#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

# ./run.sh starts Docker on Linux, or the private Daemon Server workflow on macOS.
action="${1:-start}"
if [[ $# -gt 0 ]]; then shift; fi

if [[ "$action" == remote ]] || { [[ "$(uname -s)" == Darwin ]] && [[ "$action" != test && "$action" != dev && "$action" != help && "$action" != --help && "$action" != -h ]]; }; then
  remote_host="${CLC_SSH_HOST:-daemonserver}"
  remote_dir="${CLC_REMOTE_DIR:-/home/pato/github-projects/codex-local-companion}"
  if [[ "$action" == remote ]]; then remote_action="${1:-start}"; [[ $# -eq 0 ]] || shift; else remote_action="$action"; fi
  printf -v remote_command 'cd %q && ./run.sh %q' "$remote_dir" "$remote_action"
  for argument in "$@"; do printf -v quoted_argument ' %q' "$argument"; remote_command+="$quoted_argument"; done
  if [[ -n "${CLC_PUBLIC_ORIGIN:-}" ]]; then
    printf -v remote_origin 'export CLC_PUBLIC_ORIGIN=%q; ' "$CLC_PUBLIC_ORIGIN"
    remote_command="$remote_origin$remote_command"
  fi
  if [[ "$remote_action" == start ]]; then
    echo 'Starting the companion on Daemon Server and forwarding http://127.0.0.1:43127/demo'
    exec ssh -t -o ExitOnForwardFailure=yes -L 127.0.0.1:43127:127.0.0.1:43127 "$remote_host" "$remote_command"
  fi
  exec ssh "$remote_host" "$remote_command"
fi

deployment="${CLC_DEPLOYMENT:-local}"
if [[ "$action" == dokploy ]]; then
  deployment=dokploy
  action="${1:-start}"
  [[ $# -eq 0 ]] || shift
fi
if [[ "$action" == test ]]; then npm ci --ignore-scripts; exec npm test; fi
if [[ "$action" == dev ]]; then npm ci --ignore-scripts; npm run build; exec npm start; fi
if [[ "$action" == help || "$action" == --help || "$action" == -h ]]; then
  echo 'Usage: ./run.sh [start|stop|status|login|logout|pair ORIGIN NAME [--account-admin]|pairings|revoke ID|smoke|test|dev|remote [COMMAND]|dokploy [COMMAND]]'
  exit 0
fi
command -v docker >/dev/null || { echo 'Docker Engine and the Compose plugin are required on Linux.' >&2; exit 1; }
docker compose version >/dev/null
compose=(docker compose)
if [[ "$deployment" == dokploy ]]; then compose+=(-f compose.dokploy.yaml -p codex-local-companion-dokploy);
elif [[ "$deployment" != local ]]; then echo 'CLC_DEPLOYMENT must be local or dokploy.' >&2; exit 1; fi
case "$action" in
  start)
    # Reuse only the verified Linux executable when it is already installed.
    # No user configuration, auth.json, caches, or other profile files are copied.
    if [[ "${CLC_RUNTIME_SOURCE:-auto}" != npm ]] && command -v codex >/dev/null; then
      runtime_binary="$(readlink -f "$(command -v codex)")"
      if [[ "$(od -An -tx1 -N4 "$runtime_binary" | tr -d ' \n')" == 7f454c46 ]]; then
        mkdir -p .runtime/version-profile
        if [[ "$(CODEX_HOME="$PWD/.runtime/version-profile" "$runtime_binary" --version 2>/dev/null)" == 'codex-cli 0.155.1' ]]; then
          cp -- "$runtime_binary" .runtime/codex
          chmod 755 .runtime/codex
          export CLC_RUNTIME_SOURCE=local
          echo 'Building with the verified installed Codex executable; profile files are excluded.'
        fi
      fi
    fi
    "${compose[@]}" build; exec "${compose[@]}" up ;;
  stop) exec "${compose[@]}" down ;;
  status|login|logout|pair|pairings|revoke) exec "${compose[@]}" exec -T companion node dist/src/cli.js "$action" "$@" ;;
  smoke) "${compose[@]}" run --rm --no-deps --entrypoint node companion dist/scripts/smoke.js
         exec "${compose[@]}" run --rm --no-deps --entrypoint node companion dist/scripts/tool-probe.js ;;
  *) echo "Unknown command: $action" >&2; exit 1 ;;
esac
