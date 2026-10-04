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
import type { RoleRow, UserRow } from '@/types';

export default function UserList() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const canAssign = useAuthStore((s) => s.menuCodes.includes('user:assignRole'));

  const [tenantId, setTenantId] = useState<number | undefined>();
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [roleId, setRoleId] = useState<number | null>(null);
  const [roleSel, setRoleSel] = useState<number[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['users', tenantId, keyword, page, pageSize],
    queryFn: () => api.usersPage({ tenantId, keyword: keyword || undefined, page, pageSize }),
  });
  const rolesAllQ = useQuery({ queryKey: ['roles-all-users'], queryFn: () => api.rolesPage({ pageSize: 200 }) });

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
      title: '操作',
      width: 200,
      render: (_, r) => (
        <Space>
          <Button size="small" disabled={!canAssign} onClick={() => openRoles(r.id)}>
            分配角色
          </Button>
          <Popconfirm
            title={r.status === 1 ? '停用该账号？' : '启用该账号？'}
            onConfirm={() => statusMut.mutate({ id: r.id, status: r.status === 1 ? 0 : 1 })}
          >
            <Button size="small" danger={r.status === 1}>
              {r.status === 1 ? '停用' : '启用'}
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
    </Card>
  );
}
