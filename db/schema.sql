-- SânNhanh - MySQL 8.4, utf8mb4. Giờ lưu theo giờ TP.HCM (UTC+7) dạng DATETIME/TIME, không dùng TIMESTAMP.
-- Tên cột snake_case; lớp truy cập (src/db.js) đổi sang camelCase cho code và JSON, xem docs ở đó.
-- Chạy bằng `npm run db:init` (xóa và tạo lại toàn bộ bảng).
--
-- CHỐNG ĐẶT TRÙNG (R4) nằm ở đây, không chỉ ở code. Hai lớp:
--   1. `bookings.slot_lock` (cột sinh ra) = 1 khi lịch đang giữ ô (pending/confirmed/matching), NULL khi đã nhả.
--      UNIQUE (court_id, start_at, slot_lock) nên DB không cho hai lịch đang giữ cùng một ô, bất kể code. UNIQUE bỏ
--      qua NULL nên lịch đã hủy/hết hạn không cản ai. Lớp này tự theo `status`, không ai phải nhớ nhả.
--   2. `slot_claims` có PRIMARY KEY (court_id, start_at): mỗi ô chỉ có MỘT chủ, dù là lịch đặt hay chặn giờ (blocks).
--      Lớp này chặn lịch đặt trùng với chặn giờ/giờ giữ của giải (R18), điều lớp 1 không làm được vì khác bảng.
--      Dòng claim của lịch đặt do services/bookingState.js giữ đồng bộ với status (chèn khi vào trạng thái giữ ô,
--      xóa khi ra) trong cùng transaction; của chặn giờ do services/slotClaims.js; xóa block thì ON DELETE CASCADE.
--      tests/helpers có `findClaimDrift` kiểm claim lệch status.
--   Hai transaction cùng chiếm một ô: InnoDB cho đúng một bên thắng, bên kia nhận ER_DUP_ENTRY (code đổi thành 409).
--   Vì sao không dùng trigger: tạo trigger cần quyền SUPER khi bật binary log (MySQL máy này và nhiều host không cấp).
--   Nhượng sân (R12): đổi booking cũ sang `transferred` rồi chèn booking mới của đội nhận trong CÙNG transaction.
-- Danh sách chờ (R9) KHÔNG chiếm ô: ô còn trống, chỉ có `waitlist.status = 'offered'` + hạn để chặn người khác ở tầng code.

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS waitlist;
DROP TABLE IF EXISTS slot_claims;
DROP TABLE IF EXISTS blocks;
DROP TABLE IF EXISTS booking_history;
DROP TABLE IF EXISTS bookings;
DROP TABLE IF EXISTS courts;
DROP TABLE IF EXISTS venues;
DROP TABLE IF EXISTS users;
SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name     VARCHAR(100) NOT NULL,
  email         VARCHAR(191) NOT NULL,
  phone         VARCHAR(15)  NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  role          ENUM('customer','owner','admin') NOT NULL DEFAULT 'customer',
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at    DATETIME NOT NULL,
  -- collation _ai_ci: email so khớp không phân biệt hoa thường.
  UNIQUE KEY uq_user_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Cụm sân. Giờ (slot) sinh từ open_time, close_time, slot_minutes. Giờ cao điểm cấu hình theo cụm sân (R5).
