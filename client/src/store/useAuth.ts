import { create } from 'zustand';
import { jwtDecode } from 'jwt-decode';
import api from '../services/api';

interface User {
  id: number;
  name: string;
  email: string;
  role: 'ADMIN' | 'TEAM_LEAD' | 'SALES';
  teamId: number | null;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  checkAuth: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  token: localStorage.getItem('token'),
  isAuthenticated: !!localStorage.getItem('token'),
  
  login: (token, user) => {
    localStorage.setItem('token', token);
    set({ user, token, isAuthenticated: true });
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  },

  logout: () => {
    localStorage.removeItem('token');
    set({ user: null, token: null, isAuthenticated: false });
    delete api.defaults.headers.common['Authorization'];
  },

  checkAuth: () => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const decoded: any = jwtDecode(token);
        // Check if token is expired
        if (decoded.exp * 1000 < Date.now()) {
          localStorage.removeItem('token');
          set({ user: null, token: null, isAuthenticated: false });
          delete api.defaults.headers.common['Authorization'];
        } else {
          set({ 
            user: { id: decoded.id, name: decoded.name, email: decoded.email, role: decoded.role, teamId: decoded.teamId ?? null }, 
            token, 
            isAuthenticated: true 
          });
          api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        }
      } catch (error) {
        localStorage.removeItem('token');
        set({ user: null, token: null, isAuthenticated: false });
        delete api.defaults.headers.common['Authorization'];
      }
    }
  }
}));
