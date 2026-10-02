// Conversation Alerts for Claude Code: shows Claude Code "needs input" / "finished" alerts in the right
// VS Code window and opens the exact conversation. The hook
// (~/.claude/conversation-alerts/notify.py) writes events; every window reads them.
const vscode = require("vscode");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.join(os.homedir(), ".claude", "conversation-alerts");
const EVENTS = path.join(ROOT, "events.jsonl");
const WINDOWS = path.join(ROOT, "windows");
const CLAIMS = path.join(ROOT, "claims");
const MUTED_UNTIL = path.join(ROOT, "muted_until");
const PENDING_OPEN = path.join(ROOT, "pending-open.json");
const SOUNDS = {
  waiting: path.join(ROOT, "siren.wav"),
  finished: "/System/Library/Sounds/Glass.aiff",
};

const REPEAT_MS = 2 * 60 * 1000; // repeat the siren while a conversation is still waiting
const FINISHED_TTL_MS = 60 * 60 * 1000;
const WAITING_TTL_MS = 12 * 60 * 60 * 1000;
const CLAUDE_PANEL = "claudeVSCodePanel";

const windowId = String(process.pid); // one extension host per window
const sessions = new Map(); // session id -> { state, project_dir, title, message, ts }
let offset = 0;
let statusItem;

function activate(context) {
  for (const dir of [ROOT, WINDOWS, CLAIMS]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  registerWindow();
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState(registerWindow),
    vscode.workspace.onDidChangeWorkspaceFolders(registerWindow),
    { dispose: unregisterWindow }
  );

  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusItem.command = "conversationAlerts.showList";
  context.subscriptions.push(
    statusItem,
    vscode.commands.registerCommand("conversationAlerts.showList", showList),
    vscode.window.registerUriHandler({ handleUri })
  );

  // Rebuild state from history without alerting, then follow new events.
  readEvents(false);
  fs.watchFile(EVENTS, { interval: 500 }, () => readEvents(true));
  context.subscriptions.push({ dispose: () => fs.unwatchFile(EVENTS) });

  const timer = setInterval(tick, 20 * 1000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  openPendingConversation();
  updateStatus();
}

// ---- window registry: tells the hook which window is focused and what it has open

function registerWindow() {
  const folders = (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath);
  const focused = vscode.window.state.focused;
  writeJsonAtomic(path.join(WINDOWS, `${windowId}.json`), {
    id: windowId,
    pid: process.pid,
    folders,
    focused,
    focusedAt: focused ? Date.now() : previousFocusedAt(),
  });
}

function previousFocusedAt() {
  const self = readJson(path.join(WINDOWS, `${windowId}.json`));
  return (self && self.focusedAt) || 0;
}

function unregisterWindow() {
  tryRemove(path.join(WINDOWS, `${windowId}.json`));
}

function liveWindows() {
  let names = [];
  try {
    names = fs.readdirSync(WINDOWS);
  } catch {
    return [];
  }
  return names
    .map((name) => readJson(path.join(WINDOWS, name)))
    .filter((w) => w && processAlive(w.pid));
}

// The window whose open folder contains the conversation's project folder.
function ownerWindow(projectDir) {
  let best = null;
  let bestLength = -1;
  for (const w of liveWindows()) {
    for (const folder of w.folders || []) {
      if (isInside(projectDir, folder) && folder.length > bestLength) {
        best = { window: w, folder };
        bestLength = folder.length;
      }
    }
  }
  return best;
}

// ---- events

function readEvents(alertNew) {
  let size;
  try {
    size = fs.statSync(EVENTS).size;
  } catch {
    return;
  }
  if (size < offset) offset = 0; // the hook truncated the log
  if (size === offset) return;

  const fd = fs.openSync(EVENTS, "r");
  const buffer = Buffer.alloc(size - offset);
  fs.readSync(fd, buffer, 0, buffer.length, offset);
  fs.closeSync(fd);

  // Only consume complete lines; a partial last line is read next time.
  const text = buffer.toString("utf8");
  const end = text.lastIndexOf("\n");
  if (end < 0) return;
  offset += Buffer.byteLength(text.slice(0, end + 1));

  for (const line of text.slice(0, end).split("\n")) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    applyEvent(event, alertNew);
  }
  updateStatus();
}

