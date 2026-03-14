import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Activity, ArrowRight, BarChart3, Download, Loader2, Target } from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import api from '../../services/api';

interface PerformanceRow {
  date: string;
  calls: number;
  agreed: number;
  rejected: number;
  hesitant: number;
  wrongNumber: number;
}

interface EmployeePerformancePayload {
  employee: {
    id: number;
    name: string;
    email: string;
    team?: { id: number; name: string } | null;
    isActive: boolean;
    dailyCallTarget: number;
    dailyApprovalTarget: number;
  };
  periodDays: number;
  totals: {
    calls: number;
    agreed: number;
    rejected: number;
    hesitant: number;
    wrongNumber: number;
    callTarget: number;
    approvalTarget: number;
    target: number;
    callsCompletionRate: number;
    approvalsCompletionRate: number;
    completionRate: number;
  };
  series: PerformanceRow[];
}

export default function EmployeePerformance() {
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const employeeId = Number(params.id || 0);
  const [days, setDays] = useState(14);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [payload, setPayload] = useState<EmployeePerformancePayload | null>(null);

  const fetchData = async () => {
    if (!employeeId) return;
    setLoading(true);
    setError('');
    try {
      const response = await api.get(`/admin/employees/${employeeId}/performance`, { params: { days } });
      setPayload(response.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'تعذر تحميل أداء الموظف');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, [employeeId, days]);

  const activityLevel = useMemo(() => {
    if (!payload) return 'غير متاح';
    if (payload.totals.completionRate >= 100) return 'نشط جدًا';
    if (payload.totals.completionRate >= 70) return 'نشط';
    if (payload.totals.completionRate >= 40) return 'متوسط';
    return 'غير نشط';
  }, [payload]);

  const exportActiveEmployees = async () => {
    try {
      const response = await api.get('/admin/employees/export-active', { responseType: 'blob' });
      const blobUrl = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = 'active-employees.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch {
      setError('تعذر تصدير الموظفين النشطين');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <button className="btn-secondary flex items-center gap-2" onClick={() => navigate('/admin/teams')}>
          <ArrowRight size={16} />
          رجوع لإدارة الفرق
        </button>
        <div className="flex-1">
          <h2 className="text-3xl font-bold text-slate-800">تحليل أداء الموظف</h2>
          <p className="text-slate-600">متابعة يومية للتارجت، النشاط، ومخرجات التواصل</p>
        </div>
        <button className="btn-secondary flex items-center gap-2" onClick={exportActiveEmployees}>
          <Download size={16} />
          تصدير النشطين
        </button>
      </div>

      <div className="glass-card p-4 flex flex-col md:flex-row md:items-center gap-3">
        <div className="text-sm text-slate-600">الفترة الزمنية</div>
        <select className="input-field md:max-w-44" value={days} onChange={(e) => setDays(Number(e.target.value) || 14)}>
          <option value={7}>آخر 7 أيام</option>
          <option value={14}>آخر 14 يوم</option>
          <option value={30}>آخر 30 يوم</option>
          <option value={60}>آخر 60 يوم</option>
        </select>
      </div>

      {loading ? (
        <div className="glass-card p-10 flex justify-center text-slate-500"><Loader2 className="animate-spin" /></div>
      ) : error ? (
        <div className="glass-card p-4 border border-red-200 text-red-700">{error}</div>
      ) : payload ? (
        <>
          <div className="glass-card p-6">
            <h3 className="text-xl font-bold text-slate-800">{payload.employee.name}</h3>
            <p className="text-sm text-slate-500">{payload.employee.email} • {payload.employee.team?.name || 'بدون فريق'}</p>
            <p className="text-sm mt-2">الحالة: <span className={`font-bold ${activityLevel.includes('غير') ? 'text-red-600' : 'text-emerald-600'}`}>{activityLevel}</span></p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <div className="glass-card p-4 text-center"><p className="text-xs text-slate-500">إجمالي المكالمات</p><p className="font-bold text-blue-700">{payload.totals.calls}</p></div>
            <div className="glass-card p-4 text-center"><p className="text-xs text-slate-500">موافق</p><p className="font-bold text-emerald-700">{payload.totals.agreed}</p></div>
            <div className="glass-card p-4 text-center"><p className="text-xs text-slate-500">متردد</p><p className="font-bold text-amber-700">{payload.totals.hesitant}</p></div>
            <div className="glass-card p-4 text-center"><p className="text-xs text-slate-500">مرفوض</p><p className="font-bold text-red-700">{payload.totals.rejected}</p></div>
            <div className="glass-card p-4 text-center"><p className="text-xs text-slate-500">رقم خاطئ</p><p className="font-bold text-rose-700">{payload.totals.wrongNumber}</p></div>
            <div className="glass-card p-4 text-center"><p className="text-xs text-slate-500">تحقيق الهدف</p><p className="font-bold text-indigo-700">{payload.totals.completionRate}%</p></div>
          </div>

          <div className="glass-card p-6">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 size={18} className="text-indigo-600" />
              <h4 className="font-bold text-slate-800">منحنى الأداء اليومي</h4>
            </div>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={payload.series}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="calls" stroke="#3b82f6" strokeWidth={3} dot={false} />
                  <Line type="monotone" dataKey="agreed" stroke="#10b981" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="wrongNumber" stroke="#e11d48" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 grid md:grid-cols-2 gap-3 text-sm">
              <div className="p-3 rounded-xl bg-slate-100 flex items-center gap-2"><Target size={16} /> هدف المكالمات الكلي: {payload.totals.callTarget}</div>
              <div className="p-3 rounded-xl bg-slate-100 flex items-center gap-2"><Target size={16} /> هدف الموافقات الكلي: {payload.totals.approvalTarget}</div>
              <div className="p-3 rounded-xl bg-slate-100 flex items-center gap-2"><Activity size={16} /> هدف المكالمات اليومي: {payload.employee.dailyCallTarget}</div>
              <div className="p-3 rounded-xl bg-slate-100 flex items-center gap-2"><Activity size={16} /> هدف الموافقات اليومي: {payload.employee.dailyApprovalTarget}</div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
