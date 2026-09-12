const { execFile } = require('child_process');
const path = require('path');

// 透過 Windows WIA 觸發掃描器掃描一張,存成 JPEG。
// 需要這台電腦實際接有掃描器(或多功能事務機)才會動作。
function scanToImage(outputPath) {
  const scriptPath = path.join(__dirname, 'scan.ps1');
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-OutPath', outputPath],
      { windowsHide: true, timeout: 60000 },
      (err, stdout) => {
        if (err) {
          const marker = stdout.split('\n').map((l) => l.trim()).find((l) => l.startsWith('ERROR:'));
          return reject(new Error(marker ? marker.slice('ERROR:'.length) : err.message));
        }
        resolve(outputPath);
      }
    );
  });
}

module.exports = { scanToImage };
