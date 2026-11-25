// Địa chỉ service mail: chỉ sửa ở đây.
//  - VPS, máy local, e2e: cùng origin /mail-api (trên VPS đi qua Traefik, router riêng cho /mail-api, không qua nginx; prototype-server chuyển tiếp tới service ở máy khi có MAIL_UPSTREAM, vd http://127.0.0.1:4126).
//  - Bản tĩnh trên Cloudflare Pages: gọi sang VPS (origin này nằm trong connect-src của CSP ở src/static-site.js).
const PAGES_MAIL_API = 'https://ggo.srv1741374.hstgr.cloud/mail-api';
const onPages = typeof location !== 'undefined' && location.hostname.endsWith('.pages.dev');
export const MAIL_API = onPages ? PAGES_MAIL_API : '/mail-api';
