import { Hono } from 'hono';
import type { Env, AppVariables } from '../types';
import { telegramAuth } from '../middleware/telegramAuth';
import { encryptKey, genId, sha256Hex } from '../services/crypto';
import { executeOrderDelivery } from '../services/delivery';
import { refundStarPayment } from '../services/telegramApi';

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
app.use('*', telegramAuth);

// 自动获取或初始化当前用户的商家账户
async function getOrCreateMerchant(db: D1Database, tgUser: AppVariables['tgUser']) {
  const existing = await db
    .prepare(`SELECT * FROM merchants WHERE telegram_user_id = ?1`)
    .bind(tgUser.id)
    .first<any>();
  if (existing) return existing;

  const now = Date.now();
  const id = genId('mrc');
  const storeName = tgUser.username ? `@${tgUser.username} Store` : `${tgUser.first_name} Store`;
  await db
    .prepare(
      `INSERT INTO merchants (id, telegram_user_id, username, store_name, plan, status, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 'FREE', 'ACTIVE', ?5, ?5)`
    )
    .bind(id, tgUser.id, tgUser.username || null, storeName, now)
    .run();

  return db.prepare(`SELECT * FROM merchants WHERE id = ?1`).bind(id).first<any>();
}

// 商家概览与统计
app.get('/me', async (c) => {
  const merchant = await getOrCreateMerchant(c.env.DB, c.get('tgUser'));
  const stats = await c.env.DB.prepare(
    `SELECT
       COUNT(*) AS total_orders,
       COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN total_stars ELSE 0 END), 0) AS total_stars
     FROM orders WHERE merchant_id = ?1`
  )
    .bind(merchant.id)
    .first<any>();

  return c.json({ ok: true, data: { merchant, stats } });
});

// 获取商品列表及规格、实时库存
app.get('/products', async (c) => {
  const merchant = await getOrCreateMerchant(c.env.DB, c.get('tgUser'));
  const { results: products } = await c.env.DB.prepare(
    `SELECT * FROM products WHERE merchant_id = ?1 AND status != 'ARCHIVED' ORDER BY created_at DESC`
  )
    .bind(merchant.id)
    .all<any>();

  const { results: variants } = await c.env.DB.prepare(
    `SELECT pv.*,
       (SELECT COUNT(*) FROM inventory_keys ik WHERE ik.variant_id = pv.id AND ik.status = 'AVAILABLE') AS available_stock
     FROM product_variants pv
     JOIN products p ON p.id = pv.product_id
     WHERE p.merchant_id = ?1`
  )
    .bind(merchant.id)
    .all<any>();

  const list = products.map((p) => ({
    ...p,
    variants: variants.filter((v) => v.product_id === p.id),
  }));

  return c.json({ ok: true, data: list });
});

// 创建商品与规格
app.post('/products', async (c) => {
  const merchant = await getOrCreateMerchant(c.env.DB, c.get('tgUser'));
  const body = await c.req.json<{
    title: string;
    description?: string;
    delivery_type: 'KEY' | 'FILE' | 'WEBHOOK';
    file_url?: string;
    webhook_url?: string;
    variants: Array<{ name: string; price_stars: number; stock_mode?: 'FINITE' | 'UNLIMITED' }>;
  }>();

  if (!body.title?.trim() || !body.variants?.length) {
    return c.json({ ok: false, error: { code: 'INVALID_INPUT', message: '商品名称和规格不能为空' } }, 400);
  }

  // 免费版限制最多 3 个活跃商品
  if (merchant.plan === 'FREE') {
    const countRow = await c.env.DB.prepare(
      `SELECT COUNT(*) AS cnt FROM products WHERE merchant_id = ?1 AND status = 'ACTIVE'`
    )
      .bind(merchant.id)
      .first<{ cnt: number }>();
    if ((countRow?.cnt || 0) >= 3) {
      return c.json({ ok: false, error: { code: 'PLAN_LIMIT', message: '免费版最多创建 3 个商品' } }, 403);
    }
  }

  const now = Date.now();
  const productId = genId('prd');
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO products (id, merchant_id, title, description, delivery_type, file_url, webhook_url, status, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'ACTIVE', ?8, ?8)`
    ).bind(
      productId,
      merchant.id,
      body.title.trim(),
      body.description?.trim() || '',
      body.delivery_type || 'KEY',
      body.file_url?.trim() || null,
      body.webhook_url?.trim() || null,
      now
    ),
  ];

  const createdVariants: Array<{ id: string; name: string; price_stars: number }> = [];
  for (const v of body.variants) {
    const vid = genId('var');
    const stockMode = body.delivery_type === 'KEY' ? 'FINITE' : v.stock_mode || 'UNLIMITED';
    createdVariants.push({ id: vid, name: v.name.trim(), price_stars: Math.floor(v.price_stars) });
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO product_variants (id, product_id, name, price_stars, stock_mode, is_active, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)`
      ).bind(vid, productId, v.name.trim(), Math.floor(v.price_stars), stockMode, now)
    );
  }

  await c.env.DB.batch(stmts);
  return c.json({ ok: true, data: { product_id: productId, variants: createdVariants } });
});

