import test from 'node:test';
import assert from 'node:assert/strict';
import { selectAsset,compareVersions,latestRelease } from '../lib/update.mjs';
import { spawnSync } from 'node:child_process';
import { root,python } from '../lib/bridge.mjs';
import { join } from 'node:path';
const asset=name=>({name,state:'uploaded',size:100,browser_download_url:'https://github.com/jan-du-toit/Hostman/releases/download/v1.2.0/'+name});
test('updater selects latest Release ZIPs and ignores generated source downloads',()=>{
  assert.equal(selectAsset({assets:[asset('Hostman-v1.2.0.zip')]}).name,'Hostman-v1.2.0.zip');
  assert.equal(selectAsset({assets:[asset('hostman-linux.zip'),asset('hostman-windows.zip')]},'linux').name,'hostman-linux.zip');
  assert.throws(()=>selectAsset({assets:[asset('one.zip'),asset('two.zip')]}),/ambiguous/);
  assert.throws(()=>selectAsset({assets:[],zipball_url:'https://github.com/source.zip'}),/no uploaded/);
  assert.throws(()=>selectAsset({draft:true,assets:[asset('one.zip')]}),/stable/);
  assert.throws(()=>selectAsset({assets:[{...asset('one.zip'),browser_download_url:'https://evil.test/app.zip'}]}),/Invalid/);
  assert.equal(compareVersions('1.2.0','1.1.99'),1);assert.equal(compareVersions('v1.2.0','1.2.0'),0);assert.equal(compareVersions('1.1.0','1.2.0'),-1);
});
test('missing latest Release produces a clear error instead of using a branch',async()=>{
  const old=global.fetch;global.fetch=async()=>({status:404,ok:false});
  try{await assert.rejects(latestRelease(),/No published stable/);}finally{global.fetch=old;}
});
test('Release extraction rejects traversal, duplicate names, symlinks and incomplete projects',()=>{
  const py=python();const r=spawnSync(py.exe,[...py.args,join(root,'test/release_test.py')],{encoding:'utf8'});assert.equal(r.status,0,r.stdout+'\n'+r.stderr);
});
