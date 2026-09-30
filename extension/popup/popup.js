const api = typeof browser !== "undefined" ? browser : chrome;

const tokenInput = document.getElementById("token");
const repoInput = document.getElementById("repo");
const cookieInput = document.getElementById("cookie");
const syncBtn = document.getElementById("btn-sync");
const tokenBtn = document.getElementById("btn-token");
const logEl = document.getElementById("log");

const DEFAULTS = { token: "", repo: "", cookie: "" };

// Read the version from the manifest so the popup can never drift from the
// packaged build. Only the leading two components are shown, to match the
// short form used in the desktop app's title bar.
try {
  const full = api.runtime.getManifest().version || "";
  const parts = full.split(".");
  document.getElementById("version").textContent = "v" + parts.slice(0, 2).join(".");
} catch (e) { /* keep the placeholder */ }

function appendLog(line) {
  const row = document.createElement("div");
  row.textContent = line;
  logEl.appendChild(row);
  logEl.scrollTop = logEl.scrollHeight;
}

function clearLog() {
  logEl.textContent = "";
}

function setBusy(busy) {
  syncBtn.disabled = busy;
  syncBtn.textContent = busy ? "Syncing..." : "Sync Submissions";
}

function saveSettings() {
  api.storage.local.set({
    token: tokenInput.value,
    repo: repoInput.value,
    cookie: cookieInput.value
  });
}

function loadSettings(cb) {
  api.storage.local.get(DEFAULTS, (settings) => {
    tokenInput.value = settings.token || "";
    repoInput.value = settings.repo || "";
    cookieInput.value = settings.cookie || "";
    if (cb) cb();
  });
}

syncBtn.addEventListener("click", () => {
  saveSettings();
  const port = api.runtime.connect({ name: "relay-sync" });
  setBusy(true);
  clearLog();
  appendLog("Starting sync...");

  port.onMessage.addListener((msg) => {
    if (msg.type === "log") {
      appendLog(msg.line);
    } else if (msg.type === "done") {
      appendLog("Sync finished.");
      setBusy(false);
      port.disconnect();
    }
  });

  port.postMessage({
    action: "sync",
    config: {
      token: tokenInput.value.trim(),
      repo: repoInput.value.trim(),
      cookie: cookieInput.value.trim()
    }
  });
});

tokenBtn.addEventListener("click", () => {
  api.tabs.create({
    url: "https://github.com/settings/tokens/new?description=Relay+HackerRank+Sync&scopes=repo"
  });
});

document.addEventListener("DOMContentLoaded", () => loadSettings());