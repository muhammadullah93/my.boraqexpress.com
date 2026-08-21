UPDATE order_items oi
JOIN products p ON p.id = oi.product_id
SET oi.supplier_unit_price = p.supplier_price
WHERE oi.supplier_unit_price IS NULL;

CREATE TABLE IF NOT EXISTS shipments (
  id CHAR(36) PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  courier VARCHAR(100) NOT NULL,
  service VARCHAR(100) NULL,
  tracking_no VARCHAR(160) NOT NULL,
  label_url VARCHAR(500) NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'booked',
  shipped_at DATETIME NULL,
  delivered_at DATETIME NULL,
  created_by CHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_shipments_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_shipments_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uq_shipments_order (order_id),
  UNIQUE KEY uq_shipments_tracking (tracking_no),
  INDEX idx_shipments_status_date (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `returns` (
  id CHAR(36) PRIMARY KEY,
  return_no VARCHAR(40) NOT NULL UNIQUE,
  order_id CHAR(36) NOT NULL,
  requested_by CHAR(36) NULL,
  reason VARCHAR(500) NOT NULL,
  resolution VARCHAR(30) NOT NULL DEFAULT 'pending',
  status VARCHAR(30) NOT NULL DEFAULT 'requested',
  refund_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  notes TEXT NULL,
  reviewed_by CHAR(36) NULL,
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_returns_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_returns_requester FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_returns_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_returns_order (order_id),
  INDEX idx_returns_status_date (status, requested_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS return_items (
  id CHAR(36) PRIMARY KEY,
  return_id CHAR(36) NOT NULL,
  order_item_id CHAR(36) NOT NULL,
  quantity INT NOT NULL,
  restocked TINYINT(1) NOT NULL DEFAULT 0,
  CONSTRAINT fk_return_items_return FOREIGN KEY (return_id) REFERENCES `returns`(id) ON DELETE CASCADE,
  CONSTRAINT fk_return_items_order_item FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE,
  UNIQUE KEY uq_return_order_item (return_id, order_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wallet_accounts (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL UNIQUE,
  currency CHAR(3) NOT NULL DEFAULT 'MYR',
  pending_balance DECIMAL(14,2) NOT NULL DEFAULT 0,
  available_balance DECIMAL(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_wallet_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id CHAR(36) PRIMARY KEY,
  wallet_id CHAR(36) NOT NULL,
  type VARCHAR(40) NOT NULL,
  bucket VARCHAR(20) NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  balance_after DECIMAL(14,2) NOT NULL,
  reference_type VARCHAR(40) NULL,
  reference_id VARCHAR(100) NULL,
  description VARCHAR(255) NULL,
  created_by CHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_wallet_transactions_wallet FOREIGN KEY (wallet_id) REFERENCES wallet_accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_wallet_transactions_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uq_wallet_reference (wallet_id, type, reference_type, reference_id),
  INDEX idx_wallet_transactions_date (wallet_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payout_requests (
  id CHAR(36) PRIMARY KEY,
  wallet_id CHAR(36) NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'requested',
  payment_reference VARCHAR(160) NULL,
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME NULL,
  processed_by CHAR(36) NULL,
  CONSTRAINT fk_payout_wallet FOREIGN KEY (wallet_id) REFERENCES wallet_accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_payout_processor FOREIGN KEY (processed_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_payout_status_date (status, requested_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO wallet_accounts (id, user_id, currency)
SELECT UUID(), id, 'MYR' FROM users WHERE role IN ('supplier', 'dropshipper');
