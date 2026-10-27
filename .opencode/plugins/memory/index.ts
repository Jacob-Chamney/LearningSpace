import { Plugin } from "@opencode/plugin"
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"

const VAULT = process.env.MEMORY_VAULT?.trim() || "Memory"
const STUDY_GUIDE = "StudyGuide"
const FLASHCARDS = "Flashcards"
const SESSIONS = path.join(VAULT, "04 Sessions")
const HOME = path.join(VAULT, "Home.md")
const SESSIONS_MOC = path.join(VAULT, "04 Sessions", "Sessions MOC.md")
const PROJECTS = path.join(VAULT, "03 Projects")

const IDLE_DELAY_MS = 3_000
const SAME_SESSION_COOLDOWN_MS = 5 * 60_000
const HOME_RECENT_LIMIT = 12

const pending = new Map<string, ReturnType<typeof setTimeout>>()
const inFlight = new Set<string>()
const lastCapture = new Map<string, number>()
const lastUserCount = new Map<string, number>()

const SUMMARY_PROMPT = `You are writing a session note for a learning memory vault.

Summarize the session above for future reference. Return Markdown only, with
exactly these sections and no frontmatter:

## Summary

- What was worked on and what changed.

## Decisions

- Any decisions, constraints, or approaches that matter later.

## Next

- Concrete next steps, or "- None."

Keep it under 180 words. Be factual. Mention files, commands, tests, or concepts
only if they actually appeared in the session. Do not include full submissions, answer keys, or long excerpts.`

type SessionPart = {
  type?: string
  text?: string
}

type SessionMessage = {
  type?: string
  text?: string
  content?: SessionPart[]
}

type ProjectMatch = {
  name: string
  path: string
}

export default Plugin.define({
  id: "memory-vault",
  async setup(ctx) {
    const root = ctx.location.project.canonical || ctx.location.directory
    const controller = new AbortController()

    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        if (event.type !== "session.execution.succeeded") continue

        const sessionID = event.data.sessionID
        const existing = pending.get(sessionID)
        if (existing) clearTimeout(existing)

        pending.set(
          sessionID,
          setTimeout(() => {
            pending.delete(sessionID)
            void capture(ctx, root, sessionID).catch((error) => {
              console.error("[memory-vault] capture failed", error)
            })
          }, IDLE_DELAY_MS),
        )
      }
    })().catch((error) => {
      if (!controller.signal.aborted) {
        console.error("[memory-vault] event stream failed", error)
      }
    })

    return () => {
      controller.abort()
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
    }
  },
})

async function capture(ctx: any, root: string, sessionID: string) {
  if (inFlight.has(sessionID)) return
  inFlight.add(sessionID)

  try {
    const info = await ctx.session.get({ sessionID })
    if (info.parentID) return
    if (info.projectID !== ctx.location.project.id) return
    if (isMemoryFree(root, ctx.location.directory, info)) return

    const messages = (await ctx.session.context({ sessionID })) as SessionMessage[]
    const userMessages = messages.filter(
      (message) => message.type === "user" && message.text?.trim(),
    )
    if (userMessages.length === 0) return

    const now = Date.now()
    const previousCapture = lastCapture.get(sessionID)
    if (previousCapture && now - previousCapture < SAME_SESSION_COOLDOWN_MS) return

    const previousUserCount = lastUserCount.get(sessionID) ?? 0
    if (userMessages.length <= previousUserCount) return

    const assistantMessages = messages.filter((message) => message.type === "assistant")
    const toolCalls = assistantMessages
      .flatMap((message) => message.content ?? [])
      .filter((part) => part.type === "tool")
    const hasAssistantText = assistantMessages.some((message) =>
      (message.content ?? []).some(
        (part) => part.type === "text" && Boolean(part.text?.trim()),
      ),
    )
    if (!hasAssistantText && toolCalls.length === 0) return

    // Skip a one-question/one-answer exchange unless it involved tools.
    if (userMessages.length < 2 && toolCalls.length === 0) return

    const result = await ctx.session.generate({
      sessionID,
      prompt: SUMMARY_PROMPT,
    })
    const summary = cleanSummary(result)
    if (!summary) return

    const title = makeTitle(info, userMessages)
    const date = dateParts(info.time?.created ?? now)
    const suffix = sessionID.slice(-6).replace(/[^a-zA-Z0-9]/g, "") || "session"
    const filename = `${date.date} - ${sanitizeFilename(title)} - ${suffix}.md`
    const link = filename.slice(0, -3)
    const project = await findProjectNote(root, title)
    const sessionsDir = path.join(root, SESSIONS)
    const notePath = path.join(sessionsDir, filename)

    await mkdir(sessionsDir, { recursive: true })

    const note = buildNote({
      date: date.date,
      title,
      summary,
      sessionID,
      project: project?.name,
    })

    let created = false
    try {
      await writeFile(notePath, note, { flag: "wx" })
      created = true
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error

      const existing = await readFile(notePath, "utf8")
      if (normalize(existing).includes(normalize(summary))) {
        lastCapture.set(sessionID, now)
        lastUserCount.set(sessionID, userMessages.length)
        console.error(`[memory-vault] skipped duplicate summary for ${filename}`)
        return
      }

      await appendFile(notePath, `\n## Follow-up ${date.time}\n\n${summary}\n`)
    }

    await addToSection(
      path.join(root, HOME),
      "## Recent sessions",
      link,
      false,
      HOME_RECENT_LIMIT,
    )
    await addToSessionMoc(path.join(root, SESSIONS_MOC), date.year, link)
    if (project) await addToSection(project.path, "## Session log", link, true)

    lastCapture.set(sessionID, now)
    lastUserCount.set(sessionID, userMessages.length)
    console.error(`[memory-vault] ${created ? "created" : "updated"} ${filename}`)
  } finally {
    inFlight.delete(sessionID)
  }
}

