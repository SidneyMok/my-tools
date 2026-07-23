import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { assertDocxSignature, convertDocx, prettyPrintEmailHtml, renderDocxXml, sanitizeEmailHtml, validateDocxFile } from './docx-email.js';

test('sanitizer retains safe email formatting and removes active markup', () => {
  const output = sanitizeEmailHtml('<p onclick="evil()"><strong>粗體</strong><a href="https://example.com" onclick="evil()">安全連結</a><a href="javascript:evil()">危險</a><a href="data:text/html,x">資料</a><a href="vbscript:evil">危險二</a><script>evil()</script><form>bad</form><iframe src="https://evil.example"></iframe></p>');
  assert.match(output, /<strong>粗體<\/strong>/);
  assert.match(output, /href="https:\/\/example\.com"/);
  assert.doesNotMatch(output, /onclick|javascript:|data:|vbscript:|<script|<form|<iframe/);
});

test('validates DOCX extension, signature, and configured size limit', async () => {
  assert.match(validateDocxFile({ name: 'letter.doc', size: 10, arrayBuffer: async () => new ArrayBuffer(0) }).message, /只支援/);
  assert.match(validateDocxFile({ name: 'letter.docx', size: 11 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(0) }).message, /10 MB/);
  assert.equal(await assertDocxSignature(new File([Buffer.from('not a zip')], 'bad.docx')), false);
});

test('converts actual DOCX fixture without default styles while retaining non-default color, size, underline and core email formatting', async () => {
  const content = await readFile('./fixtures/email-fidelity.docx');
  const file = new File([content], 'email-fidelity.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  const { html } = await convertDocx(file);
  assert.match(html, /color:#FF0000/i);
  assert.match(html, /font-size:16pt/);
  assert.match(html, /<u><span[^>]*>紅色 16pt 底線<\/span><\/u>/);
  assert.match(html, /<s><em><strong>/);
  assert.match(html, /<br>/);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.match(html, /<table/);
  assert.match(html, /<ul>\n  <li[^>]*>項目符號清單一<\/li>\n  <li[^>]*>項目符號清單二<\/li>\n<\/ul>/);
  assert.match(html, /<ol>\n  <li[^>]*>編號清單一<\/li>\n  <li[^>]*>編號清單二<\/li>\n<\/ol>/);
  assert.doesNotMatch(html, /(?:font-family|line-height):/i);
  assert.doesNotMatch(html, /font-size:14px/i);
  assert.doesNotMatch(html, /color:(?:#17211f|#000(?:000)?|black)/i);
});

test('OOXML bold emits strong only for enabled values', async () => {
  const documentXml = (bold) => `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr>${bold}</w:rPr><w:t>bold</w:t></w:r></w:p></w:body></w:document>`;
  const render = async (bold) => renderDocxXml(await new JSZip().file('word/document.xml', documentXml(bold)).generateAsync({ type: 'arraybuffer' }));
  for (const bold of ['', '<w:b w:val="0"/>', '<w:b w:val="false"/>', '<w:b w:val="off"/>', '<w:b w:val="none"/>', '<w:b w:val="unexpected"/>']) assert.doesNotMatch(await render(bold), /<strong>/);
  for (const bold of ['<w:b/>', '<w:b w:val="1"/>', '<w:b w:val="true"/>', '<w:b w:val="on"/>', '<w:b w:val="TRUE"/>']) assert.match(await render(bold), /<strong>bold<\/strong>/);
});

test('formats sanitized HTML deterministically without changing text-node whitespace or active-markup safety', () => {
  const dirty = '<p onclick="evil()"> 前後  空白 <strong>保留  內部空白</strong> 尾端 </p><ul><li>第一項</li><li>第二項</li></ul><script>evil()</script>';
  const sanitized = sanitizeEmailHtml(dirty);
  const first = prettyPrintEmailHtml(sanitized);
  assert.match(first, /<ul>\n  <li[^>]*>第一項<\/li>\n  <li[^>]*>第二項<\/li>\n<\/ul>/);
  assert.match(first, / 前後  空白 <strong>保留  內部空白<\/strong> 尾端 /);
  assert.doesNotMatch(first, /onclick|<script|evil\(\)/);
  assert.equal(prettyPrintEmailHtml(first), first);
  assert.equal(sanitizeEmailHtml(first), first);
});

test('pretty printer preserves preformatted content byte-for-byte for future allowlist support', () => {
  const input = '<pre>  first\n    <code>literal &lt;tag&gt;</code>\n  last  </pre><p>after</p>';
  const output = prettyPrintEmailHtml(input);
  assert.match(output, /^<pre>  first\n    <code>literal &lt;tag&gt;<\/code>\n  last  <\/pre>\n<p>after<\/p>$/);
  assert.equal(prettyPrintEmailHtml(output), output);
});

test('sanitizer strips default styles while retaining conservative non-default email-safe styles and link schemes', () => {
  const html = sanitizeEmailHtml('<p style="color:#123456;font-size:16pt;font-family:Arial, sans-serif;line-height:1.6;font-weight:700;font-style:italic;text-decoration:underline;position:fixed;display:none;--custom:x;background:url(https://evil);margin:0">內容<a href="https://example.com">https</a><a href="http://example.com">http</a><a href="mailto:hello@example.com">mail</a><a href="javascript:evil()">js</a><a href="data:text/html,x">data</a><a href="vbscript:evil">vbs</a></p>');
  assert.match(html, /color:#123456/i);
  assert.match(html, /font-size:16pt/i);
  assert.match(html, /font-weight:700/i);
  assert.match(html, /href="https:\/\/example\.com"/);
  assert.match(html, /href="http:\/\/example\.com"/);
  assert.match(html, /href="mailto:hello@example\.com"/);
  assert.doesNotMatch(html, /font-family|line-height|position|display|--custom|background|url\(|javascript:|data:|vbscript:/i);
});

test('sanitizer removes every target declaration including default black equivalents and remains byte-idempotent', () => {
  const input = '<p style="font-family:Arial;line-height:1.6;font-size:14px;color:#17211f">default</p><p style="font-family:Arial;line-height:20px;font-size:16pt;color:red">fidelity</p><p style="color:#000000">black</p>';
  const first = sanitizeEmailHtml(input);
  assert.doesNotMatch(first, /(?:font-family|line-height):/i);
  assert.doesNotMatch(first, /font-size:14px|color:(?:#17211f|#000(?:000)?|black)/i);
  assert.match(first, /font-size:16pt/i);
  assert.match(first, /color:red/i);
  assert.equal(sanitizeEmailHtml(first), first);
});

test('rejects corrupt ZIP and ZIP files that lack word/document.xml', async () => {
  const corrupt = new File([Buffer.from('PK\x03\x04not-a-real-zip')], 'corrupt.docx');
  await assert.rejects(() => convertDocx(corrupt), /無法轉換 DOCX/);
  const bytes = await new JSZip().file('note.txt', 'not a document').generateAsync({ type: 'nodebuffer' });
  const missingDocumentXml = new File([bytes], 'empty.docx');
  await assert.rejects(() => convertDocx(missingDocumentXml), /找不到 DOCX 文件內容/);
});
