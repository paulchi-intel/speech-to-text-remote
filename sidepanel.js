// sidepanel.js — Speech-to-Text Remote Chrome Extension
// Qwen3-ASR 1.7B transcription panel (remote GPU backend) with task queue

'use strict';

// ── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_BACKEND_URL = '';  // set by the user in the ⚙ popover; never hard-coded
const HEALTH_POLL_MS = 5000;
const MAX_UPLOAD_MB  = 200;   // matches ASR_MAX_UPLOAD_MB on the server

// Passed by background.js when opening in popup mode (?srcWindowId=N)
const POPUP_SRC_WINDOW_ID = (() => {
  const id = parseInt(new URLSearchParams(window.location.search).get('srcWindowId'), 10);
  return Number.isFinite(id) ? id : null;
})();

// ── SVG icons ────────────────────────────────────────────────────────────────
const SVG_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const ICONS = {
  stop:   `<svg class="hb-icon" ${SVG_ATTRS}><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/></svg>`,
  reload: `<svg class="hb-icon" ${SVG_ATTRS} stroke-width="2.4"><path d="M3 12a9 9 0 1 0 2.6-6.4"/><path d="M3 4v5h5"/></svg>`,
  remove: `<svg class="hb-icon" ${SVG_ATTRS} stroke-width="2.4"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
  copy:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g class="ic-copy"><rect x="9" y="9" width="11" height="11" rx="2.4"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></g><path class="ic-check" d="M5 12.5 10 17.5 19.5 7"/></svg>`,
  chevron: `<svg class="hb-icon" ${SVG_ATTRS} stroke-width="2.4"><path d="M6 9l6 6 6-6"/></svg>`,
  grip:   `<svg class="hb-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>`,
  // Panel mode: shown on the button as the mode it switches TO
  popup:  `<svg class="hb-icon" ${SVG_ATTRS}><rect x="3" y="8" width="13" height="12" rx="2"/><path d="M8 8V6a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3"/></svg>`,
  sidepanel: `<svg class="hb-icon" ${SVG_ATTRS}><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M14 5v14"/></svg>`,
};

