// Ngân hàng báo có tiền (SePay, R17): khớp khoản tiền vào với đơn đang chờ tiền rồi tự ghi nhận qua đúng các đường chủ sân
// bấm tay (bookingOps.applyPaid / transfers.completeTransfer / matchOps.applyPart), hoặc lưu thành khoản cần xử lý.
// Code chỉ đọc MÃ ĐƠN theo định dạng và so số tiền đúng bằng số cần chuyển; nó không hiểu ý lời nhắn của người chuyển.
// Một transaction cho mỗi giao dịch: chèn dòng bank_transactions trước (provider_tx_id UNIQUE nên gọi lại cùng id thì dừng),
// rồi khóa dòng đơn/nhượng/trận (FOR UPDATE) và kiểm lại trạng thái trước khi ghi nhận, nên hai giao dịch khác id cho cùng một
// đơn tuần tự hóa: giao dịch sau thấy đơn đã trả và thành `not_payable`.
const clock = require('../clock');
const { db, withTransaction, isDuplicate } = require('../db');
const { vnToMs } = require('../lib/time');
const { badRequest, conflict, notFound } = require('../utils/errors');
const { notify, addHistory, money } = require('./notify');
const { applyPaid } = require('./bookingOps');
const { loadTransfer, completeTransfer } = require('./transfers');
const { lockMatch, applyPart, hostPending, guestPending } = require('./matchOps');

const BANK_ACTOR = { id: null, role: 'bank' };
const LIST_LIMIT = 200;

// Mã nằm ở bất kỳ đâu trong nội dung (ngân hàng hay dán thêm chữ phía trước, ví dụ `MBVCB.123.SN01238 chuyen tien`, `KEOSN01238`):
// SN + đúng 5 chữ số (SN#####), tiền tố TD (phần ghép kèo, kèm hậu tố A/B) hoặc NH (nhượng sân). Bên trái không cần ranh giới; bên phải
// phải hết mã (không dính chữ/số khác), nên `SN012381` không phải mã (và cũng không phải SN01238). Quét trái sang phải, mỗi chỗ lấy dạng
// dài nhất (`TDSN01238A` là phần kèo, không phải đơn SN01238).
const CODE_RE = /(TD|NH)?(SN\d{5})([AB])?(?![A-Z0-9])/gi;

const REASON_TEXT = {
  no_code: 'Nội dung chuyển khoản không có mã đơn hợp lệ',
  unknown_order: 'Không có đơn nào mang mã này ở sân của bạn',
  not_approved: 'Đơn chưa được chủ sân đồng ý nên chưa nhận tiền tự động',
  not_payable: 'Đơn không còn chờ tiền (đã trả, đã hủy hoặc hết hạn)',
  wrong_account: 'Tiền vào tài khoản của sân khác, nội dung lại mang mã đơn của sân này',
  no_account: 'Báo cáo của ngân hàng không có số tài khoản nhận',
  short: 'Số tiền ít hơn số cần chuyển',
  over: 'Số tiền nhiều hơn số cần chuyển',
  multiple_codes: 'Nội dung có nhiều hơn một mã đơn khác nhau nên không tự đoán đơn nào',
};

/** Các mã đơn khác nhau tìm được trong nội dung (đã bỏ trùng); tổ hợp tiền tố/hậu tố không hợp lệ (TD thiếu A/B, NH kèm A/B, A/B không tiền tố) không tính là mã. */
function parseCodes(content) {
  const found = new Map();
  for (const m of String(content || '').matchAll(CODE_RE)) {
    const prefix = (m[1] || '').toUpperCase();
    const code = m[2].toUpperCase();
    const part = (m[3] || '').toUpperCase();
    let c = null;
    if (prefix === 'TD' && part) c = { kind: 'match', code, part: part === 'A' ? 'host' : 'guest' };
    else if (prefix === 'NH' && !part) c = { kind: 'transfer', code };
    else if (!prefix && !part) c = { kind: 'booking', code };
    if (c) found.set(`${c.kind}:${c.code}:${c.part || ''}`, c);
  }
  return [...found.values()];
}

const dto = (e) => ({
  id: e.id,
  txId: e.providerTxId,
  content: e.content,
  amount: e.amount,
  bookingId: e.bookingId ?? null,
  venueId: e.venueId ?? null,
  bookingCode: e.bookingCode ?? null,
  expected: e.expected ?? null,
  status: e.status,
  reason: e.reason ?? null,
  reasonText: e.reason ? REASON_TEXT[e.reason] : null,
  receivedAt: e.receivedAt,
});

