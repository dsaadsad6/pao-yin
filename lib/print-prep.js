const fs = require('fs/promises');
const crypto = require('crypto');
const path = require('path');
const { PDFDocument, rgb, degrees } = require('pdf-lib');
const { embedCjkFont } = require('./font');
const { layoutNUp, layoutBooklet, layoutPoster } = require('./layout');

// 在真正送印前,依需要重新排頁/套版面/疊加浮水印,輸出成一份新的暫存 PDF。
// 完全不需要任何額外處理時回傳原始路徑,避免每次列印都重新解析 PDF。
async function prepareForPrint(pdfPath, opts, printReadyDir) {
  const {
    watermarkText, headerText, footerText, pageNumbers,
    pageOrder, layoutMode, posterCols, posterRows,
  } = opts || {};
  const hasWatermark = !!(watermarkText && watermarkText.trim());
  const hasHeader = !!(headerText && headerText.trim());
  const hasFooter = !!(footerText && footerText.trim());
  const hasCustomOrder = Array.isArray(pageOrder) && pageOrder.length > 0;
  const hasLayout = layoutMode && layoutMode !== 'none';

  if (!hasWatermark && !hasHeader && !hasFooter && !pageNumbers && !hasCustomOrder && !hasLayout) {
    return pdfPath;
  }

  let bytes = await fs.readFile(pdfPath);

  if (hasCustomOrder) {
    const srcDoc = await PDFDocument.load(bytes);
    const tmp = await PDFDocument.create();
    const copied = await tmp.copyPages(srcDoc, pageOrder.map((n) => n - 1));
    copied.forEach((page) => tmp.addPage(page));
    bytes = await tmp.save();
  }

  if (layoutMode === 'nup2') bytes = await layoutNUp(bytes, 2);
  else if (layoutMode === 'nup4') bytes = await layoutNUp(bytes, 4);
  else if (layoutMode === 'booklet') bytes = await layoutBooklet(bytes);
  else if (layoutMode === 'poster') bytes = await layoutPoster(bytes, posterCols || 2, posterRows || 2);

  const doc = await PDFDocument.load(bytes);
  const font = await embedCjkFont(doc);
  const pages = doc.getPages();

  pages.forEach((page, idx) => {
    const { width, height } = page.getSize();

    if (hasWatermark) {
      const size = 44;
      const textWidth = font.widthOfTextAtSize(watermarkText, size);
      page.drawText(watermarkText, {
        x: width / 2 - textWidth / 4,
        y: height / 2,
        size,
        font,
        color: rgb(0.6, 0.6, 0.6),
        opacity: 0.25,
        rotate: degrees(45),
      });
    }

    if (hasHeader) {
      page.drawText(headerText, { x: 24, y: height - 20, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    }

    if (hasFooter) {
      page.drawText(footerText, { x: 24, y: 14, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    }

    if (pageNumbers) {
      const label = `${idx + 1} / ${pages.length}`;
      const labelWidth = font.widthOfTextAtSize(label, 9);
      page.drawText(label, { x: width - 24 - labelWidth, y: 14, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    }
  });

  const outBytes = await doc.save();
  const outPath = path.join(printReadyDir, `${crypto.randomUUID()}.pdf`);
  await fs.writeFile(outPath, outBytes);
  return outPath;
}

module.exports = { prepareForPrint };
