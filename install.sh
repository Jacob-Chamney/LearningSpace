#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_TARGET="$HOME/LearningSpace"

TARGET=""
ASSUME_YES=false
INSTALL_OPENCODE="ask"
INSTALL_GLOW="ask"
SKIP_HOOKS=false
SKIP_CHECKS=false
SKIP_DEPS=false

say() {
  printf '%s\n' "$*"
}

warn() {
  printf 'Warning: %s\n' "$*" >&2
}

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
LearningSpace installer

Usage:
  ./install.sh [options]

Options:
  --target DIR      Install the workspace in DIR (default prompt: ~/LearningSpace)
  -y, --yes         Accept defaults and skip confirmation prompts
  --no-opencode     Do not install OpenCode if it is missing
  --no-glow         Do not install Glow
  --skip-deps       Do not install missing system tools
  --skip-hooks      Do not initialize Git or install the pre-commit hook
  --skip-checks     Do not run the guide and stale checks after setup
  -h, --help        Show this help

The installer copies this workspace into the target directory when the target
is different from the directory containing this script. It never overwrites a
non-empty target directory.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --target)
      [ "$#" -ge 2 ] || die "--target needs a directory"
      TARGET="$2"
      shift 2
      ;;
    -y|--yes)
      ASSUME_YES=true
      shift
      ;;
    --no-opencode)
      INSTALL_OPENCODE=false
      shift
      ;;
    --no-glow)
      INSTALL_GLOW=false
      shift
      ;;
    --skip-hooks)
      SKIP_HOOKS=true
      shift
      ;;
    --skip-checks)
      SKIP_CHECKS=true
      shift
      ;;
    --skip-deps)
      SKIP_DEPS=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
done

[ -f "$SOURCE_DIR/AGENTS.md" ] || die "run this script from the workspace root"

ask_yes_no() {
  local prompt="$1"
  local default="$2"
  local answer=""

  if [ "$ASSUME_YES" = true ]; then
    answer="$default"
  else
    printf '%s ' "$prompt"
    if [ -r /dev/tty ]; then
      read -r answer < /dev/tty || answer=""
    else
      read -r answer || answer=""
    fi
    answer="${answer:-$default}"
  fi

  case "$answer" in
    y|Y|yes|YES|Yes) return 0 ;;
    *) return 1 ;;
  esac
}

expand_path() {
  case "$1" in
    "~") printf '%s\n' "$HOME" ;;
    "~/"*) printf '%s\n' "$HOME/${1#\~/}" ;;
    *) printf '%s\n' "$1" ;;
  esac
}

detect_package_manager() {
  if command -v brew >/dev/null 2>&1; then
    printf '%s\n' brew
  elif command -v apt-get >/dev/null 2>&1; then
    printf '%s\n' apt
  elif command -v dnf >/dev/null 2>&1; then
    printf '%s\n' dnf
  elif command -v pacman >/dev/null 2>&1; then
    printf '%s\n' pacman
  else
    printf '%s\n' none
  fi
}

PKG_MANAGER="$(detect_package_manager)"

run_as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

install_packages() {
  case "$PKG_MANAGER" in
    brew)
      brew install "$@"
      ;;
    apt)
      run_as_root apt-get update
      run_as_root apt-get install -y "$@"
      ;;
    dnf)
      run_as_root dnf install -y "$@"
      ;;
    pacman)
      run_as_root pacman -S --noconfirm "$@"
      ;;
    *)
      return 1
      ;;
  esac
}

package_name_for() {
  case "$1" in
    python3)
      case "$PKG_MANAGER" in
        brew|pacman) printf '%s\n' python ;;
        *) printf '%s\n' python3 ;;
      esac
      ;;
    *)
      printf '%s\n' "$1"
      ;;
  esac
}

missing_required() {
  local missing=""
  local command

  for command in git python3 tar; do
    if ! command -v "$command" >/dev/null 2>&1; then
      missing="$missing $command"
    fi
  done

  printf '%s\n' "$missing"
}

install_required() {
  local missing
  local packages=""
  local command

  missing="$(missing_required)"
  [ -n "$missing" ] || return 0

  warn "missing required tools:$missing"

  if [ "$SKIP_DEPS" = true ]; then
    die "missing required tools:$missing (dependency installation skipped)"
  fi

  if [ "$PKG_MANAGER" = none ]; then
    die "install these tools with your system package manager, then re-run"
  fi

  if ! ask_yes_no "Install missing tools with $PKG_MANAGER? [Y/n]" yes; then
    die "missing required tools:$missing"
  fi

  for command in $missing; do
    packages="$packages $(package_name_for "$command")"
  done

  say "Installing:$packages"
  # shellcheck disable=SC2086
  install_packages $packages

  missing="$(missing_required)"
  [ -z "$missing" ] || die "still missing required tools:$missing"
}

