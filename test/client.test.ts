import test from 'node:test';
import assert from 'node:assert/strict';
import { CompanionClient } from '../client/index.js';
test('browser client restricts endpoints, sends authenticated POST reads and revokes on disconnect',async()=>{
  for(const url of ['https://localhost:43127','http://example.com','http://user@localhost','http://127.0.0.1/path'])assert.throws(()=>new CompanionClient(url));
  const original=globalThis.fetch;const calls:{url:string,init:RequestInit}[]=[];
  globalThis.fetch=(async(url,init)=>{
    calls.push({url:String(url),init:init!});
    if(String(url).endsWith('/pair'))return Response.json({token:'test-token',session:{id:'s',origin:'http://127.0.0.1:43127'}});
    return Response.json({authenticated:false});
  }) as typeof fetch;
  try{
    const c=new CompanionClient();await c.pair('synthetic-code');await c.status();await c.disconnect();
    assert.equal(calls[0].init.credentials,'omit');assert.equal(calls[0].init.cache,'no-store');assert.equal(calls[0].init.redirect,'error');
    assert.equal(calls[1].init.method,'POST');assert.equal((calls[1].init.headers as any).Authorization,'Bearer test-token');
    assert.equal(calls[2].init.method,'DELETE');
    await c.status();assert.equal((calls[3].init.headers as any).Authorization,undefined);
  }finally{globalThis.fetch=original;}
});
test('browser cancellation requests DELETE and pre-aborted generation submits nothing',async()=>{
  const original=globalThis.fetch;const calls:string[]=[];const controller=new AbortController();
  globalThis.fetch=(async(url,init)=>{
    calls.push(`${init?.method} ${new URL(String(url)).pathname}`);
    if(String(url).endsWith('/pair'))return Response.json({token:'test-token',session:{id:'s'}});
    if(String(url).endsWith('/jobs'))return Response.json({id:'job',state:'running'});
    if(init?.method==='POST'){setImmediate(()=>controller.abort());return Response.json({id:'job',state:'running'});}
    return Response.json({id:'job',state:'cancelled'});
  }) as typeof fetch;
  try{
    const c=new CompanionClient();await c.pair('synthetic');
    const options={instructions:'synthetic',messages:[{role:'user' as const,content:'synthetic'}],model:'m',effort:'low',signal:controller.signal};
    await assert.rejects(c.generate(options),(e:any)=>e.name==='AbortError');
    assert.ok(calls.includes('DELETE /v1/jobs/job'));
    const count=calls.length;await assert.rejects(c.generate(options),(e:any)=>e.name==='AbortError');assert.equal(calls.length,count);
  }finally{globalThis.fetch=original;}
});
