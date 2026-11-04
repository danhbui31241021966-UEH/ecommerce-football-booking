// Bản tĩnh (Cloudflare, prototype cổng 4100): luôn chạy dữ liệu giả.
// Khi Express phục vụ giao diện, nó trả một mode.js khác tại đúng đường dẫn này (src/app.js) để bật chế độ thật.
export const SERVED_BY_API = false;
export const DEV_TOOLS = false;
