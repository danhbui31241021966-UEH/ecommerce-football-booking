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
| Khách hàng | Đặt sân, thanh toán qua QR, hủy, xếp hàng chờ, nhận thông báo. Nhượng booking đã trả tiền cho đội khác thay vì hủy; nhận nhượng booking của đội khác. Mở trận đủ hai đội hoặc vào trận có sẵn ở sân bật chế độ này. Đăng nhu cầu (quận, ngày, khung giờ, loại sân, ngân sách), xem các chào giá của sân và chọn một để đặt sân. |
| Chủ sân | Quản lý sân/sân con, giá, lịch, chặn lịch, duyệt booking, ghi nhận thanh toán/hoàn tiền, đánh dấu có mặt/bùng, xác nhận đã nhận tiền của đội nhận nhượng (hoặc từ chối đội đó). Bật chế độ "đủ hai đội" cho từng sân con (cả ngày hoặc một khung giờ); xác nhận từng phần tiền của hai đội, hủy trận, ghi hoàn cho từng đội. Xem nhu cầu của khách ở khu vực sân mình và gửi chào giá (chọn sân con + slot, giá, hiệu lực), rút chào giá. |
| Admin | Cấp và khóa tài khoản chủ sân, can thiệp booking ngoại lệ, xem nhật ký. |

## 3. Phạm vi MVP

**Trong phạm vi:** F01–F16 của báo cáo, cộng A7 VietQR, A9 danh sách chờ, A10 tìm theo giờ, A11 độ tin cậy, A12 giảm giá giờ chót.

