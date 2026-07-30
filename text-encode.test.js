import assert from 'node:assert/strict';
import test from 'node:test';
import {
  base64Decode,
  base64Encode,
  hashText,
  urlDecode,
  urlEncode,
  uuidV4
} from './text-encode.js';

test('Base64 round-trips Unicode text', () => {
  const source = '你好，世界！\nemoji: 😀';
  assert.equal(base64Decode(base64Encode(source)), source);
});

test('URL component encoding decodes and reports malformed escapes', () => {
  const source = 'hello world/你好?x=1&y=2';
  assert.equal(urlDecode(urlEncode(source)), source);
  assert.throws(() => urlDecode('%E0%A4%A'), URIError);
});

test('SHA-256 hashes known text through Web Crypto', async () => {
  assert.equal(
    await hashText('SHA-256', 'abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
});

test('UUID v4 has the required version and variant bits', () => {
  assert.match(uuidV4(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});
