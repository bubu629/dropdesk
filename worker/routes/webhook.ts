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
    const payload: string = query.invoice_payload || '';

    // 1a. Pro 套餐订阅预检
    if (payload.startsWith('sub:')) {
      const [, merchantId, daysStr] = payload.split(':');
      const days = Number(daysStr);
      const expectedStars = days === 365 ? 2500 : days === 30 ? 250 : -1;
      const merchant = await c.env.DB.prepare(`SELECT id FROM merchants WHERE id = ?1`)
        .bind(merchantId)
        .first();
      const isValid = Boolean(merchant) && expectedStars > 0 && query.total_amount === expectedStars;

      await answerPreCheckoutQuery(
        c.env.TELEGRAM_BOT_TOKEN,
        query.id,
        isValid,
        isValid ? undefined : '订阅信息无效，请重新发起升级'
      );
      return c.text('OK');
    }

    // 1b. 普通商品订单预检
    const order = await c.env.DB.prepare(`SELECT * FROM orders WHERE id = ?1`)
      .bind(payload)
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

  // 2. 处理 Stars 支付成功回调
  if (update.message?.successful_payment) {
    const sp = update.message.successful_payment;
    const payload: string = sp.invoice_payload || '';
    const chargeId = sp.telegram_payment_charge_id;
    const now = Date.now();

    // 幂等去重
    const dedup = await c.env.DB.prepare(
      `INSERT OR IGNORE INTO webhook_events (event_id, source, event_type, payload, processed_at)
       VALUES (?1, 'TELEGRAM', 'successful_payment', ?2, ?3)`
    )
      .bind(chargeId, JSON.stringify(sp), now)
      .run();

    if (dedup.meta.changes === 0) {
      return c.text('OK');
    }

    // 2a. Pro 套餐订阅开通/续费
    if (payload.startsWith('sub:')) {
      const [, merchantId, daysStr] = payload.split(':');
      const days = Number(daysStr) || 30;
      const merchant = await c.env.DB.prepare(`SELECT * FROM merchants WHERE id = ?1`)
        .bind(merchantId)
        .first<any>();

      if (merchant) {
        const baseTime = Math.max(now, merchant.plan_expires_at || 0);
        const newExpiresAt = baseTime + days * 24 * 60 * 60 * 1000;
        await c.env.DB.prepare(
          `UPDATE merchants SET plan = 'PRO', plan_expires_at = ?1, updated_at = ?2 WHERE id = ?3`
        )
          .bind(newExpiresAt, now, merchantId)
          .run();

        const expireDateStr = new Date(newExpiresAt).toISOString().slice(0, 10);
        await sendMessage(
          c.env.TELEGRAM_BOT_TOKEN,
          merchant.telegram_user_id,
          `🎉 <b>DropDesk Pro 已开通！</b>\n\n本次增加：${days} 天\n到期日期：<code>${expireDateStr}</code>\n\n现在你可以无限制上架商品了。`
        ).catch(() => {});
      }
      return c.text('OK');
    }

    // 2b. 普通商品订单支付成功 -> 自动发货
    const orderId = payload;
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

    c.executionCtx.waitUntil(executeOrderDelivery(c.env, orderId));
    return c.text('OK');
  }

  // 3. 处理 /start 命令
  if (update.message?.text?.startsWith('/start')) {
    const chatId = update.message.chat.id;
    await sendMessage(
      c.env.TELEGRAM_BOT_TOKEN,
      chatId,
      `👋 Welcome to <b>DropDesk</b>!\nSell digital goods & license keys in Telegram with Stars — zero code, instant auto-delivery.\n\n👋 欢迎使用 <b>DropDesk</b>！\n点击左下角菜单按钮即可打开商家后台或查看已购订单。`
    ).catch(() => {});
  }

  return c.text('OK');
});

export default app;
