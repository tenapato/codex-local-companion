import { createHash, randomBytes } from 'node:crypto';
import { Failure } from './errors.js';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const secret=()=>randomBytes(24).toString('base64url');
export type Session={id:string;name:string;origin:string;accountAdmin:boolean;expiresAt:number};
export function canonicalOrigin(value: unknown) {
  if(typeof value!=='string'||value.length>300)throw new Failure('invalid_origin',403);
  let u:URL;try{u=new URL(value);}catch{throw new Failure('invalid_origin',403);}
  if(u.origin!==value||u.username||u.password||!['http:','https:'].includes(u.protocol) ||
    (u.protocol==='http:'&&!['127.0.0.1','localhost'].includes(u.hostname)))throw new Failure('invalid_origin',403);
  return value;
}
export class Pairings {
  private codes=new Map<string,{session:Session,expires:number}>();
  private sessions=new Map<string,Session>();
  private attempts:number[]=[];
  constructor(private now=Date.now){}
  issue(origin:string,name:string,accountAdmin=false) {
    canonicalOrigin(origin);
    if(typeof name!=='string'||!name.trim()||name.length>80)throw new Failure('invalid_name');
    this.clean(); if(this.codes.size>=16||this.sessions.size>=64)throw new Failure('pairing_capacity',429);
    const code=secret(), expires=this.now()+120000;
    this.codes.set(hash(code),{expires,session:{id:secret(),name,origin,accountAdmin,expiresAt:this.now()+8*3600000}});
    return {code,expiresAt:expires,origin};
  }
  private clean(){for(const[k,v]of this.codes)if(v.expires<=this.now())this.codes.delete(k);for(const[k,v]of this.sessions)if(v.expiresAt<=this.now())this.sessions.delete(k);}
  known(origin:string){this.clean();return [...this.codes.values()].some(x=>x.session.origin===origin)||[...this.sessions.values()].some(x=>x.origin===origin);}
  redeem(origin:string,code:unknown) {
    this.clean();this.attempts=this.attempts.filter(x=>x>this.now()-60000);
    if(this.attempts.length>=30)throw new Failure('pairing_rate_limited',429);
    this.attempts.push(this.now());
    if(typeof code!=='string'||code.length>100)throw new Failure('invalid_pairing',401);
    const digest=hash(code), found=this.codes.get(digest);
    if(!found||found.session.origin!==origin)throw new Failure('invalid_pairing',401);
    this.codes.delete(digest); const token=secret();this.sessions.set(hash(token),found.session);
    return {token,session:found.session};
  }
  authorize(origin:string,authorization:unknown) {
    this.clean();if(typeof authorization!=='string'||!authorization.startsWith('Bearer ')||authorization.length>100)throw new Failure('unauthorized',401);
    const s=this.sessions.get(hash(authorization.slice(7)));
    if(!s||s.origin!==origin)throw new Failure('unauthorized',401);
    return s;
  }
  list(){this.clean();return [...this.sessions.values()];}
  revoke(id:string){for(const[k,v]of this.sessions)if(v.id===id){this.sessions.delete(k);return true;}return false;}
}
