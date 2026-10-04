import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Avatar, Button, Layout, Menu, Result, Tag, Typography } from 'antd';
import {
  BankOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '@/auth/store';

const { Header, Sider, Content } = Layout;

interface NavItem {
  code: string;
  label: string;
  path: string;
  icon: ReactNode;
}

// The admin nav is fixed client-side; visibility is gated by the caller's
// menuCodes so it can never show a link the backend would reject.
const NAV: NavItem[] = [
  { code: 'tenant:list', label: '租户管理', path: '/tenants', icon: <BankOutlined /> },
  { code: 'role:list', label: '角色权限', path: '/roles', icon: <SafetyCertificateOutlined /> },
  { code: 'team:list', label: '团队管理', path: '/teams', icon: <TeamOutlined /> },
  { code: 'user:list', label: '子账号', path: '/users', icon: <UserOutlined /> },
  { code: 'ai_rule:list', label: '转人工规则', path: '/ai/rules', icon: <RobotOutlined /> },
];

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const menuCodes = useAuthStore((s) => s.menuCodes);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const visibleNav = useMemo(() => NAV.filter((n) => menuCodes.includes(n.code)), [menuCodes]);

  if (menuCodes.length === 0) {
    return <Result status="403" title="无管理端权限" subTitle="当前账号没有任何管理端菜单权限。" />;
  }

  const selectedKey =
    visibleNav.find((n) => location.pathname.startsWith(n.path))?.path ?? visibleNav[0]?.path ?? '/tenants';

  const onLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="dark" width={220} breakpoint="lg" collapsedWidth={0}>
        <div
          style={{
            color: '#fff',
            fontWeight: 600,
            fontSize: 16,
            padding: '16px 20px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}
        >
          SmartSCRM 管理端
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={visibleNav.map((n) => ({
            key: n.path,
            icon: n.icon,
            label: <Link to={n.path}>{n.label}</Link>,
          }))}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 12,
            padding: '0 24px',
            borderBottom: '1px solid #f0f0f0',
          }}
        >
          <Avatar size="small" icon={<UserOutlined />} />
          <Typography.Text strong>{user?.nickname || user?.username}</Typography.Text>
          {user?.role && <Tag color="blue">{user.role}</Tag>}
          <Button onClick={onLogout}>退出登录</Button>
        </Header>
        <Content style={{ margin: 16 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
