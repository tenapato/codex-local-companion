# Dokploy and Cloudflare Tunnel

This deployment serves a personal companion at `https://companion.example.com`. Cloudflare Access is deliberately left off. Anyone can load the demo page; only a browser with a pairing code issued by the server owner can obtain an API session. Keep the subscription for your own use.

## Dokploy service

1. Create a project and a **Compose** service using **Docker Compose**, with GitHub repository `tenapato/codex-local-companion`, branch `main`.
2. Set **Compose Path** to `./compose.dokploy.yaml`.
3. Set this environment variable, without a trailing slash:

   ```dotenv
   CLC_PUBLIC_ORIGIN=https://companion.example.com
   ```

4. Deploy. The default build independently installs pinned Codex 0.155.1; it does not need existing CLI credentials. The large Codex package can take time to download. A container that has not completed interactive sign-in should still become healthy.
5. In **Domains**, add host `companion.example.com`, service `companion`, container port `43127`, path `/`. When the tunnel terminates browser TLS and connects to Dokploy over HTTP, select HTTP routing on the Dokploy side. Redeploy after adding the domain.

The Compose file binds the application inside its container on `0.0.0.0:43127`. Its direct host port is restricted to `127.0.0.1:43127`. Dokploy adds its router network when a domain is configured. The fixed named volume `codex-local-companion-state` preserves only this companion's profile; do not run two companion instances against it. The local development Compose file uses a different volume. No Codex profile is mounted from the host.

## Cloudflare hostname

On the existing Daemon Server tunnel, add published application hostname `companion.example.com`. Choose one route:

- **Through Dokploy:** service `http://127.0.0.1:80`. This uses the Dokploy domain rule above. The existing cloudflared connector runs with host networking, so `127.0.0.1` reaches the host router.
- **Direct to the companion:** service `http://127.0.0.1:43127`. This also works with that host-network connector; a Dokploy domain rule is unnecessary for this route.

Preserve the incoming Host `companion.example.com`. If setting an HTTP Host Header override, use exactly that hostname. Do not override it with `localhost`. Cloudflare must serve HTTPS to browsers. Leave Access disabled as requested, and do not add a wildcard browser-origin rule or publish an unrestricted inference endpoint. No additional cloudflared container or tunnel token belongs in this repository.

If the tunnel connector is later moved off host networking, loopback no longer reaches the host. Update its route/network deliberately instead of publishing the companion port on all host interfaces.

## Pair and sign in

Open Dokploy's terminal for the **companion** container and run the absolute path below. Dokploy may open the terminal in `/` rather than the image's `/app` working directory:

```sh
node /app/dist/src/cli.js pair https://companion.example.com 'Personal browser' --account-admin
```

Open `https://companion.example.com/`, enter the pairing code within two minutes, then use **Sign in to Codex** and complete the device authorization yourself. Pairing a browser and signing into Codex remain separate. Ordinary application pairings should omit `--account-admin`.

Other owner commands in the same container terminal:

```sh
node /app/dist/src/cli.js status
node /app/dist/src/cli.js pairings
node /app/dist/src/cli.js revoke SESSION_ID
node /app/dist/src/cli.js logout
```

The private owner socket is not exposed through the HTTP service. Anyone with Dokploy/container-terminal access can administer the account and should be trusted accordingly.

## run.sh alternative

To run this same configuration directly instead of having Dokploy manage it, set `CLC_PUBLIC_ORIGIN` in an ignored `.env` on the server or export it, then use:

```sh
CLC_PUBLIC_ORIGIN=https://companion.example.com ./run.sh dokploy
CLC_PUBLIC_ORIGIN=https://companion.example.com ./run.sh dokploy status
CLC_PUBLIC_ORIGIN=https://companion.example.com ./run.sh dokploy pair https://companion.example.com 'Personal browser' --account-admin
```

On macOS these commands run the script on `daemonserver`. They do not need an SSH port forward for the HTTPS site. The script may build from a verified installed native executable, copying no profile files. Do not start the script-managed instance while the Dokploy-managed instance is running: both reserve host port 43127 and the same state volume. When Dokploy manages the deployment, use its container terminal for owner commands.

## Browser applications

Bundle the framework-independent client, selecting HTTPS transport explicitly:

```ts
const companion = new CompanionClient('https://companion.example.com', {
  transport: 'remote-https',
});
await companion.pair(code);
```

Issue the code for the integrating app's exact origin, rather than the companion's origin. All status, model, generation, cancellation, and disconnect calls retain the pairing bearer checks. The client stores its token only in memory, omits cookies, and rejects redirects. Application CSP must allow the specific HTTPS endpoint. Litho-Graphic integration remains outside this repository.

## Verification

Check that the domain loads the demo, unpaired generation is rejected, pairing works once, and disconnect invalidates that browser session. Then complete interactive Codex sign-in, a structured draft, and live cancellation. Record browser versions and results in [VALIDATION.md](VALIDATION.md). The tunnel and real account workflow remain unverified until the hostname is configured and you complete sign-in.

The origin can be checked from the host without changing DNS:

```sh
curl -i -H 'Host: companion.example.com' http://127.0.0.1:43127/
```

An unexpected Host, unpaired Origin, or missing bearer token must be rejected on API routes. Keep the profile volume private. To remove the saved sign-in, use the owner logout command before stopping and explicitly deleting only `codex-local-companion-state`.

References: [Dokploy Compose domains](https://docs.dokploy.com/docs/core/docker-compose/domains), [Dokploy Compose setup](https://docs.dokploy.com/docs/core/docker-compose/example), and [Cloudflare published applications](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/).
