USE barangay_bungahin;

-- Run once on existing databases to store staff-entered estimated pickup dates.
ALTER TABLE certificate_requests
  ADD COLUMN estimated_pickup_date DATE NULL AFTER status;
