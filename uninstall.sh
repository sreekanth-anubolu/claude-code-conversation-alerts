#!/bin/bash
# Removes Conversation Alerts for Claude Code, and any earlier "Claude Notify" version. Every other setting and hook is left alone.
set -euo pipefail
CODE_CLI=$(command -v code || echo "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code")

python3 - <<'PY'
import json, os
path = os.path.expanduser("~/.claude/settings.json")
ours = ("python3 ~/.claude/conversation-alerts/notify.py",
        "python3 ~/.claude/claude-notify/notify.py", "python3 ~/.claude/hooks/notify.py")
if os.path.exists(path):
    with open(path) as f:
        settings = json.load(f)
    hooks = settings.get("hooks", {})
    for event in list(hooks):
        groups = []
        for group in hooks[event]:
            group["hooks"] = [h for h in group.get("hooks", []) if h.get("command") not in ours]
            if group["hooks"]:
                groups.append(group)
        if groups:
            hooks[event] = groups
        else:
            del hooks[event]
    if not hooks:
        settings.pop("hooks", None)
    with open(path, "w") as f:
        json.dump(settings, f, indent=2)
        f.write("\n")
PY

rm -rf "$HOME/.claude/conversation-alerts" "$HOME/.claude/claude-notify" "$HOME/.claude/vscode-notify"
if [ -x "$CODE_CLI" ]; then
  "$CODE_CLI" --uninstall-extension sreekanth-anubolu.claude-code-conversation-alerts 2>&1 | grep -iv deprecat || true
  "$CODE_CLI" --uninstall-extension local.claude-notify >/dev/null 2>&1 || true
fi
echo "Uninstalled. Reload VS Code windows to finish."
