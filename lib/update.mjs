import { mkdtemp, readFile, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { root } from './bridge.mjs';
const repo='https://github.com/jan-du-toit/Hostman.git';
function run(exe,args,options={}) {
  const r=spawnSync(exe,args,{encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024,...options});
  if(r.error)throw r.error;if(r.status!==0)throw new Error((r.stderr||r.stdout||'Command failed').trim());return r.stdout.trim();
}
export async function update(flags) {
  const ref=flags.ref||'main';
  if(!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$/.test(ref)||ref.includes('..'))throw new Error('Invalid branch or tag.');
  const source=await realpath(root);
  const installRoot=process.platform==='win32'?join(process.env.ProgramFiles||'C:/Program Files','Hostman'):'/opt/hostman';
  const normalized=s=>s.replaceAll('\\','/').toLowerCase();
  if(!flags.check && !normalized(source).startsWith(normalized(installRoot)+'/releases/'))throw new Error('Run the platform installer first. Source checkouts are never overwritten.');
  if(!flags.check && !flags.yes && !process.stdin.isTTY)throw new Error('Use --yes for a noninteractive update.');
  if(!flags.check && !flags.yes){
    const {createInterface}=await import('node:readline/promises');const rl=createInterface({input:process.stdin,output:process.stdout});
    try{const answer=await rl.question('Install code from '+repo+' ('+ref+')? [y/N] ');if(!/^y(es)?$/i.test(answer.trim())){console.log('Update cancelled.');return;}}finally{rl.close();}
  }
  const stage=await mkdtemp(join(tmpdir(),'hostman-update-'));
  try {
    console.log('Fetching '+repo+' · '+ref);
    run('git',['-c','core.hooksPath='+join(stage,'no-hooks'),'clone','--depth','1','--branch',ref,'--',repo,join(stage,'source')]);
    const checkout=join(stage,'source');
    const pkg=JSON.parse(await readFile(join(checkout,'package.json'),'utf8'));
    if(pkg.name!=='@bydt-softwares/hostman')throw new Error('Repository does not contain a Hostman package.');
    const sha=run('git',['-C',checkout,'rev-parse','HEAD']);
    console.log('Available version: '+pkg.version+' · commit '+sha);
    if(flags.check)return;
    if(process.platform==='win32')run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(checkout,'scripts','setup-windows.ps1'),'-Source',checkout,'-Update'],{stdio:'inherit'});
    else if(process.platform==='linux')run('bash',[join(checkout,'scripts','setup-fedora.sh'),'--source',checkout,'--update'],{stdio:'inherit'});
    else throw new Error('Supported platforms: Fedora Linux and Windows.');
    console.log('Hostman updated. Previous release retained by the installer.');
  } finally {await rm(stage,{recursive:true,force:true});}
}
