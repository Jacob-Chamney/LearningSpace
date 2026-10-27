const state = {
  status: null,
  input: null,
  view: "chat",
  theme: "learningspace",
  canChat: false,
  chats: [],
  activeChat: null,
  chatBusy: false,
  menuChatId: null,
  sidebarCollapsed: false,
  toastTimer: null,
  flashcardsVersion: Date.now(),
};

const views = {
  chat: {
    eyebrow: "Chat",
    title: "New chat",
    subtitle: "Ask about the assignment, a source, a concept, or what to study next.",
  },
  workspace: {
    eyebrow: "Workspace",
    title: "Workspace",
    subtitle: "Change assignment instructions and manage the documents the agent can use.",
  },
  assignment: {
    eyebrow: "Assignment",
    title: "Assignment guide",
    subtitle: "The current assignment plan, without the finished solution.",
    file: "AssignmentGuide/assignment-guide.md",
  },
  study: {
    eyebrow: "Study guide",
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
const SIDEBAR_KEY = "learningspace-sidebar-collapsed";
const CHAT_STORE_KEY = "learningspace-chats-v1";
const ACTIVE_CHAT_KEY = "learningspace-active-chat";
const LEGACY_CHAT_KEY = "learningspace-chat-history";
const LEGACY_SESSION_KEY = "learningspace-chat-session";
const THEMES = Array.isArray(window.LEARNINGSPACE_THEMES) ? window.LEARNINGSPACE_THEMES : [];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function randomId(prefix) {
  const value = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, "")
    : String(Date.now()) + Math.random().toString(36).slice(2);
  return `${prefix}${value}`;
}

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
  try { return localStorage.getItem(THEME_KEY) || "learningspace"; } catch { return "learningspace"; }
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

function applyChatAvailability() {
  const available = Boolean(state.status?.canChat);
  state.canChat = available;
  const controls = [$('.nav-item[data-view="chat"]'), $("#new-chat-top")];
  controls.forEach((control) => {
    if (!control) return;
    control.disabled = !available;
    control.setAttribute("aria-disabled", String(!available));
    control.title = available ? "" : "Add an assignment instruction or course material first.";
  });
  const note = $("#chat-lock-note");
  if (note) note.hidden = available;
  if (!available && state.view === "chat") {
    state.view = "workspace";
    if (window.location.hash === "#chat") {
      try { history.replaceState(null, "", "#workspace"); } catch { /* ignore */ }
    }
  }
}

async function loadStatus() {
  const response = await fetch(`/api/status?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Status request failed (${response.status})`);
  state.status = await response.json();
  applyChatAvailability();
}

async function loadInput() {
  const response = await fetch(`/api/input?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Input request failed (${response.status})`);
  state.input = await response.json();
}

function makeChat() {
  return {
    id: randomId("chat"),
    sessionID: randomId("ses_web"),
    title: "New chat",
    messages: [],
    updatedAt: Date.now(),
  };
}

function chatTitleFromMessage(message) {
  const clean = message.replace(/\s+/g, " ").trim();
  return clean.length > 52 ? `${clean.slice(0, 49).trim()}...` : clean || "New chat";
}

function loadChats() {
  let chats = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(CHAT_STORE_KEY) || "[]");
    if (Array.isArray(parsed)) chats = parsed.filter((chat) => chat && chat.id && chat.sessionID);
  } catch { chats = []; }

  if (!chats.length) {
    try {
      const legacy = JSON.parse(localStorage.getItem(LEGACY_CHAT_KEY) || "[]");
      if (Array.isArray(legacy) && legacy.length) {
        const session = localStorage.getItem(LEGACY_SESSION_KEY) || randomId("ses_web");
        const firstUser = legacy.find((message) => message.role === "user" && message.text);
        const chat = {
          id: randomId("chat"),
          sessionID: session,
          title: chatTitleFromMessage(firstUser?.text || ""),
          messages: legacy.filter((message) => message && message.text),
          updatedAt: Date.now(),
        };
        chats = [chat];
        localStorage.removeItem(LEGACY_CHAT_KEY);
        localStorage.removeItem(LEGACY_SESSION_KEY);
      }
    } catch { /* ignore */ }
  }

  state.chats = chats;
  let activeId = "";
  try { activeId = localStorage.getItem(ACTIVE_CHAT_KEY) || ""; } catch { activeId = ""; }
  state.activeChat = state.chats.find((chat) => chat.id === activeId) || state.chats[0] || makeChat();
}