// ── i18n translations ────────────────────────────────────────────────────────
const TRANSLATIONS = {
  en: {
    'status-checking':       'Checking backend…',
    'status-ready':          'B70 ready — Qwen3-ASR 1.7B',
    'status-loading-model':  'B70 is loading the model (first run downloads ~5 GB)…',
    'status-offline':        'B70 server unreachable',
    'status-generating':     'Transcribing…',
    'status-error':          'Error',
    'retry-backend':         'Retry',
    'label-server':          'Server',
    'step1-title':           'Choose audio',
    'step2-title':           'Choose language',
    'step3-title':           'Transcribe',
    'step2-hint':            'Not sure? Keep “Auto detect”. Picking the language improves accuracy.',
    'missing-prefix':        'Still needed: ',
    'missing-audio':         'an audio file',
    'missing-server':        'connection to B70',
    'missing-loading':       'B70 to finish loading the model',
    'list-sep':              ', ',
    'step3-ready':           'All set — press “Transcribe”.',
    'server-settings':       'Server settings',
    'status-no-server':      'Set the server address in ⚙ first',
    'update-available':      'New version available: Speech-to-Text Remote v{version}',
    'update-download':       'Download',
    'update-downloading':    'Downloading…',
    'update-downloaded':     'Downloaded. Unzip over the old files, then Reload in chrome://extensions.',
    'update-show':           'Show in folder',
    'update-failed':         'Download failed — opened the release page instead.',
    'update-dismiss':        'Dismiss this version',
    'copy':                  'Copy',
    'copied':                'Copied',
    'expand':                'Expand',
    'collapse':              'Collapse',
    'tab-setup':             'Setup',
    'tab-queue':             'Queue',
    'drop-label':            'Drop an audio file here',
    'drop-hint':             'or click to browse (wav, mp3, m4a, ogg, webm, flac)',
    'label-language':        'Language',
    'lang-auto':             'Auto detect',
    'btn-generate':          'Transcribe',
    'err-no-audio':          'Please choose an audio file.',
    'err-not-audio':         'That file is not an audio file.',
    'err-too-large':         'The file is larger than {mb} MB.',
    'err-backend-offline':   'Cannot reach the B70 ASR server. Check the Server address and that the speech-to-text-asr container is running.',
    'no-speech':             '(no speech recognized)',
    'queue-empty':           'No tasks yet. Go to "Setup" and click "Transcribe" to add tasks.',
    'queue-go-setup':        'Go to Setup',
    'task-waiting':          'Waiting',
    'task-generating':       'Transcribing',
    'task-done':             'Done',
    'task-error':            'Error',
    'task-stopped':          'Stopped',
    'panel-mode-to-popup':   'Switch to Popup',
    'panel-mode-to-sidepanel': 'Switch to Side Panel',
  },
  'zh-TW': {
    'status-checking':       '正在檢查後端…',
    'status-ready':          'B70 就緒 — Qwen3-ASR 1.7B',
    'status-loading-model':  'B70 正在載入模型（首次執行需下載約 5 GB）…',
    'status-offline':        '無法連線到 B70 伺服器',
    'status-generating':     '轉錄中…',
    'status-error':          '錯誤',
    'retry-backend':         '重試',
    'label-server':          '伺服器',
    'step1-title':           '選擇音訊',
    'step2-title':           '選擇語言',
    'step3-title':           '開始轉錄',
    'step2-hint':            '不確定就選「自動偵測」；指定語言可提高準確度。',
    'missing-prefix':        '還缺：',
    'missing-audio':         '音訊檔',
    'missing-server':        '連線到 B70',
    'missing-loading':       'B70 載入模型完成',
    'list-sep':              '、',
    'step3-ready':           '一切就緒，按下「開始轉錄」即可。',
    'server-settings':       '伺服器設定',
    'status-no-server':      '請先點 ⚙ 設定伺服器位址',
    'update-available':      '發現新版本：Speech-to-Text Remote v{version}',
    'update-download':       '下載更新',
    'update-downloading':    '下載中…',
    'update-downloaded':     '已下載。請解壓縮並覆蓋舊檔案，再到 chrome://extensions 按「重新載入」。',
    'update-show':           '在資料夾中顯示',
    'update-failed':         '下載失敗，已改為開啟 Release 頁面。',
    'update-dismiss':        '忽略此版本',
    'copy':                  '複製',
    'copied':                '已複製',
    'expand':                '展開',
    'collapse':              '收合',
    'tab-setup':             '設定',
    'tab-queue':             '佇列',
    'drop-label':            '拖放音訊檔至此',
    'drop-hint':             '或點擊以瀏覽（wav、mp3、m4a、ogg、webm、flac）',
    'label-language':        '語言',
    'lang-auto':             '自動偵測',
    'btn-generate':          '開始轉錄',
    'err-no-audio':          '請選擇音訊檔。',
    'err-not-audio':         '這不是音訊檔。',
    'err-too-large':         '檔案超過 {mb} MB。',
    'err-backend-offline':   '無法連線到 B70 ASR 伺服器，請確認伺服器位址，以及 speech-to-text-asr container 是否在執行。',
    'no-speech':             '（沒有辨識到語音）',
    'queue-empty':           '尚無任務。在「設定」頁按下「開始轉錄」即可加入佇列。',
    'queue-go-setup':        '前往設定',
    'task-waiting':          '等待中',
    'task-generating':       '轉錄中',
    'task-done':             '完成',
    'task-error':            '錯誤',
    'task-stopped':          '已停止',
    'panel-mode-to-popup':   '切換至彈窗',
    'panel-mode-to-sidepanel': '切換至側欄',
  },
  'zh-CN': {
    'status-checking':       '正在检查后端…',
    'status-ready':          'B70 就绪 — Qwen3-ASR 1.7B',
    'status-loading-model':  'B70 正在加载模型（首次运行需下载约 5 GB）…',
    'status-offline':        '无法连接到 B70 服务器',
    'status-generating':     '转录中…',
    'status-error':          '错误',
    'retry-backend':         '重试',
    'label-server':          '服务器',
    'step1-title':           '选择音频',
    'step2-title':           '选择语言',
    'step3-title':           '开始转录',
    'step2-hint':            '不确定就选「自动检测」；指定语言可提高准确度。',
    'missing-prefix':        '还缺：',
    'missing-audio':         '音频文件',
    'missing-server':        '连接到 B70',
    'missing-loading':       'B70 加载模型完成',
    'list-sep':              '、',
    'step3-ready':           '一切就绪，点击「开始转录」即可。',
    'server-settings':       '服务器设置',
    'status-no-server':      '请先点 ⚙ 设置服务器地址',
    'update-available':      '发现新版本：Speech-to-Text Remote v{version}',
    'update-download':       '下载更新',
    'update-downloading':    '下载中…',
    'update-downloaded':     '已下载。请解压并覆盖旧文件，再到 chrome://extensions 点击「重新加载」。',
    'update-show':           '在文件夹中显示',
    'update-failed':         '下载失败，已改为打开 Release 页面。',
    'update-dismiss':        '忽略此版本',
    'copy':                  '复制',
    'copied':                '已复制',
    'expand':                '展开',
    'collapse':              '收起',
    'tab-setup':             '设置',
    'tab-queue':             '队列',
    'drop-label':            '拖放音频文件至此',
    'drop-hint':             '或点击以浏览（wav、mp3、m4a、ogg、webm、flac）',
    'label-language':        '语言',
    'lang-auto':             '自动检测',
    'btn-generate':          '开始转录',
    'err-no-audio':          '请选择音频文件。',
    'err-not-audio':         '这不是音频文件。',
    'err-too-large':         '文件超过 {mb} MB。',
    'err-backend-offline':   '无法连接到 B70 ASR 服务器，请确认服务器地址，以及 speech-to-text-asr container 是否在运行。',
    'no-speech':             '（没有识别到语音）',
    'queue-empty':           '尚无任务。在「设置」页点击「开始转录」即可加入队列。',
    'queue-go-setup':        '前往设置',
    'task-waiting':          '等待中',
    'task-generating':       '转录中',
    'task-done':             '完成',
    'task-error':            '错误',
    'task-stopped':          '已停止',
    'panel-mode-to-popup':   '切换至弹窗',
    'panel-mode-to-sidepanel': '切换至侧栏',
  },
};

// ── State ────────────────────────────────────────────────────────────────────
let currentLang   = 'en';
let panelMode     = 'sidepanel';  // 'sidepanel' | 'popup'
let backendOnline = false;
let modelLoading  = false;  // server reachable but model still loading
let backendUrl    = DEFAULT_BACKEND_URL;
let audioFileData = null;   // { name, base64, mime, durationSec }
let pollTimer     = null;

// Task queue: array of { id, seq, audioFileData, language, status, text, detectedLanguage, errorMsg }
let taskQueue              = [];
let isProcessing           = false;
let nextTaskId             = 1;
let nextSeq                = 1;
let currentAbortController = null;  // AbortController for the in-flight fetch

// ── DOM refs ─────────────────────────────────────────────────────────────────
const statusBar        = document.getElementById('statusBar');
const statusDot        = document.getElementById('statusDot');
const statusText       = document.getElementById('statusText');
const startBackendBtn  = document.getElementById('startBackendBtn');
const serverUrlInput   = document.getElementById('serverUrlInput');
const serverGearBtn    = document.getElementById('serverGearBtn');
const serverPop        = document.getElementById('serverPop');
const step1Card        = document.getElementById('step1');
const step1Head        = document.getElementById('step1Head');
const step1Summary     = document.getElementById('step1Summary');
const step2Card        = document.getElementById('step2');
const step3Card        = document.getElementById('step3');
const stepMissing      = document.getElementById('stepMissing');
const stepMissingText  = document.getElementById('stepMissingText');
const langSelect       = document.getElementById('langSelect');
const tabSetup         = document.getElementById('tabSetup');
const tabQueue         = document.getElementById('tabQueue');
const queueBadge       = document.getElementById('queueBadge');
const panelSetup       = document.getElementById('panelSetup');
const panelQueue       = document.getElementById('panelQueue');
const audioDropZone    = document.getElementById('audioDropZone');
const audioFileInput   = document.getElementById('audioFileInput');
const audioFileName    = document.getElementById('audioFileName');
const audioRemoveBtn   = document.getElementById('audioRemoveBtn');
const refAudioPreview  = document.getElementById('refAudioPreview');
const refAudioPlayer   = document.getElementById('refAudioPlayer');
const languageSelect   = document.getElementById('languageSelect');
const generateBtn      = document.getElementById('generateBtn');
const msgBox           = document.getElementById('msgBox');
const queueContent     = document.getElementById('queueContent');
const queueEmpty       = document.getElementById('queueEmpty');
const panelModeBtn     = document.getElementById('panelModeBtn');

