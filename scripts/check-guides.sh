#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

python3 - "$ROOT" <<'PY'
from pathlib import Path
import re
import shutil
import subprocess
import sys

root = Path(sys.argv[1])
files = [
    root / "AssignmentGuide" / "assignment-guide.md",
    root / "StudyGuide" / "study-guide.md",
    root / "StudyGuide" / "study-guide-answers.md",
    root / "Flashcards" / "flashcards.md",
]

input_sources = sorted(
    path
    for path in (root / "input").rglob("*")
    if path.is_file() and path.name != "AGENTS.md"
)
has_sources = bool(input_sources)
checked = []
skipped = []

errors = []

for path in files:
    if not path.exists():
        if has_sources:
            errors.append(f"{path}: missing")
        else:
            skipped.append(path)
        continue

    checked.append(path)

    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()

    if not lines or not lines[0].startswith("# "):
        errors.append(f"{path}: first line must be a level-1 title")

    in_fence = False
    for lineno, line in enumerate(lines, 1):
        if len(line) > 80:
            errors.append(f"{path}:{lineno}: line is {len(line)} columns")

        if line.strip().startswith("```"):
            in_fence = not in_fence
            continue

        if in_fence:
            continue

        if line.startswith("## "):
            errors.append(f"{path}:{lineno}: use bold numbered sections, not ##")
        if line.lstrip().startswith("|"):
            errors.append(f"{path}:{lineno}: Markdown table detected")
        if re.match(r"^\s*- \[[ xX]\]", line):
            errors.append(f"{path}:{lineno}: checkbox detected")
        if line.strip() == "---":
            errors.append(f"{path}:{lineno}: horizontal rule detected")
        if re.match(r"^  +\S", line):
            errors.append(f"{path}:{lineno}: nested or continued bullet line")

    if in_fence:
        errors.append(f"{path}: unclosed code fence")

    for lineno, line in enumerate(lines, 1):
        if not re.match(r"^\*\*\d+\) ", line):
            continue
        j = lineno - 2
        while j >= 0 and not lines[j].strip():
            j -= 1
        if j < 0 or lines[j].strip() != "&nbsp;":
            errors.append(
                f"{path}:{lineno}: numbered section needs a &nbsp; spacer above"
            )

    if not re.search(r"^\*\*\d+\) Source map\*\*$", text, re.MULTILINE):
        errors.append(f"{path}: missing numbered Source map section")

    if path.name != "study-guide-answers.md":
        if not re.search(r"^\*\*\d+\) Open questions\*\*$", text, re.MULTILINE):
            errors.append(f"{path}: missing numbered Open questions section")

    if shutil.which("glow"):
        result = subprocess.run(
            ["glow", "-w", "80", str(path)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
        )
        if result.returncode != 0:
            errors.append(f"{path}: glow failed: {result.stderr.strip()}")

if errors:
    print("Guide checks failed:")
    for error in errors:
        print(f"  - {error}")
    sys.exit(1)

if not checked and not errors:
    print("Guide checks passed: no input sources or generated guides yet.")
    sys.exit(0)

print("Guide checks passed:")
for path in checked:
    print(f"  - {path.relative_to(root)}")
for path in skipped:
    print(f"  - skipped (not generated yet): {path.relative_to(root)}")
PY