function saveChats() {
  try {
    localStorage.setItem(CHAT_STORE_KEY, JSON.stringify(state.chats.slice(-30)));
    localStorage.setItem(ACTIVE_CHAT_KEY, state.activeChat?.id || "");
    if (!state.chats.length) {
      localStorage.removeItem(LEGACY_CHAT_KEY);
      localStorage.removeItem(LEGACY_SESSION_KEY);
    }
  } catch { /* ignore */ }
}

function renderSidebarHistory() {
  const container = $("#chat-history");
  if (!container) return;
  const clear = $("#clear-history");
  const chats = [...state.chats].sort((a, b) => b.updatedAt - a.updatedAt);
  if (clear) clear.disabled = !chats.length;
  if (!chats.length) {
    container.innerHTML = '<p class="history-empty">No conversations yet.</p>';
    return;
  }
  container.innerHTML = chats.map((chat) => `
    <div class="history-row">
      <button class="history-item ${state.activeChat?.id === chat.id ? "is-active" : ""}" type="button" data-chat-id="${escapeHtml(chat.id)}">
        ${escapeHtml(chat.title)}
      </button>
      <button class="history-menu-button" type="button" data-menu-chat="${escapeHtml(chat.id)}" aria-label="More options for ${escapeHtml(chat.title)}" aria-haspopup="menu" aria-expanded="false" title="More options">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="5" cy="12" r="1.5"></circle>
          <circle cx="12" cy="12" r="1.5"></circle>
          <circle cx="19" cy="12" r="1.5"></circle>
        </svg>
      </button>
    </div>
  `).join("");
  $$(".history-item", container).forEach((button) => {
    button.addEventListener("click", () => activateChat(button.dataset.chatId));
  });
  $$(".history-menu-button", container).forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openChatMenu(button.dataset.menuChat, button);
    });
  });
}

function openChatMenu(id, button) {
  const menu = $("#chat-menu");
  if (!menu) return;
  state.menuChatId = id;
  menu.hidden = false;
  const rect = button.getBoundingClientRect();
  const width = 132;
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width));
  const top = Math.min(window.innerHeight - 48, rect.bottom + 4);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  $$(".history-menu-button").forEach((item) => item.setAttribute("aria-expanded", String(item === button)));
}

function closeChatMenu() {
  const menu = $("#chat-menu");
  if (menu) menu.hidden = true;
  state.menuChatId = null;
  $$(".history-menu-button").forEach((button) => button.setAttribute("aria-expanded", "false"));
}

function deleteMenuChat() {
  const id = state.menuChatId;
  closeChatMenu();
  if (id) removeChat(id);
}

function removeChat(id) {
  if (state.chatBusy) {
    showToast("Wait for the current response first.");
    return;
  }
  const chat = state.chats.find((item) => item.id === id);
  if (!chat) return;
  if (!window.confirm(`Delete "${chat.title}" from chat history?`)) return;
  state.chats = state.chats.filter((item) => item.id !== id);
  if (state.activeChat?.id === id) {
    state.activeChat = state.chats[0] || makeChat();
    state.view = state.canChat ? "chat" : "workspace";
  }
  saveChats();
  render();
  showToast("Conversation deleted.");
}

function clearChatHistory() {
  if (state.chatBusy) {
    showToast("Wait for the current response first.");
    return;
  }
  if (!state.chats.length) return;
  if (!window.confirm("Delete all chat history? This only clears the dashboard history.")) return;
  state.chats = [];
  state.activeChat = makeChat();
  state.view = state.canChat ? "chat" : "workspace";
  try {
    localStorage.removeItem(LEGACY_CHAT_KEY);
    localStorage.removeItem(LEGACY_SESSION_KEY);
  } catch { /* ignore */ }
  saveChats();
  render();
  showToast("Chat history cleared.");
}

function activateChat(id) {
  if (!state.canChat) {
    showToast("Add an assignment instruction or course material to unlock chat.");
    return;
  }
  if (state.chatBusy) {
    showToast("Wait for the current response first.");
    return;
  }
  const chat = state.chats.find((item) => item.id === id);
  if (!chat) return;
  state.activeChat = chat;
  state.view = "chat";
  closeChatMenu();
  collapseSidebarOnMobile();
  saveChats();
  render();
}

