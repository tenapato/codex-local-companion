import test from 'node:test';
import assert from 'node:assert/strict';
import { Rpc } from '../src/rpc.js';
import { Runtime } from '../src/runtime.js';
import { threadParams, policy } from '../src/policy.js';
import { failureCode } from '../src/errors.js';

test('all server requests are rejected without running a tool or echoing input',()=>{
  const rpc=new Rpc('/unused','/unused');const sent:any[]=[];const notices:any[]=[];
  (rpc as any).send=(v:any)=>sent.push(v);rpc.on('notification',v=>notices.push(v));
  for(const method of ['item/commandExecution/requestApproval','item/permissions/requestApproval','item/tool/call','account/chatgptAuthTokens/refresh','mcpServer/elicitation/request'])rpc.receive({id:sent.length,method,params:{secret:'sensitive'}});
  assert.equal(sent.length,5);assert.ok(sent.every(x=>x.error?.code===-32601));
  assert.equal(JSON.stringify(sent).includes('sensitive'),false);
  assert.equal(notices.length,5);
});
test('thread policy excludes environment and dynamic tools and forbids paid fallback',()=>{
  const p=threadParams('/empty','selected','Draft only');
  assert.deepEqual(p.environments,[]);assert.deepEqual(p.dynamicTools,[]);
  assert.equal(p.allowProviderModelFallback,false);assert.equal(p.modelProvider,'openai');
  assert.equal(p.ephemeral,true);assert.equal(p.sandbox,'read-only');
  assert.equal(policy['features.shell_tool'],false);assert.equal(policy.web_search,'disabled');
});
test('unsupported runtime, unauthenticated account and model/effort reject before inference',async()=>{
  const r=new Runtime('/unused');const value={instructions:'x',messages:[{role:'user' as const,content:'x'}],model:'known',effort:'unsupported'};
  await assert.rejects(r.generate(value,new AbortController().signal),(e:any)=>e.code==='runtime_not_verified');
  r.inferenceEnabled=true;
  r.control={request:async()=>({account:null})} as any;
  await assert.rejects(r.generate(value,new AbortController().signal),(e:any)=>e.code==='login_required');
  r.control={request:async(method:string)=>method==='account/read'?{account:{type:'chatgpt'}}:{data:[{model:'known',supportedReasoningEfforts:[{reasoningEffort:'low'}]}],nextCursor:null}} as any;
  await assert.rejects(r.generate(value,new AbortController().signal),(e:any)=>e.code==='unsupported_settings');
});
test('failure classification exposes only categories rather than provider messages',()=>{
  assert.equal(failureCode({message:'business records',codexErrorInfo:'usageLimitExceeded'}),'usage_limited');
  assert.equal(failureCode({message:'secret',codexErrorInfo:'unauthorized'}),'login_required');
  assert.equal(failureCode({message:'private record'}),'protocol_error');
});
