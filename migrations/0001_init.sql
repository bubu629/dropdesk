PRAGMA foreign_keys = ON;

CREATE TABLE merchants (
  id TEXT PRIMARY KEY,
  telegram_user_id INTEGER NOT NULL UNIQUE,
  username TEXT,
  store_name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'FREE' CHECK (plan IN ('FREE', 'PRO', 'BUSINESS')),
  plan_expires_at INTEGER,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  delivery_type TEXT NOT NULL CHECK (delivery_type IN ('KEY', 'FILE', 'WEBHOOK')),
  file_url TEXT,
  webhook_url TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_products_merchant ON products(merchant_id, status);

CREATE TABLE product_variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price_stars INTEGER NOT NULL CHECK (price_stars > 0),
  stock_mode TEXT NOT NULL DEFAULT 'FINITE' CHECK (stock_mode IN ('FINITE', 'UNLIMITED')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_variants_product ON product_variants(product_id);

CREATE TABLE inventory_keys (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  key_content TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'LOCKED', 'SOLD', 'VOID')),
  locked_order_id TEXT,
  locked_until INTEGER,
  sold_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(variant_id, key_hash)
);
CREATE INDEX idx_keys_alloc ON inventory_keys(variant_id, status, locked_until);
CREATE INDEX idx_keys_order ON inventory_keys(locked_order_id);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  order_no TEXT NOT NULL UNIQUE,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  buyer_telegram_id INTEGER NOT NULL,
  buyer_username TEXT,
  total_stars INTEGER NOT NULL CHECK (total_stars > 0),
  status TEXT NOT NULL CHECK (status IN (
    'CREATED', 'PENDING_PAYMENT', 'PAID', 'EXPIRED', 'CANCELLED',
    'DELIVERING', 'COMPLETED', 'DELIVERY_FAILED', 'REFUND_PENDING', 'REFUNDED'
  )),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_orders_merchant ON orders(merchant_id, status, created_at DESC);
CREATE INDEX idx_orders_buyer ON orders(buyer_telegram_id, created_at DESC);
CREATE INDEX idx_orders_expire ON orders(status, expires_at);

CREATE TABLE order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  variant_id TEXT NOT NULL REFERENCES product_variants(id),
  title_snapshot TEXT NOT NULL,
  variant_snapshot TEXT NOT NULL,
  unit_price_stars INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0)
);
CREATE INDEX idx_order_items_order ON order_items(order_id);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  channel TEXT NOT NULL DEFAULT 'TELEGRAM_STARS' CHECK (channel IN ('TELEGRAM_STARS', 'TON')),
  currency TEXT NOT NULL DEFAULT 'XTR',
  amount INTEGER NOT NULL,
  telegram_payment_charge_id TEXT UNIQUE,
  provider_payment_charge_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('INITIATED', 'SUCCEEDED', 'FAILED', 'REFUNDED')),
  raw_payload TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_payments_order ON payments(order_id);

CREATE TABLE deliveries (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  delivery_type TEXT NOT NULL CHECK (delivery_type IN ('KEY', 'FILE', 'WEBHOOK')),
  payload_content TEXT,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  delivered_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_deliveries_order_unique ON deliveries(order_id);

CREATE TABLE webhook_events (
  event_id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('TELEGRAM', 'MERCHANT_WEBHOOK')),
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  processed_at INTEGER NOT NULL
);
