# 发布记录模板

> 用 `node scripts/release.mjs new --version-name <版本> --service-commit <commit>` 生成骨架（自动计算 `versionCode` 与日期），构建 APK 后按下表补齐。字段与 `release/records/v<versionName>.json` 一一对应。

## 字段说明

| 字段 | 必填时机 | 说明 |
|---|---|---|
| `versionName` | 创建时 | 语义化版本，如 `1.2.0` |
| `versionCode` | 创建时 | 正整数，单调递增，必须大于历史最大值；生成骨架时自动取「历史最大 + 1」 |
| `date` | 创建时 | 发布日期 `YYYY-MM-DD` |
| `serviceCommit` | 创建时 | 本次打包引用的 service 仓（TireEmergencyService）commit |
| `signingSha1` | 构建后 | 签名证书 SHA1 指纹（`keytool -list -printcert -jarfile`），需与高德 Key 绑定信息一致 |
| `signingSha256` | 构建后 | 签名证书 SHA256 指纹 |
| `apkSha256` | 构建后 | APK SHA256 校验和（`shasum -a 256`），供下载方复核 |
| `downloadUrl` | 构建后 | APK 托管地址（与 `android.json` 版本清单同域） |
| `notes` | 建议 | 变更摘要 |

## JSON 骨架

```json
{
  "versionName": "1.0.0",
  "versionCode": 100,
  "date": "2026-10-23",
  "serviceCommit": "<service仓commit>",
  "signingSha1": "",
  "signingSha256": "",
  "apkSha256": "",
  "downloadUrl": "",
  "notes": ""
}
```
