require('dotenv').config();

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const geoip = require('geoip-lite');
const cron = require('node-cron');

const { listPrinters } = require('./lib/printers');
const {
  imageToPdf,
  officeToPdf,
  markdownToPdf,
  textToPdf,
  buildTestPagePdf,
  getPdfPageCount,
  mergePdfs,
} = require('./lib/convert');
const { parsePageRange, printPdf } = require('./lib/print');
const { prepareForPrint } = require('./lib/print-prep');
const { urlToPdf } = require('./lib/urlToPdf');
const { scanToImage } = require('./lib/scan');

// file-type 只有 ESM 版本,從 CommonJS 這裡用動態 import() 載入
let fileTypeFromFilePromise;
function getFileTypeFromFile() {
  if (!fileTypeFromFilePromise) {
    fileTypeFromFilePromise = import('file-type').then((m) => m.fileTypeFromFile);
  }
  return fileTypeFromFilePromise;
}

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const SUMATRA_PATH = process.env.SUMATRA_PATH || 'SumatraPDF.exe';
const SOFFICE_PATH = process.env.SOFFICE_PATH || 'soffice.exe';
const EDGE_PATH = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PRINTER_STATS_FILE = path.join(__dirname, 'data', 'printer-stats.json');
const MAINTENANCE_THRESHOLD = parseInt(process.env.MAINTENANCE_THRESHOLD, 10) || 1000;
const PUBLIC_URL = process.env.PUBLIC_URL || '';
const QPDF_PATH = process.env.QPDF_PATH || 'qpdf.exe';

// 多組帳號:ACCOUNTS="帳號:密碼,帳號:密碼",沒設定就 fallback 回舊版單一 ACCESS_USERNAME/ACCESS_PASSWORD
function parseAccounts() {
  const raw = process.env.ACCOUNTS;
  if (raw && raw.trim()) {
    const accounts = raw.split(',').map((s) => s.trim()).filter(Boolean).map((pair) => {
      const idx = pair.indexOf(':');
      return { username: pair.slice(0, idx), password: pair.slice(idx + 1) };
    }).filter((a) => a.username && a.password);
    if (accounts.length > 0) return accounts;
  }
  return [{
    username: process.env.ACCESS_USERNAME || 'admin',
    password: process.env.ACCESS_PASSWORD || 'changeme',
  }];
}
const ACCOUNTS = parseAccounts();

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const CONVERTED_DIR = path.join(__dirname, 'converted');
const PRINT_READY_DIR = path.join(__dirname, 'print-ready');
const DATA_DIR = path.join(__dirname, 'data');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');
const FEEDBACK_FILE = path.join(DATA_DIR, 'feedback.json');
const SCHEDULED_FILE = path.join(DATA_DIR, 'scheduled-jobs.json');

const LO_PROFILE_DIR = path.join(__dirname, '.lo-profile');

