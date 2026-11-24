import { useEffect, useState } from 'react';
import { apiRequest, getTgWebApp } from './lib/api';
import { dict, type Lang } from './i18n';

type Tab = 'merchant' | 'orders' | 'buyer_orders';
const DEFAULT_BOT_USERNAME = 'DropDesk629bot';

function detectInitialLang(): Lang {
  const saved = localStorage.getItem('dropdesk_lang');
  if (saved === 'zh' || saved === 'en') return saved;
  const tgLang = (getTgWebApp()?.initDataUnsafe as any)?.user?.language_code || navigator.language || 'en';
  return tgLang.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export default function App() {
  const [lang, setLang] = useState<Lang>(detectInitialLang);
  const t = dict[lang];

  const [startProductId, setStartProductId] = useState<string | null>(null);
  const [startStoreId, setStartStoreId] = useState<string | null>(null);
  const [storefront, setStorefront] = useState<any>(null);
  const [botInfo, setBotInfo] = useState<{ bound: boolean; bot_username: string | null }>({ bound: false, bot_username: null });
  const [botTokenInput, setBotTokenInput] = useState('');
  const [botSaving, setBotSaving] = useState(false);
  const [tab, setTab] = useState<Tab>('merchant');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [me, setMe] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [merchantOrders, setMerchantOrders] = useState<any[]>([]);
  const [buyerOrders, setBuyerOrders] = useState<any[]>([]);
  const [checkoutProduct, setCheckoutProduct] = useState<any>(null);
  const [selectedVariant, setSelectedVariant] = useState<string>('');

  const [showSettings, setShowSettings] = useState(false);
  const [storeNameInput, setStoreNameInput] = useState('');
  const [deliveryTplInput, setDeliveryTplInput] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [deliveryType, setDeliveryType] = useState<'KEY' | 'FILE' | 'WEBHOOK'>('KEY');
  const [fileUrl, setFileUrl] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [newVariants, setNewVariants] = useState<Array<{ name: string; price_stars: string }>>([
    { name: detectInitialLang() === 'zh' ? '标准版' : 'Standard', price_stars: '10' },
  ]);

  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [addVarProductId, setAddVarProductId] = useState<string | null>(null);
  const [addVarName, setAddVarName] = useState('');
  const [addVarPrice, setAddVarPrice] = useState('10');

  const [importVariantId, setImportVariantId] = useState<string | null>(null);
  const [keysText, setKeysText] = useState('');
  const [showUpgrade, setShowUpgrade] = useState(false);

  const toggleLang = () => {
    const next: Lang = lang === 'zh' ? 'en' : 'zh';
    setLang(next);
    localStorage.setItem('dropdesk_lang', next);
  };

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

    if (startParam.startsWith('store_')) {
      const sid = startParam.slice(6);
      setStartStoreId(sid);
      apiRequest(`/api/store/stores/${sid}`)
        .then((data) => setStorefront(data))
        .catch((e: any) => notify(e.message));
      return;
    }

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

  
  async function handleBindBot() {
    if (!botTokenInput.trim()) return notify(lang === 'zh' ? '请先粘贴 Bot Token' : 'Please paste Bot Token');
    setBotSaving(true);
    try {
      const res = await apiRequest('/api/merchant/bot', {
        method: 'POST',
        body: JSON.stringify({ bot_token: botTokenInput.trim() }),
      });
      setBotInfo({ bound: true, bot_username: res.bot_username });
      setBotTokenInput('');
      notify(lang === 'zh' ? `已绑定 @${res.bot_username}，Stars 将直接进你的账户` : `Bound @${res.bot_username}!`);
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBotSaving(false);
    }
  }

  async function handleUnbindBot() {
    setBotSaving(true);
    try {
      await apiRequest('/api/merchant/bot', { method: 'DELETE' });
      setBotInfo({ bound: false, bot_username: null });
      notify(lang === 'zh' ? '已解绑，恢复使用默认收款 Bot' : 'Unbound custom bot');
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBotSaving(false);
    }
  }

  function copyStoreLink() {
    const mid = me?.merchant?.id;
    if (!mid) return;
    const url = `https://t.me/${DEFAULT_BOT_USERNAME}?startapp=store_${mid}`;
    navigator.clipboard?.writeText(url);
    notify(lang === 'zh' ? '店铺主页链接已复制' : 'Storefront link copied!');
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
      apiRequest('/api/merchant/bot').then((b) => setBotInfo(b)).catch(() => {});
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
        body: JSON.stringify({ store_name: storeNameInput, delivery_template: deliveryTplInput }),
      });
      setShowSettings(false);
      notify(t.msgSaved);
      loadMerchantData();
    } catch (e: any) {
      notify(e.message);
    }
  }

  async function handleCreateProduct() {
    if (!title.trim()) return notify(t.msgNeedTitle);
    const validVariants = newVariants
      .filter((v) => v.name.trim())
      .map((v) => ({ name: v.name.trim(), price_stars: Math.max(1, Number(v.price_stars) || 1) }));
    if (!validVariants.length) return notify(t.msgNeedVariant);

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
      setNewVariants([{ name: t.stdVariant, price_stars: '10' }]);
      notify(t.msgCreated);
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
      notify(t.msgUpdated);
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
      notify(nextStatus === 'ACTIVE' ? t.msgPublished : t.msgUnpublished);
      loadMerchantData();
    } catch (e: any) {
      notify(e.message);
    }
  }

  async function handleDeleteProduct(productId: string) {
    if (!window.confirm(t.msgConfirmDel)) return;
    try {
      await apiRequest(`/api/merchant/products/${productId}`, { method: 'DELETE' });
      notify(t.msgDeleted);
      loadMerchantData();
    } catch (e: any) {
      notify(e.message);
    }
  }

  async function handleAddVariant() {
    if (!addVarProductId || !addVarName.trim()) return notify(t.msgNeedVarName);
    try {
      await apiRequest(`/api/merchant/products/${addVarProductId}/variants`, {
        method: 'POST',
        body: JSON.stringify({ name: addVarName.trim(), price_stars: Math.max(1, Number(addVarPrice) || 1) }),
      });
      setAddVarProductId(null);
      setAddVarName('');
      setAddVarPrice('10');
      notify(t.msgVarAdded);
      loadMerchantData();
    } catch (e: any) {
      notify(e.message);
    }
  }

  async function handleImportKeys() {
    if (!importVariantId) return;
    const keys = keysText.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!keys.length) return notify(t.msgNeedKeys);
    try {
      const res = await apiRequest('/api/merchant/inventory/import', {
        method: 'POST',
        body: JSON.stringify({ variant_id: importVariantId, keys }),
      });
      notify(lang === 'zh' ? `成功导入 ${res.imported} 条，跳过重复 ${res.duplicates_skipped} 条` : `Imported ${res.imported}, skipped ${res.duplicates_skipped} duplicates`);
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
      const inv = await apiRequest(`/api/store/orders/${order.order_id}/invoice`, { method: 'POST' });
      const tg = getTgWebApp();
      if (tg?.openInvoice) {
        tg.openInvoice(inv.invoice_url, (status) => {
          if (status === 'paid') {
            notify(t.msgPaid);
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
      notify(t.msgRetry);
      loadMerchantData();
    } catch (e: any) {
      notify(e.message);
    }
  }

  async function handleRefund(orderId: string) {
    if (!window.confirm(t.msgConfirmRefund)) return;
    try {
      await apiRequest(`/api/merchant/orders/${orderId}/refund`, { method: 'POST' });
      notify(t.msgRefunded);
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
            notify(t.msgProPaid);
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
    notify(t.copiedLink);
  }

  
  /* STOREFRONT_VIEW */
  if (startStoreId && !startProductId) {
    return (
      <div className="container" style={{ maxWidth: 520, margin: '0 auto', padding: 16 }}>
        {toast && <div className="toast">{toast}</div>}
        {!storefront ? (
          <div className="card" style={{ textAlign: 'center', padding: 32 }}>
            {lang === 'zh' ? '正在加载店铺...' : 'Loading storefront...'}
          </div>
        ) : (
          <>
            <div className="card" style={{ marginBottom: 14 }}>
              <h2 style={{ margin: '0 0 6px' }}>🛍️ {storefront.merchant?.store_name}</h2>
              <div style={{ fontSize: 13, opacity: 0.75 }}>
                {lang === 'zh' ? 'Telegram Stars 付款 · 付款后 1 秒自动发货' : 'Pay with Telegram Stars · Instant auto-delivery'}
              </div>
            </div>
            {(storefront.products || []).length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: 24, opacity: 0.7 }}>
                {lang === 'zh' ? '该店铺暂未上架商品' : 'No active products yet.'}
              </div>
            ) : (
              (storefront.products || []).map((p: any) => (
                <div
                  key={p.id}
                  className="card"
                  style={{ marginBottom: 12, cursor: 'pointer' }}
                  onClick={() => {
                    setStartProductId(p.id);
                    apiRequest(`/api/store/products/${p.id}`)
                      .then((data) => {
                        setCheckoutProduct(data);
                        if (data.variants?.length) setSelectedVariant(data.variants[0].id);
                      })
                      .catch((e: any) => notify(e.message));
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <strong style={{ fontSize: 16 }}>{p.title}</strong>
                    <span style={{ fontWeight: 700, color: '#2481cc', whiteSpace: 'nowrap' }}>
                      ⭐ {p.min_price_stars}+
                    </span>
                  </div>
                  {p.description && (
                    <p style={{ margin: '6px 0 0', fontSize: 13, opacity: 0.75 }}>{p.description}</p>
                  )}
                </div>
              ))
            )}
          </>
        )}
      </div>
    );
  }

  if (startProductId) {
    return (
      <div className="min-h-screen p-4 max-w-md mx-auto">
        {toast && <div className="fixed top-4 left-4 right-4 bg-slate-900 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg z-50">{toast}</div>}
        <div className="flex justify-between items-center mb-3">
          <button onClick={() => { setStartProductId(null); loadMerchantData(); }} className="text-xs text-slate-500">
            {t.backHome}
          </button>
          <button onClick={toggleLang} className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full">
            {lang === 'zh' ? 'EN' : '中'}
          </button>
        </div>
        {loading || !checkoutProduct ? (
          <div className="text-center py-20 text-slate-400">{t.loadingProduct}</div>
        ) : (
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
            <div className="text-xs text-blue-600 font-medium mb-1">{checkoutProduct.store_name}</div>
            <h1 className="text-xl font-bold mb-2">{checkoutProduct.title}</h1>
            <p className="text-sm text-slate-600 mb-4 whitespace-pre-wrap">{checkoutProduct.description || t.defaultDesc}</p>

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
                      {checkoutProduct.delivery_type === 'KEY' ? `${t.stockLeft}: ${v.available_stock}` : t.autoDelivery}
                    </div>
                  </div>
                  <div className="font-bold text-blue-600">⭐ {v.price_stars}</div>
                </button>
              ))}
            </div>

            <button onClick={handleBuy} className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl active:scale-95 transition">
              {t.buyWithStars}
            </button>
            <div className="mt-4 pt-3 border-t border-slate-100 text-center">
              <a href={`https://t.me/${DEFAULT_BOT_USERNAME}`} target="_blank" rel="noreferrer" className="text-[11px] text-slate-400 hover:text-blue-600">
                {t.watermark}
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
          <p className="text-xs text-slate-500">{me?.merchant?.store_name || t.subtitle}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={toggleLang} className="text-xs px-2 py-1 bg-slate-100 text-slate-600 rounded-full font-medium">
            {lang === 'zh' ? 'EN' : '中'}
          </button>
          <button onClick={() => setShowSettings(true)} className="text-xs px-2.5 py-1 bg-slate-100 text-slate-700 rounded-full">
            {t.settings}
          </button>
          <button onClick={() => setShowUpgrade(true)} className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded-full font-medium">
            {me?.merchant?.plan === 'PRO' ? t.proMember : t.upgradePro}
          </button>
        </div>
      </div>

      {tab === 'merchant' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
              <div className="text-xs text-slate-500">{t.totalRevenue}</div>
              <div className="text-2xl font-bold mt-1">⭐ {me?.stats?.total_stars || 0}</div>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
              <div className="text-xs text-slate-500">{t.totalOrders}</div>
              <div className="text-2xl font-bold mt-1">{me?.stats?.total_orders || 0}</div>
            </div>
          </div>

          <div className="flex justify-between items-center">
            <h2 className="font-semibold text-sm">{t.products} ({products.length})</h2>
            <button onClick={() => setShowCreate(!showCreate)} className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg">
              {showCreate ? t.cancel : t.newProduct}
            </button>
          </div>

          {showCreate && (
            <div className="bg-white p-4 rounded-2xl border border-slate-200 space-y-3">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t.titlePh} className="w-full border rounded-lg px-3 py-2 text-sm" />
              <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t.descPh} className="w-full border rounded-lg px-3 py-2 text-sm" rows={2} />
              <div className="grid grid-cols-3 gap-2">
                {(['KEY', 'FILE', 'WEBHOOK'] as const).map((dt) => (
                  <button key={dt} onClick={() => setDeliveryType(dt)} className={`py-1.5 text-xs rounded-lg border ${deliveryType === dt ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-200'}`}>
                    {dt === 'KEY' ? t.typeKey : dt === 'FILE' ? t.typeFile : t.typeWebhook}
                  </button>
                ))}
              </div>
              <div className="text-[11px] text-slate-400">
                {deliveryType === 'KEY' && t.hintKey}
                {deliveryType === 'FILE' && t.hintFile}
                {deliveryType === 'WEBHOOK' && t.hintWebhook}
              </div>
              {deliveryType === 'FILE' && (
                <input value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} placeholder={t.fileUrlPh} className="w-full border rounded-lg px-3 py-2 text-sm" />
              )}
              {deliveryType === 'WEBHOOK' && (
                <input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder={t.webhookUrlPh} className="w-full border rounded-lg px-3 py-2 text-sm" />
              )}

              <div className="space-y-2">
                <div className="flex justify-between items-center text-xs text-slate-500">
                  <span>{t.variantsTitle}</span>
                  <button onClick={() => setNewVariants([...newVariants, { name: '', price_stars: '10' }])} className="text-blue-600 font-medium">
                    {t.addVariantBtn}
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
                      placeholder={t.variantNamePh}
                      className="flex-1 border rounded-lg px-3 py-2 text-sm"
                    />
                    <div className="flex items-center border rounded-lg px-2.5 bg-slate-50 w-32">
                      <span className="text-xs text-slate-500 whitespace-nowrap mr-1">{t.priceLabel}</span>
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
                      <button onClick={() => setNewVariants(newVariants.filter((_, i) => i !== idx))} className="px-2 text-red-500 text-xs">
                        {t.del}
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <button onClick={handleCreateProduct} className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium">
                {t.confirmCreate}
              </button>
            </div>
          )}

          {loading ? (
            <div className="text-center py-8 text-xs text-slate-400">{t.loading}</div>
          ) : (
            <div className="space-y-3">
              {products.map((p) => (
                <div key={p.id} className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{p.title}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${p.status === 'ACTIVE' ? 'bg-green-50 text-green-600' : 'bg-slate-100 text-slate-500'}`}>
                          {p.status === 'ACTIVE' ? t.active : t.inactive}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400">{t.typeLabel}: {p.delivery_type}</div>
                    </div>
                    <button onClick={() => copyShareLink(p.id)} className="text-xs text-blue-600 bg-blue-50 px-2.5 py-1 rounded-lg">
                      {t.copyLink}
                    </button>
                  </div>

                  {p.variants?.map((v: any) => (
                    <div key={v.id} className="flex justify-between items-center text-xs bg-slate-50 p-2.5 rounded-xl mt-2">
                      <span>{v.name} · ⭐ {v.price_stars}</span>
                      <div className="flex items-center gap-2">
                        {p.delivery_type === 'KEY' && (
                          <>
                            <span className="text-slate-500">{t.stock} {v.available_stock}</span>
                            <button onClick={() => setImportVariantId(v.id)} className="text-blue-600 font-medium">
                              {t.importKeys}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}

                  <div className="flex items-center gap-3 mt-3 pt-2.5 border-t border-slate-100 text-xs">
                    <button onClick={() => setAddVarProductId(p.id)} className="text-blue-600">{t.addVariant}</button>
                    <button onClick={() => setEditingProduct({ ...p })} className="text-slate-600">{t.edit}</button>
                    <button onClick={() => handleToggleStatus(p)} className="text-amber-600">
                      {p.status === 'ACTIVE' ? t.unpublish : t.publish}
                    </button>
                    <button onClick={() => handleDeleteProduct(p.id)} className="text-red-500 ml-auto">{t.delete}</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {showUpgrade && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-4">
                <div>
                  <div className="font-bold text-base">{t.proTitle}</div>
                  <div className="text-xs text-slate-500 mt-1">
                    {me?.merchant?.plan === 'PRO' && me?.merchant?.plan_expires_at
                      ? `${t.proExpires}${new Date(me.merchant.plan_expires_at).toISOString().slice(0, 10)}`
                      : t.proDesc}
                  </div>
                </div>
                <div className="space-y-2.5">
                  <button onClick={() => handleUpgrade('MONTHLY')} className="w-full flex justify-between items-center p-3.5 rounded-xl border border-blue-200 bg-blue-50/50 active:scale-95 transition">
                    <div className="text-left">
                      <div className="font-semibold text-sm">{t.proMonthly}</div>
                      <div className="text-xs text-slate-500">{t.proMonthlySub}</div>
                    </div>
                    <div className="font-bold text-blue-600">⭐ 250</div>
                  </button>
                  <button onClick={() => handleUpgrade('YEARLY')} className="w-full flex justify-between items-center p-3.5 rounded-xl border border-amber-300 bg-amber-50/60 active:scale-95 transition">
                    <div className="text-left">
                      <div className="font-semibold text-sm">{t.proYearly}</div>
                      <div className="text-xs text-amber-700">{t.proYearlySub}</div>
                    </div>
                    <div className="font-bold text-amber-600">⭐ 2500</div>
                  </button>
                </div>
                <button onClick={() => setShowUpgrade(false)} className="w-full py-2 border rounded-xl text-xs text-slate-600">
                  {t.close}
                </button>
              </div>
            </div>
          )}

          {showSettings && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-2xl p-4 w-full max-w-sm space-y-3">
                <div className="font-semibold text-sm">{t.settings}</div>
                <input value={storeNameInput} onChange={(e) => setStoreNameInput(e.target.value)} placeholder={t.storeNamePh} className="w-full border rounded-xl px-3 py-2 text-sm" />
                <textarea value={deliveryTplInput} onChange={(e) => setDeliveryTplInput(e.target.value)} rows={3} placeholder={t.deliveryTplPh} className="w-full border rounded-xl p-3 text-xs" />
                <div className="flex gap-2">
                  <button onClick={() => setShowSettings(false)} className="flex-1 py-2 border rounded-xl text-xs">{t.cancel}</button>
                  <button onClick={handleSaveSettings} className="flex-1 py-2 bg-blue-600 text-white rounded-xl text-xs font-medium">{t.save}</button>
                </div>

            <div className="border-t pt-3 space-y-2">
              <div className="font-semibold text-xs">
                🔗 {lang === 'zh' ? '商家独立店铺主页' : 'Merchant Storefront Link'}
              </div>
              <button
                type="button"
                onClick={copyStoreLink}
                className="w-full py-2 border rounded-xl text-xs font-medium"
              >
                {lang === 'zh' ? '复制店铺主页链接 (?startapp=store_...)' : 'Copy Storefront Link'}
              </button>

              <div className="font-semibold text-xs pt-1">
                🤖 {lang === 'zh' ? '绑定自有收款 Bot（Stars 直达你账户）' : 'Custom Bot (Direct Stars Settlement)'}
              </div>
              {botInfo.bound ? (
                <div className="space-y-2 text-xs">
                  <div className="text-green-600 font-medium">
                    ✅ {lang === 'zh' ? `已绑定：@${botInfo.bot_username}` : `Bound: @${botInfo.bot_username}`}
                  </div>
                  <button
                    type="button"
                    disabled={botSaving}
                    onClick={handleUnbindBot}
                    className="w-full py-2 border rounded-xl text-xs"
                  >
                    {lang === 'zh' ? '解绑自有 Bot' : 'Unbind Bot'}
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-xs text-gray-500">
                    {lang === 'zh'
                      ? '去 @BotFather 创建专属 Bot，粘贴 Token 自动配置 Webhook，收款 Stars 直接归你所有。'
                      : 'Create a bot via @BotFather and paste its token here. Stars payments will settle directly to your bot.'}
                  </div>
                  <input
                    type="password"
                    placeholder="123456789:ABCdefGHIjklMNO..."
                    value={botTokenInput}
                    onChange={(e) => setBotTokenInput(e.target.value)}
                    className="w-full border rounded-xl px-3 py-2 text-xs"
                  />
                  <button
                    type="button"
                    disabled={botSaving}
                    onClick={handleBindBot}
                    className="w-full py-2 bg-blue-600 text-white rounded-xl text-xs font-medium"
                  >
                    {botSaving ? '...' : lang === 'zh' ? '验证并绑定自有 Bot' : 'Verify & Bind Bot'}
                  </button>
                </div>
              )}
            </div>
              </div>
            </div>
          )}

          {editingProduct && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-2xl p-4 w-full max-w-sm space-y-3">
                <div className="font-semibold text-sm">{t.editProduct}</div>
                <input value={editingProduct.title} onChange={(e) => setEditingProduct({ ...editingProduct, title: e.target.value })} className="w-full border rounded-xl px-3 py-2 text-sm" />
                <textarea value={editingProduct.description || ''} onChange={(e) => setEditingProduct({ ...editingProduct, description: e.target.value })} rows={3} className="w-full border rounded-xl p-3 text-xs" />
                {editingProduct.delivery_type === 'FILE' && (
                  <input value={editingProduct.file_url || ''} onChange={(e) => setEditingProduct({ ...editingProduct, file_url: e.target.value })} placeholder={t.fileUrlPh} className="w-full border rounded-xl px-3 py-2 text-xs" />
                )}
                <div className="flex gap-2">
                  <button onClick={() => setEditingProduct(null)} className="flex-1 py-2 border rounded-xl text-xs">{t.cancel}</button>
                  <button onClick={handleSaveEditProduct} className="flex-1 py-2 bg-blue-600 text-white rounded-xl text-xs font-medium">{t.saveChanges}</button>
                </div>
              </div>
            </div>
          )}

          {addVarProductId && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-2xl p-4 w-full max-w-sm space-y-3">
                <div className="font-semibold text-sm">{t.appendVariant}</div>
                <input value={addVarName} onChange={(e) => setAddVarName(e.target.value)} placeholder={t.appendVariantPh} className="w-full border rounded-xl px-3 py-2 text-sm" />
                <div className="flex items-center border rounded-xl px-3 bg-slate-50">
                  <span className="text-xs text-slate-500 whitespace-nowrap mr-2">{t.priceStarsLabel}</span>
                  <input type="number" value={addVarPrice} onChange={(e) => setAddVarPrice(e.target.value)} placeholder="10" className="w-full py-2 text-sm bg-transparent outline-none" />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setAddVarProductId(null)} className="flex-1 py-2 border rounded-xl text-xs">{t.cancel}</button>
                  <button onClick={handleAddVariant} className="flex-1 py-2 bg-blue-600 text-white rounded-xl text-xs font-medium">{t.confirmAdd}</button>
                </div>
              </div>
            </div>
          )}

          {importVariantId && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-2xl p-4 w-full max-w-sm space-y-3">
                <div className="font-semibold text-sm">{t.importKeysTitle}</div>
                <textarea value={keysText} onChange={(e) => setKeysText(e.target.value)} rows={6} placeholder="KEY-001
KEY-002" className="w-full border rounded-xl p-3 text-xs font-mono" />
                <div className="flex gap-2">
                  <button onClick={() => setImportVariantId(null)} className="flex-1 py-2 border rounded-xl text-xs">{t.cancel}</button>
                  <button onClick={handleImportKeys} className="flex-1 py-2 bg-blue-600 text-white rounded-xl text-xs font-medium">{t.confirmImport}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'orders' && (
        <div className="space-y-3">
          <h2 className="font-semibold text-sm">{t.merchantOrders} ({merchantOrders.length})</h2>
          {merchantOrders.map((o) => (
            <div key={o.id} className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm text-xs space-y-1.5">
              <div className="flex justify-between font-medium">
                <span>{o.order_no}</span>
                <span className="text-blue-600">{o.status}</span>
              </div>
              <div className="text-slate-600">{o.title_snapshot} ({o.variant_snapshot}) · ⭐ {o.total_stars}</div>
              <div className="flex gap-2 pt-2">
                {o.status === 'DELIVERY_FAILED' && (
                  <button onClick={() => handleRetryDeliver(o.id)} className="px-3 py-1 bg-amber-100 text-amber-800 rounded-lg">{t.retryDeliver}</button>
                )}
                {['COMPLETED', 'DELIVERY_FAILED'].includes(o.status) && (
                  <button onClick={() => handleRefund(o.id)} className="px-3 py-1 bg-red-50 text-red-600 rounded-lg">{t.refund}</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'buyer_orders' && (
        <div className="space-y-3">
          <h2 className="font-semibold text-sm">{t.buyerOrders} ({buyerOrders.length})</h2>
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
        <button onClick={() => { setTab('merchant'); loadMerchantData(); }} className={tab === 'merchant' ? 'text-blue-600 font-semibold' : 'text-slate-500'}>{t.tabMerchant}</button>
        <button onClick={() => { setTab('orders'); loadMerchantData(); }} className={tab === 'orders' ? 'text-blue-600 font-semibold' : 'text-slate-500'}>{t.tabOrders}</button>
        <button onClick={() => { setTab('buyer_orders'); loadBuyerOrders(); }} className={tab === 'buyer_orders' ? 'text-blue-600 font-semibold' : 'text-slate-500'}>{t.tabBuyer}</button>
      </div>
    </div>
  );
}
