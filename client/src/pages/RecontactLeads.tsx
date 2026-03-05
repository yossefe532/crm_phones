import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Check, MessageCircle, Phone, RefreshCw, X } from 'lucide-react';
import clsx from 'clsx';
import api from '../services/api';
import { toWhatsAppNumber } from '../utils/whatsapp';

interface RecontactLead {
  id: number;
  name: string;
  phone: string;
  whatsappPhone?: string;
  status: string;
  notes?: string;
  recontactAttempts?: number;
  nextRecontactAt?: string;
  lastRecontactAt?: string;
  createdAt: string;
  agent?: { id: number; name: string };
}

const OUTCOME_OPTIONS = [
  { value: 'AGREED', label: 'موافق' },
  { value: 'HESITANT', label: 'متردد' },
  { value: 'REJECTED', label: 'مرفوض' },
  { value: 'SPONSOR', label: 'سبونسر' },
  { value: 'NO_ANSWER', label: 'مردش مرة أخرى' },
];

export default function RecontactLeads() {
  const [leads, setLeads] = useState<RecontactLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dueOnly, setDueOnly] = useState(true);
  const [selectedLead, setSelectedLead] = useState<RecontactLead | null>(null);
  const [outcome, setOutcome] = useState('AGREED');
  const [source, setSource] = useState<'CALL' | 'SEND'>('CALL');
  const [notes, setNotes] = useState('');
  const [scheduleNextAt, setScheduleNextAt] = useState('');
  const [error, setError] = useState('');

  const fetchQueue = async () => {
    setLoading(true);
    try {
      const response = await api.get('/leads/recontact', { params: { dueOnly: dueOnly ? 1 : 0 } });
      setLeads(response.data || []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'تعذر تحميل قائمة إعادة التواصل');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueue();
  }, [dueOnly]);

  const openWhatsApp = (phone: string) => {
    const formatted = toWhatsAppNumber(phone);
    if (!formatted) return;
    window.open(`https://wa.me/${formatted}`, '_blank', 'noopener,noreferrer');
  };

  const dueCount = useMemo(
    () => leads.filter((lead) => !!lead.nextRecontactAt && new Date(lead.nextRecontactAt) <= new Date()).length,
    [leads],
  );

  const submitOutcome = async () => {
    if (!selectedLead) return;
    setSaving(true);
    setError('');
    try {
      await api.post(`/leads/${selectedLead.id}/recontact/complete`, {
        outcome,
        source,
        notes: notes || undefined,
        ...(outcome === 'NO_ANSWER' ? { scheduleNextAt: new Date(scheduleNextAt).toISOString() } : {}),
      });
      setSelectedLead(null);
      setNotes('');
      setScheduleNextAt('');
      await fetchQueue();
    } catch (err: any) {
      setError(err.response?.data?.error || 'تعذر حفظ نتيجة إعادة التواصل');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-slate-800">إعادة التواصل</h2>
          <p className="text-slate-600">العملاء المجدولون للمتابعة بعد حالة مردش</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDueOnly((prev) => !prev)}
            className={clsx(
              'px-4 py-2 rounded-xl text-sm font-bold transition-colors',
              dueOnly ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700',
            )}
          >
            {dueOnly ? 'عرض المستحق فقط' : 'عرض الكل'}
          </button>
          <button onClick={fetchQueue} className="btn-secondary flex items-center gap-2">
            <RefreshCw size={18} />
            تحديث
          </button>
        </div>
      </div>

      <div className="glass-card p-4 flex flex-wrap items-center gap-3 text-sm">
        <span className="px-3 py-1 rounded-full bg-blue-100 text-blue-700 font-bold">إجمالي: {leads.length}</span>
        <span className="px-3 py-1 rounded-full bg-orange-100 text-orange-700 font-bold">مستحق الآن: {dueCount}</span>
      </div>

      {error && <div className="glass-card p-4 border border-red-200 text-red-700">{error}</div>}

      <div className="glass-card overflow-hidden">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-right">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="p-4">الاسم</th>
                <th className="p-4">الهاتف</th>
                <th className="p-4">المحاولات</th>
                <th className="p-4">موعد المتابعة</th>
                <th className="p-4">الموظف</th>
                <th className="p-4">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={6} className="p-6 text-center text-slate-500">جاري التحميل...</td></tr>
              ) : leads.length === 0 ? (
                <tr><td colSpan={6} className="p-6 text-center text-slate-500">لا توجد متابعات مجدولة</td></tr>
              ) : (
                leads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-slate-50/60">
                    <td className="p-4 font-bold text-slate-800">{lead.name}</td>
                    <td className="p-4 font-mono" dir="ltr">{lead.phone}</td>
                    <td className="p-4">{lead.recontactAttempts || 0}</td>
                    <td className="p-4 text-sm text-slate-600">{lead.nextRecontactAt ? new Date(lead.nextRecontactAt).toLocaleString('ar-EG') : '-'}</td>
                    <td className="p-4 text-sm text-slate-600">{lead.agent?.name || '-'}</td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <a href={`tel:${lead.phone}`} className="p-2 rounded-lg hover:bg-emerald-100 text-emerald-600"><Phone size={17} /></a>
                        <button onClick={() => openWhatsApp(lead.whatsappPhone || lead.phone)} className="p-2 rounded-lg hover:bg-green-100 text-green-600"><MessageCircle size={17} /></button>
                        <button
                          onClick={() => {
                            setSelectedLead(lead);
                            setOutcome('AGREED');
                            setSource('CALL');
                            setNotes(lead.notes || '');
                            setScheduleNextAt('');
                          }}
                          className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold"
                        >
                          تسجيل نتيجة
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="md:hidden divide-y divide-slate-100">
          {loading ? <div className="p-6 text-center text-slate-500">جاري التحميل...</div> : leads.length === 0 ? <div className="p-6 text-center text-slate-500">لا توجد متابعات مجدولة</div> : leads.map((lead) => (
            <div key={lead.id} className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-bold text-slate-800">{lead.name}</h3>
                <span className="text-xs bg-slate-100 px-2 py-1 rounded">{lead.recontactAttempts || 0} محاولة</span>
              </div>
              <p className="text-sm text-slate-600 font-mono" dir="ltr">{lead.phone}</p>
              <p className="text-xs text-slate-500">موعد المتابعة: {lead.nextRecontactAt ? new Date(lead.nextRecontactAt).toLocaleString('ar-EG') : '-'}</p>
              <div className="flex items-center gap-2">
                <a href={`tel:${lead.phone}`} className="flex-1 py-2 rounded-lg text-center bg-emerald-50 text-emerald-700 font-bold">اتصال</a>
                <button onClick={() => openWhatsApp(lead.whatsappPhone || lead.phone)} className="flex-1 py-2 rounded-lg text-center bg-green-50 text-green-700 font-bold">واتساب</button>
                <button onClick={() => setSelectedLead(lead)} className="flex-1 py-2 rounded-lg text-center bg-blue-50 text-blue-700 font-bold">نتيجة</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {selectedLead && (
        <div className="fixed inset-0 bg-black/50 z-50 p-4 flex items-center justify-center">
          <div className="bg-white rounded-2xl w-full max-w-xl overflow-hidden">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="font-bold text-slate-800">نتيجة إعادة التواصل - {selectedLead.name}</h3>
              <button onClick={() => setSelectedLead(null)}><X size={20} /></button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="text-sm font-bold text-slate-700 mb-2 block">النتيجة</label>
                <select className="input-field" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                  {OUTCOME_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-bold text-slate-700 mb-2 block">وسيلة التواصل</label>
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => setSource('CALL')} className={clsx('py-2 rounded-xl border-2 font-bold', source === 'CALL' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200')}>مكالمة</button>
                  <button onClick={() => setSource('SEND')} className={clsx('py-2 rounded-xl border-2 font-bold', source === 'SEND' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200')}>رسالة</button>
                </div>
              </div>
              {outcome === 'NO_ANSWER' && (
                <div>
                  <label className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-2"><CalendarClock size={16} />تحديد موعد إعادة المحاولة</label>
                  <input type="datetime-local" className="input-field" value={scheduleNextAt} onChange={(e) => setScheduleNextAt(e.target.value)} />
                </div>
              )}
              <div>
                <label className="text-sm font-bold text-slate-700 mb-2 block">ملاحظات</label>
                <textarea className="input-field min-h-[90px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              <button onClick={submitOutcome} disabled={saving || (outcome === 'NO_ANSWER' && !scheduleNextAt)} className="btn-primary w-full flex items-center justify-center gap-2">
                <Check size={18} />
                {saving ? 'جارٍ الحفظ...' : 'حفظ النتيجة'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
