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

# 4. 重新部署 Worker(非互動 + 逾時保護:stdin 導向空檔,任何互動提示會立刻 EOF 失敗而不是永遠卡住)
Log "開始部署 Worker"
$deployOut = "$logDir\deploy_$stamp.log"
$deployErr = "$logDir\deploy_$stamp.log.err"
$nullIn = "$logDir\.empty-stdin"
Set-Content -Path $nullIn -Value "" -NoNewline
$deployOk = $false
try {
    $p = Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c", "npx --yes wrangler deploy" `
        -WorkingDirectory "$root\cf-proxy-worker" `
        -RedirectStandardOutput $deployOut -RedirectStandardError $deployErr `
        -RedirectStandardInput $nullIn -WindowStyle Hidden -PassThru
    if ($p.WaitForExit(180000)) {
        $o = ""
        if (Test-Path $deployOut) { $o += Get-Content $deployOut -Raw -ErrorAction SilentlyContinue }
        if (Test-Path $deployErr) { $o += Get-Content $deployErr -Raw -ErrorAction SilentlyContinue }
        Log "部署結束(exit=$($p.ExitCode)): $o"
        if ($p.ExitCode -eq 0) { $deployOk = $true } else { Log "❌ 部署回傳非零 exit code" }
    } else {
        Log "❌ 部署超過 180 秒未結束,強制終止(可能是 npx/wrangler 在等互動輸入或登入)"
        try { $p.Kill() } catch {}
    }
} catch {
    Log "❌ 部署失敗: $($_.Exception.Message)"
}

# 5. 驗證固定網域真的通了(部署成功也可能因為快取/綁定問題還是連到舊 origin)
if ($deployOk) {
    $publicOk = $false
    for ($i = 0; $i -lt 6; $i++) {
        Start-Sleep -Seconds 5
        try {
            $r = Invoke-WebRequest -Uri "https://print.xiaom67.dpdns.org/login.html" -UseBasicParsing -TimeoutSec 10
            if ($r.StatusCode -eq 200) { $publicOk = $true; break }
        } catch {}
    }
    if ($publicOk) { Log "✅ 外網 https://print.xiaom67.dpdns.org 驗證通過" }
    else { Log "❌ 外網驗證失敗,Worker 可能還連到舊的 Tunnel 網址,請手動重新部署" }
}

Log "=== 啟動流程結束 ==="
