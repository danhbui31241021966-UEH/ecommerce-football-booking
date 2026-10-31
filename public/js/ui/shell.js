// Khung trang dùng chung: header + menu theo vai trò, footer, toast.
// Trang chỉ cần <div id="app-header"></div> và <div id="app-footer"></div>, rồi gọi mountShell().
import { icon, brandMark } from './icons.js';
import { api } from '/js/api.js';

const NAV = {
  guest: [
    { href: '/', label: 'Trang chủ' },
    { href: '/venues.html', label: 'Tìm sân' },
    { href: '/transfers.html', label: 'Pass sân' },
    { href: '/matches.html', label: 'Ghép kèo' },
  ],
  customer: [
    { href: '/', label: 'Trang chủ' },
    { href: '/venues.html', label: 'Tìm sân' },
    { href: '/transfers.html', label: 'Pass sân' },
    { href: '/matches.html', label: 'Ghép kèo' },
    { href: '/requests.html', label: 'Nhờ báo giá' },
    { href: '/my-bookings.html', label: 'Lịch đặt của tôi' },
  ],
  owner: [
    { href: '/owner.html', label: 'Hôm nay' },
    { href: '/owner-schedule.html', label: 'Lịch sân', also: ['/owner-bookings.html', '/owner-leagues.html', '/owner-league.html'] },
    { href: '/owner-requests.html', label: 'Khách nhờ báo giá' },
    { href: '/owner-settings.html', label: 'Cài đặt sân' },
  ],
  admin: [
    { href: '/admin.html', label: 'Tài khoản' },
    { href: '/admin-bookings.html', label: 'Lịch đặt' },
    { href: '/admin-logs.html', label: 'Nhật ký' },
  ],
};

const ROLE_LABEL = { guest: 'Khách', customer: 'Khách hàng', owner: 'Chủ sân', admin: 'Admin' };

// Vai trò lấy từ phiên đăng nhập (api.me). Công tắc vai trò chỉ là đường tắt của prototype: đăng nhập nhanh vào tài khoản demo.
let currentUser = null;
export const getUser = () => currentUser;
export const getRole = () => currentUser?.role || 'guest';

function isCurrent(href, also = []) {
  const path = location.pathname === '/index.html' ? '/' : location.pathname.replace(/\.html$/, '');
  return [href, ...also].some((h) => path === h.replace(/\.html$/, ''));
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const initialsOf = (name) => name.trim().split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase();

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-role], [data-proto], [data-logout]');
  if (!b) return;
  try {
    if (b.dataset.role) {
      await api.proto.quickLogin(b.dataset.role);
      location.reload();
    } else if (b.dataset.logout !== undefined) {
      await api.logout();
      location.href = '/';
    } else if (b.dataset.proto === 'reset') {
      await api.proto.resetDemo();
      location.reload();
    } else if (b.dataset.proto === 'clock') {
      await api.proto.advanceClock(15);
      location.reload();
    } else if (b.dataset.proto === 'bank') {
      const r = await api.proto.flushBank();
      toast(r.reported ? `Ngân hàng báo ${r.reported} khoản tiền đang chờ (mô phỏng).` : 'Chưa có khoản chuyển khoản nào đang chờ. Bấm "Giả lập chuyển khoản" ở mã QR của một đơn trước.');
      setTimeout(() => location.reload(), 900);
    } else if (b.dataset.proto === 'holder') {
      const r = await api.proto.holderCancels();
      toast(r.cancelled ? `Người đang giữ giờ đã hủy (${r.cancelled}). Xem thông báo của bạn.` : 'Bạn chưa xếp hàng chờ giờ nào đang có người giữ.');
      setTimeout(() => location.reload(), 900);
    }
  } catch (err) {
    toast(err.message, { error: true });
  }
});