-- Tài khoản nhận tiền (VietQR, R8) nằm trên cụm sân: bank_bin + bank_account + bank_account_name.
CREATE TABLE venues (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  owner_id              INT UNSIGNED NOT NULL,
  name                  VARCHAR(150) NOT NULL,
  district              VARCHAR(50)  NOT NULL,
  address               VARCHAR(255) NOT NULL,
  phone                 VARCHAR(20)  NOT NULL DEFAULT '',   -- '' khi nguồn không có số; không bao giờ tự đặt số
  description           TEXT NOT NULL,
  rules                 TEXT NOT NULL,
  amenities             JSON NOT NULL,                      -- mảng chuỗi
  open_time             TIME NOT NULL,
  close_time            TIME NOT NULL,
  slot_minutes          SMALLINT UNSIGNED NOT NULL DEFAULT 60,
  peak_start            TIME NULL,
  peak_end              TIME NULL,
  requires_approval     TINYINT(1) NOT NULL DEFAULT 0,      -- R3: 0 = đặt là chốt, 1 = chủ sân duyệt
  last_minute_percent   TINYINT UNSIGNED NOT NULL DEFAULT 0, -- R6: 0 = tắt
  maps_url              VARCHAR(1000) NOT NULL DEFAULT '',
  image_url             VARCHAR(500) NOT NULL DEFAULT '/img/pitch-1.svg',
  image_is_illustrative TINYINT(1) NOT NULL DEFAULT 1,
  image_credit          JSON NULL,                          -- { source, contributor, url } hoặc NULL
  data_source           JSON NULL,                          -- sân thật: { retrievedOn, sources[], estimated[], derived[] }; sân demo: NULL
  bank_bin              VARCHAR(10)  NOT NULL DEFAULT '',
  bank_account          VARCHAR(30)  NOT NULL DEFAULT '',
  bank_account_name     VARCHAR(100) NOT NULL DEFAULT '',
  is_active             TINYINT(1) NOT NULL DEFAULT 1,
  created_at            DATETIME NOT NULL,
  updated_at            DATETIME NOT NULL,
  CONSTRAINT fk_venue_owner FOREIGN KEY (owner_id) REFERENCES users(id),
  INDEX idx_venue_district (district),
  INDEX idx_venue_owner (owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Sân con. price = giá thường, peak_price = giá trong giờ cao điểm của cụm sân (R5).
-- "Chỉ nhận ghép kèo" (R13): team_mode_enabled, giới hạn trong khung [team_mode_from, team_mode_to) nếu có.
-- Không xóa cứng (giữ lịch sử đặt), chỉ is_active = 0.
CREATE TABLE courts (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  venue_id          INT UNSIGNED NOT NULL,
  name              VARCHAR(50) NOT NULL,
  field_type        ENUM('5','7') NOT NULL,
  price             INT UNSIGNED NOT NULL,
  peak_price        INT UNSIGNED NOT NULL,
  is_active         TINYINT(1) NOT NULL DEFAULT 1,
  team_mode_enabled TINYINT(1) NOT NULL DEFAULT 0,
  team_mode_from    TIME NULL,
  team_mode_to      TIME NULL,
  CONSTRAINT fk_court_venue FOREIGN KEY (venue_id) REFERENCES venues(id),
  INDEX idx_court_venue (venue_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Lịch đặt (R2: 1 sân con x 1 giờ). Mọi trạng thái của R11 ở `status`; tiền ở payment_*/refund_*.
-- user_id NULL = lịch chủ sân tự thêm cho khách gọi điện (R16), khi đó source = 'phone' và có walk_in_*.
-- price/base_price/discount_percent là giá CHỐT lúc đặt (R6); rules_snapshot/policy_snapshot chụp lúc đặt.
-- offer_id, match_id: chưa có FK vì bảng chào giá/trận chưa tồn tại; thêm FK khi bảng đó ra đời.
-- transfer_from_booking_id: lịch này có được do nhận pass (R12).
CREATE TABLE bookings (
  id                       INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code                     VARCHAR(20) NOT NULL,
  user_id                  INT UNSIGNED NULL,
  venue_id                 INT UNSIGNED NOT NULL,
  court_id                 INT UNSIGNED NOT NULL,
  start_at                 DATETIME NOT NULL,
  end_at                   DATETIME NOT NULL,
  status                   ENUM('pending','confirmed','rejected','cancelled','expired','completed','no_show','transferred','matching') NOT NULL,
  source                   ENUM('web','phone') NOT NULL DEFAULT 'web',
  walk_in_name             VARCHAR(80) NULL,
  walk_in_phone            VARCHAR(20) NULL,
  expires_at               DATETIME NULL,                    -- hạn chủ sân duyệt (R3) khi pending
  price                    INT UNSIGNED NOT NULL,
  base_price               INT UNSIGNED NOT NULL,
  discount_percent         TINYINT UNSIGNED NOT NULL DEFAULT 0,
  offer_id                 INT UNSIGNED NULL,
  match_id                 INT UNSIGNED NULL,
  transfer_from_booking_id INT UNSIGNED NULL,
  payment_status           ENUM('unpaid','paid') NOT NULL DEFAULT 'unpaid',
  paid_at                  DATETIME NULL,
  paid_via                 ENUM('bank','owner') NULL,
  refund_status            ENUM('none','pending','done') NOT NULL DEFAULT 'none',
  refund_percent           TINYINT UNSIGNED NOT NULL DEFAULT 0,
  refund_amount            INT UNSIGNED NOT NULL DEFAULT 0,
  refunded_at              DATETIME NULL,
  refund_note              VARCHAR(255) NULL,
  cancelled_by             ENUM('customer','owner','admin') NULL,
  cancelled_at             DATETIME NULL,
  cancel_reason            VARCHAR(255) NULL,
  late_cancel              TINYINT(1) NOT NULL DEFAULT 0,    -- R10: khách hủy lịch đã xác nhận khi còn < 12h
  customer_note            VARCHAR(300) NOT NULL DEFAULT '',
  rules_snapshot           TEXT NOT NULL,
  policy_snapshot          TEXT NOT NULL,
  idempotency_key          VARCHAR(64) NULL,
  created_at               DATETIME NOT NULL,
  updated_at               DATETIME NOT NULL,
  -- Lớp chống trùng 1 (xem đầu file). Không ghi trực tiếp.
  slot_lock                TINYINT AS (IF(status IN ('pending','confirmed','matching'), 1, NULL)) STORED,
  UNIQUE KEY uq_booking_code (code),
  UNIQUE KEY uq_booking_slot (court_id, start_at, slot_lock),
  UNIQUE KEY uq_booking_idem (user_id, idempotency_key),     -- NULL không đụng nhau
  UNIQUE KEY uq_booking_slot_ref (id, court_id, start_at),  -- đích của FK ở slot_claims
  CONSTRAINT fk_booking_user  FOREIGN KEY (user_id)  REFERENCES users(id),
  CONSTRAINT fk_booking_venue FOREIGN KEY (venue_id) REFERENCES venues(id),
  CONSTRAINT fk_booking_court FOREIGN KEY (court_id) REFERENCES courts(id),
  CONSTRAINT fk_booking_transfer_from FOREIGN KEY (transfer_from_booking_id) REFERENCES bookings(id),
  CONSTRAINT ck_booking_phone CHECK (user_id IS NOT NULL OR (source = 'phone' AND walk_in_name IS NOT NULL)),
  INDEX idx_booking_user (user_id, start_at),               -- "lịch đặt của tôi", uy tín 60 ngày (R10)
  INDEX idx_booking_venue_time (venue_id, start_at),
  INDEX idx_booking_status_exp (status, expires_at)         -- quét hết hạn
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Nhật ký thao tác trên lịch đặt; cũng là nguồn của "Nhật ký" admin. actor_id NULL khi do hệ thống/ngân hàng.
CREATE TABLE booking_history (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  booking_id  INT UNSIGNED NOT NULL,
  action      VARCHAR(30) NOT NULL,
  from_status VARCHAR(20) NULL,
  to_status   VARCHAR(20) NULL,
  actor_id    INT UNSIGNED NULL,
  actor_role  ENUM('customer','owner','admin','system','bank') NOT NULL DEFAULT 'system',
  note        VARCHAR(500) NOT NULL DEFAULT '',
  created_at  DATETIME NOT NULL,
  CONSTRAINT fk_hist_booking FOREIGN KEY (booking_id) REFERENCES bookings(id),
  CONSTRAINT fk_hist_actor FOREIGN KEY (actor_id) REFERENCES users(id),
  INDEX idx_hist_booking (booking_id),
  INDEX idx_hist_time (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Chặn giờ thủ công (R: bảo trì, sự kiện) và giờ giữ của giải (R18, league_id). Khoảng [start_at, end_at).
-- league_id / league_match_id chưa có FK vì bảng giải chưa tồn tại.
CREATE TABLE blocks (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  court_id        INT UNSIGNED NOT NULL,
  start_at        DATETIME NOT NULL,
  end_at          DATETIME NOT NULL,
  reason          VARCHAR(255) NOT NULL,
  created_by      INT UNSIGNED NOT NULL,
  league_id       INT UNSIGNED NULL,
  league_match_id INT UNSIGNED NULL,
  created_at      DATETIME NOT NULL,
  CONSTRAINT fk_block_court FOREIGN KEY (court_id) REFERENCES courts(id),
  CONSTRAINT fk_block_user  FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT ck_block_range CHECK (end_at > start_at),
  INDEX idx_block_court_time (court_id, start_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Mỗi dòng = một ô giờ đang có chủ. PRIMARY KEY là lớp chống trùng 2 (xem đầu file).
-- booking_id có UNIQUE: một lịch giữ đúng một ô (R2). FK ghép (booking_id, court_id, start_at) buộc ô của claim
-- trùng ô của lịch, nên không thể đổi sân/giờ của lịch đang giữ chỗ.
CREATE TABLE slot_claims (
  court_id   INT UNSIGNED NOT NULL,
  start_at   DATETIME NOT NULL,
  kind       ENUM('booking','block') NOT NULL,
  booking_id INT UNSIGNED NULL,
  block_id   INT UNSIGNED NULL,
  PRIMARY KEY (court_id, start_at),
  UNIQUE KEY uq_claim_booking (booking_id),
  INDEX idx_claim_block (block_id),
  CONSTRAINT fk_claim_court FOREIGN KEY (court_id) REFERENCES courts(id),
  CONSTRAINT fk_claim_booking FOREIGN KEY (booking_id, court_id, start_at) REFERENCES bookings (id, court_id, start_at),
  CONSTRAINT fk_claim_block FOREIGN KEY (block_id) REFERENCES blocks(id) ON DELETE CASCADE,
  CONSTRAINT ck_claim_kind CHECK (
    (kind = 'booking' AND booking_id IS NOT NULL AND block_id IS NULL) OR
    (kind = 'block'   AND block_id   IS NOT NULL AND booking_id IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Danh sách chờ (R9). Vị trí = thứ tự id trong cùng (court_id, start_at). status 'offered' + offer_expires_at =
-- đang giữ quyền đặt cho người này. Không chiếm slot_claims.
CREATE TABLE waitlist (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id          INT UNSIGNED NOT NULL,
  court_id         INT UNSIGNED NOT NULL,
  start_at         DATETIME NOT NULL,
  status           ENUM('waiting','offered') NOT NULL DEFAULT 'waiting',
  offer_expires_at DATETIME NULL,
  created_at       DATETIME NOT NULL,
  UNIQUE KEY uq_waitlist_user_slot (user_id, court_id, start_at),
  CONSTRAINT fk_wait_user  FOREIGN KEY (user_id)  REFERENCES users(id),
  CONSTRAINT fk_wait_court FOREIGN KEY (court_id) REFERENCES courts(id),
  INDEX idx_wait_slot (court_id, start_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE notifications (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  booking_id INT UNSIGNED NULL,
  message    VARCHAR(300) NOT NULL,
  link       VARCHAR(200) NOT NULL DEFAULT '/notifications.html',
  is_read    TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_notif_booking FOREIGN KEY (booking_id) REFERENCES bookings(id),
  INDEX idx_notif_user (user_id, is_read, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Session đăng nhập (express-mysql-session; tên và cột đúng như thư viện mong đợi).
CREATE TABLE sessions (
  session_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
  expires    INT UNSIGNED NOT NULL,
  data       MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  INDEX idx_session_expires (expires)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Chưa có bảng (cố ý, sẽ thêm bằng migration riêng khi làm tính năng): transfers (pass), matches (ghép kèo),
-- requests/offers (nhờ báo giá), leagues/league_teams/league_matches (giải), bank_transactions (SePay).
-- Chúng tham chiếu bookings/blocks/courts có sẵn: bookings.offer_id/match_id/transfer_from_booking_id và
-- blocks.league_id/league_match_id đã có cột để nối.
