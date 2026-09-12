const path = require('path');
const fs = require('fs/promises');
const { execFile } = require('child_process');
const { PDFDocument, rgb } = require('pdf-lib');
const sharp = require('sharp');
const { marked } = require('marked');
const { embedCjkFont } = require('./font');

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 24;

// LibreOffice 在某些帳號/服務環境下預設 profile 目錄沒有寫入權限,
// 改指定到專案內的固定目錄,避免轉檔靜默失敗
function loProfileUrl(outDir) {
  const profileDir = path.join(path.dirname(outDir), '.lo-profile');
  return profileDir.replace(/\\/g, '/');
}

async function imageToPdf(inputPath, outputPath, autoFix = true) {
  let bytes = await fs.readFile(inputPath);
  const ext = path.extname(inputPath).toLowerCase();
  let asPng = ext === '.png';

  if (autoFix) {
    // rotate(): 依 EXIF 方向自動轉正; trim(): 裁掉大片單色邊框
    try {
      bytes = await sharp(bytes).rotate().trim().png().toBuffer();
      asPng = true;
    } catch {
      // 修正失敗(例如圖片沒有可裁的邊框)就用原始檔案,不擋流程
    }
  }

  const doc = await PDFDocument.create();
  const image = asPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);

  const page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
  const maxW = A4_WIDTH - MARGIN * 2;
  const maxH = A4_HEIGHT - MARGIN * 2;
  const scale = Math.min(maxW / image.width, maxH / image.height, 1);
  const w = image.width * scale;
  const h = image.height * scale;

  page.drawImage(image, {
    x: (A4_WIDTH - w) / 2,
    y: (A4_HEIGHT - h) / 2,
    width: w,
    height: h,
  });

  const pdfBytes = await doc.save();
  await fs.writeFile(outputPath, pdfBytes);
  return outputPath;
}

function officeToPdf(inputPath, outDir, sofficePath) {
  return new Promise((resolve, reject) => {
    execFile(
      sofficePath,
      [
        '--headless',
        '--norestore',
        `-env:UserInstallation=file:///${loProfileUrl(outDir)}`,
        '--convert-to', 'pdf',
        '--outdir', outDir,
        inputPath,
      ],
      { windowsHide: true, timeout: 120000 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(`LibreOffice 轉檔失敗: ${err.message}\n${stderr}`));
        const base = path.basename(inputPath, path.extname(inputPath));
        const outPath = path.join(outDir, `${base}.pdf`);
        resolve(outPath);
      }
    );
  });
}

// Markdown 先轉成簡單的 HTML,再交給 LibreOffice 轉成 PDF(共用 officeToPdf)
async function markdownToPdf(mdPath, outDir, sofficePath) {
  const md = await fs.readFile(mdPath, 'utf-8');
  const body = marked(md);
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: "Microsoft JhengHei", sans-serif; padding: 32px; line-height: 1.6; }
    pre { background: #f2f2f2; padding: 12px; overflow-x: auto; }
    code { background: #f2f2f2; padding: 1px 4px; }
  </style></head><body>${body}</body></html>`;

  const base = path.basename(mdPath, path.extname(mdPath));
  const htmlPath = path.join(path.dirname(mdPath), `${base}.html`);
  await fs.writeFile(htmlPath, html, 'utf-8');
  try {
    return await officeToPdf(htmlPath, outDir, sofficePath);
  } finally {
    await fs.unlink(htmlPath).catch(() => {});
  }
}

// 純文字貼上列印:自動換行、自動分頁
async function textToPdf(text) {
  const doc = await PDFDocument.create();
  const font = await embedCjkFont(doc);
  const fontSize = 11;
  const lineHeight = fontSize * 1.4;
  const maxWidth = A4_WIDTH - MARGIN * 2;

  // 逐字元換行(中文沒有空白分詞,英數字混排時也還算堪用)
  function wrapLine(line) {
    if (!line) return [''];
    const out = [];
    let current = '';
    for (const ch of line) {
      const candidate = current + ch;
      if (font.widthOfTextAtSize(candidate, fontSize) > maxWidth && current) {
        out.push(current);
        current = ch;
      } else {
        current = candidate;
      }
    }
    if (current) out.push(current);
    return out.length ? out : [''];
  }

  const rawLines = text.replace(/\r\n/g, '\n').split('\n');
  const lines = rawLines.flatMap(wrapLine);

  let page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
  let y = A4_HEIGHT - MARGIN;
  for (const line of lines) {
    if (y < MARGIN) {
      page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
      y = A4_HEIGHT - MARGIN;
    }
    page.drawText(line, { x: MARGIN, y: y - fontSize, size: fontSize, font, color: rgb(0, 0, 0) });
    y -= lineHeight;
  }

  return doc.save();
}

// 內建測試頁(文字 + 灰階色塊),方便一鍵確認印表機是否正常
async function buildTestPagePdf() {
  const doc = await PDFDocument.create();
  const font = await embedCjkFont(doc);
  const page = doc.addPage([A4_WIDTH, A4_HEIGHT]);

  page.drawText('遠端影印 測試頁', { x: MARGIN, y: A4_HEIGHT - 60, size: 22, font, color: rgb(0, 0, 0) });
  page.drawText(new Date().toLocaleString('zh-TW', { hour12: false }), {
    x: MARGIN, y: A4_HEIGHT - 84, size: 11, font, color: rgb(0.3, 0.3, 0.3),
  });

  // 灰階色塊(確認印表機灰階/黑白呈現是否正常)
  const swatchW = (A4_WIDTH - MARGIN * 2) / 6;
  const swatchY = A4_HEIGHT - 160;
  for (let i = 0; i < 6; i++) {
    const shade = i / 5;
    page.drawRectangle({
      x: MARGIN + i * swatchW,
      y: swatchY,
      width: swatchW - 4,
      height: 40,
      color: rgb(1 - shade, 1 - shade, 1 - shade),
    });
  }

  // 簡單格線(確認邊界/縮放是否正確)
  const gridTop = swatchY - 30;
  const gridBottom = MARGIN + 30;
  for (let x = MARGIN; x <= A4_WIDTH - MARGIN; x += 40) {
    page.drawLine({ start: { x, y: gridTop }, end: { x, y: gridBottom }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
  }
  for (let y = gridBottom; y <= gridTop; y += 40) {
    page.drawLine({ start: { x: MARGIN, y }, end: { x: A4_WIDTH - MARGIN, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
  }

  page.drawText('如果這張紙印得出來、灰階色塊有深淺分別,', {
    x: MARGIN, y: MARGIN + 18, size: 9, font, color: rgb(0.3, 0.3, 0.3),
  });
  page.drawText('代表印表機連線與驅動設定正常。', {
    x: MARGIN, y: MARGIN + 6, size: 9, font, color: rgb(0.3, 0.3, 0.3),
  });

  return doc.save();
}

async function getPdfPageCount(pdfPath) {
  const bytes = await fs.readFile(pdfPath);
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return doc.getPageCount();
}

// 依指定順序把多份 PDF 合併成一份
async function mergePdfs(pdfPaths) {
  const merged = await PDFDocument.create();
  for (const p of pdfPaths) {
    const bytes = await fs.readFile(p);
    const src = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  return merged.save();
}

module.exports = {
  imageToPdf,
  officeToPdf,
  markdownToPdf,
  textToPdf,
  buildTestPagePdf,
  getPdfPageCount,
  mergePdfs,
};
