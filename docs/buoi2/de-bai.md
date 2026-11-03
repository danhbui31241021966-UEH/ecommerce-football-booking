# Đề bài tập nhóm Buổi 2 — HTML & CSS (TS Nguyễn Mạnh Tuấn)

Trích từ BaiTap_Nhom_Buoi2.pdf (Drive). Giữ nguyên ý của đề; phần Prompt mẫu được lược bớt.

## Mục tiêu
1. Chuyển ý tưởng, yêu cầu, wireframe Buổi 1 thành website chạy trên trình duyệt.
2. Ít nhất 4 trang HTML, bố cục và phong cách nhất quán.
3. HTML5 + CSS3.
4. Flexbox hoặc CSS Grid.
5. Responsive cho máy tính, máy tính bảng, điện thoại.
6. Hover, focus, kiểm tra khả năng sử dụng.
7. Phối hợp, quản lý mã nguồn trên GitHub, phân công rõ ràng.
8. Dùng AI có kiểm soát; chứng minh từng thành viên hiểu phần mã mình làm.

Phạm vi: chỉ giao diện HTML5/CSS3. Chưa yêu cầu JavaScript, backend, CSDL, giỏ hàng, thanh toán.

## Các trang tối thiểu (cấu trúc tham khảo: index.html, products.html, product-detail.html, about.html, style.css, images/, docs/, README.md — đã có cấu trúc tương đương thì chỉ bổ sung phần thiếu)
- **Trang chủ:** logo, menu, banner, sản phẩm nổi bật; liên kết tới trang danh sách và trang giới thiệu.
- **Danh sách sản phẩm:** tiêu đề trang; tối thiểu 8 sản phẩm; ảnh, tên, giá; liên kết xem chi tiết. Dùng Grid hoặc Flexbox. Danh mục dạng giao diện tùy chọn, không bắt buộc lọc.
- **Chi tiết sản phẩm:** ảnh; tên, giá, mô tả; thuộc tính phù hợp; nút mua dạng giao diện; liên kết quay lại danh sách.
- **Giới thiệu cửa hàng:** kinh doanh gì; đối tượng khách hàng; điểm nổi bật/giá trị; ảnh minh họa; thông tin liên hệ.

Header: logo/tên, menu, liên kết trang chính, ô tìm kiếm giao diện nếu phù hợp. Banner: ảnh, tiêu đề, lời kêu gọi hành động. Liên kết phải trỏ tới trang thật.

## Responsive (Bước 7)
| Thiết bị | Độ rộng | Yêu cầu |
|---|---|---|
| Máy tính | 1366 px | Đủ menu, banner, nhiều sản phẩm mỗi hàng |
| Máy tính bảng | 768 px | Gọn, không tràn ngang |
| Điện thoại | 390 px | Dễ đọc, thao tác thuận tiện |

Kiểm: không tràn ngang; ảnh không méo; danh sách đổi số cột; menu không chồng lấn; banner không mất nội dung quan trọng; nút dễ bấm trên điện thoại.
**Sản phẩm nộp: ảnh chụp các trang ở ba kích thước, kèm danh sách lỗi và cách nhóm đã xử lý.**

## Hover/focus (Bước 8)
Cho: liên kết menu, nút xem chi tiết, nút mua, thẻ sản phẩm, thành phần thao tác bằng bàn phím. Transition hợp lý, tương phản phù hợp, không làm xê dịch bố cục.

## Bước 9 — Tích hợp, kiểm thử, AI, GitHub
- A: tích hợp 4 trang; kiểm liên kết, CSS chung, đường dẫn ảnh; không trang nào lỗi bố cục; kiểm lại 3 khổ.
- B (đánh giá bằng AI): chọn **ít nhất 2 vấn đề thực tế AI đề xuất**; với mỗi vấn đề: vị trí mã liên quan, kiểm trên trình duyệt, quyết định áp dụng hay không, ghi thay đổi và kết quả.
- C (GitHub): cập nhật mã 4 trang, ảnh, README.md; commit lên GitHub; ghi rõ nhiệm vụ từng thành viên; giảng viên mở được repo.
- README gồm: giới thiệu; cấu trúc thư mục; danh sách trang; công nghệ; cách mở/chạy; cách kiểm responsive; hạn chế hiện tại. Không tự thêm chức năng chưa làm; không khẳng định có backend/CSDL/thanh toán (theo phạm vi Buổi 2).
- **Sản phẩm nộp: repo có đủ mã nguồn, README, hình ảnh minh họa và minh chứng kiểm thử.**

