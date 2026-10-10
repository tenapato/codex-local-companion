# Troubleshooting

## Startup

Run `./run.sh` from the repository and keep its terminal open. Linux requires Docker Engine and the Compose plugin, with permission to use the Docker daemon. macOS requires working SSH access to the Linux host. Set `CLC_SSH_HOST` and `CLC_REMOTE_DIR` for a host or checkout other than the defaults.

If port 43127 is occupied, stop the other companion or SSH forward before restarting. Do not solve a bind error by changing the listener to a public address. An existing owner socket causes startup to fail closed. Normal shutdown removes it. After an ungraceful crash, first confirm that no companion owns the state directory, then remove only its stale `owner.sock` before restarting; stopping a container alone does not remove an already-stale socket from a persistent volume.

An unverified Codex version disables inference. This release verifies 0.155.1. Updating it requires rerunning protocol and tool-surface probes and reviewing the policy, rather than simply relaxing the version check. A clean npm image build downloads a large platform-specific Codex package. Both that build and the installed-native-executable route have been tested on Daemon Server.

## Sign-in

Pairing authorizes a browser origin; it does not sign into Codex. Use `./run.sh login` or the trusted demo's **Sign in to Codex** button and complete the displayed device authorization yourself. Device-code sign-in may require enabling device-code authorization in ChatGPT security settings or permission from a workspace administrator. See [official Codex authentication instructions](https://learn.chatgpt.com/docs/auth).

If status remains signed out, refresh it after completing authorization and inspect the owner CLI status. Never copy another app's `auth.json`, tokens, or credential store into the companion. The advertised model catalog is not proof that your account can use every returned model. Authentication, plan limits, and unsupported settings are reported as job errors; no API billing fallback is attempted.

The companion rejects an existing directory that lacks its ownership marker, a symlinked profile, or a profile owned by another user. Choose a fresh dedicated `CLC_STATE` directory for native development. Do not point it at an existing Codex profile.

## Pairing and requests

Pair the exact origin, including scheme and nondefault port. `localhost` and `127.0.0.1` are different origins. Pairing codes expire after two minutes and work once. Generate a new code after expiry or a failed reuse. Sessions live in memory; restart requires pairing again. Each session belongs to one origin, and revocation cancels that session's jobs.

The browser client defaults to a loopback HTTP endpoint. For Dokploy's HTTPS endpoint select `{ transport: 'remote-https' }` explicitly. Requests with a missing or unexpected Origin/Host, missing bearer token, or mismatched session origin are rejected. Local mode also rejects forwarded proxy headers. A terminal HTTP check must supply the same valid Origin and authorization as the browser; there is no unauthenticated inference endpoint.

An ordinary pairing cannot sign into or out of the shared Codex account. Use the owner CLI, or deliberately issue a trusted pairing with `--account-admin`. Signing out cancels inference but does not revoke browser pairings; revoke those separately or stop the companion.

## Browser transport

For a remote private server, keep the SSH loopback forward open. The browser connects to `127.0.0.1` on its own computer; it does not connect directly to the server's address.

An HTTPS page calling the local HTTP endpoint may be blocked by local-network permissions, mixed-content rules, or its `connect-src` policy. Pair its exact HTTPS origin, permit the specific loopback endpoint in the application CSP, and test the browser's local-network permission allow and deny behavior. Browser compatibility remains unverified in this environment. Do not disable browser security flags. See [browser security details](SECURITY.md#browser-local-network-access) and the [validation record](VALIDATION.md).

For the explicit tunnel deployment, set `CLC_PUBLIC_ORIGIN=https://codex.tenapatricio.com` without a trailing slash. Use the configured public hostname as the request Host and route to container port 43127. A 403 after a Host override to `localhost` can mean the proxy headers were rejected by the local-mode boundary. A 502 from the tunnel usually needs checking the origin service and port. Follow [DOKPLOY.md](DOKPLOY.md) rather than changing the default local mode's checks. Cloudflare Access is intentionally off; pairing remains required.

## Privacy and reset

Application logs omit prompts, pairing codes, credentials, and generated records. Jobs are retained only in memory for up to ten minutes. Codex maintains its own isolated profile and may persist authentication and operational data; see [privacy and persistence](SECURITY.md).

To invalidate the saved sign-in, run `./run.sh logout`. Then stop the service. On the Linux host, `docker compose down --volumes` deletes this Compose project's isolated profile volume, including its saved login; this deletion is permanent. For native development, remove only the dedicated companion state directory after logout and shutdown. Never remove an existing CLI or desktop app profile.
