export const MAX_DOCX_BYTES = 10 * 1024 * 1024;
const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const safeUrl = (value) => /^(https?:|mailto:)/i.test(value || '');
const allowed = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'a', 'ol', 'ul', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'span', 'img']);
const allowedStyleProperties = new Set(['color', 'text-align', 'border', 'border-collapse', 'border-spacing', 'padding', 'vertical-align', 'width', 'height']);
const safeStyleValue = (property, value) => {
  const clean = value.trim();
  if (!clean || /(?:url\s*\(|expression\s*\(|@import|behavior|javascript:|data:|vbscript:)/i.test(clean)) return false;
  if (property === 'color') return /^#[0-9a-f]{6}$/i.test(clean);
  if (property === 'text-align') return /^(?:left|right|center|justify)$/i.test(clean);
  if (property === 'vertical-align') return /^(?:top|middle|bottom|baseline)$/i.test(clean);
  if (property === 'border-collapse') return /^(?:collapse|separate)$/i.test(clean);
  if (property === 'border-spacing') return /^(?:0|[\d.]+px)$/i.test(clean);
  if (property === 'width' || property === 'height') return /^(?:auto|[\d.]+(?:px|%))$/i.test(clean);
  if (property === 'padding') return /^[\d.]+px(?:\s+[\d.]+px){0,3}$/i.test(clean);
  if (property === 'border') return /^(?:0|[\d.]+px\s+(?:solid|dashed)\s+#[0-9a-f]{3,8})$/i.test(clean);
  return false;
};
const isDefaultColor = (value) => {
  const clean = value.trim().toLowerCase();
  if (/^(?:#17211f|#000(?:000)?|black)$/.test(clean)) return true;
  const rgb = /^rgb\(\s*([\d.]+)(%?)\s*,\s*([\d.]+)(%?)\s*,\s*([\d.]+)(%?)\s*\)$/.exec(clean);
  if (!rgb) return false;
  const channels = [1, 3, 5].map((index) => Number(rgb[index]) * (rgb[index + 1] === '%' ? 2.55 : 1));
  return channels.every((channel, index) => Math.abs(channel - [23, 33, 31][index]) < 0.01) || channels.every((channel) => channel === 0);
};
const isDefaultStyle = (property, value) => property === 'color' && isDefaultColor(value);
const sanitizeStyle = (value) => value.split(';').map((declaration) => declaration.split(/:(.*)/s)).map(([property, styleValue]) => [property?.trim().toLowerCase(), styleValue?.trim()]).filter(([property, styleValue]) => allowedStyleProperties.has(property) && safeStyleValue(property, styleValue || '') && !isDefaultStyle(property, styleValue)).map(([property, styleValue]) => `${property}:${property === 'color' ? styleValue.toLowerCase() : styleValue}`).join(';');
const esc = (text) => text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
const structuralTags = new Set(['p', 'ol', 'ul', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th']);
const formattingContainers = new Set(['ol', 'ul', 'table', 'thead', 'tbody', 'tr']);

// Tokenize the already-sanitized, conservative HTML subset without rewriting text or
// attribute values. A DOM serializer would add whitespace to mixed inline content;
// this small syntax-aware scanner only inserts whitespace at structural boundaries.
function htmlTokens(html) {
  const tokens = []; let cursor = 0;
  while (cursor < html.length) {
    if (html[cursor] !== '<') { const next = html.indexOf('<', cursor); const end = next === -1 ? html.length : next; tokens.push({ type: 'text', value: html.slice(cursor, end) }); cursor = end; continue; }
    let quote = ''; let end = cursor + 1;
    for (; end < html.length; end += 1) { const char = html[end]; if (quote) { if (char === quote) quote = ''; } else if (char === '"' || char === "'") quote = char; else if (char === '>') break; }
    if (end === html.length) { tokens.push({ type: 'text', value: html.slice(cursor) }); break; }
    const value = html.slice(cursor, end + 1); const match = /^<\s*(\/)?\s*([a-z0-9-]+)/i.exec(value);
    tokens.push(match ? { type: match[1] ? 'close' : /\/\s*>$/.test(value) ? 'void' : 'open', name: match[2].toLowerCase(), value } : { type: 'text', value }); cursor = end + 1;
  }
  return tokens;
}

function prettyPrintEmailHtmlFallback(html) {
  const output = []; const stack = []; let depth = 0; let atLineStart = true; let lastWasStructuralClose = false;
  const write = (value) => { output.push(value); atLineStart = value.endsWith('\n'); };
  const line = (indent) => {
    const padding = '  '.repeat(indent); const previous = output[output.length - 1] || '';
    if (/(?:^|\n) *$/.test(previous)) output[output.length - 1] = previous.replace(/ *$/, padding);
    else write(`\n${padding}`);
    atLineStart = false;
  };
  for (const token of htmlTokens(html)) {
    if (token.type === 'text') { if (!(formattingContainers.has(stack.at(-1)) && /[\n\r]/.test(token.value) && /^\s*$/.test(token.value))) write(token.value); lastWasStructuralClose = false; continue; }
    const isPre = token.name === 'pre' || stack.includes('pre');
    if (isPre) { write(token.value); if (token.type === 'open') stack.push(token.name); if (token.type === 'close') stack.pop(); continue; }
    const structural = structuralTags.has(token.name);
    if (token.type === 'close') {
      if (structural) { depth = Math.max(0, depth - 1); if (lastWasStructuralClose || formattingContainers.has(token.name)) line(depth); }
      write(token.value); stack.pop(); lastWasStructuralClose = structural; continue;
    }
    if (structural) line(depth);
    write(token.value); if (token.type === 'open') stack.push(token.name); if (structural) depth += 1; lastWasStructuralClose = false;
  }
  return output.join('');
}

const readableBlockTags = new Set(['p', 'ol', 'ul', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th']);
const readableVoidTags = new Set(['br', 'img']);

function escapeAttribute(value) {
  return value.replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);
}

function serializeReadableElement(element, depth, writeLine, write) {
  const tag = element.localName.toLowerCase();
  const attributes = Array.from(element.attributes, (attribute) => ` ${attribute.name}="${escapeAttribute(attribute.value)}"`).join('');
  const opening = `<${tag}${attributes}>`;
  if (readableVoidTags.has(tag)) {
    write(opening);
    return;
  }

  write(opening);
  if (tag === 'pre') {
    write(element.innerHTML);
    write(`</${tag}>`);
    return;
  }

  const children = Array.from(element.childNodes);
  const hasBlockChild = children.some((childNode) => childNode.nodeType === 1 && readableBlockTags.has(childNode.localName.toLowerCase()));
  for (const childNode of children) {
    if (childNode.nodeType === 3) {
      // Formatting comments are non-text DOM nodes after reparse. Discard only the old
      // formatter's whitespace-only indentation nodes; inline content stays exact.
      if (hasBlockChild && /^\s*$/.test(childNode.nodeValue) && /[\r\n]/.test(childNode.nodeValue)) continue;
      write(esc(childNode.nodeValue));
    } else if (childNode.nodeType === 8 && /^\n *$/.test(childNode.nodeValue)) {
      continue;
    } else if (childNode.nodeType === 1) {
      const childTag = childNode.localName.toLowerCase();
      if (readableBlockTags.has(childTag)) writeLine(depth + 1);
      serializeReadableElement(childNode, depth + 1, writeLine, write);
    }
  }
  if (hasBlockChild) writeLine(depth);
  write(`</${tag}>`);
}

// The final artifact is parsed after sanitization, then serialized from its DOM tree. This makes
// structural formatting deterministic without inserting text nodes into inline content flow.
export function prettyPrintEmailHtml(html) {
  if (typeof DOMParser === 'undefined') return prettyPrintEmailHtmlFallback(html);
  const document = new DOMParser().parseFromString(html, 'text/html');
  const output = [];
  let hasOutput = false;
  const write = (value) => { output.push(value); hasOutput ||= value.length > 0; };
  const writeLine = (depth) => {
    if (hasOutput) output.push(`<!--\n${'  '.repeat(depth)}-->`);
  };

  for (const node of document.body.childNodes) {
    if (node.nodeType === 3) {
      if (/^\s*$/.test(node.nodeValue) && /[\r\n]/.test(node.nodeValue)) continue;
      write(esc(node.nodeValue));
    } else if (node.nodeType === 8 && /^\n *$/.test(node.nodeValue)) {
      continue;
    } else if (node.nodeType === 1) {
      if (readableBlockTags.has(node.localName.toLowerCase())) writeLine(0);
      serializeReadableElement(node, 0, writeLine, write);
    }
  }
  return output.join('');
}

const children = (node, name) => Array.from(node?.childNodes || []).filter((child) => child.nodeType === 1 && child.localName === name);
const child = (node, name) => children(node, name)[0];
const attr = (node, name) => node?.getAttributeNS(WORD_NS, name) ?? node?.getAttribute(`w:${name}`) ?? node?.getAttribute(name);
const enabledOoxmlBoolean = (node) => {
  if (!node) return false;
  const value = attr(node, 'val');
  return value == null || /^(?:1|true|on)$/i.test(value.trim());
};

export function validateDocxFile(file) {
  if (!file?.name?.toLowerCase().endsWith('.docx')) return { ok: false, message: '只支援 .docx 檔案；舊版 .doc 無法轉換。' };
  if (!Number.isFinite(file.size) || file.size === 0) return { ok: false, message: '檔案是空的或無法讀取。' };
  if (file.size > MAX_DOCX_BYTES) return { ok: false, message: '檔案超過 10 MB 上限，請改用較小的 DOCX。' };
  return { ok: true };
}
export async function assertDocxSignature(file) { const bytes = new Uint8Array(await file.slice(0, 4).arrayBuffer()); return bytes.length === 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04; }

export function sanitizeEmailHtml(dirty) {
  if (typeof DOMParser === 'undefined') return prettyPrintEmailHtml(dirty.replace(/<script\b[^>]*>[\s\S]*?<\/script>|<\/?(?:form|iframe|object|embed|p)\b[^>]*>|<\/?font\b[^>]*>|\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)|\s(?:href|src)\s*=\s*["']?(?:javascript|data|vbscript):[^\s>"']*|\ssize\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)|\sfont-size\s*:[^;"']*;?/gi, '').replace(/\sstyle=("([^"]*)"|'([^']*)')/gi, (_match, _quoted, doubleQuoted, singleQuoted) => { const clean = sanitizeStyle(doubleQuoted ?? singleQuoted ?? ''); return clean ? ` style="${clean}"` : ''; }));
  const doc = new DOMParser().parseFromString(dirty, 'text/html');
  for (const font of [...doc.body.querySelectorAll('font')]) font.replaceWith(...font.childNodes);
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
  for (const table of doc.body.querySelectorAll('table')) {
    const existing = (table.getAttribute('style') || '').split(';').filter((declaration) => declaration && !/^(?:border-collapse|width):/i.test(declaration));
    table.setAttribute('style', [...existing, 'border-collapse:collapse', 'width:100%'].join(';'));
  }
  for (const cell of doc.body.querySelectorAll('td, th')) {
    const existing = (cell.getAttribute('style') || '').split(';').filter((declaration) => declaration && !/^(?:border|padding|vertical-align):/i.test(declaration));
    cell.setAttribute('style', [...existing, 'border:1px solid #dce4df', 'padding:8px', 'vertical-align:top'].join(';'));
  }
  for (const span of [...doc.body.querySelectorAll('span')]) {
    if (!span.getAttribute('style')) span.replaceWith(...span.childNodes);
  }
  const paragraphs = [...doc.body.querySelectorAll('p')];
  for (const paragraph of paragraphs) {
    const next = paragraph.nextElementSibling;
    paragraph.replaceWith(...paragraph.childNodes, ...(next ? [doc.createElement('br'), doc.createElement('br')] : []));
  }
  const output = doc.body.innerHTML.trim().replace(/(?:<br>\s*){3,}/gi, '<br><br>');
  return prettyPrintEmailHtml(output);
}

function runHtml(run, linkify = true) {
  const properties = child(run, 'rPr');
  const text = [...run.childNodes].map((node) => node.localName === 't' ? esc(node.textContent) : node.localName === 'tab' ? '&emsp;' : node.localName === 'br' || node.localName === 'cr' ? '<br>' : '').join('');
  if (!text) return '';
  let output = text;
  if (enabledOoxmlBoolean(child(properties, 'b'))) output = `<strong>${output}</strong>`;
  if (child(properties, 'i')) output = `<em>${output}</em>`;
  if (child(properties, 'u') && attr(child(properties, 'u'), 'val') !== 'none') output = `<u>${output}</u>`;
  if (child(properties, 'strike') || child(properties, 'dstrike')) output = `<s>${output}</s>`;
  const color = attr(child(properties, 'color'), 'val');
  if (/^[0-9a-f]{6}$/i.test(color || '') && !/^0{6}$/i.test(color)) output = `<span style="color:#${color.toLowerCase()}">${output}</span>`;
  return linkify ? mailtoPlainEmail(output) : output;
}
function mailtoPlainEmail(html) {
  return html.replace(/(^|>)([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})(?=<|$)/gi, (_match, prefix, email) => `${prefix}<a href="mailto:${email}">${email}</a>`);
}
function paragraphHtml(paragraph, links, trailingBreak = false) {
  let content = '';
  for (const node of Array.from(paragraph.childNodes).filter((item) => item.nodeType === 1)) {
    if (node.localName === 'r') content += runHtml(node);
    else if (node.localName === 'hyperlink') {
      const href = links.get(node.getAttributeNS(REL_NS, 'id'));
      const runs = children(node, 'r').map((run) => runHtml(run, false)).join('');
      content += safeUrl(href) ? `<a href="${esc(href)}">${runs}</a>` : runs;
    }
  }
  return `${content || '<br>'}${trailingBreak ? '<br>' : ''}`;
}

function numberingTypes(numberingXml) {
  const abstractTypes = new Map();
  for (const abstractNum of Array.from(numberingXml.getElementsByTagNameNS(WORD_NS, 'abstractNum'))) {
    const levels = new Map();
    for (const level of children(abstractNum, 'lvl')) levels.set(attr(level, 'ilvl') || '0', attr(child(level, 'numFmt'), 'val'));
    abstractTypes.set(attr(abstractNum, 'abstractNumId'), levels);
  }
  const types = new Map();
  for (const num of Array.from(numberingXml.getElementsByTagNameNS(WORD_NS, 'num'))) {
    types.set(attr(num, 'numId'), abstractTypes.get(attr(child(num, 'abstractNumId'), 'val')) || new Map());
  }
  return types;
}
export async function renderDocxXml(arrayBuffer) {
  const zipApi = globalThis.JSZip || (await import('jszip')).default;
  const zip = await zipApi.loadAsync(arrayBuffer); const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new Error('找不到 DOCX 文件內容，檔案可能已損毀或加密。');
  const relsText = await zip.file('word/_rels/document.xml.rels')?.async('string') || '<Relationships/>';
  const numberingText = await zip.file('word/numbering.xml')?.async('string') || '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>';
  const XmlParser = globalThis.DOMParser || (await import('@xmldom/xmldom')).DOMParser; const parser = new XmlParser(); const documentXml = parser.parseFromString(xml, 'application/xml'); const relsXml = parser.parseFromString(relsText, 'application/xml'); const links = new Map(Array.from(relsXml.getElementsByTagName('Relationship')).map((item) => [item.getAttribute('Id'), item.getAttribute('Target')]));
  const listTypes = numberingTypes(parser.parseFromString(numberingText, 'application/xml'));
  const body = documentXml.getElementsByTagNameNS(WORD_NS, 'body')[0];
  const sourceParagraphs = Array.from(body.getElementsByTagNameNS(WORD_NS, 'p')).filter((paragraph) => paragraphHtml(paragraph, links) !== '<br>');
  const lastVisibleParagraph = sourceParagraphs.at(-1);
  const blocks = []; let list = null;
  const flush = () => { if (list) { blocks.push(`<${list.type}>${list.items.join('')}</${list.type}>`); list = null; } };
  for (const node of Array.from(body.childNodes).filter((item) => item.nodeType === 1)) {
    if (node.localName === 'p') { const num = child(child(node, 'pPr'), 'numPr'); const numId = attr(child(num, 'numId'), 'val'); const format = listTypes.get(numId)?.get(attr(child(num, 'ilvl'), 'val') || '0'); const type = num ? (format === 'bullet' ? 'ul' : format ? 'ol' : null) : null; const value = paragraphHtml(node, links, !type && node !== lastVisibleParagraph); if (type) { if (!list || list.type !== type || list.numId !== numId) { flush(); list = { type, numId, items: [] }; } list.items.push(`<li>${value}</li>`); } else { flush(); blocks.push(value); } }
    else if (node.localName === 'tbl') { flush(); blocks.push(`<table><tbody>${children(node, 'tr').map((row) => `<tr>${children(row, 'tc').map((cell) => { const paragraphs = children(cell, 'p'); return `<td>${paragraphs.map((paragraph, index) => paragraphHtml(paragraph, links, index < paragraphs.length - 1)).join('')}</td>`; }).join('')}</tr>`).join('')}</tbody></table>`); }
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
    return { html: prettyPrintEmailHtml(sanitizeEmailHtml(html)), warnings: mammothResult.messages.map((item) => item.message) };
  } catch (error) { throw new Error(`無法轉換 DOCX：${error.message || '檔案可能已損毀、受密碼保護或包含不支援的內容。'}`); }
}