// ── i18n helpers ─────────────────────────────────────────────────────────────
function t(key) {
  return (TRANSLATIONS[currentLang] || TRANSLATIONS.en)[key] || key;
}
function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
}

// ── Language selector ─────────────────────────────────────────────────────────
langSelect.addEventListener('change', () => {
  currentLang = langSelect.value;
  applyTranslations();
  refreshStatusUI();
  updatePanelModeBtn();
  updateSteps();
  reconvertTranscripts();
  saveState();
});

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(name) {
  const isSetup = name === 'setup';
  panelSetup.classList.toggle('hidden', !isSetup);
  panelQueue.classList.toggle('hidden',  isSetup);
  tabSetup.classList.toggle('active',  isSetup);
  tabQueue.classList.toggle('active',  !isSetup);
}
tabSetup.addEventListener('click', () => switchTab('setup'));
tabQueue.addEventListener('click', () => switchTab('queue'));
document.getElementById('queueEmptyCta').addEventListener('click', () => switchTab('setup'));

// ── Badge ──────────────────────────────────────────────────────────────────────
function updateBadge() {
  const pending = taskQueue.filter((t) => t.status === 'waiting' || t.status === 'generating').length;
  if (pending > 0) {
    queueBadge.textContent = pending;
    queueBadge.classList.remove('hidden');
  } else {
    queueBadge.classList.add('hidden');
  }
}

// ── Status helpers ────────────────────────────────────────────────────────────
function setStatus(state, customText) {
  statusDot.className = 'status-dot';
  startBackendBtn.style.display = 'none';
  serverGearBtn.classList.toggle('attn', state === 'offline' || state === 'nourl');

  if (state === 'ready') {
    statusText.textContent = customText || t('status-ready');
  } else if (state === 'loading') {
    statusDot.classList.add('loading');
    statusText.textContent = customText || t('status-loading-model');
  } else if (state === 'generating') {
    statusDot.classList.add('loading');
    statusText.textContent = t('status-generating');
  } else if (state === 'nourl') {
    statusDot.classList.add('offline');
    statusText.textContent = t('status-no-server');
    serverGearBtn.classList.add('attn');
  } else if (state === 'offline') {
    statusDot.classList.add('offline');
    statusText.textContent = t('status-offline');
    startBackendBtn.style.display = 'inline-flex';
  } else if (state === 'error') {
    statusDot.classList.add('error');
    statusText.textContent = customText || t('status-error');
  } else {
    statusDot.classList.add('loading');
    statusText.textContent = t('status-checking');
  }
}
function refreshStatusUI() { setStatus(backendOnline ? 'ready' : modelLoading ? 'loading' : !backendUrl ? 'nourl' : 'offline'); }

// ── Message box ───────────────────────────────────────────────────────────────
function showMsg(text, type = 'error') {
  msgBox.className = `msg-box show ${type}`;
  msgBox.textContent = text;
}
function hideMsg() {
  msgBox.className = 'msg-box';
  msgBox.textContent = '';
}

// ── Generate button enable ─────────────────────────────────────────────────────
// ── Step cards: completion state, missing-items hint, collapse ────────────────
function step1Done() { return audioFileData !== null; }

function setStep1Collapsed(collapsed) {
  step1Card.classList.toggle('collapsed', collapsed);
}

function formatDuration(sec) {
  if (!Number.isFinite(sec)) return '';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function updateSteps() {
  const d1 = step1Done();
  // The language always has a value (Auto detect by default), so step 2 is done once step 1 is
  step1Card.classList.toggle('done', d1);
  step2Card.classList.toggle('done', d1);
  const current = d1 ? 3 : 1;
  step1Card.classList.toggle('current', current === 1);
  step2Card.classList.toggle('current', false);
  step3Card.classList.toggle('current', current === 3);

  step1Summary.textContent = audioFileData
    ? [audioFileData.name, formatDuration(audioFileData.durationSec)].filter(Boolean).join(' · ')
    : '';

  const missing = [];
  if (!audioFileData)      missing.push(t('missing-audio'));
  if (!backendOnline)      missing.push(t(modelLoading ? 'missing-loading' : 'missing-server'));
  stepMissing.classList.toggle('ready', missing.length === 0);
  stepMissingText.textContent = missing.length === 0
    ? t('step3-ready')
    : t('missing-prefix') + missing.join(t('list-sep'));
}

function updateGenerateBtn() {
  updateSteps();
  generateBtn.disabled = !(backendOnline && audioFileData !== null);
}

// ── Backend health check ──────────────────────────────────────────────────────
async function checkBackend() {
  if (!backendUrl) {
    backendOnline = false;
    modelLoading  = false;
    refreshStatusUI();
    updateGenerateBtn();
    return false;
  }
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(`${backendUrl}/health`, { signal: ctrl.signal });
    const data = res.ok ? await res.json().catch(() => ({})) : {};
    backendOnline = data.status === 'ok' && data.model_loaded === true;
    modelLoading  = data.status === 'ok' && !data.model_loaded && !data.model_error;
  } catch {
    backendOnline = false;
    modelLoading  = false;
  }
  refreshStatusUI();
  updateGenerateBtn();
  return backendOnline;
}
function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(checkBackend, HEALTH_POLL_MS);
}

// ── Extension update notice ───────────────────────────────────────────────────
const updateBanner     = document.getElementById('updateBanner');
const updateMessage    = document.getElementById('updateMessage');
const updateActionBtn  = document.getElementById('updateActionBtn');
const updateDismissBtn = document.getElementById('updateDismissBtn');
const extensionVersion = document.getElementById('extensionVersion');
let availableUpdate  = null;   // { latestVersion, releaseUrl, assetUrl }
let updateDownloadId = null;

