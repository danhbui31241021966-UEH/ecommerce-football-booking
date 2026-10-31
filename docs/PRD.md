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
| R11 | Trạng thái booking: `pending` chờ duyệt · `confirmed` đã xác nhận · `rejected` bị từ chối · `cancelled` đã hủy · `expired` hết hạn · `completed` đã đá · `no_show` bùng sân · `transferred` đã nhượng cho đội khác (booking của đội cũ; đội nhận có booking `confirmed` + `paid` mới) · `matching` giữ chỗ chờ đủ hai đội (trận đủ hai đội, chưa chốt). Thanh toán: `unpaid`/`paid`. Hoàn tiền: `none`/`pending`/`done`. |
| R12 | **Nhượng booking** (thay cho hủy). Chỉ booking `confirmed` + `paid`. (a) *Đăng:* khách đặt đăng nhượng với giá nhượng là số nguyên, bội số 1.000đ, **không vượt giá đã trả** (không bán lời); chủ sân không phải duyệt việc đăng, chỉ được báo. (b) *Hạn:* đăng và nhận được đến `transferCloseMinutes` (60 phút) trước giờ đá. (c) *Người chờ slot* (R9) được báo ngay lúc đăng và có quyền nhận riêng `waitlistOfferMinutes` phút (không quá hạn nhượng); người khác bị chặn trong lúc đó. (d) *Nhận:* đội đầu tiên bấm nhận thắng, đội thứ hai nhận 409. Nhận xong giữ chỗ `holdMinutes` phút và thấy VietQR của chủ sân, số tiền = giá nhượng, nội dung `NH<mã booking>`; tiền đi thẳng chủ sân. Quá hạn mà chủ sân chưa xác nhận thì đăng nhượng mở lại cho đội khác. (e) *Đổi chủ:* chỉ khi chủ sân bấm xác nhận đã nhận tiền; một bước duy nhất: booking đội cũ → `transferred`, đội nhận có booking `confirmed` + `paid`. Slot không bao giờ trống trong quá trình nhượng. Chủ sân có thể từ chối đội nhận (kèm lý do; thấy độ tin cậy của đội đó). (f) *Hoàn cho đội cũ* là việc **riêng**: số tiền = giá nhượng, `refundStatus` `pending` → `done` do chủ sân ghi nhận như R7; giao diện không được nói "đã hoàn" khi chưa `done`. Đội cũ không bị tính hủy muộn/bùng sân (R10). (g) *Không ai nhận* đến hạn nhượng: đăng nhượng `expired`, booking vẫn của đội cũ, hủy sau đó theo R7 như bình thường. Đội cũ rút đăng nhượng hoặc hủy booking khi chưa có người nhận thì đăng nhượng tự đóng; đã có người nhận thì chưa hủy được cho đến khi chủ sân xác nhận hoặc từ chối. (h) *Độ tin cậy đội nhận:* không chặn đặt nhưng chủ sân thấy R10 của đội nhận khi xác nhận và có quyền từ chối; booking nhận được tính vào R10 như booking thường khi đá/bùng. |
| R13 | **Trận đủ hai đội.** Chủ sân bật chế độ cho một sân con, cả ngày hoặc trong khung `from`–`to` (lưu trên sân con: `teamMode { from, to }`; giờ ngoài khung và sân chưa bật đặt như bình thường). Giờ trong khung **không đặt một mình được** (409), chỉ chốt khi đủ hai đội. (a) *Mở trận:* đội A chọn giờ, tỉ lệ phần của mình (10–90%, bước 10%) và hạn chót. Giá sân là giá gốc (không giảm giờ chót). Phần A = giá × tỉ lệ làm tròn nghìn, phần B = phần còn lại, tổng hai phần luôn đúng giá sân. (b) *Hạn chót:* do đội A chọn, trong khoảng từ `matchMinOpenMinutes` (60 phút) sau bây giờ đến `matchCloseMinutes` (120 phút) trước giờ đá; còn quá ít thời gian thì không mở trận được. Hạn tối đa cách giờ đá 2 giờ để chủ sân còn kịp dùng lại sân. (c) *Giữ slot:* mở trận tạo ngay một booking `matching` giữ slot (R4: không ai đặt trùng; người khác vào danh sách chờ R9 như thường). Đội A có `holdMinutes` (15 phút, như R3) để chuyển phần của mình; chủ sân chưa xác nhận kịp thì trận tự hủy, slot nhả, không có khoản hoàn (chưa nhận tiền). Chủ sân xác nhận thì slot được giữ đến hạn chót và trận hiện cho đội khác. (d) *Vào trận:* chỉ khi phần của A đã được chủ sân xác nhận. Đội vào đầu tiên thắng, đội sau nhận 409; đội A không tự vào trận của mình (400). Đội B giữ chỗ `holdMinutes` phút để chuyển phần của mình và thấy VietQR của phần đó; quá hạn mà chủ sân chưa xác nhận thì B rời trận, trận mở lại cho đội khác. Chủ sân có thể từ chối B (kèm lý do). (e) *Tiền:* mỗi đội chuyển phần của mình thẳng cho chủ sân (VietQR, nội dung `TD<mã booking>A` hoặc `B`). Chủ sân xác nhận từng phần riêng; giao diện chỉ coi một phần là đã trả khi chủ sân đã xác nhận. Đủ hai phần: booking thành `confirmed` + `paid` (đứng tên A), trận `confirmed`. Trận đã chốt: khách không tự hủy được, chủ sân hủy thì hoàn 100% cho cả hai đội. (f) *Đến hạn thiếu một đội:* trận `expired`, booking `expired`, slot nhả (R9 chạy tiếp). Phần nào chủ sân đã xác nhận nhận tiền được ghi vào hoàn tiền của đội đó (100%, `pending` → `done` do chủ sân ghi nhận, theo dõi riêng từng đội trên trận); giao diện không được nói "đã hoàn" khi chưa `done`. (g) *Đội A rút trận:* khi chưa có B: miễn phí, hoàn đủ phần A đã được xác nhận, không tính hủy muộn. Khi đã có B: tính như hủy, phần A đã trả hoàn theo R7 trên phần của A, hủy dưới 12 giờ trước giờ đá là hủy muộn (R10); B chưa được ghi nhận tiền nên không có khoản hoàn. (h) *Độ tin cậy:* không chặn đội nào vào trận; chủ sân thấy R10 của cả hai đội khi xác nhận và có quyền từ chối B. Bùng sân/đã đá của booking đã chốt ghi cho đội đứng tên booking (A). Booking của trận không nhượng được (R12). |
| R14 | **Nhu cầu và chào giá.** (a) *Đăng nhu cầu:* khách đăng quận, ngày (trong cửa sổ R1), khung giờ `from`–`to` (dài ≥ 60 phút), loại sân 5/7, ngân sách cho một slot (số nguyên, bội số 1.000đ), hạn nhận chào giá và ghi chú tùy chọn. Hạn nhận chào giá từ `requestMinOpenMinutes` (30 phút) sau bây giờ đến `requestCloseMinutes` (60 phút) trước giờ bắt đầu khung giờ; còn quá ít thời gian thì không đăng được. Không đăng được nếu quận đó chưa có sân nào phù hợp. Mỗi khách có tối đa `requestMaxOpen` (3) nhu cầu đang mở; độ tin cậy R10 **không** chặn việc đăng. (b) *Sân "phù hợp"* là điều kiện dữ liệu, không đọc nghĩa chữ: cụm sân đang mở, cùng quận, có sân con đang mở đúng loại và có ít nhất một slot nằm trọn trong khung giờ. Chỉ chủ sân có cụm sân phù hợp thấy nhu cầu và được báo; ngân sách **không** lọc, chỉ để hiển thị. Khách chỉ thấy nhu cầu của chính mình. (c) *Chào giá:* chủ sân chọn sân con và một slot trọn trong khung giờ, còn trống, **không** thuộc chế độ đủ hai đội (R13; không chào giá riêng được, 409). Giá chào là số nguyên, bội số 1.000đ, không vượt giá niêm yết của slot (chào giá là ưu đãi, không phải tăng giá); có thể cao hơn ngân sách, khi đó khách thấy nhãn "Vượt ngân sách" và tự quyết. Hiệu lực từ `offerMinMinutes` (15 phút) sau bây giờ đến hết hạn nhận chào giá của nhu cầu. Mỗi cụm sân chỉ có một chào giá đang mở cho một nhu cầu (muốn đổi thì rút rồi chào lại) và mỗi nhu cầu có tối đa `requestMaxOffers` (5) chào giá đang mở. (d) *Chào giá KHÔNG giữ slot* (khác R13): người khác vẫn đặt, xếp hàng chờ, chặn lịch bình thường. Chào giá hiện đúng trạng thái slot lúc xem: slot đã bị lấy thì hiện "Không dùng được" kèm lý do và không có nút chọn. (e) *Chọn chào giá:* khách chọn một chào giá đang mở; hệ thống kiểm lại ngay lúc đó (còn hiệu lực, slot còn trống và không bị chặn/giữ cho người chờ/chuyển sang chế độ đủ hai đội, giá niêm yết hiện tại vẫn ≥ giá chào) rồi tạo booking **qua đúng luồng đặt thường**: tự xác nhận hay chờ duyệt theo chế độ nhận booking của sân (R3), R2/R4 (không trùng slot), R10 (khách bị hạn chế vẫn chờ duyệt), VietQR như thường, tiền chuyển thẳng cho chủ sân. Không còn dùng được thì 409 "Chào giá này không còn dùng được: …", chào giá chuyển `void`, **không** tạo booking. Bấm lặp cùng một chào giá trả lại đúng booking cũ. (f) *Giá lưu:* booking lưu `price` = giá chào (R6: giá chốt tại lúc đặt), `basePrice` = giá niêm yết, `discountPercent` = 0 (không phải giảm giờ chót) và `offerId` (API trả `fromOffer`); lịch sử ghi `offer_accept` kèm giá chào và giá niêm yết. Chính sách hủy R7 tính trên `price`. (g) *Sau khi chọn:* nhu cầu `chosen`; các chào giá đang mở của nhu cầu thành `lost` và chủ sân của chúng được báo; chủ sân thắng được báo kèm mã booking. (h) *Hủy / rút / hết hạn:* khách hủy nhu cầu đang mở (chưa có booking nên không có tiền hoàn): chào giá mở thành `void`, chủ sân được báo. Nhu cầu đã chốt thì hủy ở booking như thường. Chủ sân rút chào giá của mình: `withdrawn`, khách được báo. Hết hạn nhận chào giá mà chưa chọn: nhu cầu `expired`, chào giá mở thành `expired`, khách được báo; chào giá quá hiệu lực riêng của nó thì `expired` trước. (i) Chào giá không phải booking: không đếm vào R10, không có tiền đi qua hệ thống. |

