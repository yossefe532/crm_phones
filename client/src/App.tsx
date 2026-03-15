import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/layout/Layout';
import Dashboard from './pages/Dashboard';
import Leads from './pages/Leads';
import AddLead from './pages/AddLead';
import NoAnswerLeads from './pages/NoAnswerLeads';
import RecontactLeads from './pages/RecontactLeads';
import Login from './pages/Login';
import UploadLeads from './pages/admin/UploadLeads';
import Templates from './pages/admin/Templates';
import Suggestions from './pages/Suggestions';
import Employees from './pages/admin/Employees';
import PooledNumbers from './pages/admin/PooledNumbers';
import TeamManagement from './pages/admin/TeamManagement';
import EmployeePerformance from './pages/admin/EmployeePerformance';
import SimCards from './pages/admin/SimCards';
import PrivateRoute from './components/PrivateRoute';
import AdminRoute from './components/AdminRoute';
import SuperAdminRoute from './components/SuperAdminRoute';
import PWAInstallPrompt from './components/PWAInstallPrompt';

function App() {
  return (
    <BrowserRouter>
      <PWAInstallPrompt />
      <Routes>
        <Route path="/login" element={<Login />} />
        
        <Route path="/" element={<PrivateRoute />}>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="leads" element={<Leads />} />
            <Route path="leads/no-answer" element={<NoAnswerLeads />} />
            <Route path="leads/recontact" element={<RecontactLeads />} />
            <Route path="leads/new" element={<AddLead />} />
            <Route path="templates" element={<Templates />} />
            <Route path="suggestions" element={<Suggestions />} />
            
            {/* Admin Only Routes */}
            <Route path="admin" element={<AdminRoute />}>
              <Route path="employees" element={<Employees />} />
              <Route path="employees/:id" element={<EmployeePerformance />} />
              <Route path="teams" element={<TeamManagement />} />
              <Route path="sim-cards" element={<SimCards />} />
              <Route element={<SuperAdminRoute />}>
                <Route path="upload" element={<UploadLeads />} />
                <Route path="pooled-numbers" element={<PooledNumbers />} />
              </Route>
            </Route>

            {/* Placeholder routes */}
            <Route path="reports" element={<div className="p-8 text-center text-slate-500">صفحة التقارير (قيد التطوير)</div>} />
            <Route path="activity" element={<div className="p-8 text-center text-slate-500">سجل النشاطات (قيد التطوير)</div>} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
