(() => {
  const $ = (id) => document.getElementById(id);
  const jsonInput = $('json-input'), jsonOutput = $('json-output'), jsonError = $('json-error'), jsonStatus = $('json-status');
  function processJson(indent) {
    const source = jsonInput.value.trim();
    if (!source) { jsonOutput.value = ''; jsonError.textContent = '請先輸入 JSON 資料。'; jsonStatus.textContent = '需要輸入'; return; }
    try { jsonOutput.value = JSON.stringify(JSON.parse(source), null, indent); jsonError.textContent = ''; jsonStatus.textContent = 'JSON 有效'; }
    catch (error) { jsonOutput.value = ''; jsonError.textContent = `JSON 格式錯誤：${error.message}`; jsonStatus.textContent = '格式錯誤'; }
  }
  $('format-json').addEventListener('click', () => processJson(2));
  $('minify-json').addEventListener('click', () => processJson(0));
  $('clear-json').addEventListener('click', () => { jsonInput.value = ''; jsonOutput.value = ''; jsonError.textContent = ''; jsonStatus.textContent = '等待輸入'; jsonInput.focus(); });
  $('copy-json').addEventListener('click', async () => {
    if (!jsonOutput.value) return;
    try { await navigator.clipboard.writeText(jsonOutput.value); jsonStatus.textContent = '已複製'; }
    catch { jsonOutput.select(); document.execCommand('copy'); jsonStatus.textContent = '已複製'; }
  });

  const htmlInput = $('html-input'), preview = $('html-preview'), initialHtml = htmlInput.value;
  function runPreview() { preview.srcdoc = htmlInput.value; }
  $('run-html').addEventListener('click', runPreview);
  $('reset-html').addEventListener('click', () => { htmlInput.value = initialHtml; runPreview(); });
  $('open-preview').addEventListener('click', () => {
    const previewUrl = URL.createObjectURL(new Blob([htmlInput.value], { type: 'text/html' }));
    window.open(previewUrl, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(previewUrl), 60000);
  });
  runPreview();

  let unit = 'seconds';
  document.querySelectorAll('[data-unit]').forEach((button) => button.addEventListener('click', () => {
    unit = button.dataset.unit;
    document.querySelectorAll('[data-unit]').forEach((item) => item.classList.toggle('selected', item === button));
  }));
  const formatDate = (date) => new Intl.DateTimeFormat('zh-Hant-TW', { dateStyle: 'full', timeStyle: 'medium' }).format(date);
  $('convert-timestamp').addEventListener('click', () => {
    const raw = $('timestamp-input').value.trim(), result = $('timestamp-result');
    if (!/^[-+]?\d+(\.\d+)?$/.test(raw)) { result.textContent = '請輸入有效的數字時間戳。'; return; }
    const date = new Date(Number(raw) * (unit === 'seconds' ? 1000 : 1));
    result.textContent = Number.isNaN(date.getTime()) ? '時間戳超出可處理範圍。' : `${formatDate(date)}\nUTC：${date.toISOString()}`;
  });
  function datetimeValue(date) { const offset = date.getTimezoneOffset() * 60000; return new Date(date - offset).toISOString().slice(0, 23); }
  $('use-now').addEventListener('click', () => { $('datetime-input').value = datetimeValue(new Date()); });
  $('convert-datetime').addEventListener('click', () => {
    const value = $('datetime-input').value, result = $('datetime-result');
    if (!value) { result.textContent = '請選擇日期與時間。'; return; }
    const date = new Date(value);
    result.textContent = `秒：${Math.floor(date.getTime() / 1000)}\n毫秒：${date.getTime()}`;
  });
})();