/**
 * Tìm khoản đang chờ tiền ứng với mã trong sân của tài khoản, khóa dòng của nó và kiểm lại.
 * Trả { reason } khi không tự ghi nhận được, hoặc { due, apply } khi ghi nhận được nếu số tiền khớp.
 */
async function lockTarget(tx, parsed, b, note) {
  const nowMs = clock.nowMs();
  if (parsed.kind === 'booking') {
    const row = await tx.one('SELECT * FROM bookings WHERE id = ? FOR UPDATE', [b.id]);
    if (row.userId == null) return { reason: 'not_payable' }; // lịch chủ sân thêm tay: không có QR
    if (row.status === 'pending') return { reason: 'not_approved' };
    if (row.status !== 'confirmed' || row.paymentStatus !== 'unpaid') return { reason: 'not_payable' };
    return { due: row.price, apply: () => applyPaid(tx, row, { via: 'bank', note }) };
  }
  if (parsed.kind === 'transfer') {
    const t = await tx.one("SELECT id FROM transfers WHERE booking_id = ? AND status = 'claimed'", [b.id]);
    const transfer = t ? await loadTransfer(t.id, tx, true) : null;
    if (!transfer || transfer.status !== 'claimed' || vnToMs(transfer.claimExpiresAt) <= nowMs) return { reason: 'not_payable' };
    return { due: transfer.askPrice, apply: () => completeTransfer(tx, transfer, null, note, 'bank') };
  }
  const mm = await tx.one('SELECT id FROM matches WHERE booking_id = ?', [b.id]);
  if (!mm) return { reason: 'not_payable' };
  const m = await lockMatch(tx, mm.id);
  const pending = parsed.part === 'host' ? hostPending(m, nowMs) : guestPending(m, nowMs);
  if (!pending) return { reason: 'not_payable' };
  return { due: parsed.part === 'host' ? m.hostAmount : m.guestAmount, apply: () => applyPart(tx, m, parsed.part, { via: 'bank', note }) };
}

/**
 * Một giao dịch tiền vào: { txId, content, amount, account }. Trả { event, duplicate }.
 * Cùng txId gọi lại thì không ghi gì thêm (duplicate = true, event = dòng đã lưu).
 */
