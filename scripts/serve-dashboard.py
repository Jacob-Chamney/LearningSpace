#!/usr/bin/env python3
"""Local LearningSpace web dashboard.

Serves the workspace on localhost and exposes fixed local actions for managing
input files and asking the read-only Plan agent for help.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import threading
import webbrowser
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parents[1]
INPUT_DIR = ROOT / "input"
GOAL_PATH = INPUT_DIR / "assignmentGoal.txt"

OUTPUTS = [
    "AssignmentGuide/assignment-guide.md",
    "StudyGuide/study-guide.md",
    "StudyGuide/study-guide-answers.md",
    "Flashcards/flashcards.md",
    "Flashcards/flashcards.html",
]

CHAT_MODEL = os.environ.get("OPENCODE_WEB_MODEL", "deepseek/deepseek-v4-pro")
MAX_UPLOAD = 100 * 1024 * 1024
MAX_GOAL = 500_000
MAX_MESSAGE = 8_000


def file_info(relative: str) -> dict:
    path = ROOT / relative
    if not path.exists():
        return {"path": relative, "exists": False}
    stat = path.stat()
    return {
        "path": relative,
        "exists": True,
        "size": stat.st_size,
        "modified": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M"),
    }


def input_files() -> list[dict]:
    files = []
    for path in sorted(INPUT_DIR.rglob("*")):
        if not path.is_file():
            continue
        if path.name in {"AGENTS.md", "assignmentGoal.txt"}:
            continue
        files.append(file_info(str(path.relative_to(ROOT))))
    return files


def status_payload() -> dict:
    return {
        "outputs": [file_info(relative) for relative in OUTPUTS],
        "inputs": input_files(),
    }


def input_payload() -> dict:
    return {
        "goal": GOAL_PATH.read_text(encoding="utf-8") if GOAL_PATH.exists() else "",
        "goalInfo": file_info("input/assignmentGoal.txt"),
        "files": input_files(),
    }


class DashboardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/":
            self.send_response(302)
            self.send_header("Location", "/web/")
            self.end_headers()
            return
        if path == "/api/status":
            self.send_json(status_payload())
            return
        if path == "/api/input":
            self.send_json(input_payload())
            return
        if path.startswith("/.git") or path.startswith("/Memory/.obsidian"):
            self.send_error(404)
            return
        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/input/goal":
            self.save_goal()
            return
        if parsed.path == "/api/input/upload":
            self.upload_input(parsed)
            return
        if parsed.path == "/api/chat":
            self.chat()
            return
        self.send_error(404)

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/input":
            self.delete_input(parsed)
            return
        self.send_error(404)

    def send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_body(self, limit: int) -> bytes:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length < 0 or length > limit:
            raise ValueError(f"Request is too large (limit {limit} bytes)")
        return self.rfile.read(length)

    def save_goal(self) -> None:
        try:
            body = json.loads(self.read_body(MAX_GOAL + 1024).decode("utf-8"))
            text = body.get("text")
            if not isinstance(text, str):
                raise ValueError("Expected a text field")
            if len(text) > MAX_GOAL:
                raise ValueError("Assignment instructions are too large")
            INPUT_DIR.mkdir(parents=True, exist_ok=True)
            GOAL_PATH.write_text(text, encoding="utf-8")
            self.send_json({"ok": True, "info": file_info("input/assignmentGoal.txt")})
        except Exception as error:
            self.send_json({"ok": False, "error": str(error)}, status=400)

    def upload_input(self, parsed) -> None:
        try:
            name = unquote(parse_qs(parsed.query).get("name", [""])[0])
            valid_name(name)
            data = self.read_body(MAX_UPLOAD)
            INPUT_DIR.mkdir(parents=True, exist_ok=True)
            path = INPUT_DIR / name
            path.write_bytes(data)
            self.send_json({"ok": True, "info": file_info(str(path.relative_to(ROOT)))})
        except Exception as error:
            self.send_json({"ok": False, "error": str(error)}, status=400)

    def delete_input(self, parsed) -> None:
        try:
            name = unquote(parse_qs(parsed.query).get("name", [""])[0])
            valid_name(name)
            path = INPUT_DIR / name
            if not path.exists():
                raise ValueError("File not found")
            path.unlink()
            self.send_json({"ok": True})
        except Exception as error:
            self.send_json({"ok": False, "error": str(error)}, status=400)

    def chat(self) -> None:
        try:
            body = json.loads(self.read_body(MAX_MESSAGE + 1024).decode("utf-8"))
            message = body.get("message", "").strip()
            session_id = body.get("sessionID", "")
            if not message:
                raise ValueError("Message is empty")
            if len(message) > MAX_MESSAGE:
                raise ValueError("Message is too long")
            if session_id and not re.fullmatch(r"ses_[A-Za-z0-9]+", session_id):
                raise ValueError("Invalid chat session")
            text, error = self.run_chat(message, session_id)
            if error:
                self.send_json({"ok": False, "error": error}, status=502)
            else:
                self.send_json({"ok": True, "text": text})
        except Exception as error:
            self.send_json({"ok": False, "error": str(error)}, status=400)

    def run_chat(self, message: str, session_id: str) -> tuple[str, str | None]:
        if not shutil_which("opencode"):
            return "", "OpenCode is not installed or not on PATH."

        command = [
            "opencode",
            "run",
            "--format",
            "json",
            "--agent",
            "plan",
        ]
        if CHAT_MODEL:
            command.extend(["--model", CHAT_MODEL])
        if session_id:
            command.extend(["--session", session_id])
        if message.startswith("-"):
            message = "User question: " + message
        command.append(message)

        try:
            result = subprocess.run(
                command,
                cwd=ROOT,
                capture_output=True,
                text=True,
                timeout=240,
            )
        except subprocess.TimeoutExpired:
            return "", "The agent did not finish within 240 seconds."
        except Exception as error:
            return "", str(error)

        texts = []
        errors = []
        for line in result.stdout.splitlines():
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("type") == "text":
                part = event.get("part", {})
                if isinstance(part.get("text"), str):
                    texts.append(part["text"])
            elif event.get("type") == "error":
                error = event.get("error", {})
                if isinstance(error, dict):
                    errors.append(str(error.get("message") or error))
                else:
                    errors.append(str(error))

        if errors:
            return "", " ".join(errors)
        text = "\n".join(texts).strip()
        if text:
            return text, None
        fallback = (result.stdout + "\n" + result.stderr).strip()
        return "", fallback or "The agent returned no text."

    def log_message(self, format: str, *args) -> None:
        print(f"[dashboard] {self.address_string()} {format % args}")


def valid_name(name: str) -> None:
    if not name or name in {"AGENTS.md", "assignmentGoal.txt"}:
        raise ValueError("That filename is reserved")
    if name.startswith(".") or len(name) > 200:
        raise ValueError("Invalid filename")
    if Path(name).name != name or "/" in name or "\\" in name or "\x00" in name:
        raise ValueError("Invalid filename")


def shutil_which(command: str) -> str | None:
    for directory in os.environ.get("PATH", "").split(os.pathsep):
        candidate = Path(directory) / command
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the LearningSpace dashboard.")
    parser.add_argument("--port", type=int, default=8765, help="Port to bind (default: 8765)")
    parser.add_argument("--no-browser", action="store_true", help="Do not open a browser")
    args = parser.parse_args()

    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), DashboardHandler)
    except OSError as error:
        print(f"Could not start dashboard: {error}")
        print("Try a different port: scripts/serve-dashboard.py --port 8766")
        raise SystemExit(1)

    port = server.server_address[1]
    url = f"http://127.0.0.1:{port}/web/"
    print(f"LearningSpace dashboard: {url}")
    print("Press Ctrl+C to stop.")

    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping dashboard.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
