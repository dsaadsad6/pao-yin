import { renderPageGrid } from './pdf-viewer.js';
import { createCustomSelect } from './custom-select.js';
import { applyI18n, LANGS } from './i18n.js';

// 註冊 Service Worker,讓瀏覽器可以把這個工具「加到主畫面/安裝成應用程式」
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

const STORAGE_KEY = 'remote-print-prefs';

const state = {
  fileId: null,
  originalName: null,
  kind: null,
  pageCount: null,
  color: 'mono',
  duplex: 'simplex',
};

let pendingFiles = []; // 多檔上傳、尚未合併/採用前的暫存清單
let pageGridController = null;
let customOrderActive = false;
let customOrderPages = null;
let batchModeActive = false;

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const cameraInput = document.getElementById('cameraInput');
const cameraBtn = document.getElementById('cameraBtn');
const fileInfo = document.getElementById('fileInfo');
const fileName = document.getElementById('fileName');
const fileMeta = document.getElementById('fileMeta');
const clearFile = document.getElementById('clearFile');
const autoFixCheckbox = document.getElementById('autoFix');
const pendingList = document.getElementById('pendingList');
const pendingActions = document.getElementById('pendingActions');
const mergeBtn = document.getElementById('mergeBtn');
const batchModeBtn = document.getElementById('batchModeBtn');
const exitBatchBtn = document.getElementById('exitBatchBtn');
const pageRangeField = document.getElementById('pageRangeField');
const layoutRow = document.getElementById('layoutRow');
const scheduleEnabled = document.getElementById('scheduleEnabled');
const scheduleAt = document.getElementById('scheduleAt');
const scheduledPanel = document.getElementById('scheduledPanel');
const scheduledWrap = document.getElementById('scheduledWrap');
const pageGrid = document.getElementById('pageGrid');
const pageGridActions = document.getElementById('pageGridActions');
const resetOrderBtn = document.getElementById('resetOrderBtn');
const sourceTabs = document.getElementById('sourceTabs');
const sourceFile = document.getElementById('sourceFile');
const sourceText = document.getElementById('sourceText');
const sourceUrl = document.getElementById('sourceUrl');
const sourceScan = document.getElementById('sourceScan');
const pasteText = document.getElementById('pasteText');
const pasteSubmit = document.getElementById('pasteSubmit');
const urlInput = document.getElementById('urlInput');
const urlSubmit = document.getElementById('urlSubmit');
const scanSubmit = document.getElementById('scanSubmit');
const testPageBtn = document.getElementById('testPageBtn');
const optionsPanel = document.getElementById('optionsPanel');
const printerSelect = document.getElementById('printerSelect');
const printerSearch = document.getElementById('printerSearch');
const refreshPrinters = document.getElementById('refreshPrinters');
const printerHint = document.getElementById('printerHint');
const allPages = document.getElementById('allPages');
const pageRange = document.getElementById('pageRange');
const pageCountHint = document.getElementById('pageCountHint');
const colorSeg = document.getElementById('colorSeg');
const duplexSeg = document.getElementById('duplexSeg');
const copiesInput = document.getElementById('copies');
const layoutModeSelect = document.getElementById('layoutMode');
const layoutHint = document.getElementById('layoutHint');
const posterSizeField = document.getElementById('posterSizeField');
const posterSize = document.getElementById('posterSize');
const watermarkText = document.getElementById('watermarkText');
const watermarkPreset = document.getElementById('watermarkPreset');
const watermarkImageInput = document.getElementById('watermarkImageInput');
const watermarkImagePickBtn = document.getElementById('watermarkImagePickBtn');
const watermarkImageHint = document.getElementById('watermarkImageHint');
const pageScale = document.getElementById('pageScale');
const scaleField = document.getElementById('scaleField');
const headerText = document.getElementById('headerText');
const footerText = document.getElementById('footerText');
const pageNumbers = document.getElementById('pageNumbers');
const previewBtn = document.getElementById('previewBtn');
const previewModal = document.getElementById('previewModal');
const previewFrame = document.getElementById('previewFrame');
const previewMsg = document.getElementById('previewMsg');
const previewCloseBtn = document.getElementById('previewCloseBtn');
const printBtn = document.getElementById('printBtn');
const printMsg = document.getElementById('printMsg');
const jobsWrap = document.getElementById('jobsWrap');
const jobFilter = document.getElementById('jobFilter');
const jobStatusFilter = document.getElementById('jobStatusFilter');
const langSelect = document.getElementById('langSelect');
const themeToggle = document.getElementById('themeToggle');
const maintenanceHint = document.getElementById('maintenanceHint');
const qrBtn = document.getElementById('qrBtn');
const qrPopover = document.getElementById('qrPopover');
const qrImage = document.getElementById('qrImage');
const feedbackFab = document.getElementById('feedbackFab');
const feedbackModal = document.getElementById('feedbackModal');
const feedbackText = document.getElementById('feedbackText');
const feedbackMsg = document.getElementById('feedbackMsg');
const feedbackCancelBtn = document.getElementById('feedbackCancelBtn');
const feedbackSubmitBtn = document.getElementById('feedbackSubmitBtn');
const openSignatureBtn = document.getElementById('openSignatureBtn');
const signatureStatusHint = document.getElementById('signatureStatusHint');
const signatureModal = document.getElementById('signatureModal');
const signatureCanvas = document.getElementById('signatureCanvas');
const signaturePlacement = document.getElementById('signaturePlacement');
const signatureMsg = document.getElementById('signatureMsg');
const signatureClearBtn = document.getElementById('signatureClearBtn');
const signatureCancelBtn = document.getElementById('signatureCancelBtn');
const signatureConfirmBtn = document.getElementById('signatureConfirmBtn');
const passwordModal = document.getElementById('passwordModal');
const pdfPasswordInput = document.getElementById('pdfPasswordInput');
const pdfPasswordMsg = document.getElementById('pdfPasswordMsg');
const pdfPasswordCancelBtn = document.getElementById('pdfPasswordCancelBtn');
const pdfPasswordSubmitBtn = document.getElementById('pdfPasswordSubmitBtn');

