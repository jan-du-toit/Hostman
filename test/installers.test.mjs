import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, lstatSync, readlinkSync, symlinkSync, linkSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root, python } from '../lib/bridge.mjs';

test('Linux command installation migrates reverse symlinks, hard links, loops and existing wrappers', {skip:process.platform==='win32'},()=>{
  for(const kind of ['reverse','hardlink','same-target','loop','normal']){
    const folder=mkdtempSync(join(tmpdir(),'hostman-links-'));
    try{
      const bin=join(folder,'bin'),install=join(folder,'Install With Spaces'),backup=join(folder,'backup');mkdirSync(bin);mkdirSync(install);mkdirSync(join(install,'runtime'));mkdirSync(join(install,'current'));mkdirSync(join(install,'current','bin'));
      const primary=join(bin,'hostman'),alias=join(bin,'hostmanager'),target=join(folder,'old-tool');
      writeFileSync(target,'old tool\n');
      if(kind==='reverse'){writeFileSync(alias,'old tool\n');symlinkSync(alias,primary);}
      if(kind==='hardlink'){writeFileSync(primary,'old tool\n');linkSync(primary,alias);}
      if(kind==='same-target'){symlinkSync(target,primary);symlinkSync(target,alias);}
      if(kind==='loop'){symlinkSync(alias,primary);symlinkSync(primary,alias);}
      if(kind==='normal'){writeFileSync(primary,'old tool\n');symlinkSync(primary,alias);}
      const script='source "$1"; hostman_install_commands "$2" "$3" "$4"';
      const run=destination=>spawnSync('bash',['-e','-c',script,'installer-test',join(root,'scripts/linux-links.sh'),bin,install,destination],{encoding:'utf8'});
      const r=run(backup);assert.equal(r.status,0,r.stderr);assert.equal(lstatSync(primary).isSymbolicLink(),false);assert.equal(readlinkSync(alias),primary);
      assert.ok(lstatSync(join(backup,'hostman')));assert.ok(lstatSync(join(backup,'hostmanager')));
      assert.equal(readFileSync(target,'utf8'),'old tool\n');
      assert.equal(run(join(folder,'second-backup')).status,0);
      // Actually execute the generated wrapper, including a path containing spaces.
      writeFileSync(join(install,'runtime','node'),'#!/bin/sh\nprintf "%s\\n" "$@"\n',{mode:0o755});
      const execute=spawnSync(primary,['list','--all'],{encoding:'utf8'});assert.equal(execute.status,0,execute.stderr);assert.equal(execute.stdout.split('\n')[0],join(install,'current/bin/hostman.mjs'));
    }finally{rmSync(folder,{recursive:true,force:true});}
  }
});

test('Linux scripts parse and rejected bootstrap tags cannot invoke package managers', {skip:process.platform==='win32'},()=>{
  for(const file of ['install.sh','setup-linux.sh','scripts/setup-linux.sh','scripts/setup-fedora.sh','scripts/linux-links.sh','scripts/uninstall-fedora.sh']){
    const r=spawnSync('bash',['-n',join(root,file)],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
  }
  const r=spawnSync('bash',[join(root,'install.sh')],{encoding:'utf8',env:{...process.env,HOSTMAN_REF:'../bad'}});
  assert.equal(r.status,1);assert.match(r.stderr,/latest Release/);
});

test('Linux DNS integration snapshots, restores, rolls back and accepts v1.0 snapshots', {skip:process.platform==='win32'},()=>{
  const py=python();
  const r=spawnSync(py.exe,[...py.args,join(root,'test','system_test.py')],{encoding:'utf8'});
  assert.equal(r.status,0,r.stdout+'\n'+r.stderr);
});
