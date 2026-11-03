// Khung trang dùng chung: header + menu theo vai trò, footer, toast.
// Trang chỉ cần <div id="app-header"></div> và <div id="app-footer"></div>, rồi gọi mountShell().
import { icon, brandMark } from './icons.js';
import { api } from '/js/api.js';

// main: luôn hiện trên thanh. more: gom vào mục "Thêm" (trên điện thoại hiện thẳng dưới nhãn "Thêm", không cần bấm thêm).
const MORE = (requestHref) => [
  { href: '/transfers.html', label: 'Pass sân' },
  { href: '/matches.html', label: 'Ghép kèo' },
  { href: '/leagues.html', label: 'Giải đấu', also: ['/league.html'] },
  { href: requestHref, label: 'Nhờ báo giá', also: ['/request.html', '/request-new.html', '/requests.html'] },
];
const NAV = {
  guest: {
    main: [
      { href: '/', label: 'Trang chủ' },
      { href: '/venues.html', label: 'Tìm sân' },
    ],
    more: MORE('/request-new.html'),
  },
  customer: {
    main: [
      { href: '/', label: 'Trang chủ' },
      { href: '/venues.html', label: 'Tìm sân' },
      { href: '/my-bookings.html', label: 'Lịch đặt của tôi' },
    ],
    more: MORE('/requests.html'),
  },
  owner: {
    main: [
      { href: '/owner.html', label: 'Hôm nay' },
      { href: '/owner-schedule.html', label: 'Lịch sân', also: ['/owner-bookings.html', '/owner-leagues.html', '/owner-league.html'] },
      { href: '/owner-requests.html', label: 'Khách nhờ báo giá' },
      { href: '/owner-settings.html', label: 'Cài đặt sân' },
    ],
    more: [],
  },
  admin: {
    main: [
      { href: '/admin.html', label: 'Tài khoản' },
      { href: '/admin-bookings.html', label: 'Lịch đặt' },
      { href: '/admin-logs.html', label: 'Nhật ký' },
    ],
    more: [],
  },
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

// Vai trò lần trước, để vẽ header ngay khi trang mở (trước khi biết phiên đăng nhập). Chỉ là gợi ý vẽ sớm: vai trò thật luôn lấy từ api.me.
const ROLE_HINT = 'ggo.role';
const hintRole = () => {
  try {
    const r = localStorage.getItem(ROLE_HINT);
    return NAV[r] ? r : 'guest';
  } catch {
    return 'guest';
  }
};
const saveHint = (role) => {
  try {
    localStorage.setItem(ROLE_HINT, role);
  } catch {
    /* chế độ riêng tư: bỏ qua */
  }
};

const linkHtml = (l) => `<a href="${l.href}" ${isCurrent(l.href, l.also) ? 'aria-current="page"' : ''}>${l.label}</a>`;
const moreIsCurrent = (role) => NAV[role].more.some((l) => isCurrent(l.href, l.also));

function navHtml(role) {
  const { main, more } = NAV[role];
  const mainLinks = main.map(linkHtml).join('');
  if (!more.length) return mainLinks;
  return `${mainLinks}<div class="nav-more"><button type="button" class="nav-more-btn" aria-expanded="false" aria-controls="nav-more-panel"${moreIsCurrent(role) ? ' data-current' : ''}>Thêm${icon('chevronDown', 16)}</button><div class="nav-more-panel" id="nav-more-panel" hidden>${more.map(linkHtml).join('')}</div></div>`;
}

function mobileLinksHtml(role) {
  const { main, more } = NAV[role];
  return main.map(linkHtml).join('') + (more.length ? `<p class="mobile-nav-label">Thêm</p>${more.map(linkHtml).join('')}` : '');
}

const actionsHtml = (user, role, unread, ghost) => {
  if (!user) return '<a class="btn btn-lime btn-sm" href="/login.html">Đăng nhập</a>';
  if (ghost) return '<span class="avatar avatar-ghost" aria-hidden="true"></span>'; // đoán là đã đăng nhập, chờ api.me cho tên thật
  return `<a class="icon-btn" href="/notifications.html" aria-label="Thông báo${unread ? `: ${unread} chưa đọc` : ''}">${icon('bell')}${unread ? `<span class="dot">${unread}</span>` : ''}</a>
    <details class="user-menu"><summary class="avatar" aria-label="Tài khoản ${esc(user.fullName)}" title="${esc(user.fullName)}">${esc(initialsOf(user.fullName))}</summary>
      <div class="user-menu-panel"><b>${esc(user.fullName)}</b><span>${esc(user.email || user.phone)} · ${ROLE_LABEL[role]}</span>
        <button type="button" data-logout>Đăng xuất</button></div></details>`;
};

// Công tắc vai trò chỉ để demo prototype: nút tròn ở góc (≥1280px), trong menu (<900px), trong footer (900–1279px).
const roleSwitchHtml = (role) =>
  `<div class="role-switch" role="group" aria-label="Xem với vai trò">${Object.entries(ROLE_LABEL)
    .map(([k, v]) => `<button type="button" data-role="${k}" aria-pressed="${k === role}">${v}</button>`)
    .join('')}</div>`;
const protoToolsHtml = `<div class="proto-tools">
      <button type="button" data-proto="reset">Đặt lại dữ liệu demo</button>
      <button type="button" data-proto="clock">Tua đồng hồ +15 phút</button>
      <button type="button" data-proto="holder">Giả lập: người giữ giờ hủy</button>
      <button type="button" data-proto="bank">Giả lập: ngân hàng báo có tiền ngay</button>
    </div>`;

const headerHtml = (role, user, unread, ghost) => `
      <header class="site-header">
        <div class="container">
          <a class="brand" href="${role === 'owner' ? '/owner.html' : role === 'admin' ? '/admin.html' : '/'}">${brandMark}<span>GGO</span></a>
          <nav class="nav" aria-label="Điều hướng chính">${navHtml(role)}</nav>
          <div class="header-actions">${actionsHtml(user, role, unread, ghost)}<button class="icon-btn menu-btn" type="button" aria-label="Mở menu" aria-expanded="false">${icon('menu')}</button></div>
        </div>
      </header>`;

const mobileNavHtml = (role, loggedIn) => {
  const switchHtml = roleSwitchHtml(role);
  return `<nav class="mobile-nav" aria-label="Điều hướng (mobile)">${mobileLinksHtml(role)}
        ${loggedIn ? '<button type="button" class="mobile-logout mobile-account" data-logout>Đăng xuất</button>' : '<a class="mobile-account" href="/register.html">Đăng ký</a>'}
        ${api.proto ? (role === 'owner' ? `<details class="mobile-role demo-group"><summary>Demo (chỉ dùng khi thuyết trình)</summary><span>Xem với vai trò</span>${switchHtml}${protoToolsHtml}</details>` : `<div class="mobile-role"><span>Xem với vai trò</span>${switchHtml}${protoToolsHtml}</div>`) : ''}
      </nav>`;
};

const dockHtml = (role) =>
  api.proto
    ? `<details class="role-dock"><summary aria-label="Công cụ demo: đang xem với vai trò ${ROLE_LABEL[role]}" title="Công cụ demo: ${ROLE_LABEL[role]}">${icon('users', 18)}${role === 'owner' ? '<span class="dock-label">Demo</span>' : ''}</summary><div class="role-dock-panel">${roleSwitchHtml(role)}${protoToolsHtml}</div></details>`
    : '';

function closeMore() {
  const btn = document.querySelector('.nav-more-btn');
  if (!btn || btn.getAttribute('aria-expanded') !== 'true') return false;
  btn.setAttribute('aria-expanded', 'false');
  document.getElementById('nav-more-panel').hidden = true;
  return true;
}

function closeMobile() {
  const nav = document.querySelector('.mobile-nav');
  const btn = document.querySelector('.menu-btn');
  if (!nav?.classList.contains('open')) return false;
  nav.classList.remove('open');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-label', 'Mở menu');
  btn.innerHTML = icon('menu');
  return true;
}

// Gắn sự kiện cho nút menu điện thoại và mục "Thêm". Gọi lại sau mỗi lần vẽ lại header.
function wireHeader() {
  const menuBtn = document.querySelector('.menu-btn');
  const mobileNav = document.querySelector('.mobile-nav');
  menuBtn?.addEventListener('click', () => {
    const open = mobileNav.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', String(open));
    menuBtn.setAttribute('aria-label', open ? 'Đóng menu' : 'Mở menu');
    menuBtn.innerHTML = icon(open ? 'close' : 'menu');
  });
  const moreBtn = document.querySelector('.nav-more-btn');
  moreBtn?.addEventListener('click', () => {
    const open = moreBtn.getAttribute('aria-expanded') !== 'true';
    moreBtn.setAttribute('aria-expanded', String(open));
    document.getElementById('nav-more-panel').hidden = !open;
  });
}

let globalKeysBound = false;
function bindGlobalKeys() {
  if (globalKeysBound) return;
  globalKeysBound = true;
  // Escape đóng mục đang mở và trả tiêu điểm về nút đã mở nó; bấm ra ngoài hoặc Tab ra khỏi "Thêm" cũng đóng.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (closeMore()) document.querySelector('.nav-more-btn')?.focus();
    else if (closeMobile()) document.querySelector('.menu-btn')?.focus();
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.nav-more')) closeMore();
  });
  document.addEventListener('focusin', (e) => {
    if (!e.target.closest('.nav-more')) closeMore();
  });
}