const printerDropdown = createCustomSelect(printerSelect);
const layoutDropdown = createCustomSelect(layoutModeSelect);
const posterDropdown = createCustomSelect(posterSize);
const jobStatusDropdown = createCustomSelect(jobStatusFilter);
const langDropdown = createCustomSelect(langSelect);
const watermarkPresetDropdown = createCustomSelect(watermarkPreset);

document.getElementById('logoutBtn').addEventListener('click', async (e) => {
  e.preventDefault();
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

// ---- 語言 ----
let currentLang = localStorage.getItem('remote-print-lang') || 'zh';
function t(key) {
  return (LANGS[currentLang] && LANGS[currentLang][key]) || LANGS.zh[key] || key;
}
langSelect.value = currentLang;
langDropdown.refresh();
applyI18n(currentLang);
langSelect.addEventListener('change', () => {
  currentLang = langSelect.value;
  localStorage.setItem('remote-print-lang', currentLang);
  applyI18n(currentLang);
  layoutDropdown.refresh();
  posterDropdown.refresh();
  jobStatusDropdown.refresh();
  watermarkPresetDropdown.refresh();
  renderJobs();
  themeToggle.title = themeTooltip(currentTheme);
  if (batchModeActive) printBtn.textContent = t('batchSubmitBtn');
  else if (scheduleEnabled.checked) printBtn.textContent = t('scheduleSubmitBtn');
  else printBtn.textContent = t('printBtn');
});

// ---- 主題(深色 / 淺色 / 護眼 / 自動跟隨系統) ----
const THEME_CYCLE = ['dark', 'light', 'eyecare', 'auto'];
const THEME_ATTR = { dark: null, light: 'light', eyecare: 'eyecare' };
const THEME_NAME_KEYS = { dark: 'themeNameDark', light: 'themeNameLight', eyecare: 'themeNameEyecare', auto: 'themeNameAuto' };
let currentTheme = localStorage.getItem('remote-print-theme') || 'dark';
const darkMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
function resolveAutoTheme() {
  return darkMediaQuery.matches ? 'dark' : 'light';
}
function themeTooltip(theme) {
  return `${t(THEME_NAME_KEYS[theme])}(點擊切換)`;
}
function applyTheme(theme) {
  currentTheme = theme;
  const effective = theme === 'auto' ? resolveAutoTheme() : theme;
  if (THEME_ATTR[effective]) document.documentElement.dataset.theme = THEME_ATTR[effective];
  else delete document.documentElement.dataset.theme;
  localStorage.setItem('remote-print-theme', theme);
  themeToggle.title = themeTooltip(theme);
}
applyTheme(currentTheme);
darkMediaQuery.addEventListener('change', () => {
  if (currentTheme === 'auto') applyTheme('auto');
});
themeToggle.addEventListener('click', () => {
  const next = THEME_CYCLE[(THEME_CYCLE.indexOf(currentTheme) + 1) % THEME_CYCLE.length];
  applyTheme(next);
});

// ---- 記住上次使用的設定,方便下次直接用 ----
function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}
function savePrefs() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      printerName: printerSelect.value,
      color: state.color,
      duplex: state.duplex,
      copies: copiesInput.value,
      layoutMode: layoutModeSelect.value,
      posterSize: posterSize.value,
      pageScale: pageScale.value,
      watermarkPreset: watermarkPreset.value,
    }));
  } catch {
    // 私密瀏覽模式等情況下 localStorage 可能無法使用,忽略即可
  }
}
const prefs = loadPrefs();

// ---- dropzone ----
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('drag');
  if (e.dataTransfer.files.length) uploadMultiple([...e.dataTransfer.files]);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) uploadMultiple([...fileInput.files]);
  fileInput.value = '';
});

cameraBtn.addEventListener('click', () => cameraInput.click());
cameraInput.addEventListener('change', () => {
  if (cameraInput.files.length) uploadMultiple([...cameraInput.files]);
  cameraInput.value = '';
});

clearFile.addEventListener('click', () => {
  state.fileId = null;
  pendingFiles = [];
  exitBatchMode();
  renderPendingList();
  fileInfo.style.display = 'none';
  optionsPanel.style.display = 'none';
});

function setBatchUiVisible(active) {
  pageRangeField.style.display = active ? 'none' : 'block';
  layoutRow.style.display = active ? 'none' : 'grid';
  scaleField.style.display = active ? 'none' : (layoutModeSelect.value === 'none' ? 'block' : 'none');
  previewBtn.style.display = active ? 'none' : 'inline-block';
  printBtn.textContent = active ? t('batchSubmitBtn') : t('printBtn');
}
function exitBatchMode() {
  batchModeActive = false;
  setBatchUiVisible(false);
}

async function applyFileResult(data) {
  exitBatchMode();
  state.fileId = data.id;
  state.originalName = data.originalName;
  state.kind = data.kind;
  state.pageCount = data.pageCount;
  customOrderActive = false;
  customOrderPages = null;

  fileName.textContent = data.originalName;
  fileMeta.textContent = `${kindLabel(data.kind)} · 共 ${data.pageCount} 頁`;
  fileInfo.style.display = 'flex';
  optionsPanel.style.display = 'block';
  updatePageRangePreview();
  await loadPageGrid();
}

async function uploadSingleFile(file) {
  const form = new FormData();
  form.append('file', file);
  form.append('autoFix', autoFixCheckbox.checked ? 'true' : 'false');
  const res = await fetch('/api/upload', { method: 'POST', body: form });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '上傳失敗');
  return data;
}

