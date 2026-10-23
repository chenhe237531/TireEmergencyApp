# 应用内更新版本清单（/downloads/android.json）

司机端 Android App 的应用内更新（设计文档 7.6）依赖一份静态版本清单。清单由发布流程生成（见下文「生成与发布流程」），与 APK 同域托管，App 启动时与每 24 小时拉取一次，与本地 `versionCode` 比较后决定是否提示更新。

## Schema

清单是一个纯 JSON 文件（无 `{ code, message, data }` 包裹），部署在 APK 同域名下的 `/downloads/android.json`，`GET` 公开访问：

```json
{
  "versionCode": 101,
  "versionName": "1.0.1",
  "url": "/downloads/tire-1.0.1-101.apk",
  "notes": "修复部分机型定位失败的问题",
  "minVersionCode": 100
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `versionCode` | int | 是 | 最新 APK 的构建号，单调递增，与 `manifest.json` 的 `versionCode` 一致；必须为正整数 |
| `versionName` | string | 是 | 最新版本名（语义化版本），与 `manifest.json` 的 `versionName` 一致 |
| `url` | string | 是 | APK 下载地址。推荐写与清单同域的根相对路径（如 `/downloads/xxx.apk`），App 端按清单域名补全；也允许绝对地址，但必须是 HTTPS |
| `notes` | string | 否 | 更新说明，展示在更新弹窗正文中；为空时 App 使用兜底文案 |
| `minVersionCode` | int | 是 | 最低支持构建号：本地 `versionCode < minVersionCode` 且清单有新版本时，弹出不可关闭的强制更新；不填场景请显式写 `0`（全部走可选更新）。必须满足 `0 <= minVersionCode <= versionCode` |

字段缺失、类型不符或取值非法时，App 端按「无更新」处理，静默失败，不弹任何提示。

## 托管要求

- **同域**：清单与 APK 必须部署在同一个域名下（清单在 `/downloads/android.json`，APK 建议在 `/downloads/tire-<versionName>-<versionCode>.apk`）。`url` 使用根相对路径时，客户端会以清单的实际访问域名补全，天然满足同域约束。
- **HTTPS**：生产环境清单与 APK 的下载地址必须是 HTTPS；安卓不校验微信合法域名，但域名需完成 ICP 备案。
- **公开访问**：清单无需鉴权，`GET /downloads/android.json` 直接返回 JSON。
- **不缓存旧值**：建议服务端对该路径禁用长缓存（或设置较短 `max-age`），保证司机在 24 小时窗口内能拿到最新清单。

## 生成与发布流程

清单由 `scripts/gen-update-manifest` 生成，不要手写：

```bash
scripts/gen-update-manifest \
  --version-code 101 \
  --version-name 1.0.1 \
  --apk release/tire-1.0.1-101.apk \
  --service-commit <service 仓打包所用 commit> \
  [--min-version-code 100] \
  [--notes "修复部分机型定位失败的问题"] \
  [--url /downloads/tire-1.0.1-101.apk] \
  [--out release/android.json]
```

- APK 的 SHA256 校验和会计算后追加到 `release/versions.tsv` 发布记录（时间、versionCode、versionName、minVersionCode、service commit、SHA256、APK 文件名、url），与设计文档 3.1「每次发版在 release/ 记录」一致。
- `--self-test` 运行脚本自测（合法参数生成成功 + 缺字段/非法参数拒绝），可用于 CI。
- 本仓不做真实托管部署：`android.json` 生成后由发布流程上传到 APK 同域的 `/downloads/` 路径（如对象存储 / CDN / 服务端静态目录），上传后以 `curl https://<域名>/downloads/android.json` 验证字段与 `release/versions.tsv` 一致。

## 客户端行为（对照）

详见 service 仓 `apps/miniapp/src/tire/app/update.ts`（`#ifdef APP-PLUS` 条件编译，小程序 / H5 不受影响）：

- 启动与回到前台时检查，24 小时内只拉取一次；拉取失败静默，不打扰司机。
- `versionCode < minVersionCode` 且有新版本：不可关闭的强制更新弹窗，仅允许下载更新。
- 其余新版本：可关闭的更新提示。
- 下载完成后调用 `plus.runtime.install` 拉起安装；安装失败（含「安装未知应用」权限被拒）时转浏览器下载并引导去系统设置开启权限。
