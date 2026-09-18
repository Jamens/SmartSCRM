# SmartSCRM 功能清单与阶段计划（已确认）

范围：全量 15 模块；保留内嵌真实网页能力；Java 后端为唯一数据层；本地 MySQL(root/1234560)；线上 API 全部改为数据库 + 模拟数据。

## A. 壳层 / 基础框架
| # | 功能 | 阶段 |
|---|------|------|
| A1 | 登录/鉴权（账号密码 + 邀请码租户 + 机器码设备绑定，JWT） | P1 |
| A2 | 无边框主窗（自绘标题栏、托盘、任务栏未读角标、单实例） | P1 |
| A3 | 多开/窗口管理（同账号多窗检测、登录态分区） | P2 |
| A4 | i18n（zh-CN / en 起，8 语种框架） | P14 |
| A5 | 主题：宝蓝主色 + 金色点缀，light/dark | P1 起 |
| A6 | 自动更新框架（本地源） | P14 |
| A7 | 内存/性能监控 | P14 |
| A8 | 敏感词风控（本地库） | P14 |

## B. 业务模块
| # | 功能 | 阶段 |
|---|------|------|
| B1 | 多平台账号视图（WebContentsView + 分区登录态 + 代理） | P2 |
| B15 | 注入脚本系统（WhatsApp/TG 适配器、翻译/UI/消息，迁移复用） | P2 |
| B4 | 客户管理（联系人/标签树/备注/时间线/受众包） | P3 |
| B3 | 快捷回复素材库（文字/图片/名片多组件） | P4 |
| B2 | 翻译中心（4 渠道 + 节点测速 + 模拟翻译 + 译文缓存） | P5 |
| B5 | 聊天记录（存储/搜索/统计） | P6 |
| B7 | 批量群发（笛卡尔展开/随机间隔/撤回/看门狗） | P7 |
| B6 | 群成员分析（事件流水 + 状态快照 + 导出） | P8 |
| B8 | 炒群引擎（角色库三级/剧本/loop 调度/failover/断点续跑，调度在 Java） | P9 |
| B9 | 互聊养号（装箱算法 + 可复现日程） | P10 |
| B13 | 代理池管理 | P11 |
| B14 | 浏览器指纹配置 | P11 |
| B10 | 云手机（VMOS 管理 + 模拟拉流） | P12 |
| B11 | 报表仪表盘 | P13 |
| B12 | 支付/套餐门控（模拟支付宝） | P13 |

## 技术选型
- desktop: Electron 39 + React 19 + TS(strict) + electron-vite + Tailwind v4 + shadcn/ui + Zustand + TanStack Query + react-i18next
- server: Java 17 + Spring Boot 3.5 + MyBatis-Plus + Flyway + MySQL 8（库名 `smartscrm_react`，不动旧 `smartscrm` 库）
- 数据模型：从老项目 24 张表（SQLite）推断映射，去掉 extra1-5 临时列，invite_code → tenant_id

## 协作约定
- 每完成一个阶段功能：本地测试通过 → git commit（用户自行 push）
- 提交前缀：feat: / fix: / refa: / update:
