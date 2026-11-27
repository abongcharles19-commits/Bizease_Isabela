CREATE DATABASE IF NOT EXISTS barangay_bungahin CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE barangay_bungahin;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  username VARCHAR(60) NOT NULL UNIQUE,
  email VARCHAR(254) NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin','secretary','staff','resident') NOT NULL DEFAULT 'staff',
  resident_id BIGINT UNSIGNED NULL,
  INDEX (resident_id),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS households (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  household_name VARCHAR(140) NOT NULL,
  purok VARCHAR(30) NOT NULL,
  address VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (purok)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS residents (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  resident_code VARCHAR(30) NOT NULL UNIQUE,
  household_id BIGINT UNSIGNED NULL,
  first_name VARCHAR(80) NOT NULL,
  middle_name VARCHAR(80) NULL,
  last_name VARCHAR(80) NOT NULL,
  birth_date DATE NULL,
  sex ENUM('female','male','other','unspecified') NOT NULL DEFAULT 'unspecified',
  civil_status VARCHAR(30) NULL,
  phone VARCHAR(20) NULL,
  purok VARCHAR(30) NOT NULL,
  address VARCHAR(255) NULL,
  status ENUM('active','senior','inactive') NOT NULL DEFAULT 'active',
  sms_opt_in TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_resident_household FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE SET NULL,
  INDEX (last_name, first_name), INDEX (purok), INDEX (phone)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS certificate_requests (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_code VARCHAR(30) NOT NULL UNIQUE,
  resident_id BIGINT UNSIGNED NOT NULL,
  document_type VARCHAR(80) NOT NULL,
  purpose VARCHAR(255) NOT NULL,
  status ENUM('pending','processing','ready_for_pickup','completed','rejected') NOT NULL DEFAULT 'pending',
  estimated_pickup_date DATE NULL,
  notes TEXT NULL,
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_request_resident FOREIGN KEY (resident_id) REFERENCES residents(id),
  INDEX (status, requested_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS announcements (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(160) NOT NULL,
  message VARCHAR(300) NOT NULL,
  audience ENUM('all','purok') NOT NULL DEFAULT 'all',
  audience_purok VARCHAR(30) NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_announcement_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

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

CREATE TABLE IF NOT EXISTS sms_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  announcement_id BIGINT UNSIGNED NULL,
  certificate_request_id BIGINT UNSIGNED NULL,
  resident_id BIGINT UNSIGNED NULL,
  phone VARCHAR(20) NOT NULL,
  message TEXT NOT NULL,
  status ENUM('queued','sent','failed','skipped') NOT NULL DEFAULT 'queued',
  provider_message_id VARCHAR(120) NULL,
  error_message VARCHAR(255) NULL,
  sent_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sms_announcement FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE SET NULL,
  CONSTRAINT fk_sms_certificate_request FOREIGN KEY (certificate_request_id) REFERENCES certificate_requests(id) ON DELETE SET NULL,
  CONSTRAINT fk_sms_resident FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE SET NULL,
  INDEX (status, created_at),
  INDEX (certificate_request_id)
) ENGINE=InnoDB;
