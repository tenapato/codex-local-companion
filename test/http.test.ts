import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createHttp } from '../src/http.js';
import { Pairings } from '../src/pairing.js';
import { Jobs } from '../src/jobs.js';
import { input } from '../src/validation.js';

const port=43127, host=`127.0.0.1:${port}`, origin='https://client.example';
async function setup() {
  const pairings=new Pairings(); const code=pairings.issue(origin,'client'); const {token}=pairings.redeem(origin,code.code);
  const runtime:any={control:{request:async()=>({})},status:async()=>({ok:true})};
  const jobs=new Jobs(async(v)=>({text:v.messages[0].content}));
  const server=createHttp(runtime,pairings,jobs,port,process.cwd());
  try { await new Promise<void>((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);}); }
  catch(e) { server.close(); throw e; }
  const address=server.address() as any; const base=`http://127.0.0.1:${address.port}`;
  const req=(path:string,init:{method?:string;headers?:Record<string,string>;body?:string}={})=>new Promise<any>((resolve,reject)=>{
    const req=httpRequest(base+path,{method:init.method??'GET',headers:{host,...init.headers}},res=>{
      const chunks:Buffer[]=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:{get:(name:string)=>res.headers[name.toLowerCase()]??null},json:async()=>JSON.parse(Buffer.concat(chunks).toString())}));
    }); req.on('error',reject); if(init.body)req.write(init.body); req.end();
  });
  return {server,req,token,jobs,pairings};
}
test('HTTP rejects untrusted Host, origin, CORS and preflight methods',async(t)=>{
  let ctx; try { ctx=await setup(); } catch(e:any) { if(e.code==='EPERM'){t.skip('sandbox does not permit loopback listeners');return;} throw e; }
  const {server,req}=ctx;
  try {
    for(const asset of ['/demo','/demo/demo.js','/demo/style.css','/client/index.js'])assert.equal((await req(asset)).status,200);
    assert.equal((await req('/demo',{headers:{'sec-fetch-site':'cross-site'}})).status,403);
    const badHost=await req('/v1/status',{headers:{host:'evil.example:43127',origin}});
    assert.equal(badHost.status,403);
    assert.equal((await req('/v1/status',{headers:{origin:'https://unpaired.example'}})).status,403);
    assert.equal((await req('/v1/status',{headers:{origin,authorization:'Bearer bogus'}})).status,401);
    const pre=await req('/v1/status',{method:'OPTIONS',headers:{origin,'access-control-request-method':'PUT'}});
    assert.equal(pre.status,403);
    const cors=await req('/v1/status',{method:'OPTIONS',headers:{origin,'access-control-request-method':'GET'}});
    assert.equal(cors.status,204); assert.equal(cors.headers.get('access-control-allow-origin'),origin);
    const proxy=await req('/v1/status',{headers:{origin,'x-forwarded-host':'127.0.0.1'}}); assert.equal(proxy.status,403);
  } finally {server.closeAllConnections(); server.close(); await once(server,'close');}
});
test('HTTP authorizes exact endpoints and keeps job access session-scoped',async(t)=>{
  let ctx; try { ctx=await setup(); } catch(e:any) { if(e.code==='EPERM'){t.skip('sandbox does not permit loopback listeners');return;} throw e; }
  const {server,req,token,pairings}=ctx;
  try {
    const auth={origin,authorization:`Bearer ${token}`};
    assert.equal((await req('/v1/status',{method:'POST',headers:{...auth,'content-type':'application/json'},body:'{}'})).status,200);
    assert.equal((await req('/v1/login',{method:'POST',headers:{...auth,'content-type':'application/json'},body:'{}'})).status,403);
    assert.equal((await req('/v1/nope',{headers:auth})).status,404);
    assert.equal((await req('/v1/status',{method:'DELETE',headers:auth})).status,404);
    const created=await req('/v1/jobs',{method:'POST',headers:{...auth,'content-type':'application/json'},body:JSON.stringify(input({instructions:'x',messages:[{role:'user',content:'private'}],model:'m',effort:'low'}))});
    assert.equal(created.status,202); const job=await created.json() as any;
    const own=await req(`/v1/jobs/${job.id}`,{headers:auth}); assert.equal(own.status,200);
    const other=await req(`/v1/jobs/${job.id}`,{headers:{origin,authorization:'Bearer other'}}); assert.equal(other.status,401);
    const second=pairings.redeem(origin,pairings.issue(origin,'another app session').code);
    assert.equal((await req(`/v1/jobs/${job.id}`,{headers:{origin,authorization:`Bearer ${second.token}`}})).status,404);
    assert.equal((await req('/v1/jobs',{method:'POST',headers:{...auth,'content-type':'application/json'},body:JSON.stringify({instructions:'x'})})).status,400);
  } finally {server.closeAllConnections(); server.close(); await once(server,'close');}
});
