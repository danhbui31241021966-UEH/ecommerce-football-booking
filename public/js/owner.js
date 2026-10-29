import {
  initPage, api, qs, qsa, esc, money, todayStr, weekday, fmtDate, fmtSlot, statusBadge, paymentBadge, refundLabel,
  showBookingDetail, askText, toast, STATUS_LABEL,
} from './common.js';

await initPage({ roles: ['owner'] });

let venues = [];
let venueId = Number(localStorage.getItem('owner.venueId')) || null;
let tab = 'schedule';
let scheduleDate = todayStr();
const bookingFilter = { status: '', date: '', q: '' };

const venue = () => venues.find((v) => v.id === venueId);

qsa('#tabs .tab').forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
qs('#venue-select').addEventListener('change', (e) => {
  venueId = Number(e.target.value);
  localStorage.setItem('owner.venueId', venueId);
  renderTab();
});
qs('#new-venue').addEventListener('click', () => {
  switchTab('settings');
  renderSettings(null);
});

function switchTab(name) {
  tab = name;
  qsa('#tabs .tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  for (const t of ['schedule', 'bookings', 'settings']) qs(`#tab-${t}`).classList.toggle('hidden', t !== name);
  renderTab();
}

async function loadVenues() {
  venues = await api('/owner/venues');
  if (!venue()) venueId = venues[0]?.id ?? null;
  qs('#venue-select').innerHTML = venues.map((v) =>
    `<option value="${v.id}" ${v.id === venueId ? 'selected' : ''}>${esc(v.name)}${v.is_active ? '' : ' (tạm ngưng)'}</option>`).join('');
  qs('#venue-select').classList.toggle('hidden', !venues.length);
}

function renderTab() {
  if (!venues.length && tab !== 'settings') {
    switchTab('settings');
    return;
  }
  if (tab === 'schedule') renderSchedule();
  if (tab === 'bookings') renderBookings();
  if (tab === 'settings') renderSettings(venue() || null);
}

// Nhắc booking chờ duyệt vì chỉ có vài phút trước khi tự hết hạn.
async function checkPending() {
  try {
    const pending = await api('/owner/bookings?status=pending');
    const box = qs('#pending-alert');
    box.classList.toggle('hidden', !pending.length);
    box.innerHTML = pending.length
      ? `⏳ Có <strong>${pending.length}</strong> booking đang chờ duyệt (${[...new Set(pending.map((b) => esc(b.venue_name)))].join(', ')}).
         <a href="#" id="see-pending">Xem ngay</a>`
      : '';
    qs('#see-pending')?.addEventListener('click', (e) => {
      e.preventDefault();
      // Danh sách booking lọc theo sân đang chọn, nên chuyển sang sân có booking chờ duyệt.
      venueId = pending[0].venue_id;
      qs('#venue-select').value = venueId;
      localStorage.setItem('owner.venueId', venueId);
      Object.assign(bookingFilter, { status: 'pending', date: '', q: '' });
      switchTab('bookings');
    });
  } catch { /* bỏ qua lỗi mạng tạm thời */ }
}

// ---------- Lịch theo ngày ----------

const CELL_TEXT = { available: 'Trống', past: 'Đã qua' };

async function renderSchedule() {
  const el = qs('#tab-schedule');
  el.innerHTML = `
    <div class="row space-between">
      <div class="row">
        <button class="btn btn-outline btn-sm" id="prev-day">←</button>
        <input type="date" id="schedule-date" value="${scheduleDate}" style="width:auto">
        <button class="btn btn-outline btn-sm" id="next-day">→</button>
        <span class="muted">${weekday(scheduleDate)}, ${fmtDate(scheduleDate)}</span>
      </div>
      <div class="legend"><span class="l-available">Trống (bấm để chặn)</span><span class="l-held">Chờ duyệt</span>
        <span class="l-booked">Đã xác nhận</span><span class="l-blocked">Đã chặn (bấm để mở)</span></div>
    </div>
    <div id="owner-schedule" style="margin-top:12px"><p class="muted">Đang tải…</p></div>`;
  const shift = (days) => {
    const d = new Date(`${scheduleDate}T00:00:00`);
    d.setDate(d.getDate() + days);
    scheduleDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    renderSchedule();
  };
  qs('#prev-day').addEventListener('click', () => shift(-1));
  qs('#next-day').addEventListener('click', () => shift(1));
  qs('#schedule-date').addEventListener('change', (e) => { scheduleDate = e.target.value || todayStr(); renderSchedule(); });

  try {
    const s = await api(`/owner/venues/${venueId}/schedule?date=${scheduleDate}`);
    const box = qs('#owner-schedule');
    box.innerHTML = s.courts.map((court) => `
      <div class="card court-block">
        <strong>${esc(court.name)}</strong> <span class="muted small">· Sân ${esc(court.fieldType)}</span>
        <div class="slot-grid">${court.slots.map((slot) => {
          const detail = slot.booking
            ? `${esc(slot.booking.customerName)}<br>${esc(slot.booking.code)}`
            : slot.block ? esc(slot.block.reason) : `${CELL_TEXT[slot.status] || ''} · ${money(slot.price)}`;
          const clickable = slot.booking || slot.block || slot.status === 'available';
          return `<button class="slot owner-view ${slot.status}${slot.peak ? ' peak' : ''}" ${clickable ? '' : 'disabled'}
            data-court="${court.id}" data-start="${slot.start}" data-status="${slot.status}"
            data-booking="${slot.booking?.id ?? ''}" data-block="${slot.block?.id ?? ''}">
            <strong>${slot.start}–${slot.end}</strong><span class="small">${detail}</span></button>`;
        }).join('')}</div>
      </div>`).join('') || '<p class="empty">Chưa có sân con hoạt động. Thêm sân con trong tab Cấu hình sân.</p>';
    qsa('.slot', box).forEach((btn) => btn.addEventListener('click', () => onSlotClick(btn.dataset)));
  } catch (err) {
    qs('#owner-schedule').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

async function onSlotClick(d) {
  try {
    if (d.booking) return showBookingDetail(d.booking, () => { renderSchedule(); checkPending(); });
    if (d.block) {
      if (!confirm('Mở lại khung giờ này cho khách đặt?')) return;
      await api(`/owner/blocks/${d.block}`, { method: 'DELETE' });
    } else if (d.status === 'available') {
      const reason = await askText(`Chặn ${d.start} ngày ${fmtDate(scheduleDate)}`, {
        label: 'Lý do chặn', placeholder: 'VD: khách đặt qua điện thoại, bảo trì sân…',
      });
      if (!reason) return;
      await api('/owner/blocks', { method: 'POST', body: { courtId: Number(d.court), date: scheduleDate, start: d.start, reason } });
    }
    toast('Đã cập nhật lịch', 'success');
    renderSchedule();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------- Booking ----------

async function renderBookings() {
  const el = qs('#tab-bookings');
  el.innerHTML = `
    <form class="row" id="booking-filter">
      <select name="status" style="width:auto"><option value="">Mọi trạng thái</option>
        ${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${bookingFilter.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <input type="date" name="date" value="${bookingFilter.date}" style="width:auto">
      <input name="q" placeholder="Mã, tên, SĐT khách" value="${esc(bookingFilter.q)}" style="width:auto">
      <button class="btn btn-sm" type="submit">Lọc</button>
    </form>
    <div class="card table-wrap" style="margin-top:12px;padding:0"><table>
      <thead><tr><th>Mã</th><th>Khách</th><th>Sân con / giờ</th><th>Giá</th><th>Trạng thái</th><th>Thanh toán</th><th></th></tr></thead>
      <tbody id="booking-rows"><tr><td colspan="7" class="muted">Đang tải…</td></tr></tbody></table></div>`;
  qs('#booking-filter').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    Object.assign(bookingFilter, { status: f.get('status'), date: f.get('date'), q: f.get('q').trim() });
    renderBookings();
  });

  const query = new URLSearchParams({ venueId, ...bookingFilter });
  for (const [k, v] of [...query]) if (!v) query.delete(k);
  try {
    const rows = await api(`/owner/bookings?${query}`);
    qs('#booking-rows').innerHTML = rows.map((b) => `
      <tr>
        <td><strong>${esc(b.code)}</strong></td>
        <td>${esc(b.customer_name)}<div class="muted small">${esc(b.customer_phone)}</div></td>
        <td>${esc(b.court_name)}<div class="muted small">${fmtSlot(b)}</div></td>
        <td>${money(b.price)}</td>
        <td>${statusBadge(b.status)}</td>
        <td>${paymentBadge(b.payment_status)}${b.refund_status !== 'none' ? `<div class="small">${esc(refundLabel(b))}</div>` : ''}</td>
        <td class="row">${b.status === 'pending' ? `<button class="btn btn-sm" data-approve="${b.id}">Duyệt</button>` : ''}
          <button class="btn btn-outline btn-sm" data-id="${b.id}">Chi tiết</button></td>
      </tr>`).join('') || '<tr><td colspan="7" class="empty">Không có booking phù hợp.</td></tr>';
    qsa('[data-id]', el).forEach((btn) => btn.addEventListener('click', () =>
      showBookingDetail(btn.dataset.id, () => { renderBookings(); checkPending(); })));
    qsa('[data-approve]', el).forEach((btn) => btn.addEventListener('click', async () => {
      try {
        await api(`/owner/bookings/${btn.dataset.approve}/approve`, { method: 'POST' });
        toast('Đã duyệt booking', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
      renderBookings();
      checkPending();
    }));
  } catch (err) {
    qs('#booking-rows').innerHTML = `<tr><td colspan="7"><div class="alert alert-error">${esc(err.message)}</div></td></tr>`;
  }
}

// ---------- Cấu hình sân & sân con ----------

const t5 = (t) => (t ? t.slice(0, 5) : '');

function renderSettings(v) {
  const el = qs('#tab-settings');
  const isNew = !v;
  el.innerHTML = `
    <form class="card" id="venue-form">
      <h2>${isNew ? 'Thêm cụm sân mới' : 'Thông tin cụm sân'}</h2>
      <p class="muted small">Thay đổi giá, khung giờ và điều kiện chỉ áp dụng cho booking mới; booking đã tạo giữ nguyên giá/điều kiện lúc đặt.</p>
      <div class="form-grid">
        <div><label>Tên sân *</label><input name="name" required value="${esc(v?.name)}"></div>
        <div><label>Quận/Huyện *</label><input name="district" required value="${esc(v?.district)}" placeholder="VD: Tân Bình"></div>
        <div class="full"><label>Địa chỉ *</label><input name="address" required value="${esc(v?.address)}"></div>
        <div><label>SĐT sân *</label><input name="phone" required value="${esc(v?.phone)}"></div>
        <div><label>Ảnh (URL https hoặc /img/…)</label><input name="imageUrl" value="${esc(v?.image_url || '/img/pitch-1.svg')}"></div>
        <div><label>Giờ mở cửa *</label><input type="time" name="openTime" required value="${t5(v?.open_time) || '06:00'}"></div>
        <div><label>Giờ đóng cửa *</label><input type="time" name="closeTime" required value="${t5(v?.close_time) || '23:00'}"></div>
        <div><label>Độ dài slot (phút) *</label><input type="number" name="slotMinutes" min="30" max="180" step="15" required value="${v?.slot_minutes || 60}"></div>
        <div><label>Giờ vàng từ</label><input type="time" name="peakStart" value="${t5(v?.peak_start)}"></div>
        <div><label>Giờ vàng đến</label><input type="time" name="peakEnd" value="${t5(v?.peak_end)}"></div>
        <div class="full"><label>Tiện ích (phân cách bằng dấu phẩy)</label><input name="amenities" value="${esc(v?.amenities)}" placeholder="Bãi giữ xe, Nước uống, Phòng thay đồ"></div>
        <div class="full"><label>Mô tả</label><textarea name="description" rows="2">${esc(v?.description)}</textarea></div>
        <div class="full"><label>Điều kiện sử dụng</label><textarea name="rules" rows="2">${esc(v?.rules)}</textarea></div>
        <div class="full"><label>Hướng dẫn thanh toán</label><textarea name="paymentInfo" rows="2" placeholder="Số tài khoản, ngân hàng, nội dung chuyển khoản hoặc trả tại sân">${esc(v?.payment_info)}</textarea></div>
        <label class="checkbox full"><input type="checkbox" name="requiresApproval" ${v?.requires_approval ? 'checked' : ''}>
          Yêu cầu chủ sân duyệt từng booking (booking chờ duyệt chỉ giữ chỗ vài phút)</label>
        ${isNew ? '' : `<label class="checkbox full"><input type="checkbox" name="isActive" ${v.is_active ? 'checked' : ''}> Đang hoạt động (bỏ chọn để tạm ngưng nhận booking)</label>`}
      </div>
      <div class="row" style="margin-top:12px"><button class="btn" type="submit">${isNew ? 'Tạo cụm sân' : 'Lưu thay đổi'}</button>
        ${isNew && venues.length ? '<button class="btn btn-outline" type="button" id="cancel-new">Hủy</button>' : ''}</div>
    </form>
    ${isNew ? '' : `
    <div class="card" style="margin-top:16px">
      <h2>Sân con & giá</h2>
      <p class="muted small">Giá tính cho 1 slot. Sân con không xóa được để giữ lịch sử booking; bỏ chọn “Hoạt động” để ngừng nhận đặt.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Tên</th><th>Loại</th><th>Giá thường</th><th>Giá giờ vàng</th><th>Hoạt động</th><th></th></tr></thead>
        <tbody>${v.courts.map((c) => courtRow(c)).join('')}${courtRow(null)}</tbody>
      </table></div>
    </div>`}`;

  qs('#cancel-new')?.addEventListener('click', () => renderSettings(venue()));
  qs('#venue-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = Object.fromEntries(new FormData(f));
    body.requiresApproval = f.requiresApproval.checked;
    if (f.isActive) body.isActive = f.isActive.checked;
    try {
      if (isNew) {
        const { id } = await api('/owner/venues', { method: 'POST', body });
        venueId = id;
        localStorage.setItem('owner.venueId', id);
        toast('Đã tạo cụm sân. Hãy thêm sân con.', 'success');
      } else {
        await api(`/owner/venues/${v.id}`, { method: 'PUT', body });
        toast('Đã lưu', 'success');
      }
      await loadVenues();
      renderSettings(venue());
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  qsa('[data-court-row]', el).forEach((row) => qs('button', row).addEventListener('click', async () => {
    const get = (n) => qs(`[name=${n}]`, row);
    const body = {
      name: get('name').value, fieldType: get('fieldType').value,
      price: Number(get('price').value), peakPrice: Number(get('peakPrice').value || get('price').value),
      isActive: get('isActive').checked,
    };
    const id = row.dataset.courtRow;
    try {
      if (id) await api(`/owner/courts/${id}`, { method: 'PUT', body });
      else await api(`/owner/venues/${v.id}/courts`, { method: 'POST', body });
      toast(id ? 'Đã lưu sân con' : 'Đã thêm sân con', 'success');
      await loadVenues();
      renderSettings(venue());
    } catch (err) {
      toast(err.message, 'error');
    }
  }));
}

function courtRow(c) {
  return `<tr data-court-row="${c?.id ?? ''}">
    <td><input name="name" value="${esc(c?.name)}" placeholder="${c ? '' : 'Tên sân con mới'}"></td>
    <td><select name="fieldType"><option value="5" ${c?.field_type === '5' ? 'selected' : ''}>Sân 5</option>
      <option value="7" ${c?.field_type === '7' ? 'selected' : ''}>Sân 7</option></select></td>
    <td><input type="number" name="price" min="10000" step="10000" value="${c?.price ?? ''}"></td>
    <td><input type="number" name="peakPrice" min="10000" step="10000" value="${c?.peak_price ?? ''}"></td>
    <td><input type="checkbox" name="isActive" ${!c || c.is_active ? 'checked' : ''}></td>
    <td><button class="btn btn-sm ${c ? 'btn-outline' : ''}" type="button">${c ? 'Lưu' : 'Thêm'}</button></td>
  </tr>`;
}

await loadVenues();
renderTab();
checkPending();
// Làm mới định kỳ (khi không mở dialog) để chủ sân thấy booking mới kịp duyệt.
setInterval(() => {
  checkPending();
  if (tab !== 'settings' && !qs('#app-dialog')?.open) renderTab();
}, 20_000);
