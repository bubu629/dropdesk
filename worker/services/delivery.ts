import type { Env } from '../types';
import { decryptKey, genId } from './crypto';
import { sendMessage } from './telegramApi';

const sendDeliveryWithWatermark = (token: string, chatId: number | string, text: string) =>
  sendMessage(token, chatId, `${text}\n\n⚡ Powered by @DropDesk629bot · Launch your free store / 免费创建你的自动发卡店`);

export async function executeOrderDelivery(env: Env, orderId: string): Promise<void> {
  const now = Date.now();

  const order = await env.DB.prepare(
    `SELECT o.*, m.telegram_user_id AS merchant_tg_id, m.store_name
     FROM orders o
     JOIN merchants m ON m.id = o.merchant_id
     WHERE o.id = ?1`
  )
    .bind(orderId)
    .first<any>();

  if (!order || !['PAID', 'DELIVERING', 'DELIVERY_FAILED'].includes(order.status)) {
    return;
  }

  const existingDelivery = await env.DB.prepare(`SELECT * FROM deliveries WHERE order_id = ?1`)
    .bind(orderId)
    .first<any>();

  if (existingDelivery?.status === 'SENT') {
    return;
  }

  const item = await env.DB.prepare(
    `SELECT oi.*, p.delivery_type, p.file_url, p.webhook_url
     FROM order_items oi
     JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = ?1
     LIMIT 1`
  )
    .bind(orderId)
    .first<any>();

  if (!item) return;

  await env.DB.prepare(`UPDATE orders SET status = 'DELIVERING', updated_at = ?1 WHERE id = ?2`)
    .bind(now, orderId)
    .run();

  const deliveryId = existingDelivery?.id || genId('dlv');
  if (!existingDelivery) {
    await env.DB.prepare(
      `INSERT INTO deliveries (id, order_id, delivery_type, status, retry_count, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'PENDING', 0, ?4, ?4)`
    )
      .bind(deliveryId, orderId, item.delivery_type, now)
      .run();
  }

  try {
    let messageBody = '';
    let payloadContent = '';

    if (item.delivery_type === 'KEY') {
      const { results: keys } = await env.DB.prepare(
        `SELECT key_content FROM inventory_keys WHERE locked_order_id = ?1 AND status = 'SOLD'`
      )
        .bind(orderId)
        .all<{ key_content: string }>();

      const decrypted = await Promise.all(
        keys.map((k) => decryptKey(k.key_content, env.KEY_ENCRYPTION_SECRET))
      );
      payloadContent = JSON.stringify(decrypted);
      const formattedKeys = decrypted.map((k) => `<code>${k}</code>`).join('\n');
      messageBody =
        `✅ <b>发货成功！</b>\n\n` +
        `订单号：<code>${order.order_no}</code>\n` +
        `商品：${item.title_snapshot} (${item.variant_snapshot})\n\n` +
        `🔑 <b>您的激活码/卡密：</b>\n${formattedKeys}`;
    } else if (item.delivery_type === 'FILE') {
      payloadContent = item.file_url || '';
      messageBody =
        `✅ <b>发货成功！</b>\n\n` +
        `订单号：<code>${order.order_no}</code>\n` +
        `商品：${item.title_snapshot}\n\n` +
        `📦 <b>下载链接：</b>\n${item.file_url}`;
    } else if (item.delivery_type === 'WEBHOOK' && item.webhook_url) {
      const resp = await fetch(item.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: order.id,
          order_no: order.order_no,
          buyer_telegram_id: order.buyer_telegram_id,
          product_id: item.product_id,
          variant_id: item.variant_id,
          quantity: item.quantity,
        }),
      });
      if (!resp.ok) throw new Error(`Merchant webhook HTTP ${resp.status}`);
      const text = await resp.text();
      payloadContent = text.slice(0, 2000);
      messageBody =
        `✅ <b>发货成功！</b>\n\n` +
        `订单号：<code>${order.order_no}</code>\n\n${payloadContent}`;
    }

    // 私聊发给买家
    await sendDeliveryWithWatermark(env.TELEGRAM_BOT_TOKEN, order.buyer_telegram_id, messageBody);

    const doneAt = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE deliveries SET status = 'SENT', payload_content = ?1, delivered_at = ?2, updated_at = ?2 WHERE id = ?3`
      ).bind(payloadContent, doneAt, deliveryId),
      env.DB.prepare(`UPDATE orders SET status = 'COMPLETED', updated_at = ?1 WHERE id = ?2`).bind(
        doneAt,
        orderId
      ),
    ]);

    // 通知商家成交（静默容错，不影响主流程）
    await sendDeliveryWithWatermark(
      env.TELEGRAM_BOT_TOKEN,
      order.merchant_tg_id,
      `💰 <b>新订单已完成发货</b>\n单号：<code>${order.order_no}</code>\n商品：${item.title_snapshot}\n金额：${order.total_stars} Stars`
    ).catch(() => {});
  } catch (err: any) {
    const errMsg = String(err?.message || err).slice(0, 500);
    const failAt = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE deliveries SET status = 'FAILED', retry_count = retry_count + 1, last_error = ?1, updated_at = ?2 WHERE id = ?3`
      ).bind(errMsg, failAt, deliveryId),
      env.DB.prepare(`UPDATE orders SET status = 'DELIVERY_FAILED', updated_at = ?1 WHERE id = ?2`).bind(
        failAt,
        orderId
      ),
    ]);
  }
}
