import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, HelpCircle, Plus, Trash2 } from 'lucide-react';
import api from '../../services/api';

interface FaqEntry {
  id: number;
  type: 'CALL_SUPPORT' | 'SYSTEM_GUIDE';
  question: string;
  answer: string;
  category?: string | null;
  sortOrder: number;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
}

interface DraftById {
  type: 'CALL_SUPPORT' | 'SYSTEM_GUIDE';
  question: string;
  answer: string;
  category: string;
  sortOrder: number;
  isPublished: boolean;
}

export default function FaqManagement() {
  const FAQ_TYPES = [
    { value: 'CALL_SUPPORT' as const, label: 'دعم المكالمة' },
    { value: 'SYSTEM_GUIDE' as const, label: 'دليل النظام' },
  ];
  const [items, setItems] = useState<FaqEntry[]>([]);
  const [drafts, setDrafts] = useState<Record<number, DraftById>>({});
  const [activeType, setActiveType] = useState<'CALL_SUPPORT' | 'SYSTEM_GUIDE'>('CALL_SUPPORT');
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [newFaq, setNewFaq] = useState<DraftById>({
    type: 'CALL_SUPPORT',
    question: '',
    answer: '',
    category: '',
    sortOrder: 0,
    isPublished: true,
  });

  const publishedCount = useMemo(() => items.filter((item) => item.isPublished).length, [items]);

  const fetchFaqs = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/faqs', { params: { includeUnpublished: true, type: activeType } });
      const rows = Array.isArray(response.data) ? response.data : [];
      setItems(rows);
      setDrafts(
        rows.reduce((acc: Record<number, DraftById>, row: FaqEntry) => {
          acc[row.id] = {
            type: row.type || 'CALL_SUPPORT',
            question: row.question || '',
            answer: row.answer || '',
            category: row.category || '',
            sortOrder: Number.isFinite(row.sortOrder) ? row.sortOrder : 0,
            isPublished: !!row.isPublished,
          };
          return acc;
        }, {}),
      );
    } catch (err: any) {
      setError(err?.response?.data?.error || 'تعذر تحميل عناصر FAQ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchFaqs();
  }, [activeType]);

  const handleCreate = async () => {
    setError('');
    setSuccess('');
    if (!newFaq.question.trim() || !newFaq.answer.trim()) {
      setError('السؤال والإجابة مطلوبان.');
      return;
    }
    setCreating(true);
    try {
      await api.post('/admin/faqs', {
        type: newFaq.type,
        question: newFaq.question.trim(),
        answer: newFaq.answer.trim(),
        category: newFaq.category.trim() || null,
        sortOrder: Number(newFaq.sortOrder) || 0,
        isPublished: newFaq.isPublished,
      });
      setSuccess('تم إنشاء عنصر FAQ بنجاح');
      setNewFaq({ type: activeType, question: '', answer: '', category: '', sortOrder: 0, isPublished: true });
      await fetchFaqs();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'تعذر إنشاء عنصر FAQ');
    } finally {
      setCreating(false);
    }
  };

  const handleSaveRow = async (faqId: number) => {
    const row = drafts[faqId];
    if (!row) return;
    setSavingId(faqId);
    setError('');
    setSuccess('');
    try {
      await api.put(`/admin/faqs/${faqId}`, {
        type: row.type,
        question: row.question.trim(),
        answer: row.answer.trim(),
        category: row.category.trim() || null,
        sortOrder: Number(row.sortOrder) || 0,
        isPublished: row.isPublished,
      });
      setSuccess('تم تحديث FAQ بنجاح');
      await fetchFaqs();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'تعذر تحديث FAQ');
    } finally {
      setSavingId(null);
    }
  };

  const handleDeleteRow = async (faqId: number) => {
    const accepted = window.confirm('هل تريد حذف عنصر FAQ نهائياً؟');
    if (!accepted) return;
    setDeletingId(faqId);
    setError('');
    setSuccess('');
    try {
      await api.delete(`/admin/faqs/${faqId}`);
      setSuccess('تم حذف FAQ');
      await fetchFaqs();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'تعذر حذف FAQ');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-slate-800 mb-2">إدارة FAQ</h2>
        <p className="text-slate-600">إضافة وتعديل وترتيب الأسئلة الشائعة المعروضة داخل صفحة إضافة العميل.</p>
      </div>

      <div className="glass-card p-5 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-slate-700">
          <HelpCircle size={18} />
          <span className="font-bold">إجمالي العناصر: {items.length}</span>
        </div>
        <div className="text-sm text-slate-500">المنشور حالياً: {publishedCount}</div>
        <div className="flex items-center gap-2">
          {FAQ_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => {
                setActiveType(t.value);
                setNewFaq((prev) => ({ ...prev, type: t.value }));
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${activeType === t.value ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {success && (
        <div className="p-4 bg-emerald-50 border border-emerald-100 text-emerald-700 rounded-xl flex items-center gap-2">
          <CheckCircle2 size={20} />
          <p>{success}</p>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-100 text-red-700 rounded-xl flex items-center gap-2">
          <AlertCircle size={20} />
          <p>{error}</p>
        </div>
      )}

      <div className="glass-card p-6 space-y-4">
        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
          <Plus size={18} className="text-emerald-600" />
          إضافة سؤال جديد
        </h3>
        <div className="grid md:grid-cols-2 gap-3">
          <input
            className="input-field"
            placeholder="السؤال"
            value={newFaq.question}
            onChange={(e) => setNewFaq((prev) => ({ ...prev, question: e.target.value }))}
          />
          <select
            className="input-field"
            value={newFaq.type}
            onChange={(e) => setNewFaq((prev) => ({ ...prev, type: e.target.value as DraftById['type'] }))}
          >
            {FAQ_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <input
            className="input-field"
            placeholder="التصنيف (اختياري) مثل: اعتراضات"
            value={newFaq.category}
            onChange={(e) => setNewFaq((prev) => ({ ...prev, category: e.target.value }))}
          />
          <textarea
            className="input-field md:col-span-2 min-h-[120px]"
            placeholder="الإجابة"
            value={newFaq.answer}
            onChange={(e) => setNewFaq((prev) => ({ ...prev, answer: e.target.value }))}
          />
          <input
            className="input-field"
            type="number"
            placeholder="الترتيب"
            value={newFaq.sortOrder}
            onChange={(e) => setNewFaq((prev) => ({ ...prev, sortOrder: Number(e.target.value) || 0 }))}
          />
          <label className="flex items-center gap-2 text-sm text-slate-700 font-bold px-1">
            <input
              type="checkbox"
              checked={newFaq.isPublished}
              onChange={(e) => setNewFaq((prev) => ({ ...prev, isPublished: e.target.checked }))}
            />
            منشور
          </label>
        </div>
        <div className="flex justify-end">
          <button className="btn-primary flex items-center gap-2" onClick={() => void handleCreate()} disabled={creating}>
            <Plus size={18} />
            {creating ? 'جارٍ الإضافة...' : 'إضافة FAQ'}
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {loading ? (
          <div className="glass-card p-6 text-slate-500 text-center">جاري تحميل عناصر FAQ...</div>
        ) : !items.length ? (
          <div className="glass-card p-6 text-slate-500 text-center">لا توجد عناصر FAQ حالياً.</div>
        ) : (
          items.map((item) => {
            const draft = drafts[item.id];
            if (!draft) return null;
            return (
              <div key={item.id} className="glass-card p-6 space-y-4">
                <div className="grid md:grid-cols-2 gap-3">
                  <input
                    className="input-field"
                    value={draft.question}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [item.id]: { ...draft, question: e.target.value } }))}
                  />
                  <select
                    className="input-field"
                    value={draft.type}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [item.id]: { ...draft, type: e.target.value as DraftById['type'] } }))}
                  >
                    {FAQ_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                  <input
                    className="input-field"
                    value={draft.category}
                    placeholder="تصنيف"
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [item.id]: { ...draft, category: e.target.value } }))}
                  />
                  <textarea
                    className="input-field md:col-span-2 min-h-[120px]"
                    value={draft.answer}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [item.id]: { ...draft, answer: e.target.value } }))}
                  />
                  <input
                    className="input-field"
                    type="number"
                    value={draft.sortOrder}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [item.id]: { ...draft, sortOrder: Number(e.target.value) || 0 } }))}
                  />
                  <label className="flex items-center gap-2 text-sm text-slate-700 font-bold px-1">
                    <input
                      type="checkbox"
                      checked={draft.isPublished}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [item.id]: { ...draft, isPublished: e.target.checked } }))}
                    />
                    منشور
                  </label>
                </div>
                <div className="flex items-center justify-end gap-3">
                  <button
                    className="px-4 py-2 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 font-bold flex items-center gap-2 disabled:opacity-50"
                    onClick={() => void handleDeleteRow(item.id)}
                    disabled={deletingId === item.id}
                  >
                    <Trash2 size={16} />
                    {deletingId === item.id ? 'جارٍ الحذف...' : 'حذف'}
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => void handleSaveRow(item.id)}
                    disabled={savingId === item.id}
                  >
                    {savingId === item.id ? 'جارٍ الحفظ...' : 'حفظ التعديل'}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
