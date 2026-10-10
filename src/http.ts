import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pairings, canonicalOrigin } from './pairing.js';
import { Jobs } from './jobs.js';
import { input } from './validation.js';
import { Failure } from './errors.js';
import { models, type Runtime } from './runtime.js';
import type { NetworkConfig } from './network.js';
export function checkHost(host:unknown,port:number,publicOrigin?:string){if(host!==`127.0.0.1:${port}`&&host!==`localhost:${port}`&&(!publicOrigin||host!==new URL(publicOrigin).host))throw new Failure('invalid_host',403);}
export async function jsonBody(req:IncomingMessage){
  if(req.headers['content-type']!=='application/json')throw new Failure('json_required',415);
  let size=0;const chunks:Buffer[]=[];
  for await(const c of req){size+=c.length;if(size>100000)throw new Failure('body_too_large',413);chunks.push(c);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Failure('invalid_json');}
}
export const send=(res:ServerResponse,status:number,value:unknown)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
export function createHttp(runtime:Runtime,pairings:Pairings,jobs:Jobs,port:number,root:string,network:Pick<NetworkConfig,'publicOrigin'>={}){
  const staticFiles:Record<string,[string,string]>={
    '/':['demo/index.html','text/html; charset=utf-8'], '/demo':['demo/index.html','text/html; charset=utf-8'], '/demo/':['demo/index.html','text/html; charset=utf-8'],
    '/demo/demo.js':['demo/demo.js','text/javascript'], '/demo/style.css':['demo/style.css','text/css'],
    '/client/index.js':['dist/client/index.js','text/javascript'],
  };
  return createServer({maxHeaderSize:8192,requestTimeout:10000,headersTimeout:5000},async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self' http://127.0.0.1:43127 http://localhost:43127; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    try{
      checkHost(req.headers.host,port,network.publicOrigin);
      const remote=!!network.publicOrigin&&req.headers.host===new URL(network.publicOrigin).host;
      // Forwarding headers never establish identity, origin, or authorization.
      // Only explicit remote mode accepts proxy traffic for the configured Host.
      if(!remote&&(req.headers['forwarded']||req.headers['x-forwarded-host']||req.headers['x-forwarded-for']))throw new Failure('proxy_forbidden',403);
      const requestOrigin=remote?network.publicOrigin!:`http://${req.headers.host}`;
      const path=req.url??'';
      if(req.method==='GET'&&staticFiles[path]){
        if(req.headers.origin&&req.headers.origin!==requestOrigin)throw new Failure('invalid_origin',403);
        if(req.headers['sec-fetch-site']==='cross-site'&&!(remote&&req.headers['sec-fetch-mode']==='navigate'))throw new Failure('cross_site',403);
        const[file,type]=staticFiles[path];res.writeHead(200,{'content-type':type});res.end(await readFile(resolve(root,file)));return;
      }
      const origin=canonicalOrigin(req.headers.origin);
      if(!pairings.known(origin))throw new Failure('origin_not_paired',403);
      res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
      if(req.method==='OPTIONS'){
        const method=req.headers['access-control-request-method'];
        if(!['GET','POST','DELETE'].includes(String(method)))throw new Failure('invalid_preflight',403);
        const headers=String(req.headers['access-control-request-headers']??'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
        if(headers.some(x=>!['authorization','content-type'].includes(x)))throw new Failure('invalid_preflight',403);
        res.setHeader('Access-Control-Allow-Methods','GET, POST, DELETE');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
        res.setHeader('Access-Control-Max-Age','0');
        if(req.headers['access-control-request-private-network']==='true')res.setHeader('Access-Control-Allow-Private-Network','true');
        res.writeHead(204);res.end();return;
      }
      if(path==='/v1/pair'&&req.method==='POST'){
        const body=await jsonBody(req);if(!body||Object.keys(body).some(k=>k!=='code'))throw new Failure('invalid_input');
        send(res,200,pairings.redeem(origin,body.code));return;
      }
      const session=pairings.authorize(origin,req.headers.authorization);
      const match=/^\/v1\/jobs\/([a-f0-9-]{36})$/.exec(path);
      const read=req.method==='GET'||req.method==='POST';
      if(read&&(['/v1/status','/v1/models','/v1/limits'].includes(path)||match)){
        if(req.method==='POST'){const b=await jsonBody(req);if(!b||Object.keys(b).length)throw new Failure('invalid_input');}
        if(path==='/v1/status')send(res,200,await runtime.status());
        else if(path==='/v1/models')send(res,200,{models:await models(runtime.control!)});
        else if(path==='/v1/limits')send(res,200,await runtime.control!.request('account/rateLimits/read'));
        else send(res,200,jobs.get(session.id,match![1]));
        return;
      }
      if(['/v1/login','/v1/logout'].includes(path)&&req.method==='POST'){
        if(!session.accountAdmin)throw new Failure('account_admin_required',403);
        const b=await jsonBody(req);if(!b||Object.keys(b).length)throw new Failure('invalid_input');
        if(path==='/v1/login')send(res,200,await runtime.login());
        else { for(const s of pairings.list())jobs.revoke(s.id);await runtime.logout();send(res,200,{}); }return;
      }
      if(path==='/v1/session'&&req.method==='DELETE'){jobs.revoke(session.id);pairings.revoke(session.id);send(res,200,{});return;}
      if(path==='/v1/jobs'&&req.method==='POST'){send(res,202,jobs.submit(session.id,input(await jsonBody(req))));return;}
      if(match&&req.method==='DELETE'){send(res,200,jobs.cancel(session.id,match[1]));return;}
      throw new Failure('not_found',404);
    }catch(e){send(res,e instanceof Failure?e.status:500,{error:{code:e instanceof Failure?e.code:'internal_error'}});}
  });
}
