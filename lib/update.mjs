import { mkdtemp, readFile, rm, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { root, python } from './bridge.mjs';
export const latestURL='https://api.github.com/repos/jan-du-toit/Hostman/releases/latest';
export function selectAsset(release,platform=process.platform){
  if(release.draft||release.prerelease)throw new Error('Only the latest stable GitHub Release is supported.');
  const zips=(release.assets||[]).filter(a=>a.state==='uploaded' && /\.zip$/i.test(a.name) && a.size>0 && a.size<=100*1024*1024);
  const platformNames=platform==='win32'?/(?:windows|win32|win64)/i:/(?:linux|fedora|ubuntu)/i;
  const targeted=zips.filter(a=>platformNames.test(a.name));
  const universal=zips.filter(a=>/^hostman(?:[-_.]v?\d|[-_.](?:source|update|universal))/i.test(a.name)&&!/(?:linux|windows|win32|win64|fedora|ubuntu)/i.test(a.name));
  const selected=targeted.length===1?targeted[0]:universal.length===1?universal[0]:zips.length===1?zips[0]:null;
  if(!selected)throw new Error(zips.length?'Several ZIPs are ambiguous. Upload one Hostman-vX.Y.Z.zip (or a platform ZIP).':'The latest Release has no uploaded Hostman update ZIP. Attach the full project ZIP; GitHub-generated source archives are not used.');
  const url=new URL(selected.browser_download_url);
  if(url.protocol!=='https:'||url.hostname!=='github.com'||!url.pathname.toLowerCase().startsWith('/jan-du-toit/hostman/releases/download/'))throw new Error('Invalid Release asset URL.');
  return selected;
}
export function compareVersions(a,b){
  const aa=a.replace(/^v/,'').split('.').map(Number),bb=b.replace(/^v/,'').split('.').map(Number);
  if(aa.length!==3||bb.length!==3||[...aa,...bb].some(n=>!Number.isInteger(n)||n<0))throw new Error('Version must be x.y.z.');
  for(let i=0;i<3;i++){if(aa[i]!==bb[i])return Math.sign(aa[i]-bb[i]);}return 0;
}
function run(exe,args,options={}){
  const r=spawnSync(exe,args,{encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024,...options});
  if(r.error)throw r.error;if(r.status!==0)throw new Error((r.stderr||r.stdout||'Installer failed').trim());return r.stdout.trim();
}
async function download(url,maxBytes){
  const response=await fetch(url,{signal:AbortSignal.timeout(90000),headers:{'User-Agent':'ByDT-Hostman-Updater','Accept':'application/octet-stream'}});
  if(!response.ok)throw new Error('Release download failed: HTTP '+response.status);
  if(Number(response.headers.get('content-length'))>maxBytes)throw new Error('Release download is too large.');
  let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>maxBytes)throw new Error('Release download exceeds its limit.');chunks.push(chunk);}
  return Buffer.concat(chunks);
}
export async function latestRelease(){
  const r=await fetch(latestURL,{signal:AbortSignal.timeout(20000),headers:{'User-Agent':'ByDT-Hostman-Updater','Accept':'application/vnd.github+json'}});
  if(r.status===404)throw new Error('No published stable GitHub Release exists yet. Publish a Release marked Latest and attach the Hostman ZIP.');
  if(!r.ok)throw new Error('GitHub Release lookup failed: HTTP '+r.status);
  const text=await r.text();if(text.length>1024*1024)throw new Error('Oversized Release metadata.');return JSON.parse(text);
}
export async function update(flags={}){
  if(flags.ref)throw new Error('Updates now use only the latest GitHub Release. --ref is no longer supported.');
  const installed=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
  const source=await realpath(root);
  const installRoot=process.platform==='win32'?join(process.env.ProgramFiles||'C:/Program Files','Hostman'):'/opt/hostman';
  const normalized=s=>s.replaceAll('\\','/').toLowerCase();
  if(!flags.check&&!normalized(source).startsWith(normalized(installRoot)+'/releases/'))throw new Error('Run the platform installer first. Source checkouts are never overwritten.');
  console.log('Checking the latest GitHub Release…');
  const release=await latestRelease(),asset=selectAsset(release);
  console.log(`Installed: ${installed.version}\nLatest Release: ${release.tag_name}\nZIP: ${asset.name}`);
  if(flags.check)return;
  if(/^v?\d+\.\d+\.\d+$/.test(release.tag_name)&&compareVersions(release.tag_name,installed.version)<=0){console.log('Hostman is already up to date.');return;}
  if(!flags.yes){
    if(!process.stdin.isTTY)throw new Error('Use --yes for a noninteractive update.');
    const {createInterface}=await import('node:readline/promises');const rl=createInterface({input:process.stdin,output:process.stdout});
    try{if(!/^y(es)?$/i.test((await rl.question('Install this latest Release? [y/N] ')).trim())){console.log('Update cancelled.');return;}}finally{rl.close();}
  }
  const stage=await mkdtemp(join(tmpdir(),'hostman-release-'));
  try{
    console.log('Downloading '+asset.name+'…');const bytes=await download(asset.browser_download_url,100*1024*1024);
    if(bytes.length!==asset.size)throw new Error('Release size does not match GitHub metadata.');
    const digest=createHash('sha256').update(bytes).digest('hex');
    if(asset.digest){if(!/^sha256:[a-f0-9]{64}$/i.test(asset.digest)||asset.digest.slice(7).toLowerCase()!==digest)throw new Error('Release SHA-256 verification failed.');}
    const archive=join(stage,'release.zip');await writeFile(archive,bytes,{mode:0o600});
    const py=python();const result=JSON.parse(run(py.exe,[...py.args,join(root,'python/release_archive.py'),archive,join(stage,'source')]));
    if(compareVersions(result.version,installed.version)<=0)throw new Error('The uploaded ZIP is not newer than the installed version.');
    if(/^v?\d+\.\d+\.\d+$/.test(release.tag_name)&&compareVersions(result.version,release.tag_name)!==0)throw new Error('Release tag and package.json version do not match.');
    await writeFile(join(result.root,'release.json'),JSON.stringify({id:release.id,tag:release.tag_name,asset:asset.name,sha256:digest})+'\n');
    run(process.execPath,['--check',join(result.root,'bin/hostman.mjs')]);
    if(process.platform==='win32')run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(result.root,'scripts/setup-windows.ps1'),'-Source',result.root,'-Update'],{stdio:'inherit'});
    else if(process.platform==='linux')run('bash',[join(result.root,'scripts/setup-linux.sh'),'--source',result.root,'--update'],{stdio:'inherit'});
    else throw new Error('Supported platforms: Fedora, Ubuntu and Windows.');
    console.log('Hostman updated to '+result.version+'. Previous application release retained.');
  }finally{await rm(stage,{recursive:true,force:true});}
}
