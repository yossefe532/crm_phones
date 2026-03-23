import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BellRing, BellOff, Loader2 } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../store/useAuth';

type MaintenancePayload = {
  enabled: boolean;
  message: string;
  updatedAt: string | null;
};

const DEFAULT_MESSAGE = 'النظام تحت الصيانة حالياً.. ثواني و هنرجع تاني.';
const POLL_INTERVAL_MS = 15000;

export default function MaintenanceGate() {
  const [maintenance, setMaintenance] = useState<MaintenancePayload>({
    enabled: false,
    message: DEFAULT_MESSAGE,
    updatedAt: null,
  });
  const [isToggling, setIsToggling] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const refreshTimerRef = useRef<number | null>(null);
  const user = useAuth((state) => state.user);
  const isAdmin = user?.role === 'ADMIN';

  const fetchMaintenanceStatus = useCallback(async () => {
    try {
      const response = await api.get('/maintenance/status');
      const payload = response?.data?.maintenance;
      setMaintenance({
        enabled: Boolean(payload?.enabled),
        message: typeof payload?.message === 'string' && payload.message.trim() ? payload.message : DEFAULT_MESSAGE,
        updatedAt: typeof payload?.updatedAt === 'string' ? payload.updatedAt : null,
      });
    } catch (error) {
      console.error('Failed to fetch maintenance status:', error);
    }
  }, []);

  const toggleMaintenanceMode = useCallback(async () => {
    if (!isAdmin || isToggling) return;
    setIsToggling(true);
    try {
      const response = await api.put('/admin/maintenance-mode', {
        enabled: !maintenance.enabled,
        message: maintenance.message || DEFAULT_MESSAGE,
      });
      const payload = response?.data?.maintenance;
      setMaintenance({
        enabled: Boolean(payload?.enabled),
        message: typeof payload?.message === 'string' && payload.message.trim() ? payload.message : DEFAULT_MESSAGE,
        updatedAt: typeof payload?.updatedAt === 'string' ? payload.updatedAt : null,
      });
      setIsPanelOpen(false);
    } catch (error) {
      console.error('Failed to toggle maintenance mode:', error);
    } finally {
      setIsToggling(false);
    }
  }, [isAdmin, isToggling, maintenance.enabled, maintenance.message]);

  useEffect(() => {
    void fetchMaintenanceStatus();

    refreshTimerRef.current = window.setInterval(() => {
      void fetchMaintenanceStatus();
    }, POLL_INTERVAL_MS);

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void fetchMaintenanceStatus();
      }
    };

    const onFocus = () => {
      void fetchMaintenanceStatus();
    };

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);

    return () => {
      if (refreshTimerRef.current) {
        window.clearInterval(refreshTimerRef.current);
      }
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [fetchMaintenanceStatus]);

  const updatedAtLabel = useMemo(() => {
    if (!maintenance.updatedAt) return null;
    const date = new Date(maintenance.updatedAt);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat('ar-EG', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }, [maintenance.updatedAt]);

  return (
    <>
      {isAdmin && (
        <div className="fixed bottom-4 left-4 z-[120]">
          {isPanelOpen && (
            <div className="mb-2 w-72 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-2xl backdrop-blur">
              <p className="text-sm font-bold text-slate-800">تحكم الصيانة</p>
              <p className="mt-1 text-xs text-slate-600">
                الحالة الحالية: {maintenance.enabled ? 'مفعّلة' : 'متوقفة'}
              </p>
              <button
                type="button"
                onClick={toggleMaintenanceMode}
                disabled={isToggling}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-60"
              >
                {isToggling ? <Loader2 size={16} className="animate-spin" /> : null}
                {maintenance.enabled ? 'إيقاف وضع الصيانة' : 'تشغيل وضع الصيانة'}
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => setIsPanelOpen((prev) => !prev)}
            className={`inline-flex h-12 w-12 items-center justify-center rounded-full shadow-xl transition ${
              maintenance.enabled
                ? 'bg-amber-500 text-white hover:bg-amber-400'
                : 'bg-slate-900 text-white hover:bg-slate-700'
            }`}
            title="تحكم وضع الصيانة"
            aria-label="تحكم وضع الصيانة"
          >
            {maintenance.enabled ? <BellOff size={20} /> : <BellRing size={20} />}
          </button>
        </div>
      )}

      {maintenance.enabled && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/88 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-slate-900/90 px-6 py-8 text-center text-white shadow-2xl">
            <div className="mx-auto maintenance-robot">
              <div className="maintenance-robot__antenna" />
              <div className="maintenance-robot__head">
                <span className="maintenance-robot__eye" />
                <span className="maintenance-robot__eye" />
              </div>
              <div className="maintenance-robot__body">
                <span className="maintenance-robot__gear" />
              </div>
            </div>

            <h2 className="mt-4 text-2xl font-black">وضع الصيانة</h2>
            <p className="mt-1 text-amber-400 font-bold">ثواني و هنرجع تاني</p>
            <p className="mt-3 text-sm leading-7 text-slate-200">{maintenance.message}</p>
            {updatedAtLabel && (
              <p className="mt-2 text-xs text-slate-300">آخر تحديث: {updatedAtLabel}</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
