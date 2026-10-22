#!/usr/bin/env bash
# Starts Mx Office from this checkout, on this machine: the macOS (and Linux) twin of start-office.ps1.
# Runs in macOS's own bash 3.2, so nothing here needs a newer one.
#
#   ./scripts/start-office.sh                              # office home ~/mx-office, port 4600
#   ./scripts/start-office.sh --office-home ~/office2 --port 4610
#   ./scripts/start-office.sh -- --city Berlin             # anything after -- goes to the office
#
# What it does:
#   - The office keeps its data in <office home>/.agent-office and clones new projects into the office
#     home: --office-home, else AGENT_OFFICE_HOME, else ~/mx-office.
#   - Builds the office first when there's no dist folder yet (npm install too, on a fresh clone).
#   - If an office already answers on the port, it just opens it in the browser and stops.
#   - Starts the office; the office opens the browser itself once it's listening, signed in (a one-time
#     sign-in link), and a new office opens on its first-run setup (password, prerequisites, GitHub,
#     Mendix, toolkit).
#   - Keeps it running across Settings > Agents > Restart safely (the office exits with code 75 and is
#     started again; AGENT_OFFICE_LAUNCHER_LOOP=1 tells it a restart is possible).
#
# Tokens and the password are NOT read here: the office keeps them itself (on macOS in your login
# Keychain, Settings > Connections). Any environment variable already set when this runs (GH_TOKEN,
# AGENT_OFFICE_PASSWORD, AGENT_OFFICE_HOME, AGENT_OFFICE_MXCLI, ...) is left as it is and wins.
#
# --dry-run prints what it would do (as JSON) and starts nothing. --no-browser doesn't open the browser;
# --no-build doesn't build, even when dist is missing.

set -u

RESTART_EXIT_CODE=75
NODE_MIN_MAJOR=22
NODE_MIN_MINOR=5
REPO="$(cd "$(dirname "$0")/.." && pwd)"

die() {
  printf 'start-office: %s\n' "$*" >&2
  exit 1
}
say() { printf '==> %s\n' "$*"; }

office_home=''
port=''
no_browser=0
no_build=0
dry_run=0
office_args=()

while [ $# -gt 0 ]; do
  case "$1" in
    --office-home | --home)
      [ $# -ge 2 ] || die "$1 needs a folder"
      office_home="$2"
      shift 2
      ;;
    --office-home=* | --home=*) office_home="${1#*=}"; shift ;;
    --port)
      [ $# -ge 2 ] || die '--port needs a number'
      port="$2"
      shift 2
      ;;
    --port=*) port="${1#*=}"; shift ;;
    --no-browser) no_browser=1; shift ;;
    --no-build) no_build=1; shift ;;
    --dry-run) dry_run=1; shift ;;
    -h | --help)
      sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    --)
      shift
      office_args+=("$@")
      break
      ;;
    *) office_args+=("$1"); shift ;;
  esac
done

case "$port" in
  '' | *[!0-9]*) [ -z "$port" ] || die "--port wants a number, not '$port'" ;;
esac

