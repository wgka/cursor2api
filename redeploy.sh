#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="${APP_NAME:-cursor2api}"
GIT_REMOTE="${GIT_REMOTE:-origin}"
GIT_BRANCH="${GIT_BRANCH:-}"

info() { printf '\033[1;34m[INFO]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[WARN]\033[0m %s\n' "$*"; }
error() { printf '\033[1;31m[ERROR]\033[0m %s\n' "$*" >&2; }

on_error() {
  error "脚本执行失败（第 $1 行）"
}
trap 'on_error $LINENO' ERR

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    error "缺少命令: $1"
    exit 1
  }
}

run() {
  info "执行: $*"
  "$@"
}

choose_compose() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    echo "docker compose"
    return 0
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    echo "docker-compose"
    return 0
  fi

  return 1
}

cd "$PROJECT_DIR"

need_cmd git

if [[ ! -d .git ]]; then
  error "当前目录不是 Git 仓库: $PROJECT_DIR"
  exit 1
fi

if [[ -z "$GIT_BRANCH" ]]; then
  GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
fi

if [[ "$GIT_BRANCH" == "HEAD" ]]; then
  error "当前处于 detached HEAD，无法自动确定分支"
  exit 1
fi

if ! git remote get-url "$GIT_REMOTE" >/dev/null 2>&1; then
  error "Git 远程不存在: $GIT_REMOTE"
  exit 1
fi

TRACKED_CHANGES="$(git status --porcelain --untracked-files=no)"
if [[ -n "$TRACKED_CHANGES" ]]; then
  warn "检测到已跟踪文件存在未提交修改，已停止自动更新，避免覆盖你的本地改动："
  git status --short
  exit 1
fi

info "项目目录: $PROJECT_DIR"
info "准备同步 $GIT_REMOTE/$GIT_BRANCH"

run git fetch "$GIT_REMOTE" --prune --tags

REMOTE_REF="refs/remotes/$GIT_REMOTE/$GIT_BRANCH"
if ! git show-ref --verify --quiet "$REMOTE_REF"; then
  error "远程分支不存在: $GIT_REMOTE/$GIT_BRANCH"
  exit 1
fi

LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse "$GIT_REMOTE/$GIT_BRANCH")"
info "更新前本地提交: $LOCAL_SHA"
info "远程目标提交:   $REMOTE_SHA"

run git pull --ff-only "$GIT_REMOTE" "$GIT_BRANCH"

if [[ ! -f config.yaml && -f config.yaml.example ]]; then
  warn "未检测到 config.yaml，已从示例文件复制一份，请按需修改配置"
  run cp config.yaml.example config.yaml
fi

COMPOSE_CMD=""
if COMPOSE_CMD="$(choose_compose)"; then
  info "检测到 Docker Compose，开始容器重部署"
  # shellcheck disable=SC2206
  COMPOSE_ARR=($COMPOSE_CMD)
  run "${COMPOSE_ARR[@]}" up -d --build --remove-orphans
  run "${COMPOSE_ARR[@]}" ps
  info "Docker 重部署完成"
  exit 0
fi

need_cmd node
need_cmd npm

if [[ -f package-lock.json ]]; then
  run npm ci
else
  run npm install
fi

run npm run build

if ! command -v pm2 >/dev/null 2>&1; then
  info "未检测到 PM2，正在安装"
  run npm install -g pm2
fi

if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  info "重启现有 PM2 服务: $APP_NAME"
  run env NODE_ENV=production pm2 restart "$APP_NAME" --update-env
else
  info "未发现现有 PM2 服务，开始创建: $APP_NAME"
  run env NODE_ENV=production pm2 start dist/index.js --name "$APP_NAME"
fi

run pm2 save
run pm2 status "$APP_NAME"
info "PM2 重部署完成"
