# 小蚂蚁轮胎救援 · DCloud 离线打包工程

> ADR-0003：司机端 UI 源码唯一维护在 service 仓 `TireEmergencyService/apps/miniapp`，本目录只承载安卓离线打包壳工程、签名与发布流程。`manifest.json` 的 `app-plus` 配置随 UI 源码维护，不在本仓复制，避免两端分叉。

## 现状（骨架）

DCloud 离线打包 SDK 是数百 MB 的授权产物，**不入库**（`app/libs/` 已被根 `.gitignore` 忽略，CI 由 `scripts/check-artifacts.sh` 兜底拦截）。当前交付物是可填充的工程骨架：Gradle 结构、签名配置模板、应用名与图标的资源占位。**放入 SDK 与 keystore 之前无法产出真实 APK。**

## 接入 DCloud 离线 SDK

1. 从 [DCloud App 离线打包 SDK](https://nativesupport.dcloud.net.cn/AppDocs/download/android.html) 下载与 HBuilderX 版本匹配的 SDK。
2. 将 SDK 的 aar 放入 `app/libs/`（不入库）。
3. 构建 uni-app 前端资源：在 service 仓 checkout 本次发版固定的 commit，执行 `pnpm --filter tire-miniapp build:app`，把产物放入 `app/src/main/assets/apps/__UNI__TIRE001/www/`。
4. 按 SDK 官方文档确认 `build.gradle` 的 AGP / Gradle 版本、`compileSdk` / `targetSdk` 是否需要调整。
5. 复制 `signing-template.properties` 为 `android/signing.properties` 并填入正式签名（见「签名与 keystore 安全」）。
6. 构建 release APK：`gradle assembleRelease`（本地需安装 Android SDK；首次可执行 `gradle wrapper --gradle-version 8.7` 生成 wrapper，`gradle-wrapper.jar` 不入库）。

## 包名与应用名

- 包名暂定 `com.xiaomayi.tire`，**上架前必须替换为公司自有域名倒序**，包名一经上架不可更改（设计文档 §8.2）。替换位置：`app/build.gradle` 的 `namespace` / `applicationId`。
- 高德 Key 绑定「包名 + 签名 SHA1」：替换包名或签名后必须在高德开放平台同步更换 Key（`app/src/main/AndroidManifest.xml` 中 `com.amap.api.v2.KEY`）。
- 应用名「小蚂蚁轮胎救援」在 `app/src/main/res/values/strings.xml`。

## 图标占位

`app/src/main/res/mipmap-*/ic_launcher.png` 尚未提供（仓库不收录二进制图标），上架前放入品牌图标：

| 目录 | 尺寸 |
|---|---|
| `mipmap-mdpi` | 48×48 |
| `mipmap-hdpi` | 72×72 |
| `mipmap-xhdpi` | 96×96 |
| `mipmap-xxhdpi` | 144×144 |
| `mipmap-xxxhdpi` | 192×192 |

## 版本管理

- `android/version.properties` 保存待构建的 `VERSION_CODE` / `VERSION_NAME`，发版时与 service 仓 `apps/miniapp/src/manifest.json` 保持一致。
- 发布流程与校验见 `../release/README.md`：`versionCode` 必须大于 `release/records/` 中的历史最大值，由 `../scripts/release.mjs` 在本地与 CI 共同校验。

## 签名与 keystore 安全（设计文档 §8.2）

- keystore 独立生成并离线备份，**绝不入库**（`.gitignore` 覆盖 `*.jks` / `*.keystore`，CI 有 `git ls-files` 断言兜底）。
- 丢失后果：无法用原签名覆盖安装或发布商店更新，只能更换包名重新上架；因此必须离线备份（如密码管理器与离线存储介质双份，并记录各字段明文）。
- 构建后用 `keytool -list -printcert -jarfile app-release.apk` 取得 SHA1 / SHA256 指纹，录入 `release/records/` 对应版本记录，与高德 Key 绑定信息核对一致。
