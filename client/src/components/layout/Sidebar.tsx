import { NavLink, useNavigate } from 'react-router-dom';
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
  Database
} from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../../store/useStore';
import { useAuth } from '../../store/useAuth';

export default function Sidebar() {
  const { isSidebarOpen, closeSidebar } = useStore();
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: 'لوحة التحكم' },
    { to: '/leads', icon: Users, label: 'إدارة العملاء' },
    { to: '/leads/no-answer', icon: PhoneMissed, label: 'عملاء مردوش' },
    { to: '/leads/recontact', icon: PhoneCall, label: 'إعادة التواصل' },
    { to: '/leads/new', icon: UserPlus, label: 'إضافة عميل جديد' },
    { to: '/templates', icon: MessageSquare, label: 'قوالب الرسائل' },
  ];

  const adminItems = [
    { to: '/admin/teams', icon: ShieldCheck, label: 'إدارة الفرق' },
    { to: '/admin/employees', icon: UsersRound, label: 'إدارة الموظفين' },
    { to: '/admin/upload', icon: Upload, label: 'رفع داتا أرقام' },
    { to: '/admin/pooled-numbers', icon: Database, label: 'الأرقام المجمعة' },
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
          <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 mb-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center font-bold text-lg">
              {user?.name?.[0] || 'U'}
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-bold truncate">{user?.name || 'مستخدم'}</p>
              <p className="text-xs text-slate-400 truncate">{user?.email}</p>
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
