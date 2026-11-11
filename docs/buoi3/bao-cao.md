# Báo cáo Buổi 3 – Tích hợp JavaScript cho GGO

**Nhóm 8 · Môn Phát triển ứng dụng Thương mại điện tử**

## Mục lục

1. Bước 1 – Chuẩn bị và thống nhất phạm vi
2. Bước 2 – Dữ liệu và danh sách sân
3. Bước 3 – Tìm kiếm, lọc và sắp xếp
4. Bước 4 – Trang chi tiết sân
5. Bước 5 – Giỏ sân
6. Bước 6 – Lưu và khôi phục dữ liệu
7. Bước 7 – Tích hợp, kiểm thử và giao diện
8. Bước 8 – Hoàn thiện, GitHub và sử dụng AI
9. Câu hỏi kiểm tra kiến thức

## Bước 1. Chuẩn bị và thống nhất phạm vi

Nhóm tiếp tục phát triển website GGO đã thực hiện ở các buổi trước, kế thừa giao diện và luồng đặt sân. Với đặc thù dịch vụ, nhóm xem sân và khung giờ là đối tượng cần tìm, còn quận và loại sân 5/7 người là nhóm phân loại. Nhóm thống nhất tìm theo tên sân và sắp xếp theo giá tăng hoặc giảm.

Giỏ sân là danh sách những khung giờ khách muốn xem lại hoặc đặt riêng. Mỗi dòng biểu thị một sân con, ngày và giờ cụ thể; cùng một lựa chọn không tạo thêm dòng trùng. Giỏ sân không giữ chỗ và không xác nhận đặt sân. Khi khách tiếp tục đặt, tình trạng và giá được kiểm tra lại theo luồng đặt sân của website.


## Bước 2. Dữ liệu và trang danh sách sân

Danh sách sân được hiển thị từ nguồn dữ liệu thống nhất của website, gồm thông tin tên, khu vực, mức giá, loại sân và giờ còn có thể đặt. Thiết kế kế thừa bố cục trang danh sách hiện tại, giúp người dùng nhận biết các sân và những thông tin cần thiết trước khi xem chi tiết. Dữ liệu trình bày trong môi trường minh họa không được xem là xác nhận về tình trạng sân ngoài thực tế.

## Bước 3. Tìm kiếm, lọc và sắp xếp

Người dùng có thể nhập tên sân và chọn thứ tự giá mà không cần mở phần bộ lọc. Các tiêu chí về quận, loại sân, mức giá và thời điểm được kết hợp để thu hẹp kết quả. Khi không có sân phù hợp, trang thông báo rõ trạng thái rỗng; lựa chọn tìm kiếm và bộ lọc được giữ lại khi tải lại trang.

![Hình 1. Kết hợp tìm kiếm, quận và thứ tự giá trên màn hình máy tính](screens/search-sort-1366.png)

![Hình 2. Tìm kiếm và sắp xếp trên màn hình điện thoại](screens/search-sort-390.png)

## Bước 4. Trang chi tiết sân

Trang chi tiết trình bày địa điểm, mức giá và lịch chọn giờ. Khách chọn ngày, sân con và giờ phù hợp rồi mới tiếp tục đặt. Nếu sân không tồn tại hoặc giờ đã được người khác đặt, giao diện cho biết tình trạng và cho phép khách quay lại tìm lựa chọn khác. Nút thêm giờ vào giỏ sân được tách biệt với thao tác đặt sân để tránh nhầm lẫn giữa lưu lựa chọn và xác nhận đặt.

![Hình 3. Chọn giờ và thêm vào giỏ sân trên điện thoại](screens/cart-detail-390.png)

![Hình 4. Chi tiết sân và thao tác thêm vào giỏ sân trên máy tính](screens/cart-detail-1366.png)

## Bước 5. Giỏ sân

Giỏ sân hiển thị từng lựa chọn theo sân, ngày, giờ bắt đầu và sân con. Khách có thể bỏ lựa chọn hoặc quay lại đúng khung giờ để tiếp tục đặt. Trang làm rõ rằng một dòng tương ứng một giờ, không có cơ chế tăng số lượng cho cùng một chỗ và việc lưu lựa chọn không bảo đảm giờ vẫn còn trống.

Khi mở giỏ sân, website đối chiếu lại lịch và giá hiện tại. Giờ đã bị đặt, đang giữ hoặc không còn khả dụng được cảnh báo và không cộng vào tổng tạm tính. Tổng tiền chỉ có ý nghĩa tham khảo cho các giờ còn trống; bước đặt sân vẫn phải xác nhận lại.

![Hình 5. Giỏ sân trên điện thoại với giờ còn trống và giờ đã có người đặt](screens/cart-390.png)

![Hình 6. Giỏ sân trên máy tính và thông tin tổng tạm tính](screens/cart-1366.png)