function applyEvent(event, alertNew) {
  if (event.type === "open") {
    if (alertNew && event.target === windowId) openHere(event.session);
    return;
  }
  if (event.state === "waiting" || event.state === "finished") {
    sessions.set(event.session, event);
    if (alertNew && event.display === windowId) showAlert(event);
  } else {
    sessions.delete(event.session); // working, ended or seen
  }
}

function appendEvent(event) {
  event.ts = Date.now() / 1000;
  fs.appendFileSync(EVENTS, JSON.stringify(event) + "\n", { mode: 0o600 });
}

// ---- alerts

async function showAlert(event) {
  if (event.state === "finished" && isConversationVisible(event.title)) return;
  playSound(event.state);

  const text =
    event.state === "waiting"
      ? `🚨 ${label(event)} needs you: ${event.message}`
      : `✓ ${label(event)} finished: ${event.message}`;
  const show = event.state === "waiting" ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
  const choice = await show(text, "Open conversation");
  if (choice) openConversation(event.session);
}

// True when this focused window's active Claude tab is that conversation.
function isConversationVisible(title) {
  if (!vscode.window.state.focused || !title) return false;
  const tabLabel = title.length > 25 ? title.slice(0, 24) + "…" : title; // same cut as the Claude tab
  return vscode.window.tabGroups.all.some((group) => {
    const tab = group.activeTab;
    return (
      tab &&
      tab.input instanceof vscode.TabInputWebview &&
      tab.input.viewType.includes(CLAUDE_PANEL) &&
      tab.label === tabLabel
    );
  });
}

function playSound(state) {
  if (process.platform !== "darwin" || isMuted()) return;
  const sound = SOUNDS[state];
  if (fs.existsSync(sound)) spawn("afplay", [sound], { detached: true, stdio: "ignore" }).unref();
}

// Every window ticks, but a claim file per time slot lets only one of them repeat the siren.
function tick() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    const ttl = s.state === "waiting" ? WAITING_TTL_MS : FINISHED_TTL_MS;
    if (now - s.ts * 1000 > ttl) sessions.delete(id);
  }
  updateStatus();

  const overdue = [...sessions.values()].some((s) => s.state === "waiting" && now - s.ts * 1000 >= REPEAT_MS);
  if (overdue && !isMuted() && claim(`repeat-${Math.floor(now / REPEAT_MS)}`)) playSound("waiting");
  cleanClaims(now);
}

function claim(name) {
  try {
    fs.closeSync(fs.openSync(path.join(CLAIMS, name), "wx"));
    return true;
  } catch {
    return false;
  }
}

function cleanClaims(now) {
  for (const name of safeReaddir(CLAIMS)) {
    const file = path.join(CLAIMS, name);
    try {
      if (now - fs.statSync(file).mtimeMs > 10 * 60 * 1000) fs.unlinkSync(file);
    } catch {}
  }
}

// ---- opening a conversation

function handleUri(uri) {
  const session = new URLSearchParams(uri.query).get("session");
  if (uri.path === "/open" && session) openConversation(session);
}

// Only conversations we were told about can be opened, so a crafted link can't open arbitrary folders.
function openConversation(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) {
    vscode.window.showInformationMessage("Conversation Alerts: that conversation is no longer waiting.");
    return;
  }
  const owner = ownerWindow(s.project_dir);
  if (owner && owner.window.id === windowId) {
    openHere(sessionId);
  } else if (owner) {
    raiseFolder(owner.folder);
    appendEvent({ type: "open", session: sessionId, target: owner.window.id });
  } else {
    // No window has the project open: open it, and the new window picks up the conversation.
    writeJsonAtomic(PENDING_OPEN, { session: sessionId, folder: s.project_dir, ts: Date.now() });
    raiseFolder(s.project_dir);
  }
}

