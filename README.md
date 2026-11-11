# GGO – Website đặt sân bóng đá mini tại TP.HCM

**Thấy sân trống, đặt là đá.** Đồ án môn Phát triển ứng dụng Thương mại điện tử – Nhóm 8.

GGO giúp người chơi tìm sân bóng mini 5/7 người theo giờ, xem giá và lịch trống, đặt sân và theo dõi lịch đặt. Chủ sân quản lý sân, giá, lịch và xác nhận thanh toán; quản trị viên hỗ trợ tài khoản và các trường hợp ngoại lệ. Khách có thể xem sân mà không cần đăng nhập. Website không giữ tiền; khách chuyển khoản trực tiếp cho chủ sân.

## Các trang

- `index.html` – Trang chủ, tìm theo ngày/giờ/loại sân/khu vực và xem giờ gần nhất còn trống.
- `products.html` – Tìm theo tên sân; lọc ngày, giờ, quận, loại sân (5/7 người), giá và giờ chót; sắp xếp giá tăng/giảm.
- `product-detail.html` – Thông tin sân, lịch giờ và luồng đặt sân; lưu giờ cụ thể vào giỏ giờ.
- `cart.html` – Xem các giờ đã lưu, tình trạng và giá mới nhất; bỏ giờ hoặc mở lại lịch để đặt.
- `about.html` – Giới thiệu GGO.
- Tài khoản khách: `login.html`, `register.html`, `my-bookings.html`, `booking.html`, `notifications.html`.
- Pass sân: `transfers.html`, `transfer.html`.
- Ghép kèo: `matches.html`, `match.html`, `match-new.html`.
- Nhờ báo giá: `requests.html`, `request.html`, `request-new.html`.
- Giải đấu: `leagues.html`, `league.html`.
- Chủ sân: `owner.html`, `owner-schedule.html`, `owner-bookings.html`, `owner-settings.html`, `owner-requests.html`, `owner-leagues.html`, `owner-league.html`.
- Quản trị: `admin.html`, `admin-bookings.html`, `admin-logs.html`.

## Chức năng Buổi 3

- Tìm sân theo tên; kết hợp với lọc quận, loại sân 5/7 người và các bộ lọc có sẵn; sắp xếp theo giá tăng dần/giảm dần. Mặc định vẫn ưu tiên giờ có thể đặt.
- Trang danh sách sân lấy dữ liệu qua API/mock; chi tiết sân mở theo `id` trên URL.
- Giỏ giờ lưu từng khung giờ cụ thể trong trình duyệt (`localStorage`), mỗi dòng là một chỗ riêng, không có số lượng `+`/`−`. Lịch và giá được tải lại trước khi hiển thị; giờ không còn trống bị loại khỏi tổng và không thể đặt từ giỏ.
- Giỏ chỉ là danh sách nháp, **không giữ chỗ**. Đặt từng giờ qua luồng booking hiện tại; chủ sân có thể nhận yêu cầu/giữ giờ theo luật GGO. GGO không gom nhiều giờ thành một đơn thanh toán.

## Công nghệ

- Giao diện: HTML5, CSS3 và JavaScript ES modules, không dùng framework.
- Máy chủ: Node.js 20+ và Express 5; dữ liệu nghiệp vụ và phiên đăng nhập lưu trong MySQL 8.
- Kiểm thử: bộ test Node.js và kiểm thử trình duyệt Playwright.

## Mở website

- **Bản live:** https://ggo-datsan.pages.dev – triển khai tĩnh trên Cloudflare Pages, dùng dữ liệu mẫu trong `mock/`, không kết nối backend hay MySQL. File `js/mode.js` của bản tĩnh đặt `SERVED_BY_API = false`.
- **Prototype trên máy:** `npm install`, sau đó `npm run prototype`; mở http://localhost:4100. Chạy bằng dữ liệu mẫu, không cần MySQL.
- **Chạy đầy đủ trên máy:** cần Node.js 20+ và MySQL 8. Tạo database/user MySQL riêng theo cấu hình cục bộ, sao chép `.env.example` thành `.env` và điền thông tin kết nối, rồi chạy:

  ```bash
  npm install
  npm run db:init
  npm run db:seed
  npm start
  ```

  Mở http://localhost:3000. Express bật chế độ API thật, kết nối MySQL cho dữ liệu nghiệp vụ và phiên đăng nhập, đồng thời phục vụ danh sách tệp tĩnh cho phép (các trang HTML ở gốc cùng `css/`, `fonts/`, `images/`, `js/`, `mock/`, `robots.txt`, `sitemap.xml`, `favicon.ico`). Môi trường không production có thêm công cụ demo. Không đưa `.env` lên GitHub. `npm run db:init` và `npm run db:seed` khởi tạo lại dữ liệu; chỉ chạy trên database dành cho dự án. Nếu chạy trên MySQL đã có dữ liệu cũ, cần chạy migration `db/migrations/202611040001_image_path_images.sql` để đổi đường dẫn ảnh sân trong DB từ `/img/` sang `/images/`. Chưa chạy migration thì ảnh vẫn hiện nhờ redirect `/img` → `/images`. Bản live trên Pages hiện dùng dữ liệu mock nên chưa cần migration này.

## Kiểm thử responsive

