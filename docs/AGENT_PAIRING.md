# Pairing guide for AI agents

Use this guide when helping an owner connect a browser application to an existing Codex Local Companion. Read [API.md](API.md) for request details and [DOKPLOY.md](DOKPLOY.md) for deployment. All domains below are examples; obtain actual addresses from the owner's configuration.

## Account ownership

Each companion instance uses one isolated Codex profile and one signed-in Codex account. Every app paired with that instance uses that account. Pairing authorizes a browser session; it does not create a separate account or attach per-app OpenAI credentials.

Another person must run their own companion instance with its own state volume and complete Codex-managed sign-in with their own account. This implementation does not provide multiple users' accounts within one shared service. Never ask an app to submit an OpenAI token, copy another CLI's credentials, or send Codex credentials to a hosted backend.

One server can host separate companion instances, but their containers, state volumes, host ports, and routed hostnames must be distinct. The shipped Dokploy Compose file fixes host port 43127 and volume name `codex-local-companion-state`; it cannot be deployed multiple times unchanged. This release has no central instance manager. Several apps or browsers can pair independently with a single instance when they should use the same owner's account; generation is queued with the API's concurrency and capacity limits.

## Identify the endpoint and browser origin

Before issuing a code, determine:

- The companion endpoint, such as `http://127.0.0.1:43127` for local mode or `https://companion.example.com` for explicit remote mode.
- The origin of the browser app making requests, such as `https://app.example.com` or `http://localhost:5173`. Use its `window.location.origin`, without a path or trailing slash.
- Whether this is an ordinary draft client or the owner's trusted account-administration UI.
- How the existing instance is managed: Dokploy, Docker Compose, or native Node.js. Do not launch a second instance to pair with the first.

For the included demo, the browser app origin equals the companion origin. For a separate application, issue the code for that application's origin. A code issued for the companion's demo cannot authorize a different app. `localhost`, `127.0.0.1`, HTTP, HTTPS, and different ports identify different origins.

Keep pairing codes and bearer tokens out of source files, URLs, persistent browser storage, public logs, and hosted backend requests. Show a pairing code only to its owner through a trusted channel.

## Issue a code through the owner CLI

The companion must already be running. Codes are issued over its private owner socket, never an HTTP admin endpoint.

In a Dokploy terminal for the companion container, use the absolute path because the terminal may start in `/`:

```sh
node /app/dist/src/cli.js pair https://app.example.com 'My browser app'
```

For the owner's trusted demo, account administration is an explicit additional permission:

```sh
node /app/dist/src/cli.js pair https://companion.example.com 'Owner demo' --account-admin
```

For the default Docker Compose deployment, run on its host from the repository:

```sh
docker compose exec companion node /app/dist/src/cli.js pair http://127.0.0.1:43127 'Local demo' --account-admin
```

For a native development instance, run from the same repository with the same `CLC_STATE` configuration as the running service:

```sh
node dist/src/cli.js pair http://localhost:5173 'Development app'
```

The output contains a single-use code valid for 120 seconds. Issue it immediately before redemption. An expired or used code needs replacement. Ordinary app pairings should omit `--account-admin`.

## Redeem from the correct browser app

For the included demo, open the companion endpoint's `/demo` page. Under **Connect your companion**, paste the code into **One-time pairing code** and click **Pair browser**.

For another application, bundle `client/index.ts` or its compiled JavaScript. Select the transport explicitly for HTTPS:

```ts
import { CompanionClient } from './client/index.js';

const companion = new CompanionClient('https://companion.example.com', {
  transport: 'remote-https',
});

// Obtain this from the owner's pairing form; do not embed it in source.
await companion.pair(code);
const status = await companion.status();
const models = await companion.models();
```

For loopback, use `new CompanionClient('http://127.0.0.1:43127')`. Keep the client instance alive while connected. Its bearer token lives only in memory, and the browser supplies Origin automatically. A page reload loses the client token and requires a new pairing. Do not redeem from the companion demo on behalf of an app hosted at a different origin.

The underlying exchange is `POST /v1/pair` with JSON `{ "code": "..." }`. Subsequent API requests require the returned bearer token and the same exact Origin. The library handles these headers and uses POST reads to preserve Origin on same-origin requests.

Sessions expire after eight hours. Service restart removes all browser sessions and unused codes; the isolated Codex sign-in can persist separately. Each browser client needs its own pairing session.

## Sign into Codex separately

Successful pairing does not mean Codex is signed in. Check `status.authenticated`.

If sign-in is needed, the owner can use **Sign in to Codex** in an account-admin demo session or run `node /app/dist/src/cli.js login` inside the container. The owner completes the displayed Codex device authorization interactively. An AI agent must not copy credentials from another app or complete account authorization as the owner. Refresh status after the owner finishes.

An ordinary pairing cannot start or end account sign-in. All authorized apps use the companion's single account, so signing out affects their inference access too.

## Verify and disconnect

Verify pairing with `status()` and `models()` before requesting inference. `authenticated: true` confirms the account session; `inferenceEnabled: true` confirms the runtime version gate. A returned model catalog does not prove subscription entitlement. Use model IDs and supported effort values from that catalog.

When the task includes generation, use bounded context and the optional output schema through `generate()`. Accept a draft only when the job state is `completed`. Report failed, interrupted, cancelled, timed-out, or untested live inference accurately. The integrating application must validate permissions, references, prices, and business rules before the user confirms saving.

Use `await companion.disconnect()` to revoke the current browser session. To revoke another session, use the owner CLI:

```sh
node /app/dist/src/cli.js pairings
node /app/dist/src/cli.js revoke SESSION_ID
```

Revocation cancels that session's jobs. Disconnect does not sign out of Codex. Owner `logout` ends the account session and cancels inference jobs, but browser pairings remain until revoked, expired, or the service restarts.

## Diagnose failures without weakening checks

- `invalid_pairing`: check expiry, reuse, and the exact browser origin; issue a new code.
- `origin_not_paired` or `invalid_origin`: confirm the request comes from the app origin authorized by the owner. Generate a code for that origin if needed.
- `invalid_host`: check the endpoint and proxy Host. Remote mode must match `CLC_PUBLIC_ORIGIN`; loopback mode accepts only its documented local Host values.
- `unauthorized`: the bearer token is missing, expired, revoked, or belongs to another origin. Pair again through the intended client.
- `account_admin_required`: use the owner CLI for account administration or an explicitly authorized admin pairing.
- `login_required`: ask the owner to complete Codex-managed sign-in; pairing alone is insufficient.
- `runtime_not_verified`: stop inference and consult the runtime validation record. Do not relax tool restrictions or the version gate to bypass it.
- `companion_not_running`: check the running instance and state/socket configuration. Inside Docker, use `/app/dist/src/cli.js`.
- A proxy's HTML 404 or 502: check hostname routing, service selection, and container port before debugging pairing. The companion's default container port is 43127.

For loopback requests from an HTTPS page, browser local-network permissions and CSP can block transport. For remote HTTPS, allow the exact endpoint in the application's `connect-src`. Test the intended browser; do not disable security flags, add wildcard origins, or remove pairing checks to make a request succeed.
