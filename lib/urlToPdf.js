const { execFile } = require('child_process');

// 用系統內建的 Microsoft Edge 無頭模式把網頁轉成 PDF,不用額外裝瀏覽器套件
function urlToPdf(url, outputPath, edgePath) {
  return new Promise((resolve, reject) => {
    execFile(
      edgePath,
      [
        '--headless',
        '--disable-gpu',
        '--no-pdf-header-footer',
        `--print-to-pdf=${outputPath}`,
        url,
      ],
      { windowsHide: true, timeout: 60000 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(`網頁轉檔失敗: ${err.message}\n${stderr}`));
        resolve(outputPath);
      }
    );
  });
}

module.exports = { urlToPdf };
