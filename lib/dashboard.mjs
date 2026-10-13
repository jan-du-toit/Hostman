import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { bridge, root, system } from './bridge.mjs';
import { authenticate } from './auth.mjs';
const assets={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/bydt-logo.png':'bydt-logo.png'};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png'};
const allowedFields={add:['host','ip','group','comment'],set:['key','host','ip','group','comment'],remove:['key'],enable:['key'],disable:['key'],group:['action','name','new'],'dns-config':['upstreams','ttl','timeoutMs','logging'],'dns-block':['domain'],'dns-unblock':['domain']};
const allowedOps=new Set(Object.keys(allowedFields));
function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;return timingSafeEqual(Buffer.from(a),Buffer.from(b));}
async function body(req){
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>8192)throw Object.assign(new Error('Request too large'),{status:413});chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(new Error('Invalid JSON'),{status:400});}
}
export async function createDashboard({port=8090,auth=authenticate,getState=()=>bridge('list'),mutate=(op,data)=>bridge(op,data),service=action=>system([action]),statsFile,staticRoot=join(root,'dashboard')}={}){
  const sessions=new Map(),attempts=new Map();let pendingLogins=0;
  const server=http.createServer(async(req,res)=>{
    function json(status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try{
      const actual=server.address().port;
      if(![`127.0.0.1:${actual}`,`localhost:${actual}`].includes(req.headers.host)){json(403,{error:'Invalid dashboard host.'});return;}
      const path=new URL(req.url,'http://localhost').pathname;
      const origin=req.headers.origin;
      const sameOrigin=origin===`http://${req.headers.host}`;
      if(req.method==='POST'&&!sameOrigin){json(403,{error:'Same-origin requests required.'});return;}
      const cookie=(req.headers.cookie||'').split(';').map(v=>v.trim()).filter(v=>v.startsWith('hostman_session='));
      const sid=cookie.length===1?cookie[0].slice('hostman_session='.length):'';
      let session=sessions.get(sid);
      if(session&&(Date.now()>session.expires||Date.now()>session.absolute)){sessions.delete(sid);session=null;}
      if(path==='/api/health'&&req.method==='GET'){json(200,{service:'hostman-dashboard'});return;}
      if(path==='/api/login'&&req.method==='POST'){
        const key=req.socket.remoteAddress;const now=Date.now();let rate=attempts.get(key)||{since:now,count:0};
        if(now-rate.since>60000)rate={since:now,count:0};
        if(rate.count>=5||pendingLogins>=2){json(429,{error:'Too many login attempts. Wait a minute.'});return;}
        rate.count++;attempts.set(key,rate);const credentials=await body(req);
        if(typeof credentials.username!=='string'||typeof credentials.password!=='string'||!credentials.password||credentials.username.length>256||credentials.password.length>1024){json(401,{error:'Invalid username/password or administrator access required.'});return;}
        pendingLogins++;let identity;try{identity=await auth(credentials.username,credentials.password);}finally{pendingLogins--;credentials.password='';}
        if(!identity){json(401,{error:'Invalid username/password or administrator access required.'});return;}
        if(sid)sessions.delete(sid);
        if(sessions.size>=100){json(503,{error:'Session limit reached.'});return;}
        const token=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url');
        sessions.set(token,{user:identity.user,csrf,expires:now+30*60000,absolute:now+8*3600000});attempts.delete(key);
        res.setHeader('Set-Cookie',`hostman_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);json(200,{user:identity.user,csrf});return;
      }
      if(path.startsWith('/api/')){
        if(!session){json(401,{error:'Sign in to continue.'});return;}
        session.expires=Date.now()+30*60000;
        if(req.method==='POST'&&!equal(req.headers['x-hostman-csrf'],session.csrf)){json(403,{error:'Invalid CSRF token.'});return;}
        if(path==='/api/session'&&req.method==='GET'){json(200,{user:session.user,csrf:session.csrf});return;}
        if(path==='/api/logout'&&req.method==='POST'){sessions.delete(sid);res.setHeader('Set-Cookie','hostman_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');json(200,{ok:true});return;}
        if(path==='/api/state'&&req.method==='GET'){
          const state=getState();let stats=null;
          if(statsFile)try{stats=JSON.parse(await readFile(statsFile,'utf8'));}catch{}
          let priority=false;if(state.dataDir)try{priority=JSON.parse(await readFile(join(state.dataDir,'dns-system.json'),'utf8')).phase==='enabled';}catch{}
          json(200,{...state,stats,priority,user:session.user});return;
        }
        if(path==='/api/action'&&req.method==='POST'){
          const {op,fields}=await body(req);
          if(!allowedOps.has(op)||!fields||typeof fields!=='object'||Array.isArray(fields))throw new Error('Unsupported DNS action.');
          if(Object.keys(fields).some(key=>!allowedFields[op].includes(key)))throw new Error('Unsupported action field.');
          json(200,{ok:true,result:mutate(op,fields)});return;
        }
        if(path==='/api/service'&&req.method==='POST'){
          const {action}=await body(req);
          if(!['enable','disable','start','stop','restart','flush'].includes(action))throw new Error('Unsupported service action.');
          // No endpoint accepts shell text or command arguments from the browser.
          service(action);json(200,{ok:true});return;
        }
        json(404,{error:'Unknown endpoint.'});return;
      }
      if(req.method!=='GET'||!assets[path]){json(404,{error:'Not found.'});return;}
      const file=assets[path],type=Object.keys(types).find(ext=>file.endsWith(ext));
      res.writeHead(200,{'Content-Type':types[type]});res.end(await readFile(join(staticRoot,file)));
    }catch(error){if(!res.headersSent)json(error.status||400,{error:error.message});else res.end();}
  });
  server.requestTimeout=20000;server.headersTimeout=10000;server.maxConnections=64;
  const housekeeping=setInterval(()=>{const now=Date.now();for(const [sid,s] of sessions)if(s.expires<now||s.absolute<now)sessions.delete(sid);for(const [key,r] of attempts)if(now-r.since>60000)attempts.delete(key);},60000);housekeeping.unref();
  server.on('close',()=>clearInterval(housekeeping));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
  return server;
}
export async function serveDashboard(){
  const state=bridge('status');
  if(process.env.HOSTMAN_DATA_DIR||process.env.HOSTMAN_HOSTS_FILE)throw new Error('Installed dashboard service refuses test path overrides. Use the dashboard test factory instead.');
  const statsFile=process.platform==='win32'?join(state.dataDir,'runtime','dns-stats.json'):'/run/hostman/dns-stats.json';
  const server=await createDashboard({port:state.data.dashboard.port,statsFile});
  console.log('ByDT Hostman DNS Controller: http://localhost:'+server.address().port);
  const stop=()=>{server.closeAllConnections();server.close(()=>process.exit(0));};process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
