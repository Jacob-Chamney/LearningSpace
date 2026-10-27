const state = {
  status: null,
  input: null,
  view: "overview",
  chat: [],
  chatSession: null,
  chatBusy: false,
  theme: "learningspace",
  toastTimer: null,
  flashcardsVersion: Date.now(),
};

const views = {
  overview: {
    eyebrow: "Workspace",
    title: "Overview",
    subtitle: "Change assignment instructions, manage source files, and ask the agent for help.",
  },
  assignment: {
    eyebrow: "AssignmentGuide",
    title: "Assignment guide",
    subtitle: "The current assignment plan, without the finished solution.",
    file: "AssignmentGuide/assignment-guide.md",
  },
  study: {
    eyebrow: "StudyGuide",
    title: "Study guide",
    subtitle: "Practice questions reveal answers inline. Markdown remains the source.",
    file: "StudyGuide/study-guide.md",
    answers: "StudyGuide/study-guide-answers.md",
  },
  flashcards: {
    eyebrow: "Flashcards",
    title: "Flashcards",
    subtitle: "A browser deck generated from the Markdown flashcard source.",
  },
};

const THEME_KEY = "learningspace-theme";
const THEMES = Array.isArray(window.LEARNINGSPACE_THEMES) ? window.LEARNINGSPACE_THEMES : [];

const $ = (selector, root = document) => root.querySelector(selector);

const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

function renderMarkdown(source) {
  source = source.replace(/^---\n[\s\S]*?\n---\n/, "");
  const lines = source.replace(/\r/g, "").split("\n");
  const html = [];
  let paragraph = [];
  let list = null;
  let inCode = false;
  let codeLang = "";
  let codeLines = [];

  function flushParagraph() {
    if (!paragraph.length) return;
    const content = paragraph.join(" ").trim();
    if (/^\*\*[^*]+\*\*$/.test(content)) {
      html.push(`<p class="section-heading">${inlineMarkdown(content)}</p>`);
    } else {
      html.push(`<p>${inlineMarkdown(content)}</p>`);
    }
    paragraph = [];
  }

  function closeList() {
    if (!list) return;
    html.push(`</${list}>`);
    list = null;
  }

  function openList(type) {
    if (list === type) return;
    closeList();
    html.push(`<${type}>`);
    list = type;
  }

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flushParagraph();
      closeList();
      if (inCode) {
        const language = codeLang ? ` class="language-${escapeHtml(codeLang)}"` : "";
        html.push(`<pre><code${language}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        inCode = false;
        codeLang = "";
        codeLines = [];
      } else {
        inCode = true;
        codeLang = trimmed.slice(3).trim();
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      closeList();
      continue;
    }

    if (trimmed === "&nbsp;") {
      flushParagraph();
      closeList();
      html.push('<div class="md-space"></div>');
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      html.push(`<h${heading[1].length}>${inlineMarkdown(heading[2])}</h${heading[1].length}>`);
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      flushParagraph();
      openList("ul");
      html.push(`<li>${inlineMarkdown(trimmed.replace(/^[-*]\s+/, ""))}</li>`);
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      flushParagraph();
      openList("ol");
      html.push(`<li>${inlineMarkdown(trimmed.replace(/^\d+\.\s+/, ""))}</li>`);
      continue;
    }

    if (trimmed === "---") {
      flushParagraph();
      closeList();
      html.push("<hr>");
      continue;
    }

    if (trimmed.startsWith("> ")) {
      flushParagraph();
      closeList();
      html.push(`<blockquote>${inlineMarkdown(trimmed.slice(2))}</blockquote>`);
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  closeList();
  if (inCode) html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  return html.join("\n");
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeQuestion(text) {
  return String(text).toLowerCase().replace(/[`*_]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2800);
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    showToast("Copied.");
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    showToast("Copied.");
  }
}

function outputInfo(path) {
  return state.status?.outputs?.find((item) => item.path === path);
}

