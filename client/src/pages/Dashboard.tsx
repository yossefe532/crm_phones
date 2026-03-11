import { useEffect, useRef, useState } from 'react';
import {
  Users, 
  CheckCircle2, 
  HelpCircle, 
  XCircle,
  Database,
  Download,
  Table2,
  MessageCircle
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
  recontact?: number;
  scope?: 'GLOBAL' | 'TEAM' | 'AGENT';
  teamMembersPerformance?: Array<{
    userId: number;
    name: string;
    dailyCallTarget: number;
    callsToday: number;
    agreedToday: number;
  }>;
  leaderboard?: Array<{
    userId: number;
    name: string;
    callsToday: number;
    agreedToday: number;
    dailyCallTarget: number;
  }>;
}

interface Team {
  id: number;
  name: string;
}

export default function Dashboard() {
  const REFRESH_INTERVAL_MS = 8000;
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats>({ total: 0, agreed: 0, hesitant: 0, rejected: 0, poolCount: 0 });
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<number | ''>('');
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const isFetchingRef = useRef(false);

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

  const userRank = stats.leaderboard?.findIndex(l => l.userId === user?.id) ?? -1;
  const isTopThree = userRank >= 0 && userRank < 3;
  const displayLeaderboard = stats.leaderboard?.slice(0, 3) || [];
  const userStats = userRank >= 3 ? stats.leaderboard?.[userRank] : null;

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-4">
          <div>
            <h2 className="text-3xl font-bold text-slate-800 mb-2">لوحة التحكم</h2>
            <p className="text-slate-600">أهلاً بك، {user?.name}</p>
          </div>
          {user?.role === 'ADMIN' && (
            <select
              value={selectedTeamId}
              onChange={(e) => setSelectedTeamId(e.target.value ? Number(e.target.value) : '')}
              className="input-field min-w-[200px] h-10 mt-2"
            >
              <option value="">كل الفرق</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  فريق: {team.name}
                </option>
              ))}
            </select>
          )}
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

      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 glass-card p-6">
          <h3 className="text-xl font-bold text-slate-800 mb-6">أداء الفريق</h3>
          {stats.teamMembersPerformance && stats.teamMembersPerformance.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-right">
                <thead className="bg-slate-50/50 border-b border-slate-100">
                  <tr>
                      <th className="p-3 text-sm font-semibold text-slate-600">الموظف</th>
                      <th className="p-3 text-sm font-semibold text-slate-600 text-center">المكالمات</th>
                      <th className="p-3 text-sm font-semibold text-slate-600 text-center">وافقوا (اليوم)</th>
                      <th className="p-3 text-sm font-semibold text-slate-600">نسبة النجاح</th>
                      <th className="p-3 text-sm font-semibold text-slate-600">الحالة</th>
                      <th className="p-3 text-sm font-semibold text-slate-600">إجراء</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {stats.teamMembersPerformance.map((member) => {
                      const isDone = member.callsToday >= member.dailyCallTarget;
                      const progress = Math.min(100, Math.round((member.callsToday / member.dailyCallTarget) * 100));
                      const successRate = member.callsToday > 0 
                        ? Math.round((member.agreedToday / member.callsToday) * 100) 
                        : 0;
                      
                      return (
                        <tr key={member.userId} className="hover:bg-slate-50/50 transition-colors">
                          <td className="p-3">
                            <p className="font-bold text-slate-800 text-sm">{member.name}</p>
                            <p className="text-xs text-slate-500">الهدف: {member.dailyCallTarget}</p>
                          </td>
                          <td className="p-3 text-center">
                            <div className="flex flex-col items-center gap-1">
                              <span className="text-sm font-bold text-slate-700">{member.callsToday}</span>
                              <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                <div 
                                  className={clsx("h-full", isDone ? "bg-emerald-500" : "bg-amber-500")}
                                  style={{ width: `${progress}%` }}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="p-3 text-center">
                            <span className="px-3 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-bold text-sm">
                              {member.agreedToday}
                            </span>
                          </td>
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <span className={clsx(
                                "text-sm font-bold",
                                successRate > 20 ? "text-emerald-600" : successRate > 10 ? "text-amber-600" : "text-slate-500"
                              )}>
                                {successRate}%
                              </span>
                            </div>
                          </td>
                          <td className="p-3">
                          {isDone ? (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold">مكتمل ✅</span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold">جاري العمل..</span>
                          )}
                        </td>
                        <td className="p-3">
                          <button 
                            onClick={() => {
                              const msg = isDone 
                                ? `عاش يا ${member.name.split(' ')[0]}! بطل والله على مجهودك النهاردة 🏆`
                                : `يا ${member.name.split(' ')[0]}، التارجت لسه مخلصش. محتاجين نشد شوية، بالتوفيق! 💪`;
                              const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(msg)}`;
                              window.open(whatsappUrl, '_blank');
                            }}
                            className={clsx(
                              "p-2 rounded-lg transition-colors",
                              isDone ? "hover:bg-emerald-100 text-emerald-600" : "hover:bg-amber-100 text-amber-600"
                            )}
                            title={isDone ? "تهنئة" : "متابعة"}
                          >
                            <MessageCircle size={18} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="h-64 w-full flex items-center justify-center text-slate-400">
              <p>{(user?.role === 'ADMIN' || user?.role === 'TEAM_LEAD') ? 'لا يوجد موظفين حالياً' : 'خاص بالمدير فقط'}</p>
            </div>
          )}
        </div>

        <div className="glass-card p-6 flex flex-col h-full">
          <h3 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2">
            <span>🏆 وحوش السالز</span>
          </h3>
          <div className="space-y-4 flex-1">
            {displayLeaderboard.map((member, idx) => (
              <div 
                key={member.userId} 
                className={clsx(
                  "p-4 rounded-2xl flex items-center gap-4 border transition-all duration-300",
                  idx === 0 ? "bg-amber-50 border-amber-200 scale-105 shadow-sm" : 
                  idx === 1 ? "bg-slate-50 border-slate-200" : 
                  "bg-orange-50/50 border-orange-100"
                )}
              >
                <div className={clsx(
                  "w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg",
                  idx === 0 ? "bg-amber-400 text-white" : 
                  idx === 1 ? "bg-slate-300 text-slate-700" : 
                  "bg-orange-300 text-white"
                )}>
                  {idx + 1}
                </div>
                <div className="flex-1">
                  <p className="font-bold text-slate-800">{member.name}</p>
                  <p className="text-xs text-slate-500">{member.callsToday} مكالمة | {member.agreedToday} موافق</p>
                </div>
              </div>
            ))}

            {userStats && (
              <>
                <div className="border-t border-dashed border-slate-200 my-6"></div>
                <div className="p-4 rounded-2xl bg-indigo-50 border border-indigo-100 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold">
                      {userRank + 1}
                    </div>
                    <div className="flex-1">
                      <p className="font-bold text-indigo-900">ترتيبك الحالي</p>
                      <p className="text-xs text-indigo-700">أنت في المركز الـ {userRank + 1}</p>
                    </div>
                  </div>
                  <div className="mt-4 p-3 bg-white/50 rounded-xl text-sm text-indigo-800 italic text-center">
                    {userRank < 10 ? "قربت جداً من الوحوش! شد حيلك وادخل في التوب 3 🚀" : "البداية صعبة بس أنت قدها، ركز وهتوصل للقمة! 💪"}
                  </div>
                </div>
              </>
            )}

            {isTopThree && (
              <div className="mt-6 p-4 rounded-2xl bg-emerald-50 border border-emerald-100 text-center animate-bounce">
                <p className="text-emerald-800 font-bold">أنت من وحوش اليوم! 👑</p>
                <p className="text-xs text-emerald-600 mt-1">حافظ على مكانك في القمة</p>
              </div>
            )}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
