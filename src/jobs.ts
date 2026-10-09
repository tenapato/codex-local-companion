import { randomUUID } from 'node:crypto';
import { Failure } from './errors.js';
import type { Input } from './validation.js';
export type Job={id:string;owner:string;state:'queued'|'running'|'completed'|'failed'|'cancelled';result?:{text:string,data?:unknown};error?:{code:string};controller:AbortController;created:number;deadline?:NodeJS.Timeout};
export class Jobs {
  private jobs=new Map<string,Job>();
  private running=0;
  private closed=false;
  constructor(private generate:(v:Input,s:AbortSignal)=>Promise<{text:string,data?:unknown}>,private concurrency=1){}
  submit(owner:string,value:Input){
    for(const[k,j]of this.jobs)if(!['running','queued'].includes(j.state)&&j.created<Date.now()-600000)this.jobs.delete(k);
    if(this.closed||[...this.jobs.values()].filter(j=>['queued','running'].includes(j.state)).length>=8||this.jobs.size>=64)throw new Failure('busy',429);
    if([...this.jobs.values()].filter(j=>j.owner===owner&&['queued','running'].includes(j.state)).length>=2)throw new Failure('busy',429);
    const job:Job={id:randomUUID(),owner,state:'queued',controller:new AbortController(),created:Date.now()};
    this.jobs.set(job.id,job);
    job.deadline=setTimeout(()=>{
      if(['queued','running'].includes(job.state)){job.state='failed';job.error={code:'timeout'};job.controller.abort();setTimeout(()=>this.jobs.delete(job.id),600000).unref();}
    },180000).unref();
    const launch=()=>{
      if(job.state!=='queued')return;
      if(this.running>=this.concurrency){setTimeout(launch,25).unref();return;}
      this.running++;job.state='running';
      void this.generate(value,job.controller.signal).then(result=>{if(job.state==='running'){job.result=result;job.state='completed';}}).catch(e=>{
        if(job.state==='running'){job.state=e instanceof Failure&&e.code==='cancelled'?'cancelled':'failed';job.error={code:e instanceof Failure?e.code:'runtime_failed'};}
      }).finally(()=>{this.running--;clearTimeout(job.deadline);setTimeout(()=>this.jobs.delete(job.id),600000).unref();});
    };
    launch();return this.view(job);
  }
  private view(j:Job){return {id:j.id,state:j.state,...(j.state==='completed'?{result:j.result}:{}),...(j.error?{error:j.error}:{})};}
  get(owner:string,id:string){const j=this.jobs.get(id);if(!j||j.owner!==owner)throw new Failure('job_not_found',404);return this.view(j);}
  cancel(owner:string,id:string){const j=this.jobs.get(id);if(!j||j.owner!==owner)throw new Failure('job_not_found',404);if(['queued','running'].includes(j.state)){j.state='cancelled';clearTimeout(j.deadline);j.controller.abort();delete j.result;setTimeout(()=>this.jobs.delete(id),600000).unref();}return this.view(j);}
  revoke(owner:string){for(const[k,j]of this.jobs)if(j.owner===owner){j.state='cancelled';clearTimeout(j.deadline);j.controller.abort();this.jobs.delete(k);}}
  cancelAll(){this.closed=true;for(const j of this.jobs.values()){clearTimeout(j.deadline);j.controller.abort();delete j.result;j.state='cancelled';}}
}