**Ngoài phạm vi:** cổng thanh toán/ví (web không giữ tiền), app di động, đặt nhiều slot một lần, đặt định kỳ, kèo có tiền cược thêm hoặc kèo theo tỉ số (chỉ có kèo tiền sân, R15), đánh giá/review sân, bản đồ tương tác, SMS/email/Zalo (chỉ thông báo trong web), đa ngôn ngữ.

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
| R8 | **VietQR:** chỉ hiện khi booking đã xác nhận và chưa thanh toán. QR theo tài khoản chủ sân, số tiền = giá booking, nội dung = mã booking. Tiền được ghi nhận "đã nhận" tự động khi ngân hàng báo về (R17), hoặc chủ sân bấm tay khi không tự được. |
| R9 | **Danh sách chờ:** chỉ đăng ký được cho slot đang có người giữ (không phải slot bị chặn hay đang trống). Khi slot trống lại, người chờ sớm nhất được giữ quyền đặt **10 phút** (không quá giờ bắt đầu); hết hạn thì chuyển cho người kế tiếp. |
| R10 | **Độ tin cậy:** đếm số lần *bùng sân* (chủ sân đánh dấu no-show) + *hủy muộn* (hủy booking đã xác nhận khi còn <12h) trong **60 ngày**. Từ **2 lần** trở lên, mọi booking mới của khách đó phải chờ chủ sân duyệt, kể cả ở sân tự xác nhận. Chủ sân thấy chỉ số này khi duyệt. |
| R11 | Trạng thái booking: `pending` chờ duyệt · `confirmed` đã xác nhận · `rejected` bị từ chối · `cancelled` đã hủy · `expired` hết hạn · `completed` đã đá · `no_show` bùng sân · `transferred` đã nhượng cho đội khác (booking của đội cũ; đội nhận có booking `confirmed` + `paid` mới) · `matching` giữ chỗ chờ đủ hai đội (trận đủ hai đội, chưa chốt). Thanh toán: `unpaid`/`paid`. Hoàn tiền: `none`/`pending`/`done`. |
| R12 | **Nhượng booking** (thay cho hủy). Chỉ booking `confirmed` + `paid`. (a) *Đăng:* khách đặt đăng nhượng với giá nhượng là số nguyên, bội số 1.000đ, **không vượt giá đã trả** (không bán lời); chủ sân không phải duyệt việc đăng, chỉ được báo. (b) *Hạn:* đăng và nhận được đến `transferCloseMinutes` (60 phút) trước giờ đá. (c) *Người chờ slot* (R9) được báo ngay lúc đăng và có quyền nhận riêng `waitlistOfferMinutes` phút (không quá hạn nhượng); người khác bị chặn trong lúc đó. (d) *Nhận:* đội đầu tiên bấm nhận thắng, đội thứ hai nhận 409. Nhận xong giữ chỗ `holdMinutes` phút và thấy VietQR của chủ sân, số tiền = giá nhượng, nội dung `NH<mã booking>`; tiền đi thẳng chủ sân. Quá hạn mà chủ sân chưa xác nhận thì đăng nhượng mở lại cho đội khác. (e) *Đổi chủ:* chỉ khi chủ sân bấm xác nhận đã nhận tiền; một bước duy nhất: booking đội cũ → `transferred`, đội nhận có booking `confirmed` + `paid`. Slot không bao giờ trống trong quá trình nhượng. Chủ sân có thể từ chối đội nhận (kèm lý do; thấy độ tin cậy của đội đó). (f) *Hoàn cho đội cũ* là việc **riêng**: số tiền = giá nhượng, `refundStatus` `pending` → `done` do chủ sân ghi nhận như R7; giao diện không được nói "đã hoàn" khi chưa `done`. Đội cũ không bị tính hủy muộn/bùng sân (R10). (g) *Không ai nhận* đến hạn nhượng: đăng nhượng `expired`, booking vẫn của đội cũ, hủy sau đó theo R7 như bình thường. Đội cũ rút đăng nhượng hoặc hủy booking khi chưa có người nhận thì đăng nhượng tự đóng; đã có người nhận thì chưa hủy được cho đến khi chủ sân xác nhận hoặc từ chối. (h) *Độ tin cậy đội nhận:* không chặn đặt nhưng chủ sân thấy R10 của đội nhận khi xác nhận và có quyền từ chối; booking nhận được tính vào R10 như booking thường khi đá/bùng. |
| R13 | **Trận đủ hai đội.** Chủ sân bật chế độ cho một sân con, cả ngày hoặc trong khung `from`–`to` (lưu trên sân con: `teamMode { from, to }`; giờ ngoài khung và sân chưa bật đặt như bình thường). Giờ trong khung **không đặt một mình được** (409), chỉ chốt khi đủ hai đội. (a) *Mở kèo:* đội A chọn giờ, kèo tiền sân (R15) và hạn chót. Giá sân là giá thường (không giảm giờ chót). Mỗi đội luôn chuyển trước nửa tiền sân: phần A = giá chia hai làm tròn nghìn, phần B = phần còn lại, tổng hai phần luôn đúng giá sân (không còn chọn chia 30–70% như trước; phần chênh theo kèo trả sau trận, R15). (b) *Hạn chót:* do đội A chọn, trong khoảng từ `matchMinOpenMinutes` (60 phút) sau bây giờ đến `matchCloseMinutes` (120 phút) trước giờ đá; còn quá ít thời gian thì không mở trận được. Hạn tối đa cách giờ đá 2 giờ để chủ sân còn kịp dùng lại sân. (c) *Giữ slot:* mở trận tạo ngay một booking `matching` giữ slot (R4: không ai đặt trùng; người khác vào danh sách chờ R9 như thường). Đội A có `holdMinutes` (15 phút, như R3) để chuyển phần của mình; chủ sân chưa xác nhận kịp thì trận tự hủy, slot nhả, không có khoản hoàn (chưa nhận tiền). Chủ sân xác nhận thì slot được giữ đến hạn chót và trận hiện cho đội khác. (d) *Vào trận:* chỉ khi phần của A đã được chủ sân xác nhận. Đội vào đầu tiên thắng, đội sau nhận 409; đội A không tự vào trận của mình (400). Đội B giữ chỗ `holdMinutes` phút để chuyển phần của mình và thấy VietQR của phần đó; quá hạn mà chủ sân chưa xác nhận thì B rời trận, trận mở lại cho đội khác. Chủ sân có thể từ chối B (kèm lý do). (e) *Tiền:* mỗi đội chuyển phần của mình thẳng cho chủ sân (VietQR, nội dung `TD<mã booking>A` hoặc `B`). Chủ sân xác nhận từng phần riêng; giao diện chỉ coi một phần là đã trả khi chủ sân đã xác nhận. Đủ hai phần: booking thành `confirmed` + `paid` (đứng tên A), trận `confirmed`. Trận đã chốt: khách không tự hủy được, chủ sân hủy thì hoàn 100% cho cả hai đội. (f) *Đến hạn thiếu một đội:* trận `expired`, booking `expired`, slot nhả (R9 chạy tiếp). Phần nào chủ sân đã xác nhận nhận tiền được ghi vào hoàn tiền của đội đó (100%, `pending` → `done` do chủ sân ghi nhận, theo dõi riêng từng đội trên trận); giao diện không được nói "đã hoàn" khi chưa `done`. (g) *Đội A rút trận:* khi chưa có B: miễn phí, hoàn đủ phần A đã được xác nhận, không tính hủy muộn. Khi đã có B: tính như hủy, phần A đã trả hoàn theo R7 trên phần của A, hủy dưới 12 giờ trước giờ đá là hủy muộn (R10); B chưa được ghi nhận tiền nên không có khoản hoàn. (h) *Độ tin cậy:* không chặn đội nào vào trận; chủ sân thấy R10 của cả hai đội khi xác nhận và có quyền từ chối B. Bùng sân/đã đá của booking đã chốt ghi cho đội đứng tên booking (A). Booking của trận không nhượng được (R12). |
| R14 | **Nhu cầu và chào giá.** (a) *Đăng nhu cầu:* khách đăng quận, ngày (trong cửa sổ R1), khung giờ `from`–`to` (dài ≥ 60 phút), loại sân 5/7, ngân sách cho một slot (số nguyên, bội số 1.000đ), hạn nhận chào giá và ghi chú tùy chọn. Hạn nhận chào giá từ `requestMinOpenMinutes` (30 phút) sau bây giờ đến `requestCloseMinutes` (60 phút) trước giờ bắt đầu khung giờ; còn quá ít thời gian thì không đăng được. Không đăng được nếu quận đó chưa có sân nào phù hợp. Mỗi khách có tối đa `requestMaxOpen` (3) nhu cầu đang mở; độ tin cậy R10 **không** chặn việc đăng. (b) *Sân "phù hợp"* là điều kiện dữ liệu, không đọc nghĩa chữ: cụm sân đang mở, cùng quận, có sân con đang mở đúng loại và có ít nhất một slot nằm trọn trong khung giờ. Chỉ chủ sân có cụm sân phù hợp thấy nhu cầu và được báo; ngân sách **không** lọc, chỉ để hiển thị. Khách chỉ thấy nhu cầu của chính mình. (c) *Chào giá:* chủ sân chọn sân con và một slot trọn trong khung giờ, còn trống, **không** thuộc chế độ đủ hai đội (R13; không chào giá riêng được, 409). Giá chào là số nguyên, bội số 1.000đ, không vượt giá niêm yết của slot (chào giá là ưu đãi, không phải tăng giá); có thể cao hơn ngân sách, khi đó khách thấy nhãn "Vượt ngân sách" và tự quyết. Hiệu lực từ `offerMinMinutes` (15 phút) sau bây giờ đến hết hạn nhận chào giá của nhu cầu. Mỗi cụm sân chỉ có một chào giá đang mở cho một nhu cầu (muốn đổi thì rút rồi chào lại) và mỗi nhu cầu có tối đa `requestMaxOffers` (5) chào giá đang mở. (d) *Chào giá KHÔNG giữ slot* (khác R13): người khác vẫn đặt, xếp hàng chờ, chặn lịch bình thường. Chào giá hiện đúng trạng thái slot lúc xem: slot đã bị lấy thì hiện "Không dùng được" kèm lý do và không có nút chọn. (e) *Chọn chào giá:* khách chọn một chào giá đang mở; hệ thống kiểm lại ngay lúc đó (còn hiệu lực, slot còn trống và không bị chặn/giữ cho người chờ/chuyển sang chế độ đủ hai đội, giá niêm yết hiện tại vẫn ≥ giá chào) rồi tạo booking **qua đúng luồng đặt thường**: tự xác nhận hay chờ duyệt theo chế độ nhận booking của sân (R3), R2/R4 (không trùng slot), R10 (khách bị hạn chế vẫn chờ duyệt), VietQR như thường, tiền chuyển thẳng cho chủ sân. Không còn dùng được thì 409 "Chào giá này không còn dùng được: …", chào giá chuyển `void`, **không** tạo booking. Bấm lặp cùng một chào giá trả lại đúng booking cũ. (f) *Giá lưu:* booking lưu `price` = giá chào (R6: giá chốt tại lúc đặt), `basePrice` = giá niêm yết, `discountPercent` = 0 (không phải giảm giờ chót) và `offerId` (API trả `fromOffer`); lịch sử ghi `offer_accept` kèm giá chào và giá niêm yết. Chính sách hủy R7 tính trên `price`. (g) *Sau khi chọn:* nhu cầu `chosen`; các chào giá đang mở của nhu cầu thành `lost` và chủ sân của chúng được báo; chủ sân thắng được báo kèm mã booking. (h) *Hủy / rút / hết hạn:* khách hủy nhu cầu đang mở (chưa có booking nên không có tiền hoàn): chào giá mở thành `void`, chủ sân được báo. Nhu cầu đã chốt thì hủy ở booking như thường. Chủ sân rút chào giá của mình: `withdrawn`, khách được báo. Hết hạn nhận chào giá mà chưa chọn: nhu cầu `expired`, chào giá mở thành `expired`, khách được báo; chào giá quá hiệu lực riêng của nó thì `expired` trước. (i) Chào giá không phải booking: không đếm vào R10, không có tiền đi qua hệ thống. |
| R15 | **Kèo tiền sân (trên ghép kèo).** (a) *Kèo:* khi mở kèo, đội mở chọn `loserPercent` thuộc {50, 60, 70, 100}: 5-5 (hòa vốn), 6-4, 7-3, "thua bao sân" (10-0). Đội thua chịu `loserAmount` = giá × `loserPercent` làm tròn nghìn, đội thắng chịu `winnerAmount` = giá trừ `loserAmount`; tổng hai đội luôn đúng giá sân. **Chỉ có kèo tiền sân:** không tiền cược thêm, không kèo theo tỉ số; web phải nói rõ điều này ở màn mở kèo và màn kèo. (b) *Giữ sân không đổi:* mỗi đội chuyển trước nửa tiền sân cho chủ sân, chủ sân xác nhận từng phần, đủ hai phần thì chốt (R13). Hạn tìm đủ đội, nhả giờ, trả lại tiền giữ nguyên. (c) *Báo kết quả:* kèo `confirmed` có `loserPercent` lớn hơn 50 sang bước báo kết quả khi qua `endAt` (`result.status = awaiting`, hạn báo `reportBy` = `endAt` + 48 giờ). Chỉ hai đội trưởng (tài khoản đội mở và đội vào) báo, bằng lựa chọn có cấu trúc `winner` thuộc `host` / `guest` / `draw` (giao diện hiện "Đội mình thắng / Đội kia thắng / Hòa"); báo lại được đến khi chốt. Kèo 5-5 không cần báo kết quả. (d) *Chốt kết quả:* hai báo cáo giống nhau thì `settled`, `settledBy = agree`. Hai báo cáo lệch nhau thì `needs_owner` ngay. Quá `reportBy` mà chưa khớp (một bên hoặc cả hai không báo) thì `needs_owner`; từ đó đội không báo lại được. Chủ sân của sân chốt `winner` ở mục Ghép kèo của Quản lý lịch đặt (nút "Chốt kết quả"); `settledBy = owner`. Admin chỉ xem. Chủ sân không chốt được khi các đội còn trong hạn báo mà chưa lệch (409). (e) *Trả phần chênh:* có thắng/thua thì `topUp` = { from: đội thua, to: đội thắng, amount = `loserAmount` trừ phần đội thua đã trả trước, status `unpaid` sang `received`, `dueBy` = lúc chốt + 48 giờ }. Hòa thì không có `topUp`, không ai trả thêm. Đội thua thấy "Đội thua trả thêm X cho đội thắng" kèm mã QR tới tài khoản đội thắng; đội thắng bấm "Đã nhận" thì `received`. Khoản này đi thẳng giữa hai đội: web không giữ tiền, không bắt buộc trả, chỉ ghi "Chưa trả" / "Đã nhận"; quá `dueBy` chỉ hiện chữ "quá hạn". (f) *Tài khoản ngân hàng:* mỗi đội nhập `{ bin, account, accountName }` một lần cho kèo, khi báo kết quả hoặc ở màn đã chốt. Lưu trên kèo (`hostBank`/`guestBank`), không lưu vào hồ sơ. Một đội xem tài khoản của chính mình; đội thua chỉ thấy tài khoản đội thắng, dưới dạng QR trả chênh, khi kèo đã chốt và còn `unpaid`. Người ngoài kèo, chủ sân, admin không thấy số tài khoản. (g) *Kèo cũ:* kèo không có `loserPercent` (chốt trước khi có R15) coi như 5-5: không có kết quả, không có phần chênh. (h) *Uy tín:* không tự động phạt; phần chênh không trả chỉ hiện "Chưa trả · quá hạn" cho hai đội. Đề xuất: chỉ khi đội thắng và chủ sân/admin cùng xác nhận nhiều lần không trả mới xem xét một mục riêng, không gộp vào R10. |
| R16 | **Lịch đặt qua điện thoại (chủ sân tự thêm).** Khách gọi điện hoặc nhắn Zalo thì chủ sân tự ghi vào lịch. (a) *Thêm:* chủ sân của sân đó nhập tên khách (bắt buộc), số điện thoại (không bắt buộc), sân con, ngày, giờ, giá (mặc định giá thường, nhập lại được, 0 đến 100 triệu), đã nhận tiền hay chưa, ghi chú. Không có tài khoản khách, không báo cho ai, không tính vào độ tin cậy (R10). (b) *Giữ giờ như đặt thật:* lịch có `source = phone`, `userId = null`, `walkIn = { name, phone }`, trạng thái `confirmed`, `paymentStatus` = `paid` hoặc `unpaid`. Giờ đó hiện "Đã đặt" với khách trên web, khách đặt trùng nhận 409; có trong danh sách và lịch hôm nay với nhãn "Đặt qua điện thoại". (c) *Giờ không thêm được (lỗi rõ):* giờ đã qua (400); đã có lịch, đang giữ chỗ, đang bị chặn, đang giữ cho người xếp hàng chờ (R6), hoặc giờ đang ở chế độ "Chỉ nhận ghép kèo" (R13) (409). Giờ đang có người xếp hàng chờ nhưng còn trống thì vẫn thêm được; người chờ không được báo, vì giờ đó vốn chưa nhả cho họ. (d) *Sửa:* chủ sân sửa tên, SĐT, giá, ghi chú. Không đổi sân/giờ (muốn đổi thì hủy rồi thêm lại, để lưới và người chờ luôn đúng). Đã nhận tiền thì khóa giá (409). (e) *Hủy:* chủ sân hủy như lịch thường nhưng không tạo khoản trả lại (`refundPercent = 0`, `refundStatus = none`): web không giữ tiền của khách này, chủ sân tự trả ngoài web; không tính hủy muộn. Giờ trống lại, người xếp hàng chờ nhận lượt như thường lệ. (f) *Ghi nhận tiền:* như lịch thường (`/paid`). Đã đá / bùng sân: bùng sân không ghi vào uy tín vì không có tài khoản. (g) *Admin:* thấy trong Lịch đặt với nhãn và tên/SĐT khách, chỉ xem và xử lý ngoại lệ như lịch thường; nhật ký có `phone_create`, `phone_update`. |
| R17 | **Ngân hàng báo có tiền (SePay).** Khách chuyển thẳng vào tài khoản chủ sân, web không giữ tiền. Ngân hàng báo về (webhook của SePay) thì hệ thống tự ghi nhận "đã nhận tiền", chủ sân không phải bấm. (a) *Khớp bằng cấu trúc, không đoán ý:* chỉ đọc **mã đơn có định dạng** trong nội dung chuyển khoản (`SN#####` cho đơn thường; `NH` + mã cho nhượng R12; `TD` + mã + `A`/`B` cho từng phần của kèo R13) và so **số tiền đúng bằng** số cần chuyển. Mã dính liền chữ khác (ví dụ `KEO` + mã) hoặc không có mã thì không khớp. (b) *Tự ghi nhận khi:* mã khớp một khoản đang chờ tiền (đơn `confirmed` + `unpaid`; nhượng đang `claimed` còn hạn giữ chỗ; phần kèo còn trong hạn giữ chỗ) **và** số tiền bằng đúng số cần chuyển. Kết quả như chủ sân bấm tay: đơn `paid`, nhượng đổi chủ, phần kèo được nhận (đủ hai phần thì chốt sân). Đơn ghi `paidVia = bank` (chủ sân bấm tay thì `owner`), nhật ký ghi nguồn "Ngân hàng báo" (`bank_paid`) thay vì tên chủ sân; khách và chủ sân đều được báo. (c) *Không tự ghi nhận, chủ sân xử lý tay:* thiếu tiền, thừa tiền, sai hoặc thiếu mã, mã không có ở sân này, **tiền vào tài khoản của sân khác với sân của đơn** (hoặc báo cáo không có số tài khoản nhận), đơn đã trả/đã hủy/hết hạn, đơn **chưa được chủ sân đồng ý** (khách chưa thấy QR nên tiền về sớm là chuyển nhầm hoặc chuyển sai chỗ). Khoản đó thành thẻ "Ngân hàng báo có … chưa tự ghi nhận" trong "Việc cần làm ngay" của chủ sân kèm lý do, chủ sân nhận thông báo; xử lý xong (nhận đủ thì bấm "Đã nhận tiền" ở đơn, thừa/thiếu thì chuyển lại hoặc nhờ khách bù) thì bấm "Đã xử lý". Nhật ký đơn có `bank_unmatched`, `bank_resolved`. (d) *Lặp lại vô hại:* mỗi giao dịch có mã giao dịch của ngân hàng; báo lại cùng mã giao dịch thì không ghi thêm gì, không thông báo thêm. Giao dịch **khác** mã báo thêm tiền cho đơn đã trả thì thành khoản cần xử lý (không cộng dồn). (e) *Vẫn bấm tay được:* tiền mặt, khách đặt qua điện thoại (R16), chuyển sai nội dung, ngân hàng chậm báo. Bấm tay và tự động không chồng nhau: đơn đã `paid` thì lần sau bị 409 hoặc thành khoản cần xử lý. (f) *Luôn thủ công:* hoàn tiền (R7, R12f, R13f), phần chênh theo kèo (R15: đội thua chuyển cho **tài khoản đội thắng**, không qua tài khoản chủ sân nên webhook của chủ sân không thấy), hủy, bùng sân. (g) *Bản prototype chỉ mô phỏng:* màn khách có nút "Tôi đã chuyển khoản (mô phỏng)" (và "Thử chuyển sai": thiếu 10.000đ, thừa 10.000đ, sai nội dung); khoảng 4 giây sau mock gọi cùng một hàm "ngân hàng báo có tiền" với dữ liệu giống webhook `{ txId, content, amount, account }`. Công cụ Demo có nút "Giả lập: ngân hàng báo có tiền ngay" gọi hàm đó cho mọi khoản đang chờ. Mọi chỗ hiện nguồn này đều ghi "(mô phỏng)". Khối giả lập không có ở bản thật. |
| R18 | **Giải phủi tại một sân (vòng tròn một lượt).** Chủ sân tạo giải ở sân của mình: tên, loại sân 5 hoặc 7 người, 4–8 đội, điều lệ chữ (có sẵn bản mặc định), link nhóm Zalo/fanpage (không bắt buộc). Đội chỉ cần tên đội và người liên hệ (tên, số điện thoại không bắt buộc), không có tài khoản. (a) *Trạng thái suy ra, không lưu:* `draft` (chưa công bố) → `published` → `ongoing` (đã có kết quả hoặc có trận đã đến giờ) → `finished` (mọi trận có kết quả). (b) *Trận:* nhập đủ đội rồi "tạo các trận" (xoay vòng, mỗi cặp một trận; làm lại được khi còn nháp). Xếp giờ bằng tay từng trận hoặc "xếp tự động" (một sân con, từ ngày/giờ chọn, tối đa N trận mỗi ngày). Lưu giờ ở bước nháp chưa giữ chỗ. (c) *Công bố = giữ giờ cả loạt:* phải có giờ đủ mọi trận. Hệ thống kiểm cả loạt trước (ô đã có lịch/chặn/giữ cho người chờ, giờ đã qua, sân con sai loại, hai trận trùng giờ, một đội hai trận cùng giờ); **có một lỗi thì không giữ ô nào** và báo lỗi nào. Giờ giữ là một "chặn giờ" gắn mã giải nên khách đặt thường, chủ thêm lịch điện thoại, ghép kèo đều không đặt trùng được; chủ sân không bỏ chặn tay được (409). Giờ giữ **không bị giới hạn cửa sổ đặt 3 ngày** như chặn giờ. Ô trên lưới khách và lưới chủ sân ghi "Giải: <tên giải>". (d) *Hoãn trận:* chủ sân đổi sang giờ khác (kiểm như (c) cho ô mới); giờ cũ được trả (đi qua luồng người chờ giờ sẵn có), giờ mới được giữ; ghi lịch sử (ai, lúc nào, lý do). Trận đã có kết quả thì không hoãn. Xóa giải: trả mọi giờ, xóa đội và kết quả. (e) *Tỉ số:* chỉ chủ sân của sân đó nhập, và chỉ khi trận đã đến giờ đá. Sửa tỉ số bắt buộc có lý do; mọi lần nhập/sửa lưu `{ ai, lúc nào, từ, thành, lý do }`. (f) *Bảng xếp hạng tự tính:* thắng 3, hòa 1, thua 0; xếp theo điểm, rồi hiệu số, rồi bàn thắng; vẫn bằng thì theo tên đội A–Z. Thứ tự này ghi trong điều lệ mặc định. (g) *Đội rút giữa giải* (chỉ sau công bố): kết quả đã đá giữ nguyên; mọi trận chưa đá của đội đó thành thua 0-3 (đội kia thắng 3-0), giờ giữ được trả, bảng ghi "Đã rút". Không hoàn tác. Trước công bố thì xóa đội thay vì cho rút; thêm/xóa đội chỉ làm được khi còn nháp và chưa tạo các trận. (h) *Lệ phí:* không thu qua web; chủ sân chỉ tick đội đã nộp/chưa nộp. Số điện thoại và lệ phí chỉ chủ sân thấy. (i) *Trang giải công khai* `/league.html?id=` (không cần đăng nhập, chỉ giải đã công bố): đội, lịch, kết quả, bảng xếp hạng, điều lệ, nút sao chép link, link nhóm Zalo/fanpage; có title/description/og/canonical theo từng giải (không lập chỉ mục nếu sân là sân demo); trang chi tiết sân liệt kê giải chưa kết thúc. Không làm: loại trực tiếp, chia bảng, vua phá lưới, thẻ phạt, giải nhiều sân, chat/khiếu nại, giải thưởng, gắn tỉ số với tiền, tin tức. |

