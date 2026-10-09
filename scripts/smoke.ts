import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Rpc } from '../src/rpc.js';
import { models } from '../src/runtime.js';
import { threadParams } from '../src/policy.js';
const root=await mkdtemp(join(tmpdir(),'companion-smoke-'));
const profile=join(root,'profile'),cwd=join(root,'empty');
await mkdir(profile);await mkdir(cwd);
const rpc=new Rpc(profile,cwd,process.env.CLC_CODEX_BIN??'codex');
try{
  await rpc.start();
  const account=await rpc.request('account/read',{refreshToken:false});
  if(account.account!==null)throw new Error('unexpected_authentication');
  const catalog=await models(rpc);
  if(!catalog.length)throw new Error('empty_catalog');
  const t=await rpc.request('thread/start',threadParams(cwd,catalog[0].model,'Synthetic protocol smoke only.'));
  if(t.model!==catalog[0].model || t.modelProvider!=='openai' || t.instructionSources?.length || !t.thread.ephemeral)throw new Error('thread_isolation_failed');
  const mcp=await rpc.request('mcpServerStatus/list',{threadId:t.thread.id,limit:100});
  if(mcp.data.length||mcp.nextCursor)throw new Error('mcp_isolation_failed');
  console.log(JSON.stringify({runtime:rpc.version,initialize:'passed',isolatedAccount:'login_required',modelDiscovery:'passed',modelCount:catalog.length,ephemeralThread:'passed',instructionSources:t.instructionSources?.length??0,mcpServers:0,liveInference:'not_tested',interactiveSignIn:'not_tested'}));
}finally{await rpc.close();await rm(root,{recursive:true,force:true});}
