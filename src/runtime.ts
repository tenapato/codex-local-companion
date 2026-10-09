import { mkdir, mkdtemp, rm, writeFile, chmod, lstat, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Rpc } from './rpc.js';
import { threadParams, VERIFIED_VERSION } from './policy.js';
import { Failure, failureCode } from './errors.js';
import { ajv, type Input } from './validation.js';
export interface Transport {
  request(method:string,params?:unknown):Promise<any>;
  on(event:string,callback:(message:any)=>void):unknown;
  off(event:string,callback:(message:any)=>void):unknown;
  close():Promise<void>;
}
export async function prepareProfile(state: string) {
  state=resolve(state);
  await mkdir(state,{recursive:true,mode:0o700});
  const meta=await lstat(state);
  if (meta.isSymbolicLink() || meta.uid !== process.getuid?.()) throw new Failure('unsafe_profile');
  const marker=join(state,'companion-owned');
  const entries=await readdir(state);
  if(entries.length){
    if((await readFile(marker,'utf8').catch(()=>''))!=='codex-local-companion\n')throw new Failure('profile_not_owned');
  }else await writeFile(marker,'codex-local-companion\n',{flag:'wx',mode:0o600});
  await chmod(state,0o700);
  const profile=join(state,'codex');
  await mkdir(profile,{recursive:true,mode:0o700}); await chmod(profile,0o700);
  if((await lstat(profile)).isSymbolicLink())throw new Failure('unsafe_profile');
  await writeFile(join(profile,'config.toml'),'model_provider = "openai"\nforced_login_method = "chatgpt"\ncli_auth_credentials_store = "file"\nweb_search = "disabled"\n[analytics]\nenabled = false\n',{mode:0o600});
  return profile;
}
export async function models(rpc: Transport) {
  let cursor: string|null=null; const data:any[]=[];
  for (let page=0;page<20;page++) {
    const r=await rpc.request('model/list',{limit:100,includeHidden:false,...(cursor?{cursor}:{})});
    if (!Array.isArray(r.data)) throw new Failure('protocol_malformed',502);
    data.push(...r.data); cursor=r.nextCursor;
    if (!cursor) return data.map(m=>({id:m.id,model:m.model,displayName:m.displayName,defaultReasoningEffort:m.defaultReasoningEffort,supportedReasoningEfforts:m.supportedReasoningEfforts}));
  }
  throw new Failure('protocol_pagination',502);
}
export async function runTurn(rpc: Transport, threadId: string, value: Input, signal: AbortSignal, timeoutMs=180000) {
  return new Promise<{text:string,data?:unknown}>((resolveResult,reject)=>{
    let settled=false, turnId:string|undefined, final:string|undefined, pendingCompletion:any;
    const finish=(error?:Error,result?:{text:string,data?:unknown})=>{
      if(settled)return; settled=true; clearTimeout(timer);signal.removeEventListener('abort',cancel);rpc.off('notification',listen);
      error?reject(error):resolveResult(result!);
    };
    const interrupt=()=>{ if(turnId) void rpc.request('turn/interrupt',{threadId,turnId}).catch(()=>{}); };
    const cancel=()=>{interrupt();finish(new Failure('cancelled'));};
    const timer=setTimeout(()=>{interrupt();finish(new Failure('timeout',504));},timeoutMs);
    const completed=(turn:any)=>{
      if (!turnId) { pendingCompletion=turn; return; }
      if(turn.id!==turnId)return;
      if(turn.status==='interrupted') {finish(new Failure('cancelled'));return;}
      if(turn.status==='failed') {finish(new Failure(failureCode(turn.error),502));return;}
      if(turn.status!=='completed'||typeof final!=='string'||!final.trim()||final.length>256000) {finish(new Failure('incomplete_response',502));return;}
      if(value.outputSchema) {
        try { const data=JSON.parse(final); const validate=ajv.compile(value.outputSchema); if(!validate(data))throw new Error(); finish(undefined,{text:final,data}); }
        catch {finish(new Failure('invalid_structured_response',502));}
        finally { ajv.removeSchema(value.outputSchema); }
      } else finish(undefined,{text:final});
    };
    const listen=(m:any)=>{
      if(m.method==='companion/toolDenied'){finish(new Failure('tool_denied',502));return;}
      if(m.method==='companion/exited'){finish(new Failure('runtime_exited',502));return;}
      if(m.params?.threadId!==threadId)return;
      if(m.method==='turn/started') {turnId=m.params.turn.id;if(signal.aborted)interrupt();}
      if(m.method==='item/started' && !['userMessage','agentMessage','reasoning','plan'].includes(m.params.item?.type)) {
        interrupt();finish(new Failure('unexpected_tool',502));return;
      }
      if(m.method==='item/completed'&&m.params.item?.type==='agentMessage' && (!m.params.item.phase || m.params.item.phase==='final_answer')) final=m.params.item.text;
      if(m.method==='turn/completed')completed(m.params.turn);
    };
    rpc.on('notification',listen); signal.addEventListener('abort',cancel,{once:true});
    if(signal.aborted){cancel();return;}
    void rpc.request('turn/start',{
      threadId,environments:[],model:value.model,effort:value.effort,approvalPolicy:'never',
      sandboxPolicy:{type:'readOnly',networkAccess:false},
      input:[{type:'text',text:JSON.stringify({conversation:value.messages}),text_elements:[]}],
      ...(value.outputSchema?{outputSchema:value.outputSchema}:{}),
    }).then(r=>{turnId=r.turn?.id;if(!turnId){finish(new Failure('protocol_malformed',502));return;}if(settled)interrupt();else if(pendingCompletion)completed(pendingCompletion);}).catch(e=>finish(e));
  });
}
export class Runtime {
  control?:Rpc; version=''; inferenceEnabled=false;
  private workers=new Set<Rpc>();
  constructor(readonly profile:string,readonly binary='codex') {}
  async start() {
    const cwd=join(this.profile,'empty');await mkdir(cwd,{recursive:true,mode:0o700});
    this.control=new Rpc(this.profile,cwd,this.binary);await this.control.start();this.version=this.control.version;
    // Fail closed on runtime changes until the executable-tool probe is repeated and reviewed.
    this.inferenceEnabled=this.version===VERIFIED_VERSION;
  }
  async status() {
    const r=await this.control!.request('account/read',{refreshToken:false});
    return {authenticated:r.account?.type==='chatgpt',authMode:r.account?.type??null,planType:r.account?.planType??null,inferenceEnabled:this.inferenceEnabled,runtimeVersion:this.version};
  }
  async generate(value:Input,signal:AbortSignal) {
    if(!this.inferenceEnabled)throw new Failure('runtime_not_verified',503);
    if(!(await this.status()).authenticated)throw new Failure('login_required',401);
    const catalog=await models(this.control!);const selected=catalog.find(x=>x.model===value.model);
    if(!selected || !selected.supportedReasoningEfforts?.some((x:any)=>x.reasoningEffort===value.effort))throw new Failure('unsupported_settings');
    if(signal.aborted)throw new Failure('cancelled');
    const cwd=await mkdtemp(join(tmpdir(),'codex-companion-draft-'));
    const rpc=new Rpc(this.profile,cwd,this.binary);
    this.workers.add(rpc);
    let turnActive=false;
    const abortSetup=()=>{if(!turnActive)void rpc.close();};
    signal.addEventListener('abort',abortSetup,{once:true});
    try {
      if(signal.aborted)throw new Failure('cancelled');
      await rpc.start(); if(signal.aborted)throw new Failure('cancelled');
      const t=await rpc.request('thread/start',threadParams(cwd,value.model,value.instructions));
      if(t.model!==value.model || t.modelProvider!=='openai' || t.thread?.ephemeral!==true || t.instructionSources?.length)throw new Failure('thread_isolation_failed',502);
      const mcp=await rpc.request('mcpServerStatus/list',{threadId:t.thread.id,limit:100});
      if(!Array.isArray(mcp.data)||mcp.data.length||mcp.nextCursor)throw new Failure('mcp_isolation_failed',502);
      turnActive=true;
      return await runTurn(rpc,t.thread.id,value,signal);
    } catch(e) { if(signal.aborted)throw new Failure('cancelled');throw e; }
    finally { signal.removeEventListener('abort',abortSetup);await rpc.close();this.workers.delete(rpc);await rm(cwd,{recursive:true,force:true}); }
  }
  async login() {
    const r=await this.control!.request('account/login/start',{type:'chatgptDeviceCode'});
    if(r.type!=='chatgptDeviceCode'||typeof r.userCode!=='string'||r.verificationUrl!=='https://auth.openai.com/codex/device')throw new Failure('protocol_malformed',502);
    return {verificationUrl:r.verificationUrl,userCode:r.userCode,loginId:r.loginId};
  }
  async logout(){await this.control!.request('account/logout');}
  async close(){await Promise.allSettled([...this.workers].map(rpc=>rpc.close()).concat(this.control?[this.control.close()]:[]));}
}
