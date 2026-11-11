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

1. **Dữ liệu sân được sử dụng thống nhất như thế nào?** GGO dùng cùng nguồn thông tin sân và lịch khi người dùng tìm kiếm, mở chi tiết và xem giỏ sân. Trên trang danh sách, website lấy các sân theo điều kiện đang chọn; khi mở chi tiết, website lấy lại sân và lịch của ngày tương ứng. Khi thêm giờ, giỏ chỉ lưu mã sân, mã sân con, ngày và giờ bắt đầu, không sao chép giá hay trạng thái còn chỗ.

   Ví dụ, khách lưu giờ 20:00 ở Sân 1 rồi sang giỏ sân, trang giỏ tải lại lịch và giá hiện tại của sân đó. Nếu giờ đã bị đặt trong lúc khách rời trang, giỏ hiển thị cảnh báo và không cộng giờ ấy vào tổng. Cách làm này tránh xem dữ liệu cũ là xác nhận còn chỗ; giỏ sân chỉ ghi nhớ lựa chọn, không thay thế bước đặt sân.

2. **Tìm kiếm, lọc và sắp xếp được kết hợp như thế nào?** Khi mở danh sách, GGO đọc từ khóa, ngày, giờ, quận, loại sân, mức giá và lựa chọn giờ chót từ đường dẫn bằng `URLSearchParams`. Từ khóa, ngày, quận, loại sân và mức giá được gửi cùng yêu cầu lấy danh sách; giờ cụ thể và giờ chót tiếp tục được áp dụng khi chọn các khung giờ hiển thị. Cuối cùng, giá được sắp tăng hoặc giảm trong từng nhóm sân còn giờ và sân không còn giờ.

   Chẳng hạn, khách chọn một quận, nhập tên sân rồi chọn giá tăng; khi tải lại, các lựa chọn vẫn hiện và thứ tự giá được giữ. Việc ghi trạng thái vào đường dẫn giúp khôi phục hoặc chia sẻ cùng một lựa chọn, còn tách hai nhóm giờ giúp sân không còn chỗ không chen vào giữa các sân có thể đặt.

3. **Trang chi tiết biết cần hiển thị sân và giờ nào bằng cách nào?** Khi người dùng mở trang, `URLSearchParams` đọc mã sân và các thông tin ngày, giờ, sân con từ đường dẫn. Trang lấy thông tin sân và lịch; nếu đường dẫn có một giờ cụ thể, trang chỉ chọn sẵn giờ đó khi giờ vẫn đặt được. Ngày ngoài thời hạn đặt được đưa về ngày hợp lệ; mã sân không tồn tại dẫn tới thông báo không tìm thấy sân.

   Ví dụ, từ trang danh sách khách mở Sân 1 lúc 20:00 thì trang chi tiết hiển thị đúng sân và ngày đã chọn. Nếu người khác vừa đặt giờ đó, trang không tiếp tục coi giờ là khả dụng mà báo tình trạng và yêu cầu chọn giờ khác. Cách kiểm tra này giữ cho thao tác đặt gắn với đúng lựa chọn và hạn chế gửi yêu cầu cho giờ đã thay đổi.

4. **Điều gì xảy ra khi thêm lại cùng một giờ vào giỏ sân?** GGO so sánh bốn thông tin: sân, sân con, ngày và giờ bắt đầu. Nếu đã có một dòng trùng đủ bốn thông tin, thao tác thêm trả về kết quả không thành công; trang chi tiết hiện thông báo “Giờ này đã có trong giỏ sân.” Nếu khác ngày hoặc sân con, đó là một lựa chọn riêng.

   Ví dụ, thêm Sân 1 lúc 20:00 vào cùng ngày lần đầu sẽ tạo một dòng; bấm “Thêm vào giỏ sân” lần nữa cho đúng giờ ấy chỉ hiện thông báo trùng, không tăng số lượng. Điều này phù hợp với quy tắc một sân con trong một khung giờ chỉ là một chỗ, tránh tạo cảm giác khách có thể giữ hoặc mua lặp cùng chỗ.

   ```js
   const rows = read();
   if (rows.some((r) => same(r, item))) return false;
   saveCart([...rows, { venueId: Number(item.venueId), courtId: Number(item.courtId), date: item.date, start: item.start }]);
   return true;
   ```

5. **Khi giỏ sân thay đổi, phần nào được cập nhật và tính tiền ra sao?** Sau khi thêm hoặc xóa, badge trên menu được đồng bộ trong trang hiện tại và các thẻ trình duyệt khác. Khi mở giỏ sân, website đọc lại danh sách đã lưu, lấy mới sân và lịch cho từng dòng, rồi kiểm tra trạng thái của sân con và giờ. Chỉ những dòng còn khả dụng mới được cộng giá hiện tại vào tổng tạm tính; badge vẫn phản ánh số dòng đang lưu.

   Ví dụ, nếu có hai giờ trong giỏ nhưng một giờ đã bị người khác đặt, trang vẫn cho thấy hai lựa chọn đã lưu, đồng thời ghi “Còn đặt được 1/2 giờ” và chỉ cộng giá của giờ còn trống. Như vậy người dùng không nhầm số lựa chọn với số giờ vẫn đặt được, cũng không dựa vào tổng tiền cũ khi giá hoặc lịch đã thay đổi.

