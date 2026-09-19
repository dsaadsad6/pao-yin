const { PDFDocument } = require('pdf-lib');

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 18;
const GAP = 10;

// N 個原始頁面縮小拼貼到一張紙上(2-up 直向堆疊、4-up 2x2)
async function layoutNUp(pdfBytes, perSheet) {
  const srcDoc = await PDFDocument.load(pdfBytes);
  const outDoc = await PDFDocument.create();
  const embedded = await outDoc.embedPages(srcDoc.getPages());

  const cols = perSheet === 4 ? 2 : 1;
  const rows = perSheet === 4 ? 2 : 2;
  const cellW = (A4_WIDTH - MARGIN * 2 - GAP * (cols - 1)) / cols;
  const cellH = (A4_HEIGHT - MARGIN * 2 - GAP * (rows - 1)) / rows;

  for (let i = 0; i < embedded.length; i += perSheet) {
    const page = outDoc.addPage([A4_WIDTH, A4_HEIGHT]);
    for (let j = 0; j < perSheet && i + j < embedded.length; j++) {
      const ep = embedded[i + j];
      const col = j % cols;
      const row = Math.floor(j / cols);
      const scale = Math.min(cellW / ep.width, cellH / ep.height);
      const w = ep.width * scale;
      const h = ep.height * scale;
      const cellX = MARGIN + col * (cellW + GAP);
      const cellY = A4_HEIGHT - MARGIN - (row + 1) * cellH - row * GAP;
      page.drawPage(ep, {
        x: cellX + (cellW - w) / 2,
        y: cellY + (cellH - h) / 2,
        width: w,
        height: h,
      });
    }
  }
  return outDoc.save();
}

// 騎馬釘小冊子排版:補頁到 4 的倍數,依標準拼版順序輸出(建議搭配雙面短邊列印)
async function layoutBooklet(pdfBytes) {
  const srcDoc = await PDFDocument.load(pdfBytes);
  const outDoc = await PDFDocument.create();
  const embedded = await outDoc.embedPages(srcDoc.getPages());

  const n = embedded.length;
  const padded = Math.ceil(n / 4) * 4;
  const pages = [...embedded];
  while (pages.length < padded) pages.push(null);

  const outW = A4_HEIGHT; // 橫向
  const outH = A4_WIDTH;
  const cellW = (outW - MARGIN * 2 - GAP) / 2;
  const cellH = outH - MARGIN * 2;

  const sheets = padded / 4;
  const sides = [];
  for (let i = 0; i < sheets; i++) {
    sides.push([padded - 1 - i * 2, i * 2]); // 正面:左右
    sides.push([i * 2 + 1, padded - 2 - i * 2]); // 背面:左右
  }

  for (const [leftIdx, rightIdx] of sides) {
    const page = outDoc.addPage([outW, outH]);
    [leftIdx, rightIdx].forEach((idx, slot) => {
      const ep = pages[idx];
      if (!ep) return;
      const scale = Math.min(cellW / ep.width, cellH / ep.height);
      const w = ep.width * scale;
      const h = ep.height * scale;
      const cellX = MARGIN + slot * (cellW + GAP);
      page.drawPage(ep, {
        x: cellX + (cellW - w) / 2,
        y: (outH - h) / 2,
        width: w,
        height: h,
      });
    });
  }
  return outDoc.save();
}

// 海報列印:把第一頁放大,拆成 cols x rows 張紙,列印後拼貼成海報
async function layoutPoster(pdfBytes, cols, rows) {
  const srcDoc = await PDFDocument.load(pdfBytes);
  const outDoc = await PDFDocument.create();
  const [ep] = await outDoc.embedPages([srcDoc.getPages()[0]]);

  const totalW = A4_WIDTH * cols;
  const totalH = A4_HEIGHT * rows;
  const scale = Math.min(totalW / ep.width, totalH / ep.height);
  const scaledW = ep.width * scale;
  const scaledH = ep.height * scale;
  const offsetX = (totalW - scaledW) / 2;
  const offsetY = (totalH - scaledH) / 2;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const page = outDoc.addPage([A4_WIDTH, A4_HEIGHT]);
      page.drawPage(ep, {
        x: offsetX - c * A4_WIDTH,
        y: offsetY - (rows - 1 - r) * A4_HEIGHT,
        width: scaledW,
        height: scaledH,
      });
    }
  }
  return outDoc.save();
}

// 自訂縮放:保持紙張大小不變,把每頁內容依比例縮放並置中(50%~200%)
async function layoutScale(pdfBytes, scalePercent) {
  const srcDoc = await PDFDocument.load(pdfBytes);
  const outDoc = await PDFDocument.create();
  const embedded = await outDoc.embedPages(srcDoc.getPages());
  const scale = scalePercent / 100;

  embedded.forEach((ep) => {
    const page = outDoc.addPage([ep.width, ep.height]);
    const w = ep.width * scale;
    const h = ep.height * scale;
    page.drawPage(ep, {
      x: (ep.width - w) / 2,
      y: (ep.height - h) / 2,
      width: w,
      height: h,
    });
  });
  return outDoc.save();
}

module.exports = { layoutNUp, layoutBooklet, layoutPoster, layoutScale };
