export const MAX_DOCX_BYTES = 10 * 1024 * 1024;
const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const safeUrl = (value) => /^(https?:|mailto:)/i.test(value || '');
const allowed = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'a', 'ol', 'ul', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'span', 'img', 'font', 'pre', 'code']);
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
const readableBlockTags = new Set(['p', 'ol', 'ul', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th']);
const readableVoidTags = new Set(['br', 'img']);
const meaningfulDocumentComments = (document) => Array.from(document.childNodes)
  .filter((node) => node.nodeType === 8 && node.nodeValue.trim())
  .map((node) => `<!--${node.nodeValue}-->`);

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
    const value = html.slice(cursor, end + 1); const comment = /^<!--([\s\S]*?)-->$/.exec(value); const match = /^<\s*(\/)?\s*([a-z0-9-]+)/i.exec(value);
    tokens.push(comment ? { type: 'comment', value, content: comment[1] } : match ? { type: match[1] ? 'close' : /\/\s*>$/.test(value) ? 'void' : 'open', name: match[2].toLowerCase(), value } : { type: 'text', value }); cursor = end + 1;
  }
  return tokens;
}

function prettyPrintEmailHtmlFallback(html) {
  const output = []; const stack = []; let depth = 0; let boundary = null;
  const write = (value) => { output.push(value); boundary = null; };
  const line = (indent) => {
    if (!output.length) return;
    const value = `\n${'  '.repeat(indent)}`;
    if (boundary != null) output[boundary] = value;
    else { output.push(value); boundary = output.length - 1; }
  };
  for (const token of htmlTokens(html)) {
    const isPre = token.name === 'pre' || stack.includes('pre');
    if (isPre) { write(token.value); if (token.type === 'open') stack.push(token.name); if (token.type === 'close') stack.pop(); continue; }
    if (token.type === 'text') {
      if (/^\s*$/.test(token.value) && /[\n\r]/.test(token.value)) continue;
      const previous = output[output.length - 1] || '';
      write(/^\n[ \t]*/.test(token.value) && /\n[ \t]*$/.test(previous) ? token.value.replace(/^\n[ \t]*/, '') : token.value);
      continue;
    }
    if (token.type === 'comment') { if (token.content.trim()) { write(`<!--${token.content}-->`); line(depth); } continue; }
    const structural = structuralTags.has(token.name);
    if (token.type === 'close') {
      if (structural) depth = Math.max(0, depth - 1);
      if (structural && ['ol', 'ul', 'table', 'thead', 'tbody', 'tr'].includes(token.name)) line(depth);
      write(token.value); stack.pop(); continue;
    }
    if (structural) line(depth);
    write(token.value); if (token.type === 'open') stack.push(token.name); if (structural) depth += 1; if (token.name === 'br') line(Math.max(0, depth - 1));
  }
  return output.join('').replace(/\n[ \t]*(?:\n[ \t]*)+/g, '\n');
}

function escapeAttribute(value) {
  return value.replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);
}

function serializeReadableElement(element, depth, writeLine, write) {
  const tag = element.localName.toLowerCase();
  const attributes = Array.from(element.attributes, (attribute) => ` ${attribute.name}="${escapeAttribute(attribute.value)}"`).join('');
  const opening = `<${tag}${attributes}>`;
  if (readableVoidTags.has(tag)) {
    write(opening);
    if (tag === 'br') writeLine(Math.max(0, depth - 1));
    return;
  }

  write(opening);
  if (tag === 'pre') {
    write(element.innerHTML);
    write(`</${tag}>`);
    return;
  }

  const children = Array.from(element.childNodes);
  const ownsStructuralLayout = readableBlockTags.has(tag) && children.some((childNode) => childNode.nodeType === 1 && readableBlockTags.has(childNode.localName.toLowerCase()));
  for (const childNode of children) {
    if (childNode.nodeType === 3) {
      // Ignore only indentation reintroduced by this serializer. Text containing visible
      // characters (including template variables and Unicode) remains byte-for-byte.
      if (/^\s*$/.test(childNode.nodeValue) && /[\r\n]/.test(childNode.nodeValue)) continue;
      // A preceding <br> already owns this source line. Browser parsing exposes the
      // serializer newline as part of the following text node; retain user text only.
      const followsBreak = childNode.previousSibling?.nodeType === 1 && childNode.previousSibling.localName.toLowerCase() === 'br';
      write(esc(followsBreak ? childNode.nodeValue.replace(/^\n[ \t]*/, '') : childNode.nodeValue.replace(/^\n[ \t]*/, '')));
    } else if (childNode.nodeType === 8) {
      if (childNode.nodeValue.trim()) { write(`<!--${childNode.nodeValue}-->`); writeLine(depth + 1); }
    } else if (childNode.nodeType === 1) {
      const childTag = childNode.localName.toLowerCase();
      if (readableBlockTags.has(childTag) && ownsStructuralLayout) writeLine(depth + 1);
      serializeReadableElement(childNode, depth + 1, writeLine, write);
    }
  }
  if (ownsStructuralLayout) writeLine(depth);
  write(`</${tag}>`);
}

