// Giới hạn tần suất cửa sổ trượt, trong bộ nhớ, có trần số khóa. Khi bảng đầy và không dọn được:
//  - mặc định đóng an toàn: khóa mới bị từ chối (dùng cho người nhận, vì đó là thứ bảo vệ hộp thư người khác);
//  - evictOldest: đẩy khóa chèn sớm nhất ra nhường chỗ (không phải khóa lâu không dùng; dùng cho IP: kẻ nạp nhiều IP giả không khóa được người thật,
//    còn số thư vẫn bị chặn bởi giới hạn người nhận và trần ngày).
class SlidingLimiter {
  constructor({ max, windowMs, maxKeys = 10000, evictOldest = false, now = Date.now }) {
    Object.assign(this, { max, windowMs, maxKeys, evictOldest, now });
    this.hits = new Map();
  }
  _fresh(key) {
    const t = this.now();
    const arr = (this.hits.get(key) || []).filter((x) => x > t - this.windowMs);
    if (arr.length) this.hits.set(key, arr); else this.hits.delete(key);
    return arr;
  }
  // Giây phải chờ nếu hết lượt, 0 nếu còn.
  wait(key) {
    const arr = this._fresh(key);
    if (arr.length >= this.max) return Math.max(1, Math.ceil((arr[0] + this.windowMs - this.now()) / 1000));
    if (!arr.length && this.hits.size >= this.maxKeys) {
      this.sweep();
      if (this.evictOldest && this.hits.size >= this.maxKeys) this.hits.delete(this.hits.keys().next().value);
      if (this.hits.size >= this.maxKeys) return Math.ceil(this.windowMs / 1000);
    }
    return 0;
  }
  record(key) {
    const arr = this._fresh(key);
    arr.push(this.now());
    this.hits.set(key, arr);
  }
  sweep() { for (const k of [...this.hits.keys()]) this._fresh(k); }
}

// Kiểm tất cả rồi mới ghi: [{limiter,key}]. Trả 0 nếu qua, ngược lại giây chờ lớn nhất.
function consume(checks) {
  let wait = 0;
  for (const { limiter, key } of checks) wait = Math.max(wait, limiter.wait(key));
  if (wait) return wait;
  for (const { limiter, key } of checks) limiter.record(key);
  return 0;
}

module.exports = { SlidingLimiter, consume };
