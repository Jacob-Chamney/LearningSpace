#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

python3 - "$ROOT" <<'PY'
from pathlib import Path
import json
import re
import sys
from html import escape

root = Path(sys.argv[1])
source = root / "Flashcards" / "flashcards.md"
output = root / "Flashcards" / "flashcards.html"

if not source.exists():
    print("No Flashcards/flashcards.md yet; skipping HTML deck.")
    sys.exit(0)

text = source.read_text(encoding="utf-8")

title_match = re.search(r"^# (.+)$", text, re.MULTILINE)
title = title_match.group(1).strip() if title_match else "Flashcards"
updated_match = re.search(r"^\*\*Last updated:\*\* (.+)$", text, re.MULTILINE)
updated = updated_match.group(1).strip() if updated_match else ""

parts = re.split(r"(?m)^\*\*(\d+)\) (.+?)\*\*[ \t]*$", text)
intro = parts[0]
cards = []

for index in range(1, len(parts), 3):
    number = parts[index]
    section_title = parts[index + 1].strip()
    body = parts[index + 2]
    if section_title.lower() in {"source map", "open questions"}:
        continue

    question_parts = []
    answer_parts = []
    state = "answer"

    for raw_line in body.splitlines():
        line = raw_line.strip()
        if not line or line == "&nbsp;":
            continue
        if line.startswith("- "):
            line = line[2:].strip()
        if line.startswith("**Q:**"):
            state = "question"
            question_parts.append(line[len("**Q:**"):].strip())
        elif line.startswith("**A:**"):
            state = "answer"
            answer_parts.append(line[len("**A:**"):].strip())
        elif line.startswith("**") and line.endswith("**"):
            state = "answer"
            answer_parts.append(line.strip("*"))
        else:
            if state == "question":
                question_parts.append(line)
            else:
                answer_parts.append(line)

    if not question_parts and not answer_parts:
        continue

    cards.append({
        "number": number,
        "title": section_title,
        "question": " ".join(part for part in question_parts if part),
        "answers": [part for part in answer_parts if part],
    })

if not cards:
    print("No flashcard sections found in Flashcards/flashcards.md.", file=sys.stderr)
    sys.exit(1)

sources = []
capturing = False
for line in intro.splitlines():
    stripped = line.strip()
    if stripped.startswith("**Sources scanned:**"):
        capturing = True
        value = stripped[len("**Sources scanned:**"):].strip()
        if value:
            sources.append(value)
        continue
    if capturing:
        if not stripped or stripped.startswith("**"):
            break
        sources.append(stripped)

payload = json.dumps(
    {
        "title": title,
        "updated": updated,
        "sources": " ".join(sources),
        "cards": cards,
    },
    ensure_ascii=False,
).replace("</", "<\\/")

