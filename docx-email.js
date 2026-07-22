export const MAX_DOCX_BYTES = 10 * 1024 * 1024;
const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const safeUrl = (value) => /^(https?:|mailto:)/i.test(value || '');
const allowed = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'a', 'ol', 'ul', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'span', 'img']);
const emailStyle = 'font-family:Arial,Helvetica,"PingFang TC","Microsoft JhengHei",sans-serif;font-size:14px;line-height:1.6;color:#17211f;';
const allowedStyleProperties = new Set(['color', 'font-size', 'font-family', 'line-height', 'text-decoration', 'font-weight', 'font-style', 'text-align', 'border', 'border-collapse', 'border-spacing', 'padding', 'vertical-align', 'width', 'height']);
const safeStyleValue = (property, value) => {
  const clean = value.trim();
  if (!clean || /(?:url\s*\(|expression\s*\(|@import|behavior|javascript:|data:|vbscript:)/i.test(clean)) return false;
  if (property === 'color') return /^(?:#[0-9a-f]{3,8}|rgb\([\d\s,.%]+\)|[a-z]+)$/i.test(clean);
  if (property === 'font-size') return /^(?:[\d.]+(?:px|pt|em|rem|%)|small|medium|large)$/i.test(clean);
  if (property === 'font-family') return /^[\w\s,"'-]+$/i.test(clean);
  if (property === 'line-height') return /^[\d.]+(?:px|pt|em|rem|%)?$/i.test(clean);
  if (property === 'font-weight') return /^(?:normal|bold|[1-9]00)$/i.test(clean);
  if (property === 'font-style') return /^(?:normal|italic|oblique)$/i.test(clean);
  if (property === 'text-decoration') return /^(?:none|underline|line-through)(?:\s+(?:underline|line-through))?$/i.test(clean);
  if (property === 'text-align') return /^(?:left|right|center|justify)$/i.test(clean);
  if (property === 'vertical-align') return /^(?:top|middle|bottom|baseline)$/i.test(clean);
  if (property === 'border-collapse') return /^(?:collapse|separate)$/i.test(clean);
  if (property === 'border-spacing') return /^(?:0|[\d.]+px)$/i.test(clean);
  if (property === 'width' || property === 'height') return /^(?:auto|[\d.]+(?:px|%))$/i.test(clean);
  if (property === 'padding') return /^[\d.]+px(?:\s+[\d.]+px){0,3}$/i.test(clean);
  if (property === 'border') return /^(?:0|[\d.]+px\s+(?:solid|dashed)\s+#[0-9a-f]{3,8})$/i.test(clean);
  return false;
};
const sanitizeStyle = (value) => value.split(';').map((declaration) => declaration.split(/:(.*)/s)).filter(([property, styleValue]) => allowedStyleProperties.has(property?.trim().toLowerCase()) && safeStyleValue(property.trim().toLowerCase(), styleValue || '')).map(([property, styleValue]) => `${property.trim().toLowerCase()}:${styleValue.trim()}`).join(';');
const esc = (text) => text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
const children = (node, name) => Array.from(node?.childNodes || []).filter((child) => child.nodeType === 1 && child.localName === name);
const child = (node, name) => children(node, name)[0];
const attr = (node, name) => node?.getAttributeNS(WORD_NS, name) ?? node?.getAttribute(`w:${name}`) ?? node?.getAttribute(name);

export function validateDocxFile(file) {
  if (!file?.name?.toLowerCase().endsWith('.docx')) return { ok: false, message: '只支援 .docx 檔案；舊版 .doc 無法轉換。' };
  if (!Number.isFinite(file.size) || file.size === 0) return { ok: false, message: '檔案是空的或無法讀取。' };
  if (file.size > MAX_DOCX_BYTES) return { ok: false, message: '檔案超過 10 MB 上限，請改用較小的 DOCX。' };
  return { ok: true };
}
export async function assertDocxSignature(file) { const bytes = new Uint8Array(await file.slice(0, 4).arrayBuffer()); return bytes.length === 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04; }

export function sanitizeEmailHtml(dirty) {
  if (typeof DOMParser === 'undefined') return dirty.replace(/<script\b[^>]*>[\s\S]*?<\/script>|<\/?(?:form|iframe|object|embed)\b[^>]*>|\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)|\s(?:href|src)\s*=\s*["']?(?:javascript|data|vbscript):[^\s>"']*/gi, '').replace(/\sstyle=("([^"]*)"|'([^']*)')/gi, (_match, _quoted, doubleQuoted, singleQuoted) => { const clean = sanitizeStyle(doubleQuoted ?? singleQuoted ?? ''); return clean ? ` style="${clean}"` : ''; });
  const doc = new DOMParser().parseFromString(dirty, 'text/html');
  for (const element of [...doc.body.querySelectorAll('*')]) {
    const tag = element.tagName.toLowerCase();
    if (!allowed.has(tag) || /^(script|style|form|object|embed|iframe|frame|meta|link|svg|math)$/i.test(tag)) { element.remove(); continue; }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name === 'style') { const sanitized = sanitizeStyle(attribute.value); if (sanitized) element.setAttribute('style', sanitized); else element.removeAttribute('style'); }
      if (name.startsWith('on') || name === 'id' || name === 'class' || name === 'srcset') element.removeAttribute(attribute.name);
      if ((name === 'href' || name === 'src') && !safeUrl(attribute.value)) element.removeAttribute(attribute.name);
      if (!['href', 'src', 'alt', 'title', 'style', 'colspan', 'rowspan'].includes(name)) element.removeAttribute(attribute.name);
    }
    if (tag === 'a' && element.hasAttribute('href')) { element.setAttribute('target', '_blank'); element.setAttribute('rel', 'noopener noreferrer'); }
  }
  for (const element of [...doc.body.querySelectorAll('p, li, td, th')]) if (!element.getAttribute('style')) element.setAttribute('style', emailStyle);
  for (const table of doc.body.querySelectorAll('table')) table.setAttribute('style', 'border-collapse:collapse;width:100%;' + emailStyle);
  for (const cell of doc.body.querySelectorAll('td, th')) cell.setAttribute('style', (cell.getAttribute('style') || emailStyle) + 'border:1px solid #dce4df;padding:8px;vertical-align:top;');
  return doc.body.innerHTML.trim();
}

function runHtml(run) {
  const properties = child(run, 'rPr');
  const text = [...run.childNodes].map((node) => node.localName === 't' ? esc(node.textContent) : node.localName === 'tab' ? '&emsp;' : node.localName === 'br' || node.localName === 'cr' ? '<br>' : '').join('');
  if (!text) return '';
  const styles = []; const color = attr(child(properties, 'color'), 'val'); const size = attr(child(properties, 'sz'), 'val');
  if (/^[0-9a-f]{6}$/i.test(color)) styles.push(`color:#${color}`);
  if (/^\d+$/.test(size || '')) styles.push(`font-size:${Number(size) / 2}pt`);
  let output = styles.length ? `<span style="${styles.join(';')}">${text}</span>` : text;
  if (child(properties, 'b')) output = `<strong>${output}</strong>`;
  if (child(properties, 'i')) output = `<em>${output}</em>`;
  if (child(properties, 'u') && attr(child(properties, 'u'), 'val') !== 'none') output = `<u>${output}</u>`;
  if (child(properties, 'strike') || child(properties, 'dstrike')) output = `<s>${output}</s>`;
  return output;
}
function paragraphHtml(paragraph, links) {
  let content = ''; for (const node of Array.from(paragraph.childNodes).filter((item) => item.nodeType === 1)) { if (node.localName === 'r') content += runHtml(node); else if (node.localName === 'hyperlink') { const href = links.get(node.getAttributeNS(REL_NS, 'id')); const runs = children(node, 'r').map(runHtml).join(''); content += safeUrl(href) ? `<a href="${esc(href)}">${runs}</a>` : runs; } }
  return content || '<br>';
}
export async function renderDocxXml(arrayBuffer) {
  const zipApi = globalThis.JSZip || (await import('jszip')).default;
  const zip = await zipApi.loadAsync(arrayBuffer); const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new Error('找不到 DOCX 文件內容，檔案可能已損毀或加密。');
  const relsText = await zip.file('word/_rels/document.xml.rels')?.async('string') || '<Relationships/>';
  const XmlParser = globalThis.DOMParser || (await import('@xmldom/xmldom')).DOMParser; const parser = new XmlParser(); const documentXml = parser.parseFromString(xml, 'application/xml'); const relsXml = parser.parseFromString(relsText, 'application/xml'); const links = new Map(Array.from(relsXml.getElementsByTagName('Relationship')).map((item) => [item.getAttribute('Id'), item.getAttribute('Target')]));
  const blocks = []; let list = null;
  const flush = () => { if (list) { blocks.push(`<${list.type}>${list.items.join('')}</${list.type}>`); list = null; } };
  for (const node of Array.from(documentXml.getElementsByTagNameNS(WORD_NS, 'body')[0].childNodes).filter((item) => item.nodeType === 1)) {
    if (node.localName === 'p') { const num = child(child(node, 'pPr'), 'numPr'); const type = num ? (attr(child(num, 'numId'), 'val') === '0' ? 'ul' : 'ol') : null; const value = paragraphHtml(node, links); if (type) { if (!list || list.type !== type) { flush(); list = { type, items: [] }; } list.items.push(`<li>${value}</li>`); } else { flush(); blocks.push(`<p>${value}</p>`); } }
    else if (node.localName === 'tbl') { flush(); blocks.push(`<table><tbody>${children(node, 'tr').map((row) => `<tr>${children(row, 'tc').map((cell) => `<td>${children(cell, 'p').map((p) => paragraphHtml(p, links)).join('<br>')}</td>`).join('')}</tr>`).join('')}</tbody></table>`); }
  } flush(); return blocks.join('');
}

export async function convertDocx(file, mammoth) {
  const validity = validateDocxFile(file); if (!validity.ok) throw new Error(validity.message);
  if (!await assertDocxSignature(file)) throw new Error('此檔案不是有效的 DOCX（缺少 ZIP 簽名），可能已損毀或加密。');
  try {
    // Mammoth provides compatibility diagnostics and basic document semantics. Its output omits
    // arbitrary run color/font-size (and defaults to omitting underline), so the narrow OOXML
    // run-properties renderer above deliberately supplies required color/size/underline fidelity.
    const arrayBuffer = await file.arrayBuffer();
    // Read the required document part first so missing/corrupt OOXML receives a useful local error,
    // rather than a parser-specific diagnostic from optional compatibility analysis.
    const html = await renderDocxXml(arrayBuffer);
    const mammothResult = mammoth ? await mammoth.convertToHtml({ arrayBuffer }, { styleMap: ['u => u'] }) : { messages: [] };
    return { html: sanitizeEmailHtml(html), warnings: mammothResult.messages.map((item) => item.message) };
  } catch (error) { throw new Error(`無法轉換 DOCX：${error.message || '檔案可能已損毀、受密碼保護或包含不支援的內容。'}`); }
}