async function uploadMultiple(files) {
  exitBatchMode();
  optionsPanel.style.display = 'none';
  fileName.textContent = `上傳中... (0/${files.length})`;
  fileMeta.textContent = '';
  fileInfo.style.display = 'flex';

  const errors = [];
  for (let i = 0; i < files.length; i++) {
    fileName.textContent = `上傳中... (${i + 1}/${files.length}) ${files[i].name}`;
    try {
      let data = await uploadSingleFile(files[i]);
      if (data.needsPassword) {
        const unlocked = await promptForPdfPassword(data);
        if (!unlocked) {
          errors.push(`${files[i].name}: 已取消解鎖`);
          continue;
        }
        data = unlocked;
      }
      pendingFiles.push(data);
    } catch (err) {
      errors.push(`${files[i].name}: ${err.message}`);
    }
  }

  if (errors.length) {
    fileMeta.textContent = errors.join('; ');
  }

  if (pendingFiles.length === 1) {
    const only = pendingFiles[0];
    pendingFiles = [];
    renderPendingList();
    await applyFileResult(only);
  } else if (pendingFiles.length > 1) {
    fileInfo.style.display = 'none';
    renderPendingList();
  } else {
    fileName.textContent = '上傳失敗';
  }
}

function renderPendingList() {
  if (!pendingFiles.length) {
    pendingList.style.display = 'none';
    pendingList.innerHTML = '';
    pendingActions.style.display = 'none';
    return;
  }
  pendingList.style.display = 'flex';
  pendingActions.style.display = 'flex';
  mergeBtn.style.display = batchModeActive ? 'none' : 'inline-block';
  batchModeBtn.style.display = batchModeActive ? 'none' : 'inline-block';
  exitBatchBtn.style.display = batchModeActive ? 'inline-block' : 'none';

  pendingList.innerHTML = pendingFiles
    .map((f, i) => `
      <div class="pending-item" data-index="${i}">
        <span class="name">${escapeHtml(f.originalName)}</span>
        <span class="meta">${f.pageCount} 頁</span>
        ${batchModeActive ? `<input type="text" data-action="range" data-i18n-placeholder="batchPageRangePlaceholder" placeholder="${t('batchPageRangePlaceholder')}" value="${escapeHtml(f.pageRange || '')}" />` : ''}
        <button type="button" data-action="up" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" data-action="down" ${i === pendingFiles.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" data-action="remove">✕</button>
      </div>
    `)
    .join('');

  pendingList.querySelectorAll('.pending-item').forEach((el) => {
    const i = Number(el.dataset.index);
    el.querySelector('[data-action="up"]').addEventListener('click', () => {
      [pendingFiles[i - 1], pendingFiles[i]] = [pendingFiles[i], pendingFiles[i - 1]];
      renderPendingList();
    });
    el.querySelector('[data-action="down"]').addEventListener('click', () => {
      [pendingFiles[i + 1], pendingFiles[i]] = [pendingFiles[i], pendingFiles[i + 1]];
      renderPendingList();
    });
    el.querySelector('[data-action="remove"]').addEventListener('click', () => {
      pendingFiles.splice(i, 1);
      renderPendingList();
    });
    const rangeInput = el.querySelector('[data-action="range"]');
    if (rangeInput) {
      rangeInput.addEventListener('input', () => { pendingFiles[i].pageRange = rangeInput.value; });
    }
  });
}

batchModeBtn.addEventListener('click', () => {
  if (pendingFiles.length < 2) return;
  batchModeActive = true;
  optionsPanel.style.display = 'block';
  setBatchUiVisible(true);
  renderPendingList();
});
exitBatchBtn.addEventListener('click', () => {
  exitBatchMode();
  renderPendingList();
});

