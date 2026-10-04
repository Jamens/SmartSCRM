import { useEffect, useMemo, useState } from 'react';
import type { Key, ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Space, Spin, Tag, Tree, Typography } from 'antd';
import type { DataNode } from 'antd/es/tree';
import * as api from '@/api/admin';
import type { MenuNode } from '@/types';

function toTreeData(nodes: MenuNode[]): DataNode[] {
  return nodes.map((n) => ({
    key: n.id,
    title: n.type === 3 ? <Tag color="purple">{n.name}</Tag> : (n.name as ReactNode),
    children: n.children && n.children.length ? toTreeData(n.children) : undefined,
  }));
}

function collectIds(nodes: MenuNode[], acc: number[] = []): number[] {
  for (const n of nodes) {
    acc.push(n.id);
    if (n.children) collectIds(n.children, acc);
  }
  return acc;
}

function buildCodeMap(nodes: MenuNode[], map = new Map<number, string>()): Map<number, string> {
  for (const n of nodes) {
    map.set(n.id, n.code);
    if (n.children) buildCodeMap(n.children, map);
  }
  return map;
}

export default function RoleEdit() {
  const { id } = useParams();
  const roleId = Number(id);
  const { message } = App.useApp();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const catalogQ = useQuery({ queryKey: ['menus-catalog'], queryFn: () => api.getMenus() });
  const grantedQ = useQuery({
    queryKey: ['role-granted', roleId],
    queryFn: () => api.roleGrantedMenus(roleId),
    enabled: !!id,
  });
  const roleQ = useQuery({ queryKey: ['roles-all'], queryFn: () => api.rolesPage({ pageSize: 200 }) });

  const treeData = useMemo(() => toTreeData(catalogQ.data ?? []), [catalogQ.data]);
  const idToCode = useMemo(() => buildCodeMap(catalogQ.data ?? []), [catalogQ.data]);
  const allIds = useMemo(() => collectIds(catalogQ.data ?? []), [catalogQ.data]);

  const [checked, setChecked] = useState<Key[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (grantedQ.data && !loaded) {
      // Initialize local state from the fetched permission set. The data arrives
      // asynchronously, so a lazy useState initializer cannot capture it.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setChecked(grantedQ.data);
      setLoaded(true);
    }
  }, [grantedQ.data, loaded]);

  const grantMut = useMutation({
    mutationFn: (codes: string[]) => api.roleGrantMenus(roleId, codes),
    onSuccess: () => {
      message.success('权限已保存');
      qc.invalidateQueries({ queryKey: ['role-granted', roleId] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const onSave = () => {
    const codes = checked
      .map((k) => idToCode.get(Number(k)))
      .filter((c): c is string => !!c);
    grantMut.mutate(codes);
  };

  const role = roleQ.data?.records.find((r) => r.id === roleId);

  if (catalogQ.isLoading || grantedQ.isLoading) {
    return (
      <Card>
        <Spin tip="加载权限树…" />
      </Card>
    );
  }

  return (
    <Card
      title={
        <Space>
          <span>角色权限配置</span>
          {role ? <Tag color="blue">{role.name}</Tag> : <Tag>#{roleId}</Tag>}
        </Space>
      }
      extra={
        <Space>
          <Button onClick={() => navigate('/roles')}>返回</Button>
          <Button onClick={() => setChecked(allIds)}>全选</Button>
          <Button onClick={() => setChecked([])}>清空</Button>
          <Button type="primary" loading={grantMut.isPending} onClick={onSave}>
            保存
          </Button>
        </Space>
      }
    >
      <Typography.Paragraph type="secondary">
        勾选即授权；目录与菜单、按钮级权限共用同一套编码，前端按钮守卫与后端 @PreAuthorize 校验同步生效。保存会整体替换该角色的权限集合。
      </Typography.Paragraph>
      <Tree
        checkable
        checkStrictly={false}
        defaultExpandAll
        treeData={treeData}
        checkedKeys={checked}
        onCheck={(keys) => setChecked(Array.isArray(keys) ? keys : keys.checked)}
        style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 12, marginTop: 8 }}
      />
    </Card>
  );
}
