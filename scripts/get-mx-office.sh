#!/usr/bin/env bash
# Get Mx Office in one line on macOS (README > Get Mx Office on macOS); Linux works too:
#
#   curl -fsSL https://raw.githubusercontent.com/keithchin/mx-office/main/scripts/get-mx-office.sh | bash
#
# Checks for Git and Node.js 22.5 or newer (offering to install them with Homebrew: brew install git
# node), clones the office into ~/mx-office-app (or pulls it when it's already there, so running it
# twice is safe), installs and builds it, then starts it with scripts/start-office.sh, which opens
# First-run setup in your browser. Set MX_OFFICE_DIR first for another folder. Nothing is installed
# without asking (MX_OFFICE_YES=1 answers yes for you, for a script; with no terminal to ask on and no
# MX_OFFICE_YES, nothing is installed). It never installs Homebrew itself: that's yours to run from
# https://brew.sh. Runs in macOS's own bash 3.2.

set -eu

repo='https://github.com/keithchin/mx-office.git'
dir="${MX_OFFICE_DIR:-$HOME/mx-office-app}"
node_min_major=22
node_min_minor=5
mac=0
[ "$(uname -s)" = Darwin ] && mac=1

die() {
  printf 'get-mx-office: %s\n' "$*" >&2
  exit 1
}

# A yes/no question, asked on the terminal (piped into bash, stdin is this script, so never read from it).
ask() {
  local answer=''
  if [ "${MX_OFFICE_YES:-}" = 1 ]; then
    printf '%s [Y/n] y (MX_OFFICE_YES=1)\n' "$1"
    return 0
  fi
  if ! { : </dev/tty; } 2>/dev/null; then
    printf '%s\n  (no terminal to ask on: not installing; run this in a terminal, or set MX_OFFICE_YES=1)\n' "$1"
    return 1
  fi
  printf '%s [Y/n] ' "$1"
  read -r answer </dev/tty || answer=n
  case "$answer" in [nN]*) return 1 ;; *) return 0 ;; esac
}

# Homebrew, from where it usually is even when this shell's PATH doesn't have it yet.
find_brew() {
  if command -v brew >/dev/null 2>&1; then command -v brew; return 0; fi
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [ -x "$b" ]; then printf '%s' "$b"; return 0; fi
  done
  return 1
}

# Installs Homebrew formulae after asking; on Linux, says what to type instead.
brew_install() {
  local what="$1"
  shift
  if [ "$mac" != 1 ]; then
    die "$what isn't installed. Install it with your package manager (e.g. sudo apt install $*; Node.js 22: see nodejs.org), then run this again."
  fi
  local brew
  if ! brew="$(find_brew)"; then
    die "$what isn't installed, and neither is Homebrew. Install Homebrew from https://brew.sh (it explains each step), then run this again; or install $what yourself."
  fi
  if ! ask "$what isn't installed (or too old). Install it now with Homebrew (brew install $*)?"; then
    die "Mx Office needs $what."
  fi
  "$brew" install "$@"
  # The new program's folder, without opening a new terminal.
  eval "$("$brew" shellenv)"
  hash -r
}

git_ok() { command -v git >/dev/null 2>&1 && git --version >/dev/null 2>&1; }

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local v major rest minor
  v="$(node -p 'process.versions.node' 2>/dev/null)" || return 1
  major="${v%%.*}"
  rest="${v#*.}"
  minor="${rest%%.*}"
  [ "$major" -gt "$node_min_major" ] || { [ "$major" -eq "$node_min_major" ] && [ "$minor" -ge "$node_min_minor" ]; }
}

# On a Mac, /usr/bin/git is a stand-in until the Command Line Tools are installed: --version fails then.
git_ok || brew_install Git git
git_ok || die "git was installed but doesn't answer yet: open a new terminal and run this again."
node_ok || brew_install "Node.js $node_min_major.$node_min_minor or newer" node
node_ok || die "Node.js $node_min_major.$node_min_minor or newer isn't on PATH yet (an older one is first?): open a new terminal and run this again."

# Nice to have before First-run setup (it can install gh and jq too, but not a newer bash): asked once.
if [ "$mac" = 1 ] && brew="$(find_brew)"; then
  extras=''
  command -v gh >/dev/null 2>&1 || extras="$extras gh"
  command -v jq >/dev/null 2>&1 || extras="$extras jq"
  [ -x /opt/homebrew/bin/bash ] || [ -x /usr/local/bin/bash ] || extras="$extras bash"
  if [ -n "$extras" ]; then
    # shellcheck disable=SC2086 # the formula names are words on purpose
    if ask "Also install what the projects' toolkit uses (brew install$extras; bash because macOS's own is 3.2)?"; then "$brew" install $extras || echo "brew couldn't install all of them: First-run setup will say what's missing."; fi
  fi
fi

if [ -d "$dir/.git" ]; then
  echo "Mx Office is already in $dir: updating it (git pull)"
  git -C "$dir" pull --ff-only || die 'git failed (see above).'
else
  echo "Cloning Mx Office into $dir"
  git clone "$repo" "$dir" || die 'git failed (see above).'
fi

cd "$dir"
npm ci || die 'npm ci failed (see above).'
npm run build || die 'npm run build failed (see above).'

echo 'Starting Mx Office: it opens First-run setup in your browser. Later, start it again with:'
echo "  bash \"$dir/scripts/start-office.sh\""
echo "(or run bash \"$dir/scripts/install-shortcut.sh\" once for a Mx Office icon in ~/Applications)"
# The office reads nothing from stdin, but give it the terminal rather than the rest of a piped script.
if { : </dev/tty; } 2>/dev/null; then
  exec bash "$dir/scripts/start-office.sh" "$@" </dev/tty
fi
exec bash "$dir/scripts/start-office.sh" "$@"
