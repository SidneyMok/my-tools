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

test('converts actual DOCX fixture without legacy font sizing markup while retaining core email structure and semantics', async () => {
  const content = await readFile('./fixtures/email-fidelity.docx');
  const file = new File([content], 'email-fidelity.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  const { html } = await convertDocx(file);
  assert.match(html, /紅色 16pt 底線/);
  assert.match(html, /<u>紅色 16pt 底線<\/u>/);
  assert.match(html, /<s><em><strong>/);
  assert.match(html, /<br>/);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.match(html, /<table/);
  assert.match(html, /<ul>\n  <li[^>]*>項目符號清單一<\/li>\n  <li[^>]*>項目符號清單二<\/li>\n<\/ul>/);
  assert.match(html, /<ol>\n  <li[^>]*>編號清單一<\/li>\n  <li[^>]*>編號清單二<\/li>\n<\/ol>/);
  assert.doesNotMatch(html, /font-size\s*:|\ssize\s*=/i);
  assert.equal(sanitizeEmailHtml(html), html);
});

test('converts the line-first DOCX fixture with one break per non-final source text line', async () => {
  const content = await readFile('./fixtures/line-first-email.docx');
  const file = new File([content], 'line-first-email.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  const { html } = await convertDocx(file);

  assert.match(html, /<strong>第一行粗體<\/strong><br>\n第二行手動換行<br>\n<font color="#ff0000">第三行紅色<\/font><br>\n<a href="mailto:linked@example\.com"[^>]*>linked@example\.com<\/a><br>\n<a href="mailto:plain@example\.com"[^>]*>plain@example\.com<\/a><br>\n<ul>\n  <li>清單一<\/li>\n  <li>清單二<\/li>\n<\/ul>\n<table/);
  assert.match(html, /<td[^>]*>表格最後一行<\/td>/);
  assert.doesNotMatch(html, /表格最後一行<br>/);
  assert.equal((html.match(/<br>/g) || []).length, 5);
  assert.doesNotMatch(html, /font-size\s*:|\ssize\s*=/i);
  assert.equal(sanitizeEmailHtml(html), html);
});

test('uses structural list and table boundaries instead of terminal container breaks', async () => {
  const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>body line</w:t></w:r></w:p><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>list one</w:t></w:r></w:p><w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>nested list item</w:t></w:r></w:p><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>list two</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell-1A</w:t></w:r></w:p><w:p><w:r><w:t>cell-1B</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`;
  const numbering = `<?xml version="1.0"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
  const bytes = await new JSZip().file('word/document.xml', xml).file('word/numbering.xml', numbering).generateAsync({ type: 'arraybuffer' });
  const html = await renderDocxXml(bytes);

  assert.match(html, /^body line<br><ul><li>list one<\/li><li>nested list item<\/li><li>list two<\/li><\/ul><table/);
  assert.match(html, /<td>cell-1A<br>cell-1B<\/td>/);
  assert.doesNotMatch(html, /<li>[^<]*<br><\/li>|cell-1B<br><\/td>/);
});

test('fallback sanitizer matches the canonical paragraph, list, table, and cell contract', () => {
  const savedDomParser = globalThis.DOMParser;
  const input = '<p style="color:#123456;text-align:center">第一段</p><p>第二段 <a title="連結" href="https://example.com">link</a></p><ul><li>項目一</li><li>項目二</li></ul><table style="width:80%;border-collapse:separate"><tbody><tr><th colspan="2">標題</th><td rowspan="2" style="padding:2px">值</td></tr></tbody></table>';
  const expected = '第一段<br>\n<br>\n第二段 <a title="連結" href="https://example.com" target="_blank" rel="noopener noreferrer">link</a><br>\n<br>\n<ul>\n  <li>項目一</li>\n  <li>項目二</li>\n</ul>\n<table style="border-collapse:collapse;width:100%">\n  <tbody>\n    <tr>\n      <th colspan="2" style="border:1px solid #dce4df;padding:8px;vertical-align:top">標題</th>\n      <td rowspan="2" style="border:1px solid #dce4df;padding:8px;vertical-align:top">值</td>\n    </tr>\n  </tbody>\n</table>';
  try {
    globalThis.DOMParser = undefined;
    const first = sanitizeEmailHtml(input);
    assert.equal(first, expected);
    assert.equal(sanitizeEmailHtml(first), expected);
  } finally {
    globalThis.DOMParser = savedDomParser;
  }
});

test('fallback sanitizer removes active child markup inside canonical fonts when DOMParser is unavailable', () => {
  const savedDomParser = globalThis.DOMParser;
  try {
    globalThis.DOMParser = undefined;
    const html = sanitizeEmailHtml('<font color="#abcdef"><script>alert(1)</script><a href="javascript:evil()">unsafe</a><img src="data:text/html,evil"><img src="https://safe.example/image.png" onerror="evil()">safe &lt;img src=x onerror=bad()&gt;</font>');
    assert.match(html, /^<font color="#abcdef"><a>unsafe<\/a><img><img src="https:\/\/safe\.example\/image\.png">safe &lt;img src=x onerror=bad\(\)&gt;<\/font>$/);
    assert.doesNotMatch(html, /<script|javascript:|data:|onerror="evil\(\)"/i);
  } finally {
    globalThis.DOMParser = savedDomParser;
  }
});

test('sanitizer retains only canonical nonblack color-only font markup', () => {
  const html = sanitizeEmailHtml('<FONT COLOR="#FF0000">保費通知</FONT><font color="#000000">black</font><font face="Arial" color="#00AA00">unsafe attributes</font><font color="#FF0000" size="4">sized font</font><span style="FONT-SIZE:16pt;color:#00AA00">續期保費</span><table size="3"><tr><td SIZE="2">表格內容</td></tr></table>');
  assert.match(html, /<font color="#ff0000">保費通知<\/font>/);
  assert.match(html, /black/);
  assert.match(html, /unsafe attributessized font/);
  assert.match(html, /續期保費/);
  assert.match(html, /表格內容/);
  assert.doesNotMatch(html, /font-size\s*:|\ssize\s*=|<span|#000000|face=/i);
  assert.equal(sanitizeEmailHtml(html), html);
});

test('converts reported insurance-notice DOCX fixture without legacy size markup', async () => {
  const content = await readFile('./fixtures/insurance-notice-font-sizing.docx');
  const file = new File([content], 'insurance-notice-font-sizing.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  const { html } = await convertDocx(file);
  for (const text of ['保單續期繳費通知', '保單號碼：${policyNo}', '應繳保費：${premiumPayable}', '請於到期日前完成繳費。', '注意事項一', '注意事項二', '客服專線']) assert.match(html, new RegExp(text.replace(/[${}]/g, '\\$&')));
  assert.match(html, /<strong>保單續期繳費通知<\/strong>/);
  assert.match(html, /<ul>\n  <li>注意事項一<\/li>\n  <li><u>注意事項二<\/u><\/li>\n<\/ul>/);
  assert.match(html, /<table/);
  assert.match(html, /<br>/);
  assert.doesNotMatch(html, /font-size\s*:|\ssize\s*=/i);
  assert.equal(sanitizeEmailHtml(html), html);
});

test('Normal (Web) paragraph style is separate from legacy run-size conversion', async () => {
  const documentXml = (style) => `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr>${style}</w:pPr><w:r><w:t>Normal Web notice text</w:t></w:r></w:p></w:body></w:document>`;
  const render = async (style) => renderDocxXml(await new JSZip().file('word/document.xml', documentXml(style)).generateAsync({ type: 'arraybuffer' }));
  const plain = await render('');
  const normalWeb = await render('<w:pStyle w:val="NormalWeb"/>');
  assert.equal(normalWeb, plain);
  assert.equal(normalWeb, 'Normal Web notice text');
  assert.doesNotMatch(normalWeb, /font-size\s*:|\ssize\s*=/i);
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

test('serializes structural breaks, blocks, lists, and meaningful comments as real indented source lines', () => {
  const source = '<strong>標題</strong><br><em>第一行</em><br><br><!-- 法務：保留此註記 --><ul><li>項目 <u>一</u><br>續行 {{name}}</li><li>項目二</li></ul><table><tbody><tr><th>欄位</th><td>值</td></tr></tbody></table>';
  const formatted = prettyPrintEmailHtml(source);

  assert.equal(formatted, `<strong>標題</strong><br>
<em>第一行</em><br>
<br>
<!-- 法務：保留此註記 -->
<ul>
  <li>項目 <u>一</u><br>
  續行 {{name}}</li>
  <li>項目二</li>
</ul>
<table>
  <tbody>
    <tr>
      <th>欄位</th>
      <td>值</td>
    </tr>
  </tbody>
</table>`);
  assert.match(formatted, /<br>\n/);
  assert.match(formatted, /\n  <li>/);
  assert.equal(prettyPrintEmailHtml(formatted), formatted);
});

test('drops only contentless conversion comments while preserving business comments and review content', () => {
  const source = '<!--\n  --><!-- --><!--法務核准：{{name}} 的保費通知--><strong>繁體中文</strong><br>續期通知';
  const formatted = prettyPrintEmailHtml(source);

  assert.equal(formatted, '<!--法務核准：{{name}} 的保費通知-->\n<strong>繁體中文</strong><br>\n續期通知');
  assert.doesNotMatch(formatted, /<!--\s*-->/);
  assert.equal(prettyPrintEmailHtml(formatted), formatted);
  assert.equal(sanitizeEmailHtml(formatted), formatted);
});

test('pretty printer preserves preformatted content byte-for-byte for future allowlist support', () => {
  const input = '<pre>  first\n    <code>literal &lt;tag&gt;</code>\n  last  </pre><p>after</p>';
  const output = prettyPrintEmailHtml(input);
  assert.match(output, /^<pre>  first\n    <code>literal &lt;tag&gt;<\/code>\n  last  <\/pre>\n<p>after<\/p>$/);
  assert.equal(prettyPrintEmailHtml(output), output);
});

test('sanitizer removes styles while retaining conservative safe links', () => {
  const html = sanitizeEmailHtml('<p style="color:#123456;font-size:16pt;font-family:Arial, sans-serif;line-height:1.6;font-weight:700;font-style:italic;text-decoration:underline;position:fixed;display:none;--custom:x;background:url(https://evil);margin:0">內容<a href="https://example.com">https</a><a href="http://example.com">http</a><a href="mailto:hello@example.com">mail</a><a href="javascript:evil()">js</a><a href="data:text/html,x">data</a><a href="vbscript:evil">vbs</a></p>');
  assert.match(html, /href="https:\/\/example\.com"/);
  assert.match(html, /href="http:\/\/example\.com"/);
  assert.match(html, /href="mailto:hello@example\.com"/);
  assert.doesNotMatch(html, /font-family|line-height|font-size|color:|font-weight|position|display|--custom|background|url\(|javascript:|data:|vbscript:/i);
});

test('sanitizer removes every target declaration including default black equivalents and remains byte-idempotent', () => {
  const input = '<p style="font-family:Arial;line-height:1.6;font-size:14px;color:#17211f">default</p><p style="font-family:Arial;line-height:20px;font-size:16pt;color:red">fidelity</p><p style="color:#000000">black</p>';
  const first = sanitizeEmailHtml(input);
  assert.doesNotMatch(first, /(?:font-family|line-height):/i);
  assert.doesNotMatch(first, /font-size:14px|color:(?:#17211f|#000(?:000)?|black)/i);
  assert.doesNotMatch(first, /font-size:|color:/i);
  assert.equal(sanitizeEmailHtml(first), first);
});

test('rejects corrupt ZIP and ZIP files that lack word/document.xml', async () => {
  const corrupt = new File([Buffer.from('PK\x03\x04not-a-real-zip')], 'corrupt.docx');
  await assert.rejects(() => convertDocx(corrupt), /無法轉換 DOCX/);
  const bytes = await new JSZip().file('note.txt', 'not a document').generateAsync({ type: 'nodebuffer' });
  const missingDocumentXml = new File([bytes], 'empty.docx');
  await assert.rejects(() => convertDocx(missingDocumentXml), /找不到 DOCX 文件內容/);
});

test('renders the source-runs DOCX fixture directly with canonical safe colour fonts', async () => {
  const content = await readFile('./fixtures/source-runs-email.docx');
  const file = new File([content], 'source-runs-email.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  const { html, warnings } = await convertDocx(file);
  assert.equal(warnings.length, 0);
  assert.match(html, /normal&emsp;manual<br>\nbreak<br>\ncarriage<br>\n<strong>bold<\/strong><u>underline<\/u><font color="#a1b2c3">colour<\/font>black<font color="#ff0000"><u><strong>combined<\/strong><\/u><\/font><br>/);
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;&lt;img src=x onerror=bad\(\)&gt;<a href="mailto:safe@example\.com"[^>]*>safe@example\.com<\/a>unsafe link<br>\n/);
  assert.match(html, /<ul>\n  <li>list item<\/li>\n<\/ul>\n<table/);
  assert.match(html, /<td[^>]*>cell first<br>\n      cell final<\/td>/);
  assert.doesNotMatch(html, /(?:<script|<img|javascript:|font-size|\ssize=)/i);
  assert.match(html, /&lt;img src=x onerror=bad\(\)&gt;/);
  assert.doesNotMatch(html, /cell final<br><\/td>|<li>[^<]*<br><\/li>/);
  assert.equal(sanitizeEmailHtml(html), html);
});