export async function mountShell() {
  // Vẽ header ngay, không chờ phiên đăng nhập: logo và nút chính hiện cùng lúc với trang. Khi api.me trả lời thì chỉnh lại cho đúng.
  const guessed = hintRole();
  const header = document.getElementById('app-header');
  if (header) {
    header.outerHTML = headerHtml(guessed, guessed === 'guest' ? null : {}, 0, true) + mobileNavHtml(guessed, guessed !== 'guest') + dockHtml(guessed);
    wireHeader();
    bindGlobalKeys();
  }

  try {
    currentUser = (await api.me()).user;
  } catch {
    currentUser = null;
  }
  const role = getRole();
  saveHint(role);

  if (header) {
    if (role !== guessed) {
      const wasOpen = document.querySelector('.mobile-nav')?.classList.contains('open');
      const olds = ['.site-header', '.mobile-nav', '.role-dock'].map((q) => document.querySelector(q)).filter(Boolean);
      olds[0].insertAdjacentHTML('beforebegin', headerHtml(role, currentUser, 0, false) + mobileNavHtml(role, !!currentUser) + dockHtml(role));
      olds.forEach((el) => el.remove());
      wireHeader();
      if (wasOpen) document.querySelector('.menu-btn')?.click();
    } else {
      // Khách vãng lai đã được vẽ đúng từ đầu; người đã đăng nhập thì thay ô giữ chỗ bằng chuông và tên thật.
      if (currentUser) {
        const box = document.querySelector('.header-actions');
        const menuBtn = box.querySelector('.menu-btn');
        [...box.children].forEach((c) => c !== menuBtn && c.remove());
        menuBtn.insertAdjacentHTML('beforebegin', actionsHtml(currentUser, role, 0, false));
      }
    }
    if (currentUser) {
      // Số thông báo chưa đọc đến sau, không chặn việc vẽ header.
      api
        .notifications()
        .then(({ unread }) => {
          const bell = document.querySelector('.header-actions > .icon-btn[href="/notifications.html"]');
          if (bell && unread) bell.outerHTML = actionsHtml(currentUser, role, unread, false).match(/<a class="icon-btn"[\s\S]*?<\/a>/)[0];
        })
        .catch(() => {});
    }
  }
  const proto = !!api.proto;
  const roleSwitch = roleSwitchHtml(role);
  const protoTools = protoToolsHtml;

  const footer = document.getElementById('app-footer');
  if (footer) {
    footer.outerHTML = `
      <footer class="site-footer">
        <div class="container">
          <div>
            <a class="brand" href="/">${brandMark}<span>GGO</span></a>
            <p class="footer-slogan">Thấy sân trống, đặt là đá.</p>
            <p class="footer-note">Đặt sân bóng mini 5 và 7 người ở TP.HCM, không cần gọi điện.</p>
          </div>
          <div>
            <p>Bạn chuyển khoản thẳng cho chủ sân bằng mã QR.</p>
            <p>GGO không giữ tiền của bạn: tiền đi thẳng tới chủ sân.</p>
          </div>
          <div>
            <p><a class="footer-link" href="/about.html">Giới thiệu GGO</a></p>
            <p>Đồ án môn Phát triển ứng dụng TMĐT – Nhóm 8</p>
          </div>
          ${proto ? `<div class="footer-role"><span>Xem với vai trò</span>${roleSwitch}${protoTools}</div>` : ''}
        </div>
        <p class="footer-wordmark" aria-hidden="true">GGO</p>
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
