const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const h = require('./helpers');

test.after(() => h.closeAll());

test('hằng số luật trong src/rules.js khớp mock/meta.json (chống lệch với prototype)', () => {
  const mock = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'mock', 'meta.json'), 'utf8'));
  const { RULES, BANKS } = require('../src/rules');
  assert.deepEqual({ ...RULES, banks: BANKS }, mock);
});

test('GET /api/meta trả luật, danh sách ngân hàng và đồng hồ server; giữ chỗ 15 phút, đặt trước 3 ngày', async () => {
  const app = await h.startApp();
  try {
    const r = await app.agent().get('/api/meta');
    assert.equal(r.status, 200);
    assert.equal(r.body.holdMinutes, 15);
    assert.equal(r.body.bookingWindowDays, 3);
    assert.equal(r.body.banks.length, 18);
    assert.match(r.body.now, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  } finally {
    await app.close();
  }
});