6. **Vì sao dùng `localStorage`, và dữ liệu được khôi phục như thế nào?** GGO dùng `localStorage` với khóa giỏ `ggo.cart` để lựa chọn còn lại khi khách chuyển trang hoặc tải lại cùng website trên trình duyệt đó. `loadCart` đọc và kiểm tra dữ liệu; `saveCart` ghi danh sách sau khi thêm hoặc xóa, phát thông báo cập nhật giao diện và đọc lại kết quả. Cả lưu và đọc đều được bảo vệ để lỗi định dạng hoặc trình duyệt không cho truy cập bộ nhớ không làm hỏng trang.

   Ví dụ, sau khi tải lại trang, các mã sân, sân con, ngày và giờ vẫn được đọc lại; giỏ sau đó tải lịch và giá mới. Dữ liệu này chỉ nằm trong trình duyệt đó, không đồng bộ giữa thiết bị và không giữ chỗ trên máy chủ. Vì vậy phải kiểm tra lịch lại ở bước đặt sân.

   ```js
   const raw = storage.getItem(KEY);
   const rows = raw ? JSON.parse(raw) : [];
   if (!Array.isArray(rows)) return [];
   ```

7. **Nếu dữ liệu trong giỏ sân sai hoặc không còn hợp lệ thì xử lý thế nào?** Khi đọc dữ liệu, GGO chỉ giữ các dòng có mã sân và mã sân con chuyển được thành số nguyên, ngày theo dạng năm-tháng-ngày và giờ theo dạng giờ-phút; các dòng còn lại bị bỏ, mã được chuẩn hóa về dạng số và chỉ bốn trường định danh được giữ. Nếu nội dung không phải JSON hợp lệ hoặc không phải danh sách, thao tác đọc trả về danh sách rỗng. Sau đó trang giỏ vẫn kiểm tra lại sân con và giờ trong lịch.

   Ví dụ, một dòng có giờ sai định dạng hoặc thiếu mã sân không được dùng để dựng thẻ giỏ. Một dòng đúng định dạng nhưng sân hoặc giờ không còn trong lịch cũng bị đánh dấu không khả dụng và loại khỏi tổng. Phân biệt hai bước này giúp chống dữ liệu lỗi trong bộ nhớ đồng thời không nhầm rằng một dòng đúng cấu trúc chắc chắn còn đặt được.

8. **Nhóm giải quyết xung đột khi gộp hai nhánh tìm kiếm/sắp xếp và giỏ sân như thế nào?** Hai nhánh cùng sửa danh sách các luồng kiểm thử cần chạy: nhánh tìm kiếm/sắp xếp thêm luồng của mình, còn nhánh giỏ sân thêm luồng giỏ. Khi gộp, phần danh sách đó bị xung đột; nhóm giữ lại cả hai luồng để bộ chạy chung tiếp tục kiểm tra đủ hai chức năng.

   Nhánh giỏ sân đã được công khai trên GitHub trước khi nhập vào nhánh chính, nên nhóm dùng merge thay vì rebase. Cách này giữ nguyên lịch sử đã chia sẻ và thể hiện rõ hai nhánh công việc; nếu chỉ giữ một phía của xung đột thì một trong hai luồng kiểm thử sẽ bị bỏ khỏi lượt chạy chung.

9. **Nhóm đã kiểm chứng phần AI hỗ trợ viết như thế nào, và phát hiện gì?** Nhóm chạy bộ kiểm thử dự án đạt 183/183; kiểm thử trình duyệt cho tìm kiếm/sắp xếp và giỏ sân đều đạt ở độ rộng 390 và 1366. Nhóm cũng xem ảnh giao diện thay vì chỉ dựa vào kết quả tự động. Qua đó phát hiện ô tìm bị ẩn trong vùng lọc thu gọn, nhãn sắp xếp bị cắt trên điện thoại và sân hết giờ bị xếp xen vào nhóm sân còn giờ; các điểm này được điều chỉnh rồi kiểm tra lại.

   Ảnh giỏ sân còn cho thấy dấu câu sau lý do giờ không khả dụng bị thiếu, câu “1 giờ còn trống · 1 giờ” khó hiểu và ngày hiển thị dài hơn cần thiết; nhóm đổi thành cách ghi số giờ còn đặt được trên tổng, sửa dấu câu và rút gọn nhãn ngày. Ngoài ra, một kiểm thử sau khi tải lại trang lấy thuộc tính `value` trực tiếp từ lựa chọn quận, nhưng lựa chọn đó không khai báo thuộc tính này; kiểm thử được sửa để chọn theo nội dung nhãn. Những lần đối chiếu này cho thấy đề xuất của AI cần được kiểm tra bằng hành vi thật và cách người dùng đọc giao diện.

10. **Giỏ sân có bảo đảm khách sẽ đặt được giờ đã lưu không?** Không. Giỏ sân chỉ lưu lựa chọn ở trình duyệt; nó không khóa giờ và không tạo đơn đặt. Khi khách tiếp tục đặt, website gửi yêu cầu đặt theo luồng hiện có và máy chủ kiểm tra lại trạng thái giờ.

   Chẳng hạn, hai khách ở hai trình duyệt khác nhau có thể cùng lưu giờ 20:00 của một sân khi giờ còn trống. Người đặt trước có thể thành công, còn yêu cầu đến sau nhận thông báo giờ không còn khả dụng. Tách bước lưu khỏi bước đặt giúp không giữ chỗ vô thời hạn và buộc tình trạng cuối cùng được quyết định bởi lịch trên máy chủ.
