// Shared types for the admin console. Field shapes mirror the backend DTOs
// (see apps/server .../web/admin/* and .../common/{ApiResponse,PageResult}).

/** 1 = platform-wide, 2 = bound to a single tenant. */
export type Scope = 1 | 2;
export const SCOPE_PLATFORM: Scope = 1;
export const SCOPE_TENANT: Scope = 2;

export enum MenuType {
  DIR = 1,
  MENU = 2,
  BUTTON = 3, // hidden from sidebar, referenced by backend @PreAuthorize
}

export interface MenuNode {
  id: number;
  name: string;
  code: string;
  type: number; // MenuType
  path: string | null;
  icon: string | null;
  sort: number | null;
  children: MenuNode[];
}

export interface UserInfo {
  id: number;
  username: string;
  nickname: string | null;
  avatar: string | null;
  role: string;
  tenantId: number | null;
  inviteCode: string | null;
  tenantName: string | null;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: UserInfo;
}

export interface TenantRow {
  id: number;
  inviteCode: string;
  name: string;
  status: number; // 1 active, 0 suspended
  seatLimit: number | null; // null = unlimited
  seatUsed: number; // current sub-account count against the seat limit
  createdAt: string;
}

export interface TenantCreatePayload {
  name: string;
  inviteCode?: string;
}

export interface TenantQuotaPayload {
  seatLimit: number | null; // null restores unlimited
}

export interface UserCreatePayload {
  username: string;
  password: string;
  nickname?: string;
  tenantId?: number;
  role?: string; // legacy role: owner|admin|agent
  status?: number; // 1 active, 0 disabled
}

export interface UserTeamAssignPayload {
  teamIds: number[];
}

export interface TenantCounts {
  users: number;
  platformAccounts: number;
}

export interface RoleRow {
  id: number;
  tenantId: number | null;
  code: string;
  name: string;
  scope: number;
  builtin: number; // 1 = builtin, must not be deleted
  status: number;
}

export interface TeamRow {
  id: number;
  tenantId: number | null;
  parentId: number;
  name: string;
  scope: number;
  status: number;
}

export interface UserRow {
  id: number;
  tenantId: number | null;
  username: string;
  nickname: string | null;
  role: string | null;
  status: number;
}
