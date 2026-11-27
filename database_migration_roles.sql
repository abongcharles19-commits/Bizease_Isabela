USE barangay_bungahin;

-- Run once on databases created before Admin/Resident/Staff role support.
ALTER TABLE users
  MODIFY role ENUM('admin','secretary','staff','resident') NOT NULL DEFAULT 'staff',
  ADD COLUMN resident_id BIGINT UNSIGNED NULL AFTER role,
  ADD INDEX idx_users_resident_id (resident_id);
