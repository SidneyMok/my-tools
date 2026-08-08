import { convertDocx } from './docx-email.js';

const BUILTIN_GROUPS = [
  ['中文', [
    ['paymentDate', '繳費日期'], ['companyName', '保險公司'], ['ownerName', '投保人'], ['insuredName', '受保人名稱'], ['productName', '產品名稱'], ['paymentFrequency', '繳費頻率'], ['ownerTitle', '投保人稱謂（中文）'], ['insuredTitle', '受保人稱謂（中文）'], ['notifyDate', '通知日期']
  ]],
  ['英文', [
    ['paymentDateEn', '繳費日期（英文）'], ['companyNameEnglish', '保險公司英文名'], ['ownerPinyin', '投保人英文名'], ['insuredPinyin', '受保人英文名'], ['productNameEnglish', '產品名稱（英文）'], ['paymentFrequencyEn', '繳費頻率（英文）'], ['ownerTitleEn', '投保人稱謂（英文）'], ['insuredTitleEn', '受保人稱謂（英文）'], ['notifyDateEn', '通知日期（英文）'], ['coolingOffDateEn', '冷靜期結束日（英文）']
  ]],
  ['通用', [
    ['policyNo', '保單號'], ['currency', '貨幣'], ['premiumPayable', '應繳保費'], ['dda', '自動扣款 DDA'], ['sumAssured', '保額'], ['productYear', '產品年期']
  ]]
].map(([group, variables]) => ({ group, variables: variables.map(([field, label]) => ({ field, label })) }));
const CUSTOM_STORAGE_KEY = 'docx-email-custom-variables-v1';
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const builtinFields = new Set(BUILTIN_GROUPS.flatMap(({ variables }) => variables.map(({ field }) => field.toLowerCase())));
const $ = (id) => document.getElementById(id);
const input = $('docx-input'); const source = $('docx-source'); const status = $('docx-status'); const error = $('docx-error'); const warnings = $('docx-warnings'); const preview = $('open-docx-preview'); const copy = $('copy-docx-html'); const download = $('download-docx-html');
const search = $('variable-search'); const variableList = $('variable-list'); const customForm = $('custom-variable-form'); const customLabel = $('custom-variable-label'); const customField = $('custom-variable-field'); const customError = $('custom-variable-error'); const customList = $('custom-variable-list'); const cancelCustom = $('cancel-custom-variable'); const saveCustom = $('save-custom-variable');
let artifact = ''; let customVariables = []; let editingField = null;
function updateArtifactControls() { const disabled = !artifact; preview.disabled = disabled; copy.disabled = disabled; download.disabled = disabled; }
function useArtifact(html) { artifact = html; source.value = artifact; updateArtifactControls(); }
function syncSource() { artifact = source.value; updateArtifactControls(); }
function showFailure(message) { useArtifact(''); error.textContent = message; status.textContent = '無法轉換'; warnings.textContent = ''; }
function validCustom(variable, fields = new Set()) { return variable && typeof variable.label === 'string' && variable.label.trim() && typeof variable.field === 'string' && FIELD_NAME.test(variable.field) && !builtinFields.has(variable.field.toLowerCase()) && !fields.has(variable.field.toLowerCase()); }
function loadCustomVariables() { try { const parsed = JSON.parse(localStorage.getItem(CUSTOM_STORAGE_KEY) || '[]'); const fields = new Set(); return Array.isArray(parsed) ? parsed.filter((variable) => { if (!validCustom(variable, fields)) return false; fields.add(variable.field.toLowerCase()); return true; }).map(({ label, field }) => ({ label: label.trim(), field })) : []; } catch { return []; } }
function saveCustomVariables() { localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(customVariables)); }
function insertVariable(field) { const token = `\${${field}}`; source.setRangeText(token, source.selectionStart, source.selectionEnd, 'end'); syncSource(); source.focus(); }
function makeOption(variable, kind) { const button = document.createElement('button'); button.type = 'button'; button.className = 'variable-option'; button.dataset.variableKind = kind; button.dataset.variableField = variable.field; button.append(document.createTextNode(`${variable.label} `)); const field = document.createElement('code'); field.textContent = variable.field; button.append(field); if (kind === 'builtin') { const readonly = document.createElement('span'); readonly.className = 'readonly'; readonly.textContent = '唯讀'; button.append(readonly); } button.addEventListener('click', () => insertVariable(variable.field)); return button; }
function renderCatalog() { const query = search.value.trim().toLocaleLowerCase(); variableList.replaceChildren(); for (const { group, variables } of BUILTIN_GROUPS) { const section = document.createElement('section'); section.className = 'variable-group'; const title = document.createElement('h3'); title.textContent = group; const options = document.createElement('div'); options.className = 'variable-options'; variables.filter(({ label, field }) => !query || label.toLocaleLowerCase().includes(query) || field.toLowerCase().includes(query)).forEach((variable) => options.append(makeOption(variable, 'builtin'))); section.append(title, options); variableList.append(section); } const customSection = document.createElement('section'); customSection.className = 'variable-group'; const customTitle = document.createElement('h3'); customTitle.textContent = '自定义变量'; const customOptions = document.createElement('div'); customOptions.className = 'variable-options'; customVariables.filter(({ label, field }) => !query || label.toLocaleLowerCase().includes(query) || field.toLowerCase().includes(query)).forEach((variable) => customOptions.append(makeOption(variable, 'custom'))); customSection.append(customTitle, customOptions); variableList.append(customSection); }
function resetCustomForm() { editingField = null; customForm.reset(); customError.textContent = ''; saveCustom.textContent = '新增'; cancelCustom.hidden = true; }
function renderCustomVariables() { customList.replaceChildren(); customVariables.forEach((variable) => { const row = document.createElement('div'); row.className = 'custom-variable-row'; const label = document.createElement('span'); label.textContent = variable.label; const field = document.createElement('code'); field.textContent = `\${${variable.field}}`; const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = '編輯'; edit.setAttribute('aria-label', `編輯 ${variable.label}`); edit.addEventListener('click', () => { editingField = variable.field; customLabel.value = variable.label; customField.value = variable.field; saveCustom.textContent = '更新'; cancelCustom.hidden = false; customLabel.focus(); }); const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '刪除'; remove.setAttribute('aria-label', `刪除 ${variable.label}`); remove.addEventListener('click', () => { customVariables = customVariables.filter(({ field }) => field !== variable.field); saveCustomVariables(); renderCatalog(); renderCustomVariables(); resetCustomForm(); }); row.append(label, field, edit, remove); customList.append(row); }); }
source.addEventListener('input', syncSource); search.addEventListener('input', renderCatalog);
customForm.addEventListener('submit', (event) => { event.preventDefault(); const variable = { label: customLabel.value.trim(), field: customField.value.trim() }; const otherFields = new Set(customVariables.filter(({ field }) => field !== editingField).map(({ field }) => field.toLowerCase())); if (!validCustom(variable, otherFields)) { customError.textContent = '請輸入未重複的英文欄位名稱。'; return; } customVariables = editingField ? customVariables.map((item) => item.field === editingField ? variable : item) : [...customVariables, variable]; saveCustomVariables(); renderCatalog(); renderCustomVariables(); resetCustomForm(); });
cancelCustom.addEventListener('click', resetCustomForm);
customVariables = loadCustomVariables(); renderCatalog(); renderCustomVariables();
input.addEventListener('change', async () => {
  const file = input.files?.[0]; if (!file) return; error.textContent = ''; warnings.textContent = ''; status.textContent = '正在轉換…'; useArtifact('');
  try { const result = await convertDocx(file); useArtifact(result.html); status.textContent = '已轉換並消毒'; warnings.textContent = result.warnings.join(' '); } catch (reason) { showFailure(reason.message); }
});
preview.addEventListener('click', () => {
  if (!artifact) return;
  const url = URL.createObjectURL(new Blob([artifact], { type: 'text/html;charset=UTF-8' }));
  let revoked = false;
  let popup; let frame;
  const cleanup = () => {
    popup?.removeEventListener?.('pagehide', revoke);
    frame?.removeEventListener?.('load', revoke);
  };
  const revoke = () => { if (!revoked) { revoked = true; cleanup(); URL.revokeObjectURL(url); } };
  try {
    // Open a trusted neutral shell under the click activation, then isolate the editable
    // HTML in an opaque-origin frame. Never give editor HTML a same-origin popup or opener.
    popup = window.open('', '_blank');
    if (!popup) throw new Error('blocked');
    popup.opener = null;
    if (typeof popup.addEventListener !== 'function' || typeof popup.document?.write !== 'function') throw new Error('unavailable');
    // A popup can be dismissed before its frame receives the Blob URL. pagehide is the
    // browser lifecycle signal for that case and leaves a successfully loaded frame intact.
    popup.addEventListener('pagehide', revoke, { once: true });
    popup.document.open?.();
    popup.document.write('<!doctype html><meta charset="UTF-8"><title>Docx Email 預覽</title><style>html,body,iframe{width:100%;height:100%;margin:0;border:0}iframe{display:block}</style><iframe data-docx-preview title="Docx Email 預覽內容" sandbox=""></iframe>');
    popup.document.close?.();
    frame = popup.document.querySelector?.('iframe[data-docx-preview]');
    if (!frame) throw new Error('unavailable');
    frame.addEventListener('load', revoke, { once: true });
    frame.src = url;
    error.textContent = '';
    status.textContent = '已在新視窗開啟預覽';
  } catch {
    revoke();
    popup?.close?.();
    error.textContent = '無法開啟預覽視窗，請允許彈出視窗後再試。';
    status.textContent = '無法開啟預覽';
  }
});
copy.addEventListener('click', async () => { if (!artifact) return; try { await navigator.clipboard.writeText(artifact); status.textContent = '已複製 HTML'; } catch { source.focus(); source.select(); document.execCommand('copy'); status.textContent = '已複製 HTML'; } });
download.addEventListener('click', () => { if (!artifact) return; const url = URL.createObjectURL(new Blob([artifact], { type: 'text/html;charset=UTF-8' })); const link = document.createElement('a'); link.href = url; link.download = 'email-template.html'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); status.textContent = '已下載 HTML'; });
