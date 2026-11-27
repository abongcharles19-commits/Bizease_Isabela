USE barangay_bungahin;

CREATE TABLE IF NOT EXISTS documents (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(160) NOT NULL,
  document_type VARCHAR(80) NOT NULL,
  description TEXT NULL,
  status ENUM('draft','implemented','archived') NOT NULL DEFAULT 'implemented',
  document_date DATE NOT NULL,
  original_file_name VARCHAR(255) NULL,
  stored_file_name VARCHAR(80) NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_document_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX (status, document_date)
) ENGINE=InnoDB;