## Bước 10 — Câu hỏi kiến thức bắt buộc (mỗi thành viên TỰ trả lời theo phần mình làm)
1. **Giải thích mã nguồn:** chọn một đoạn HTML và một đoạn CSS em làm; giải thích vai trò các thẻ, ý nghĩa ít nhất 3 thuộc tính CSS, ảnh hưởng tới giao diện.
2. **Dự đoán kết quả:** `.product-list { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }` — đổi `repeat(4, 1fr)` thành `repeat(2, 1fr)` thì giao diện đổi thế nào, vì sao?
3. **Phát hiện lỗi:** `.product-image { width: 100%; height: 250px; }` làm ảnh bị kéo giãn — đề xuất sửa thế nào, giải thích thuộc tính thêm vào.
4. **Quyết định kỹ thuật:** phần em phụ trách dùng Grid hay Flexbox, vì sao? Nêu một tình huống phương án kia phù hợp hơn.
5. **Kiểm tra responsive:** web tràn ngang ở 390 px thì kiểm thành phần nào trước, dùng công cụ gì?
6. **Đánh giá nội dung AI:** một đề xuất AI em đã dùng/điều chỉnh/loại bỏ — đề xuất là gì, kiểm bằng cách nào, kết quả thực tế, rút ra điều gì.

Giảng viên có thể gọi ngẫu nhiên từng thành viên giải thích mã, dự đoán khi đổi thuộc tính CSS, sửa lỗi nhỏ, giải thích quyết định kỹ thuật.

Ngoài ra mỗi bước 1–9 có "câu hỏi kiểm tra kiến thức" riêng (ví dụ: vì sao dùng một file CSS chung; `<header>`/`<nav>` có vai trò gì; Grid khác Flexbox; `@media` có vai trò gì; `:hover` khác `:focus`…). Đề không nói rõ các câu này có bắt buộc nộp không — mục 12 chỉ ghi "mỗi thành viên trả lời 6 câu".

## Mục 12 — Sản phẩm cuối cùng cần nộp
| STT | Sản phẩm | Yêu cầu |
|---|---|---|
| 1 | GitHub repository | Tiếp tục repository đã tạo ở Buổi 1 |
| 2 | Trang chủ | Có header, menu, banner và sản phẩm nổi bật |
| 3 | Trang danh sách sản phẩm | Có ít nhất 8 sản phẩm |
| 4 | Trang chi tiết sản phẩm | Có hình ảnh, tên, giá, mô tả và thuộc tính |
| 5 | Trang giới thiệu | Có nội dung và hình ảnh phù hợp |
| 6 | Responsive | Ảnh chụp ở 1366 px, 768 px và 390 px |
| 7 | Hiệu ứng giao diện | Có hover và focus phù hợp |
| 8 | Báo cáo kiểm thử | Danh sách lỗi, cách xử lý và kết quả |
| 9 | Báo cáo sử dụng AI | Ít nhất 2 ví dụ có phân tích và minh chứng |
| 10 | README | Hướng dẫn xem và chạy website |
| 11 | Bảng phân công | Nêu rõ nhiệm vụ từng thành viên |
| 12 | Câu hỏi kiến thức | Mỗi thành viên trả lời 6 câu hỏi |

Lưu ý của đề: không yêu cầu backend, CSDL, đăng nhập thật, giỏ hàng hay thanh toán ở Buổi 2. Đề không quy định định dạng file nộp (Docs/PDF).