## 5. Danh sách màn hình (27)

**Tên hiển thị (đã đổi cho dễ hiểu).** Chỉ đổi chữ trên giao diện; tên endpoint, trường dữ liệu, giá trị `status` và khóa localStorage giữ nguyên (mục 7 vẫn dùng tên cũ).

| Tên cũ | Tên mới | Ghi chú |
|---|---|---|
| Nhượng sân / đăng nhượng / giá nhượng | Pass sân / đăng pass / giá pass | |
| Ghép trận, trận đủ hai đội, đội mở / đội vào | Ghép kèo, kèo, đội mở kèo / đội vào kèo | hạn chót → "hạn tìm đủ đội" |
| Chế độ đủ hai đội (chủ sân) | Chỉ nhận ghép kèo | |
| (mới, R15) hệ số chia tiền sau trận | Kèo tiền sân: 5-5, 6-4, 7-3, thua bao sân; phần chênh gọi là "trả thêm" | không có từ "cược" hay "tỉ số": chỉ chia tiền sân |
| Đăng nhu cầu / Nhu cầu của tôi | Nhờ sân báo giá / Tôi đã nhờ báo giá | menu khách: "Nhờ báo giá"; menu chủ sân: "Khách nhờ báo giá" |
| Chào giá, ngân sách, giá niêm yết | Báo giá, mức giá bạn muốn, giá thường | |
| Booking, Booking của tôi | Lịch đặt, Lịch đặt của tôi | |
| slot, sân con | giờ, sân | "cụm sân" giữ nguyên |
| Tự xác nhận / Chủ sân duyệt | Đặt là chốt / Chủ sân duyệt | câu dài: "chủ sân đồng ý mới có sân" |
| Chờ duyệt, Đã xác nhận, Từ chối, Hết hạn | Chờ chủ sân đồng ý, Đã có sân, Chủ sân từ chối, Quá hạn | "Đã có sân" luôn đi kèm nhãn "Chưa chuyển khoản / Đã chuyển khoản" |
| Chờ đủ hai đội (matching), Đã nhượng | Đang tìm đội đá cùng, Đã pass | |
| Hoàn tiền, Chưa hoàn / Đã hoàn | Trả lại tiền, Chưa trả lại / Đã trả lại | nút chủ sân: "Đã chuyển lại …" |
| Thanh toán, VietQR, thu tiền | Chuyển khoản, mã QR, "Đã nhận tiền" (nút chủ sân) | |
| Độ tin cậy, hủy muộn | Uy tín, hủy sát giờ | |
| Danh sách chờ | Chờ giờ này (nút "Báo tôi khi trống") | |

