// Có BE thì bản tĩnh chạy chế độ thật, giống Express (src/app.js trả mode.js tương tự). Không có BE (nhánh mock) thì dùng file tĩnh public/js/mode.js.
import { backendUrl } from '../_lib/config.js';

export async function onRequest({ request, env }) {
  if (!backendUrl()) return env.ASSETS.fetch(request);
  return new Response('export const SERVED_BY_API = true;\nexport const DEV_TOOLS = false;\n', {
    headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' },
  });
}