## 5. Danh sách màn hình (24)

**Tên hiển thị (đã đổi cho dễ hiểu).** Chỉ đổi chữ trên giao diện; tên endpoint, trường dữ liệu, giá trị `status` và khóa localStorage giữ nguyên (mục 7 vẫn dùng tên cũ).

| Tên cũ | Tên mới | Ghi chú |
|---|---|---|
| Nhượng sân / đăng nhượng / giá nhượng | Pass sân / đăng pass / giá pass | |
| Ghép trận, trận đủ hai đội, đội mở / đội vào | Ghép kèo, kèo, đội mở kèo / đội vào kèo | hạn chót → "hạn tìm đủ đội" |
| Chế độ đủ hai đội (chủ sân) | Chỉ nhận ghép kèo | |
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
| 19 | Ghép kèo (danh sách) | Trận đã có phần đội mở trận và còn nhận đội thứ hai, lọc theo ngày; phần của đội vào, hạn chót. Ở màn 2 và trang chủ, giờ đủ hai đội **không bị ẩn** khỏi kết quả tìm: hiện thành ô viền nét đứt có chữ "Ghép kèo" (thẻ sân: một hàng riêng "Ghép kèo · chốt khi đủ hai đội"; trang chủ: dòng có nhãn Ghép kèo), bấm vào dẫn tới trận đang chờ đội thứ hai (màn 21) hoặc màn mở trận (màn 20); cuối danh sách có lối "Nhờ sân báo giá". Ở màn 3, ô giờ của sân bật chế độ hiện nhãn "Đủ hai đội" (viền nét đứt) dẫn tới màn 20; ô đang có trận hiện liên kết vào trận. Mục "Ghép kèo" trên thanh điều hướng. |
| 20 | Mở trận | Sân, giờ, giá sân; chọn phần của đội mình (chip %), hiện hai phần cộng đúng giá sân; chọn hạn chót; nói rõ giữ slot 15 phút và quy tắc hoàn. |
| 22 | Nhờ sân báo giá | Quận, loại sân, ngày, khung giờ, ngân sách, hạn nhận báo giá, ghi chú; nhắc rõ báo giá không giữ sân và giới hạn tin nhờ báo giá đang mở. Điều kiện của trang tìm sân điền sẵn vào form. |
| 23 | Tôi đã nhờ báo giá | Danh sách tin nhờ báo giá đã đăng: trạng thái bằng chữ (Đang chờ sân báo giá / Có báo giá, chờ bạn chọn / Đã chốt thành lịch đặt / Hết hạn / Đã hủy), số báo giá, giá rẻ nhất, hạn. Mục "Khách nhờ báo giá" trên thanh điều hướng của khách. |
| 24 | Chi tiết tin nhờ báo giá | Tóm tắt tin nhờ báo giá + đồng hồ hạn; các báo giá xếp theo giá (sân, slot, giá chào cạnh giá niêm yết, nhãn Trong ngân sách / Vượt ngân sách, hiệu lực); nút chọn có bước xác nhận; báo giá mất slot hiện "Không chọn được" kèm lý do; hủy tin nhờ báo giá. |
| 21 | Chi tiết trận | Giá, hai phần, hạn chót; mỗi đội một dòng trạng thái phần tiền (chủ sân đã nhận / chưa); VietQR phần của đội đang xem; nút Vào trận; rút trận (đội mở, có cảnh báo hậu quả); khoản hoàn Chưa hoàn / Đã hoàn; 4 bước giải thích. |
| 18 | Chi tiết pass | Giá gốc/giá pass, hạn nhận, nút Nhận; sau khi nhận hiện VietQR + đồng hồ; 4 bước giải thích đổi chủ và hoàn tiền là hai việc riêng. |

