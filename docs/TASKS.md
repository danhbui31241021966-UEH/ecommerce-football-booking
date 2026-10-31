# Task list

Theo `docs/PRD.md`. Mỗi task chỉ bắt đầu khi được giao; xong mỗi màn dừng lại để review rồi mới sang màn tiếp.

Ký hiệu: `[ ]` chưa làm · `[~]` đang làm · `[x]` xong.

## Giai đoạn 0 – Chuẩn bị

- [x] Tách phần BE làm trước PRD sang branch `draft/backend-additions`; `main` về bản nháp gốc.
- [~] PRD + task list — **xong khi:** nhóm duyệt PRD (luật nghiệp vụ, 16 màn, API contract).
- [ ] Trả lời các câu hỏi mở trong PRD mục 10 (deadline, phân công).

## Giai đoạn 1 – Prototype đợt 1: luồng đặt sân của khách

- [x] **T1. Nền giao diện** — file CSS chung (biến màu/chữ/khoảng cách, nút, thẻ, badge trạng thái slot, hộp thoại), header/menu vẽ bằng JS theo vai trò.
  Xong khi: một trang mẫu hiển thị đủ các thành phần trên mobile và desktop.
  Lệch so với mô tả: vai trò lấy từ `api.me()` (header, nút Đăng xuất); công tắc vai trò chỉ còn là đường tắt prototype. Trang mẫu là `styleguide.html`.
- [x] **T2. Lớp dữ liệu giả** — `api.js` + `public/mock/*.json` đúng API contract; giả lập đặt sân, hủy, danh sách chờ trong bộ nhớ; công tắc vai trò.
  Xong khi: mọi endpoint mà đợt 1 dùng trả dữ liệu đúng kiểu trong PRD mục 7.
  Lệch so với mô tả: mock nằm ở `js/api-mock.js` (dữ liệu gốc `public/mock/*.json`, trạng thái lưu localStorage); thay công tắc vai trò bằng `api.proto` (`quickLogin`, `resetDemo`, `advanceClock`), `api.proto` là null khi nối BE thật. Giờ hiện tại của mock lấy từ `meta().now`.
- [x] **T3. Trang chủ (màn 1)** — tìm theo giờ, khối giảm giá giờ chót.
  Xong khi: chọn ngày + giờ + loại sân → chuyển sang kết quả đúng điều kiện.
  Lệch so với mô tả: trang chủ là `index.html` (đổi từ `home.html`); form tìm chuyển sang `/venues.html` với điều kiện trên URL.
- [x] **T4. Danh sách sân (màn 2)** — chip lọc, thẻ sân có giờ trống, giá gạch ngang, nhãn tự xác nhận/chờ duyệt.
  Xong khi: bấm một giờ trên thẻ mở chi tiết sân với ô đó đã được chọn.
- [x] **T5. Chi tiết sân + lưới slot (màn 3)** — 3 chip ngày, đủ 7 trạng thái ô, nút "Báo tôi khi trống", thanh đặt dính dưới.
  Xong khi: mobile và desktop đều đọc rõ trạng thái, giá thường/cao điểm/giảm giá.
  Lệch so với mô tả: trên mobile lưới chia Sáng/Chiều/Tối và chọn từng sân con bằng nút chuyển, không cuộn ngang; thêm trạng thái "đang giữ cho bạn" (8 trạng thái).
- [x] **T6. Xác nhận đặt + chi tiết booking/QR (màn 4, 5)** — hộp xác nhận có mốc hủy cụ thể; màn booking có đếm ngược, VietQR, nút sao chép, hủy kèm số tiền hoàn.
  Xong khi: đi trọn luồng 1 và 2 của PRD mục 6 bằng dữ liệu giả.
  Lệch so với mô tả: hộp xác nhận nằm trong `venue.html`; màn booking là `booking.html`. Đã đi trọn luồng 1–5 bằng giao diện với dữ liệu giả ở 390 và 1280.
