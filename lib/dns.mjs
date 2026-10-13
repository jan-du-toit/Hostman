import dgram from 'node:dgram';
import net from 'node:net';
import { randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { domainToASCII } from 'node:url';

export function question(packet) {
  if (packet.length < 12 || packet.readUInt16BE(4) !== 1 || (packet[2] & 0xf8)) throw new Error('Invalid standard query');
  let offset = 12;
  const labels = [];
  // Compression in the first/only question is deliberately rejected.
  while (true) {
    if (offset >= packet.length) throw new Error('Truncated query');
    const size = packet[offset++];
    if (!size) break;
    if (size > 63 || offset + size > packet.length) throw new Error('Invalid label');
    labels.push(packet.subarray(offset, offset + size).toString('ascii').toLowerCase());
    offset += size;
  }
  if (!labels.length || labels.join('.').length > 253 || offset + 4 > packet.length) throw new Error('Invalid question');
  const q = { name: labels.join('.'), type: packet.readUInt16BE(offset), cls: packet.readUInt16BE(offset + 2), end: offset + 4 };
  // Only a single, root-named EDNS OPT record is accepted; no arbitrary additional records.
  if (packet.readUInt16BE(6) || packet.readUInt16BE(8)) throw new Error('Unexpected query answers');
  const ar = packet.readUInt16BE(10);
  q.udpSize = 512;
  if (ar) {
    const p = q.end;
    if (ar !== 1 || p + 11 > packet.length || packet[p] !== 0 || packet.readUInt16BE(p+1) !== 41 || p+11+packet.readUInt16BE(p+9) !== packet.length) throw new Error('Invalid EDNS');
    q.udpSize = Math.max(512, Math.min(4096, packet.readUInt16BE(p+3)));
  } else if (q.end !== packet.length) throw new Error('Trailing query bytes');
  return q;
}

function response(packet, q, code = 0, answers = [], authoritative = false) {
  const header = Buffer.alloc(12);
  packet.copy(header, 0, 0, 2);
  header.writeUInt16BE(0x8080 | (packet.readUInt16BE(2) & 0x0110) | (authoritative ? 0x0400 : 0) | code, 2);
  header.writeUInt16BE(1, 4); header.writeUInt16BE(answers.length, 6);
  return Buffer.concat([header, packet.subarray(12, q.end), ...answers]);
}

export function ipBytes(ip) {
  if (net.isIP(ip) === 4) return Buffer.from(ip.split('.').map(Number));
  if (net.isIP(ip) !== 6) throw new Error('Invalid IP');
  if (ip.includes('.')) {
    const pos = ip.lastIndexOf(':');
    const bytes = ipBytes(ip.slice(pos+1));
    ip = ip.slice(0, pos+1) + bytes.readUInt16BE(0).toString(16) + ':' + bytes.readUInt16BE(2).toString(16);
  }
  const halves = ip.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const all = halves.length === 2 ? [...left, ...Array(8-left.length-right.length).fill('0'), ...right] : left;
  const out = Buffer.alloc(16); all.forEach((part, i) => out.writeUInt16BE(parseInt(part,16),i*2)); return out;
}

function record(ip, ttl) {
  const data = ipBytes(ip), head = Buffer.alloc(12);
  head.writeUInt16BE(0xc00c,0); head.writeUInt16BE(data.length === 4 ? 1 : 28,2);
  head.writeUInt16BE(1,4); head.writeUInt32BE(ttl,6); head.writeUInt16BE(data.length,10);
  return Buffer.concat([head,data]);
}

export function makeQuery(name, type = 1) {
  name=domainToASCII(name.replace(/\.$/,''));
  if(!name || name.length>253 || name.split('.').some(s=>!s.length || s.length>63 || !/^[a-z0-9_-]+$/i.test(s))) throw new Error('Invalid DNS hostname');
  const header = Buffer.alloc(12); header.writeUInt16BE(randomInt(65536),0); header.writeUInt16BE(0x0100,2); header.writeUInt16BE(1,4);
  const labels = name.replace(/\.$/,'').split('.').map(s => Buffer.concat([Buffer.from([Buffer.byteLength(s)]),Buffer.from(s)]));
  const tail = Buffer.alloc(5); tail.writeUInt16BE(type,1); tail.writeUInt16BE(1,3);
  return Buffer.concat([header,...labels,tail]);
}

function validReply(reply, sent) {
  if (reply.length < 12 || !(reply[2] & 0x80) || reply.readUInt16BE(0) !== sent.readUInt16BE(0) || reply.readUInt16BE(4) !== 1) throw new Error('Invalid upstream response');
  // DNS response questions are normally uncompressed; verify them independently of section counts.
  const head = Buffer.from(reply); head[2] &= 0x07; head.writeUInt16BE(0,6); head.writeUInt16BE(0,8); head.writeUInt16BE(0,10);
  const qSent = question(sent); const truncatedQuestion = head.subarray(0,qSent.end);
  const qReply = question(truncatedQuestion);
  if (qReply.name !== qSent.name || qReply.type !== qSent.type || qReply.cls !== qSent.cls) throw new Error('Upstream question mismatch');
  return reply;
}

export async function exchange(packet, server, timeoutMs = 1500, tcp = false) {
  const endpoint = typeof server === 'string' ? {address:server,port:53} : server;
  if (!tcp) return new Promise((resolve,reject) => {
    const socket = dgram.createSocket(net.isIP(endpoint.address) === 6 ? 'udp6' : 'udp4');
    const timer = setTimeout(() => done(new Error('DNS timeout')),timeoutMs);
    let finished = false;
    function done(error, result) { if (finished) return; finished=true; clearTimeout(timer); socket.close(); error ? reject(error) : resolve(result); }
    socket.on('error',done);
    socket.on('message', reply => { try { done(null,validReply(reply,packet)); } catch {} });
    socket.connect(endpoint.port,endpoint.address,() => socket.send(packet,error => { if(error) done(error); }));
  });
  return new Promise((resolve,reject) => {
    const socket = net.createConnection({host:endpoint.address,port:endpoint.port});
    let buffer = Buffer.alloc(0), finished = false;
    const timer = setTimeout(() => done(new Error('DNS TCP timeout')),timeoutMs);
    function done(error,result) { if(finished)return; finished=true; clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(result); }
    socket.on('error',done); socket.on('end',() => done(new Error('Incomplete DNS TCP response')));
    socket.on('connect',() => { const h=Buffer.alloc(2); h.writeUInt16BE(packet.length); socket.write(Buffer.concat([h,packet])); });
    socket.on('data',chunk => { buffer=Buffer.concat([buffer,chunk]); if(buffer.length>=2 && buffer.length>=buffer.readUInt16BE(0)+2) { try {done(null,validReply(buffer.subarray(2,buffer.readUInt16BE(0)+2),packet));}catch(e){done(e);} } });
  });
}

export async function readTable(dataDir, hostsFile) {
  const data = JSON.parse(await readFile(join(dataDir,'state.json'),'utf8'));
  const text = await readFile(hostsFile,'utf8');
  const table = new Map();
  for (const line of text.split(/\r?\n/)) {
    const bits = line.split('#')[0].trim().split(/\s+/);
    if (!net.isIP(bits[0])) continue;
    for (const name of bits.slice(1)) {
      const key=name.toLowerCase().replace(/\.$/,'');
      if(!table.has(key))table.set(key,[]);
      table.get(key).push(bits[0]);
    }
  }
  if (!data.dns || !Array.isArray(data.dns.upstreams) || !data.dns.upstreams.length ||
      data.dns.upstreams.some(ip => !net.isIP(ip) || /^127\./.test(ip) || ip==='::1' || ip==='0.0.0.0' || ip==='::') ||
      !Number.isInteger(data.dns.ttl) || data.dns.ttl<0 || data.dns.ttl>86400 ||
      !Number.isInteger(data.dns.timeoutMs) || data.dns.timeoutMs<100 || data.dns.timeoutMs>10000) throw new Error('Invalid DNS configuration');
  return {table, config:data.dns};
}

export async function createDnsServer({ table = new Map(), config, port = 53, addresses = ['127.0.0.1','::1'], logger = console.log }) {
  let pending=0, connections=0;
  const sockets=[], clients=new Set();
  const state={table,config};
  async function handle(packet,tcp) {
    let q; try { q=question(packet); } catch { return null; }
    if (pending>=128) return response(packet,q,2);
    pending++;
    try {
      if(q.cls !== 1) return response(packet,q,4);
      const ips=state.table.get(q.name);
      if(ips) {
        const selected = ips.filter(ip => q.type === 255 || net.isIP(ip) === (q.type===1 ? 4 : q.type===28 ? 6 : 0));
        return response(packet,q,0,selected.map(ip=>record(ip,state.config.ttl)),true);
      }
      const sent=Buffer.from(packet); sent.writeUInt16BE(randomInt(65536),0);
      for(const upstream of state.config.upstreams) {
        try {
          let reply=await exchange(sent,upstream,state.config.timeoutMs,tcp);
          if(!tcp && reply[2]&2) reply=await exchange(sent,upstream,state.config.timeoutMs,true);
          const code=reply[3]&15;
          if(code===2 || code===5) continue;
          reply=Buffer.from(reply); packet.copy(reply,0,0,2); return reply;
        } catch {}
      }
      return response(packet,q,2);
    } finally {pending--;}
  }
  try {
    for(const address of addresses) {
      const udp=dgram.createSocket(net.isIP(address)===6 ? 'udp6':'udp4'); sockets.push(udp);
      udp.on('message',async(packet,rinfo)=>{
        try {
          let reply=await handle(packet,false); if(!reply)return;
          const q=question(packet);
          if(reply.length>q.udpSize) {reply=response(packet,q);reply[2]|=2;}
          udp.send(reply,rinfo.port,rinfo.address,()=>{});
        }catch(e){logger('DNS request error: '+e.message);}
      });
      await new Promise((resolve,reject)=>{udp.once('error',reject);udp.bind(port,address,()=>{udp.removeListener('error',reject);udp.on('error',e=>logger('DNS socket error: '+e.message));resolve();});});
      const tcp=net.createServer(client=>{
        if(connections>=128){client.destroy();return;} connections++; clients.add(client);
        client.on('close',()=>{connections--;clients.delete(client);}); client.on('error',()=>{}); client.setTimeout(10000,()=>client.destroy());
        let buffer=Buffer.alloc(0), chain=Promise.resolve(), queued=0;
        client.on('data',chunk=>{
          buffer=Buffer.concat([buffer,chunk]); if(buffer.length>131074){client.destroy();return;}
          while(buffer.length>=2 && buffer.length>=buffer.readUInt16BE(0)+2) {
            const length=buffer.readUInt16BE(0); if(length<12 || ++queued>16){client.destroy();return;}
            const packet=Buffer.from(buffer.subarray(2,length+2));buffer=buffer.subarray(length+2);
            chain=chain.then(async()=>{try {const reply=await handle(packet,true);if(reply&&!client.destroyed){const h=Buffer.alloc(2);h.writeUInt16BE(reply.length);client.write(Buffer.concat([h,reply]));}} finally {queued--;}}).catch(()=>client.destroy());
          }
        });
      }); sockets.push(tcp);
      await new Promise((resolve,reject)=>{tcp.once('error',reject);tcp.listen(port,address,()=>{tcp.removeListener('error',reject);tcp.on('error',e=>logger('DNS TCP error: '+e.message));resolve();});});
    }
  } catch(e) { for(const s of sockets)try{s.close();}catch{} throw e; }
  return { update(table,config){state.table=table;state.config=config;}, async close(){for(const c of clients)c.destroy();await Promise.all(sockets.map(s=>new Promise(resolve=>{try{s.close(resolve);}catch{resolve();}})));} };
}

export function answerAddresses(packet) {
  let offset=12; const output=[];
  function skipName() {
    let total=0;
    while(offset<packet.length) {
      const size=packet[offset++];
      if(!size)return;
      if((size&0xc0)===0xc0){if(offset>=packet.length)throw new Error('Truncated DNS name');offset++;return;}
      if(size>63 || offset+size>packet.length || ++total>127)throw new Error('Invalid DNS name');offset+=size;
    }throw new Error('Truncated DNS name');
  }
  for(let i=0;i<packet.readUInt16BE(4);i++){skipName();offset+=4;if(offset>packet.length)throw new Error('Truncated DNS question');}
  for(let i=0;i<packet.readUInt16BE(6);i++) {
    skipName();if(offset+10>packet.length)throw new Error('Truncated DNS record');
    const type=packet.readUInt16BE(offset),ttl=packet.readUInt32BE(offset+4),length=packet.readUInt16BE(offset+8);offset+=10;
    if(offset+length>packet.length)throw new Error('Truncated DNS data');
    const bytes=packet.subarray(offset,offset+length);
    if(type===1 && length===4)output.push({type:'A',address:[...bytes].join('.'),ttl});
    if(type===28 && length===16)output.push({type:'AAAA',address:Array.from({length:8},(_,i)=>bytes.readUInt16BE(i*2).toString(16)).join(':'),ttl});
    offset+=length;
  }return output;
}