function renderInstalledVersion() {
  extensionVersion.textContent = `v${chrome.runtime.getManifest().version}`;
}

function renderUpdateBanner(messageKey = 'update-available') {
  renderInstalledVersion();
  if (!availableUpdate?.latestVersion) { updateBanner.hidden = true; return; }
  updateMessage.textContent = t(messageKey).replace('{version}', availableUpdate.latestVersion);
  updateBanner.hidden = false;
}

async function checkForExtensionUpdate(force = false) {
  renderInstalledVersion();
  const result = await chrome.runtime.sendMessage({ type: 'CHECK_EXTENSION_UPDATE', force }).catch(() => null);
  if (!result?.ok || !result.updateAvailable || !result.latestVersion) return;
  const stored = await chrome.storage.local.get('dismissedUpdateVersion');
  if (stored.dismissedUpdateVersion === result.latestVersion) return;
  availableUpdate = {
    latestVersion: result.latestVersion,
    releaseUrl:    result.releaseUrl,
    assetUrl:      result.assetUrl,
  };
  renderUpdateBanner();
}

async function downloadUpdate() {
  if (!availableUpdate) return;
  if (!availableUpdate.assetUrl) {  // no ZIP attached to the release: open its page
    chrome.tabs.create({ url: availableUpdate.releaseUrl });
    return;
  }
  updateActionBtn.disabled = true;
  updateActionBtn.textContent = t('update-downloading');
  try {
    updateDownloadId = await chrome.downloads.download({
      url: availableUpdate.assetUrl,
      filename: `speech-to-text-remote-v${availableUpdate.latestVersion}.zip`,
      saveAs: false,
    });
  } catch (_) {
    updateFailed();
  }
}

function updateFailed() {
  updateActionBtn.disabled = false;
  updateActionBtn.textContent = t('update-download');
  updateMessage.textContent = t('update-failed');
  if (availableUpdate?.releaseUrl) chrome.tabs.create({ url: availableUpdate.releaseUrl });
}

chrome.downloads?.onChanged.addListener((delta) => {
  if (delta.id !== updateDownloadId) return;
  if (delta.state?.current === 'complete') {
    updateActionBtn.disabled = false;
    updateActionBtn.textContent = t('update-show');
    updateActionBtn.dataset.done = '1';
    renderUpdateBanner('update-downloaded');
  } else if (delta.state?.current === 'interrupted' || delta.error) {
    updateFailed();
  }
});

updateActionBtn.addEventListener('click', () => {
  if (updateActionBtn.dataset.done === '1') chrome.downloads.show(updateDownloadId);
  else downloadUpdate();
});
updateDismissBtn.addEventListener('click', async () => {
  if (!availableUpdate?.latestVersion) return;
  await chrome.storage.local.set({ dismissedUpdateVersion: availableUpdate.latestVersion });
  availableUpdate = null;
  renderUpdateBanner();
});

// ── Server address ────────────────────────────────────────────────────────────
function normalizeUrl(url) {
  let v = (url || '').trim().replace(/\/+$/, '');
  if (v && !/^https?:\/\//i.test(v)) v = 'http://' + v;
  return v || DEFAULT_BACKEND_URL;
}

// The server address is user-supplied, so ask Chrome for access to that one origin
async function ensureServerPermission(url) {
  try {
    const origins = [new URL(url).origin + '/*'];
    if (!(await chrome.permissions.contains({ origins }))) await chrome.permissions.request({ origins });
  } catch (_) { /* fall back to the server's CORS headers */ }
}
serverUrlInput.addEventListener('change', async () => {
  backendUrl = normalizeUrl(serverUrlInput.value);
  serverUrlInput.value = backendUrl;
  chrome.storage.local.set({ backendUrl });
  setStatus('checking');
  if (backendUrl) await ensureServerPermission(backendUrl);
  checkBackend();
});

startBackendBtn.addEventListener('click', () => { setStatus('checking'); checkBackend(); });

step1Head.addEventListener('click', () => {
  step1Card.classList.toggle('collapsed');
});

serverGearBtn.addEventListener('click', () => {
  const open = serverPop.classList.toggle('open');
  serverGearBtn.classList.toggle('open', open);
  serverGearBtn.setAttribute('aria-expanded', String(open));
  if (open) setTimeout(() => serverUrlInput.focus(), 120);
});

// ── File drop zone ────────────────────────────────────────────────────────────
const AUDIO_EXT = /\.(wav|mp3|m4a|aac|ogg|oga|opus|webm|flac|mp4)$/i;
function isAudioFile(file) {
  return (file.type || '').startsWith('audio/') || AUDIO_EXT.test(file.name || '');
}

audioDropZone.addEventListener('click', (e) => {
  if (e.target.closest('#audioRemoveBtn')) return;
  audioFileInput.click();
});
audioFileInput.addEventListener('change', () => {
  const file = audioFileInput.files[0];
  if (file) loadAudioFile(file);
  audioFileInput.value = '';
});
audioRemoveBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  clearAudioFile();
});
['dragenter', 'dragover'].forEach((ev) =>
  audioDropZone.addEventListener(ev, (e) => {
    e.preventDefault();
    audioDropZone.classList.add('drag-over');
  })
);
['dragleave', 'dragend'].forEach((ev) =>
  audioDropZone.addEventListener(ev, () => audioDropZone.classList.remove('drag-over'))
);
audioDropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  audioDropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) loadAudioFile(file);
});

function showAudio(data) {
  audioDropZone.classList.add('has-file');
  audioFileName.textContent = data.name;
  refAudioPlayer.src = `data:${data.mime || 'audio/wav'};base64,${data.base64}`;
  refAudioPreview.classList.add('show');
}