![Hình 7. Trạng thái giỏ sân trống trên điện thoại](screens/cart-empty-390.png)

![Hình 8. Trạng thái giỏ sân trống trên máy tính](screens/cart-empty-1366.png)

## Bước 6. Lưu và khôi phục dữ liệu

Danh sách trong giỏ sân được lưu bằng `localStorage` trên trình duyệt đang sử dụng, để vẫn còn sau khi chuyển trang hoặc tải lại. Website chỉ lưu thông tin nhận diện sân, sân con, ngày và giờ; khi hiển thị lại, lịch và giá được tải mới thay vì tin vào thông tin cũ. `saveCart` và `loadCart` đảm nhiệm việc lưu, đọc và kiểm tra dữ liệu; dữ liệu sai định dạng được loại bỏ an toàn.

Khi khách thay đổi giỏ sân ở một thẻ trình duyệt khác, số lượng trên menu được cập nhật để phản ánh trạng thái mới. Việc lưu trên một trình duyệt không tạo giữ chỗ và không đồng bộ thành đơn đặt sân.

## Bước 7. Tích hợp, kiểm thử và giao diện

Các luồng tìm kiếm, lọc, sắp xếp, xem chi tiết, thêm/bỏ lựa chọn, tải lại dữ liệu và trạng thái trống được kiểm tra trên màn hình điện thoại và máy tính. Kết quả được đối chiếu với hành vi mong đợi; các trường hợp lưu lặp, giờ đã có người đặt và cập nhật giữa các thẻ đều được kiểm tra. Bộ kiểm thử tích hợp của dự án và kiểm thử riêng cho giỏ sân đều đạt. Trong các luồng trình duyệt đã kiểm tra, không ghi nhận lỗi JavaScript hoặc lỗi trang.

**Bảng 7.1. Tổng hợp kiểm thử chức năng**

| Mã TC | Trường hợp kiểm thử | Kết quả |
|---|---|---|
| TC01 | Mở danh sách sân | Tìm kiếm và sắp xếp dùng được ngay; đạt trên điện thoại và máy tính. |
| TC02 | Tải danh sách | Có sân để thao tác; đạt. |
| TC03 | Tìm tên sân phù hợp | Chỉ hiện các sân khớp; đạt. |
| TC04 | Tìm từ khóa không tồn tại | Báo không có kết quả; đạt. |
| TC05 | Xem trạng thái không có kết quả | Giữ lại từ khóa tìm; đạt. |
| TC06 | Chọn quận và giá tăng | Giá theo thứ tự tăng; đạt. |
| TC07 | Chọn giá giảm | Giá theo thứ tự giảm; đạt. |
| TC08 | Kết hợp quận, tên và thứ tự giá | Tiêu chí được giữ trong đường dẫn; đạt. |
| TC09 | Tải lại trang đã lọc | Khôi phục lựa chọn; đạt. |
| TC10 | Thêm một giờ còn trống | Có một dòng trong giỏ sân; đạt. |
| TC11 | Thêm lại cùng giờ | Không tạo dòng trùng; đạt. |
| TC12 | Thay đổi giỏ ở thẻ khác | Số hiển thị được cập nhật; đạt. |
| TC13 | Mở giỏ sân | Tải lại lịch và giá hiện tại; đạt. |
| TC14 | Giờ đã bị chiếm | Cảnh báo và không tính vào tổng; đạt. |
| TC15 | Tiếp tục đặt một giờ | Trở lại đúng sân, ngày, giờ và sân con; đạt. |
| TC16 | Bỏ hết lựa chọn | Hiện trạng thái trống và số lượng bằng không; đạt. |
| TC17 | Thêm lặp cùng một giờ | Chỉ giữ một lựa chọn; đạt. |
| TC18 | Bỏ một lựa chọn và tính tổng | Tổng phản ánh các giờ còn trống; đạt. |
| TC19 | Dữ liệu lưu lỗi hoặc không hợp lệ | Khôi phục an toàn, không hiển thị dòng sai; đạt. |
| TC20 | Theo dõi lỗi trong luồng giỏ sân | Không phát sinh lỗi trang; đạt. |

**Bảng 7.2. Nhật ký lỗi đã khắc phục**

