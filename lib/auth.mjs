import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { python,root } from './bridge.mjs';
export function authenticate(username,password){
  const py=python();return new Promise(resolve=>{
    const child=spawn(py.exe,[...py.args,join(root,'python/auth.py')],{stdio:['pipe','pipe','ignore'],env:{...process.env,PYTHONUTF8:'1'}});
    let output='',finished=false;const timer=setTimeout(()=>{child.kill();done(false);},15000);
    function done(result){if(finished)return;finished=true;clearTimeout(timer);resolve(result);}
    child.on('error',()=>done(false));child.stdout.on('data',chunk=>{output+=chunk;if(output.length>4096){child.kill();done(false);}});
    child.on('close',()=>{try{const r=JSON.parse(output);done(r.ok?{user:r.user}:false);}catch{done(false);}});
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({username,password}));
  });
}
