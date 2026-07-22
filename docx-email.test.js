import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { convertDocx, sanitizeEmailHtml, validateDocxFile } from './docx-email.js';

test('sanitizer retains safe email formatting and removes active markup', () => {
  const output = sanitizeEmailHtml('<p onclick="evil()"><strong>粗體</strong><a href="https://example.com" onclick="evil()">安全連結</a><a href="javascript:evil()">危險</a><a href="data:text/html,x">資料</a><a href="vbscript:evil">危險二</a><script>evil()</script><form>bad</form><iframe src="https://evil.example"></iframe></p>');
  assert.match(output, /<strong>粗體<\/strong>/);
  assert.match(output, /href="https:\/\/example\.com"/);
  assert.doesNotMatch(output, /onclick|javascript:|data:|vbscript:|<script|<form|<iframe/);
});

test('validates DOCX extension, signature, and configured size limit', () => {
  assert.equal(validateDocxFile({ name: 'letter.doc', size: 10, arrayBuffer: async () => new ArrayBuffer(0) }).ok, false);
  assert.equal(validateDocxFile({ name: 'letter.docx', size: 11 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(0) }).ok, false);
});

test('converts actual DOCX fixture with color, size, underline and core email formatting', async () => {
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
});
