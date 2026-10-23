# 发布记录规范

> issue #11 / ADR-0003：每个 APK 必须记录所依赖的 service 仓 commit、版本号、versionCode、签名指纹与校验和。APK 与 keystore 本身不入库，本目录只存机器可校验的记录。

## 目录结构

```
release/
├── README.md      本规范
├── TEMPLATE.md    发布记录字段模板
└── records/       每个正式版本一份 JSON 记录，命名 v<versionName>.json（如 v1.0.0.json）
```

## 发布流程

1. 在 service 仓 checkout 本次发版固定的 commit，执行 `pnpm --filter tire-miniapp build:app`。
2. 在 service 仓递增 `apps/miniapp/src/manifest.json` 的 `versionCode` / `versionName`。
3. 发版门槛校验（候选 versionCode 必须大于历史最大值）：
   `node scripts/release.mjs check-version --manifest <service仓>/apps/miniapp/src/manifest.json`
4. 生成记录骨架（`--version-code` 省略时自动取「历史最大 + 1」）：
   `node scripts/release.mjs new --version-name 1.0.1 --service-commit <service仓commit>`
5. 按 `android/README.md` 完成 SDK 接入与签名，`gradle assembleRelease` 产出 APK。
6. 补齐记录中的指纹与校验和：
   - `apkSha256`：`shasum -a 256 app-release.apk`
   - `signingSha1` / `signingSha256`：`keytool -list -printcert -jarfile app-release.apk`
   - `downloadUrl`：APK 托管地址（与版本清单 `android.json` 同域，见设计文档 §7.6）
7. `node scripts/release.mjs validate` 全绿后提交记录。
8. APK 上传托管；确认 keystore 已离线备份（见 `android/README.md`）。

## 校验规则（`scripts/release.mjs validate`，本地与 CI 共用）

- 记录 schema：必填字段 `versionName` / `versionCode` / `date` / `serviceCommit`；`versionName` 必须是语义化版本；`versionCode` 必须是正整数；指纹与校验和必须为对应位数的十六进制；`downloadUrl` 必须以 http(s) 开头。
- 唯一性：`versionCode`、`versionName` 不得与历史记录重复。
- 单调递增：发布日期更晚的记录，其 `versionCode` 必须大于所有更早记录。
- 一致性：文件名必须为 `v<versionName>.json`；`android/version.properties` 的 `VERSION_CODE` 不得低于历史最大 `versionCode`。
- 跨仓（可选参数）：`--manifest <path>` 校验 service 仓 `manifest.json` 的 `versionCode` 必须大于历史最大值，用于发版前的门槛检查。

## 安全红线

- 禁止提交：`*.apk`、`*.keystore`、`*.jks`、`signing.properties`（根 `.gitignore` 已忽略，CI 由 `scripts/check-artifacts.sh` 用 `git ls-files` 断言兜底）。
- keystore 生成命令与丢失后果见 `android/README.md`。
