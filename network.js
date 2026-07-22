const API_URL = 'https://ipwho.is/';

export function isValidIp(value) {
  const input = value.trim();
  if (!input) return false;

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(input)) {
    return input.split('.').every((part) => Number(part) <= 255);
  }

  if (!/^[0-9a-f:.]+$/i.test(input) || input.includes(':::')) return false;
  const pieces = input.split('::');
  if (pieces.length > 2) return false;
  const hasCompression = pieces.length === 2;
  const groups = input.replace('::', ':').split(':').filter(Boolean);
  const embeddedIpv4 = groups.at(-1)?.includes('.');
  if (embeddedIpv4) {
    const ipv4 = groups.pop();
    if (!isValidIp(ipv4)) return false;
  }

  const groupCount = groups.length + (embeddedIpv4 ? 2 : 0);
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return false;
  return hasCompression ? groupCount < 8 : groupCount === 8;
}

function messageForError(response, payload) {
  if (response.status === 429) return '查詢次數已達限制，請稍後再試。';
  if (payload?.message) return `查詢失敗：${payload.message}`;
  return '目前無法取得網路資訊，請檢查連線後再試。';
}

async function requestIp(ip) {
  let response;
  try {
    response = await fetch(`${API_URL}${ip ? encodeURIComponent(ip) : ''}`);
  } catch {
    throw new Error('目前無法連線至 IP 查詢服務，請檢查網路後再試。');
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('查詢服務回傳了無法辨識的資料，請稍後再試。');
  }
  if (!response.ok || !payload.success) throw new Error(messageForError(response, payload));
  return payload;
}

function valueOrEmpty(value) {
  return value || '未提供';
}

function renderResult(container, data) {
  const connection = data.connection || {};
  const location = [data.city, data.region, data.country].filter(Boolean).join('，');
  container.innerHTML = `
    <div class="ip-result-heading"><span class="ip-type">${data.type || 'IP'}</span><strong>${data.ip}</strong></div>
    <dl class="ip-details">
      <div><dt>國家 / 地區</dt><dd>${valueOrEmpty(data.country)}</dd></div>
      <div><dt>城市 / 區域</dt><dd>${valueOrEmpty(location)}</dd></div>
      <div><dt>ASN</dt><dd>${connection.asn ? `AS${connection.asn}` : '未提供'}</dd></div>
      <div><dt>ISP</dt><dd>${valueOrEmpty(connection.isp)}</dd></div>
      <div><dt>組織</dt><dd>${valueOrEmpty(connection.org)}</dd></div>
      <div><dt>時區</dt><dd>${valueOrEmpty(data.timezone?.id)}</dd></div>
    </dl>`;
  container.hidden = false;
}

function setStatus(element, text, state = '') {
  element.textContent = text;
  element.dataset.state = state;
}

function initialiseNetworkTool() {
  const currentStatus = document.getElementById('current-ip-status');
  if (!currentStatus) return;

  const currentResult = document.getElementById('current-ip-result');
  const currentRetry = document.getElementById('retry-current-ip');
  const lookupForm = document.getElementById('ip-lookup-form');
  const lookupInput = document.getElementById('ip-lookup-input');
  const lookupError = document.getElementById('ip-lookup-error');
  const lookupStatus = document.getElementById('lookup-status');
  const lookupResult = document.getElementById('lookup-result');
  const lookupRetry = document.getElementById('retry-lookup');
  let latestLookup = 0;

  async function loadCurrentIp() {
    currentResult.hidden = true;
    currentRetry.hidden = true;
    setStatus(currentStatus, '正在取得目前公網 IP…', 'loading');
    try {
      const data = await requestIp('');
      renderResult(currentResult, data);
      setStatus(currentStatus, '已更新', 'success');
    } catch (error) {
      setStatus(currentStatus, error.message, 'error');
      currentRetry.hidden = false;
    }
  }

  async function lookupIp(ip) {
    const requestId = ++latestLookup;
    lookupResult.hidden = true;
    lookupRetry.hidden = true;
    setStatus(lookupStatus, '正在查詢…', 'loading');
    try {
      const data = await requestIp(ip);
      if (requestId !== latestLookup) return;
      renderResult(lookupResult, data);
      setStatus(lookupStatus, '查詢完成', 'success');
    } catch (error) {
      if (requestId !== latestLookup) return;
      setStatus(lookupStatus, error.message, 'error');
      lookupRetry.hidden = false;
    }
  }

  currentRetry.addEventListener('click', loadCurrentIp);
  lookupForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const ip = lookupInput.value.trim();
    lookupError.textContent = '';
    if (!isValidIp(ip)) {
      ++latestLookup;
      lookupResult.hidden = true;
      lookupRetry.hidden = true;
      lookupError.textContent = '請輸入有效的 IPv4 或 IPv6 位址。';
      setStatus(lookupStatus, '輸入格式錯誤', 'error');
      lookupInput.focus();
      return;
    }
    lookupIp(ip);
  });
  lookupRetry.addEventListener('click', () => lookupIp(lookupInput.value.trim()));
  loadCurrentIp();
}

if (typeof document !== 'undefined') initialiseNetworkTool();