html = r'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <title>__TITLE__ | LearningSpace Flashcards</title>
  <style>
    :root {
      --bg: #080b16;
      --bg-soft: #0f1527;
      --panel: rgba(17, 24, 39, 0.82);
      --panel-strong: #111827;
      --text: #f8fafc;
      --muted: #94a3b8;
      --subtle: #64748b;
      --line: rgba(148, 163, 184, 0.18);
      --indigo: #818cf8;
      --violet: #a78bfa;
      --cyan: #22d3ee;
      --green: #34d399;
      --shadow: 0 32px 80px rgba(0, 0, 0, 0.45);
    }

    * { box-sizing: border-box; }
    html { min-height: 100%; background: var(--bg); }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
    }

    button { font: inherit; }

    .page {
      width: min(960px, calc(100% - 32px));
      margin: 0 auto;
      padding: 34px 0 44px;
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      margin-bottom: 40px;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }

    .brand-mark {
      display: grid;
      width: 34px;
      height: 34px;
      place-items: center;
      border: 1px solid var(--line-strong);
      border-radius: 9px;
      background: var(--panel-strong);
      color: var(--text);
      font-size: 15px;
      letter-spacing: 0;
    }

    .deck-meta {
      color: var(--subtle);
      font-size: 13px;
      text-align: right;
    }

    .deck-meta strong { color: var(--muted); font-weight: 600; }

    .hero {
      max-width: 760px;
      margin-bottom: 26px;
    }

    .eyebrow {
      margin: 0 0 12px;
      color: var(--indigo);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }

    h1 {
      max-width: 820px;
      margin: 0;
      font-size: clamp(34px, 6vw, 64px);
      font-weight: 750;
      letter-spacing: -0.045em;
      line-height: 0.98;
    }

    .sources {
      max-width: 760px;
      margin: 18px 0 0;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.6;
    }

    .progress-row {
      display: flex;
      align-items: center;
      gap: 16px;
      margin: 32px 0 14px;
    }

    .progress-track {
      flex: 1;
      height: 7px;
      overflow: hidden;
      border-radius: 99px;
      background: color-mix(in srgb, var(--muted) 14%, transparent);
    }

    .progress-fill {
      width: 0;
      height: 100%;
      border-radius: inherit;
      background: var(--indigo);
      transition: width 240ms ease;
    }

    .progress-label {
      min-width: 92px;
      color: var(--muted);
      font-size: 13px;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    .stage {
      position: relative;
      perspective: 1600px;
    }

    .card-shell {
      position: relative;
      min-height: 410px;
      cursor: pointer;
      transform-style: preserve-3d;
      transition: transform 620ms cubic-bezier(0.2, 0.75, 0.25, 1);
      outline: none;
    }

    .card-shell:focus-visible {
      border-radius: 28px;
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--indigo) 55%, transparent);
    }

    .card-shell.is-flipped { transform: rotateY(180deg); }

    .card-face {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      overflow: auto;
      padding: 38px;
      border: 1px solid var(--line);
      border-radius: 16px;
      backface-visibility: hidden;
      -webkit-backface-visibility: hidden;
    }

    .card-front {
      background: var(--panel-strong);
    }

    .card-back {
      background: var(--bg-soft);
      transform: rotateY(180deg);
    }

    .card-topline {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      margin-bottom: 28px;
    }

    .card-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border: 1px solid color-mix(in srgb, var(--indigo) 28%, transparent);
      border-radius: 999px;
      color: var(--text);
      background: color-mix(in srgb, var(--indigo) 10%, transparent);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    .card-badge::before {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--cyan);
      content: "";
      box-shadow: 0 0 12px color-mix(in srgb, var(--cyan) 90%, transparent);
    }

    .flip-hint, .answer-count {
      color: var(--subtle);
      font-size: 12px;
    }

    .card-title {
      margin: 0 0 18px;
      font-size: clamp(24px, 4vw, 38px);
      font-weight: 700;
      letter-spacing: -0.035em;
      line-height: 1.1;
    }

    .question {
      margin: 0;
      color: var(--text);
      font-size: clamp(21px, 3.5vw, 30px);
      font-weight: 500;
      line-height: 1.35;
      letter-spacing: -0.02em;
    }

    .answer-list {
      margin: 0;
      padding: 0;
      list-style: none;
      color: var(--text);
      font-size: 17px;
      line-height: 1.65;
    }

    .answer-list li {
      position: relative;
      margin: 0 0 14px;
      padding-left: 22px;
    }

    .answer-list li::before {
      position: absolute;
      top: 0.68em;
      left: 2px;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--cyan);
      content: "";
      box-shadow: 0 0 12px color-mix(in srgb, var(--cyan) 35%, transparent);
    }

    .answer-list code, .sources code {
      padding: 2px 6px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: color-mix(in srgb, var(--muted) 10%, transparent);
      color: var(--text);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.9em;
    }

    .answer-list strong { color: var(--text); font-weight: 700; }

    .controls {
      display: grid;
      grid-template-columns: 1fr 1.2fr 1fr;
      gap: 10px;
      margin-top: 22px;
    }

    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 46px;
      padding: 11px 16px;
      border: 1px solid var(--line-strong);
      border-radius: 9px;
      color: var(--text);
      background: transparent;
      cursor: pointer;
      font-size: 13px;
      font-weight: 650;
      transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;
    }

    .button:hover {
      border-color: var(--line-strong);
      background: color-mix(in srgb, var(--muted) 8%, transparent);
    }

    .button:active { transform: translateY(0); }

    .button.primary {
      border-color: transparent;
      color: var(--bg);
      background: var(--indigo);
    }

    .button.primary:hover { background: color-mix(in srgb, var(--indigo) 80%, var(--text)); }

    .secondary-controls {
      display: flex;
      justify-content: center;
      gap: 10px;
      margin-top: 10px;
    }

    .secondary-controls .button {
      min-height: 36px;
      padding: 6px 12px;
      border-color: transparent;
      color: var(--subtle);
      background: transparent;
      font-size: 12px;
    }

    .secondary-controls .button:hover {
      color: var(--text);
      background: color-mix(in srgb, var(--muted) 10%, transparent);
    }

    .keyboard-hint {
      margin: 24px 0 0;
      color: var(--subtle);
      font-size: 12px;
      text-align: center;
    }

    .keyboard-hint kbd {
      display: inline-block;
      min-width: 21px;
      margin: 0 2px;
      padding: 2px 5px;
      border: 1px solid var(--line);
      border-bottom-width: 2px;
      border-radius: 5px;
      color: var(--muted);
      background: color-mix(in srgb, var(--panel-strong) 72%, transparent);
      font-family: inherit;
      font-size: 11px;
      text-align: center;
    }

    .status {
      min-height: 18px;
      margin-top: 10px;
      color: var(--muted);
      font-size: 12px;
      text-align: center;
    }

    .empty {
      padding: 40px;
      border: 1px solid var(--line);
      border-radius: 24px;
      color: var(--muted);
      background: var(--panel);
      text-align: center;
    }

    @media (max-width: 640px) {
      .page { width: min(100% - 22px, 960px); padding-top: 22px; }
      .topbar { align-items: flex-start; margin-bottom: 30px; }
      .deck-meta { max-width: 44%; font-size: 11px; line-height: 1.5; }
      .card-shell { min-height: 410px; }
      .card-face { padding: 24px; border-radius: 22px; }
      .card-topline { margin-bottom: 22px; }
      .flip-hint { display: none; }
      .controls { grid-template-columns: 1fr 1fr; }
      .controls .button.primary { grid-column: 1 / -1; grid-row: 1; }
      .answer-list { font-size: 16px; }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        scroll-behavior: auto !important;
        transition-duration: 0.01ms !important;
        animation-duration: 0.01ms !important;
      }
    }
  </style>
