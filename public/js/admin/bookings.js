import { api } from '/js/api.js';
import { mountShell } from '/js/ui/shell.js';
import { shortTs, money, vnToMs, STATUS_LABEL, PAYMENT_LABEL, REFUND_LABEL } from '/js/ui/format.js';
import { showDialog, noteField } from '/js/admin/dialog.js';

const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const actionLabel={create:'Tạo booking',approve:'Duyệt booking',reject:'Từ chối booking',cancel:'Hủy booking',mark_paid:'Ghi nhận đã thu',mark_refunded:'Ghi nhận đã hoàn',attendance:'Ghi nhận có mặt',expire:'Booking hết hạn'};
let rows=[],nowMs=Date.now();
function msg(t,err=false){$('#feedback').textContent=t;$('#feedback').classList.toggle('is-error',err)}
function render(){
 const q=$('#booking-search').value.trim().toLowerCase(),st=$('#booking-status').value;
 const filtered=rows.filter(b=>(!st||b.status===st)&&(!q||[b.code,b.customerName,b.customerPhone,b.venueName].some(v=>String(v||'').toLowerCase().includes(q))));
 $('#booking-count').textContent=`${filtered.length} booking`;
 $('#booking-list').innerHTML=filtered.length?filtered.map(b=>{
  const refundLine=b.status==='cancelled'&&Number(b.refundPercent)===100?`Hoàn 100% · ${money(b.refundAmount||0)} · ${b.paymentStatus==='paid'?esc(REFUND_LABEL[b.refundStatus]||b.refundStatus):'chưa thu tiền'}`:esc(REFUND_LABEL[b.refundStatus]||b.refundStatus);
  const actions=`${['pending','confirmed'].includes(b.status)?`<button class="btn btn-secondary btn-sm" data-op="cancel" data-id="${esc(b.id)}" data-action="danger">Hủy ngoại lệ</button>`:''}${b.paymentStatus==='unpaid'&&['confirmed','completed'].includes(b.status)?`<button class="btn btn-secondary btn-sm" data-op="paid" data-id="${esc(b.id)}">Ghi đã thu</button>`:''}${b.refundStatus==='pending'?`<button class="btn btn-secondary btn-sm" data-op="refund" data-id="${esc(b.id)}">Ghi đã hoàn</button>`:''}${b.status==='confirmed'&&vnToMs(b.startAt)<=nowMs?`<button class="btn btn-secondary btn-sm" data-op="attendance" data-result="completed" data-id="${esc(b.id)}">Đã đá</button><button class="btn btn-secondary btn-sm" data-op="attendance" data-result="no_show" data-id="${esc(b.id)}">Bùng sân</button>`:''}`;
  const actionCount=(actions.match(/<button/g)||[]).length;
  return `<article class="admin-record"><div class="record-grid booking-grid"><div class="record-main"><span class="record-label">Booking / khách</span><button class="record-primary record-primary-button" data-detail="${esc(b.id)}">${esc(b.code)} · Chi tiết</button><span class="record-secondary">${esc(b.customerName)} · ${esc(b.customerPhone)}</span></div><div><span class="record-label">Sân / giờ</span><b>${esc(b.venueName)}</b><span class="record-secondary">${esc(b.courtName)} · ${esc(shortTs(b.startAt))}</span></div><div><span class="record-label">Trạng thái</span><span class="status-badge" data-state="${esc(b.status)}">${esc(STATUS_LABEL[b.status]||b.status)}</span><span class="record-secondary">${esc(PAYMENT_LABEL[b.paymentStatus]||b.paymentStatus)} · ${refundLine}</span></div><div><span class="record-label">Giá booking</span><b>${esc(money(b.price))}</b></div><div class="record-actions" data-action-count="${actionCount}">${actions}</div></div></article>`;
 }).join(''):'<p class="empty-state">Không có booking khớp điều kiện.</p>';
}
async function load(){msg('Đang tải booking…');$('#booking-list').innerHTML='<p class="empty-state">Đang tải dữ liệu…</p>';try{const[meta,data]=await Promise.all([api.meta(),api.admin.bookings({status:$('#booking-status').value||undefined,q:$('#booking-search').value.trim()||undefined})]);nowMs=meta.now?vnToMs(meta.now):Date.now();rows=data;render();msg('')}catch(e){rows=[];$('#booking-list').innerHTML=`<p class="empty-state">Không tải được: ${esc(e.message)}</p>`;msg(e.message,true)}}
function reliabilityText(r){return r?`${r.noShows} lần bùng · ${r.lateCancels} lần hủy muộn · ${r.completed} lần đã đá · ${r.violations}/${r.maxViolations} vi phạm trong ${r.windowDays} ngày${r.restricted?' · booking mới cần chờ duyệt':''}`:'Chưa có dữ liệu độ tin cậy.'}
async function showBooking(id){
 const d=await api.booking(id),history=(d.history||[]).map(h=>`<li><time>${esc(h.createdAt?shortTs(h.createdAt):'—')}</time><div><b>${esc(actionLabel[h.action]||h.action)}</b><span class="record-secondary">${esc(STATUS_LABEL[h.fromStatus]||h.fromStatus||'—')} → ${esc(STATUS_LABEL[h.toStatus]||h.toStatus||'—')}</span>${h.actorName?`<p>${esc(h.actorName)}${h.note?` · ${esc(h.note)}`:''}</p>`:''}</div></li>`).join('');
 const refundDetail=d.status==='cancelled'&&Number(d.refundPercent)===100?`Hoàn 100% (${money(d.refundAmount||0)}) · ${d.paymentStatus==='paid'?REFUND_LABEL[d.refundStatus]||d.refundStatus:'chưa thu tiền'}`:`Hoàn ${Number(d.refundPercent||0)}% (${money(d.refundAmount||0)}) · ${REFUND_LABEL[d.refundStatus]||d.refundStatus}`;
 const body=`<dl class="detail-grid"><div class="detail-item"><dt>Khách hàng</dt><dd><b>${esc(d.customerName)}</b><br>${esc(d.customerPhone)}<br>${esc(d.customerEmail)}</dd></div><div class="detail-item"><dt>Sân / giờ</dt><dd>${esc(d.venueName)} · ${esc(d.courtName)}<br>${esc(shortTs(d.startAt))}–${esc(d.endAt?.slice(11,16)||'')}</dd></div><div class="detail-item"><dt>Trạng thái</dt><dd>${esc(STATUS_LABEL[d.status]||d.status)} · ${esc(PAYMENT_LABEL[d.paymentStatus]||d.paymentStatus)}</dd></div><div class="detail-item"><dt>Tiền / hoàn tiền</dt><dd>${esc(money(d.price))} · ${esc(refundDetail)}</dd></div><div class="detail-item"><dt>Độ tin cậy khách</dt><dd>${esc(reliabilityText(d.customerReliability))}</dd></div><div class="detail-item"><dt>Ghi chú khách</dt><dd>${esc(d.customerNote||'—')}</dd></div></dl><h3 class="h3">Lịch sử trạng thái</h3>${history?`<ol class="detail-history">${history}</ol>`:'<p>Chưa có lịch sử.</p>'}`;
 await showDialog({title:`Chi tiết booking ${d.code}`,body,hideConfirm:true,cancel:'Đóng'});
}
async function runAction(button){
 const id=button.dataset.id,op=button.dataset.op;let data;
 if(op==='cancel'){const booking=rows.find(x=>String(x.id)===id);data=await showDialog({title:'Hủy booking ngoại lệ?',body:`<p>Admin hủy sẽ hoàn 100% số tiền đã thu (${esc(money(booking?.paymentStatus==='paid'?booking.price:0))}) theo R7.</p>${noteField('Lý do hủy',{name:'reason',required:true,placeholder:'Gửi lý do cho khách'})}`,confirm:'Hủy booking',danger:true})}
 else if(op==='paid')data=await showDialog({title:'Ghi nhận đã thu tiền?',body:`<p>Xác nhận đã nhận ${esc(money(rows.find(x=>String(x.id)===id)?.price))} cho booking này.</p>${noteField('Ghi chú (không bắt buộc)',{placeholder:'Ví dụ: nhận chuyển khoản lúc 18:40'})}`,confirm:'Đã thu tiền'});
 else if(op==='refund')data=await showDialog({title:'Ghi nhận đã hoàn tiền?',body:`<p>Chỉ xác nhận sau khi đã hoàn tiền cho khách.</p>${noteField('Ghi chú (không bắt buộc)',{placeholder:'Ví dụ: mã giao dịch'})}`,confirm:'Đã hoàn tiền'});
 else data=await showDialog({title:button.dataset.result==='completed'?'Đánh dấu đã đá?':'Đánh dấu bùng sân?',body:`<p>${button.dataset.result==='completed'?'Ghi nhận khách đã hoàn tất trận đấu.':'Xác nhận khách không đến sân. Thao tác này ảnh hưởng độ tin cậy và không thể hoàn tác tại đây.'}</p>`,confirm:button.dataset.result==='completed'?'Đã đá':'Đánh dấu bùng',danger:button.dataset.result==='no_show'});
 if(!data)return;
 if(op==='cancel')await api.admin.cancel(id,data.reason.trim());else if(op==='paid')await api.admin.markPaid(id,data.note.trim());else if(op==='refund')await api.admin.markRefunded(id,data.note.trim());else await api.admin.attendance(id,button.dataset.result);
 msg(op==='cancel'?'Đã hủy booking · hoàn 100% theo R7.':'Đã cập nhật booking.');await load();
}
$('#booking-filter').onclick=load;$('#booking-search').addEventListener('keydown',e=>{if(e.key==='Enter')load()});$('#booking-status').addEventListener('change',load);
$('#booking-list').addEventListener('click',async e=>{const button=e.target.closest('button');if(!button)return;try{if(button.dataset.detail)await showBooking(button.dataset.detail);else if(button.dataset.op)await runAction(button)}catch(err){msg(err.message,true)}});
mountShell();load();