function statusChip(info) {
  if (!info?.exists) return '<span class="chip missing"><span class="dot"></span>missing</span>';
  return `<span class="chip ok"><span class="dot"></span>${formatBytes(info.size)}</span>`;
}

function setHeading(view) {
  $("#view-eyebrow").textContent = view.eyebrow;
  $("#view-title").textContent = view.title;
  $("#view-subtitle").textContent = view.subtitle;
}

function setActiveNav() {
  $$(".nav-item").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.view);
  });
}

function showLoading() {
  $("#content").innerHTML = '<div class="loading">Loading workspace…</div>';
}

function showError(message) {
  $("#content").innerHTML = `<div class="error">${escapeHtml(message)}</div>`;
}

function themeById(id) {
  return THEMES.find((theme) => theme.id === id) || THEMES[0];
}

function syncFlashcardTheme() {
  const frame = document.getElementById("flashcard-frame");
  if (!frame?.contentWindow) return;
  const colors = themeById(state.theme)?.colors;
  if (colors) frame.contentWindow.postMessage({ type: "learningspace-theme", colors }, "*");
}

function applyTheme(id, persist = true) {
  const theme = themeById(id);
  if (!theme) return;
  const colors = theme.colors;
  const root = document.documentElement;
  const variables = {
    "--bg": colors.bg,
    "--bg-soft": colors.bgSoft,
    "--bg-deep": colors.bgDeep,
    "--panel-strong": colors.panelStrong,
    "--text": colors.text,
    "--muted": colors.muted,
    "--theme-border": colors.line,
    "--theme-border-strong": colors.lineStrong,
    "--indigo": colors.primary,
    "--violet": colors.secondary,
    "--cyan": colors.accent,
    "--green": colors.success,
    "--amber": colors.warning,
    "--danger": colors.danger,
  };
  Object.entries(variables).forEach(([key, value]) => {
    if (value) root.style.setProperty(key, value);
  });
  root.dataset.theme = theme.id;
  state.theme = theme.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", colors.bg);
  if (persist) {
    try { localStorage.setItem(THEME_KEY, theme.id); } catch { /* ignore */ }
  }
  syncFlashcardTheme();
  $$(".theme-option").forEach((button) => {
    const selected = button.dataset.theme === theme.id;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function renderThemeGrid() {
  const grid = $("#theme-grid");
  if (!grid) return;
  grid.innerHTML = THEMES.map((theme) => {
    const c = theme.colors;
    return `
      <button class="theme-option" type="button" data-theme="${escapeHtml(theme.id)}" aria-pressed="false">
        <span class="theme-swatch" style="--swatch-bg:${escapeHtml(c.bg)};--swatch-panel:${escapeHtml(c.panelStrong)};--swatch-primary:${escapeHtml(c.primary)};--swatch-accent:${escapeHtml(c.accent)}"></span>
        <span class="theme-label">${escapeHtml(theme.label)}</span>
      </button>
    `;
  }).join("");
  $$(".theme-option").forEach((button) => {
    button.addEventListener("click", () => {
      applyTheme(button.dataset.theme);
      showToast("Appearance updated.");
    });
  });
  applyTheme(themeById(state.theme).id, false);
}

function getInitialTheme() {
  try {
    return localStorage.getItem(THEME_KEY) || "learningspace";
  } catch {
    return "learningspace";
  }
}

function openSettings() {
  renderThemeGrid();
  $("#settings-modal").hidden = false;
  document.body.classList.add("settings-open");
  const panel = $(".settings-panel");
  if (panel) panel.scrollTop = 0;
  $("[data-close-settings]")?.focus();
}

function closeSettings() {
  $("#settings-modal").hidden = true;
  document.body.classList.remove("settings-open");
  $("#settings")?.focus();
}

async function loadStatus() {
  const response = await fetch(`/api/status?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Status request failed (${response.status})`);
  state.status = await response.json();
}

async function loadInput() {
  const response = await fetch(`/api/input?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Input request failed (${response.status})`);
  state.input = await response.json();
}

function renderOverview() {
  if (!state.input) {
    showLoading();
    return;
  }

  const goal = state.input.goal || "";
  const files = state.input.files || [];
  const fileRows = files.length
    ? files.map((item) => `
        <div class="file-row" data-file="${escapeHtml(item.path)}">
          <span class="file-name">${escapeHtml(item.path.replace(/^input\//, ""))}</span>
          <span class="file-meta">${formatBytes(item.size)}</span>
          <button class="button small danger remove-file" type="button" data-name="${escapeHtml(item.path.replace(/^input\//, ""))}">Remove</button>
        </div>
      `).join("")
    : '<div class="empty-inline">No source files yet. Add slides, PDFs, handouts, or notes above.</div>';

  $("#content").innerHTML = `
    <div class="grid">
      <article class="card wide">
        <p class="card-kicker">Assignment input</p>
        <h2>Assignment instructions</h2>
        <p>Edit <code>input/assignmentGoal.txt</code>. This is the authoritative instruction file for the assignment guide.</p>
        <textarea class="goal-editor" id="goal-editor" spellcheck="true" aria-label="Assignment instructions">${escapeHtml(goal)}</textarea>
        <div class="card-actions">
          <button class="button primary" type="button" id="save-goal">Save instructions</button>
          <span class="inline-hint" id="goal-status">${state.input.goalInfo?.exists ? "Saved locally" : "No instructions file yet"}</span>
        </div>
      </article>

      <article class="card wide">
        <p class="card-kicker">Input sources</p>
        <h2>Course files</h2>
        <p>Add or remove the documents the agent should use. Files are written directly to <code>input/</code>.</p>
        <div class="dropzone" id="dropzone" tabindex="0" role="button">
          <strong>Drop files here</strong>
          <span>or</span>
          <button class="button small" type="button" id="choose-files">Choose files</button>
          <input type="file" id="file-input" multiple hidden>
        </div>
        <div class="file-list" id="source-list">${fileRows}</div>
      </article>

      <article class="card wide chat-card">
        <div class="chat-header">
          <div>
            <p class="card-kicker">Ask the agent</p>
            <h2>Questions and help</h2>
            <p>Use the read-only Plan agent for questions about the assignment, sources, or study strategy.</p>
          </div>
          <button class="button small ghost" type="button" id="new-chat">New chat</button>
        </div>
        <div class="chat-messages" id="chat-messages"></div>
        <form class="chat-form" id="chat-form">
          <textarea id="chat-input" rows="2" placeholder="Ask about the assignment, a slide, a concept, or what to study next…"></textarea>
          <button class="button primary" type="submit" id="chat-send">Send</button>
        </form>
        <p class="chat-hint">Enter sends · Shift+Enter adds a line · Plan mode does not edit files.</p>
      </article>
    </div>
  `;

  $("#save-goal").addEventListener("click", saveGoal);
  $("#choose-files").addEventListener("click", () => $("#file-input").click());
  $("#file-input").addEventListener("change", (event) => uploadFiles(event.target.files));
  $("#dropzone").addEventListener("click", (event) => {
    if (event.target.id !== "choose-files") $("#file-input").click();
  });
  $("#dropzone").addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      $("#file-input").click();
    }
  });
  ["dragenter", "dragover"].forEach((name) => {
    $("#dropzone").addEventListener(name, (event) => {
      event.preventDefault();
      $("#dropzone").classList.add("is-dragging");
    });
  });
  ["dragleave", "drop"].forEach((name) => {
    $("#dropzone").addEventListener(name, (event) => {
      event.preventDefault();
      $("#dropzone").classList.remove("is-dragging");
    });
  });
  $("#dropzone").addEventListener("drop", (event) => uploadFiles(event.dataTransfer.files));
  $$(".remove-file").forEach((button) => {
    button.addEventListener("click", () => removeFile(button.dataset.name));
  });

  $("#new-chat").addEventListener("click", newChat);
  $("#chat-form").addEventListener("submit", (event) => {
    event.preventDefault();
    sendChat();
  });
  $("#chat-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendChat();
    }
  });
  renderChatMessages();
}

