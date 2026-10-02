"""Conversation Alerts for Claude Code: the hook.

Runs as an async Claude Code hook for Notification, Stop, UserPromptSubmit,
PostToolUse and SessionEnd. It records what each conversation needs in an
append-only event log that the Conversation Alerts VS Code extension watches.

- Needs input (permission prompt, question, MCP form): state "waiting".
- Claude finished its reply: state "finished".
- You replied or a pending tool ran: state "working", which clears the alert.

If a VS Code window is focused, that window shows the alert and plays the
sound. Otherwise this hook shows a macOS banner and plays the sound itself.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.parse

ROOT = os.path.join(os.path.expanduser("~"), ".claude", "conversation-alerts")
EVENTS = os.path.join(ROOT, "events.jsonl")
WINDOWS = os.path.join(ROOT, "windows")
PENDING = os.path.join(ROOT, "pending")
MUTED_UNTIL = os.path.join(ROOT, "muted_until")

SOUNDS = {
    "waiting": os.path.join(ROOT, "siren.wav"),
    "finished": "/System/Library/Sounds/Glass.aiff",
}
# Notification types that mean Claude is blocked on you. idle_prompt is left
# out because Stop already covers "your turn" and idle_prompt repeats.
WAITING_TYPES = {
    "permission_prompt",
    "elicitation_dialog",
    "elicitation_url_dialog",
    "agent_needs_input",
}
MAX_EVENTS_BYTES = 512 * 1024
TITLE_SCAN_BYTES = 2 * 1024 * 1024
MAX_TEXT = 200  # keeps each log line well under the atomic-append size


def main():
    data = json.load(sys.stdin)
    session = data.get("session_id") or ""
    if not session or data.get("agent_id"):
        return  # subagents never alert

    event = data.get("hook_event_name")
    if event == "Notification":
        if data.get("notification_type") in WAITING_TYPES:
            alert(data, "waiting", waiting_message(data.get("message")))
    elif event == "Stop":
        if data.get("background_tasks"):
            return  # paused for background work, not really your turn yet
        alert(data, "finished", first_line(data.get("last_assistant_message")))
    elif event == "UserPromptSubmit":
        resolve(data, "working")
    elif event == "PostToolUse":
        # Runs after every tool call, so only log when something was waiting.
        if os.path.exists(pending_marker(session)):
            resolve(data, "working")
    elif event == "SessionEnd":
        resolve(data, "ended")


def alert(data, state, message):
    session = data["session_id"]
    project_dir = os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or ""
    title = conversation_title(data.get("transcript_path"))

    focused = [w for w in live_windows() if w.get("focused")]
    if focused:
        display = focused[0]["id"]  # that window shows the alert and plays the sound
    else:
        display = "banner"
        show_banner(session, state, project_dir, title, message)
        play_sound(state)

    if state == "waiting":
        open(pending_marker(session), "w").close()
    else:
        remove_pending(session)

    append_event({
        "session": session,
        "state": state,
        "project_dir": project_dir,
        "title": title,
        "message": message,
        "display": display,
    })


def resolve(data, state):
    session = data["session_id"]
    remove_pending(session)
    remove_banner(session)
    append_event({"session": session, "state": state})


def waiting_message(message):
    message = message or "Claude needs your input"
    if message.endswith("AskUserQuestion"):
        return "Claude has a question for you"  # questions arrive as permission prompts
    return message[:MAX_TEXT]


def first_line(text):
    """First non-empty line of Claude's reply, as plain text."""
    for line in (text or "").splitlines():
        line = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", line)  # [label](url) -> label
        line = line.replace("**", "").replace("__", "").replace("`", "")
        line = line.strip().lstrip("#*-> ").strip()
        if line:
            return line[:MAX_TEXT]
    return "Your turn"


