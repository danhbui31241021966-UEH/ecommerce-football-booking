// Đã bỏ: demo qua tunnel + Cloudflare Pages không còn. Web chạy trên VPS; Pages chỉ chuyển hướng 301 (scripts/pages-deploy.mjs --redirect-to).
console.error('demo:up đã bỏ: web chạy trên VPS https://ggo.srv1741374.hstgr.cloud, còn Cloudflare Pages chỉ chuyển hướng 301 về đó nên không còn bản demo đầy đủ để deploy.');
process.exit(1);
