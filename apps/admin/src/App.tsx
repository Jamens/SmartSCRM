import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth, RequireCode } from '@/auth/guard';
import AppLayout from '@/layout/AppLayout';
import Login from '@/pages/Login';
import TenantList from '@/pages/TenantList';
import RoleList from '@/pages/RoleList';
import RoleEdit from '@/pages/RoleEdit';
import TeamList from '@/pages/TeamList';
import UserList from '@/pages/UserList';
import AiRuleList from '@/pages/AiRuleList';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/tenants" replace />} />
        <Route path="tenants" element={<TenantList />} />
        <Route path="roles" element={<RoleList />} />
        <Route path="roles/:id" element={<RoleEdit />} />
        <Route path="teams" element={<TeamList />} />
        <Route path="users" element={<UserList />} />
        <Route
          path="ai/rules"
          element={
            <RequireCode code="ai_rule:list">
              <AiRuleList />
            </RequireCode>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
