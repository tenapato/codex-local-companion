# Validation record

October 9, 2026. This is a working implementation with remaining interactive checks, not a claim of production readiness.

## Passed

- Twenty automated tests on the Mac and in the Daemon Server Docker build, with no skipped HTTP tests. Inference was mocked. Coverage includes code replay/expiry/rate limits, exact Origin/Host checks and CORS, same-origin POST reads, session/job isolation and revocation, profile ownership, denied RPC tool requests, supported model/effort validation, structured output completion gates, failed/interrupted turns, timeouts, and cancellation around turn startup. Client tests check endpoint restrictions, in-memory tokens, disconnect, and cancellation. Remote-mode tests confirm the demo is public while API pairing, Host/Origin checks, and session revocation remain enforced; remote binding requires explicit HTTPS configuration.
- Real installed Codex 0.155.1 protocol smoke using a fresh, empty HOME/CODEX_HOME. `initialize`, unsigned-in `account/read`, `model/list`, ephemeral `thread/start`, provider/model identity checks, and empty MCP/instruction discovery passed. Five catalog models were advertised without authentication; this does not verify entitlement.
- Real installed runtime with a synthetic local model transport. The request forwarded the JSON schema and exposed zero executable tools. Remaining tools were `skills.list/read`; no skills were enabled. No subscription account or paid API was used.
- The same runtime smoke and tool probe passed inside the Docker image under the Compose restrictions.
- Docker image built using the verified installed Linux executable through the optional local-runtime build stage. `./run.sh` detected the executable, built the image, and started the service. No profile or credentials were copied into the image.
- The clean npm-only Docker runtime-install stage also built successfully on Daemon Server. It independently installed the pinned platform package and verified Codex 0.155.1 without copying a host binary or profile.
- The Dokploy Compose configuration reached healthy state on Daemon Server with user `node`, read-only root, all capabilities dropped, and host publishing restricted to `127.0.0.1:43127`. Its independently installed runtime passed the real protocol and tool probes. HTTP checks with public Host `codex.tenapatricio.com` and proxy headers passed static serving, one-use pairing, required account-admin privileges, model discovery, rejection of unauthorized inference, and session revocation. Signed-out generation returned `login_required` with no partial output. This tests the origin container, not Cloudflare's edge route or a browser.
- Running container inspection showed user `node`, read-only root filesystem, all Linux capabilities dropped, and a listener at `127.0.0.1:43127` only.
- Production HTTP smoke against the running container passed pairing, replay rejection, model discovery, required account-admin privileges, disconnect, and a `login_required` job error without a partial result. No authenticated inference was attempted.
- The Mac `./run.sh` workflow started Docker on Daemon Server and opened its private SSH loopback forward. The demo HTML, CSS, JavaScript, and browser client each returned HTTP 200 through it. This verifies startup, the network forward, and static serving, not browser behavior.
- Pinned project dependency installation reported zero npm audit vulnerabilities after updating Ajv to 8.20.0. This is a package advisory check, not an application security audit.

## Awaiting interactive verification

- Managed Codex device sign-in, successful subscription-backed structured generation, live model entitlement, live cancellation, subscription-limit behavior, and sign-out after real sign-in. The demo and owner commands are implemented, but no user account was used in testing.
- Browser pairing and local-network permission behavior. Mac Chrome 153.0.8010.53 exited before launch with a platform path-service error in the execution environment. Server Chrome for Testing 153.0.8010.12 could not launch with its normal sandbox under Ubuntu's user-namespace policy. A missing ALSA library was supplied only in a disposable test directory; no OS packages or browser security policies were changed. Neither failure establishes HTTPS-to-loopback compatibility.
- Safari, Firefox, and actual application CSP/permission behavior. No compatibility claim is made for these browsers.
- The owner-managed Dokploy deployment, actual `codex.tenapatricio.com` tunnel route, and HTTPS browser workflow. The repository supplies the Compose configuration and preserves pairing authentication with Cloudflare Access off; it does not claim that hostname routing or browser behavior has passed.

Test services are stopped after validation so they do not reserve the port needed by Dokploy. The optional remote Compose file intentionally supports public HTTPS transport; the hostname must be configured by the owner. No hosted subscription integration or Litho-Graphic integration is implemented.

## Continue verification

From the Mac clone or Linux checkout, run `./run.sh`. On macOS this starts the server workflow and SSH forward. In another terminal:

```sh
./run.sh pair http://127.0.0.1:43127 'Local demo' --account-admin
```

Open `http://127.0.0.1:43127/demo` and paste the code. Use **Sign in to Codex**, complete the managed device-code flow, and use **Refresh status**. Choose a returned model/effort and generate the example structured draft. Verify cancellation on a second turn, then sign out and disconnect. Record the actual browser/version and observed results here.

To test a hosted application against local mode, first authorize its exact HTTPS origin with `./run.sh pair`. Bundle `client/index.ts` into that application. Allow the specific loopback endpoint in the application's `connect-src`, test browser local-network permission allow/deny behavior, and verify pair, status, draft, cancel, and disconnect. Do not disable browser security protections to make the test pass. For the explicitly configured remote HTTPS mode, follow [DOKPLOY.md](DOKPLOY.md) and test the same API workflow through the public hostname.

An optional CDP script is provided at `scripts/browser-smoke.mjs`. It uses a fresh browser profile, an unsigned-in running companion, and an actual `https://example.com/` document for transport testing. Set `CLC_CHROMIUM_BIN` and `CLC_STATE` to the browser executable and companion state directory. It can attempt the browser's test permission grant and reports it separately. It has not completed in this execution environment and is not part of the passing automated suite.
