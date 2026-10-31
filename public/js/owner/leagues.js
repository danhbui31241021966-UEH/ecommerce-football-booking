// Giải đấu của chủ sân: danh sách giải ở sân đang chọn và hộp tạo giải mới.
import { $, esc, initPage, loadVenues, venueSelect, errorBox, api, dialog, guard, toast, mountViewSwitch } from './common.js';

const content = $('#content');
let venues = [];
let venueId;

export const STATUS_TEXT = { draft: 'Đang soạn', published: 'Đã công bố', ongoing: 'Đang đá', finished: 'Đã kết thúc' };
const STATUS_HINT = {
  draft: 'Chưa công bố. Xếp giờ cho đủ các trận rồi bấm công bố.',
  published: 'Đã công bố, chưa đá trận nào.',
  ongoing: 'Đang đá, nhập tỉ số sau mỗi trận.',
  finished: 'Đá xong hết các trận.',
};

async function load() {
  content.innerHTML = '<div class="skeleton" style="height:200px"></div>';
  try {
    const list = await api.owner.leagues(venueId);
    const v = venues.find((x) => x.id === venueId);
    $('#sub').textContent = `${v.name} · ${list.length} giải`;
    const cards = list.length
      ? `<ul class="plain-list">${list
          .map(
            (l) => `<li><a class="lg-card" href="/owner-league.html?id=${l.id}" data-id="${l.id}">
              <strong>${esc(l.name)}</strong>
              <span class="muted">Sân ${esc(l.fieldType)} người · ${l.teams}/${l.teamCount} đội · ${l.done}/${l.matches || '–'} trận đã đá</span>
              <span><span class="badge badge-lg-${l.status}">${STATUS_TEXT[l.status]}</span> <span class="muted">${STATUS_HINT[l.status]}</span></span></a></li>`,
          )
          .join('')}</ul>`
      : '<div class="empty"><p>Sân này chưa có giải nào. Tạo giải để các đội cùng đá vòng tròn tại sân của bạn.</p></div>';
    content.innerHTML = `<div class="lg-sec"><button class="btn btn-primary" type="button" id="new-league">Tạo giải mới</button></div>${cards}`;
    $('#new-league').onclick = createDialog;
  } catch (err) {
    errorBox(content, err, load);
  }
}

async function createDialog() {
  const v = venues.find((x) => x.id === venueId);
  const types = [...new Set(v.courts.filter((c) => c.isActive).map((c) => c.fieldType))].filter((t) => ['5', '7'].includes(t));
  if (!types.length) {
    toast('Sân này chưa có sân con 5 hoặc 7 người nên chưa tạo giải được.', { error: true });
    return;
  }
  const data = await dialog({
    title: 'Tạo giải mới',
    confirm: 'Tạo giải',
    body: `<p class="muted">Đá vòng tròn một lượt tại ${esc(v.name)}. Tạo xong bạn nhập đội, xếp giờ rồi mới công bố.</p>
      <div class="field"><label for="lg-name">Tên giải</label><input class="input" id="lg-name" name="name" maxlength="80" required data-label="tên giải" placeholder="Ví dụ: Giải phủi mùa thu"></div>
      <div class="field"><label for="lg-type">Loại sân</label><select class="select" id="lg-type" name="fieldType">${types.map((t) => `<option value="${t}">Sân ${t} người</option>`).join('')}</select></div>
      <div class="field"><label for="lg-count">Số đội (4 đến 8)</label><select class="select" id="lg-count" name="teamCount">${[4, 5, 6, 7, 8].map((n) => `<option value="${n}">${n} đội</option>`).join('')}</select><span class="hint">Mỗi đội gặp các đội còn lại một trận.</span></div>
      <div class="field"><label for="lg-link">Link nhóm Zalo hoặc fanpage (không bắt buộc)</label><input class="input" id="lg-link" name="link" type="url" inputmode="url" maxlength="300" placeholder="https://zalo.me/g/..."></div>
      <p class="muted">Điều lệ có sẵn (xếp hạng, rút đội, lệ phí), bạn sửa được sau khi tạo.</p>`,
  });
  if (!data) return;
  await guard(null, async () => {
    const l = await api.owner.createLeague({ venueId, name: data.name, fieldType: data.fieldType, teamCount: Number(data.teamCount), link: data.link || '' });
    location.href = `/owner-league.html?id=${l.id}`;
  });
}

if (await initPage()) {
  try {
    ({ venues, id: venueId } = await loadVenues());
    if (!venues.length) {
      content.innerHTML = '<div class="empty"><p>Bạn chưa có sân nào.</p><a class="btn btn-primary" href="/owner-settings.html">Thêm sân</a></div>';
    } else {
      mountViewSwitch('leagues');
      $('#tools').innerHTML = '<label class="sr-only" for="venue">Sân của bạn</label><select class="select" id="venue"></select>';
      venueSelect($('#venue'), venues, venueId, (id) => {
        venueId = id;
        load();
      });
      await load();
    }
  } catch (err) {
    errorBox(content, err, () => location.reload());
  }
}
