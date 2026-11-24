import { mountShell, toast } from '/js/ui/shell.js';
import { icon } from '/js/ui/icons.js';
mountShell({ unread: 3 });

// Gắn icon vào phần tử có data-icon (đặt trước chữ)
document.querySelectorAll('[data-icon]').forEach((el) => {
  el.insertAdjacentHTML(el.childElementCount || el.textContent.trim() ? 'afterbegin' : 'beforeend', icon(el.dataset.icon, el.classList.contains('art') ? 32 : 16));
});

// Chip chọn nhiều / chọn một
document.querySelectorAll('[data-toggle-group] > *').forEach((b) =>
  b.addEventListener('click', () => b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'))));
document.querySelectorAll('[data-single-group]').forEach((g) =>
  g.querySelectorAll(':scope > *').forEach((b) => b.addEventListener('click', () => {
    g.querySelectorAll(':scope > *').forEach((x) => x.setAttribute('aria-pressed', 'false'));
    b.setAttribute('aria-pressed', 'true');
  })));

// Chọn slot -> cập nhật thanh đặt
const money = (n) => `${Number(n).toLocaleString('vi-VN')}đ`;
document.querySelectorAll('[data-pick]').forEach((s) => s.addEventListener('click', () => {
  document.querySelectorAll('[data-pick]').forEach((x) => x.setAttribute('aria-pressed', 'false'));
  s.setAttribute('aria-pressed', 'true');
  document.getElementById('bar-what').textContent = `Thành Phát · ${s.dataset.pick} · hôm nay`;
  document.getElementById('bar-total').textContent = money(s.dataset.price);
  document.getElementById('bar-book').disabled = false;
}));

const dlg = document.getElementById('confirm-dialog');
document.getElementById('open-dialog').addEventListener('click', () => dlg.showModal());
// Hộp xác nhận lấy dữ liệu từ ô đang chọn (mẫu: giảm giờ chót = 20% giá gốc)
let picked = null;
document.querySelectorAll('[data-pick]').forEach((s) => s.addEventListener('click', () => { picked = s; }));
document.getElementById('bar-book').addEventListener('click', () => {
  if (picked) {
    const [court, hour] = picked.dataset.pick.split(' · ');
    const price = Number(picked.dataset.price);
    const sale = picked.classList.contains('sale');
    const end = String(Number(hour.slice(0, 2)) + 1).padStart(2, '0') + hour.slice(2);
    document.getElementById('dlg-venue').textContent = `Thành Phát · ${court}`;
    document.getElementById('dlg-time').textContent = `${hour}–${end}, hôm nay`;
    document.getElementById('dlg-total').textContent = money(price);
    document.getElementById('dlg-orig-row').hidden = !sale;
    document.getElementById('dlg-sale-row').hidden = !sale;
    if (sale) {
      const orig = Math.round(price / 0.8);
      document.querySelector('#dlg-orig-row dd').textContent = money(orig);
      document.querySelector('#dlg-sale-row dd').textContent = `-${money(orig - price)}`;
    }
    document.getElementById('do-book').textContent = `Đặt sân · ${money(price)}`;
  }
  dlg.showModal();
});
dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dlg.close()));
document.getElementById('do-book').addEventListener('click', () => { dlg.close(); toast('Đặt sân thành công – mã SN-24817'); });

document.querySelectorAll('[data-wait]').forEach((b) => b.addEventListener('click', () => toast('Đã thêm vào danh sách chờ – bạn đứng thứ 1')));
document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
  await navigator.clipboard?.writeText(b.dataset.copy).catch(() => {});
  toast(`Đã sao chép ${b.dataset.copy}`);
}));
