import { createMiddleware } from 'hono/factory';
import type { Env, AppVariables, TelegramUser } from '../types';

const encoder = new TextEncoder();

async function hmacSha256(key: BufferSource, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export const telegramAuth = createMiddleware<{
  Bindings: Env;
  Variables: AppVariables;
}>(async (c, next) => {
  const authHeader = c.req.header('Authorization') || '';
  if (!authHeader.startsWith('tma ')) {
    return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '缺少 Telegram 鉴权头' } }, 401);
  }

  const rawInitData = authHeader.slice(4).trim();
  const params = new URLSearchParams(rawInitData);
  const hash = params.get('hash');
  const authDate = Number(params.get('auth_date') || 0);

  if (!hash || !authDate) {
    return c.json({ ok: false, error: { code: 'INVALID_INIT_DATA', message: '鉴权参数不完整' } }, 401);
  }

  // 防重放：initData 有效期 1 小时
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - authDate > 3600) {
    return c.json({ ok: false, error: { code: 'AUTH_EXPIRED', message: '登录状态已过期，请重新打开应用' } }, 401);
  }

  // 按字典序拼接待签名字符串
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = await hmacSha256(encoder.encode('WebAppData'), c.env.TELEGRAM_BOT_TOKEN);
  const calculatedHash = toHex(await hmacSha256(secretKey, dataCheckString));

  if (calculatedHash !== hash) {
    return c.json({ ok: false, error: { code: 'INVALID_SIGNATURE', message: '签名校验失败' } }, 401);
  }

  const userStr = params.get('user');
  if (!userStr) {
    return c.json({ ok: false, error: { code: 'NO_USER', message: '缺少用户信息' } }, 401);
  }

  const tgUser = JSON.parse(userStr) as TelegramUser;
  c.set('tgUser', tgUser);
  await next();
});
