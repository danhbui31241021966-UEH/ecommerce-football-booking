// Chuyển nguyên vẹn /api/* tới BE (Express trên Mac, qua Cloudflare tunnel). Cookie phiên là first-party của sannhanh.pages.dev, không mở CORS.
// Code ở đây không hiểu nội dung request/response: chỉ gắn hai header tin cậy, bỏ header giả, chuyển và báo "BE tắt".
import { backendUrl } from '../_lib/config.js';

// Header chỉ Function này được đặt; khách gửi vào thì bỏ. Forwarded/XFF của khách cũng bỏ để BE chỉ tin X-SN-Client-IP.
const STRIP = ['x-sn-proxy-secret', 'x-sn-client-ip', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'forwarded', 'host'];
const BACKEND_TIMEOUT_MS = 20000;

const down = () =>
  new Response(JSON.stringify({ error: 'Hệ thống đang tạm nghỉ' }), {
    status: 503,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-sn-down': '1' },
  });

// Tunnel chết: Cloudflare trả 52x/530 hoặc 502/503/504 dạng HTML. Lỗi do BE tự trả luôn là JSON nên không bị coi là "tắt".
const isTunnelError = (res) => (res.status >= 520 && res.status <= 530) || ([502, 503, 504].includes(res.status) && !(res.headers.get('content-type') || '').includes('json'));

export async function onRequest({ request, env }) {
  const base = backendUrl();
  if (!base) return env.ASSETS.fetch(request); // bản mock: không có BE

  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  for (const h of STRIP) headers.delete(h);
  headers.set('x-sn-proxy-secret', env.PROXY_SECRET || '');
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) headers.set('x-sn-client-ip', ip);

  const hasBody = !['GET', 'HEAD'].includes(request.method);
  let res;
  try {
    res = await fetch(new Request(base + url.pathname + url.search, { method: request.method, headers, body: hasBody ? request.body : undefined, redirect: 'manual', signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS) }));
  } catch {
    return down();
  }
  if (isTunnelError(res)) return down();
  return new Response(res.body, res); // giữ nguyên status, Set-Cookie, Content-Type
}