function startNewChat() {
  if (!state.canChat) {
    showToast("Add an assignment instruction or course material to unlock chat.");
    return;
  }
  if (state.chatBusy) {
    showToast("Wait for the current response first.");
    return;
  }
  state.activeChat = makeChat();
  state.view = "chat";
  closeChatMenu();
  collapseSidebarOnMobile();
  saveChats();
  render();
  $("#chat-input")?.focus();
}

function currentChatMessages() {
  return state.activeChat?.messages || [];
}

function viewHeader(label) {
  return `
    <div class="view-header" aria-label="LearningSpace ${escapeHtml(label)}">
      <span class="view-mark">LS</span>
      <span class="view-path">LEARNINGSPACE / ${escapeHtml(label)}</span>
    </div>
  `;
}

function renderChatView() {
  if (!state.canChat) {
    state.view = "workspace";
    document.body.dataset.view = "workspace";
    setActiveNav();
    renderWorkspace();
    return;
  }
  if (!state.activeChat) state.activeChat = makeChat();
  $("#content").innerHTML = `
    <section class="view-frame">
      ${viewHeader("CHAT")}
      <section class="chat-view">
        <div class="chat-thread" id="chat-thread"></div>
        <form class="chat-composer" id="chat-form">
          <textarea id="chat-input" rows="1" placeholder="Ask about the assignment, a source, a concept, or what to study next..."></textarea>
          <button class="button primary chat-send" type="submit" id="chat-send">Send</button>
        </form>
        <p class="chat-hint">Course material only. Off-topic questions are declined. Enter sends · Shift+Enter adds a line.</p>
      </section>
    </section>
  `;
  renderChatMessages();
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
  $$("[data-suggestion]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = $("#chat-input");
      input.value = button.dataset.suggestion;
      input.focus();
    });
  });
}

function renderChatMessages() {
  const thread = $("#chat-thread");
  if (!thread) return;
  const messages = currentChatMessages();
  if (!messages.length) {
    thread.innerHTML = `
      <div class="chat-welcome">
        <p class="eyebrow">LearningSpace</p>
        <h2>How can I help with your coursework?</h2>
        <p>Ask about the assignment, a source document, a concept, or what to review next. Off-topic questions are declined.</p>
        <div class="chat-suggestions">
          <button type="button" data-suggestion="Summarize the assignment plan.">Summarize the assignment plan</button>
          <button type="button" data-suggestion="Quiz me on the study guide.">Quiz me on the study guide</button>
          <button type="button" data-suggestion="What should I review first?">What should I review first</button>
        </div>
      </div>
    `;
    return;
  }

  thread.innerHTML = messages.map((message) => {
    if (message.role === "user") {
      return `<div class="chat-message user"><div class="chat-bubble">${escapeHtml(message.text)}</div></div>`;
    }
    return `<div class="chat-message assistant"><div class="assistant-mark">LS</div><div class="assistant-content">${message.pending ? '<span class="typing">Thinking...</span>' : renderMarkdown(message.text)}</div></div>`;
  }).join("");
  thread.scrollTop = thread.scrollHeight;
}

async function sendChat() {
  if (!state.canChat) {
    showToast("Add an assignment instruction or course material to unlock chat.");
    return;
  }
  if (state.chatBusy) return;
  const input = $("#chat-input");
  const message = input.value.trim();
  if (!message) return;
  if (!state.activeChat) state.activeChat = makeChat();

  const chat = state.activeChat;
  chat.messages.push({ role: "user", text: message });
  chat.messages.push({ role: "assistant", text: "", pending: true });
  if (chat.title === "New chat") chat.title = chatTitleFromMessage(message);
  chat.updatedAt = Date.now();
  if (!state.chats.some((item) => item.id === chat.id)) state.chats.push(chat);
  saveChats();
  state.chatBusy = true;
  input.value = "";
  renderSidebarHistory();
  renderChatMessages();
  const sendButton = $("#chat-send");
  const newChatButton = $("#new-chat-top");
  if (sendButton) sendButton.disabled = true;
  if (newChatButton) newChatButton.disabled = true;

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, sessionID: chat.sessionID }),
    });
    const result = await response.json();
    const pending = chat.messages[chat.messages.length - 1];
    if (!pending) return;
    pending.pending = false;
    pending.text = result.ok ? result.text : `**Agent error:** ${result.error || "The agent could not answer."}`;
    chat.updatedAt = Date.now();
    saveChats();
    renderSidebarHistory();
    if (state.activeChat?.id === chat.id) renderChatMessages();
  } catch (error) {
    const pending = chat.messages[chat.messages.length - 1];
    if (!pending) return;
    pending.pending = false;
    pending.text = `**Connection error:** ${error.message}`;
    saveChats();
    if (state.activeChat?.id === chat.id) renderChatMessages();
  } finally {
    state.chatBusy = false;
    if (sendButton) sendButton.disabled = !state.canChat;
    if (newChatButton) newChatButton.disabled = !state.canChat;
    $("#chat-input")?.focus();
  }
}

