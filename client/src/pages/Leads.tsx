import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { 
  Search, 
  Filter, 
  Plus, 
  Phone, 
  MessageCircle,
  Crown,
  Edit,
  Trash2
} from 'lucide-react';
import clsx from 'clsx';
import EditLeadModal from '../components/EditLeadModal';
import { toWhatsAppNumber } from '../utils/whatsapp';
import { useAuth } from '../store/useAuth';

interface Lead {
  id: number;
  name: string;
  phone: string;
  whatsappPhone?: string;
  gender?: 'MALE' | 'FEMALE' | 'UNKNOWN';
  status: string;
  source: string;
  notes?: string;
  agent?: { name: string; email: string };
  createdAt: string;
}

export default function Leads() {
  const REFRESH_INTERVAL_MS = 250;
  const { user } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [deletingLeadId, setDeletingLeadId] = useState<number | null>(null);
  const isFetchingRef = useRef(false);

  const fetchLeads = async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    try {
      const response = await api.get('/leads');
      setLeads(response.data);
    } catch (error) {
      console.error('Failed to fetch leads:', error);
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
    }
  };

  useEffect(() => {
    void fetchLeads();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchLeads();
      }
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, []);

  const filteredLeads = leads
    .filter((lead) =>
      lead.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.phone.includes(searchTerm),
    )
    .filter((lead) => filterStatus === 'ALL' || lead.status === filterStatus);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'AGREED': return 'bg-emerald-100 text-emerald-700';
      case 'HESITANT': return 'bg-amber-100 text-amber-700';
      case 'REJECTED': return 'bg-red-100 text-red-700';
      case 'SPONSOR': return 'bg-yellow-100 text-yellow-700 border-yellow-300';
      case 'NO_ANSWER': return 'bg-blue-100 text-blue-700';
      case 'RECONTACT': return 'bg-indigo-100 text-indigo-700';
      default: return 'bg-slate-100 text-slate-700';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'SPONSOR': return 'سبونسر';
      case 'NO_ANSWER': return 'مردش';
      case 'RECONTACT': return 'إعادة تواصل';
      case 'AGREED': return 'موافق';
      case 'HESITANT': return 'متردد';
      case 'REJECTED': return 'مرفوض';
      case 'NEW': return 'جديد';
      default: return status;
    }
  };

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

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold text-slate-800">إدارة العملاء</h2>
          <p className="text-slate-600">قائمة بجميع العملاء المحتملين والحاليين</p>
        </div>
        <Link 
          to="/leads/new" 
          className="btn-primary flex items-center gap-2"
        >
          <Plus size={20} />
          <span>إضافة عميل جديد</span>
        </Link>
      </div>

      <div className="glass-card p-4 flex flex-col md:flex-row gap-4 items-center">
        <div className="relative flex-1 w-full">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
          <input 
            type="text" 
            placeholder="بحث بالاسم أو رقم الهاتف..." 
            className="input-field pr-10"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 w-full md:w-auto">
          <Filter className="text-slate-400" size={20} />
          <select 
            className="input-field"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="ALL">كل الحالات</option>
            <option value="NEW">جديد</option>
            <option value="AGREED">موافق</option>
            <option value="HESITANT">متردد</option>
            <option value="REJECTED">مرفوض</option>
            <option value="SPONSOR">سبونسر</option>
            <option value="NO_ANSWER">لم يرد</option>
            <option value="RECONTACT">إعادة تواصل</option>
            <option value="WRONG_NUMBER">أرقام خاطئة</option>
          </select>
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
                <th className="p-4 font-semibold text-slate-600">المصدر</th>
                <th className="p-4 font-semibold text-slate-600">الموظف</th>
                <th className="p-4 font-semibold text-slate-600">تاريخ الإضافة</th>
                <th className="p-4 font-semibold text-slate-600">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">جاري التحميل...</td>
                </tr>
              ) : filteredLeads.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">لا توجد بيانات</td>
                </tr>
              ) : (
                filteredLeads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="p-4 font-medium text-slate-800 flex items-center gap-2">
                      {lead.status === 'SPONSOR' && <Crown size={16} className="text-yellow-500 fill-yellow-500" />}
                      {lead.name}
                    </td>
                    <td className="p-4 font-mono text-slate-600" dir="ltr">{lead.phone}</td>
                    <td className="p-4">
                      <span className={clsx("px-3 py-1 rounded-full text-xs font-bold", getStatusColor(lead.status))}>
                        {getStatusLabel(lead.status)}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        {lead.source === 'CALL' ? (
                          <Phone size={16} className="text-emerald-500" />
                        ) : lead.source === 'POOL' ? (
                          <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">POOL</span>
                        ) : (
                          <MessageCircle size={16} className="text-blue-500" />
                        )}
                      </div>
                    </td>
                    <td className="p-4 text-slate-600 text-sm">
                      {lead.agent?.name || '-'}
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
                  <span className={clsx("px-2 py-1 rounded-full text-xs font-bold", getStatusColor(lead.status))}>{getStatusLabel(lead.status)}</span>
                </div>
                <p className="font-mono text-sm text-slate-600" dir="ltr">{lead.phone}</p>
                <p className="text-xs text-slate-500">{lead.agent?.name || '-'} • {new Date(lead.createdAt).toLocaleDateString('ar-EG')}</p>
                <div className="grid grid-cols-2 gap-2">
                  <a href={`tel:${lead.phone}`} className="py-2 rounded-lg bg-emerald-50 text-emerald-700 text-center font-bold">اتصال</a>
                  <button onClick={() => openWhatsApp(lead.whatsappPhone || lead.phone)} className="py-2 rounded-lg bg-green-50 text-green-700 text-center font-bold">واتساب</button>
                  <button onClick={() => setSelectedLead(lead)} className="py-2 rounded-lg bg-blue-50 text-blue-700 text-center font-bold">تعديل</button>
                  {user?.role === 'ADMIN' ? (
                    <button onClick={() => deleteLead(lead)} className="py-2 rounded-lg bg-red-50 text-red-700 text-center font-bold">حذف</button>
                  ) : <div />}
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
    </div>
  );
}
