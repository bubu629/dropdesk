async function tgRequest<T = any>(token: string, method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!data.ok) {
    throw new Error(`Telegram API ${method} failed:${data.description || res.status}`);
  }
  return data.result as T;
}

export function createStarsInvoiceLink(
  token: string,
  params: { title: string; description: string; payload: string; stars: number }
): Promise<string> {
  return tgRequest<string>(token, 'createInvoiceLink', {
    title: params.title.slice(0, 32),
    description: (params.description || params.title).slice(0, 255),
    payload: params.payload,
    provider_token: '',
    currency: 'XTR',
    prices: [{ label: params.title.slice(0, 32), amount: params.stars }],
  });
}

export function answerPreCheckoutQuery(
  token: string,
  preCheckoutQueryId: string,
  ok: boolean,
  errorMessage?: string
) {
  return tgRequest(token, 'answerPreCheckoutQuery', {
    pre_checkout_query_id: preCheckoutQueryId,
    ok,
    ...(ok ? {} : { error_message: errorMessage || '订单已过期或库存不足' }),
  });
}

export function sendMessage(token: string, chatId: number, text: string) {
  return tgRequest(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });
}

export function refundStarPayment(token: string, userId: number, telegramPaymentChargeId: string) {
  return tgRequest(token, 'refundStarPayment', {
    user_id: userId,
    telegram_payment_charge_id: telegramPaymentChargeId,
  });
}
