# SânNhanh – Website đặt sân bóng đá mini 5/7 người tại TP.HCM

Đồ án môn Phát triển ứng dụng Thương mại điện tử – Nhóm 8.

Khách tìm sân, xem giá và lịch trống, đặt **1 sân con + 1 slot cố định** và theo dõi trạng thái trên web.
Chủ sân quản lý sân, slot, giá, chặn lịch đặt ngoài web, duyệt booking, ghi nhận thanh toán/hoàn tiền.
Admin cấp tài khoản chủ sân và chỉ can thiệp booking khi có tranh chấp/sự cố.

## Công nghệ

| Lớp | Công nghệ |
| --- | --- |
| Frontend | HTML5, CSS3, JavaScript (ES modules, không framework) |
| Backend | Node.js 20+ + Express 5 |
| Database | MySQL 8 |
| Bảo mật | bcrypt, session lưu trong MySQL, CSRF token, Helmet (CSP), rate limit đăng nhập |

## Chạy trên máy

1. Cài Node.js 20+ và MySQL 8. Tạo database và user:

   ```sql
   CREATE DATABASE football_booking CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'fb_app'@'localhost' IDENTIFIED BY 'mat_khau_cua_ban';
   GRANT ALL ON football_booking.* TO 'fb_app'@'localhost';
   ```

2. Cấu hình và cài đặt:

   ```bash
   cp .env.example .env      # sửa DB_PASSWORD, SESSION_SECRET
   npm install
   npm run db:init           # tạo lại toàn bộ bảng từ db/schema.sql (XÓA dữ liệu cũ)
   npm run db:seed           # nạp dữ liệu demo: 34 sân thật + 6 sân demo + tài khoản demo (XÓA dữ liệu cũ)
   npm start                 # http://localhost:3000, giao diện chạy chế độ thật
   ```

   Giao diện do Express phục vụ chạy với API thật; bản tĩnh (Cloudflare, `npm run prototype` ở cổng 4100) vẫn là dữ liệu giả.
   Ở máy local thêm `?mode=mock` hoặc `?mode=real` vào URL để đổi (nhớ trong localStorage, `?mode=` để xóa).
   Khi không phải production, `/api/dev/*` cho phép đặt lại dữ liệu demo, tua đồng hồ server và đăng nhập nhanh theo vai trò.

3. Kiểm thử: `npm test` (cần MySQL). Bộ chạy tự tạo CSDL `football_booking_test_<ngẫu nhiên>` bằng chính `DB_USER`
   (cần quyền ALL trên các CSDL tên `football_booking_test_%`), chạy mọi test trên đó rồi xóa. Chạy một file:
   `npm test -- tests/booking.race.test.js`.

### Tài khoản demo (mật khẩu chung `Matkhau@123`)

| Vai trò | Email |
| --- | --- |
| Admin | admin@datsan.local |
| Chủ sân (Hoàng Gia, Thành Công, Quận 7 Sunrise) | chusan1@datsan.local |
| Chủ sân (Bình Thạnh Xanh, Phú Nhuận Arena, Thủ Đức Riverside) | chusan2@datsan.local |
| Khách hàng | khach1@datsan.local, khach2@datsan.local |

Sân **Thành Công** và **Quận 7 Sunrise** bật yêu cầu duyệt để demo luồng chờ xác nhận / hết hạn.

## Cấu trúc

```
src/
  app.js, server.js, config.js, db.js
  middleware/   auth (phân quyền), csrf, error
  routes/       auth, venues (công khai), bookings (khách), owner, admin, notifications
  services/     slots (hàm thuần: slot, giá, hoàn tiền), schedule (lịch trống), bookings (nghiệp vụ booking)
db/schema.sql   lược đồ MySQL
scripts/        db-init, dữ liệu mẫu
public/         giao diện (index, venues, venue, login, register, my-bookings, notifications, owner, admin)
tests/          unit test + integration test nghiệp vụ booking
```

## Các quy tắc nghiệp vụ được hiện thực

- **Chống trùng lịch (NFR04):** do CSDL bảo đảm (UNIQUE `uq_booking_slot` + bảng `slot_claims`, xem đầu `db/schema.sql`),
  code chỉ đổi lỗi trùng khóa thành 409. Test `tests/booking.race.test.js`: nhiều khách đặt cùng ô cùng lúc → đúng 1 thành công.
- **Gửi lặp:** mỗi lần mở form đặt sân sinh một `idempotencyKey`; gửi lại cùng mã trả về booking cũ.
- **Giá tính ở server**, không tin giá client gửi lên. Giá, điều kiện sử dụng, chính sách hủy và hướng dẫn thanh toán
  được lưu snapshot vào booking.
