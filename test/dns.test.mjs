import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import net from 'node:net';
import { createDnsServer, exchange, makeQuery, ipBytes, question, answerAddresses } from '../lib/dns.mjs';
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port;}
const config={upstreams:[],ttl:60,timeoutMs:100};
test('local A/AAAA, NODATA, TCP, case-insensitive questions and hot reload',async()=>{
  const port=await freePort();const table=new Map([['app.test',['127.0.0.8','2001:db8::42']]]);
  const server=await createDnsServer({table,config,port,addresses:['127.0.0.1'],logger:()=>{}});
  try{
    for(const tcp of [false,true]){
      const a=await exchange(makeQuery('APP.test'),{address:'127.0.0.1',port},1000,tcp);
      assert.equal(a.readUInt16BE(6),1);assert.deepEqual(a.subarray(-4),Buffer.from([127,0,0,8]));assert.equal(a[2]&4,4);
      assert.deepEqual(answerAddresses(a),[{type:'A',address:'127.0.0.8',ttl:60}]);
      const aaaa=await exchange(makeQuery('app.test',28),{address:'127.0.0.1',port},1000,tcp);
      assert.deepEqual(aaaa.subarray(-16),ipBytes('2001:db8::42'));
      const txt=await exchange(makeQuery('app.test',16),{address:'127.0.0.1',port},1000,tcp);
      assert.equal(txt[3]&15,0);assert.equal(txt.readUInt16BE(6),0);
    }
    server.update(new Map([['app.test',['10.0.0.9']]]),config);
    const a=await exchange(makeQuery('app.test'),{address:'127.0.0.1',port});assert.deepEqual(a.subarray(-4),Buffer.from([10,0,0,9]));
    const missing=await exchange(makeQuery('missing.test'),{address:'127.0.0.1',port});assert.equal(missing[3]&15,2);
  }finally{await server.close();}
});
test('upstream forwarding, spoofed IDs ignored, timeout failover and client ID preserved',async()=>{
  const upstream=dgram.createSocket('udp4');await new Promise(r=>upstream.bind(0,'127.0.0.1',r));
  upstream.on('message',(query,rinfo)=>{
    const bogus=Buffer.from(query);bogus[2]|=0x80;bogus.writeUInt16BE((query.readUInt16BE(0)+1)%65536,0);upstream.send(bogus,rinfo.port,rinfo.address);
    const good=Buffer.from(query);good[2]|=0x80;good[3]|=0x80;upstream.send(good,rinfo.port,rinfo.address);
  });
  const port=await freePort();
  const server=await createDnsServer({port,addresses:['127.0.0.1'],config:{...config,upstreams:[{address:'127.0.0.1',port:await freePort()},{address:'127.0.0.1',port:upstream.address().port}]},logger:()=>{}});
  try{const query=makeQuery('public.test');const answer=await exchange(query,{address:'127.0.0.1',port},2000);assert.equal(answer.readUInt16BE(0),query.readUInt16BE(0));assert.equal(answer[3]&15,0);}
  finally{await server.close();await new Promise(r=>upstream.close(r));}
});
test('malformed packets and IPv6 conversion',()=>{
  for(const query of [Buffer.alloc(0),Buffer.alloc(12),Buffer.concat([makeQuery('app.test'),Buffer.from([1])])])assert.throws(()=>question(query));
  const pointer=makeQuery('app.test');pointer[12]=0xc0;assert.throws(()=>question(pointer));
  assert.equal(ipBytes('::1').toString('hex'),'00000000000000000000000000000001');
  assert.equal(ipBytes('::ffff:192.0.2.1').toString('hex'),'00000000000000000000ffffc0000201');
});
test('large UDP answers truncate, TCP returns complete records',async()=>{
  const port=await freePort();const table=new Map([['large.test',Array(50).fill('127.0.0.1')]]);
  const server=await createDnsServer({table,config,port,addresses:['127.0.0.1'],logger:()=>{}});
  try{
    const udp=await exchange(makeQuery('large.test'),{address:'127.0.0.1',port});assert.equal(udp[2]&2,2);assert.ok(udp.length<=512);
    const tcp=await exchange(makeQuery('large.test'),{address:'127.0.0.1',port},1000,true);assert.equal(tcp.readUInt16BE(6),50);
  }finally{await server.close();}
});

test('truncated upstream UDP is retried over TCP and full response returned to TCP clients',async()=>{
  const upPort=await freePort();
  const udp=dgram.createSocket('udp4');await new Promise(r=>udp.bind(upPort,'127.0.0.1',r));
  udp.on('message',(query,rinfo)=>{const reply=Buffer.from(query);reply[2]|=0x82;reply[3]|=0x80;udp.send(reply,rinfo.port,rinfo.address);});
  let tcpRequests=0;
  const tcp=net.createServer(client=>{
    let buffer=Buffer.alloc(0);
    client.on('data',chunk=>{
      buffer=Buffer.concat([buffer,chunk]);if(buffer.length<2||buffer.length<buffer.readUInt16BE(0)+2)return;
      tcpRequests++;const query=buffer.subarray(2);const reply=Buffer.from(query);reply[2]|=0x80;reply[3]|=0x80;
      const length=Buffer.alloc(2);length.writeUInt16BE(reply.length);client.end(Buffer.concat([length,reply]));
    });
  });await new Promise(r=>tcp.listen(upPort,'127.0.0.1',r));
  const port=await freePort();const server=await createDnsServer({port,addresses:['127.0.0.1'],config:{...config,upstreams:[{address:'127.0.0.1',port:upPort}]},logger:()=>{}});
  try{const reply=await exchange(makeQuery('public.test'),{address:'127.0.0.1',port},1000);assert.equal(reply[2]&2,0);assert.equal(tcpRequests,1);}
  finally{await server.close();await new Promise(r=>udp.close(r));await new Promise(r=>tcp.close(r));}
});

test('a silent upstream times out and falls back to the next server',async()=>{
  const silent=dgram.createSocket('udp4'),responsive=dgram.createSocket('udp4');
  await new Promise(r=>silent.bind(0,'127.0.0.1',r));await new Promise(r=>responsive.bind(0,'127.0.0.1',r));
  let silentRequests=0;silent.on('message',()=>silentRequests++);
  responsive.on('message',(query,peer)=>{const reply=Buffer.from(query);reply[2]|=0x80;reply[3]|=0x80;responsive.send(reply,peer.port,peer.address);});
  const port=await freePort();const server=await createDnsServer({port,addresses:['127.0.0.1'],config:{...config,upstreams:[{address:'127.0.0.1',port:silent.address().port},{address:'127.0.0.1',port:responsive.address().port}]},logger:()=>{}});
  try{const reply=await exchange(makeQuery('public.test'),{address:'127.0.0.1',port},1000);assert.equal(reply[3]&15,0);assert.equal(silentRequests,1);}
  finally{await server.close();await new Promise(r=>silent.close(r));await new Promise(r=>responsive.close(r));}
});

test('IPv6 loopback serves UDP and TCP AAAA queries',async()=>{
  const port=await freePort();const server=await createDnsServer({port,addresses:['::1'],table:new Map([['v6.test',['::1']]]),config,logger:()=>{}});
  try{for(const tcp of [false,true]){const reply=await exchange(makeQuery('v6.test',28),{address:'::1',port},1000,tcp);assert.equal(reply.readUInt16BE(6),1);assert.deepEqual(reply.subarray(-16),ipBytes('::1'));}}
  finally{await server.close();}
});