### Khách hàng

| # | Màn | Nội dung chính |
|---|---|---|
| 1 | Trang chủ | Ô tìm theo giờ (ngày + giờ muốn đá + loại sân 5/7 + quận). Khối "Giảm giá giờ chót". Lối vào danh sách sân. |
| 2 | Danh sách sân / kết quả tìm | Chip lọc (ngày, giờ, giá, 5/7, quận). Thẻ sân có **giờ trống ngay trên thẻ**, giá thấp–cao, nhãn giảm giá, nhãn "tự xác nhận / chờ duyệt". |
| 3 | Chi tiết sân | Ảnh, địa chỉ + link Google Maps, tiện ích, nội quy, chính sách hủy. **Lưới slot**: 3 chip ngày; mobile chia Sáng/Chiều/Tối, desktop mỗi cột một sân con. Trạng thái ô: trống / đã đặt / đang giữ / bị chặn / đã qua / đang giữ cho người khác / **đang giữ cho bạn**. Ô đã có người giữ có nút "Báo tôi khi trống". Thanh dưới cùng tóm tắt lựa chọn + giá + nút Đặt. |
| 4 | Xác nhận đặt (hộp thoại) | Sân, giờ, giá gốc/giảm/tổng, ghi chú, chính sách hủy kèm **mốc giờ cụ thể** ("hủy trước 19:00 30/10 hoàn 100%"). Báo trước nếu lịch đặt sẽ phải chờ duyệt (do sân hoặc do độ tin cậy). |
| 5 | Chi tiết lịch đặt + thanh toán | Mã lịch đặt, trạng thái, đồng hồ đếm ngược nếu đang chờ duyệt. **VietQR** + ngân hàng, số TK, tên TK, số tiền, nội dung – mỗi dòng có nút Sao chép. Nút hủy hiện số tiền sẽ được hoàn. Lịch sử trạng thái. |
| 6 | Lịch đặt của tôi | Tab: Sắp tới / Đã qua / Đang chờ slot (danh sách chờ, có nút rời hàng; lượt đang được giữ quyền nổi bật kèm hạn) / Pass sân (các lần mình đăng, kèm Chưa hoàn / Đã hoàn) / Ghép kèo (các trận mình mở hoặc vào, kèm trạng thái và Chưa hoàn / Đã hoàn). Trang chi tiết lịch đặt (màn 5) có form "Pass lại" và nút rút đăng pass. |
| 7 | Thông báo | Danh sách, đánh dấu đã đọc, bấm để mở trang liên quan. *(Dùng chung cho chủ sân.)* |
| 8 | Đăng nhập | |
| 9 | Đăng ký | Họ tên, email, số điện thoại, mật khẩu. |
| 17 | Pass sân (danh sách) | Lịch đặt đang được pass, lọc theo ngày; giá pass cạnh giá gốc gạch ngang; nhãn ưu tiên người chờ. Cũng có chip "Đang pass · giá" ở ô đã đặt trong lưới slot (màn 3) và mục "Pass sân" trên thanh điều hướng. |
| 19 | Ghép kèo (danh sách) | Kèo đã có phần đội mở và còn nhận đội thứ hai, lọc theo ngày; kèo tiền sân (5-5, 6-4, 7-3, thua bao sân), phần trả trước của đội vào, hạn chót. Ở màn 2 và trang chủ, giờ đủ hai đội **không bị ẩn** khỏi kết quả tìm: hiện thành ô viền nét đứt có chữ "Ghép kèo" (thẻ sân: một hàng riêng "Ghép kèo · chốt khi đủ hai đội"; trang chủ: dòng có nhãn Ghép kèo), bấm vào dẫn tới trận đang chờ đội thứ hai (màn 21) hoặc màn mở trận (màn 20); cuối danh sách có lối "Nhờ sân báo giá". Ở màn 3, ô giờ của sân bật chế độ hiện nhãn "Đủ hai đội" (viền nét đứt) dẫn tới màn 20; ô đang có trận hiện liên kết vào trận. Mục "Ghép kèo" trên thanh điều hướng. |
| 20 | Mở trận | Sân, giờ, giá sân; chọn phần của đội mình (chip %), hiện hai phần cộng đúng giá sân; chọn hạn chót; nói rõ giữ slot 15 phút và quy tắc hoàn. |
| 22 | Nhờ sân báo giá | Quận, loại sân, ngày, khung giờ, ngân sách, hạn nhận báo giá, ghi chú; nhắc rõ báo giá không giữ sân và giới hạn tin nhờ báo giá đang mở. Điều kiện của trang tìm sân điền sẵn vào form. |
| 23 | Tôi đã nhờ báo giá | Danh sách tin nhờ báo giá đã đăng: trạng thái bằng chữ (Đang chờ sân báo giá / Có báo giá, chờ bạn chọn / Đã chốt thành lịch đặt / Hết hạn / Đã hủy), số báo giá, giá rẻ nhất, hạn. Mục "Khách nhờ báo giá" trên thanh điều hướng của khách. |
| 24 | Chi tiết tin nhờ báo giá | Tóm tắt tin nhờ báo giá + đồng hồ hạn; các báo giá xếp theo giá (sân, slot, giá chào cạnh giá niêm yết, nhãn Trong ngân sách / Vượt ngân sách, hiệu lực); nút chọn có bước xác nhận; báo giá mất slot hiện "Không chọn được" kèm lý do; hủy tin nhờ báo giá. |
| 21 | Chi tiết trận | Giá, hai phần, hạn chót; mỗi đội một dòng trạng thái phần tiền (chủ sân đã nhận / chưa); VietQR phần của đội đang xem; nút Vào trận; rút trận (đội mở, có cảnh báo hậu quả); khoản hoàn Chưa hoàn / Đã hoàn; 4 bước giải thích. |
| 18 | Chi tiết pass | Giá gốc/giá pass, hạn nhận, nút Nhận; sau khi nhận hiện VietQR + đồng hồ; 4 bước giải thích đổi chủ và hoàn tiền là hai việc riêng. |

