const { execFile } = require('child_process');

// Win32_Printer 的 PrinterStatus 數值對照(WMI 標準定義)
const STATUS_MAP = {
  1: '其他',
  2: '未知',
  3: '閒置',
  4: '列印中',
  5: '暖機中',
  6: '停止列印',
  7: '離線',
};

function listPrinters() {
  return new Promise((resolve, reject) => {
    const psCmd =
      'Get-CimInstance -ClassName Win32_Printer | ' +
      'Select-Object Name, Default, WorkOffline, PrinterStatus, Network | ' +
      'ConvertTo-Json -Compress';
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psCmd],
      { windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err);
        let data;
        try {
          data = JSON.parse(stdout.trim() || '[]');
        } catch (e) {
          return reject(e);
        }
        const list = Array.isArray(data) ? data : [data];
        const printers = list
          .filter(Boolean)
          .map((p) => ({
            name: p.Name,
            isDefault: !!p.Default,
            offline: !!p.WorkOffline,
            network: !!p.Network,
            status: p.WorkOffline ? '離線' : (STATUS_MAP[p.PrinterStatus] || '正常'),
          }))
          // 預設印表機排最前面,其餘依名稱排序
          .sort((a, b) => {
            if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
            return a.name.localeCompare(b.name, 'zh-Hant');
          });
        resolve(printers);
      }
    );
  });
}

module.exports = { listPrinters };
