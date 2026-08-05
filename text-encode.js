const encoder = new TextEncoder();

export function base64Encode(value) {
  const bytes = encoder.encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64Decode(value) {
  const binary = atob(value.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export function urlEncode(value) {
  return encodeURIComponent(value);
}

export function formatSqlInList(value, { valuesOnly = false, noQuotes = false } = {}) {
  const retainedValues = value.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const formattedValues = retainedValues.map((item) => noQuotes ? item : `'${item.replaceAll("'", "''")}'`);
  const list = formattedValues.join(',');
  return { output: valuesOnly ? list : `IN (${list})`, count: retainedValues.length };
}

export function urlDecode(value) {
  return decodeURIComponent(value);
}

export async function hashText(algorithm, value) {
  if (!globalThis.crypto?.subtle) throw new Error('此瀏覽器無法使用 Web Crypto。');
  let digest;
  try {
    digest = await globalThis.crypto.subtle.digest(algorithm, encoder.encode(value));
  } catch {
    throw new Error(`無法計算 ${algorithm} 雜湊。`);
  }
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function uuidV4() {
  if (!globalThis.crypto?.getRandomValues) throw new Error('此瀏覽器無法產生安全的 UUID。');
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function copyText(value, status) {
  if (!value) return;
  navigator.clipboard.writeText(value)
    .then(() => { status.textContent = '已複製'; })
    .catch(() => { status.textContent = '無法使用剪貼簿，請手動複製。'; });
}

function initialiseTextEncodeTool() {
  const input = document.getElementById('text-encode-input');
  if (!input) return;
  const output = document.getElementById('text-encode-output');
  const status = document.getElementById('text-encode-status');
  const error = document.getElementById('text-encode-error');
  const uuidOutput = document.getElementById('uuid-output');
  const sqlInput = document.getElementById('sql-in-input');
  const sqlOutput = document.getElementById('sql-in-output');
  const sqlError = document.getElementById('sql-in-error');
  const sqlCount = document.getElementById('sql-in-count');

  function run(transform, success) {
    error.textContent = '';
    try {
      output.value = transform(input.value);
      status.textContent = success;
    } catch (caught) {
      output.value = '';
      error.textContent = caught instanceof URIError || caught?.name === 'InvalidCharacterError'
        ? '輸入內容無法解碼，請確認格式完整且有效。'
        : '輸入內容無法解碼，請確認為有效的 UTF-8 Base64。';
      status.textContent = '格式錯誤';
    }
  }

  document.getElementById('base64-encode').addEventListener('click', () => run(base64Encode, '已編碼為 Base64'));
  document.getElementById('base64-decode').addEventListener('click', () => run(base64Decode, '已解碼 Base64'));
  document.getElementById('url-encode').addEventListener('click', () => run(urlEncode, '已編碼 URL 元件'));
  document.getElementById('url-decode').addEventListener('click', () => run(urlDecode, '已解碼 URL 元件'));
  document.querySelectorAll('[data-hash]').forEach((button) => button.addEventListener('click', async () => {
    error.textContent = '';
    status.textContent = '計算中…';
    try {
      output.value = await hashText(button.dataset.hash, input.value);
      status.textContent = `已計算 ${button.dataset.hash}`;
    } catch (caught) {
      output.value = '';
      error.textContent = caught.message || '無法計算雜湊。';
      status.textContent = '無法計算';
    }
  }));
  document.getElementById('copy-text-output').addEventListener('click', () => copyText(output.value, status));
  document.getElementById('format-sql-in').addEventListener('click', () => {
    sqlError.textContent = '';
    try {
      const result = formatSqlInList(sqlInput.value, {
        valuesOnly: document.getElementById('sql-in-values-only').checked,
        noQuotes: document.getElementById('sql-in-no-quotes').checked
      });
      sqlOutput.value = result.output;
      sqlCount.textContent = `已包含 ${result.count} 個值`;
      status.textContent = '已格式化 SQL IN 清單';
    } catch (caught) {
      sqlOutput.value = '';
      sqlCount.textContent = '已包含 0 個值';
      sqlError.textContent = caught.message || '無法格式化 SQL IN 清單。';
      status.textContent = '格式錯誤';
    }
  });
  document.getElementById('copy-sql-in').addEventListener('click', () => copyText(sqlOutput.value, status));
  document.getElementById('clear-sql-in').addEventListener('click', () => {
    sqlInput.value = '';
    sqlOutput.value = '';
    sqlError.textContent = '';
    sqlCount.textContent = '已包含 0 個值';
    status.textContent = '等待輸入';
    sqlInput.focus();
  });
  document.getElementById('clear-text-encode').addEventListener('click', () => {
    input.value = '';
    output.value = '';
    error.textContent = '';
    status.textContent = '等待輸入';
    input.focus();
  });
  document.getElementById('generate-uuid').addEventListener('click', () => {
    try {
      uuidOutput.value = uuidV4();
      status.textContent = '已產生 UUID v4';
    } catch (caught) {
      error.textContent = caught.message;
      status.textContent = '無法產生';
    }
  });
  document.getElementById('copy-uuid').addEventListener('click', () => copyText(uuidOutput.value, status));

}

if (typeof document !== 'undefined') initialiseTextEncodeTool();