### Chủ sân

| # | Màn | Nội dung chính |
|---|---|---|
| 10 | Hôm nay (màn đầu của chủ sân) | Một dòng tóm tắt (số việc cần làm, giờ đá hôm nay, số chưa nhận tiền). Khối "Việc cần làm ngay", mỗi đơn một lần: đơn chờ đồng ý (đếm ngược 15 phút, "Đồng ý" / "Từ chối"), pass sân chờ xác nhận tiền, ghép kèo chờ xác nhận tiền hoặc chờ chủ sân chốt kết quả, khoản chưa trả lại ("Đã chuyển lại"). Mỗi thẻ có nút bằng động từ; thẻ chỉ để xem (đang pass chưa ai nhận, đang tìm đội) không vào đây mà ở danh sách Lịch sân. Khối "Giờ đá hôm nay": mỗi dòng có tình trạng tiền và "Đã nhận tiền". Không có 4 ô số. Nút "+ Thêm lịch đặt" luôn nằm đầu trang, trong màn hình đầu trên 390 (mở form R16, ngày hôm nay, chưa chọn giờ). |
| 11 | Cài đặt sân | Các nhóm thu gọn, mỗi nhóm có nút Lưu riêng (chỉ lưu các ô của nhóm đó): Thông tin sân; Giờ mở cửa và giá cao điểm; Cách nhận đặt sân (đặt là chốt / chủ sân duyệt, giảm giờ chót); Nội quy và chính sách hủy; Tài khoản nhận tiền (chọn ngân hàng); Các sân và giá (tên, 5/7 người, giá thường, giá cao điểm, bật/tắt, "Chỉ nhận ghép kèo" cho từng sân con). |
| 12 | Lịch sân (lưới) | Một mục menu "Lịch sân" có hai cách xem: "Lưới theo giờ" (màn này) và "Danh sách" (màn 13). Lưới theo ngày, vạch giờ hiện tại. Trên 390 xem từng sân một bằng tab Sân 1 / Sân 2 / Sân 3, không cắt lưới; từ 700px trở lên các sân nằm cạnh nhau. Ô đọc được tên khách. Bấm ô trống hiện hộp chọn: "Khách đặt (điện thoại/Zalo)" (mặc định, mở form thêm lịch đặt R16; tắt khi giờ ở chế độ chỉ ghép kèo) hoặc "Chặn giờ (sửa sân, sự kiện)" (lý do). Bấm ô đã đặt để xem lịch đặt; lịch qua điện thoại có nhãn "Đặt qua điện thoại" và nút Sửa. Hiện số người đang chờ. |
| 13 | Lịch sân (danh sách) | Cùng mục menu "Lịch sân", đường dẫn `/owner-bookings.html` (giữ `?status=`, `?date=`, `?q=`, `?id=`). Bảng lọc theo trạng thái/ngày (có "Chờ đủ hai đội"). Bảng "Ghép kèo": xác nhận từng phần của hai đội, từ chối đội vào, hủy trận, ghi hoàn từng đội, và nút "Chốt kết quả" khi hai đội báo lệch hoặc quá hạn (hộp thoại hiện hai báo cáo, chọn đội mở thắng / đội vào thắng / hòa). Cài đặt sân (màn 11): công tắc "Chế độ đủ hai đội" + khung giờ cho từng sân con. Màn Khách nhờ báo giá của khách (mục "Khách nhờ báo giá" trên thanh điều hướng): tin nhờ báo giá phù hợp với sân của mình, độ tin cậy R10 của khách, bấm "Gửi báo giá" (chọn sân con + slot trống, giá, hiệu lực, lời nhắn), các báo giá đã gửi và nút rút; tin nhờ báo giá đã kết thúc ở mục riêng. Duyệt/từ chối (thấy độ tin cậy của khách), hủy, ghi nhận đã thu tiền, ghi nhận đã hoàn, đánh dấu đã đá/bùng. | Chữ tiền ở khu chủ sân thống nhất "Chưa nhận tiền" / "Đã nhận tiền"; màn của khách giữ "Chưa chuyển khoản" / "Đã chuyển khoản". Công cụ demo (đặt lại dữ liệu, tua đồng hồ, xem với vai trò) nằm ở mục "Demo" cuối menu chủ sân.
| 13b | Giải đấu (danh sách + tạo giải) | Tab thứ ba cạnh "Lưới theo giờ" và "Danh sách" trong mục menu "Lịch sân" (menu chủ sân vẫn 4 mục), `/owner-leagues.html`, theo sân đang chọn. Hộp "Tạo giải mới": tên, loại sân, số đội, link. | owner |
| 13c | Quản lý giải | `/owner-league.html?id=`: đội (thêm/sửa/xóa, tick lệ phí, cho rút), tạo trận, xếp tự động/chọn giờ từng trận, công bố, nhập/sửa tỉ số, hoãn trận, lịch sử, bảng xếp hạng, sửa điều lệ, xóa giải. | owner |
| 6b | Trang giải công khai | `/league.html?id=` (R18i). | công khai |

### Admin

| # | Màn | Nội dung chính |
|---|---|---|
| 14 | Tài khoản | Danh sách người dùng, tạo tài khoản chủ sân, khóa/mở. |
| 15 | Lịch đặt | Tra cứu mọi lịch đặt, hủy ngoại lệ, ghi nhận thanh toán/hoàn tiền, đánh dấu có mặt. |
| 16 | Nhật ký | Lịch sử thao tác trên lịch đặt. |

## 6. Luồng chính

