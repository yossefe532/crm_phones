
import { useState, useEffect } from 'react';
import { Crown, Star, TrendingUp, CheckCircle2, X } from 'lucide-react';
import clsx from 'clsx';

export default function VipFeatureAnnouncement() {
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    // Check if user has already seen this announcement
    const hasSeen = localStorage.getItem('vip-feature-announcement-seen-v1');
    if (!hasSeen) {
      // Small delay to let the app load first
      const timer = setTimeout(() => setIsOpen(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleClose = () => {
    setIsOpen(false);
    localStorage.setItem('vip-feature-announcement-seen-v1', 'true');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden relative animate-in zoom-in-95 slide-in-from-bottom-10 duration-500">
        {/* Background Pattern */}
        <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-r from-amber-300 to-yellow-500 flex items-center justify-center overflow-hidden">
          <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white via-transparent to-transparent" />
          <Crown size={120} className="text-white/20 absolute -bottom-10 -right-10 rotate-12" />
          <Star size={80} className="text-white/20 absolute top-5 -left-10 -rotate-12 animate-pulse" />
        </div>

        <button 
          onClick={handleClose}
          className="absolute top-4 left-4 z-10 p-2 bg-black/10 hover:bg-black/20 rounded-full text-white transition-colors"
        >
          <X size={20} />
        </button>

        <div className="pt-36 px-8 pb-8 text-center">
          {step === 0 && (
            <div className="space-y-6 animate-in slide-in-from-right-10 duration-300 fade-in">
              <div className="mx-auto w-20 h-20 bg-yellow-100 rounded-full flex items-center justify-center shadow-lg shadow-yellow-200 border-4 border-white -mt-16 relative z-10">
                <Crown size={40} className="text-yellow-600 drop-shadow-sm" />
              </div>
              
              <div>
                <h2 className="text-2xl font-black text-slate-800 mb-2">نقدم لكم نظام الـ VIP الجديد! 🌟</h2>
                <p className="text-slate-600 leading-relaxed">
                  تحديث جديد ومميز لمساعدتك على زيادة مبيعاتك والوصول لعملاء بجودة أعلى.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4 text-right">
                <div className="bg-amber-50 p-4 rounded-xl border border-amber-100">
                  <div className="flex items-center gap-2 mb-2 text-amber-700 font-bold">
                    <Star size={18} className="fill-amber-500 text-amber-500" />
                    <span>داتا مميزة</span>
                  </div>
                  <p className="text-xs text-amber-800/80">
                    عملاء تم اختيارهم بعناية لزيادة فرص البيع.
                  </p>
                </div>
                <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                  <div className="flex items-center gap-2 mb-2 text-indigo-700 font-bold">
                    <TrendingUp size={18} />
                    <span>فرص أعلى</span>
                  </div>
                  <p className="text-xs text-indigo-800/80">
                    نسبة رد وموافقة أعلى من الداتا العادية.
                  </p>
                </div>
              </div>

              <button 
                onClick={() => setStep(1)}
                className="w-full py-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 hover:shadow-indigo-300 hover:scale-[1.02] transition-all active:scale-95"
              >
                كيف أحصل عليها؟ 🚀
              </button>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-6 animate-in slide-in-from-right-10 duration-300 fade-in">
              <div className="mx-auto w-20 h-20 bg-indigo-100 rounded-full flex items-center justify-center shadow-lg shadow-indigo-200 border-4 border-white -mt-16 relative z-10">
                <TrendingUp size={40} className="text-indigo-600" />
              </div>

              <div>
                <h2 className="text-2xl font-black text-slate-800 mb-2">شروط التفعيل 🎯</h2>
                <p className="text-slate-600 text-sm">
                  الزر الذهبي سيظهر لك تلقائياً عند تحقيق الشروط التالية:
                </p>
              </div>

              <div className="space-y-3 text-right">
                <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl">
                  <div className="bg-emerald-100 p-2 rounded-lg text-emerald-600 mt-1">
                    <CheckCircle2 size={18} />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-800">20 موافقة (Agreed)</h4>
                    <p className="text-xs text-slate-500">
                      بمجرد وصولك لـ 20 موافقة إجمالية، يفتح لك سحب <span className="font-bold text-amber-600">1 عميل VIP</span> يومياً.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl">
                  <div className="bg-blue-100 p-2 rounded-lg text-blue-600 mt-1">
                    <TrendingUp size={18} />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-800">كل ما تبيع أكتر.. تكسب أكتر</h4>
                    <p className="text-xs text-slate-500">
                      كل 10 موافقات زيادة، ليك عميل VIP زيادة في اليوم (بحد أقصى 7).
                    </p>
                  </div>
                </div>
              </div>

              <button 
                onClick={handleClose}
                className="w-full py-3 bg-gradient-to-r from-amber-500 to-yellow-500 text-white rounded-xl font-bold shadow-lg shadow-amber-200 hover:shadow-amber-300 hover:scale-[1.02] transition-all active:scale-95"
              >
                فهمت، يلا نبدأ! 💪
              </button>
            </div>
          )}
        </div>
        
        {/* Progress Dots */}
        <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-2">
          <div className={clsx("w-2 h-2 rounded-full transition-all", step === 0 ? "bg-indigo-600 w-6" : "bg-slate-300")} />
          <div className={clsx("w-2 h-2 rounded-full transition-all", step === 1 ? "bg-indigo-600 w-6" : "bg-slate-300")} />
        </div>
      </div>
    </div>
  );
}