install_opencode_if_needed() {
  local version

  if command -v opencode >/dev/null 2>&1; then
    version="$(opencode --version 2>/dev/null || printf 'unknown')"
    say "OpenCode: $version"
    case "$version" in
      1.*|v1.*)
        warn "OpenCode 1 detected. This workspace is tested with OpenCode 2."
        warn "Upgrade with: opencode upgrade --major"
        ;;
    esac
    return 0
  fi

  [ "$INSTALL_OPENCODE" = false ] && return 0

  if ! ask_yes_no "OpenCode is not installed. Install OpenCode 2 now? [Y/n]" yes; then
    warn "OpenCode was not installed. Install it before running the workspace."
    return 0
  fi

  command -v curl >/dev/null 2>&1 || die "curl is required to install OpenCode"

  say "Installing OpenCode 2..."
  if [ -n "${OPENCODE_VERSION:-}" ]; then
    if ! curl -fsSL https://opencode.ai/v2/install | bash -s -- --version "$OPENCODE_VERSION"; then
      die "OpenCode installation failed"
    fi
  else
    if ! curl -fsSL https://opencode.ai/v2/install | bash; then
      die "OpenCode installation failed"
    fi
  fi

  export PATH="$HOME/.opencode/bin:$PATH"
  hash -r || true

  command -v opencode >/dev/null 2>&1 || die "OpenCode was installed but is not on PATH"
  say "OpenCode: $(opencode --version 2>/dev/null || printf 'installed')"
}

install_glow_if_requested() {
  [ "$INSTALL_GLOW" = false ] && return 0

  if command -v glow >/dev/null 2>&1; then
    say "Glow: $(glow --version 2>/dev/null | head -n 1 || printf 'installed')"
    return 0
  fi

  if ! ask_yes_no "Glow is optional. Install it for preview checks? [y/N]" no; then
    return 0
  fi

  say "Installing Glow..."
  case "$PKG_MANAGER" in
    brew)
      if brew install glow; then return 0; fi
      ;;
    apt)
      if run_as_root apt-get update && run_as_root apt-get install -y glow; then
        return 0
      fi
      ;;
    dnf)
      if run_as_root dnf install -y glow; then return 0; fi
      ;;
    pacman)
      if run_as_root pacman -S --noconfirm glow; then return 0; fi
      ;;
  esac

  if command -v go >/dev/null 2>&1; then
    if go install github.com/charmbracelet/glow@latest; then
      export PATH="$(go env GOPATH)/bin:$PATH"
      hash -r || true
      command -v glow >/dev/null 2>&1 && return 0
    fi
  fi

  warn "Glow could not be installed automatically."
  warn "Install it from https://github.com/charmbracelet/glow, or skip it."
}

choose_target() {
  local input_target

  if [ -z "$TARGET" ]; then
    if [ "$ASSUME_YES" = true ]; then
      TARGET="$DEFAULT_TARGET"
    else
      printf 'Project directory [%s]: ' "$DEFAULT_TARGET"
      if [ -r /dev/tty ]; then
        read -r input_target < /dev/tty || input_target=""
      else
        read -r input_target || input_target=""
      fi
      TARGET="${input_target:-$DEFAULT_TARGET}"
    fi
  fi

  TARGET="$(expand_path "$TARGET")"
  mkdir -p "$TARGET"
  TARGET="$(cd "$TARGET" && pwd -P)"
}

copy_workspace() {
  if [ "$TARGET" = "$SOURCE_DIR" ]; then
    say "Using workspace in place: $TARGET"
    return 0
  fi

  case "$TARGET/" in
    "$SOURCE_DIR/"*)
      die "target must not be inside the source workspace"
      ;;
  esac

  if [ -n "$(find "$TARGET" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
    die "target is not empty: $TARGET"
  fi

  say "Copying workspace to $TARGET..."
  (
    cd "$SOURCE_DIR"
    tar \
      --exclude='./.git' \
      --exclude='./Memory/.obsidian' \
      --exclude='./.DS_Store' \
      -cf - .
  ) | (
    cd "$TARGET"
    tar -xf -
  )
}

configure_hooks() {
  [ "$SKIP_HOOKS" = true ] && return 0

  if [ ! -d "$TARGET/.git" ]; then
    if ! ask_yes_no "Initialize Git and enable the pre-commit checks? [Y/n]" yes; then
      warn "Skipping Git hook setup."
      return 0
    fi
    git -C "$TARGET" init -q
  fi

  "$TARGET/scripts/install-hooks.sh"
}

install_plugins() {
  local plugin="$TARGET/.opencode/plugins/memory/index.ts"

  [ -f "$plugin" ] || die "memory plugin is missing: $plugin"

  say "OpenCode plugin: memory-vault"
  say "  - bundled at .opencode/plugins/memory/index.ts"
  say "  - writes session notes to Memory/04 Sessions"
  say "  - skips StudyGuide/ and Flashcards/"
  say "No external plugins or MCP servers are required."
}

run_checks() {
  [ "$SKIP_CHECKS" = true ] && return 0

  say "Running workspace checks..."
  if ! (cd "$TARGET" && scripts/check-guides.sh); then
    warn "Guide checks failed. Regenerate the affected outputs and rerun the checks."
  fi
  if ! (cd "$TARGET" && scripts/check-stale.sh); then
    warn "Stale-output checks failed. Regenerate the affected outputs."
  fi
  if ! (cd "$TARGET" && scripts/check-coverage.sh); then
    warn "Source coverage checks failed. Add the missing sources to the guides."
  fi
}

say "LearningSpace installer"
say "Source: $SOURCE_DIR"

choose_target
install_required
install_opencode_if_needed
install_glow_if_requested
copy_workspace
install_plugins
configure_hooks
run_checks

cat <<EOF

Setup complete.

Project directory:
  $TARGET

Next:
  cd "$TARGET"
  opencode
  /connect

Use /connect to choose a provider and add an API key.

Then add the current course files to input/ and run:
  "generate assignment guide"
  "generate study guide"
  "generate flashcards"

Read README.md for the OpenCode and memory-vault setup details.
EOF
