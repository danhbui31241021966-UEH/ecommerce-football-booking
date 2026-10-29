# Task list

Theo `docs/PRD.md`. Mỗi task chỉ bắt đầu khi được giao; xong mỗi màn dừng lại để review rồi mới sang màn tiếp.

Ký hiệu: `[ ]` chưa làm · `[~]` đang làm · `[x]` xong.

## Giai đoạn 0 – Chuẩn bị

- [x] Tách phần BE làm trước PRD sang branch `draft/backend-additions`; `main` về bản nháp gốc.
- [~] PRD + task list — **xong khi:** nhóm duyệt PRD (luật nghiệp vụ, 16 màn, API contract).
- [ ] Trả lời các câu hỏi mở trong PRD mục 10 (deadline, phân công).

## Giai đoạn 1 – Prototype đợt 1: luồng đặt sân của khách

- [ ] **T1. Nền giao diện** — file CSS chung (biến màu/chữ/khoảng cách, nút, thẻ, badge trạng thái slot, hộp thoại), header/menu vẽ bằng JS theo vai trò.
  Xong khi: một trang mẫu hiển thị đủ các thành phần trên mobile và desktop.
- [ ] **T2. Lớp dữ liệu giả** — `api.js` + `public/mock/*.json` đúng API contract; giả lập đặt sân, hủy, danh sách chờ trong bộ nhớ; công tắc vai trò.
  Xong khi: mọi endpoint mà đợt 1 dùng trả dữ liệu đúng kiểu trong PRD mục 7.
- [ ] **T3. Trang chủ (màn 1)** — tìm theo giờ, khối giảm giá giờ chót.
  Xong khi: chọn ngày + giờ + loại sân → chuyển sang kết quả đúng điều kiện.
- [ ] **T4. Danh sách sân (màn 2)** — chip lọc, thẻ sân có giờ trống, giá gạch ngang, nhãn tự xác nhận/chờ duyệt.
  Xong khi: bấm một giờ trên thẻ mở chi tiết sân với ô đó đã được chọn.
- [ ] **T5. Chi tiết sân + lưới slot (màn 3)** — 3 chip ngày, đủ 7 trạng thái ô, nút "Báo tôi khi trống", thanh đặt dính dưới.
  Xong khi: mobile và desktop đều đọc rõ trạng thái, giá thường/cao điểm/giảm giá.
- [ ] **T6. Xác nhận đặt + chi tiết booking/QR (màn 4, 5)** — hộp xác nhận có mốc hủy cụ thể; màn booking có đếm ngược, VietQR, nút sao chép, hủy kèm số tiền hoàn.
  Xong khi: đi trọn luồng 1 và 2 của PRD mục 6 bằng dữ liệu giả.
- [ ] Review đợt 1 với nhóm, sửa theo góp ý.

## Giai đoạn 2 – Prototype đợt 2: phần còn lại

- [ ] **T7.** Booking của tôi + danh sách chờ (màn 6).
- [ ] **T8.** Thông báo (màn 7), đăng nhập/đăng ký (màn 8, 9).
- [ ] **T9.** Chủ sân: tổng quan, cài đặt sân (màn 10, 11).
- [ ] **T10.** Chủ sân: lịch & chặn lịch, quản lý booking (màn 12, 13).
- [ ] **T11.** Admin: tài khoản, booking, nhật ký (màn 14–16).
- [ ] Review đợt 2.

## Giai đoạn 3 – Backend và nối FE

- [ ] **T12.** Đưa phần BE từ `draft/backend-additions` vào `main`, rà lại theo PRD; chuyển response sang camelCase theo contract.
- [ ] **T13.** Tắt dữ liệu giả, nối từng màn với API thật.
- [ ] **T14.** Kiểm thử: chống đặt trùng, giữ chỗ 15 phút, danh sách chờ, hoàn tiền, độ tin cậy, giảm giá giờ chót.
- [ ] **T15.** Dữ liệu mẫu cho demo + kịch bản demo theo 5 luồng PRD mục 6.

## Giai đoạn 4 – Hoàn thiện

- [ ] **T16.** Sửa báo cáo cho khớp các thay đổi (giữ chỗ 15 phút, các tính năng bổ sung).
- [ ] **T17.** Triển khai lên hosting, chuẩn bị slide demo.
