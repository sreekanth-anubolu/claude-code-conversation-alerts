#!/bin/bash
# Installs Conversation Alerts for Claude Code for your user: works in every project and every VS Code window.
set -euo pipefail
cd "$(dirname "$0")"

# Run from a git clone: build the package first, then install from it.
if [ ! -f notify.py ] && [ -x build.sh ]; then
  ./build.sh >/dev/null
  rm -rf dist/conversation-alerts
  (cd dist && unzip -q conversation-alerts.zip)
  exec ./dist/conversation-alerts/install.sh
fi

ROOT="$HOME/.claude/conversation-alerts"
CODE_CLI=$(command -v code || echo "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code")
if [ ! -x "$CODE_CLI" ]; then
  echo "Could not find VS Code's 'code' command. Is VS Code installed in /Applications?" >&2
  exit 1
fi
command -v python3 >/dev/null || { echo "python3 is required." >&2; exit 1; }

# Add the hooks to ~/.claude/settings.json. Everything else in the file is kept.
python3 - <<'PY'
import json, os, shutil, sys, time
path = os.path.expanduser("~/.claude/settings.json")
command = "python3 ~/.claude/conversation-alerts/notify.py"
# Earlier versions, released as "Claude Notify".
old_commands = ("python3 ~/.claude/claude-notify/notify.py", "python3 ~/.claude/hooks/notify.py")
events = ["Notification", "Stop", "UserPromptSubmit", "PostToolUse", "SessionEnd"]

settings = {}
if os.path.exists(path):
    try:
        with open(path) as f:
            settings = json.load(f)
    except ValueError as err:
        sys.exit(f"~/.claude/settings.json is not valid JSON ({err}). Fix it and run install.sh again; nothing was changed.")
    shutil.copy(path, path + ".bak-" + time.strftime("%Y%m%d-%H%M%S"))

hooks = settings.setdefault("hooks", {})
for event in list(hooks):
    groups = []
    for group in hooks[event]:
        group["hooks"] = [h for h in group.get("hooks", []) if h.get("command") not in (command, *old_commands)]
        if group["hooks"]:
            groups.append(group)
    hooks[event] = groups
    if not groups:
        del hooks[event]
for event in events:
    hooks.setdefault(event, []).append({"hooks": [{"type": "command", "command": command, "async": True}]})

with open(path, "w") as f:
    json.dump(settings, f, indent=2)
    f.write("\n")
PY

mkdir -p "$ROOT" && chmod 700 "$ROOT"
cp notify.py siren.wav "$ROOT/"

# Remove earlier versions ("Claude Notify"): their files, only if they are ours, and their extension.
if [ -f "$HOME/.claude/hooks/notify.py" ] && grep -q "vscode-notify" "$HOME/.claude/hooks/notify.py"; then
  rm -f "$HOME/.claude/hooks/notify.py" "$HOME/.claude/hooks/siren.wav"
fi
rm -rf "$HOME/.claude/vscode-notify" "$HOME/.claude/claude-notify"
"$CODE_CLI" --uninstall-extension local.claude-notify >/dev/null 2>&1 || true

"$CODE_CLI" --install-extension conversation-alerts.vsix --force 2>&1 | grep -iv deprecat || true

NOTIFIER=$(command -v terminal-notifier || true)
for candidate in /opt/homebrew/bin/terminal-notifier /usr/local/bin/terminal-notifier; do
  if [ -z "$NOTIFIER" ] && [ -x "$candidate" ]; then NOTIFIER="$candidate"; fi
done

echo
echo "Installed. Now:"
echo "  1. In every open VS Code window: Cmd+Shift+P → Developer: Reload Window"

if [ -z "$NOTIFIER" ]; then
  echo "  2. Optional: for alerts you can click when VS Code is in the background, run"
  echo "       brew install terminal-notifier"
  echo "     then run ./install.sh again to allow its notifications."
  exit 0
fi

# Allow terminal-notifier's notifications. The first notification makes macOS ask for permission.
if "$NOTIFIER" -title "Conversation Alerts" -message "Notifications are on. Alerts will look like this." \
     -group conversation-alerts-setup >/dev/null 2>&1; then
  echo "  2. Notifications are allowed (you should see a test notification)."
else
  echo "  2. Allow notifications: macOS is blocking terminal-notifier. Opening System Settings…"
  open "x-apple.systempreferences:com.apple.Notifications-Settings.extension" >/dev/null 2>&1 || true
  echo "     Find terminal-notifier and turn on Allow notifications. If macOS just asked, click Allow."
  echo "     Not in the list? Run this, then ./install.sh again so macOS asks:"
  echo "       tccutil reset UserNotification fr.julienxx.oss.terminal-notifier"
fi
echo "  3. In System Settings → Notifications → terminal-notifier, choose the Alerts style, so alerts"
echo "     stay on screen until you answer. With Banners they disappear after about 5 seconds."
