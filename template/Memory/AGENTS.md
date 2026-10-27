# Memory Rules

This vault is the user's durable learning memory.
It is also the assistant's memory store.
The parent `AGENTS.md` still applies.

## Read order

1. `Home.md`
2. The relevant course MOC
3. The relevant project note
4. Recent session notes
5. Search for the canonical topic or concept note

## Write rules

- After meaningful work, update the course or project note.
- Add a session note from `06 Templates/Session.md`.
- The memory plugin auto-creates or updates a session note after successful work.
- Review auto-generated notes and correct them before relying on them.
- Create or update a topic or concept note when a reusable idea appears.
- Link new notes from the relevant course or topic MOC and project note.
- Keep one main idea per note.
- Prefer links over duplicated text.
- Record decisions, gotchas, and next steps.
- Keep notes shorter than the work they describe.
- Do not store full chat transcripts.
- Do not store secrets, API keys, passwords, or large generated files.
- Store small reusable examples or formulas only; full submissions belong in
  the course files.
- Do not make durable notes depend on temporary source paths.
- Treat coursework source files as temporary and potentially deleted.
- Use frontmatter consistently.
- Keep plain Markdown links in indexes. Do not rely only on Dataview.

## Frontmatter

Every durable note should start with:

```yaml
---
type: moc | course | topic | concept | project | session | source | review
status: seed | active | complete | paused | evergreen
tags: []
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

Add fields only when useful.

## Scope

This vault is for durable learning notes, not submission-ready coursework.
Do not add finished assignment answers here unless the user explicitly asks.
For coursework, `AssignmentGuide/assignment-guide.md` remains the source of
truth. Study-guide and flashcard work do not use this vault.
