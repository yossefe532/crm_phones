import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import api from '../services/api';
import { 
  Phone, 
  MessageCircle, 
  Check, 
  User,
  AlertCircle
} from 'lucide-react';
import clsx from 'clsx';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../store/useAuth';
import { AUTO_MESSAGE_STATUSES, buildLeadTemplatePlaceholders, buildTemplateMessage, toWhatsAppNumber } from '../utils/whatsapp';

const leadSchema = z.object({
  name: z.string().min(3, 'الاسم يجب أن يكون 3 أحرف على الأقل'),
  phone: z.string().regex(/^01[0125][0-9]{8}$/, 'رقم الهاتف غير صحيح (يجب أن يبدأ بـ 01 ويتكون من 11 رقم)'),
  whatsappPhone: z
    .string()
    .optional()
    .refine((value) => !value || /^01[0125][0-9]{8}$/.test(value), 'رقم الواتساب غير صحيح'),
  notes: z.string().optional(),
  status: z.enum(['NEW', 'AGREED', 'HESITANT', 'REJECTED', 'SPONSOR', 'NO_ANSWER', 'RECONTACT']),
  gender: z.enum(['MALE', 'FEMALE', 'UNKNOWN']),
});

type LeadForm = z.infer<typeof leadSchema>;
interface StatusTemplate {
  status: string;
  content: string;
}

interface ClaimedLeadPayload {
  id: number;
  name: string;
  phone: string;
  whatsappPhone?: string;
  gender?: 'MALE' | 'FEMALE' | 'UNKNOWN';
}

