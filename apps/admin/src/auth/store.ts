import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import * as api from '@/api/admin';
import type { LoginResponse, MenuNode, UserInfo } from '@/types';
import { tokenStore } from './token';

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  user: UserInfo | null;
  menuCodes: string[];
  menuTree: MenuNode[];
  login: (username: string, password: string, inviteCode: string) => Promise<void>;
  logout: () => void;
  hasCode: (code: string) => boolean;
}

function applyToken(token: string | null) {
  tokenStore.set(token);
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      refreshToken: null,
      user: null,
      menuCodes: [],
      menuTree: [],
      login: async (username, password, inviteCode) => {
        const resp: LoginResponse = await api.login({
          username,
          password,
          inviteCode,
          deviceId: 'admin-web',
          deviceName: 'Admin Console',
        });
        // Pull the sidebar tree + the caller's permission codes. Either may 403
        // for a non-admin account; we tolerate that and surface "no permission".
        const [menuTree, menuCodes] = await Promise.all([
          api.getMenus().catch(() => []),
          api.getMyCodes().catch(() => []),
        ]);
        applyToken(resp.accessToken);
        set({
          token: resp.accessToken,
          refreshToken: resp.refreshToken,
          user: resp.user,
          menuCodes,
          menuTree,
        });
      },
      logout: () => {
        applyToken(null);
        set({ token: null, refreshToken: null, user: null, menuCodes: [], menuTree: [] });
      },
      hasCode: (code) => get().menuCodes.includes(code),
    }),
    {
      name: 'smartscrm-admin-auth',
      partialize: (s) => ({
        token: s.token,
        refreshToken: s.refreshToken,
        user: s.user,
        menuCodes: s.menuCodes,
        menuTree: s.menuTree,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.token) applyToken(state.token);
      },
    },
  ),
);
