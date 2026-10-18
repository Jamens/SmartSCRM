#!/usr/bin/env bash
# 本地启动桌面端（Electron + React）。
#
# 两个坑，都在这个脚本里处理掉了：
#
# 1. ELECTRON_RUN_AS_NODE=1 会让 Electron 以纯 Node 模式启动——不注入 app API，
#    于是 @electron-toolkit/utils 读 electron.app.isPackaged 直接 TypeError。
#    某些终端/CI 环境会预置这个变量，必须先清掉。
#
# 2. 启动前要先构建 inject/bridge 两个 bundle，否则预加载脚本找不到注入资源。
#
# 用法：
#   bash scripts/dev-desktop.sh
#
# 前置：依赖已装（见 README 或 pnpm install）。

set -euo pipefail

DESKTOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../apps/desktop" && pwd)"

# 坑 1：清除会让 Electron 退化成 Node 的环境变量
unset ELECTRON_RUN_AS_NODE

cd "$DESKTOP_DIR"

# 坑 2：预构建注入资源（predev 做的事）
echo "→ 构建注入资源"
node scripts/build-inject.mjs
node scripts/build-bridge.mjs

echo "→ 启动桌面端（dev server :5173 + Electron 主进程）"
exec ./node_modules/.bin/electron-vite dev