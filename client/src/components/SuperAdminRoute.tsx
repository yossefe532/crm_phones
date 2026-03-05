import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../store/useAuth';

interface SuperAdminRouteProps {
  redirectPath?: string;
}

export default function SuperAdminRoute({ redirectPath = '/' }: SuperAdminRouteProps) {
  const { user } = useAuth();

  if (!user || user.role !== 'ADMIN') {
    return <Navigate to={redirectPath} replace />;
  }

  return <Outlet />;
}
