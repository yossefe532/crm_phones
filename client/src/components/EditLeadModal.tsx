import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { X, Check, MessageCircle, Crown } from 'lucide-react';
import clsx from 'clsx';
import api from '../services/api';
import { useAuth } from '../store/useAuth';
import { AUTO_MESSAGE_STATUSES, buildLeadTemplatePlaceholders, buildTemplateMessage, toWhatsAppNumber } from '../utils/whatsapp';

const EGYPT_MOBILE_REGEX = /^(01[0125][0-9]{8}|20[1235][0-9]{9})$/;

const schema = z.object({
  name: z.string().min(1, 'الاسم مطلوب'),
  status: z.string(),
  notes: z.string().optional(),
  whatsappPhone: z
    .string()
    .optional()
    .refine((v) => !v || EGYPT_MOBILE_REGEX.test(v.replace(/\s+/g, '')), 'رقم الواتساب غير صحيح'),
  gender: z.enum(['MALE', 'FEMALE', 'UNKNOWN']),
});

type FormData = z.infer<typeof schema>;
const UNKNOWN_NAME_VALUE = 'UNKNOWN';
const UNKNOWN_ALLOWED_STATUSES = new Set(['NEW', 'NO_ANSWER', 'RECONTACT', 'WRONG_NUMBER']);
const STATUS_LABELS: Record<string, string> = {
  NEW: 'جديد',
  INTERESTED: 'مهتم',
  AGREED: 'موافق',
  HESITANT: 'متردد',
  REJECTED: 'مرفوض',
  SPONSOR: 'سبونسر',
  NO_ANSWER: 'مردش',
  RECONTACT: 'إعادة تواصل',
  WRONG_NUMBER: 'رقم خاطئ',
};

interface Props {
  lead: any;
  onClose: () => void;
  onUpdate: () => void;
}

interface StatusTemplate {
  status: string;
  content: string;
}

