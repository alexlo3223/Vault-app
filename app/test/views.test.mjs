import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ago, fmtSize } from '../public/views.js';

test('ago turns a timestamp into a short relative time', () => {
  const now = Date.UTC(2026, 5, 15, 12, 0, 0);
  assert.equal(ago(now - 20e3, now), 'ahora mismo');
  assert.equal(ago(now - 5 * 60e3, now), 'hace 5 min');
  assert.equal(ago(now - 3 * 3600e3, now), 'hace 3 h');
  assert.equal(ago(now - 2 * 86400e3, now), 'hace 2 d');
  assert.match(ago(now - 30 * 86400e3, now), /\w/); // older than a week: a calendar date
  assert.equal(ago(now + 5e3, now), 'ahora mismo'); // a clock slightly ahead never shows a negative time
});

test('fmtSize switches from bytes to kilobytes', () => {
  assert.equal(fmtSize(900), '900 B');
  assert.equal(fmtSize(2048), '2.0 KB');
});
