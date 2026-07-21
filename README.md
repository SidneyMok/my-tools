# 工具箱

純靜態、繁體中文的本機開發小工具頁面，沒有伺服器、帳號或外部依賴。

## 使用方式

直接以瀏覽器開啟 `index.html` 即可。若需要本機 HTTP 伺服器，可在此目錄執行：

```sh
python3 -m http.server 8080
```

然後開啟 `http://localhost:8080`。

## 自動化開發流程

在 GitHub 建立需求 Issue 後，補齊 acceptance criteria 並加上 `agent:ready` label。TALOS 每五分鐘會接管 Issue，交給 project leader 完成開發、QA 和 Pull Request。PR 仍必須由人工審核和 merge；merge 至 `main` 後 GitHub Pages 會自動重新發布。完整規則見 [自動化流程](docs/automation/issue-workflow.md)。

## 驗證重點

- JSON：輸入有效 JSON 後可格式化、壓縮及複製；輸入不合法內容會顯示錯誤。
- HTML：修改編輯器內容後按「執行」會在 sandbox iframe 顯示；可重設或新視窗開啟。
- 時間：可將秒或毫秒 Unix 時間戳轉換成本機時間，也可由本機日期時間取得秒與毫秒時間戳。