async function saveGoal() {
  const button = $("#save-goal");
  const textarea = $("#goal-editor");
  if (!button || !textarea) return;
  button.disabled = true;
  try {
    const response = await fetch("/api/input/goal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: textarea.value }),
    });
    const result = await response.json();
    if (!result.ok) throw new Error(result.error || "Save failed");
    await loadInput();
    $("#goal-status").textContent = "Saved locally";
    showToast("Assignment instructions saved.");
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
}

async function uploadFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  const draft = $("#goal-editor")?.value;
  for (const file of files) {
    try {
      const response = await fetch(`/api/input/upload?name=${encodeURIComponent(file.name)}`, {
        method: "POST",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });
      const result = await response.json();
      if (!result.ok) throw new Error(result.error || `Could not upload ${file.name}`);
    } catch (error) {
      showToast(error.message);
      return;
    }
  }
  await loadInput();
  renderOverview();
  if (draft !== undefined && $("#goal-editor")) $("#goal-editor").value = draft;
  showToast(files.length === 1 ? "Source file added." : "Source files added.");
}

async function removeFile(name) {
  if (!window.confirm(`Remove ${name} from input/?`)) return;
  try {
    const response = await fetch(`/api/input?name=${encodeURIComponent(name)}`, { method: "DELETE" });
    const result = await response.json();
    if (!result.ok) throw new Error(result.error || "Remove failed");
    await loadInput();
    renderOverview();
    showToast("Source file removed.");
  } catch (error) {
    showToast(error.message);
  }
}

