(() => {
  const $ = (id) => document.getElementById(id);
  const jsonInput = $('json-input');
  if (jsonInput) {
    const jsonOutput = $('json-output'), jsonError = $('json-error'), jsonStatus = $('json-status');
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
  }

  const htmlInput = $('html-input');
  if (htmlInput) {
    const preview = $('html-preview'), initialHtml = htmlInput.value;
    function runPreview() { preview.srcdoc = htmlInput.value; }
    $('run-html').addEventListener('click', runPreview);
    $('reset-html').addEventListener('click', () => { htmlInput.value = initialHtml; runPreview(); });
    $('open-preview').addEventListener('click', () => {
      const previewUrl = URL.createObjectURL(new Blob([htmlInput.value], { type: 'text/html;charset=UTF-8' }));
      window.open(previewUrl, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(previewUrl), 60000);
    });
    runPreview();
  }

  const timestampInput = $('timestamp-input');
  if (timestampInput) {
    let unit = 'seconds';
    document.querySelectorAll('[data-unit]').forEach((button) => button.addEventListener('click', () => {
      unit = button.dataset.unit;
      document.querySelectorAll('[data-unit]').forEach((item) => item.classList.toggle('selected', item === button));
    }));
    const pad = (value) => String(value).padStart(2, '0');
    const formatDate = (date) => {
      const format = $('timestamp-format').value;
      const values = { year: date.getFullYear(), month: pad(date.getMonth() + 1), day: pad(date.getDate()), hour: pad(date.getHours()), minute: pad(date.getMinutes()), second: pad(date.getSeconds()) };
      if (format === 'yyyy/MM/dd hh:mm:ss') return `${values.year}/${values.month}/${values.day} ${values.hour}:${values.minute}:${values.second}`;
      if (format === 'dd/MM/yyyy hh:mm:ss') return `${values.day}/${values.month}/${values.year} ${values.hour}:${values.minute}:${values.second}`;
      if (format === 'MMM d, yyyy hh:mm:ss') return `${new Intl.DateTimeFormat('en-US', { month: 'short' }).format(date)} ${date.getDate()}, ${values.year} ${values.hour}:${values.minute}:${values.second}`;
      return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
    };
    $('convert-timestamp').addEventListener('click', () => {
      const raw = timestampInput.value.trim(), result = $('timestamp-result');
      if (!/^[-+]?\d+(\.\d+)?$/.test(raw)) { result.textContent = '請輸入有效的數字時間戳。'; return; }
      const date = new Date(Number(raw) * (unit === 'seconds' ? 1000 : 1));
      result.textContent = Number.isNaN(date.getTime()) ? '時間戳超出可處理範圍。' : `${formatDate(date)}\nUTC：${date.toISOString()}`;
    });
    $('timestamp-format').addEventListener('change', () => {
      if (timestampInput.value.trim()) $('convert-timestamp').click();
    });
    function datetimeValue(date) { const offset = date.getTimezoneOffset() * 60000; return new Date(date - offset).toISOString().slice(0, 23); }
    $('use-now').addEventListener('click', () => { $('datetime-input').value = datetimeValue(new Date()); });
    $('convert-datetime').addEventListener('click', () => {
      const value = $('datetime-input').value, result = $('datetime-result');
      if (!value) { result.textContent = '請選擇日期與時間。'; return; }
      const date = new Date(value);
      const seconds = String(Math.floor(date.getTime() / 1000));
      const milliseconds = String(date.getTime());
      result.innerHTML = `<div class="timestamp-value-row"><span>秒：<strong id="datetime-seconds">${seconds}</strong></span><button class="icon-button" id="copy-datetime-seconds" title="複製秒時間戳" aria-label="複製秒時間戳">⧉</button></div><div class="timestamp-value-row"><span>毫秒：<strong id="datetime-milliseconds">${milliseconds}</strong></span><button class="icon-button" id="copy-datetime-milliseconds" title="複製毫秒時間戳" aria-label="複製毫秒時間戳">⧉</button></div>`;
      const copyStatus = $('datetime-copy-status');
      const copyValue = async (copyValue, label) => {
        if (!navigator.clipboard?.writeText) { copyStatus.textContent = '無法使用剪貼簿，請手動複製。'; return; }
        try { await navigator.clipboard.writeText(copyValue); copyStatus.textContent = `${label}已複製`; }
        catch { copyStatus.textContent = '無法使用剪貼簿，請手動複製。'; }
      };
      $('copy-datetime-seconds').addEventListener('click', () => copyValue(seconds, '秒'));
      $('copy-datetime-milliseconds').addEventListener('click', () => copyValue(milliseconds, '毫秒'));
    });
  }
})();