- [ ] Review đợt 1 với nhóm, sửa theo góp ý.

## Giai đoạn 2 – Prototype đợt 2: phần còn lại

- [x] **T7.** Booking của tôi + danh sách chờ (màn 6).
- [x] **T8.** Thông báo (màn 7), đăng nhập/đăng ký (màn 8, 9).
- [x] **T9.** Chủ sân: tổng quan, cài đặt sân (màn 10, 11).
  Lệch so với mô tả: cài đặt sân gửi khóa ngân hàng phẳng `bankBin/bankAccount/bankAccountName`.
- [x] **T10.** Chủ sân: lịch & chặn lịch, quản lý booking (màn 12, 13).
  Lệch so với mô tả: booking mở được theo `?id=`, `?status=`, `?date=`, `?q=` (link thông báo chủ sân trỏ `/owner-bookings.html?id=`).
- [x] **T11.** Admin: tài khoản, booking, nhật ký (màn 14–16).
- [ ] Review đợt 2.

## Tính năng bổ sung: nhượng sân thay vì hủy (R12)

- [x] **C.** Nhượng booking — engine mock + `api.js` (đăng, nhận, rút, chủ sân xác nhận/từ chối), màn 17–18, tab "Nhượng sân" ở Booking của tôi, chip ở lưới slot, bảng "Nhượng sân" ở Quản lý booking, thông báo cho người chờ slot, nhật ký `transfer_*`, demo có sẵn 5 đăng nhượng; contract ở PRD mục 7. **Kiểm:** `/tmp/flows/f-transfer.mjs` (390 + 1280), f12, f345.
- [x] **A.** Đủ hai đội mới chốt sân (R13) — chế độ bật theo sân con + khung giờ (`teamMode`), mở trận / vào trận, hai phần tiền xác nhận riêng, giữ slot bằng booking `matching`, hết hạn thì nhả slot và ghi hoàn từng đội; màn 19–21, tab "Ghép trận", bảng trận ở Quản lý booking, công tắc ở Cài đặt sân, admin ghi hoàn từng đội; demo có 4 trận (chờ đội B, đã có B chưa đủ tiền, đã chốt); key lưu v6. **Kiểm:** `/tmp/flows/f-match.mjs` (390 + 1280, 08:00/15:00/22:30), f12, f345, f-transfer.
- [x] **B.** Đội đăng nhu cầu, sân chào giá (R14) — `requests`/`offers` (key lưu v7), chào giá không giữ slot, chọn = kiểm lại rồi đặt qua luồng đặt thường (giá chốt = giá chào, `offerId`); màn 22–24, màn Nhu cầu của chủ sân, mục "Nhu cầu" trên thanh điều hướng; demo 4 nhu cầu (chờ chào giá / 3 chào giá / đã chốt booking / của khách khác). Kèm: giờ đủ hai đội hiện lại trong kết quả tìm ở trang chủ và /venues kèm nhãn "Ghép trận". **Kiểm:** `/tmp/flows/f-request.mjs` (390 + 1280, nhiều mốc giờ), f-match, f-transfer, f12, f345. Chưa làm: thông báo email/đẩy thật, admin xem nhu cầu.
- [x] **D.** Kèo tiền sân cho ghép kèo (R15) — đội mở chọn 5-5 / 6-4 / 7-3 / thua bao sân thay cho chia 30–70%; mỗi đội vẫn trả trước nửa tiền sân. Đá xong: hai đội trưởng báo kết quả (đội mình thắng / đội kia thắng / hòa), khớp thì chốt, lệch hoặc quá 48 giờ thì chủ sân chốt; đội thua thấy "trả thêm X" + mã QR tới tài khoản đội thắng, đội thắng bấm "Đã nhận" (web không giữ tiền). Endpoint mới: `POST /matches/:id/result`, `PUT /matches/:id/bank`, `POST /matches/:id/topup-received`, `POST /owner/matches/:id/result`; `Match` thêm `loserPercent`, `loserAmount`, `winnerAmount`, `result`, `yourBank`, `topUpQr` (bỏ `hostPercent`); key lưu v8. Demo thêm 2 kèo đã đá (khachnen05 (đội mở) và khachnen12 chờ báo kết quả; khachnen08 (thắng) và khachnen11 (thua) đã chốt, chưa trả chênh). Chưa làm: phạt uy tín khi không trả chênh (chỉ hiện "quá hạn"), thông báo email/đẩy. **Kiểm:** `/tmp/flows/f-stake.mjs` (390 + 1280), f-match, f12, f345, f-transfer, f-request.
- [x] **E.** Chủ sân tự thêm lịch đặt khách gọi điện/Zalo (R16) — bấm ô trống ở Lịch sân chọn "Khách đặt" hoặc "Chặn giờ"; nút "+ Thêm lịch đặt" ở Tổng quan và Lịch sân. `POST /api/owner/bookings`, `PUT /api/owner/bookings/:id`; `source: phone` + `walkIn` (key lưu v9); hủy không tạo khoản trả lại; không thông báo/uy tín. Demo: chusan1 có 2 lịch "Đặt qua điện thoại" hôm nay. Kiểm: `/tmp/flows/f-phone.mjs` (390 và 1280).
- [x] **F.** Bố cục lại khu chủ sân — menu 4 mục (Hôm nay · Lịch sân · Khách nhờ báo giá · Cài đặt sân), Lịch đặt gộp vào Lịch sân (lưới/danh sách), Hôm nay là danh sách việc cần làm (kể cả pass sân và ghép kèo của sân mình) rồi giờ đá hôm nay, lịch từng sân bằng tab ở 390, cài đặt thành nhóm lưu riêng, mục Demo cuối menu, chữ "Chưa nhận tiền" thống nhất. Không đổi API. Kiểm: `/tmp/flows/f-owner-ux.mjs` (đếm số lần bấm).
- [x] **G.** Ngân hàng báo có tiền thì đơn tự sang "Đã nhận tiền" (mô phỏng SePay, R17) — một hàm `bankReport` trong mock (khớp mã đơn có cấu trúc + đúng số tiền, idempotent theo mã giao dịch); đơn thường, nhượng (`NH`), hai phần kèo (`TD…A/B`) tự khớp; thiếu/thừa/sai mã/đơn chưa duyệt thì thành thẻ "cần xử lý" cho chủ sân; nút tay vẫn dùng; `paidVia`; endpoint `GET /owner/bank-events`, `POST /owner/bank-events/:id/resolve`; nút "Tôi đã chuyển khoản (mô phỏng)" ở khung QR và nút Demo; sửa nút Demo đè chữ ở 1280; key lưu v10; PRD có mục BE webhook. Hoàn tiền, phần chênh kèo, tiền mặt/điện thoại vẫn thủ công. **Kiểm:** `/tmp/flows/f-autopay.mjs` (390 + 1280) và toàn bộ bộ cũ. Chưa làm: BE thật (T12).

## Giai đoạn 3 – Backend và nối FE

- [ ] **T12.** Đưa phần BE từ `draft/backend-additions` vào `main`, rà lại theo PRD; chuyển response sang camelCase theo contract.
- [ ] **T13.** Tắt dữ liệu giả, nối từng màn với API thật.
- [ ] **T14.** Kiểm thử: chống đặt trùng, giữ chỗ 15 phút, danh sách chờ, hoàn tiền, độ tin cậy, giảm giá giờ chót.
- [ ] **T15.** Dữ liệu mẫu cho demo + kịch bản demo theo 5 luồng PRD mục 6.

## Giai đoạn 4 – Hoàn thiện

- [ ] **T16.** Sửa báo cáo cho khớp các thay đổi (giữ chỗ 15 phút, các tính năng bổ sung).
- [ ] **T17.** Triển khai lên hosting, chuẩn bị slide demo.
