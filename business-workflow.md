6. NHIỆM VỤ 6 – QUY TRÌNH NGHIỆP VỤ CHÍNH
6.1. Quy trình đặt sân và khóa khung giờ
1. Khách truy cập website; có thể tìm và xem giá/lịch mà chưa cần đăng nhập.
2. Khách tìm sân theo tên/khu vực, chọn ngày và xem các slot còn khả dụng.
3. Khách mở trang chi tiết để xem ảnh, địa chỉ, tiện ích, giá, quy định, chính sách hủy và danh sách sân con.
4. Khách chọn 01 sân con và 01 slot cố định. Nếu chưa đăng nhập, hệ thống yêu cầu đăng nhập/đăng ký trước khi tiếp tục.
5. Hệ thống hiển thị tóm tắt booking. Khách xác nhận thông tin liên hệ và đồng ý điều kiện sử dụng/chính sách hủy.
6. Khi gửi booking, server kiểm tra lại slot, giá, trạng thái sân và quyền đặt. Nếu không hợp lệ, hệ thống trả lỗi và không tạo booking.
7. Nếu requiresApproval=OFF, booking chuyển thẳng sang Đã xác nhận và khóa slot. Nếu requiresApproval=ON, booking chuyển Chờ xác nhận và tạm giữ slot 05 phút.
8. Chủ sân có thể duyệt hoặc từ chối booking chờ. Duyệt → Đã xác nhận; từ chối → Bị từ chối và giải phóng slot; quá 05 phút → Hết hạn và giải phóng slot.
9. Khách xem mã booking, trạng thái, giá đã chốt và lịch sử tại “Đơn của tôi”. Chủ sân xem booking tại màn hình quản lý.
10. Sau khi nhận tiền bằng phương thức ngoài hệ thống, Chủ sân chuyển trạng thái thanh toán từ Chưa thanh toán sang Đã thanh toán.
11. Nếu phát sinh hủy, hệ thống áp dụng chính sách hủy/hoàn, cập nhật trạng thái, lưu lịch sử và giải phóng slot khi phù hợp.
LINK BPMN:
6.2. Luồng trạng thái booking
Từ trạng thái	Sự kiện	Sang trạng thái	Xử lý slot
Tạo mới	requiresApproval=OFF và hợp lệ	Đã xác nhận	Khóa slot.
Tạo mới	requiresApproval=ON và hợp lệ	Chờ xác nhận	Tạm giữ 05 phút.
Chờ xác nhận	Chủ sân duyệt	Đã xác nhận	Tiếp tục khóa slot.
Chờ xác nhận	Chủ sân từ chối	Bị từ chối	Giải phóng slot.
Chờ xác nhận	Quá 05 phút	Hết hạn	Giải phóng slot.
Đã xác nhận	Khách hủy	Đã hủy	Giải phóng slot và tính mức hoàn.
Đã xác nhận	Chủ sân hủy	Đã hủy	Giải phóng slot; hoàn 100% cho khách.

6.3. Quy tắc dữ liệu quan trọng
• Một sân con không được có hai booking Đã xác nhận trùng cùng một slot.
• Chọn/xem slot không tạo quyền giữ chỗ; chỉ booking Chờ xác nhận mới tạm giữ 05 phút.
• Giá và điều kiện sử dụng phải được lưu cùng booking tại thời điểm tạo.
• Chủ sân được chặn slot thủ công; slot bị chặn không xuất hiện là khả dụng.
• Tài khoản Chủ sân chỉ thao tác trên dữ liệu sân thuộc mình.
• Mọi thay đổi trạng thái quan trọng phải được lưu lịch sử để đối chiếu.
