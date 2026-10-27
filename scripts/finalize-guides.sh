#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  cat <<'EOF'
Usage: scripts/finalize-guides.sh

Refresh the checksum manifest and run all output checks.

Run this after generating or intentionally editing a guide or flashcard deck.
The script refuses to bless a source change when no generated output changed,
which usually means the outputs were not regenerated.

For a manual check without updating the manifest, run the check scripts directly.
EOF
  exit 0
fi

if [ "$#" -gt 0 ]; then
  printf 'Usage: %s\n' "$0" >&2
  exit 1
fi

python3 - "$ROOT" <<'PY'
from pathlib import Path
import hashlib
import json
import sys

root = Path(sys.argv[1])
manifest_path = root / ".guide-manifest.json"
input_dir = root / "input"

output_paths = [
    "AssignmentGuide/assignment-guide.md",
    "StudyGuide/study-guide.md",
    "StudyGuide/study-guide-answers.md",
    "Flashcards/flashcards.md",
]


def digest(path: Path) -> str:
    hash = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hash.update(chunk)
    return hash.hexdigest()


def current_sources():
    return {
        str(path.relative_to(root)): digest(path)
        for path in sorted(input_dir.rglob("*"))
        if path.is_file() and path.name != "AGENTS.md"
    }


def current_outputs():
    return {
        relative: digest(root / relative) if (root / relative).exists() else None
        for relative in output_paths
    }


current_source_hashes = current_sources()
current_output_hashes = current_outputs()

if not manifest_path.exists():
    print("No manifest yet; creating one after content checks.")
    sys.exit(0)

try:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
except json.JSONDecodeError as error:
    print(f"Manifest is invalid: {error}", file=sys.stderr)
    sys.exit(1)

recorded_sources = manifest.get("sources", {})
recorded_outputs = manifest.get("outputs", {})

source_changes = [
    relative
    for relative in sorted(set(recorded_sources) | set(current_source_hashes))
    if recorded_sources.get(relative) != current_source_hashes.get(relative)
]
output_changes = [
    relative
    for relative in output_paths
    if recorded_outputs.get(relative, {}).get("hash")
    != current_output_hashes.get(relative)
]

if source_changes and not output_changes:
    print("Refusing to update the manifest.", file=sys.stderr)
    print("Source files changed but no generated output changed:", file=sys.stderr)
    for relative in source_changes:
        print(f"  - {relative}", file=sys.stderr)
    print("Regenerate the affected outputs, then re-run this script.", file=sys.stderr)
    sys.exit(1)

if source_changes:
    print("Source changes detected:")
    for relative in source_changes:
        print(f"  - {relative}")

if output_changes:
    print("Output changes detected:")
    for relative in output_changes:
        if current_output_hashes[relative] is None:
            print(f"  - {relative} (missing)")
        else:
            print(f"  - {relative}")
PY

scripts/check-guides.sh
scripts/check-coverage.sh
scripts/update-manifest.sh
scripts/check-stale.sh

printf '\nAll checks passed; manifest updated.\n'
