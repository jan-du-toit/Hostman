import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
export const root = dirname(dirname(fileURLToPath(import.meta.url)));
export function python() {
  if(process.env.HOSTMAN_PYTHON)return {exe:process.env.HOSTMAN_PYTHON,args:[]};
  for(const [exe,args] of process.platform==='win32' ? [['python',[]],['py',['-3']]] : [['python3',[]]]) {
    const result=spawnSync(exe,[...args,'-c','import sys; assert sys.version_info >= (3, 9)'],{encoding:'utf8'});
    if(result.status===0)return {exe,args};
  }
  throw new Error('Python 3.9+ is required. Install Python and add it to PATH.');
}
export function bridge(op,fields={}) {
  const p=python();
  const child=spawnSync(p.exe,[...p.args,join(root,'python','hosts.py')],{input:JSON.stringify({op,...fields}),encoding:'utf8',maxBuffer:8*1024*1024,timeout:30000});
  if(child.error)throw child.error;
  let result;try{result=JSON.parse(child.stdout);}catch{throw new Error(child.stderr.trim()||'Python hosts helper did not return a valid response.');}
  if(!result.ok)throw new Error(result.error);
  return result.result;
}
export function system(args) {
  const p=python();const child=spawnSync(p.exe,[...p.args,join(root,'python','system.py'),...args],{stdio:'inherit'});
  if(child.error)throw child.error;if(child.status!==0)throw new Error('System operation failed.');
}
