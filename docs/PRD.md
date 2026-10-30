# PRD – Website đặt sân bóng đá mini 5/7 người tại TP.HCM

Nhóm 8 – môn Phát triển ứng dụng TMĐT. Trạng thái: **bản nháp, chờ duyệt**.

Nguồn: báo cáo Chương 1 (`BÀI-TẬP-NHÓM-CHƯƠNG-1-NHÓM-8.docx`, F01–F16) và các đề xuất bổ sung nhóm đã chốt (Google Doc "Đề xuất bổ sung requirement – bản đầy đủ").

---

## 1. Mục tiêu và định vị

**Vấn đề:** đặt sân mini hiện nay chủ yếu qua gọi điện/Zalo; khách không biết giá thật, không biết sân còn trống, chủ sân ghi sổ tay và dễ trùng lịch, bị "bùng" sân.

**Định vị:** *Đặt sân cho cả đội, ngay trên web – không app, không gọi điện.*

**Khác biệt so với các nền tảng hiện có:**

1. Tìm theo giờ trước, chọn sân sau ("19h tối nay sân nào trống?").
2. Danh sách chờ khi slot đã có người giữ; slot trống lại thì người chờ sớm nhất được giữ quyền đặt.
3. Giảm giá giờ chót cho slot sắp tới giờ mà còn trống.
4. Độ tin cậy của khách để hạn chế bùng sân.
5. Thanh toán bằng VietQR theo tài khoản của chủ sân – web **không giữ tiền**.

**Thành công của MVP:** một khách mới tìm được slot trống và gửi đặt sân trong dưới 1 phút trên điện thoại; chủ sân duyệt/ghi nhận thanh toán không cần rời trang quản lý; không bao giờ có hai booking cùng giữ một slot.

## 2. Vai trò

| Vai trò | Làm gì |
|---|---|
| Khách vãng lai | Tìm sân, xem giá và lịch trống. Không cần đăng nhập. |
| Khách hàng | Đặt sân, thanh toán qua QR, hủy, xếp hàng chờ, nhận thông báo. Nhượng booking đã trả tiền cho đội khác thay vì hủy; nhận nhượng booking của đội khác. |
| Chủ sân | Quản lý sân/sân con, giá, lịch, chặn lịch, duyệt booking, ghi nhận thanh toán/hoàn tiền, đánh dấu có mặt/bùng, xác nhận đã nhận tiền của đội nhận nhượng (hoặc từ chối đội đó). |
| Admin | Cấp và khóa tài khoản chủ sân, can thiệp booking ngoại lệ, xem nhật ký. |

## 3. Phạm vi MVP

**Trong phạm vi:** F01–F16 của báo cáo, cộng A7 VietQR, A9 danh sách chờ, A10 tìm theo giờ, A11 độ tin cậy, A12 giảm giá giờ chót.

**Ngoài phạm vi:** cổng thanh toán/ví (web không giữ tiền), app di động, đặt nhiều slot một lần, đặt định kỳ, kèo đội/chia tiền (A8 – đã bỏ), đánh giá/review sân, bản đồ tương tác, SMS/email/Zalo (chỉ thông báo trong web), đa ngôn ngữ.

## 4. Luật nghiệp vụ (đã chốt)

