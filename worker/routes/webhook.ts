import { Hono } from 'hono';
import type { Env } from '../types';
import { genId } from '../services/crypto';
import { executeOrderDelivery } from '../services/delivery';
import { answerPreCheckoutQuery, sendMessage } from '../services/telegramApi';

const app = new Hono<{ Bindings: Env }>();

app.post('/telegram', async (c) => {
  const secret = c.req.header('X-Telegram-Bot-Api-Secret-Token');
  if (secret !== c.env.TELEGRAM_WEBHOOK_SECRET) {
    return c.text('Forbidden', 403);
  }

  const update = await c.req.json<any>();

  // 1. 处理支付前预检（必须 10 秒内响应）
  if (update.pre_checkout_query) {
    const query = update.pre_checkout_query;
    const orderId = query.invoice_payload;
    const order = await c.env.DB.prepare(`SELECT * FROM orders WHERE id = ?1`)
      .bind(orderId)
      .first<any>();

    const isValid =
      order &&
      order.status === 'PENDING_PAYMENT' &&
      Date.now() < order.expires_at &&
      order.total_stars === query.total_amount;

    await answerPreCheckoutQuery(
      c.env.TELEGRAM_BOT_TOKEN,
      query.id,
      Boolean(isValid),
      isValid ? undefined : '订单已超时或金额不匹配，请重新下单'
    );
    return c.text('OK');
  }

  // 2. 处理 Stars 支付成功回调（幂等 + 自动发货）
  if (update.message?.successful_payment) {
    const sp = update.message.successful_payment;
    const orderId = sp.invoice_payload;
    const chargeId = sp.telegram_payment_charge_id;
    const now = Date.now();

    // 幂等去重：同一个 chargeId 只处理一次
    const dedup = await c.env.DB.prepare(
      `INSERT OR IGNORE INTO webhook_events (event_id, source, event_type, payload, processed_at)
       VALUES (?1, 'TELEGRAM', 'successful_payment', ?2, ?3)`
    )
      .bind(chargeId, JSON.stringify(sp), now)
      .run();

    if (dedup.meta.changes === 0) {
      return c.text('OK');
    }

    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO payments (id, order_id, channel, currency, amount, telegram_payment_charge_id, provider_payment_charge_id, status, raw_payload, created_at, updated_at)
         VALUES (?1, ?2, 'TELEGRAM_STARS', ?3, ?4, ?5, ?6, 'SUCCEEDED', ?7, ?8, ?8)`
      ).bind(
        genId('pay'),
        orderId,
        sp.currency || 'XTR',
        sp.total_amount,
        chargeId,
        sp.provider_payment_charge_id || null,
        JSON.stringify(sp),
        now
      ),
      c.env.DB.prepare(`UPDATE orders SET status = 'PAID', updated_at = ?1 WHERE id = ?2`).bind(now, orderId),
      c.env.DB.prepare(
        `UPDATE inventory_keys SET status = 'SOLD', sold_at = ?1 WHERE locked_order_id = ?2 AND status = 'LOCKED'`
      ).bind(now, orderId),
    ]);

    // 异步触发自动发货（不阻塞 Webhook 响应）
    c.executionCtx.waitUntil(executeOrderDelivery(c.env, orderId));
    return c.text('OK');
  }

  // 3. 处理 /start 命令
  if (update.message?.text?.startsWith('/start')) {
    const chatId = update.message.chat.id;
    await sendMessage(
      c.env.TELEGRAM_BOT_TOKEN,
      chatId,
      `👋 欢迎使用 <b>DropDesk</b>！\n\n点击左下角菜单按钮即可打开商家后台或查看已购订单。`
    ).catch(() => {});
  }

  return c.text('OK');
});

export default app;
