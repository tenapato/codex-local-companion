import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Pairings } from '../src/pairing.js';
import { input } from '../src/validation.js';
import { Jobs } from '../src/jobs.js';
import { runTurn } from '../src/runtime.js';
import { Failure } from '../src/errors.js';

const valid = () => ({instructions:'Draft',messages:[{role:'user' as const,content:'hello'}],model:'m',effort:'low'});
function failure(fn:()=>unknown, code:string) { assert.throws(fn,(e:any)=>e instanceof Failure&&e.code===code); }

test('pairing binds a one-use code and bearer session to origin, expiry and revocation',()=>{
  let now=1000; const p=new Pairings(()=>now); const a='https://example.test', b='https://other.test';
  const issued=p.issue(a,'browser');
  failure(()=>p.redeem(b,issued.code),'invalid_pairing');
  const {token,session}=p.redeem(a,issued.code);
  failure(()=>p.redeem(a,issued.code),'invalid_pairing');
  assert.equal(p.authorize(a,`Bearer ${token}`).id,session.id);
  failure(()=>p.authorize(b,`Bearer ${token}`),'unauthorized');
  assert.equal(p.revoke(session.id),true);
  failure(()=>p.authorize(a,`Bearer ${token}`),'unauthorized');
  const expired=p.issue(a,'short'); now+=120001;
  assert.equal(p.known(a),false); failure(()=>p.redeem(a,expired.code),'invalid_pairing');
  const ttl=p.issue(a,'ttl'), long=p.redeem(a,ttl.code).token;
  now+=8*60*60*1000+1; failure(()=>p.authorize(a,`Bearer ${long}`),'unauthorized');
});

test('pairings enforce origin and capacity rules',()=>{
  const p=new Pairings();
  for(const origin of ['file:///tmp/x','http://example.test','https://example.test/path','https://u:p@example.test']) failure(()=>p.issue(origin,'x'),'invalid_origin');
  failure(()=>p.issue('https://example.test',' '),'invalid_name');
  for(let i=0;i<16;i++) p.issue(`https://${i}.example.test`,'x');
  failure(()=>p.issue('https://overflow.test','x'),'pairing_capacity');
  const rate=new Pairings(); const issued=rate.issue('https://rate.test','x');
  for(let i=0;i<30;i++) failure(()=>rate.redeem('https://rate.test','wrong'),'invalid_pairing');
  failure(()=>rate.redeem('https://rate.test',issued.code),'pairing_rate_limited');
});

test('input rejects unknown fields, oversized content and unsafe schemas',()=>{
  assert.deepEqual(input(valid()),valid());
  failure(()=>input({...valid(),extra:true}),'invalid_input');
  failure(()=>input({...valid(),messages:[{role:'system',content:'x'}]}),'invalid_input');
  failure(()=>input({...valid(),outputSchema:{$ref:'#/x'}}),'invalid_output_schema');
  failure(()=>input({...valid(),outputSchema:{type:'object',patternProperties:{x:{type:'string'}}}}),'invalid_output_schema');
  failure(()=>input({...valid(),outputSchema:{type:'not-a-json-schema-type'}}),'invalid_output_schema');
  failure(()=>input({...valid(),messages:Array.from({length:5},()=>({role:'user',content:'x'.repeat(16000)}))}),'input_too_large');
});

class MockRpc extends EventEmitter {
  requests:{method:string;params:any}[]=[];
  response:Promise<any> = Promise.resolve({turn:{id:'t1'}});
  request(method:string,params:any={}) { this.requests.push({method,params}); return this.response; }
  async close(){}
}
const tick=()=>new Promise(r=>setImmediate(r));
async function successful(rpc:MockRpc, status='completed', text='answer') {
  const p=runTurn(rpc as any,'thread',valid(),new AbortController().signal,1000);
  await tick();
  rpc.emit('notification',{method:'item/completed',params:{threadId:'thread',item:{type:'agentMessage',phase:'final_answer',text}}});
  rpc.emit('notification',{method:'turn/completed',params:{threadId:'thread',turn:{id:'t1',status}}});
  return p;
}
test('runTurn returns output only following a matching completed turn',async()=>{
  assert.deepEqual(await successful(new MockRpc()),{text:'answer'});
  await assert.rejects(successful(new MockRpc(),'failed'),(e:any)=>e.code==='protocol_error');
  await assert.rejects(successful(new MockRpc(),'interrupted'),(e:any)=>e.code==='cancelled');
  await assert.rejects(successful(new MockRpc(),'inProgress'),(e:any)=>e.code==='incomplete_response');
  await assert.rejects(successful(new MockRpc(),'completed','  '),(e:any)=>e.code==='incomplete_response');
});

