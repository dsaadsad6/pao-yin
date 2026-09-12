const fs = require('fs/promises');
const fsSync = require('fs');
const fontkit = require('@pdf-lib/fontkit');

// pdf-lib 內建的 StandardFonts 只支援 WinAnsi 編碼,無法畫中文字,
// 這裡改用 Windows 內建的中文字型(標楷體),搭配 fontkit 嵌入 PDF。
const CANDIDATES = [
  process.env.CJK_FONT_PATH,
  'C:\\Windows\\Fonts\\kaiu.ttf',
  'C:\\Windows\\Fonts\\mingliu.ttc',
  'C:\\Windows\\Fonts\\simsun.ttc',
].filter(Boolean);

let cachedBytes;

async function loadCjkFontBytes() {
  if (cachedBytes) return cachedBytes;
  const found = CANDIDATES.find((p) => fsSync.existsSync(p));
  if (!found) {
    throw new Error('找不到可用的中文字型,請在 .env 設定 CJK_FONT_PATH 指向一個 .ttf 字型檔');
  }
  cachedBytes = await fs.readFile(found);
  return cachedBytes;
}

async function embedCjkFont(doc) {
  doc.registerFontkit(fontkit);
  const bytes = await loadCjkFontBytes();
  return doc.embedFont(bytes, { subset: true });
}

module.exports = { embedCjkFont, loadCjkFontBytes };
