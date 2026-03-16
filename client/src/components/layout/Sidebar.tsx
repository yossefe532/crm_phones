import { NavLink, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { 
  LayoutDashboard, 
  Users, 
  UserPlus, 
  PhoneMissed,
  PhoneCall,
  UsersRound, 
  ShieldCheck,
  MessageSquare, 
  X,
  LogOut,
  Upload,
  Database,
  PencilLine,
  Check,
  Loader2,
  Smartphone,
  Lightbulb,
  HelpCircle
} from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../../store/useStore';
import { useAuth } from '../../store/useAuth';
import api from '../../services/api';

export default function Sidebar() {
  const { isSidebarOpen, closeSidebar } = useStore();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState(user?.name || '');
  const [isSavingName, setIsSavingName] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleUpdateName = async () => {
    if (!newName.trim() || newName.trim() === user?.name) {
      setIsEditingName(false);
      return;
    }
    setIsSavingName(true);
    try {
      const response = await api.put('/me/update-name', { name: newName.trim() });
      const { user: updatedUser, token: newToken } = response.data;
      
      if (newToken && updatedUser) {
        localStorage.setItem('token', newToken);
        // We can't directly update the zustand store easily from here without 
        // access to the set method, but we can reload to sync everything.
        window.location.reload(); 
      }
      setIsEditingName(false);
    } catch (error) {
      console.error('Failed to update name:', error);
      alert('فشل تحديث الاسم');
    } finally {
      setIsSavingName(false);
    }
  };

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: 'لوحة التحكم' },
    { to: '/leads', icon: Users, label: 'إدارة العملاء' },
    { to: '/leads/no-answer', icon: PhoneMissed, label: 'عملاء مردوش' },
    { to: '/leads/recontact', icon: PhoneCall, label: 'إعادة التواصل' },
    { to: '/leads/new', icon: UserPlus, label: 'إضافة عميل جديد' },
    { to: '/templates', icon: MessageSquare, label: 'قوالب الرسائل' },
    { to: '/suggestions', icon: Lightbulb, label: 'الاقتراحات' },
  ];

  const adminItems = [
    { to: '/admin/teams', icon: ShieldCheck, label: 'إدارة الفرق' },
    { to: '/admin/employees', icon: UsersRound, label: 'إدارة الموظفين' },
    { to: '/admin/sim-cards', icon: Smartphone, label: 'خطوط العمل' },
    { to: '/admin/upload', icon: Upload, label: 'رفع داتا أرقام' },
    { to: '/admin/pooled-numbers', icon: Database, label: 'الأرقام المجمعة' },
    { to: '/admin/faqs', icon: HelpCircle, label: 'إدارة FAQ' },
  ];
  const visibleAdminItems = user?.role === 'TEAM_LEAD'
    ? adminItems.filter((item) => item.to === '/admin/employees' || item.to === '/admin/teams')
    : adminItems;

  return (
    <>
      {/* Mobile Overlay */}
      <div 
        className={clsx(
          "fixed inset-0 bg-black/50 z-30 md:hidden transition-opacity",
          isSidebarOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={closeSidebar}
      />

      {/* Sidebar */}
      <aside 
        className={clsx(
          "fixed md:sticky top-0 right-0 z-40 w-[86vw] max-w-80 h-screen bg-gradient-to-b from-slate-900 to-slate-800 text-white shadow-2xl transition-transform duration-300 md:translate-x-0 overflow-y-auto flex flex-col",
          isSidebarOpen ? "translate-x-0" : "translate-x-full md:translate-x-0" // RTL: translate-x-full moves right
        )}
      >
        <div className="p-6 border-b border-white/10 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-2xl font-bold shadow-lg">
              E
            </div>
            <div>
              <h1 className="text-lg font-bold">أكاديمية إيديكون</h1>
              <p className="text-xs text-emerald-400 font-medium">نظام إدارة العملاء</p>
            </div>
          </div>
          <button onClick={closeSidebar} className="md:hidden text-white/70 hover:text-white">
            <X size={24} />
          </button>
        </div>

        <nav className="p-4 space-y-2 flex-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={closeSidebar}
              className={({ isActive }) => clsx(
                "flex items-center gap-3 p-4 rounded-xl transition-all duration-200",
                isActive 
                  ? "bg-white/10 text-emerald-400 border-r-4 border-emerald-500" 
                  : "text-slate-300 hover:bg-white/5 hover:translate-x-[-4px]"
              )}
            >
              <item.icon size={22} />
              <span className="font-medium">{item.label}</span>
            </NavLink>
          ))}

          {(user?.role === 'ADMIN' || user?.role === 'TEAM_LEAD') && (
            <div className="mt-8 pt-6 border-t border-white/10">
              <p className="text-xs text-slate-500 mb-3 px-4 font-bold uppercase tracking-wider">الإدارة</p>
              {visibleAdminItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={closeSidebar}
                  className={({ isActive }) => clsx(
                    "flex items-center gap-3 p-4 rounded-xl transition-all duration-200",
                    isActive 
                      ? "bg-white/10 text-emerald-400 border-r-4 border-emerald-500" 
                      : "text-slate-300 hover:bg-white/5 hover:translate-x-[-4px]"
                  )}
                >
                  <item.icon size={22} />
                  <span className="font-medium">{item.label}</span>
                </NavLink>
              ))}
            </div>
          )}
        </nav>

        <div className="p-4 border-t border-white/10 mt-auto">
          <div className="p-3 rounded-xl bg-white/5 mb-3">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center font-bold text-lg flex-shrink-0">
                {user?.name?.[0] || 'U'}
              </div>
              <div className="overflow-hidden flex-1">
                {isEditingName ? (
                  <div className="flex items-center gap-1">
                    <input 
                      autoFocus
                      className="bg-slate-700 text-white text-xs px-2 py-1 rounded border border-emerald-500 w-full outline-none"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleUpdateName()}
                    />
                    <button 
                      onClick={handleUpdateName}
                      disabled={isSavingName}
                      className="text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
                    >
                      {isSavingName ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    </button>
                    <button onClick={() => setIsEditingName(false)} className="text-red-400 hover:text-red-300">
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-1 group/name">
                    <p className="text-sm font-bold truncate">{user?.name || 'مستخدم'}</p>
                    <button 
                      onClick={() => { setNewName(user?.name || ''); setIsEditingName(true); }}
                      className="text-slate-500 hover:text-emerald-400 opacity-0 group-hover/name:opacity-100 transition-opacity"
                    >
                      <PencilLine size={12} />
                    </button>
                  </div>
                )}
                <p className="text-xs text-slate-400 truncate">{user?.email}</p>
              </div>
            </div>
          </div>
          
          <button 
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors font-bold"
          >
            <LogOut size={18} />
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </aside>
    </>
  );
}
