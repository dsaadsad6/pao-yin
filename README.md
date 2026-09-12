# 拋印(原「遠端影印」)

自架的網頁,可以上傳照片 / PDF / Word,選頁碼範圍、彩色或黑白、單面或雙面,直接送到印表機列印。暗色黑白系半透明玻璃質感介面,登入密碼保護。

因為印表機在另一台電腦上,這個專案要**部署到那台接印表機的電腦上執行**,那台電腦才是真正的伺服器。

## 需要安裝(在有印表機的那台電腦上)

1. [Node.js LTS](https://nodejs.org/)
2. [SumatraPDF](https://www.sumatrapdfreader.org/)(用來靜默把 PDF 送去印表機,並控制頁碼/彩色黑白/雙面)
3. [LibreOffice](https://www.libreoffice.org/)(用來把 Word 轉成 PDF)— 只有需要支援 Word 上傳時才需要
4. [Microsoft Edge](https://www.microsoft.com/edge)(用來把網頁轉成 PDF)— Windows 10/11 通常都內建,不用額外裝
5. 掃描功能需要這台電腦實際接有掃描器或多功能事務機(透過 Windows WIA),沒有掃描器就不會用到這個功能

也可以用 winget 安裝(以系統管理員身分執行 PowerShell):

```powershell
winget install -e --id OpenJS.NodeJS.LTS
winget install -e --id SumatraPDF.SumatraPDF
winget install -e --id TheDocumentFoundation.LibreOffice
```

## 設定

1. 把整個 `remote-print` 資料夾複製到有印表機的電腦上
2. 複製 `.env.example` 為 `.env`,並修改:
   - `ACCESS_PASSWORD`:進入網站要輸入的密碼,務必改掉
   - `SESSION_SECRET`:隨便打一串長亂數字串
   - `SUMATRA_PATH`、`SOFFICE_PATH`:改成該電腦上實際的安裝路徑
3. 安裝套件並啟動:

```powershell
npm install
npm start
```

4. 瀏覽器開 `http://localhost:3000` 確認可以看到登入畫面、選得到印表機清單、上傳檔案後能看到頁數。

> 浮水印/頁碼/測試頁/貼上文字這幾個功能需要中文字型畫圖,程式會自動找 Windows 內建的「標楷體」(`C:\Windows\Fonts\kaiu.ttf`)。如果該電腦上沒有這個字型(例如非繁體中文版 Windows),在 `.env` 設定 `CJK_FONT_PATH` 指向任一個 `.ttf` 中文字型檔即可。

## 讓外面可以透過一個網域連進來

因為印表機那台電腦通常在家用網路裡,建議用 **Cloudflare Tunnel**(免費、不用開路由器 port、自動有 HTTPS),不要直接把 3000 port 對外開放。

```powershell
winget install -e --id Cloudflare.cloudflared
cloudflared tunnel login
cloudflared tunnel create remote-print
cloudflared tunnel route dns remote-print print.你的網域.com
cloudflared tunnel run --url http://localhost:3000 remote-print
```

之後全世界只要打開 `https://print.你的網域.com` 就能連到家裡這台印表機,密碼保護 + Cloudflare 的 HTTPS 一起把關。想長駐背景執行可以用 `cloudflared service install` 把它裝成 Windows 服務。

## 功能

- 上傳照片(jpg/png,可自動校正方向/裁邊)、PDF、Word/PPT/Excel(doc/docx/ppt/pptx/xls/xlsx)、純文字/Markdown(txt/md)
- 也可以直接貼上文字轉成 PDF,或一鍵列印內建測試頁(確認印表機/驅動是否正常)
- 頁碼範圍選取、彩色/灰階/黑白、單面/雙面、份數
- 進階列印選項:浮水印文字、頁首/頁尾文字、自動頁碼
- 上傳後可看每頁縮圖,點縮圖勾選要印哪幾頁、拖曳調整列印順序
- 一次選多個檔案可以合併成一份文件再列印
- 版面模式:2 合 1 / 4 合 1(省紙)、小冊子(騎馬釘自動拼版)、海報(單頁放大拼貼列印)
- 貼網址把網頁轉成 PDF(用本機 Microsoft Edge 無頭模式)
- 掃描文件(需要這台電腦有接掃描器/多功能事務機)
- 上傳檔案會做魔術位元組驗證,擋掉偽裝副檔名的檔案
- 印表機清單搜尋/重新整理、標示系統預設印表機與狀態、累積列印頁數與保養提醒
- 密碼保護、登入嘗試次數限制、localStorage 記住上次設定
- 三種主題(深色 / 淺色 / 護眼低對比)、三種語言(中/英/日)介面
- Enter 鍵可直接送出列印(印表機搜尋框、頁碼範圍輸入框除外)
- 列印紀錄,可依檔名/印表機/狀態篩選

## 已經在開發機上驗證過的部分

- 登入 / session 保護
- 讀取本機已安裝印表機清單
- 照片(jpg/png)自動轉成 PDF(含 sharp 自動轉正/裁邊)
- Word/PPT/Excel/純文字/Markdown 透過 LibreOffice 自動轉成 PDF
- 貼上文字、內建測試頁產生
- 浮水印/頁首/頁尾/頁碼疊加(中文字型正確顯示)
- 上傳檔案魔術位元組驗證(擋偽裝檔案)
- 多檔合併(驗證過合併後頁面順序正確)
- 頁面縮圖渲染、點選頁面、拖曳自訂列印順序(有實際跑過瀏覽器操作,drag 事件邏輯也用程式模擬驗證過)
- 取得 PDF 實際頁數、頁碼範圍格式驗證("1-3,5,7-9"、超出範圍會擋下來)
- N-up(2/4 合 1)、小冊子拼版、海報拼貼三種版面演算法(直接讀輸出 PDF 內容逐頁比對過,順序/位置都正確)
- 透過真實瀏覽器操作完整送印一次(貼上文字、內建測試頁、網頁轉換),SumatraPDF 實際呼叫印表機驅動並成功完成,不只是模擬測試
- 網頁轉 PDF(實際轉換過真實網站,包含多頁的頁面)
- 印表機累積頁數統計邏輯、掃描功能的錯誤處理(找不到掃描器時會顯示清楚的中文訊息,不會卡住)
- 主題切換(深色/淺色/護眼三種都截圖確認過配色跟對比)、自訂下拉選單/打勾框樣式(取代瀏覽器原生外觀)

**尚未在真實印表機/掃描器上測試**:雖然 SumatraPDF 呼叫印表機驅動的流程本身已經跑通(在這台開發機的虛擬印表機「Microsoft Print to PDF」上成功列印過),但實體印表機的彩色/黑白/雙面/紙張大小支援度因廠牌而異。掃描功能因為這台開發機沒有實體掃描器,完全沒有測試過真的掃描動作(只驗證了「找不到掃描器」的錯誤路徑)。請在部署到有印表機/掃描器的電腦後,先用一份 1-2 頁的測試檔案(或內建的「列印測試頁」功能)跑一次「彩色/黑白」「單面/雙面」各組合,並實際試一次掃描功能。

**已知限制**:多語系目前只涵蓋前端介面的靜態文字(按鈕、標籤、提示),伺服器回傳的動態訊息(錯誤訊息、列印紀錄裡的顏色/雙面文字等)固定顯示中文。登入頁面也還是中文,沒有跟著語言切換。

## 架構

```
public/                前端頁面
  index.html/app.js    主頁與邏輯
  login.html/login.js  登入頁
  pdf-viewer.js        頁面縮圖渲染(pdfjs-dist)
  custom-select.js     自訂樣式下拉選單元件
  i18n.js              多語系字典(中/英/日)
server.js              Express 伺服器、登入驗證、上傳/合併/列印/掃描/網頁轉檔 API
lib/printers.js        讀取 Windows 已安裝印表機
lib/convert.js         圖片/文件轉 PDF、貼上文字、測試頁、合併 PDF、讀取頁數
lib/print-prep.js      送印前依自訂順序重組頁面、套版面、疊加浮水印/頁首/頁尾/頁碼
lib/layout.js          N-up / 小冊子 / 海報版面演算法
lib/print.js           頁碼範圍驗證、組出 SumatraPDF 列印指令
lib/font.js            中文字型載入(給 PDF 畫中文字用)
lib/urlToPdf.js         用 Microsoft Edge 無頭模式把網頁轉成 PDF
lib/scan.js / scan.ps1  透過 WIA 觸發掃描器掃描
uploads/               使用者上傳的原始檔
converted/             轉檔後的 PDF
print-ready/           送印前處理過的暫存 PDF
data/jobs.json         列印紀錄
data/printer-stats.json 各印表機累積列印頁數
```

## 版本號規則

`package.json` 的版本號採用 `驕傲版本.預設版本.羞恥版本` 的格式:

- **驕傲版本**(第一碼):更新內容讓人感到驕傲時才動(大改版、重大新功能),歸零後面兩碼
- **預設版本**(第二碼):一般性的新功能更新,歸零羞恥版本
- **羞恥版本**(第三碼):修了一個很丟臉的 bug 時使用(例如讓伺服器直接當機的那種)

目前版本 `2.0.0`:2026-09-12 從「遠端影印」正式改名「拋印」,加了行銷首頁、帳號密碼登入、自訂圖示、手機版面、開機自動啟動、固定對外網域,是值得驕傲的一次大改版。
