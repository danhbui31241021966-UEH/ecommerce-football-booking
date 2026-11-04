// Màn 7: thông báo (khách và chủ sân dùng chung). Bấm một dòng để mở trang liên quan.
import { api } from '/js/api.js';
import { getUser, mountShell, toast } from '/js/ui/shell.js';
import { $, decorate, esc, redirectToLogin } from '/js/ui/page.js';
import { shortTs } from '/js/ui/format.js';

let data;

function render() {
  const { unread, items } = data;
  $('root').innerHTML = `
    <div class="page-head"><h1 class="h1">Thông báo</h1>
      <div class="row"><p class="sub" id="unread-sub">${unread ? `${unread} thông báo chưa đọc` : 'Bạn đã đọc hết thông báo'}</p><span class="spacer"></span>
        <button type="button" class="btn btn-sm" id="read-all" ${unread ? '' : 'disabled'}>Đánh dấu đã đọc tất cả</button></div></div>
    ${
      items.length
        ? `<ul class="notif-list">${items
            .map(
              (n) => `<li><a class="notif-item${n.isRead ? '' : ' unread'}" href="${esc(n.link || '/notifications.html')}"><span class="pip" aria-hidden="true"></span>
              <span class="msg">${n.isRead ? '' : '<span class="tag-unread">Mới · </span>'}${esc(n.message)}</span><time>${shortTs(n.createdAt)}</time></a></li>`,
            )
            .join('')}</ul>`
        : '<div class="card empty"><div class="art" data-icon="bell"></div><p><b style="color:var(--text)">Chưa có thông báo</b><br>Khi lịch đặt đổi trạng thái hoặc có giờ trống, bạn sẽ thấy ở đây.</p></div>'
    }`;
  decorate();
}

async function load() {
  try {
    data = await api.notifications();
    render();
  } catch (e) {
    $('root').innerHTML = `<div class="card empty"><p><b style="color:var(--text)">Không tải được thông báo</b><br>${esc(e.message)}</p></div>`;
  }
}

document.addEventListener('click', async (e) => {
  if (!e.target.closest('#read-all')) return;
  try {
    await api.readAllNotifications();
    await load();
    document.querySelector('.header-actions .dot')?.remove();
    toast('Đã đánh dấu tất cả là đã đọc.');
  } catch (err) {
    toast(err.message, { error: true });
  }
});

await mountShell();
if (!getUser()) redirectToLogin();
else await load();
