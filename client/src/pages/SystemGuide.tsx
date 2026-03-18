import { useEffect, useMemo, useState } from 'react';
import { BookOpenText, ChevronDown, LifeBuoy, Search } from 'lucide-react';
import clsx from 'clsx';
import api from '../services/api';

interface GuideItem {
  id: number;
  question: string;
  answer: string;
  sortOrder: number;
  isPublished: boolean;
}

export default function SystemGuide() {
  const [items, setItems] = useState<GuideItem[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await api.get('/faqs', { params: { type: 'SYSTEM_GUIDE' } });
        const rows = Array.isArray(response.data) ? response.data : [];
        setItems(rows.map((row) => ({
          id: row.id,
          question: row.question || '',
          answer: row.answer || '',
          sortOrder: Number(row.sortOrder || 0),
          isPublished: Boolean(row.isPublished),
        })));
      } catch {
        setError('تعذر تحميل دليل استخدام النظام حالياً.');
      } finally {
        setLoading(false);
      }
    };
    run();
  }, []);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return items;
    return items.filter((item) =>
      `${item.question} ${item.answer}`.toLowerCase().includes(normalized),
    );
  }, [items, query]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-slate-800 flex items-center gap-2">
            <BookOpenText className="text-indigo-600" size={28} />
            دليل استخدام النظام
          </h2>
          <p className="text-slate-600 mt-2">هنا كل أسئلة تشغيل السيستم وخطوات الاستخدام اليومية.</p>
        </div>
      </div>

      <div className="glass-card p-4 md:p-5">
        <div className="relative">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث في أسئلة دليل النظام..."
            className="w-full pr-9 pl-3 py-2.5 rounded-xl border border-slate-200 bg-white"
          />
        </div>
      </div>

      <div className="glass-card p-4 md:p-6 space-y-3">
        {loading && <p className="text-slate-500 text-sm">جاري تحميل الدليل...</p>}
        {!loading && error && <p className="text-red-600 text-sm">{error}</p>}
        {!loading && !error && filtered.length === 0 && (
          <p className="text-slate-500 text-sm">لا توجد نتائج مطابقة حالياً.</p>
        )}
        {!loading && !error && filtered.map((item) => (
          <div key={item.id} className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <button
              type="button"
              onClick={() => setOpenId((prev) => (prev === item.id ? null : item.id))}
              className="w-full px-4 py-3.5 flex items-center justify-between gap-3 text-right hover:bg-slate-50 transition-colors"
            >
              <span className="font-black text-slate-800">{item.question}</span>
              <ChevronDown
                size={18}
                className={clsx('text-slate-500 transition-transform', openId === item.id && 'rotate-180')}
              />
            </button>
            {openId === item.id && (
              <div className="px-4 pb-4">
                <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3.5 text-slate-700 leading-7 whitespace-pre-wrap">
                  {item.answer}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-start gap-2.5 text-emerald-800">
        <LifeBuoy size={18} className="mt-0.5" />
        <p className="text-sm font-semibold">
          لو سؤالك خاص بطريقة الرد على العميل أثناء المكالمة، راجع قسم FAQ الخاص بالمكالمات في صفحة إضافة العميل.
        </p>
      </div>
    </div>
  );
}