export async function mountShell() {
  try {
    currentUser = (await api.me()).user;
  } catch {
    currentUser = null;
  }
  const role = getRole();
  const links = NAV[role]
    .map((l) => `<a href="${l.href}" ${isCurrent(l.href, l.also) ? 'aria-current="page"' : ''}>${l.label}</a>`)
    .join('');
  let unread = 0;
  if (currentUser) {
    try {
      unread = (await api.notifications()).unread;
    } catch {
      unread = 0;
    }
  }
  const proto = !!api.proto;

  // Công tắc vai trò chỉ để demo prototype: nút tròn ở góc (≥1280px), trong menu (<900px), trong footer (900–1279px).
  const roleSwitch = `<div class="role-switch" role="group" aria-label="Xem với vai trò">${Object.entries(ROLE_LABEL)
    .map(([k, v]) => `<button type="button" data-role="${k}" aria-pressed="${k === role}">${v}</button>`)
    .join('')}</div>`;
  const protoTools = `<div class="proto-tools">
      <button type="button" data-proto="reset">Đặt lại dữ liệu demo</button>
      <button type="button" data-proto="clock">Tua đồng hồ +15 phút</button>
      <button type="button" data-proto="holder">Giả lập: người giữ giờ hủy</button>
      <button type="button" data-proto="bank">Giả lập: ngân hàng báo có tiền ngay</button>
    </div>`;

  const header = document.getElementById('app-header');
  if (header) {
    header.outerHTML = `
      <header class="site-header">
        <div class="container">
          <a class="brand" href="${role === 'owner' ? '/owner.html' : role === 'admin' ? '/admin.html' : '/'}">${brandMark}<span>Sân<b>Nhanh</b></span></a>
          <nav class="nav" aria-label="Điều hướng chính">${links}</nav>
          <div class="header-actions">
            ${
              !currentUser
                ? `<a class="btn btn-lime btn-sm" href="/login.html">Đăng nhập</a>`
                : `<a class="icon-btn" href="/notifications.html" aria-label="Thông báo${unread ? `: ${unread} chưa đọc` : ''}">${icon('bell')}${
                    unread ? `<span class="dot">${unread}</span>` : ''
                  }</a>
                   <details class="user-menu"><summary class="avatar" aria-label="Tài khoản ${esc(currentUser.fullName)}" title="${esc(currentUser.fullName)}">${esc(initialsOf(currentUser.fullName))}</summary>
                     <div class="user-menu-panel"><b>${esc(currentUser.fullName)}</b><span>${esc(currentUser.email)} · ${ROLE_LABEL[role]}</span>
                       <button type="button" data-logout>Đăng xuất</button></div></details>`
            }
            <button class="icon-btn menu-btn" type="button" aria-label="Mở menu" aria-expanded="false">${icon('menu')}</button>
          </div>
        </div>
      </header>
      <nav class="mobile-nav" aria-label="Điều hướng (mobile)">${links}
        ${currentUser ? '<button type="button" class="mobile-logout" data-logout>Đăng xuất</button>' : '<a href="/register.html">Đăng ký</a>'}
        ${proto ? (role === 'owner' ? `<details class="mobile-role demo-group"><summary>Demo (chỉ dùng khi thuyết trình)</summary><span>Xem với vai trò</span>${roleSwitch}${protoTools}</details>` : `<div class="mobile-role"><span>Xem với vai trò</span>${roleSwitch}${protoTools}</div>`) : ''}
      </nav>
      ${proto ? `<details class="role-dock"><summary aria-label="Công cụ demo: đang xem với vai trò ${ROLE_LABEL[role]}" title="Công cụ demo: ${ROLE_LABEL[role]}">${icon('users', 18)}${role === 'owner' ? '<span class="dock-label">Demo</span>' : ''}</summary><div class="role-dock-panel">${roleSwitch}${protoTools}</div></details>` : ''}`;

    const menuBtn = document.querySelector('.menu-btn');
    const mobileNav = document.querySelector('.mobile-nav');
    menuBtn.addEventListener('click', () => {
      const open = mobileNav.classList.toggle('open');
      menuBtn.setAttribute('aria-expanded', String(open));
      menuBtn.innerHTML = icon(open ? 'close' : 'menu');
    });
  }

  const footer = document.getElementById('app-footer');
  if (footer) {
    footer.outerHTML = `
      <footer class="site-footer">
        <div class="container">
          <div>
            <a class="brand" href="/">${brandMark}<span>Sân<b>Nhanh</b></span></a>
            <p class="footer-note">Đặt sân bóng mini 5 và 7 người ở TP.HCM, không cần gọi điện.</p>
          </div>
          <div>
            <p>Bạn chuyển khoản thẳng cho chủ sân bằng mã QR.</p>
            <p>SânNhanh không giữ tiền của bạn: tiền đi thẳng tới chủ sân.</p>
          </div>
          <div>
            <p>Đồ án môn Phát triển ứng dụng TMĐT – Nhóm 8</p>
          </div>
          ${proto ? `<div class="footer-role"><span>Xem với vai trò</span>${roleSwitch}${protoTools}</div>` : ''}
        </div>
        <p class="footer-wordmark" aria-hidden="true">SânNhanh</p>
      </footer>`;
  }
}

export function toast(message, { error = false } = {}) {
  let stack = document.querySelector('.toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    stack.setAttribute('role', 'status');
    document.body.append(stack);
  }
  const el = document.createElement('div');
  el.className = `toast${error ? ' error' : ''}`;
  el.innerHTML = `<span class="ic">${icon(error ? 'info' : 'check')}</span><span></span>`;
  el.lastElementChild.textContent = message;
  stack.append(el);
  setTimeout(() => el.remove(), 3200);
}