function getChatSession() {
  if (state.chatSession) return state.chatSession;
  let value = "";
  try {
    value = localStorage.getItem("learningspace-chat-session") || "";
  } catch {
    value = "";
  }
  if (!/^ses_[A-Za-z0-9]+$/.test(value)) {
    const random = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, "")
      : String(Date.now());
    value = `ses_web${random}`;
    try { localStorage.setItem("learningspace-chat-session", value); } catch { /* ignore */ }
  }
  state.chatSession = value;
  return value;
}

function loadChat() {
  try {
    const saved = localStorage.getItem("learningspace-chat-history");
    state.chat = saved ? JSON.parse(saved) : [];
    if (!Array.isArray(state.chat)) state.chat = [];
  } catch {
    state.chat = [];
  }
}

function saveChat() {
  try { localStorage.setItem("learningspace-chat-history", JSON.stringify(state.chat.slice(-40))); } catch { /* ignore */ }
}

function renderChatMessages() {
  const container = $("#chat-messages");
  if (!container) return;
  if (!state.chat.length) {
    container.innerHTML = '<div class="chat-empty">Ask a question about the assignment, a source document, or how to study.</div>';
    return;
  }
  container.innerHTML = state.chat.map((message) => {
    if (message.role === "user") {
      return `<div class="chat-row user"><div class="chat-bubble user">${escapeHtml(message.text)}</div></div>`;
    }
    return `<div class="chat-row assistant"><div class="chat-bubble assistant">${message.pending ? '<span class="typing">Thinking…</span>' : renderMarkdown(message.text)}</div></div>`;
  }).join("");
  container.scrollTop = container.scrollHeight;
}

async function sendChat() {
  if (state.chatBusy) return;
  const input = $("#chat-input");
  const message = input.value.trim();
  if (!message) return;

  state.chatBusy = true;
  state.chat.push({ role: "user", text: message });
  state.chat.push({ role: "assistant", text: "", pending: true });
  saveChat();
  input.value = "";
  renderChatMessages();
  const sendButton = $("#chat-send");
  const newChatButton = $("#new-chat");
  if (sendButton) sendButton.disabled = true;
  if (newChatButton) newChatButton.disabled = true;

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, sessionID: getChatSession() }),
    });
    const result = await response.json();
    const pending = state.chat[state.chat.length - 1];
    if (!pending) return;
    pending.pending = false;
    pending.text = result.ok ? result.text : `**Agent error:** ${result.error || "The agent could not answer."}`;
    saveChat();
    renderChatMessages();
  } catch (error) {
    const pending = state.chat[state.chat.length - 1];
    if (!pending) return;
    pending.pending = false;
    pending.text = `**Connection error:** ${error.message}`;
    saveChat();
    renderChatMessages();
  } finally {
    state.chatBusy = false;
    if (sendButton) sendButton.disabled = false;
    if (newChatButton) newChatButton.disabled = false;
    $("#chat-input")?.focus();
  }
}

