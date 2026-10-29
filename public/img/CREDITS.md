# Nguồn ảnh

Ảnh trong `public/img/photos/` lấy từ Pexels, dùng theo [Pexels License](https://www.pexels.com/license/)
(miễn phí, dùng thương mại và không cần ghi nguồn, nhưng ghi ở đây để truy được). Tải bản nén của CDN Pexels
(`images.pexels.com`, tham số `auto=compress&cs=tinysrgb&w=<rộng>`), không chỉnh sửa gì thêm (trừ ghi chú nén lại bên dưới).

| File | Rộng×cao | Dung lượng | Trang ảnh | Tác giả |
| --- | --- | --- | --- | --- |
| `photos/hero-1920.jpg` | 1920×1280 | 301.594 B | https://www.pexels.com/photo/man-in-blue-and-yellow-soccer-jersey-standing-on-the-soccer-field-13907425/ | Quyn Phạm |
| `photos/hero-800.jpg` (cùng ảnh, bản mobile) | 800×533 | 69.937 B | như trên | Quyn Phạm |
| `photos/hero-portrait-760.jpg` (cùng ảnh gốc, **bản cắt dọc** cho mobile dưới 640px: lấy vùng x 580–1340, y 150–1280 của bản 1920 để đầu cầu thủ nằm phía trên chữ) | 760×1130 | 100.378 B | như trên | Quyn Phạm |
| `photos/stats-1400.jpg` | 1400×933 | 270.440 B | https://www.pexels.com/photo/football-team-players-standing-on-the-side-of-a-pitch-13907456/ | Quyn Phạm |
| `photos/venue2-900.jpg` | 900×600 | 86.917 B | https://www.pexels.com/photo/football-players-sitting-on-football-field-13907429/ | Quyn Phạm |
| `photos/kids-900.jpg` | 900×600 | 100.874 B | https://www.pexels.com/photo/boys-playing-soccer-on-a-field-19582958/ | Nguyễn Hoàng Văn |
| `photos/aerial-900.jpg` | 900×675 | 108.859 B | https://www.pexels.com/photo/aerial-night-view-of-illuminated-soccer-field-32761355/ | Jose Parra |

Giấy phép: Pexels License (dùng và chỉnh sửa miễn phí, không bắt buộc ghi nguồn). Ảnh gốc của ba ảnh Quyn Phạm là 6000×4000; bản trong repo tải từ CDN của Pexels
(`images.pexels.com`, `auto=compress`) ở chiều rộng ghi trên, riêng `stats-1400.jpg` được nén lại (JPEG q72) từ bản 1600px.
Tác giả đã đối chiếu trên trang ảnh Pexels vào lần sửa này (hai ảnh Nguyễn Hoàng Văn và Jose Parra ở lần kiểm trước).
Ảnh Quyn Phạm chụp trận bóng đêm trên sân cỏ nhân tạo có lưới bao; trang ảnh không ghi địa điểm cụ thể. Các ảnh chỉ minh họa cho sân mẫu trong prototype, không phải sân thật của hệ thống.

## Font

Archivo (Omnibus-Type), SIL Open Font License 1.1, tải từ Google Fonts (https://fonts.google.com/specimen/Archivo), tự host trong `public/fonts/`.
Bản variable hai trục (wght 100–900, wdth 62–125), ba subset: `Archivo-vietnamese.woff2` 34.364 B, `Archivo-latin-ext.woff2` 85.856 B, `Archivo-latin.woff2` 90.096 B.
