const fs = require('fs/promises');
const crypto = require('crypto');
const path = require('path');
const { PDFDocument, rgb, degrees } = require('pdf-lib');
const { embedCjkFont } = require('./font');
const { layoutNUp, layoutBooklet, layoutPoster, layoutScale } = require('./layout');

// 在真正送印前,依需要重新排頁/套版面/疊加浮水印,輸出成一份新的暫存 PDF。
// 完全不需要任何額外處理時回傳原始路徑,避免每次列印都重新解析 PDF。
async function prepareForPrint(pdfPath, opts, printReadyDir) {
  const {
    watermarkText, headerText, footerText, pageNumbers,
    pageOrder, layoutMode, posterCols, posterRows,
    pageScale, pageRotations,
    watermarkImagePath, watermarkImageOpacity,
    watermarkColor, watermarkOpacity,
    stampImagePath, stampPlacement, // 'stamp-last-page' | 'stamp-all-pages'(簽名章,階段5會用到)
  } = opts || {};
  const hasWatermark = !!(watermarkText && watermarkText.trim());
  const hasHeader = !!(headerText && headerText.trim());
  const hasFooter = !!(footerText && footerText.trim());
  const hasCustomOrder = Array.isArray(pageOrder) && pageOrder.length > 0;
  const hasLayout = layoutMode && layoutMode !== 'none';
  const hasScale = !!pageScale && Number(pageScale) !== 100 && !hasLayout;
  const hasRotations = !!pageRotations && Object.keys(pageRotations).length > 0 && !hasLayout;
  const hasWatermarkImage = !!watermarkImagePath;
  const hasStamp = !!stampImagePath;

  if (
    !hasWatermark && !hasHeader && !hasFooter && !pageNumbers && !hasCustomOrder &&
    !hasLayout && !hasScale && !hasRotations && !hasWatermarkImage && !hasStamp
  ) {
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
  else if (hasScale) bytes = await layoutScale(bytes, Number(pageScale));

  const doc = await PDFDocument.load(bytes);
  const font = await embedCjkFont(doc);
  const pages = doc.getPages();

  let watermarkImage = null;
  if (hasWatermarkImage) {
    const imgBytes = await fs.readFile(watermarkImagePath);
    const ext = path.extname(watermarkImagePath).toLowerCase();
    watermarkImage = ext === '.png' ? await doc.embedPng(imgBytes) : await doc.embedJpg(imgBytes);
  }
  let stampImage = null;
  if (hasStamp) {
    const imgBytes = await fs.readFile(stampImagePath);
    const ext = path.extname(stampImagePath).toLowerCase();
    stampImage = ext === '.png' ? await doc.embedPng(imgBytes) : await doc.embedJpg(imgBytes);
  }

  const wmColor = Array.isArray(watermarkColor) && watermarkColor.length === 3 ? watermarkColor : [0.6, 0.6, 0.6];
  const wmOpacity = typeof watermarkOpacity === 'number' ? watermarkOpacity : 0.25;

  pages.forEach((page, idx) => {
    const { width, height } = page.getSize();

    if (hasRotations) {
      const originalPageNum = hasCustomOrder ? pageOrder[idx] : idx + 1;
      const delta = pageRotations[originalPageNum];
      if (delta) page.setRotation(degrees((page.getRotation().angle + Number(delta)) % 360));
    }

    if (hasWatermark) {
      const size = 44;
      const textWidth = font.widthOfTextAtSize(watermarkText, size);
      page.drawText(watermarkText, {
        x: width / 2 - textWidth / 4,
        y: height / 2,
        size,
        font,
        color: rgb(wmColor[0], wmColor[1], wmColor[2]),
        opacity: wmOpacity,
        rotate: degrees(45),
      });
    }

    if (watermarkImage) {
      const maxW = width * 0.5;
      const maxH = height * 0.5;
      const scale = Math.min(maxW / watermarkImage.width, maxH / watermarkImage.height);
      const w = watermarkImage.width * scale;
      const h = watermarkImage.height * scale;
      page.drawImage(watermarkImage, {
        x: (width - w) / 2,
        y: (height - h) / 2,
        width: w,
        height: h,
        opacity: typeof watermarkImageOpacity === 'number' ? watermarkImageOpacity : 0.25,
      });
    }

    if (stampImage && (stampPlacement === 'stamp-all-pages' || (stampPlacement === 'stamp-last-page' && idx === pages.length - 1))) {
      const stampW = Math.min(width * 0.22, stampImage.width);
      const scale = stampW / stampImage.width;
      const stampH = stampImage.height * scale;
      page.drawImage(stampImage, {
        x: width - stampW - 24,
        y: 24,
        width: stampW,
        height: stampH,
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
