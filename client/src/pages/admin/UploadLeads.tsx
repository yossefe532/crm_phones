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

const UPLOAD_CHUNK_SIZE = 500;

export default function UploadLeads() {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [textInput, setTextInput] = useState('');
  const [mode, setMode] = useState<'TEXT' | 'FILE'>('TEXT');
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<number | ''>('');
  const [uploadScope, setUploadScope] = useState<'TEAM' | 'ALL'>('TEAM');
  const [batchName, setBatchName] = useState('');
  const [batchLocation, setBatchLocation] = useState('');
  const [isVipBatch, setIsVipBatch] = useState(false);
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
    const isUploadAll = user?.role === 'ADMIN' && uploadScope === 'ALL';
    if (!isUploadAll && !selectedTeamId) {
      setError('يجب اختيار الفريق قبل الرفع');
      return;
    }
    setLoading(true);
    setError('');
    setSuccess('');
    
    try {
      const rows = data
        .map((row: any) => {
          if (typeof row === 'string') return row.trim();
          return {
            name: row.name || row['الاسم'] || row['Name'] || '',
            phone: String(row.phone || row['رقم الهاتف'] || row['موبايل'] || row['Phone'] || '').trim(),
            gender: row.gender || row['النوع'] || 'UNKNOWN',
          };
        })
        .filter((row) => (typeof row === 'string' ? row.trim().length > 0 : row.phone.length > 0));

      if (rows.length === 0) {
        throw new Error('لا توجد بيانات صالحة للمعالجة');
      }

      let totalInserted = 0;
      let totalSkippedExisting = 0;
      let totalUpgradedNames = 0;
      let totalDuplicatesInPayload = 0;
      let validRows = 0;
      let resolvedBatchId: number | null = null;
      let resolvedBatchName = '';
      for (let i = 0; i < rows.length; i += UPLOAD_CHUNK_SIZE) {
        const chunk = rows.slice(i, i + UPLOAD_CHUNK_SIZE);
        const uploadResponse: any = await api.post('/leads/bulk', {
          leads: chunk,
          teamId: isUploadAll ? null : selectedTeamId,
          uploadScope: isUploadAll ? 'ALL' : 'TEAM',
          batchId: resolvedBatchId,
          batchName,
          batchLocation,
          isVip: isVipBatch,
        });
        totalInserted += Number(uploadResponse.data?.inserted || 0);
        totalSkippedExisting += Number(uploadResponse.data?.skippedExisting || 0);
        totalUpgradedNames += Number(uploadResponse.data?.upgradedNames || 0);
        totalDuplicatesInPayload += Number(uploadResponse.data?.duplicatesInPayload || 0);
        validRows += Number(uploadResponse.data?.validRows || 0);
        if (!resolvedBatchId && uploadResponse.data?.batch?.id) {
          resolvedBatchId = Number(uploadResponse.data.batch.id);
          resolvedBatchName = uploadResponse.data?.batch?.name || '';
        }
      }
      setSuccess(`تمت المعالجة بنجاح • أضيف: ${totalInserted} • موجود مسبقاً: ${totalSkippedExisting} • تم تحديث أسماء: ${totalUpgradedNames} • مكرر داخل الملف: ${totalDuplicatesInPayload} • صالح: ${validRows}${resolvedBatchName ? ` • الحزمة: ${resolvedBatchName}` : ''}`);
      setTextInput('');
      setBatchName('');
      setBatchLocation('');
      setIsVipBatch(false);
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
        <p className="text-slate-600">إضافة مجموعة كبيرة من الأرقام إلى مجمع فريق محدد أو إلى مجمع عام غير مخصص</p>
      </div>

      <div className="glass-card p-6">
        {user?.role === 'ADMIN' && (
          <div className="mb-4">
            <label className="block text-sm font-bold text-slate-700 mb-2">نطاق الرفع</label>
            <select
              className="input-field"
              value={uploadScope}
              onChange={(e) => setUploadScope(e.target.value as 'TEAM' | 'ALL')}
            >
              <option value="TEAM">لفريق واحد</option>
              <option value="ALL">للمجمع العام</option>
            </select>
          </div>
        )}
        <div className="mb-4">
          <label className="block text-sm font-bold text-slate-700 mb-2">الفريق</label>
          <select
            className="input-field"
            value={selectedTeamId}
            onChange={(e) => setSelectedTeamId(e.target.value ? Number(e.target.value) : '')}
            disabled={(user?.role === 'TEAM_LEAD' && teams.length === 1) || (user?.role === 'ADMIN' && uploadScope === 'ALL')}
          >
            <option value="">اختر الفريق</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
          {user?.role === 'ADMIN' && uploadScope === 'ALL' && (
            <p className="text-xs text-slate-500 mt-2">سيتم إضافة كل رقم للمجمع العام ويُسحب عشوائيًا عند claim.</p>
          )}
        </div>
        <div className="grid md:grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">اسم الحزمة</label>
            <input
              className="input-field"
              value={batchName}
              onChange={(e) => setBatchName(e.target.value)}
              placeholder="مثال: حملة مارس القاهرة"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">المكان/المصدر</label>
            <input
              className="input-field"
              value={batchLocation}
              onChange={(e) => setBatchLocation(e.target.value)}
              placeholder="مثال: مدينة نصر أو إعلانات فيسبوك"
            />
          </div>
        </div>

        <div className="mb-6 flex items-center gap-2">
          <input
            type="checkbox"
            id="isVip"
            checked={isVipBatch}
            onChange={(e) => setIsVipBatch(e.target.checked)}
            className="w-5 h-5 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
          />
          <label htmlFor="isVip" className="text-sm font-bold text-slate-700 cursor-pointer select-none">
            تصنيف هذه الداتا كـ VIP (تظهر بزر ذهبي ولها شروط خاصة للسحب)
          </label>
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
            <label className="block text-sm font-bold text-slate-700">أدخل الأرقام (مثال: 201062008041,مصطفي, أو رقم فقط)</label>
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
