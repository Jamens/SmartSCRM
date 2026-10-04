import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Alert, App, Button, Card, Form, Input } from 'antd';
import { KeyOutlined, LockOutlined, UserOutlined } from '@ant-design/icons';
import { useAuthStore } from '@/auth/store';

interface LoginValues {
  username: string;
  password: string;
  inviteCode: string;
}

export default function Login() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const login = useAuthStore((s) => s.login);
  const token = useAuthStore((s) => s.token);
  const menuCodes = useAuthStore((s) => s.menuCodes);
  const navigate = useNavigate();
  const location = useLocation();
  const { message } = App.useApp();

  if (token && menuCodes.length > 0) {
    const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/tenants';
    return <Navigate to={from} replace />;
  }

  const onFinish = async (values: LoginValues) => {
    setSubmitting(true);
    setError(null);
    try {
      await login(values.username.trim(), values.password, values.inviteCode.trim());
      const codes = useAuthStore.getState().menuCodes;
      if (!codes || codes.length === 0) {
        setError('该账号没有管理端权限，请使用平台或租户管理员账号登录。');
        useAuthStore.getState().logout();
        return;
      }
      message.success('登录成功');
      navigate('/tenants', { replace: true });
    } catch (e) {
      setError((e as Error).message || '登录失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f0f2f5',
      }}
    >
      <Card title="SmartSCRM 管理端" style={{ width: 380 }}>
        {error && (
          <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />
        )}
        <Form<LoginValues> layout="vertical" onFinish={onFinish} requiredMark={false}>
          <Form.Item name="username" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
            <Input prefix={<UserOutlined />} placeholder="管理员账号" autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" autoComplete="current-password" />
          </Form.Item>
          <Form.Item
            name="inviteCode"
            label="租户邀请码"
            rules={[{ required: true, message: '请输入邀请码' }]}
            tooltip="平台管理员也需填写其管理的根租户邀请码"
          >
            <Input prefix={<KeyOutlined />} placeholder="invite code" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block loading={submitting}>
              登录
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
