import { useEffect, useRef, useState } from 'react';
import {
  Users, 
  CheckCircle2, 
  HelpCircle, 
  XCircle,
  Database,
  Download,
  Table2,
  Trophy,
  Medal,
  Crown,
  TrendingUp,
  Filter,
  MessageCircle,
  PieChart as PieChartIcon,
  BellRing
} from 'lucide-react';
import clsx from 'clsx';
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
  approvalsToday?: number;
  approvalsYesterday?: number;
  dailyApprovalTarget?: number | null;
  recontact?: number;
  scope?: 'GLOBAL' | 'TEAM' | 'AGENT';
  teamMembersPerformance?: Array<{
    userId: number;
    name: string;
    dailyCallTarget: number;
    dailyApprovalTarget?: number;
    callsToday: number;
    agreedToday: number;
    phone?: string | null;
  }>;
  leaderboard?: Array<{
    userId: number;
    name: string;
    callsToday: number;
    agreedToday: number;
    dailyCallTarget: number;
    dailyApprovalTarget?: number;
  }>;
}

interface Team {
  id: number;
  name: string;
}

export default function Dashboard() {
  const REFRESH_INTERVAL_MS = 15000;
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats>({ total: 0, agreed: 0, hesitant: 0, rejected: 0, poolCount: 0 });
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<number | ''>('');
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [testingNotification, setTestingNotification] = useState(false);
  const isFetchingRef = useRef(false);
  const invalidateTimerRef = useRef<number | null>(null);

  const fetchTeams = async () => {
    if (user?.role !== 'ADMIN') return;
    try {
      const response = await api.get('/teams');
      setTeams(response.data || []);
    } catch (error) {
      console.error('Failed to fetch teams:', error);
    }
  };

  const fetchStats = async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    try {
      const params = selectedTeamId ? { teamId: selectedTeamId } : {};
      const response = await api.get('/stats', { params });
      setStats(response.data);
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
    }
  };

  useEffect(() => {
    fetchTeams();
  }, [user?.role]);

  useEffect(() => {
    void fetchStats();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchStats();
      }
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [selectedTeamId]);

  useEffect(() => {
    const onInvalidate = () => {
      if (document.visibilityState !== 'visible') return;
      if (invalidateTimerRef.current) {
        window.clearTimeout(invalidateTimerRef.current);
      }
      invalidateTimerRef.current = window.setTimeout(() => {
        void fetchStats();
      }, 180);
    };
    window.addEventListener('crm:invalidate', onInvalidate as any);
    return () => {
      window.removeEventListener('crm:invalidate', onInvalidate as any);
      if (invalidateTimerRef.current) {
        window.clearTimeout(invalidateTimerRef.current);
        invalidateTimerRef.current = null;
      }
    };
  }, [selectedTeamId]);

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

  const testNotification = async () => {
    setTestingNotification(true);
    try {
      await api.get('/notifications/test');
      alert('سيصلك إشعار تجريبي خلال لحظات.. تأكد من تفعيل الإشعارات في المتصفح');
    } catch (error: any) {
      alert(error.response?.data?.error || 'فشل إرسال الإشعار التجريبي. تأكد من اشتراكك في الإشعارات أولاً.');
    } finally {
      setTestingNotification(false);
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

  const userRank = stats.leaderboard?.findIndex(l => l.userId === user?.id) ?? -1;
  const isTopThree = userRank >= 0 && userRank < 3;
  const displayLeaderboard = stats.leaderboard?.slice(0, 3) || [];
  const userStats = userRank >= 3 ? stats.leaderboard?.[userRank] : null;

  return (
    <div className="space-y-6 md:space-y-8 pb-10">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="flex flex-col md:flex-row md:items-center gap-4 w-full md:w-auto">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold text-slate-800 mb-1">لوحة التحكم</h2>
            <p className="text-slate-500 text-sm md:text-base flex items-center gap-2 font-medium">
              أهلاً بك، {user?.name}
              {isTopThree && <Crown className="w-4 h-4 text-amber-500 animate-bounce" />}
            </p>
          </div>
          {user?.role === 'ADMIN' && (
            <div className="relative group w-full md:w-auto">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-hover:text-indigo-500 transition-colors" />
              <select
                value={selectedTeamId}
                onChange={(e) => setSelectedTeamId(e.target.value ? Number(e.target.value) : '')}
                className="input-field pl-9 min-w-full md:min-w-[220px] h-11 text-sm bg-white/50 backdrop-blur-sm border-slate-200 hover:border-indigo-300 focus:ring-2 focus:ring-indigo-100 transition-all cursor-pointer appearance-none rounded-xl font-bold"
              >
                <option value="">كل الفرق</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    فريق: {team.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        
        <div className="flex flex-col md:flex-row items-center gap-3 w-full md:w-auto">
          <button
            onClick={testNotification}
            disabled={testingNotification}
            className="btn-secondary w-full md:w-auto flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-slate-200 hover:border-emerald-500 hover:text-emerald-600 transition-all font-bold group"
            title="تجربة وصول الإشعارات"
          >
            <BellRing size={18} className={clsx(testingNotification && "animate-ring")} />
            <span>تجربة الإشعارات</span>
          </button>

          {user?.role !== 'ADMIN' ? (
            <button
              onClick={claimLead}
              disabled={claiming}
              className="btn-primary w-full md:w-auto flex items-center justify-center gap-3 px-6 py-3 rounded-xl shadow-lg shadow-indigo-200 hover:shadow-indigo-300 transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100 group"
            >
              <Download size={20} className="group-hover:animate-bounce" />
              <span className="font-bold">سحب عميل جديد</span>
            </button>
          ) : (
            <button
              onClick={() => navigate('/admin/pooled-numbers')}
              className="btn-secondary w-full md:w-auto flex items-center justify-center gap-3 px-6 py-3 rounded-xl border-2 border-slate-200 hover:border-indigo-500 hover:text-indigo-600 transition-all font-bold"
            >
              <Table2 size={20} />
              <span>عرض الداتا المجمعة</span>
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-3 md:gap-4">
        {statCards.map((stat, index) => (
          <div key={index} className="glass-card p-4 md:p-5 flex flex-col items-center justify-center text-center hover:translate-y-[-4px] hover:shadow-xl transition-all duration-300 group border-b-2 border-transparent hover:border-indigo-500">
            <div className={`w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl ${stat.bg} flex items-center justify-center mb-3 shadow-inner group-hover:scale-110 transition-transform`}>
              <stat.icon className={`w-5 h-5 md:w-6 md:h-6 ${stat.color}`} />
            </div>
            <p className={`text-xl md:text-2xl font-black ${stat.color} mb-0.5 tracking-tight`}>{loading ? '...' : stat.value}</p>
            <p className="text-[10px] md:text-xs text-slate-500 font-bold uppercase tracking-wider">{stat.label}</p>
          </div>
        ))}
      </div>

      {(user?.role === 'SALES' || user?.role === 'TEAM_LEAD') && (() => {
        const callsToday = stats.callsToday || 0;
        const approvalsToday = stats.approvalsToday || 0;
        const callTarget = stats.dailyCallTarget || 30;
        const approvalTarget = stats.dailyApprovalTarget || 0;
        const done = callsToday >= callTarget && approvalsToday >= approvalTarget;
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="glass-card p-5 md:p-6 border-l-4 border-indigo-500 overflow-hidden relative group">
              <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:scale-110 transition-transform duration-700">
                <TrendingUp size={120} />
              </div>
              <div className="relative z-10">
                <h3 className="text-base md:text-lg font-black text-slate-800 mb-4 flex items-center gap-2">
                  <Trophy size={20} className="text-amber-500" />
                  {user?.role === 'TEAM_LEAD' ? 'هدف مكالمات الفريق' : 'هدف المكالمات'}
                </h3>
                <div className="flex items-end justify-between mb-3">
                  <div>
                    <p className="text-2xl md:text-3xl font-black text-slate-900 leading-none">
                      {callsToday}
                      <span className="text-slate-400 text-sm md:text-lg font-medium mx-2">/ {callTarget}</span>
                    </p>
                    <p className="text-xs text-slate-500 font-bold mt-2 uppercase tracking-widest">المكالمات المنجزة</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg md:text-xl font-black text-indigo-600">
                      {Math.min(100, Math.round((callsToday / Math.max(1, callTarget)) * 100))}%
                    </p>
                    <p className="text-[10px] text-slate-400 font-bold">نسبة الإنجاز</p>
                  </div>
                </div>
                <div className="w-full h-3 md:h-4 rounded-full bg-slate-100 overflow-hidden shadow-inner border border-slate-50">
                  <div
                    className={clsx(
                      "h-full transition-all duration-1000 ease-out rounded-full shadow-sm",
                      callsToday >= callTarget ? "bg-gradient-to-r from-emerald-400 to-emerald-600" : "bg-gradient-to-r from-indigo-400 to-indigo-600"
                    )}
                    style={{
                      width: `${Math.min(100, Math.round((callsToday / Math.max(1, callTarget)) * 100))}%`,
                    }}
                  />
                </div>
                <div className="flex justify-between mt-3">
                  <p className="text-[10px] md:text-xs text-slate-400 font-bold flex items-center gap-1">
                    <TrendingUp size={12} />
                    مكالمات أمس: {stats.callsYesterday || 0}
                  </p>
                </div>
              </div>
            </div>

            <div className="glass-card p-5 md:p-6 border-l-4 border-emerald-500 overflow-hidden relative group">
              <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:scale-110 transition-transform duration-700">
                <TrendingUp size={120} />
              </div>
              <div className="relative z-10">
                <h3 className="text-base md:text-lg font-black text-slate-800 mb-4 flex items-center gap-2">
                  <Trophy size={20} className="text-emerald-500" />
                  {user?.role === 'TEAM_LEAD' ? 'هدف موافقات الفريق' : 'هدف الموافقات'}
                </h3>
                <div className="flex items-end justify-between mb-3">
                  <div>
                    <p className="text-2xl md:text-3xl font-black text-slate-900 leading-none">
                      {approvalsToday}
                      <span className="text-slate-400 text-sm md:text-lg font-medium mx-2">/ {approvalTarget}</span>
                    </p>
                    <p className="text-xs text-slate-500 font-bold mt-2 uppercase tracking-widest">الموافقات المنجزة</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg md:text-xl font-black text-emerald-600">
                      {approvalTarget > 0 ? Math.min(100, Math.round((approvalsToday / Math.max(1, approvalTarget)) * 100)) : 100}%
                    </p>
                    <p className="text-[10px] text-slate-400 font-bold">نسبة الإنجاز</p>
                  </div>
                </div>
                <div className="w-full h-3 md:h-4 rounded-full bg-slate-100 overflow-hidden shadow-inner border border-slate-50">
                  <div
                    className={clsx(
                      "h-full transition-all duration-1000 ease-out rounded-full shadow-sm",
                      approvalsToday >= approvalTarget ? "bg-gradient-to-r from-emerald-400 to-emerald-600" : "bg-gradient-to-r from-indigo-400 to-indigo-600"
                    )}
                    style={{
                      width: `${approvalTarget > 0 ? Math.min(100, Math.round((approvalsToday / Math.max(1, approvalTarget)) * 100)) : 100}%`,
                    }}
                  />
                </div>
                <div className="flex justify-between mt-3">
                  <p className="text-[10px] md:text-xs text-slate-400 font-bold flex items-center gap-1">
                    <TrendingUp size={12} />
                    موافقات أمس: {stats.approvalsYesterday || 0}
                  </p>
                  {done && (
                    <p className="text-[10px] md:text-xs text-emerald-600 font-black animate-pulse">تم تحقيق الهدف بنجاح! 🎉</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8">
        <div className="glass-card p-5 md:p-8 flex flex-col h-full bg-white/80 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-xl font-black text-slate-800 tracking-tight">توزيع الحالات</h3>
            <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400">
              <PieChartIcon size={20} />
            </div>
          </div>
          <div className="h-[250px] md:h-[300px] w-full relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={window.innerWidth < 768 ? 65 : 85}
                  outerRadius={window.innerWidth < 768 ? 90 : 115}
                  paddingAngle={8}
                  dataKey="value"
                  stroke="none"
                >
                  {data.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} className="hover:opacity-80 transition-opacity cursor-pointer shadow-xl" />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 30px -5px rgba(0,0,0,0.1)', fontWeight: 'bold' }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none">
              <p className="text-2xl md:text-4xl font-black text-slate-800 leading-none">{stats.total}</p>
              <p className="text-[10px] md:text-xs text-slate-400 font-bold uppercase mt-1 tracking-widest">إجمالي العملاء</p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-8">
            {data.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2 p-2.5 rounded-xl hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-100">
                <div className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ backgroundColor: item.color }} />
                <span className="text-xs font-bold text-slate-600 truncate">{item.name}</span>
                <span className="text-xs font-black text-slate-900 mr-auto">{item.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 md:gap-8">
          <div className="glass-card p-5 md:p-8 flex flex-col h-full bg-gradient-to-br from-white to-slate-50/30">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-xl font-black text-slate-800 tracking-tight flex items-center gap-3">
                <Crown size={24} className="text-amber-500" />
                <span>وحوش السالز</span>
              </h3>
              <div className="px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-[10px] font-black uppercase tracking-widest">
                أبطال اليوم
              </div>
            </div>
            
            <div className="space-y-4 flex-1">
              {displayLeaderboard.map((member, idx) => (
                <div 
                  key={member.userId} 
                  className={clsx(
                    "p-4 md:p-5 rounded-2xl flex items-center gap-4 border transition-all duration-500 relative overflow-hidden group",
                    idx === 0 ? "bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200 shadow-lg shadow-amber-100/50 scale-[1.02]" : 
                    idx === 1 ? "bg-gradient-to-r from-slate-50 to-indigo-50 border-slate-200" : 
                    "bg-gradient-to-r from-orange-50/50 to-amber-50/30 border-orange-100"
                  )}
                >
                  {idx === 0 && <div className="absolute top-0 right-0 p-1 bg-amber-400 text-white rounded-bl-xl text-[10px] font-black uppercase px-3 shadow-sm">الأول</div>}
                  
                  <div className={clsx(
                    "w-10 h-10 md:w-14 md:h-14 rounded-2xl flex items-center justify-center font-black text-lg md:text-2xl shadow-md transition-transform group-hover:rotate-12",
                    idx === 0 ? "bg-gradient-to-br from-amber-300 to-amber-500 text-white" : 
                    idx === 1 ? "bg-gradient-to-br from-slate-200 to-slate-400 text-white" : 
                    "bg-gradient-to-br from-orange-200 to-orange-400 text-white"
                  )}>
                    {idx === 0 ? <Crown size={24} /> : idx === 1 ? <Medal size={24} /> : <Trophy size={20} />}
                  </div>
                  
                  <div className="flex-1">
                    <p className="font-black text-slate-800 text-sm md:text-lg tracking-tight">{member.name}</p>
                    <div className="flex items-center gap-3 mt-1">
                      <p className="text-[10px] md:text-xs font-bold text-slate-500 flex items-center gap-1 font-medium">
                        <TrendingUp size={12} className="text-emerald-500" />
                        {member.callsToday} مكالمة
                      </p>
                      <div className="w-1 h-1 rounded-full bg-slate-300" />
                      <p className="text-[10px] md:text-xs font-bold text-emerald-600 flex items-center gap-1 font-black">
                        <CheckCircle2 size={12} />
                        {member.agreedToday} موافق
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    <p className="text-xs md:text-sm font-black text-slate-400 italic">#{idx + 1}</p>
                  </div>
                </div>
              ))}

              {userStats && (
                <>
                  <div className="border-t-2 border-dashed border-slate-200 my-8 relative">
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white px-4 text-[10px] font-black text-slate-300 tracking-widest uppercase italic">ترتيبك</div>
                  </div>
                  <div className="p-5 rounded-2xl bg-gradient-to-r from-indigo-600 to-indigo-800 border border-indigo-500 shadow-xl shadow-indigo-100 animate-in fade-in slide-in-from-bottom-4 duration-700">
                    <div className="flex items-center gap-5">
                      <div className="w-12 h-12 md:w-14 md:h-14 rounded-2xl bg-white/20 backdrop-blur-md text-white flex items-center justify-center font-black text-xl md:text-2xl border border-white/30 shadow-inner">
                        {userRank + 1}
                      </div>
                      <div className="flex-1">
                        <p className="font-black text-white text-base md:text-xl tracking-tight">أداءك اليوم</p>
                        <p className="text-xs md:text-sm text-indigo-100 font-medium mt-0.5 opacity-90">أنت في المركز الـ {userRank + 1} على الشركة</p>
                      </div>
                    </div>
                    <div className="mt-5 p-4 bg-black/10 rounded-xl text-xs md:text-sm text-indigo-50 font-bold italic leading-relaxed text-center border border-white/5">
                      " {userRank < 10 ? "قربت جداً من الوحوش! شد حيلك وادخل في التوب 3 🚀" : "البداية صعبة بس أنت قدها، ركز وهتوصل للقمة! 💪"} "
                    </div>
                  </div>
                </>
              )}

              {isTopThree && (
                <div className="mt-6 p-5 rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-700 text-center shadow-lg shadow-emerald-100 animate-bounce border border-emerald-400">
                  <p className="text-white font-black text-base md:text-lg flex items-center justify-center gap-2">
                    <Crown size={20} />
                    أنت من وحوش اليوم! 👑
                  </p>
                  <p className="text-emerald-100 text-[10px] md:text-xs font-bold mt-1 uppercase tracking-widest">حافظ على مكانك في القمة</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="glass-card p-5 md:p-8 border-t-4 border-indigo-500 shadow-2xl shadow-slate-200/50">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <h3 className="text-xl md:text-2xl font-black text-slate-800 tracking-tight flex items-center gap-3">
            <Users size={28} className="text-indigo-500" />
            <span>أداء الفريق التفصيلي</span>
          </h3>
          <div className="flex items-center gap-2">
            <div className="px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-700 text-[10px] font-black flex items-center gap-1 shadow-sm">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              مباشر
            </div>
            <div className="text-[10px] font-bold text-slate-400">تحديث تلقائي كل 8 ثواني</div>
          </div>
        </div>

        {stats.teamMembersPerformance && stats.teamMembersPerformance.length > 0 ? (
          <div className="overflow-x-auto -mx-5 md:mx-0 custom-scrollbar">
            <table className="w-full text-right min-w-[700px]">
              <thead className="bg-slate-50/80 border-b border-slate-100">
                <tr>
                  <th className="p-4 text-xs font-black text-slate-500 uppercase tracking-widest">الموظف</th>
                  <th className="p-4 text-xs font-black text-slate-500 uppercase tracking-widest text-center">المكالمات</th>
                  <th className="p-4 text-xs font-black text-slate-500 uppercase tracking-widest text-center">وافقوا (اليوم)</th>
                  <th className="p-4 text-xs font-black text-slate-500 uppercase tracking-widest text-center">نسبة النجاح</th>
                  <th className="p-4 text-xs font-black text-slate-500 uppercase tracking-widest text-center">الحالة</th>
                  <th className="p-4 text-xs font-black text-slate-500 uppercase tracking-widest text-center">إجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stats.teamMembersPerformance.map((member) => {
                  const approvalTarget = member.dailyApprovalTarget ?? 0;
                  const isDone = member.callsToday >= member.dailyCallTarget && member.agreedToday >= approvalTarget;
                  const progress = Math.min(100, Math.round((member.callsToday / member.dailyCallTarget) * 100));
                  const successRate = member.callsToday > 0 
                    ? Math.round((member.agreedToday / member.callsToday) * 100) 
                    : 0;
                  
                  return (
                    <tr key={member.userId} className="hover:bg-indigo-50/30 transition-all group">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center font-black text-slate-500 group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-all duration-300 shadow-sm">
                            {member.name.charAt(0)}
                          </div>
                          <div>
                            <p className="font-black text-slate-800 text-sm md:text-base leading-tight group-hover:text-indigo-700 transition-colors">{member.name}</p>
                            <p className="text-[10px] text-slate-400 font-bold mt-1 uppercase tracking-tighter">الهدف: {member.dailyCallTarget}{approvalTarget > 0 ? ` / ${approvalTarget}` : ''}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex flex-col items-center gap-2">
                          <div className="flex items-baseline gap-1">
                            <span className="text-base font-black text-slate-800">{member.callsToday}</span>
                            <span className="text-[10px] text-slate-400 font-bold">/ {member.dailyCallTarget}</span>
                          </div>
                          <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-50 shadow-inner">
                            <div 
                              className={clsx(
                                "h-full transition-all duration-1000 ease-out",
                                isDone ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" : "bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.3)]"
                              )}
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="p-4 text-center">
                        <span className={clsx(
                          "px-4 py-1.5 rounded-xl font-black text-sm md:text-base inline-block min-w-[45px] shadow-sm transition-transform group-hover:scale-110",
                          member.agreedToday > 0 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"
                        )}>
                          {member.agreedToday}
                        </span>
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <span className={clsx(
                            "text-base font-black",
                            successRate > 25 ? "text-emerald-600" : successRate > 10 ? "text-amber-600" : "text-slate-400"
                          )}>
                            {successRate}%
                          </span>
                          <div className="flex gap-0.5">
                            {[1, 2, 3].map(star => (
                              <div key={star} className={clsx(
                                "w-1 h-1 rounded-full transition-colors duration-500",
                                successRate >= (star * 10) ? "bg-emerald-400" : "bg-slate-200"
                              )} />
                            ))}
                          </div>
                        </div>
                      </td>
                      <td className="p-4 text-center">
                        {isDone ? (
                          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-black uppercase tracking-widest shadow-sm border border-emerald-200">
                            <CheckCircle2 size={12} />
                            <span>مكتمل</span>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 text-amber-600 text-[10px] font-black uppercase tracking-widest border border-amber-100 shadow-sm">
                            <TrendingUp size={12} className="animate-pulse" />
                            <span>جاري العمل</span>
                          </div>
                        )}
                      </td>
                      <td className="p-4 text-center">
                        <button 
                          onClick={() => {
                            if (!member.phone) {
                              alert('الموظف لم يقم بإضافة رقم الواتساب الخاص به بعد');
                              return;
                            }
                            const msg = isDone 
                              ? `عاش يا ${member.name.split(' ')[0]}! بطل والله على مجهودك النهاردة 🏆`
                              : `يا ${member.name.split(' ')[0]}، التارجت لسه مخلصش. محتاجين نشد شوية، بالتوفيق! 💪`;
                            const cleanPhone = member.phone.replace(/\D/g, '');
                            const finalPhone = cleanPhone.startsWith('2') ? cleanPhone : `2${cleanPhone}`;
                            const whatsappUrl = `https://wa.me/${finalPhone}?text=${encodeURIComponent(msg)}`;
                            window.open(whatsappUrl, '_blank');
                          }}
                          className={clsx(
                            "w-10 h-10 rounded-xl flex items-center justify-center transition-all shadow-sm hover:shadow-lg active:scale-90 mx-auto",
                            !member.phone ? "bg-slate-100 text-slate-300 cursor-not-allowed" :
                            isDone ? "bg-emerald-50 text-emerald-600 hover:bg-emerald-500 hover:text-white" : "bg-amber-50 text-amber-600 hover:bg-amber-500 hover:text-white"
                          )}
                          title={!member.phone ? "رقم الواتساب غير متوفر" : isDone ? "تهنئة" : "متابعة"}
                        >
                          <MessageCircle size={20} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="h-64 w-full flex flex-col items-center justify-center text-slate-400 gap-4 bg-slate-50/50 rounded-3xl border-2 border-dashed border-slate-200">
            <Users size={48} className="opacity-20" />
            <p className="font-bold">{(user?.role === 'ADMIN' || user?.role === 'TEAM_LEAD') ? 'لا يوجد موظفين في هذا النطاق حالياً' : 'بيانات الفريق متاحة للمديرين فقط'}</p>
          </div>
        )}
      </div>
    </div>
  );
}
