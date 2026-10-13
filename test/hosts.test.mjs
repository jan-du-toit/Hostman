import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, python } from '../lib/bridge.mjs';
const py=python();
function sandbox(initial='127.0.0.1 localhost\n# Keep me\n192.168.1.5 existing.test alias.test\n'){
  const dir=mkdtempSync(join(tmpdir(),'hostman-test-'));const hosts=join(dir,'hosts');writeFileSync(hosts,initial);
  const env={...process.env,HOSTMAN_DATA_DIR:join(dir,'data'),HOSTMAN_HOSTS_FILE:hosts};
  const request=(op,fields={})=>{
    const r=spawnSync(py.exe,[...py.args,join(root,'python/hosts.py')],{env,input:JSON.stringify({op,...fields}),encoding:'utf8'});
    if(!r.stdout)throw new Error(r.stderr);return JSON.parse(r.stdout);
  };
  return {dir,hosts,env,request,read:()=>readFileSync(hosts,'utf8'),close:()=>rmSync(dir,{recursive:true,force:true})};
}
function ok(result){assert.equal(result.ok,true,result.error);return result.result;}
test('hosts lifecycle preserves existing bytes, groups, toggles and backup restore',()=>{
  const s=sandbox();try{
    ok(s.request('init'));const original=s.read();
    ok(s.request('group',{action:'create',name:'dev'}));
    const result=ok(s.request('add',{host:'APP.test',ip:'127.0.0.2',group:'dev'}));
    assert.ok(s.read().startsWith(original));assert.match(s.read(),/127.0.0.2\tapp.test/);
    ok(s.request('set',{key:'app.test',ip:'::1',comment:'local app'}));assert.match(s.read(),/::1\tapp.test/);
    ok(s.request('group',{action:'disable',name:'dev'}));assert.doesNotMatch(s.read(),/app.test/);
    ok(s.request('group',{action:'enable',name:'dev'}));assert.match(s.read(),/app.test/);
    ok(s.request('disable',{key:'app.test'}));assert.doesNotMatch(s.read(),/app.test/);
    ok(s.request('enable',{key:'app.test'}));
    ok(s.request('group',{action:'rename',name:'dev',new:'work'}));assert.equal(ok(s.request('export')).entries[0].group,'work');
    ok(s.request('remove',{key:'app.test'}));assert.equal(ok(s.request('export')).entries.length,0);
    ok(s.request('restore',{name:result.backup}));assert.equal(s.read(),original.replace(/# BEGIN HOSTMAN[\s\S]*/,'' )+'# BEGIN HOSTMAN - ByDT Softwares\n# END HOSTMAN\n');
  }finally{s.close();}
});
test('duplicate external hosts, injection, corrupt markers and import schema rejected without writes',()=>{
  const s=sandbox();try{
    ok(s.request('init'));const original=s.read();
    for(const fields of [{host:'existing.test',ip:'127.0.0.1'},{host:'bad\nname',ip:'127.0.0.1'},{host:'app.test',ip:'999.1.1.1'},{host:'app.test',ip:'127.0.0.1',comment:'one\ntwo'}])assert.equal(s.request('add',fields).ok,false);
    assert.equal(s.read(),original);
    assert.equal(s.request('import',{data:{schema:2}}).ok,false);
    assert.equal(s.request('dns-config',{upstreams:['127.0.0.1']}).ok,false);
    writeFileSync(s.hosts,original+'# BEGIN HOSTMAN - ByDT Softwares\n');
    assert.equal(s.request('add',{host:'app.test',ip:'127.0.0.1'}).ok,false);
  }finally{s.close();}
});
test('raw editor detects concurrent writes and protects managed block',()=>{
  const s=sandbox();try{
    ok(s.request('add',{host:'app.test',ip:'::1'}));
    let raw=ok(s.request('raw'));
    ok(s.request('write-raw',{hash:raw.hash,text:raw.text+'10.0.0.8 new.test\n'}));assert.match(s.read(),/new.test/);
    assert.equal(s.request('write-raw',{hash:raw.hash,text:raw.text}).ok,false);
    raw=ok(s.request('raw'));
    assert.equal(s.request('write-raw',{hash:raw.hash,text:raw.text+'invalid\n'}).ok,false);
    ok(s.request('write-raw',{hash:raw.hash,text:raw.text.replace('::1\tapp.test','127.0.0.6\tapp.test')}));assert.match(s.read(),/::1\tapp.test/);
  }finally{s.close();}
});
test('interrupted transaction rolls back hosts and state',()=>{
  const s=sandbox();try{
    const res=ok(s.request('add',{host:'app.test',ip:'127.0.0.1'}));
    writeFileSync(join(s.dir,'data','transaction.json'),JSON.stringify({backup:res.backup}));
    writeFileSync(s.hosts,'broken partial write');
    assert.equal(s.request('list').ok,false);ok(s.request('recover'));
    assert.match(s.read(),/localhost/);assert.doesNotMatch(s.read(),/app.test/);
    assert.equal(ok(s.request('export')).entries.length,0);
  }finally{s.close();}
});
test('CLI commands work end-to-end and never touch real hosts in tests',()=>{
  const s=sandbox();try{
    const cli=args=>spawnSync(process.execPath,[join(root,'bin/hostman.mjs'),...args],{env:s.env,encoding:'utf8'});
    assert.equal(cli(['add','site.test','10.0.0.9','--comment','']).status,0);
    const exported=join(s.dir,'export.json');assert.equal(cli(['export',exported]).status,0);
    assert.equal(cli(['clear']).status,1);assert.equal(cli(['clear','--yes']).status,0);
    assert.equal(cli(['import',exported,'--yes']).status,0);
    const result=cli(['list','--json']);assert.equal(result.status,0);assert.equal(JSON.parse(result.stdout).data.entries[0].host,'site.test');
    assert.equal(cli(['dns','enable']).status,1);assert.match(cli(['dns','enable']).stderr,/test path overrides|sudo|Administrator/);
    assert.equal(cli(['update','--yes']).status,1);assert.match(cli(['update','--yes']).stderr,/installer first/);
  }finally{s.close();}
});

test('concurrent Python edits serialize without losing entries',async()=>{
  const s=sandbox();try{
    const {spawn}=await import('node:child_process');
    const results=await Promise.all(Array.from({length:12},(_,i)=>new Promise((resolve,reject)=>{
      const p=spawn(py.exe,[...py.args,join(root,'python/hosts.py')],{env:s.env});let output='',error='';
      p.stdout.on('data',chunk=>output+=chunk);p.stderr.on('data',chunk=>error+=chunk);p.on('error',reject);
      p.on('close',code=>{try{resolve(JSON.parse(output));}catch{reject(new Error(error||'No result'));}});
      p.stdin.end(JSON.stringify({op:'add',host:'host'+i+'.test',ip:'127.0.0.1'}));
    })));
    results.forEach(ok);const data=ok(s.request('export'));assert.equal(data.entries.length,12);
    assert.equal((s.read().match(/\thost\d+.test/g)||[]).length,12);
  }finally{s.close();}
});

test('CRLF hosts entries and trailing unmanaged content are preserved',()=>{
  const original='127.0.0.1 localhost\r\n# Header\r\n# BEGIN HOSTMAN - ByDT Softwares\r\n# END HOSTMAN\r\n10.0.0.1 existing.test\r\n';
  const s=sandbox(original);try{ok(s.request('add',{host:'new.test',ip:'::1'}));assert.ok(s.read().endsWith('10.0.0.1 existing.test\r\n'));assert.match(s.read(),/::1\tnew.test[^\r]*\r\n/);}
  finally{s.close();}
});

test('foreground CLI DNS reloads a hosts edit without restarting',async()=>{
  const s=sandbox();const {spawn}=await import('node:child_process');const net=await import('node:net');
  const {exchange,makeQuery}=await import('../lib/dns.mjs');let child;
  try{
    ok(s.request('add',{host:'live.test',ip:'10.0.0.1'}));
    const reserve=net.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
    child=spawn(process.execPath,[join(root,'bin/hostman.mjs'),'dns','serve','--port',String(port)],{env:s.env});
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('DNS startup timed out')),4000);
      child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);reject(new Error('DNS exited: '+code));});
      child.stdout.on('data',chunk=>{if(chunk.toString().includes('listening')){clearTimeout(timer);resolve();}});
    });
    let reply=await exchange(makeQuery('live.test'),{address:'127.0.0.1',port});assert.deepEqual(reply.subarray(-4),Buffer.from([10,0,0,1]));
    ok(s.request('set',{key:'live.test',ip:'10.0.0.2'}));
    const deadline=Date.now()+3000;
    do{await new Promise(r=>setTimeout(r,100));reply=await exchange(makeQuery('live.test'),{address:'127.0.0.1',port});}while(reply.at(-1)!==2&&Date.now()<deadline);
    assert.deepEqual(reply.subarray(-4),Buffer.from([10,0,0,2]));
  }finally{if(child){child.kill();await new Promise(r=>child.once('exit',r));}s.close();}
});