for (const dir of [UPLOAD_DIR, CONVERTED_DIR, PRINT_READY_DIR, DATA_DIR, LO_PROFILE_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
if (!fs.existsSync(JOBS_FILE)) fs.writeFileSync(JOBS_FILE, '[]');
if (!fs.existsSync(PRINTER_STATS_FILE)) fs.writeFileSync(PRINTER_STATS_FILE, '{}');
if (!fs.existsSync(FEEDBACK_FILE)) fs.writeFileSync(FEEDBACK_FILE, '[]');
if (!fs.existsSync(SCHEDULED_FILE)) fs.writeFileSync(SCHEDULED_FILE, '[]');

// ---- 排程列印 ----
function readScheduled() {
  try {
    return JSON.parse(fs.readFileSync(SCHEDULED_FILE, 'utf-8'));
  } catch {
    return [];
  }
}
function writeScheduled(list) {
  fs.writeFileSync(SCHEDULED_FILE, JSON.stringify(list, null, 2));
}

// ---- 意見回饋 ----
function readFeedback() {
  try {
    return JSON.parse(fs.readFileSync(FEEDBACK_FILE, 'utf-8'));
  } catch {
    return [];
  }
}
function addFeedback(entry) {
  const list = readFeedback();
  list.push(entry);
  fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(list.slice(-500), null, 2));
}

// ---- 印表機維護提醒(累積列印頁數) ----
function readPrinterStats() {
  try {
    return JSON.parse(fs.readFileSync(PRINTER_STATS_FILE, 'utf-8'));
  } catch {
    return {};
  }
}
function addPrinterPages(printerName, pages) {
  const stats = readPrinterStats();
  stats[printerName] = (stats[printerName] || 0) + pages;
  fs.writeFileSync(PRINTER_STATS_FILE, JSON.stringify(stats, null, 2));
}
function countSelectedPages(rangeStr, totalPages) {
  if (!rangeStr || !rangeStr.trim()) return totalPages;
  let count = 0;
  for (const part of rangeStr.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const start = parseInt(m[1], 10);
    const end = m[2] ? parseInt(m[2], 10) : start;
    count += Math.abs(end - start) + 1;
  }
  return count || totalPages;
}

// ---- 檔案上傳設定 ----
const ALLOWED_EXT = new Set([
  '.jpg', '.jpeg', '.png', '.pdf', '.doc', '.docx',
  '.ppt', '.pptx', '.xls', '.xlsx', '.txt', '.md',
]);

// 上傳的檔案副檔名跟實際內容的魔術位元組要相符,防止偽裝檔案
// txt/md 是純文字,沒有固定的魔術位元組可比對,略過檢查
const SIGNATURE_MAP = {
  '.pdf': ['pdf'],
  '.jpg': ['jpg'], '.jpeg': ['jpg'],
  '.png': ['png'],
  '.doc': ['cfb'], '.xls': ['cfb'], '.ppt': ['cfb'],
  '.docx': ['zip'], '.xlsx': ['zip'], '.pptx': ['zip'],
};

async function validateFileSignature(filePath, ext) {
  const expected = SIGNATURE_MAP[ext];
  if (!expected) return true; // txt/md 無需檢查
  const fileTypeFromFile = await getFileTypeFromFile();
  const detected = await fileTypeFromFile(filePath);
  return !!detected && expected.includes(detected.ext);
}
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const id = crypto.randomUUID();
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${id}${ext}`);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // 瀏覽器送出的檔名是 UTF-8,但 multer/busboy 預設當成 latin1 解讀,
    // 中文檔名會變亂碼,這裡轉回正確編碼
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return cb(new Error('不支援的檔案格式'));
    cb(null, true);
  },
});

// ---- 浮水印/簽名圖片上傳(僅存本機,不轉檔) ----
const watermarkImageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const id = crypto.randomUUID();
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${id}${ext}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.png' && ext !== '.jpg' && ext !== '.jpeg') return cb(new Error('僅支援 PNG / JPG 圖片'));
    cb(null, true);
  },
});

// ---- jobs 簡易儲存 ----
function readJobs() {
  try {
    return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}
function writeJobs(jobs) {
  fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs.slice(-100), null, 2));
}
function addJob(job) {
  const jobs = readJobs();
  jobs.push(job);
  writeJobs(jobs);
}

// ---- 檔案登記表(上傳後轉檔完成的 PDF 路徑與頁數) ----
const fileRegistry = new Map(); // id -> { pdfPath, pageCount, originalName }

const app = express();
// 對外是透過 Cloudflare Tunnel + Worker 反代,請求會帶 X-Forwarded-For,
// 不設定這個 express-rate-limit 會直接丟未攔截例外把整個 process 弄掛
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }, // 7 天
  })
);

function requireAuth(req, res, next) {
  if (req.session && req.session.authed) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: '尚未登入' });
  return res.redirect('/login.html');
}

// 登入頁、首頁介紹頁與共用靜態資源允許匿名存取,實際列印工具(/print/)以下一律需要登入
app.use('/login.html', express.static(path.join(__dirname, 'public', 'login.html')));
app.use('/style.css', express.static(path.join(__dirname, 'public', 'style.css')));
app.use('/login.js', express.static(path.join(__dirname, 'public', 'login.js')));
app.use('/icon.png', express.static(path.join(__dirname, 'public', 'icon.png')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '嘗試次數過多,請稍後再試' },
});

app.post('/api/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  const matched = ACCOUNTS.find((a) => a.username === username && a.password === password);
  if (matched) {
    req.session.authed = true;
    req.session.username = matched.username;
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: '帳號或密碼錯誤' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/pdfjs', express.static(path.join(__dirname, 'node_modules', 'pdfjs-dist', 'build')));

app.get('/api/printers', async (req, res) => {
  try {
    const printers = await listPrinters();
    const stats = readPrinterStats();
    const withStats = printers.map((p) => ({
      ...p,
      pagesPrinted: stats[p.name] || 0,
      maintenanceDue: (stats[p.name] || 0) >= MAINTENANCE_THRESHOLD,
    }));
    res.json({ printers: withStats, maintenanceThreshold: MAINTENANCE_THRESHOLD });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/pdf-bytes/:id', (req, res) => {
  const entry = fileRegistry.get(req.params.id);
  if (!entry) return res.status(404).json({ error: '找不到檔案' });
  res.setHeader('Content-Type', 'application/pdf');
  res.sendFile(entry.pdfPath);
});

app.post('/api/merge', async (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length < 2) {
    return res.status(400).json({ error: '至少要選 2 份檔案才能合併' });
  }

  const entries = ids.map((id) => fileRegistry.get(id));
  if (entries.some((e) => !e)) {
    return res.status(404).json({ error: '有檔案找不到,請重新上傳' });
  }

  try {
    const id = crypto.randomUUID();
    const mergedBytes = await mergePdfs(entries.map((e) => e.pdfPath));
    const pdfPath = path.join(CONVERTED_DIR, `${id}.pdf`);
    await fs.promises.writeFile(pdfPath, mergedBytes);

    const pageCount = await getPdfPageCount(pdfPath);
    const originalName = `合併文件(${entries.length} 份)`;
    fileRegistry.set(id, { pdfPath, pageCount, originalName });

    res.json({ id, originalName, kind: 'merged', pageCount });
  } catch (e) {
    res.status(500).json({ error: `合併失敗: ${e.message}` });
  }
});

app.post('/api/upload', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: '沒有收到檔案' });

    const ext = path.extname(req.file.originalname).toLowerCase();
    const id = path.basename(req.file.filename, ext);
    const autoFix = req.body.autoFix !== 'false';

    try {
      const signatureOk = await validateFileSignature(req.file.path, ext);
      if (!signatureOk) {
        await fs.promises.unlink(req.file.path).catch(() => {});
        return res.status(400).json({ error: '檔案內容跟副檔名不符,可能是偽裝過的檔案,已拒絕' });
      }

      let pdfPath;
      let kind;

      if (ext === '.pdf') {
        pdfPath = req.file.path;
        kind = 'pdf';

        // 先試著讀頁數,如果是加密過的 PDF,pdf-lib 會直接丟出帶有 "encrypted" 字樣的錯誤
        try {
          const pageCount = await getPdfPageCount(pdfPath);
          fileRegistry.set(id, { pdfPath, pageCount, originalName: req.file.originalname });
          return res.json({ id, originalName: req.file.originalname, kind, pageCount });
        } catch (e) {
          if (!/encrypt/i.test(e.message || '')) throw e;
          fileRegistry.set(id, { pdfPath, pageCount: null, originalName: req.file.originalname, kind: 'pdf', encrypted: true });
          return res.json({ id, originalName: req.file.originalname, kind, needsPassword: true });
        }
      } else if (ext === '.jpg' || ext === '.jpeg' || ext === '.png') {
        pdfPath = path.join(CONVERTED_DIR, `${id}.pdf`);
        await imageToPdf(req.file.path, pdfPath, autoFix);
        kind = 'image';
      } else if (ext === '.doc' || ext === '.docx' || ext === '.ppt' || ext === '.pptx' || ext === '.xls' || ext === '.xlsx') {
        pdfPath = await officeToPdf(req.file.path, CONVERTED_DIR, SOFFICE_PATH);
        kind = 'office';
      } else if (ext === '.md') {
        pdfPath = await markdownToPdf(req.file.path, CONVERTED_DIR, SOFFICE_PATH);
        kind = 'office';
      } else if (ext === '.txt') {
        pdfPath = await officeToPdf(req.file.path, CONVERTED_DIR, SOFFICE_PATH);
        kind = 'office';
      } else {
        return res.status(400).json({ error: '不支援的檔案格式' });
      }

      const pageCount = await getPdfPageCount(pdfPath);
      fileRegistry.set(id, { pdfPath, pageCount, originalName: req.file.originalname });

      res.json({ id, originalName: req.file.originalname, kind, pageCount });
    } catch (e) {
      res.status(500).json({ error: `處理檔案失敗: ${e.message}` });
    }
  });
});

app.post('/api/upload-watermark-image', (req, res) => {
  watermarkImageUpload.single('image')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: '沒有收到圖片' });

    const ext = path.extname(req.file.originalname).toLowerCase();
    try {
      const signatureOk = await validateFileSignature(req.file.path, ext);
      if (!signatureOk) {
        await fs.promises.unlink(req.file.path).catch(() => {});
        return res.status(400).json({ error: '圖片內容跟副檔名不符,可能是偽裝過的檔案,已拒絕' });
      }
      const id = path.basename(req.file.filename, ext);
      fileRegistry.set(id, {
        pdfPath: null,
        imagePath: req.file.path,
        pageCount: 0,
        originalName: req.file.originalname,
        kind: 'image-asset',
      });
      res.json({ id });
    } catch (e) {
      res.status(500).json({ error: `圖片處理失敗: ${e.message}` });
    }
  });
});

app.post('/api/decrypt-pdf', (req, res) => {
  const { id, password } = req.body || {};
  const entry = fileRegistry.get(id);
  if (!entry || !entry.encrypted) return res.status(404).json({ error: '找不到需要解鎖的檔案,請重新上傳' });
  if (!password) return res.status(400).json({ error: '請輸入密碼' });

  const outPath = path.join(CONVERTED_DIR, `${crypto.randomUUID()}.pdf`);
  execFile(
    QPDF_PATH,
    [`--password=${password}`, '--decrypt', entry.pdfPath, outPath],
    { windowsHide: true, timeout: 30000 },
    async (err) => {
      if (err) return res.status(400).json({ error: '密碼錯誤,或這份 PDF 用了 qpdf 不支援的加密方式' });
      try {
        const pageCount = await getPdfPageCount(outPath);
        entry.pdfPath = outPath;
        entry.pageCount = pageCount;
        entry.encrypted = false;
        res.json({ id, originalName: entry.originalName, kind: 'pdf', pageCount });
      } catch (e) {
        res.status(500).json({ error: `解鎖後讀取失敗: ${e.message}` });
      }
    }
  );
});

app.post('/api/paste-text', async (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: '內容是空的' });
  if (text.length > 200000) return res.status(400).json({ error: '文字內容過長' });

  try {
    const id = crypto.randomUUID();
    const pdfBytes = await textToPdf(text);
    const pdfPath = path.join(CONVERTED_DIR, `${id}.pdf`);
    await fs.promises.writeFile(pdfPath, pdfBytes);

    const pageCount = await getPdfPageCount(pdfPath);
    const originalName = `貼上的文字 (${new Date().toLocaleString('zh-TW', { hour12: false })})`;
    fileRegistry.set(id, { pdfPath, pageCount, originalName });

    res.json({ id, originalName, kind: 'text', pageCount });
  } catch (e) {
    res.status(500).json({ error: `處理文字失敗: ${e.message}` });
  }
});

app.post('/api/test-page', async (req, res) => {
  try {
    const id = crypto.randomUUID();
    const pdfBytes = await buildTestPagePdf();
    const pdfPath = path.join(CONVERTED_DIR, `${id}.pdf`);
    await fs.promises.writeFile(pdfPath, pdfBytes);

    const pageCount = await getPdfPageCount(pdfPath);
    const originalName = '印表機測試頁';
    fileRegistry.set(id, { pdfPath, pageCount, originalName });

    res.json({ id, originalName, kind: 'test', pageCount });
  } catch (e) {
    res.status(500).json({ error: `產生測試頁失敗: ${e.message}` });
  }
});

app.post('/api/url-to-pdf', async (req, res) => {
  const { url } = req.body || {};
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: '請輸入以 http:// 或 https:// 開頭的網址' });
  }

  try {
    const id = crypto.randomUUID();
    const pdfPath = path.join(CONVERTED_DIR, `${id}.pdf`);
    await urlToPdf(url, pdfPath, EDGE_PATH);

    const pageCount = await getPdfPageCount(pdfPath);
    const originalName = url;
    fileRegistry.set(id, { pdfPath, pageCount, originalName });

    res.json({ id, originalName, kind: 'url', pageCount });
  } catch (e) {
    res.status(500).json({ error: `網頁轉檔失敗: ${e.message}` });
  }
});

app.post('/api/scan', async (req, res) => {
  try {
    const id = crypto.randomUUID();
    const imgPath = path.join(UPLOAD_DIR, `${id}.jpg`);
    await scanToImage(imgPath);

    const pdfPath = path.join(CONVERTED_DIR, `${id}.pdf`);
    await imageToPdf(imgPath, pdfPath, true);

    const pageCount = await getPdfPageCount(pdfPath);
    const originalName = `掃描文件 (${new Date().toLocaleString('zh-TW', { hour12: false })})`;
    fileRegistry.set(id, { pdfPath, pageCount, originalName });

    res.json({ id, originalName, kind: 'scan', pageCount });
  } catch (e) {
    res.status(500).json({ error: `掃描失敗: ${e.message}` });
  }
});

function resolveWatermarkImagePath(watermarkImageId) {
  if (!watermarkImageId) return null;
  const imgEntry = fileRegistry.get(watermarkImageId);
  if (!imgEntry || imgEntry.kind !== 'image-asset') return null;
  return imgEntry.imagePath;
}

// 所有列印路徑(網頁即時列印/批次列印/排程列印)共用的核心邏輯。
// spec 需要的欄位已經是「完全解析好」的資料(pdfPath 是實際檔案路徑、watermarkImagePath 已解析成真實路徑等),
// 這樣排程列印在真正執行的當下就算 fileRegistry 已經變動也不受影響。
async function executePrintJob(spec) {
  const {
    pdfPath, pageCount, originalName, printerName, pageRange, color, duplex, copies,
    watermarkText, headerText, footerText, pageNumbers, pageOrder,
    layoutMode, posterCols, posterRows, pageScale, pageRotations,
    watermarkImagePath, watermarkColor, watermarkOpacity,
    stampImagePath, stampPlacement, printedBy, batchId,
  } = spec;

  const hasCustomOrder = Array.isArray(pageOrder) && pageOrder.length > 0;
  const hasLayout = layoutMode && layoutMode !== 'none';
  const bypassRange = hasCustomOrder || hasLayout;
  const effectivePageOrder = hasCustomOrder
    ? pageOrder
    : (hasLayout ? Array.from({ length: pageCount }, (_, i) => i + 1) : null);

  const job = {
    id: crypto.randomUUID(),
    originalName,
    printerName,
    pageRange: hasCustomOrder ? `自訂順序(${pageOrder.length} 頁)` : (pageRange && String(pageRange).trim() ? String(pageRange).trim() : `1-${pageCount}`),
    layout: { nup2: '2-up', nup4: '4-up', booklet: '小冊子', poster: '海報' }[layoutMode] || null,
    color: color === 'color' ? 'color' : color === 'gray' ? 'gray' : 'mono',
    duplex: duplex || 'simplex',
    copies: copies || 1,
    status: 'printing',
    printedBy: printedBy || null,
    batchId: batchId || null,
    attempts: 0,
    createdAt: new Date().toISOString(),
  };
  addJob(job);

  // 保守版重試:只在「指令根本沒送出去」(例如 SumatraPDF.exe 執行檔本身叫不起來)時才重試,
  // 已經呼叫過 SumatraPDF、真的跟印表機互動過的失敗一律不重試,避免物理重複出紙
  const MAX_SUBMIT_RETRIES = 2;
  let lastErr = null;
  for (let attempt = 0; attempt <= MAX_SUBMIT_RETRIES; attempt++) {
    job.attempts = attempt + 1;
    try {
      const normalizedRange = bypassRange ? null : parsePageRange(pageRange, pageCount);
      if (!hasCustomOrder && normalizedRange) job.pageRange = normalizedRange;

      const printPdfPath = await prepareForPrint(
        pdfPath,
        {
          watermarkText, headerText, footerText, pageNumbers,
          pageOrder: effectivePageOrder,
          layoutMode, posterCols, posterRows,
          pageScale, pageRotations,
          watermarkImagePath, watermarkColor, watermarkOpacity,
          stampImagePath, stampPlacement,
        },
        PRINT_READY_DIR
      );
      await printPdf({
        sumatraPath: SUMATRA_PATH,
        printerName,
        pdfPath: printPdfPath,
        pageRange: normalizedRange,
        color,
        duplex,
        copies,
      });
      job.status = 'done';
      try {
        const finalPageCount = await getPdfPageCount(printPdfPath);
        addPrinterPages(printerName, finalPageCount * (parseInt(copies, 10) || 1));
      } catch {
        // 統計失敗不影響列印結果本身
      }
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      const isSpawnFailure = /ENOENT/.test(e.message || '');
      if (!isSpawnFailure || attempt === MAX_SUBMIT_RETRIES) break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  if (lastErr) {
    console.error('列印失敗:', lastErr);
    job.status = 'error';
    job.error = /頁碼格式錯誤|頁碼超出範圍/.test(lastErr.message || '')
      ? lastErr.message
      : '印表機沒有回應或列印失敗,請確認印表機是否連線、紙張/墨水是否足夠,再重試一次';
  }

  const jobs = readJobs();
  const idx = jobs.findIndex((j) => j.id === job.id);
  if (idx >= 0) jobs[idx] = job;
  writeJobs(jobs);

  return job;
}

app.post('/api/print', async (req, res) => {
  const {
    id, printerName, pageRange, color, duplex, copies,
    watermarkText, headerText, footerText, pageNumbers, pageOrder,
    layoutMode, posterCols, posterRows,
    pageScale, pageRotations, watermarkImageId, watermarkColor, watermarkOpacity,
    stampImageId, stampPlacement,
  } = req.body || {};
  const entry = fileRegistry.get(id);
  if (!entry) return res.status(404).json({ error: '找不到檔案,請重新上傳' });
  if (!printerName) return res.status(400).json({ error: '請選擇印表機' });

  if (Array.isArray(pageOrder) && pageOrder.length > 0) {
    const valid = pageOrder.every((n) => Number.isInteger(n) && n >= 1 && n <= entry.pageCount);
    if (!valid) return res.status(400).json({ error: '自訂排序的頁碼超出範圍' });
  }

  const job = await executePrintJob({
    pdfPath: entry.pdfPath, pageCount: entry.pageCount, originalName: entry.originalName,
    printerName, pageRange, color, duplex, copies,
    watermarkText, headerText, footerText, pageNumbers, pageOrder,
    layoutMode, posterCols, posterRows, pageScale, pageRotations,
    watermarkImagePath: resolveWatermarkImagePath(watermarkImageId),
    watermarkColor, watermarkOpacity,
    stampImagePath: resolveWatermarkImagePath(stampImageId),
    stampPlacement,
    printedBy: (req.session && req.session.username) || null,
  });

  if (job.status === 'error') return res.status(500).json({ error: job.error, job });
  res.json({ ok: true, job });
});

app.post('/api/print-batch', async (req, res) => {
  const {
    items, printerName, color, duplex, copies,
    watermarkText, headerText, footerText, pageNumbers,
  } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: '沒有要批次列印的檔案' });
  }
  if (!printerName) return res.status(400).json({ error: '請選擇印表機' });

  const entries = items.map((item) => ({ item, entry: fileRegistry.get(item.id) }));
  const missing = entries.find((e) => !e.entry);
  if (missing) return res.status(404).json({ error: '有檔案找不到,請重新上傳' });

  const batchId = crypto.randomUUID();
  const printedBy = (req.session && req.session.username) || null;
  const jobs = [];
  // 依序而非平行送印,避免多個 SumatraPDF 同時搶同一台印表機
  for (const { item, entry } of entries) {
    const job = await executePrintJob({
      pdfPath: entry.pdfPath, pageCount: entry.pageCount, originalName: entry.originalName,
      printerName, pageRange: item.pageRange, color, duplex, copies,
      watermarkText, headerText, footerText, pageNumbers,
      printedBy, batchId,
    });
    jobs.push(job);
  }

  const hasError = jobs.some((j) => j.status === 'error');
  res.status(hasError ? 207 : 200).json({ ok: !hasError, jobs });
});

app.post('/api/schedule-print', (req, res) => {
  const {
    id, scheduledAt, printerName, pageRange, color, duplex, copies,
    watermarkText, headerText, footerText, pageNumbers, pageOrder,
    layoutMode, posterCols, posterRows, pageScale, pageRotations,
    watermarkImageId, watermarkColor, watermarkOpacity,
  } = req.body || {};
  const entry = fileRegistry.get(id);
  if (!entry) return res.status(404).json({ error: '找不到檔案,請重新上傳' });
  if (!printerName) return res.status(400).json({ error: '請選擇印表機' });

  const when = new Date(scheduledAt);
  if (!scheduledAt || Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
    return res.status(400).json({ error: '請選擇一個未來的時間' });
  }
  if (Array.isArray(pageOrder) && pageOrder.length > 0) {
    const valid = pageOrder.every((n) => Number.isInteger(n) && n >= 1 && n <= entry.pageCount);
    if (!valid) return res.status(400).json({ error: '自訂排序的頁碼超出範圍' });
  }

  const scheduled = {
    id: crypto.randomUUID(),
    scheduledAt: when.toISOString(),
    status: 'pending',
    createdAt: new Date().toISOString(),
    printedBy: (req.session && req.session.username) || null,
    originalName: entry.originalName,
    printerName,
    spec: {
      pdfPath: entry.pdfPath, pageCount: entry.pageCount, originalName: entry.originalName,
      printerName, pageRange, color, duplex, copies,
      watermarkText, headerText, footerText, pageNumbers, pageOrder,
      layoutMode, posterCols, posterRows, pageScale, pageRotations,
      watermarkImagePath: resolveWatermarkImagePath(watermarkImageId),
      watermarkColor, watermarkOpacity,
    },
  };
  const list = readScheduled();
  list.push(scheduled);
  writeScheduled(list);

  res.json({ ok: true, scheduled: { id: scheduled.id, scheduledAt: scheduled.scheduledAt, originalName: scheduled.originalName, printerName } });
});

app.get('/api/scheduled-jobs', (req, res) => {
  const list = readScheduled()
    .filter((s) => s.status === 'pending')
    .map((s) => ({ id: s.id, scheduledAt: s.scheduledAt, originalName: s.originalName, printerName: s.printerName, printedBy: s.printedBy }))
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
  res.json({ scheduled: list });
});

app.delete('/api/schedule-print/:id', (req, res) => {
  const list = readScheduled();
  const idx = list.findIndex((s) => s.id === req.params.id && s.status === 'pending');
  if (idx < 0) return res.status(404).json({ error: '找不到這筆排程,或已經執行過了' });
  list[idx].status = 'cancelled';
  writeScheduled(list);
  res.json({ ok: true });
});

const PREVIEW_TTL_MS = 10 * 60 * 1000;

app.post('/api/print-preview', async (req, res) => {
  const {
    id, pageOrder, layoutMode, posterCols, posterRows,
    watermarkText, headerText, footerText, pageNumbers,
    pageScale, pageRotations, watermarkImageId, watermarkColor, watermarkOpacity,
    stampImageId, stampPlacement,
  } = req.body || {};
  const entry = fileRegistry.get(id);
  if (!entry) return res.status(404).json({ error: '找不到檔案,請重新上傳' });

  const hasCustomOrder = Array.isArray(pageOrder) && pageOrder.length > 0;
  const hasLayout = layoutMode && layoutMode !== 'none';
  const effectivePageOrder = hasCustomOrder
    ? pageOrder
    : (hasLayout ? Array.from({ length: entry.pageCount }, (_, i) => i + 1) : null);

  try {
    const previewPath = await prepareForPrint(
      entry.pdfPath,
      {
        watermarkText, headerText, footerText, pageNumbers,
        pageOrder: effectivePageOrder,
        layoutMode, posterCols, posterRows,
        pageScale, pageRotations,
        watermarkImagePath: resolveWatermarkImagePath(watermarkImageId),
        watermarkColor, watermarkOpacity,
        stampImagePath: resolveWatermarkImagePath(stampImageId),
        stampPlacement,
      },
      PRINT_READY_DIR
    );
    const previewId = crypto.randomUUID();
    const pageCount = await getPdfPageCount(previewPath);
    fileRegistry.set(previewId, { pdfPath: previewPath, pageCount, originalName: entry.originalName, kind: 'preview' });
    setTimeout(() => {
      fileRegistry.delete(previewId);
      if (previewPath !== entry.pdfPath) fs.promises.unlink(previewPath).catch(() => {});
    }, PREVIEW_TTL_MS);
    res.json({ id: previewId, pageCount });
  } catch (e) {
    res.status(500).json({ error: `產生預覽失敗: ${e.message}` });
  }
});

app.get('/api/jobs', (req, res) => {
  const jobs = readJobs().slice().reverse();
  res.json({ jobs });
});

app.get('/api/qrcode', async (req, res) => {
  if (!PUBLIC_URL) return res.status(404).json({ error: '尚未設定 PUBLIC_URL' });
  try {
    const buffer = await QRCode.toBuffer(PUBLIC_URL, { width: 320, margin: 1 });
    res.type('png').send(buffer);
  } catch (e) {
    res.status(500).json({ error: `產生 QR Code 失敗: ${e.message}` });
  }
});

app.post('/api/feedback', (req, res) => {
  const { message } = req.body || {};
  if (!message || !message.trim()) return res.status(400).json({ error: '請輸入回饋內容' });
  if (message.length > 2000) return res.status(400).json({ error: '內容過長' });

  const ip = (req.ip || req.headers['cf-connecting-ip'] || '').replace(/^::ffff:/, '');
  // 用本機內建的 geoip-lite 資料庫查地理位置,不把使用者 IP 送到任何外部第三方服務
  let location = null;
  try {
    const geo = geoip.lookup(ip);
    if (geo) location = `${geo.country || ''} ${geo.region || ''} ${geo.city || ''}`.trim();
  } catch {
    // 查不到地理位置不影響回饋本身的儲存
  }

  addFeedback({
    id: crypto.randomUUID(),
    message: message.trim(),
    username: (req.session && req.session.username) || null,
    ip,
    location,
    createdAt: new Date().toISOString(),
  });

  res.json({ ok: true });
});

// 統一錯誤處理,避免把內部錯誤堆疊洩漏給外部使用者
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 400).json({ error: '請求處理失敗,請確認輸入內容' });
});

// 每分鐘檢查一次有沒有時間到的排程列印工作
let scheduledCronRunning = false;
cron.schedule('* * * * *', async () => {
  if (scheduledCronRunning) return;
  scheduledCronRunning = true;
  try {
    const list = readScheduled();
    const due = list.filter((s) => s.status === 'pending' && new Date(s.scheduledAt).getTime() <= Date.now());
    for (const s of due) {
      s.status = 'running';
      writeScheduled(list);
      try {
        const job = await executePrintJob({ ...s.spec, printedBy: s.printedBy });
        s.status = job.status === 'done' ? 'done' : 'error';
        s.jobId = job.id;
        if (job.status === 'error') s.error = job.error;
      } catch (e) {
        s.status = 'error';
        s.error = e.message;
      }
      writeScheduled(list);
    }
  } catch (e) {
    console.error('排程列印檢查失敗:', e);
  } finally {
    scheduledCronRunning = false;
  }
});

app.listen(PORT, () => {
  console.log(`拋印網站啟動: http://localhost:${PORT}`);
});
