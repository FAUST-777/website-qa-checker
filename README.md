# 網站自動 QA 檢查器 (Website QA Checker)

> 貼上網址 → 自動檢查 → 直接看到要改什麼

**線上使用：** https://website-qa-checker.vercel.app
**示範用故障網頁（練習用）：** https://website-qa-checker.vercel.app/demo.html

## 需求起因

公司美編產出的網站每次上線都有 QA 問題，反覆出現的狀況包括：

- **按鈕按下去沒反應**——忘記綁定連結或功能
- **LINE「加入好友」按鈕連錯**——應該顯示 QR Code / 加好友頁，卻連到「下載 LINE APP」頁
- 連結 404、圖片破圖、手機版跑版等基本錯誤

過去仰賴人工逐一點擊檢查，費時又容易漏。因此需要一個**業務也能自己操作**的工具：把要檢查的網站網址貼上去，系統自動檢查，最後直接列出「這個網站要改的錯誤」，業務可下載報告轉交美編修正。

## 功能

| 檢查項目 | 說明 |
|---|---|
| 🔘 死按鈕偵測 | 實際點擊每個按鈕，偵測「點了沒有任何反應」（無跳轉、無視窗、畫面無變化） |
| 💬 LINE 連結驗證 | 加好友連結是否為正確格式（`lin.ee/xxx`、`line.me/R/ti/p/@id`），抓出誤連「下載頁」、`line://` 深層連結等錯誤 |
| 🔗 失效連結掃描 | 逐一請求所有連結，回報 404 / 500 / 無法連線 |
| 🖼️ 破圖偵測 | 找出載入失敗的圖片 |
| 📱 手機版檢查 | 缺少 viewport 設定、內容超出手機螢幕寬度（跑版） |
| ⚙️ 程式錯誤 | 瀏覽器 console 錯誤、資源載入失敗 |
| 📄 多頁模式 | 可選擇連同站內子頁面一起檢查（最多 7 頁） |
| ⬇️ 報告下載 | 一鍵下載 HTML 報告（含截圖），業務直接傳給美編 |

## 使用方式

1. 打開網站
2. 貼上要檢查的網址
3. 選「只檢查這一頁」或「連同站內子頁面」
4. 按「開始檢查」，等 1~4 分鐘
5. 查看 🔴 必修錯誤 / 🟡 建議修正 清單，按「下載報告」傳給美編

## 技術架構

- **Next.js 15 (App Router)** + TypeScript，部署於 Vercel
- **puppeteer-core + @sparticuz/chromium**：在 Vercel serverless function 內跑無頭 Chrome（`maxDuration: 300`）
- **NDJSON streaming**：檢查過程即時回傳進度到前端
- 本機開發時自動改用本機安裝的 Chrome / Edge

## 本機開發

```bash
npm install
npm run dev   # http://localhost:3000
```

## 部署

```bash
npx vercel --prod
```
