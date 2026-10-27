#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER="$SOURCE_DIR/install.sh"

KEEP_TEMP=false
if [ "${1:-}" = "--keep" ]; then
  KEEP_TEMP=true
elif [ "$#" -gt 0 ]; then
  printf 'Usage: %s [--keep]\n' "$0" >&2
  exit 1
fi

die() {
  printf 'Test failed: %s\n' "$*" >&2
  exit 1
}

say() {
  printf '%s\n' "$*"
}

[ -f "$INSTALLER" ] || die "install.sh not found at $INSTALLER"

BASE="${TMPDIR:-/tmp}/opencode"
mkdir -p "$BASE"
TEST_ROOT="$(mktemp -d "$BASE/learning-space-test.XXXXXX")"
TARGET="$TEST_ROOT/workspace"

cleanup() {
  local status=$?
  trap - EXIT
  if [ "$KEEP_TEMP" = true ]; then
    say "Temporary workspace kept at: $TEST_ROOT"
  else
    rm -rf "$TEST_ROOT"
  fi
  exit "$status"
}
trap cleanup EXIT

SOURCE_STATUS_BEFORE=""
if git -C "$SOURCE_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  SOURCE_STATUS_BEFORE="$(git -C "$SOURCE_DIR" status --porcelain)"
fi

say "Checking installer syntax..."
bash -n "$INSTALLER"

say "Checking installer help..."
"$INSTALLER" --help >/dev/null

say "Running installer in an isolated workspace..."
"$INSTALLER" \
  --target "$TARGET" \
  --no-opencode \
  --no-glow \
  --skip-deps \
  --no-command \
  --yes

say "Verifying copied workspace..."
for relative in \
  AGENTS.md \
  install.sh \
  test-install.sh \
  input/AGENTS.md \
  AssignmentGuide/AGENTS.md \
  StudyGuide/AGENTS.md \
  Flashcards/AGENTS.md \
  Memory/AGENTS.md \
  .opencode/plugins/memory/index.ts; do
  [ -e "$TARGET/$relative" ] || die "missing copied file: $relative"
done

[ ! -e "$TARGET/Memory/.obsidian" ] ||
  die "personal Memory/.obsidian was copied into the test workspace"

say "Verifying Git hook..."
[ -x "$TARGET/.githooks/pre-commit" ] || die "pre-commit hook is not executable"
[ "$(git -C "$TARGET" config --get core.hooksPath)" = ".githooks" ] ||
  die "core.hooksPath was not set in the test workspace"

say "Running the pre-commit hook in the test workspace..."
(cd "$TARGET" && ./.githooks/pre-commit)

say "Checking that the source workspace was not modified..."
if git -C "$SOURCE_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  SOURCE_STATUS_AFTER="$(git -C "$SOURCE_DIR" status --porcelain)"
  [ "$SOURCE_STATUS_BEFORE" = "$SOURCE_STATUS_AFTER" ] ||
    die "source workspace changed during the test"
fi

say "Installer smoke test passed."
say "No OpenCode, Glow, or system packages were installed."
say "No files were changed outside the temporary workspace."
