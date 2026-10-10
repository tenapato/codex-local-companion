# Integration boundary

The companion exposes a personal draft-generation service and a framework-independent client, using loopback by default or an explicitly configured HTTPS endpoint. It does not implement Litho-Graphic integration. Treat the companion response as untrusted draft material; the host application retains all authority over domain data and persistence.

## Recommended flow

1. The browser app pairs its exact origin with the companion. Keep the pairing code and bearer token in memory only.
2. A Worker authorized by the application gathers only the context the signed-in user is allowed to use, then returns a bounded draft request to the browser.
3. The browser asks the companion to generate a draft from that supplied context.
4. The browser sends the draft back to the Worker. The Worker rechecks permissions and validates references, prices, recipients, and domain rules against authoritative data.
5. The application shows the user the proposed result and requires explicit confirmation before saving or sending.

Do not let the local model response establish authorization, confirm prices, select records the Worker did not authorize, or bypass the application's existing write flow. The companion cannot validate Litho-Graphic permissions or business rules.

## Client example

```ts
import { CompanionClient } from './client/index.js';

const client = new CompanionClient();
await client.pair(pairingCode);
const available = await client.models();
const model = available.find((entry) => entry.model === preferredModel) ?? available[0];
const controller = new AbortController();

const generated = await client.generate({
  instructions: 'Prepare a concise draft. Use only the supplied context.',
  messages: [
    { role: 'user', content: JSON.stringify(workerAuthorizedContext) },
  ],
  model: model.model,
  effort: model.defaultReasoningEffort,
  outputSchema: {
    type: 'object',
    properties: { draft: { type: 'string' } },
    required: ['draft'],
    additionalProperties: false,
  },
  signal: controller.signal,
});

if (generated.state === 'completed') {
  // Send generated.result?.data or text to the Worker for fresh validation.
  // Show the validated proposal and wait for the user's save confirmation.
}

// On user cancellation or component teardown:
controller.abort();
// When the user disconnects the companion session:
await client.disconnect();
```

`generate()` returns a `CompanionJob` when the job reaches `completed`, `failed`, or `cancelled`. It polls the HTTP job endpoints. An `AbortController` cancels the server job when possible; if the browser has already lost its connection, the server's three-minute job limit bounds remaining work. Use `submit()`, `getJob()`, and `cancel()` for explicit polling or custom UI. `disconnect()` revokes the browser session; an unmount or closed tab alone does not revoke it.

Use only the model IDs and effort values returned by `models()`. Keep context within the API's size limits and exclude secrets and unrelated user data. Optional structured output is validated against a restricted JSON Schema subset, but the Worker must still validate the returned data against current authoritative state.

## Browser deployment considerations

A browser page at an HTTPS origin may be blocked when it calls the HTTP loopback service, depending on browser local-network permissions and policy. Content Security Policy must allow the companion in `connect-src`, and browser local-network access behavior may require user action. Neither HTTPS browser access nor any specific Litho-Graphic deployment path is verified by this repository. See [Security](SECURITY.md#browser-local-network-access) and test the exact browser and app configuration.

For the optional Dokploy/Cloudflare deployment, construct the client with the exact HTTPS endpoint and `{ transport: 'remote-https' }`. Pair the integrating application's origin, keep its token in browser memory, and permit that endpoint in `connect-src`. The hosted Worker does not receive the pairing token or Codex credentials. This removes the HTTP-loopback transport dependency, but actual browser and application behavior must still be tested. See [DOKPLOY.md](DOKPLOY.md).