### Chủ sân

| # | Màn | Nội dung chính |
|---|---|---|
| 10 | Tổng quan | Lịch đặt chờ duyệt (đếm ngược 15 phút), lịch hôm nay, số chưa thanh toán. |
| 11 | Cài đặt sân | Thông tin sân, giờ mở/đóng, độ dài slot, khung cao điểm, tự xác nhận/chờ duyệt, nội quy, tài khoản ngân hàng (chọn ngân hàng), % giảm giờ chót. Sân con: tên, 5/7, giá thường, giá cao điểm, bật/tắt. |
| 12 | Lịch & chặn lịch | Lịch theo ngày, mỗi cột một sân con, vạch giờ hiện tại. Bấm ô trống để chặn (lý do), bấm ô đã đặt để xem lịch đặt. Hiện số người đang chờ. |
| 13 | Quản lý lịch đặt | Bảng lọc theo trạng thái/ngày (có "Chờ đủ hai đội"). Bảng "Ghép kèo": xác nhận từng phần của hai đội, từ chối đội vào, hủy trận, ghi hoàn từng đội. Cài đặt sân (màn 11): công tắc "Chế độ đủ hai đội" + khung giờ cho từng sân con. Màn Khách nhờ báo giá của khách (mục "Khách nhờ báo giá" trên thanh điều hướng): tin nhờ báo giá phù hợp với cụm sân của mình, độ tin cậy R10 của khách, bấm "Gửi báo giá" (chọn sân con + slot trống, giá, hiệu lực, lời nhắn), các báo giá đã gửi và nút rút; tin nhờ báo giá đã kết thúc ở mục riêng. Duyệt/từ chối (thấy độ tin cậy của khách), hủy, ghi nhận đã thu tiền, ghi nhận đã hoàn, đánh dấu đã đá/bùng. |

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
7. **Ghép kèo:** sân con bật chế độ → đội A bấm ô "Đủ hai đội" → chọn phần của mình và hạn chót → slot được giữ, A chuyển phần của mình → chủ sân xác nhận phần A → trận hiện ở "Ghép kèo" → đội B vào, chuyển phần của B → chủ sân xác nhận phần B → lịch đặt chốt. Đến hạn thiếu một đội thì slot nhả và tiền đã nhận ghi vào hoàn tiền (chưa hoàn → đã hoàn do chủ sân ghi nhận).
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
| POST | `/api/matches` | `{ courtId, date, start, hostPercent, closesAt }` → `Match` (kèm `paymentQr` phần của đội mở). 409: giờ không bật chế độ, slot đã có người giữ/chặn; 400: hạn chót ngoài khoảng cho phép, tỉ lệ không hợp lệ, quá sát giờ đá. |
| GET | `/api/matches?venueId=&date=&district=` | `[Match]` đã có phần đội mở trận được xác nhận và còn nhận đội thứ hai (xem không cần đăng nhập). |
| GET | `/api/matches/mine` | `[Match]` các trận mình mở hoặc vào. |
| GET | `/api/matches/:id` | `Match`. `paymentQr` chỉ có cho đội đang cần trả phần của mình. |
| POST | `/api/matches/:id/join` | → `Match` (kèm `paymentQr`). 409: đã có đội khác vào, chủ sân chưa xác nhận phần đội mở, không còn mở, quá hạn; 400: đội mở tự vào. |
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
| POST / DELETE | `/blocks`, `/blocks/:id` | Chặn / bỏ chặn lịch `{ courtId, date, start, end, reason }`. |
| GET | `/bookings?status=&date=` | `[Booking]` |
| POST | `/bookings/:id/approve` · `/reject` · `/cancel` | Duyệt / từ chối / hủy (`{ reason }`). |
| POST | `/bookings/:id/paid` · `/refund` | Ghi nhận đã thu / đã hoàn (`{ note }`). |
| POST | `/bookings/:id/attendance` | `{ result: "completed" hoặc "no_show" }` |
| GET | `/matches` | `[Match]` của sân mình cần xử lý: `open`, `joined`, và trận đã kết thúc còn khoản hoàn `pending`. |
| POST | `/matches/:id/confirm-part` | `{ part: "host" \| "guest", note }` → `Match`. Xác nhận đã nhận phần của một đội (host: còn trong hạn giữ chỗ của đội mở; guest: đã vào và còn hạn giữ chỗ). Đủ hai phần thì chốt. |
| POST | `/matches/:id/reject-guest` | `{ reason }` (bắt buộc) → `Match`. Đội vào rời trận, trận mở lại. |
| POST | `/matches/:id/cancel` | `{ reason }` (bắt buộc) → `Match`. Hủy trận đang mở hoặc đang chờ; đội nào đã được xác nhận tiền thì có khoản hoàn `pending`. |
| POST | `/matches/:id/refund` | `{ part, note }` → `Match`. Ghi nhận đã hoàn cho đội `part`; bỏ `part` chỉ hợp lệ khi đúng một khoản đang chờ (400 nếu hai khoản). |
| GET | `/requests` | `[Request]` phù hợp với cụm sân của mình: đang mở, và đã kết thúc nhưng mình từng chào giá. Mỗi nhu cầu kèm `customerName`, `customerReliability`, `venues` (cụm sân của mình phù hợp), `options` (sân con + slot đang trống có thể chào), `openOfferCount`, `maxOffers` và chỉ các chào giá của mình. |
| POST | `/requests/:id/offers` | `{ courtId, start, price, validUntil, note }` → `Offer`. 403: nhu cầu không phù hợp sân này/không phải sân của mình; 400: slot ngoài khung giờ, giá lẻ hoặc vượt giá niêm yết, hiệu lực ngoài khoảng cho phép; 409: nhu cầu đã kết thúc, slot không còn trống, giờ đủ hai đội, cụm sân đã có chào giá mở, nhu cầu đã đủ chào giá. |
| DELETE | `/offers/:id` | Rút chào giá đang mở của mình → `Offer` (`withdrawn`). 409 nếu đã kết thúc. |
| GET | `/transfers` | `[Transfer]` của sân mình cần xử lý: `claimed` (chờ xác nhận tiền), `open`, và `completed` còn chờ hoàn cho đội cũ. |
| POST | `/transfers/:id/confirm` | `{ note }` → `Transfer`. Chỉ khi `claimed` và còn hạn giữ chỗ. Đổi chủ trong một bước. 409 nếu không hợp lệ. |
| POST | `/transfers/:id/reject` | `{ reason }` (bắt buộc) → `Transfer`. Báo đội nhận; mở lại nếu còn hạn nhượng, ngược lại `expired`. |

