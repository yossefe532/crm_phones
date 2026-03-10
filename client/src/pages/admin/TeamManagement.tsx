import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Crown, KeyRound, Loader2, Trash2, UserPlus } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../store/useAuth';

interface TeamMemberProfile {
  dailyCallTarget?: number;
  department?: string;
  isActive?: boolean;
}

interface TeamMember {
  id: number;
  name: string;
  email: string;
  role: 'TEAM_LEAD' | 'SALES';
  teamId: number;
  callsToday?: number;
  employeeProfile?: TeamMemberProfile | null;
}

interface TeamStats {
  membersCount: number;
  salesCount: number;
  teamLeadsCount: number;
  totalLeads: number;
  poolCount: number;
  agreed: number;
  hesitant: number;
  rejected: number;
  noAnswer: number;
  recontact: number;
  wrongNumber: number;
  callsToday: number;
  callsYesterday: number;
  totalTarget: number;
  targetAchievementPercent: number;
}

interface TeamBlock {
  id: number;
  name: string;
  members: TeamMember[];
  stats: TeamStats;
}

interface TeamOption {
  id: number;
  name: string;
}

const MAX_TEAM_LEADS = 2;

export default function TeamManagement() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [teams, setTeams] = useState<TeamBlock[]>([]);
  const [teamOptions, setTeamOptions] = useState<TeamOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [deletingMemberId, setDeletingMemberId] = useState<number | null>(null);
  const [resettingMemberId, setResettingMemberId] = useState<number | null>(null);
  const [deletingTeamId, setDeletingTeamId] = useState<number | null>(null);
  const [roleUpdatingId, setRoleUpdatingId] = useState<number | null>(null);
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'SALES' as 'SALES' | 'TEAM_LEAD',
    teamId: '' as number | '',
    dailyCallTarget: 30,
    department: 'Sales',
  });

  const resetAlerts = () => {
    setError('');
    setSuccess('');
  };

  const fetchTeams = async () => {
    setLoading(true);
    try {
      const [managementRes, teamsRes] = await Promise.allSettled([
        api.get('/team-management'),
        api.get('/teams'),
      ]);
      if (managementRes.status !== 'fulfilled') {
        throw managementRes.reason;
      }
      const incomingTeams: TeamBlock[] = managementRes.value.data || [];
      setTeams(incomingTeams);
      const parsedTeams = teamsRes.status === 'fulfilled'
        ? (teamsRes.value.data || []).map((team: any) => ({ id: team.id, name: team.name }))
        : incomingTeams.map((team) => ({ id: team.id, name: team.name }));
      setTeamOptions(parsedTeams);
      if (user?.role === 'TEAM_LEAD' && incomingTeams[0]?.id) {
        setForm((prev) => ({ ...prev, teamId: incomingTeams[0].id, role: 'SALES' }));
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'فشل تحميل بيانات الفرق');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchTeams();
  }, []);

  const isAdmin = user?.role === 'ADMIN';

  const canCreate = useMemo(() => {
    if (!form.name.trim() || !form.email.trim() || form.password.length < 6) return false;
    if (isAdmin) {
      if (!form.teamId) return false;
      return true;
    }
    return true;
  }, [form, isAdmin]);

  const addMember = async () => {
    if (!canCreate) return;
    resetAlerts();
    setSaving(true);
    try {
      await api.post('/team-management/members', {
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
        role: isAdmin ? form.role : 'SALES',
        teamId: isAdmin ? form.teamId : undefined,
        employeeProfile: {
          dailyCallTarget: form.dailyCallTarget,
          department: form.department.trim() || 'Sales',
          isActive: true,
        },
      });
      setSuccess('تم إضافة العضو بنجاح');
      setForm((prev) => ({
        ...prev,
        name: '',
        email: '',
        password: '',
        role: 'SALES',
        dailyCallTarget: 30,
        department: 'Sales',
      }));
      await fetchTeams();
    } catch (err: any) {
      setError(err.response?.data?.error || 'تعذر إضافة العضو');
    } finally {
      setSaving(false);
    }
  };

  const removeMember = async (member: TeamMember) => {
    const confirmed = window.confirm(`هل تريد إزالة العضو "${member.name}"؟`);
    if (!confirmed) return;
    resetAlerts();
    setDeletingMemberId(member.id);
    try {
      await api.delete(`/users/${member.id}`);
      setSuccess('تمت إزالة العضو');
      await fetchTeams();
    } catch (err: any) {
      setError(err.response?.data?.error || 'تعذر إزالة العضو');
    } finally {
      setDeletingMemberId(null);
    }
  };

  const resetMemberPassword = async (member: TeamMember) => {
    const customPassword = window.prompt('اكتب كلمة مرور جديدة (أو اتركها فارغة لتوليد كلمة مرور تلقائيًا)');
    if (customPassword === null) return;
    resetAlerts();
    setResettingMemberId(member.id);
    try {
      const payload = customPassword.trim() ? { password: customPassword.trim() } : {};
      const response = await api.put(`/users/${member.id}/password`, payload);
      const newPassword = response.data?.password || customPassword.trim();
      setSuccess(`تم تحديث كلمة مرور ${member.name}`);
      if (newPassword) {
        window.alert(`كلمة المرور الجديدة لـ ${member.name}: ${newPassword}`);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'تعذر تحديث كلمة المرور');
    } finally {
      setResettingMemberId(null);
    }
  };

  const changeMemberRole = async (member: TeamMember, targetRole: 'SALES' | 'TEAM_LEAD') => {
    resetAlerts();
    setRoleUpdatingId(member.id);
    try {
      await api.put(`/team-management/members/${member.id}/role`, { role: targetRole });
      setSuccess(targetRole === 'TEAM_LEAD' ? 'تم تعيين العضو كتيم ليدر' : 'تمت إزالة صلاحية التيم ليدر');
      await fetchTeams();
    } catch (err: any) {
      setError(err.response?.data?.error || 'تعذر تحديث دور العضو');
    } finally {
      setRoleUpdatingId(null);
    }
  };

  const deleteTeam = async (team: TeamBlock) => {
    const confirmed = window.confirm(`حذف الفريق "${team.name}" سيحذف كل أعضائه وكل عملائه. هل أنت متأكد؟`);
    if (!confirmed) return;
    resetAlerts();
    setDeletingTeamId(team.id);
    try {
      await api.delete(`/teams/${team.id}`);
      setSuccess('تم حذف الفريق بالكامل');
      await fetchTeams();
    } catch (err: any) {
      setError(err.response?.data?.error || 'تعذر حذف الفريق');
    } finally {
      setDeletingTeamId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-slate-800 mb-2">إدارة الفرق</h2>
        <p className="text-slate-600">متابعة إحصاءات كل فريق وإدارة الأعضاء والتيم ليدر</p>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-100 text-red-700 flex items-center gap-2">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="p-4 rounded-xl bg-emerald-100 text-emerald-700 flex items-center gap-2">
          <CheckCircle2 size={18} />
          <span>{success}</span>
        </div>
      )}

      <div className="glass-card p-6 space-y-4">
        <div className="flex items-center gap-2 text-slate-700 font-bold">
          <UserPlus size={18} />
          <span>{isAdmin ? 'إضافة عضو أو تيم ليدر' : 'إضافة عضو جديد لفريقي'}</span>
        </div>
        <div className="grid md:grid-cols-3 gap-3">
          <input className="input-field" placeholder="الاسم" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
          <input className="input-field" placeholder="البريد الإلكتروني" value={form.email} onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))} />
          <input className="input-field" type="password" placeholder="كلمة المرور" value={form.password} onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))} />
        </div>
        <div className="grid md:grid-cols-4 gap-3">
          {isAdmin ? (
            <>
              <select className="input-field" value={form.role} onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value as 'SALES' | 'TEAM_LEAD' }))}>
                <option value="SALES">عضو مبيعات</option>
                <option value="TEAM_LEAD">تيم ليدر</option>
              </select>
              <select className="input-field" value={form.teamId} onChange={(e) => setForm((prev) => ({ ...prev, teamId: e.target.value ? Number(e.target.value) : '' }))}>
                <option value="">اختر الفريق</option>
                {teamOptions.map((team) => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </>
          ) : (
            <div className="input-field flex items-center">{teams[0]?.name || 'فريقي'}</div>
          )}
          <input className="input-field" type="number" min={1} max={500} placeholder="الهدف اليومي" value={form.dailyCallTarget} onChange={(e) => setForm((prev) => ({ ...prev, dailyCallTarget: Number(e.target.value) || 30 }))} />
          <input className="input-field" placeholder="القسم" value={form.department} onChange={(e) => setForm((prev) => ({ ...prev, department: e.target.value }))} />
        </div>
        <button className="btn-primary inline-flex items-center gap-2" onClick={addMember} disabled={saving || !canCreate}>
          {saving ? <Loader2 size={18} className="animate-spin" /> : <UserPlus size={18} />}
          <span>إضافة</span>
        </button>
      </div>

      {loading ? (
        <div className="glass-card p-10 flex justify-center text-slate-500">
          <Loader2 className="animate-spin" />
        </div>
      ) : (
        teams.map((team) => (
          <div key={team.id} className="glass-card p-6 space-y-5">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <h3 className="text-2xl font-bold text-slate-800">{team.name}</h3>
                <p className="text-sm text-slate-500">
                  أعضاء: {team.stats.membersCount} • تيم ليدر: {team.stats.teamLeadsCount}/{MAX_TEAM_LEADS}
                </p>
              </div>
              <div className="text-sm text-slate-600">
                ليدز: {team.stats.totalLeads} • Pool: {team.stats.poolCount} • اليوم: {team.stats.callsToday} • أمس: {team.stats.callsYesterday}
              </div>
              {isAdmin && (
                <button
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-red-100 text-red-700 text-xs font-bold disabled:opacity-50"
                  onClick={() => deleteTeam(team)}
                  disabled={deletingTeamId === team.id}
                >
                  {deletingTeamId === team.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  حذف الفريق بالكامل
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-8 gap-3">
              <div className="bg-slate-100 rounded-xl p-3 text-center"><p className="text-xs text-slate-500">وافقوا</p><p className="font-bold">{team.stats.agreed}</p></div>
              <div className="bg-slate-100 rounded-xl p-3 text-center"><p className="text-xs text-slate-500">مترددين</p><p className="font-bold">{team.stats.hesitant}</p></div>
              <div className="bg-slate-100 rounded-xl p-3 text-center"><p className="text-xs text-slate-500">رفضوا</p><p className="font-bold">{team.stats.rejected}</p></div>
              <div className="bg-slate-100 rounded-xl p-3 text-center"><p className="text-xs text-slate-500">مردوش</p><p className="font-bold">{team.stats.noAnswer}</p></div>
              <div className="bg-slate-100 rounded-xl p-3 text-center"><p className="text-xs text-slate-500">إعادة تواصل</p><p className="font-bold">{team.stats.recontact}</p></div>
              <div className="bg-slate-100 rounded-xl p-3 text-center"><p className="text-xs text-slate-500">رقم خاطئ</p><p className="font-bold">{team.stats.wrongNumber}</p></div>
              <div className="bg-slate-100 rounded-xl p-3 text-center"><p className="text-xs text-slate-500">هدف اليوم</p><p className="font-bold">{team.stats.totalTarget}</p></div>
              <div className="bg-slate-100 rounded-xl p-3 text-center"><p className="text-xs text-slate-500">تحقيق الهدف</p><p className="font-bold">{team.stats.targetAchievementPercent}%</p></div>
            </div>

            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-right border-b border-slate-200">
                    <th className="py-3">العضو</th>
                    <th className="py-3">الدور</th>
                    <th className="py-3">الهدف اليومي</th>
                    <th className="py-3">مكالمات اليوم</th>
                    <th className="py-3">الحالة</th>
                    <th className="py-3">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {team.members.map((member) => (
                    <tr key={member.id} className="border-b border-slate-100">
                      <td className="py-3">
                        <p className="font-bold text-slate-800">{member.name}</p>
                        <p className="text-xs text-slate-500">{member.email}</p>
                      </td>
                      <td className="py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-bold ${member.role === 'TEAM_LEAD' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-700'}`}>
                          {member.role === 'TEAM_LEAD' ? 'Team Lead' : 'Sales'}
                        </span>
                      </td>
                      <td className="py-3">{member.employeeProfile?.dailyCallTarget || '-'}</td>
                      <td className="py-3 font-semibold">{member.callsToday ?? 0}</td>
                      <td className="py-3">
                        <span className={`px-2 py-1 rounded-full text-xs ${member.employeeProfile?.isActive === false ? 'bg-slate-200 text-slate-600' : 'bg-emerald-100 text-emerald-700'}`}>
                          {member.employeeProfile?.isActive === false ? 'موقوف' : 'نشط'}
                        </span>
                      </td>
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          {(isAdmin || member.role === 'SALES') && (
                            <button
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-sky-100 text-sky-700 text-xs disabled:opacity-50"
                              onClick={() => resetMemberPassword(member)}
                              disabled={resettingMemberId === member.id}
                            >
                              {resettingMemberId === member.id ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                              كلمة السر
                            </button>
                          )}
                          {isAdmin && member.role === 'SALES' && (
                            <button
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-100 text-indigo-700 text-xs disabled:opacity-50"
                              onClick={() => changeMemberRole(member, 'TEAM_LEAD')}
                              disabled={roleUpdatingId === member.id || team.stats.teamLeadsCount >= MAX_TEAM_LEADS}
                              title={team.stats.teamLeadsCount >= MAX_TEAM_LEADS ? 'يجب إزالة تيم ليدر أولاً' : 'تعيين Team Lead'}
                            >
                              {roleUpdatingId === member.id ? <Loader2 size={14} className="animate-spin" /> : <Crown size={14} />}
                              تعيين ليدر
                            </button>
                          )}
                          {isAdmin && member.role === 'TEAM_LEAD' && (
                            <button
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-100 text-amber-700 text-xs disabled:opacity-50"
                              onClick={() => changeMemberRole(member, 'SALES')}
                              disabled={roleUpdatingId === member.id}
                            >
                              {roleUpdatingId === member.id ? <Loader2 size={14} className="animate-spin" /> : <Crown size={14} />}
                              إزالة القيادة
                            </button>
                          )}
                          <button
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs"
                            onClick={() => navigate(`/admin/employees/${member.id}`)}
                          >
                            الأداء
                          </button>
                          <button
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-100 text-red-700 text-xs disabled:opacity-50"
                            onClick={() => removeMember(member)}
                            disabled={deletingMemberId === member.id || (!isAdmin && member.role !== 'SALES')}
                          >
                            {deletingMemberId === member.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                            إزالة
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
