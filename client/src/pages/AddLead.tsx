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
  AlertCircle,
  Image,
  PlayCircle
} from 'lucide-react';
import clsx from 'clsx';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../store/useAuth';
import { AUTO_MESSAGE_STATUSES, buildLeadTemplatePlaceholders, buildTemplateMessage, toWhatsAppNumber } from '../utils/whatsapp';
import { assistantService } from '../services/assistant';

const EGYPT_MOBILE_REGEX = /^(01[0125][0-9]{8}|20[1235][0-9]{9})$/;

const leadSchema = z.object({
  name: z.string().min(3, 'الاسم يجب أن يكون 3 أحرف على الأقل'),
  phone: z.string().regex(EGYPT_MOBILE_REGEX, 'رقم الهاتف غير صحيح (ابدأ بـ 01 أو 20)'),
  whatsappPhone: z
    .string()
    .optional()
    .refine((value) => !value || EGYPT_MOBILE_REGEX.test(value), 'رقم الواتساب غير صحيح'),
  notes: z.string().optional(),
  profileDetails: z.string().optional(),
  status: z.enum(['NEW', 'AGREED', 'HESITANT', 'REJECTED', 'SPONSOR', 'NO_ANSWER', 'RECONTACT', 'WRONG_NUMBER']),
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
  profileDetails?: string;
  gender?: 'MALE' | 'FEMALE' | 'UNKNOWN';
}

interface RecontactLeadPayload {
  id: number;
  name: string;
  phone: string;
  whatsappPhone?: string;
  notes?: string;
  profileDetails?: string;
  status?: 'NO_ANSWER' | 'RECONTACT' | 'NEW' | 'AGREED' | 'HESITANT' | 'REJECTED' | 'SPONSOR' | 'WRONG_NUMBER';
  source?: 'CALL' | 'SEND';
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
  const [recontactLeadId, setRecontactLeadId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [templates, setTemplates] = useState<StatusTemplate[]>([]);
  const [messageDraft, setMessageDraft] = useState('');
  const [isEditingMessage, setIsEditingMessage] = useState(false);
  const [includeMaterial, setIncludeMaterial] = useState(false);
  const [includeOfficialVideo, setIncludeOfficialVideo] = useState(false);
  const [assistantTab, setAssistantTab] = useState<'TRAINING' | 'SCRIPT'>('SCRIPT');
  const [trainingTopic, setTrainingTopic] = useState('');
  const [trainingContext, setTrainingContext] = useState('');
  const [trainingSaving, setTrainingSaving] = useState(false);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantError, setAssistantError] = useState('');
  const [assistantScript, setAssistantScript] = useState('');
  const [followUpQuestions, setFollowUpQuestions] = useState<string[]>([]);
  const [webInsights, setWebInsights] = useState<string[]>([]);
  const [occupation, setOccupation] = useState('');
  const [age, setAge] = useState('');
  const [education, setEducation] = useState('');
  const [goals, setGoals] = useState('');
  const [nameDetectedHint, setNameDetectedHint] = useState('');
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
      try {
        const trainingRes = await assistantService.getTraining();
        setTrainingTopic(trainingRes.effectiveTraining?.topic || '');
        setTrainingContext(trainingRes.effectiveTraining?.context || '');
      } catch {
        setTrainingTopic('');
        setTrainingContext('');
      }

      const claimId = Number(searchParams.get('claimId') || 0);
      const recontactId = Number(searchParams.get('recontactId') || 0);
      const claimedFromState = (location.state as { claimedLead?: ClaimedLeadPayload } | null)?.claimedLead;
      const recontactFromState = (location.state as { recontactLead?: RecontactLeadPayload } | null)?.recontactLead;
      const applyClaimedLead = (lead: ClaimedLeadPayload) => {
        if (!lead?.id) return;
        setClaimedLeadId(lead.id);
        setRecontactLeadId(null);
        setValue('name', lead.name || '');
        setValue('phone', lead.phone || '');
        setValue('whatsappPhone', lead.whatsappPhone || '');
        setValue('gender', lead.gender || 'UNKNOWN');
        setValue('profileDetails', lead.profileDetails || '');
      };
      const applyRecontactLead = (lead: RecontactLeadPayload) => {
        if (!lead?.id) return;
        setRecontactLeadId(lead.id);
        setClaimedLeadId(null);
        setValue('name', lead.name || '');
        setValue('phone', lead.phone || '');
        setValue('whatsappPhone', lead.whatsappPhone || '');
        setValue('gender', lead.gender || 'UNKNOWN');
        setValue('notes', lead.notes || '');
        setValue('profileDetails', lead.profileDetails || '');
        setValue('status', lead.status === 'RECONTACT' ? 'NO_ANSWER' : ((lead.status as LeadForm['status']) || 'NO_ANSWER'));
      };

      if (claimedFromState?.id && (!claimId || claimId === claimedFromState.id)) {
        applyClaimedLead(claimedFromState);
        return;
      }
      if (recontactFromState?.id && (!recontactId || recontactId === recontactFromState.id)) {
        applyRecontactLead(recontactFromState);
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

      if (recontactId > 0) {
        setClaimLoading(true);
        try {
          const leadRes = await api.get(`/leads/${recontactId}`);
          applyRecontactLead(leadRes.data);
        } catch (recontactError: any) {
          setError(recontactError?.response?.data?.error || 'تعذر تحميل بيانات عميل إعادة التواصل');
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
    const materialUrl = 'https://postimg.cc/gallery/QsVwM6J';
    const officialVideoUrl = 'https://www.facebook.com/share/r/1CdjpkHzKx/';
    const outgoingMessage = [
      messageDraft.trim(),
      includeMaterial ? `الماتريال (صور):\n${materialUrl}` : '',
      includeOfficialVideo ? `الفيديو الرسمي:\n${officialVideoUrl}` : '',
    ].filter(Boolean).join('\n\n');
    const shouldAutoSend =
      data.status !== 'NEW' && AUTO_MESSAGE_STATUSES.has(data.status) && !!outgoingMessage.trim();
    const waWindow = shouldAutoSend ? window.open('about:blank', '_blank') : null;
    try {
      console.log('Submitting lead data:', { ...data, claimedLeadId, recontactLeadId });
      if (claimedLeadId) {
        await api.post(`/leads/${claimedLeadId}/finalize-claim`, { ...data, source: 'CALL' });
      } else if (recontactLeadId) {
        await api.put(`/leads/${recontactLeadId}`, { ...data, source: 'CALL', logCall: true });
      } else {
        await api.post('/leads', { ...data, source: 'CALL' });
      }
      finalizedRef.current = true;

      if (shouldAutoSend && selectedTemplate) {
        const whatsappNumber = toWhatsAppNumber(whatsappTarget);
        const whatsappUrl = whatsappNumber
          ? `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(outgoingMessage)}`
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
        if (recontactLeadId) {
          navigate(data.status === 'NO_ANSWER' ? '/leads/no-answer' : '/leads');
        } else {
          navigate('/leads');
        }
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
  const currentNotes = watch('notes');
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
  const outgoingPreview = useMemo(() => {
    const materialUrl = 'https://postimg.cc/gallery/QsVwM6J';
    const officialVideoUrl = 'https://www.facebook.com/share/r/1CdjpkHzKx/';
    return [
      messageDraft.trim(),
      includeMaterial ? `الماتريال (صور):\n${materialUrl}` : '',
      includeOfficialVideo ? `الفيديو الرسمي:\n${officialVideoUrl}` : '',
    ].filter(Boolean).join('\n\n');
  }, [includeMaterial, includeOfficialVideo, messageDraft]);

  useEffect(() => {
    if (currentName?.trim()) return;
    if (!currentNotes?.trim() || currentNotes.trim().length < 8) return;
    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await assistantService.extractName(currentNotes);
        if (response.extractedName && !currentName?.trim()) {
          setValue('name', response.extractedName, { shouldValidate: true, shouldDirty: true });
          setNameDetectedHint(`تم اكتشاف الاسم تلقائياً: ${response.extractedName}`);
        }
      } catch {
        setNameDetectedHint('');
      }
    }, 700);
    return () => window.clearTimeout(timeoutId);
  }, [currentName, currentNotes, setValue]);

  const handleSaveTraining = async () => {
    setAssistantError('');
    setTrainingSaving(true);
    try {
      const saved = await assistantService.saveTraining({
        topic: trainingTopic,
        context: trainingContext,
        scope: 'USER',
      });
      const savedTopic = saved.training?.topic || trainingTopic;
      const savedContext = saved.training?.context || trainingContext;
      setTrainingTopic(savedTopic);
      setTrainingContext(savedContext);
    } catch (err: any) {
      setAssistantError(err?.response?.data?.error || 'تعذر حفظ تدريب المساعد');
    } finally {
      setTrainingSaving(false);
    }
  };

  const handleGenerateScript = async () => {
    setAssistantError('');
    setAssistantLoading(true);
    try {
      const response = await assistantService.generateScript({
        leadName: currentName || '',
        occupation,
        age,
        education,
        goals,
        notes: currentNotes || '',
        trainingTopic,
        trainingContext,
        searchWeb: true,
      });
      setAssistantScript(response.script || '');
      setFollowUpQuestions(response.followUpQuestions || []);
      setWebInsights(response.webInsights || []);
      if (!trainingTopic && response.trainingTopic) setTrainingTopic(response.trainingTopic);
      if (!trainingContext && response.trainingContext) setTrainingContext(response.trainingContext);
    } catch (err: any) {
      setAssistantError(err?.response?.data?.error || 'تعذر توليد السكريبت الذكي');
    } finally {
      setAssistantLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h2 className="text-3xl font-bold text-slate-800 mb-2">إضافة عميل جديد</h2>
        <p className="text-slate-600">
          {claimedLeadId
            ? 'تم سحب عميل من المجمع. أكمل حالته الآن.'
            : recontactLeadId
              ? 'إعادة تواصل مع عميل من قائمة مردوش.'
              : 'قم بإدخال بيانات العميل الجديد'}
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

      {recontactLeadId && !claimLoading && (
        <div className="glass-card p-4 border border-indigo-100 bg-indigo-50/70 text-indigo-900 text-sm">
          هذا عميل من قائمة "مردوش". إذا بقيت الحالة "مردش" سيظل في القائمة، وإذا غيّرت الحالة سينتقل لقائمة العملاء حسب النتيجة الجديدة.
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
                placeholder="01xxxxxxxxx أو 20xxxxxxxxxx"
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
                placeholder="01xxxxxxxxx أو 20xxxxxxxxxx"
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
          <div className="grid grid-cols-2 md:grid-cols-8 gap-4">
            {[
              { value: 'NEW', label: 'جديد', color: 'bg-slate-100 hover:bg-slate-200 text-slate-700' },
              { value: 'AGREED', label: 'موافق', color: 'bg-emerald-100 hover:bg-emerald-200 text-emerald-700' },
              { value: 'HESITANT', label: 'متردد', color: 'bg-amber-100 hover:bg-amber-200 text-amber-700' },
              { value: 'REJECTED', label: 'مرفوض', color: 'bg-red-100 hover:bg-red-200 text-red-700' },
              { value: 'SPONSOR', label: 'سبونسر', color: 'bg-yellow-100 hover:bg-yellow-200 text-yellow-700' },
              { value: 'NO_ANSWER', label: 'مردش', color: 'bg-blue-100 hover:bg-blue-200 text-blue-700' },
              { value: 'RECONTACT', label: 'إعادة تواصل', color: 'bg-indigo-100 hover:bg-indigo-200 text-indigo-700' },
              { value: 'WRONG_NUMBER', label: 'رقم خاطئ', color: 'bg-rose-100 hover:bg-rose-200 text-rose-700' },
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
          <div className="flex flex-wrap gap-3">
            <label
              className={clsx(
                "cursor-pointer select-none px-5 py-3 rounded-2xl font-black flex items-center gap-3 transition-all border-2",
                includeMaterial ? "border-indigo-500 bg-indigo-100 text-indigo-800" : "border-slate-200 bg-white hover:bg-slate-50 text-slate-700",
              )}
            >
              <input
                type="checkbox"
                className="hidden"
                checked={includeMaterial}
                onChange={(e) => setIncludeMaterial(e.target.checked)}
              />
              <span className={clsx("w-6 h-6 rounded-lg flex items-center justify-center border-2", includeMaterial ? "bg-indigo-600 border-indigo-600 text-white" : "border-slate-300")}>
                {includeMaterial ? <Check size={18} /> : null}
              </span>
              <Image size={20} />
              <span>ارسال الماتريال</span>
            </label>

            <label
              className={clsx(
                "cursor-pointer select-none px-5 py-3 rounded-2xl font-black flex items-center gap-3 transition-all border-2",
                includeOfficialVideo ? "border-emerald-500 bg-emerald-100 text-emerald-800" : "border-slate-200 bg-white hover:bg-slate-50 text-slate-700",
              )}
            >
              <input
                type="checkbox"
                className="hidden"
                checked={includeOfficialVideo}
                onChange={(e) => setIncludeOfficialVideo(e.target.checked)}
              />
              <span className={clsx("w-6 h-6 rounded-lg flex items-center justify-center border-2", includeOfficialVideo ? "bg-emerald-600 border-emerald-600 text-white" : "border-slate-300")}>
                {includeOfficialVideo ? <Check size={18} /> : null}
              </span>
              <PlayCircle size={20} />
              <span>ارسال الفديو الرسمي</span>
            </label>
          </div>
        </div>

        {outgoingPreview && (
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
                {outgoingPreview}
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
          {nameDetectedHint && (
            <p className="text-xs text-indigo-600">{nameDetectedHint}</p>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-sm font-bold text-slate-700">تفاصيل العميل (تتحفظ مع الرقم)</label>
          <textarea
            {...register('profileDetails')}
            className="input-field min-h-[120px]"
            placeholder="مثال: شغال ايه، سنه كام، بيدرس ايه، مستوى الدخل، أي تفاصيل مهمة للمستقبل..."
          />
        </div>

        <div className="p-5 rounded-2xl border border-indigo-100 bg-indigo-50/50 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h4 className="text-lg font-bold text-indigo-900">المساعد الذكي للمكالمات</h4>
              <p className="text-sm text-indigo-700">يتعلم من المجال العام ويولّد سكريبت مخصص لكل عميل.</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAssistantTab('SCRIPT')}
                className={clsx(
                  'px-3 py-2 rounded-lg text-sm font-bold transition-colors',
                  assistantTab === 'SCRIPT' ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-700 border border-indigo-200',
                )}
              >
                توليد السكريبت
              </button>
              <button
                type="button"
                onClick={() => setAssistantTab('TRAINING')}
                className={clsx(
                  'px-3 py-2 rounded-lg text-sm font-bold transition-colors',
                  assistantTab === 'TRAINING' ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-700 border border-indigo-200',
                )}
              >
                تدريب الذكاء
              </button>
            </div>
          </div>

          {assistantTab === 'TRAINING' ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">الموضوع العام</label>
                <input
                  value={trainingTopic}
                  onChange={(e) => setTrainingTopic(e.target.value)}
                  className="input-field"
                  placeholder="مثال: كورسات تسويق رقمي للمبتدئين"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">معلومات التدريب</label>
                <textarea
                  value={trainingContext}
                  onChange={(e) => setTrainingContext(e.target.value)}
                  className="input-field min-h-[120px]"
                  placeholder="اكتب تفاصيل العرض، نوع العملاء، اعتراضات متوقعة، ونبرة الكلام المفضلة."
                />
              </div>
              <button
                type="button"
                onClick={handleSaveTraining}
                disabled={trainingSaving}
                className="px-4 py-2 rounded-lg bg-indigo-600 text-white font-bold hover:bg-indigo-700 disabled:opacity-60"
              >
                {trainingSaving ? 'جارٍ حفظ التدريب...' : 'حفظ تدريب المساعد'}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid md:grid-cols-2 gap-3">
                <input
                  value={occupation}
                  onChange={(e) => setOccupation(e.target.value)}
                  className="input-field"
                  placeholder="الشغل الحالي"
                />
                <input
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  className="input-field"
                  placeholder="السن"
                />
                <input
                  value={education}
                  onChange={(e) => setEducation(e.target.value)}
                  className="input-field"
                  placeholder="الدراسة أو المؤهل"
                />
                <input
                  value={goals}
                  onChange={(e) => setGoals(e.target.value)}
                  className="input-field"
                  placeholder="هدف العميل"
                />
              </div>
              <button
                type="button"
                onClick={handleGenerateScript}
                disabled={assistantLoading}
                className="px-4 py-2 rounded-lg bg-indigo-600 text-white font-bold hover:bg-indigo-700 disabled:opacity-60"
              >
                {assistantLoading ? 'جارٍ توليد السكريبت...' : 'توليد سكريبت ذكي الآن'}
              </button>
              {assistantScript && (
                <div className="space-y-3">
                  <div className="bg-white border border-indigo-100 rounded-xl p-4 whitespace-pre-wrap text-sm text-slate-700">
                    {assistantScript}
                  </div>
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard.writeText(assistantScript)}
                    className="px-3 py-1.5 rounded-lg text-sm font-bold bg-slate-100 hover:bg-slate-200 text-slate-700"
                  >
                    نسخ السكريبت
                  </button>
                </div>
              )}
              {!!followUpQuestions.length && (
                <div className="bg-white border border-indigo-100 rounded-xl p-4">
                  <h5 className="font-bold text-indigo-900 mb-2">أسئلة ذكية مقترحة</h5>
                  <ul className="space-y-1 text-sm text-slate-700">
                    {followUpQuestions.map((question) => (
                      <li key={question}>- {question}</li>
                    ))}
                  </ul>
                </div>
              )}
              {!!webInsights.length && (
                <div className="bg-white border border-indigo-100 rounded-xl p-4">
                  <h5 className="font-bold text-indigo-900 mb-2">معلومات من البحث</h5>
                  <ul className="space-y-1 text-sm text-slate-700">
                    {webInsights.map((insight) => (
                      <li key={insight}>- {insight}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          {assistantError && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {assistantError}
            </div>
          )}
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
