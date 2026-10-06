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
import type { TeamRow, UserRow } from '@/types';
import { SCOPE_PLATFORM, SCOPE_TENANT } from '@/types';

export default function TeamList() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const canCreate = useAuthStore((s) => s.menuCodes.includes('team:create'));
  const canDelete = useAuthStore((s) => s.menuCodes.includes('team:delete'));
  const canUpdate = useAuthStore((s) => s.menuCodes.includes('team:update'));

  const [tenantId, setTenantId] = useState<number | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    scope: SCOPE_PLATFORM,
    tenantId: undefined as number | undefined,
    name: '',
    parentId: undefined as number | undefined,
    type: 1,
  });

  const [renameId, setRenameId] = useState<number | null>(null);
  const [renameName, setRenameName] = useState('');

  const [configId, setConfigId] = useState<number | null>(null);
  const [configType, setConfigType] = useState<number>(1);
  const [configPushTicket, setConfigPushTicket] = useState<number>(0);
  const [configPowers, setConfigPowers] = useState('');

  const [memberId, setMemberId] = useState<number | null>(null);
  const [memberSel, setMemberSel] = useState<number[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['teams', tenantId, page, pageSize],
    queryFn: () => api.teamsPage({ tenantId, page, pageSize }),
  });
  const usersAllQ = useQuery({ queryKey: ['users-all'], queryFn: () => api.usersPage({ pageSize: 200 }) });

  const createMut = useMutation({
    mutationFn: () => api.teamCreate(form),
    onSuccess: () => {
      message.success('团队已创建');
      setCreateOpen(false);
      qc.invalidateQueries({ queryKey: ['teams'] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const renameMut = useMutation({
    mutationFn: (p: { id: number; name: string }) => api.teamRename(p.id, p.name),
    onSuccess: () => {
      message.success('已重命名');
      setRenameId(null);
      qc.invalidateQueries({ queryKey: ['teams'] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const configMut = useMutation({
    mutationFn: (p: { id: number; type: number; isPushTicket: number; powers: string }) =>
      api.teamUpdateConfig(p.id, { type: p.type, isPushTicket: p.isPushTicket, powers: p.powers || null }),
    onSuccess: () => {
      message.success('部门属性已更新');
      setConfigId(null);
      qc.invalidateQueries({ queryKey: ['teams'] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const openConfig = (r: TeamRow) => {
    setConfigId(r.id);
    setConfigType(r.type ?? 1);
    setConfigPushTicket(r.isPushTicket ?? 0);
    setConfigPowers(r.powers ?? '');
  };

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.teamDelete(id),
    onSuccess: () => {
      message.success('已删除');
      qc.invalidateQueries({ queryKey: ['teams'] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const memberMut = useMutation({
    mutationFn: (p: { id: number; userIds: number[] }) => api.teamAssignMembers(p.id, p.userIds),
    onSuccess: () => {
      message.success('成员已更新');
      setMemberId(null);
      qc.invalidateQueries({ queryKey: ['teams'] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const openMembers = async (id: number) => {
    setMemberId(id);
    try {
      const ids = await api.teamMembers(id);
      setMemberSel(ids);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const columns: ColumnsType<TeamRow> = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '名称', dataIndex: 'name' },
    { title: '作用域', dataIndex: 'scope', width: 90, render: (s: number) => <Tag>{s === SCOPE_PLATFORM ? '平台' : '租户'}</Tag> },
    {
      title: '上级',
      dataIndex: 'parentId',
      width: 100,
      render: (v: number) => (v === 0 ? <Tag color="default">无</Tag> : v),
    },
    {
      title: '租户',
      dataIndex: 'tenantId',
      width: 100,
      render: (v: number | null) => (v == null ? <Tag color="default">全局</Tag> : v),
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 90,
      render: (v: number | undefined) =>
        v === 2 ? <Tag color="purple">DC</Tag> : <Tag>普通</Tag>,
    },
    {
      title: '推送工单',
      dataIndex: 'isPushTicket',
      width: 90,
      render: (v: number | undefined) => (v === 1 ? <Tag color="green">是</Tag> : <Tag>否</Tag>),
    },
    {
      title: '权限',
      dataIndex: 'powers',
      width: 120,
      render: (v: string | null | undefined) => (v ? <span>{v}</span> : <Tag color="default">-</Tag>),
    },
    {
      title: '操作',
      width: 280,
      render: (_, r) => (
        <Space>
          <Button size="small" onClick={() => openMembers(r.id)}>
            成员
          </Button>
          <Button
            size="small"
            disabled={!canUpdate}
            onClick={() => {
              setRenameId(r.id);
              setRenameName(r.name);
            }}
          >
            改名
          </Button>
          <Button size="small" disabled={!canUpdate} onClick={() => openConfig(r)}>
            属性
          </Button>
          <Popconfirm title="删除该团队？" onConfirm={() => deleteMut.mutate(r.id)}>
            <Button size="small" danger disabled={!canDelete}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const userOptions =
    usersAllQ.data?.records.map((u: UserRow) => ({
      label: `${u.username}${u.nickname ? `（${u.nickname}）` : ''}`,
      value: u.id,
    })) ?? [];

  return (
    <Card
      title="团队管理"
      extra={
        canCreate && (
          <Button type="primary" onClick={() => setCreateOpen(true)}>
            新建团队
          </Button>
        )
      }
    >
      <Space style={{ marginBottom: 16 }} wrap>
        <InputNumber
          placeholder="租户 ID"
          style={{ width: 140 }}
          value={tenantId}
          onChange={(v) => {
            setTenantId(v ?? undefined);
            setPage(1);
          }}
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
        title="新建团队"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => createMut.mutate()}
        confirmLoading={createMut.isPending}
        okText="创建"
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Select
            style={{ width: '100%' }}
            value={form.scope}
            onChange={(v) => setForm({ ...form, scope: v })}
            options={[
              { value: SCOPE_PLATFORM, label: '平台（全局）' },
              { value: SCOPE_TENANT, label: '租户' },
            ]}
          />
          {form.scope === SCOPE_TENANT && (
            <InputNumber
              style={{ width: '100%' }}
              placeholder="租户 ID"
              value={form.tenantId}
              onChange={(v) => setForm({ ...form, tenantId: v ?? undefined })}
            />
          )}
          <Input
            placeholder="团队名称"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Select
            style={{ width: '100%' }}
            value={form.type ?? 1}
            onChange={(v) => setForm({ ...form, type: v })}
            options={[
              { value: 1, label: '普通' },
              { value: 2, label: 'DC' },
            ]}
          />
        </Space>
      </Modal>

      <Modal
        title="重命名团队"
        open={renameId !== null}
        onCancel={() => setRenameId(null)}
        onOk={() => renameMut.mutate({ id: renameId as number, name: renameName })}
        confirmLoading={renameMut.isPending}
        okText="保存"
      >
        <Input value={renameName} onChange={(e) => setRenameName(e.target.value)} maxLength={64} />
      </Modal>

      <Modal
        title="团队成员"
        open={memberId !== null}
        onCancel={() => setMemberId(null)}
        onOk={() => memberMut.mutate({ id: memberId as number, userIds: memberSel })}
        confirmLoading={memberMut.isPending}
        okText="保存"
        width={520}
      >
        <Select
          mode="multiple"
          style={{ width: '100%' }}
          placeholder="选择成员"
          value={memberSel}
          onChange={setMemberSel}
          options={userOptions}
          optionFilterProp="label"
          showSearch
        />
      </Modal>

      <Modal
        title="部门属性"
        open={configId !== null}
        onCancel={() => setConfigId(null)}
        onOk={() => configMut.mutate({ id: configId as number, type: configType, isPushTicket: configPushTicket, powers: configPowers })}
        confirmLoading={configMut.isPending}
        okText="保存"
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Select
            style={{ width: '100%' }}
            value={configType}
            onChange={setConfigType}
            options={[
              { value: 1, label: '普通 (NORMAL)' },
              { value: 2, label: 'DC' },
            ]}
          />
          <Select
            style={{ width: '100%' }}
            value={configPushTicket}
            onChange={setConfigPushTicket}
            options={[
              { value: 0, label: '不推送工单' },
              { value: 1, label: '推送工单' },
            ]}
          />
          <Input
            placeholder="权限串（逗号分隔，可选）"
            value={configPowers}
            onChange={(e) => setConfigPowers(e.target.value)}
            maxLength={255}
          />
        </Space>
      </Modal>
    </Card>
  );
}