function newChat() {
  if (state.chatBusy) return;
  state.chat = [];
  state.chatSession = null;
  try {
    localStorage.removeItem("learningspace-chat-history");
    localStorage.removeItem("learningspace-chat-session");
  } catch { /* ignore */ }
  renderChatMessages();
  showToast("New conversation.");
}

async function fetchMarkdown(path) {
  const response = await fetch(`/${path}?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`);
  return response.text();
}

function docToolbar(path) {
  return `
    <div class="doc-toolbar">
      <span>${escapeHtml(path)}</span>
      <div class="doc-actions">
        <a class="button small ghost" href="/${escapeHtml(path)}" target="_blank" rel="noreferrer">Open .md</a>
        <button class="button small ghost" type="button" data-copy="${escapeHtml(path)}">Copy path</button>
      </div>
    </div>
  `;
}

function bindPathCopy(root) {
  $$("[data-copy]", root).forEach((button) => {
    button.addEventListener("click", () => copyText(button.dataset.copy));
  });
}

async function renderDocument(file) {
  $("#content").innerHTML = '<div class="loading">Loading Markdown…</div>';
  try {
    const markdown = await fetchMarkdown(file);
    $("#content").innerHTML = `${docToolbar(file)}<article class="prose">${renderMarkdown(markdown)}</article>`;
    bindPathCopy($("#content"));
  } catch (error) {
    $("#content").innerHTML = `<div class="empty-state"><strong>File not found</strong><p>${escapeHtml(error.message)}</p></div>`;
  }
}

function parseAnswerKey(markdown) {
  const byQuestion = new Map();
  const ordered = [];
  const heading = /^\*\*(\d+)\) (.+?)\*\*$/gm;
  const matches = [];
  let match;
  while ((match = heading.exec(markdown)) !== null) matches.push(match);

  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const end = index + 1 < matches.length ? matches[index + 1].index : markdown.length;
    const body = markdown.slice(current.index + current[0].length, end);
    const questionMatch = body.match(/^- \*\*Question:\*\* (.+)$/m);
    if (!questionMatch) continue;
    const question = questionMatch[1].trim();
    const answerLines = body.split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- ") && !line.startsWith("- **Question:**"))
      .map((line) => line.slice(2).trim())
      .filter(Boolean);
    if (!answerLines.length) continue;
    const item = { question, answers: answerLines };
    ordered.push(item);
    byQuestion.set(normalizeQuestion(question), item.answers);
  }
  return { byQuestion, ordered };
}

function enhancePracticeQuestions(root, answers) {
  const heading = Array.from(root.querySelectorAll(".section-heading"))
    .find((element) => element.textContent.toLowerCase().includes("practice questions"));
  if (!heading) return;

  let list = heading.nextElementSibling;
  while (list && list.tagName !== "UL") list = list.nextElementSibling;
  if (!list) return;

  $$("li", list).forEach((item, index) => {
    const questionText = item.textContent.trim();
    const answer = answers.byQuestion.get(normalizeQuestion(questionText))
      || answers.ordered[index]?.answers;
    if (!answer) return;

    item.classList.add("question-item");
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "button small answer-toggle";
    toggle.textContent = "Show answer";

    const panel = document.createElement("div");
    panel.className = "answer-panel";
    panel.hidden = true;
    panel.innerHTML = `<p class="answer-label">Answer</p><ul>${answer.map((line) => `<li>${inlineMarkdown(line)}</li>`).join("")}</ul>`;

    toggle.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      toggle.textContent = panel.hidden ? "Show answer" : "Hide answer";
      toggle.setAttribute("aria-expanded", String(!panel.hidden));
    });
    toggle.setAttribute("aria-expanded", "false");
    item.append(toggle, panel);
  });
}

