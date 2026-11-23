// Trang đích sau đăng nhập lấy từ ?next=: chỉ nhận đường dẫn cùng nguồn với trang hiện tại.
// Trình duyệt coi "\" như "/" và bỏ qua tab/xuống dòng, nên "/\host" hay "/\t/host" thành "//host" (trang ngoài);
// vì vậy phân tích bằng URL thay vì so tiền tố chuỗi. Đường dẫn chuẩn hoá ra "//…" (vd "/.//host") cũng bị loại
// vì gán lại vào location sẽ thành URL ngoài.
export function safeNext(next, origin) {
  if (!next) return null;
  let url;
  try { url = new URL(next, origin); } catch { return null; }
  if (url.origin !== origin || url.pathname.startsWith('//')) return null;
  return url.pathname + url.search + url.hash;
}
