# LearningSpace

This file applies to this directory and everything below it. It routes work
by folder.

## Folder map

- `input/` - one source set: `assignmentGoal.txt` plus lecture decks and docs.
- `AssignmentGuide/` - generated assignment guide and tutor instructions.
- `StudyGuide/` - generated study guide and answer key.
- `Flashcards/` - generated flashcards from the study guide.
- `Memory/` - coding memory vault. Follow `Memory/AGENTS.md`.
- `scripts/` - guide, freshness, coverage, and release checks.
- `template/` - sanitized memory-vault skeleton for releases.
- `.githooks/` - Git pre-commit hook.
- `install.sh` - interactive installer for end users.
- `test-install.sh` - safe smoke test for the installer.
- `.guide-manifest.json` - checksum state for generated outputs.
- `README.md` - setup, OpenCode plugin, and reproducibility notes.
- `LICENSE` - MIT license.
- `opencode.jsonc` - OpenCode project config.
- `.opencode/plugins/memory/` - automatic memory capture plugin.

## Working rules

- Before working in a folder, read that folder's `AGENTS.md` if it exists.
- Treat `input/` as the single source drop folder. Do not edit its documents.
- `AssignmentGuide/` reads `input/assignmentGoal.txt` plus relevant input lectures
  and memory. It produces `AssignmentGuide/assignment-guide.md`.
- `StudyGuide/` reads only the lecture material in `input/`. It does not use
  the memory vault. It produces `StudyGuide/study-guide.md` and
  `StudyGuide/study-guide-answers.md`.
- `Flashcards/` reads `StudyGuide/study-guide.md` (and its answer key when
  needed). It produces `Flashcards/flashcards.md`.
- Say "generate assignment guide", "generate study guide", or "generate
  flashcards" to rebuild the matching output from the current input set.
- Do not blend old and new source sets. If `input/` contains a mix, ask which
  files belong to the current course.
- After generating or editing any guide or flashcard deck, run
  `scripts/finalize-guides.sh`; fix every reported issue before reporting
  completion.
- Outside `StudyGuide/` and `Flashcards/`, use the memory vault for project
  state, canonical notes, and session history.
- The memory plugin auto-captures successful sessions outside `StudyGuide/`
  and `Flashcards/`.
- Keep assignment work, study-guide work, and flashcard work separate.
- Do not put full code or assignment solutions in `Memory/`.
- Do not modify source documents unless the user asks.
