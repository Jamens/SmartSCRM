import { http, qs, type PageResult } from './client';
import type {
  LoginResponse,
  MenuNode,
  TenantRow,
  TenantCounts,
  TenantCreatePayload,
  RoleRow,
  TeamRow,
  UserRow,
  UserCreatePayload,
  AiRuleRow,
  AiRulePayload,
} from '@/types';

export interface LoginPayload {
  username: string;
  password: string;
  inviteCode: string;
  deviceId: string;
  deviceName?: string;
}

// ---- auth ----
export const login = (p: LoginPayload) => http.post<LoginResponse>('/api/auth/login', p);
export const getMenus = () => http.get<MenuNode[]>('/api/admin/menus');
export const getMenuCatalog = () => http.get<MenuNode[]>('/api/admin/menus/all');
export const getMyCodes = () => http.get<string[]>('/api/admin/my-codes');

// ---- tenants ----
export const tenantsPage = (p: { keyword?: string; status?: number; page?: number; pageSize?: number }) =>
  http.get<PageResult<TenantRow>>(`/api/admin/tenants${qs(p)}`);
export const tenantRename = (id: number, name: string) =>
  http.put<void>(`/api/admin/tenants/${id}/name${qs({ name })}`);
export const tenantSetStatus = (id: number, status: number) =>
  http.post<void>(`/api/admin/tenants/${id}/status${qs({ status })}`);
export const tenantCounts = (id: number) => http.get<TenantCounts>(`/api/admin/tenants/${id}/counts`);
export const tenantCreate = (p: TenantCreatePayload) => http.post<TenantRow>('/api/admin/tenants', p);
export const tenantSetQuota = (id: number, seatLimit: number | null) =>
  http.post<void>(`/api/admin/tenants/${id}/quota`, { seatLimit });
export const tenantDelete = (id: number) => http.del<void>(`/api/admin/tenants/${id}`);

// ---- roles ----
export const rolesPage = (p: { scope?: number; tenantId?: number; page?: number; pageSize?: number }) =>
  http.get<PageResult<RoleRow>>(`/api/admin/roles${qs(p)}`);
export const roleGrantedMenus = (id: number) => http.get<number[]>(`/api/admin/roles/${id}/menus`);
export const roleCreate = (p: {
  scope: number;
  tenantId?: number;
  code: string;
  name: string;
  menuCodes?: string[];
}) => http.post<RoleRow>('/api/admin/roles', p);
export const roleGrantMenus = (id: number, menuCodes: string[]) =>
  http.put<void>(`/api/admin/roles/${id}/menus`, { menuCodes });
export const roleDelete = (id: number) => http.del<void>(`/api/admin/roles/${id}`);

// ---- teams ----
export const teamsPage = (p: { tenantId?: number; page?: number; pageSize?: number }) =>
  http.get<PageResult<TeamRow>>(`/api/admin/teams${qs(p)}`);
export const teamMembers = (id: number) => http.get<number[]>(`/api/admin/teams/${id}/members`);
export const teamCreate = (p: { scope: number; tenantId?: number; name: string; parentId?: number }) =>
  http.post<TeamRow>('/api/admin/teams', p);
export const teamRename = (id: number, name: string) =>
  http.put<void>(`/api/admin/teams/${id}/name${qs({ name })}`);
export const teamAssignMembers = (id: number, userIds: number[]) =>
  http.put<void>(`/api/admin/teams/${id}/members`, { userIds });
export const teamDelete = (id: number) => http.del<void>(`/api/admin/teams/${id}`);

// ---- users ----
export const usersPage = (p: { tenantId?: number; keyword?: string; page?: number; pageSize?: number }) =>
  http.get<PageResult<UserRow>>(`/api/admin/users${qs(p)}`);
export const userRoles = (id: number) => http.get<number[]>(`/api/admin/users/${id}/roles`);
export const userAssignRoles = (id: number, roleIds: number[]) =>
  http.put<void>(`/api/admin/users/${id}/roles`, { roleIds });
export const userSetStatus = (id: number, status: number) =>
  http.put<void>(`/api/admin/users/${id}/status${qs({ status })}`);
export const userCreate = (p: UserCreatePayload) => http.post<UserRow>('/api/admin/users', p);
export const userDelete = (id: number) => http.del<void>(`/api/admin/users/${id}`);
export const userTeams = (id: number) => http.get<number[]>(`/api/admin/users/${id}/teams`);
export const userAssignTeams = (id: number, teamIds: number[]) =>
  http.put<void>(`/api/admin/users/${id}/teams`, { teamIds });

// ---- AI transfer-to-human rules (B28) ----
// tenantId is a query param, never a body field: a tenant-scoped admin is pinned to
// its own tenant by the backend, a platform admin must name one. The full rule list
// is small and unordered by the API contract, so it is fetched in one shot.
export const aiRules = (tenantId?: number) => http.get<AiRuleRow[]>(`/api/admin/ai-rules${qs({ tenantId })}`);
export const aiRuleCreate = (p: AiRulePayload, tenantId?: number) =>
  http.post<AiRuleRow>(`/api/admin/ai-rules${qs({ tenantId })}`, p);
export const aiRuleUpdate = (id: number, p: AiRulePayload, tenantId?: number) =>
  http.put<AiRuleRow>(`/api/admin/ai-rules/${id}${qs({ tenantId })}`, p);
export const aiRuleDelete = (id: number, tenantId?: number) =>
  http.del<void>(`/api/admin/ai-rules/${id}${qs({ tenantId })}`);
