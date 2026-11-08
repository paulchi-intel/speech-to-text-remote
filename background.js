// background.js — Speech-to-Text Remote service worker (MV3)

import { checkExtensionUpdate } from "./update.js";

// ── Panel mode state ──────────────────────────────────────────────────────────
let _cachedMode        = "sidepanel";   // "sidepanel" | "popup"
let _bgPopupWindowId   = null;          // chrome.windows id of the popup window
let _cachedSrcWindowId = null;          // windowId of the tab that triggered action.onClicked

async function openPopupWindow(srcWindowId) {
  // Close any existing popup first
  if (_bgPopupWindowId !== null) {
    try { await chrome.windows.remove(_bgPopupWindowId); } catch (_) {}
    _bgPopupWindowId = null;
  }
  const url = chrome.runtime.getURL("sidepanel.html") +
    (srcWindowId != null ? `?srcWindowId=${srcWindowId}` : "");
  const win = await chrome.windows.create({ url, type: "popup", width: 420, height: 620, focused: true });
  _bgPopupWindowId = win.id;
}

// Bring a window to the front. The side panel closing (window.close()) hands focus
// back to the browser window, so re-assert focus a couple of times afterwards.
async function raiseWindow(windowId) {
  if (windowId == null) return;
  for (const delay of [0, 150, 400]) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    try { await chrome.windows.update(windowId, { focused: true, drawAttention: true }); }
    catch (_) { return; }
  }
}

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === _bgPopupWindowId) _bgPopupWindowId = null;
});

async function applyPanelMode(_mode) {
  // Always keep action popup empty; icon click is handled by onClicked
  await chrome.action.setPopup({ popup: "" });
}

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(["panelMode"]);
  _cachedMode = stored.panelMode || "sidepanel";
  await applyPanelMode(_cachedMode);
});

chrome.runtime.onStartup.addListener(async () => {
  const stored = await chrome.storage.local.get(["panelMode"]);
  _cachedMode = stored.panelMode || "sidepanel";
  await applyPanelMode(_cachedMode);
});

// Open the side panel (or popup) when the extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  _cachedSrcWindowId = tab.windowId;
  if (_cachedMode === "popup") {
    openPopupWindow(tab.windowId);
  } else {
    chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

// ── Messages from the panel ───────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "CHECK_EXTENSION_UPDATE") {
    (async () => {
      try {
        const result = await checkExtensionUpdate({ force: Boolean(message.force) });
        sendResponse({ ok: true, ...result });
      } catch (err) {
        sendResponse({ ok: false, error: err.message || String(err) });
      }
    })();
    return true;
  }

  if (message.type === "SET_PANEL_MODE") {
    (async () => {
      try {
        const mode = message.mode === "popup" ? "popup" : "sidepanel";
        _cachedMode = mode;

        if (mode === "popup") {
          await chrome.storage.local.set({ panelMode: mode });
          await applyPanelMode(mode);
          await openPopupWindow(_cachedSrcWindowId);
          sendResponse({ ok: true });
          await raiseWindow(_bgPopupWindowId);
        } else {
          // sidepanel.js already called chrome.sidePanel.open() synchronously
          await chrome.storage.local.set({ panelMode: mode });
          await applyPanelMode(mode);
          sendResponse({ ok: true });
          if (_bgPopupWindowId !== null) {
            try { await chrome.windows.remove(_bgPopupWindowId); } catch (_) {}
            _bgPopupWindowId = null;
          }
          // Bring the browser window (now showing the side panel) to the front
          const srcId = message.srcWindowId ?? _cachedSrcWindowId
            ?? (await chrome.windows.getLastFocused({ windowTypes: ["normal"] }).catch(() => null))?.id;
          await raiseWindow(srcId);
        }
      } catch (err) {
        sendResponse({ ok: false, error: err.message || String(err) });
      }
    })();
    return true;
  }
});

