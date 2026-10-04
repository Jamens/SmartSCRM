import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Card,
  Descriptions,
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
import dayjs from 'dayjs';
import * as api from '@/api/admin';
import { useAuthStore } from '@/auth/store';
import type { TenantRow } from '@/types';

export default function TenantList() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const canCreate = useAuthStore((s) => s.menuCodes.includes('tenant:create'));
  const canQuota = useAuthStore((s) => s.menuCodes.includes('tenant:quota'));
  const canDelete = useAuthStore((s) => s.menuCodes.includes('tenant:delete'));
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<number | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [renameId, setRenameId] = useState<number | null>(null);
  const [renameName, setRenameName] = useState('');
  const [detailId, setDetailId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createCode, setCreateCode] = useState('');
  const [quotaId, setQuotaId] = useState<number | null>(null);
  const [quotaLimit, setQuotaLimit] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['tenants', keyword, status, page, pageSize],
    queryFn: () => api.tenantsPage({ keyword: keyword || undefined, status, page, pageSize }),
  });

  const renameMut = useMutation({
    mutationFn: (p: { id: number; name: string }) => api.tenantRename(p.id, p.name),
    onSuccess: () => {
      message.success('已重命名');
      setRenameId(null);
      qc.invalidateQueries({ queryKey: ['tenants'] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const statusMut = useMutation({
    mutationFn: (p: { id: number; status: number }) => api.tenantSetStatus(p.id, p.status),
    onSuccess: () => {
      message.success('状态已更新');
      qc.invalidateQueries({ queryKey: ['tenants'] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const createMut = useMutation({
    mutationFn: () => api.tenantCreate({ name: createName, inviteCode: createCode || undefined }),
    onSuccess: () => {
      message.success('租户已创建');
      setCreateOpen(false);
      setCreateName('');
      setCreateCode('');
      qc.invalidateQueries({ queryKey: ['tenants'] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const quotaMut = useMutation({
    mutationFn: () => api.tenantSetQuota(quotaId as number, quotaLimit),
    onSuccess: () => {
      message.success('配额已更新');
      setQuotaId(null);
      setQuotaLimit(null);
      qc.invalidateQueries({ queryKey: ['tenants'] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.tenantDelete(id),
    onSuccess: () => {
      message.success('租户已删除');
      qc.invalidateQueries({ queryKey: ['tenants'] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const countsQ = useQuery({
    queryKey: ['tenant-counts', detailId],
    queryFn: () => api.tenantCounts(detailId as number),
    enabled: detailId !== null,
  });

  const detailRow = data?.records.find((r) => r.id === detailId) ?? null;

  const columns: ColumnsType<TenantRow> = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '邀请码', dataIndex: 'inviteCode', width: 140 },
    { title: '名称', dataIndex: 'name' },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (s: number) =>
        s === 1 ? <Tag color="green">启用</Tag> : <Tag color="red">停用</Tag>,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (v: string) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-'),
    },
    {
      title: '席位',
      key: 'seats',
      width: 150,
      render: (_, r: TenantRow) => {
        const used = r.seatUsed ?? 0;
        if (r.seatLimit == null) {
          return <span>已用 {used} / 不限</span>;
        }
        const over = used > r.seatLimit;
        return (
          <span style={over ? { color: '#cf1322', fontWeight: 600 } : undefined}>
            已用 {used} / 上限 {r.seatLimit}
          </span>
        );
      },
    },
    {
      title: '操作',
      width: 320,
      render: (_, r) => (
        <Space>
          <Button
            size="small"
            onClick={() => {
              setRenameId(r.id);
              setRenameName(r.name);
            }}
          >
            改名
          </Button>
          <Popconfirm
            title={r.status === 1 ? '停用该租户？' : '启用该租户？'}
            onConfirm={() => statusMut.mutate({ id: r.id, status: r.status === 1 ? 0 : 1 })}
          >
            <Button size="small" danger={r.status === 1}>
              {r.status === 1 ? '停用' : '启用'}
            </Button>
          </Popconfirm>
          <Button size="small" disabled={!canQuota} onClick={() => { setQuotaId(r.id); setQuotaLimit(r.seatLimit); }}>
            配额
          </Button>
          <Popconfirm
            title="删除该租户？"
            description="租户下仍有成员或平台账号时将被拒绝"
            onConfirm={() => deleteMut.mutate(r.id)}
          >
            <Button size="small" danger disabled={!canDelete}>
              删除
            </Button>
          </Popconfirm>
          <Button size="small" onClick={() => setDetailId(r.id)}>
            详情
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Card title="租户管理">
      <Space style={{ marginBottom: 16 }} wrap>
        <Button type="primary" disabled={!canCreate} onClick={() => setCreateOpen(true)}>
          新建租户
        </Button>
        <Input.Search
          placeholder="按名称搜索"
          allowClear
          onSearch={(v) => {
            setKeyword(v);
            setPage(1);
          }}
          style={{ width: 220 }}
        />
        <Select
          placeholder="状态"
          allowClear
          style={{ width: 120 }}
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={[
            { value: 1, label: '启用' },
            { value: 0, label: '停用' },
          ]}
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
        title="重命名租户"
        open={renameId !== null}
        onCancel={() => setRenameId(null)}
        onOk={() => renameMut.mutate({ id: renameId as number, name: renameName })}
        confirmLoading={renameMut.isPending}
        okText="保存"
      >
        <Input
          value={renameName}
          onChange={(e) => setRenameName(e.target.value)}
          maxLength={128}
          placeholder="租户名称"
        />
      </Modal>

      <Modal
        title="新建租户"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => createMut.mutate()}
        confirmLoading={createMut.isPending}
        okText="创建"
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Input
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            maxLength={128}
            placeholder="租户名称（必填）"
            status={!createName ? 'error' : undefined}
          />
          <Input
            value={createCode}
            onChange={(e) => setCreateCode(e.target.value)}
            maxLength={64}
            placeholder="邀请码（可选，留空自动生成）"
          />
        </Space>
      </Modal>

      <Modal
        title="设置席位配额"
        open={quotaId !== null}
        onCancel={() => setQuotaId(null)}
        onOk={() => quotaMut.mutate()}
        confirmLoading={quotaMut.isPending}
        okText="保存"
      >
        <InputNumber
          style={{ width: '100%' }}
          min={0}
          max={100000}
          value={quotaLimit}
          onChange={(v) => setQuotaLimit(v)}
          placeholder="留空为不限"
        />
      </Modal>

      <Modal title="租户详情" open={detailId !== null} onCancel={() => setDetailId(null)} footer={null}>
        {countsQ.data ? (
          <Descriptions column={1} bordered>
            {detailRow && (
              <Descriptions.Item label="席位用量">
                {detailRow.seatUsed} / {detailRow.seatLimit == null ? '不限' : detailRow.seatLimit}
              </Descriptions.Item>
            )}
            <Descriptions.Item label="用户数">{countsQ.data.users}</Descriptions.Item>
            <Descriptions.Item label="平台账号数">
              {countsQ.data.platformAccounts}
            </Descriptions.Item>
          </Descriptions>
        ) : (
          <span>加载中…</span>
        )}
      </Modal>
    </Card>
  );
}