// 批量导入卡密（自动加密 + 去重）
app.post('/inventory/import', async (c) => {
  const merchant = await getOrCreateMerchant(c.env.DB, c.get('tgUser'));
  const body = await c.req.json<{ variant_id: string; keys: string[] }>();

  const variant = await c.env.DB.prepare(
    `SELECT pv.id FROM product_variants pv
     JOIN products p ON p.id = pv.product_id
     WHERE pv.id = ?1 AND p.merchant_id = ?2`
  )
    .bind(body.variant_id, merchant.id)
    .first();

  if (!variant) {
    return c.json({ ok: false, error: { code: 'NOT_FOUND', message: '规格不存在' } }, 404);
  }

  const cleanKeys = [...new Set((body.keys || []).map((k) => k.trim()).filter(Boolean))];
  if (!cleanKeys.length) {
    return c.json({ ok: false, error: { code: 'EMPTY_KEYS', message: '卡密列表为空' } }, 400);
  }

  const now = Date.now();
  let imported = 0;
  let duplicatesSkipped = 0;

  for (const rawKey of cleanKeys) {
    const keyHash = await sha256Hex(rawKey);
    const encrypted = await encryptKey(rawKey, c.env.KEY_ENCRYPTION_SECRET);
    const res = await c.env.DB.prepare(
      `INSERT OR IGNORE INTO inventory_keys (id, merchant_id, variant_id, key_content, key_hash, status, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'AVAILABLE', ?6)`
    )
      .bind(genId('key'), merchant.id, body.variant_id, encrypted, keyHash, now)
      .run();

    if (res.meta.changes > 0) imported++;
    else duplicatesSkipped++;
  }

  const stockRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS cnt FROM inventory_keys WHERE variant_id = ?1 AND status = 'AVAILABLE'`
  )
    .bind(body.variant_id)
    .first<{ cnt: number }>();

  return c.json({
    ok: true,
    data: { imported, duplicates_skipped: duplicatesSkipped, available_stock: stockRow?.cnt || 0 },
  });
});

// 商家查看订单列表
app.get('/orders', async (c) => {
  const merchant = await getOrCreateMerchant(c.env.DB, c.get('tgUser'));
  const status = c.req.query('status');
  const limit = Math.min(Number(c.req.query('limit') || 30), 100);

  const sql = status
    ? `SELECT o.*, oi.title_snapshot, oi.variant_snapshot, oi.quantity
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id
       WHERE o.merchant_id = ?1 AND o.status = ?2
       ORDER BY o.created_at DESC LIMIT ?3`
    : `SELECT o.*, oi.title_snapshot, oi.variant_snapshot, oi.quantity
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id
       WHERE o.merchant_id = ?1
       ORDER BY o.created_at DESC LIMIT ?2`;

  const stmt = status
    ? c.env.DB.prepare(sql).bind(merchant.id, status, limit)
    : c.env.DB.prepare(sql).bind(merchant.id, limit);

  const { results } = await stmt.all();
  return c.json({ ok: true, data: results });
});

// 手动触发/重试发货
app.post('/orders/:id/deliver', async (c) => {
  const merchant = await getOrCreateMerchant(c.env.DB, c.get('tgUser'));
  const orderId = c.req.param('id');
  const order = await c.env.DB.prepare(`SELECT id FROM orders WHERE id = ?1 AND merchant_id = ?2`)
    .bind(orderId, merchant.id)
    .first();

  if (!order) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: '订单不存在' } }, 404);

  await executeOrderDelivery(c.env, orderId);
  return c.json({ ok: true, data: { order_id: orderId, triggered: true } });
});

// 商家发起 Stars 退款
app.post('/orders/:id/refund', async (c) => {
  const merchant = await getOrCreateMerchant(c.env.DB, c.get('tgUser'));
  const orderId = c.req.param('id');

  const order = await c.env.DB.prepare(
    `SELECT o.*, p.telegram_payment_charge_id, p.id AS payment_id
     FROM orders o
     JOIN payments p ON p.order_id = o.id AND p.status = 'SUCCEEDED'
     WHERE o.id = ?1 AND o.merchant_id = ?2`
  )
    .bind(orderId, merchant.id)
    .first<any>();

  if (!order || !order.telegram_payment_charge_id) {
    return c.json({ ok: false, error: { code: 'CANNOT_REFUND', message: '未找到可退款的 Stars 支付记录' } }, 400);
  }

  const now = Date.now();
  await c.env.DB.prepare(`UPDATE orders SET status = 'REFUND_PENDING', updated_at = ?1 WHERE id = ?2`)
    .bind(now, orderId)
    .run();

  await refundStarPayment(c.env.TELEGRAM_BOT_TOKEN, order.buyer_telegram_id, order.telegram_payment_charge_id);

  const doneAt = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE orders SET status = 'REFUNDED', updated_at = ?1 WHERE id = ?2`).bind(doneAt, orderId),
    c.env.DB.prepare(`UPDATE payments SET status = 'REFUNDED', updated_at = ?1 WHERE id = ?2`).bind(
      doneAt,
      order.payment_id
    ),
  ]);

  return c.json({ ok: true, data: { order_id: orderId, status: 'REFUNDED' } });
});

export default app;
