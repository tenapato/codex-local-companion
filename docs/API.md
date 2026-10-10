# HTTP API and browser client

The service listens on `http://127.0.0.1:43127` by default. Local mode accepts only loopback Host values (`127.0.0.1:<port>` or `localhost:<port>`) and rejects forwarded proxy headers. A different port can be selected with `CLC_PORT` (1024–65535); the demo uses its current origin, while the startup script's SSH forward uses the default port.

Explicit remote mode sets `CLC_PUBLIC_ORIGIN` to a canonical HTTPS origin without a trailing slash. It additionally accepts that exact hostname as Host. Forwarding headers on that Host are ignored for authorization; Origin, pairing, and bearer checks remain mandatory. Set `CLC_BIND=0.0.0.0` only inside the dedicated Dokploy container, whose host port is published on loopback. This bind fails closed without a valid public origin. Static assets at `/`, `/demo`, and their scripts/styles are public in remote mode; the owner socket is never an HTTP route. Cloudflare Access is not required by this implementation.

Except for static demo/client assets and `POST /v1/pair`, API calls require both an exact paired `Origin` header and `Authorization: Bearer <token>`. Pairing is bound to the exact origin. JSON requests must have `Content-Type: application/json`; request bodies are capped at 100,000 bytes. Responses are JSON and marked `no-store`.

## Pairing

The owner creates a pairing over the private Unix socket, not the HTTP API:

```sh
docker compose exec companion node /app/dist/src/cli.js pair https://your-app.example 'My app'
```

The CLI returns a code valid for 120 seconds. The browser exchanges it once:

```http
POST /v1/pair
Origin: https://your-app.example
Content-Type: application/json

{"code":"<single-use-code>"}
```

Success returns `{ "token": "…", "session": { "id", "name", "origin", "accountAdmin", "expiresAt" } }`. Tokens expire after eight hours and are held in memory by the service. Pairing attempts are rate-limited. A browser must keep its token in memory and must not place it in persistent browser storage.

## Endpoints

All endpoints below, except `POST /v1/pair`, require the paired Origin and bearer token.

| Method and path | Purpose | Success |
| --- | --- | --- |
| `POST /v1/pair` | Redeem a pairing code for this exact origin. | `200` session and token |
| `GET /v1/status` | Read authentication state, plan label, runtime version, and inference gate. | `200` status object |
| `GET /v1/models` | List available model IDs and supported reasoning efforts. | `200` `{ "models": [...] }` |
| `GET /v1/limits` | Read Codex account rate-limit information. | `200` app-server rate-limit response |
| `POST /v1/login` | Start ChatGPT device login; account-admin session only. | `200` `{ verificationUrl, userCode, loginId }` |
| `POST /v1/logout` | End Codex account login; account-admin session only. Cancels all jobs; browser pairings remain valid. | `200` `{}` |
| `POST /v1/jobs` | Submit a bounded draft request. | `202` queued/running job |
| `GET /v1/jobs/{id}` | Read a job owned by this session. | `200` job state |
| `DELETE /v1/jobs/{id}` | Cancel a queued/running job. | `200` job state |
| `DELETE /v1/session` | Revoke this browser session and its jobs. | `200` `{}` |

`POST /v1/login` and `/v1/logout` require an empty JSON object. The service never provides a browser endpoint for arbitrary app-server methods.

Read endpoints (`status`, `models`, `limits`, and `jobs/{id}`) also accept POST with `{}`. The browser library uses POST reads because browsers omit `Origin` on same-origin GET requests. Both forms enforce the same origin and bearer checks. CORS preflight requires a pending pairing or active session for the exact origin.

### Draft request

```json
{
  "instructions": "Write a concise reply using the supplied conversation.",
  "messages": [
    { "role": "user", "content": "Please share the updated schedule." },
    { "role": "assistant", "content": "I will check and send it today." }
  ],
  "model": "<model id from /v1/models>",
  "effort": "<supported reasoning effort from /v1/models>",
  "outputSchema": {
    "type": "object",
    "properties": { "draft": { "type": "string" } },
    "required": ["draft"],
    "additionalProperties": false
  }
}
```

