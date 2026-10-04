import type { ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Button, Result } from 'antd';
import { useAuthStore } from './store';

/** Redirects to /login when there is no active session. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.token);
  const location = useLocation();
  if (!token) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}

/** Blocks rendering when the caller lacks a required permission code. Shares the
 *  same code vocabulary the backend @PreAuthorize checks, so frontend hiding and
 *  backend rejection can never drift apart. */
export function RequireCode({ code, children }: { code: string; children: ReactNode }) {
  const has = useAuthStore((s) => s.menuCodes.includes(code));
  if (!has) {
    return (
      <Result
        status="403"
        title="无访问权限"
        subTitle={`需要权限：${code}`}
        extra={
          <Link to="/">
            <Button type="primary">返回首页</Button>
          </Link>
        }
      />
    );
  }
  return <>{children}</>;
}
