// Thẻ việc cần xử lý của chủ sân: pass sân và ghép kèo của sân mình. Dùng ở "Hôm nay" và ở danh sách lịch đặt.
import { esc, money, dayLabel, api, dm, dialog, guard, toast, reliabilityHtml, hhmm as hm } from './common.js';

const TR_NOTE = { open: 'Đang pass, chưa có đội nhận', claimed: 'Đội nhận đang chuyển khoản cho bạn', completed: 'Sân đã sang đội nhận, bạn cần chuyển lại tiền cho đội pass' };

export function transferRow(t) {
  const claimed = t.status === 'claimed';
  return `<li class="tr-row" data-transfer="${t.id}">
    <div><b>${hm(t.startAt)}–${hm(t.endAt)} · ${esc(dayLabel(t.startAt.slice(0, 10)))}</b> · ${esc(t.courtName)} · <span class="code">${esc(t.bookingCode)}</span></div>
    <div class="muted">Đội pass: ${esc(t.giverName)} · giá pass <b class="num">${money(t.askPrice)}</b>${t.askPrice < t.originalPrice ? ` (đội pass đã trả ${money(t.originalPrice)})` : ''}</div>
    ${t.claimerName ? `<div>Đội nhận: <b>${esc(t.claimerName)}</b> <a class="phone" href="tel:${esc(t.claimerPhone)}">${esc(t.claimerPhone)}</a> ${reliabilityHtml(t.claimerReliability)}</div>` : ''}
    <div class="tr-state"><span class="badge badge-${claimed ? 'pending' : t.status === 'completed' ? 'confirmed' : 'transferred'}">${esc(TR_NOTE[t.status])}</span>${claimed ? `<span class="countdown-sm" data-expires="${esc(t.claimExpiresAt)}">Còn --:--</span>` : ''}</div>
    ${claimed ? `<p class="muted">Chỉ bấm khi tiền đã vào tài khoản của bạn. Nội dung chuyển khoản: <b>${esc(t.paymentContent)}</b>. Bấm xong, sân sang đội nhận ngay; bạn cần chuyển lại tiền cho đội pass.</p>
    <div class="row-actions"><button class="btn btn-lime btn-sm" type="button" data-tr-confirm="${t.id}">Đã nhận ${money(t.askPrice)}</button><button class="btn btn-danger btn-sm" type="button" data-tr-reject="${t.id}">Từ chối đội nhận</button></div>` : ''}
    ${t.status === 'completed' ? `<div class="row-actions"><button class="btn btn-lime btn-sm" type="button" data-act="refund" data-id="${t.bookingId}">Đã chuyển lại ${money(t.refund?.amount ?? t.askPrice)} cho đội pass</button></div>` : ''}
  </li>`;
}

const MT_NOTE = { open: 'Cần thêm một đội', joined: 'Đội vào kèo đang chuyển khoản', expired: 'Quá hạn, kèo không thành', cancelled: 'Đã hủy', confirmed: 'Đã chốt sân' };

const winnerOf = (m, w) => (w === 'host' ? `đội mở kèo (${m.hostName}) thắng` : w === 'guest' ? `đội vào kèo (${m.guestName}) thắng` : w === 'draw' ? 'hòa' : 'chưa báo');
const stakeWord = (p) => (p >= 100 ? 'thua bao sân' : `${p / 10}-${10 - p / 10}`);

