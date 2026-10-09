export interface CompanionSession {
  id: string;
  name: string;
  origin: string;
  accountAdmin: boolean;
  expiresAt: number;
}

export interface CompanionModel {
  id: string;
  model: string;
  displayName: string;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: Array<{ reasoningEffort: string; description: string }>;
}

export interface CompanionStatus {
  authenticated: boolean;
  authMode: string | null;
  planType: string | null;
  inferenceEnabled: boolean;
  runtimeVersion: string;
}

export interface CompanionJob {
  id: string;
  state: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';
  result?: { text: string; data?: unknown };
  error?: { code: string };
}

export interface GenerateOptions {
  instructions: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  model: string;
  effort: string;
  outputSchema?: object;
  signal?: AbortSignal;
  pollIntervalMs?: number;
}

export class CompanionError extends Error {
  readonly code: string;
  readonly status?: number;
  constructor(code: string, status?: number) {
    super(code);
    this.name = 'CompanionError';
    this.code = code;
    this.status = status;
  }
}

/** Browser client for a companion server on the same machine. Tokens live only in this instance. */
export class CompanionClient {
  readonly baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl = 'http://127.0.0.1:43127') {
    this.baseUrl = CompanionClient.validateBaseUrl(baseUrl);
  }

  private static validateBaseUrl(value: string): string {
    let url: URL;
    try { url = new URL(value); } catch { throw new TypeError('Companion URL must be an HTTP localhost URL.'); }
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'http:' || (host !== 'localhost' && host !== '127.0.0.1') ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new TypeError('Companion URL must use HTTP on localhost or 127.0.0.1 without a path or credentials.');
    }
    return url.origin;
  }

  private async request<T>(path: string, method = 'GET', body?: unknown, auth = true): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && this.token) headers.Authorization = `Bearer ${this.token}`;
    const response = await fetch(`${this.baseUrl}${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit', cache: 'no-store',
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    let payload: any = null;
    try { payload = await response.json(); } catch { /* handled as a generic protocol error */ }
    if (!response.ok) throw new CompanionError(payload?.error?.code || 'request_failed', response.status);
    return payload as T;
  }

  async pair(code: string): Promise<{ token: string; session: CompanionSession }> {
    const result = await this.request<{ token: string; session: CompanionSession }>('/v1/pair', 'POST', { code }, false);
    if (!result?.token || !result.session) throw new CompanionError('invalid_pair_response');
    this.token = result.token;
    return { token: result.token, session: result.session };
  }

  // Browsers omit Origin on same-origin GET. POST reads ensure Origin is present
  // even when the demo and companion share an origin; authorization is identical.
  status(): Promise<CompanionStatus> { return this.request('/v1/status', 'POST', {}); }
  async models(): Promise<CompanionModel[]> { return (await this.request<{ models: CompanionModel[] }>('/v1/models', 'POST', {})).models; }
  limits(): Promise<unknown> { return this.request('/v1/limits', 'POST', {}); }
  login(): Promise<{ verificationUrl: string; userCode: string; loginId: string }> { return this.request('/v1/login', 'POST', {}); }
  logout(): Promise<unknown> { return this.request('/v1/logout', 'POST', {}); }

  submit(options: Omit<GenerateOptions, 'signal' | 'pollIntervalMs'>): Promise<{ id: string; state: 'queued' | 'running' }> {
    const { instructions, messages, model, effort, outputSchema } = options;
    return this.request('/v1/jobs', 'POST', { instructions, messages, model, effort, ...(outputSchema ? { outputSchema } : {}) });
  }

  getJob(id: string): Promise<CompanionJob> { return this.request(`/v1/jobs/${encodeURIComponent(id)}`, 'POST', {}); }
  cancel(id: string): Promise<unknown> { return this.request(`/v1/jobs/${encodeURIComponent(id)}`, 'DELETE'); }

  async generate(options: GenerateOptions): Promise<CompanionJob> {
    if (options.signal?.aborted) throw new DOMException('Generation cancelled.', 'AbortError');
    const job = await this.submit(options);
    const interval = Math.max(150, options.pollIntervalMs ?? 700);
    try { while (true) {
      if (options.signal?.aborted) {
        await this.cancel(job.id);
        throw new DOMException('Generation cancelled.', 'AbortError');
      }
      const current = await this.getJob(job.id);
      if (current.state === 'completed' || current.state === 'failed' || current.state === 'cancelled') return current;
      await new Promise<void>((resolve, reject) => {
        const done = () => { options.signal?.removeEventListener('abort', abort); resolve(); };
        const timer = setTimeout(done, interval);
        const abort = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); reject(new DOMException('Generation cancelled.', 'AbortError')); };
        options.signal?.addEventListener('abort', abort, { once: true });
        if (options.signal?.aborted) abort();
      });
    } } catch (error) { await this.cancel(job.id).catch(() => {}); throw error; }
  }

  async disconnect(): Promise<void> {
    if (!this.token) return;
    try { await this.request('/v1/session', 'DELETE'); }
    finally { this.token = null; }
  }
}
