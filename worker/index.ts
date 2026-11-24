const LANDING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>DropDesk — Automated Digital Storefront on Telegram & TON</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 680px; margin: 48px auto; padding: 0 20px; color: #1e293b; line-height: 1.6; }
    h1 { font-size: 2rem; margin-bottom: 8px; }
    .badge { display: inline-block; background: #eff6ff; color: #2563eb; padding: 4px 12px; border-radius: 999px; font-size: 0.85rem; font-weight: 600; margin-bottom: 16px; }
    .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 20px; margin: 24px 0; }
    a.btn { display: inline-block; background: #2563eb; color: #fff; text-decoration: none; padding: 12px 22px; border-radius: 10px; font-weight: 600; }
    footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 0.85rem; color: #64748b; }
  </style>
</head>
<body>
  <div class="badge">Built for Telegram & TON Ecosystem</div>
  <h1>DropDesk</h1>
  <p>DropDesk is an automated digital storefront and license-key delivery Mini App built for Telegram and the <strong>TON blockchain</strong> ecosystem.</p>
  <div class="card">
    <h2>How DropDesk Uses TON</h2>
    <p>DropDesk enables merchants and creators to sell digital goods, software licenses, and files directly inside Telegram using Telegram Stars, which merchants settle and withdraw as <strong>TON</strong> via Fragment on the <strong>TON blockchain</strong>. We are also expanding native <strong>TON</strong> and TON Connect payment workflows for zero-friction Web3 commerce.</p>
  </div>
  <ul>
    <li>Instant auto-delivery for license keys, download links, and webhooks</li>
    <li>Multi-variant pricing and built-in order management</li>
    <li>Bilingual (EN/ZH) Telegram Mini App interface</li>
  </ul>
  <p><a class="btn" href="https://t.me/DropDesk629bot">Open DropDesk in Telegram</a></p>
  <footer>
    <a href="https://ton.app/app/dropdesk" target="_blank" rel="noopener">Find us on Ton.app</a>
  </footer>
</body>
</html>`;

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import merchantRoutes from './routes/merchant';
import storeRoutes from './routes/store';
import webhookRoutes from './routes/webhook';
import { releaseExpiredOrdersAndKeys } from './services/inventory';
import { executeOrderDelivery } from './services/delivery';

const app = new Hono<{ Bindings: Env }>();
app.get('/', (c) => c.html(LANDING_HTML));

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
