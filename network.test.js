import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidIp } from './network.js';

test('accepts standard IPv4 addresses', () => {
  assert.equal(isValidIp('8.8.8.8'), true);
  assert.equal(isValidIp('192.168.0.1'), true);
});

test('accepts standard and compressed IPv6 addresses', () => {
  assert.equal(isValidIp('2001:4860:4860::8888'), true);
  assert.equal(isValidIp('::1'), true);
  assert.equal(isValidIp('::'), true);
  assert.equal(isValidIp('::ffff:192.0.2.128'), true);
});

test('rejects malformed IP addresses', () => {
  assert.equal(isValidIp('256.1.1.1'), false);
  assert.equal(isValidIp('1:2:3:4:5:6:7:8::'), false);
  assert.equal(isValidIp('::1:2:3:4:5:6:7:8'), false);
  assert.equal(isValidIp('2001:::1'), false);
  assert.equal(isValidIp('not-an-ip'), false);
  assert.equal(isValidIp(''), false);
});
