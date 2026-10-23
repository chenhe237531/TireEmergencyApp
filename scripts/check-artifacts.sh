#!/usr/bin/env bash
# 断言仓库未跟踪任何 APK / 签名材料 / DCloud SDK 产物（issue #11：二进制与密钥不入库）。
# 本地与 CI 共用；在 git 仓库（含 worktree）内执行。
set -euo pipefail

status=0

forbidden='.*\.(apk|aab|jks|keystore|jceks|p12|pem|cer|crt|aar|so)$|(^|/)signing\.properties$|(^|/)gradle-wrapper\.jar$'

matches=$(git ls-files | grep -Ei "$forbidden" || true)
if [ -n "$matches" ]; then
  echo "[FAIL] 发现禁止入库的构建产物 / 签名材料：" >&2
  echo "$matches" >&2
  status=1
fi

libs=$(git ls-files | grep -E '^android/app/libs/' || true)
if [ -n "$libs" ]; then
  echo "[FAIL] DCloud 离线 SDK 目录 android/app/libs/ 下存在已跟踪文件（SDK 为授权产物，不入库）：" >&2
  echo "$libs" >&2
  status=1
fi

if [ "$status" -eq 0 ]; then
  echo "[OK] 未发现被跟踪的 APK / 签名材料 / SDK 产物"
fi
exit "$status"
