import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import merchantRoutes from './routes/merchant';
import storeRoutes from './routes/store';
import webhookRoutes from './routes/webhook';
import { releaseExpiredOrdersAndKeys } from './services/inventory';
import { executeOrderDelivery } from './services/delivery';

const app = new Hono<{ Bindings: Env }>();

app.use(
  '/api/*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
);

app.get('/api/health', (c) => c.json({ ok: true, service: 'dropdesk', time: Date.now() }));
app.route('/api/merchant', merchantRoutes);
app.route('/api/store', storeRoutes);
app.route('/api/webhooks', webhookRoutes);

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        // 1. 释放超时未支付订单和锁定卡密
        await releaseExpiredOrdersAndKeys(env.DB);

        // 2. 自动重试发货失败（重试次数 < 3）的订单
        const { results: failed } = await env.DB.prepare(
          `SELECT order_id FROM deliveries WHERE status = 'FAILED' AND retry_count < 3 LIMIT 10`
        ).all<{ order_id: string }>();

        for (const row of failed) {
          await executeOrderDelivery(env, row.order_id);
        }
      })()
    );
  },
};