| Mã | Luật |
|---|---|
| R1 | Đặt trước tối đa **3 ngày** (hôm nay + 2 ngày tới). |
| R2 | Mỗi booking = 1 sân con × 1 slot. Slot dài theo cấu hình sân (mặc định 60 phút). |
| R3 | Sân **tự xác nhận** hoặc **chờ duyệt** tùy chủ sân cấu hình. Booking chờ duyệt giữ chỗ **15 phút**; quá hạn chưa duyệt thì tự hết hạn và slot trống lại. *(Báo cáo ghi 05 phút – cần sửa báo cáo cho khớp.)* |
| R4 | Một slot chỉ có tối đa một booking ở trạng thái chờ duyệt hoặc đã xác nhận. |
| R5 | **Giá cao điểm:** mỗi sân con có giá thường và giá cao điểm; khung giờ cao điểm cấu hình theo sân. |
| R6 | **Giảm giá giờ chót:** slot còn trống bắt đầu trong vòng **3 giờ** tới được giảm % do chủ sân đặt (0 = tắt). Giá sau giảm làm tròn 1.000đ. Giá được chốt tại lúc đặt. |
| R7 | **Hoàn tiền khi khách hủy** (tính trên số tiền đã thanh toán): trước ≥24h → 100%; 12–<24h → 50%; <12h → 0%. Chủ sân hoặc admin hủy → 100%. Hoàn tiền thủ công, chủ sân ghi nhận trên web. |
| R8 | **VietQR:** chỉ hiện khi booking đã xác nhận và chưa thanh toán. QR theo tài khoản chủ sân, số tiền = giá booking, nội dung = mã booking. Chủ sân tự xác nhận đã nhận tiền. |
| R9 | **Danh sách chờ:** chỉ đăng ký được cho slot đang có người giữ (không phải slot bị chặn hay đang trống). Khi slot trống lại, người chờ sớm nhất được giữ quyền đặt **10 phút** (không quá giờ bắt đầu); hết hạn thì chuyển cho người kế tiếp. |
| R10 | **Độ tin cậy:** đếm số lần *bùng sân* (chủ sân đánh dấu no-show) + *hủy muộn* (hủy booking đã xác nhận khi còn <12h) trong **60 ngày**. Từ **2 lần** trở lên, mọi booking mới của khách đó phải chờ chủ sân duyệt, kể cả ở sân tự xác nhận. Chủ sân thấy chỉ số này khi duyệt. |
| R11 | Trạng thái booking: `pending` chờ duyệt · `confirmed` đã xác nhận · `rejected` bị từ chối · `cancelled` đã hủy · `expired` hết hạn · `completed` đã đá · `no_show` bùng sân · `transferred` đã nhượng cho đội khác (booking của đội cũ; đội nhận có booking `confirmed` + `paid` mới). Thanh toán: `unpaid`/`paid`. Hoàn tiền: `none`/`pending`/`done`. |
| R12 | **Nhượng booking** (thay cho hủy). Chỉ booking `confirmed` + `paid`. (a) *Đăng:* khách đặt đăng nhượng với giá nhượng là số nguyên, bội số 1.000đ, **không vượt giá đã trả** (không bán lời); chủ sân không phải duyệt việc đăng, chỉ được báo. (b) *Hạn:* đăng và nhận được đến `transferCloseMinutes` (60 phút) trước giờ đá. (c) *Người chờ slot* (R9) được báo ngay lúc đăng và có quyền nhận riêng `waitlistOfferMinutes` phút (không quá hạn nhượng); người khác bị chặn trong lúc đó. (d) *Nhận:* đội đầu tiên bấm nhận thắng, đội thứ hai nhận 409. Nhận xong giữ chỗ `holdMinutes` phút và thấy VietQR của chủ sân, số tiền = giá nhượng, nội dung `NH<mã booking>`; tiền đi thẳng chủ sân. Quá hạn mà chủ sân chưa xác nhận thì đăng nhượng mở lại cho đội khác. (e) *Đổi chủ:* chỉ khi chủ sân bấm xác nhận đã nhận tiền; một bước duy nhất: booking đội cũ → `transferred`, đội nhận có booking `confirmed` + `paid`. Slot không bao giờ trống trong quá trình nhượng. Chủ sân có thể từ chối đội nhận (kèm lý do; thấy độ tin cậy của đội đó). (f) *Hoàn cho đội cũ* là việc **riêng**: số tiền = giá nhượng, `refundStatus` `pending` → `done` do chủ sân ghi nhận như R7; giao diện không được nói "đã hoàn" khi chưa `done`. Đội cũ không bị tính hủy muộn/bùng sân (R10). (g) *Không ai nhận* đến hạn nhượng: đăng nhượng `expired`, booking vẫn của đội cũ, hủy sau đó theo R7 như bình thường. Đội cũ rút đăng nhượng hoặc hủy booking khi chưa có người nhận thì đăng nhượng tự đóng; đã có người nhận thì chưa hủy được cho đến khi chủ sân xác nhận hoặc từ chối. (h) *Độ tin cậy đội nhận:* không chặn đặt nhưng chủ sân thấy R10 của đội nhận khi xác nhận và có quyền từ chối; booking nhận được tính vào R10 như booking thường khi đá/bùng. |

## 5. Danh sách màn hình (18)

### Khách hàng