- **Chờ duyệt:** sân bật `requiresApproval` → booking ở trạng thái Chờ xác nhận, giữ slot 15 phút (R3, `src/rules.js`).
  Job chạy mỗi 15 giây (và chạy ngay trước khi tạo/duyệt booking) chuyển booking quá hạn sang Hết hạn.
- **Hủy/hoàn:** khách hủy ≥24h hoàn 100%, 12–<24h hoàn 50%, <12h không hoàn; chủ sân/Admin hủy (bắt buộc lý do) hoàn 100%.
  Hoàn tiền thủ công, web lưu số tiền và trạng thái Chưa hoàn/Đã hoàn.
- **Phân quyền ở server:** mỗi request nạp lại user từ DB (tài khoản bị khóa mất quyền ngay); chủ sân chỉ thấy sân của mình;
  truy cập booking của người khác trả 404.
- Mọi thay đổi trạng thái, thanh toán, hoàn tiền được ghi vào `booking_history`; thông báo trong web cho khách và chủ sân.

## Bổ sung/làm rõ so với tài liệu Buổi 1

Những điểm tài liệu chưa nói rõ, nhóm đã chốt khi triển khai:

- Mỗi sân con có **giá thường** và **giá giờ vàng**; chủ sân đặt khung giờ vàng cho cụm sân.
- Khách **được hủy booking đang Chờ xác nhận** (không phát sinh hoàn tiền).
- **Tiền hoàn tính trên số tiền đã thanh toán**: booking chưa thanh toán thì số tiền hoàn = 0.
- Chống trùng áp dụng cho **cả booking Chờ xác nhận còn hạn**, không chỉ Đã xác nhận.
- Không đặt slot đã qua; chỉ đặt trước tối đa 3 ngày (R1, `src/rules.js`).
- Chủ sân nhận **thông báo trong web khi có booking mới**; trang quản lý tự làm mới và hiện cảnh báo booking chờ duyệt.
- Mỗi cụm sân có ô **hướng dẫn thanh toán** (STK/tiền mặt) hiển thị khi đặt.
- Sân con **không xóa cứng**, chỉ ngừng hoạt động để giữ lịch sử booking.
- Trang chi tiết có link **Google Maps** tạo từ địa chỉ (không dùng API bản đồ).
- Chủ sân không hủy được booking đã đến giờ đá; trường hợp sự cố do Admin xử lý.

Ngoài phạm vi MVP (giữ nguyên quyết định nhóm): payment gateway, đặt định kỳ, đổi lịch trực tiếp, review, GPS,
email/SMS/Zalo, social login, đa môn.

## Triển khai (deploy)

Cần một nền tảng chạy Node.js và một MySQL 8. Đặt các biến môi trường như `.env.example`, thêm `NODE_ENV=production`
(server chỉ lắng nghe `127.0.0.1`, ra mạng qua tunnel và Pages Function, xem mục dưới; cookie `secure` nên bắt buộc HTTPS), chạy `npm run db:init` một lần để tạo bảng
(hoặc `npm run db:seed` nếu muốn dữ liệu demo), sau đó `npm start`.

## Chạy demo Pages qua BE trên máy Mac

Web vẫn chạy trên Cloudflare Pages; Express/MySQL chạy local. Quick Tunnel `trycloudflare.com` chỉ là địa chỉ tạm, đổi sau mỗi lần bật tunnel; không cần domain hay tunnel trả phí.

### Cài cloudflared

Đã cài binary chính thức Cloudflare tại `~/.local/bin/cloudflared` trên macOS Apple Silicon. Phiên bản `2026.10.7`, lấy từ GitHub Release `cloudflare/cloudflared` (`cloudflared-darwin-arm64.tgz`); SHA-256 đã đối chiếu với digest của GitHub Release: `3586ccf397e98e5f437e60e7c307ca6ac463e110580503af8bb8e6f9ebf831bd`. Không cần Homebrew hoặc `sudo`.

### Chuẩn bị và bật/tắt

