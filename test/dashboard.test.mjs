import test from 'node:test';
import assert from 'node:assert/strict';
import { createDashboard } from '../lib/dashboard.mjs';
import { bridge } from '../lib/bridge.mjs';

test('dashboard requires system authentication, CSRF and same-origin requests',async()=>{
  const changes=[];const server=await createDashboard({port:0,auth:async(user,password)=>user==='admin'&&password==='correct'?{user}:false,getState:()=>({data:{entries:[],groups:{default:true},dns:{upstreams:['1.1.1.1']},dashboard:{port:8090}}}),mutate:(op,fields)=>{changes.push({op,fields});return {message:'Saved'};},service:a=>changes.push(a)});
  const url='http://127.0.0.1:'+server.address().port;
  const call=(path,body,headers={})=>fetch(url+path,{method:body?'POST':'GET',headers:{...(body?{'Origin':url,'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
  try{
    let r=await call('/');assert.equal(r.status,200);assert.match(await r.text(),/Your DNS/);assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);
    assert.equal((await call('/api/state')).status,401);
    assert.equal((await call('/api/login',{username:'admin',password:'correct'},{Origin:'https://evil.test'})).status,403);
    assert.equal((await call('/api/login',{username:'admin',password:'wrong'})).status,401);
    r=await call('/api/login',{username:'admin',password:'correct'});assert.equal(r.status,200);
    const cookie=r.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);const session=await r.json();const headers={Cookie:cookie.split(';')[0]};
    assert.equal((await call('/api/state',undefined,headers)).status,200);
    assert.equal((await call('/api/action',{op:'add',fields:{host:'app.test',ip:'127.0.0.1'}},headers)).status,403);
    headers['X-Hostman-CSRF']=session.csrf;
    assert.equal((await call('/api/action',{op:'add',fields:{host:'app.test',ip:'127.0.0.1'}},headers)).status,200);
    assert.deepEqual(changes[0],{op:'add',fields:{host:'app.test',ip:'127.0.0.1'}});
    assert.equal((await call('/api/action',{op:'add',fields:{op:'clear',host:'app.test',ip:'127.0.0.1'}},headers)).status,400);
    assert.equal((await call('/api/action',{op:'write-raw',fields:{}},headers)).status,400);
    assert.equal((await call('/api/service',{action:'rm -rf /'},headers)).status,400);
    assert.equal((await call('/api/service',{action:'restart'},headers)).status,200);assert.equal(changes.at(-1),'restart');
    assert.equal((await call('/api/logout',{},headers)).status,200);assert.equal((await call('/api/state',undefined,headers)).status,401);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('dashboard rate limits failed login attempts',async()=>{
  const server=await createDashboard({port:0,auth:async()=>false});const url='http://127.0.0.1:'+server.address().port;
  try{for(let i=0;i<5;i++)assert.equal((await fetch(url+'/api/login',{method:'POST',headers:{Origin:url,'Content-Type':'application/json'},body:JSON.stringify({username:'unknown',password:'invalid'})})).status,401);
    assert.equal((await fetch(url+'/api/login',{method:'POST',headers:{Origin:url},body:'{}'})).status,429);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('system authentication rejects empty credentials and native PAM conversation works', {skip:process.platform==='win32'},async()=>{
  const {spawnSync}=await import('node:child_process');const {python,root}=await import('../lib/bridge.mjs');const {join}=await import('node:path');
  const py=python();const r=spawnSync(py.exe,[...py.args,join(root,'test/auth_test.py')],{encoding:'utf8'});assert.equal(r.status,0,r.stdout+'\n'+r.stderr);
});

test('dashboard port changes detect conflicts before saving configuration',async()=>{
  const net=await import('node:net');const {checkDashboardPort}=await import('../lib/setup.mjs');
  const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;
  try{await assert.rejects(checkDashboardPort(port),/already in use/);await assert.rejects(checkDashboardPort(53),/1024/);}finally{await new Promise(r=>socket.close(r));}
  await checkDashboardPort(port);
});
