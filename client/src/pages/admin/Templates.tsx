import { useEffect, useState } from 'react';
import api from '../../services/api';
import { AlertCircle, CheckCircle, MessageCircle } from 'lucide-react';

interface Template {
  id: number;
  status: string;
  content: string;
}

export default function Templates() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  const fetchTemplates = async () => {
    try {
      const response = await api.get('/templates');
      setTemplates(response.data);
    } catch (err) {
      setError('فشل في جلب القوالب');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  const handleUpdate = async (id: number, content: string) => {
    setError('');
    setSuccess('');
    try {
      await api.put(`/templates/${id}`, { content });
      setSuccess('تم تحديث القالب بنجاح');
    } catch (err) {
      setError('فشل تحديث القالب');
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'AGREED': return 'تم الاتفاق (Agreed)';
      case 'REJECTED': return 'تم الرفض (Rejected)';
      case 'HESITANT': return 'متردد (Hesitant)';
      case 'SPONSOR': return 'سبونسر (Sponsor)';
      case 'NO_ANSWER': return 'مردش (No Answer)';
      default: return status;
    }
  };

  if (loading) return <div className="p-8 text-center text-slate-500">جاري التحميل...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-slate-800 mb-2">قوالب الرسائل</h2>
        <p className="text-slate-600">تعديل الرسائل التلقائية لكل حالة</p>
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

      <div className="grid gap-6">
        {templates.map((template) => (
          <div key={template.id} className="glass-card p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <MessageCircle size={20} className="text-emerald-500" />
                {getStatusLabel(template.status)}
              </h3>
            </div>
            
            <textarea
              className="input-field min-h-[120px] mb-4 font-mono text-sm"
              defaultValue={template.content}
              onBlur={(e) => handleUpdate(template.id, e.target.value)}
              placeholder="اكتب نص الرسالة هنا..."
            />
            
            <p className="text-xs text-slate-500">
              المتغيرات المتاحة: <code className="bg-slate-100 px-1 rounded">{'{customer_name}'}</code>، <code className="bg-slate-100 px-1 rounded">{'{user_name}'}</code>، <code className="bg-slate-100 px-1 rounded">{'{customer_title}'}</code>، <code className="bg-slate-100 px-1 rounded">{'{customer_gender_ar}'}</code>، <code className="bg-slate-100 px-1 rounded">{'{customer_object_pronoun}'}</code>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
