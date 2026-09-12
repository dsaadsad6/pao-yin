require('dotenv').config();

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const rateLimit = require('express-rate-limit');

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
const ACCESS_USERNAME = process.env.ACCESS_USERNAME || 'admin';
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || 'changeme';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const SUMATRA_PATH = process.env.SUMATRA_PATH || 'SumatraPDF.exe';
const SOFFICE_PATH = process.env.SOFFICE_PATH || 'soffice.exe';
const EDGE_PATH = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PRINTER_STATS_FILE = path.join(__dirname, 'data', 'printer-stats.json');
const MAINTENANCE_THRESHOLD = parseInt(process.env.MAINTENANCE_THRESHOLD, 10) || 1000;

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const CONVERTED_DIR = path.join(__dirname, 'converted');
const PRINT_READY_DIR = path.join(__dirname, 'print-ready');
const DATA_DIR = path.join(__dirname, 'data');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');

const LO_PROFILE_DIR = path.join(__dirname, '.lo-profile');

for (const dir of [UPLOAD_DIR, CONVERTED_DIR, PRINT_READY_DIR, DATA_DIR, LO_PROFILE_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
if (!fs.existsSync(JOBS_FILE)) fs.writeFileSync(JOBS_FILE, '[]');
if (!fs.existsSync(PRINTER_STATS_FILE)) fs.writeFileSync(PRINTER_STATS_FILE, '{}');

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
  if (username === ACCESS_USERNAME && password === ACCESS_PASSWORD) {
    req.session.authed = true;
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

app.post('/api/print', async (req, res) => {
  const {
    id, printerName, pageRange, color, duplex, copies,
    watermarkText, headerText, footerText, pageNumbers, pageOrder,
    layoutMode, posterCols, posterRows,
  } = req.body || {};
  const entry = fileRegistry.get(id);
  if (!entry) return res.status(404).json({ error: '找不到檔案,請重新上傳' });
  if (!printerName) return res.status(400).json({ error: '請選擇印表機' });

  const hasCustomOrder = Array.isArray(pageOrder) && pageOrder.length > 0;
  const hasLayout = layoutMode && layoutMode !== 'none';
  if (hasCustomOrder) {
    const valid = pageOrder.every((n) => Number.isInteger(n) && n >= 1 && n <= entry.pageCount);
    if (!valid) return res.status(400).json({ error: '自訂排序的頁碼超出範圍' });
  }

  // 版面模式(N-up/小冊子/海報)一定要先在伺服器端把選取的頁面組成一份新 PDF,
  // 所以只要用了版面模式,就一律走自訂頁序這條路,不再用 SumatraPDF 的頁碼範圍字串
  const bypassRange = hasCustomOrder || hasLayout;
  const effectivePageOrder = hasCustomOrder
    ? pageOrder
    : (hasLayout ? Array.from({ length: entry.pageCount }, (_, i) => i + 1) : null);

  let normalizedRange = null;
  if (!bypassRange) {
    try {
      normalizedRange = parsePageRange(pageRange, entry.pageCount);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }

  const layoutLabel = { nup2: '2-up', nup4: '4-up', booklet: '小冊子', poster: '海報' }[layoutMode];
  const job = {
    id: crypto.randomUUID(),
    fileId: id,
    originalName: entry.originalName,
    printerName,
    pageRange: hasCustomOrder
      ? `自訂順序(${pageOrder.length} 頁)`
      : (normalizedRange || `1-${entry.pageCount}`),
    layout: layoutLabel || null,
    color: color === 'color' ? 'color' : color === 'gray' ? 'gray' : 'mono',
    duplex: duplex || 'simplex',
    copies: copies || 1,
    status: 'printing',
    createdAt: new Date().toISOString(),
  };
  addJob(job);

  try {
    const printPdfPath = await prepareForPrint(
      entry.pdfPath,
      {
        watermarkText, headerText, footerText, pageNumbers,
        pageOrder: effectivePageOrder,
        layoutMode, posterCols, posterRows,
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
  } catch (e) {
    console.error('列印失敗:', e);
    job.status = 'error';
    job.error = '印表機沒有回應或列印失敗,請確認印表機是否連線、紙張/墨水是否足夠,再重試一次';
  }

  const jobs = readJobs();
  const idx = jobs.findIndex((j) => j.id === job.id);
  if (idx >= 0) jobs[idx] = job;
  writeJobs(jobs);

  if (job.status === 'error') return res.status(500).json({ error: job.error, job });
  res.json({ ok: true, job });
});

app.get('/api/jobs', (req, res) => {
  const jobs = readJobs().slice().reverse();
  res.json({ jobs });
});

// 統一錯誤處理,避免把內部錯誤堆疊洩漏給外部使用者
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 400).json({ error: '請求處理失敗,請確認輸入內容' });
});

app.listen(PORT, () => {
  console.log(`拋印網站啟動: http://localhost:${PORT}`);
});
