USE barangay_bungahin;

-- Run once on existing databases before using email-based resident sign-in.
ALTER TABLE users
  ADD COLUMN email VARCHAR(254) NULL AFTER username,
  ADD UNIQUE INDEX uq_users_email (email);