mergeBtn.addEventListener('click', async () => {
  if (pendingFiles.length < 2) return;
  mergeBtn.disabled = true;
  mergeBtn.textContent = '合併中...';
  try {
    const res = await fetch('/api/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: pendingFiles.map((f) => f.id) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '合併失敗');
    pendingFiles = [];
    renderPendingList();
    await applyFileResult(data);
  } catch (err) {
    printMsg.textContent = err.message;
    printMsg.classList.add('show', 'error');
  } finally {
    mergeBtn.disabled = false;
    mergeBtn.textContent = '合併成一份文件並使用';
  }
});

function kindLabel(kind) {
  if (kind === 'pdf') return 'PDF';
  if (kind === 'image') return '照片';
  if (kind === 'office') return '文件(已轉為 PDF)';
  if (kind === 'text') return '貼上的文字';
  if (kind === 'test') return '測試頁';
  if (kind === 'merged') return '合併文件';
  if (kind === 'url') return '網頁轉換';
  if (kind === 'scan') return '掃描文件';
  return kind;
}

// ---- 上傳檔案 / 貼上文字 分頁籤 ----
const SOURCE_PANELS = { file: sourceFile, text: sourceText, url: sourceUrl, scan: sourceScan };
sourceTabs.querySelectorAll('button').forEach((btn) => {
  btn.addEventListener('click', () => {
    sourceTabs.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    for (const [key, panel] of Object.entries(SOURCE_PANELS)) {
      if (key === btn.dataset.value) {
        panel.style.display = 'block';
        panel.classList.remove('tab-anim');
        void panel.offsetWidth; // 強制 reflow,讓動畫可以重新播放
        panel.classList.add('tab-anim');
      } else {
        panel.style.display = 'none';
      }
    }
  });
});

pasteSubmit.addEventListener('click', async () => {
  const text = pasteText.value;
  if (!text.trim()) return;

  pasteSubmit.disabled = true;
  pasteSubmit.textContent = '轉換中...';
  optionsPanel.style.display = 'none';
  try {
    const res = await fetch('/api/paste-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '轉換失敗');
    await applyFileResult(data);
  } catch (err) {
    printMsg.textContent = err.message;
    printMsg.classList.add('show', 'error');
  } finally {
    pasteSubmit.disabled = false;
    pasteSubmit.textContent = '轉換成 PDF';
  }
});

// ---- 測試頁 ----
testPageBtn.addEventListener('click', async () => {
  testPageBtn.disabled = true;
  try {
    const res = await fetch('/api/test-page', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '產生測試頁失敗');
    await applyFileResult(data);
  } catch (err) {
    printMsg.textContent = err.message;
    printMsg.classList.add('show', 'error');
  } finally {
    testPageBtn.disabled = false;
  }
});

// ---- 網頁轉 PDF ----
urlSubmit.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  if (!url) return;

  urlSubmit.disabled = true;
  urlSubmit.textContent = '轉換中...';
  optionsPanel.style.display = 'none';
  try {
    const res = await fetch('/api/url-to-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '轉換失敗');
    await applyFileResult(data);
  } catch (err) {
    printMsg.textContent = err.message;
    printMsg.classList.add('show', 'error');
  } finally {
    urlSubmit.disabled = false;
    urlSubmit.textContent = t('convertToPdf');
  }
});

// ---- 掃描 ----
scanSubmit.addEventListener('click', async () => {
  scanSubmit.disabled = true;
  scanSubmit.textContent = '掃描中...';
  optionsPanel.style.display = 'none';
  try {
    const res = await fetch('/api/scan', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '掃描失敗');
    await applyFileResult(data);
  } catch (err) {
    printMsg.textContent = err.message;
    printMsg.classList.add('show', 'error');
  } finally {
    scanSubmit.disabled = false;
    scanSubmit.textContent = t('scanStart');
  }
});

// ---- 全部頁面 / 自訂頁碼範圍 / 頁面縮圖 ----
allPages.addEventListener('change', () => {
  pageRange.disabled = allPages.checked;
  const showGrid = !allPages.checked && !!pageGridController;
  pageGrid.style.display = showGrid ? 'flex' : 'none';
  pageGridActions.style.display = showGrid ? 'block' : 'none';
  if (allPages.checked) {
    pageRange.value = '';
    if (pageGridController) pageGridController.reset();
  }
  updatePageRangePreview();
});
pageRange.addEventListener('input', () => {
  // 使用者手動打頁碼範圍時,視為放棄縮圖自訂排序
  customOrderActive = false;
  customOrderPages = null;
  updatePageRangePreview();
});
resetOrderBtn.addEventListener('click', () => {
  if (pageGridController) pageGridController.reset();
});

async function loadPageGrid() {
  pageGrid.innerHTML = '';
  pageGridController = null;
  try {
    const res = await fetch(`/api/pdf-bytes/${state.fileId}`);
    if (!res.ok) return;
    const buf = await res.arrayBuffer();
    pageGridController = await renderPageGrid(new Uint8Array(buf), pageGrid, {
      onChange: ({ selected, isCustomOrder }) => {
        customOrderActive = isCustomOrder;
        customOrderPages = isCustomOrder ? selected : null;
        if (!isCustomOrder) {
          pageRange.value = selected.length === state.pageCount ? '' : compactRange(selected);
        }
        updatePageRangePreview();
      },
    });
    const showGrid = !allPages.checked;
    pageGrid.style.display = showGrid ? 'flex' : 'none';
    pageGridActions.style.display = showGrid ? 'block' : 'none';
  } catch {
    // 縮圖載入失敗不影響其他列印流程,靜默略過,使用者仍可用手動頁碼範圍
  }
}

function compactRange(pages) {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const cur = sorted[i];
    if (cur === prev + 1) {
      prev = cur;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = cur;
    prev = cur;
  }
  return parts.join(',');
}

// 跟 lib/print.js 的 parsePageRange 邏輯一致,純粹用來即時顯示,不做為送出前的唯一驗證
function clientParsePageRange(input, pageCount) {
  if (!input || !input.trim()) return { ok: true, count: pageCount };
  const parts = input.split(',').map((s) => s.trim()).filter(Boolean);
  let count = 0;
  for (const part of parts) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) return { ok: false, error: `格式錯誤: "${part}"` };
    let start = parseInt(m[1], 10);
    let end = m[2] ? parseInt(m[2], 10) : start;
    if (start > end) [start, end] = [end, start];
    if (start < 1 || end > pageCount) return { ok: false, error: `超出範圍(1-${pageCount}): "${part}"` };
    count += end - start + 1;
  }
  return { ok: true, count };
}

function updatePageRangePreview() {
  if (!state.pageCount) return;
  if (allPages.checked) {
    pageCountHint.textContent = `此檔案共 ${state.pageCount} 頁,將列印全部頁面`;
    pageCountHint.classList.remove('error');
    return;
  }
  if (customOrderActive) {
    pageRange.disabled = true;
    pageCountHint.textContent = `已自訂排序,將依縮圖排列的順序列印共 ${customOrderPages.length} 頁`;
    pageCountHint.classList.remove('error');
    return;
  }
  pageRange.disabled = false;
  const result = clientParsePageRange(pageRange.value, state.pageCount);
  if (!result.ok) {
    pageCountHint.textContent = result.error;
    pageCountHint.classList.add('error');
  } else {
    pageCountHint.textContent = pageRange.value.trim()
      ? `共 ${state.pageCount} 頁,已選 ${result.count} 頁`
      : `此檔案共 ${state.pageCount} 頁`;
    pageCountHint.classList.remove('error');
  }
}

// ---- segmented controls ----
function setupSegmented(el, key, onChange) {
  el.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      el.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state[key] = btn.dataset.value;
      if (onChange) onChange();
      savePrefs();
    });
  });
}
function setActiveSegment(el, value) {
  el.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.value === value));
}
setupSegmented(colorSeg, 'color');
setupSegmented(duplexSeg, 'duplex');

if (prefs.color) { state.color = prefs.color; setActiveSegment(colorSeg, prefs.color); }
if (prefs.duplex) { state.duplex = prefs.duplex; setActiveSegment(duplexSeg, prefs.duplex); }
if (prefs.copies) copiesInput.value = prefs.copies;
copiesInput.addEventListener('change', savePrefs);