</head>
<body>
  <main class="page">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark">LS</span>
        <span>LearningSpace / Flashcards</span>
      </div>
      <div class="deck-meta">
        <div><strong>__UPDATED__</strong></div>
        <div>Browser deck</div>
      </div>
    </header>

    <section class="hero" aria-labelledby="deck-title">
      <p class="eyebrow">Active recall deck</p>
      <h1 id="deck-title">__TITLE__</h1>
      <p class="sources" id="deck-sources"></p>
    </section>

    <div class="progress-row">
      <div class="progress-track" role="progressbar" aria-label="Deck progress" aria-valuemin="1" aria-valuemax="1" aria-valuenow="1">
        <div class="progress-fill" id="progress-fill"></div>
      </div>
      <div class="progress-label" id="progress-label">1 / 1</div>
    </div>

    <section class="stage" aria-label="Flashcard">
      <div class="card-shell" id="card" tabindex="0" role="button" aria-label="Flashcard. Click or press Space to flip.">
        <article class="card-face card-front">
          <div class="card-topline">
            <span class="card-badge" id="front-badge">Card 01</span>
            <span class="flip-hint">Click to reveal</span>
          </div>
          <h2 class="card-title" id="front-title"></h2>
          <p class="question" id="front-question"></p>
        </article>

        <article class="card-face card-back">
          <div class="card-topline">
            <span class="card-badge">Answer</span>
            <span class="answer-count" id="answer-count"></span>
          </div>
          <h2 class="card-title" id="back-title"></h2>
          <ul class="answer-list" id="answer-list"></ul>
        </article>
      </div>
    </section>

    <nav class="controls" aria-label="Flashcard controls">
      <button class="button" type="button" id="prev">← Previous</button>
      <button class="button primary" type="button" id="flip">Flip card <span aria-hidden="true">↻</span></button>
      <button class="button" type="button" id="next">Next →</button>
    </nav>

    <div class="secondary-controls">
      <button class="button" type="button" id="shuffle">Shuffle deck</button>
      <button class="button" type="button" id="reset">Reset</button>
    </div>

    <p class="keyboard-hint">
      <kbd>←</kbd> <kbd>→</kbd> navigate · <kbd>Space</kbd> flip ·
      <kbd>S</kbd> shuffle · <kbd>R</kbd> reset
    </p>
    <p class="status" id="status" aria-live="polite"></p>
  </main>

  <script src="../web/themes.js"></script>
  <script>
    const deck = __CARDS_JSON__;

    const card = document.getElementById("card");
    const frontBadge = document.getElementById("front-badge");
    const frontTitle = document.getElementById("front-title");
    const frontQuestion = document.getElementById("front-question");
    const backTitle = document.getElementById("back-title");
    const answerList = document.getElementById("answer-list");
    const answerCount = document.getElementById("answer-count");
    const progressFill = document.getElementById("progress-fill");
    const progressLabel = document.getElementById("progress-label");
    const progressTrack = document.querySelector(".progress-track");
    const status = document.getElementById("status");
    const deckSources = document.getElementById("deck-sources");

    let order = deck.cards.map((_, index) => index);
    let current = 0;
    let flipped = false;

    function applyThemePalette(colors) {
      if (!colors) return;
      const root = document.documentElement;
      root.style.setProperty("--bg", colors.bg);
      root.style.setProperty("--bg-soft", colors.bgSoft);
      root.style.setProperty("--panel", colors.panelStrong);
      root.style.setProperty("--panel-strong", colors.panelStrong);
      root.style.setProperty("--text", colors.text);
      root.style.setProperty("--muted", colors.muted);
      root.style.setProperty("--subtle", colors.subtle);
      root.style.setProperty("--line", `color-mix(in srgb, ${colors.line} 55%, transparent)`);
      root.style.setProperty("--indigo", colors.primary);
      root.style.setProperty("--violet", colors.secondary);
      root.style.setProperty("--cyan", colors.accent);
      root.style.setProperty("--green", colors.success);
      root.style.setProperty("--amber", colors.warning);
      root.style.setProperty("--danger", colors.danger);
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function formatInline(value) {
      return escapeHtml(value)
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    }

    function render() {
      if (!deck.cards.length) return;
      const item = deck.cards[order[current]];
      const displayNumber = String(current + 1).padStart(2, "0");
      const total = deck.cards.length;

      frontBadge.textContent = "Card " + displayNumber;
      frontTitle.innerHTML = formatInline(item.title);
      frontQuestion.innerHTML = formatInline(item.question || item.title);
      backTitle.innerHTML = formatInline(item.title);
      answerList.innerHTML = item.answers.map((answer) => "<li>" + formatInline(answer) + "</li>").join("");
      answerCount.textContent = item.answers.length + " key point" + (item.answers.length === 1 ? "" : "s");
      progressLabel.textContent = (current + 1) + " / " + total;
      progressFill.style.width = (((current + 1) / total) * 100) + "%";
      progressTrack.setAttribute("aria-valuemax", String(total));
      progressTrack.setAttribute("aria-valuenow", String(current + 1));
      card.classList.toggle("is-flipped", flipped);
      card.setAttribute("aria-label", flipped ? "Flashcard answer. Click or press Space to show the question." : "Flashcard question. Click or press Space to reveal the answer.");
    }

    function setStatus(message) {
      status.textContent = message;
    }

    function flip() {
      flipped = !flipped;
      card.classList.toggle("is-flipped", flipped);
      card.setAttribute("aria-label", flipped ? "Flashcard answer. Click or press Space to show the question." : "Flashcard question. Click or press Space to reveal the answer.");
      setStatus(flipped ? "Answer revealed." : "Question shown.");
    }

    function move(delta) {
      if (!deck.cards.length) return;
      current = (current + delta + deck.cards.length) % deck.cards.length;
      flipped = false;
      render();
      setStatus("Card " + (current + 1) + " of " + deck.cards.length + ".");
    }

    function shuffle() {
      for (let i = order.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      current = 0;
      flipped = false;
      render();
      setStatus("Deck shuffled.");
    }

    function reset() {
      order = deck.cards.map((_, index) => index);
      current = 0;
      flipped = false;
      render();
      setStatus("Deck reset to its original order.");
    }

    deckSources.innerHTML = deck.sources ? "Sources: " + formatInline(deck.sources) : "";
    document.title = deck.title + " | LearningSpace Flashcards";

    document.getElementById("prev").addEventListener("click", () => move(-1));
    document.getElementById("next").addEventListener("click", () => move(1));
    document.getElementById("flip").addEventListener("click", flip);
    document.getElementById("shuffle").addEventListener("click", shuffle);
    document.getElementById("reset").addEventListener("click", reset);
    card.addEventListener("click", flip);

    document.addEventListener("keydown", (event) => {
      if (event.target instanceof HTMLButtonElement) return;
      if (event.key === "ArrowLeft") { event.preventDefault(); move(-1); }
      if (event.key === "ArrowRight") { event.preventDefault(); move(1); }
      if (event.key === " " || event.key === "Enter") { event.preventDefault(); flip(); }
      if (event.key.toLowerCase() === "s") shuffle();
      if (event.key.toLowerCase() === "r") reset();
    });

    window.addEventListener("message", (event) => {
      if (!event.data || event.data.type !== "learningspace-theme") return;
      applyThemePalette(event.data.colors);
    });

    const requestedTheme = new URLSearchParams(window.location.search).get("theme");
    let storedTheme = "";
    try { storedTheme = localStorage.getItem("learningspace-theme") || ""; } catch { /* ignore */ }
    const selectedTheme = requestedTheme || storedTheme || "learningspace";
    const palette = (window.LEARNINGSPACE_THEMES || []).find((theme) => theme.id === selectedTheme);
    if (palette) applyThemePalette(palette.colors);

    render();
  </script>
</body>
</html>
'''

html = html.replace("__TITLE__", escape(title))
html = html.replace("__UPDATED__", escape(updated or "Current deck"))
html = html.replace("__CARDS_JSON__", payload)
output.write_text(html, encoding="utf-8")
print(f"Built {output.relative_to(root)}")
print(f"  - cards: {len(cards)}")
PY
