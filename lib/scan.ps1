param(
  [Parameter(Mandatory=$true)][string]$OutPath
)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Drawing
  $deviceManager = New-Object -ComObject WIA.DeviceManager
  if ($deviceManager.DeviceInfos.Count -eq 0) {
    Write-Output "ERROR:找不到掃描器,請確認掃描器已開機並連接到這台電腦"
    exit 1
  }
  $device = $deviceManager.DeviceInfos.Item(1).Connect()
  $item = $device.Items.Item(1)
  $wiaFormatJPEG = "{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}"
  $image = $item.Transfer($wiaFormatJPEG)

  # 部分掃描器的 WIA 驅動不管要求什麼格式,實際存出來的內容都是 BMP,
  # 這裡不管驅動實際存了什麼格式,一律用 System.Drawing 讀取實際內容(自動判斷真實格式)
  # 再重新編碼成真正的 JPEG,避免後續轉 PDF 時格式不符
  $tempPath = [System.IO.Path]::GetTempFileName()
  Remove-Item -Force $tempPath
  $image.SaveFile($tempPath)
  $bitmap = [System.Drawing.Image]::FromFile($tempPath)
  if (Test-Path $OutPath) { Remove-Item -Force $OutPath }
  $bitmap.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Jpeg)
  $bitmap.Dispose()
  Remove-Item -Force $tempPath
  Write-Output "OK"
} catch {
  Write-Output "ERROR:$($_.Exception.Message)"
  exit 1
}