Fields `instructions`, `messages`, `model`, and `effort` are required. `outputSchema` is optional. Only `user` and `assistant` message roles are accepted; the companion serializes these messages as quoted conversation data inside one user input. There is no browser-provided system/developer role. Model and effort must be advertised by the runtime's current model catalog. A catalog entry is a candidate, not proof of subscription entitlement; only a successful live turn confirms access for that request.

Bounds: `instructions` up to 8,000 characters; 1–32 messages, each at most 16,000 characters; combined instructions and message content at most 64,000 characters; model and effort strings up to 160 characters. Schemas are at most 16,000 serialized characters, depth 16, and 1,000 traversed values. `$ref`, `$dynamicRef`, `$recursiveRef`, `pattern`, and `patternProperties` are rejected. Schema compilation and final output validation use Ajv. No arbitrary regular-expression patterns or external schema references are accepted.

Jobs run one at a time globally, with at most eight queued/active jobs and two queued/active jobs per browser session. Job lifetime is capped at three minutes. Completed jobs are retained for up to ten minutes, subject to in-memory capacity. There is no streaming API: only a completed final answer is returned. Output is capped at 256,000 characters. Structured output is parsed and checked against the provided schema before it is returned.

A job response has one of these states: `queued`, `running`, `completed`, `failed`, or `cancelled`. A completed response contains `result: { text, data? }`; when an output schema was requested, `data` contains the parsed JSON value. Failed responses contain `error: { code }`. Job IDs are scoped to the submitting session.

### Errors

Errors use `{ "error": { "code": "..." } }`. Common codes include `invalid_input`, `input_too_large`, `invalid_output_schema`, `invalid_structured_response`, `unsupported_settings`, `model_unavailable`, `context_limit`, `usage_limited`, `login_required`, `runtime_not_verified`, `incomplete_response`, `timeout`, `cancelled`, `busy`, `job_not_found`, `unauthorized`, `origin_not_paired`, `invalid_origin`, `account_admin_required`, `pairing_rate_limited`, and `not_found`. HTTP status conveys the broad class; callers should branch on the stable code and handle unknown codes safely. Internal failures return `internal_error` without upstream error text.

## TypeScript client

Import the React-independent client from `client/index.ts` in source projects, or the compiled `dist/client/index.js` in a built installation:

```ts
import { CompanionClient } from './client/index.js';

const companion = new CompanionClient();
await companion.pair(code); // keep the code/token in memory only
const models = await companion.models();
const controller = new AbortController();
const job = await companion.generate({
  instructions: 'Draft a short reply using only this context.',
  messages: [{ role: 'user', content: 'Can we move the meeting to Thursday?' }],
  model: models[0].model,
  effort: models[0].defaultReasoningEffort,
  signal: controller.signal,
});
if (job.state === 'completed') {
  const draft = job.result?.text; // render or return for application validation
}
// controller.abort() cancels a pending generation.
await companion.disconnect(); // revokes the session and clears this instance's token
```

`generate()` submits a job and polls until completion, failure, cancellation, or abort. If an `AbortSignal` fires, it requests job cancellation and rejects with `AbortError`; a network loss or page close can leave a job running until its three-minute timeout. Call `submit()`, `getJob()`, and `cancel()` directly when the application needs to manage polling itself. `disconnect()` revokes the paired session; simply dropping a client instance does not revoke the server-side session, which expires after eight hours.

The default constructor accepts only HTTP `localhost` or `127.0.0.1` URLs with no path or credentials. Remote HTTPS requires an explicit transport choice:

```ts
const companion = new CompanionClient('https://codex.tenapatricio.com', {
  transport: 'remote-https',
});
await companion.pair(code);
```

Both transports use only the in-memory pairing bearer token; cookies are omitted and redirects are rejected. Remote mode accepts HTTPS hostnames without paths or credentials. Browser cross-origin access remains available only for paired origins. An application must allow the exact HTTPS endpoint in its `connect-src`. Adding Cloudflare Access later requires a separate cookie/token transport design; the current client does not implement Access authentication.