Báo cáo đo 4 trang chính tại 1366, 768 và 390 px bằng Playwright/Chrome. Không tràn ngang ở cả 12 trường hợp; danh sách đổi 3/2/1 cột; menu không chồng lấn; banner đủ nội dung; ảnh tải đúng và không méo (52 ảnh có `alt`, `width`, `height`); các nút và ô chọn trên điện thoại cao tối thiểu 44 px sau khi sửa. Băng thẻ “Sân còn trống” trên trang chủ cuộn ngang trong khung riêng theo thiết kế, không làm tràn toàn trang. Số liệu chi tiết và giới hạn kiểm thử tại [docs/buoi2/bao-cao.md, mục 7](docs/buoi2/bao-cao.md#vii-responsive).

## Kiểm thử Buổi 3

1. Cài dependencies: `npm install`.
2. Terminal 1: chạy mock prototype, ví dụ `PROTO_PORT=4123 npm run prototype`.
3. Terminal 2, từ cùng repo: chạy tìm kiếm/sắp xếp ở điện thoại và desktop:

   ```bash
   U=http://127.0.0.1:4123 node e2e/b3-search.mjs 390
   U=http://127.0.0.1:4123 node e2e/b3-search.mjs 1366
   node --test tests/cart.test.js
   U=http://127.0.0.1:4123 node e2e/b3-cart.mjs 390
   U=http://127.0.0.1:4123 node e2e/b3-cart.mjs 1366
   ```

Các bài cart E2E cần prototype chạy ở cổng chỉ định; xem kết quả từng bước và ảnh trong `e2e/out/`. `npm test` chạy bộ kiểm thử backend (cần cấu hình DB kiểm thử); `npm run e2e:all` chạy toàn bộ E2E. Ảnh và bảng kết quả của Buổi 3: [docs/buoi3/Nhom08_Buoi3_GGO.docx](docs/buoi3/Nhom08_Buoi3_GGO.docx).

## Cấu trúc dự án

```text
ecommerce-football-booking/
├── index.html, products.html, product-detail.html, about.html, …  # 30 trang giao diện
├── css/                   # CSS chung và CSS theo khu vực
├── images/                # Ảnh, logo và biểu tượng
├── fonts/                 # Font Archivo
├── js/                    # ES modules giao diện, API và chế độ mock/real
├── mock/                  # Dữ liệu giả cho prototype và bản Pages
├── functions/             # Cloudflare Pages Functions và thư viện dùng chung
├── src/                   # Ứng dụng Express, API, nghiệp vụ và cấu hình
├── db/                    # Schema MySQL
├── scripts/               # Chạy server prototype, khởi tạo DB, seed và triển khai
├── tests/                 # Unit/integration tests backend
├── e2e/                   # Luồng kiểm thử trình duyệt Playwright
├── docs/                  # PRD, yêu cầu, kế hoạch và báo cáo Buổi 2–3
├── robots.txt, sitemap.xml, favicon.ico
├── package.json
└── README.md
```

## Phân công thành viên

| Thành viên | Vai trò |
| --- | --- |
| Danh | Leader |
| Phong | UX/UI |
| Phan Huy | UX/UI |
| Hưng | Frontend |
| Nam | Frontend |
| Đạt | Backend |
| Bằng | Backend |
| Nghĩa | QA |

## Tài liệu

- [Yêu cầu sản phẩm (PRD)](docs/PRD.md)
- [Kế hoạch dự án Buổi 1](PROJECT_PLAN.md)
- [Yêu cầu Buổi 1](REQUIREMENTS.md)
- [Quy trình nghiệp vụ](business-workflow.md)
- [Phân tích đối thủ](competitor-analysis.md)
- [Báo cáo Buổi 2](docs/buoi2/bao-cao.md) và [hồ sơ nộp bài](docs/buoi2/nop-bai.md)
- [Báo cáo Buổi 3 (DOCX)](docs/buoi3/Nhom08_Buoi3_GGO.docx) và [ảnh minh chứng](docs/buoi3/screens/)

## Mật khẩu tài khoản demo

Seed dữ liệu demo cung cấp tài khoản mẫu; mật khẩu chung là `Matkhau@123`. Đây là **mật khẩu demo cho dữ liệu mẫu**, không dùng cho tài khoản thật. Tài khoản và email mẫu được nêu trong mã seed, không phải thông tin liên hệ của thành viên.

## Vấn đề đã gặp và cách xử lý

- Tìm kiếm và sắp xếp ban đầu nằm trong bộ lọc đang thu gọn nên người dùng không thấy; chuyển hai điều khiển ra ngoài.
- Bố cục điều khiển bị chật ở màn 390 px; xếp dọc và cho ô sắp xếp dùng toàn chiều rộng trên điện thoại.
- Sort giá làm sân hết giờ xen vào thứ tự sân còn giờ; tách hai nhóm rồi sort giá riêng trong mỗi nhóm.
- Test sau F5 lấy `value` của option quận, nhưng option này không khai báo thuộc tính đó; chuyển test sang chọn theo nội dung text của option rồi kiểm tra giá trị bộ lọc đã khôi phục.
- Giỏ hàng dùng chữ dễ hiểu nhầm là đặt chỗ hoặc cộng số lượng; đổi nội dung thành “Giờ đã lưu”, mỗi dòng một slot và nói rõ giá/tình trạng có thể đổi, giỏ không giữ giờ.

## Repository GitHub

[https://github.com/danhbui31241021966-UEH/ecommerce-football-booking](https://github.com/danhbui31241021966-UEH/ecommerce-football-booking)

## Sử dụng AI

Agent hỗ trợ viết mã, test và tài liệu dưới sự điều phối của nhóm. Nhóm kiểm tra hành vi bằng test tự động trên prototype và ảnh chụp ở desktop/điện thoại; kết quả và giới hạn được ghi trong [báo cáo Buổi 3](docs/buoi3/Nhom08_Buoi3_GGO.docx). Không coi đề xuất AI là minh chứng thay cho test.

## Kiểm thử

- `npm test` – test backend; cấu hình database kiểm thử theo hướng dẫn trong `.env.example`/scripts.
- `npm run e2e` – chạy một luồng trình duyệt; `npm run e2e:all` – chạy toàn bộ bộ e2e.