function resultRow(m) {
  const r = m.result;
  if (!r) return '';
  if (r.status === 'settled') return `<div>Kết quả: <b>${esc(winnerOf(m, r.winner))}</b>${r.settledBy === 'owner' ? ' · bạn đã chốt' : ' · hai đội khớp nhau'}${r.topUp ? ` · đội thua trả thêm <b class="num">${money(r.topUp.amount)}</b> cho đội thắng: <b>${r.topUp.status === 'received' ? 'Đã nhận' : 'Chưa trả'}</b>` : ''}</div>`;
  return `<div>Kết quả ${stakeWord(m.loserPercent)}: đội mở kèo báo <b>${esc(winnerOf(m, r.hostReport))}</b>; đội vào kèo báo <b>${esc(winnerOf(m, r.guestReport))}</b>. ${r.status === 'needs_owner' ? 'Hai đội chưa khớp nhau hoặc quá hạn, bạn chốt kết quả.' : `Chờ hai đội báo trước ${hm(r.reportBy)} ${dm(r.reportBy)}.`}</div>`;
}

export function matchRow(m) {
  const hostBtn = m.status === 'open' && !m.hostPaid && m.hostPayBy
    ? `<button class="btn btn-lime btn-sm" type="button" data-mt-confirm="${m.id}" data-part="host">Đã nhận ${money(m.hostAmount)} từ đội mở kèo</button>` : '';
  const guestBtn = m.status === 'joined'
    ? `<button class="btn btn-lime btn-sm" type="button" data-mt-confirm="${m.id}" data-part="guest">Đã nhận ${money(m.guestAmount)} từ đội vào kèo</button><button class="btn btn-danger btn-sm" type="button" data-mt-reject="${m.id}">Từ chối đội vào kèo</button>` : '';
  const settleBtn = m.result?.status === 'needs_owner' ? `<button class="btn btn-lime btn-sm" type="button" data-mt-settle="${m.id}">Chốt kết quả</button>` : '';
  const cancelBtn = ['open', 'joined'].includes(m.status) ? `<button class="btn btn-sm" type="button" data-mt-cancel="${m.id}">Hủy kèo</button>` : '';
  const refunds = (m.refunds || []).map((r) => `<div class="mt-refund"><span>Chuyển lại cho ${r.part === 'host' ? 'đội mở kèo' : 'đội vào kèo'} (${esc(r.name)}): <b class="num">${money(r.amount)}</b> · <b>${r.status === 'done' ? 'Đã chuyển lại' : 'Chưa chuyển lại'}</b></span>${r.status === 'pending' ? `<button class="btn btn-lime btn-sm" type="button" data-mt-refund="${m.id}" data-part="${r.part}">Đã chuyển lại ${money(r.amount)}</button>` : ''}</div>`).join('');
  return `<li class="tr-row" data-match="${m.id}">
    <div><b>${hm(m.startAt)}–${hm(m.endAt)} · ${esc(dayLabel(m.startAt.slice(0, 10)))}</b> · ${esc(m.courtName)} · <span class="code">${esc(m.bookingCode)}</span> · giá sân <b class="num">${money(m.price)}</b> · kèo <b>${stakeWord(m.loserPercent)}</b></div>
    <div>Đội mở kèo: <b>${esc(m.hostName)}</b> <a class="phone" href="tel:${esc(m.hostPhone)}">${esc(m.hostPhone)}</a> ${reliabilityHtml(m.hostReliability)} · phần <b class="num">${money(m.hostAmount)}</b> · ${m.hostPaid ? '<b>đã nhận</b>' : `chưa nhận, nội dung <b>${esc(m.hostContent)}</b>`}</div>
    ${m.guestName ? `<div>Đội vào kèo: <b>${esc(m.guestName)}</b> <a class="phone" href="tel:${esc(m.guestPhone)}">${esc(m.guestPhone)}</a> ${reliabilityHtml(m.guestReliability)} · phần <b class="num">${money(m.guestAmount)}</b> · ${m.guestPaid ? '<b>đã nhận</b>' : `chưa nhận, nội dung <b>${esc(m.guestContent)}</b>`}</div>` : `<div class="muted">Chưa có đội vào kèo · phần <span class="num">${money(m.guestAmount)}</span></div>`}
    <div class="tr-state"><span class="badge badge-${m.status === 'joined' ? 'pending' : m.status === 'open' ? 'matching' : 'expired'}">${esc(MT_NOTE[m.status])}</span><span class="muted">Hạn tìm đội ${hm(m.closesAt)} ${dm(m.closesAt)}</span>${m.status === 'joined' ? `<span class="countdown-sm" data-expires="${esc(m.guestHoldUntil)}">Còn --:--</span>` : ''}${m.status === 'open' && !m.hostPaid && m.hostPayBy ? `<span class="countdown-sm" data-expires="${esc(m.hostPayBy)}">Còn --:--</span>` : ''}</div>
    ${resultRow(m)}
    <p class="muted">Bấm “Đã nhận” cho từng đội, chỉ sau khi tiền đã vào tài khoản của bạn. Đủ tiền hai đội thì sân được chốt. Hết hạn mà thiếu đội thì sân mở lại và bạn chuyển lại tiền cho đội đã trả.</p>
    <div class="row-actions">${hostBtn}${guestBtn}${settleBtn}${cancelBtn}</div>
    ${refunds}
  </li>`;
}

