# 開機/登入時自動執行:啟動伺服器 + Quick Tunnel,並自動把新網址同步到 Cloudflare Worker
$ErrorActionPreference = "Stop"
$root = "E:\Projects\remote-print"
$logDir = "$root\startup-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
$log = "$logDir\startup_$stamp.log"

function Log($msg) {
    $line = "$(Get-Date -Format 'HH:mm:ss') $msg`r`n"
    [System.IO.File]::AppendAllText($log, $line, [System.Text.UTF8Encoding]::new($false))
}

Log "=== 開始啟動 ==="

# 1. 啟動 Node 伺服器
Log "啟動 node server.js"
Start-Process -FilePath "node.exe" -ArgumentList "server.js" -WorkingDirectory $root -WindowStyle Hidden

# 等伺服器就緒(最多等 30 秒)
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:3000/login.html" -UseBasicParsing -TimeoutSec 2
        if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
}
Log "伺服器就緒狀態: $ready"

# 2. 啟動 Quick Tunnel,把輸出導到檔案以便解析網址
$tunnelOut = "$logDir\tunnel_$stamp.log"
Start-Process -FilePath "cloudflared.exe" -ArgumentList "tunnel --url http://localhost:3000" `
    -RedirectStandardOutput $tunnelOut -RedirectStandardError "$tunnelOut.err" -WindowStyle Hidden
Log "啟動 cloudflared quick tunnel"

# 等待網址出現(最多等 20 秒)
$tunnelUrl = $null
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 1
    $content = ""
    if (Test-Path $tunnelOut) { $content += Get-Content $tunnelOut -Raw -ErrorAction SilentlyContinue }
    if (Test-Path "$tunnelOut.err") { $content += Get-Content "$tunnelOut.err" -Raw -ErrorAction SilentlyContinue }
    if ($content -match "https://[a-z0-9-]+\.trycloudflare\.com") {
        $tunnelUrl = $matches[0]
        break
    }
}
Log "取得 Quick Tunnel 網址: $tunnelUrl"

if (-not $tunnelUrl) {
    Log "❌ 沒有取得 Quick Tunnel 網址,中止同步 Worker"
    exit 1
}

# 3. 更新 wrangler.toml 的 ORIGIN_URL
$wranglerToml = "$root\cf-proxy-worker\wrangler.toml"
$content = Get-Content $wranglerToml -Raw
$newContent = $content -replace 'ORIGIN_URL = ".*"', "ORIGIN_URL = `"$tunnelUrl`""
Set-Content -Path $wranglerToml -Value $newContent -Encoding utf8 -NoNewline
Log "已更新 wrangler.toml"

# 4. 重新部署 Worker
Log "開始部署 Worker"
Push-Location "$root\cf-proxy-worker"
try {
    $deployOutput = & npx wrangler deploy 2>&1 | Out-String
    Log "部署輸出: $deployOutput"
} catch {
    Log "❌ 部署失敗: $($_.Exception.Message)"
} finally {
    Pop-Location
}

Log "=== 啟動流程結束 ==="
