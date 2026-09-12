const { execFile } = require('child_process');

// 解析 "1-3,5,7-9" 這種格式,回傳正規化字串,並驗證範圍是否落在 1..pageCount 之內
function parsePageRange(input, pageCount) {
  if (!input || !input.trim()) return null; // null = 全部頁數
  const parts = input.split(',').map((s) => s.trim()).filter(Boolean);
  const normalized = [];

  for (const part of parts) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw new Error(`頁碼格式錯誤: "${part}"`);
    let start = parseInt(m[1], 10);
    let end = m[2] ? parseInt(m[2], 10) : start;
    if (start > end) [start, end] = [end, start];
    if (start < 1 || end > pageCount) {
      throw new Error(`頁碼超出範圍(1-${pageCount}): "${part}"`);
    }
    normalized.push(start === end ? `${start}` : `${start}-${end}`);
  }

  return normalized.join(',');
}

function buildSettings({ pageRange, color, duplex }) {
  const settings = [];
  if (pageRange) settings.push(pageRange);
  settings.push(color === 'color' ? 'color' : 'monochrome');
  if (duplex === 'duplex-long') settings.push('duplex', 'duplexlong');
  else if (duplex === 'duplex-short') settings.push('duplexshort');
  else settings.push('simplex');
  return settings.join(',');
}

function printPdf({ sumatraPath, printerName, pdfPath, pageRange, color, duplex, copies = 1 }) {
  const settings = buildSettings({ pageRange, color, duplex });

  const runOnce = () =>
    new Promise((resolve, reject) => {
      const args = [
        '-print-to', printerName,
        '-print-settings', settings,
        '-silent',
        '-exit-when-done',
        pdfPath,
      ];
      execFile(sumatraPath, args, { windowsHide: true, timeout: 60000 }, (err, stdout, stderr) => {
        if (err) return reject(new Error(`列印失敗: ${err.message}\n${stderr}`));
        resolve();
      });
    });

  return (async () => {
    const n = Math.max(1, Math.min(50, parseInt(copies, 10) || 1));
    for (let i = 0; i < n; i++) {
      await runOnce();
    }
    return { settings, copies: n };
  })();
}

module.exports = { parsePageRange, buildSettings, printPdf };
