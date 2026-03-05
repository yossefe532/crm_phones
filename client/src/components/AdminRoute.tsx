import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../store/useAuth';

interface AdminRouteProps {
  redirectPath?: string;
}

export default function AdminRoute({ redirectPath = '/' }: AdminRouteProps) {
  const { user } = useAuth();

  if (!user || (user.role !== 'ADMIN' && user.role !== 'TEAM_LEAD')) {
    return <Navigate to={redirectPath} replace />;
  }

  return <Outlet />;
}
