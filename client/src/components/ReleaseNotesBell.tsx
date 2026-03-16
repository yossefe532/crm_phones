import { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  BookOpenCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import api from '../services/api';

interface ReleaseNote {
  id: number;
  title: string;
  body: string;
  version?: string | null;
  publishedAt: string;
  isRead: boolean;
  readAt?: string | null;
}

const GUIDE_STORAGE_KEY = 'release-notes-guide-v1';

export default function ReleaseNotesBell() {
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState<ReleaseNote[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [showGuide, setShowGuide] = useState(false);
  const [guideStep, setGuideStep] = useState(0);
  const [markingAll, setMarkingAll] = useState(false);

  const fetchUnreadCount = async () => {
    try {
      const response = await api.get('/release-notes/unread-count');
      setUnreadCount(Number(response.data?.unreadCount) || 0);
    } catch {
      setUnreadCount(0);
    }
  };

  const loadNotes = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/release-notes');
      const rows = Array.isArray(response.data) ? response.data : [];
      setNotes(rows);
      const firstUnread = rows.find((row: ReleaseNote) => !row.isRead);
      setActiveNoteId((prev) => prev || firstUnread?.id || rows[0]?.id || null);
      const hasSeenGuide = localStorage.getItem(GUIDE_STORAGE_KEY);
      if (!hasSeenGuide && rows.length > 0) {
        setShowGuide(true);
        setGuideStep(0);
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || 'تعذر تحميل التحديثات');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchUnreadCount();
    const intervalId = window.setInterval(() => {
      void fetchUnreadCount();
    }, 60000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void loadNotes();
  }, [isOpen]);

  const activeNote = useMemo(
    () => notes.find((note) => note.id === activeNoteId) || null,
    [activeNoteId, notes],
  );

  const handleSelectNote = async (note: ReleaseNote) => {
    setActiveNoteId(note.id);
    if (note.isRead) return;
    try {
      await api.post(`/release-notes/${note.id}/read`);
      setNotes((prev) => prev.map((row) => (row.id === note.id ? { ...row, isRead: true, readAt: new Date().toISOString() } : row)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // ignore
    }
  };

  const handleMarkAllAsRead = async () => {
    setMarkingAll(true);
    try {
      await api.post('/release-notes/read-all');
      setNotes((prev) => prev.map((row) => ({ ...row, isRead: true, readAt: row.readAt || new Date().toISOString() })));
      setUnreadCount(0);
    } catch {
      // ignore
    } finally {
      setMarkingAll(false);
    }
  };

  const closeGuide = () => {
    setShowGuide(false);
    localStorage.setItem(GUIDE_STORAGE_KEY, '1');
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 transition-colors sm:h-10 sm:w-10"
        title="تحديثات النظام"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-red-500 text-white text-[11px] font-black flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] p-2 sm:p-4 md:p-6 overflow-y-auto">
          <div className="relative mx-auto my-auto w-full max-w-5xl bg-white rounded-2xl md:rounded-3xl border border-slate-200 shadow-2xl overflow-hidden h-[calc(100dvh-1rem)] sm:h-[calc(100dvh-2rem)] md:h-[min(85dvh,820px)]">
            <div className="h-full flex flex-col md:grid md:grid-cols-[320px_minmax(0,1fr)]">
              <aside className="border-b md:border-b-0 md:border-l border-slate-200 bg-slate-50/80 p-3 sm:p-4 flex flex-col max-h-[42dvh] md:max-h-none min-h-0">
                <div className="flex items-center justify-between gap-2 mb-4">
                  <h3 className="font-black text-slate-900 flex items-center gap-2">
                    <Sparkles size={18} className="text-indigo-600" />
                    Release Notes
                  </h3>
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    className="p-2 rounded-lg hover:bg-slate-200 text-slate-600"
                  >
                    <X size={18} />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => void handleMarkAllAsRead()}
                  disabled={markingAll || !notes.some((n) => !n.isRead)}
                  className="mb-3 px-3 py-2 rounded-lg text-xs font-bold bg-indigo-100 text-indigo-700 disabled:opacity-50 shrink-0"
                >
                  {markingAll ? 'جارٍ التحديد كمقروء...' : 'تحديد الكل كمقروء'}
                </button>
                <div className="overflow-y-auto space-y-2 pr-1 min-h-0 flex-1">
                  {loading ? (
                    <div className="text-sm text-slate-500 p-3">جاري تحميل التحديثات...</div>
                  ) : !notes.length ? (
                    <div className="text-sm text-slate-500 p-3">لا توجد تحديثات حالياً.</div>
                  ) : (
                    notes.map((note) => (
                      <button
                        type="button"
                        key={note.id}
                        onClick={() => void handleSelectNote(note)}
                        className={clsx(
                          'w-full text-right rounded-xl border px-3 py-3 transition-colors',
                          activeNoteId === note.id ? 'border-indigo-300 bg-white' : 'border-transparent hover:bg-white',
                        )}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <p className="font-bold text-slate-800 text-sm truncate">{note.title}</p>
                          {!note.isRead && <span className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0" />}
                        </div>
                        <p className="text-xs text-slate-500">
                          {new Date(note.publishedAt).toLocaleDateString('ar-EG')}
                          {note.version ? ` • ${note.version}` : ''}
                        </p>
                      </button>
                    ))
                  )}
                </div>
              </aside>

              <section className="p-4 sm:p-5 md:p-8 overflow-y-auto flex-1 min-h-0">
                {error && (
                  <div className="mb-4 rounded-xl bg-red-50 border border-red-100 text-red-700 p-3 text-sm">{error}</div>
                )}
                {!activeNote ? (
                  <div className="h-full flex items-center justify-center text-slate-500">اختر تحديثاً لعرض التفاصيل.</div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-indigo-700">
                      <BookOpenCheck size={18} />
                      <span className="text-sm font-bold">
                        {activeNote.version ? `الإصدار ${activeNote.version}` : 'تحديث عام'}
                      </span>
                    </div>
                    <h2 className="text-2xl font-black text-slate-900">{activeNote.title}</h2>
                    <p className="text-xs text-slate-500">
                      {new Date(activeNote.publishedAt).toLocaleString('ar-EG')}
                    </p>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 whitespace-pre-wrap leading-8 text-slate-700">
                      {activeNote.body}
                    </div>
                    {activeNote.isRead && (
                      <div className="inline-flex items-center gap-2 text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-1.5 text-xs font-bold">
                        <CheckCircle2 size={14} />
                        تم الاطلاع على هذا التحديث
                      </div>
                    )}
                  </div>
                )}
              </section>
            </div>

            {showGuide && (
              <div className="absolute inset-0 bg-slate-950/65 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
                <div className="w-full max-w-xl max-h-[90%] bg-white rounded-2xl p-5 sm:p-6 md:p-7 shadow-2xl border border-slate-200 overflow-y-auto">
                  <div className="mb-5 flex items-center justify-between">
                    <h4 className="font-black text-slate-900">دليل سريع للتحديثات</h4>
                    <button
                      type="button"
                      onClick={closeGuide}
                      className="text-slate-500 hover:text-slate-700"
                    >
                      <X size={18} />
                    </button>
                  </div>

                  <div className="relative min-h-[160px]">
                    <div
                      className={clsx(
                        'transition-all duration-300',
                        guideStep === 0 ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8 absolute inset-0 pointer-events-none',
                      )}
                    >
                      <h5 className="text-lg font-black text-indigo-700 mb-2">1) جرس التحديثات</h5>
                      <p className="text-sm text-slate-700 leading-7">
                        الرقم الأحمر فوق الجرس يوضح عدد التحديثات غير المقروءة، ويتحدّث تلقائياً كل دقيقة.
                      </p>
                    </div>
                    <div
                      className={clsx(
                        'transition-all duration-300',
                        guideStep === 1 ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8 absolute inset-0 pointer-events-none',
                      )}
                    >
                      <h5 className="text-lg font-black text-indigo-700 mb-2">2) قراءة كل إصدار</h5>
                      <p className="text-sm text-slate-700 leading-7">
                        من القائمة الجانبية تقدر تختار أي إصدار، وتشوف فيه الجديد زي تحديثات FAQ أو نظام الاقتراحات. وبمجرد فتحه يتم وضعه كمقروء تلقائياً.
                      </p>
                    </div>
                    <div
                      className={clsx(
                        'transition-all duration-300',
                        guideStep === 2 ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8 absolute inset-0 pointer-events-none',
                      )}
                    >
                      <h5 className="text-lg font-black text-indigo-700 mb-2">3) متابعة الميزات الجديدة</h5>
                      <p className="text-sm text-slate-700 leading-7">
                        تابع أي إصدار يخص FAQ أو الاقتراحات ثم استخدم زر "تحديد الكل كمقروء" بعد المراجعة السريعة.
                      </p>
                    </div>
                  </div>

                  <div className="mt-6 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {[0, 1, 2].map((dot) => (
                        <span
                          key={dot}
                          className={clsx(
                            'h-2 rounded-full transition-all',
                            guideStep === dot ? 'w-8 bg-indigo-600' : 'w-2 bg-slate-300',
                          )}
                        />
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setGuideStep((prev) => Math.max(0, prev - 1))}
                        disabled={guideStep === 0}
                        className="px-3 py-2 rounded-lg border border-slate-200 text-slate-700 disabled:opacity-50"
                      >
                        <ChevronRight size={16} />
                      </button>
                      {guideStep < 2 ? (
                        <button
                          type="button"
                          onClick={() => setGuideStep((prev) => Math.min(2, prev + 1))}
                          className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-bold flex items-center gap-1"
                        >
                          التالي
                          <ChevronLeft size={16} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={closeGuide}
                          className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold"
                        >
                          فهمت
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
