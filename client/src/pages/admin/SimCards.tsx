
import { useState, useEffect } from 'react';
import { 
  Upload, 
  Search, 
  Save, 
  Check, 
  X, 
  AlertTriangle, 
  Smartphone, 
  Loader2,
  Database,
  UserCheck
} from 'lucide-react';
import api from '../../services/api';

interface User {
  id: number;
  name: string;
  role: string;
  simSerialNumber?: string;
  simPhoneNumber?: string;
}

interface ParsedResult {
  raw: string;
  parsed: {
    name: string;
    serial: string | null;
    phone: string | null;
  };
  match: {
    id: number;
    name: string;
    score: number;
  } | null;
  selectedUserId?: number; // For manual override
}

export default function SimCards() {
  const [activeTab, setActiveTab] = useState<'list' | 'upload'>('list');
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // List State
  const [searchQuery, setSearchQuery] = useState('');

  // Upload State
  const [rawText, setRawText] = useState('');
  const [parsedData, setParsedData] = useState<ParsedResult[]>([]);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [availableUsers, setAvailableUsers] = useState<{id: number, name: string}[]>([]);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const response = await api.get('/admin/sim-cards');
      setUsers(response.data);
    } catch (err: any) {
      console.error(err);
      setError('فشل تحميل بيانات الخطوط');
    } finally {
      setLoading(false);
    }
  };

  const handleParse = async () => {
    if (!rawText.trim()) return;
    setParsing(true);
    setError(null);
    try {
      const response = await api.post('/admin/sim-cards/parse', { text: rawText });
      const { results, users } = response.data;
      
      // Initialize selectedUserId with the best match if score is good enough
      const initializedResults = results.map((r: ParsedResult) => ({
        ...r,
        selectedUserId: r.match ? r.match.id : undefined
      }));
      
      setParsedData(initializedResults);
      setAvailableUsers(users);
      if (initializedResults.length === 0) {
        setError('لم يتم العثور على بيانات صالحة في النص المدخل');
      }
    } catch (err: any) {
      console.error(err);
      setError('فشل تحليل البيانات');
    } finally {
      setParsing(false);
    }
  };

  const handleSaveAssignments = async () => {
    const assignments = parsedData
      .filter(item => item.selectedUserId && item.parsed.serial)
      .map(item => ({
        userId: item.selectedUserId,
        serial: item.parsed.serial,
        phone: item.parsed.phone
      }));

    if (assignments.length === 0) {
      setError('لا توجد بيانات صالحة للحفظ. تأكد من تحديد الموظف وتوفر الرقم التسلسلي.');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await api.post('/admin/sim-cards/assign', { assignments });
      setSuccess(`تم تحديث بيانات ${response.data.count} موظف بنجاح`);
      setRawText('');
      setParsedData([]);
      setActiveTab('list');
      fetchUsers();
    } catch (err: any) {
      console.error(err);
      setError('فشل حفظ البيانات');
    } finally {
      setSaving(false);
    }
  };

  const filteredUsers = users.filter(user => {
    const query = searchQuery.toLowerCase();
    return (
      user.name.toLowerCase().includes(query) ||
      (user.simSerialNumber && user.simSerialNumber.includes(query)) ||
      (user.simPhoneNumber && user.simPhoneNumber.includes(query))
    );
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Smartphone className="text-indigo-600" />
            إدارة خطوط العمل
          </h1>
          <p className="text-slate-500 mt-1">توزيع وإدارة شرائح الاتصال للموظفين</p>
        </div>
        
        <div className="flex bg-slate-100 p-1 rounded-xl">
          <button
            onClick={() => setActiveTab('list')}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
              activeTab === 'list' 
                ? 'bg-white text-indigo-600 shadow-sm' 
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            قائمة الخطوط
          </button>
          <button
            onClick={() => setActiveTab('upload')}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
              activeTab === 'upload' 
                ? 'bg-white text-indigo-600 shadow-sm' 
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            إضافة / تحديث
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <AlertTriangle size={20} />
          {error}
        </div>
      )}

      {success && (
        <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-600 flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <Check size={20} />
          {success}
        </div>
      )}

      {activeTab === 'list' ? (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="relative w-full sm:w-96">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
              <input
                type="text"
                placeholder="بحث بالاسم، الرقم، أو السيريال..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pr-10 pl-4 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
              />
            </div>
            <div className="text-sm text-slate-500 font-medium">
              إجمالي الخطوط الموزعة: {users.filter(u => u.simSerialNumber).length}
            </div>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-right">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-bold">
                <tr>
                  <th className="px-6 py-4">الموظف</th>
                  <th className="px-6 py-4">الدور</th>
                  <th className="px-6 py-4">رقم الخط</th>
                  <th className="px-6 py-4">السيريال (Serial Number)</th>
                  <th className="px-6 py-4 text-center">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                      <Loader2 className="w-8 h-8 mx-auto mb-2 animate-spin text-indigo-500" />
                      جاري التحميل...
                    </td>
                  </tr>
                ) : filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                      لا توجد بيانات مطابقة للبحث
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((user) => (
                    <tr key={user.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4 font-bold text-slate-800">{user.name}</td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded-lg text-xs font-bold ${
                          user.role === 'TEAM_LEAD' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'
                        }`}>
                          {user.role === 'TEAM_LEAD' ? 'Team Lead' : 'Sales Agent'}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-mono text-slate-600" dir="ltr">
                        {user.simPhoneNumber || '-'}
                      </td>
                      <td className="px-6 py-4 font-mono text-slate-500 text-sm" dir="ltr">
                        {user.simSerialNumber || '-'}
                      </td>
                      <td className="px-6 py-4 text-center">
                        {user.simSerialNumber ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold">
                            <Check size={12} />
                            مفعل
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100 text-slate-400 text-xs font-bold">
                            غير معين
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
            <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
              <Upload size={20} className="text-indigo-600" />
              إدخال البيانات
            </h3>
            <p className="text-sm text-slate-500 mb-4 leading-relaxed">
              قم بنسخ ولصق القائمة بالصيغة التالية:
              <br />
              <code className="bg-slate-100 px-2 py-1 rounded text-indigo-600 font-mono mx-1">
                [الرقم التسلسلي] [الاسم] [رقم الهاتف]
              </code>
              <br />
              مثال:
              <span className="block mt-2 p-3 bg-slate-50 rounded-lg border border-slate-100 font-mono text-xs text-slate-600 dir-ltr text-left">
                8920022023438078 معاز محمد حسن 01016158560 195
              </span>
            </p>
            
            <textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder="الصق البيانات هنا..."
              className="w-full h-48 p-4 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-mono text-sm mb-4"
              dir="ltr"
            />
            
            <div className="flex justify-end">
              <button
                onClick={handleParse}
                disabled={parsing || !rawText.trim()}
                className="btn-primary flex items-center gap-2 px-6 py-2.5 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {parsing ? <Loader2 size={18} className="animate-spin" /> : <Database size={18} />}
                تحليل البيانات
              </button>
            </div>
          </div>

          {parsedData.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in slide-in-from-bottom-4">
              <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                <h3 className="font-bold text-slate-800">نتائج التحليل ({parsedData.length})</h3>
                <button
                  onClick={handleSaveAssignments}
                  disabled={saving}
                  className="btn-primary bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-2 px-6 py-2 rounded-xl shadow-lg shadow-emerald-200 disabled:opacity-50"
                >
                  {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                  حفظ التعيينات
                </button>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-right">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-bold">
                    <tr>
                      <th className="px-6 py-4">البيانات المستخرجة</th>
                      <th className="px-6 py-4">السيريال / الرقم</th>
                      <th className="px-6 py-4">تعيين للموظف</th>
                      <th className="px-6 py-4 text-center">الحالة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {parsedData.map((item, index) => (
                      <tr key={index} className={`hover:bg-slate-50/50 transition-colors ${!item.parsed.serial ? 'bg-red-50/30' : ''}`}>
                        <td className="px-6 py-4">
                          <p className="font-bold text-slate-800">{item.parsed.name || 'اسم غير معروف'}</p>
                          <p className="text-xs text-slate-400 mt-1 truncate max-w-[200px]" title={item.raw}>
                            {item.raw}
                          </p>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col gap-1">
                            <span className="font-mono text-xs bg-slate-100 px-2 py-1 rounded text-slate-600 w-fit">
                              S: {item.parsed.serial || 'غير موجود'}
                            </span>
                            <span className="font-mono text-xs bg-indigo-50 px-2 py-1 rounded text-indigo-600 w-fit">
                              P: {item.parsed.phone || 'غير موجود'}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="relative">
                            <select
                              value={item.selectedUserId || ''}
                              onChange={(e) => {
                            const newParsedData = [...parsedData];
                            newParsedData[index] = {
                              ...newParsedData[index],
                              selectedUserId: Number(e.target.value) || undefined
                            };
                            setParsedData(newParsedData);
                          }}
                          className={`w-full p-2 pr-8 rounded-lg border appearance-none focus:outline-none focus:ring-2 transition-all ${
                            item.match && item.match.id === item.selectedUserId
                              ? 'border-emerald-200 bg-emerald-50/50 focus:ring-emerald-500/20'
                              : 'border-slate-200 focus:ring-indigo-500/20'
                          }`}
                        >
                          <option value="">اختر موظف...</option>
                          {availableUsers.map(u => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                        </select>
                        <UserCheck className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 pointer-events-none" />
                      </div>
                      {item.match && !item.selectedUserId && (
                        <div className="flex items-center gap-1 mt-1 cursor-pointer" onClick={() => {
                          const newParsedData = [...parsedData];
                          newParsedData[index] = {
                            ...newParsedData[index],
                            selectedUserId: item.match!.id
                          };
                          setParsedData(newParsedData);
                        }}>
                          <AlertTriangle size={12} className="text-amber-500" />
                          <p className="text-xs text-amber-600 font-medium underline decoration-dashed">
                            اقتراح: {item.match.name}
                          </p>
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center">
                      {item.selectedUserId && item.parsed.serial ? (
                        <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-sm">
                          <Check size={16} />
                        </div>
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                          <X size={16} />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