async function report({ txId, content, amount, account }) {
  const id = String(txId ?? '').trim().slice(0, 64);
  if (!id) throw badRequest('Thiếu mã giao dịch');
  const sum = Number(amount);
  if (!Number.isInteger(sum) || sum <= 0) throw badRequest('Số tiền không hợp lệ');
  const text = String(content ?? '').slice(0, 300);
  const acc = String(account ?? '').trim().slice(0, 30);

  return withTransaction(async (tx) => {
    const now = clock.now();
    let rowId;
    try {
      const r = await tx.query(
        "INSERT INTO bank_transactions (provider_tx_id, account_number, content, amount, status, reason, received_at) VALUES (?, ?, ?, ?, 'unmatched', 'no_code', ?)",
        [id, acc || null, text, sum, now],
      );
      rowId = r.insertId;
    } catch (err) {
      if (!isDuplicate(err, 'uq_banktx_provider')) throw err;
      return { event: dto(await tx.one('SELECT * FROM bank_transactions WHERE provider_tx_id = ?', [id])), duplicate: true };
    }

    const codes = parseCodes(text);
    const parsed = codes.length === 1 ? codes[0] : null;
    // Tìm sân theo tài khoản trước; đơn chỉ được tự nhận khi thuộc đúng các sân dùng tài khoản đó.
    const venues = acc ? await tx.query('SELECT id, owner_id FROM venues WHERE bank_account = ?', [acc]) : [];
    const note = `Ngân hàng báo đã nhận ${money(sum)}, nội dung "${text}", mã giao dịch ${id}`;
    let b = null;
    let inAccount = false;
    let reason = null;
    let target = null;
    if (codes.length > 1) reason = 'multiple_codes';
    else if (!parsed) reason = 'no_code';
    else {
      b = await tx.one('SELECT b.id, b.code, b.user_id, b.venue_id, v.owner_id FROM bookings b JOIN venues v ON v.id = b.venue_id WHERE b.code = ?', [parsed.code]);
      if (!b) reason = 'unknown_order';
      else if (!acc) reason = 'no_account';
      else if (!venues.some((v) => v.id === b.venueId)) reason = 'wrong_account';
      else {
        inAccount = true;
        target = await lockTarget(tx, parsed, b, note);
        reason = target.reason || null;
        if (!reason && sum !== target.due) reason = sum < target.due ? 'short' : 'over';
      }
    }
    if (!reason) await target.apply();

    // Chủ nhận khoản: chủ của đơn khi đơn thuộc tài khoản; không thì chủ duy nhất của các sân dùng tài khoản; không phân định được thì để trống.
    const owners = [...new Set(venues.map((v) => v.ownerId))];
    const ownerId = inAccount ? b.ownerId : owners.length === 1 ? owners[0] : null;
    const venueId = inAccount ? b.venueId : venues.length === 1 ? venues[0].id : null;
    const expected = inAccount ? target.due ?? null : null; // chỉ có khi tìm được khoản đang chờ tiền
    const status = reason ? 'unmatched' : 'matched';
    await tx.query(
      'UPDATE bank_transactions SET owner_id = ?, venue_id = ?, booking_id = ?, booking_code = ?, expected = ?, status = ?, reason = ? WHERE id = ?',
      [ownerId, venueId, inAccount ? b.id : null, parsed?.code ?? null, expected, status, reason, rowId],
    );

    if (!reason) {
      await notify(tx, ownerId, `Ngân hàng báo đã nhận ${money(sum)} cho đơn ${b.code}. Hệ thống đã tự ghi nhận "Đã nhận tiền".`, { bookingId: b.id, link: '/owner-bookings.html' });
    } else {
      if (inAccount) {
        await addHistory(tx, b.id, 'bank_unmatched', {
          actor: BANK_ACTOR,
          note: `Ngân hàng báo ${money(sum)}, nội dung "${text}" nhưng chưa tự ghi nhận: ${REASON_TEXT[reason]}${expected ? ` (cần ${money(expected)})` : ''}`,
        });
      }
      await notify(tx, ownerId, `Ngân hàng báo ${money(sum)}, nội dung "${text}" nhưng chưa tự ghi nhận được: ${REASON_TEXT[reason].toLowerCase()}. Cần bạn xem và xử lý.`, { bookingId: inAccount ? b.id : null, link: '/owner.html' });
      if (inAccount && ['short', 'over'].includes(reason)) {
        await notify(tx, b.userId, `Ngân hàng báo đã nhận ${money(sum)} cho ${b.code}, chưa khớp số cần chuyển (${money(expected)}). Chủ sân sẽ xem và liên hệ bạn.`, { bookingId: b.id, link: `/booking.html?id=${b.id}` });
      }
    }
    return { event: dto(await tx.one('SELECT * FROM bank_transactions WHERE id = ?', [rowId])), duplicate: false };
  });
}

/** Khoản ngân hàng báo về tài khoản sân của chủ sân, mới nhất trước. */
async function listForOwner(user) {
  const rows = await db.query('SELECT * FROM bank_transactions WHERE owner_id = ? ORDER BY received_at DESC, id DESC LIMIT ?', [user.id, LIST_LIMIT]);
  return rows.map(dto);
}

async function resolve(user, rawId, note) {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id < 1) throw notFound('Không tìm thấy khoản tiền này');
  const text = typeof note === 'string' ? note.slice(0, 300) : '';
  return withTransaction(async (tx) => {
    const e = await tx.one('SELECT * FROM bank_transactions WHERE id = ? FOR UPDATE', [id]);
    if (!e || e.ownerId !== user.id) throw notFound('Không tìm thấy khoản tiền này');
    if (e.status !== 'unmatched') throw conflict('Khoản tiền này không cần xử lý');
    const now = clock.now();
    await tx.query("UPDATE bank_transactions SET status = 'resolved', handled_by = ?, handled_at = ? WHERE id = ?", [user.fullName, now, id]);
    if (e.bookingId) {
      await addHistory(tx, e.bookingId, 'bank_resolved', {
        actor: { id: user.id, role: user.role },
        note: `Đã xử lý khoản ${money(e.amount)} ngân hàng báo (${REASON_TEXT[e.reason].toLowerCase()})${text ? `. ${text}` : ''}`,
      });
    }
    return dto(await tx.one('SELECT * FROM bank_transactions WHERE id = ?', [id]));
  });
}

module.exports = { report, listForOwner, resolve, parseCodes, REASON_TEXT };