function renderWorkspace() {
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
    ${viewHeader("WORKSPACE")}
    ${!state.canChat ? `
      <div class="chat-lock-banner" role="status">
        <strong>Chat is locked.</strong>
        Add an assignment instruction or at least one course document below to unlock it.
      </div>
    ` : ""}
    <div class="workspace-grid">
      <article class="card">
        <p class="card-kicker">Assignment input</p>
        <h2>Assignment instructions</h2>
        <p>Edit <code>input/assignmentGoal.txt</code>. This is the authoritative instruction file for the assignment guide.</p>
        <textarea class="goal-editor" id="goal-editor" spellcheck="true" aria-label="Assignment instructions">${escapeHtml(goal)}</textarea>
        <div class="card-actions">
          <button class="button primary" type="button" id="save-goal">Save instructions</button>
          <span class="inline-hint" id="goal-status">${state.input.goalInfo?.exists ? "Saved locally" : "No instructions file yet"}</span>
        </div>
      </article>

      <article class="card">
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
    await loadStatus();
    renderWorkspace();
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
  await loadStatus();
  renderWorkspace();
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
    await loadStatus();
    renderWorkspace();
    showToast("Source file removed.");
  } catch (error) {
    showToast(error.message);
  }
}

async function fetchMarkdown(path) {
  const response = await fetch(`/${path}?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`);
  return response.text();
}

async function renderDocument(file, label) {
  $("#content").innerHTML = '<div class="loading">Loading Markdown...</div>';
  try {
    const markdown = await fetchMarkdown(file);
    $("#content").innerHTML = `${viewHeader(label)}<article class="prose">${renderMarkdown(markdown)}</article>`;
  } catch (error) {
    $("#content").innerHTML = `${viewHeader(label)}<div class="empty-state"><strong>File not found</strong><p>${escapeHtml(error.message)}</p></div>`;
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
  $("#content").innerHTML = '<div class="loading">Loading study guide...</div>';
  try {
    const [guide, answerKey] = await Promise.all([
      fetchMarkdown(views.study.file),
      fetchMarkdown(views.study.answers).catch(() => ""),
    ]);
    $("#content").innerHTML = `${viewHeader("STUDY GUIDE")}<article class="prose">${renderMarkdown(guide)}</article>`;
    if (answerKey) enhancePracticeQuestions($(".prose"), parseAnswerKey(answerKey));
  } catch (error) {
    $("#content").innerHTML = `${viewHeader("STUDY GUIDE")}<div class="empty-state"><strong>Study guide not found</strong><p>${escapeHtml(error.message)}</p></div>`;
  }
}

function renderFlashcards() {
  const path = "Flashcards/flashcards.html";
  const info = outputInfo(path);
  if (!info?.exists) {
    $("#content").innerHTML = `
      ${viewHeader("FLASHCARDS")}
      <div class="empty-state">
        <strong>No browser deck yet</strong>
        <p>Ask the agent to generate flashcards, then finalize the workspace from OpenCode.</p>
      </div>
    `;
    return;
  }

  const deckUrl = `/${path}?theme=${encodeURIComponent(state.theme)}&embed=1&t=${state.flashcardsVersion}`;
  $("#content").innerHTML = `
    <section class="view-frame">
      ${viewHeader("FLASHCARDS")}
      <div class="deck-shell">
        <iframe id="flashcard-frame" title="LearningSpace flashcard deck" src="${deckUrl}"></iframe>
      </div>
    </section>
  `;
  $("#flashcard-frame")?.addEventListener("load", syncFlashcardTheme);
  syncFlashcardTheme();
}

function outputInfo(path) {
  return state.status?.outputs?.find((item) => item.path === path);
}

function setActiveNav() {
  $$(".nav-item").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.view);
  });
}

function showLoading() {
  $("#content").innerHTML = '<div class="loading">Loading workspace...</div>';
}