| # | Màn | Nội dung chính |
|---|---|---|
| 1 | Trang chủ | Ô tìm theo giờ (ngày + giờ muốn đá + loại sân 5/7 + quận). Khối "Giảm giá giờ chót". Lối vào danh sách sân. |
| 2 | Danh sách sân / kết quả tìm | Chip lọc (ngày, giờ, giá, 5/7, quận). Thẻ sân có **giờ trống ngay trên thẻ**, giá thấp–cao, nhãn giảm giá, nhãn "tự xác nhận / chờ duyệt". |
| 3 | Chi tiết sân | Ảnh, địa chỉ + link Google Maps, tiện ích, nội quy, chính sách hủy. **Lưới slot**: 3 chip ngày; mobile chia Sáng/Chiều/Tối, desktop mỗi cột một sân con. Trạng thái ô: trống / đã đặt / đang giữ / bị chặn / đã qua / đang giữ cho người khác / **đang giữ cho bạn**. Ô đã có người giữ có nút "Báo tôi khi trống". Thanh dưới cùng tóm tắt lựa chọn + giá + nút Đặt. |
| 4 | Xác nhận đặt (hộp thoại) | Sân, giờ, giá gốc/giảm/tổng, ghi chú, chính sách hủy kèm **mốc giờ cụ thể** ("hủy trước 19:00 30/10 hoàn 100%"). Báo trước nếu booking sẽ phải chờ duyệt (do sân hoặc do độ tin cậy). |
| 5 | Chi tiết booking + thanh toán | Mã booking, trạng thái, đồng hồ đếm ngược nếu đang chờ duyệt. **VietQR** + ngân hàng, số TK, tên TK, số tiền, nội dung – mỗi dòng có nút Sao chép. Nút hủy hiện số tiền sẽ được hoàn. Lịch sử trạng thái. |
| 6 | Booking của tôi | Tab: Sắp tới / Đã qua / Đang chờ slot (danh sách chờ, có nút rời hàng; lượt đang được giữ quyền nổi bật kèm hạn) / Nhượng sân (các lần mình đăng, kèm Chưa hoàn / Đã hoàn). Trang chi tiết booking (màn 5) có form "Nhượng lại" và nút rút đăng nhượng. |
| 7 | Thông báo | Danh sách, đánh dấu đã đọc, bấm để mở trang liên quan. *(Dùng chung cho chủ sân.)* |
| 8 | Đăng nhập | |
| 9 | Đăng ký | Họ tên, email, số điện thoại, mật khẩu. |
| 17 | Nhượng sân (danh sách) | Booking đang được nhượng, lọc theo ngày; giá nhượng cạnh giá gốc gạch ngang; nhãn ưu tiên người chờ. Cũng có chip "Đang nhượng · giá" ở ô đã đặt trong lưới slot (màn 3) và mục "Nhượng sân" trên thanh điều hướng. |
| 18 | Chi tiết nhượng | Giá gốc/giá nhượng, hạn nhận, nút Nhận; sau khi nhận hiện VietQR + đồng hồ; 4 bước giải thích đổi chủ và hoàn tiền là hai việc riêng. |

### Chủ sân

| # | Màn | Nội dung chính |
|---|---|---|
| 10 | Tổng quan | Booking chờ duyệt (đếm ngược 15 phút), lịch hôm nay, số chưa thanh toán. |
| 11 | Cài đặt sân | Thông tin sân, giờ mở/đóng, độ dài slot, khung cao điểm, tự xác nhận/chờ duyệt, nội quy, tài khoản ngân hàng (chọn ngân hàng), % giảm giờ chót. Sân con: tên, 5/7, giá thường, giá cao điểm, bật/tắt. |
| 12 | Lịch & chặn lịch | Lịch theo ngày, mỗi cột một sân con, vạch giờ hiện tại. Bấm ô trống để chặn (lý do), bấm ô đã đặt để xem booking. Hiện số người đang chờ. |
| 13 | Quản lý booking | Bảng lọc theo trạng thái/ngày. Duyệt/từ chối (thấy độ tin cậy của khách), hủy, ghi nhận đã thu tiền, ghi nhận đã hoàn, đánh dấu đã đá/bùng. |

### Admin

| # | Màn | Nội dung chính |
|---|---|---|
| 14 | Tài khoản | Danh sách người dùng, tạo tài khoản chủ sân, khóa/mở. |
| 15 | Booking | Tra cứu mọi booking, hủy ngoại lệ, ghi nhận thanh toán/hoàn tiền, đánh dấu có mặt. |
| 16 | Nhật ký | Lịch sử thao tác trên booking. |

## 6. Luồng chính