function loadAudioFile(file) {
  hideMsg();
  if (!isAudioFile(file)) { showMsg(t('err-not-audio')); return; }
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) { showMsg(t('err-too-large').replace('{mb}', MAX_UPLOAD_MB)); return; }
  const reader = new FileReader();
  reader.onload = (e) => {
    const base64 = e.target.result.split(',')[1];
    audioFileData = { name: file.name, base64, mime: file.type || 'audio/wav', durationSec: null };
    showAudio(audioFileData);
    // Read the duration once the browser has parsed the file (shown in the step summary)
    refAudioPlayer.addEventListener('loadedmetadata', () => {
      if (audioFileData && Number.isFinite(refAudioPlayer.duration)) {
        audioFileData.durationSec = refAudioPlayer.duration;
        updateSteps();
        saveState();
      }
    }, { once: true });
    updateGenerateBtn();
    saveState();
  };
  reader.readAsDataURL(file);
}

function clearAudioFile() {
  audioFileData = null;
  audioDropZone.classList.remove('has-file');
  audioFileName.textContent = '';
  refAudioPlayer.removeAttribute('src');
  refAudioPreview.classList.remove('show');
  updateGenerateBtn();
  saveState();
}

languageSelect.addEventListener('change', saveState);

// ── Transcript script (繁 / 简) follows the UI language ───────────────────────
const CHINESE_LANGS = new Set(['Chinese', 'Cantonese']);
function scriptForUi() {
  return currentLang === 'zh-TW' ? 'zh-TW' : currentLang === 'zh-CN' ? 'zh-CN' : '';
}

// Re-render finished Chinese transcripts after the UI language changes
async function reconvertTranscripts() {
  const script  = scriptForUi();
  const targets = taskQueue.filter((tk) =>
    tk.status === 'done' && tk.rawText && CHINESE_LANGS.has(tk.detectedLanguage) && (tk.textScript || '') !== script);
  if (!targets.length || !backendUrl) return;
  try {
    const res = await fetch(`${backendUrl}/convert`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ texts: targets.map((tk) => tk.rawText), script }),
    });
    const data = await res.json();
    if (!res.ok || data.status !== 'ok') return;
    targets.forEach((tk, i) => {
      tk.text       = data.texts[i];
      tk.textScript = script;
      updateTaskCard(tk);
    });
    saveState();
  } catch (_) { /* server unreachable: keep the current text, retry on next change */ }
}

// ── Enqueue task (generate button) ────────────────────────────────────────────
// Press feedback: replay the squash + wave launch on each press (also for Enter/Space)
function playGenPress() {
  if (generateBtn.disabled) return;
  generateBtn.classList.remove('go');
  void generateBtn.offsetWidth;
  generateBtn.classList.add('go');
}
generateBtn.addEventListener('pointerdown', playGenPress);
generateBtn.addEventListener('click', (e) => { if (e.detail === 0) playGenPress(); });
generateBtn.addEventListener('animationend', (e) => {
  // Keep .go until the last bar's launch finishes so it always plays out fully
  if (e.animationName === 'wave-launch' && e.target.classList.contains('b5')) generateBtn.classList.remove('go');
});

generateBtn.addEventListener('click', () => {
  hideMsg();
  if (!audioFileData)                         { showMsg(t('err-no-audio'));       return; }
  if (!backendOnline)                         { showMsg(t('err-backend-offline')); return; }

  const task = {
    id:               nextTaskId++,
    seq:              nextSeq++,
    audioFileData:    audioFileData,
    language:         languageSelect.value,
    status:           'waiting',
    text:             '',
    detectedLanguage: null,
    errorMsg:         null,
  };

  taskQueue.push(task);
  renderTaskCard(task);
  updateBadge();
  // The file is now in the queue; clear step 1 so the next file can be picked right away
  clearAudioFile();

  switchTab('queue');
  processQueue();
});

// ── Queue processor ────────────────────────────────────────────────────────────
async function processQueue() {
  if (isProcessing) return;
  const task = taskQueue.find((t) => t.status === 'waiting');
  if (!task) return;

  isProcessing = true;
  currentAbortController = new AbortController();
  task.status = 'generating';
  updateTaskCard(task);
  startElapsedTimer(task.id);
  updateBadge();
  statusBar.classList.add('generating');
  setStatus('generating');

  try {
    const res = await fetch(`${backendUrl}/transcribe`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  currentAbortController.signal,
      body: JSON.stringify({
        audio_base64: task.audioFileData.base64,
        filename:     task.audioFileData.name,
        language:     task.language,
        script:       scriptForUi(),
      }),
    });
    const data = await res.json();
    if (!res.ok || data.status !== 'ok') throw new Error(data.error || `HTTP ${res.status}`);
    task.text             = data.text || '';
    task.rawText          = data.raw_text ?? data.text ?? '';
    task.textScript       = scriptForUi();
    task.detectedLanguage = data.language || null;
    if (Number.isFinite(data.duration_sec)) task.audioFileData.durationSec = data.duration_sec;
    task.status = 'done';
  } catch (err) {
    // If aborted (user removed the card), silently discard
    if (err.name === 'AbortError') {
      // Check if card still exists — if removed it's cancelled, otherwise stopped
      task.status = document.getElementById(`task-${task.id}`) ? 'stopped' : 'cancelled';
    } else {
      task.errorMsg = err.message;
      task.status = 'error';
    }
  }

  currentAbortController = null;
  isProcessing = false;
  stopElapsedTimer(task.id, task);
  statusBar.classList.remove('generating');

  if (task.status === 'cancelled') {
    // Card was already removed from DOM by the remove handler
    taskQueue = taskQueue.filter((t) => t.id !== task.id);
    renumberTasks();
    if (taskQueue.length === 0) { queueEmpty.style.display = ''; nextSeq = 1; nextTaskId = 1; }
    updateBadge();
    saveState();
    refreshStatusUI();
  } else if (task.status === 'stopped') {
    updateTaskCard(task);
    updateBadge();
    saveState();
    refreshStatusUI();
  } else {
    updateTaskCard(task);
    updateBadge();
    saveState();
    refreshStatusUI();
  }

  // Continue with next waiting task
  processQueue();
}

// ── Task text: expand/collapse + copy ─────────────────────────────────────────
const TEXT_CLAMP_H = 54;            // 3 lines at 12px x 1.5
const expandedTaskIds = new Set();  // UI-only; not persisted

