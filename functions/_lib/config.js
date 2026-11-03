// Địa chỉ BE của bản deploy này. File backend.generated.js do scripts/pages-deploy.mjs sinh ra cho từng lần deploy (không commit):
// biến môi trường của Pages chia theo production/preview chứ không theo nhánh, nên nhánh mock sẽ bị lây nếu dùng biến.
// Rỗng = bản mock: Function không chuyển gì và trang chạy dữ liệu giả.
import backend from './backend.generated.js';

export const backendUrl = () => String(backend || '').replace(/\/+$/, '');