1. **Đặt sân tự xác nhận:** Trang chủ → chọn 19:00 hôm nay → thẻ sân có giờ trống → bấm 19:00 → chi tiết sân (ô đã chọn sẵn) → Đặt → hộp xác nhận → booking `confirmed` → màn thanh toán QR → chủ sân ghi nhận `paid`.
2. **Đặt sân chờ duyệt:** như trên nhưng booking `pending` có đếm ngược 15 phút → chủ sân duyệt (thấy độ tin cậy) → khách nhận thông báo → QR hiện.
3. **Danh sách chờ:** slot đã có người giữ → "Báo tôi khi trống" → người kia hủy → khách nhận thông báo "slot đang giữ cho bạn đến 19:10" → vào đặt.
4. **Hủy và hoàn tiền:** khách hủy → web hiện % và số tiền hoàn theo R7 → chủ sân chuyển khoản lại và ghi nhận `done`.
5. **Bùng sân:** sau giờ đá chủ sân đánh dấu `no_show` → đủ 2 lần trong 60 ngày thì lần đặt sau của khách phải chờ duyệt.
6. **Nhượng sân:** khách A có booking đã trả tiền nhưng bận → "Nhượng lại" với giá ≤ giá gốc → người đang chờ slot được báo và ưu tiên → đội B nhận, thấy QR, chuyển khoản thẳng chủ sân → chủ sân xác nhận đã nhận tiền → booking sang B, A hiện *Chưa hoàn* → chủ sân chuyển lại tiền cho A và ghi nhận *Đã hoàn*.

## 7. API contract

Prototype FE dùng dữ liệu giả **đúng theo contract này**; khi có BE chỉ cần đổi nguồn dữ liệu. Contract lấy từ bản nháp BE (branch `draft/backend-additions`).

**Quy ước:** JSON, khóa camelCase. Thời điểm dạng `"YYYY-MM-DD HH:mm:ss"` giờ Việt Nam; ngày `"YYYY-MM-DD"`; giờ `"HH:mm"`; tiền là số nguyên VND. Lỗi trả `{ "error": "<thông báo>" }` kèm mã HTTP 400/401/403/404/409. Thao tác ghi (POST/PUT/DELETE) gửi header `X-CSRF-Token`. Đăng nhập bằng session cookie.

### Công khai

| Method | Đường dẫn | Mô tả |
|---|---|---|
| GET | `/api/meta` | Cấu hình hiển thị: `bookingWindowDays`, `holdMinutes`, `waitlistOfferMinutes`, `lastMinuteHours`, `reliabilityWindowDays`, `reliabilityMaxViolations`, `transferCloseMinutes`, `banks` (BIN + tên ngân hàng). |
| GET | `/api/venues/districts` | Danh sách quận có sân. |
| GET | `/api/venues?q=&district=&fieldType=&maxPrice=&date=&from=` | Danh sách sân → `{ date, venues: [Venue] }`. Có `date` thì mỗi sân kèm `availableSlots`. |
| GET | `/api/venues/slots?date=&at=&district=&fieldType=&maxPrice=&lastMinute=1` | Tìm theo giờ → `{ date, at, slots: [SlotResult] }`; khớp slot bắt đầu trong [at−30 phút, at+60 phút], gần giờ chọn nhất lên trước. |
| GET | `/api/venues/:id` | Chi tiết sân → `VenueDetail`. |
| GET | `/api/venues/:id/schedule?date=` | Lịch một ngày → `Schedule`. |

### Tài khoản

| Method | Đường dẫn | Mô tả |
|---|---|---|
| GET | `/api/auth/csrf` | `{ csrfToken }` |
| GET | `/api/auth/me` | `{ user: User hoặc null }` |
| POST | `/api/auth/register` | `{ fullName, email, phone, password }` → `{ user }` |
| POST | `/api/auth/login` | `{ email, password }` → `{ user }` |
| POST | `/api/auth/logout` | |

### Khách hàng

