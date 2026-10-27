#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

python3 - "$ROOT" <<'PY'
from pathlib import Path
import sys

root = Path(sys.argv[1])
input_dir = root / "input"
study_guide = root / "StudyGuide" / "study-guide.md"
assignment_guide = root / "AssignmentGuide" / "assignment-guide.md"

sources = sorted(
    path
    for path in input_dir.rglob("*")
    if path.is_file() and path.name != "AGENTS.md"
)

if not sources:
    print("Source coverage check passed: no input sources yet.")
    sys.exit(0)

errors = []
lectures = [
    path for path in sources if path.name != "assignmentGoal.txt"
]

if not study_guide.exists():
    errors.append("StudyGuide/study-guide.md is missing")
else:
    text = study_guide.read_text(encoding="utf-8")
    for path in lectures:
        if path.name not in text:
            errors.append(
                f"StudyGuide/study-guide.md does not mention {path.name}"
            )

if any(path.name == "assignmentGoal.txt" for path in sources):
    if not assignment_guide.exists():
        errors.append("AssignmentGuide/assignment-guide.md is missing")
    elif "assignmentGoal.txt" not in assignment_guide.read_text(encoding="utf-8"):
        errors.append(
            "AssignmentGuide/assignment-guide.md does not mention "
            "assignmentGoal.txt"
        )

if errors:
    print("Source coverage check failed:")
    for error in errors:
        print(f"  - {error}")
    sys.exit(1)

print("Source coverage check passed:")
print(f"  - input sources: {len(sources)}")
print(f"  - lecture sources: {len(lectures)}")
PY
