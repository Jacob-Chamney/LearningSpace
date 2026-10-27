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
manifest = root / ".guide-manifest.json"

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

data = {
    "version": 1,
    "sources": {
        str(path.relative_to(root)): digest(path)
        for path in sources
    },
    "outputs": {},
}

for relative, dependencies in output_specs:
    path = root / relative
    if not path.exists():
        continue

    data["outputs"][relative] = {
        "hash": digest(path),
        "dependencies": dependencies,
    }

manifest.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
print(f"Updated {manifest.relative_to(root)}")
print(f"  - sources: {len(data['sources'])}")
print(f"  - outputs: {len(data['outputs'])}")
PY
