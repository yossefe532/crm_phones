import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import WhatsAppPrompt from '../WhatsAppPrompt';
import { Menu } from 'lucide-react';
import { useStore } from '../../store/useStore';
import LiveEvents from '../LiveEvents';
import CoachToasts from '../CoachToasts';
import ReleaseNotesBell from '../ReleaseNotesBell';

export default function Layout() {
  const { toggleSidebar } = useStore();

  return (
    <div className="flex h-screen bg-gradient-to-br from-slate-50 to-slate-200 overflow-hidden">
      <Sidebar />
      <WhatsAppPrompt />
      <LiveEvents />
      <CoachToasts />
      
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        <header className="md:hidden sticky top-0 flex items-center justify-between p-4 bg-white/90 backdrop-blur-md border-b border-slate-200 shadow-sm z-20">
          <button 
            onClick={toggleSidebar}
            className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <Menu size={24} />
          </button>
          <span className="font-bold text-slate-800">أكاديمية إيديكون</span>
          <ReleaseNotesBell />
        </header>

        <div className="hidden md:block absolute top-5 right-auto left-5 z-30">
          <ReleaseNotesBell />
        </div>

        <div className="flex-1 overflow-auto p-3 md:p-8 scroll-smooth overscroll-contain">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
