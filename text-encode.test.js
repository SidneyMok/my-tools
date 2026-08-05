import assert from 'node:assert/strict';
import test from 'node:test';
import {
  base64Decode,
  base64Encode,
  formatSqlInList,
  hashText,
  urlDecode,
  urlEncode,
  uuidV4
} from './text-encode.js';

test('SQL IN formatter removes blank lines and trims retained values', () => {
  assert.deepEqual(
    formatSqlInList('  apple  \n\n banana\n   \ncherry  '),
    { output: "IN ('apple','banana','cherry')", count: 3 }
  );
});

test('SQL IN formatter escapes text values and supports values-only output', () => {
  assert.deepEqual(
    formatSqlInList("O'Reilly\napple", { valuesOnly: true }),
    { output: "'O''Reilly','apple'", count: 2 }
  );
});

test('SQL IN formatter emits all retained values without quotes when requested', () => {
  assert.deepEqual(
    formatSqlInList('  TR0240\n\n550e8400-e29b-41d4-a716-446655440000\nCURRENT_DATE\n user_id  ', { noQuotes: true }),
    { output: 'IN (TR0240,550e8400-e29b-41d4-a716-446655440000,CURRENT_DATE,user_id)', count: 4 }
  );
});

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
