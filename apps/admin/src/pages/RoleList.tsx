import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import * as api from '@/api/admin';
import { useAuthStore } from '@/auth/store';
import type { RoleRow } from '@/types';
import { SCOPE_PLATFORM, SCOPE_TENANT } from '@/types';

const scopeLabel = (s: number) => (s === SCOPE_PLATFORM ? '平台' : s === SCOPE_TENANT ? '租户' : String(s));

export default function RoleList() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canCreate = useAuthStore((s) => s.menuCodes.includes('role:create'));
  const canDelete = useAuthStore((s) => s.menuCodes.includes('role:delete'));

  const [scope, setScope] = useState<number | undefined>();
  const [tenantId, setTenantId] = useState<number | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ scope: SCOPE_PLATFORM, tenantId: undefined as number | undefined, code: '', name: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['roles', scope, tenantId, page, pageSize],
    queryFn: () => api.rolesPage({ scope, tenantId, page, pageSize }),
  });

  const createMut = useMutation({
    mutationFn: () => api.roleCreate(form),
    onSuccess: (role) => {
      message.success('角色已创建');
      setCreateOpen(false);
      qc.invalidateQueries({ queryKey: ['roles'] });
      navigate(`/roles/${role.id}`);
    },
    onError: (e) => message.error((e as Error).message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.roleDelete(id),
    onSuccess: () => {
      message.success('已删除');
      qc.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const columns: ColumnsType<RoleRow> = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '编码', dataIndex: 'code', width: 160 },
    { title: '名称', dataIndex: 'name' },
    { title: '作用域', dataIndex: 'scope', width: 90, render: (s: number) => <Tag>{scopeLabel(s)}</Tag> },
    {
      title: '租户',
      dataIndex: 'tenantId',
      width: 100,
      render: (v: number | null) => (v == null ? <Tag color="default">全局</Tag> : v),
    },
    {
      title: '类型',
      dataIndex: 'builtin',
      width: 100,
      render: (b: number) => (b === 1 ? <Tag color="gold">内置</Tag> : <Tag>自定义</Tag>),
    },
    {
      title: '操作',
      width: 180,
      render: (_, r) => (
        <Space>
          <Button size="small" onClick={() => navigate(`/roles/${r.id}`)}>
            权限
          </Button>
          <Popconfirm
            title="删除该角色？"
            description={r.builtin === 1 ? '内置角色不可删除' : undefined}
            disabled={r.builtin === 1 || !canDelete}
            onConfirm={() => deleteMut.mutate(r.id)}
          >
            <Button size="small" danger disabled={r.builtin === 1 || !canDelete}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card
      title="角色权限"
      extra={
        canCreate && (
          <Button type="primary" onClick={() => setCreateOpen(true)}>
            新建角色
          </Button>
        )
      }
    >
      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          placeholder="作用域"
          allowClear
          style={{ width: 120 }}
          value={scope}
          onChange={(v) => {
            setScope(v);
            setPage(1);
          }}
          options={[
            { value: SCOPE_PLATFORM, label: '平台' },
            { value: SCOPE_TENANT, label: '租户' },
          ]}
        />
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
        title="新建角色"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => createMut.mutate()}
        confirmLoading={createMut.isPending}
        okText="创建并配置权限"
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <div style={{ marginBottom: 4 }}>作用域</div>
            <Select
              style={{ width: '100%' }}
              value={form.scope}
              onChange={(v) => setForm({ ...form, scope: v })}
              options={[
                { value: SCOPE_PLATFORM, label: '平台（全局）' },
                { value: SCOPE_TENANT, label: '租户' },
              ]}
            />
          </div>
          {form.scope === SCOPE_TENANT && (
            <div>
              <div style={{ marginBottom: 4 }}>租户 ID</div>
              <InputNumber
                style={{ width: '100%' }}
                value={form.tenantId}
                onChange={(v) => setForm({ ...form, tenantId: v ?? undefined })}
              />
            </div>
          )}
          <div>
            <div style={{ marginBottom: 4 }}>编码（唯一）</div>
            <Input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="如 tenant_op"
            />
          </div>
          <div>
            <div style={{ marginBottom: 4 }}>名称</div>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="如 租户运营"
            />
          </div>
        </Space>
      </Modal>
    </Card>
  );
}
