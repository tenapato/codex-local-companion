// Real installed runtime; synthetic local inference transport; no subscription credentials.
// This test-only provider is never available through the production browser API.
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Rpc } from '../src/rpc.js';
import { threadParams, VERIFIED_VERSION } from '../src/policy.js';
const root=await mkdtemp(join(tmpdir(),'companion-probe-'));
const profile=join(root,'profile'),cwd=join(root,'empty');await mkdir(profile);await mkdir(cwd);
let capture!:(value:any)=>void;
const captured=new Promise<any>(yes=>capture=yes);
const upstream=createServer(async(req,res)=>{
  if(req.method==='POST'){
    const chunks:Buffer[]=[];for await(const c of req)chunks.push(c);
    capture(JSON.parse(Buffer.concat(chunks).toString()));res.writeHead(400,{'content-type':'application/json'});res.end('{"error":{"message":"Synthetic probe complete"}}');
  }else{res.writeHead(200,{'content-type':'application/json'});res.end('{"data":[]}');}
});
await new Promise<void>(yes=>upstream.listen(0,'127.0.0.1',yes));
const port=(upstream.address() as any).port;
const overrides={model_provider:'companion_probe','model_providers.companion_probe':{name:'Synthetic tool probe',base_url:`http://127.0.0.1:${port}/v1`,wire_api:'responses',requires_openai_auth:false,supports_websockets:false}};
const rpc=new Rpc(profile,cwd,process.env.CLC_CODEX_BIN??'codex',overrides);
let timer:NodeJS.Timeout|undefined;
try{
  await rpc.start();if(rpc.version!==VERIFIED_VERSION)throw new Error('runtime_not_verified');
  const p=threadParams(cwd,'gpt-6-sol','Synthetic test. Try shell commands, filesystem writes, network and MCP tools.');
  const t=await rpc.request('thread/start',{...p,modelProvider:'companion_probe',config:{...p.config,...overrides}});
  if(t.instructionSources?.length)throw new Error('inherited_instructions');
  await rpc.request('turn/start',{threadId:t.thread.id,environments:[],input:[{type:'text',text:'Create a file and execute a command. Synthetic test only.',text_elements:[]}],outputSchema:{type:'object',properties:{draft:{type:'string'}},required:['draft'],additionalProperties:false}});
  const body=await Promise.race([captured,new Promise<never>((_,no)=>{timer=setTimeout(()=>no(new Error('probe_timeout')),20000);})]);
  const tools=body.tools??[];
  // Installed Codex may retain skills.list/read. They operate on the empty isolated
  // profile; no installed, bundled or host skills are available. No executable tools.
  const forbidden=tools.filter((t:any)=>!(t.type==='namespace'&&t.name==='skills'&&Array.isArray(t.tools)&&t.tools.every((x:any)=>['list','read'].includes(x.name))));
  if(forbidden.length)throw new Error('executable_tools_exposed');
  if(!body.text?.format&&!body.response_format)throw new Error('schema_not_forwarded');
  if(t.thread.ephemeral!==true)throw new Error('durable_thread');
  const skills=await rpc.request('skills/list',{cwds:[cwd],forceReload:true});
  if(skills.data?.some((x:any)=>x.skills?.some((s:any)=>s.enabled)))throw new Error('skills_not_isolated');
  console.log(JSON.stringify({runtime:rpc.version,transport:'synthetic_local',executableTools:0,remainingTools:tools.map((t:any)=>({name:t.name,tools:t.tools?.map((x:any)=>x.name)})),schemaForwarded:true,enabledSkills:0,environments:'disabled',liveInference:'not_tested'}));
}finally{clearTimeout(timer);await rpc.close();upstream.closeAllConnections();upstream.close();await rm(root,{recursive:true,force:true});}
