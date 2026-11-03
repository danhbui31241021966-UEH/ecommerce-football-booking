// Màn 11 – Cài đặt sân: thông tin, giờ, cao điểm, chế độ đồng ý, giảm giờ chót, ngân hàng, sân.
import { $, $$, esc, initPage, loadVenues, venueSelect, rememberVenue, errorBox, dialog, guard, toast, api } from './common.js';
import { hmToMin } from '/js/ui/format.js';

const content = $('#content');
let venues = [];
let venueId;
let meta;
let dirty = new Set();

const hours = Array.from({ length: 25 }, (_, i) => `${String(i).padStart(2, '0')}:00`);
const opts = (list, cur) => list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`).join('');
const hourOpts = (cur, from = 0) => opts(hours.slice(from).map((h) => [h, h]), cur);

const field = (label, input, { id, hint = '', full = false } = {}) =>
  `<div class="field ${full ? 'full' : ''}"><label for="${id}">${label}</label>${input}${hint ? `<span class="hint">${hint}</span>` : ''}<span class="err" hidden></span></div>`;

function courtRow(c) {
  return `<form class="court ${c.isActive ? '' : 'off'}" data-court="${c.id}" novalidate>
    ${field('Tên sân', `<input class="input" id="cn-${c.id}" name="name" value="${esc(c.name)}" required>`, { id: `cn-${c.id}` }).replace('class="field', 'class="field c-name')}
    ${field('Loại sân', `<select class="select" id="ct-${c.id}" name="fieldType">${opts([['5', 'Sân 5 người'], ['7', 'Sân 7 người']], c.fieldType)}</select>`, { id: `ct-${c.id}` })}
    ${field('Giá thường (đ/giờ)', `<input class="input" id="cp-${c.id}" name="price" type="number" inputmode="numeric" min="0" step="1000" value="${c.price}">`, { id: `cp-${c.id}` })}
    ${field('Giá cao điểm (đ/giờ)', `<input class="input" id="cpp-${c.id}" name="peakPrice" type="number" inputmode="numeric" min="0" step="1000" value="${c.peakPrice}">`, { id: `cpp-${c.id}` })}
    <div class="c-team">
      <label class="switch"><input type="checkbox" name="teamMode" ${c.teamMode ? 'checked' : ''}><span class="track"></span><span class="sw-text">Chỉ nhận ghép kèo</span></label>
      <label class="c-time">Từ <input class="input" type="time" name="teamFrom" value="${esc(c.teamMode?.from || '')}" aria-label="Chỉ nhận ghép kèo từ giờ"></label>
      <label class="c-time">đến <input class="input" type="time" name="teamTo" value="${esc(c.teamMode?.to || '')}" aria-label="Chỉ nhận ghép kèo đến giờ"></label>
      <span class="hint">Trong khung giờ này, sân chỉ nhận khi có đủ hai đội, mỗi đội chuyển khoản một phần. Để trống là áp dụng cả ngày. Ngoài khung giờ, khách đặt như bình thường.</span>
    </div>
    <div class="c-foot">
      <label class="switch"><input type="checkbox" name="isActive" ${c.isActive ? 'checked' : ''}><span class="track"></span><span class="sw-text">${c.isActive ? 'Đang mở đặt' : 'Tạm tắt'}</span></label>
      <button class="btn btn-sm btn-primary" type="submit">Lưu sân</button>
    </div>
  </form>`;
}

const openGroups = new Set();
const group = (key, title, summary, inner, { saveLabel = 'Lưu', formId = '' } = {}) => `
  <details class="panel set-group" data-key="${key}" ${openGroups.has(key) ? 'open' : ''}>
    <summary><h2 class="h2">${title}</h2><span class="sum">${esc(summary)}</span></summary>
    <form class="set-form" ${formId ? `id="${formId}"` : ''} data-group="${key}" novalidate>
      <div class="pbody">${inner}</div>
      <div class="group-foot"><span class="state" role="status">Chưa có thay đổi</span><button class="btn btn-primary" type="submit">${saveLabel}</button></div>
    </form>
  </details>`;

function render() {
  const v = venues.find((x) => x.id === venueId);
  const bank = v.bank || { bin: v.bankBin, account: v.bankAccount, accountName: v.bankAccountName };
  const bankName = meta.banks.find((b) => b.bin === bank.bin)?.name;
  content.innerHTML = `
  <div class="set-groups">
    ${group('info', 'Thông tin sân', `${v.name} · ${v.district}`, `<div class="fgrid">
        ${field('Tên sân', `<input class="input" id="name" name="name" value="${esc(v.name)}" required>`, { id: 'name', full: true })}
        ${field('Quận', `<input class="input" id="district" name="district" value="${esc(v.district)}" required>`, { id: 'district' })}
        ${field('Số điện thoại', `<input class="input" id="phone" name="phone" inputmode="tel" value="${esc(v.phone || '')}">`, { id: 'phone' })}
        ${field('Địa chỉ', `<input class="input" id="address" name="address" value="${esc(v.address)}" required>`, { id: 'address', full: true })}
        ${field('Tiện ích', `<input class="input" id="amenities" name="amenities" value="${esc((v.amenities || []).join(', '))}">`, { id: 'amenities', full: true, hint: 'Cách nhau bằng dấu phẩy: Bãi giữ xe, Nước uống, Phòng thay đồ' })}
        ${field('Giới thiệu', `<textarea class="textarea" id="description" name="description" rows="3">${esc(v.description || '')}</textarea>`, { id: 'description', full: true })}
      </div>`, { saveLabel: 'Lưu thông tin sân' })}
    ${group('hours', 'Giờ mở cửa và giá cao điểm', `${v.openTime}–${v.closeTime} · cao điểm ${v.peakStart}–${v.peakEnd}`, `<div class="fgrid">
          ${field('Giờ mở cửa', `<select class="select" id="openTime" name="openTime">${hourOpts(v.openTime, 0)}</select>`, { id: 'openTime' })}
          ${field('Giờ đóng cửa', `<select class="select" id="closeTime" name="closeTime">${hourOpts(v.closeTime, 1)}</select>`, { id: 'closeTime' })}
          ${field('Mỗi lượt đá dài', `<select class="select" id="slotMinutes" name="slotMinutes">${opts([[60, '60 phút'], [90, '90 phút'], [120, '120 phút']], v.slotMinutes)}</select>`, { id: 'slotMinutes', full: true, hint: 'Mỗi lượt đặt là một sân trong một lượt đá. Đổi độ dài không ảnh hưởng lịch đặt đã có.' })}
          ${field('Cao điểm từ', `<select class="select" id="peakStart" name="peakStart">${hourOpts(v.peakStart, 0)}</select>`, { id: 'peakStart' })}
          ${field('Cao điểm đến', `<select class="select" id="peakEnd" name="peakEnd">${hourOpts(v.peakEnd, 1)}</select>`, { id: 'peakEnd', hint: 'Giờ trong khung này tính giá cao điểm.' })}
        </div>`, { saveLabel: 'Lưu giờ mở cửa' })}
    ${group('mode', 'Cách nhận đặt sân', `${v.requiresApproval ? 'Bạn duyệt từng đơn' : 'Xác nhận ngay'} · giảm giờ chót ${v.lastMinutePercent}%`, `
          <fieldset class="mode-pick" style="border:0;padding:0;margin:0"><legend class="sr-only">Chế độ xác nhận</legend>
            <label><input type="radio" name="requiresApproval" value="0" ${v.requiresApproval ? '' : 'checked'}><b>Xác nhận ngay</b><span>Khách đặt được xác nhận ngay. Khách đã bùng hoặc hủy sát giờ ${meta.reliabilityMaxViolations} lần trong ${meta.reliabilityWindowDays} ngày thì vẫn phải chờ bạn đồng ý.</span></label>
            <label><input type="radio" name="requiresApproval" value="1" ${v.requiresApproval ? 'checked' : ''}><b>Chủ sân duyệt</b><span>Khách đặt xong, bạn có ${meta.holdMinutes} phút để đồng ý. Quá hạn thì giờ tự mở lại cho người khác.</span></label>
          </fieldset>
          ${field(`Giảm giá giờ chót (giờ sắp đá trong ${meta.lastMinuteHours} giờ tới)`, `<div class="input-suffix"><input class="input" id="lastMinutePercent" name="lastMinutePercent" type="number" inputmode="numeric" min="0" max="90" value="${v.lastMinutePercent}"><span>%</span></div>`, { id: 'lastMinutePercent', hint: 'Giờ còn trống sát giờ đá được giảm giá để dễ có khách. Để 0 là không giảm.' })}
        `, { saveLabel: 'Lưu cách nhận đặt' })}
    ${group('rules', 'Nội quy và chính sách hủy', v.rules ? 'Đã có nội quy' : 'Chưa có nội quy', `
        ${field('Nội quy sân', `<textarea class="textarea" id="rules" name="rules" rows="4">${esc(v.rules || '')}</textarea>`, { id: 'rules', hint: 'Khách thấy nội quy này khi đặt sân.' })}
        <div class="readonly-box"><b>Chính sách hủy (cố định theo hệ thống)</b><br>${esc(v.cancelPolicy || 'Hủy trước 24 giờ trả lại 100%, từ 12 đến dưới 24 giờ trả lại 50%, dưới 12 giờ không trả lại.')}</div>
      `, { saveLabel: 'Lưu nội quy' })}
    ${group('bank', 'Tài khoản nhận tiền (mã QR)', bank.account ? `${bankName || 'Ngân hàng'} · ${bank.account}` : 'Chưa nhập tài khoản', `<div class="fgrid">
        ${field('Ngân hàng', `<select class="select" id="bankBin" name="bankBin"><option value="">Chọn ngân hàng</option>${opts(meta.banks.map((b) => [b.bin, b.name]), bank.bin)}</select>`, { id: 'bankBin', full: true })}
        ${field('Số tài khoản', `<input class="input" id="bankAccount" name="bankAccount" inputmode="numeric" autocomplete="off" value="${esc(bank.account || '')}">`, { id: 'bankAccount' })}
        ${field('Tên chủ tài khoản', `<input class="input" id="bankAccountName" name="bankAccountName" autocomplete="off" value="${esc(bank.accountName || '')}">`, { id: 'bankAccountName' })}
        <p class="hint full" style="font-size:var(--fs-xs);color:var(--muted)">Khách chuyển khoản thẳng vào tài khoản này, GGO không giữ tiền. Khách chỉ thấy mã QR khi đã có sân mà chưa chuyển khoản.</p>
      </div>`, { saveLabel: 'Lưu tài khoản' })}

    <details class="panel set-group" data-key="courts" ${openGroups.has('courts') ? 'open' : ''}>
      <summary><h2 class="h2">Các sân và giá</h2><span class="sum">${esc(v.courts.map((c) => c.name).join(', ') || 'Chưa có sân nào')}</span></summary>
      <div class="courts">${v.courts.map(courtRow).join('') || '<p class="panel-empty">Chưa có sân nào.</p>'}</div>
      <form class="court" id="new-court" novalidate style="background:var(--surface-2)">
        ${field('Thêm sân', `<input class="input" id="nc-name" name="name" placeholder="Ví dụ: Sân 4" required>`, { id: 'nc-name' }).replace('class="field', 'class="field c-name')}
        ${field('Loại sân', `<select class="select" id="nc-type" name="fieldType">${opts([['5', 'Sân 5 người'], ['7', 'Sân 7 người']], '5')}</select>`, { id: 'nc-type' })}
        ${field('Giá thường (đ/giờ)', `<input class="input" id="nc-price" name="price" type="number" inputmode="numeric" min="0" step="1000" value="300000">`, { id: 'nc-price' })}
        ${field('Giá cao điểm (đ/giờ)', `<input class="input" id="nc-peak" name="peakPrice" type="number" inputmode="numeric" min="0" step="1000" value="450000">`, { id: 'nc-peak' })}
        <div class="c-foot"><button class="btn btn-sm btn-lime" type="submit">Thêm sân</button></div>
      </form>
    </details>
  </div>`;
  dirty = new Set();
}

function setDirty(form, on) {
  const key = form.dataset.group;
  if (!key) return;
  if (on) dirty.add(key); else dirty.delete(key);
  form.classList.toggle('dirty', on);
  const st = $('.state', form);
  if (st) st.textContent = on ? 'Có thay đổi chưa lưu' : 'Chưa có thay đổi';
}

function setErr(input, msg) {
  const f = input.closest('.field');
  f.classList.toggle('error', !!msg);
  const e = $('.err', f);
  e.hidden = !msg;
  e.textContent = msg || '';
  input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  return !msg;
}
const isMoney = (s) => s !== '' && Number.isInteger(Number(s)) && Number(s) >= 0;

function validateGroup(f) {
  const el = (n) => f.elements[n];
  let ok = true;
  const need = (n, msg) => (ok = setErr(el(n), el(n).value.trim() ? '' : msg) && ok);
  const key = f.dataset.group;
  if (key === 'info') {
    need('name', 'Nhập tên sân');
    need('district', 'Nhập quận');
    need('address', 'Nhập địa chỉ');
  }
  if (key === 'hours') {
    const open = hmToMin(el('openTime').value);
    const close = hmToMin(el('closeTime').value);
    ok = setErr(el('closeTime'), close > open ? '' : 'Giờ đóng phải sau giờ mở') && ok;
    const ps = hmToMin(el('peakStart').value);
    const pe = hmToMin(el('peakEnd').value);
    ok = setErr(el('peakEnd'), pe > ps ? (ps >= open && pe <= close ? '' : 'Cao điểm phải nằm trong giờ hoạt động') : 'Cao điểm kết thúc phải sau giờ bắt đầu') && ok;
  }
  if (key === 'mode') {
    const pct = el('lastMinutePercent').value;
    ok = setErr(el('lastMinutePercent'), isMoney(pct) && Number(pct) <= 90 ? '' : 'Nhập số nguyên từ 0 đến 90') && ok;
  }
  if (key === 'bank') {
    const bin = el('bankBin').value;
    const acc = el('bankAccount').value.trim();
    const accName = el('bankAccountName').value.trim();
    if (bin || acc || accName) {
      ok = setErr(el('bankBin'), bin ? '' : 'Chọn ngân hàng') && ok;
      ok = setErr(el('bankAccount'), /^\d{6,19}$/.test(acc) ? '' : 'Số tài khoản gồm 6–19 chữ số') && ok;
      ok = setErr(el('bankAccountName'), accName ? '' : 'Nhập tên chủ tài khoản') && ok;
    } else ['bankBin', 'bankAccount', 'bankAccountName'].forEach((n) => setErr(el(n), ''));
  }
  return ok;
}

function validateCourt(f) {
  let ok = setErr(f.elements.name, f.elements.name.value.trim() ? '' : 'Nhập tên sân');
  ok = setErr(f.elements.price, isMoney(f.elements.price.value) ? '' : 'Nhập giá hợp lệ') && ok;
  const peakOk = isMoney(f.elements.peakPrice.value) && Number(f.elements.peakPrice.value) >= Number(f.elements.price.value);
  ok = setErr(f.elements.peakPrice, peakOk ? '' : 'Giá cao điểm phải bằng hoặc cao hơn giá thường') && ok;
  return ok;
}

// Mỗi nhóm lưu riêng: lấy giá trị đã lưu của sân làm nền, chỉ thay các ô của nhóm đang lưu.
function venueBody(f) {
  const v = venues.find((x) => x.id === venueId);
  const bank = v.bank || { bin: v.bankBin, account: v.bankAccount, accountName: v.bankAccountName };
  const body = {
    name: v.name, district: v.district, address: v.address, phone: v.phone || '', amenities: v.amenities || [], description: v.description || '',
    openTime: v.openTime, closeTime: v.closeTime, slotMinutes: v.slotMinutes, peakStart: v.peakStart, peakEnd: v.peakEnd,
    requiresApproval: !!v.requiresApproval, lastMinutePercent: v.lastMinutePercent, rules: v.rules || '',
    bankBin: bank.bin || '', bankAccount: bank.account || '', bankAccountName: bank.accountName || '',
  };
  const el = f.elements;
  const val = (n) => el[n].value.trim();
  const by = {
    info: () => Object.assign(body, { name: val('name'), district: val('district'), address: val('address'), phone: val('phone'), amenities: val('amenities').split(',').map((x) => x.trim()).filter(Boolean), description: val('description') }),
    hours: () => Object.assign(body, { openTime: el.openTime.value, closeTime: el.closeTime.value, slotMinutes: Number(el.slotMinutes.value), peakStart: el.peakStart.value, peakEnd: el.peakEnd.value }),
    mode: () => Object.assign(body, { requiresApproval: el.requiresApproval.value === '1', lastMinutePercent: Number(el.lastMinutePercent.value) }),
    rules: () => Object.assign(body, { rules: val('rules') }),
    bank: () => Object.assign(body, { bankBin: el.bankBin.value, bankAccount: val('bankAccount'), bankAccountName: val('bankAccountName') }),
  };
  by[f.dataset.group]();
  return body;
}

async function reload(keepScroll = true) {
  const y = scrollY;
  venues = await api.owner.venues();
  render();
  if (keepScroll) scrollTo(0, y);
}

content.addEventListener('toggle', (e) => {
  const d = e.target.closest?.('.set-group');
  if (!d) return;
  if (d.open) openGroups.add(d.dataset.key); else openGroups.delete(d.dataset.key);
}, true);
content.addEventListener('input', (e) => {
  const sf = e.target.closest('.set-form');
  if (sf) setDirty(sf, true);
  const sw = e.target.closest('.switch');
  if (sw) {
    $('.sw-text', sw).textContent = e.target.checked ? 'Đang mở đặt' : 'Tạm tắt';
  }
});
content.addEventListener('change', (e) => {
  const sf = e.target.closest('.set-form');
  if (sf) setDirty(sf, true);
});

content.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const btn = e.submitter;
  if (f.dataset.group) {
    if (!validateGroup(f)) return void ($('.field.error input, .field.error select', f)?.focus(), toast('Kiểm tra lại các ô báo lỗi', { error: true }));
    guard(btn, async () => {
      await api.owner.updateVenue(venueId, venueBody(f));
      toast(`Đã lưu: ${f.closest('.set-group').querySelector('h2').textContent.toLowerCase()}`);
      await reload();
    });
  } else if (f.id === 'new-court') {
    if (!validateCourt(f)) return;
    guard(btn, async () => {
      await api.owner.addCourt(venueId, { name: f.elements.name.value.trim(), fieldType: f.elements.fieldType.value, price: Number(f.elements.price.value), peakPrice: Number(f.elements.peakPrice.value) });
      toast('Đã thêm sân');
      await reload();
    });
  } else if (f.dataset.court) {
    if (!validateCourt(f)) return;
    guard(btn, async () => {
      const el = f.elements;
      await api.owner.updateCourt(Number(f.dataset.court), { name: el.name.value.trim(), fieldType: el.fieldType.value, price: Number(el.price.value), peakPrice: Number(el.peakPrice.value), isActive: el.isActive.checked, teamMode: el.teamMode.checked ? { from: el.teamFrom.value || null, to: el.teamTo.value || null } : null });
      toast(`Đã lưu ${el.name.value.trim()}`);
      await reload();
    });
  }
});

async function newVenue() {
  const r = await dialog({
    title: 'Thêm sân mới',
    confirm: 'Tạo sân',
    body: `<div class="fgrid">
      ${field('Tên sân', '<input class="input" id="nv-name" name="name" required data-label="tên sân">', { id: 'nv-name', full: true })}
      ${field('Quận', '<input class="input" id="nv-district" name="district" required data-label="quận">', { id: 'nv-district' })}
      ${field('Điện thoại', '<input class="input" id="nv-phone" name="phone" inputmode="tel">', { id: 'nv-phone' })}
      ${field('Địa chỉ', '<input class="input" id="nv-address" name="address" required data-label="địa chỉ">', { id: 'nv-address', full: true })}
    </div><p class="muted" style="margin-top:12px;font-size:var(--fs-sm)">Giờ mở, giá và tài khoản ngân hàng chỉnh sau trong trang này.</p>`,
  });
  if (!r) return;
  const created = await api.owner.createVenue({ name: r.name.trim(), district: r.district.trim(), address: r.address.trim(), phone: r.phone.trim() });
  toast('Đã tạo sân');
  venues = await api.owner.venues();
  venueId = created?.id ?? venues[venues.length - 1].id;
  rememberVenue(venueId);
  fillTools();
  render();
}

function fillTools() {
  $('#tools').innerHTML = `<label class="sr-only" for="venue">Sân của bạn</label><select class="select" id="venue"></select><button class="btn btn-sm" type="button" id="add-venue">Thêm sân mới</button>`;
  venueSelect($('#venue'), venues, venueId, (id) => {
    if (dirty.size && !confirm('Có thay đổi chưa lưu. Chuyển sang sân khác và bỏ thay đổi?')) {
      $('#venue').value = venueId;
      return;
    }
    venueId = id;
    render();
  });
  $('#add-venue').onclick = (e) => guard(e.currentTarget, newVenue);
}

window.addEventListener('beforeunload', (e) => {
  if (dirty.size) e.preventDefault();
});

if (await initPage()) {
  try {
    [{ venues, id: venueId }, meta] = await Promise.all([loadVenues(), api.meta()]);
    $('#sub').textContent = 'Mở từng mục để sửa. Mỗi mục có nút Lưu riêng, áp dụng cho khách từ lúc bạn lưu.';
    fillTools();
    if (!venues.length) content.innerHTML = '<div class="empty"><p>Bạn chưa có sân nào. Bấm “Thêm sân mới” để bắt đầu.</p></div>';
    else render();
  } catch (err) {
    errorBox(content, err, () => location.reload());
  }
}
