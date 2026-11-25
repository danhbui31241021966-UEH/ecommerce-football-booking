// Địa chỉ service mail: chỉ sửa ở đây.
// Cùng origin /mail-api: trên VPS đi qua Traefik (router riêng cho /mail-api, không qua nginx); máy local và e2e: prototype-server chuyển tiếp tới service ở máy khi có MAIL_UPSTREAM, vd http://127.0.0.1:4126.
export const MAIL_API = '/mail-api';
