import { useEffect, useMemo, useState } from 'react';
import { Database, Loader2, RefreshCw, Search, Trash2 } from 'lucide-react';
import api from '../../services/api';

interface PooledLead {
  id: number;
  name: string;
  phone: string;
  createdAt: string;
  team?: { id: number; name: string } | null;
}

interface TeamOption {
  id: number;
  name: string;
}

export default function PooledNumbers() {
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<PooledLead[]>([]);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [search, setSearch] = useState('');
  const [teamId, setTeamId] = useState<number | ''>('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [deleteCount, setDeleteCount] = useState(100);
  const [deleting, setDeleting] = useState(false);

  const fetchTeams = async () => {
    try {
      const response = await api.get('/teams');
      const list = (response.data || []).map((team: any) => ({ id: team.id, name: team.name }));
      setTeams(list);
    } catch {
      setTeams([]);
    }
  };

  const fetchPooled = async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const response = await api.get('/admin/pooled-numbers', {
        params: {
          ...(teamId ? { teamId } : {}),
          ...(search.trim() ? { search: search.trim() } : {}),
        },
      });
      setLeads(response.data?.leads || []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'تعذر تحميل بيانات المجمع');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTeams();
  }, []);

  useEffect(() => {
    fetchPooled();
  }, [teamId]);

  const groupedByTeam = useMemo(() => {
    return leads.reduce<Record<string, number>>((acc, lead) => {
      const key = lead.team?.name || 'غير محدد';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  }, [leads]);

  const deleteAllPooled = async () => {
    const confirmed = window.confirm('سيتم حذف كل الأرقام المجمعة حسب الفلاتر الحالية. هل أنت متأكد؟');
    if (!confirmed) return;
    setDeleting(true);
    setError('');
    setSuccess('');
    try {
      const response = await api.delete('/admin/pooled-numbers', {
        data: {
          mode: 'ALL',
          ...(teamId ? { teamId } : {}),
          ...(search.trim() ? { search: search.trim() } : {}),
        },
      });
      setSuccess(response.data?.message || 'تم حذف الأرقام بنجاح');
      await fetchPooled();
    } catch (err: any) {
      setError(err.response?.data?.error || 'تعذر حذف الأرقام');
    } finally {
      setDeleting(false);
    }
  };

  const deleteLimitedPooled = async () => {
    if (!Number.isInteger(deleteCount) || deleteCount < 1) {
      setError('عدد الحذف يجب أن يكون رقمًا صحيحًا أكبر من صفر');
      return;
    }
    const confirmed = window.confirm(`سيتم حذف أول ${deleteCount} رقم من المجمع حسب الفلاتر الحالية. هل تريد المتابعة؟`);
    if (!confirmed) return;
    setDeleting(true);
    setError('');
    setSuccess('');
    try {
      const response = await api.delete('/admin/pooled-numbers', {
        data: {
          mode: 'COUNT',
          count: deleteCount,
          sort: 'OLDEST',
          ...(teamId ? { teamId } : {}),
          ...(search.trim() ? { search: search.trim() } : {}),
        },
      });
      setSuccess(response.data?.message || 'تم حذف جزء من الأرقام بنجاح');
      await fetchPooled();
    } catch (err: any) {
      setError(err.response?.data?.error || 'تعذر حذف الأرقام');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-slate-800">الأرقام المجمّعة</h2>
        <p className="text-slate-600">إدارة ومراجعة أرقام المجمع (Admin فقط)</p>
      </div>

      <div className="glass-card p-4 flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            className="input-field pr-9"
            placeholder="بحث بالاسم أو الهاتف"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') fetchPooled();
            }}
          />
        </div>
        <select className="input-field md:max-w-56" value={teamId} onChange={(e) => setTeamId(e.target.value ? Number(e.target.value) : '')}>
          <option value="">كل الفرق</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>{team.name}</option>
          ))}
        </select>
        <button className="btn-secondary flex items-center justify-center gap-2 md:w-auto w-full" onClick={fetchPooled}>
          <RefreshCw size={18} />
          تحديث
        </button>
      </div>
      <div className="glass-card p-4 flex flex-col md:flex-row gap-3 md:items-center">
        <div className="flex-1 text-sm text-slate-600">يمكنك حذف كل العملاء المجمعة حسب الفلاتر أو حذف عدد محدد فقط.</div>
        <input
          className="input-field md:max-w-40"
          type="number"
          min={1}
          value={deleteCount}
          onChange={(e) => setDeleteCount(Number(e.target.value) || 0)}
          placeholder="عدد"
        />
        <button className="btn-secondary flex items-center justify-center gap-2" onClick={deleteLimitedPooled} disabled={deleting}>
          {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
          حذف عدد محدد
        </button>
        <button className="px-4 py-2 rounded-xl bg-red-100 text-red-700 font-bold flex items-center justify-center gap-2 disabled:opacity-50" onClick={deleteAllPooled} disabled={deleting}>
          {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
          حذف كل النتائج
        </button>
      </div>

      {error && <div className="glass-card p-4 border border-red-200 text-red-700">{error}</div>}
      {success && <div className="glass-card p-4 border border-emerald-200 text-emerald-700">{success}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="glass-card p-4">
          <p className="text-xs text-slate-500">إجمالي المجمع</p>
          <p className="text-2xl font-bold text-purple-700">{leads.length}</p>
        </div>
        {Object.entries(groupedByTeam).slice(0, 3).map(([teamName, count]) => (
          <div key={teamName} className="glass-card p-4">
            <p className="text-xs text-slate-500 truncate">{teamName}</p>
            <p className="text-2xl font-bold text-slate-700">{count}</p>
          </div>
        ))}
      </div>

      <div className="glass-card overflow-hidden">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-right">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="p-4">#</th>
                <th className="p-4">الاسم</th>
                <th className="p-4">الهاتف</th>
                <th className="p-4">الفريق</th>
                <th className="p-4">تاريخ الإضافة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={5} className="p-8 text-center text-slate-500">جاري التحميل...</td></tr>
              ) : leads.length === 0 ? (
                <tr><td colSpan={5} className="p-8 text-center text-slate-500">لا توجد أرقام في المجمع</td></tr>
              ) : leads.map((lead, idx) => (
                <tr key={lead.id}>
                  <td className="p-4 text-slate-500">{idx + 1}</td>
                  <td className="p-4 font-semibold text-slate-800">{lead.name}</td>
                  <td className="p-4 font-mono" dir="ltr">{lead.phone}</td>
                  <td className="p-4">{lead.team?.name || '-'}</td>
                  <td className="p-4 text-sm text-slate-500">{new Date(lead.createdAt).toLocaleDateString('ar-EG')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="md:hidden divide-y divide-slate-100">
          {loading ? <div className="p-6 text-center text-slate-500">جاري التحميل...</div> : leads.length === 0 ? <div className="p-6 text-center text-slate-500">لا توجد أرقام</div> : leads.map((lead) => (
            <div key={lead.id} className="p-4">
              <div className="flex items-center gap-2 text-purple-700 mb-2"><Database size={16} /><span className="font-bold">{lead.name}</span></div>
              <p className="font-mono text-sm text-slate-700" dir="ltr">{lead.phone}</p>
              <p className="text-xs text-slate-500 mt-1">{lead.team?.name || 'بدون فريق'} • {new Date(lead.createdAt).toLocaleDateString('ar-EG')}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
