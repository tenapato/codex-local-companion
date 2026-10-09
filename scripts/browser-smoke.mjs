// Optional browser transport smoke, against a running unsigned-in companion.
// No prompts, pairing secrets, tokens, account information, or page contents are logged.
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const binary=process.env.CLC_CHROMIUM_BIN;
if(!binary)throw new Error('Set CLC_CHROMIUM_BIN to a Chromium executable');
const state=resolve(process.env.CLC_STATE??'.state');
const owner=(body)=>new Promise((yes,no)=>{
  if(process.env.CLC_OWNER_SSH){
    const child=spawn('ssh',[process.env.CLC_OWNER_SSH,'node --input-type=module'],{stdio:['pipe','pipe','ignore']});
    let output='';child.stdout.on('data',c=>output+=c);child.on('error',no);
    child.on('exit',code=>{try{code===0?yes(JSON.parse(output)):no(new Error('owner_pairing_failed'));}catch{no(new Error('owner_pairing_failed'));}});
    child.stdin.end(`import {request} from 'node:http';const req=request({socketPath:${JSON.stringify(join(state,'owner.sock'))},path:'/pair',method:'POST',headers:{'content-type':'application/json'}},res=>{res.pipe(process.stdout);res.on('end',()=>{if(res.statusCode!==200)process.exitCode=1;});});req.on('error',()=>{process.exitCode=1;});req.end(${JSON.stringify(JSON.stringify(body))});`);
    return;
  }
  const req=request({socketPath:join(state,'owner.sock'),path:'/pair',method:'POST',headers:{'content-type':'application/json'}},res=>{
    let data='';res.on('data',c=>data+=c);res.on('end',()=>{try{res.statusCode===200?yes(JSON.parse(data)):no(new Error('owner_pairing_failed'));}catch{no(new Error('owner_pairing_failed'));}});
  });req.on('error',no);req.end(JSON.stringify(body));
});
const temporary=await mkdtemp(join(tmpdir(),'companion-browser-'));
const chrome=spawn(binary,['--headless=new',`--user-data-dir=${temporary}`,'--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--no-first-run','--no-default-browser-check','about:blank'],{stdio:['ignore','ignore','pipe']});
let ws;
try{
  const endpoint=await new Promise((yes,no)=>{
    let diagnostic='';const timeout=setTimeout(()=>no(new Error('browser_start_timeout')),15000);
    chrome.stderr.on('data',c=>{diagnostic+=c;const m=/DevTools listening on (ws:\/\/[^\s]+)/.exec(diagnostic);if(m){clearTimeout(timeout);yes(m[1]);}});
    chrome.once('exit',()=>{clearTimeout(timeout);no(new Error('browser_exited'));});
  });
  ws=new WebSocket(endpoint);await new Promise((yes,no)=>{ws.addEventListener('open',yes,{once:true});ws.addEventListener('error',no,{once:true});});
  let seq=0;const pending=new Map();
  ws.addEventListener('message',event=>{
    const m=JSON.parse(String(event.data));const p=pending.get(m.id);
    if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.no(new Error('cdp_'+m.error.code)):p.yes(m.result);}
  });
  const call=(method,params={},sessionId)=>new Promise((yes,no)=>{
    const id=++seq;const timer=setTimeout(()=>{pending.delete(id);no(new Error('cdp_timeout'));},20000);
    pending.set(id,{yes,no,timer});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
  });
  const version=await call('Browser.getVersion');
  const target=await call('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await call('Target.attachToTarget',{targetId:target.targetId,flatten:true});
  await call('Page.enable',{},sessionId);
  const evaluate=async(expression)=>{
    const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);
    if(r.exceptionDetails)throw new Error('browser_evaluation_failed');return r.result.value;
  };
  const navigate=async(url)=>{
    await call('Page.navigate',{url},sessionId);
    for(let i=0;i<40;i++){
      if(await evaluate(`location.href===${JSON.stringify(url)} && document.readyState==='complete'`))return;
      await new Promise(yes=>setTimeout(yes,100));
    }throw new Error('navigation_failed');
  };
  const local='http://127.0.0.1:43127';
  await navigate(local+'/demo');
  const pair=await owner({origin:local,name:'Browser smoke'});
  const loopback=await evaluate(`(async()=>{
    const {CompanionClient}=await import('/client/index.js');
    const c=new CompanionClient(location.origin); await c.pair(${JSON.stringify(pair.code)});
    const status=await c.status(); const models=await c.models(); await c.disconnect();
    return {paired:true,authenticated:status.authenticated,models:models.length,disconnected:true};
  })()`);
  if(!loopback.paired||!loopback.models||loopback.authenticated)throw new Error('loopback_smoke_failed');
  // Actual public HTTPS document; all test calls go only to the local companion.
  // No script or data is published to example.com.
  await navigate('https://example.com/');
  const httpsOrigin=await evaluate('location.origin');
  if(httpsOrigin!=='https://example.com')throw new Error('https_origin_failed');
  const httpsPair=await owner({origin:httpsOrigin,name:'HTTPS browser transport smoke'});
  const attempt=()=>evaluate(`(async()=>{
    try {
      const r=await fetch('${local}/v1/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:${JSON.stringify(httpsPair.code)}}),credentials:'omit'});
      if(!r.ok)return {ok:false,status:r.status};const {token}=await r.json();
      const s=await fetch('${local}/v1/status',{headers:{Authorization:'Bearer '+token},credentials:'omit'});
      const d=await fetch('${local}/v1/session',{method:'DELETE',headers:{Authorization:'Bearer '+token},credentials:'omit'});
      return {ok:s.ok&&d.ok,secureContext:isSecureContext};
    }catch{return {ok:false,blocked:true,secureContext:isSecureContext};}
  })()`);
  let https=await attempt(),permission='default';
  if(!https.ok){
    try{await call('Browser.grantPermissions',{origin:httpsOrigin,permissions:['localNetworkAccess']});permission='explicit_test_grant';https=await attempt();}
    catch{permission='grant_unavailable';}
  }
  console.log(JSON.stringify({browser:version.product,os:process.platform,loopback,httpsOrigin,https,localNetworkPermission:permission,liveInference:'not_tested',deviceSignIn:'not_tested'}));
}finally{ws?.close();chrome.kill('SIGKILL');await new Promise(yes=>{if(chrome.exitCode!==null||chrome.signalCode!==null)yes();else chrome.once('exit',yes);});await rm(temporary,{recursive:true,force:true});}
