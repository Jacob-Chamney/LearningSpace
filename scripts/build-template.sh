#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-$ROOT/dist/LearningSpace-template}"
AUTHOR_NAME="${AUTHOR_NAME:-$(git -C "$ROOT" config user.name 2>/dev/null || true)}"

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

say() {
  printf '%s\n' "$*"
}

mkdir -p "$TARGET"
TARGET="$(cd "$TARGET" && pwd -P)"

if [ "$TARGET" = "$ROOT" ]; then
  die "template target must not be the workspace root"
fi

case "$TARGET/" in
  "$ROOT/"*)
    case "$TARGET/" in
      "$ROOT/dist/"*) ;;
      *) die "target inside the workspace must be under dist/" ;;
    esac
    ;;
esac

if [ -n "$(find "$TARGET" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
  die "template target is not empty: $TARGET"
fi

say "Building sanitized template in $TARGET..."

(
  cd "$ROOT"
  tar \
    --exclude='./.git' \
    --exclude='./dist' \
    --exclude='./input' \
    --exclude='./Memory' \
    --exclude='./AssignmentGuide/assignment-guide.md' \
    --exclude='./StudyGuide/study-guide.md' \
    --exclude='./StudyGuide/study-guide-answers.md' \
    --exclude='./Flashcards/flashcards.md' \
    --exclude='./.guide-manifest.json' \
    -cf - .
) | (
  cd "$TARGET"
  tar -xf -
)

mkdir -p "$TARGET/input"
cp "$ROOT/input/AGENTS.md" "$TARGET/input/AGENTS.md"

mkdir -p "$TARGET/Memory"
cp -R "$ROOT/template/Memory/." "$TARGET/Memory/"

mkdir -p "$TARGET/Memory/06 Templates"
cp -R "$ROOT/Memory/06 Templates/." "$TARGET/Memory/06 Templates/"

# Replace the configured author name, if the scaffold contains it.
python3 - "$TARGET" "$AUTHOR_NAME" <<'PY'
from pathlib import Path
import sys

root = Path(sys.argv[1])
author = sys.argv[2].strip()
if not author:
    sys.exit(0)

for path in root.rglob("*.md"):
    text = path.read_text(encoding="utf-8")
    updated = text.replace(f"{author}'s", "the user's").replace(author, "the user")
    if updated != text:
        path.write_text(updated, encoding="utf-8")
PY

say "Running the template smoke test..."
"$TARGET/test-install.sh"

say "Template ready: $TARGET"
say "Input: $TARGET/input"
say "Memory vault: $TARGET/Memory"
say "Distribute this directory, not your personal workspace."
