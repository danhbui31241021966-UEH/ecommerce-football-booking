// Khung trang dùng chung: header + menu theo vai trò, footer, toast.
// Trang chỉ cần <div id="app-header"></div> và <div id="app-footer"></div>, rồi gọi mountShell().
import { icon, brandMark } from './icons.js';

const NAV = {
  guest: [
    { href: '/', label: 'Trang chủ' },
    { href: '/venues.html', label: 'Tìm sân' },
  ],
  customer: [
    { href: '/', label: 'Trang chủ' },
    { href: '/venues.html', label: 'Tìm sân' },
    { href: '/my-bookings.html', label: 'Booking của tôi' },
  ],
  owner: [
    { href: '/owner.html', label: 'Tổng quan' },
    { href: '/owner-schedule.html', label: 'Lịch sân' },
    { href: '/owner-bookings.html', label: 'Booking' },
    { href: '/owner-settings.html', label: 'Cài đặt sân' },
  ],
  admin: [
    { href: '/admin.html', label: 'Tài khoản' },
    { href: '/admin-bookings.html', label: 'Booking' },
    { href: '/admin-logs.html', label: 'Nhật ký' },
  ],
};

const ROLE_LABEL = { guest: 'Khách', customer: 'Khách hàng', owner: 'Chủ sân', admin: 'Admin' };

// Prototype: vai trò lưu trong localStorage để demo từng góc nhìn khi chưa có đăng nhập thật.
const ROLE_KEY = 'sannhanh.role';
export function getRole() {
  return localStorage.getItem(ROLE_KEY) || 'guest';
}
export function setRole(role) {
  localStorage.setItem(ROLE_KEY, role);
}

function isCurrent(href) {
  const path = location.pathname === '/index.html' ? '/' : location.pathname;
  return path === href;
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('.role-switch button');
  if (!b) return;
  setRole(b.dataset.role);
  location.reload();
});

export function mountShell({ unread = 0, userInitials = 'ĐN' } = {}) {
  const role = getRole();
  const links = NAV[role]
    .map((l) => `<a href="${l.href}" ${isCurrent(l.href) ? 'aria-current="page"' : ''}>${l.label}</a>`)
    .join('');

  // Công tắc vai trò chỉ để demo prototype: nằm ở thanh nhỏ góc màn hình, không thuộc header sản phẩm.
  const roleSwitch = `<div class="role-switch" role="group" aria-label="Xem với vai trò (prototype)">${Object.entries(ROLE_LABEL)
    .map(([k, v]) => `<button type="button" data-role="${k}" aria-pressed="${k === role}">${v}</button>`)
    .join('')}</div>`;

  const header = document.getElementById('app-header');
  if (header) {
    header.outerHTML = `
      <header class="site-header">
        <div class="container">
          <a class="brand" href="/">${brandMark}<span>Sân<b>Nhanh</b></span></a>
          <nav class="nav" aria-label="Điều hướng chính">${links}</nav>
          <div class="header-actions">
            ${
              role === 'guest'
                ? `<a class="btn btn-lime btn-sm" href="/login.html">Đăng nhập</a>`
                : `<a class="icon-btn" href="/notifications.html" aria-label="Thông báo">${icon('bell')}${
                    unread ? `<span class="dot">${unread}</span>` : ''
                  }</a>
                   <span class="avatar" title="${ROLE_LABEL[role]}">${userInitials}</span>`
            }
            <button class="icon-btn menu-btn" type="button" aria-label="Mở menu" aria-expanded="false">${icon('menu')}</button>
          </div>
        </div>
      </header>
      <nav class="mobile-nav" aria-label="Điều hướng (mobile)">${links}
        <div class="mobile-role"><span>Xem với vai trò (prototype)</span>${roleSwitch}</div>
      </nav>
      <details class="role-dock"><summary aria-label="Vai trò đang xem (prototype): ${ROLE_LABEL[role]}" title="Vai trò: ${ROLE_LABEL[role]}">${icon('users', 18)}</summary>${roleSwitch}</details>`;

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
            <p class="footer-note">Đặt sân bóng mini 5/7 người tại TP.HCM – không app, không gọi điện.</p>
          </div>
          <div>
            <p>Thanh toán chuyển khoản VietQR thẳng vào tài khoản chủ sân.</p>
            <p>SânNhanh không giữ tiền của bạn.</p>
          </div>
          <div>
            <p>Đồ án môn Phát triển ứng dụng TMĐT – Nhóm 8</p>
          </div>
          <div class="footer-role"><span>Xem với vai trò (prototype)</span>${roleSwitch}</div>
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