Hoàn cho đội cũ dùng `POST /bookings/:bookingId/refund` có sẵn (booking `transferred`, `refundAmount` = giá nhượng). Với booking của trận đủ hai đội, `POST /bookings/:id/refund` (chủ sân và admin) nhận thêm `{ part }` như `/matches/:id/refund`; `refundAmount`/`refundStatus` của booking là tổng các khoản hoàn của trận, khoản từng đội nằm ở `Match.refunds` và `Match.yourPart.refund`.

### Admin (`/api/admin`)

`GET /users`, `POST /owners`, `POST /users/:id/active`, `GET /bookings`, `POST /bookings/:id/cancel | paid | refund | attendance`, `GET /logs`.

### Kiểu dữ liệu chính

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
               status, expiresAt, price, basePrice, discountPercent, paymentStatus,
               refundStatus, refundPercent, refundAmount, cancelledBy, cancelReason, createdAt,
               acquiredByTransfer, transfer? { id, status, askPrice, closesAt, claimExpiresAt },
               match? { id, status, closesAt, refunds?[chỉ chủ sân/admin] }, fromOffer (đặt từ chào giá: price = giá chào, basePrice = niêm yết) }
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
               courtId, courtName, fieldType, startAt, endAt, price, hostPercent, hostAmount, guestAmount,
               closesAt, createdAt, hostPaid, guestPaid, hasGuest, joinable, role: "host"|"guest"|"staff"|null,
               guestHoldUntil, hostPayBy, endReason,
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
- Header/menu do JS chung vẽ theo vai trò, không lặp HTML ở từng trang.

## 10. Câu hỏi còn mở

1. Deadline của môn và ngày demo.
2. Phân công thành viên (FE/BE/tài liệu/test).
3. Có dùng Figma để vẽ wireframe trước không, hay vẽ thẳng bằng HTML.
4. Hình ảnh sân: dùng ảnh minh họa tự vẽ/không bản quyền hay ảnh thật nhóm chụp.