1. **Đặt sân tự xác nhận:** Trang chủ → chọn 19:00 hôm nay → thẻ sân có giờ trống → bấm 19:00 → chi tiết sân (ô đã chọn sẵn) → Đặt → hộp xác nhận → lịch đặt `confirmed` → màn thanh toán QR → chủ sân ghi nhận `paid`.
2. **Đặt sân chờ duyệt:** như trên nhưng lịch đặt `pending` có đếm ngược 15 phút → chủ sân duyệt (thấy độ tin cậy) → khách nhận thông báo → QR hiện.
3. **Danh sách chờ:** slot đã có người giữ → "Báo tôi khi trống" → người kia hủy → khách nhận thông báo "slot đang giữ cho bạn đến 19:10" → vào đặt.
4. **Hủy và hoàn tiền:** khách hủy → web hiện % và số tiền hoàn theo R7 → chủ sân chuyển khoản lại và ghi nhận `done`.
5. **Bùng sân:** sau giờ đá chủ sân đánh dấu `no_show` → đủ 2 lần trong 60 ngày thì lần đặt sau của khách phải chờ duyệt.
6. **Pass sân:** khách A có lịch đặt đã trả tiền nhưng bận → "Pass lại" với giá ≤ giá gốc → người đang chờ slot được báo và ưu tiên → đội B nhận, thấy QR, chuyển khoản thẳng chủ sân → chủ sân xác nhận đã nhận tiền → lịch đặt sang B, A hiện *Chưa hoàn* → chủ sân chuyển lại tiền cho A và ghi nhận *Đã hoàn*.
7. **Ghép kèo:** sân con bật chế độ → đội A bấm ô "Đủ hai đội" → chọn kèo tiền sân (5-5, 6-4, 7-3, thua bao sân) và hạn chót → slot được giữ, A chuyển trước nửa tiền sân → chủ sân xác nhận phần A → trận hiện ở "Ghép kèo" → đội B vào, chuyển phần của B → chủ sân xác nhận phần B → lịch đặt chốt. Đến hạn thiếu một đội thì slot nhả và tiền đã nhận ghi vào hoàn tiền (chưa hoàn → đã hoàn do chủ sân ghi nhận). Đá xong (kèo thắng/thua): mỗi đội trưởng báo kết quả → khớp thì chốt, lệch hoặc quá hạn thì chủ sân chốt → đội thua thấy "trả thêm X" kèm mã QR tới đội thắng → đội thắng bấm "Đã nhận" (R15).
8. **Khách nhờ báo giá và báo giá:** khách không thấy giờ hợp ý → đăng tin nhờ báo giá → chủ sân có cụm sân phù hợp được báo, chọn slot trống và gửi báo giá (không giữ slot) → khách xem các báo giá, chọn một → hệ thống kiểm lại slot và giá, tạo lịch đặt qua luồng đặt thường (tự xác nhận hoặc chờ duyệt) → khách chuyển tiền thẳng cho chủ sân bằng VietQR. Nếu slot đã bị lấy trước đó, báo giá báo không dùng được và không có lịch đặt nào được tạo.

## 7. API contract

Prototype FE dùng dữ liệu giả **đúng theo contract này**; khi có BE chỉ cần đổi nguồn dữ liệu. Contract lấy từ bản nháp BE (branch `draft/backend-additions`).

**Quy ước:** JSON, khóa camelCase. Thời điểm dạng `"YYYY-MM-DD HH:mm:ss"` giờ Việt Nam; ngày `"YYYY-MM-DD"`; giờ `"HH:mm"`; tiền là số nguyên VND. Lỗi trả `{ "error": "<thông báo>" }` kèm mã HTTP 400/401/403/404/409. Thao tác ghi (POST/PUT/DELETE) gửi header `X-CSRF-Token`. Đăng nhập bằng session cookie.

### Công khai