function measureTaskText(card) {
  const clip = card.querySelector('.task-text-clip');
  const btn  = card.querySelector('.task-expand-btn');
  if (!clip || !btn || clip.clientWidth === 0) return;  // hidden tab: measure later
  const overflowing = clip.scrollHeight > TEXT_CLAMP_H + 1;
  clip.classList.toggle('clamped', overflowing);
  btn.hidden = !overflowing;
}

function setTaskExpanded(card, taskId, expand) {
  const clip  = card.querySelector('.task-text-clip');
  const btn   = card.querySelector('.task-expand-btn');
  if (expand) {
    clip.style.maxHeight = clip.scrollHeight + 'px';
    clip.classList.add('expanded');
    expandedTaskIds.add(taskId);
    // Release the fixed height once the animation is done so resizing reflows
    setTimeout(() => { if (clip.classList.contains('expanded')) clip.style.maxHeight = 'none'; }, 300);
  } else {
    clip.style.maxHeight = clip.scrollHeight + 'px';
    void clip.offsetHeight;
    clip.classList.remove('expanded');
    clip.style.maxHeight = TEXT_CLAMP_H + 'px';
    expandedTaskIds.delete(taskId);
  }
  btn.classList.toggle('open', expand);
  btn.title = t(expand ? 'collapse' : 'expand');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) { /* fall back below */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
  ta.remove();
  return ok;
}

function flashCopied(btn) {
  clearTimeout(btn._copyTimer);
  btn.classList.add('copied');
  btn.title = t('copied');
  btn._copyTimer = setTimeout(() => {
    btn.classList.remove('copied');
    btn.title = t('copy');
  }, 1500);
}

// ── Task numbers: always 1..N in queue order ──────────────────────────────────
function seqFontSize(seq) { return seq >= 100 ? '8px' : seq >= 10 ? '10px' : ''; }

// Call after anything that removes or reorders tasks (remove, cancel, drag, restore)
function renumberTasks() {
  taskQueue.forEach((task, i) => {
    task.seq = i + 1;
    const el = document.querySelector(`#task-${task.id} .ts-n`);
    if (el) {
      el.textContent = String(task.seq);
      el.style.fontSize = seqFontSize(task.seq);
    }
  });
  nextSeq = taskQueue.length + 1;
}

// ── Task card rendering ────────────────────────────────────────────────────────
function renderTaskCard(task) {
  queueEmpty.style.display = 'none';

  const card = document.createElement('div');
  card.className = `task-card ${task.status}`;
  card.id = `task-${task.id}`;
  card.classList.toggle('sortable', task.status !== 'generating');
  card.innerHTML = buildCardHTML(task);
  queueContent.appendChild(card);
  attachCardListeners(card, task);
}

function updateTaskCard(task) {
  const card = document.getElementById(`task-${task.id}`);
  if (!card) return;
  card.className = `task-card ${task.status}`;
  card.classList.toggle('sortable', task.status !== 'generating');
  card.removeAttribute('draggable');
  card.innerHTML = buildCardHTML(task);
  attachCardListeners(card, task);
}

function attachCardListeners(card, task) {
  // Stop / Reload button
  const stopBtn = card.querySelector('.task-stop-btn');
  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      if (task.status === 'generating') {
        // Stop: abort the in-flight fetch
        if (currentAbortController) currentAbortController.abort();
      } else if (task.status === 'stopped' || task.status === 'error') {
        // Reload: reset task to waiting and re-enqueue
        task.status = 'waiting';
        task.text = '';
        task.rawText = '';
        task.detectedLanguage = null;
        task.errorMsg = null;
        updateTaskCard(task);
        updateBadge();
        saveState();
        processQueue();
      }
    });
  }

  // Copy buttons (transcript / error message)
  card.querySelectorAll('.task-copy-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const text = btn.dataset.copy === 'error' ? task.errorMsg : task.text;
      if (await copyText(text)) flashCopied(btn);
    });
  });

  // Expand / collapse the transcript
  const expandBtn = card.querySelector('.task-expand-btn');
  if (expandBtn) {
    expandBtn.addEventListener('click', () => {
      setTaskExpanded(card, task.id, !card.querySelector('.task-text-clip').classList.contains('expanded'));
    });
  }
  measureTaskText(card);

  // Remove button — always allowed; aborts fetch if task is generating
  card.querySelector('.task-remove-btn').addEventListener('click', () => {
    expandedTaskIds.delete(task.id);
    if (task.status === 'generating' && currentAbortController) {
      currentAbortController.abort();
    }
    if (task.status !== 'generating') {
      taskQueue = taskQueue.filter((t) => t.id !== task.id);
      renumberTasks();
      if (taskQueue.length === 0) { queueEmpty.style.display = ''; nextSeq = 1; nextTaskId = 1; expandedTaskIds.clear(); }
      updateBadge();
      saveState();
    }
    card.remove();
  });
}

