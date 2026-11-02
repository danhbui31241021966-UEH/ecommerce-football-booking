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
(server lắng nghe `0.0.0.0`, cookie `secure` nên bắt buộc HTTPS), chạy `npm run db:init` một lần để tạo bảng
(hoặc `npm run db:seed` nếu muốn dữ liệu demo), sau đó `npm start`.