// ---- 版面模式(N-up / 小冊子 / 海報) ----
const LAYOUT_HINTS = {
  none: '',
  nup2: '每張紙印 2 頁,直向堆疊,適合節省紙張。',
  nup4: '每張紙印 4 頁(2x2),適合節省紙張的講義。',
  booklet: '會自動補頁、重新排版成對折裝訂用的順序。列印時請選「雙面(短邊)」,印完對折疊起來就是正確頁序。',
  poster: '只會使用第一頁放大拼貼,列印後把每張紙拼在一起就是完整海報。',
};
layoutModeSelect.addEventListener('change', () => {
  posterSizeField.style.display = layoutModeSelect.value === 'poster' ? 'block' : 'none';
  scaleField.style.display = layoutModeSelect.value === 'none' ? 'block' : 'none';
  layoutHint.textContent = LAYOUT_HINTS[layoutModeSelect.value] || '';
  savePrefs();
});
posterSize.addEventListener('change', savePrefs);
if (prefs.layoutMode) {
  layoutModeSelect.value = prefs.layoutMode;
  posterSizeField.style.display = prefs.layoutMode === 'poster' ? 'block' : 'none';
  scaleField.style.display = prefs.layoutMode === 'none' ? 'block' : 'none';
  layoutHint.textContent = LAYOUT_HINTS[prefs.layoutMode] || '';
  layoutDropdown.refresh();
}
if (prefs.posterSize) { posterSize.value = prefs.posterSize; posterDropdown.refresh(); }
if (prefs.pageScale) pageScale.value = prefs.pageScale;
pageScale.addEventListener('change', savePrefs);

// ---- 浮水印樣式庫 ----
const WATERMARK_PRESETS = {
  confidential: { textKey: 'presetConfidential', color: [0.75, 0.15, 0.15], opacity: 0.28 },
  draft: { textKey: 'presetDraft', color: [0.55, 0.55, 0.55], opacity: 0.25 },
  internal: { textKey: 'presetInternal', color: [0.2, 0.35, 0.6], opacity: 0.22 },
};
watermarkPreset.addEventListener('change', () => {
  const preset = WATERMARK_PRESETS[watermarkPreset.value];
  if (preset) watermarkText.value = t(preset.textKey);
  savePrefs();
});
if (prefs.watermarkPreset) { watermarkPreset.value = prefs.watermarkPreset; watermarkPresetDropdown.refresh(); }

// ---- 浮水印圖片上傳 ----
let watermarkImageId = null;
watermarkImagePickBtn.addEventListener('click', () => watermarkImageInput.click());
watermarkImageInput.addEventListener('change', async () => {
  const file = watermarkImageInput.files[0];
  if (!file) return;
  watermarkImageId = null;
  watermarkImageHint.classList.remove('error');
  watermarkImageHint.textContent = '上傳中...';
  try {
    const form = new FormData();
    form.append('image', file);
    const res = await fetch('/api/upload-watermark-image', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '上傳失敗');
    watermarkImageId = data.id;
    watermarkImageHint.textContent = '';
    const span = document.createElement('span');
    span.textContent = `已選擇:${file.name}`;
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'link-btn';
    removeBtn.style.marginLeft = '8px';
    removeBtn.textContent = t('remove');
    removeBtn.addEventListener('click', () => {
      watermarkImageId = null;
      watermarkImageInput.value = '';
      watermarkImageHint.textContent = '';
    });
    watermarkImageHint.appendChild(span);
    watermarkImageHint.appendChild(removeBtn);
  } catch (err) {
    watermarkImageId = null;
    watermarkImageHint.textContent = err.message;
    watermarkImageHint.classList.add('error');
  }
});

// ---- printers ----
let printersCache = [];

async function loadPrinters() {
  refreshPrinters.classList.add('spinning');
  refreshPrinters.disabled = true;
  try {
    const res = await fetch('/api/printers');
    const data = await res.json();
    printersCache = data.printers || [];
    printerSelect.innerHTML = '';

    if (!printersCache.length) {
      printerSelect.innerHTML = '<option value="">找不到印表機</option>';
      printerHint.textContent = '這台電腦目前沒有安裝任何印表機';
      return;
    }

    for (const p of printersCache) {
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.dataset.status = p.status || '';
      const tag = p.isDefault ? '預設 · ' : '';
      opt.textContent = `${p.name}(${tag}${p.status})`;
      printerSelect.appendChild(opt);
    }

    if (prefs.printerName && printersCache.some((p) => p.name === prefs.printerName)) {
      printerSelect.value = prefs.printerName;
    }
    updatePrinterHint();
  } catch {
    printersCache = [];
    printerSelect.innerHTML = '<option value="">讀取印表機失敗</option>';
    printerHint.textContent = '無法連線到伺服器讀取印表機清單';
  } finally {
    printerDropdown.refresh();
    refreshPrinters.classList.remove('spinning');
    refreshPrinters.disabled = false;
  }
}

function updatePrinterHint() {
  const selected = printersCache.find((p) => p.name === printerSelect.value);
  if (!selected) { printerHint.textContent = ''; maintenanceHint.style.display = 'none'; return; }
  const bits = [];
  if (selected.isDefault) bits.push('系統預設印表機');
  bits.push(`狀態:${selected.status}`);
  if (selected.network) bits.push('網路印表機');
  if (selected.pagesPrinted) bits.push(`累積列印 ${selected.pagesPrinted} 頁`);
  printerHint.textContent = bits.join(' · ');

  if (selected.maintenanceDue) {
    maintenanceHint.textContent = `這台印表機已經累積列印超過 ${selected.pagesPrinted} 頁,建議檢查碳粉/墨水存量與定期保養`;
    maintenanceHint.style.display = 'block';
  } else {
    maintenanceHint.style.display = 'none';
  }
}
printerSelect.addEventListener('change', () => { updatePrinterHint(); savePrefs(); });
refreshPrinters.addEventListener('click', loadPrinters);

