CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(30) NOT NULL,
  company_name VARCHAR(190) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  session_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_role_status (role, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS products (
  id CHAR(36) PRIMARY KEY,
  supplier_user_id CHAR(36) NULL,
  sku VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(190) NOT NULL,
  description TEXT NULL,
  supplier_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  proposed_supplier_price DECIMAL(12,2) NULL,
  platform_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  srp DECIMAL(12,2) NOT NULL DEFAULT 0,
  stock INT NOT NULL DEFAULT 0,
  reserved INT NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  created_by CHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_products_supplier FOREIGN KEY (supplier_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_products_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_products_supplier_status (supplier_user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orders (
  id CHAR(36) PRIMARY KEY,
  order_no VARCHAR(40) NOT NULL UNIQUE,
  channel VARCHAR(40) NOT NULL DEFAULT 'manual',
  external_order_id VARCHAR(100) NULL,
  dropshipper_user_id CHAR(36) NULL,
  supplier_user_id CHAR(36) NULL,
  customer_name VARCHAR(160) NOT NULL,
  customer_phone VARCHAR(60) NULL,
  shipping_address TEXT NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  payment_status VARCHAR(30) NOT NULL DEFAULT 'pending',
  fulfillment_status VARCHAR(30) NOT NULL DEFAULT 'new',
  warehouse VARCHAR(120) NULL,
  tracking_no VARCHAR(120) NULL,
  created_by CHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_orders_dropshipper FOREIGN KEY (dropshipper_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_orders_supplier FOREIGN KEY (supplier_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_orders_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_orders_drop_status (dropshipper_user_id, fulfillment_status),
  INDEX idx_orders_supplier_status (supplier_user_id, fulfillment_status),
  INDEX idx_orders_tracking (tracking_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_items (
  id CHAR(36) PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  product_id CHAR(36) NULL,
  product_name VARCHAR(190) NOT NULL,
  sku VARCHAR(80) NOT NULL,
  quantity INT NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_items_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_items_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
  INDEX idx_items_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventory_movements (
  id CHAR(36) PRIMARY KEY,
  product_id CHAR(36) NOT NULL,
  delta INT NOT NULL,
  reason VARCHAR(80) NOT NULL,
  reference_type VARCHAR(40) NULL,
  reference_id VARCHAR(100) NULL,
  balance_after INT NOT NULL,
  created_by CHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_inventory_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_inventory_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_inventory_product_date (product_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS packing_sessions (
  id CHAR(36) PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  barcode VARCHAR(160) NOT NULL,
  operator_user_id CHAR(36) NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'packing',
  evidence_status VARCHAR(30) NOT NULL DEFAULT 'pending',
  evidence_url VARCHAR(500) NULL,
  retention_until DATETIME NULL,
  notes TEXT NULL,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  CONSTRAINT fk_packing_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_packing_operator FOREIGN KEY (operator_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_packing_order_date (order_id, started_at),
  INDEX idx_packing_barcode (barcode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS integrations (
  id CHAR(36) PRIMARY KEY,
  platform VARCHAR(30) NOT NULL UNIQUE,
  status VARCHAR(30) NOT NULL DEFAULT 'not_configured',
  credentials_configured TINYINT(1) NOT NULL DEFAULT 0,
  last_sync_at DATETIME NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sync_logs (
  id CHAR(36) PRIMARY KEY,
  integration_id CHAR(36) NOT NULL,
  direction VARCHAR(30) NOT NULL,
  status VARCHAR(30) NOT NULL,
  records_processed INT NOT NULL DEFAULT 0,
  message VARCHAR(500) NULL,
  created_by CHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sync_integration FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE,
  CONSTRAINT fk_sync_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_sync_integration_date (integration_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id VARCHAR(100) NULL,
  details_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_audit_entity_date (entity_type, entity_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO integrations (id, platform, status, credentials_configured)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'shopee', 'not_configured', 0),
  ('10000000-0000-4000-8000-000000000002', 'tiktok', 'not_configured', 0),
  ('10000000-0000-4000-8000-000000000003', 'lazada', 'not_configured', 0);