function openHere(sessionId) {
  vscode.commands.executeCommand("claude-vscode.primaryEditor.open", sessionId);
  const s = sessions.get(sessionId);
  if (s && s.state === "finished") appendEvent({ session: sessionId, state: "seen" });
}

function openPendingConversation() {
  const pending = readJson(PENDING_OPEN);
  if (!pending || Date.now() - pending.ts > 60 * 1000) return;
  const folders = (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath);
  if (folders.some((folder) => isInside(pending.folder, folder))) {
    tryRemove(PENDING_OPEN);
    openHere(pending.session);
  }
}

// `code <folder>` focuses the window that already has the folder open, or opens a new one.
function raiseFolder(folder) {
  const cli = path.join(vscode.env.appRoot, "bin", "code");
  spawn(cli, [folder], { detached: true, stdio: "ignore" }).unref();
}

// ---- status bar and list

function updateStatus() {
  const all = [...sessions.values()];
  const waiting = all.filter((s) => s.state === "waiting").length;
  const finished = all.length - waiting;
  const bell = isMuted() ? "$(bell-slash)" : "$(bell)";

  const parts = [bell];
  if (waiting) parts.push(`${waiting} waiting`);
  if (finished) parts.push(`$(check) ${finished}`);
  statusItem.text = parts.join(" ");
  statusItem.backgroundColor = waiting ? new vscode.ThemeColor("statusBarItem.warningBackground") : undefined;
  statusItem.tooltip = waiting
    ? `${waiting} Claude conversation(s) waiting for you`
    : "Conversation Alerts: no conversation is waiting";
  statusItem.show();
}

async function showList() {
  const items = [...sessions.entries()]
    .sort(([, a], [, b]) => (a.state === b.state ? b.ts - a.ts : a.state === "waiting" ? -1 : 1))
    .map(([id, s]) => ({
      label: `${s.state === "waiting" ? "$(alert)" : "$(check)"} ${label(s)}`,
      description: s.message,
      detail: `${s.state === "waiting" ? "Waiting" : "Finished"} ${ago(s.ts)}`,
      session: id,
    }));

  const actions = [
    { label: "", kind: vscode.QuickPickItemKind.Separator },
    isMuted()
      ? { label: "$(bell) Unmute", action: "unmute" }
      : { label: "$(bell-slash) Mute sounds for 1 hour", action: "mute" },
  ];
  if ([...sessions.values()].some((s) => s.state === "finished")) {
    actions.push({ label: "$(clear-all) Clear finished", action: "clear" });
  }

  const picked = await vscode.window.showQuickPick([...items, ...actions], {
    placeHolder: items.length ? "Open a Claude conversation" : "No Claude conversation needs you",
  });
  if (!picked) return;
  if (picked.session) openConversation(picked.session);
  else if (picked.action === "mute") fs.writeFileSync(MUTED_UNTIL, String(Date.now() / 1000 + 3600));
  else if (picked.action === "unmute") tryRemove(MUTED_UNTIL);
  else if (picked.action === "clear") {
    for (const [id, s] of sessions) if (s.state === "finished") appendEvent({ session: id, state: "seen" });
  }
  updateStatus();
}

// ---- helpers

function label(s) {
  const project = path.basename(s.project_dir || "") || "Claude";
  return s.title ? `${project} · ${s.title}` : project;
}

function ago(ts) {
  const minutes = Math.round((Date.now() / 1000 - ts) / 60);
  return minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`;
}

function isMuted() {
  try {
    return Date.now() / 1000 < parseFloat(fs.readFileSync(MUTED_UNTIL, "utf8"));
  } catch {
    return false;
  }
}

function isInside(child, parent) {
  if (!child || !parent) return false;
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function tryRemove(file) {
  try {
    fs.unlinkSync(file);
  } catch {}
}

module.exports = { activate, deactivate: unregisterWindow };
