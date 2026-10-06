import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Card,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import * as api from '@/api/admin';
import { useAuthStore } from '@/auth/store';
import type { RoleRow, TeamRow, TenantRow, UserRow } from '@/types';

export default function UserList() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const canAssign = useAuthStore((s) => s.menuCodes.includes('user:assignRole'));
  const canAssignTeam = useAuthStore((s) => s.menuCodes.includes('user:assignTeam'));
  const canCreate = useAuthStore((s) => s.menuCodes.includes('user:create'));
  const canDelete = useAuthStore((s) => s.menuCodes.includes('user:delete'));
  const canEdit = useAuthStore((s) => s.menuCodes.includes('user:update'));
  const canResetPassword = useAuthStore((s) => s.menuCodes.includes('user:resetPassword'));

  const [tenantId, setTenantId] = useState<number | undefined>();
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [roleId, setRoleId] = useState<number | null>(null);
  const [roleSel, setRoleSel] = useState<number[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [createUsername, setCreateUsername] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createNickname, setCreateNickname] = useState('');
  const [createTenantId, setCreateTenantId] = useState<number | undefined>();
  const [createRole, setCreateRole] = useState<string>('agent');
  const [createStatus, setCreateStatus] = useState<number>(1);
  const [createPortLimit, setCreatePortLimit] = useState<number | null>(null);

  const [teamId, setTeamId] = useState<number | null>(null);
  const [teamTenantId, setTeamTenantId] = useState<number | null>(null);
  const [teamSel, setTeamSel] = useState<number[]>([]);

  const [portId, setPortId] = useState<number | null>(null);
  const [portEdit, setPortEdit] = useState<number | null>(null);
  const [resetId, setResetId] = useState<number | null>(null);
  const [resetPassword, setResetPassword] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['users', tenantId, keyword, page, pageSize],
    queryFn: () => api.usersPage({ tenantId, keyword: keyword || undefined, page, pageSize }),
  });
  const rolesAllQ = useQuery({ queryKey: ['roles-all-users'], queryFn: () => api.rolesPage({ pageSize: 200 }) });

  // Team options for the assign-team modal, scoped to the target user's tenant.
  const teamsAllQ = useQuery({
    queryKey: ['teams-for-user', teamTenantId],
    queryFn: () => api.teamsPage({ tenantId: teamTenantId ?? undefined, pageSize: 200 }),
    enabled: teamId !== null,
  });
  // Tenant options for the create-user modal (platform/super admins only; tenant
  // admins get 403 and this stays empty, letting the backend default to their tenant).
  const tenantsAllQ = useQuery({
    queryKey: ['tenants-all-create'],
    queryFn: () => api.tenantsPage({ pageSize: 200 }),
    enabled: createOpen,
    retry: false,
  });

  const statusMut = useMutation({
    mutationFn: (p: { id: number; status: number }) => api.userSetStatus(p.id, p.status),
    onSuccess: () => {
      message.success('状态已更新');
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const roleMut = useMutation({
    mutationFn: (p: { id: number; roleIds: number[] }) => api.userAssignRoles(p.id, p.roleIds),
    onSuccess: () => {
      message.success('角色已更新');
      setRoleId(null);
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const openRoles = async (id: number) => {
    setRoleId(id);
    try {
      const ids = await api.userRoles(id);
      setRoleSel(ids);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const createMut = useMutation({
    mutationFn: () =>
      api.userCreate({
        username: createUsername,
        password: createPassword,
        nickname: createNickname || undefined,
        tenantId: createTenantId,
        role: createRole,
        status: createStatus,
        portLimit: createPortLimit,
      }),
    onSuccess: () => {
      message.success('用户已创建');
      setCreateOpen(false);
      setCreateUsername('');
      setCreatePassword('');
      setCreateNickname('');
      setCreateTenantId(undefined);
      setCreateRole('agent');
      setCreateStatus(1);
      setCreatePortLimit(null);
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const portMut = useMutation({
    mutationFn: (p: { id: number; portLimit: number | null }) => api.userSetPortLimit(p.id, p.portLimit),
    onSuccess: () => {
      message.success('端口上限已更新');
      setPortId(null);
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const resetMut = useMutation({
    mutationFn: (p: { id: number; password: string }) => api.userResetPassword(p.id, p.password),
    onSuccess: () => {
      message.success('密码已重置');
      setResetId(null);
      setResetPassword('');
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const openPort = (r: UserRow) => {
    setPortId(r.id);
    setPortEdit(r.portLimit ?? null);
  };

  const teamMut = useMutation({
    mutationFn: () => api.userAssignTeams(teamId as number, teamSel),
    onSuccess: () => {
      message.success('团队已更新');
      setTeamId(null);
      setTeamTenantId(null);
      setTeamSel([]);
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.userDelete(id),
    onSuccess: () => {
      message.success('用户已删除');
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const openCreate = () => {
    setCreateUsername('');
    setCreatePassword('');
    setCreateNickname('');
    setCreateTenantId(undefined);
    setCreateRole('agent');
    setCreateStatus(1);
    setCreatePortLimit(null);
    setCreateOpen(true);
  };

  const openTeams = async (id: number, userTenantId: number | null) => {
    setTeamId(id);
    setTeamTenantId(userTenantId);
    setTeamSel([]);
    try {
      const ids = await api.userTeams(id);
      setTeamSel(ids);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const columns: ColumnsType<UserRow> = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '账号', dataIndex: 'username', width: 160 },
    { title: '昵称', dataIndex: 'nickname', render: (v: string | null) => v ?? '-' },
    {
      title: '角色',
      dataIndex: 'role',
      width: 140,
      render: (v: string | null) => (v ? <Tag color="blue">{v}</Tag> : '-'),
    },
    {
      title: '租户',
      dataIndex: 'tenantId',
      width: 100,
      render: (v: number | null) => (v == null ? <Tag color="default">全局</Tag> : v),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (s: number) => (s === 1 ? <Tag color="green">启用</Tag> : <Tag color="red">停用</Tag>),
    },
    {
      title: '端口上限',
      dataIndex: 'portLimit',
      width: 100,
      render: (v: number | null | undefined) =>
        v == null ? <Tag color="default">不限</Tag> : <span>{v}</span>,
    },
    {
      title: '操作',
      width: 380,
      render: (_, r) => (
        <Space>
          <Button size="small" disabled={!canAssign} onClick={() => openRoles(r.id)}>
            分配角色
          </Button>
          <Button size="small" disabled={!canAssignTeam} onClick={() => openTeams(r.id, r.tenantId)}>
            分配团队
          </Button>
          <Button size="small" disabled={!canEdit} onClick={() => openPort(r)}>
            端口上限
          </Button>
          <Button size="small" disabled={!canResetPassword} onClick={() => setResetId(r.id)}>
            重置密码
          </Button>
          <Popconfirm
            title={r.status === 1 ? '停用该账号？' : '启用该账号？'}
            onConfirm={() => statusMut.mutate({ id: r.id, status: r.status === 1 ? 0 : 1 })}
          >
            <Button size="small" danger={r.status === 1}>
              {r.status === 1 ? '停用' : '启用'}
            </Button>
          </Popconfirm>
          <Popconfirm
            title="删除该用户？"
            description="该用户的角色与团队关联将一并清除"
            onConfirm={() => deleteMut.mutate(r.id)}
          >
            <Button size="small" danger disabled={!canDelete}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const roleOptions =
    rolesAllQ.data?.records.map((r: RoleRow) => ({
      label: `${r.name}（${r.code}）`,
      value: r.id,
    })) ?? [];

  return (
    <Card title="子账号管理">
      <Space style={{ marginBottom: 16 }} wrap>
        <Button type="primary" disabled={!canCreate} onClick={openCreate}>
          新建用户
        </Button>
        <InputNumber
          placeholder="租户 ID"
          style={{ width: 140 }}
          value={tenantId}
          onChange={(v) => {
            setTenantId(v ?? undefined);
            setPage(1);
          }}
        />
        <Input.Search
          placeholder="搜索账号/昵称"
          allowClear
          onSearch={(v) => {
            setKeyword(v);
            setPage(1);
          }}
          style={{ width: 220 }}
        />
      </Space>
      <Table
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={data?.records ?? []}
        pagination={{
          total: data?.total ?? 0,
          current: page,
          pageSize,
          showSizeChanger: true,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
      />

      <Modal
        title="分配角色"
        open={roleId !== null}
        onCancel={() => setRoleId(null)}
        onOk={() => roleMut.mutate({ id: roleId as number, roleIds: roleSel })}
        confirmLoading={roleMut.isPending}
        okText="保存"
        width={520}
      >
        <Select
          mode="multiple"
          style={{ width: '100%' }}
          placeholder="选择角色"
          value={roleSel}
          onChange={setRoleSel}
          options={roleOptions}
          optionFilterProp="label"
          showSearch
        />
      </Modal>

      <Modal
        title="新建用户"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => createMut.mutate()}
        confirmLoading={createMut.isPending}
        okText="创建"
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Input
            value={createUsername}
            onChange={(e) => setCreateUsername(e.target.value)}
            maxLength={64}
            placeholder="登录账号（必填）"
            status={!createUsername ? 'error' : undefined}
          />
          <Input.Password
            value={createPassword}
            onChange={(e) => setCreatePassword(e.target.value)}
            placeholder="初始密码（至少 6 位，必填）"
            status={!createPassword ? 'error' : undefined}
          />
          <Input
            value={createNickname}
            onChange={(e) => setCreateNickname(e.target.value)}
            maxLength={64}
            placeholder="昵称（可选）"
          />
          {tenantsAllQ.data ? (
            <Select
              style={{ width: '100%' }}
              placeholder="租户（平台管理员必选）"
              allowClear
              value={createTenantId}
              onChange={setCreateTenantId}
              options={tenantsAllQ.data.records.map((t: TenantRow) => ({ label: `${t.name}（${t.inviteCode}）`, value: t.id }))}
              showSearch
              optionFilterProp="label"
            />
          ) : null}
          <Select
            style={{ width: '100%' }}
            value={createRole}
            onChange={setCreateRole}
            options={[
              { value: 'owner', label: 'owner' },
              { value: 'admin', label: 'admin' },
              { value: 'agent', label: 'agent' },
            ]}
          />
          <Select
            style={{ width: '100%' }}
            value={createStatus}
            onChange={setCreateStatus}
            options={[
              { value: 1, label: '启用' },
              { value: 0, label: '停用' },
            ]}
          />
          <InputNumber
            style={{ width: '100%' }}
            placeholder="端口上限（留空=不限，受租户 seat_limit 约束）"
            min={1}
            value={createPortLimit}
            onChange={(v) => setCreatePortLimit(v ?? null)}
          />
        </Space>
      </Modal>

      <Modal
        title="分配团队"
        open={teamId !== null}
        onCancel={() => {
          setTeamId(null);
          setTeamTenantId(null);
          setTeamSel([]);
        }}
        onOk={() => teamMut.mutate()}
        confirmLoading={teamMut.isPending}
        okText="保存"
        width={520}
      >
        <Select
          mode="multiple"
          style={{ width: '100%' }}
          placeholder="选择团队"
          value={teamSel}
          onChange={setTeamSel}
          loading={teamsAllQ.isLoading}
          options={(teamsAllQ.data?.records ?? []).map((t: TeamRow) => ({ label: t.name, value: t.id }))}
          optionFilterProp="label"
          showSearch
        />
      </Modal>

      <Modal
        title="端口上限"
        open={portId !== null}
        onCancel={() => setPortId(null)}
        onOk={() => portMut.mutate({ id: portId as number, portLimit: portEdit })}
        confirmLoading={portMut.isPending}
        okText="保存"
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <InputNumber
            style={{ width: '100%' }}
            placeholder="留空=不限（受租户 seat_limit 约束）"
            min={1}
            value={portEdit}
            onChange={(v) => setPortEdit(v ?? null)}
          />
          <div style={{ color: 'rgba(0,0,0,0.45)' }}>上限不得超过该账号所属租户的 seat_limit。</div>
        </Space>
      </Modal>

      <Modal
        title="重置密码"
        open={resetId !== null}
        onCancel={() => {
          setResetId(null);
          setResetPassword('');
        }}
        onOk={() => resetMut.mutate({ id: resetId as number, password: resetPassword })}
        confirmLoading={resetMut.isPending}
        okText="重置"
      >
        <Input.Password
          value={resetPassword}
          onChange={(e) => setResetPassword(e.target.value)}
          placeholder="新密码（至少 6 位）"
          status={resetPassword.length > 0 && resetPassword.length < 6 ? 'error' : undefined}
        />
      </Modal>
    </Card>
  );
}
