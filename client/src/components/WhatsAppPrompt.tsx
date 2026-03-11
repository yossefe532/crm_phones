import { useState, useEffect } from 'react';
import { useAuth } from '../store/useAuth';
import api from '../services/api';
import { MessageSquare, Save, Loader2, Phone } from 'lucide-react';

export default function WhatsAppPrompt() {
  const { user } = useAuth();
  const [show, setShow] = useState(false);
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const checkPhone = async () => {
      if (!user || user.role === 'ADMIN') {
        setIsChecking(false);
        return;
      }

      try {
        const response = await api.get('/me/employee-profile');
        if (!response.data?.phone) {
          setShow(true);
        }
      } catch (error) {
        console.error('Failed to fetch profile:', error);
        // If profile doesn't exist, we should show the prompt
        setShow(true);
      } finally {
        setIsChecking(false);
      }
    };

    checkPhone();
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone || phone.length < 10) {
      alert('يرجى إدخال رقم واتساب صحيح');
      return;
    }

    setLoading(true);
    try {
      await api.put('/me/update-name', { whatsappPhone: phone });
      setShow(false);
    } catch (error) {
      console.error('Failed to update phone:', error);
      alert('فشل حفظ الرقم، يرجى المحاولة مرة أخرى');
    } finally {
      setLoading(false);
    }
  };

  if (isChecking || !show) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="glass-card max-w-md w-full p-8 shadow-2xl border-2 border-indigo-500/30 animate-in zoom-in-95 duration-300">
        <div className="flex flex-col items-center text-center">
          <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mb-6 shadow-inner">
            <MessageSquare size={40} className="text-emerald-600" />
          </div>
          
          <h2 className="text-2xl font-black text-slate-800 mb-3">تفعيل واتساب العمل 📱</h2>
          <p className="text-slate-600 mb-8 leading-relaxed">
            أهلاً بك في الفريق! لضمان وصول رسائل المتابعة والتحفيز إليك، يرجى إدخال 
            <span className="font-bold text-slate-800"> رقم الواتساب الشخصي </span> 
            الخاص بك.
          </p>

          <form onSubmit={handleSubmit} className="w-full space-y-6">
            <div className="relative">
              <Phone className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
              <input
                type="tel"
                dir="ltr"
                placeholder="01xxxxxxxxx"
                className="input-field pr-12 h-14 text-lg font-bold tracking-widest text-center"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                autoFocus
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full h-14 rounded-2xl flex items-center justify-center gap-3 text-lg shadow-xl shadow-indigo-200"
            >
              {loading ? (
                <Loader2 className="animate-spin" size={24} />
              ) : (
                <>
                  <Save size={24} />
                  <span>حفظ الرقم والبدء</span>
                </>
              )}
            </button>
          </form>
          
          <p className="mt-6 text-[10px] text-slate-400 font-bold uppercase tracking-widest">
            سيتم استخدام هذا الرقم لإرسال تنبيهات التارجت والرسائل الإدارية فقط
          </p>
        </div>
      </div>
    </div>
  );
}