printerSearch.addEventListener('input', () => {
  const q = printerSearch.value.trim().toLowerCase();
  let firstVisible = null;
  for (const opt of printerSelect.options) {
    const match = !q || opt.textContent.toLowerCase().includes(q);
    opt.hidden = !match;
    if (match && !firstVisible) firstVisible = opt;
  }
  if (printerSelect.selectedOptions[0]?.hidden && firstVisible) {
    printerSelect.value = firstVisible.value;
    updatePrinterHint();
  }
  printerDropdown.refresh();
});

// ---- print ----
// Enter 鍵送出列印(排除印表機搜尋框跟頁碼範圍輸入框,避免打字打到一半誤送出)
optionsPanel.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target === printerSearch || e.target === pageRange) return;
  if (e.target.tagName === 'TEXTAREA') return;
  e.preventDefault();
  if (!printBtn.disabled) printBtn.click();
});

function buildPrintOptionsPayload() {
  const preset = WATERMARK_PRESETS[watermarkPreset.value];
  return {
    watermarkText: watermarkText.value,
    headerText: headerText.value,
    footerText: footerText.value,
    pageNumbers: pageNumbers.checked,
    pageOrder: !allPages.checked && customOrderActive ? customOrderPages : null,
    pageRotations: pageGridController ? pageGridController.getRotations() : {},
    layoutMode: layoutModeSelect.value,
    posterCols: Number(posterSize.value.split('x')[0]),
    posterRows: Number(posterSize.value.split('x')[1]),
    pageScale: Number(pageScale.value) || 100,
    watermarkImageId,
    watermarkColor: preset ? preset.color : null,
    watermarkOpacity: preset ? preset.opacity : null,
    stampImageId,
    stampPlacement: stampPlacementValue,
  };
}

previewBtn.addEventListener('click', async () => {
  if (!state.fileId) return;
  previewBtn.disabled = true;
  const original = previewBtn.textContent;
  previewBtn.textContent = '產生中...';
  try {
    const res = await fetch('/api/print-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: state.fileId,
        pageRange: allPages.checked ? '' : pageRange.value,
        ...buildPrintOptionsPayload(),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '預覽失敗');
    previewFrame.src = `/api/pdf-bytes/${data.id}`;
    previewMsg.classList.remove('show', 'error');
    previewModal.style.display = 'flex';
  } catch (err) {
    printMsg.textContent = err.message;
    printMsg.classList.add('show', 'error');
  } finally {
    previewBtn.disabled = false;
    previewBtn.textContent = original;
  }
});
function closePreviewModal() {
  previewModal.style.display = 'none';
  previewFrame.src = '';
}
previewCloseBtn.addEventListener('click', closePreviewModal);
previewModal.addEventListener('click', (e) => { if (e.target === previewModal) closePreviewModal(); });

scheduleEnabled.addEventListener('change', () => {
  scheduleAt.style.display = scheduleEnabled.checked ? 'block' : 'none';
  printBtn.textContent = scheduleEnabled.checked ? t('scheduleSubmitBtn') : t('printBtn');
  previewBtn.style.display = scheduleEnabled.checked ? 'none' : (batchModeActive ? 'none' : 'inline-block');
});

async function submitBatchPrint() {
  if (!printerSelect.value) {
    printMsg.textContent = '請先選擇印表機';
    printMsg.classList.add('show', 'error');
    return;
  }
  const res = await fetch('/api/print-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: pendingFiles.map((f) => ({ id: f.id, pageRange: f.pageRange || '' })),
      printerName: printerSelect.value,
      color: state.color,
      duplex: state.duplex,
      copies: copiesInput.value,
      watermarkText: watermarkText.value,
      headerText: headerText.value,
      footerText: footerText.value,
      pageNumbers: pageNumbers.checked,
    }),
  });
  const data = await res.json();
  if (!res.ok && !data.jobs) throw new Error(data.error || '批次列印失敗');
  const failedCount = (data.jobs || []).filter((j) => j.status === 'error').length;
  if (failedCount > 0) throw new Error(`${pendingFiles.length - failedCount}/${pendingFiles.length} 份成功,${failedCount} 份失敗,請查看列印紀錄`);
  savePrefs();
  pendingFiles = [];
  exitBatchMode();
  renderPendingList();
  printMsg.textContent = '已送出批次列印工作';
  printMsg.classList.add('show', 'ok');
}

async function submitSchedulePrint() {
  if (!state.fileId) return;
  if (!printerSelect.value) {
    printMsg.textContent = '請先選擇印表機';
    printMsg.classList.add('show', 'error');
    return;
  }
  const res = await fetch('/api/schedule-print', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: state.fileId,
      scheduledAt: scheduleAt.value ? new Date(scheduleAt.value).toISOString() : '',
      printerName: printerSelect.value,
      pageRange: allPages.checked ? '' : pageRange.value,
      color: state.color,
      duplex: state.duplex,
      copies: copiesInput.value,
      ...buildPrintOptionsPayload(),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '排程失敗');
  savePrefs();
  printMsg.textContent = '已加入排程';
  printMsg.classList.add('show', 'ok');
  loadScheduled();
}

async function submitNormalPrint() {
  if (!state.fileId) return;
  if (!printerSelect.value) {
    printMsg.textContent = '請先選擇印表機';
    printMsg.classList.add('show', 'error');
    return;
  }
  const res = await fetch('/api/print', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: state.fileId,
      printerName: printerSelect.value,
      pageRange: allPages.checked ? '' : pageRange.value,
      color: state.color,
      duplex: state.duplex,
      copies: copiesInput.value,
      ...buildPrintOptionsPayload(),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '列印失敗');
  savePrefs();
  printMsg.textContent = '已送出列印工作';
  printMsg.classList.add('show', 'ok');
  loadJobs();
}

