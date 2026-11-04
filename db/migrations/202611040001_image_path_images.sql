-- Ảnh tĩnh chuyển từ /img/ sang /images/. Backfill cho bản cài cũ; chạy lại nhiều lần vẫn an toàn.
-- Đường dẫn cũ vẫn mở được nhờ chuyển hướng /img/* -> /images/*, nên bước này chỉ để bỏ một lần chuyển hướng.
ALTER TABLE venues ALTER COLUMN image_url SET DEFAULT '/images/pitch-1.svg';
UPDATE venues SET image_url = CONCAT('/images/', SUBSTRING(image_url, 6)) WHERE image_url LIKE '/img/%';
