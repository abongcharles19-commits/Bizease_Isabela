USE barangay_bungahin;

-- Run once on existing databases to associate SMS logs with certificate requests.
ALTER TABLE sms_logs
  ADD COLUMN certificate_request_id BIGINT UNSIGNED NULL AFTER announcement_id,
  ADD CONSTRAINT fk_sms_certificate_request FOREIGN KEY (certificate_request_id)
    REFERENCES certificate_requests(id) ON DELETE SET NULL,
  ADD INDEX idx_sms_certificate_request (certificate_request_id);
