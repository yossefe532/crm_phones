import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import api from '../services/api';
import { useAuth } from '../store/useAuth';
import { useNavigate } from 'react-router-dom';
import { Lock, Mail, Loader2 } from 'lucide-react';
import clsx from 'clsx';

const loginSchema = z.object({
  email: z.string().email('البريد الإلكتروني غير صحيح'),
  password: z.string().min(6, 'كلمة المرور يجب أن تكون 6 أحرف على الأقل'),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function Login() {
  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const login = useAuth((state) => state.login);
  const navigate = useNavigate();

  const onSubmit = async (data: LoginForm) => {
    setLoading(true);
    setError('');
    try {
      const response = await api.post('/auth/login', data);
      login(response.data.token, response.data.user);
      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.error || 'فشل تسجيل الدخول');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 p-4">
      <div className="glass-card w-full max-w-md p-8 bg-white/10 backdrop-blur-xl border-white/10">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-3xl font-bold shadow-lg mx-auto mb-4 text-white">
            E
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">تسجيل الدخول</h1>
          <p className="text-slate-400">نظام إدارة العملاء - أكاديمية إيديكون</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm text-center">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">البريد الإلكتروني</label>
            <div className="relative">
              <Mail className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" size={20} />
              <input
                {...register('email')}
                type="email"
                autoComplete="username"
                autoFocus
                dir="ltr"
                className={clsx(
                  "w-full px-4 py-3 pr-10 rounded-xl bg-slate-900/50 border border-slate-700 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none transition-colors",
                  errors.email && "border-red-500 focus:border-red-500"
                )}
                placeholder="example@edicon.com"
              />
            </div>
            {errors.email && <p className="text-xs text-red-400">{errors.email.message}</p>}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">كلمة المرور</label>
            <div className="relative">
              <Lock className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" size={20} />
              <input
                {...register('password')}
                type="password"
                autoComplete="current-password"
                dir="ltr"
                className={clsx(
                  "w-full px-4 py-3 pr-10 rounded-xl bg-slate-900/50 border border-slate-700 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none transition-colors",
                  errors.password && "border-red-500 focus:border-red-500"
                )}
                placeholder="••••••••"
              />
            </div>
            {errors.password && <p className="text-xs text-red-400">{errors.password.message}</p>}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full btn-primary py-3 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="animate-spin" /> : 'دخول'}
          </button>
        </form>
      </div>
    </div>
  );
}