export default function EditLeadModal({ lead, onClose, onUpdate }: Props) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [templates, setTemplates] = useState<StatusTemplate[]>([]);
  const [template, setTemplate] = useState('');
  const [messageDraft, setMessageDraft] = useState('');
  const [isEditingMessage, setIsEditingMessage] = useState(false);
  
  const { register, handleSubmit, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: lead.name,
      status: lead.status,
      notes: lead.notes || '',
      whatsappPhone: lead.whatsappPhone || '',
      gender: lead.gender || 'UNKNOWN',
    }
  });

  const currentStatus = watch('status');
  const currentName = watch('name');
  const currentGender = watch('gender');

  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        const res = await api.get('/templates');
        setTemplates(res.data || []);
      } catch (error) {
        console.error(error);
      }
    };
    fetchTemplates();
  }, []);

  // Generate status template with placeholders
  useEffect(() => {
    if (!AUTO_MESSAGE_STATUSES.has(currentStatus)) {
      setTemplate('');
      return;
    }

    const selectedTemplate = templates.find((t) => t.status === currentStatus);
    if (!selectedTemplate) {
      setTemplate('');
      return;
    }

    setTemplate(
      buildTemplateMessage(selectedTemplate.content, {
        ...buildLeadTemplatePlaceholders({
          customerName: currentName || lead.name || '',
          userName: user?.name || '',
          gender: currentGender,
        }),
      }),
    );
  }, [currentGender, currentName, currentStatus, lead.name, templates, user?.name]);

  useEffect(() => {
    setMessageDraft(template);
    setIsEditingMessage(false);
  }, [template]);

  const getWhatsAppUrl = (message: string, phoneInput?: string) => {
    const phone = toWhatsAppNumber(phoneInput || lead.whatsappPhone || lead.phone);
    if (!phone) {
      return '';
    }

    return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  };

  const openWhatsAppMessage = (message: string, phoneInput?: string, targetWindow?: Window | null) => {
    const url = getWhatsAppUrl(message, phoneInput);
    if (!url) {
      targetWindow?.close();
      return;
    }

    if (targetWindow && !targetWindow.closed) {
      targetWindow.location.replace(url);
      return;
    }

    window.location.href = url;
  };

  const onSubmit = async (data: FormData) => {
    setError('');
    if (data.name.trim().toUpperCase() === UNKNOWN_NAME_VALUE && !UNKNOWN_ALLOWED_STATUSES.has(data.status)) {
      setError(`لا يمكن حفظ الحالة "${STATUS_LABELS[data.status] || data.status}" مع اسم UNKNOWN. أدخل الاسم أولاً.`);
      return;
    }
    setLoading(true);
    const selectedTemplate = templates.find((t) => t.status === data.status);
    const autoMessage = selectedTemplate
      ? buildTemplateMessage(selectedTemplate.content, {
          ...buildLeadTemplatePlaceholders({
            customerName: data.name || '',
            userName: user?.name || '',
            gender: data.gender,
          }),
        })
      : '';
    const finalMessage = messageDraft.trim() || autoMessage;
    const whatsappTarget = data.whatsappPhone || lead.phone;
    const shouldAutoSend =
      data.status !== lead.status && AUTO_MESSAGE_STATUSES.has(data.status) && !!finalMessage;
    const waWindow = shouldAutoSend ? window.open('about:blank', '_blank') : null;
    try {
      await api.put(`/leads/${lead.id}`, data);
      if (shouldAutoSend) {
        openWhatsAppMessage(finalMessage, whatsappTarget, waWindow);
      } else {
        waWindow?.close();
      }
      onUpdate();
    } catch (error) {
      waWindow?.close();
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[95vh] flex flex-col overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 flex-shrink-0">
          <h3 className="text-xl font-bold text-slate-800">تعديل بيانات العميل</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={24} />
          </button>
        </div>

        <form id="edit-lead-form" onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-6 overflow-y-auto custom-scrollbar flex-1 min-h-0">
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700">اسم العميل</label>
              <input 
                {...register('name')}
                className={clsx("input-field", errors.name && "border-red-500")}
              />
              {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700">رقم الهاتف</label>
              <div className="input-field bg-slate-50 text-slate-500 flex items-center justify-between">
                <span dir="ltr">{lead.phone}</span>
                <span className="text-xs bg-slate-200 px-2 py-1 rounded">لا يمكن تعديله</span>
              </div>
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-bold text-slate-700">رقم الواتساب (اختياري)</label>
              <input
                {...register('whatsappPhone')}
                className={clsx("input-field", errors.whatsappPhone && "border-red-500")}
                placeholder="01xxxxxxxxx أو 20xxxxxxxxxx"
                dir="ltr"
              />
              {errors.whatsappPhone && <p className="text-xs text-red-500">{errors.whatsappPhone.message}</p>}
            </div>
          </div>
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm font-bold">
              {error}
            </div>
          )}

          <div className="space-y-3">
            <label className="text-sm font-bold text-slate-700">النوع</label>
            <div className="grid grid-cols-3 gap-3">
              {[
                { value: 'MALE', label: 'ذكر' },
                { value: 'FEMALE', label: 'أنثى' },
                { value: 'UNKNOWN', label: 'غير محدد' },
              ].map((item) => (
                <label
                  key={item.value}
                  className={clsx(
                    'cursor-pointer p-3 rounded-xl text-center font-bold transition-all border-2',
                    currentGender === item.value
                      ? 'border-current shadow-md scale-[1.01]'
                      : 'border-slate-200 bg-white hover:bg-slate-50',
                  )}
                >
                  <input type="radio" value={item.value} {...register('gender')} className="hidden" />
                  {item.label}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <label className="text-sm font-bold text-slate-700">تحديث الحالة</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {[
                { value: 'NEW', label: 'جديد', color: 'bg-slate-100' },
                { value: 'INTERESTED', label: 'مهتم', color: 'bg-cyan-100 text-cyan-700' },
                { value: 'AGREED', label: 'موافق', color: 'bg-emerald-100 text-emerald-700' },
                { value: 'HESITANT', label: 'متردد', color: 'bg-amber-100 text-amber-700' },
                { value: 'REJECTED', label: 'مرفوض', color: 'bg-red-100 text-red-700' },
                { value: 'SPONSOR', label: 'سبونسر', color: 'bg-yellow-100 text-yellow-700 border-yellow-300', icon: Crown },
                { value: 'NO_ANSWER', label: 'مردش', color: 'bg-blue-100 text-blue-700' },
                { value: 'RECONTACT', label: 'إعادة تواصل', color: 'bg-indigo-100 text-indigo-700' },
                { value: 'WRONG_NUMBER', label: 'رقم خاطئ', color: 'bg-rose-100 text-rose-700' },
              ].map((status) => (
                <label 
                  key={status.value}
                  className={clsx(
                    "cursor-pointer p-3 rounded-xl text-center font-bold transition-all border-2 flex items-center justify-center gap-1 text-sm",
                    currentStatus === status.value 
                      ? "border-current shadow-md scale-105" 
                      : "border-transparent opacity-70 hover:opacity-100",
                    status.color
                  )}
                >
                  <input 
                    type="radio" 
                    value={status.value} 
                    {...register('status')} 
                    className="hidden"
                  />
                  {status.icon && <status.icon size={14} />}
                  {status.label}
                </label>
              ))}
            </div>
          </div>

          {template && (
            <div className="p-4 bg-green-50 border border-green-100 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-green-800 flex items-center gap-2">
                  <MessageCircle size={18} />
                  رسالة واتساب المقترحة
                </h4>
                <button
                  type="button"
                  onClick={() => setIsEditingMessage((prev) => !prev)}
                  className="text-xs bg-green-500 text-white px-3 py-1.5 rounded-lg hover:bg-green-600 transition-colors font-bold flex items-center gap-1"
                >
                  تعديل الرسالة
                </button>
              </div>
              {isEditingMessage ? (
                <textarea
                  value={messageDraft}
                  onChange={(e) => setMessageDraft(e.target.value)}
                  className="input-field min-h-[120px]"
                  placeholder="عدّل الرسالة قبل الإرسال..."
                />
              ) : (
                <p className="text-sm text-slate-600 bg-white p-3 rounded-lg border border-green-100 whitespace-pre-wrap">
                  {messageDraft}
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">ملاحظات</label>
            <textarea 
              {...register('notes')}
              className="input-field min-h-[100px]"
              placeholder="أضف ملاحظاتك هنا..."
            />
          </div>
        </form>

        <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2 rounded-xl font-bold text-slate-500 hover:bg-slate-100 transition-colors"
          >
            إلغاء
          </button>
          <button
            form="edit-lead-form"
            type="submit"
            disabled={loading}
            className="btn-primary min-w-[120px] flex items-center justify-center gap-2"
          >
            {loading ? <span className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></span> : (
              <>
                <Check size={20} />
                <span>حفظ التعديلات</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