// The final artifact is parsed after sanitization, then serialized from its DOM tree. This makes
// structural formatting deterministic without inserting text nodes into inline content flow.
export function prettyPrintEmailHtml(html) {
  if (typeof DOMParser === 'undefined') return prettyPrintEmailHtmlFallback(html);
  const document = new DOMParser().parseFromString(html, 'text/html');
  const output = [];
  let hasOutput = false; let boundary = null;
  const write = (value) => { output.push(value); hasOutput ||= value.length > 0; boundary = null; };
  const writeLine = (depth) => {
    if (!hasOutput || depth == null) return;
    const value = `\n${'  '.repeat(depth)}`;
    if (boundary != null) output[boundary] = value;
    else { output.push(value); boundary = output.length - 1; }
  };

  const nodes = [
    ...meaningfulDocumentComments(document).map((value) => ({ nodeType: 8, nodeValue: value.slice(4, -3) })),
    ...document.body.childNodes
  ];
  for (const node of nodes) {
    if (node.nodeType === 3) {
      if (/^\s*$/.test(node.nodeValue) && /[\r\n]/.test(node.nodeValue)) continue;
      const followsBreak = node.previousSibling?.nodeType === 1 && node.previousSibling.localName.toLowerCase() === 'br';
      write(esc(followsBreak ? node.nodeValue.replace(/^\n[ \t]*/, '') : node.nodeValue.replace(/^\n[ \t]*/, '')));
    } else if (node.nodeType === 8) {
      if (node.nodeValue.trim()) { write(`<!--${node.nodeValue}-->`); writeLine(0); }
    } else if (node.nodeType === 1) {
      if (readableBlockTags.has(node.localName.toLowerCase())) writeLine(0);
      serializeReadableElement(node, 0, writeLine, write);
    }
  }
  return output.join('').replace(/\n[ \t]*(?:\n[ \t]*)+/g, '\n');
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
  if (typeof DOMParser === 'undefined') {
    const escaped = []; const comments = [];
    const fontStack = [];
    const protect = (input) => input.replace(/&lt;[\s\S]*?&gt;/gi, (text) => `@@ESCAPED${escaped.push(text) - 1}@@`);
    const parseAttributes = (source) => {
      const attributes = new Map();
      for (const match of source.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
      return attributes;
    };
    const sanitizeTag = (tag) => {
      const match = /^<\s*(\/)?\s*([a-z0-9-]+)([^>]*)>$/i.exec(tag);
      if (!match) return esc(tag);
      const [, closing, rawName, source] = match; const name = rawName.toLowerCase();
      if (name === 'font') {
        if (closing) return fontStack.pop() ? '</font>' : '';
        const attributes = parseAttributes(source); const color = attributes.get('color')?.toLowerCase();
        const accepted = attributes.size === 1 && /^#[0-9a-f]{6}$/.test(color || '') && !/^#0{6}$/.test(color);
        fontStack.push(accepted);
        return accepted ? `<font color="${color}">` : '';
      }
      if (!allowed.has(name) || /^(?:script|style|form|object|embed|iframe|frame|meta|link|svg|math)$/i.test(name) || name === 'p' || name === 'span') return '';
      if (closing) return name === 'br' || name === 'img' ? '' : `</${name}>`;
      const attributes = parseAttributes(source);
      const output = [];
      const style = sanitizeStyle(attributes.get('style') || ''); if (style) output.push(`style="${style}"`);
      for (const attribute of ['alt', 'title', 'colspan', 'rowspan']) if (attributes.has(attribute)) output.push(`${attribute}="${escapeAttribute(attributes.get(attribute))}"`);
      if ((name === 'a' || name === 'img') && safeUrl(attributes.get(name === 'a' ? 'href' : 'src'))) output.push(`${name === 'a' ? 'href' : 'src'}="${escapeAttribute(attributes.get(name === 'a' ? 'href' : 'src'))}"`);
      if (name === 'a' && attributes.has('href') && safeUrl(attributes.get('href'))) output.push('target="_blank"', 'rel="noopener noreferrer"');
      return `<${name}${output.length ? ` ${output.join(' ')}` : ''}>`;
    };
    const protectComments = (input) => input.replace(/<!--([\s\S]*?)-->/g, (_match, content) => (content.trim() ? `@@COMMENT${comments.push(content) - 1}@@` : ''));
    const cleaned = protect(protectComments(dirty)).replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, sanitizeTag);
    return prettyPrintEmailHtml(cleaned.replace(/@@ESCAPED(\d+)@@/g, (_match, index) => escaped[index]).replace(/@@COMMENT(\d+)@@/g, (_match, index) => `<!--${comments[index]}-->`));
  }
  const doc = new DOMParser().parseFromString(dirty, 'text/html');
  const leadingComments = meaningfulDocumentComments(doc).join('');
  for (const element of [...doc.body.querySelectorAll('*')]) {
    const tag = element.tagName.toLowerCase();
    if (!allowed.has(tag) || /^(script|style|form|object|embed|iframe|frame|meta|link|svg|math)$/i.test(tag)) { element.remove(); continue; }
    if (tag === 'span') { element.replaceWith(...element.childNodes); continue; }
    if (tag === 'font') {
      const color = element.getAttribute('color');
      if (!/^#[0-9a-f]{6}$/i.test(color || '') || /^#0{6}$/i.test(color) || element.attributes.length !== 1) { element.replaceWith(...element.childNodes); continue; }
      element.setAttribute('color', color.toLowerCase());
      continue;
    }
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
  for (const span of [...doc.body.querySelectorAll('span')]) span.replaceWith(...span.childNodes);
  const paragraphs = [...doc.body.querySelectorAll('p')];
  for (const paragraph of paragraphs) {
    const next = paragraph.nextElementSibling;
    paragraph.replaceWith(...paragraph.childNodes, ...(next ? [doc.createElement('br'), doc.createElement('br')] : []));
  }
  const output = `${leadingComments}${doc.body.innerHTML.trim()}`.replace(/(?:<br>\s*){3,}/gi, '<br><br>');
  return prettyPrintEmailHtml(output);
}

function mailtoPlainText(text) {
  const email = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  let output = ''; let cursor = 0;
  for (const match of text.matchAll(email)) { output += esc(text.slice(cursor, match.index)); output += `<a href="mailto:${match[0]}">${esc(match[0])}</a>`; cursor = match.index + match[0].length; }
  return output + esc(text.slice(cursor));
}

// Formatting nests deterministically from outermost colour, then underline, then bold.
function runHtml(run, linkify = true) {
  const properties = child(run, 'rPr');
  const text = [...run.childNodes].map((node) => node.localName === 't' ? (linkify ? mailtoPlainText(node.textContent) : esc(node.textContent)) : node.localName === 'tab' ? '&emsp;' : node.localName === 'br' || node.localName === 'cr' ? '<br>' : '').join('');
  if (!text) return '';
  let output = text;
  if (enabledOoxmlBoolean(child(properties, 'b'))) output = `<strong>${output}</strong>`;
  if (child(properties, 'i')) output = `<em>${output}</em>`;
  if (child(properties, 'u') && attr(child(properties, 'u'), 'val') !== 'none') output = `<u>${output}</u>`;
  if (child(properties, 'strike') || child(properties, 'dstrike')) output = `<s>${output}</s>`;
  const color = attr(child(properties, 'color'), 'val');
  if (/^[0-9a-f]{6}$/i.test(color || '') && !/^0{6}$/i.test(color)) output = `<font color="#${color.toLowerCase()}">${output}</font>`;
  return output;
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

export async function convertDocx(file) {
  const validity = validateDocxFile(file); if (!validity.ok) throw new Error(validity.message);
  if (!await assertDocxSignature(file)) throw new Error('此檔案不是有效的 DOCX（缺少 ZIP 簽名），可能已損毀或加密。');
  try {
    const html = await renderDocxXml(await file.arrayBuffer());
    return { html: prettyPrintEmailHtml(sanitizeEmailHtml(html)), warnings: [] };
  } catch (error) { throw new Error(`無法轉換 DOCX：${error.message || '檔案可能已損毀、受密碼保護或包含不支援的內容。'}`); }
}
