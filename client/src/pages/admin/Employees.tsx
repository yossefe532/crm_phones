import { Fragment, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { AlertCircle, CheckCircle2, Loader2, PencilLine, Save, Trash2, UserPlus, X } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../store/useAuth';

interface EmployeeProfile {
  id: number;
  userId: number;
  department: string;
  jobTitle: string | null;
  phone: string | null;
  timezone: string;
  dailyCallTarget: number;
  isActive: boolean;
}

interface EmployeeRow {
  id: number;
  name: string;
  email: string;
  role: 'SALES' | 'TEAM_LEAD';
  teamId: number | null;
  profile: EmployeeProfile;
  callsToday: number;
}

interface TeamOption {
  id: number;
  name: string;
}

interface CreateAgentForm {
  name: string;
  email: string;
  password: string;
  role: 'SALES' | 'TEAM_LEAD';
  dailyCallTarget: number;
  department: string;
  jobTitle: string;
  phone: string;
  teamId: number | '';
  teamName: string;
}

interface EditProfileForm {
  name: string;
  email: string;
  dailyCallTarget: number;
  department: string;
  jobTitle: string;
  phone: string;
  timezone: string;
  isActive: boolean;
}

const defaultCreateForm: CreateAgentForm = {
  name: '',
  email: '',
  password: '',
  role: 'SALES',
  dailyCallTarget: 30,
  department: 'Sales',
  jobTitle: '',
  phone: '',
  teamId: '',
  teamName: '',
};

export default function Employees() {
  const { user } = useAuth();
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deletingEmployeeId, setDeletingEmployeeId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [createForm, setCreateForm] = useState<CreateAgentForm>(defaultCreateForm);
  const [editForm, setEditForm] = useState<EditProfileForm>({
    name: '',
    email: '',
    dailyCallTarget: 30,
    department: 'Sales',
    jobTitle: '',
    phone: '',
    timezone: 'Africa/Cairo',
    isActive: true,
  });

  const resetAlerts = () => {
    setError('');
    setSuccess('');
  };

  const fetchTeams = async () => {
    try {
      const response = await api.get('/teams');
      const parsed = (response.data || []).map((team: any) => ({ id: team.id, name: team.name }));
      setTeams(parsed);
      if (parsed.length === 1) {
        setCreateForm((prev) => ({ ...prev, teamId: prev.role === 'SALES' ? parsed[0].id : prev.teamId }));
      }
    } catch {
      setTeams([]);
    }
  };

  const fetchEmployees = async (searchValue = '') => {
    setLoading(true);
    try {
      const response = await api.get('/admin/employees', {
        params: searchValue.trim() ? { search: searchValue.trim() } : undefined,
      });
      setEmployees(response.data || []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'فشل تحميل الموظفين');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmployees();
    fetchTeams();
  }, []);

  const kpi = useMemo(() => {
    const agentsCount = employees.length;
    const activeCount = employees.filter((item) => item.profile?.isActive).length;
    const totalTarget = employees.reduce((sum, item) => sum + (item.profile?.dailyCallTarget || 0), 0);
    const totalCalls = employees.reduce((sum, item) => sum + (item.callsToday || 0), 0);
    return { agentsCount, activeCount, totalTarget, totalCalls };
  }, [employees]);

  const validateEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

  const handleCreateAgent = async (e: FormEvent) => {
    e.preventDefault();
    resetAlerts();

    if (createForm.name.trim().length < 2) {
      setError('اسم الموظف يجب أن يكون حرفين على الأقل');
      return;
    }
    if (!validateEmail(createForm.email)) {
      setError('يرجى إدخال بريد إلكتروني صحيح');
      return;
    }
    if (createForm.password.length < 6) {
      setError('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      return;
    }
    if (createForm.role === 'SALES' && (!Number.isInteger(createForm.dailyCallTarget) || createForm.dailyCallTarget < 1 || createForm.dailyCallTarget > 500)) {
      setError('الهدف اليومي يجب أن يكون رقمًا صحيحًا بين 1 و 500');
      return;
    }
    if (createForm.role === 'TEAM_LEAD' && user?.role !== 'ADMIN') {
      setError('فقط الأدمن يمكنه إنشاء Team Lead');
      return;
    }
    if (user?.role === 'ADMIN' && createForm.role === 'SALES' && !createForm.teamId) {
      setError('اختيار الفريق مطلوب لإنشاء حساب Sales');
      return;
    }
    if (user?.role === 'ADMIN' && createForm.role === 'TEAM_LEAD' && createForm.teamName.trim().length < 2) {
      setError('اسم الفريق الجديد مطلوب ويجب أن يكون حرفين على الأقل');
      return;
    }

    setCreating(true);
    try {
      let effectiveTeamId: number | '' = createForm.teamId;

      if (user?.role === 'ADMIN' && createForm.role === 'TEAM_LEAD') {
        const teamResponse = await api.post('/teams', { name: createForm.teamName.trim() });
        const createdTeamId = teamResponse?.data?.id;
        if (!createdTeamId) {
          throw new Error('فشل إنشاء الفريق الجديد');
        }
        effectiveTeamId = createdTeamId;
      }

      await api.post('/users', {
        name: createForm.name.trim(),
        email: createForm.email.trim().toLowerCase(),
        password: createForm.password,
        role: createForm.role,
        teamId: user?.role === 'ADMIN' ? effectiveTeamId : undefined,
        ...(createForm.role === 'SALES'
          ? {
              employeeProfile: {
                dailyCallTarget: createForm.dailyCallTarget,
                department: createForm.department.trim() || 'Sales',
                jobTitle: createForm.jobTitle.trim() || null,
                phone: createForm.phone.trim() || null,
                timezone: 'Africa/Cairo',
                isActive: true,
              },
            }
          : {}),
      });
      setSuccess(createForm.role === 'TEAM_LEAD' ? 'تم إنشاء Team Lead مع فريق جديد بنجاح' : 'تم إنشاء الموظف بنجاح');
      setCreateForm(defaultCreateForm);
      await fetchTeams();
      await fetchEmployees(search);
    } catch (err: any) {
      setError(err.response?.data?.error || 'تعذر إنشاء الموظف');
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (employee: EmployeeRow) => {
    resetAlerts();
    setEditingId(employee.id);
    setEditForm({
      name: employee.name,
      email: employee.email,
      dailyCallTarget: employee.profile?.dailyCallTarget || 30,
      department: employee.profile?.department || 'Sales',
      jobTitle: employee.profile?.jobTitle || '',
      phone: employee.profile?.phone || '',
      timezone: employee.profile?.timezone || 'Africa/Cairo',
      isActive: employee.profile?.isActive ?? true,
    });
  };

  const saveEdit = async () => {
    if (editingId === null) return;
    resetAlerts();
    if (!Number.isInteger(editForm.dailyCallTarget) || editForm.dailyCallTarget < 1 || editForm.dailyCallTarget > 500) {
      setError('الهدف اليومي يجب أن يكون رقمًا صحيحًا بين 1 و 500');
      return;
    }
    if (!editForm.department.trim()) {
      setError('القسم مطلوب');
      return;
    }
    if (editForm.name.trim().length < 2) {
      setError('اسم الموظف يجب أن يكون حرفين على الأقل');
      return;
    }
    if (!validateEmail(editForm.email)) {
      setError('يرجى إدخال بريد إلكتروني صحيح');
      return;
    }

    setSaving(true);
    try {
      await api.put(`/users/${editingId}`, {
        name: editForm.name.trim(),
        email: editForm.email.trim().toLowerCase(),
      });
      await api.put(`/admin/employees/${editingId}/profile`, {
        dailyCallTarget: editForm.dailyCallTarget,
        department: editForm.department.trim(),
        jobTitle: editForm.jobTitle.trim() || null,
        phone: editForm.phone.trim() || null,
        timezone: editForm.timezone.trim() || 'Africa/Cairo',
        isActive: editForm.isActive,
      });
      setSuccess('تم تحديث ملف الموظف');
      setEditingId(null);
      await fetchEmployees(search);
    } catch (err: any) {
      setError(err.response?.data?.error || 'تعذر تحديث ملف الموظف');
    } finally {
      setSaving(false);
    }
  };

  const deleteEmployee = async (employee: EmployeeRow) => {
    resetAlerts();
    const confirmed = window.confirm(`هل تريد حذف الموظف "${employee.name}"؟`);
    if (!confirmed) return;
    setDeletingEmployeeId(employee.id);
    try {
      await api.delete(`/users/${employee.id}`);
      setSuccess('تم حذف الموظف بنجاح');
      if (editingId === employee.id) {
        setEditingId(null);
      }
      await fetchEmployees(search);
    } catch (err: any) {
      setError(err.response?.data?.error || 'تعذر حذف الموظف');
    } finally {
      setDeletingEmployeeId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-slate-800 mb-2">إدارة الموظفين</h2>
        <p className="text-slate-600">ملف لكل وكيل مبيعات مع هدف المكالمات اليومي ومتابعة التنفيذ اللحظي</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="glass-card p-4 text-center">
          <p className="text-xs text-slate-500 mb-1">إجمالي الوكلاء</p>
          <p className="text-2xl font-bold text-slate-800">{kpi.agentsCount}</p>
        </div>
        <div className="glass-card p-4 text-center">
          <p className="text-xs text-slate-500 mb-1">الوكلاء النشطون</p>
          <p className="text-2xl font-bold text-emerald-600">{kpi.activeCount}</p>
        </div>
        <div className="glass-card p-4 text-center">
          <p className="text-xs text-slate-500 mb-1">إجمالي الهدف اليومي</p>
          <p className="text-2xl font-bold text-indigo-600">{kpi.totalTarget}</p>
        </div>
        <div className="glass-card p-4 text-center">
          <p className="text-xs text-slate-500 mb-1">مكالمات اليوم</p>
          <p className="text-2xl font-bold text-amber-600">{kpi.totalCalls}</p>
        </div>
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

      <form onSubmit={handleCreateAgent} className="glass-card p-6 space-y-4">
        <div className="flex items-center gap-2 text-slate-700 font-bold">
          <UserPlus size={18} />
          <span>{createForm.role === 'TEAM_LEAD' ? 'إضافة Team Lead مع فريق جديد' : 'إضافة وكيل مبيعات جديد'}</span>
        </div>
        <div className="grid md:grid-cols-3 gap-3">
          <input className="input-field" placeholder="الاسم" value={createForm.name} onChange={(e) => setCreateForm((prev) => ({ ...prev, name: e.target.value }))} />
          <input className="input-field" placeholder="البريد الإلكتروني" value={createForm.email} onChange={(e) => setCreateForm((prev) => ({ ...prev, email: e.target.value }))} />
          <input className="input-field" type="password" placeholder="كلمة المرور" value={createForm.password} onChange={(e) => setCreateForm((prev) => ({ ...prev, password: e.target.value }))} />
        </div>
        {user?.role === 'ADMIN' && (
          <div className="grid md:grid-cols-3 gap-3">
            <select
              className="input-field"
              value={createForm.role}
              onChange={(e) =>
                setCreateForm((prev) => ({
                  ...prev,
                  role: e.target.value as 'SALES' | 'TEAM_LEAD',
                  teamId: e.target.value === 'TEAM_LEAD' ? '' : prev.teamId,
                  teamName: e.target.value === 'TEAM_LEAD' ? prev.teamName : '',
                }))
              }
            >
              <option value="SALES">Sales</option>
              <option value="TEAM_LEAD">Team Lead</option>
            </select>
          </div>
        )}
        {createForm.role === 'SALES' ? (
          <div className="grid md:grid-cols-4 gap-3">
            <input className="input-field" type="number" min={1} max={500} placeholder="هدف المكالمات اليومي" value={createForm.dailyCallTarget} onChange={(e) => setCreateForm((prev) => ({ ...prev, dailyCallTarget: Number(e.target.value) }))} />
            {user?.role === 'ADMIN' && (
              <select className="input-field" value={createForm.teamId} onChange={(e) => setCreateForm((prev) => ({ ...prev, teamId: e.target.value ? Number(e.target.value) : '' }))}>
                <option value="">اختر الفريق</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            )}
            <input className="input-field" placeholder="القسم" value={createForm.department} onChange={(e) => setCreateForm((prev) => ({ ...prev, department: e.target.value }))} />
            <input className="input-field" placeholder="المسمى الوظيفي (اختياري)" value={createForm.jobTitle} onChange={(e) => setCreateForm((prev) => ({ ...prev, jobTitle: e.target.value }))} />
            <input className="input-field" placeholder="هاتف الموظف (اختياري)" value={createForm.phone} onChange={(e) => setCreateForm((prev) => ({ ...prev, phone: e.target.value }))} />
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            <input
              className="input-field"
              placeholder="اسم الفريق الجديد"
              value={createForm.teamName}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, teamName: e.target.value }))}
            />
          </div>
        )}
        <button type="submit" disabled={creating} className="btn-primary inline-flex items-center gap-2">
          {creating ? <Loader2 size={18} className="animate-spin" /> : <UserPlus size={18} />}
          <span>{createForm.role === 'TEAM_LEAD' ? 'إنشاء Team Lead وفريق' : 'إضافة الموظف'}</span>
        </button>
      </form>

      <div className="glass-card p-6 space-y-4">
        <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
          <h3 className="text-xl font-bold text-slate-800">قائمة الوكلاء</h3>
          <div className="flex gap-2">
            <input className="input-field min-w-[260px]" placeholder="بحث بالاسم أو البريد" value={search} onChange={(e) => setSearch(e.target.value)} />
            <button
              className="btn-secondary"
              onClick={async () => {
                resetAlerts();
                await fetchEmployees(search);
              }}
            >
              بحث
            </button>
          </div>
        </div>

        {loading ? (
          <div className="py-12 flex justify-center text-slate-500">
            <Loader2 className="animate-spin" />
          </div>
        ) : employees.length === 0 ? (
          <div className="py-8 text-center text-slate-500">لا يوجد وكلاء مطابقين لنتيجة البحث</div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right border-b border-slate-200">
                  <th className="py-3">الموظف</th>
                  <th className="py-3">الهدف اليومي</th>
                  <th className="py-3">مكالمات اليوم</th>
                  <th className="py-3">النسبة</th>
                  <th className="py-3">الحالة</th>
                  <th className="py-3">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((employee) => {
                  const target = employee.profile?.dailyCallTarget || 1;
                  const progress = Math.min(100, Math.round((employee.callsToday / target) * 100));
                  const isEditing = editingId === employee.id;

                  return (
                    <Fragment key={employee.id}>
                      <tr className="border-b border-slate-100 align-top">
                        <td className="py-4">
                          <p className="font-bold text-slate-800">{employee.name}</p>
                          <p className="text-xs text-slate-500">{employee.email}</p>
                          <p className="text-xs text-slate-500 mt-1">
                            {employee.profile?.department} {employee.profile?.jobTitle ? `- ${employee.profile.jobTitle}` : ''}
                          </p>
                        </td>
                        <td className="py-4 font-bold text-indigo-700">{employee.profile?.dailyCallTarget}</td>
                        <td className="py-4 font-bold text-amber-600">{employee.callsToday}</td>
                        <td className="py-4">
                          <div className="w-36 bg-slate-200 rounded-full h-2.5 overflow-hidden">
                            <div className="h-full bg-emerald-500" style={{ width: `${progress}%` }} />
                          </div>
                          <p className="text-xs text-slate-500 mt-1">{progress}%</p>
                        </td>
                        <td className="py-4">
                          <span className={`px-2 py-1 text-xs rounded-full ${employee.profile?.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                            {employee.profile?.isActive ? 'نشط' : 'موقوف'}
                          </span>
                        </td>
                        <td className="py-4">
                          <div className="flex items-center gap-2">
                            <button className="btn-secondary inline-flex items-center gap-1 text-xs" onClick={() => startEdit(employee)}>
                              <PencilLine size={14} />
                              تعديل
                            </button>
                            <button
                              className="inline-flex items-center gap-1 text-xs px-3 py-2 rounded-xl bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50"
                              onClick={() => deleteEmployee(employee)}
                              disabled={deletingEmployeeId === employee.id}
                            >
                              {deletingEmployeeId === employee.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                              حذف
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isEditing && (
                        <tr className="border-b border-slate-100">
                          <td colSpan={6} className="pb-4">
                            <div className="p-4 mt-2 rounded-xl border border-slate-200 bg-slate-50 grid md:grid-cols-6 gap-2">
                              <input className="input-field" value={editForm.name} onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))} />
                              <input className="input-field" value={editForm.email} onChange={(e) => setEditForm((prev) => ({ ...prev, email: e.target.value }))} />
                              <input className="input-field" type="number" min={1} max={500} value={editForm.dailyCallTarget} onChange={(e) => setEditForm((prev) => ({ ...prev, dailyCallTarget: Number(e.target.value) }))} />
                              <input className="input-field" value={editForm.department} onChange={(e) => setEditForm((prev) => ({ ...prev, department: e.target.value }))} />
                              <input className="input-field" value={editForm.jobTitle} onChange={(e) => setEditForm((prev) => ({ ...prev, jobTitle: e.target.value }))} />
                              <input className="input-field" value={editForm.phone} onChange={(e) => setEditForm((prev) => ({ ...prev, phone: e.target.value }))} />
                              <label className="flex items-center gap-2 px-3 rounded-xl bg-white border border-slate-200">
                                <input type="checkbox" checked={editForm.isActive} onChange={(e) => setEditForm((prev) => ({ ...prev, isActive: e.target.checked }))} />
                                <span>نشط</span>
                              </label>
                              <div className="flex gap-2">
                                <button className="btn-primary flex items-center gap-1" disabled={saving} onClick={saveEdit}>
                                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                  حفظ
                                </button>
                                <button className="btn-secondary flex items-center gap-1" onClick={() => setEditingId(null)}>
                                  <X size={14} />
                                  إلغاء
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
