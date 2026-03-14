import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';

type CoachLevel = 'info' | 'warning' | 'success';

type CoachMessage = {
  id: string;
  title: string;
  body: string;
  level: CoachLevel;
  at: number;
};

const buildId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return (crypto as any).randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const levelStyles: Record<CoachLevel, { wrap: string; icon: any }> = {
  info: { wrap: 'bg-slate-900 text-white', icon: Info },
  warning: { wrap: 'bg-amber-600 text-white', icon: AlertCircle },
  success: { wrap: 'bg-emerald-600 text-white', icon: CheckCircle2 },
};

export default function CoachToasts() {
  const [items, setItems] = useState<CoachMessage[]>([]);

  useEffect(() => {
    const handler = (evt: Event) => {
      const detail = (evt as CustomEvent).detail || {};
      const level: CoachLevel = (detail.level === 'warning' || detail.level === 'success') ? detail.level : 'info';
      const next: CoachMessage = {
        id: buildId(),
        title: String(detail.title || 'تنبيه'),
        body: String(detail.body || ''),
        level,
        at: Date.now(),
      };
      setItems((prev) => [next, ...prev].slice(0, 4));
      window.setTimeout(() => {
        setItems((prev) => prev.filter((m) => m.id !== next.id));
      }, 14000);
    };
    window.addEventListener('crm:coach', handler as any);
    return () => window.removeEventListener('crm:coach', handler as any);
  }, []);

  if (!items.length) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-3 w-[340px] max-w-[90vw]">
      {items.map((item) => {
        const meta = levelStyles[item.level];
        const Icon = meta.icon;
        return (
          <div key={item.id} className={`rounded-2xl shadow-2xl p-4 ${meta.wrap}`}>
            <div className="flex items-start gap-3">
              <div className="mt-0.5">
                <Icon size={18} />
              </div>
              <div className="flex-1">
                <div className="font-black text-sm">{item.title}</div>
                <div className="text-xs opacity-90 mt-1 leading-relaxed">{item.body}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

