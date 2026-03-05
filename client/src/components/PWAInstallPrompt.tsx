import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISS_KEY = 'pwa_install_dismissed';

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(localStorage.getItem(DISMISS_KEY) === '1');

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone;
    if (standalone) {
      setIsInstalled(true);
    }

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const handleInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const onInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  if (isInstalled || dismissed || !deferredPrompt) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:w-[360px] bg-slate-900 text-white rounded-2xl p-4 shadow-2xl z-[60]">
      <button
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, '1');
          setDismissed(true);
        }}
        className="absolute left-3 top-3 text-slate-400 hover:text-white"
      >
        <X size={18} />
      </button>
      <p className="font-bold text-sm mb-1">ثبت النظام كتطبيق</p>
      <p className="text-xs text-slate-300 mb-3">لأداء أسرع وتجربة كاملة بدون شريط المتصفح.</p>
      <button onClick={onInstall} className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 font-bold flex items-center justify-center gap-2">
        <Download size={16} />
        تثبيت التطبيق
      </button>
    </div>
  );
}
