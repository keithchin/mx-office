#!/usr/bin/env bash
# Builds the leave-approval benchmark baseline app from nothing (benchmark E3).
#   scripts/benchmark/baseline/build-baseline.sh <out-dir>
# Needs Studio Pro 11.12.4 (its mx.exe) and mxcli. Leaves a git repo with three commits in <out-dir>
# and prints its HEAD; bundle it with: git -C <out-dir> bundle create baseline.bundle --all
set -euo pipefail
OUT="${1:?usage: build-baseline.sh <out-dir>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
MX="${MX:-/c/Program Files/Mendix/11.12.4/modeler/mx.exe}"
MXCLI="${MXCLI:-/c/Users/z00556et/agent-spike/tools/mxcli/mxcli.exe}"
MXBUILD="${MXBUILD:-C:\Program Files\Mendix\11.12.4\modeler\mxbuild.exe}"
[ -e "$OUT" ] && { echo "$OUT exists: pick a fresh folder" >&2; exit 2; }

"$MX" create-project --app-name LeaveBaseline --output-dir "$(cygpath -w "$OUT" 2>/dev/null || echo "$OUT")"
cd "$OUT"
cp "$HERE/gitignore" .gitignore
git init -q -b main
git -c core.longpaths=true -c core.safecrlf=false add -A
git -c core.safecrlf=false commit -qm "Blank Mendix 11.12.4 app (mx create-project)"

"$MXCLI" exec "$HERE/01-domain.mdl" -p LeaveBaseline.mpr
"$MXCLI" exec "$HERE/02-security-seed-ui.mdl" -p LeaveBaseline.mpr
"$MX" check LeaveBaseline.mpr
git -c core.safecrlf=false add -A
git -c core.safecrlf=false commit -qm "Benchmark baseline: HR + Notices modules, roles, test identities, seed, pages"

# One build settles the generated JavaScript/Java action stubs; without it every fresh clone's
# first build dirties ~50 files. mxbuild exit 0 + no errors file = clean.
"$MXBUILD" --target=deploy --write-errors="$(pwd)/.mxbuild-errors.json" LeaveBaseline.mpr < /dev/null
rm -f .mxbuild-errors.json
git -c core.safecrlf=false add -A
git -c core.safecrlf=false commit -qm "Settle generated action stubs after the first build" || true
git rev-parse HEAD
