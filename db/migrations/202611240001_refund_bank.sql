-- Tài khoản khách nhận lại tiền khi hủy. Backfill cho bản cài cũ; chạy lại nhiều lần vẫn an toàn.
-- Chọn đúng database trước khi chạy. Lịch đặt đã hủy trước đó giữ NULL (khách bổ sung ở trang lịch đặt).

SET @ggo_cols = (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'bookings' AND column_name IN ('refund_bank_bin', 'refund_bank_account', 'refund_bank_name')
);
SET @ggo_sql = IF(@ggo_cols = 0,
  'ALTER TABLE bookings ADD COLUMN refund_bank_bin VARCHAR(10) NULL AFTER refund_note, ADD COLUMN refund_bank_account VARCHAR(20) NULL AFTER refund_bank_bin, ADD COLUMN refund_bank_name VARCHAR(60) NULL AFTER refund_bank_account',
  'SELECT 1');
PREPARE ggo_stmt FROM @ggo_sql;
EXECUTE ggo_stmt;
DEALLOCATE PREPARE ggo_stmt;
