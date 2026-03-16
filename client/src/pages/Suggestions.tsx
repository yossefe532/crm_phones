
import { useState, useEffect, useMemo } from 'react';
import { Lightbulb, Send, Loader2, MessageSquareQuote, CheckCircle2, Database, MessageCircleReply, Clock3 } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../store/useAuth';

interface Suggestion {
  id: number;
  content: string;
  answer?: string | null;
  answeredAt?: string | null;
  createdAt: string;
  user?: {
    name: string;
    email: string;
    role: string;
  };
  answeredBy?: {
    id: number;
    name: string;
    email: string;
  } | null;
}

export default function Suggestions() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [answerDrafts, setAnswerDrafts] = useState<Record<number, string>>({});
  const [answeringId, setAnsweringId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchSuggestions = async () => {
    setLoading(true);
    setError('');
    try {
      const endpoint = isAdmin ? '/admin/suggestions' : '/suggestions/mine';
      const response = await api.get(endpoint);
      const rows: Suggestion[] = Array.isArray(response.data) ? response.data : [];
      setSuggestions(rows);
      setAnswerDrafts((prev) => {
        const next = { ...prev };
        rows.forEach((item) => {
          next[item.id] = prev[item.id] ?? item.answer ?? '';
        });
        return next;
      });
    } catch (fetchError) {
      console.error('Failed to fetch suggestions', fetchError);
      setError('تعذر تحميل الاقتراحات حالياً');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    void fetchSuggestions();
  }, [isAdmin, user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;

    setSubmitting(true);
    setError('');
    try {
      await api.post('/suggestions', { content });
      setSuccess(true);
      setContent('');
      setTimeout(() => setSuccess(false), 3000);
      await fetchSuggestions();
    } catch (submitError) {
      console.error('Failed to submit suggestion', submitError);
      setError('فشل إرسال الاقتراح، حاول مرة أخرى.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAnswer = async (suggestionId: number) => {
    const answer = (answerDrafts[suggestionId] || '').trim();
    if (!answer) {
      setError('اكتب الرد قبل الحفظ');
      return;
    }
    setAnsweringId(suggestionId);
    setError('');
    try {
      await api.patch(`/admin/suggestions/${suggestionId}/answer`, { answer });
      await fetchSuggestions();
    } catch (answerError) {
      console.error('Failed to answer suggestion', answerError);
      setError('تعذر حفظ الرد الآن');
    } finally {
      setAnsweringId(null);
    }
  };

  const answeredCount = useMemo(
    () => suggestions.filter((item) => !!item.answer).length,
    [suggestions],
  );

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-10">
      <div>
        <h1 className="text-3xl font-bold text-slate-800 flex items-center gap-3">
          <Lightbulb className="text-amber-500 fill-amber-500" />
          صندوق المقترحات
        </h1>
        <p className="text-slate-500 mt-2">
          رأيك يهمنا! شاركنا أفكارك لتطوير النظام وتحسين بيئة العمل.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        <div className="glass-card p-6 md:p-8 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-amber-400 to-orange-500" />
          
          <div className="mb-6">
            <h2 className="text-xl font-bold text-slate-800 mb-2">عندك فكرة؟</h2>
            <p className="text-sm text-slate-500">
              اكتب مقترحك بالتفصيل.. إيه اللي ممكن نضيفه يسهل شغلك أو يزود إنتاجيتك؟
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="أقترح إضافة ميزة..."
              className="w-full h-40 p-4 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all resize-none"
              required
            />
            
            <div className="flex items-center justify-between">
              {success ? (
                <div className="flex items-center gap-2 text-emerald-600 font-bold animate-in fade-in slide-in-from-bottom-2">
                  <CheckCircle2 size={20} />
                  تم الإرسال بنجاح! شكراً لك
                </div>
              ) : (
                <div />
              )}
              
              <button
                type="submit"
                disabled={submitting || !content.trim()}
                className="btn-primary bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-lg shadow-amber-200 hover:shadow-amber-300 border-none flex items-center gap-2 px-6 py-2.5 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
                <span>إرسال المقترح</span>
              </button>
            </div>
          </form>
        </div>

        <div className="space-y-6">
          <div className="bg-gradient-to-br from-indigo-600 to-violet-700 rounded-2xl p-6 md:p-8 text-white shadow-xl relative overflow-hidden">
            <MessageSquareQuote size={120} className="absolute -bottom-4 -left-4 text-white/10 rotate-12" />
            <div className="relative z-10">
              <h3 className="text-2xl font-black mb-4">لماذا نشارك؟</h3>
              <ul className="space-y-3">
                <li className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center mt-0.5 font-bold">1</div>
                  <p className="text-indigo-100 font-medium">أنت الأدرى باحتياجاتك اليومية في العمل.</p>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center mt-0.5 font-bold">2</div>
                  <p className="text-indigo-100 font-medium">كل فكرة بتساعدنا نطور النظام ليكون أسرع وأسهل.</p>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center mt-0.5 font-bold">3</div>
                  <p className="text-indigo-100 font-medium">صوتك مسموع والإدارة بتابع كل المقترحات بنفسها.</p>
                </li>
              </ul>
            </div>
          </div>

          <div className="glass-card p-5 space-y-2">
            <p className="text-sm text-slate-500">
              {isAdmin ? 'حالة الصندوق الحالي' : 'متابعة اقتراحاتك'}
            </p>
            <p className="text-xl font-black text-slate-800">
              {answeredCount}/{suggestions.length}
              <span className="text-sm font-bold text-slate-500 mr-2">تم الرد عليها</span>
            </p>
            <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all"
                style={{ width: `${suggestions.length ? Math.round((answeredCount / suggestions.length) * 100) : 0}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <h2 className="text-2xl font-bold text-slate-800 mb-2 flex items-center gap-2">
          <Database size={24} className="text-indigo-600" />
          {isAdmin ? `مقترحات الفريق (${suggestions.length})` : `اقتراحاتي (${suggestions.length})`}
        </h2>
        <p className="text-sm text-slate-500 mb-6">
          {isAdmin ? 'يمكنك كتابة رد مباشر على كل اقتراح وسيظهر لصاحب الاقتراح فوراً.' : 'ستجد هنا حالة كل اقتراح والرد الرسمي عند توفره.'}
        </p>

        {loading ? (
          <div className="py-12 flex justify-center text-slate-400">
            <Loader2 size={32} className="animate-spin" />
          </div>
        ) : suggestions.length > 0 ? (
          <div className="grid gap-4">
            {suggestions.map((suggestion) => (
              <div key={suggestion.id} className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-shadow space-y-3">
                <div className="flex justify-between items-start gap-2 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 font-bold">
                      {(suggestion.user?.name || user?.name || '?').charAt(0)}
                    </div>
                    <div>
                      <p className="font-bold text-slate-800">{suggestion.user?.name || user?.name || 'مستخدم'}</p>
                      <p className="text-xs text-slate-500" dir="ltr">
                        {(suggestion.user?.email || user?.email || '-') + ' • ' + new Date(suggestion.createdAt).toLocaleDateString('ar-EG')}
                      </p>
                    </div>
                  </div>
                  <span className={suggestion.answer ? 'px-2 py-1 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700' : 'px-2 py-1 rounded-lg text-xs font-bold bg-amber-50 text-amber-700'}>
                    {suggestion.answer ? 'تم الرد' : 'بانتظار الرد'}
                  </span>
                </div>

                <p className="text-slate-700 leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-100 whitespace-pre-wrap">
                  {suggestion.content}
                </p>

                {suggestion.answer ? (
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4">
                    <div className="flex items-center gap-2 text-emerald-700 font-bold text-sm mb-2">
                      <MessageCircleReply size={16} />
                      رد الإدارة
                    </div>
                    <p className="text-sm text-slate-700 whitespace-pre-wrap leading-7">{suggestion.answer}</p>
                    <p className="text-xs text-slate-500 mt-2 flex items-center gap-1">
                      <Clock3 size={13} />
                      {suggestion.answeredAt ? new Date(suggestion.answeredAt).toLocaleString('ar-EG') : 'تم الرد'}
                    </p>
                  </div>
                ) : null}

                {isAdmin && (
                  <div className="rounded-xl border border-slate-200 p-3 space-y-2">
                    <p className="text-xs text-slate-500 font-bold">رد الإدارة</p>
                    <textarea
                      value={answerDrafts[suggestion.id] || ''}
                      onChange={(e) => setAnswerDrafts((prev) => ({ ...prev, [suggestion.id]: e.target.value }))}
                      className="input-field min-h-[100px]"
                      placeholder="اكتب ردّك هنا..."
                    />
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => void handleAnswer(suggestion.id)}
                        disabled={answeringId === suggestion.id}
                        className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {answeringId === suggestion.id ? 'جارٍ الحفظ...' : 'حفظ الرد'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 text-slate-400">
            لا توجد مقترحات حتى الآن
          </div>
        )}
      </div>
    </div>
  );
}
