#!/usr/bin/env bash
# Puts a "Mx Office" launcher in ~/Applications (Finder, Launchpad and Spotlight find it there) that runs
# scripts/start-office.sh from this checkout in a Terminal window (it starts the office, or opens it when
# it's already running): the macOS twin of install-shortcut.ps1. Run it once:
#
#   ./scripts/install-shortcut.sh
#   ./scripts/install-shortcut.sh --office-home ~/office2 --port 4610   # passed on to start-office.sh
#   ./scripts/install-shortcut.sh --desktop                              # on the Desktop too
#   ./scripts/install-shortcut.sh --remove                               # take them away again
#
# The launcher is a .command file: a shell script Finder opens in Terminal. Closing that window stops the
# office (as closing the PowerShell window does on Windows); the desktop app keeps it running in the
# menu bar instead. --dry-run prints what it would write and writes nothing; --destination <folder>
# writes there instead (tests).

set -eu

name='Mx Office'
repo="$(cd "$(dirname "$0")/.." && pwd)"
launcher="$repo/scripts/start-office.sh"
office_home=''
port=''
desktop=0
remove=0
dry_run=0
destination=''

while [ $# -gt 0 ]; do
  case "$1" in
    --office-home | --home) office_home="$2"; shift 2 ;;
    --port) port="$2"; shift 2 ;;
    --desktop) desktop=1; shift ;;
    --remove) remove=1; shift ;;
    --dry-run) dry_run=1; shift ;;
    --destination) destination="$2"; shift 2 ;;
    -h | --help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "install-shortcut: unknown option $1" >&2; exit 2 ;;
  esac
done

dirs=()
if [ -n "$destination" ]; then
  dirs+=("$destination")
else
  dirs+=("$HOME/Applications")
  [ "$desktop" = 1 ] && dirs+=("$HOME/Desktop")
fi

# The command line the launcher runs, every argument quoted for bash.
cmd="exec bash $(printf '%q' "$launcher")"
[ -z "$office_home" ] || cmd="$cmd --office-home $(printf '%q' "$office_home")"
[ -z "$port" ] || cmd="$cmd --port $(printf '%q' "$port")"

body="#!/bin/bash
# Mx Office: starts the office from $repo (scripts/install-shortcut.sh made this; run it with --remove to take it away).
$cmd
"

for d in "${dirs[@]}"; do
  file="$d/$name.command"
  if [ "$remove" = 1 ]; then
    if [ "$dry_run" = 1 ]; then echo "would remove $file"; elif [ -f "$file" ]; then rm -f "$file" && echo "Removed $file"; fi
    continue
  fi
  if [ "$dry_run" = 1 ]; then
    printf 'would write %s:\n%s\n' "$file" "$body"
    continue
  fi
  mkdir -p "$d"
  printf '%s' "$body" >"$file"
  chmod 755 "$file"
  echo "Wrote $file"
done
[ "$remove" = 1 ] || [ "$dry_run" = 1 ] || echo "Open \"$name\" from Finder > Applications (or Spotlight) to start the office."
