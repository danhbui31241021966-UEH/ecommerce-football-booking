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
- [ ] **A, B.** Hai tính năng tiếp theo theo brief của lead.

## Giai đoạn 3 – Backend và nối FE

- [ ] **T12.** Đưa phần BE từ `draft/backend-additions` vào `main`, rà lại theo PRD; chuyển response sang camelCase theo contract.
- [ ] **T13.** Tắt dữ liệu giả, nối từng màn với API thật.
- [ ] **T14.** Kiểm thử: chống đặt trùng, giữ chỗ 15 phút, danh sách chờ, hoàn tiền, độ tin cậy, giảm giá giờ chót.
- [ ] **T15.** Dữ liệu mẫu cho demo + kịch bản demo theo 5 luồng PRD mục 6.

## Giai đoạn 4 – Hoàn thiện

- [ ] **T16.** Sửa báo cáo cho khớp các thay đổi (giữ chỗ 15 phút, các tính năng bổ sung).
- [ ] **T17.** Triển khai lên hosting, chuẩn bị slide demo.
