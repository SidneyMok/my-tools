# 工具箱

純靜態、繁體中文的本機開發小工具頁面，沒有伺服器、帳號或外部依賴。

## 使用方式

直接以瀏覽器開啟 `index.html` 即可。每項工具都有獨立頁面：`index.html`（JSON）、`html-preview.html`（HTML 預覽）與 `timestamp.html`（Unix 時間戳）。若需要本機 HTTP 伺服器，可在此目錄執行：

```sh
python3 -m http.server 8080
```

然後開啟 `http://localhost:8080`。

## 驗證重點

- JSON：輸入有效 JSON 後可格式化、壓縮及複製；輸入不合法內容會顯示錯誤。
- HTML：修改編輯器內容後按「執行」會在 sandbox iframe 顯示；可重設或新視窗開啟。
- 時間：可將秒或毫秒 Unix 時間戳轉換成本機時間，也可由本機日期時間取得秒與毫秒時間戳。