printBtn.addEventListener('click', async () => {
  printMsg.classList.remove('show', 'error', 'ok');
  printBtn.disabled = true;
  const original = printBtn.textContent;
  printBtn.textContent = '處理中...';

  try {
    if (batchModeActive) await submitBatchPrint();
    else if (scheduleEnabled.checked) await submitSchedulePrint();
    else await submitNormalPrint();
  } catch (err) {
    printMsg.textContent = err.message;
    printMsg.classList.add('show', 'error');
  } finally {
    printBtn.disabled = false;
    printBtn.textContent = original;
  }
});

// ---- job history ----
function statusLabel(s) {
  if (s === 'done') return t('statusDone');
  if (s === 'error') return t('statusError');
  return t('statusPrinting');
}
function duplexLabel(d) {
  if (d === 'duplex-long') return t('duplexLongEdge');
  if (d === 'duplex-short') return t('duplexShortEdge');
  return t('simplex');
}
function colorLabel(c) {
  if (c === 'color') return t('colorColor');
  if (c === 'gray') return t('colorGray');
  return t('colorMono');
}

let jobsCache = [];

async function loadJobs() {
  try {
    const res = await fetch('/api/jobs');
    const data = await res.json();
    jobsCache = data.jobs || [];
    renderJobs();
  } catch {
    jobsWrap.innerHTML = `<div class="empty">${t('noRecords')}</div>`;
  }
}

function renderJobs() {
  const q = jobFilter.value.trim().toLowerCase();
  const statusQ = jobStatusFilter.value;
  const filtered = jobsCache.filter((j) => {
    if (statusQ && j.status !== statusQ) return false;
    if (!q) return true;
    return (
      j.originalName.toLowerCase().includes(q) ||
      j.printerName.toLowerCase().includes(q)
    );
  });

  if (!filtered.length) {
    jobsWrap.innerHTML = `<div class="empty">${t('noRecords')}</div>`;
    return;
  }
  const rows = filtered
    .map((j) => {
      const time = new Date(j.createdAt).toLocaleString('zh-TW', { hour12: false });
      return `<tr>
        <td>${time}</td>
        <td>${escapeHtml(j.originalName)}</td>
        <td>${escapeHtml(j.printerName)}</td>
        <td>${escapeHtml(j.pageRange)}</td>
        <td>${colorLabel(j.color)} / ${duplexLabel(j.duplex)}${j.layout ? ' / ' + escapeHtml(j.layout) : ''}</td>
        <td class="status-${j.status}">${statusLabel(j.status)}</td>
        <td>${escapeHtml(j.printedBy || '-')}</td>
      </tr>`;
    })
    .join('');
  jobsWrap.innerHTML = `<table>
    <thead><tr>
      <th>${t('colTime')}</th><th>${t('colFile')}</th><th>${t('printer')}</th>
      <th>${t('pageRange')}</th><th>${t('colSettings')}</th><th>${t('colStatus')}</th><th>${t('colOperator')}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

jobFilter.addEventListener('input', renderJobs);
jobStatusFilter.addEventListener('change', renderJobs);

// ---- 排程中的列印 ----
async function loadScheduled() {
  try {
    const res = await fetch('/api/scheduled-jobs');
    const data = await res.json();
    renderScheduled(data.scheduled || []);
  } catch {
    // 讀取失敗就不顯示這個區塊,不影響其他功能
  }
}
function renderScheduled(list) {
  if (!list.length) {
    scheduledPanel.style.display = 'none';
    return;
  }
  scheduledPanel.style.display = 'block';
  const rows = list
    .map((s) => {
      const time = new Date(s.scheduledAt).toLocaleString('zh-TW', { hour12: false });
      return `<tr>
        <td>${time}</td>
        <td>${escapeHtml(s.originalName)}</td>
        <td>${escapeHtml(s.printerName)}</td>
        <td><button type="button" class="link-btn" data-cancel="${s.id}">${t('cancelSchedule')}</button></td>
      </tr>`;
    })
    .join('');
  scheduledWrap.innerHTML = `<table>
    <thead><tr><th>${t('colTime')}</th><th>${t('colFile')}</th><th>${t('printer')}</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
  scheduledWrap.querySelectorAll('[data-cancel]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await fetch(`/api/schedule-print/${btn.dataset.cancel}`, { method: 'DELETE' });
      } catch {
        // 忽略,重新整理清單即可反映最新狀態
      }
      loadScheduled();
    });
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---- QR Code 快速開啟 ----
qrBtn.addEventListener('click', async () => {
  const isOpen = qrPopover.style.display !== 'none';
  if (isOpen) { qrPopover.style.display = 'none'; return; }
  if (!qrImage.src) {
    try {
      const res = await fetch('/api/qrcode');
      if (res.ok) qrImage.src = URL.createObjectURL(await res.blob());
    } catch {
      // 抓不到就顯示空白圖示,不影響其他功能
    }
  }
  qrPopover.style.display = 'block';
});
document.addEventListener('click', (e) => {
  if (qrPopover.style.display === 'none') return;
  if (e.target === qrBtn || qrBtn.contains(e.target) || qrPopover.contains(e.target)) return;
  qrPopover.style.display = 'none';
});

// ---- 意見回饋 ----
function openFeedbackModal() {
  feedbackMsg.classList.remove('show', 'error', 'ok');
  feedbackText.value = '';
  feedbackModal.style.display = 'flex';
  feedbackText.focus();
}
function closeFeedbackModal() {
  feedbackModal.style.display = 'none';
}
feedbackFab.addEventListener('click', openFeedbackModal);
feedbackCancelBtn.addEventListener('click', closeFeedbackModal);
feedbackModal.addEventListener('click', (e) => {
  if (e.target === feedbackModal) closeFeedbackModal();
});
feedbackSubmitBtn.addEventListener('click', async () => {
  const message = feedbackText.value.trim();
  if (!message) return;
  feedbackSubmitBtn.disabled = true;
  try {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '送出失敗');
    feedbackMsg.textContent = t('feedbackSent');
    feedbackMsg.classList.add('show', 'ok');
    setTimeout(closeFeedbackModal, 1200);
  } catch (err) {
    feedbackMsg.textContent = err.message;
    feedbackMsg.classList.add('show', 'error');
  } finally {
    feedbackSubmitBtn.disabled = false;
  }
});

