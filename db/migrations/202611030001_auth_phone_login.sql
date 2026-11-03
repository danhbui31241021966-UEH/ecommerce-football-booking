-- Backfill for existing installs. Select the target database first; safe to execute repeatedly.
-- Verify there are no duplicate phone values before applying the unique index:
-- SELECT phone, COUNT(*) FROM users GROUP BY phone HAVING COUNT(*) > 1;

SET @ggo_email_nullable = (
  SELECT is_nullable
    FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'email'
);
SET @ggo_sql = IF(@ggo_email_nullable = 'NO', 'ALTER TABLE users MODIFY email VARCHAR(191) NULL', 'SELECT 1');
PREPARE ggo_stmt FROM @ggo_sql;
EXECUTE ggo_stmt;
DEALLOCATE PREPARE ggo_stmt;

SET @ggo_phone_index = (
  SELECT COUNT(*)
    FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'users' AND index_name = 'uq_user_phone'
);
SET @ggo_sql = IF(@ggo_phone_index = 0, 'ALTER TABLE users ADD UNIQUE KEY uq_user_phone (phone)', 'SELECT 1');
PREPARE ggo_stmt FROM @ggo_sql;
EXECUTE ggo_stmt;
DEALLOCATE PREPARE ggo_stmt;
