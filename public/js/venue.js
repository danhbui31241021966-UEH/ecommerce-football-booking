import {
  initPage, api, qs, qsa, esc, money, params, todayStr, weekday, fmtDate, toast, openDialog, closeDialog,
  currentUser, loginRedirect, statusBadge,
} from './common.js';

await initPage();
const root = qs('#venue-root');
const venueId = params().get('id');
let date = params().get('date') || todayStr();
let venue;

const SLOT_TEXT = { booked: 'Đã đặt', held: 'Đang giữ chỗ', blocked: 'Không khả dụng', past: 'Đã qua' };

try {
  venue = await api(`/venues/${encodeURIComponent(venueId)}`);
} catch (err) {
  root.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div><a href="/venues.html">← Quay lại tìm sân</a>`;
  throw err;
}
document.title = `${venue.name} – SânNhanh`;
if (date < todayStr() || date > todayStr(venue.bookingWindowDays)) date = todayStr();
renderVenue();
loadSchedule();

function renderVenue() {
  const peak = venue.peakStart ? `${venue.peakStart}–${venue.peakEnd}` : null;
  root.innerHTML = `
    <p class="small"><a href="/venues.html">← Tìm sân</a></p>
    <div class="venue-hero">
      <img src="${esc(venue.imageUrl)}" alt="${esc(venue.name)}">
      <div class="card">
        <h1>${esc(venue.name)}</h1>
        <ul class="info-list">
          <li>📍 ${esc(venue.address)}, ${esc(venue.district)}, TP.HCM · <a href="${esc(venue.mapsUrl)}" target="_blank" rel="noopener">Xem bản đồ</a></li>
          <li>📞 ${esc(venue.phone)}</li>
          <li>🕒 ${esc(venue.openTime)} – ${esc(venue.closeTime)} · mỗi slot ${venue.slotMinutes} phút</li>
          ${peak ? `<li>⭐ Giờ vàng: ${esc(peak)}</li>` : ''}
          <li>${venue.requiresApproval
            ? `⏳ Booking cần chủ sân duyệt (giữ chỗ tối đa ${venue.holdMinutes} phút)`
            : '✅ Booking hợp lệ được xác nhận ngay'}</li>
        </ul>
        <div style="margin-top:8px">${venue.amenities.map((a) => `<span class="tag">${esc(a)}</span>`).join('')}</div>
        ${venue.description ? `<p class="muted small">${esc(venue.description)}</p>` : ''}
      </div>
    </div>

    <div class="card" style="margin-top:20px">
      <h2>Bảng giá (theo slot)</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Sân con</th><th>Loại</th><th>Giờ thường</th>${peak ? `<th>Giờ vàng (${esc(peak)})</th>` : ''}</tr></thead>
        <tbody>${venue.courts.map((c) => `<tr><td>${esc(c.name)}</td><td>Sân ${esc(c.fieldType)}</td>
          <td>${money(c.price)}</td>${peak ? `<td>${money(c.peakPrice)}</td>` : ''}</tr>`).join('')}</tbody>
      </table></div>
    </div>

    <div class="card" style="margin-top:20px">
      <div class="row space-between"><h2 style="margin:0">Lịch trống</h2>
        <div class="legend"><span class="l-available">Còn trống</span><span class="l-peak">Giờ vàng</span>
          <span class="l-held">Đang giữ chỗ</span><span class="l-booked">Đã đặt</span><span class="l-blocked">Không khả dụng</span></div></div>
      <div class="date-chips" id="date-chips" style="margin-top:12px"></div>
      <div id="schedule" style="margin-top:12px"></div>
    </div>

    <div class="form-grid" style="margin-top:20px">
      <div class="card"><h3>Điều kiện sử dụng</h3><p class="small">${esc(venue.rules || 'Chưa cập nhật')}</p></div>
      <div class="card"><h3>Chính sách hủy</h3><p class="small">${esc(venue.cancelPolicy)}</p></div>
      <div class="card"><h3>Thanh toán</h3><p class="small">${esc(venue.paymentInfo || 'Liên hệ sân')}</p></div>
    </div>`;

  const chips = [];
  for (let i = 0; i <= venue.bookingWindowDays; i++) {
    const d = todayStr(i);
    chips.push(`<button class="date-chip${d === date ? ' active' : ''}" data-date="${d}">
      <div>${i === 0 ? 'Hôm nay' : weekday(d)}</div><strong>${d.slice(8, 10)}/${d.slice(5, 7)}</strong></button>`);
  }
  qs('#date-chips').innerHTML = chips.join('');
  qsa('.date-chip').forEach((btn) => btn.addEventListener('click', () => {
    date = btn.dataset.date;
    qsa('.date-chip').forEach((b) => b.classList.toggle('active', b === btn));
    history.replaceState(null, '', `?id=${venue.id}&date=${date}`);
    loadSchedule();
  }));
}

async function loadSchedule() {
  const box = qs('#schedule');
  box.innerHTML = '<p class="muted">Đang tải lịch…</p>';
  try {
    const schedule = await api(`/venues/${venue.id}/schedule?date=${date}`);
    if (!schedule.courts.length) {
      box.innerHTML = '<p class="empty">Sân chưa có sân con hoạt động.</p>';
      return;
    }
    box.innerHTML = schedule.courts.map((court) => `
      <div class="court-block">
        <strong>${esc(court.name)}</strong> <span class="muted small">· Sân ${esc(court.fieldType)} người</span>
        <div class="slot-grid">${court.slots.map((s) => `
          <button class="slot ${s.status}${s.peak ? ' peak' : ''}" ${s.status === 'available' ? '' : 'disabled'}
            data-court="${court.id}" data-court-name="${esc(court.name)}" data-type="${esc(court.fieldType)}"
            data-start="${s.start}" data-end="${s.end}" data-price="${s.price}">
            <strong>${s.start}–${s.end}</strong>
            ${s.status === 'available' ? `${money(s.price)}${s.peak ? ' ⭐' : ''}` : SLOT_TEXT[s.status]}
          </button>`).join('')}</div>
      </div>`).join('');
    qsa('.slot.available', box).forEach((btn) => btn.addEventListener('click', () => openBookingForm(btn.dataset)));
  } catch (err) {
    box.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

function openBookingForm(slot) {
  if (!currentUser) return loginRedirect();
  if (currentUser.role !== 'customer') {
    return toast('Chỉ tài khoản khách hàng mới đặt được sân', 'error');
  }
  // Một mã cho mỗi lần mở form: bấm gửi nhiều lần cũng chỉ tạo một booking.
  const idempotencyKey = crypto.randomUUID();
  const body = openDialog('Xác nhận đặt sân', `
    <dl class="kv">
      <dt>Sân</dt><dd>${esc(venue.name)}</dd>
      <dt>Sân con</dt><dd>${esc(slot.courtName)} (sân ${esc(slot.type)} người)</dd>
      <dt>Ngày</dt><dd>${weekday(date)}, ${fmtDate(date)}</dd>
      <dt>Khung giờ</dt><dd>${esc(slot.start)} – ${esc(slot.end)}</dd>
      <dt>Giá</dt><dd class="price">${money(slot.price)}</dd>
      <dt>Người đặt</dt><dd>${esc(currentUser.fullName)} · ${esc(currentUser.phone)}</dd>
    </dl>
    <div class="alert ${venue.requiresApproval ? 'alert-warn' : 'alert-info'}" style="margin-top:12px">
      ${venue.requiresApproval
        ? `Sân này cần chủ sân duyệt. Slot được giữ tối đa ${venue.holdMinutes} phút; quá thời gian chưa duyệt booking sẽ hết hạn.`
        : 'Booking sẽ được xác nhận ngay sau khi gửi.'}
      <br><strong>Thanh toán:</strong> ${esc(venue.paymentInfo || 'Liên hệ sân')}</div>
    <form id="booking-form" class="stack">
      <div><label for="note">Ghi chú cho chủ sân</label><textarea id="note" rows="2" maxlength="255" placeholder="VD: cần thêm áo bib"></textarea></div>
      <details><summary class="small">Điều kiện sử dụng & chính sách hủy</summary>
        <p class="small">${esc(venue.rules || '')}</p><p class="small">${esc(venue.cancelPolicy)}</p></details>
      <label class="checkbox"><input type="checkbox" id="agree" required>
        Tôi đồng ý với điều kiện sử dụng và chính sách hủy của sân.</label>
      <div id="booking-error" class="alert alert-error hidden"></div>
      <button class="btn btn-block" type="submit">Xác nhận đặt sân</button>
    </form>`);

  qs('#booking-form', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = qs('button[type=submit]', e.target);
    btn.disabled = true;
    btn.textContent = 'Đang gửi…';
    try {
      const b = await api('/bookings', {
        method: 'POST',
        body: {
          courtId: Number(slot.court), date, start: slot.start, idempotencyKey,
          note: qs('#note', body).value, agreeTerms: qs('#agree', body).checked,
        },
      });
      showResult(b);
      loadSchedule();
    } catch (err) {
      const box = qs('#booking-error', body);
      box.textContent = err.message;
      box.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Xác nhận đặt sân';
      if (err.status === 409) loadSchedule();
    }
  });
}

function showResult(b) {
  openDialog(b.status === 'pending' ? 'Đã gửi yêu cầu đặt sân' : 'Đặt sân thành công', `
    <p>Mã booking: <strong style="font-size:1.2rem">${esc(b.code)}</strong> ${statusBadge(b.status)}</p>
    ${b.status === 'pending'
      ? `<div class="alert alert-warn">Chủ sân cần duyệt trước ${esc(b.expires_at.slice(11, 16))}. Bạn sẽ nhận thông báo trên web khi có kết quả.</div>`
      : '<div class="alert alert-success">Slot đã được giữ cho bạn.</div>'}
    <p class="small"><strong>Thanh toán:</strong> ${esc(b.payment_info_snapshot || 'Liên hệ sân')}</p>
    <div class="row"><a class="btn" href="/my-bookings.html">Xem đơn của tôi</a>
      <button class="btn btn-outline" id="close-result">Đặt thêm</button></div>`);
  qs('#close-result').addEventListener('click', closeDialog);
}
