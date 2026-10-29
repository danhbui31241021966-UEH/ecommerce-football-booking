-- Website đặt sân bóng đá mini 5/7 người - MySQL 8.x
-- Thời gian lưu theo giờ Việt Nam (UTC+7), kiểu DATETIME.

DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS booking_history;
DROP TABLE IF EXISTS bookings;
DROP TABLE IF EXISTS slot_blocks;
DROP TABLE IF EXISTS courts;
DROP TABLE IF EXISTS venues;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name     VARCHAR(100) NOT NULL,
  email         VARCHAR(191) NOT NULL UNIQUE,
  phone         VARCHAR(15)  NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  role          ENUM('customer','owner','admin') NOT NULL DEFAULT 'customer',
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Cụm sân. Khung giờ (slot) được sinh từ open_time, close_time, slot_minutes.
CREATE TABLE venues (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  owner_id          INT UNSIGNED NOT NULL,
  name              VARCHAR(150) NOT NULL,
  district          VARCHAR(50)  NOT NULL,
  address           VARCHAR(255) NOT NULL,
  phone             VARCHAR(15)  NOT NULL,
  description       TEXT,
  amenities         VARCHAR(500) NOT NULL DEFAULT '',
  open_time         TIME NOT NULL,
  close_time        TIME NOT NULL,
  slot_minutes      SMALLINT UNSIGNED NOT NULL DEFAULT 60,
  peak_start        TIME NULL,
  peak_end          TIME NULL,
  requires_approval TINYINT(1) NOT NULL DEFAULT 0,
  rules             TEXT,
  payment_info      TEXT,
  image_url         VARCHAR(500) NOT NULL DEFAULT '/img/pitch-1.svg',
  is_active         TINYINT(1) NOT NULL DEFAULT 1,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_venue_owner FOREIGN KEY (owner_id) REFERENCES users(id),
  INDEX idx_venue_district (district)
) ENGINE=InnoDB;

-- Sân con. Giá tính theo 1 slot; peak_price áp dụng khi slot bắt đầu trong khung giờ vàng.
-- Sân con không bị xóa cứng, chỉ ngừng hoạt động để giữ lịch sử booking.
CREATE TABLE courts (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  venue_id   INT UNSIGNED NOT NULL,
  name       VARCHAR(50) NOT NULL,
  field_type ENUM('5','7') NOT NULL,
  price      INT UNSIGNED NOT NULL,
  peak_price INT UNSIGNED NOT NULL,
  is_active  TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT fk_court_venue FOREIGN KEY (venue_id) REFERENCES venues(id)
) ENGINE=InnoDB;

-- Slot chủ sân chặn thủ công (đặt ngoài web, bảo trì, sự kiện).
CREATE TABLE slot_blocks (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  court_id   INT UNSIGNED NOT NULL,
  start_at   DATETIME NOT NULL,
  end_at     DATETIME NOT NULL,
  reason     VARCHAR(255) NOT NULL,
  created_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_block_court FOREIGN KEY (court_id) REFERENCES courts(id),
  CONSTRAINT fk_block_user  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_block_court_time (court_id, start_at)
) ENGINE=InnoDB;

CREATE TABLE bookings (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code             VARCHAR(20) NOT NULL UNIQUE,
  customer_id      INT UNSIGNED NOT NULL,
  venue_id         INT UNSIGNED NOT NULL,
  court_id         INT UNSIGNED NOT NULL,
  start_at         DATETIME NOT NULL,
  end_at           DATETIME NOT NULL,
  status           ENUM('pending','confirmed','rejected','cancelled','expired') NOT NULL,
  expires_at       DATETIME NULL,
  -- Snapshot tại thời điểm tạo booking: đổi giá/điều kiện sau đó không ảnh hưởng booking này.
  price            INT UNSIGNED NOT NULL,
  venue_name       VARCHAR(150) NOT NULL,
  court_name       VARCHAR(50) NOT NULL,
  field_type       ENUM('5','7') NOT NULL,
  rules_snapshot   TEXT,
  policy_snapshot  TEXT,
  payment_info_snapshot TEXT,
  customer_note    VARCHAR(255),
  payment_status   ENUM('unpaid','paid') NOT NULL DEFAULT 'unpaid',
  paid_at          DATETIME NULL,
  cancel_reason    VARCHAR(255),
  cancelled_by     ENUM('customer','owner','admin') NULL,
  refund_percent   TINYINT UNSIGNED NULL,
  refund_amount    INT UNSIGNED NOT NULL DEFAULT 0,
  refund_status    ENUM('none','pending','done') NOT NULL DEFAULT 'none',
  refunded_at      DATETIME NULL,
  refund_note      VARCHAR(255),
  idempotency_key  VARCHAR(64) NOT NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- 1 khi booking đang giữ slot (chờ xác nhận hoặc đã xác nhận), NULL khi đã giải phóng.
  -- UNIQUE bỏ qua NULL, nên DB tự chặn hai booking giữ cùng sân con + cùng giờ bắt đầu.
  slot_lock        TINYINT AS (IF(status IN ('pending','confirmed'), 1, NULL)) STORED,
  CONSTRAINT fk_booking_customer FOREIGN KEY (customer_id) REFERENCES users(id),
  CONSTRAINT fk_booking_venue    FOREIGN KEY (venue_id) REFERENCES venues(id),
  CONSTRAINT fk_booking_court    FOREIGN KEY (court_id) REFERENCES courts(id),
  UNIQUE KEY uq_booking_slot (court_id, start_at, slot_lock),
  UNIQUE KEY uq_booking_idem (customer_id, idempotency_key),
  INDEX idx_booking_status_exp (status, expires_at),
  INDEX idx_booking_venue_time (venue_id, start_at)
) ENGINE=InnoDB;

CREATE TABLE booking_history (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  booking_id  INT UNSIGNED NOT NULL,
  action      VARCHAR(30) NOT NULL,
  from_status VARCHAR(20) NULL,
  to_status   VARCHAR(20) NULL,
  actor_id    INT UNSIGNED NULL,
  note        VARCHAR(500),
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_hist_booking FOREIGN KEY (booking_id) REFERENCES bookings(id),
  INDEX idx_hist_booking (booking_id)
) ENGINE=InnoDB;

CREATE TABLE notifications (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  booking_id INT UNSIGNED NULL,
  message    VARCHAR(255) NOT NULL,
  is_read    TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_notif_user (user_id, is_read)
) ENGINE=InnoDB;