| Method | Đường dẫn | Mô tả |
|---|---|---|
| GET | `/api/meta` | Cấu hình hiển thị: `bookingWindowDays`, `holdMinutes`, `waitlistOfferMinutes`, `lastMinuteHours`, `reliabilityWindowDays`, `reliabilityMaxViolations`, `transferCloseMinutes`, `matchCloseMinutes`, `matchMinOpenMinutes`, `requestCloseMinutes`, `requestMinOpenMinutes`, `requestMaxOpen`, `requestMaxOffers`, `offerMinMinutes`, `banks` (BIN + tên ngân hàng). |
| GET | `/api/venues/districts` | Danh sách quận có sân. |
| GET | `/api/venues?q=&district=&fieldType=&maxPrice=&date=&from=` | Danh sách sân → `{ date, venues: [Venue] }`. Có `date` thì mỗi sân kèm `availableSlots`; ô giờ đủ hai đội có `teamMode: true` (mở trận mới), ô đang có trận chờ đội thứ hai có `match: { id }`, ô thường có hai trường này falsy. |
| GET | `/api/venues/slots?date=&at=&district=&fieldType=&maxPrice=&lastMinute=1` | Tìm theo giờ → `{ date, at, slots: [SlotResult] }`; khớp slot bắt đầu trong [at−30 phút, at+60 phút], gần giờ chọn nhất lên trước. |
| GET | `/api/venues/:id` | Chi tiết sân → `VenueDetail`. |
| GET | `/api/venues/:id/schedule?date=` | Lịch một ngày → `Schedule`. Ô bị giải giữ: `status: blocked` kèm `league: { id, name }`. |
| GET | `/api/leagues/:id` | Giải đã công bố → `League` (không có liên hệ, lệ phí, lịch sử). 404 nếu chưa công bố. `VenueDetail.leagues` = giải chưa kết thúc của sân. |

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
| POST | `/api/matches` | `{ courtId, date, start, loserPercent (50|60|70|100), closesAt }` → `Match` (kèm `paymentQr` nửa tiền sân của đội mở). 409: giờ không bật chế độ, slot đã có người giữ/chặn; 400: hạn chót ngoài khoảng cho phép, `loserPercent` ngoài bốn giá trị, quá sát giờ đá. |
| GET | `/api/matches?venueId=&date=&district=` | `[Match]` đã có phần đội mở trận được xác nhận và còn nhận đội thứ hai (xem không cần đăng nhập). |
| GET | `/api/matches/mine` | `[Match]` các trận mình mở hoặc vào. |
| GET | `/api/matches/:id` | `Match`. `paymentQr` chỉ có cho đội đang cần trả phần của mình. |
| POST | `/api/matches/:id/join` | → `Match` (kèm `paymentQr`). 409: đã có đội khác vào, chủ sân chưa xác nhận phần đội mở, không còn mở, quá hạn; 400: đội mở tự vào. |
| POST | `/api/matches/:id/result` | `{ winner: "host" / "guest" / "draw", bank? { bin, account, accountName } }` → `Match`. Đội trưởng báo kết quả (R15c); `bank` tùy chọn để nhận phần chênh. 403: không phải đội trong kèo; 409: chưa đá xong, kèo 5-5, đã chốt hoặc đang chờ chủ sân; 400: `winner`/`bank` không hợp lệ. Hai báo cáo khớp thì chốt, lệch thì `needs_owner`. |
| PUT | `/api/matches/:id/bank` | `{ bin, account, accountName }` → `Match`. Lưu tài khoản nhận tiền của đội mình trong kèo. 403 nếu không phải đội trong kèo. |
| POST | `/api/matches/:id/topup-received` | → `Match`. Đội thắng ghi nhận đã nhận phần chênh (`topUp.status = received`). 403: không phải đội thắng; 409: không có phần chênh hoặc đã ghi nhận. |
| DELETE | `/api/matches/:id` | Đội mở trận rút (xem R13g). 409 nếu trận đã kết thúc. |
| POST | `/api/requests` | `{ district, date, from, to, fieldType, budget, closesAt, note }` → `Request`. 400: quận chưa có sân phù hợp, khung giờ/ngân sách/hạn không hợp lệ, còn quá ít thời gian; 409: đã đủ `requestMaxOpen` nhu cầu đang mở. |
| GET | `/api/requests/mine` | `[Request]` (kèm `offers`), mới nhất trước. |
| GET | `/api/requests/:id` | `Request` của chính mình (404 nếu không phải của mình). |
| DELETE | `/api/requests/:id` | Hủy nhu cầu đang mở; chào giá mở thành `void`. 409 nếu đã chốt hoặc đã kết thúc. |
| POST | `/api/requests/:id/accept` | `{ offerId }` → `Booking` (đúng luồng đặt thường, giá = giá chào). 409: nhu cầu đã kết thúc, chào giá không còn hiệu lực/hết hạn, hoặc không còn dùng được (slot bị lấy, bị chặn, giữ cho người chờ, chuyển sang chế độ đủ hai đội, giá niêm yết đã thấp hơn giá chào) — khi đó không tạo booking. |
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
| POST | `/bookings` | Thêm lịch đặt qua điện thoại (R16) `{ courtId, date, start, customerName, customerPhone?, price?, paid?, note? }` → `Booking` (`source: "phone"`). 400: tên trống/quá 80 ký tự, SĐT sai, giá sai, giờ đã qua; 403: sân không phải của mình; 409: sân tắt, giờ đã có lịch/đang giữ/bị chặn/giữ cho người chờ/chỉ ghép kèo. |
| PUT | `/bookings/:id` | Sửa lịch qua điện thoại còn `confirmed` `{ customerName?, customerPhone?, price?, note? }`. 409: không phải lịch qua điện thoại, đã hủy, hoặc đổi giá khi đã nhận tiền. Không đổi được sân/giờ. |
| POST / DELETE | `/blocks`, `/blocks/:id` | Chặn / bỏ chặn lịch `{ courtId, date, start, end, reason }`. |
| GET | `/bookings?status=&date=` | `[Booking]` |
| POST | `/bookings/:id/approve` · `/reject` · `/cancel` | Duyệt / từ chối / hủy (`{ reason }`). |
| POST | `/bookings/:id/paid` · `/refund` | Ghi nhận đã thu / đã hoàn (`{ note }`). |
| POST | `/bookings/:id/attendance` | `{ result: "completed" hoặc "no_show" }` |
| GET | `/matches` | `[Match]` của sân mình cần xử lý: `open`, `joined`, trận đã kết thúc còn khoản hoàn `pending`, và kèo đã đá xong đang chờ báo/chốt kết quả (`result.status` = `awaiting` hoặc `needs_owner`). |
| POST | `/matches/:id/confirm-part` | `{ part: "host" \| "guest", note }` → `Match`. Xác nhận đã nhận phần của một đội (host: còn trong hạn giữ chỗ của đội mở; guest: đã vào và còn hạn giữ chỗ). Đủ hai phần thì chốt. |
| POST | `/matches/:id/reject-guest` | `{ reason }` (bắt buộc) → `Match`. Đội vào rời trận, trận mở lại. |
| POST | `/matches/:id/result` | `{ winner: "host" / "guest" / "draw" }` → `Match`. Chủ sân chốt kết quả khi `result.status = needs_owner` (R15d). 403: kèo không thuộc sân của mình; 409: chưa đến bước chủ sân chốt, hoặc đã chốt. |
| POST | `/matches/:id/cancel` | `{ reason }` (bắt buộc) → `Match`. Hủy trận đang mở hoặc đang chờ; đội nào đã được xác nhận tiền thì có khoản hoàn `pending`. |
| POST | `/matches/:id/refund` | `{ part, note }` → `Match`. Ghi nhận đã hoàn cho đội `part`; bỏ `part` chỉ hợp lệ khi đúng một khoản đang chờ (400 nếu hai khoản). |
| GET | `/requests` | `[Request]` phù hợp với cụm sân của mình: đang mở, và đã kết thúc nhưng mình từng chào giá. Mỗi nhu cầu kèm `customerName`, `customerReliability`, `venues` (cụm sân của mình phù hợp), `options` (sân con + slot đang trống có thể chào), `openOfferCount`, `maxOffers` và chỉ các chào giá của mình. |
| POST | `/requests/:id/offers` | `{ courtId, start, price, validUntil, note }` → `Offer`. 403: nhu cầu không phù hợp sân này/không phải sân của mình; 400: slot ngoài khung giờ, giá lẻ hoặc vượt giá niêm yết, hiệu lực ngoài khoảng cho phép; 409: nhu cầu đã kết thúc, slot không còn trống, giờ đủ hai đội, cụm sân đã có chào giá mở, nhu cầu đã đủ chào giá. |
| DELETE | `/offers/:id` | Rút chào giá đang mở của mình → `Offer` (`withdrawn`). 409 nếu đã kết thúc. |
| GET | `/bank-events` | `[BankEvent]` các khoản ngân hàng báo về tài khoản sân của mình, mới nhất trước: `{ id, txId, content, amount, bookingId?, bookingCode?, expected?, status: matched / unmatched / resolved, reason?, reasonText?, receivedAt }`. `reason`: `no_code`, `unknown_order`, `wrong_account`, `no_account`, `not_approved`, `not_payable`, `short`, `over` (R17). |
| POST | `/bank-events/:id/resolve` | `{ note? }`. Chủ sân đánh dấu đã xử lý khoản `unmatched`. 404 nếu không phải của mình; 409 nếu không còn cần xử lý. |
| GET | `/transfers` | `[Transfer]` của sân mình cần xử lý: `claimed` (chờ xác nhận tiền), `open`, và `completed` còn chờ hoàn cho đội cũ. |
| POST | `/transfers/:id/confirm` | `{ note }` → `Transfer`. Chỉ khi `claimed` và còn hạn giữ chỗ. Đổi chủ trong một bước. 409 nếu không hợp lệ. |
| POST | `/transfers/:id/reject` | `{ reason }` (bắt buộc) → `Transfer`. Báo đội nhận; mở lại nếu còn hạn nhượng, ngược lại `expired`. |

Hoàn cho đội cũ dùng `POST /bookings/:bookingId/refund` có sẵn (booking `transferred`, `refundAmount` = giá nhượng). Với booking của trận đủ hai đội, `POST /bookings/:id/refund` (chủ sân và admin) nhận thêm `{ part }` như `/matches/:id/refund`; `refundAmount`/`refundStatus` của booking là tổng các khoản hoàn của trận, khoản từng đội nằm ở `Match.refunds` và `Match.yourPart.refund`.

#### Giải đấu của chủ sân (R18)

| Method | Đường dẫn | Mô tả |
|---|---|---|
| GET | `/leagues?venueId=` | Giải của mình: `{ id, venueId, name, fieldType, teamCount, teams, status, matches, done }`. |
| POST | `/leagues` | `{ venueId, name, fieldType: "5"/"7", teamCount: 4–8, rules?, link?, teams? }` → `League`. |
| GET / PUT / DELETE | `/leagues/:id` | Chi tiết (có liên hệ, lệ phí, lịch sử); sửa `{ name?, rules?, link? }`; xóa (trả mọi giờ). 403 nếu không phải giải của mình. |
| POST / PUT / DELETE | `/leagues/:id/teams`, `/teams/:tid` | Thêm `{ name, contactName, contactPhone? }`; sửa hoặc `{ feePaid }`; xóa. Thêm/xóa chỉ khi còn nháp và chưa tạo trận (409). |
| POST | `/leagues/:id/fixtures` | Tạo (lại) các trận vòng tròn; cần đủ đội. |
| PUT | `/leagues/:id/plan` | `{ slots: [{ matchId, courtId, date, start }] }` lưu giờ ở bước nháp (chưa giữ). |
| POST | `/leagues/:id/auto-plan` | `{ courtId, date, start, perDay }` xếp các trận chưa có giờ. |
| POST | `/leagues/:id/publish` | Kiểm cả loạt rồi giữ hết hoặc 409 (không giữ ô nào). |
| POST | `/leagues/:id/matches/:mid/reschedule` | `{ courtId, date, start, note? }`. |
| POST | `/leagues/:id/matches/:mid/score` | `{ home, away, note? }`; `note` bắt buộc khi sửa; 409 nếu chưa đến giờ đá. |
| POST | `/leagues/:id/teams/:tid/withdraw` | `{ note? }` (R18g). |

`DELETE /api/owner/blocks/:id` trả 409 với ô giải giữ.

### Admin (`/api/admin`)

`GET /users`, `POST /owners`, `POST /users/:id/active`, `GET /bookings`, `POST /bookings/:id/cancel | paid | refund | attendance`, `GET /logs`.

### Kiểu dữ liệu chính

`League` = `{ id, venueId, venueName, venueAddress, indexable, name, fieldType, teamCount, rules, link, status (draft/published/ongoing/finished), publishedAt, teams: [{ id, name, withdrawn, contactName?, contactPhone?, feePaid? }], matches: [{ id, round, homeId, awayId, homeName, awayName, status (unscheduled/planned/scheduled/played/forfeit), courtId, courtName, date, start, end, held, score: {home, away}|null, forfeitBy, rescheduled (true khi trận từng bị hoãn; chỉ để hiển thị nhãn “Đã hoãn”, công khai cũng thấy), started, history?: [{ kind: score/reschedule/forfeit, at, by, from, to, note }] }], standings: [{ rank, teamId, name, withdrawn, played, won, drawn, lost, gf, ga, gd, points }], counts }`. Bản lưu: `leagues`, `leagueTeams`, `leagueMatches`; giờ giữ là `blocks` có `leagueId`, `leagueMatchId`.

