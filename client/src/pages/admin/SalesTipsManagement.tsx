import { useEffect, useMemo, useState } from 'react';
import { Bot, Lightbulb, Plus, Sparkles, Trash2, Wand2 } from 'lucide-react';
import api from '../../services/api';

type SourceType = 'MANUAL' | 'AI_GENERATED' | 'WEB';

interface SalesTip {
  id: number;
  title: string;
  content: string;
  category: string | null;
  sourceType: SourceType;
  sourceTitle: string | null;
  sourceUrl: string | null;
  sortOrder: number;
  isPublished: boolean;
}

interface TipForm {
  title: string;
  content: string;
  category: string;
  sortOrder: number;
  isPublished: boolean;
}

const createEmptyForm = (): TipForm => ({
  title: '',
  content: '',
  category: '',
  sortOrder: 0,
  isPublished: true,
});

export default function SalesTipsManagement() {
  const [tips, setTips] = useState<SalesTip[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState<TipForm>(createEmptyForm());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [aiTopic, setAiTopic] = useState('تحسين افتتاح المكالمة');
  const [aiContext, setAiContext] = useState('سيلز أكاديمية إيديكون يتواصلون مع أصحاب شركات وبزنس');
  const [aiCount, setAiCount] = useState(30);
  const [aiGenerating, setAiGenerating] = useState(false);

  const fetchTips = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/sales-tips', { params: { includeUnpublished: true } });
      const rows = Array.isArray(response.data) ? response.data : [];
      setTips(rows);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'تعذر تحميل النصائح حالياً.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTips();
  }, []);

  const groupedCount = useMemo(() => ({
    total: tips.length,
    published: tips.filter((tip) => tip.isPublished).length,
    ai: tips.filter((tip) => tip.sourceType === 'AI_GENERATED' || tip.sourceType === 'WEB').length,
  }), [tips]);

  const resetForm = () => {
    setEditingId(null);
    setForm(createEmptyForm());
  };

  const onSave = async () => {
    if (!form.title.trim() || !form.content.trim()) {
      setError('العنوان والمحتوى مطلوبين.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        title: form.title.trim(),
        content: form.content.trim(),
        category: form.category.trim() || null,
        sortOrder: Number(form.sortOrder || 0),
        isPublished: form.isPublished,
      };
      if (editingId) await api.put(`/admin/sales-tips/${editingId}`, payload);
      else await api.post('/admin/sales-tips', payload);
      resetForm();
      await fetchTips();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'فشل حفظ النصيحة.');
    } finally {
      setSaving(false);
    }
  };

  const onEdit = (tip: SalesTip) => {
    setEditingId(tip.id);
    setForm({
      title: tip.title,
      content: tip.content,
      category: tip.category || '',
      sortOrder: tip.sortOrder || 0,
      isPublished: tip.isPublished,
    });
  };

  const onDelete = async (tipId: number) => {
    if (!window.confirm('متأكد من حذف النصيحة؟')) return;
    try {
      await api.delete(`/admin/sales-tips/${tipId}`);
      await fetchTips();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'فشل حذف النصيحة.');
    }
  };

  const onGenerateAi = async () => {
    const normalizedCount = Math.min(1000, Math.max(1, Math.floor(aiCount || 1)));
    const rounds = Math.ceil(normalizedCount / 3);
    setAiGenerating(true);
    setError('');
    try {
      for (let i = 0; i < rounds; i += 1) {
        await api.post('/sales-tips/ai-generate', {
          topic: aiTopic,
          salesContext: aiContext,
          searchWeb: true,
          save: true,
        });
      }
      await fetchTips();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'تعذر توليد النصائح بالذكاء الاصطناعي.');
    } finally {
      setAiGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-black text-slate-800 flex items-center gap-2">
          <Lightbulb className="text-amber-500" />
          نصائح السالز
        </h2>
        <p className="text-slate-600 mt-2">المالك يكتب أو يولّد نصائح، وتظهر تلقائياً للسالز عند فتح لوحة التحكم.</p>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        <div className="glass-card p-4"><p className="text-xs text-slate-500">إجمالي النصائح</p><p className="text-2xl font-black">{groupedCount.total}</p></div>
        <div className="glass-card p-4"><p className="text-xs text-slate-500">المنشور حالياً</p><p className="text-2xl font-black text-emerald-600">{groupedCount.published}</p></div>
        <div className="glass-card p-4"><p className="text-xs text-slate-500">نصائح مولدة</p><p className="text-2xl font-black text-indigo-600">{groupedCount.ai}</p></div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 p-3 text-sm">{error}</div>}

      <div className="glass-card p-5 space-y-4">
        <h3 className="text-lg font-black flex items-center gap-2"><Plus size={18} />{editingId ? 'تعديل نصيحة' : 'إضافة نصيحة'}</h3>
        <div className="grid md:grid-cols-2 gap-3">
          <input className="input-field" placeholder="العنوان" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} />
          <input className="input-field" placeholder="التصنيف (اختياري)" value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))} />
        </div>
        <textarea className="input-field min-h-[120px]" placeholder="محتوى النصيحة..." value={form.content} onChange={(e) => setForm((p) => ({ ...p, content: e.target.value }))} />
        <div className="flex flex-wrap items-center gap-3">
          <input className="input-field max-w-[140px]" type="number" value={form.sortOrder} onChange={(e) => setForm((p) => ({ ...p, sortOrder: Number(e.target.value || 0) }))} />
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={form.isPublished} onChange={(e) => setForm((p) => ({ ...p, isPublished: e.target.checked }))} />
            منشور
          </label>
          <button type="button" onClick={onSave} disabled={saving} className="btn-primary">{saving ? 'جاري الحفظ...' : 'حفظ'}</button>
          {editingId && <button type="button" onClick={resetForm} className="btn-secondary">إلغاء</button>}
        </div>
      </div>

      <div className="glass-card p-5 space-y-4">
        <h3 className="text-lg font-black flex items-center gap-2"><Bot size={18} />مولد نصائح AI</h3>
        <div className="grid md:grid-cols-3 gap-3">
          <input className="input-field" value={aiTopic} onChange={(e) => setAiTopic(e.target.value)} placeholder="موضوع التوليد" />
          <input className="input-field md:col-span-2" value={aiContext} onChange={(e) => setAiContext(e.target.value)} placeholder="سياق البيع" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input className="input-field max-w-[180px]" type="number" min={1} max={1000} value={aiCount} onChange={(e) => setAiCount(Number(e.target.value || 1))} />
          <button type="button" onClick={onGenerateAi} disabled={aiGenerating} className="btn-primary flex items-center gap-2">
            <Wand2 size={16} />
            {aiGenerating ? 'جاري التوليد...' : 'توليد وحفظ'}
          </button>
          <p className="text-xs text-slate-500 flex items-center gap-1"><Sparkles size={14} />أقصى عدد 1000 نصيحة.</p>
        </div>
      </div>

      <div className="glass-card p-5 space-y-3">
        <h3 className="text-lg font-black">قائمة النصائح</h3>
        {loading ? <p className="text-slate-500 text-sm">جاري التحميل...</p> : tips.map((tip) => (
          <div key={tip.id} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="font-black text-slate-800">{tip.title}</h4>
                <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap">{tip.content}</p>
                <p className="text-xs text-slate-500 mt-2">{tip.category || 'عام'} • {tip.sourceType} • {tip.isPublished ? 'منشور' : 'غير منشور'}</p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => onEdit(tip)} className="btn-secondary text-xs">تعديل</button>
                <button type="button" onClick={() => onDelete(tip.id)} className="px-2.5 py-2 rounded-lg bg-red-50 text-red-600"><Trash2 size={14} /></button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
