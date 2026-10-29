const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function showDialog({ title, body = '', confirm = 'Xác nhận', cancel = 'Để sau', danger = false, hideConfirm = false }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'modal admin-modal';
    dlg.innerHTML = `<form novalidate>
      <div class="modal-head"><h2 class="h2">${esc(title)}</h2><span class="spacer"></span><button class="icon-btn" type="button" data-close aria-label="Đóng">×</button></div>
      <div class="modal-body">${body}<p class="form-error" role="alert" hidden></p></div>
      <div class="modal-foot"><button class="btn btn-ghost" type="button" data-close>${esc(cancel)}</button>${hideConfirm ? '' : `<button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="submit">${esc(confirm)}</button>`}</div>
    </form>`;
    let result = null;
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); }, { once: true });
    dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });
    dlg.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const missing = [...form.querySelectorAll('[required]')].find((field) => !String(field.value).trim());
      if (missing) {
        const error = form.querySelector('.form-error');
        error.textContent = `Vui lòng nhập ${missing.dataset.label || 'thông tin còn thiếu'}.`;
        error.hidden = false;
        missing.focus();
        return;
      }
      result = Object.fromEntries(new FormData(form));
      dlg.close();
    });
    document.body.append(dlg);
    dlg.showModal();
    (dlg.querySelector('[autofocus],textarea,input,select') || dlg.querySelector('[type="submit"]') || dlg.querySelector('[data-close]'))?.focus();
  });
}

export const noteField = (label, { name = 'note', required = false, placeholder = '' } = {}) =>
  `<div class="field"><label for="${esc(name)}">${esc(label)}</label><textarea class="textarea" id="${esc(name)}" name="${esc(name)}" rows="3" placeholder="${esc(placeholder)}" ${required ? `required data-label="${esc(label.toLowerCase())}"` : ''}></textarea></div>`;