// Thẻ có nút hành động thì mới là "việc cần làm"; thẻ chỉ để xem (đang pass chưa ai nhận, đang tìm đội) không đưa vào "Hôm nay".
export const transferNeedsAction = (t) => t.status === 'claimed' || t.status === 'completed';
export const matchNeedsAction = (m) =>
  (m.status === 'open' && !m.hostPaid && !!m.hostPayBy) || m.status === 'joined' || m.result?.status === 'needs_owner' || (m.refunds || []).some((r) => r.status === 'pending');

// Gắn một lần cho vùng chứa. getMatches()/getTransfers() trả danh sách hiện tại; reload() tải lại sau khi ghi.
export function wireTasks(root, getMatches, getTransfers, reload) {
  root.addEventListener('click', (e) => {
  const mc = e.target.closest('[data-mt-confirm]');
  const mr = e.target.closest('[data-mt-reject]');
  const mx = e.target.closest('[data-mt-cancel]');
  const mf = e.target.closest('[data-mt-refund]');
  const ms = e.target.closest('[data-mt-settle]');
  const mb = mc || mr || mx || mf || ms;
  if (mb) {
    const m = getMatches().find((x) => x.id === Number(mb.dataset.mtConfirm || mb.dataset.mtReject || mb.dataset.mtCancel || mb.dataset.mtRefund || mb.dataset.mtSettle));
    guard(mb, async () => {
      const ref = `<p class="dlg-ref"><b>${esc(m.courtName)}</b> · ${hm(m.startAt)}–${hm(m.endAt)} ${dm(m.startAt)} · ${esc(m.bookingCode)}</p>`;
      const reasonField = '<div class="field"><label for="f-note">Lý do</label><textarea class="textarea" id="f-note" name="note" rows="3" required data-label="lý do"></textarea></div>';
      if (ms) {
        const r = await dialog({
          title: 'Chốt kết quả kèo',
          confirm: 'Chốt kết quả',
          body: `${ref}<p>Đội mở kèo báo: <b>${esc(winnerOf(m, m.result.hostReport))}</b>. Đội vào kèo báo: <b>${esc(winnerOf(m, m.result.guestReport))}</b>.</p>
            <fieldset class="field"><legend>Kết quả bạn chốt</legend>
              <label><input type="radio" name="winner" value="host" required data-label="kết quả"> Đội mở kèo thắng</label>
              <label><input type="radio" name="winner" value="guest"> Đội vào kèo thắng</label>
              <label><input type="radio" name="winner" value="draw"> Hòa, không ai trả thêm</label></fieldset>
            <p class="muted">Đội thua sẽ chuyển phần chênh thẳng cho đội thắng. SânNhanh không giữ tiền.</p>`,
        });
        if (!r) return;
        if (!r.winner) throw new Error('Chọn kết quả');
        await api.owner.settleMatchResult(m.id, r.winner);
        toast('Đã chốt kết quả');
      } else if (mc || mf) {
        const part = mb.dataset.part;
        const amount = mf ? m.refunds.find((r) => r.part === part).amount : part === 'host' ? m.hostAmount : m.guestAmount;
        const who = part === 'host' ? 'đội mở kèo' : 'đội vào kèo';
        const r = await dialog(mf
          ? { title: 'Ghi nhận đã trả lại tiền', confirm: `Đã chuyển lại ${money(amount)}`, body: `${ref}<p>Chuyển lại <b>${money(amount)}</b> cho ${who} bằng chuyển khoản, rồi bấm ghi nhận ở đây.</p>` }
          : { title: `Đã nhận tiền của ${who}?`, confirm: `Đã nhận ${money(amount)}`, body: `${ref}<p>Chỉ bấm khi ${money(amount)} đã vào tài khoản của bạn. Đây mới là phần của ${who}; sân chốt khi bạn nhận đủ tiền của cả hai đội.</p>` });
        if (!r) return;
        if (mf) await api.owner.refundMatch(m.id, part, '');
        else await api.owner.confirmMatchPart(m.id, part, '');
        toast(mf ? 'Đã ghi nhận chuyển lại tiền' : 'Đã ghi nhận đã nhận tiền');
      } else {
        const r = await dialog({
          title: mr ? 'Từ chối đội vào kèo' : 'Hủy kèo',
          confirm: mr ? 'Từ chối' : 'Hủy kèo',
          danger: true,
          body: `${ref}<p>${mr ? 'Kèo mở lại cho đội khác. Lý do được gửi cho đội vào kèo.' : 'Giờ mở lại cho khách khác. Bạn cần chuyển lại tiền cho các đội đã trả.'}</p>${reasonField}`,
        });
        if (!r) return;
        if (mr) await api.owner.rejectMatchGuest(m.id, r.note.trim());
        else await api.owner.cancelMatch(m.id, r.note.trim());
        toast(mr ? 'Đã từ chối đội vào kèo' : 'Đã hủy kèo');
      }
      await reload();
    });
    return;
  }
  const ok = e.target.closest('[data-tr-confirm]');
  const no = e.target.closest('[data-tr-reject]');
  if (ok || no) {
    const t = getTransfers().find((x) => x.id === Number((ok || no).dataset.trConfirm || (ok || no).dataset.trReject));
    guard(ok || no, async () => {
      const who = `<p class="dlg-ref"><b>${esc(t.claimerName)}</b> nhận ${esc(t.courtName)} · ${hm(t.startAt)}–${hm(t.endAt)} · ${esc(t.bookingCode)}</p>`;
      if (ok) {
        const r = await dialog({
          title: 'Đã nhận tiền?',
          confirm: `Đã nhận ${money(t.askPrice)}`,
          body: `${who}<p>Chỉ bấm khi ${money(t.askPrice)} đã vào tài khoản của bạn. Sân sẽ sang đội nhận ngay. Bạn vẫn cần chuyển lại tiền cho đội pass.</p>`,
        });
        if (!r) return;
        await api.owner.confirmTransfer(t.id, '');
        toast('Sân đã sang đội nhận. Bạn cần chuyển lại tiền cho đội pass.');
      } else {
        const r = await dialog({
          title: 'Từ chối đội nhận',
          confirm: 'Từ chối',
          danger: true,
          body: `${who}<p>Đăng pass được mở lại cho đội khác nếu còn hạn. Lý do được gửi cho đội nhận.</p><div class="field"><label for="f-note">Lý do</label><textarea class="textarea" id="f-note" name="note" rows="3" required data-label="lý do"></textarea></div>`,
        });
        if (!r) return;
        await api.owner.rejectTransfer(t.id, r.note.trim());
        toast('Đã từ chối đội nhận');
      }
      await reload();
    });
    return;
  }
  });
}
