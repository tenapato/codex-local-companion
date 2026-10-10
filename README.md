# Codex Local Companion

Codex Local Companion is a personal draft-generation service that binds to loopback by default. It lets an explicitly paired browser app request drafts through the official Codex app-server while keeping the user's sign-in on the host. It does not provide API-key billing or an unauthenticated fallback.

The service is designed for one user's Linux machine, such as a private Daemon Server. The default Compose file uses Linux host networking and a loopback listener. An explicit [Dokploy and Cloudflare Tunnel mode](docs/DOKPLOY.md) serves the demo over HTTPS while retaining origin-bound pairing for every API session. It does not share an account with other users. Read [Security](docs/SECURITY.md) before pairing an origin or using it with a browser app.

## Dokploy and Cloudflare Tunnel

Use `./compose.dokploy.yaml` as the Dokploy Compose Path, with repository `tenapato/codex-local-companion`, branch `main`. Set:

```dotenv
CLC_PUBLIC_ORIGIN=https://companion.example.com
```

Add the hostname to Dokploy service `companion`, container port `43127`, path `/`. Route the Cloudflare Tunnel hostname to the Dokploy router; or route the existing host-network tunnel directly to `http://127.0.0.1:43127`. Both use the public hostname as the request Host. Cloudflare handles browser HTTPS. No Cloudflare Access policy is required in this mode: the demo is public, but API usage requires a short-lived pairing code issued by the server owner. See the [deployment guide](docs/DOKPLOY.md) for exact settings, owner commands, and verification.

## Requirements

- Linux with Docker Engine and Docker Compose plugin for the recommended deployment.
- Node.js 22 or newer and npm for local development.
- The image pins `@openai/codex` to `0.155.1`; the companion fails closed for inference if the runtime version differs.
- A ChatGPT account that can sign in to Codex through its device authorization flow. This uses the account's applicable plan and limits; there is no API billing fallback.

## Start with run.sh

Clone this repository if needed:

```sh
git clone https://github.com/tenapato/codex-local-companion.git
cd codex-local-companion
```

From the project directory, one script builds the image and starts everything in the foreground:

```sh
./run.sh
```

On Linux this runs Docker Compose. On macOS it starts the same script on `daemonserver` and opens the private SSH forward automatically. The remote checkout must already exist at `/home/pato/github-projects/codex-local-companion`. Override `CLC_SSH_HOST` or `CLC_REMOTE_DIR` if needed. Press Ctrl-C to stop the foreground run; `./run.sh stop` removes the stopped container while retaining the profile volume.

On Linux, the script can reuse an installed native Codex 0.155.1 executable for the image build. It copies only that executable into ignored `.runtime/` build input, and verifies the version in the image. The container still creates its own empty profile. `CLC_RUNTIME_SOURCE=npm ./run.sh` forces the independent npm install stage; this can require a large download. An installed Node-based Codex launcher will use the npm stage. The local-executable image build is the verified route on Daemon Server.

In a second terminal, these shortcuts work on both machines:

```sh
./run.sh pair http://127.0.0.1:43127 'Local demo' --account-admin
./run.sh login
./run.sh status
./run.sh pairings
```

Open `http://127.0.0.1:43127/demo`, paste the pairing code within two minutes, then complete Codex sign-in in your browser. Pairing and sign-in are separate steps. `./run.sh test` runs mocked tests; `./run.sh smoke` runs the isolated runtime probes inside Docker. Linux users can explicitly select `./run.sh remote` for the SSH workflow.

Keep the first run in the foreground so startup and runtime errors remain visible. The service should report `http://127.0.0.1:43127/demo`. Sign-in is interactive and belongs to the owner, never to the browser:

```sh
docker compose exec companion node /app/dist/src/cli.js login
```

Complete the displayed device-code flow. To pair a browser origin, use its exact origin (scheme, host, and port, without a path):

```sh
docker compose exec companion node /app/dist/src/cli.js pair https://your-app.example 'Local demo'
```

Use `--account-admin` only for a trusted personal demo that should be able to start or end the Codex account login session:

```sh
docker compose exec companion node /app/dist/src/cli.js pair http://127.0.0.1:43127 'Local demo' --account-admin
```

The CLI prints a single-use pairing code valid for 120 seconds. Enter it into the browser app. The included demo is served at `/demo`; it can redeem a code at the same loopback service. The demo flow can use a paired account-admin session for managed device login. Account-admin access is broader than ordinary draft access; grant it only to your own trusted app.

Use `docker compose exec companion node /app/dist/src/cli.js pairings` to inspect active pairings and `docker compose exec companion node /app/dist/src/cli.js revoke SESSION_ID` to revoke one. `docker compose down` stops the service. `docker compose down --volumes` also deletes its persisted profile and login state; this is destructive. To invalidate the saved Codex sign-in before deleting state, run the owner CLI `logout` command.

## Open the demo from a Mac

For a remote Linux host named `daemonserver`, forward the loopback port over SSH:

```sh
ssh -N -L 127.0.0.1:43127:127.0.0.1:43127 daemonserver
```

Then open `http://127.0.0.1:43127/demo` on the Mac. The SSH tunnel must remain open. `./run.sh` on macOS handles startup and this forward automatically; use the manual command when the service is already running. The companion sees the browser origin as the local Mac origin; pair that exact origin (for example, `http://127.0.0.1:5173` for a separately hosted dev app). Keep the default local mode behind this private forward. Use the explicit Dokploy configuration for public HTTPS transport.

Browser access from an HTTPS production page to a local HTTP companion depends on browser local-network protections, site permissions, and the app's Content Security Policy. This compatibility path has not been verified across browsers; see [Security](docs/SECURITY.md#browser-local-network-access).

For startup, sign-in, pairing, and browser failures, see [Troubleshooting](docs/TROUBLESHOOTING.md).

## Develop and use the client

```sh
npm ci
npm test
npm run smoke
npm run probe
```

`npm test` builds and runs the mocked runtime/HTTP tests. `npm run smoke` performs a real isolated app-server initialize/account/model/thread smoke test without signing in or generating inference. `npm run probe` checks the installed runtime's tool surface through a synthetic local endpoint. The runtime probes do not verify live inference, interactive sign-in, or browser local-network behavior. Docker startup and the probes inside Docker have also been tested separately. See [Validation](docs/VALIDATION.md) for the current recorded status; pending checks should not be read as passed.

A framework-independent TypeScript client is in `client/index.ts`; the build output is `dist/client/index.js`. It is also served at `/client/index.js`. API and client details are in [API](docs/API.md). Litho-Graphic integration is not implemented; the intended boundary is described in [Integration](docs/INTEGRATION.md).

## Pairing guide for AI agents

See [AGENT_PAIRING.md](docs/AGENT_PAIRING.md) for owner commands, browser-origin selection, client pairing, separate Codex sign-in, verification, and revocation. Each companion uses one Codex account; other users need their own instance and isolated profile.

## Official references

- [Codex app-server](https://learn.chatgpt.com/docs/app-server)
- [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk)
- [Codex authentication](https://learn.chatgpt.com/docs/auth)
- [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
- [Chrome Local Network Access](https://developer.chrome.com/blog/local-network-access)
- [MDN: Local network access](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Local_network_access)
- [MDN: Mixed content](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Mixed_content)

## License

[MIT](LICENSE)
