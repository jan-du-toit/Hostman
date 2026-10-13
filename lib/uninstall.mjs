import { access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { bridge, root, system } from './bridge.mjs';
export async function uninstall(flags={}){
  if(process.env.HOSTMAN_DATA_DIR||process.env.HOSTMAN_HOSTS_FILE)throw new Error('Uninstall is disabled with test path overrides.');
  if(!flags.yes){
    if(!process.stdin.isTTY)throw new Error('Run hostman uninstall --yes for a noninteractive uninstall.');
    const {createInterface}=await import('node:readline/promises');const rl=createInterface({input:process.stdin,output:process.stdout});
    try{if(!/^y(es)?$/i.test((await rl.question('Uninstall Hostman and restore system DNS? Hosts and backups are retained. [y/N] ')).trim()))return;}finally{rl.close();}
  }
  system(['check-admin']);
  if(flags['remove-hosts'])bridge('clear');
  let r;
  if(process.platform==='win32'){
    const exe=join(process.env.ProgramFiles||'C:/Program Files','Hostman','Uninstall.exe');
    if(await access(exe).then(()=>true,()=>false))r=spawnSync(exe,['/S'],{stdio:'inherit'});
    else r=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'scripts/uninstall-windows.ps1')],{stdio:'inherit'});
  }else r=spawnSync('bash',[join(root,'scripts/uninstall-fedora.sh')],{stdio:'inherit'});
  if(r.error)throw r.error;if(r.status!==0)throw new Error('Uninstall stopped; restore DNS successfully before retrying.');
}