function buildCardHTML(task) {
  const badgeLabel = t(`task-${task.status}`);
  const showStop   = task.status === 'generating';
  const showReload = task.status === 'stopped' || task.status === 'error';
  const stopReloadBtn = showStop
    ? `<button class="task-stop-btn" title="Stop">${ICONS.stop}</button>`
    : showReload
    ? `<button class="task-stop-btn reload" title="Retry">${ICONS.reload}</button>`
    : '';
  const src        = task.audioFileData;
  const audioHtml  = src?.base64
    ? `<div class="task-audio show"><audio controls preload="metadata" src="data:${src.mime || 'audio/wav'};base64,${src.base64}"></audio></div>`
    : '';
  const langTag    = task.detectedLanguage || (task.language === 'auto' ? t('lang-auto') : task.language);
  const transcript = task.status === 'done' ? (task.text || t('no-speech')) : '';
  const errorHtml  = task.errorMsg
    ? `<div class="task-error-row"><div class="task-error-msg">⚠ ${escapeHtml(task.errorMsg)}</div>
         <button class="task-copy-btn" data-copy="error" title="${t('copy')}">${ICONS.copy}</button></div>`
    : '';
  const expanded   = expandedTaskIds.has(task.id);

  return `
    <div class="task-header">
      ${task.status !== 'generating' ? `<span class="task-drag-handle" title="Drag to reorder">${ICONS.grip}</span>` : '<span style="width:19px;flex-shrink:0"></span>'}
      <span class="task-state" title="${badgeLabel}">
        <span class="ts-n"${seqFontSize(task.seq) ? ` style="font-size:${seqFontSize(task.seq)}"` : ''}>${task.seq}</span>
        <svg class="ts-ring" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14"/></svg>
      </span>
      <span class="task-filename">${escapeHtml(task.audioFileData.name)}</span>
      <span class="task-lang-tag">${escapeHtml(langTag)}</span>
      ${task.status === 'generating'
        ? `<span class="task-elapsed" id="elapsed-${task.id}">0:00</span>`
        : task.elapsedSec != null
        ? `<span class="task-elapsed">${Math.floor(task.elapsedSec / 60)}:${String(task.elapsedSec % 60).padStart(2, '0')}</span>`
        : ''}
      ${stopReloadBtn}
      <button class="task-remove-btn" title="Remove">${ICONS.remove}</button>
    </div>
    ${task.status === 'generating' ? '<div class="task-progress"><span></span></div>' : ''}
    ${audioHtml}
    ${transcript ? `<div class="task-text-box">
      <div class="task-text-clip${expanded ? ' expanded' : ''}"${expanded ? ' style="max-height:none"' : ''}>
        <div class="task-text">${escapeHtml(transcript)}</div>
      </div>
      ${task.text ? `<button class="task-copy-btn" data-copy="text" title="${t('copy')}">${ICONS.copy}</button>` : ''}
      <button class="task-expand-btn${expanded ? ' open' : ''}" hidden title="${t(expanded ? 'collapse' : 'expand')}">${ICONS.chevron}</button>
    </div>` : ''}
    ${errorHtml}
  `;
}

// ── Elapsed timer ─────────────────────────────────────────────────────────────
const cardTimers = new Map(); // taskId → { id: intervalId, startTime }

function startElapsedTimer(taskId) {
  const startTime = Date.now();
  const update = () => {
    const el = document.getElementById(`elapsed-${taskId}`);
    if (!el) return;
    const sec = Math.floor((Date.now() - startTime) / 1000);
    el.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  };
  update();
  cardTimers.set(taskId, { id: setInterval(update, 1000), startTime });
}

function stopElapsedTimer(taskId, task) {
  const entry = cardTimers.get(taskId);
  if (entry !== undefined) {
    clearInterval(entry.id);
    cardTimers.delete(taskId);
    if (task) task.elapsedSec = Math.floor((Date.now() - entry.startTime) / 1000);
  }
}

// ── Drag-and-drop reorder ─────────────────────────────────────────────────────
let dragSrcId = null;

function initDragAndDrop() {
  // A card is draggable only while its handle is pressed, so the text inside
  // stays selectable with the mouse.
  queueContent.addEventListener('pointerdown', (e) => {
    const card = e.target.closest('.task-drag-handle')?.closest('.task-card.sortable');
    if (card) card.setAttribute('draggable', 'true');
  });
  const clearDraggable = () =>
    queueContent.querySelectorAll('.task-card[draggable]').forEach((c) => c.removeAttribute('draggable'));
  document.addEventListener('pointerup', clearDraggable);
  document.addEventListener('pointercancel', clearDraggable);

  new ResizeObserver(() => {
    queueContent.querySelectorAll('.task-card').forEach(measureTaskText);
  }).observe(queueContent);

  queueContent.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.task-card[draggable]');
    if (!card) return;
    dragSrcId = card.id;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  queueContent.addEventListener('dragend', () => {
    queueContent.querySelectorAll('.task-card').forEach((c) => {
      c.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom');
      c.removeAttribute('draggable');
    });
    dragSrcId = null;
  });

  queueContent.addEventListener('dragover', (e) => {
    e.preventDefault();
    const card = e.target.closest('.task-card');
    if (!card || card.id === dragSrcId) return;
    queueContent.querySelectorAll('.task-card').forEach((c) =>
      c.classList.remove('drag-over-top', 'drag-over-bottom')
    );
    const rect = card.getBoundingClientRect();
    card.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drag-over-top' : 'drag-over-bottom');
    e.dataTransfer.dropEffect = 'move';
  });

  queueContent.addEventListener('dragleave', (e) => {
    const card = e.target.closest('.task-card');
    if (card && !card.contains(e.relatedTarget)) {
      card.classList.remove('drag-over-top', 'drag-over-bottom');
    }
  });

  queueContent.addEventListener('drop', (e) => {
    e.preventDefault();
    const targetCard = e.target.closest('.task-card');
    if (!targetCard || !dragSrcId || targetCard.id === dragSrcId) return;

    const srcCard = document.getElementById(dragSrcId);
    if (!srcCard) return;

    const rect = targetCard.getBoundingClientRect();
    if (e.clientY < rect.top + rect.height / 2) {
      queueContent.insertBefore(srcCard, targetCard);
    } else {
      queueContent.insertBefore(srcCard, targetCard.nextSibling);
    }

    // Sync taskQueue order to match DOM
    const newOrder = Array.from(queueContent.querySelectorAll('.task-card'))
      .map((c) => parseInt(c.id.replace('task-', ''), 10));
    taskQueue.sort((a, b) => newOrder.indexOf(a.id) - newOrder.indexOf(b.id));

    renumberTasks();

    targetCard.classList.remove('drag-over-top', 'drag-over-bottom');
    saveState();
  });
}

// ── Utility ───────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── State persistence ─────────────────────────────────────────────────────────
function saveState() {
  const queueToSave = taskQueue.map((t) => ({
    id:            t.id,
    seq:           t.seq,
    audioFileData:    t.audioFileData,
    language:         t.language,
    status:           t.status === 'generating' ? 'waiting' : t.status,
    text:             t.text,
    rawText:          t.rawText,
    textScript:       t.textScript,
    detectedLanguage: t.detectedLanguage,
    errorMsg:         t.errorMsg,
    elapsedSec:       t.elapsedSec,
  }));
  chrome.storage.local.set({
    lang:            currentLang,
    audioFileData:   audioFileData,
    asrLang:         languageSelect.value,
    taskQueue:       queueToSave,
    nextTaskId:      nextTaskId,
    nextSeq:         nextSeq,
    panelMode:       panelMode,
  }).catch((err) => console.error('[saveState] chrome.storage.local.set failed:', err));
}

