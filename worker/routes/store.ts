import { Hono } from 'hono';
import type { Env, AppVariables } from '../types';
import { telegramAuth } from '../middleware/telegramAuth';
import { genId, genOrderNo } from '../services/crypto';
import { lockKeysForOrder } from '../services/inventory';
import { createStarsInvoiceLink } from '../services/telegramApi';

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// 公开接口：获取商品详情（买家通过分享链接打开）
app.get('/products/:id', async (c) => {
  const productId = c.req.param('id');
  const product = await c.env.DB.prepare(
    `SELECT p.*, m.store_name, m.username AS merchant_username
     FROM products p
     JOIN merchants m ON m.id = p.merchant_id
     WHERE p.id = ?1 AND p.status = 'ACTIVE'`
  )
    .bind(productId)
    .first<any>();

  if (!product) {
    return c.json({ ok: false, error: { code: 'NOT_FOUND', message: '商品不存在或已下架' } }, 404);
  }

  const { results: variants } = await c.env.DB.prepare(
    `SELECT pv.*,
       (SELECT COUNT(*) FROM inventory_keys ik WHERE ik.variant_id = pv.id AND ik.status = 'AVAILABLE') AS available_stock
     FROM product_variants pv
     WHERE pv.product_id = ?1 AND pv.is_active = 1`
  )
    .bind(productId)
    .all();

  return c.json({ ok: true, data: { ...product, variants } });
});

// 以下接口需要 Telegram 登录鉴权
app.use('/orders/*', telegramAuth);
app.use('/orders', telegramAuth);

// 买家创建订单并原子锁定库存
app.post('/orders', async (c) => {
  const tgUser = c.get('tgUser');
  const body = await c.req.json<{ variant_id: string; quantity?: number }>();
  const quantity = Math.max(1, Math.min(Math.floor(body.quantity || 1), 10));

  const variant = await c.env.DB.prepare(
    `SELECT pv.*, p.merchant_id, p.title AS product_title, p.delivery_type
     FROM product_variants pv
     JOIN products p ON p.id = pv.product_id
     WHERE pv.id = ?1 AND pv.is_active = 1 AND p.status = 'ACTIVE'`
  )
    .bind(body.variant_id)
    .first<any>();

  if (!variant) {
    return c.json({ ok: false, error: { code: 'NOT_FOUND', message: '商品规格不可用' } }, 404);
  }

  const now = Date.now();
  const expiresAt = now + 15 * 60 * 1000;
  const orderId = genId('ord');
  const orderNo = genOrderNo();
  const totalStars = variant.price_stars * quantity;

  if (variant.delivery_type === 'KEY' && variant.stock_mode === 'FINITE') {
    const locked = await lockKeysForOrder(c.env.DB, variant.id, orderId, quantity);
    if (locked.length < quantity) {
      return c.json({ ok: false, error: { code: 'OUT_OF_STOCK', message: '库存不足，请稍后再试' } }, 409);
    }
  }

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO orders (id, order_no, merchant_id, buyer_telegram_id, buyer_username, total_stars, status, expires_at, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'CREATED', ?7, ?8, ?8)`
    ).bind(orderId, orderNo, variant.merchant_id, tgUser.id, tgUser.username || null, totalStars, expiresAt, now),
    c.env.DB.prepare(
      `INSERT INTO order_items (id, order_id, product_id, variant_id, title_snapshot, variant_snapshot, unit_price_stars, quantity)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
    ).bind(genId('oit'), orderId, variant.product_id, variant.id, variant.product_title, variant.name, variant.price_stars, quantity),
  ]);

  return c.json({ ok: true, data: { order_id: orderId, order_no: orderNo, total_stars: totalStars, expires_at: expiresAt } });
});

// 生成 Telegram Stars 支付链接
app.post('/orders/:id/invoice', async (c) => {
  const tgUser = c.get('tgUser');
  const orderId = c.req.param('id');

  const order = await c.env.DB.prepare(
    `SELECT o.*, oi.title_snapshot, oi.variant_snapshot
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     WHERE o.id = ?1 AND o.buyer_telegram_id = ?2`
  )
    .bind(orderId, tgUser.id)
    .first<any>();

  if (!order || !['CREATED', 'PENDING_PAYMENT'].includes(order.status) || Date.now() > order.expires_at) {
    return c.json({ ok: false, error: { code: 'ORDER_INVALID', message: '订单已过期或不可支付' } }, 400);
  }

  const invoiceUrl = await createStarsInvoiceLink(c.env.TELEGRAM_BOT_TOKEN, {
    title: `${order.title_snapshot} - ${order.variant_snapshot}`,
    description: `订单号: ${order.order_no}`,
    payload: order.id,
    stars: order.total_stars,
  });

  await c.env.DB.prepare(`UPDATE orders SET status = 'PENDING_PAYMENT', updated_at = ?1 WHERE id = ?2`)
    .bind(Date.now(), orderId)
    .run();

  return c.json({ ok: true, data: { invoice_url: invoiceUrl } });
});

// 买家查看自己的订单列表
app.get('/orders', async (c) => {
  const tgUser = c.get('tgUser');
  const { results } = await c.env.DB.prepare(
    `SELECT o.*, oi.title_snapshot, oi.variant_snapshot, oi.quantity, d.status AS delivery_status, d.payload_content
     FROM orders o
     LEFT JOIN order_items oi ON oi.order_id = o.id
     LEFT JOIN deliveries d ON d.order_id = o.id
     WHERE o.buyer_telegram_id = ?1
     ORDER BY o.created_at DESC LIMIT 30`
  )
    .bind(tgUser.id)
    .all();

  return c.json({ ok: true, data: results });
});

export default app;