def conversation_title(transcript_path):
    """The same title the Claude extension shows on the tab: custom title, else AI title."""
    if not transcript_path or not os.path.exists(transcript_path):
        return ""
    custom = ai = ""
    with open(transcript_path, "rb") as f:
        size = f.seek(0, os.SEEK_END)
        f.seek(max(0, size - TITLE_SCAN_BYTES))
        for raw in f:
            if b'"custom-title"' not in raw and b'"ai-title"' not in raw:
                continue
            try:
                entry = json.loads(raw)
            except ValueError:
                continue  # the first line after seeking is usually partial
            if entry.get("type") == "custom-title" and entry.get("customTitle"):
                custom = entry["customTitle"]
            elif entry.get("type") == "ai-title" and entry.get("aiTitle"):
                ai = entry["aiTitle"]
    return (custom or ai)[:MAX_TEXT]


def live_windows():
    windows = []
    if not os.path.isdir(WINDOWS):
        return windows
    for name in os.listdir(WINDOWS):
        path = os.path.join(WINDOWS, name)
        try:
            with open(path) as f:
                window = json.load(f)
        except (OSError, ValueError):
            continue
        if process_alive(window.get("pid")):
            windows.append(window)
        else:
            try_remove(path)  # VS Code quit without cleaning up
    return windows


def process_alive(pid):
    if not isinstance(pid, int) or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def show_banner(session, state, project_dir, title, message):
    if sys.platform != "darwin":
        return
    project = os.path.basename(project_dir) or "Claude"
    heading = ("🚨 " if state == "waiting" else "✓ ") + project
    subtitle = title or ("Needs your input" if state == "waiting" else "Finished")
    notifier = terminal_notifier()
    if notifier:
        # Clicking opens our URI handler, which raises the right window and conversation.
        url = "vscode://sreekanth-anubolu.claude-code-conversation-alerts/open?session=" + urllib.parse.quote(session)
        posted = run([notifier, "-title", heading, "-subtitle", subtitle, "-message", message,
                      "-group", banner_group(session), "-open", url])
        if posted:
            return
    # No terminal-notifier, or macOS has its notifications turned off. This banner
    # isn't clickable, but it still shows. Text goes in as argv, never into the script.
    run(["osascript",
         "-e", "on run argv",
         "-e", "display notification (item 1 of argv) with title (item 2 of argv) subtitle (item 3 of argv)",
         "-e", "end run",
         message, heading, subtitle])


def remove_banner(session):
    notifier = terminal_notifier()
    if notifier:
        run([notifier, "-remove", banner_group(session)])


def banner_group(session):
    return "conversation-alerts-" + session


def terminal_notifier():
    for candidate in (shutil.which("terminal-notifier"),
                      "/opt/homebrew/bin/terminal-notifier",
                      "/usr/local/bin/terminal-notifier"):
        if candidate and os.path.exists(candidate):
            return candidate
    return None


def play_sound(state):
    if sys.platform != "darwin" or muted():
        return
    sound = SOUNDS[state]
    if os.path.exists(sound):
        subprocess.Popen(["afplay", sound], start_new_session=True,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def muted():
    try:
        with open(MUTED_UNTIL) as f:
            return time.time() < float(f.read().strip())
    except (OSError, ValueError):
        return False


def append_event(event):
    event["ts"] = time.time()
    if os.path.exists(EVENTS) and os.path.getsize(EVENTS) > MAX_EVENTS_BYTES:
        open(EVENTS, "w").close()  # the extension notices the shrink and reads from the top
    fd = os.open(EVENTS, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
    with os.fdopen(fd, "a") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")


def pending_marker(session):
    return os.path.join(PENDING, session.replace("/", "_"))


def remove_pending(session):
    try_remove(pending_marker(session))


def try_remove(path):
    try:
        os.remove(path)
    except OSError:
        pass


def run(cmd):
    """Runs cmd quietly; True if it succeeded."""
    try:
        result = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0


if __name__ == "__main__":
    for directory in (ROOT, WINDOWS, PENDING):
        os.makedirs(directory, mode=0o700, exist_ok=True)
    main()
