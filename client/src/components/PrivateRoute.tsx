import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../store/useAuth';
import { useEffect } from 'react';

export default function PrivateRoute() {
  const { isAuthenticated, checkAuth } = useAuth();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace />;
}