// ---- 簽名蓋章 ----
let stampImageId = null;
let stampPlacementValue = 'stamp-last-page';
const sigCtx = signatureCanvas.getContext('2d');
sigCtx.lineWidth = 2.5;
sigCtx.lineCap = 'round';
sigCtx.strokeStyle = '#111';
let sigDrawing = false;
let sigHasStrokes = false;

function sigPos(e) {
  const rect = signatureCanvas.getBoundingClientRect();
  const scaleX = signatureCanvas.width / rect.width;
  const scaleY = signatureCanvas.height / rect.height;
  return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
}
signatureCanvas.addEventListener('pointerdown', (e) => {
  sigDrawing = true;
  sigHasStrokes = true;
  const p = sigPos(e);
  sigCtx.beginPath();
  sigCtx.moveTo(p.x, p.y);
  signatureCanvas.setPointerCapture(e.pointerId);
});
signatureCanvas.addEventListener('pointermove', (e) => {
  if (!sigDrawing) return;
  const p = sigPos(e);
  sigCtx.lineTo(p.x, p.y);
  sigCtx.stroke();
});
signatureCanvas.addEventListener('pointerup', () => { sigDrawing = false; });
signatureCanvas.addEventListener('pointerleave', () => { sigDrawing = false; });

function clearSignatureCanvas() {
  sigCtx.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height);
  sigHasStrokes = false;
}
function openSignatureModal() {
  signatureMsg.classList.remove('show', 'error');
  signaturePlacement.value = stampPlacementValue;
  signatureModal.style.display = 'flex';
}
function closeSignatureModal() { signatureModal.style.display = 'none'; }
openSignatureBtn.addEventListener('click', openSignatureModal);
signatureCancelBtn.addEventListener('click', closeSignatureModal);
signatureClearBtn.addEventListener('click', clearSignatureCanvas);
signatureModal.addEventListener('click', (e) => { if (e.target === signatureModal) closeSignatureModal(); });

signatureConfirmBtn.addEventListener('click', async () => {
  if (!sigHasStrokes) {
    signatureMsg.textContent = t('signatureHint');
    signatureMsg.classList.add('show', 'error');
    return;
  }
  signatureConfirmBtn.disabled = true;
  try {
    const blob = await new Promise((resolve) => signatureCanvas.toBlob(resolve, 'image/png'));
    const form = new FormData();
    form.append('image', blob, 'signature.png');
    const res = await fetch('/api/upload-watermark-image', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '上傳簽名失敗');
    stampImageId = data.id;
    stampPlacementValue = signaturePlacement.value;
    signatureStatusHint.textContent = `${t('signatureBtn')} ✓`;
    closeSignatureModal();
  } catch (err) {
    signatureMsg.textContent = err.message;
    signatureMsg.classList.add('show', 'error');
  } finally {
    signatureConfirmBtn.disabled = false;
  }
});

// ---- PDF 密碼解鎖 ----
function promptForPdfPassword(data) {
  return new Promise((resolve) => {
    pdfPasswordMsg.classList.remove('show', 'error');
    pdfPasswordInput.value = '';
    passwordModal.style.display = 'flex';
    pdfPasswordInput.focus();

    function cleanup() {
      passwordModal.style.display = 'none';
      pdfPasswordSubmitBtn.removeEventListener('click', onSubmit);
      pdfPasswordCancelBtn.removeEventListener('click', onCancel);
      pdfPasswordInput.removeEventListener('keydown', onKeydown);
    }
    function onCancel() { cleanup(); resolve(null); }
    async function onSubmit() {
      const password = pdfPasswordInput.value;
      if (!password) return;
      pdfPasswordSubmitBtn.disabled = true;
      try {
        const res = await fetch('/api/decrypt-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: data.id, password }),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || '解鎖失敗');
        cleanup();
        resolve(result);
      } catch (err) {
        pdfPasswordMsg.textContent = err.message;
        pdfPasswordMsg.classList.add('show', 'error');
      } finally {
        pdfPasswordSubmitBtn.disabled = false;
      }
    }
    function onKeydown(e) { if (e.key === 'Enter') onSubmit(); }
    pdfPasswordSubmitBtn.addEventListener('click', onSubmit);
    pdfPasswordCancelBtn.addEventListener('click', onCancel);
    pdfPasswordInput.addEventListener('keydown', onKeydown);
  });
}

// ---- 鍵盤快速鍵(Ctrl/Cmd+P 送出列印、Esc 關閉彈窗/清除檔案) ----
function isTypingTarget(el) {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el === printerSearch || el === pageRange) return true;
  if (el.tagName === 'INPUT' && el.type !== 'checkbox' && el.type !== 'radio') return true;
  return false;
}
function closeTopmostModal() {
  if (signatureModal.style.display !== 'none') { closeSignatureModal(); return true; }
  if (previewModal.style.display !== 'none') { closePreviewModal(); return true; }
  if (feedbackModal.style.display !== 'none') { closeFeedbackModal(); return true; }
  if (qrPopover.style.display !== 'none') { qrPopover.style.display = 'none'; return true; }
  return false;
}
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
    e.preventDefault();
    if (optionsPanel.style.display !== 'none' && !printBtn.disabled) printBtn.click();
    return;
  }
  if (e.key === 'Escape') {
    if (closeTopmostModal()) return;
    if (isTypingTarget(e.target)) return;
    if (state.fileId) clearFile.click();
  }
});

loadPrinters();
loadJobs();
loadScheduled();
