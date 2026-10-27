#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

python3 - "$ROOT" <<'PY'
from pathlib import Path
import hashlib
import json
import sys

root = Path(sys.argv[1])
input_dir = root / "input"
manifest_path = root / ".guide-manifest.json"

output_specs = [
    ("AssignmentGuide/assignment-guide.md", []),
    ("StudyGuide/study-guide.md", []),
    (
        "StudyGuide/study-guide-answers.md",
        ["StudyGuide/study-guide.md"],
    ),
    (
        "Flashcards/flashcards.md",
        [
            "StudyGuide/study-guide.md",
            "StudyGuide/study-guide-answers.md",
        ],
    ),
    ("Flashcards/flashcards.html", ["Flashcards/flashcards.md"]),
]


def digest(path: Path) -> str:
    hash = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hash.update(chunk)
    return hash.hexdigest()


sources = sorted(
    path
    for path in input_dir.rglob("*")
    if path.is_file() and path.name != "AGENTS.md"
)
existing_outputs = [
    root / relative for relative, _ in output_specs if (root / relative).exists()
]

errors = []

if not sources:
    if existing_outputs:
        errors.append(
            "input/ has no sources but generated outputs still exist; "
            "clear them or restore the source set"
        )
    else:
        print("Stale output check passed: no input sources yet.")
        sys.exit(0)

if sources:
    if not manifest_path.exists():
        errors.append(
            ".guide-manifest.json is missing; run scripts/update-manifest.sh"
        )
    else:
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            errors.append(f".guide-manifest.json is invalid: {error}")
            manifest = None

        if manifest is not None:
            recorded_sources = manifest.get("sources", {})
            current_sources = {
                str(path.relative_to(root)): digest(path)
                for path in sources
            }

            for relative in sorted(set(recorded_sources) | set(current_sources)):
                if relative not in current_sources:
                    errors.append(f"source removed: {relative}")
                elif relative not in recorded_sources:
                    errors.append(f"source added: {relative}")
                elif recorded_sources[relative] != current_sources[relative]:
                    errors.append(f"source changed: {relative}")

            recorded_outputs = manifest.get("outputs", {})
            for relative, dependencies in output_specs:
                output = root / relative
                if not output.exists():
                    errors.append(f"output missing: {relative}")
                    continue

                recorded = recorded_outputs.get(relative)
                if not isinstance(recorded, dict):
                    errors.append(f"manifest entry missing: {relative}")
                    continue

                if recorded.get("hash") != digest(output):
                    errors.append(f"output changed: {relative}")

                for dependency in dependencies:
                    dependency_path = root / dependency
                    if not dependency_path.exists():
                        errors.append(
                            f"{relative}: dependency missing: {dependency}"
                        )
                        continue

                    dependency_record = recorded_outputs.get(dependency)
                    if not isinstance(dependency_record, dict):
                        errors.append(
                            f"{relative}: dependency not in manifest: {dependency}"
                        )
                    elif dependency_record.get("hash") != digest(dependency_path):
                        errors.append(
                            f"{relative}: dependency changed: {dependency}"
                        )

if errors:
    print("Stale output check failed:")
    for error in errors:
        print(f"  - {error}")
    print("Regenerate the affected output, then run scripts/update-manifest.sh.")
    sys.exit(1)

print("Stale output check passed:")
print(f"  - sources: {len(sources)}")
print(f"  - manifest: {manifest_path.relative_to(root)}")
for relative, _ in output_specs:
    print(f"  - {relative}")
PY
