import { useEffect, useState } from 'react';
import api from '../../services/api';
import { AlertCircle, CheckCircle, MessageCircle } from 'lucide-react';
import { useAuth } from '../../store/useAuth';

interface Template {
  id: number;
  status: string;
  content: string;
  scope?: 'USER' | 'TENANT';
}

export default function Templates() {
  const { user } = useAuth();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [scopeByTemplate, setScopeByTemplate] = useState<Record<number, 'USER' | 'TENANT'>>({});
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'TEMPLATES' | 'AI'>('TEMPLATES');
  const [userTrainingTopic, setUserTrainingTopic] = useState('');
  const [userTrainingContext, setUserTrainingContext] = useState('');
  const [globalTrainingTopic, setGlobalTrainingTopic] = useState('');
  const [globalTrainingContext, setGlobalTrainingContext] = useState('');

  const fetchTemplates = async () => {
    try {
      const response = await api.get('/templates');
      const items = response.data || [];
      setTemplates(items);
      setDrafts(items.reduce((acc: Record<number, string>, item: Template) => ({ ...acc, [item.id]: item.content }), {}));
      setScopeByTemplate(items.reduce((acc: Record<number, 'USER' | 'TENANT'>, item: Template) => ({ ...acc, [item.id]: item.scope === 'TENANT' ? 'TENANT' : 'USER' }), {}));
    } catch (err) {
      setError('فشل في جلب القوالب');
    } finally {
      setLoading(false);
    }
  };

  const fetchTraining = async () => {
    try {
      const response = await api.get('/assistant/training');
      setUserTrainingTopic(response.data?.userTraining?.topic || '');
      setUserTrainingContext(response.data?.userTraining?.context || '');
      setGlobalTrainingTopic(response.data?.globalTraining?.topic || '');
      setGlobalTrainingContext(response.data?.globalTraining?.context || '');
    } catch {
      setError('تعذر تحميل إعدادات الذكاء الاصطناعي');
    }
  };

  useEffect(() => {
    fetchTemplates();
    fetchTraining();
  }, []);

  const handleUpdate = async (id: number) => {
    setError('');
    setSuccess('');
    try {
      await api.put(`/templates/${id}`, {
        content: drafts[id],
        scope: scopeByTemplate[id] || 'USER',
      });
      setSuccess('تم تحديث القالب بنجاح');
      await fetchTemplates();
    } catch (err) {
      setError('فشل تحديث القالب');
    }
  };

  const saveTraining = async (scope: 'USER' | 'GLOBAL') => {
    setError('');
    setSuccess('');
    try {
      await api.post('/assistant/training', {
        scope,
        topic: scope === 'GLOBAL' ? globalTrainingTopic : userTrainingTopic,
        context: scope === 'GLOBAL' ? globalTrainingContext : userTrainingContext,
      });
      setSuccess(scope === 'GLOBAL' ? 'تم حفظ تعليمات الذكاء الموحدة' : 'تم حفظ تعليماتك الشخصية للذكاء');
    } catch {
      setError('فشل حفظ إعدادات الذكاء');
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'AGREED': return 'تم الاتفاق (Agreed)';
      case 'REJECTED': return 'تم الرفض (Rejected)';
      case 'HESITANT': return 'متردد (Hesitant)';
      case 'SPONSOR': return 'سبونسر (Sponsor)';
      case 'NO_ANSWER': return 'مردش (No Answer)';
      case 'WRONG_NUMBER': return 'رقم خاطئ (Wrong Number)';
      default: return status;
    }
  };

  if (loading) return <div className="p-8 text-center text-slate-500">جاري التحميل...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-slate-800 mb-2">قوالب الرسائل</h2>
        <p className="text-slate-600">قوالبك الشخصية + إعدادات الذكاء الاصطناعي</p>
      </div>

      <div className="glass-card p-2 inline-flex gap-2">
        <button className={`px-4 py-2 rounded-lg text-sm font-bold ${activeTab === 'TEMPLATES' ? 'bg-emerald-100 text-emerald-700' : 'text-slate-600'}`} onClick={() => setActiveTab('TEMPLATES')}>قوالب الرسائل</button>
        <button className={`px-4 py-2 rounded-lg text-sm font-bold ${activeTab === 'AI' ? 'bg-indigo-100 text-indigo-700' : 'text-slate-600'}`} onClick={() => setActiveTab('AI')}>إعدادات الذكاء</button>
      </div>

      {success && (
        <div className="p-4 bg-emerald-100 text-emerald-700 rounded-xl flex items-center gap-2">
          <CheckCircle size={20} />
          <p>{success}</p>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-100 text-red-700 rounded-xl flex items-center gap-2">
          <AlertCircle size={20} />
          <p>{error}</p>
        </div>
      )}

      {activeTab === 'TEMPLATES' ? (
        <div className="grid gap-6">
          {templates.map((template) => (
            <div key={template.id} className="glass-card p-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-2">
                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <MessageCircle size={20} className="text-emerald-500" />
                  {getStatusLabel(template.status)}
                </h3>
                <div className="flex items-center gap-2">
                  <select
                    className="input-field text-sm"
                    value={scopeByTemplate[template.id] || 'USER'}
                    onChange={(e) => setScopeByTemplate((prev) => ({ ...prev, [template.id]: e.target.value as 'USER' | 'TENANT' }))}
                  >
                    <option value="USER">قالب خاص بي</option>
                    {user?.role === 'ADMIN' && <option value="TENANT">قالب موحد للشركة</option>}
                  </select>
                  <button className="btn-primary text-xs" onClick={() => handleUpdate(template.id)}>حفظ</button>
                </div>
              </div>
              <textarea
                className="input-field min-h-[120px] mb-4 font-mono text-sm"
                value={drafts[template.id] ?? template.content}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [template.id]: e.target.value }))}
                placeholder="اكتب نص الرسالة هنا..."
              />
              <p className="text-xs text-slate-500">
                المتغيرات المتاحة: <code className="bg-slate-100 px-1 rounded">{'{customer_name}'}</code>، <code className="bg-slate-100 px-1 rounded">{'{user_name}'}</code>، <code className="bg-slate-100 px-1 rounded">{'{customer_title}'}</code>، <code className="bg-slate-100 px-1 rounded">{'{customer_gender_ar}'}</code>، <code className="bg-slate-100 px-1 rounded">{'{customer_object_pronoun}'}</code>
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {user?.role === 'ADMIN' && (
            <div className="glass-card p-6 space-y-3">
              <h3 className="text-lg font-bold text-slate-800">تعليمات الذكاء الموحدة (المالك)</h3>
              <input className="input-field" value={globalTrainingTopic} onChange={(e) => setGlobalTrainingTopic(e.target.value)} placeholder="الموضوع الموحد" />
              <textarea className="input-field min-h-[120px]" value={globalTrainingContext} onChange={(e) => setGlobalTrainingContext(e.target.value)} placeholder="تعليمات موحدة للذكاء الاصطناعي..." />
              <button className="btn-primary" onClick={() => saveTraining('GLOBAL')}>حفظ التعليمات الموحدة</button>
            </div>
          )}
          <div className="glass-card p-6 space-y-3">
            <h3 className="text-lg font-bold text-slate-800">تعليمات الذكاء الخاصة بي</h3>
            <input className="input-field" value={userTrainingTopic} onChange={(e) => setUserTrainingTopic(e.target.value)} placeholder="موضوعي الحالي" />
            <textarea className="input-field min-h-[120px]" value={userTrainingContext} onChange={(e) => setUserTrainingContext(e.target.value)} placeholder="كيف أحب الذكاء يساعدني في كتابة السكربت..." />
            <button className="btn-secondary" onClick={() => saveTraining('USER')}>حفظ تعليماتي الشخصية</button>
          </div>
        </div>
      )}
    </div>
  );
}
