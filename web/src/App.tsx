import { useEffect, useState } from 'react';
import { apiRequest, getTgWebApp } from './lib/api';

type Tab = 'merchant' | 'orders' | 'buyer_orders';

export default function App() {
  const [startProductId, setStartProductId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('merchant');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [me, setMe] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [merchantOrders, setMerchantOrders] = useState<any[]>([]);
  const [buyerOrders, setBuyerOrders] = useState<any[]>([]);
  const [checkoutProduct, setCheckoutProduct] = useState<any>(null);
  const [selectedVariant, setSelectedVariant] = useState<string>('');

  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [deliveryType, setDeliveryType] = useState<'KEY' | 'FILE' | 'WEBHOOK'>('KEY');
  const [fileUrl, setFileUrl] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [variantName, setVariantName] = useState('标准版');
  const [priceStars, setPriceStars] = useState('10');

  const [importVariantId, setImportVariantId] = useState<string | null>(null);
  const [keysText, setKeysText] = useState('');
  const [botUsername, setBotUsername] = useState('');

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    const tg = getTgWebApp();
    tg?.ready();
    tg?.expand();

    const startParam =
      tg?.initDataUnsafe?.start_param ||
      new URLSearchParams(window.location.search).get('startapp') ||
      '';

    if (startParam.startsWith('p_')) {
      const pid = startParam.slice(2);
      setStartProductId(pid);
      loadCheckoutProduct(pid);
    } else {
      loadMerchantData();
    }
  }, []);

  async function loadCheckoutProduct(pid: string) {
    setLoading(true);
    try {
      const data = await apiRequest(`/api/store/products/${pid}`);
      setCheckoutProduct(data);
      if (data.variants?.length) setSelectedVariant(data.variants[0].id);
    } catch (e: any) {
      notify(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadMerchantData() {
    setLoading(true);
    try {
      const [meData, prodData, ordData] = await Promise.all([
        apiRequest('/api/merchant/me'),
        apiRequest('/api/merchant/products'),
        apiRequest('/api/merchant/orders'),
      ]);
      setMe(meData);
      setProducts(prodData);
      setMerchantOrders(ordData);
    } catch (e: any) {
      notify(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadBuyerOrders() {
    setLoading(true);
    try {
      const data = await apiRequest('/api/store/orders');
      setBuyerOrders(data);
    } catch (e: any) {
      notify(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateProduct() {
    if (!title.trim()) return notify('请输入商品名称');
    try {
      await apiRequest('/api/merchant/products', {
        method: 'POST',
        body: JSON.stringify({
          title,
          description: desc,
          delivery_type: deliveryType,
          file_url: deliveryType === 'FILE' ? fileUrl : undefined,
          webhook_url: deliveryType === 'WEBHOOK' ? webhookUrl : undefined,
          variants: [{ name: variantName || '默认', price_stars: Number(priceStars) || 1 }],
        }),
      });
      setShowCreate(false);
      setTitle('');
      setDesc('');
      notify('商品创建成功');
      loadMerchantData();
    } catch (e: any) {
      notify(e.message);
    }
  }

  async function handleImportKeys() {
    if (!importVariantId) return;
    const keys = keysText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!keys.length) return notify('请至少输入一条卡密');
    try {
      const res = await apiRequest('/api/merchant/inventory/import', {
        method: 'POST',
        body: JSON.stringify({ variant_id: importVariantId, keys }),
      });
      notify(`成功导入 ${res.imported} 条，跳过重复 ${res.duplicates_skipped} 条`);
      setImportVariantId(null);
      setKeysText('');
      loadMerchantData();
    } catch (e: any) {
      notify(e.message);
    }
  }

  async function handleBuy() {
    if (!selectedVariant) return;
    try {
      const order = await apiRequest('/api/store/orders', {
        method: 'POST',
        body: JSON.stringify({ variant_id: selectedVariant, quantity: 1 }),
      });
      const inv = await apiRequest(`/api/store/orders/${order.order_id}/invoice`, {
        method: 'POST',
      });
      const tg = getTgWebApp();
      if (tg?.openInvoice) {
        tg.openInvoice(inv.invoice_url, (status) => {
          if (status === 'paid') {
            notify('支付成功！系统正在自动发货，请查看 Bot 私聊消息');
            setStartProductId(null);
            setTab('buyer_orders');
            loadBuyerOrders();
          }
        });
      } else {
        window.open(inv.invoice_url, '_blank');
      }
    } catch (e: any) {
      notify(e.message);
    }
  }

  async function handleRetryDeliver(orderId: string) {
    try {
      await apiRequest(`/api/merchant/orders/${orderId}/deliver`, { method: 'POST' });
      notify('已重新触发发货');
      loadMerchantData();
    } catch (e: any) {
      notify(e.message);
    }
  }

  async function handleRefund(orderId: string) {
    if (!window.confirm('确认退还买家的 Telegram Stars 吗？')) return;
    try {
      await apiRequest(`/api/merchant/orders/${orderId}/refund`, { method: 'POST' });
      notify('退款成功');
      loadMerchantData();
    } catch (e: any) {
      notify(e.message);
    }
  }

  function copyShareLink(productId: string) {
    const bot = botUsername.trim().replace(/^@/, '') || '你的Bot用户名';
    const url = `https://t.me/${bot}?startapp=p_${productId}`;
    navigator.clipboard?.writeText(url);
    notify(`已复制链接：${url}`);
  }

  if (startProductId) {
    return (
      <div className="min-h-screen p-4 max-w-md mx-auto">
        {toast && <div className="fixed top-4 left-4 right-4 bg-slate-900 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg z-50">{toast}</div>}
        <button onClick={() => { setStartProductId(null); loadMerchantData(); }} className="text-xs text-slate-500 mb-3">
          ← 返回 DropDesk
        </button>
        {loading || !checkoutProduct ? (
          <div className="text-center py-20 text-slate-400">加载商品中...</div>
        ) : (
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
            <div className="text-xs text-blue-600 font-medium mb-1">{checkoutProduct.store_name}</div>
            <h1 className="text-xl font-bold mb-2">{checkoutProduct.title}</h1>
            <p className="text-sm text-slate-600 mb-4 whitespace-pre-wrap">{checkoutProduct.description || '付款后由 Bot 自动交付'}</p>

            <div className="space-y-2 mb-5">
              {checkoutProduct.variants?.map((v: any) => (
                <button
                  key={v.id}
                  onClick={() => setSelectedVariant(v.id)}
                  className={`w-full flex justify-between items-center p-3 rounded-xl border text-left ${
                    selectedVariant === v.id ? 'border-blue-600 bg-blue-50' : 'border-slate-200'
                  }`}
                >
                  <div>
                    <div className="font-medium text-sm">{v.name}</div>
                    <div className="text-xs text-slate-500">
                      {checkoutProduct.delivery_type === 'KEY' ? `剩余库存: ${v.available_stock}` : '自动发货'}
                    </div>
                  </div>
                  <div className="font-bold text-blue-600">⭐ {v.price_stars}</div>
                </button>
              ))}
            </div>

            <button
              onClick={handleBuy}
              className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl active:scale-95 transition"
            >
              使用 Telegram Stars 立即购买
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20 max-w-md mx-auto p-4">
      {toast && <div className="fixed top-4 left-4 right-4 bg-slate-900 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg z-50">{toast}</div>}

      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-bold">DropDesk</h1>
          <p className="text-xs text-slate-500">{me?.merchant?.store_name || 'Telegram 自动发卡与收银台'}</p>
        </div>
        <span className="text-xs px-2.5 py-1 bg-blue-100 text-blue-700 rounded-full font-medium">
          {me?.merchant?.plan || 'FREE'}
        </span>
      </div>

      {tab === 'merchant' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
              <div className="text-xs text-slate-500">累计收入 (Stars)</div>
              <div className="text-2xl font-bold mt-1">⭐ {me?.stats?.total_stars || 0}</div>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
              <div className="text-xs text-slate-500">总订单数</div>
              <div className="text-2xl font-bold mt-1">{me?.stats?.total_orders || 0}</div>
            </div>
          </div>

          <div className="bg-white p-3 rounded-xl border border-slate-100 flex items-center gap-2">
            <span className="text-xs text-slate-500 shrink-0">我的 Bot:</span>
            <input
              value={botUsername}
              onChange={(e) => setBotUsername(e.target.value)}
              placeholder="输入你的 Bot 用户名用于生成分享链接"
              className="text-xs w-full outline-none"
            />
          </div>

          <div className="flex justify-between items-center">
            <h2 className="font-semibold text-sm">商品管理 ({products.length})</h2>
            <button onClick={() => setShowCreate(!showCreate)} className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg">
              {showCreate ? '取消' : '+ 新建商品'}
            </button>
          </div>

          {showCreate && (
            <div className="bg-white p-4 rounded-2xl border border-slate-200 space-y-3">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="商品名称（如：Pro 月卡激活码）" className="w-full border rounded-lg px-3 py-2 text-sm" />
              <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="商品描述" className="w-full border rounded-lg px-3 py-2 text-sm" rows={2} />
              <div className="grid grid-cols-3 gap-2">
                {(['KEY', 'FILE', 'WEBHOOK'] as const).map((t) => (
                  <button key={t} onClick={() => setDeliveryType(t)} className={`py-1.5 text-xs rounded-lg border ${deliveryType === t ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-200'}`}>
                    {t === 'KEY' ? '自动发卡' : t === 'FILE' ? '文件链接' : 'Webhook'}
                  </button>
                ))}
              </div>
              {deliveryType === 'FILE' && (
                <input value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} placeholder="下载链接 URL" className="w-full border rounded-lg px-3 py-2 text-sm" />
              )}
              {deliveryType === 'WEBHOOK' && (
                <input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="发货回调 Webhook URL" className="w-full border rounded-lg px-3 py-2 text-sm" />
              )}
              <div className="grid grid-cols-2 gap-2">
                <input value={variantName} onChange={(e) => setVariantName(e.target.value)} placeholder="规格名" className="border rounded-lg px-3 py-2 text-sm" />
                <input type="number" value={priceStars} onChange={(e) => setPriceStars(e.target.value)} placeholder="价格(Stars)" className="border rounded-lg px-3 py-2 text-sm" />
              </div>
              <button onClick={handleCreateProduct} className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium">
                确认创建
              </button>
            </div>
          )}

          {loading ? (
            <div className="text-center py-8 text-xs text-slate-400">加载中...</div>
          ) : (
            <div className="space-y-3">
              {products.map((p) => (
                <div key={p.id} className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <div className="font-semibold text-sm">{p.title}</div>
                      <div className="text-xs text-slate-400">类型: {p.delivery_type}</div>
                    </div>
                    <button onClick={() => copyShareLink(p.id)} className="text-xs text-blue-600 bg-blue-50 px-2.5 py-1 rounded-lg">
                      复制购买链接
                    </button>
                  </div>
                  {p.variants?.map((v: any) => (
                    <div key={v.id} className="flex justify-between items-center text-xs bg-slate-50 p-2.5 rounded-xl mt-2">
                      <span>{v.name} · ⭐ {v.price_stars}</span>
                      <div className="flex items-center gap-2">
                        {p.delivery_type === 'KEY' && (
                          <>
                            <span className="text-slate-500">库存 {v.available_stock}</span>
                            <button onClick={() => setImportVariantId(v.id)} className="text-blue-600 font-medium">
                              导入卡密
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {importVariantId && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-2xl p-4 w-full max-w-sm space-y-3">
                <div className="font-semibold text-sm">批量导入卡密（每行一条）</div>
                <textarea value={keysText} onChange={(e) => setKeysText(e.target.value)} rows={6} placeholder="KEY-001
KEY-002" className="w-full border rounded-xl p-3 text-xs font-mono" />
                <div className="flex gap-2">
                  <button onClick={() => setImportVariantId(null)} className="flex-1 py-2 border rounded-xl text-xs">取消</button>
                  <button onClick={handleImportKeys} className="flex-1 py-2 bg-blue-600 text-white rounded-xl text-xs font-medium">确认导入</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'orders' && (
        <div className="space-y-3">
          <h2 className="font-semibold text-sm">商家订单 ({merchantOrders.length})</h2>
          {merchantOrders.map((o) => (
            <div key={o.id} className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm text-xs space-y-1.5">
              <div className="flex justify-between font-medium">
                <span>{o.order_no}</span>
                <span className="text-blue-600">{o.status}</span>
              </div>
              <div className="text-slate-600">{o.title_snapshot} ({o.variant_snapshot}) · ⭐ {o.total_stars}</div>
              <div className="flex gap-2 pt-2">
                {o.status === 'DELIVERY_FAILED' && (
                  <button onClick={() => handleRetryDeliver(o.id)} className="px-3 py-1 bg-amber-100 text-amber-800 rounded-lg">重试发货</button>
                )}
                {['COMPLETED', 'DELIVERY_FAILED'].includes(o.status) && (
                  <button onClick={() => handleRefund(o.id)} className="px-3 py-1 bg-red-50 text-red-600 rounded-lg">退款</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'buyer_orders' && (
        <div className="space-y-3">
          <h2 className="font-semibold text-sm">我购买的订单 ({buyerOrders.length})</h2>
          {buyerOrders.map((o) => (
            <div key={o.id} className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm text-xs space-y-1.5">
              <div className="flex justify-between font-medium">
                <span>{o.order_no}</span>
                <span className="text-green-600">{o.status}</span>
              </div>
              <div className="text-slate-600">{o.title_snapshot} · ⭐ {o.total_stars}</div>
              {o.payload_content && (
                <div className="bg-slate-50 p-2.5 rounded-lg font-mono text-xs break-all select-all">
                  {o.payload_content}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex justify-around py-2.5 text-xs">
        <button onClick={() => { setTab('merchant'); loadMerchantData(); }} className={tab === 'merchant' ? 'text-blue-600 font-semibold' : 'text-slate-500'}>商家后台</button>
        <button onClick={() => { setTab('orders'); loadMerchantData(); }} className={tab === 'orders' ? 'text-blue-600 font-semibold' : 'text-slate-500'}>商家订单</button>
        <button onClick={() => { setTab('buyer_orders'); loadBuyerOrders(); }} className={tab === 'buyer_orders' ? 'text-blue-600 font-semibold' : 'text-slate-500'}>我的购买</button>
      </div>
    </div>
  );
}
