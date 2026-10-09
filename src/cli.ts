import { createServer, request } from 'node:http';
import { mkdir, unlink, chmod, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pairings } from './pairing.js';
import { Jobs } from './jobs.js';
import { Runtime, prepareProfile } from './runtime.js';
import { createHttp, jsonBody, send } from './http.js';
import { Failure } from './errors.js';
const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const state=resolve(process.env.CLC_STATE??join(root,'.state'));
const socket=join(state,'owner.sock');
const [command='help',...args]=process.argv.slice(2);
async function owner(action:string,body:unknown={}){
  return new Promise<any>((yes,no)=>{
    const req=request({socketPath:socket,path:`/${action}`,method:'POST',headers:{'content-type':'application/json'},timeout:20000},res=>{
      let text='';res.setEncoding('utf8');res.on('data',c=>text+=c);res.on('end',()=>{
        try{const v=JSON.parse(text);res.statusCode===200?yes(v):no(new Failure(v.error?.code??'owner_error'));}catch{no(new Failure('owner_error'));}
      });
    });req.on('error',()=>no(new Failure('companion_not_running')));req.on('timeout',()=>req.destroy());req.end(JSON.stringify(body));
  });
}
async function start(){
  process.umask(0o077);
  const profile=await prepareProfile(state);
  // Never unlink an active owner socket. A leftover socket requires an explicit owner cleanup.
  try{await lstat(socket);throw new Failure('owner_socket_exists');}catch(e:any){if(e.code!=='ENOENT')throw e;}
  const runtime=new Runtime(profile,process.env.CLC_CODEX_BIN??'codex');await runtime.start();
  const pairings=new Pairings();const jobs=new Jobs((v,s)=>runtime.generate(v,s));
  const port=Number(process.env.CLC_PORT??43127);
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Failure('invalid_port');
  const http=createHttp(runtime,pairings,jobs,port,root);
  const admin=createServer(async(req,res)=>{
    try{
      const b=await jsonBody(req);let value:unknown;
      switch(req.url){
        case '/pair':value=pairings.issue(b.origin,b.name,b.accountAdmin===true);break;
        case '/list':value=pairings.list();break;
        case '/revoke':jobs.revoke(b.id);value={revoked:pairings.revoke(b.id)};break;
        case '/login':value=await runtime.login();break;
        case '/status':value=await runtime.status();break;
        case '/logout':for(const s of pairings.list())jobs.revoke(s.id);await runtime.logout();value={};break;
        default:throw new Failure('not_found',404);
      }send(res,200,value);
    }catch(e){send(res,400,{error:{code:e instanceof Failure?e.code:'owner_error'}});}
  });
  const cleanup=async()=>{jobs.cancelAll();http.closeAllConnections();http.close();admin.close();await runtime.close();await unlink(socket).catch(()=>{});};
  try{
    await new Promise<void>((ok,no)=>{admin.once('error',no);admin.listen(socket,()=>ok());});await chmod(socket,0o600);
    await new Promise<void>((ok,no)=>{http.once('error',no);http.listen(port,'127.0.0.1',()=>ok());});
  }catch(e){await cleanup();throw e;}
  console.log(`Codex Local Companion: http://127.0.0.1:${port}/demo`);
  console.log(`Runtime ${runtime.version}; inference ${runtime.inferenceEnabled?'enabled':'blocked: runtime not verified'}. Pair using the owner CLI.`);
  const shutdown=()=>{void cleanup().finally(()=>process.exit(0));};process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
}
try{
  if(command==='start')await start();
  else if(command==='pair'){
    const [origin,name='Browser app']=args.filter(a=>a!=='--account-admin');
    const r=await owner('pair',{origin,name,accountAdmin:args.includes('--account-admin')});
    console.log(`Origin: ${r.origin}\nSingle-use pairing code (expires in 120 seconds): ${r.code}`);
  }else if(command==='pairings')console.log(JSON.stringify(await owner('list'),null,2));
  else if(command==='revoke')console.log(JSON.stringify(await owner('revoke',{id:args[0]})));
  else if(['login','logout','status'].includes(command))console.log(JSON.stringify(await owner(command),null,2));
  else console.log('Commands: start | pair ORIGIN [NAME] [--account-admin] | pairings | revoke ID | login | logout | status');
}catch(e){console.error(e instanceof Failure?e.code:'startup_failed');process.exitCode=1;}
