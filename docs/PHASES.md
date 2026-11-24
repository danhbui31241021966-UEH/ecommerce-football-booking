# Các giai đoạn làm GGO

> **Tài liệu tổng kết lập sau.** Repo này không có nhánh hay PR riêng cho từng giai đoạn: mọi việc từ 21/10 đến 24/11/2026 nằm thẳng trên `main`, trừ đợt 3 (PR #1). File này dựng lại các giai đoạn từ lịch sử commit thật (`git log` của `main`, 149 commit, từ `54f072d` đến `4ca2401`), đối chiếu với `docs/TASKS.md` và `docs/PRD.md`. Ranh giới nào cũng là một commit có thật; chỗ việc đan xen nhau thì có ghi "Lẫn" ngay dưới mục đó.

Repo: <https://github.com/danhbui31241021966-UEH/ecommerce-football-booking>. Giờ trong bảng là giờ ghi trên commit (UTC+7). Link `compare` đi từ commit cuối của giai đoạn trước đến commit cuối của giai đoạn này, nên bao gồm cả các commit gộp nhánh nằm giữa.

## Tổng quan

| # | Giai đoạn | Ngày | Từ → đến |
|---|---|---|---|
| 0 | Chuẩn bị: tài liệu, PRD, bản nháp | 21/10 – 29/10 | `54f072d` → `1eac7c7` |
| 1 | Prototype đợt 1: luồng đặt sân của khách | 29/10 – 30/10 | `2f645d2` → `45d0155` |
| 2 | Prototype đợt 2: chủ sân, admin, sửa lỗi | 30/10 | `37b16f5` → `e2dc216` |
| – | Dữ liệu sân thật (không có trong TASKS) | 30/10 | `606a061` → `2cc4de2` |
| – | Tính năng bổ sung R12–R18 (nhượng sân, ghép kèo, báo giá, kèo tiền sân, lịch điện thoại, giải đấu, SePay mô phỏng) | 31/10 – 01/11 | `945c4b3` → `a29e56e` |
| 3 | Backend Express + MySQL và nối FE | 02/11 – 03/11 | `7e268e4` → `c465310` |
| – | Buổi 2: báo cáo, đổi tên GGO, đo và cải thiện UX, logo, cấu trúc thư mục | 03/11 – 04/11 | `8824cd3` → `e004166` |
| – | Buổi 3: tìm tên, sắp xếp giá, Giỏ sân | 11/11 | `86ce1f2` → `c8f57dd` |
| – | Đợt 1: bản demo live giữ dữ liệu, Docker tĩnh, chặn chuyển hướng sau đăng nhập | 23/11 – 24/11 | `7bae3a4` → `034dc47` |
| – | Đợt 2: sửa lỗi từ lượt thử UX | 24/11 | `0f25bb3` → `f649b86` |
| – | Đợt 3: bảo mật và trải nghiệm bản demo (PR #1) | 24/11 | `a731a1d` → `4ca2401` |

Giai đoạn 4 của TASKS không có khoảng commit riêng, xem cuối file.

Cách kiểm chung: `npm test` chạy `tests/*.test.js` trên MySQL thật (`scripts/test.js` tạo database tạm); `e2e/run-all.mjs` chạy các luồng Playwright ở 390 và 1280 px trên prototype (`npm run prototype`). Thư mục `e2e/` chỉ xuất hiện trong repo từ `6785513` (03/11): trước đó các luồng nằm ở `/tmp/flows/` ngoài repo, nên các giai đoạn trước mốc đó ghi tên luồng theo TASKS.md và nói rõ đó là lúc chưa nằm trong repo.

---

## 0. Chuẩn bị: tài liệu, PRD, bản nháp

- **Mục tiêu:** có đề bài, phân tích đối thủ, PRD và danh sách việc trước khi làm giao diện.
- **Commit:** `54f072d` (21/10, Add files via upload) → `01d1a8d` (29/10 14:04) → `1eac7c7` (29/10 21:04). Link: [commit 54f072d](https://github.com/danhbui31241021966-UEH/ecommerce-football-booking/commit/54f072d) · [54f072d…1eac7c7](https://github.com/danhbui31241021966-UEH/ecommerce-football-booking/compare/54f072d...1eac7c7)
- **Làm gì:**
  - `54f072d`: `REQUIREMENTS.md`, `business-workflow.md`, `competitor-analysis.md` (ảnh Alobo, Datsan247, Sporta), `AGENTS.md`, `AI_USAGE_LOG.md`.
  - `01d1a8d`: bản nháp Express + MySQL đầu tiên (`db/schema.sql`, `public/*`): đặt sân, duyệt, hủy/hoàn tiền, trang chủ sân, admin.
  - `1eac7c7`: `docs/PRD.md` và `docs/TASKS.md`.
  - Phần BE làm trước PRD được tách sang nhánh `draft/backend-additions` (commit `d317100`, 29/10: VietQR, danh sách chờ, tìm theo giờ, độ tin cậy, giảm giá giờ chót); nhánh này chưa từng gộp vào `main`.
- **Kiểm thử:** chỉ có `tests/slots.test.js` và `tests/booking.integration.test.js` đi kèm bản nháp (cần MySQL). Phần còn lại là tài liệu nên không có test.
- **Lẫn:** `main` gồm bản nháp `01d1a8d` nhưng PRD viết sau nó; `draft/backend-additions` xuất phát từ bản nháp gốc `294a576` (cùng nội dung `01d1a8d`, hash khác) nên không nằm trong lịch sử `main`.

## 1. Prototype đợt 1: luồng đặt sân của khách

- **Mục tiêu:** đi trọn luồng khách tìm sân, chọn giờ, đặt, thanh toán QR, hủy bằng dữ liệu giả (T1–T6 trong TASKS).
- **Commit:** `2f645d2` (29/10 21:19) → `45d0155` (30/10 03:23). Link: [1eac7c7…45d0155](https://github.com/danhbui31241021966-UEH/ecommerce-football-booking/compare/1eac7c7...45d0155)
- **Làm gì:**
  - `2f645d2` nền giao diện: font, bộ component, header theo vai trò, trang mẫu (T1) và `scripts/prototype-server.js`.
  - `49b5e41` trang chủ kiểu tờ chương trình trận đấu, ảnh thật (T3).
  - `d78aa0d` lớp dữ liệu `api.js` với dữ liệu giả, nối trang chủ, đăng nhập/đăng ký (T2, T8).
  - `b19a2cb` danh sách sân, chi tiết sân và lưới giờ, xác nhận đặt, booking và VietQR (T4–T6).
  - `45d0155` gọn bộ lọc mobile; xóa trang và JS cũ của bản nháp.
- **Kiểm thử:** TASKS.md ghi đã đi trọn luồng 1–5 của PRD bằng giao diện ở 390 và 1280 (luồng `f12`, `f345` lúc đó ở `/tmp/flows/`, vào repo từ `6785513`). Trong repo lúc này chỉ có hai file test của bản nháp (`tests/slots.test.js`, `tests/booking.integration.test.js`). Chưa có test tự động cho prototype.
- **Lẫn:** hai commit `d78aa0d` và `b19a2cb` mỗi commit chứa cả việc của giai đoạn 2: `d78aa0d` có 4 màn chủ sân (T9, T10), `b19a2cb` có Booking của tôi và Thông báo (T7, T8). TASKS.md chia theo task, lịch sử chia theo commit, nên khoảng này không khớp 1:1 với T1–T6.

## 2. Prototype đợt 2: phần còn lại

- **Mục tiêu:** hoàn thiện các màn còn lại: chủ sân, admin (T7–T11).
- **Commit:** `37b16f5` (30/10 03:30) → `e2dc216` (30/10 03:57). Link: [45d0155…e2dc216](https://github.com/danhbui31241021966-UEH/ecommerce-football-booking/compare/45d0155...e2dc216)
- **Làm gì:**
  - `37b16f5` admin: tài khoản, tra cứu và xử lý booking, nhật ký (T11).
  - `e2dc216` sửa link thông báo danh sách chờ, mốc hủy theo giờ hiện tại, nhãn lịch sử booking, QR lên đầu trên mobile; cập nhật task list T1–T11.
- **Kiểm thử:** như giai đoạn 1: chạy tay các luồng `f12`/`f345` (ngoài repo lúc đó). Hai mục "Review đợt 1/2 với nhóm" trong TASKS.md không có dấu vết trong commit nên vẫn để chưa xong.
- **Lẫn:** như trên, T7–T10 nằm ở các commit giai đoạn 1.

## – Dữ liệu sân thật (không có trong TASKS)

- **Mục tiêu:** thay sân giả bằng sân bóng mini thật ở TP.HCM.
- **Commit:** `606a061` (30/10 11:01) → `2cc4de2` (30/10 23:52). Link: [e2dc216…2cc4de2](https://github.com/danhbui31241021966-UEH/ecommerce-football-booking/compare/e2dc216...2cc4de2)
- **Làm gì:** 34 sân thật (`606a061`); tách nguồn dữ liệu, bỏ thông tin không có nguồn (`34f891d`); sinh booking nền để lịch có giờ đã đặt (`3635181`); ảnh thật từ Google Maps (`f171396`) và ảnh minh họa cho 8 sân chưa có ảnh (`2cc4de2`); ẩn giờ đã qua khi tìm sân.
- **Kiểm thử:** xem bằng giao diện, chưa có test riêng; `e2e/photos.mjs` (vào repo ở `6785513`) kiểm ảnh sân sau này.

## – Tính năng bổ sung R12–R18

- **Mục tiêu:** các tính năng ngoài luồng đặt sân cơ bản: nhượng sân, ghép đủ hai đội, nhu cầu và báo giá, kèo tiền sân, lịch đặt qua điện thoại, giải đấu, ngân hàng báo tiền (mô phỏng). Tương ứng các mục C, A, B, D, E, F, G, H, I của TASKS.
- **Commit:** `945c4b3` (31/10 00:17) → `a29e56e` (01/11 10:11). Link: [2cc4de2…a29e56e](https://github.com/danhbui31241021966-UEH/ecommerce-football-booking/compare/2cc4de2...a29e56e)
- **Làm gì:**
  - `945c4b3` nhượng sân thay vì hủy (C, R12); `5c32686` đủ hai đội mới chốt sân (A, R13); `0a43e3d` đăng nhu cầu, chủ sân chào giá (B, R14).
  - `dddfc98` kèo tiền sân 5-5, 6-4, 7-3 hoặc thua bao sân (D, R15); `d479a86` chủ sân tự thêm lịch đặt khách gọi điện/Zalo (E, R16); `b3f5038` bố cục lại khu chủ sân (F).
  - `90d4f33` chuyển khoản xong đơn tự sang "Đã nhận tiền", mô phỏng SePay (G, R17).
  - `617be5c`, `24ea8b2`, `b75fc13` giải đấu phủi tại một sân (H, R18); `a29e56e` trang danh sách giải, menu, dải ở trang chủ (I).
- **Kiểm thử:** TASKS.md ghi từng luồng ở 390 và 1280: `f-transfer`, `f-match`, `f-request`, `f-stake`, `f-phone`, `f-owner-ux`, `f-autopay`, `f-league`, `f-leagues-public` (hiện ở `e2e/`, vào repo từ `6785513`, sau giai đoạn này), kèm chạy lại `f12`, `f345`. `tests/` chưa có bài nào cho phần này; test cho cùng nghiệp vụ trên MySQL được viết ở giai đoạn 3 (`tests/transfers.test.js`, `match.test.js`, `request.test.js`, `league.test.js`, `bank.test.js`).
- **Lẫn:** `5dce022` (viết lại chữ, SEO cơ bản) và `0937747` (ảnh đầu trang tự đổi, câu chào theo giờ) là việc giao diện chung, không thuộc mục nào của R12–R18. Gom chung vì cùng một đợt làm liền trong hai ngày; ranh giới giữa các mục C, A, B, D... là từng commit riêng, xem danh sách trên.

## 3. Backend Express + MySQL và nối FE

- **Mục tiêu:** đưa nghiệp vụ lên backend thật và cho FE nối được (T12–T15).
- **Commit:** `7e268e4` (02/11 15:01) → `c465310` (03/11 15:51). Link: [a29e56e…c465310](https://github.com/danhbui31241021966-UEH/ecommerce-football-booking/compare/a29e56e...c465310)
- **Làm gì:**
  - `7e268e4` nền Express + MySQL: lược đồ, auth, phiên, CSRF, giờ mô phỏng; response camelCase (`src/lib/camel.js`).
  - `f9fff3e` vòng đời booking và backend chủ sân/admin; `d655f76` lịch qua điện thoại/Zalo.
  - `6785513` nhượng sân, ghép đội, kèo tiền sân; `7365a17` nhu cầu và báo giá; `8ff657f` giải đấu; `3fc8122` webhook SePay.
  - `c465310` phục vụ bản live từ backend qua tunnel, `scripts/pages-deploy.mjs`, `scripts/demo-*.cjs`, `functions/` cho Cloudflare Pages.
  - `js/api.js` chọn `mock` hoặc `real` ở một chỗ (hằng `MODE`), nên cùng giao diện chạy được với cả hai.
- **Kiểm thử:** `tests/auth`, `booking.race` (chống đặt trùng, idempotencyKey), `booking.ops` (hoàn tiền theo mốc, uy tín, danh sách chờ), `owner-admin`, `phone-booking`, `transfers`, `match`, `request`, `league`, `bank`, `public` (giờ chót, giá), `schema`, `seed`, `seed.bookings`, `meta`, `dev`, `production`; `scripts/test.js` dựng database tạm. `6785513` đưa các luồng e2e vào `e2e/` (`f12`, `f345`, `f-match`, ...); `c465310` thêm `e2e/f-live-smoke.mjs`.
- **Lẫn:** `6d56fa7` (giữ chỗ cho header để trang không nhảy) là sửa giao diện, nằm giữa các commit BE. `6785513` cũng chứa 19 file e2e đưa vào repo một lượt nên vừa là backend vừa là "nhập" luồng kiểm thử cũ.

## – Buổi 2: báo cáo, đổi tên GGO, UX, logo, cấu trúc thư mục

- **Mục tiêu:** nộp bài Buổi 2: trang giới thiệu, sửa focus/vùng bấm/hover, báo cáo Chương 2, rồi cải thiện luồng đặt sân có đo trước và sau.
- **Commit:** `8824cd3` (03/11 18:40) → `e004166` (04/11 20:00). Link: [c465310…e004166](https://github.com/danhbui31241021966-UEH/ecommerce-football-booking/compare/c465310...e004166)
- **Làm gì:**
  - Báo cáo và hồ sơ nộp bài: `8824cd3`, `389c12a`, `d19ad83`, `65ae890`, `8777ddb`, `e7ce0ba` (`docs/buoi2/`).
  - Đổi tên web thành GGO, thêm slogan, địa chỉ `ggo-datsan.pages.dev` (`745746c`).
  - Đo UX trước/sau (`4840e2f`, `9fcbc31`) và cải thiện: gộp trang kết quả với trang sân, đăng nhập bằng số điện thoại, giữ chỗ 15 phút cho đơn chưa chuyển khoản (`2f87803`), hộp xác nhận nói hạn chuyển khoản, trang chủ làm lại, menu Thêm, ràng buộc cửa sổ đặt (`9b533b3`).
  - Logo GGO, favicon, ảnh chia sẻ (`d2cc75c`, `d99c797`, `255a4bd`).
  - Đưa trang tĩnh ra thư mục gốc theo mẫu của thầy: `css/`, `images/`, `js/`, `fonts/`, `mock/`; `venues.html` thành `products.html` (`a1a2cd4`); gộp README, phân công thành viên (`2fa02c4`, `9a305e3`, `e004166`).
- **Kiểm thử:** `e2e/ux-measure.mjs` (số đo trước/sau), `e2e/f-auth-intent.mjs` (đăng nhập quay lại đúng hộp đặt), `tests/pay-hold.test.js` (giữ 15 phút), `tests/static-site.test.js` (đường dẫn tĩnh sau khi dời thư mục, `a1a2cd4`), `9eb2125` thử biên cửa sổ đặt, và chạy lại `e2e/run-all.mjs`. Ảnh minh chứng ở `docs/buoi2/screens/`.
- **Lẫn:** đây là khoảng lẫn nhất. Từ 03/11 23:14 đến 04/11 03:46 có hai nhánh UX (`ux-booking-path`, `ux-find`) cùng sửa và gộp vào nhau nhiều lần; nhiều cặp commit "làm" và "Gộp ..." trùng nội dung (ví dụ `a24816c` và `9aa4a6a`, `2f87803` và `74e203f`). Giờ ghi trên commit không luôn tăng theo thứ tự cha–con, nên thứ tự cha–con mới là căn cứ ranh giới. Các commit BE nhỏ (`9b533b3` ràng buộc cửa sổ đặt, `495741d`, `84f6b22`) cũng nằm trong đợt này. Việc dời thư mục `a1a2cd4` đổi đường dẫn 195 file nên các tài liệu cũ (kể cả TASKS.md) nhắc `venues.html`, `venue.html` là tên trước khi dời.

## – Buổi 3: tìm tên, sắp xếp giá, Giỏ sân

- **Mục tiêu:** thêm tìm sân theo tên, sắp xếp giá và giỏ lưu các giờ sân cụ thể (không giữ chỗ).
- **Commit:** `86ce1f2` (11/11 18:35) → `c8f57dd` (11/11 21:31). Link: [e004166…c8f57dd](https://github.com/danhbui31241021966-UEH/ecommerce-football-booking/compare/e004166...c8f57dd)
- **Làm gì:**
  - Tìm theo tên và sắp xếp giá, đưa ra ngoài bộ lọc (`86ce1f2`, `88daac1`, `7347ff2`).
  - Giỏ lưu giờ sân trong `localStorage`, xem giá mới nhất, bỏ giờ đã hết (`2ca1a8e`, `8027c88`); trang giỏ và badge đồng bộ giữa các thẻ (`dec66ee`, `974b34c`); đổi tên "Giỏ sân" (`f9d9356`).
  - README, báo cáo Buổi 3 (kể cả bản Word) và ảnh ở 390/1366 (`1ef4cd1`, `c1ab268`, `e3a910c`, `c63614f`, `cff3bfc`, `a7cca21`, `d0139b0`, `c8f57dd`).
- **Kiểm thử:** `tests/cart.test.js`, `e2e/b3-search.mjs`, `e2e/b3-cart.mjs` (cả hai khổ 390/1366), cập nhật `e2e/f-owner-ux.mjs` (menu chủ sân có Giỏ sân; sau này bỏ) và `e2e/seo.mjs`. Ảnh ở `docs/buoi3/screens/`.
- **Lẫn:** hai commit gộp (`6885df8`, `7a5b18c`) và các commit sửa kiểm thử nằm xen giữa; phần báo cáo chiếm gần nửa số commit.

## – Đợt 1: bản demo live giữ dữ liệu, Docker tĩnh, chặn chuyển hướng

- **Mục tiêu:** bản demo trên Pages dùng được như người lạ: giữ tài khoản và lịch đặt đã tạo, an toàn sau đăng nhập, có bản tĩnh bằng Docker. (Nhánh `live-mock-flow` ở remote `b3` kết thúc tại `f649b86` nên bao cả đợt 1 và đợt 2.)
- **Commit:** `7bae3a4` (23/11 23:31) → `034dc47` (24/11 00:52). Link: [c8f57dd…034dc47](https://github.com/danhbui31241021966-UEH/ecommerce-football-booking/compare/c8f57dd...034dc47)
- **Làm gì:**
  - Giữ tài khoản và lịch đặt của người dùng khi sang ngày mới, chỉ dựng lại dữ liệu mẫu khi chưa có thao tác (`7bae3a4`); chân trang nói rõ dữ liệu lưu trên trình duyệt này, báo dữ liệu cũ và cho đặt lại demo (`96484ce`, `36029f6`).
  - Đặt xong thì bỏ giờ đó khỏi Giỏ sân (`5ad67b0`).
  - Sau đăng nhập chỉ chuyển tới đường dẫn cùng nguồn (`590d49b`).
  - Image Docker nginx cho bản tĩnh, so mã phản hồi với Pages (`10ee078`).
  - Nút Bộ lọc mở được khi dữ liệu chưa tải xong (`034dc47`).
- **Kiểm thử:** `e2e/f-guest-journey.mjs` (người lạ tìm sân, thêm giỏ, đăng ký, đặt, chuyển khoản mô phỏng, tải lại và sang ngày mới), `tests/safe-next.test.js`, `tests/static-site.test.js` (nhận `/cart` lẫn `/cart.html`), `scripts/compare-status.mjs`, `e2e/b3-search.mjs` (chờ trang tải xong).
- **Lẫn:** `590d49b` là sửa bảo mật nhỏ nằm trong đợt thiên về trải nghiệm; việc bảo mật rộng hơn để sang đợt 3.

## – Đợt 2: sửa lỗi từ lượt thử UX

- **Mục tiêu:** sửa các điểm khó chịu tìm ra khi một người thử như khách mới trên bản live (theo nội dung các commit).
- **Commit:** `0f25bb3` (24/11 05:38) → `f649b86` (24/11 10:18). Link: [034dc47…f649b86](https://github.com/danhbui31241021966-UEH/ecommerce-football-booking/compare/034dc47...f649b86)
- **Làm gì:**
  - Khách nhập tài khoản nhận tiền hoàn khi hủy; chủ sân và admin thấy để chuyển đúng chỗ (`0f25bb3`, kèm migration `202611240001_refund_bank.sql`).
  - Hủy lịch chưa chuyển khoản chỉ nói hủy miễn phí, mốc hoàn giải thích theo thời gian tới giờ đá (`48d4652`).
  - Đăng ký để trống hoặc sai thì báo lỗi dưới ô sai đầu tiên (`9df0144`).
  - Thanh toán trên điện thoại: ô sao chép lên trước QR, nút lưu ảnh QR (`1b755f1`).
  - Ban đêm lịch sân và hộp Thêm lịch đặt tự mở ngày còn giờ (`b668d9d`).
  - Một loạt lỗi nhỏ: nhãn Khách mới, bỏ Giỏ sân khỏi menu chủ sân và admin, thông báo có tên cụm sân (`4885255`).
- **Kiểm thử:** `tests/booking.ops.test.js` (hoàn tiền có tài khoản, hủy chưa chuyển khoản), `tests/auth.test.js`; `e2e/f-register-errors.mjs`, `e2e/f-pay-mobile.mjs`, `e2e/f-owner-night.mjs` và cập nhật `f-owner-ux`, `f345`; `6ff4579` và `f649b86` đưa ba luồng mới vào `e2e/run-all.mjs`.
- **Lẫn:** `6ff4579` và `f649b86` (10:13, 10:18) là kiểm thử cho việc đã làm lúc 05:38–05:45, nên cách các sửa đổi ~4,5 giờ. Giờ ghi trên `a731a1d` (đợt 3, 10:02) sớm hơn commit cha của nó là `f649b86` (đợt 2, 10:18), nên theo giờ hai đợt chồng nhau 16 phút; theo cha–con thì đợt 3 bắt đầu sau `f649b86`.

## – Đợt 3: bảo mật và trải nghiệm bản demo (PR #1)

- **Mục tiêu:** làm cứng bản demo công khai và sửa vài điểm trải nghiệm. Đây là phần duy nhất đi qua nhánh và PR.
- **Commit:** `a731a1d` (24/11 10:02) → `438728c` (10:54), gộp bằng `4ca2401` (11:05, `Gộp đợt 3: bảo mật và trải nghiệm bản demo (#1)`). Link: [f649b86…4ca2401](https://github.com/danhbui31241021966-UEH/ecommerce-football-booking/compare/f649b86...4ca2401) · [commit 4ca2401](https://github.com/danhbui31241021966-UEH/ecommerce-football-booking/commit/4ca2401)
- **Làm gì:**
  - Chỉ nhận liên kết bản đồ an toàn (`a731a1d`); API demo chỉ bật khi có cờ rõ ràng (`c7b382a`).
  - CSP và header bảo mật cho bản tĩnh; header nginx sinh từ cùng chính sách với Pages (`8325cf7`, `6bc1977`).
  - Giới hạn huy hiệu thông báo, ngăn thông báo từ dữ liệu nền (`edf960d`); vùng bấm gọi điện khách đủ lớn cho chủ sân (`3e33e6e`); đăng nhập chủ sân của sân demo được gợi ý (`8f4b289`).
  - Ba sân demo nhận tiền vào tài khoản ngân hàng thật để quét được QR; tiền báo về ghi đúng sân của đơn khi nhiều sân dùng chung tài khoản (`438728c`).
- **Kiểm thử:** `tests/static-site.test.js`, `tests/owner-admin.test.js`, `tests/bank.test.js`, `tests/dev.test.js`; `e2e/f-real-qr.mjs` (mới ở `438728c`), cập nhật `e2e/f-auth-intent.mjs`, `f-owner-ux.mjs`; `scripts/compare-status.mjs` so mã phản hồi với Pages.
- **Lẫn:** `438728c` gộp nhiều việc trong một commit (QR thật, ghi tiền đúng sân, dựng lại dữ liệu mẫu cho trình duyệt cũ).

---

## Giai đoạn 4 (hoàn thiện) không có khoảng commit riêng

TASKS.md đặt "sửa báo cáo" (T16) và "triển khai, slide demo" (T17) ở cuối, nhưng trong lịch sử chúng làm rải rác cùng các giai đoạn khác: báo cáo Buổi 2/3 và việc sửa cho khớp luật giữ chỗ 15 phút (`65ae890`, Buổi 2), triển khai lên Cloudflare Pages (`c465310`, `745746c`) và Docker tĩnh (`10ee078`, đợt 1). Slide demo không có trong repo. Chi tiết trạng thái ở `docs/TASKS.md`.