# A path as given, with ~ expanded and made absolute (the folder may not exist yet).
full_path() {
  local p="$1"
  # shellcheck disable=SC2088 # a literal ~ given as the folder (quoted on purpose)
  case "$p" in
    "~") p="$HOME" ;;
    "~/"*) p="$HOME/${p#\~/}" ;;
  esac
  case "$p" in
    /*) ;;
    *) p="$PWD/$p" ;;
  esac
  printf '%s' "$p"
}

# What the office will be started with, from the options, the environment and the office's own settings.
set_env_keys=()
set_env_vals=()
set_env() {
  set_env_keys+=("$1")
  set_env_vals+=("$2")
}

if [ -n "$office_home" ]; then
  home_dir="$(full_path "$office_home")"; home_from='option'
elif [ -n "${AGENT_OFFICE_HOME:-}" ]; then
  home_dir="$(full_path "$AGENT_OFFICE_HOME")"; home_from='env'
else
  home_dir="$HOME/mx-office"; home_from='default'
fi
[ "$home_from" = env ] || set_env AGENT_OFFICE_HOME "$home_dir"
# New projects go into the office home unless AGENT_OFFICE_PROJECTS says otherwise.
[ -n "${AGENT_OFFICE_PROJECTS:-}" ] || set_env AGENT_OFFICE_PROJECTS "$home_dir"

if [ -n "$port" ]; then
  port_from='option'
elif [ -n "${PORT:-}" ] && [ "${PORT}" -eq "${PORT}" ] 2>/dev/null; then
  port="$PORT"; port_from='env'
else
  port=4600; port_from='default'
fi

# The browser's first-run setup asks what the terminal walkthrough would.
set_env AGENT_OFFICE_NO_WELCOME 1
set_env AGENT_OFFICE_LAUNCHER_LOOP 1
if [ "$no_browser" = 1 ] && [ -z "${AGENT_OFFICE_NO_OPEN:-}" ]; then set_env AGENT_OFFICE_NO_OPEN 1; fi

have_node=0
command -v node >/dev/null 2>&1 && have_node=1

# The office's own settings (not secret): the mxcli picked in first-run setup goes first on PATH.
settings_file="$home_dir/.agent-office/office-settings.json"
mxcli=''
path_add=''
if [ -f "$settings_file" ] && [ "$have_node" = 1 ]; then
  if mxcli="$(node -e 'try { const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); if (s && typeof s.mxcliPath === "string") process.stdout.write(s.mxcliPath); } catch (e) { process.stderr.write(String(e.message)); process.exit(1); }' "$settings_file" 2>/dev/null)"; then
    if [ -n "$mxcli" ]; then
      mxdir="$(dirname "$mxcli")"
      case ":$PATH:" in
        *":$mxdir:"*) ;;
        *) [ -d "$mxdir" ] && path_add="$mxdir" ;;
      esac
    fi
  else
    printf "warning: couldn't read %s; starting without it.\n" "$settings_file" >&2
    mxcli=''
  fi
fi

pass_args=()
[ "$port_from" = option ] && pass_args+=(--port "$port")
if [ ${#office_args[@]} -gt 0 ]; then
  for a in "${office_args[@]}"; do [ -n "$a" ] && [ "$a" != -- ] && pass_args+=("$a"); done
fi

needs_install=false
[ -d "$REPO/node_modules" ] || needs_install=true
needs_build=false
[ -f "$REPO/dist/server/server/cli.js" ] || needs_build=true

if [ "$dry_run" = 1 ]; then
  [ "$have_node" = 1 ] || die "Node.js isn't installed (or not on PATH): --dry-run prints its plan with it"
  # JSON through Node, so every path is quoted properly; the same fields start-office.ps1 -DryRun prints.
  env_json='{}'
  i=0
  while [ $i -lt ${#set_env_keys[@]} ]; do
    env_json="$(node -e 'const o = JSON.parse(process.argv[1]); o[process.argv[2]] = process.argv[3]; process.stdout.write(JSON.stringify(o))' "$env_json" "${set_env_keys[$i]}" "${set_env_vals[$i]}")"
    i=$((i + 1))
  done
  # shellcheck disable=SC2016 # JavaScript, not shell
  node -e '
    const [repo, officeHome, homeFrom, port, portFrom, needsInstall, needsBuild, mxcli, pathAdd, setEnv, restart, ...args] = process.argv.slice(1);
    console.log(JSON.stringify({
      repo, officeHome, homeFrom, port: Number(port), portFrom, url: `http://localhost:${port}`,
      entry: `${repo}/bin/agent-office.js`, needsInstall: needsInstall === "true", needsBuild: needsBuild === "true",
      mxcli: mxcli || null, pathAdd: pathAdd ? [pathAdd] : [], setEnv: JSON.parse(setEnv), officeArgs: args, restartExitCode: Number(restart),
    }, null, 2));
  ' "$REPO" "$home_dir" "$home_from" "$port" "$port_from" "$needs_install" "$needs_build" "$mxcli" "$path_add" "$env_json" "$RESTART_EXIT_CODE" ${pass_args[@]+"${pass_args[@]}"}
  exit 0
fi

# Node.js 22.5 or newer runs the office.
if [ "$have_node" != 1 ]; then
  die "Node.js isn't installed (or not on PATH). Install Node.js $NODE_MIN_MAJOR.$NODE_MIN_MINOR or newer (macOS: brew install node; or https://nodejs.org), then run this again."
fi
node_version="$(node -p 'process.versions.node')"
node_major="${node_version%%.*}"
node_rest="${node_version#*.}"
node_minor="${node_rest%%.*}"
if [ "$node_major" -lt "$NODE_MIN_MAJOR" ] || { [ "$node_major" -eq "$NODE_MIN_MAJOR" ] && [ "$node_minor" -lt "$NODE_MIN_MINOR" ]; }; then
  die "Node.js $node_version is too old: the office needs $NODE_MIN_MAJOR.$NODE_MIN_MINOR or newer (macOS: brew upgrade node)."
fi

url="http://localhost:$port"

open_url() {
  if [ "$(uname -s)" = Darwin ]; then open "$1" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$1" >/dev/null 2>&1 || true
  fi
}

office_up() {
  local body
  body="$(curl -fsS --max-time 3 "http://127.0.0.1:$port/api/health" 2>/dev/null)" || return 1
  printf '%s' "$body" | grep -Eq '"ok"[[:space:]]*:[[:space:]]*true'
}

port_taken() {
  node -e 'const s = require("net").connect(Number(process.argv[1]), "127.0.0.1"); s.setTimeout(800, () => process.exit(1)); s.on("connect", () => process.exit(0)); s.on("error", () => process.exit(1));' "$port"
}

# Already running here: just open it.
if office_up; then
  echo "Mx Office is already running at $url"
  [ "$no_browser" = 1 ] || open_url "$url/home"
  exit 0
fi
if port_taken; then
  die "Port $port is in use by another program. Start the office on another port: ./scripts/start-office.sh --port 4610"
fi

cd "$REPO" || die "can't go into $REPO"
if [ "$needs_install" = true ] && [ "$no_build" != 1 ]; then
  say 'npm install (first start of this checkout)'
  npm install || die "npm install failed (exit $?)"
fi
if [ "$needs_build" = true ] && [ "$no_build" != 1 ]; then
  say 'npm run build (no dist yet)'
  npm run build || die "npm run build failed (exit $?)"
fi
[ -f "$REPO/dist/server/server/cli.js" ] || die "The office isn't built: run npm install and npm run build in $REPO"

i=0
while [ $i -lt ${#set_env_keys[@]} ]; do
  export "${set_env_keys[$i]}=${set_env_vals[$i]}"
  i=$((i + 1))
done
[ -z "$path_add" ] || export PATH="$path_add:$PATH"

say "Mx Office: home $home_dir, $url"
while :; do
  node "$REPO/bin/agent-office.js" ${pass_args[@]+"${pass_args[@]}"}
  code=$?
  # Restarted: the pages reconnect by themselves, so no second browser window.
  if [ "$code" -eq "$RESTART_EXIT_CODE" ]; then
    export AGENT_OFFICE_NO_OPEN=1
    say 'Restarting Mx Office...'
    continue
  fi
  exit "$code"
done