| Method | Đường dẫn | Mô tả |
|---|---|---|
| POST | `/api/bookings` | `{ courtId, date, start, note, idempotencyKey }` → `Booking`. 409 nếu slot vừa bị người khác giữ. |
| GET | `/api/bookings/mine` | `[Booking]` |
| GET | `/api/bookings/reliability` | `Reliability` của chính mình. |
| GET | `/api/bookings/:id` | `BookingDetail` |
| POST | `/api/bookings/:id/cancel` | `{ reason }` → `BookingDetail` |
| POST | `/api/waitlist` | `{ courtId, date, start }` → `{ position }` |
| GET | `/api/waitlist/mine` | `[WaitlistEntry]` |
| DELETE | `/api/waitlist/:id` | Rời hàng chờ. |
| POST | `/api/bookings/:id/transfer` | `{ askPrice }` → `Transfer`. Chủ booking, booking `confirmed` + `paid`, trước giờ đá `transferCloseMinutes` phút. 400: giá không nguyên/bội 1.000đ, vượt giá đã trả, quá hạn; 409: chưa xác nhận/chưa trả tiền, đã có đăng nhượng; 404: không phải booking của mình. |
| GET | `/api/transfers?venueId=&date=&district=` | `[Transfer]` đang mở nhận (xem không cần đăng nhập; có đăng nhập thì `role` và `priorityLocked` theo người xem). |
| GET | `/api/transfers/mine` | `[Transfer]` các lần mình đăng và các lần mình nhận. |
| GET | `/api/transfers/:id` | `Transfer`. `paymentQr` chỉ có cho đội nhận khi `status = claimed`. |
| POST | `/api/transfers/:id/claim` | → `Transfer` (kèm `paymentQr`). 409: không còn mở, đã có đội khác nhận, đang ưu tiên người chờ; 400/409: quá hạn hoặc tự nhận booking của mình. |
| DELETE | `/api/transfers/:id` | Đội đăng rút. 409 nếu đã có đội nhận. |
| GET | `/api/notifications` | `{ unread, items: [Notification] }` |
| POST | `/api/notifications/read-all` | |

### Chủ sân (`/api/owner`)

| Method | Đường dẫn | Mô tả |
|---|---|---|
| GET / POST | `/venues` | Danh sách sân của mình / tạo sân. |
| PUT | `/venues/:id` | Sửa sân (gồm ngân hàng, khung cao điểm, % giảm giờ chót). |
| POST | `/venues/:id/courts` | Thêm sân con. |
| PUT | `/courts/:id` | Sửa sân con. |
| GET | `/venues/:id/schedule?date=` | `Schedule` có thêm chi tiết booking, lý do chặn, số người chờ. |
| POST / DELETE | `/blocks`, `/blocks/:id` | Chặn / bỏ chặn lịch `{ courtId, date, start, end, reason }`. |
| GET | `/bookings?status=&date=` | `[Booking]` |
| POST | `/bookings/:id/approve` · `/reject` · `/cancel` | Duyệt / từ chối / hủy (`{ reason }`). |
| POST | `/bookings/:id/paid` · `/refund` | Ghi nhận đã thu / đã hoàn (`{ note }`). |
| POST | `/bookings/:id/attendance` | `{ result: "completed" hoặc "no_show" }` |
| GET | `/transfers` | `[Transfer]` của sân mình cần xử lý: `claimed` (chờ xác nhận tiền), `open`, và `completed` còn chờ hoàn cho đội cũ. |
| POST | `/transfers/:id/confirm` | `{ note }` → `Transfer`. Chỉ khi `claimed` và còn hạn giữ chỗ. Đổi chủ trong một bước. 409 nếu không hợp lệ. |
| POST | `/transfers/:id/reject` | `{ reason }` (bắt buộc) → `Transfer`. Báo đội nhận; mở lại nếu còn hạn nhượng, ngược lại `expired`. |

Hoàn cho đội cũ dùng `POST /bookings/:bookingId/refund` có sẵn (booking `transferred`, `refundAmount` = giá nhượng).

### Admin (`/api/admin`)

`GET /users`, `POST /owners`, `POST /users/:id/active`, `GET /bookings`, `POST /bookings/:id/cancel | paid | refund | attendance`, `GET /logs`.

### Kiểu dữ liệu chính

