# Memory Rules

This vault is the user's long-term coding memory.
It is also the assistant's memory store.
The parent `AGENTS.md` still applies.

## Read order

1. `Home.md`
2. The relevant language MOC
3. The relevant project note
4. Recent session notes
5. Search for the canonical topic note

## Write rules

- After meaningful work, update the project note.
- Add a session note from `06 Templates/Session.md`.
- The memory plugin auto-creates or updates a session note after successful work.
- Review auto-generated notes and correct them before relying on them.
- Create or update a topic note when a reusable idea appears.
- Link new notes from the relevant language MOC and project note.
- Keep one main idea per note.
- Prefer links over duplicated text.
- Record decisions, gotchas, and next steps.
- Keep notes shorter than the work they describe.
- Do not store full chat transcripts.
- Do not store secrets, API keys, passwords, or large generated files.
- Store small reusable snippets only. Full code belongs in its project or Git repo.
- Do not make durable notes depend on coursework source paths; preserve the
  small reusable snippet in the note itself.
- Treat coursework source files as temporary and potentially deleted.
- Use frontmatter consistently.
- Keep plain Markdown links in indexes. Do not rely only on Dataview.

## Frontmatter

Every durable note should start with:

```yaml
---
type: moc | algorithm | concept | implementation | snippet | project | session | debug
status: seed | active | complete | paused | evergreen
languages: []
tags: []
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

Add fields only when useful.

## Scope

This vault is for coding memory, not coursework submission.
Do not add assignment solutions here unless the user explicitly asks.
For coursework, `AssignmentGuide/assignment-guide.md` remains the source of truth.
Study-guide work in `StudyGuide/` does not use this vault.
