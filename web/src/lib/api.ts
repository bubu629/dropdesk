export const API_BASE = 'https://dropdesk.zhangbanzhuan.workers.dev';

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        initDataUnsafe?: {
          start_param?: string;
          user?: { id: number; first_name: string; username?: string };
        };
        ready: () => void;
        expand: () => void;
        openInvoice: (url: string, cb?: (status: string) => void) => void;
        showAlert: (msg: string) => void;
      };
    };
  }
}

export function getTgWebApp() {
  return window.Telegram?.WebApp;
}

export async function apiRequest<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const initData = getTgWebApp()?.initData || '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(initData ? { Authorization: `tma ${initData}` } : {}),
    ...((options.headers as Record<string, string>) || {}),
  };

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const json = await res.json();
  if (!json.ok) {
    throw new Error(json.error?.message || '请求失败');
  }
  return json.data as T;
}
