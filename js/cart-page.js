import { api } from '/js/api.js';
import { mountShell, toast } from '/js/ui/shell.js';
import { $, decorate, esc } from '/js/ui/page.js';
import { dayLabel, money } from '/js/ui/format.js';
import '/js/cart.js';

const STATUS = { booked: 'Đã có người đặt', held: 'Đang có người giữ', past: 'Giờ đã qua', blocked: 'Giờ không còn trống', unavailable: 'Giờ không còn trống', offered: 'Giờ không còn trống' };
const rowKey = (x) => JSON.stringify([x.venueId, x.courtId, x.date, x.start]);
const rows = GgoCart.loadCart();
let entries = [];

async function load() {
  const current = GgoCart.loadCart();
  const result = await Promise.all(current.map(async (item) => {
    try {
      const [venue, schedule] = await Promise.all([api.venue(item.venueId), api.schedule(item.venueId, item.date)]);
      const court = schedule.courts.find((c) => c.id === item.courtId);
      const slot = court?.slots.find((s) => s.start === item.start);
      if (!venue || !slot) return { item, venue, court, slot, invalid: 'Không tìm thấy giờ này trong lịch hiện tại.' };
      return { item, venue, court, slot, invalid: slot.status !== 'available' && !slot.offeredToYou ? (STATUS[slot.status] || 'Giờ không còn trống') : null };
    } catch (error) { return { item, invalid: error.message || 'Không tải được lịch và giá.' }; }
  }));
  entries = result;
  render();
}

function render() {
  const root = $('cart-root');
  if (!entries.length) {
    root.innerHTML = '<div class="card empty"><h1 class="h1">Giỏ giờ đã lưu</h1><p>Bạn chưa lưu giờ sân nào.</p><a class="btn btn-lime" href="/products.html">Tìm sân</a></div>';
    decorate(); return;
  }
  const valid = entries.filter((e) => !e.invalid && e.slot);
  const total = valid.reduce((sum, e) => sum + e.slot.price, 0);
  root.innerHTML = `<div class="page-head"><h1 class="h1">Giờ đã lưu</h1><p class="sub">Mỗi giờ là một chỗ riêng. Tình trạng và giá được cập nhật từ lịch sân hiện tại.</p></div>
    <div class="cart-list">${entries.map(({ item, venue, court, slot, invalid }) => {
      const link = `/product-detail.html?id=${item.venueId}&date=${encodeURIComponent(item.date)}&slot=${encodeURIComponent(item.start)}&court=${item.courtId}`;
      const image = venue?.imageUrl ? `<img src="${esc(venue.imageUrl)}" alt="${esc(venue.name)}">` : '<div class="cart-image-empty">Chưa có ảnh</div>';
      return `<article class="card cart-item">${image}<div class="cart-info"><h2 class="h3">${esc(venue?.name || 'Không tải được sân')}</h2><p>${esc(court?.name || 'Sân con không tìm thấy')} · ${esc(dayLabel(item.date))} · ${esc(slot ? `${slot.start}–${slot.end}` : item.start)}</p><p class="cart-price">${slot ? money(slot.price) : '—'}</p>${invalid ? `<p class="notice warn cart-invalid" role="status">${esc(invalid.replace(/\.$/, ''))}. Không tính vào tổng.</p>` : ''}</div><div class="cart-actions">${invalid ? '' : `<a class="btn btn-lime btn-sm" href="${link}">Đặt giờ này</a>`}<button type="button" class="btn btn-ghost btn-sm" data-remove="${esc(rowKey(item))}">Xóa</button></div></article>`;
    }).join('')}</div>
    <section class="card cart-total"><p>Còn đặt được ${valid.length}/${entries.length} giờ</p><p class="h3">Tổng tạm tính <b>${money(total)}</b></p><small>Giá có thể thay đổi. Chỉ xác nhận khi bạn đặt giờ.</small></section>`;
  decorate();
}

document.addEventListener('click', async (event) => {
  const btn = event.target.closest('[data-remove]');
  if (!btn) return;
  const key = btn.dataset.remove;
  const target = GgoCart.loadCart().find((item) => rowKey(item) === key);
  if (target) GgoCart.removeCart(target);
  await load();
  toast('Đã xóa giờ khỏi giỏ.');
});
await mountShell();
await load();
