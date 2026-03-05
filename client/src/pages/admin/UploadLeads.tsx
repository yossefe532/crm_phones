import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import api from '../../services/api';
import { Upload, FileText, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../../store/useAuth';

interface TeamOption {
  id: number;
  name: string;
}

export default function UploadLeads() {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [textInput, setTextInput] = useState('');
  const [mode, setMode] = useState<'TEXT' | 'FILE'>('TEXT');
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<number | ''>('');
  const { user } = useAuth();

  useEffect(() => {
    const fetchTeams = async () => {
      try {
        const response = await api.get('/teams');
        const data = response.data || [];
        setTeams(data.map((team: any) => ({ id: team.id, name: team.name })));
        if (data.length === 1) {
          setSelectedTeamId(data[0].id);
        }
      } catch {
        setTeams([]);
      }
    };
    fetchTeams();
  }, []);

  const processData = async (data: any[]) => {
    if (!selectedTeamId) {
      setError('يجب اختيار الفريق قبل الرفع');
      return;
    }
    setLoading(true);
    setError('');
    setSuccess('');
    
    try {
      // Validate and format data
      const leads = data.map((row: any) => {
        // Handle different column names if necessary, or assume direct mapping
        // If row is string (from text input), treat as phone
        if (typeof row === 'string') {
          return { phone: row.trim(), source: 'POOL' };
        }
        return {
          name: row.name || row['الاسم'] || 'Unknown',
          phone: String(row.phone || row['رقم الهاتف'] || row['موبايل'] || '').trim(),
          source: 'POOL'
        };
      }).filter(l => l.phone.length >= 10); // Basic validation

      if (leads.length === 0) {
        throw new Error('لا توجد بيانات صالحة للمعالجة');
      }

      const response = await api.post('/leads/bulk', { leads, teamId: selectedTeamId });
      setSuccess(response.data.message);
      setTextInput('');
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'حدث خطأ أثناء رفع البيانات');
    } finally {
      setLoading(false);
    }
  };

  const handleTextSubmit = () => {
    const lines = textInput.split('\n').filter(line => line.trim());
    processData(lines);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws);
        processData(data);
      } catch (err) {
        setError('فشل قراءة الملف. تأكد من أن الملف سليم.');
      }
    };
    reader.readAsBinaryString(file);
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([{ name: 'اسم العميل', phone: '01xxxxxxxxx' }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "leads_template.xlsx");
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-slate-800 mb-2">رفع داتا أرقام</h2>
        <p className="text-slate-600">إضافة مجموعة كبيرة من الأرقام إلى مجمع فريق محدد</p>
      </div>

      <div className="glass-card p-6">
        <div className="mb-4">
          <label className="block text-sm font-bold text-slate-700 mb-2">الفريق</label>
          <select
            className="input-field"
            value={selectedTeamId}
            onChange={(e) => setSelectedTeamId(e.target.value ? Number(e.target.value) : '')}
            disabled={user?.role === 'TEAM_LEAD' && teams.length === 1}
          >
            <option value="">اختر الفريق</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-4 mb-6">
          <button
            onClick={() => setMode('TEXT')}
            className={clsx(
              "px-4 py-2 rounded-lg font-bold transition-colors",
              mode === 'TEXT' ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            )}
          >
            نسخ ولصق (Text)
          </button>
          <button
            onClick={() => setMode('FILE')}
            className={clsx(
              "px-4 py-2 rounded-lg font-bold transition-colors",
              mode === 'FILE' ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            )}
          >
            ملف إكسيل (Excel)
          </button>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-100 text-red-700 rounded-xl flex items-center gap-2">
            <AlertCircle size={20} />
            <p>{error}</p>
          </div>
        )}

        {success && (
          <div className="mb-4 p-4 bg-emerald-100 text-emerald-700 rounded-xl flex items-center gap-2">
            <CheckCircle size={20} />
            <p>{success}</p>
          </div>
        )}

        {mode === 'TEXT' ? (
          <div className="space-y-4">
            <label className="block text-sm font-bold text-slate-700">أدخل الأرقام (كل رقم في سطر منفصل)</label>
            <textarea
              className="input-field min-h-[200px] font-mono"
              placeholder="010xxxxxxx&#10;011xxxxxxx&#10;..."
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
            />
            <button
              onClick={handleTextSubmit}
              disabled={loading || !textInput.trim()}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="animate-spin" /> : <Upload size={20} />}
              <span>رفع الأرقام</span>
            </button>
          </div>
        ) : (
          <div className="space-y-6 text-center py-8 border-2 border-dashed border-slate-300 rounded-xl">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-400">
              <FileText size={32} />
            </div>
            <div>
              <p className="text-lg font-bold text-slate-700">اختر ملف Excel (.xlsx, .csv)</p>
              <p className="text-sm text-slate-500 mt-1">يجب أن يحتوي الملف على عمود 'phone' على الأقل</p>
            </div>
            
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileUpload}
              className="hidden"
              id="file-upload"
            />
            <label
              htmlFor="file-upload"
              className="btn-primary inline-flex items-center gap-2 cursor-pointer"
            >
              {loading ? <Loader2 className="animate-spin" /> : <Upload size={20} />}
              <span>اختيار ملف</span>
            </label>

            <div className="pt-4">
              <button onClick={downloadTemplate} className="text-emerald-600 hover:underline text-sm font-bold">
                تحميل ملف مثال (Template)
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
