# Security model and operational limits

Codex Local Companion is a personal draft-generation bridge for one user's machine. It is not a multi-tenant gateway or a general Codex proxy. The implementation uses the official Codex app-server and a private Codex profile. It does not accept API keys or switch to API billing when subscription authentication is unavailable.

## Network and browser boundary

The default HTTP listener binds to `127.0.0.1`. The local Compose configuration uses host networking and publishes no ports. Local mode accepts only loopback Host values and rejects forwarded proxy headers. It does not mount the Docker socket.

The optional Dokploy configuration explicitly enables remote HTTPS transport with `CLC_PUBLIC_ORIGIN`. It binds inside its container on `0.0.0.0`, publishes only a host-loopback port, and permits the exact configured public Host through Cloudflare Tunnel or Dokploy's router. Proxy headers never grant identity or authorization. This changes the threat boundary: the demo and pairing redemption route are internet reachable, and Cloudflare terminates browser TLS. Cloudflare Access is left off at the owner's request. The pairing code and browser bearer token are therefore the access controls for the inference API. Never distribute them to other users or embed them in frontend code, URLs, hosted servers, or public logs. Pairing redemption is rate-limited, but this release does not claim protection against every application-layer denial of service.

Each browser origin must be paired by the owner using its exact origin. Pairing codes are single-use and expire after 120 seconds. Browser sessions are bound to that origin, use bearer tokens, expire after eight hours, and are held in memory. API GETs also require Origin and bearer authorization. CORS preflight accepts only GET, POST, and DELETE and only Authorization and Content-Type headers. A pairing token is a bearer credential: anyone who obtains it can act within that browser session's permissions until it is revoked or expires.

The included owner CLI communicates over a Unix socket with mode `0600`. The CLI can create/list/revoke pairings, start/stop account login, and inspect status. Owner access is therefore equivalent to access to the host account and companion state. Do not make the socket or container state available to untrusted users.

## Draft-only Codex policy

The companion creates a separate, isolated profile under `/state/codex`, and starts ephemeral inference threads in temporary empty working directories. It does not mount the host's `~/.codex` or user workspace. It disables web search, MCP servers, apps, plugins, shell and unified execution, multi-agent execution, browser/computer use, image generation, hooks, memory, skill discovery, workspace dependencies, permission requests, and related tool surfaces through app-server configuration. Inference is allowed only for the pinned, verified Codex runtime version `0.155.1`; a different version fails closed until the runtime probe and review are repeated.

The runtime's synthetic tool probe found no executable tool surface. Codex may retain `skills.list` and `skills.read` methods, but the isolated profile has no enabled skills, and the probe checks that condition. During generation, the companion rejects unexpected tool items and does not return an incomplete or partial response as a draft. The app-server configuration and probe provide defense in depth; they are not a claim that all future Codex versions or environments have been audited.

The browser can submit only bounded instructions, quoted `user`/`assistant` conversation context, a catalog model and supported effort, and an optional bounded JSON schema. It cannot send system messages, arbitrary app-server calls, or custom tool definitions. The application integrating drafts must still validate permissions, references, pricing, recipients, and other domain-specific facts, and should require the user to confirm before saving or sending a result.

## Data and persistence

Prompts and generated drafts are processed by Codex using the signed-in account and its applicable service terms and controls. In tunnel mode, requests and results also pass through Cloudflare, which terminates HTTPS; review any enabled edge request logging. OpenAI credentials stay in the isolated profile and are never returned over the tunnel. The companion does not intentionally log prompt bodies, generated text, or bearer tokens. Docker's local logging driver bounds service logs, but Codex itself may keep local logs, caches, SQLite data, or `auth.json` under the isolated `/state/codex` profile. Do not assume zero disk persistence.

The Compose volume `companion_state` persists the isolated profile and account login across restarts. Browser sessions and pairing codes are in memory and are revoked on restart. To revoke one browser session, use `docker compose exec companion node /app/dist/src/cli.js revoke SESSION_ID`; to end the Codex login, use the owner `logout` command (which calls app-server `account/logout` and cancels all jobs; browser pairings remain valid). `docker compose down --volumes` deletes the persistent profile and login state and is destructive.

## Browser local-network access

An HTTPS website calling an HTTP loopback companion may be subject to browser local-network access permission prompts and network request checks. Browser behavior differs by version and policy. The companion responds to an `Access-Control-Request-Private-Network: true` preflight only for an origin already known from an active pairing or unredeemed pairing. This implementation detail does not establish broad compatibility. Chrome Local Network Access permission requirements, browser mixed-content rules, and a site's Content Security Policy `connect-src` can all block the request. HTTPS-to-localhost browser compatibility has not been verified; check the current browser documentation and test the specific browser and embedding app before relying on it.

- [Chrome Local Network Access](https://developer.chrome.com/blog/local-network-access)
- [MDN: Local network access](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Local_network_access)
- [MDN: Mixed content](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Mixed_content)

## Account administration

A normal paired browser session can read status, models, limits, and submit/cancel/read its own jobs. It cannot start or end account login. `--account-admin` explicitly grants those additional endpoints to that paired browser origin. The account-admin role is intended for the owner's trusted demo or app and should not be granted to general users. Owner CLI access remains the preferred way to sign in.

## Before using outside a personal machine

This project has not been declared production-ready or independently security-audited. Keep the host and Docker daemon under the owner's control, use exact trusted origins, revoke unused sessions, and review the current validation record in [VALIDATION.md](VALIDATION.md) before relying on it. Do not treat successful mocked tests or protocol smoke checks as evidence of browser, Docker, or live inference compatibility.