```text
Venue        { id, name, district, address, phone, imageUrl, amenities[], openTime, closeTime,
               slotMinutes, requiresApproval, lastMinutePercent, vietQr, fieldTypes[],
               minPrice, maxPrice, availableSlots? }
VenueDetail  Venue + { description, rules, peakStart, peakEnd, cancelPolicy, mapsUrl,
               courts: [{ id, name, fieldType, price, peakPrice }] }
Schedule     { date, slotMinutes, courts: [{ id, name, fieldType, slots: [Slot] }] }
Slot         { start, end, transfer? { id, askPrice, originalPrice } (ô đã đặt đang nhượng), basePrice, discountPercent, price, peak,
               status: "available"|"booked"|"held"|"blocked"|"past"|"offered",
               offeredToYou?, offerExpiresAt?, onWaitlist? }
SlotResult   { venueId, venueName, district, address, requiresApproval, courtId, courtName,
               fieldType, start, end, price, basePrice, discountPercent, peak, offeredToYou }
Booking      { id, code, venueId, venueName, courtId, courtName, fieldType, startAt, endAt,
               status, expiresAt, price, basePrice, discountPercent, paymentStatus,
               refundStatus, refundPercent, refundAmount, cancelledBy, cancelReason, createdAt,
               acquiredByTransfer, transfer? { id, status, askPrice, closesAt, claimExpiresAt } }
BookingDetail Booking + { customerNote, rulesSnapshot, policySnapshot, history: [{ action,
               fromStatus, toStatus, actorName, note, createdAt }], paymentQr: PaymentQr|null,
               customerReliability: Reliability|null }
PaymentQr    { url, bankName, account, accountName, amount, content }
Reliability  { noShows, lateCancels, completed, violations, windowDays, maxViolations, restricted }
WaitlistEntry { id, venueId, venueName, courtId, courtName, fieldType, startAt, endAt,
               status: "waiting"|"offered", offerExpiresAt, offerActive }
Transfer     { id, status: "open"|"claimed"|"completed"|"cancelled"|"expired", askPrice, originalPrice,
               discountPercent, venueId, venueName, courtId, courtName, fieldType, startAt, endAt,
               createdAt, closesAt, priorityUntil, priorityLocked, role: "giver"|"claimer"|"staff"|null,
               claimedAt, claimExpiresAt, endReason,
               giver/staff: bookingId, bookingCode, refund { status, amount }|null;
               claimer: newBookingId, paymentQr|null;
               staff: giverName, claimerName, claimerPhone, claimerReliability, newBookingId, paymentContent }
Notification { id, bookingId, message, link, isRead, createdAt }
User         { id, fullName, email, phone, role: "customer"|"owner"|"admin" }
```

> Bản nháp BE hiện trả một số đối tượng booking theo snake_case; khi nối BE sẽ chuyển sang camelCase cho khớp contract.

## 8. Hướng giao diện

Tham khảo (Mobbin): Zocdoc – giờ trống ngay trên thẻ; Fresha/Opendoor – chip ngày + thanh đặt dính dưới; Preply – chia giờ theo buổi; Walmart – lưới tuần (đổi thành cột sân con); Tripadvisor – khung chính sách hủy; GetYourGuide/Klook – chip lọc, giá gạch ngang; Monzo – màn QR; Fresha web – lịch chủ sân; MLS/Fixtured – chất thể thao.

- **Mobile-first**: khách chủ yếu đặt bằng điện thoại; lưới slot cuộn ngang trên mobile.
- Phần hero/tiêu đề mang chất thể thao (chữ đậm hẹp, xanh cỏ, tương phản cao); phần đặt sân nền sáng, gọn, ưu tiên đọc giờ và giá.
- Màu trạng thái slot nhất quán ở mọi màn, có cả chữ/biểu tượng – không chỉ dựa vào màu.
- Một file CSS chung với biến (màu, chữ, khoảng cách, bo góc) và class dùng lại (nút, thẻ, badge trạng thái, bảng, hộp thoại).

## 9. Kỹ thuật

- **Stack theo báo cáo:** HTML5/CSS3/JavaScript thuần (ES modules, không bước build) · Node.js + Express · MySQL · Git/GitHub.
- **Prototype:** các trang trong `public/` gọi API qua một module `api.js` duy nhất; ở chế độ prototype module này đọc dữ liệu giả `public/mock/*.json` và giả lập thao tác ghi trong bộ nhớ trình duyệt. Có công tắc vai trò (khách/chủ sân/admin) để demo khi chưa có đăng nhập thật.
- **Khi nối BE:** tắt chế độ giả trong `api.js`; giao diện không đổi.
- Header/menu do JS chung vẽ theo vai trò, không lặp HTML ở từng trang.

## 10. Câu hỏi còn mở

1. Deadline của môn và ngày demo.
2. Phân công thành viên (FE/BE/tài liệu/test).
3. Có dùng Figma để vẽ wireframe trước không, hay vẽ thẳng bằng HTML.
4. Hình ảnh sân: dùng ảnh minh họa tự vẽ/không bản quyền hay ảnh thật nhóm chụp.