function showError(message) {
  $("#content").innerHTML = `<div class="error">${escapeHtml(message)}</div>`;
}

function render() {
  document.body.dataset.view = state.view;
  setActiveNav();
  renderSidebarHistory();
  switch (state.view) {
    case "chat":
      renderChatView();
      break;
    case "workspace":
      renderWorkspace();
      break;
    case "assignment":
      renderDocument(views.assignment.file, "ASSIGNMENT GUIDE");
      break;
    case "study":
      renderStudyGuide();
      break;
    case "flashcards":
      renderFlashcards();
      break;
    default:
      renderChatView();
  }
}

function collapseSidebarOnMobile() {
  if (window.innerWidth <= 900) {
    state.sidebarCollapsed = true;
    applySidebarState();
  }
}

function applySidebarState() {
  document.body.classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
  const button = $("#sidebar-toggle");
  if (button) {
    button.setAttribute("aria-expanded", String(!state.sidebarCollapsed));
    button.setAttribute("aria-label", state.sidebarCollapsed ? "Show sidebar" : "Hide sidebar");
  }
  try { localStorage.setItem(SIDEBAR_KEY, state.sidebarCollapsed ? "1" : "0"); } catch { /* ignore */ }
}

function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  applySidebarState();
}

async function setView(view) {
  if (!views[view]) return;
  if (view === "chat" && !state.canChat) {
    showToast("Add an assignment instruction or course material to unlock chat.");
    return;
  }
  state.view = view;
  window.location.hash = view;
  if (view === "workspace" && !state.input) {
    try { await loadInput(); } catch { /* handled by render */ }
  }
  if (view === "chat" && !state.activeChat) state.activeChat = makeChat();
  collapseSidebarOnMobile();
  saveChats();
  render();
}

function bindEvents() {
  $$(".nav-item").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });
  $("#new-chat-top").addEventListener("click", startNewChat);
  $("#clear-history").addEventListener("click", clearChatHistory);
  $("#chat-menu-delete").addEventListener("click", deleteMenuChat);
  document.addEventListener("click", (event) => {
    if (event.target.closest(".history-menu-button") || event.target.closest("#chat-menu")) return;
    closeChatMenu();
  });
  window.addEventListener("scroll", closeChatMenu, true);
  window.addEventListener("resize", closeChatMenu);
  $("#sidebar-toggle").addEventListener("click", toggleSidebar);
  $("#settings").addEventListener("click", openSettings);
  window.addEventListener("storage", (event) => {
    if (event.key === THEME_KEY) applyTheme(event.newValue || "learningspace", false);
  });
  $$("[data-close-settings]").forEach((element) => {
    element.addEventListener("click", closeSettings);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("#settings-modal").hidden) closeSettings();
  });
  window.addEventListener("hashchange", () => {
    let view = window.location.hash.slice(1);
    if (view === "overview") view = "workspace";
    if (view === "chat" && !state.canChat) {
      state.view = "workspace";
      if (window.location.hash !== "#workspace") {
        try { history.replaceState(null, "", "#workspace"); } catch { /* ignore */ }
      }
      render();
      return;
    }
    if (views[view] && view !== state.view) {
      state.view = view;
      if (view === "workspace" && !state.input) loadInput().then(render).catch(() => render());
      else render();
    }
  });
}

function loadSidebarState() {
  let saved = "";
  try { saved = localStorage.getItem(SIDEBAR_KEY) || ""; } catch { saved = ""; }
  if (saved === "1") state.sidebarCollapsed = true;
  else if (saved === "0") state.sidebarCollapsed = false;
  else state.sidebarCollapsed = window.innerWidth <= 900;
  applySidebarState();
}

async function init() {
  applyTheme(getInitialTheme(), false);
  loadSidebarState();
  loadChats();
  bindEvents();
  let initial = window.location.hash.slice(1);
  if (initial === "overview") initial = "workspace";
  if (views[initial]) state.view = initial;
  if (state.view === "chat" && !state.activeChat) state.activeChat = makeChat();
  try {
    const tasks = [loadStatus()];
    if (state.view === "workspace") tasks.push(loadInput());
    await Promise.all(tasks);
    if (state.view === "workspace" && !state.input) await loadInput();
    render();
  } catch (error) {
    showError(`Dashboard could not reach the local server. Run scripts/serve-dashboard.py and open its URL. ${error.message}`);
  }
}

init();
