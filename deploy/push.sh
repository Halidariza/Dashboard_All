#!/usr/bin/env bash
# Dijalankan DI LAPTOP. Kirim source + .env ke server lalu jalankan setup.
#   ./deploy/push.sh root@IP-SERVER
set -euo pipefail

TARGET=${1:?pakai: ./deploy/push.sh user@host}
APP_DIR=${APP_DIR:-/opt/dashboard}
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT"
[ -f .env ] || { echo "ERROR: .env tidak ditemukan di $ROOT"; exit 1; }

echo "==> Buat arsip (tanpa node_modules/.git/data/buffer)"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
tar czf "$TMP/app.tgz" \
    --exclude=node_modules --exclude=.git --exclude=data \
    --exclude=mqtt_buffer.csv --exclude='*.log' \
    server.js package.json package-lock.json public gas docs deploy .env .gitignore

echo "==> Siapkan $APP_DIR di $TARGET"
# /opt butuh hak root, jadi buat foldernya lewat sudo lalu serahkan ke user SSH.
ssh "$TARGET" "if [ \$(id -u) -eq 0 ]; then mkdir -p '$APP_DIR'; else sudo mkdir -p '$APP_DIR' && sudo chown \$(id -un):\$(id -gn) '$APP_DIR'; fi"

echo "==> Kirim source"
scp "$TMP/app.tgz" "$TARGET:/tmp/app.tgz"
ssh "$TARGET" "tar xzf /tmp/app.tgz -C '$APP_DIR' && rm -f /tmp/app.tgz"

echo "==> Jalankan setup di server"
ssh -t "$TARGET" "bash '$APP_DIR/deploy/setup-remote.sh'"