```text
Venue        { id, name, district, address, phone, imageUrl, amenities[], openTime, closeTime,
               slotMinutes, requiresApproval, lastMinutePercent, vietQr, fieldTypes[],
               minPrice, maxPrice, availableSlots? }
VenueDetail  Venue + { description, rules, peakStart, peakEnd, cancelPolicy, mapsUrl,
               courts: [{ id, name, fieldType, price, peakPrice, teamMode: { from, to }|null }] }
               (PUT /owner/courts/:id nhận teamMode: { from, to } hoặc null để tắt)
Schedule     { date, slotMinutes, courts: [{ id, name, fieldType, slots: [Slot] }] }
Slot         { start, end, teamMode? (giờ chỉ chốt khi đủ hai đội, ô còn trống), match? { id, status, joinable } (ô đang giữ cho trận), transfer? { id, askPrice, originalPrice } (ô đã đặt đang nhượng), basePrice, discountPercent, price, peak,
               status: "available"|"booked"|"held"|"blocked"|"past"|"offered",
               offeredToYou?, offerExpiresAt?, onWaitlist? }
SlotResult   { venueId, venueName, district, address, requiresApproval, courtId, courtName,
               fieldType, start, end, price, basePrice, discountPercent, peak, offeredToYou }
Booking      { id, code, venueId, venueName, courtId, courtName, fieldType, startAt, endAt,
               status, expiresAt, price, basePrice, discountPercent, paymentStatus, paidVia (bank / owner / null),
               refundStatus, refundPercent, refundAmount, cancelledBy, cancelReason, createdAt,
               acquiredByTransfer, transfer? { id, status, askPrice, closesAt, claimExpiresAt },
               match? { id, status, closesAt, refunds?[chỉ chủ sân/admin] }, fromOffer (đặt từ chào giá: price = giá chào, basePrice = niêm yết),
               source: "web"|"phone" (phone = chủ sân thêm, R16; khách không có tài khoản, chỉ chủ sân/admin thấy tên và SĐT trong customerName/customerPhone) }
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
Match        { id, status: "open"|"joined"|"confirmed"|"expired"|"cancelled", venueId, venueName,
               courtId, courtName, fieldType, startAt, endAt, price, loserPercent, loserAmount, winnerAmount, hostAmount, guestAmount,
               closesAt, createdAt, hostPaid, guestPaid, hasGuest, joinable, role: "host"|"guest"|"staff"|null,
               guestHoldUntil, hostPayBy, endReason,
               result: null | { status: "awaiting"|"needs_owner"|"settled", reportBy, yourReport, otherReported, winner, settledBy: "agree"|"owner", settledAt,
                                topUp: { from, to, amount, status: "unpaid"|"received", receivedAt, dueBy, overdue, fromName, toName }|null,
                                staff: hostReport, guestReport },
               host/guest: yourBank { bin, bankName, account, accountName }|null, topUpQr|null (chỉ đội thua, khi topUp unpaid),
               host/guest/staff: bookingId, bookingCode;
               host/guest: yourPart { part, amount, paid, refund { status, amount }|null }, paymentQr|null;
               staff: hostName, hostPhone, hostReliability, guestName, guestPhone, guestReliability,
                      hostContent, guestContent, refunds: [{ part, name, amount, status: "pending"|"done" }] }
Request      { id, status: "open"|"chosen"|"expired"|"cancelled", district, date, from, to, fieldType,
               budget, note, closesAt, createdAt, endReason, bookingId (khi chosen),
               offers: [Offer] (khách: mọi chào giá; chủ sân: chỉ của mình, xếp đang mở trước rồi theo giá);
               chủ sân thêm: customerName, customerReliability, venues: [{ id, name }], openOfferCount, maxOffers,
               options: [{ venueId, venueName, courtId, courtName, slots: [{ start, end, basePrice }] }] }
Offer        { id, requestId, status: "open"|"chosen"|"lost"|"withdrawn"|"expired"|"void", venueId, venueName,
               venueAddress, venueDistrict, requiresApproval, courtId, courtName, fieldType, startAt, endAt, price, listedPrice,
               overBudget, note, validUntil, createdAt, endReason, usable, unusableReason (khi open mà usable = false,
               tính tại lúc xem vì chào giá không giữ slot), bookingId (khi chosen) }
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
- **Giải đấu (R18):** BE làm trong một transaction khi công bố (kiểm cả loạt rồi chèn các chặn giờ; ràng buộc duy nhất sân con + ngày + giờ cho chặn giờ). Sitemap của BE nên liệt kê giải đã công bố của sân thật (prototype không có sitemap giải vì giải tạo lúc chạy).
- Header/menu do JS chung vẽ theo vai trò, không lặp HTML ở từng trang.
- **Ghi chú cho BE (đã biết, chưa làm):** (1) Nội dung chuyển khoản thật thường bị ngân hàng thêm chữ, ví dụ `MBVCB.123.SN01238 chuyen tien` hoặc `KEOSN01238`; hiện các trường hợp này rơi vào xử lý tay của chủ sân (an toàn). Khi làm BE, xem lại việc tìm mã trong chuỗi, kiểu SePay "tiền tố + mã" xuất hiện ở bất kỳ đâu trong nội dung. (2) Tiền về tài khoản không thuộc sân nào: hiện thẻ "cần xử lý" rơi về chủ của đơn; webhook thật luôn gắn với một tài khoản đã liên kết nên hầu như không xảy ra.
- **Webhook SePay (BE, R17):** `POST /api/webhooks/sepay`, không dùng phiên đăng nhập. (1) *Xác thực:* kiểm khóa API SePay trong header `Authorization: Apikey <khóa>` (so sánh hằng thời gian, khóa lưu ở biến môi trường, sai thì 401 và không ghi gì); chỉ nhận giao dịch tiền vào (`transferType = in`). (2) *Tìm sân theo tài khoản trước, rồi mới tìm đơn:* số tài khoản nhận (`accountNumber`) xác định sân/chủ sân nhận tiền. Chỉ tìm đơn trong các sân dùng đúng tài khoản đó. Mã đơn thuộc sân có tài khoản khác thì không tự nhận (`wrong_account`) và thẻ cần xử lý hiện cho chủ của tài khoản đã nhận tiền; thiếu số tài khoản thì không tự nhận (`no_account`). Không sân nào dùng tài khoản đó thì lưu `unmatched` không gắn chủ. (3) *Khớp:* tách mã đơn theo định dạng ở R17a từ `content`, tìm khoản đang chờ tiền trong sân đó; so `transferAmount` đúng bằng số cần chuyển. (4) *Idempotent:* khóa duy nhất theo `id` giao dịch của SePay (`bank_transactions.provider_tx_id UNIQUE`); chèn bản ghi giao dịch và đổi trạng thái đơn trong **một transaction CSDL**, khóa dòng đơn (`SELECT ... FOR UPDATE`) để hai webhook đồng thời không ghi hai lần; gọi lại cùng `id` trả 200 và không làm gì. (5) *Phản hồi:* 200 `{ "success": true }` khi đã lưu giao dịch (kể cả `unmatched`) để SePay không gửi lại vô hạn; lỗi hệ thống thì 5xx để SePay thử lại. (6) *Không tự ghi nhận* thiếu/thừa/sai mã/đơn chưa duyệt/đơn đã trả: lưu `status = unmatched` + `reason`, báo chủ sân, hiện ở "Việc cần làm ngay"; không bao giờ tự đổi đơn khi chưa chắc. Hoàn tiền không đi qua webhook. Prototype mô phỏng bằng `proto.bankReport` trong `api-mock.js`, cùng luật khớp.

## 10. Câu hỏi còn mở

1. Deadline của môn và ngày demo.
2. Phân công thành viên (FE/BE/tài liệu/test).
3. Có dùng Figma để vẽ wireframe trước không, hay vẽ thẳng bằng HTML.
4. Hình ảnh sân: dùng ảnh minh họa tự vẽ/không bản quyền hay ảnh thật nhóm chụp.