| Triệu chứng | Nguyên nhân | Cách khắc phục |
|---|---|---|
| Không thấy ô tìm và lựa chọn thứ tự giá | Các điều khiển bị đặt trong vùng lọc thu gọn | Đưa chúng ra khu vực luôn hiển thị trên danh sách sân. |
| Điều khiển bị chật trên điện thoại | Các thành phần vẫn xếp ngang ở màn hình hẹp | Chuyển sang bố cục dọc và dùng đủ chiều rộng. |
| Sân hết giờ chen vào thứ tự sân còn giờ | Hai nhóm trạng thái được sắp xếp chung | Sắp xếp riêng nhóm còn giờ và nhóm hết giờ. |
| Bộ lọc quận không được khôi phục đúng trong kiểm thử | Lựa chọn quận không có giá trị thuộc tính riêng | Chọn theo nhãn quận và xác nhận lại trạng thái sau tải lại. |
| Nội dung giỏ dễ bị hiểu như xác nhận đặt sân | Cách gọi trước đây gần với giỏ hàng mua sản phẩm | Dùng tên “Giỏ sân” và nêu rõ lựa chọn chưa giữ chỗ. |
| Giá hoặc tình trạng giờ trong giỏ sân bị cũ | Lịch có thể thay đổi sau khi khách rời trang | Tải lại lịch và giá; cảnh báo giờ không còn khả dụng. |
| Số hiển thị trên menu bị cũ ở thẻ khác | Mỗi thẻ trình duyệt có giao diện riêng | Đồng bộ thay đổi giữa các thẻ đang mở. |

### Giới hạn kiểm thử

Các ảnh và luồng minh chứng sử dụng dữ liệu trình diễn trong trình duyệt. Kết quả không thay thế việc xác nhận trực tiếp lịch của sân, kiểm tra môi trường vận hành thật hoặc thanh toán ngân hàng. Kiểm thử bao phủ các trường hợp được liệt kê, không chứng minh mọi tổ hợp bộ lọc hay mọi tình huống nhiều người cùng đặt đồng thời. Nhóm không đưa ra kết luận về trải nghiệm người dùng nếu chưa có thử nghiệm người dùng thực tế.

## Bước 8. Hoàn thiện, GitHub và sử dụng AI

Nhóm duy trì mã nguồn chung và ghi nhận thay đổi theo từng phần chức năng. README được cập nhật để hướng dẫn cách hiểu sản phẩm, cách chạy và cách kiểm thử. Báo cáo và ảnh chụp tổng hợp các phần đã triển khai; lịch sử đóng góp được mô tả theo bằng chứng hiện có, không quy kết hoạt động riêng khi chưa xác minh được.

**Sử dụng AI.** Công cụ AI hỗ trợ phân tích yêu cầu, đề xuất cách triển khai, viết và rà soát kiểm thử, cũng như biên tập tài liệu. Nhóm đối chiếu đề xuất với yêu cầu và kiểm tra hành vi bằng kiểm thử, giao diện và ảnh chụp. AI không được xem là nguồn xác nhận thay cho kết quả thực tế; giới hạn của dữ liệu và luồng đã kiểm tra được nêu riêng.

## Câu hỏi kiểm tra kiến thức

1. **Dữ liệu sân được sử dụng thống nhất như thế nào?** Danh sách và trang chi tiết lấy thông tin từ cùng nguồn. Giỏ sân chỉ lưu định danh sân, sân con, ngày và giờ; khi mở lại, website tải lịch và giá hiện tại.
2. **Tìm kiếm và bộ lọc được kết hợp ra sao?** Website giữ từ khóa và tiêu chí như quận, loại sân, mức giá, thời điểm; kết quả chỉ gồm sân thỏa các lựa chọn và được sắp xếp theo giá đã chọn.
3. **Trang chi tiết biết lựa chọn sân nào bằng cách nào?** `URLSearchParams` đọc mã sân và thông tin giờ từ đường dẫn để mở đúng lịch; lựa chọn không hợp lệ được báo cho người dùng.
4. **Điều gì xảy ra khi thêm lại cùng một giờ?** Giờ được nhận diện theo sân, sân con, ngày và thời điểm bắt đầu; lựa chọn trùng không tạo thêm dòng.
5. **Khi giỏ sân thay đổi, nội dung nào cập nhật?** Danh sách lựa chọn, số lượng trên menu, cảnh báo khả dụng và tổng tạm tính được cập nhật.
6. **Vì sao sử dụng `localStorage`?** Cách lưu này giữ lựa chọn trên trình duyệt khi chuyển trang hoặc tải lại; nó không giữ chỗ và không thay thế dữ liệu lịch chính thức.
7. **Nếu dữ liệu giỏ sân không hợp lệ thì xử lý thế nào?** `loadCart` kiểm tra cấu trúc, bỏ dữ liệu lỗi và chỉ giữ những lựa chọn có thể nhận diện.
8. **Vì sao không có nút tăng hoặc giảm số lượng?** Mỗi sân con và khung giờ là một chỗ cụ thể; muốn chọn giờ khác, khách thêm một lựa chọn riêng.
9. **AI được kiểm chứng ra sao?** Nhóm đối chiếu đề xuất với yêu cầu, thực hiện các luồng kiểm thử và kiểm tra giao diện; nội dung chưa có bằng chứng không được nêu như kết quả.
10. **Giỏ sân có đảm bảo giờ được đặt không?** Không. Đây chỉ là danh sách tham khảo; website kiểm tra lại tình trạng khi khách tiếp tục đặt.
