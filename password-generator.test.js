import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { CATEGORY_SETS, generatePassword, validatePasswordSettings } from './password-generator.js';

test('password generator source uses Web Crypto and has no Math.random entropy path', async () => {
  const source = await readFile('./password-generator.js', 'utf8');
  assert.match(source, /getRandomValues/);
  assert.doesNotMatch(source, /Math\.random/);
  const calls = [];
  const crypto = { getRandomValues(values) { calls.push(values.length); values.fill(0); return values; } };
  const password = generatePassword({ length: 16, categories: ['uppercase', 'lowercase', 'numbers', 'symbols'] }, crypto);
  assert.equal(password.length, 16);
  assert.ok(calls.length > 1, 'secure selection and shuffle both use crypto.getRandomValues');
  assert.match(password, /[A-Z]/);
  assert.match(password, /[a-z]/);
  assert.match(password, /[0-9]/);
  assert.ok([...password].some((character) => CATEGORY_SETS.symbols.includes(character)));
});

test('password generator guarantees every enabled category and accepts configured lengths', () => {
  const crypto = { getRandomValues(values) { for (let index = 0; index < values.length; index += 1) values[index] = (index + 19) % 256; return values; } };
  const password = generatePassword({ length: 12, categories: ['uppercase', 'symbols'] }, crypto);
  assert.equal(password.length, 12);
  assert.match(password, /[A-Z]/);
  assert.ok([...password].some((character) => CATEGORY_SETS.symbols.includes(character)));
});

test('password generator securely shuffles guaranteed categories instead of fixing their positions', () => {
  let seed = 0;
  const crypto = { getRandomValues(values) { for (let index = 0; index < values.length; index += 1) values[index] = (seed++ * 73 + 41) % 256; return values; } };
  const passwords = new Set(Array.from({ length: 12 }, () => generatePassword({ length: 16, categories: ['uppercase', 'lowercase', 'numbers', 'symbols'] }, crypto)));
  assert.ok(passwords.size > 1);
  assert.ok([...passwords].some((password) => !/[A-Z]/.test(password[0])));
});

test('password settings reject unsafe lengths and disabled categories', () => {
  assert.match(validatePasswordSettings({ length: 16, categories: [] }), /至少選擇一種/);
  assert.match(validatePasswordSettings({ length: 11, categories: ['uppercase'] }), /12 至 128/);
  assert.match(validatePasswordSettings({ length: 3, categories: ['uppercase', 'lowercase', 'numbers', 'symbols'] }), /12 至 128/);
  assert.equal(validatePasswordSettings({ length: 12, categories: ['uppercase', 'lowercase'] }), '');
});