test('runTurn validates structured output and withholds final text until completion',async()=>{
  const rpc=new MockRpc(), value={...valid(),outputSchema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false}};
  const p=runTurn(rpc as any,'thread',value,new AbortController().signal,1000);
  await tick();
  rpc.emit('notification',{method:'item/completed',params:{threadId:'thread',item:{type:'agentMessage',phase:'final_answer',text:'{"ok":true}'}}});
  let settled=false; void p.finally(()=>{settled=true;}); await tick(); assert.equal(settled,false);
  rpc.emit('notification',{method:'turn/completed',params:{threadId:'thread',turn:{id:'t1',status:'completed'}}});
  assert.deepEqual(await p,{text:'{"ok":true}',data:{ok:true}});
  for(const text of ['not json','{"ok":"wrong"}']) {
    const bad=new MockRpc(), pending=runTurn(bad as any,'thread',value,new AbortController().signal,1000); await tick();
    bad.emit('notification',{method:'item/completed',params:{threadId:'thread',item:{type:'agentMessage',phase:'final_answer',text}}});
    bad.emit('notification',{method:'turn/completed',params:{threadId:'thread',turn:{id:'t1',status:'completed'}}});
    await assert.rejects(pending,(e:any)=>e.code==='invalid_structured_response');
  }
});

test('runTurn handles protocol errors, denied tools and cancellation around turn start',async()=>{
  const rpc=new MockRpc(); rpc.response=Promise.reject(new Failure('protocol_error',502));
  await assert.rejects(runTurn(rpc as any,'thread',valid(),new AbortController().signal,1000),(e:any)=>e.code==='protocol_error');
  const denied=new MockRpc(); const p=runTurn(denied as any,'thread',valid(),new AbortController().signal,1000);
  denied.emit('notification',{method:'companion/toolDenied'});
  await assert.rejects(p,(e:any)=>e.code==='tool_denied');
  const pre=new MockRpc(); const ac=new AbortController(); ac.abort();
  await assert.rejects(runTurn(pre as any,'thread',valid(),ac.signal),(e:any)=>e.code==='cancelled');
  assert.equal(pre.requests.length,0);
  const pending=new MockRpc(); let release!:(v:any)=>void; pending.response=new Promise(r=>release=r);
  const ac2=new AbortController(); const pendingTurn=runTurn(pending as any,'thread',valid(),ac2.signal,1000); ac2.abort();
  await assert.rejects(pendingTurn,(e:any)=>e.code==='cancelled'); release({turn:{id:'late'}}); await tick();
  const timeout=new MockRpc(); timeout.response=new Promise(()=>{});
  await assert.rejects(runTurn(timeout as any,'thread',valid(),new AbortController().signal,10),(e:any)=>e.code==='timeout');
});

test('runTurn fails closed when an unexpected tool item starts',async()=>{
  const rpc=new MockRpc(); const p=runTurn(rpc as any,'thread',valid(),new AbortController().signal,1000); await tick();
  rpc.emit('notification',{method:'item/started',params:{threadId:'thread',item:{type:'commandExecution'}}});
  await assert.rejects(p,(e:any)=>e.code==='unexpected_tool');
  assert.equal(rpc.requests.some(x=>x.method==='turn/interrupt'),true);
});

test('jobs isolate owners, cancel queued/running work and enforce per-owner capacity',async()=>{
  let release!:()=>void; let started=0; const gate=new Promise<void>(r=>release=r);
  const jobs=new Jobs(async(_v,signal)=>{started++; await gate; if(signal.aborted)throw new Failure('cancelled'); return {text:'done'};},1);
  const first=jobs.submit('owner-1',valid()),second=jobs.submit('owner-1',valid());
  assert.equal(first.state,'running'); assert.equal(second.state,'queued');
  failure(()=>jobs.submit('owner-1',valid()),'busy');
  failure(()=>jobs.get('owner-2',first.id),'job_not_found');
  const cancelled=jobs.cancel('owner-1',first.id); assert.equal(cancelled.state,'cancelled');
  release(); await new Promise(r=>setTimeout(r,80));
  assert.equal(jobs.get('owner-1',second.id).state,'completed'); assert.equal(started,2);
  const bounded=new Jobs(async()=>({text:'x'}),1);
  for(let i=0;i<8;i++) bounded.submit(`o${i}`,valid());
  failure(()=>bounded.submit('overflow',valid()),'busy');
});
