#!/usr/bin/env bash
# 本地启动后端（开发用）。
#
# 为什么需要这个脚本：`application.yml` 里的口令与 JWT 密钥已改为环境变量注入
# （P0 修复，密钥不再入库），所以本地起服务必须显式提供这两个变量，否则
# JwtService 会拒绝启动——这是刻意的，弱密钥等于没有鉴权。
#
# 用法：
#   bash scripts/dev-server.sh          # 前台启动
#
# 口令与密钥从本地私有文件读（该文件被 .gitignore 忽略）：
#   apps/server/src/main/resources/application-local.yml
# 若该文件不存在，用环境变量兜底：
#   SCRM_DB_PASSWORD=... SCRM_JWT_SECRET=... bash scripts/dev-server.sh

set -euo pipefail

SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../apps/server" && pwd)"
LOCAL_YML="$SERVER_DIR/src/main/resources/application-local.yml"

# 从本地私有 yml 里抽取值。刻意不在本脚本里硬编码任何凭据。
if [[ -f "$LOCAL_YML" ]]; then
  read_yaml() {
    # 用 awk 找 "    <key>:" 缩进层级下的值，兼容行尾注释
    awk -v key="$1" '
      $0 ~ "^    " key ":" {
        v = $0
        sub(/^[^:]*:[[:space:]]*/, "", v)
        sub(/[[:space:]]*#.*$/, "", v)
        gsub(/^["'"'"']|["'"'"']$/, "", v)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", v)
        print v
        exit
      }
    ' "$LOCAL_YML"
  }
  [[ -z "${SCRM_DB_PASSWORD:-}" ]] && SCRM_DB_PASSWORD="$(read_yaml password)"
  [[ -z "${SCRM_JWT_SECRET:-}" ]] && SCRM_JWT_SECRET="$(read_yaml secret)"
fi

if [[ -z "${SCRM_DB_PASSWORD:-}" ]]; then
  echo "缺少 SCRM_DB_PASSWORD：请在 $LOCAL_YML 填 password，或用环境变量传入" >&2
  exit 1
fi
if [[ -z "${SCRM_JWT_SECRET:-}" ]]; then
  echo "缺少 SCRM_JWT_SECRET：请在 $LOCAL_YML 填 secret（≥32 字节，可用 openssl rand -base64 48 生成），或用环境变量传入" >&2
  exit 1
fi
if (( ${#SCRM_JWT_SECRET} < 32 )); then
  echo "SCRM_JWT_SECRET 至少 32 字节，当前 ${#SCRM_JWT_SECRET}" >&2
  exit 1
fi

export SCRM_DB_PASSWORD SCRM_JWT_SECRET

# 显式固定端口，绕开环境里可能存在的 SERVER__PORT / SERVER_PORT 干扰。
# （Spring Boot 的 relaxed binding 会把 SERVER__PORT 这类双下划线变量当作 server.port，
# 优先级高于 application.yml。本机环境里就有一个 SERVER__PORT=61844，会把服务顶到
# 随机高端口并与其他进程相撞。这里用 --server.port 显式指定，命令行参数优先级最高。）
PORT="${SCRM_DEV_PORT:-8180}"

echo "→ 启动后端：port=$PORT（DB 口令与 JWT 密钥已从环境变量注入）"
cd "$SERVER_DIR"
exec ./mvnw -o spring-boot:run -Dspring-boot.run.arguments="--server.port=${PORT}"