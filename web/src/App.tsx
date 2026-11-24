import { useEffect, useState } from 'react';
import { apiRequest, getTgWebApp } from './lib/api';

type Tab = 'merchant' | 'orders' | 'buyer_orders';
const DEFAULT_BOT_USERNAME = 'DropDesk629bot';

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

  // 店铺设置
  const [showSettings, setShowSettings] = useState(false);
  const [storeNameInput, setStoreNameInput] = useState('');
  const [deliveryTplInput, setDeliveryTplInput] = useState('');

  // 新建商品（支持多规格）
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [deliveryType, setDeliveryType] = useState<'KEY' | 'FILE' | 'WEBHOOK'>('KEY');
  const [fileUrl, setFileUrl] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [newVariants, setNewVariants] = useState<Array<{ name: string; price_stars: string }>>([
    { name: '标准版', price_stars: '10' },
  ]);

  // 编辑商品
  const [editingProduct, setEditingProduct] = useState<any>(null);

  // 追加规格
  const [addVarProductId, setAddVarProductId] = useState<string | null>(null);
  const [addVarName, setAddVarName] = useState('');
  const [addVarPrice, setAddVarPrice] = useState('10');

  // 导入卡密
  const [importVariantId, setImportVariantId] = useState<string | null>(null);
  const [keysText, setKeysText] = useState('');
  const [showUpgrade, setShowUpgrade] = useState(false);

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
      setStoreNameInput(meData?.merchant?.store_name || '');
      setDeliveryTplInput(meData?.merchant?.delivery_template || '');
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

  async function handleSaveSettings() {
    try {
      await apiRequest('/api/merchant/me', {
        method: 'PUT',
        body: JSON.stringify({
          store_name: storeNameInput,
          delivery_template: deliveryTplInput,
        }),
      });
      setShowSettings(false);
      notify('店铺设置已保存');
      loadMerchantData();
    } catch (e: any) {
      notify(e.message);
    }
  }

  async function handleCreateProduct() {
    if (!title.trim()) return notify('请输入商品名称');
    const validVariants = newVariants
      .filter((v) => v.name.trim())
      .map((v) => ({ name: v.name.trim(), price_stars: Math.max(1, Number(v.price_stars) || 1) }));
    if (!validVariants.length) return notify('请至少填写一个规格');

    try {
      await apiRequest('/api/merchant/products', {
        method: 'POST',
        body: JSON.stringify({
          title,
          description: desc,
          delivery_type: deliveryType,
          file_url: deliveryType === 'FILE' ? fileUrl : undefined,
          webhook_url: deliveryType === 'WEBHOOK' ? webhookUrl : undefined,
          variants: validVariants,
        }),
      });
      setShowCreate(false);
      setTitle('');
      setDesc('');
      setFileUrl('');
      setWebhookUrl('');
      setNewVariants([{ name: '标准版', price_stars: '10' }]);
      notify('商品创建成功');
      loadMerchantData();
    } catch (e: any) {
      notify(e.message);
    }
  }

  async function handleSaveEditProduct() {
    if (!editingProduct) return;
    try {
      await apiRequest(`/api/merchant/products/${editingProduct.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: editingProduct.title,
          description: editingProduct.description,
          file_url: editingProduct.file_url,
          webhook_url: editingProduct.webhook_url,
          status: editingProduct.status,
        }),
      });
      setEditingProduct(null);
      notify('商品已更新');
      loadMerchantData();
    } catch (e: any) {
      notify(e.message);
    }
  }

  async function handleToggleStatus(product: any) {
    const nextStatus = product.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      await apiRequest(`/api/merchant/products/${product.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: nextStatus }),
      });
      notify(nextStatus === 'ACTIVE' ? '商品已上架' : '商品已下架');
      loadMerchantData();
    } catch (e: any) {
      notify(e.message);
    }
  }

  async function handleDeleteProduct(productId: string) {
    if (!window.confirm('确认删除该商品吗？删除后买家将无法继续购买。')) return;
    try {
      await apiRequest(`/api/merchant/products/${productId}`, { method: 'DELETE' });
      notify('商品已删除');
      loadMerchantData();
    } catch (e: any) {
      notify(e.message);
    }
  }

  async function handleAddVariant() {
    if (!addVarProductId || !addVarName.trim()) return notify('请输入规格名称');
    try {
      await apiRequest(`/api/merchant/products/${addVarProductId}/variants`, {
        method: 'POST',
        body: JSON.stringify({
          name: addVarName.trim(),
          price_stars: Math.max(1, Number(addVarPrice) || 1),
        }),
      });
      setAddVarProductId(null);
      setAddVarName('');
      setAddVarPrice('10');
      notify('规格已添加');
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

  
  async function handleUpgrade(cycle: 'MONTHLY' | 'YEARLY') {
    try {
      const res = await apiRequest('/api/merchant/upgrade/invoice', {
        method: 'POST',
        body: JSON.stringify({ cycle }),
      });
      const tg = getTgWebApp();
      if (tg?.openInvoice) {
        tg.openInvoice(res.invoice_url, (status) => {
          if (status === 'paid') {
            setShowUpgrade(false);
            notify('支付成功！Pro 套餐已自动生效');
            setTimeout(() => loadMerchantData(), 1500);
          }
        });
      } else {
        window.open(res.invoice_url, '_blank');
      }
    } catch (e: any) {
      notify(e.message);
    }
  }

  function copyShareLink(productId: string) {
    const url = `https://t.me/${DEFAULT_BOT_USERNAME}?startapp=p_${productId}`;
    navigator.clipboard?.writeText(url);
    notify(`已复制购买链接`);
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
            <div className="mt-4 pt-3 border-t border-slate-100 text-center">
              <a
                href={`https://t.me/${DEFAULT_BOT_USERNAME}`}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-slate-400 hover:text-blue-600"
              >
                ⚡ Powered by DropDesk · Free Auto-Delivery Store / 免费开店
              </a>
            </div>
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
        <div className="flex items-center gap-2">
          <button onClick={() => setShowSettings(true)} className="text-xs px-2.5 py-1 bg-slate-100 text-slate-700 rounded-full">
            店铺设置
          </button>
          <button
            onClick={() => setShowUpgrade(true)}
            className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded-full font-medium"
          >
            {me?.merchant?.plan === 'PRO' ? 'PRO 会员' : '升级 Pro'}
          </button>
        </div>
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

          <div className="flex justify-between items-center">
            <h2 className="font-semibold text-sm">商品管理 ({products.length})</h2>
            <button onClick={() => setShowCreate(!showCreate)} className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg">
              {showCreate ? '取消' : '+ 新建商品'}
            </button>
          </div>

          {showCreate && (
            <div className="bg-white p-4 rounded-2xl border border-slate-200 space-y-3">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="商品名称（如：Pro 会员激活码）" className="w-full border rounded-lg px-3 py-2 text-sm" />
              <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="商品描述" className="w-full border rounded-lg px-3 py-2 text-sm" rows={2} />
              <div className="grid grid-cols-3 gap-2">
                {(['KEY', 'FILE', 'WEBHOOK'] as const).map((t) => (
                  <button key={t} onClick={() => setDeliveryType(t)} className={`py-1.5 text-xs rounded-lg border ${deliveryType === t ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-200'}`}>
                    {t === 'KEY' ? '自动发卡' : t === 'FILE' ? '文件链接' : 'Webhook'}
                  </button>
                ))}
              </div>
              <div className="text-[11px] text-slate-400">
                {deliveryType === 'KEY' && '自动发卡：提前导入激活码/卡密，买家付款后自动发一条'}
                {deliveryType === 'FILE' && '文件链接：填网盘/直链，买家付款后自动发送下载链接'}
                {deliveryType === 'WEBHOOK' && 'Webhook（开发者用）：付款后自动回调你的服务器 API 发货'}
              </div>
              {deliveryType === 'FILE' && (
                <input value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} placeholder="下载链接 URL" className="w-full border rounded-lg px-3 py-2 text-sm" />
              )}
              {deliveryType === 'WEBHOOK' && (
                <input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="发货回调 Webhook URL" className="w-full border rounded-lg px-3 py-2 text-sm" />
              )}

              <div className="space-y-2">
                <div className="flex justify-between items-center text-xs text-slate-500">
                  <span>商品规格与价格 (Stars)</span>
                  <button
                    onClick={() => setNewVariants([...newVariants, { name: '', price_stars: '10' }])}
                    className="text-blue-600 font-medium"
                  >
                    + 添加一档规格
                  </button>
                </div>
                {newVariants.map((v, idx) => (
                  <div key={idx} className="flex gap-2">
                    <input
                      value={v.name}
                      onChange={(e) => {
                        const copy = [...newVariants];
                        copy[idx].name = e.target.value;
                        setNewVariants(copy);
                      }}
                      placeholder="规格名（如：月卡）"
                      className="flex-1 border rounded-lg px-3 py-2 text-sm"
                    />
                    <div className="flex items-center border rounded-lg px-2.5 bg-slate-50 w-32">
                      <span className="text-xs text-slate-500 whitespace-nowrap mr-1">价格 ⭐</span>
                      <input
                        type="number"
                        value={v.price_stars}
                        onChange={(e) => {
                          const copy = [...newVariants];
                          copy[idx].price_stars = e.target.value;
                          setNewVariants(copy);
                        }}
                        placeholder="10"
                        className="w-full py-2 text-sm bg-transparent outline-none"
                      />
                    </div>
                    {newVariants.length > 1 && (
                      <button
                        onClick={() => setNewVariants(newVariants.filter((_, i) => i !== idx))}
                        className="px-2 text-red-500 text-xs"
                      >
                        删
                      </button>
                    )}
                  </div>
                ))}
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
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{p.title}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${p.status === 'ACTIVE' ? 'bg-green-50 text-green-600' : 'bg-slate-100 text-slate-500'}`}>
                          {p.status === 'ACTIVE' ? '上架中' : '已下架'}
                        </span>
                      </div>
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

                  <div className="flex items-center gap-3 mt-3 pt-2.5 border-t border-slate-100 text-xs">
                    <button onClick={() => setAddVarProductId(p.id)} className="text-blue-600">+ 加规格</button>
                    <button onClick={() => setEditingProduct({ ...p })} className="text-slate-600">编辑</button>
                    <button onClick={() => handleToggleStatus(p)} className="text-amber-600">
                      {p.status === 'ACTIVE' ? '下架' : '上架'}
                    </button>
                    <button onClick={() => handleDeleteProduct(p.id)} className="text-red-500 ml-auto">删除</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {showUpgrade && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-4">
                <div>
                  <div className="font-bold text-base">DropDesk Pro 套餐</div>
                  <div className="text-xs text-slate-500 mt-1">
                    {me?.merchant?.plan === 'PRO' && me?.merchant?.plan_expires_at
                      ? `当前有效期至：${new Date(me.merchant.plan_expires_at).toISOString().slice(0, 10)}`
                      : '解锁无限商品上架与高级商家权益'}
                  </div>
                </div>
                <div className="space-y-2.5">
                  <button
                    onClick={() => handleUpgrade('MONTHLY')}
                    className="w-full flex justify-between items-center p-3.5 rounded-xl border border-blue-200 bg-blue-50/50 active:scale-95 transition"
                  >
                    <div className="text-left">
                      <div className="font-semibold text-sm">Pro 月卡（30天）</div>
                      <div className="text-xs text-slate-500">按月灵活订阅，续费自动顺延</div>
                    </div>
                    <div className="font-bold text-blue-600">⭐ 250</div>
                  </button>
                  <button
                    onClick={() => handleUpgrade('YEARLY')}
                    className="w-full flex justify-between items-center p-3.5 rounded-xl border border-amber-300 bg-amber-50/60 active:scale-95 transition"
                  >
                    <div className="text-left">
                      <div className="font-semibold text-sm">Pro 年卡（365天）</div>
                      <div className="text-xs text-amber-700">立省 2 个月费用</div>
                    </div>
                    <div className="font-bold text-amber-600">⭐ 2500</div>
                  </button>
                </div>
                <button
                  onClick={() => setShowUpgrade(false)}
                  className="w-full py-2 border rounded-xl text-xs text-slate-600"
                >
                  关闭
                </button>
              </div>
            </div>
          )}

          {showSettings && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-2xl p-4 w-full max-w-sm space-y-3">
                <div className="font-semibold text-sm">店铺设置</div>
                <input value={storeNameInput} onChange={(e) => setStoreNameInput(e.target.value)} placeholder="店铺名称" className="w-full border rounded-xl px-3 py-2 text-sm" />
                <textarea value={deliveryTplInput} onChange={(e) => setDeliveryTplInput(e.target.value)} rows={3} placeholder="自定义发货附言（可选，如售后联系方式）" className="w-full border rounded-xl p-3 text-xs" />
                <div className="flex gap-2">
                  <button onClick={() => setShowSettings(false)} className="flex-1 py-2 border rounded-xl text-xs">取消</button>
                  <button onClick={handleSaveSettings} className="flex-1 py-2 bg-blue-600 text-white rounded-xl text-xs font-medium">保存</button>
                </div>
              </div>
            </div>
          )}

          {editingProduct && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-2xl p-4 w-full max-w-sm space-y-3">
                <div className="font-semibold text-sm">编辑商品</div>
                <input value={editingProduct.title} onChange={(e) => setEditingProduct({ ...editingProduct, title: e.target.value })} className="w-full border rounded-xl px-3 py-2 text-sm" />
                <textarea value={editingProduct.description || ''} onChange={(e) => setEditingProduct({ ...editingProduct, description: e.target.value })} rows={3} className="w-full border rounded-xl p-3 text-xs" />
                {editingProduct.delivery_type === 'FILE' && (
                  <input value={editingProduct.file_url || ''} onChange={(e) => setEditingProduct({ ...editingProduct, file_url: e.target.value })} placeholder="文件链接" className="w-full border rounded-xl px-3 py-2 text-xs" />
                )}
                <div className="flex gap-2">
                  <button onClick={() => setEditingProduct(null)} className="flex-1 py-2 border rounded-xl text-xs">取消</button>
                  <button onClick={handleSaveEditProduct} className="flex-1 py-2 bg-blue-600 text-white rounded-xl text-xs font-medium">保存修改</button>
                </div>
              </div>
            </div>
          )}

          {addVarProductId && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-2xl p-4 w-full max-w-sm space-y-3">
                <div className="font-semibold text-sm">追加新规格</div>
                <input value={addVarName} onChange={(e) => setAddVarName(e.target.value)} placeholder="规格名（如：年卡 / 终身版）" className="w-full border rounded-xl px-3 py-2 text-sm" />
                <div className="flex items-center border rounded-xl px-3 bg-slate-50">
                  <span className="text-xs text-slate-500 whitespace-nowrap mr-2">价格 (⭐ Stars)</span>
                  <input type="number" value={addVarPrice} onChange={(e) => setAddVarPrice(e.target.value)} placeholder="10" className="w-full py-2 text-sm bg-transparent outline-none" />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setAddVarProductId(null)} className="flex-1 py-2 border rounded-xl text-xs">取消</button>
                  <button onClick={handleAddVariant} className="flex-1 py-2 bg-blue-600 text-white rounded-xl text-xs font-medium">确认添加</button>
                </div>
              </div>
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
