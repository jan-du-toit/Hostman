#!/usr/bin/env node
import { readFile, writeFile, mkdtemp, rm, access, appendFile, stat, rename, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import readline from 'node:readline/promises';
import { bridge, system, root } from '../lib/bridge.mjs';
import { createDnsServer, readTable, makeQuery, exchange, answerAddresses } from '../lib/dns.mjs';
import { update } from '../lib/update.mjs';
import { uninstall } from '../lib/uninstall.mjs';
import { paint,banner,info,success,hostTable } from '../lib/terminal.mjs';
import { dnsSetup,checkDashboardPort } from '../lib/setup.mjs';
import { serveDashboard } from '../lib/dashboard.mjs';

const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const help=`${paint(36,'Hostman '+pkg.version)} · ByDT Softwares · MIT License

hostman                          Interactive menu
hostman list [--all] [--json]     List managed hosts; --all includes existing hosts
hostman add HOST IP [--group NAME] [--comment TEXT]
hostman set HOST-OR-ID [--ip IP] [--host NEWNAME] [--group NAME] [--comment TEXT]
hostman remove HOST-OR-ID         Remove a managed entry
hostman enable|disable HOST-OR-ID Toggle an entry
hostman groups                   List groups
hostman group create|enable|disable|clear|delete NAME [--yes]
hostman group rename OLD NEW
hostman clear --yes               Remove all managed entries
hostman edit-file                 Edit existing hosts in your text editor
hostman export FILE               Export managed entries and DNS config to JSON
hostman import FILE --yes         Replace managed entries and config from JSON
hostman backups                   List automatic backups
hostman restore BACKUP-ID --yes   Restore the complete hosts/state snapshot
hostman recover                   Recover an interrupted hosts transaction
hostman dns setup                First-time DNS/dashboard setup wizard
hostman dns status|enable|disable|start|stop|restart
hostman dns upstream IP [IP ...]  Set explicit upstream DNS servers
hostman dns config [--ttl N] [--timeout N] [--logging on|off]
hostman dns block|unblock DOMAIN  Exact host or *.domain blocking
hostman dns blocks               List DNS blocking rules
hostman dashboard status|enable|disable|start|stop|restart
hostman dashboard port NUMBER    Change dashboard port (default 8090)
hostman dns lookup HOST [--type A|AAAA] [--tcp]
hostman dns serve [--port N]      Foreground DNS server (normally a system service)
hostman flush                     Clear the OS resolver cache
hostman doctor                    Check dependencies, paths and local DNS
hostman update [--check] [--yes]  Install the latest Release ZIP
hostman uninstall [--yes] [--remove-hosts]
hostman version|help

Writes require sudo on Fedora/Ubuntu or an Administrator terminal on Windows.
DNS priority requires the platform installer first. DNS-changing commands
are under the DNS menu. hostmanager is an alias for hostman.
`;

function parse(args) {
  const flags={},pos=[];
  const values=new Set(['group','comment','ip','host','port','type','ref','ttl','timeout','logging']);
  const booleans=new Set(['all','json','yes','tcp','check','help','remove-hosts']);
  for(let i=0;i<args.length;i++) {
    if(!args[i].startsWith('--')){pos.push(args[i]);continue;}
    const key=args[i].slice(2);
    if(key in flags)throw new Error('Duplicate option --'+key);
    if(values.has(key)) {if(i+1 >= args.length || args[i+1].startsWith('--'))throw new Error('--'+key+' needs a value');flags[key]=args[++i];}
    else if(booleans.has(key))flags[key]=true;
    else throw new Error('Unknown option --'+key);
  }
  return {pos,flags};
}
function count(pos,min,max=min){if(pos.length<min || pos.length>max)throw new Error('Wrong number of arguments. Run hostman help.');}
function requireYes(flags){if(!flags.yes)throw new Error('This replaces or deletes data. Repeat with --yes; an automatic backup will be saved.');}
function out(result,json=false){if(json)console.log(JSON.stringify(result,null,2));else {console.log(paint(32,result.message||'Saved.'));if(result.backup)console.log('Backup: '+result.backup);}}
function list(flags={}) {
  const r=bridge('list');if(flags.json){console.log(JSON.stringify(r,null,2));return;}
  const rows=r.data.entries.map(e=>({host:e.host,ip:e.ip,group:e.group,state:e.enabled&&r.data.groups[e.group]?'on':'off',id:e.id}));
  if(rows.length)hostTable(rows);else console.log('No managed hosts yet. Try: hostman add app.test 127.0.0.1');
  if(flags.all){console.log('Existing hosts outside the managed section:');console.table(r.unmanaged);}
}
async function serve(flags) {
  const port=Number(flags.port||53);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid port.');
  // Installed services use fixed system locations; user overrides only affect explicit foreground runs.
  const info=bridgeForServe();
  if(await access(join(info.dataDir,'transaction.json')).then(()=>true,()=>false))throw new Error('Recover the interrupted hosts transaction before starting DNS.');
  let current=await readTable(info.dataDir,info.hostsFile);
  const log=async message=>{
    const line=new Date().toISOString()+' '+message+'\n';console.log(message);
    if(process.platform==='win32')try{const file=join(info.dataDir,'dns.log');if((await stat(file).catch(()=>({size:0}))).size>5*1024*1024)await rename(file,file+'.1').catch(()=>{});await appendFile(file,line);}catch{}
  };
  const metricsDir=process.env.HOSTMAN_DATA_DIR?join(info.dataDir,'runtime'):process.platform==='win32'?join(info.dataDir,'runtime'):'/run/hostman';
  await mkdir(metricsDir,{recursive:true,mode:0o700});
  const metrics={started:new Date().toISOString(),updated:new Date().toISOString(),counts:{total:0,local:0,upstream:0,blocked:0,failed:0},queries:[]};
  const server=await createDnsServer({...current,port,logger:m=>void log(m),onQuery:event=>{metrics.counts.total++;metrics.counts[event.source]++;if(current.config.logging!==false){metrics.queries.push(event);if(metrics.queries.length>200)metrics.queries.shift();}}});
  let writingMetrics=false;
  const metricsTimer=setInterval(async()=>{if(writingMetrics)return;writingMetrics=true;try{metrics.updated=new Date().toISOString();if(current.config.logging===false)metrics.queries=[];const temporary=join(metricsDir,'dns-stats.new');await writeFile(temporary,JSON.stringify(metrics),{mode:0o600});await rename(temporary,join(metricsDir,'dns-stats.json'));}catch{}finally{writingMetrics=false;}},2000);
  await log('Hostman DNS listening on 127.0.0.1 and ::1, UDP/TCP port '+port);
  let reloading=false, lastError='';
  const timer=setInterval(async()=>{
    if(reloading)return;reloading=true;
    try {
      await access(join(info.dataDir,'transaction.json')).then(()=>{throw new Error('Hosts transaction in progress');},()=>{});
      current=await readTable(info.dataDir,info.hostsFile);server.update(current.table,current.config);lastError='';
    } catch(e) {if(e.message!==lastError && e.message!=='Hosts transaction in progress'){lastError=e.message;void log('Reload failed; keeping previous entries: '+e.message);}}
    finally{reloading=false;}
  },1000);
  let closing=false;
  async function stop(){if(closing)return;closing=true;clearInterval(timer);clearInterval(metricsTimer);await server.close();process.exit(0);}
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
function bridgeForServe() {
  // DNS can run under an unprivileged system account without Python or PATH discovery.
  return {dataDir:process.env.HOSTMAN_DATA_DIR || (process.platform==='win32'?join(process.env.ProgramData||'C:/ProgramData','Hostman'):'/var/lib/hostman'),hostsFile:process.env.HOSTMAN_HOSTS_FILE || (process.platform==='win32'?join(process.env.SystemRoot||'C:/Windows','System32/drivers/etc/hosts'):'/etc/hosts')};
}
async function editFile() {
  const before=bridge('raw');const dir=await mkdtemp(join(tmpdir(),'hostman-edit-'));const file=join(dir,'hosts');
  try {
    await writeFile(file,before.text,{mode:0o600});
    const editor=process.env.HOSTMAN_EDITOR || (process.platform==='win32'?'notepad.exe':'vi');
    const child=spawnSync(editor,[file],{stdio:'inherit'});if(child.error)throw child.error;if(child.status!==0)throw new Error('Editor exited unsuccessfully.');
    const text=await readFile(file,'utf8');if(text===before.text){console.log('No changes.');return;}
    out(bridge('write-raw',{text,hash:before.hash}));
  } finally {await rm(dir,{recursive:true,force:true});}
}
async function doctor(){
  console.log('Hostman '+pkg.version+' · Node '+process.version+' · '+process.platform);
  const r=bridge('status');console.log('Python helper: OK\nHosts: '+r.hostsFile+'\nData: '+r.dataDir);
  console.log('Upstreams: '+r.data.dns.upstreams.join(', '));
  try{const reply=await exchange(makeQuery('localhost'),'127.0.0.1',1000);console.log('Local DNS: responding (rcode '+(reply[3]&15)+')');}catch{console.log('Local DNS: stopped or unavailable');}
  console.log('Apps using their own DNS / browser Secure DNS can bypass system DNS.');
}
async function execute(args){
  const {pos,flags}=parse(args);if(flags.help){console.log(help);return;}
  const [cmd,...tail]=pos;
  switch(cmd){
    case 'help':console.log(help);break;
    case 'version':console.log(pkg.version);break;
    case 'init':count(tail,0);out(bridge('init'));break;
    case 'list':count(tail,0);list(flags);break;
    case 'add':count(tail,2);out(bridge('add',{host:tail[0],ip:tail[1],group:flags.group||'default',comment:flags.comment||''}),flags.json);break;
    case 'set':{
      count(tail,1);const fields={key:tail[0]};for(const key of ['ip','host','group','comment'])if(key in flags)fields[key]=flags[key];
      if(Object.keys(fields).length===1)throw new Error('Set needs --ip, --host, --group or --comment.');out(bridge('set',fields),flags.json);break;
    }
    case 'remove':case 'enable':case 'disable':count(tail,1);out(bridge(cmd,{key:tail[0]}),flags.json);break;
    case 'groups':count(tail,0);console.table(Object.entries(bridge('export').groups).map(([group,enabled])=>({group,enabled})));break;
    case 'group':count(tail,tail[0]==='rename'?3:2);if(['clear','delete'].includes(tail[0]))requireYes(flags);out(bridge('group',{action:tail[0],name:tail[1],new:tail[2]}),flags.json);break;
    case 'clear':count(tail,0);requireYes(flags);out(bridge('clear'));break;
    case 'export':count(tail,1);await writeFile(tail[0],JSON.stringify(bridge('export'),null,2)+'\n',{mode:0o600,flag:'wx'});console.log('Exported to '+tail[0]);break;
    case 'import':count(tail,1);requireYes(flags);out(bridge('import',{data:JSON.parse(await readFile(tail[0],'utf8'))}));break;
    case 'backups':count(tail,0);console.log(bridge('backups').join('\n')||'No backups.');break;
    case 'restore':count(tail,1);requireYes(flags);out(bridge('restore',{name:tail[0]}));break;
    case 'recover':count(tail,0);out(bridge('recover'));break;
    case 'edit-file':count(tail,0);await editFile();break;
    case 'doctor':count(tail,0);await doctor();break;
    case 'flush':count(tail,0);system(['flush']);break;
    case 'dns':{
      const [action,...rest]=tail;
      if(action==='setup'){count(rest,0);await dnsSetup();}
      else if(['status','enable','disable','start','stop','restart'].includes(action)){count(rest,0);if(action==='enable'&&process.stdin.isTTY&&!bridge('export').setupComplete)await dnsSetup();system([action]);}
      else if(action==='serve'){count(rest,0);await serve(flags);}
      else if(action==='upstream'){count(rest,1,5);out(bridge('dns-config',{upstreams:rest}));}
      else if(action==='config'){
        count(rest,0);const fields={};if(flags.ttl!==undefined)fields.ttl=Number(flags.ttl);if(flags.timeout!==undefined)fields.timeoutMs=Number(flags.timeout);
        if(flags.logging!==undefined){if(!['on','off'].includes(flags.logging))throw new Error('Logging must be on or off.');fields.logging=flags.logging==='on';}
        if(Object.keys(fields).length)out(bridge('dns-config',fields));else console.log(JSON.stringify(bridge('export').dns,null,2));
      }
      else if(['block','unblock'].includes(action)){count(rest,1);out(bridge('dns-'+action,{domain:rest[0]}));}
      else if(action==='blocks'){count(rest,0);console.log((bridge('export').dns.blocks||[]).join('\n')||'No blocked domains.');}
      else if(action==='lookup'){
        count(rest,1);const type=(flags.type||'A').toUpperCase();if(!['A','AAAA'].includes(type))throw new Error('Type must be A or AAAA.');
        const reply=await exchange(makeQuery(rest[0],type==='A'?1:28),'127.0.0.1',5000,Boolean(flags.tcp));
        const code=reply[3]&15;console.log('Hostman DNS: '+rest[0]+' · rcode '+code+' · answers '+reply.readUInt16BE(6));
        if(code!==0)throw new Error('DNS returned error '+code);
        const addresses=answerAddresses(reply);if(addresses.length)console.table(addresses);else console.log('No address records for this hostname/type.');
      }else throw new Error('Run hostman help for DNS commands.');break;
    }
    case 'dashboard':{
      const [action,...rest]=tail;
      if(action==='serve'){count(rest,0);await serveDashboard();}
      else if(action==='port'){count(rest,1);const before=bridge('export');if(Number(rest[0])!==before.dashboard.port)await checkDashboardPort(Number(rest[0]));out(bridge('dashboard-config',{port:Number(rest[0])}));if(before.dashboard.enabled)system(['dashboard-restart']);info('Dashboard: http://localhost:'+Number(rest[0]));}
      else if(['enable','disable','start','stop','restart','status'].includes(action)){count(rest,0);if(action==='enable'||action==='disable')bridge('dashboard-config',{enabled:action==='enable'});system(['dashboard-'+action]);}
      else throw new Error('Run hostman help for dashboard commands.');break;
    }
    case 'uninstall':count(tail,0);await uninstall(flags);break;
    case 'update':count(tail,0);await update(flags);break;
    default:throw new Error('Unknown command. Run hostman help.');
  }
}
async function menu(){
  const rl=readline.createInterface({input:process.stdin,output:process.stdout});
  const ask=async prompt=>(await rl.question(prompt)).trim();
  const yes=async prompt=>['y','yes'].includes((await ask(prompt+' [y/N] ')).toLowerCase());
  try {
    while(true){
      console.log(banner(pkg.version));
      console.log(' 1 List hosts        2 Add host         3 Edit host\n 4 Remove host       5 Toggle host      6 Groups\n 7 Edit hosts file   8 Export JSON      9 Import JSON\n10 Backups/restore  11 DNS menu        12 Doctor\n13 Update          14 DNS setup       15 Dashboard\n16 Uninstall        0 Exit');
      try {
        const choice=await ask('hostman › ');
        if(choice==='0'||choice.toLowerCase()==='exit')break;
        if(choice==='1')list({all:true});
        else if(choice==='2'){
          const host=await ask('Hostname: '),ip=await ask('IP address: '),group=await ask('Group [default]: '),comment=await ask('Comment [optional]: ');
          await execute(['add',host,ip,'--group',group||'default','--comment',comment]);
        } else if(choice==='3'){
          list();const key=await ask('Hostname or ID: ');const e=bridge('export').entries.find(e=>e.host===key||e.id===key);if(!e)throw new Error('Entry not found.');
          const host=await ask('Hostname ['+e.host+']: '),ip=await ask('IP ['+e.ip+']: '),group=await ask('Group ['+e.group+']: '),comment=await ask('Comment ['+(e.comment||'none')+'] (enter - to clear): ');
          await execute(['set',key,'--host',host||e.host,'--ip',ip||e.ip,'--group',group||e.group,'--comment',comment==='-'?'':comment||e.comment||'']);
        } else if(choice==='4'){list();await execute(['remove',await ask('Hostname or ID: ')]);}
        else if(choice==='5'){list();const key=await ask('Hostname or ID: '),action=await ask('enable or disable: ');if(!['enable','disable'].includes(action))throw new Error('Choose enable or disable.');await execute([action,key]);}
        else if(choice==='6'){
          await execute(['groups']);const action=await ask('create / rename / enable / disable / clear / delete (Enter to return): ');if(!action)continue;
          if(!['create','rename','enable','disable','clear','delete'].includes(action))throw new Error('Unknown group action.');
          const name=await ask('Group name: ');let args=['group',action,name];
          if(action==='rename')args.push(await ask('New name: '));if(['clear','delete'].includes(action)){if(!await yes('Delete entries in this group?'))continue;args.push('--yes');}await execute(args);
        } else if(choice==='7')await editFile();
        else if(choice==='8')await execute(['export',await ask('Output JSON path (new file): ')]);
        else if(choice==='9'){const file=await ask('Input JSON path: ');if(await yes('Replace all managed entries and DNS config?'))await execute(['import',file,'--yes']);}
        else if(choice==='10'){await execute(['backups']);const id=await ask('Backup ID to restore (Enter to return): ');if(id && await yes('Restore the ENTIRE hosts file and managed config?'))await execute(['restore',id,'--yes']);}
        else if(choice==='11'){
          if(!bridge('export').setupComplete)await dnsSetup(rl);
          console.log('DNS mode puts Hostman before router DNS. Set reachable upstream servers first.');
          const action=await ask('status / enable / disable / start / stop / restart / upstream / blocks (Enter to return): ');if(!action)continue;
          if(!['status','enable','disable','start','stop','restart','upstream','blocks'].includes(action))throw new Error('Unknown DNS action.');
          if(action==='enable'&&!await yes('Enable local DNS priority and change system DNS settings?'))continue;
          await execute(['dns',action,...(action==='upstream'?(await ask('Upstream IPs separated by spaces: ')).split(/\s+/):[])]);
        } else if(choice==='12')await doctor();
        else if(choice==='13'){if(await yes('Download and install the latest GitHub Release ZIP?'))await update({yes:true});}
        else if(choice==='14')await dnsSetup(rl);
        else if(choice==='15'){const action=await ask('status / enable / disable / start / stop / restart / port: ');await execute(['dashboard',action,...(action==='port'?[await ask('Dashboard port: ')]:[])]);}
        else if(choice==='16'){if(await yes('Uninstall Hostman and restore system DNS?')){await uninstall({yes:true});break;}}
        else console.log('Choose a number from the menu.');
      } catch(e){console.log(paint(31,'Error: '+e.message));}
    }
  }finally{rl.close();}
}
try {
  const args=process.argv.slice(2);
  if(!args.length || args[0]==='menu'){if(process.stdin.isTTY)await menu();else console.log(help);}
  else await execute(args);
} catch(e){console.error(paint(31,'Hostman: '+e.message));process.exitCode=1;}