export default function AddLead() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [claimLoading, setClaimLoading] = useState(false);
  const [claimedLeadId, setClaimedLeadId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [templates, setTemplates] = useState<StatusTemplate[]>([]);
  const [messageDraft, setMessageDraft] = useState('');
  const [isEditingMessage, setIsEditingMessage] = useState(false);
  const finalizedRef = useRef(false);

  const { register, handleSubmit, formState: { errors }, setValue, watch } = useForm<LeadForm>({
    resolver: zodResolver(leadSchema),
    defaultValues: {
      status: 'NEW',
      gender: 'UNKNOWN',
      whatsappPhone: '',
    }
  });

  useEffect(() => {
    const initializePage = async () => {
      try {
        const templatesRes = await api.get('/templates');
        setTemplates(templatesRes.data || []);
      } catch {
        setTemplates([]);
      }

      const claimId = Number(searchParams.get('claimId') || 0);
      const claimedFromState = (location.state as { claimedLead?: ClaimedLeadPayload } | null)?.claimedLead;
      const applyClaimedLead = (lead: ClaimedLeadPayload) => {
        if (!lead?.id) return;
        setClaimedLeadId(lead.id);
        setValue('name', lead.name || '');
        setValue('phone', lead.phone || '');
        setValue('whatsappPhone', lead.whatsappPhone || '');
        setValue('gender', lead.gender || 'UNKNOWN');
      };

      if (claimedFromState?.id && (!claimId || claimId === claimedFromState.id)) {
        applyClaimedLead(claimedFromState);
        return;
      }

      if (claimId > 0) {
        setClaimLoading(true);
        try {
          const leadRes = await api.get(`/leads/${claimId}`);
          applyClaimedLead(leadRes.data);
        } catch (claimError: any) {
          setError(claimError?.response?.data?.error || 'تعذر تحميل بيانات العميل المسحوب');
        } finally {
          setClaimLoading(false);
        }
      }
    };

    initializePage();
  }, [location.state, searchParams, setValue]);

  useEffect(() => {
    if (!claimedLeadId) return;
    return () => {
      if (!finalizedRef.current) {
        void api.post(`/leads/${claimedLeadId}/release-claim`).catch(() => undefined);
      }
    };
  }, [claimedLeadId]);

  const onSubmit = async (data: LeadForm) => {
    setSubmitting(true);
    setError('');
    const selectedTemplate = templates.find((t) => t.status === data.status);
    const whatsappTarget = data.whatsappPhone || data.phone;
    const shouldAutoSend =
      data.status !== 'NEW' && AUTO_MESSAGE_STATUSES.has(data.status) && !!messageDraft.trim();
    const waWindow = shouldAutoSend ? window.open('about:blank', '_blank') : null;
    try {
      if (claimedLeadId) {
        await api.post(`/leads/${claimedLeadId}/finalize-claim`, { ...data, source: 'CALL' });
      } else {
        await api.post('/leads', { ...data, source: 'CALL' });
      }
      finalizedRef.current = true;

      if (shouldAutoSend && selectedTemplate) {
        const whatsappNumber = toWhatsAppNumber(whatsappTarget);
        const whatsappUrl = whatsappNumber
          ? `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(messageDraft)}`
          : '';

        if (whatsappUrl) {
          if (waWindow && !waWindow.closed) {
            waWindow.location.replace(whatsappUrl);
          } else {
            window.location.href = whatsappUrl;
          }
        } else {
          waWindow?.close();
        }
      } else {
        waWindow?.close();
      }

      if (claimedLeadId && data.status === 'NEW') {
        navigate('/');
      } else {
        navigate('/leads');
      }
    } catch (err: any) {
      waWindow?.close();
      setError(err.response?.data?.error || 'حدث خطأ أثناء إضافة العميل');
    } finally {
      setSubmitting(false);
    }
  };

  const currentStatus = watch('status');
  const currentGender = watch('gender');
  const currentName = watch('name');
  const currentPhone = watch('phone');
  const currentWhatsappPhone = watch('whatsappPhone');
  const selectedTemplate = templates.find((t) => t.status === currentStatus);
  const previewMessage = useMemo(
    () =>
    currentStatus !== 'NEW' && selectedTemplate?.content
      ? buildTemplateMessage(selectedTemplate.content, {
          ...buildLeadTemplatePlaceholders({
            customerName: currentName || '',
            userName: user?.name || '',
            gender: currentGender,
          }),
        })
      : '',
    [currentGender, currentName, currentStatus, selectedTemplate, user?.name],
  );

  useEffect(() => {
    setMessageDraft(previewMessage);
    setIsEditingMessage(false);
  }, [previewMessage]);

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h2 className="text-3xl font-bold text-slate-800 mb-2">إضافة عميل جديد</h2>
        <p className="text-slate-600">
          {claimedLeadId ? 'تم سحب عميل من المجمع. أكمل حالته الآن.' : 'قم بإدخال بيانات العميل الجديد'}
        </p>
      </div>

      {claimLoading && (
        <div className="glass-card p-4 text-slate-600">جاري تحميل بيانات العميل المسحوب...</div>
      )}

      {claimedLeadId && !claimLoading && (
        <div className="glass-card p-4 border border-purple-100 bg-purple-50/70 text-purple-900 text-sm">
          هذا عميل مسحوب من المجمع. عند الحفظ بالحالة "جديد" سيتم إرجاعه تلقائياً إلى المجمع.
        </div>
      )}

      <div className="glass-card p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-lg font-bold text-slate-700">ابدأ بالتواصل الهاتفي</h3>
            <p className="text-sm text-slate-500">اضغط اتصال مباشر ثم أكمل بيانات العميل.</p>
          </div>
          <a
            href={currentPhone ? `tel:${currentPhone}` : undefined}
            className={clsx(
              'px-6 py-3 rounded-xl font-bold flex items-center gap-2 transition-all',
              currentPhone
                ? 'bg-gradient-to-br from-emerald-400 to-teal-600 text-white shadow-emerald-200 hover:shadow-md'
                : 'bg-slate-100 text-slate-400 pointer-events-none',
            )}
          >
            <Phone size={20} />
            <span>اتصال الآن</span>
          </a>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="glass-card p-8 space-y-8">
        {error && (
          <div className="p-4 bg-red-100 border border-red-200 text-red-700 rounded-xl flex items-center gap-3">
            <AlertCircle size={24} />
            <p>{error}</p>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">اسم العميل</label>
            <div className="relative">
              <User className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
              <input 
                {...register('name')}
                className={clsx("input-field pr-10", errors.name && "border-red-500 focus:border-red-500")}
                placeholder="الاسم الثلاثي"
              />
            </div>
            {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">رقم الهاتف</label>
            <div className="relative">
              <Phone className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
              <input 
                {...register('phone')}
                className={clsx("input-field pr-10", errors.phone && "border-red-500 focus:border-red-500")}
                placeholder="01xxxxxxxxx"
                dir="ltr"
              />
            </div>
            {errors.phone && <p className="text-xs text-red-500 mt-1">{errors.phone.message}</p>}
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-bold text-slate-700">رقم الواتساب (اختياري)</label>
            <div className="relative">
              <MessageCircle className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
              <input
                {...register('whatsappPhone')}
                className={clsx("input-field pr-10", errors.whatsappPhone && "border-red-500 focus:border-red-500")}
                placeholder="01xxxxxxxxx"
                dir="ltr"
              />
            </div>
            {errors.whatsappPhone && <p className="text-xs text-red-500 mt-1">{errors.whatsappPhone.message}</p>}
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-bold text-slate-700">النوع</label>
            <div className="grid grid-cols-3 gap-3">
              {[
                { value: 'MALE', label: 'ذكر' },
                { value: 'FEMALE', label: 'أنثى' },
                { value: 'UNKNOWN', label: 'غير محدد' },
              ].map((genderItem) => (
                <label
                  key={genderItem.value}
                  className={clsx(
                    'cursor-pointer p-3 rounded-xl text-center font-bold transition-all border-2',
                    currentGender === genderItem.value
                      ? 'border-current shadow-md scale-[1.01]'
                      : 'border-slate-200 bg-white hover:bg-slate-50',
                  )}
                >
                  <input type="radio" value={genderItem.value} {...register('gender')} className="hidden" />
                  {genderItem.label}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <label className="text-sm font-bold text-slate-700">حالة العميل</label>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
            {[
              { value: 'NEW', label: 'جديد', color: 'bg-slate-100 hover:bg-slate-200 text-slate-700' },
              { value: 'AGREED', label: 'موافق', color: 'bg-emerald-100 hover:bg-emerald-200 text-emerald-700' },
              { value: 'HESITANT', label: 'متردد', color: 'bg-amber-100 hover:bg-amber-200 text-amber-700' },
              { value: 'REJECTED', label: 'مرفوض', color: 'bg-red-100 hover:bg-red-200 text-red-700' },
              { value: 'SPONSOR', label: 'سبونسر', color: 'bg-yellow-100 hover:bg-yellow-200 text-yellow-700' },
              { value: 'NO_ANSWER', label: 'مردش', color: 'bg-blue-100 hover:bg-blue-200 text-blue-700' },
              { value: 'RECONTACT', label: 'إعادة تواصل', color: 'bg-indigo-100 hover:bg-indigo-200 text-indigo-700' },
            ].map((status) => (
              <label 
                key={status.value}
                className={clsx(
                  "cursor-pointer p-4 rounded-xl text-center font-bold transition-all border-2",
                  currentStatus === status.value 
                    ? "border-current shadow-md scale-105" 
                    : "border-transparent opacity-80 hover:opacity-100",
                  status.color
                )}
              >
                <input 
                  type="radio" 
                  value={status.value} 
                  {...register('status')} 
                  className="hidden"
                />
                {status.label}
              </label>
            ))}
          </div>
        </div>

        {previewMessage && (
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
              <p className="text-sm text-slate-700 bg-white p-3 rounded-lg border border-green-100 whitespace-pre-wrap">
                {messageDraft}
              </p>
            )}
            <p className="text-xs text-slate-500">
              سيتم الإرسال تلقائياً بعد الحفظ على رقم {currentWhatsappPhone || currentPhone || 'الواتساب'}.
            </p>
          </div>
        )}

        <div className="space-y-2">
          <label className="text-sm font-bold text-slate-700">ملاحظات إضافية</label>
          <textarea 
            {...register('notes')}
            className="input-field min-h-[120px]"
            placeholder="أي تفاصيل أخرى..."
          />
        </div>

        <div className="flex justify-end pt-6 border-t border-slate-100">
          <button 
            type="submit" 
            disabled={submitting}
            className="btn-primary w-full md:w-auto min-w-[200px] flex items-center justify-center gap-2"
          >
            {submitting ? (
              <span className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></span>
            ) : (
              <>
                <Check size={20} />
                <span>حفظ العميل</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