// ── Panel mode toggle ─────────────────────────────────────────────────────────
function updatePanelModeBtn() {
  if (!panelModeBtn) return;
  if (panelMode === 'popup') {
    panelModeBtn.innerHTML = ICONS.sidepanel;
    panelModeBtn.title = t('panel-mode-to-sidepanel');
  } else {
    panelModeBtn.innerHTML = ICONS.popup;
    panelModeBtn.title = t('panel-mode-to-popup');
  }
}

async function togglePanelMode() {
  const newMode = panelMode === 'popup' ? 'sidepanel' : 'popup';
  panelMode = newMode;

  if (newMode === 'popup') {
    document.body.classList.add('popup-mode');
  } else {
    document.body.classList.remove('popup-mode');
    // Must call sidePanel.open() synchronously before any await to keep user gesture
    if (POPUP_SRC_WINDOW_ID !== null) {
      chrome.sidePanel.open({ windowId: POPUP_SRC_WINDOW_ID }).catch(() => {});
    }
  }

  updatePanelModeBtn();
  saveState();

  try {
    const resp = await chrome.runtime.sendMessage({ type: 'SET_PANEL_MODE', mode: newMode, srcWindowId: POPUP_SRC_WINDOW_ID });
    if (resp?.ok) {
      window.close();
    }
  } catch (err) {
    console.error('[togglePanelMode] sendMessage failed:', err);
  }
}

panelModeBtn?.addEventListener('click', () => togglePanelMode());

// ── Icon buttons: replay a small SVG state-change animation on each click ─────
[panelModeBtn, startBackendBtn].forEach((btn) => {
  if (!btn) return;
  btn.addEventListener('click', () => {
    btn.classList.remove('tog');
    void btn.offsetWidth;
    btn.classList.add('tog');
  });
  btn.addEventListener('animationend', () => btn.classList.remove('tog'));
});

// ── Header cursor spotlight: a soft light that smoothly trails the pointer ────
(() => {
  const bar = document.querySelector('.header-bar');
  if (!bar) return;

  // Double-click an empty area of the header to toggle the ambient sheen
  bar.addEventListener('dblclick', (e) => {
    if (e.target.closest('.header-title, .header-right')) return;
    bar.classList.toggle('sheen-off');
  });

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let curX = 0, curY = 0, tgtX = 0, tgtY = 0, raf = 0, lit = false;
  const tick = () => {
    curX += (tgtX - curX) * 0.18;
    curY += (tgtY - curY) * 0.18;
    bar.style.setProperty('--mx', curX + 'px');
    bar.style.setProperty('--my', curY + 'px');
    if (lit && (Math.abs(tgtX - curX) > 0.5 || Math.abs(tgtY - curY) > 0.5)) {
      raf = requestAnimationFrame(tick);
    } else {
      raf = 0;
    }
  };
  bar.addEventListener('pointermove', (e) => {
    const r = bar.getBoundingClientRect();
    tgtX = e.clientX - r.left;
    tgtY = e.clientY - r.top;
    if (!raf) raf = requestAnimationFrame(tick);
  });
  bar.addEventListener('pointerenter', (e) => {
    const r = bar.getBoundingClientRect();
    curX = tgtX = e.clientX - r.left;
    curY = tgtY = e.clientY - r.top;
    lit = true;
    bar.classList.add('lit');
    if (!raf) raf = requestAnimationFrame(tick);
  });
  bar.addEventListener('pointerleave', () => {
    lit = false;
    bar.classList.remove('lit');
  });
})();

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  const stored = await chrome.storage.local.get([
    'lang', 'audioFileData', 'asrLang',
    'taskQueue', 'nextTaskId', 'nextSeq', 'panelMode', 'backendUrl',
  ]).catch(() => ({}));

  backendUrl = normalizeUrl(stored.backendUrl);
  serverUrlInput.value = backendUrl;

  if (stored.lang && TRANSLATIONS[stored.lang]) {
    currentLang = stored.lang;
  }
  langSelect.value = currentLang;  // always sync selector to actual lang (fixes first-run mismatch)

  applyTranslations();

  // Restore panel mode — derive actual current mode from URL context, not storage.
  // POPUP_SRC_WINDOW_ID is only set when background.js opened this page as a popup window.
  // Storage value may be stale if a previous switch failed or the popup was manually closed.
  const actualMode = POPUP_SRC_WINDOW_ID !== null ? 'popup' : 'sidepanel';
  panelMode = actualMode;
  if ((stored.panelMode || 'sidepanel') !== actualMode) {
    // Heal stale storage so background.js icon-click behaves correctly
    chrome.storage.local.set({ panelMode: actualMode });
  }
  if (panelMode === 'popup') document.body.classList.add('popup-mode');
  updatePanelModeBtn();

  if (stored.audioFileData) {
    audioFileData = stored.audioFileData;
    showAudio(audioFileData);
  }
  if (stored.asrLang) languageSelect.value = stored.asrLang;

  // Restore queue
  if (stored.taskQueue && stored.taskQueue.length > 0) {
    nextTaskId = stored.nextTaskId || 1;
    nextSeq    = stored.nextSeq    || 1;
    taskQueue  = stored.taskQueue;
    renumberTasks();  // close any gaps saved by an earlier session
    queueEmpty.style.display = 'none';
    taskQueue.forEach((task) => renderTaskCard(task));
    updateBadge();
    // Resume any tasks that were interrupted (reset generating→waiting)
    const anyWaiting = taskQueue.some((t) => t.status === 'waiting');
    if (anyWaiting) setTimeout(processQueue, 1000);
  }

  setStatus('checking');
  await checkBackend();
  startPolling();
  updateGenerateBtn();
  if (!backendUrl) serverGearBtn.click();  // first run: ask for the server address
  reconvertTranscripts();
  checkForExtensionUpdate();
  initDragAndDrop();
}

init();
