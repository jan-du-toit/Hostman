import net from 'node:net';
import readline from 'node:readline/promises';
import { bridge, system } from './bridge.mjs';
import { info,success } from './terminal.mjs';
export async function checkDashboardPort(port){
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Dashboard port must be 1024–65535.');
  const socket=net.createServer();
  await new Promise((resolve,reject)=>{socket.once('error',()=>reject(new Error('Dashboard port '+port+' is already in use. Choose another port.')));socket.listen(port,'127.0.0.1',()=>socket.close(resolve));});
}
export async function dnsSetup(existingRl){
  if(!process.stdin.isTTY)throw new Error('DNS setup is interactive. Run sudo hostman dns setup / use an Administrator terminal.');
  system(['check-admin']);
  const rl=existingRl||readline.createInterface({input:process.stdin,output:process.stdout});
  const ask=async q=>(await rl.question(q)).trim();
  const yes=async(q,defaultYes=false)=>{const answer=(await ask(q+(defaultYes?' [Y/n] ':' [y/N] '))).toLowerCase();return answer?['y','yes'].includes(answer):defaultYes;};
  try{
    const old=bridge('export');info('DNS setup · local records resolve before your upstream servers.');
    const servers=await ask('Upstream DNS IPs ['+old.dns.upstreams.join(' ')+']: ');
    const ttl=await ask('Local record TTL in seconds ['+old.dns.ttl+']: ');
    const logging=await yes('Keep recent DNS query activity?',old.dns.logging!==false);
    const dashboard=await yes('Enable the DNS controller dashboard?',old.dashboard.enabled);
    const port=dashboard?Number((await ask('Dashboard port ['+old.dashboard.port+']: '))||old.dashboard.port):old.dashboard.port;
    if(dashboard&&(!old.dashboard.enabled||port!==old.dashboard.port))await checkDashboardPort(port);
    bridge('dns-config',{upstreams:servers?servers.split(/[\s,]+/).filter(Boolean):old.dns.upstreams,ttl:ttl?Number(ttl):old.dns.ttl,logging});
    bridge('dashboard-config',{enabled:dashboard,port,setupComplete:true});
    if(dashboard){system(['dashboard-enable']);success('Controller: http://localhost:'+port+' · sign in with your system administrator account.');}
    else if(old.dashboard.enabled)system(['dashboard-disable']);
    if(await yes('Enable Hostman DNS priority now?',false))system(['enable']);
    success('DNS setup saved. Run hostman dns setup again to change it.');
  }finally{if(!existingRl)rl.close();}
}
