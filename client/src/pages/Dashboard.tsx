import { useEffect, useRef, useState } from 'react';
import {
  Users, 
  CheckCircle2, 
  HelpCircle, 
  XCircle,
  Database,
  Download,
  Table2
} from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../store/useAuth';
import { 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { useNavigate } from 'react-router-dom';

interface Stats {
  total: number;
  agreed: number;
  hesitant: number;
  rejected: number;
  noAnswer?: number;
  wrongNumber?: number;
  poolCount?: number;
  callsToday?: number;
  callsYesterday?: number;
  dailyCallTarget?: number | null;
  recontact?: number;
  scope?: 'GLOBAL' | 'TEAM' | 'AGENT';
}

export default function Dashboard() {
  const REFRESH_INTERVAL_MS = 8000;
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats>({ total: 0, agreed: 0, hesitant: 0, rejected: 0, poolCount: 0 });
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const isFetchingRef = useRef(false);

  const fetchStats = async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    try {
      const response = await api.get('/stats');
      setStats(response.data);
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
    }
  };

  useEffect(() => {
    void fetchStats();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchStats();
      }
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, []);

  const claimLead = async () => {
    setClaiming(true);
    try {
      const response = await api.post('/leads/claim');
      await fetchStats();
      const leadId = response.data?.id;
      if (leadId) {
        navigate(`/leads/new?claimId=${leadId}`, { state: { claimedLead: response.data } });
      }
    } catch (error: any) {
      alert(error.response?.data?.error || 'لا توجد عملاء متاحين في المجمع حالياً');
    } finally {
      setClaiming(false);
    }
  };

  const statCards = [
    { label: 'إجمالي عملائي', value: stats.total, icon: Users, color: 'text-blue-600', bg: 'bg-blue-100' },
    { label: 'وافقوا', value: stats.agreed, icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-100' },
    { label: 'مترددين', value: stats.hesitant, icon: HelpCircle, color: 'text-amber-600', bg: 'bg-amber-100' },
    { label: 'رفضوا', value: stats.rejected, icon: XCircle, color: 'text-red-600', bg: 'bg-red-100' },
    { label: 'لم يرد', value: stats.noAnswer || 0, icon: HelpCircle, color: 'text-sky-600', bg: 'bg-sky-100' },
    { label: 'أرقام خاطئة', value: stats.wrongNumber || 0, icon: XCircle, color: 'text-rose-600', bg: 'bg-rose-100' },
    { label: 'إعادة تواصل', value: stats.recontact || 0, icon: HelpCircle, color: 'text-indigo-600', bg: 'bg-indigo-100' },
  ];

  if (user?.role === 'ADMIN' || user?.role === 'TEAM_LEAD') {
    statCards.unshift({ label: 'المجمع (غير موزع)', value: stats.poolCount || 0, icon: Database, color: 'text-purple-600', bg: 'bg-purple-100' });
  }

  const data = [
    { name: 'وافقوا', value: stats.agreed, color: '#10b981' },
    { name: 'مترددين', value: stats.hesitant, color: '#f59e0b' },
    { name: 'رفضوا', value: stats.rejected, color: '#ef4444' },
    { name: 'لم يرد', value: stats.noAnswer || 0, color: '#0ea5e9' },
    { name: 'رقم خاطئ', value: stats.wrongNumber || 0, color: '#e11d48' },
    { name: 'إعادة تواصل', value: stats.recontact || 0, color: '#6366f1' },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold text-slate-800 mb-2">لوحة التحكم</h2>
          <p className="text-slate-600">أهلاً بك، {user?.name}</p>
        </div>
        
        {user?.role !== 'ADMIN' ? (
          <button
            onClick={claimLead}
            disabled={claiming}
            className="btn-primary flex items-center gap-2 animate-pulse hover:animate-none"
          >
            <Download size={20} />
            <span>سحب عميل جديد</span>
          </button>
        ) : (
          <button
            onClick={() => navigate('/admin/pooled-numbers')}
            className="btn-secondary flex items-center gap-2"
          >
            <Table2 size={18} />
            <span>عرض الداتا المجمعة</span>
          </button>
        )}
      </div>

      <div className={`grid grid-cols-2 ${(user?.role === 'ADMIN' || user?.role === 'TEAM_LEAD') ? 'md:grid-cols-8' : 'md:grid-cols-7'} gap-4 md:gap-6`}>
        {statCards.map((stat, index) => (
          <div key={index} className="glass-card p-6 flex flex-col items-center justify-center text-center hover:scale-105 transition-transform duration-300">
            <div className={`w-12 h-12 rounded-2xl ${stat.bg} flex items-center justify-center mb-4 shadow-sm`}>
              <stat.icon className={`w-6 h-6 ${stat.color}`} />
            </div>
            <p className={`text-3xl font-bold ${stat.color} mb-1`}>{loading ? '...' : stat.value}</p>
            <p className="text-sm text-slate-600 font-medium">{stat.label}</p>
          </div>
        ))}
      </div>

      {(user?.role === 'SALES' || user?.role === 'TEAM_LEAD') && (
        <div className="glass-card p-6">
          <h3 className="text-lg font-bold text-slate-800 mb-3">{user?.role === 'TEAM_LEAD' ? 'هدف الفريق اليومي' : 'هدف المكالمات اليومي'}</h3>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-slate-600">التقدم اليوم</p>
            <p className="font-bold text-slate-800">
              {stats.callsToday || 0} / {stats.dailyCallTarget || 0}
            </p>
          </div>
          <p className="text-xs text-slate-500 mb-2">مكالمات أمس: {stats.callsYesterday || 0}</p>
          <div className="w-full h-3 rounded-full bg-slate-200 overflow-hidden">
            <div
              className="h-full bg-emerald-500"
              style={{
                width: `${Math.min(
                  100,
                  Math.round(((stats.callsToday || 0) / Math.max(1, stats.dailyCallTarget || 1)) * 100)
                )}%`,
              }}
            />
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <div className="glass-card p-6">
          <h3 className="text-xl font-bold text-slate-800 mb-6">توزيع الحالات</h3>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {data.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="glass-card p-6">
          <h3 className="text-xl font-bold text-slate-800 mb-6">أداء الفريق</h3>
          <div className="h-64 w-full flex items-center justify-center text-slate-400">
            <p>{(user?.role === 'ADMIN' || user?.role === 'TEAM_LEAD') ? 'جاري تجميع بيانات الفريق...' : 'خاص بالمدير فقط'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
