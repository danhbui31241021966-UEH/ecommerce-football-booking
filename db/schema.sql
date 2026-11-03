-- GGO - MySQL 8.4, utf8mb4. Giờ lưu theo giờ TP.HCM (UTC+7) dạng DATETIME/TIME, không dùng TIMESTAMP.
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
DROP TABLE IF EXISTS bank_transactions;
DROP TABLE IF EXISTS league_events;
DROP TABLE IF EXISTS league_matches;
DROP TABLE IF EXISTS league_teams;
DROP TABLE IF EXISTS leagues;
DROP TABLE IF EXISTS offers;
DROP TABLE IF EXISTS requests;
DROP TABLE IF EXISTS match_refunds;
DROP TABLE IF EXISTS matches;
DROP TABLE IF EXISTS transfers;
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
  expires_at               DATETIME NULL,                    -- hạn của bước đang chờ (R3): pending = chủ sân đồng ý; confirmed + unpaid = khách chuyển khoản; còn lại NULL
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
-- R12: một lịch có thể đăng pass nhiều lần tuần tự; khóa booking trong ứng dụng ngăn đăng hai pass cùng lúc.
CREATE TABLE transfers (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  booking_id        INT UNSIGNED NOT NULL,
  from_user_id      INT UNSIGNED NOT NULL,
  ask_price         INT UNSIGNED NOT NULL,
  status            ENUM('open','claimed','completed','cancelled','expired') NOT NULL,
  created_at        DATETIME NOT NULL,
  closes_at         DATETIME NOT NULL,
  priority_until    DATETIME NULL,
  to_user_id        INT UNSIGNED NULL,
  claimed_at        DATETIME NULL,
  claim_expires_at  DATETIME NULL,
  new_booking_id    INT UNSIGNED NULL,
  completed_at      DATETIME NULL,
  end_reason        VARCHAR(255) NULL,
  CONSTRAINT fk_transfer_booking FOREIGN KEY (booking_id) REFERENCES bookings(id),
  CONSTRAINT fk_transfer_from_user FOREIGN KEY (from_user_id) REFERENCES users(id),
  CONSTRAINT fk_transfer_to_user FOREIGN KEY (to_user_id) REFERENCES users(id),
  CONSTRAINT fk_transfer_new_booking FOREIGN KEY (new_booking_id) REFERENCES bookings(id),
  INDEX idx_transfer_booking_status (booking_id, status),
  INDEX idx_transfer_status_close (status, closes_at),
  INDEX idx_transfer_from_user (from_user_id, id),
  INDEX idx_transfer_to_user (to_user_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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

-- Ghép kèo (R13) và kèo tiền sân (R15). Mỗi trận có đúng một booking (matches.booking_id, trạng thái `matching` giữ ô qua
-- slot_claims như mọi lịch khác). bookings.match_id trỏ ngược lại nhưng KHÔNG có FK (vòng tham chiếu); services/matchOps.js
-- đặt nó khi tạo trận. Hai đội cùng vào một trận cùng lúc: matchOps khóa dòng matches (SELECT ... FOR UPDATE) rồi UPDATE có
-- điều kiện `status = 'open' AND guest_id IS NULL`, nên đúng một bên thắng, bên kia 409.
-- Khóa dòng luôn theo thứ tự matches -> bookings (setStatus khóa bookings).
CREATE TABLE matches (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  booking_id            INT UNSIGNED NOT NULL,
  host_id               INT UNSIGNED NOT NULL,                 -- đội mở kèo (đứng tên booking)
  guest_id              INT UNSIGNED NULL,                     -- đội vào kèo
  price                 INT UNSIGNED NOT NULL,                 -- giá sân tại lúc mở kèo
  loser_percent         TINYINT UNSIGNED NOT NULL DEFAULT 50,  -- R15: 50 / 60 / 70 / 100
  host_amount           INT UNSIGNED NOT NULL,                 -- phần chuyển trước của đội mở
  guest_amount          INT UNSIGNED NOT NULL,                 -- phần còn lại (host + guest = price)
  status                ENUM('open','joined','confirmed','cancelled','expired') NOT NULL DEFAULT 'open',
  created_at            DATETIME NOT NULL,
  closes_at             DATETIME NOT NULL,                     -- hạn tìm đủ hai đội
  host_pay_by           DATETIME NOT NULL,                     -- hạn chủ sân xác nhận phần của đội mở
  host_paid_at          DATETIME NULL,                         -- chủ sân đã xác nhận nhận tiền
  guest_paid_at         DATETIME NULL,
  guest_hold_until      DATETIME NULL,                         -- hạn giữ chỗ của đội vào khi status = joined
  joined_at             DATETIME NULL,
  ended_at              DATETIME NULL,
  end_reason            VARCHAR(300) NULL,
  host_bank_bin         VARCHAR(10) NULL,
  host_bank_account     VARCHAR(20) NULL,
  host_bank_name        VARCHAR(60) NULL,
  guest_bank_bin        VARCHAR(10) NULL,
  guest_bank_account    VARCHAR(20) NULL,
  guest_bank_name       VARCHAR(60) NULL,
  -- R15: kết quả (NULL khi kèo 5-5, hoặc chưa đá xong)
  result_status         ENUM('awaiting','needs_owner','settled') NULL,
  report_by             DATETIME NULL,
  host_report           ENUM('host','guest','draw') NULL,
  guest_report          ENUM('host','guest','draw') NULL,
  winner                ENUM('host','guest','draw') NULL,
  settled_by            ENUM('agree','owner') NULL,
  settled_at            DATETIME NULL,
  topup_from            ENUM('host','guest') NULL,
  topup_to              ENUM('host','guest') NULL,
  topup_amount          INT UNSIGNED NULL,
  topup_status          ENUM('unpaid','received') NULL,
  topup_due_by          DATETIME NULL,
  topup_received_at     DATETIME NULL,
  UNIQUE KEY uq_match_booking (booking_id),
  CONSTRAINT fk_match_booking FOREIGN KEY (booking_id) REFERENCES bookings(id),
  CONSTRAINT fk_match_host    FOREIGN KEY (host_id)  REFERENCES users(id),
  CONSTRAINT fk_match_guest   FOREIGN KEY (guest_id) REFERENCES users(id),
  CONSTRAINT ck_match_loser   CHECK (loser_percent IN (50, 60, 70, 100)),
  CONSTRAINT ck_match_amounts CHECK (host_amount + guest_amount = price),
  INDEX idx_match_status (status, closes_at),
  INDEX idx_match_host  (host_id),
  INDEX idx_match_guest (guest_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Tiền chủ sân phải chuyển lại cho từng đội khi trận không thành (R13e–g). Chỉ ghi cho phần chủ sân đã xác nhận nhận.
CREATE TABLE match_refunds (
  id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  match_id  INT UNSIGNED NOT NULL,
  part      ENUM('host','guest') NOT NULL,
  user_id   INT UNSIGNED NOT NULL,
  amount    INT UNSIGNED NOT NULL,
  status    ENUM('pending','done') NOT NULL DEFAULT 'pending',
  done_at   DATETIME NULL,
  UNIQUE KEY uq_match_refund_part (match_id, part),
  CONSTRAINT fk_mrefund_match FOREIGN KEY (match_id) REFERENCES matches(id),
  CONSTRAINT fk_mrefund_user  FOREIGN KEY (user_id)  REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Nhu cầu của khách và chào giá của sân (R14). Chào giá KHÔNG giữ ô (không có slot_claims): chỉ khi khách chọn thì mới tạo booking
-- qua luồng đặt thường (bookingCore.createBooking), nên chống trùng ô vẫn là của bookings/slot_claims.
-- bookings.offer_id trỏ tới offers.id nhưng không có FK (vòng tham chiếu requests.booking_id <-> bookings).
-- offers.open_key (cột sinh ra) = 1 khi chào giá còn mở: UNIQUE (request_id, venue_id, open_key) là luật "mỗi cụm sân chỉ một chào giá
-- đang mở cho một nhu cầu" do DB giữ. Thứ tự khóa dòng luôn requests -> offers.
CREATE TABLE requests (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         INT UNSIGNED NOT NULL,
  district        VARCHAR(60) NOT NULL,
  want_date       DATE NOT NULL,
  from_time       TIME NOT NULL,
  to_time         TIME NOT NULL,
  field_type      ENUM('5','7') NOT NULL,
  budget          INT UNSIGNED NOT NULL,                      -- cho một slot; chỉ để hiển thị, không lọc
  note            VARCHAR(300) NOT NULL DEFAULT '',
  status          ENUM('open','chosen','expired','cancelled') NOT NULL DEFAULT 'open',
  closes_at       DATETIME NOT NULL,                          -- hạn nhận chào giá
  created_at      DATETIME NOT NULL,
  end_reason      VARCHAR(255) NULL,
  chosen_offer_id INT UNSIGNED NULL,
  booking_id      INT UNSIGNED NULL,
  CONSTRAINT fk_request_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_request_booking FOREIGN KEY (booking_id) REFERENCES bookings(id),
  INDEX idx_request_user (user_id, status),
  INDEX idx_request_open (status, closes_at),
  INDEX idx_request_district (district, want_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE offers (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_id   INT UNSIGNED NOT NULL,
  venue_id     INT UNSIGNED NOT NULL,
  court_id     INT UNSIGNED NOT NULL,
  start_at     DATETIME NOT NULL,
  end_at       DATETIME NOT NULL,
  price        INT UNSIGNED NOT NULL,                         -- giá chào (bội số 1.000đ, không vượt giá niêm yết)
  listed_price INT UNSIGNED NOT NULL,                         -- giá niêm yết của slot lúc chào
  valid_until  DATETIME NOT NULL,
  note         VARCHAR(200) NOT NULL DEFAULT '',
  status       ENUM('open','chosen','lost','withdrawn','expired','void') NOT NULL DEFAULT 'open',
  end_reason   VARCHAR(255) NULL,
  created_at   DATETIME NOT NULL,
  open_key     TINYINT AS (IF(status = 'open', 1, NULL)) STORED,
  UNIQUE KEY uq_offer_open_venue (request_id, venue_id, open_key),
  CONSTRAINT fk_offer_request FOREIGN KEY (request_id) REFERENCES requests(id),
  CONSTRAINT fk_offer_venue FOREIGN KEY (venue_id) REFERENCES venues(id),
  CONSTRAINT fk_offer_court FOREIGN KEY (court_id) REFERENCES courts(id),
  INDEX idx_offer_request (request_id, status),
  INDEX idx_offer_venue (venue_id, status),
  INDEX idx_offer_valid (status, valid_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Giải phủi tại một sân, vòng tròn một lượt (R18). Trạng thái giải (draft/published/ongoing/finished) và bảng xếp hạng KHÔNG lưu:
-- suy ra từ published_at, từ kết quả và từ giờ giữ của các trận.
-- Giờ đá của một trận khi đã công bố = một dòng `blocks` (league_id, league_match_id) + dòng `slot_claims` của nó, nên ô đó
-- có đúng một chủ ở lớp chống trùng PRIMARY KEY (court_id, start_at) như mọi chỗ khác. league_matches.block_id là FK tới blocks
-- (RESTRICT): không ai xóa được một block đang giữ giờ giải ở tầng DB, chỉ đi qua trả giờ của giải. Bảng blocks không đổi
-- (league_id/league_match_id vẫn là cột thường, không FK, để tránh vòng tham chiếu blocks <-> league_matches).
-- Trước khi công bố start_at/court_id chỉ là giờ dự kiến (block_id NULL, không giữ ô).
CREATE TABLE leagues (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  venue_id     INT UNSIGNED NOT NULL,
  name         VARCHAR(80) NOT NULL,
  field_type   ENUM('5','7') NOT NULL,
  team_count   TINYINT UNSIGNED NOT NULL,
  rules        TEXT NOT NULL,
  link         VARCHAR(300) NOT NULL DEFAULT '',
  published_at DATETIME NULL,
  created_at   DATETIME NOT NULL,
  CONSTRAINT fk_league_venue FOREIGN KEY (venue_id) REFERENCES venues(id),
  CONSTRAINT ck_league_teams CHECK (team_count BETWEEN 4 AND 8),
  INDEX idx_league_venue (venue_id, published_at),
  INDEX idx_league_published (published_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Đội không có tài khoản. Tên đội không trùng trong một giải (không phân biệt hoa/thường, có phân biệt dấu).
CREATE TABLE league_teams (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  league_id     INT UNSIGNED NOT NULL,
  name          VARCHAR(40) COLLATE utf8mb4_0900_as_ci NOT NULL,
  contact_name  VARCHAR(60) NOT NULL DEFAULT '',
  contact_phone VARCHAR(20) NOT NULL DEFAULT '',
  fee_paid      TINYINT(1) NOT NULL DEFAULT 0,
  withdrawn_at  DATETIME NULL,
  created_at    DATETIME NOT NULL,
  CONSTRAINT fk_lteam_league FOREIGN KEY (league_id) REFERENCES leagues(id),
  UNIQUE KEY uq_lteam_name (league_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE league_matches (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  league_id  INT UNSIGNED NOT NULL,
  round_no   TINYINT UNSIGNED NOT NULL,
  home_id    INT UNSIGNED NOT NULL,
  away_id    INT UNSIGNED NOT NULL,
  court_id   INT UNSIGNED NULL,
  start_at   DATETIME NULL,
  block_id   INT UNSIGNED NULL,                    -- có = giờ đang được giữ
  home_score TINYINT UNSIGNED NULL,
  away_score TINYINT UNSIGNED NULL,
  forfeit_by INT UNSIGNED NULL,                    -- đội rút: xử thua 0-3
  CONSTRAINT fk_lmatch_league FOREIGN KEY (league_id) REFERENCES leagues(id),
  CONSTRAINT fk_lmatch_home FOREIGN KEY (home_id) REFERENCES league_teams(id),
  CONSTRAINT fk_lmatch_away FOREIGN KEY (away_id) REFERENCES league_teams(id),
  CONSTRAINT fk_lmatch_forfeit FOREIGN KEY (forfeit_by) REFERENCES league_teams(id),
  CONSTRAINT fk_lmatch_court FOREIGN KEY (court_id) REFERENCES courts(id),
  CONSTRAINT fk_lmatch_block FOREIGN KEY (block_id) REFERENCES blocks(id),
  CONSTRAINT ck_lmatch_score CHECK ((home_score IS NULL) = (away_score IS NULL)),
  UNIQUE KEY uq_lmatch_block (block_id),           -- một block giữ giờ của đúng một trận
  INDEX idx_lmatch_league (league_id),
  INDEX idx_lmatch_start (court_id, start_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Lịch sử nhập/sửa tỉ số, hoãn trận, xử thua: ai, lúc nào, từ, thành, lý do. Chỉ chủ sân thấy.
CREATE TABLE league_events (
  id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  match_id  INT UNSIGNED NOT NULL,
  kind      ENUM('score','reschedule','forfeit') NOT NULL,
  at        DATETIME NOT NULL,
  by_name   VARCHAR(100) NOT NULL,
  from_text VARCHAR(100) NULL,
  to_text   VARCHAR(100) NOT NULL,
  note      VARCHAR(500) NOT NULL DEFAULT '',
  CONSTRAINT fk_levent_match FOREIGN KEY (match_id) REFERENCES league_matches(id),
  INDEX idx_levent_match (match_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Ngân hàng báo có tiền (SePay, R17). Mỗi giao dịch tiền vào là một dòng, kể cả khoản không khớp.
-- provider_tx_id UNIQUE (id giao dịch của SePay) làm webhook gọi lại vô hại: services/bankOps.js chèn dòng này TRƯỚC, trong cùng
-- transaction với việc khóa và đổi trạng thái đơn, nên hai webhook cùng id (hoặc hai id cho cùng một đơn) tuần tự hóa.
-- owner_id/venue_id = sân nhận tiền theo số tài khoản; NULL khi không sân nào dùng tài khoản đó hoặc tài khoản dùng chung
-- nhiều chủ mà đơn không phân định được.
CREATE TABLE bank_transactions (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  provider_tx_id VARCHAR(64) NOT NULL,
  account_number VARCHAR(30) NULL,
  content        VARCHAR(300) NOT NULL DEFAULT '',
  amount         INT UNSIGNED NOT NULL,
  owner_id       INT UNSIGNED NULL,
  venue_id       INT UNSIGNED NULL,
  booking_id     INT UNSIGNED NULL,
  booking_code   VARCHAR(20) NULL,                        -- mã đọc được trong nội dung (kể cả khi không có đơn)
  expected       INT UNSIGNED NULL,                       -- số tiền cần chuyển của khoản chờ tiền tìm được
  status         ENUM('matched','unmatched','resolved') NOT NULL,
  reason         ENUM('no_code','unknown_order','wrong_account','no_account','not_approved','not_payable','short','over','multiple_codes') NULL,
  handled_by     VARCHAR(100) NULL,
  handled_at     DATETIME NULL,
  received_at    DATETIME NOT NULL,
  UNIQUE KEY uq_banktx_provider (provider_tx_id),
  CONSTRAINT fk_banktx_owner FOREIGN KEY (owner_id) REFERENCES users(id),
  CONSTRAINT fk_banktx_venue FOREIGN KEY (venue_id) REFERENCES venues(id),
  CONSTRAINT fk_banktx_booking FOREIGN KEY (booking_id) REFERENCES bookings(id),
  CONSTRAINT ck_banktx_reason CHECK ((status = 'matched') = (reason IS NULL)),
  INDEX idx_banktx_owner (owner_id, received_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Các bảng khác tham chiếu bookings/blocks/courts có sẵn: bookings.offer_id/match_id/transfer_from_booking_id và
-- blocks.league_id/league_match_id đã có cột để nối.