async function renderStudyGuide() {
  $("#content").innerHTML = '<div class="loading">Loading study guide…</div>';
  try {
    const [guide, answerKey] = await Promise.all([
      fetchMarkdown(views.study.file),
      fetchMarkdown(views.study.answers).catch(() => ""),
    ]);
    $("#content").innerHTML = `${docToolbar(views.study.file)}<article class="prose">${renderMarkdown(guide)}</article>`;
    bindPathCopy($("#content"));
    if (answerKey) {
      enhancePracticeQuestions($(".prose"), parseAnswerKey(answerKey));
    }
  } catch (error) {
    $("#content").innerHTML = `<div class="empty-state"><strong>Study guide not found</strong><p>${escapeHtml(error.message)}</p></div>`;
  }
}

function renderFlashcards() {
  const path = "Flashcards/flashcards.html";
  const info = outputInfo(path);
  if (!info?.exists) {
    $("#content").innerHTML = `
      <div class="empty-state">
        <strong>No browser deck yet</strong>
        <p>Ask the agent to generate flashcards, then finalize the workspace from OpenCode.</p>
      </div>
    `;
    return;
  }

  const deckUrl = `/${path}?theme=${encodeURIComponent(state.theme)}&t=${state.flashcardsVersion}`;
  $("#content").innerHTML = `
    <div class="doc-toolbar">
      <span>${escapeHtml(path)}</span>
      <div class="doc-actions">
        <a class="button small ghost" href="${deckUrl}" target="_blank" rel="noreferrer">Open deck</a>
      </div>
    </div>
    <div class="deck-shell">
      <iframe id="flashcard-frame" title="LearningSpace flashcard deck" src="${deckUrl}"></iframe>
    </div>
  `;

  $("#flashcard-frame")?.addEventListener("load", syncFlashcardTheme);
  syncFlashcardTheme();
}

function render() {
  setActiveNav();
  setHeading(views[state.view]);
  if (!state.status && state.view !== "overview") {
    showLoading();
    return;
  }

  switch (state.view) {
    case "overview":
      renderOverview();
      break;
    case "assignment":
      renderDocument(views.assignment.file);
      break;
    case "study":
      renderStudyGuide();
      break;
    case "flashcards":
      renderFlashcards();
      break;
    default:
      renderOverview();
  }
}

async function setView(view) {
  state.view = view;
  window.location.hash = view;
  if (view === "overview" && !state.input) {
    try { await loadInput(); } catch { /* handled by render */ }
  }
  render();
}

async function refresh() {
  try {
    const tasks = [loadStatus()];
    if (state.view === "overview") tasks.push(loadInput());
    await Promise.all(tasks);
    render();
    showToast("Workspace refreshed.");
  } catch (error) {
    showError(error.message);
  }
}

function bindEvents() {
  $$(".nav-item").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });
  $("#refresh").addEventListener("click", refresh);
  $("#settings").addEventListener("click", openSettings);
  $$("[data-close-settings]").forEach((element) => {
    element.addEventListener("click", closeSettings);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("#settings-modal").hidden) closeSettings();
  });
  window.addEventListener("hashchange", () => {
    const view = window.location.hash.slice(1);
    if (views[view] && view !== state.view) {
      state.view = view;
      if (view === "overview") loadInput().then(render).catch(() => render());
      else render();
    }
  });
}

async function init() {
  applyTheme(getInitialTheme(), false);
  bindEvents();
  const initial = window.location.hash.slice(1);
  if (views[initial]) state.view = initial;
  loadChat();
  try {
    const tasks = [loadStatus()];
    if (state.view === "overview") tasks.push(loadInput());
    await Promise.all(tasks);
    render();
  } catch (error) {
    showError(`Dashboard could not reach the local server. Run scripts/serve-dashboard.py and open its URL. ${error.message}`);
  }
}

init();
