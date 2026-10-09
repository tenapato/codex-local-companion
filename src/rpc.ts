import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Failure, failureCode } from './errors.js';
import { serverArgs, denial } from './policy.js';
export class Rpc extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private pending = new Map<number, {resolve:(x:any)=>void,reject:(x:Error)=>void,timer:NodeJS.Timeout}>();
  version = '';
  constructor(readonly profile: string, readonly cwd: string, readonly binary = 'codex', readonly overrides: Record<string, unknown> = {}) { super(); }
  // Do not inherit provider keys, proxies, auth tokens, MCP settings, or the user's HOME.
  env() { return { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: this.profile, CODEX_HOME: this.profile, LANG: 'C.UTF-8' }; }
  async start() {
    this.version = execFileSync(this.binary, ['--version'], {env:this.env(),encoding:'utf8',timeout:10000,stdio:['ignore','pipe','ignore']}).trim().replace(/^codex-cli\s+/, '');
    this.child = spawn(this.binary, serverArgs(this.overrides), {cwd:this.cwd,env:this.env(),stdio:'pipe'});
    this.child.stderr.resume(); // Runtime diagnostics may contain prompts. Never forward them.
    this.child.stdout.setEncoding('utf8');
    let buffer = '';
    this.child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 4 * 1024 * 1024) { this.fail('protocol_size'); return; }
      let i: number;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
        try { this.receive(JSON.parse(line)); } catch { this.fail('protocol_malformed'); return; }
      }
    });
    this.child.on('error', () => this.fail('runtime_unavailable'));
    this.child.on('exit', () => this.fail('runtime_exited'));
    this.child.stdin.on('error', () => this.fail('runtime_exited'));
    await this.request('initialize', {clientInfo:{name:'codex_local_companion',title:'Codex Local Companion',version:'0.1.0'},capabilities:{experimentalApi:true}});
    this.send({method:'initialized',params:{}});
  }
  receive(message: any) {
    if (!message || typeof message !== 'object') throw new Error('malformed');
    if (message.method && message.id !== undefined) {
      this.send(denial(message)); this.emit('notification',{method:'companion/toolDenied'}); return;
    }
    if (message.id !== undefined) {
      const p = this.pending.get(message.id);
      if (!p) return;
      clearTimeout(p.timer); this.pending.delete(message.id);
      if (message.error) p.reject(new Failure(failureCode(message.error),502));
      else if (!Object.hasOwn(message,'result')) p.reject(new Failure('protocol_malformed',502));
      else p.resolve(message.result);
    } else if (typeof message.method === 'string') this.emit('notification',message);
    else throw new Error('malformed');
  }
  private send(message: unknown) {
    if (!this.child || this.child.killed) throw new Failure('runtime_exited',503);
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  request(method: string, params: unknown = {}, timeoutMs = 15000): Promise<any> {
    const id = ++this.sequence;
    return new Promise((resolve,reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Failure('protocol_timeout',504)); },timeoutMs);
      this.pending.set(id,{resolve,reject,timer});
      try { this.send({id,method,params}); } catch(e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }
  private fail(code: string) {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Failure(code,502)); }
    this.pending.clear(); this.emit('notification',{method:'companion/exited'}); this.child?.kill('SIGKILL');
  }
  async close() {
    const child=this.child;
    if (!child) return;
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise<void>(resolve => { child.once('exit',()=>resolve()); child.kill('SIGKILL'); });
    }
  }
}