1. Copy `.env.example` thành `.env` nếu chưa có; `DB_USER` phải là `fb_app` (không dùng root), và database trong `DB_NAME` phải được tạo/schema hóa trước. Mật khẩu MySQL root không thuộc cấu hình app; file local là `~/.local/mysql-root.secret` (quyền `600`). `~/.local/mysql.cnf` được giữ nguyên; nó không còn đăng nhập root passwordless được sau khi đổi mật khẩu.
2. Chạy **một lần** `npm run demo:setup`. Lệnh chỉ tạo `PROXY_SECRET` và `SEPAY_API_KEY` nếu thiếu hoặc còn bắt đầu bằng `change_me`; giữ nguyên giá trị thật đã có, không in secret ra, và chỉ sửa `.env` của worktree đang chạy. `SESSION_SECRET` hiện có phải tối thiểu 32 ký tự và không phải placeholder; `DB_PASSWORD` không được bắt đầu bằng `change_me` (được phép để trống theo cấu hình server).
3. Đặt Pages secret cho **Preview** một lần, phải cùng giá trị với `PROXY_SECRET` trong `.env`. Trên Wrangler 4.111, lệnh `--env preview` đã được xác nhận và báo rõ môi trường; secret chỉ có hiệu lực sau lần deploy tiếp theo. Chạy tại root worktree; giá trị đi qua stdin, không vào history/command line:

   ```bash
   PROXY_SECRET="$(node -e 'const d=require("dotenv"); process.stdout.write(d.parse(require("fs").readFileSync(".env","utf8")).PROXY_SECRET)')" && printf %s "$PROXY_SECRET" | npx --no-install wrangler pages secret put PROXY_SECRET --project-name sannhanh --env preview
   ```

   Cần đăng nhập Wrangler và project `sannhanh` đã tồn tại. Production secret do Pine đặt, không chạy trong demo. Lệnh production có `--env production` tường minh; không bỏ cờ vì Wrangler mặc định vào production:

   ```bash
   PROXY_SECRET="$(node -e 'const d=require("dotenv"); process.stdout.write(d.parse(require("fs").readFileSync(".env","utf8")).PROXY_SECRET)')" && printf %s "$PROXY_SECRET" | npx --no-install wrangler pages secret put PROXY_SECRET --project-name sannhanh --env production
   ```
4. Bật một branch preview tường minh (branch `main` bị chặn):

   ```bash
   npm run demo:up -- --branch tunnel-test
   ```

   Production chỉ do Pine chạy sau khi đã cấu hình production `PROXY_SECRET`:

   ```bash
   npm run demo:up -- --branch main --production
   ```

   `--production` chỉ hợp lệ cùng `--branch main`; thiếu cờ thì `main` bị từ chối, còn branch preview đi với cờ này cũng bị từ chối. Lệnh production chưa được chạy trong lần chuẩn bị này.

   Lệnh bật MySQL bằng `~/.local/mysql.cnf` nếu chưa chạy, chạy Express với `NODE_ENV=production`, `HOST=127.0.0.1`, cổng cố định `3000`, tạo quick tunnel, kiểm tra `GET /api/venues` bằng header `X-SN-Proxy-Secret` (retry có giới hạn 60 giây; nếu macOS giữ NXDOMAIN thì kiểm tra qua DNS công khai 1.1.1.1 và cùng hostname/SNI), rồi deploy Pages với URL tunnel làm backend, sau đó kiểm tra `/api/venues` qua Pages Preview cũng trả 200 (giúp phát hiện thiếu/sai Preview `PROXY_SECRET`). Nếu cổng `3000` đã có listener thì dừng với lỗi rõ ràng, không chọn cổng khác và không đụng listener đó. Không có branch mặc định; `demo:up` chỉ đi vào production nếu có `--branch main --production` tường minh. Lệnh production ở trên thuộc Pine; không chạy nó khi chỉ muốn Preview.
5. Tắt demo bằng `npm run demo:down`. Lệnh chỉ gửi signal tới PID Express/cloudflared mà demo ghi trong `.demo-state.json`, sau khi so khớp PID, thời điểm start và command; không dùng `pkill`. **MySQL vẫn để chạy**, kể cả khi `demo:up` vừa khởi động nó. PID/log được lưu ở `.demo-state.json` và `.demo-logs/`, đã gitignore. Chạy `demo:up` lần nữa khi cùng branch và tiến trình còn khỏe sẽ không sinh process thứ hai.

### Nạp lại dữ liệu demo

`npm run demo:seed -- --yes` sẽ xóa toàn bộ dữ liệu hiện tại trong database `DB_NAME` rồi nạp lại dữ liệu demo. Đây là thao tác hủy dữ liệu, bắt buộc cờ `--yes`; không chạy nếu cần giữ dữ liệu hiện có. Lệnh dùng tài khoản `DB_USER` trong `.env`, từ chối dùng root, và không chạy tự động khi bật server.

`SEPAY_API_KEY` được sinh ngẫu nhiên để không dùng placeholder. Khi/ nếu cấu hình webhook SePay, lấy giá trị từ `.env` và dán vào phần cấu hình webhook bên SePay; chưa có webhook nào được cài bởi các lệnh demo. Việc gắn webhook thuộc Pine/chủ dự án.

### Phạm vi bảo mật và kiểm thử

Production BE chỉ chấp nhận request có `X-SN-Proxy-Secret` đúng; thiếu/sai key trả `404 Not Found`. Không chia sẻ secret qua log/chat hoặc truyền qua command line. `demo:up` gửi header cả khi kiểm endpoint local lẫn qua tunnel. Các kiểm thử tích hợp phải dùng code đã ghép `src/productionCheck.js` và `src/middleware/proxy.js`; code cũ trước khi ghép không có cổng proxy này và không được đưa ra tunnel công khai.
