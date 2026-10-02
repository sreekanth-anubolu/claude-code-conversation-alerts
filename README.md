# Conversation Alerts for Claude Code

Running several Claude Code conversations in VS Code? Conversation Alerts tells you the moment one needs you, and takes you straight to that conversation.

> Not affiliated with or endorsed by Anthropic. "Claude" and "Claude Code" are trademarks of Anthropic.

Works on macOS with VS Code and the Claude Code VS Code extension 2.1.233 or newer.

## Features

### What it alerts you about

- 🚨 **Needs input**, with a siren:
  - a permission prompt ("Claude needs your permission to use Bash")
  - a question from Claude ("Claude has a question for you")
  - an MCP server's form or browser link
  - a background agent that needs you
- ✓ **Finished, your turn**, with a softer sound. The alert shows the first line of Claude's reply.
- Every alert names the **project and the conversation**, using the same title as the Claude tab (your custom title, or Claude's own).

### Where the alert appears

- **In VS Code:** a VS Code notification in the window you're using. It's yellow for "needs input" and blue for "finished".
- **In another app:** a macOS banner instead. You never get both.
- **One alert per event,** however many VS Code windows you have open.
- **No "finished" alert for the conversation you're already looking at.**

### Getting to the conversation

- **Open conversation** (on the alert, the banner or the list) opens that exact conversation in the Claude Code chat panel.
- **The right window:** if the conversation belongs to another VS Code window, that window comes to the front first.
- **Not open anywhere:** if no window has the project open, it opens the project in a new window, then the conversation.
- Conversations started in a subfolder or git worktree still find their window.

### Keeping track

- **Status bar:** shows `🔔 2 waiting ✓ 1`, and turns yellow while anything is waiting.
- **List:** click the status bar, or run **Conversation Alerts: Show waiting conversations**, to see every waiting and finished conversation with how long ago it happened. Pick one to jump to it.
- **Repeats** the siren about every 2 minutes while a conversation is still waiting. Only one window plays it.
- **Clears by itself** when you reply, approve the tool, Claude finishes, or the conversation ends. The macOS banner is removed too. Finished items also drop off after an hour.
- **Mute sounds for an hour** from the list, or clear all finished items. The alerts still show while muted.

### Quiet and safe

- **No false alarms:** subagents and Claude's own background work never alert, and the repeating "idle" notification is ignored.
- **Never slows Claude down:** the hooks run in the background.
- **Stays on your Mac:** no network calls, and the event log is readable only by you.
- **Light:** needs only `python3` and VS Code. `terminal-notifier` is optional, for clickable banners. No Node or npm.
- **Safe install:** backs up `~/.claude/settings.json`, keeps your other settings and hooks, and changes nothing if the file isn't valid JSON. Running it again is harmless, and it upgrades older versions. `uninstall.sh` removes everything it added.

## Install

    git clone https://github.com/sreekanth-anubolu/claude-code-conversation-alerts.git
    cd claude-code-conversation-alerts
    ./install.sh

Then:

1. **Reload** every VS Code window (Cmd+Shift+P → **Developer: Reload Window**).
2. **Allow notifications** for clickable banners (optional, recommended):
   - Run `brew install terminal-notifier`, then `./install.sh` again.
   - The installer sends a test notification. When macOS asks, click **Allow**.
   - If notifications are blocked, the installer opens System Settings → Notifications for you: find **terminal-notifier** and turn on **Allow notifications**.
3. **Choose the Alerts style** in System Settings → Notifications → **terminal-notifier**. Banners disappear after about 5 seconds; Alerts stay until you answer, and are removed for you once you do.

`install.sh` also works from the unzipped `conversation-alerts.zip` package (see [Build from source](#build-from-source)).

## Uninstall

    ./uninstall.sh

## Good to know

- To use a different siren, replace `~/.claude/conversation-alerts/siren.wav` with any WAV file. Reinstalling puts the original back.
- Everything lives in `~/.claude/conversation-alerts/`. Nothing is added to any project.
- If you deny a permission prompt, the alert stays until Claude replies or you send a message, because Claude Code sends no hook for a denial.
- **Open conversation** uses an undocumented command of the Claude Code extension. If an update breaks it, the alerts still work.
- If macOS blocks the scripts as downloaded from the internet: `xattr -dr com.apple.quarantine conversation-alerts`

## How it works

1. A Python hook (`notify.py`) runs on `Notification`, `Stop`, `UserPromptSubmit`, `PostToolUse` and `SessionEnd`. It appends what each conversation needs to `~/.claude/conversation-alerts/events.jsonl`.
2. Each VS Code window registers its open folders and whether it's focused. If a window is focused, the hook leaves the alert to it. Otherwise the hook shows a macOS banner and plays the sound.
3. The VS Code extension in every window reads the event log. It shows the alert, keeps the status-bar list, and repeats the siren.
4. **Open conversation** finds the window whose folder contains the conversation's project. It raises that window and opens the conversation through the Claude Code extension.

## Build from source

    ./build.sh

This writes `dist/conversation-alerts.vsix` and `dist/conversation-alerts.zip`, the package with the install script. No Node or npm needed.

## Inspired by

[dimokol/claude-notifications](https://github.com/dimokol/claude-notifications), [ryuk2098/claude-code-notify](https://github.com/ryuk2098/claude-code-notify), [Tri9ster/hooknotice](https://github.com/Tri9ster/hooknotice) and [zekunyan/claude-code-notifier-plus](https://github.com/zekunyan/claude-code-notifier-plus).

## License

[MIT](LICENSE)
