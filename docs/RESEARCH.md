# Protocol findings

Researched October 9, 2026 against the [official app-server documentation](https://learn.chatgpt.com/docs/app-server), [SDK documentation](https://learn.chatgpt.com/docs/codex-sdk), [authentication documentation](https://learn.chatgpt.com/docs/auth), and [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).

Daemon Server has `codex-cli 0.155.1`, Linux x86-64, Docker Engine 28.1.1, and Node 22.15.1. The Mac has Codex 0.159.3; this release's inference policy deliberately blocks that unverified version. The server runtime's own `app-server generate-json-schema --experimental` output was inspected, rather than assuming the current website describes every installed field.

The SDK documentation recommends app-server for custom clients that own authentication, approvals, and streamed events. The companion therefore speaks JSONL over a private child process's stdio. App-server has no public TCP listener. There is no hosted ChatGPT integration, custom OAuth client impersonation, external-token login, or API-key provider configuration in production.

## Implemented calls

- `initialize` with `clientInfo` and `capabilities.experimentalApi: true`, followed by `initialized`.
- `account/read` with `refreshToken: false` for status. Production generation requires `account.type === "chatgpt"`.
- `account/login/start` with `type: "chatgptDeviceCode"`; Codex owns token exchange and refresh. The browser sees the managed verification URL and temporary user code, never account access/refresh tokens. `account/logout` signs out.
- `model/list` with cursor pagination returns model strings and `supportedReasoningEfforts`. The installed runtime advertised five models while unsigned-in. This is catalog discovery, not entitlement verification. Model access awaits a successful subscription-backed turn.
- `thread/start` uses `ephemeral: true`, `environments: []`, `dynamicTools: []`, `allowProviderModelFallback: false`, `sandbox: "read-only"`, and fixed tool policy. The environment/fallback fields require experimental capability in this installed protocol. The response's model/provider and instruction sources are checked before starting a turn.
- `mcpServerStatus/list` must report no configured servers before generation.
- `turn/start` accepts text input, `effort`, and optional `outputSchema`. Conversation roles are serialized as data, not forwarded as raw model instructions. Schema constraints were observed in the synthetic upstream request.
- `turn/interrupt` accepts the active thread and turn IDs. A cancellation during `turn/start` is remembered and interrupts the turn once its ID arrives; the dedicated inference process is then closed.
- `item/completed` supplies candidate final text. Only `turn/completed` with `turn.status === "completed"` releases it. Failed, interrupted, missing, invalid JSON, and schema-mismatching output are errors.
- `account/rateLimits/read` provides current account limits. Errors are translated into bounded categories; upstream messages are not echoed because they can contain input or credentials.

## Tool boundary

A read-only sandbox still allows commands and reads, so it is insufficient for this service. The inference policy additionally disables environment access and execution/tool features before initialization and again per thread. See `src/policy.ts` for the exact installed-version settings. Every app-server request back to the client is rejected; browser input has no route to arbitrary app-server methods.

`npm run probe` starts the real installed runtime with a synthetic local model transport, using fresh empty HOME/CODEX_HOME paths. Its first model request must contain no executable tools. The only accepted remaining namespace is `skills` with `list/read`, and `skills/list` must report zero enabled skills. The observed 0.155.1 request passed this check. Changing Codex versions requires repeating this probe and reviewing the policy before updating the version gate. These checks cover configuration and protocol behavior; they do not prove live model access or constitute a security audit.

The synthetic provider exists only in the tool test. The browser API cannot select it, set a provider/base URL, supply keys, or change transport. Production always uses Codex-managed ChatGPT authentication and fails when that authentication is absent.

## Browser transport

The companion uses HTTP fetch with Origin and bearer checks, explicit CORS, and preflight support for authorized or pending origins. The client uses POST variants of reads so same-origin requests also carry Origin. DNS rebinding is constrained by exact loopback Host validation; forwarded proxy headers are rejected.

[Chrome documents local-network permissions for public pages reaching loopback](https://developer.chrome.com/blog/local-network-access). [MDN describes local-network requests](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Local_network_access) and [loopback mixed-content behavior](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Mixed_content). Browser permissions, application CSP, OS policy, and browser version all matter. PNA response headers alone do not establish compatibility with Chrome's newer permission model.

See [VALIDATION.md](VALIDATION.md) for measured results and outstanding sign-in/browser checks. No public tunnel or externally reachable companion was created.
