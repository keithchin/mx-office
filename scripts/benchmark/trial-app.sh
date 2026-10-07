#!/usr/bin/env bash
# One benchmark trial's runtime, the way the office's live app runs it (src/server/liveapp/app.ts),
# with every machine-specific input pinned instead of inherited (benchmark E3).
#
#   trial-app.sh reset <bundle> <dir>                  fresh clone of the baseline bundle into <dir>
#   trial-app.sh start <dir> <db-name> <first-port>    mxcli run --local on ports N, N+1, N+2 and a NEW database
#   trial-app.sh oql   <dir> "<OQL>"                   read persisted state through the runtime's admin API
#   trial-app.sh stop  <dir>                           end the mxcli tree (pid from .mxcli/run-local.json)
#   trial-app.sh drop  <db-name>                       drop the trial database
#
# Environment: MXCLI, MXBUILD_PATH (Studio Pro 11.12.4's mxbuild.exe: an ambient MXBUILD_PATH for
# another version breaks the build), PG_BIN, PGHOST/PGPORT/PGUSER/PGPASSWORD. Keep first ports out of
# the office's live-app range (8110-8199 by default) and never use 4600.
set -euo pipefail
MXCLI="${MXCLI:-/c/Users/z00556et/agent-spike/tools/mxcli/mxcli.exe}"
export MXBUILD_PATH="${BENCH_MXBUILD_PATH:-C:\Program Files\Mendix\11.12.4\modeler\mxbuild.exe}"
PG_BIN="${PG_BIN:-/c/Program Files/PostgreSQL/18/bin}"
PGHOST="${PGHOST:-127.0.0.1}"; PGPORT="${PGPORT:-5432}"; PGUSER="${PGUSER:-postgres}"; export PGPASSWORD="${PGPASSWORD:-postgres}"
export PATH="$PATH:$PG_BIN"

pid_of() { node -e "try{console.log(require(process.argv[1]).pid)}catch{}" "$(cd "$1" && pwd -W 2>/dev/null || pwd)/.mxcli/run-local.json"; }

case "${1:-}" in
  reset)
    bundle="${2:?bundle}"; dir="${3:?dir}"
    [ -e "$dir" ] && { echo "$dir exists: every trial gets a fresh folder" >&2; exit 2; }
    git -c core.longpaths=true clone -q "$bundle" "$dir"
    git -C "$dir" remote remove origin
    git -C "$dir" rev-parse HEAD ;;
  start)
    dir="${2:?dir}"; db="${3:?db-name}"; p="${4:?first-port}"
    case "$p" in 4600|459[89]|4601|4602) echo "not near the office's port" >&2; exit 2 ;; esac
    if "$PG_BIN/psql.exe" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -Atc "select 1 from pg_database where datname='$db'" | grep -q 1; then
      echo "database $db already exists: a trial needs a fresh one" >&2; exit 2
    fi
    cd "$dir"; mkdir -p .mxcli
    mpr="$(ls *.mpr | head -1)"
    start=$(date +%s)
    "$MXCLI" run --local -p "$mpr" --mxbuild-path "$MXBUILD_PATH" \
      --app-port "$p" --admin-port $((p + 1)) --serve-port $((p + 2)) \
      --db-host "$PGHOST:$PGPORT" --db-user "$PGUSER" --db-password "$PGPASSWORD" --db-name "$db" --ensure-db \
      > .mxcli/run-console.log 2>&1 &
    for _ in $(seq 1 120); do
      code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$p/" || true)
      case "$code" in 2*|3*) echo "up on http://127.0.0.1:$p/ after $(( $(date +%s) - start ))s"; exit 0 ;; esac
      grep -q "^Error" .mxcli/run-console.log && { tail -5 .mxcli/run-console.log >&2; exit 1; }
      sleep 5
    done
    echo "not up after 10 min" >&2; exit 1 ;;
  oql)
    dir="${2:?dir}"; q="${3:?query}"
    read -r port tok < <(node -e "const j=require(process.argv[1]);console.log(j.adminPort, j.adminPass)" "$(cd "$dir" && pwd -W 2>/dev/null || pwd)/.mxcli/run-local.json")
    "$MXCLI" oql --direct --host 127.0.0.1 --port "$port" --token "$tok" --json "$q" | grep -v '^Using project' ;;
  stop)
    dir="${2:?dir}"; pid="$(pid_of "$dir")"
    [ -n "$pid" ] && taskkill //PID "$pid" //T //F >/dev/null 2>&1 || true
    echo "stopped ${pid:-nothing}" ;;
  drop)
    "$PG_BIN/dropdb.exe" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" --if-exists "${2:?db-name}" ;;
  *) sed -n 2,14p "$0"; exit 2 ;;
esac
