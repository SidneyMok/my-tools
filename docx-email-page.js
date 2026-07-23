import { convertDocx } from './docx-email.js';

const $ = (id) => document.getElementById(id);
const input = $('docx-input'); const source = $('docx-source'); const preview = $('docx-preview'); const status = $('docx-status'); const error = $('docx-error'); const warnings = $('docx-warnings'); const copy = $('copy-docx-html'); const download = $('download-docx-html');
let artifact = '';
function useArtifact(html) { artifact = html; source.value = artifact; preview.srcdoc = artifact; copy.disabled = !artifact; download.disabled = !artifact; }
function showFailure(message) { useArtifact(''); error.textContent = message; status.textContent = '無法轉換'; warnings.textContent = ''; }
input.addEventListener('change', async () => {
  const file = input.files?.[0]; if (!file) return; error.textContent = ''; warnings.textContent = ''; status.textContent = '正在轉換…'; useArtifact('');
  try { const result = await convertDocx(file, globalThis.mammoth); useArtifact(result.html); status.textContent = '已轉換並消毒'; warnings.textContent = result.warnings.join(' '); } catch (reason) { showFailure(reason.message); }
});
copy.addEventListener('click', async () => { if (!artifact) return; try { await navigator.clipboard.writeText(artifact); status.textContent = '已複製 HTML'; } catch { source.focus(); source.select(); document.execCommand('copy'); status.textContent = '已複製 HTML'; } });
download.addEventListener('click', () => { if (!artifact) return; const url = URL.createObjectURL(new Blob([artifact], { type: 'text/html;charset=UTF-8' })); const link = document.createElement('a'); link.href = url; link.download = 'email-template.html'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); status.textContent = '已下載 HTML'; });
