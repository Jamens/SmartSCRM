import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Alert,
  Button,
  Card,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import * as api from '@/api/admin';
import { useAuthStore } from '@/auth/store';
import type { AiRulePayload, AiRuleRow, RuleMatchMode } from '@/types';

interface FormState {
  ruleName: string;
  matchMode: RuleMatchMode;
  keywords: string;
  transferReason: string;
  enabled: boolean;
  priority: number;
}

const EMPTY_FORM: FormState = {
  ruleName: '',
  matchMode: 'any',
  keywords: '',
  transferReason: '',
  enabled: true,
  priority: 0,
};

export default function AiRuleList() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const canList = useAuthStore((s) => s.menuCodes.includes('ai_rule:list'));
  const canCreate = useAuthStore((s) => s.menuCodes.includes('ai_rule:create'));
  const canUpdate = useAuthStore((s) => s.menuCodes.includes('ai_rule:update'));
  const canDelete = useAuthStore((s) => s.menuCodes.includes('ai_rule:delete'));
  const myTenantId = useAuthStore((s) => s.user?.tenantId ?? null);

  // A tenant admin is pinned to its own tenant by the backend, so the selector is only
  // shown when the caller actually has a choice (platform scope, i.e. no tenant of its own).
  const [tenantId, setTenantId] = useState<number | undefined>(myTenantId ?? undefined);
  const effectiveTenantId = myTenantId ?? tenantId;

  const [editing, setEditing] = useState<AiRuleRow | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const rulesQ = useQuery({
    queryKey: ['ai-rules', effectiveTenantId],
    queryFn: () => api.aiRules(effectiveTenantId),
    enabled: canList,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['ai-rules'] });

  const saveMut = useMutation({
    mutationFn: (p: AiRulePayload) =>
      editing ? api.aiRuleUpdate(editing.id, p, effectiveTenantId) : api.aiRuleCreate(p, effectiveTenantId),
    onSuccess: () => {
      message.success(editing ? '规则已更新' : '规则已创建');
      setOpen(false);
      setEditing(null);
      invalidate();
    },
    onError: (e) => message.error((e as Error).message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.aiRuleDelete(id, effectiveTenantId),
    onSuccess: () => {
      message.success('规则已删除');
      invalidate();
    },
    onError: (e) => message.error((e as Error).message),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  };

  const openEdit = (r: AiRuleRow) => {
    setEditing(r);
    setForm({
      ruleName: r.ruleName,
      matchMode: r.matchMode,
      keywords: r.keywords,
      transferReason: r.transferReason ?? '',
      enabled: r.enabled === 1,
      priority: r.priority,
    });
    setOpen(true);
  };

  // Guard the same conditions the backend enforces, so the button is disabled rather
  // than failing after the fact. The rule name and keyword list are the two the
  // service rejects with 40000.
  const canSave =
    form.ruleName.trim().length > 0 &&
    form.keywords
      .split(/[,，;；]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0).length > 0;

  const columns: ColumnsType<AiRuleRow> = [
    { title: 'ID', dataIndex: 'id', width: 70 },
    { title: '规则名', dataIndex: 'ruleName', width: 160 },
    {
      title: '匹配',
      dataIndex: 'matchMode',
      width: 110,
      render: (m: RuleMatchMode) => (
        <Tooltip title={m === 'all' ? '正文需同时包含全部关键词' : '正文包含任一关键词即命中'}>
          <Tag color={m === 'all' ? 'purple' : 'blue'}>{m === 'all' ? '全部' : '任一'}</Tag>
        </Tooltip>
      ),
    },
    {
      title: '关键词',
      dataIndex: 'keywords',
      render: (v: string) => (
        <Space size={4} wrap>
          {v
            .split(/[,，;；]/)
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
            .map((k) => (
              <Tag key={k}>{k}</Tag>
            ))}
        </Space>
      ),
    },
    {
      title: '转人工原因',
      dataIndex: 'transferReason',
      width: 180,
      render: (v: string | null) => v || <Tag color="default">用规则名</Tag>,
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 90,
      render: (p: number) => <Tag color={p > 0 ? 'green' : 'default'}>{p}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 90,
      render: (v: number) => (v === 1 ? <Tag color="success">启用</Tag> : <Tag>停用</Tag>),
    },
    {
      title: '操作',
      width: 130,
      render: (_, r) => (
        <Space>
          <Button size="small" disabled={!canUpdate} onClick={() => openEdit(r)}>
            编辑
          </Button>
          <Popconfirm title="删除该规则？" onConfirm={() => deleteMut.mutate(r.id)}>
            <Button size="small" danger disabled={!canDelete}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // A platform admin has no tenant of its own; without one the backend answers 40001,
  // so say so up front instead of firing a request that is guaranteed to fail.
  const needTenant = myTenantId == null && effectiveTenantId == null;

  return (
    <Card
      title="转人工规则"
      extra={
        canCreate && (
          <Button type="primary" onClick={openCreate}>
            新建规则
          </Button>
        )
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="客户发来的入站消息命中关键词时，该会话会自动从 AI 转人工并进入接管队列。优先级数字越大越先评估；停用的规则不参与匹配。"
      />

      {myTenantId == null && (
        <Space style={{ marginBottom: 16 }}>
          <InputNumber
            placeholder="租户 ID（平台管理员必填）"
            style={{ width: 220 }}
            value={effectiveTenantId}
            onChange={(v) => setTenantId(v ?? undefined)}
          />
        </Space>
      )}

      {needTenant && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="请先填写租户 ID：平台管理员没有默认租户，规则按租户隔离。"
        />
      )}

      <Table
        rowKey="id"
        loading={rulesQ.isLoading}
        columns={columns}
        dataSource={rulesQ.data ?? []}
        pagination={false}
        locale={{ emptyText: needTenant ? '请先选择租户' : '暂无规则，点右上角新建' }}
      />

      <Modal
        title={editing ? '编辑规则' : '新建规则'}
        open={open}
        onCancel={() => {
          setOpen(false);
          setEditing(null);
        }}
        onOk={() =>
          saveMut.mutate({
            ruleName: form.ruleName.trim(),
            matchMode: form.matchMode,
            keywords: form.keywords.trim(),
            transferReason: form.transferReason.trim() || undefined,
            enabled: form.enabled ? 1 : 0,
            priority: form.priority,
          })
        }
        okButtonProps={{ disabled: !canSave }}
        confirmLoading={saveMut.isPending}
        okText="保存"
        width={560}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Input
            placeholder="规则名（必填）"
            maxLength={100}
            value={form.ruleName}
            onChange={(e) => setForm({ ...form, ruleName: e.target.value })}
          />
          <Select
            style={{ width: '100%' }}
            value={form.matchMode}
            onChange={(v: RuleMatchMode) => setForm({ ...form, matchMode: v })}
            options={[
              { value: 'any', label: '任一关键词命中（any）' },
              { value: 'all', label: '全部关键词命中（all）' },
            ]}
          />
          <Input.TextArea
            rows={2}
            placeholder="关键词（必填），用逗号或分号分隔：退款, 投诉, 人工"
            maxLength={1000}
            value={form.keywords}
            onChange={(e) => setForm({ ...form, keywords: e.target.value })}
          />
          <Input
            placeholder="转人工原因（留空则用「规则名」作为原因）"
            maxLength={255}
            value={form.transferReason}
            onChange={(e) => setForm({ ...form, transferReason: e.target.value })}
          />
          <Space>
            <span>启用</span>
            <Switch checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} />
            <InputNumber
              placeholder="优先级"
              style={{ width: 140 }}
              value={form.priority}
              onChange={(v) => setForm({ ...form, priority: v ?? 0 })}
            />
          </Space>
        </Space>
      </Modal>
    </Card>
  );
}
