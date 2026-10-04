import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Card,
  Descriptions,
  Input,
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
import type { TenantRow } from '@/types';

export default function TenantList() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<number | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [renameId, setRenameId] = useState<number | null>(null);
  const [renameName, setRenameName] = useState('');
  const [detailId, setDetailId] = useState<number | null>(null);

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

  const countsQ = useQuery({
    queryKey: ['tenant-counts', detailId],
    queryFn: () => api.tenantCounts(detailId as number),
    enabled: detailId !== null,
  });

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
      title: '操作',
      width: 220,
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

      <Modal title="租户详情" open={detailId !== null} onCancel={() => setDetailId(null)} footer={null}>
        {countsQ.data ? (
          <Descriptions column={1} bordered>
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