function makeTitle(info: any, userMessages: SessionMessage[]) {
  const current = cleanTitle(info.title ?? "")
  if (current && current !== "New session" && current !== "Untitled") return current

  const first = cleanTitle(userMessages[0]?.text?.trim().split("\n")[0] ?? "")
  return first || "Session"
}

function cleanTitle(value: string) {
  return value
    .trim()
    .replace(/^["'`]+/, "")
    .replace(/["'`]+$/, "")
    .trim()
}

function truncate(value: string, max: number) {
  if (value.length <= max) return value
  const cut = value.slice(0, max)
  const boundary = cut.lastIndexOf(" ")
  return (boundary >= Math.floor(max * 0.6) ? cut.slice(0, boundary) : cut).trim()
}

function sanitizeFilename(value: string) {
  const clean = value
    .replace(/[\\/:*?"<>|#^\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return truncate(clean, 70) || "Session"
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "")
}

function dateParts(timestamp: number) {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, "0")
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
    year: String(date.getFullYear()),
  }
}

function cleanSummary(value: unknown) {
  let text = ""

  if (typeof value === "string") {
    text = value
  } else if (value && typeof value === "object") {
    const result = value as {
      text?: unknown
      content?: SessionPart[]
      data?: { text?: unknown; content?: SessionPart[] }
    }

    if (typeof result.text === "string") {
      text = result.text
    } else if (typeof result.data?.text === "string") {
      text = result.data.text
    } else {
      const content = result.content ?? result.data?.content ?? []
      text = content
        .filter((part) => part.type === "text")
        .map((part) => part.text ?? "")
        .join("\n")
    }
  }

  text = text.trim()
  if (!text) return ""

  text = text
    .replace(/^```(?:markdown|md)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/```[\s\S]*?```/g, "[code omitted]")
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .trim()

  if (!/^##\s+/m.test(text)) text = `## Summary\n\n${text}`
  return text.slice(0, 6_000)
}

// StudyGuide and Flashcards are intentionally memory-free. Skip sessions
// rooted there.
function isMemoryFree(root: string, instanceDir: string, info: any) {
  const memoryFree = new Set([STUDY_GUIDE, FLASHCARDS])
  if (
    memoryFree.has(path.basename(root)) ||
    memoryFree.has(path.basename(instanceDir))
  ) {
    return true
  }

  const base = info.location?.directory ?? instanceDir
  const target = path.resolve(base, info.subpath ?? "")
  return target.split(path.sep).some((part) => memoryFree.has(part))
}

function buildNote(input: {
  date: string
  title: string
  summary: string
  sessionID: string
  project?: string
}) {
  const project = input.project ? `- [[${input.project}]]\n` : ""
  return `---
type: session
status: complete
languages: []
tags: [session, auto]
created: ${input.date}
updated: ${input.date}
date: ${input.date}
project: ${input.project ? `"[[${input.project}]]"` : '""'}
source: opencode
session: "${input.sessionID}"
---

# ${input.date} - ${input.title}

${input.summary}

## Links

- [[Home]]
- [[Sessions MOC]]
${project}`
}

async function findProjectNote(root: string, title: string): Promise<ProjectMatch | null> {
  const directory = path.join(root, PROJECTS)
  let files: string[]

  try {
    files = await readdir(directory)
  } catch {
    return null
  }

  const normalizedTitle = normalize(title)
  const matches = files
    .filter((file) => file.endsWith(".md") && !/ MOC\.md$/i.test(file))
    .map((file) => ({
      name: file.slice(0, -3),
      path: path.join(directory, file),
    }))
    .filter((project) => {
      const name = normalize(project.name)
      return (
        name.length >= 5 &&
        (normalizedTitle.includes(name) || name.includes(normalizedTitle))
      )
    })

  return matches.length === 1 ? matches[0] : null
}

async function addToSessionMoc(file: string, year: string, link: string) {
  const heading = `## ${year}`
  let text: string

  try {
    text = await readFile(file, "utf8")
  } catch {
    return
  }

  if (text.includes(heading)) {
    await addToSection(file, heading, link)
    return
  }

  text = `${text.trimEnd()}\n\n${heading}\n\n- [[${link}]]\n`
  await writeFile(file, text)
}

async function addToSection(
  file: string,
  heading: string,
  link: string,
  create: boolean = false,
  maxItems?: number,
) {
  let text: string

  try {
    text = await readFile(file, "utf8")
  } catch {
    return
  }

  const bullet = `- [[${link}]]`
  if (text.includes(bullet)) return

  const start = text.indexOf(heading)
  if (start === -1) {
    if (!create) return
    text = `${text.trimEnd()}\n\n${heading}\n\n${bullet}\n`
    await writeFile(file, text)
    return
  }

  const next = text.indexOf("\n## ", start + heading.length)
  const end = next === -1 ? text.length : next
  const before = text.slice(0, start)
  const section = text.slice(start, end)
  const after = text.slice(end)

  const lineEnd = section.indexOf("\n")
  const head = lineEnd === -1 ? `${section}\n` : section.slice(0, lineEnd + 1)
  const body = lineEnd === -1 ? "" : section.slice(lineEnd + 1)
  let newBody = `\n${bullet}\n${body.replace(/^\n+/, "")}`

  if (maxItems) {
    let seen = 0
    newBody = newBody
      .split("\n")
      .filter((line) => {
        if (!line.startsWith("- ")) return true
        seen += 1
        return seen <= maxItems
      })
      .join("\n")
  }

  await writeFile(file, `${before}${head}${newBody}${after}`)
}
