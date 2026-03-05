import { useEffect, useState } from 'react';
import { Search, Phone, MessageCircle, Edit, Trash2, CalendarClock, X, Check } from 'lucide-react';
import api from '../services/api';
import EditLeadModal from '../components/EditLeadModal';
import { toWhatsAppNumber } from '../utils/whatsapp';
import { useAuth } from '../store/useAuth';

interface Lead {
  id: number;
  name: string;
  phone: string;
  whatsappPhone?: string;
  status: string;
  source: string;
  notes?: string;
  gender?: 'MALE' | 'FEMALE' | 'UNKNOWN';
  createdAt: string;
}

export default function NoAnswerLeads() {
  const { user } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [deletingLeadId, setDeletingLeadId] = useState<number | null>(null);
  const [schedulingLead, setSchedulingLead] = useState<Lead | null>(null);
  const [nextContactAt, setNextContactAt] = useState('');
  const [savingSchedule, setSavingSchedule] = useState(false);

  const fetchLeads = async () => {
    try {
      const response = await api.get('/leads');
      const noAnswerLeads = (response.data || []).filter(
        (lead: Lead) => lead.status === 'NO_ANSWER' && lead.source !== 'POOL',
      );
      setLeads(noAnswerLeads);
    } catch (error) {
      console.error('Failed to fetch no answer leads:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeads();
  }, []);

  const filteredLeads = leads.filter((lead) =>
    lead.name.toLowerCase().includes(searchTerm.toLowerCase()) || lead.phone.includes(searchTerm),
  );

  const handleLeadUpdate = () => {
    fetchLeads();
    setSelectedLead(null);
  };

  const openWhatsApp = (phone: string) => {
    const formatted = toWhatsAppNumber(phone);
    if (!formatted) return;
    window.open(`https://wa.me/${formatted}`, '_blank', 'noopener,noreferrer');
  };

  const deleteLead = async (lead: Lead) => {
    if (user?.role !== 'ADMIN') return;
    const confirmed = window.confirm(`هل تريد حذف العميل "${lead.name}" نهائياً؟`);
    if (!confirmed) return;
    setDeletingLeadId(lead.id);
    try {
      await api.delete(`/leads/${lead.id}`);
      await fetchLeads();
    } catch (error) {
      console.error('Failed to delete lead:', error);
    } finally {
      setDeletingLeadId(null);
    }
  };

  const openSchedule = (lead: Lead) => {
    setSchedulingLead(lead);
    const date = new Date();
    date.setDate(date.getDate() + 1);
    date.setHours(11, 0, 0, 0);
    setNextContactAt(date.toISOString().slice(0, 16));
  };

  const scheduleRecontact = async () => {
    if (!schedulingLead || !nextContactAt) return;
    setSavingSchedule(true);
    try {
      await api.post(`/leads/${schedulingLead.id}/recontact/schedule`, {
        nextContactAt: new Date(nextContactAt).toISOString(),
      });
      setSchedulingLead(null);
      await fetchLeads();
    } catch (error) {
      console.error('Failed to schedule recontact:', error);
    } finally {
      setSavingSchedule(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-slate-800">عملاء مردوش</h2>
        <p className="text-slate-600">قائمة مستقلة للمتابعة وإعادة التواصل</p>
      </div>

      <div className="glass-card p-4">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
          <input
            type="text"
            placeholder="بحث بالاسم أو رقم الهاتف..."
            className="input-field pr-10"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-right">
            <thead className="bg-slate-50/50 border-b border-slate-100">
              <tr>
                <th className="p-4 font-semibold text-slate-600">الاسم</th>
                <th className="p-4 font-semibold text-slate-600">رقم الهاتف</th>
                <th className="p-4 font-semibold text-slate-600">الحالة</th>
                <th className="p-4 font-semibold text-slate-600">تاريخ الإضافة</th>
                <th className="p-4 font-semibold text-slate-600">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-500">جاري التحميل...</td>
                </tr>
              ) : filteredLeads.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-500">لا توجد بيانات</td>
                </tr>
              ) : (
                filteredLeads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="p-4 font-medium text-slate-800">{lead.name}</td>
                    <td className="p-4 font-mono text-slate-600" dir="ltr">{lead.phone}</td>
                    <td className="p-4">
                      <span className="px-3 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-700">
                        مردش
                      </span>
                    </td>
                    <td className="p-4 text-slate-500 text-sm">
                      {new Date(lead.createdAt).toLocaleDateString('ar-EG')}
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <a
                          href={`tel:${lead.phone}`}
                          className="p-2 hover:bg-emerald-100 rounded-lg text-emerald-600 transition-colors"
                          title="اتصال"
                        >
                          <Phone size={18} />
                        </a>
                        <button
                          onClick={() => openWhatsApp(lead.whatsappPhone || lead.phone)}
                          className="p-2 hover:bg-green-100 rounded-lg text-green-600 transition-colors"
                          title="واتساب"
                        >
                          <MessageCircle size={18} />
                        </button>
                        <button
                          onClick={() => setSelectedLead(lead)}
                          className="p-2 hover:bg-blue-100 rounded-lg text-blue-600 transition-colors"
                          title="تعديل"
                        >
                          <Edit size={18} />
                        </button>
                        <button
                          onClick={() => openSchedule(lead)}
                          className="p-2 hover:bg-indigo-100 rounded-lg text-indigo-600 transition-colors"
                          title="جدولة إعادة تواصل"
                        >
                          <CalendarClock size={18} />
                        </button>
                        {user?.role === 'ADMIN' && (
                          <button
                            onClick={() => deleteLead(lead)}
                            disabled={deletingLeadId === lead.id}
                            className="p-2 hover:bg-red-100 rounded-lg text-red-600 transition-colors disabled:opacity-50"
                            title="حذف"
                          >
                            <Trash2 size={18} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="md:hidden divide-y divide-slate-100">
          {loading ? (
            <div className="p-6 text-center text-slate-500">جاري التحميل...</div>
          ) : filteredLeads.length === 0 ? (
            <div className="p-6 text-center text-slate-500">لا توجد بيانات</div>
          ) : (
            filteredLeads.map((lead) => (
              <div key={lead.id} className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-800">{lead.name}</h3>
                  <span className="px-2 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-700">مردش</span>
                </div>
                <p className="font-mono text-sm text-slate-600" dir="ltr">{lead.phone}</p>
                <p className="text-xs text-slate-500">{new Date(lead.createdAt).toLocaleDateString('ar-EG')}</p>
                <div className="grid grid-cols-2 gap-2">
                  <a href={`tel:${lead.phone}`} className="py-2 rounded-lg bg-emerald-50 text-emerald-700 text-center font-bold">اتصال</a>
                  <button onClick={() => openWhatsApp(lead.whatsappPhone || lead.phone)} className="py-2 rounded-lg bg-green-50 text-green-700 text-center font-bold">واتساب</button>
                  <button onClick={() => setSelectedLead(lead)} className="py-2 rounded-lg bg-blue-50 text-blue-700 text-center font-bold">تعديل</button>
                  <button onClick={() => openSchedule(lead)} className="py-2 rounded-lg bg-indigo-50 text-indigo-700 text-center font-bold">جدولة</button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {selectedLead && (
        <EditLeadModal
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onUpdate={handleLeadUpdate}
        />
      )}

      {schedulingLead && (
        <div className="fixed inset-0 bg-black/50 z-50 p-4 flex items-center justify-center">
          <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-bold text-slate-800">جدولة إعادة التواصل</h3>
              <button onClick={() => setSchedulingLead(null)}><X size={20} /></button>
            </div>
            <div className="p-4 space-y-4">
              <p className="text-sm text-slate-600">العميل: <span className="font-bold text-slate-800">{schedulingLead.name}</span></p>
              <input
                type="datetime-local"
                className="input-field"
                value={nextContactAt}
                onChange={(e) => setNextContactAt(e.target.value)}
              />
              <button onClick={scheduleRecontact} disabled={savingSchedule || !nextContactAt} className="btn-primary w-full flex items-center justify-center gap-2">
                <Check size={18} />
                {savingSchedule ? 'جارٍ الحفظ...' : 'نقل إلى إعادة التواصل'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
