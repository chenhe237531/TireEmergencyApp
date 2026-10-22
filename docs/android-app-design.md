# 小蚂蚁轮胎救援 · 司机端 Android App 设计

> 状态：待确认（确认后进入实施）
> 关联文档：[GLOSSARY.md](../GLOSSARY.md) · [ADR-0001](adr/0001-reuse-uniapp-for-android.md) · [ADR-0002](adr/0002-phone-first-driver-identity.md) · [ADR-0003](adr/0003-android-delivery-repo-boundary.md) · [ADR-0004](adr/0004-android-v1-scope.md)

## 1. 目标与边界

为货车、轿车司机提供一个安卓客户端，完成与微信小程序相同的业务闭环：查看附近门店、一键上报故障救援、提交救援咨询、查看记录与进度。

**v1 包含**：手机号 + 短信验证码登录、附近门店（按距离）、故障找救援、救援咨询、我的记录与取消、个人资料与身份、FAQ、关于、联系客服、分享海报、地图选点、客服一键拨号、草稿与弱网重试、应用内更新检查、账号注销。

**v1 不包含**：厂商推送、在线支付、门店端、门店分布地图、iOS 版本。平台只做信息对接，费用由司机与门店线下确认。

## 2. 现状与约束

- 服务端：`TireEmergencyService/apps/server`，NestJS 11 + Prisma 6，接口前缀 `/api/v1`，统一响应 `{ code, message, data }`。
- 司机端 UI：`TireEmergencyService/apps/miniapp`，uni-app（unibest 4.4 + Vue3 + TS），已支持 `mp-weixin` 与 `h5`。
- 司机身份：`Driver.openid`（微信）唯一，`phone` 可空且不唯一；安卓无法使用微信 `code2Session`。
- 工单：`RescueAlert` 要求司机已绑定手机号；2 分钟内同司机已有进行中工单时返回 `40900`。
- 门店脱敏：接口不下发门店电话、详细地址、联系人，仅名称、分类、主营、评分、模糊区域与距离。
- 部署：容器可多实例（MySQL），因此验证码与频控不能放内存。

## 3. 总体架构

### 3.1 代码与交付边界

```
TireEmergencyService/                 TireEmergencyApp/
├─ apps/miniapp   ← 唯一 UI 源码      ├─ docs/           设计、ADR、发布清单
│  ├─ mp-weixin / h5                 ├─ android/        离线打包工程（上架阶段）
│  └─ app-plus    ← 新增构建目标      ├─ release/        版本清单、APK 归档、签名配置（证书不入库）
├─ apps/server    ← 增量改造          ├─ scripts/        构建、发布、版本清单生成
└─ apps/admin     ← 司机状态兼容      └─ GLOSSARY.md
```

- 安卓专属差异用条件编译（`#ifdef APP-PLUS`）落在同一套页面里，不复制工程。
- `manifest.json` 的 `app-plus` 配置随 UI 源码维护；本仓负责打包工程、签名与发布流程（见 ADR-0003）。
- 每次发版在 `release/` 记录：版本号、versionCode、依赖的 service 仓 commit、签名指纹、APK 校验和。

### 3.2 客户端分层

保持 unibest 现有结构，只增加安卓分支：

| 层 | 位置 | 安卓端变化 |
|---|---|---|
| 页面 | `src/pages`、`src/pkg-*` | 登录页加短信登录分支；新增注销入口 |
| 请求 | `src/tire/request.ts` | 增加 `VITE_APP_SERVER_BASEURL` 分支 |
| 状态 | `src/tire/store.ts` | token 与司机资料复用；增加注销后清理 |
| 平台能力 | 新增 `src/tire/app/` | 定位、地图选点、拨号、本地通知、版本检查、草稿 |
| 组件 | `src/components/tire` | 复用，不新增设计语言 |

### 3.3 环境与接口地址

| 环境 | 用途 | API 地址 |
|---|---|---|
| 本地 | 开发联调 | `http://<局域网IP>:3100/api/v1` |
| 预发 | 内测 APK | `https://<staging域名>/api/v1` |
| 生产 | 应用商店 / 官网 | `https://<生产域名>/api/v1` |

- 新增 `VITE_APP_SERVER_BASEURL`，仅 `APP-PLUS` 生效；H5 继续走相对路径，小程序继续走 `VITE_MP_SERVER_BASEURL`。
- 生产必须 HTTPS；安卓不校验微信合法域名，但域名需完成 ICP 备案。
- 图片上传复用 `${BASE}/app/upload`（multipart，字段 `file`，上限 5MB）。

## 4. 身份与登录

### 4.1 登录流程

```
输入手机号 → POST /app/auth/sms/send
          → 输入 6 位验证码 → POST /app/auth/sms/login
          → 返回 token + 司机资料（isNew / merged）
          → role 为空则引导选择身份（私人车主 / 车队 / 服务门店）
```

- 验证码：6 位数字，5 分钟有效，最多尝试 5 次；同一手机号 60 秒可重发、每天 5 条；同一 IP 每小时 10 条。
- 手机号不存在时自动创建 `Driver`（`openid` 为空），不返回“该手机号未注册”。
- 令牌 `aud=app`，30 天有效；`40001` 清 token 回登录页；`40003` 提示封禁并清 token。
- 微信小程序与 H5 登录链路保持不变。

### 4.2 账号合并

规则见 [ADR-0002](adr/0002-phone-first-driver-identity.md#L21-L29)，实现落在 `auth/phone` 与 `auth/sms/login`：

1. 先按手机号查 `Driver`；存在则登录，不存在则创建。
2. 微信绑定手机号时若手机号已属于另一 `Driver`，在事务内合并。
3. 保留创建时间更早的账号为主账号，迁移 `RescueAlert`、`ConsultRequest`、`ViewLog`。
4. 主账号 `openid` 为空且被合并账号有 `openid` 时，接管该 `openid`；被合并账号清空 `openid`、`phone`，`status='merged'`，写 `mergedIntoId` / `mergedAt`。
5. 任一账号被封禁，合并后保持封禁。
6. 每次合并写 `DriverMergeLog`，后台可追溯。

### 4.3 账号注销

- 入口：我的 → 账号与安全 → 注销账号；需二次短信验证（`scene=delete`）。
- 处理：司机资料匿名化（手机号、openid、昵称、头像清空，`status='deleted'`）；工单保留状态、时间、门店用于运营统计，但车牌、坐标、位置描述、故障描述、联系人、电话、现场图片全部清空；浏览痕迹与本人上传文件删除。
- 注销后同一手机号可重新注册，历史工单不关联到新账号。

## 5. 页面与接口映射

| 页面 / 能力 | 现有接口 | 安卓端处理 |
|---|---|---|
| 首页 · 门店列表 | `GET /app/stores?category&lat&lng` | 复用；定位成功传坐标，失败仅按默认排序 |
| 首页 · 浏览埋点 | `POST /app/view-log` | 复用 |
| 首页 · 故障找救援 | `POST /app/rescue-alert` | 增加 `clientRequestId`；草稿与重试 |
| 首页 · 定位 | `uni.getLocation` | 改为高德定位 + 地图选点 |
| 救援咨询 | `POST /app/consult`、`POST /app/upload` | 增加 `clientRequestId`；图片压缩与重试 |
| 登录 | `POST /app/auth/login` | 安卓改为 `sms/send` + `sms/login` |
| 我的 | `GET /app/profile`、`POST /app/auth/phone` | 复用资料；安卓手机号在登录时已确定 |
| 我的记录 | `GET /app/rescue-alerts`、`GET /app/consults` | 复用；前台轮询 + 本地通知 |
| 取消救援 | `PATCH /app/rescue-alerts/:id/cancel` | 复用 |
| 完善身份 | `PATCH /app/profile` | 复用 |
| 联系客服 | `GET /app/settings` | 增加一键拨号 |
| FAQ / 关于 | `GET /app/faqs`、`GET /app/settings` | 复用；关于页展示备案号与注销入口 |
| 分享海报 | `GET /app/settings` | 安卓改为保存相册 + 系统分享 |
| 账号注销 | 新增 `DELETE /app/account` | 新增页面或弹窗 |
| 版本更新 | 新增 `/downloads/android.json` | 启动与每 24 小时检查 |

## 6. 服务端改造

### 6.1 数据模型

| 模型 | 变更 | 说明 |
|---|---|---|
| `Driver` | `phone String? @unique` | 空字符串迁移为 `NULL`，避免多个未绑定司机冲突 |
| `Driver` | `mergedIntoId Int?`、`mergedAt DateTime?`、`deletedAt DateTime?` | `status` 增加 `merged` / `deleted` |
| `RescueAlert` | `clientRequestId String?`，`@@unique([driverId, clientRequestId])` | 幂等键；`NULL` 不参与唯一约束 |
| `ConsultRequest` | `clientRequestId String?`，`@@unique([driverId, clientRequestId])` | 游客 `driverId` 为空时不去重 |
| `SmsCode` | 新表 | `phone`、`scene`、`codeHash`、`ip`、`expiresAt`、`attempts`、`usedAt`、`createdAt` |
| `DriverMergeLog` | 新表 | `fromDriverId`、`toDriverId`、`phone`、`reason`、`createdAt` |

约束：所有新增长文本字段按现有约定加 `// mysql: @db.Text` 标记；`SmsCode.codeHash` 用 `HMAC-SHA256(SMS_CODE_SECRET, code)`，不存明文。

### 6.2 新增 / 调整接口

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/app/auth/sms/send` | 公开 | 入参 `{ phone, scene: 'login' \| 'delete' }`，返回 `{ retryAfter }`；不泄露手机号是否注册 |
| POST | `/app/auth/sms/login` | 公开 | 入参 `{ phone, code, nickname?, avatarUrl? }`，返回 `{ accessToken, user, isNew, merged }` |
| DELETE | `/app/account` | app | 入参 `{ code }`，完成注销并匿名化 |
| POST | `/app/rescue-alert` | app | 请求体增加 `clientRequestId`；命中则返回原工单，不再报 `40900` |
| POST | `/app/consult` | 可选 | 请求体增加 `clientRequestId` |
| GET | `/app/settings` | 可选 | 增加 `smsEnabled` |
| GET | `/downloads/android.json` | 公开 | 静态版本清单：`{ versionCode, versionName, url, notes, minVersionCode }` |

`POST /app/auth/phone` 保留，增加“手机号已属于另一账号则合并”的分支；小程序行为不变。

### 6.3 错误码

沿用现有码表，新增：

| 码 | 含义 |
|---|---|
| `40021` | 验证码错误或已过期 |
| `42900` | 请求过于频繁（短信 / 登录尝试） |

### 6.4 安全与频控

- 发送验证码：校验 `^1[3-9]\d{9}$`；先删过期记录；按手机号与 IP 计数；日志不打印明文验证码。
- 校验验证码：`timingSafeEqual` 比较哈希；失败累加 `attempts`，达到 5 次即作废；成功后 `usedAt` 置位，禁止复用。
- 登录成功与失败都记录 `lastLoginAt`；被封禁账号直接返回 `40003`。
- 本地开发可设 `ALLOW_DEMO_SMS_CODE=1` 使用固定码，生产必须为 `0`；与 `ALLOW_DEMO_LOGIN` 同样受 `NODE_ENV` 保护。
- 生产环境必须配置 `SMS_CODE_SECRET`，缺失时启动失败（与 `JWT_SECRET` 同策略）。

### 6.5 数据迁移

1. 备份数据库（SQLite 文件 / MySQL 全量）。
2. 找出重复手机号，按 ADR-0002 规则合并或置空。
3. `phone` 空字符串统一改为 `NULL`。
4. 执行 `db:push` 增加唯一约束与新表；MySQL 版 schema 由 `prisma/db.js` 生成。
5. 写一条迁移脚本记录合并结果，保留 `DriverMergeLog` 供客服核对。
6. 回归：微信登录、绑定手机号、救援提交、咨询提交、后台司机列表。

## 7. 客户端关键设计

### 7.1 平台条件编译

| 能力 | APP-PLUS | MP-WEIXIN | H5 |
|---|---|---|---|
| 登录 | 短信验证码 | `uni.login` + `code2Session` | 演示登录（仅开发） |
| 定位 | 高德定位 + `uni.chooseLocation` | 系统定位 | 浏览器定位 / 手填 |
| 分享 | 保存海报 + 系统分享 | 小程序分享 | 复制链接 |
| 更新 | 应用内检查 APK | 微信更新 | 无 |
| 通知 | 前台轮询 + 本地通知 | 订阅消息（后续） | 前台轮询 |

### 7.2 定位与地图选点

- 使用 `uni.getLocation({ type: 'gcj02', provider: 'amap' })` 获取坐标，`uni.chooseLocation` 打开地图选点；返回的名称与地址拼接为 `locationDesc`（截断 200 字）。
- 拒绝定位权限时：不阻塞提交，展示“手动填写位置”输入框，并给出去系统设置的引导。
- 首次启动必须先弹隐私提示，用户同意后再初始化地图 SDK；高德 Key 绑定 Android 包名与签名 SHA1。
- 坐标统一使用 GCJ-02，避免与后端 `haversineKm` 距离计算出现偏移。

### 7.3 草稿、重试与幂等

- 救援与咨询表单每次变更写入本地草稿（`uni.setStorageSync`），页面进入时恢复。
- 首次提交生成 UUID 作为 `clientRequestId`，与草稿一起持久化；所有重试复用同一个值。
- 提交成功或用户主动清空后删除草稿。
- 重试策略：网络错误按 1s / 3s / 9s 退避，最多 3 次；业务错误（参数、封禁）不重试。
- 同一 `clientRequestId` 的重试由服务端返回原工单，不会重复建单。

### 7.4 图片上传

- 选择图片后先 `uni.compressImage` 压缩到 2MB 以内，再逐张上传；最多 9 张。
- 上传失败的图片保留本地副本（`uni.saveFile`）并写入待上传队列，下次进入页面或提交时重试。
- 文字提交不等待所有图片成功；失败图片在记录详情中标记“未上传”。

### 7.5 状态通知

- 进入“我的记录”与首页时立即拉取，之后每 30 秒轮询；页面隐藏时停止。
- 状态变化时：前台 `uni.showToast`；App 在后台但进程存活时用 `plus.push.createMessage` 发本地通知。
- App 被杀死后不会收到通知（v1 明确不支持）；业务上由客服电话联系司机，不依赖通知。

### 7.6 版本更新

- 启动时与每 24 小时请求 `/downloads/android.json`，比较本地 `versionCode`。
- `versionCode < minVersionCode`：阻塞式弹窗，仅允许下载更新。
- 否则展示可关闭的更新提示；下载完成后调用 `plus.runtime.install`，需申请“安装未知应用”权限。
- 发布脚本自动生成 `android.json` 并归档 APK；版本清单与 APK 同域托管。

### 7.7 权限与隐私

| 权限 | 触发时机 | 拒绝后的行为 |
|---|---|---|
| 定位 | 首页首次加载 / 地图选点 | 手填位置，距离不展示 |
| 相机 / 相册 | 上传现场照片 | 允许仅文字提交 |
| 通知 | 首次后台通知前 | 仅前台提示 |
| 安装未知应用 | 应用内更新 | 引导到系统设置或浏览器下载 |

- 首次启动展示隐私弹窗，链接到后台配置的《用户协议》《隐私政策》；未同意不初始化任何第三方 SDK。
- 隐私政策需列明：高德地图 SDK、DCloud 运行环境、短信服务商、收集的手机号/位置/照片用途。
- 权限被拒后不循环弹窗，统一引导到系统设置。

### 7.8 分享

- 微信小程序原有的分享链路（`tire/share.ts`、微信分享卡片）在安卓不可用。
- 安卓端保留海报生成与保存相册，增加系统分享面板分享 H5 链接；分享文案取 `/app/settings.shareTitle`。

## 8. 交付与发布

### 8.1 打包路径

1. **内测阶段**：HBuilderX 云打包，使用 DCloud AppID 与测试证书，输出内测 APK。
2. **上架阶段**：`TireEmergencyApp/android` 建 DCloud 离线 SDK 工程，接入正式签名、高德原生 Key、后续推送与崩溃 SDK，构建可 CI 的 release APK。
3. 每次打包执行 `pnpm --filter tire-miniapp build:app`，确保使用固定的 service 仓 commit。

### 8.2 签名与版本

- 包名（暂定）：`com.xiaomayi.tire`；发布前必须替换为公司自有域名倒序，包名一经上架不可更改。
- 应用名：小蚂蚁轮胎救援。
- `versionCode` 单调递增，`versionName` 用语义化版本；两者写入 `manifest.json` 并由发布脚本校验。
- keystore 独立生成，离线备份，不入库；丢失将无法覆盖安装。

### 8.3 验收矩阵

| 类别 | 用例 |
|---|---|
| 登录 | 新手机号注册、已注册登录、验证码错误/过期/频控、封禁账号被拒 |
| 合并 | 微信老账号 + 安卓同手机号、历史工单保留、封禁状态保持、审计日志 |
| 首页 | 授权定位、拒绝定位手填、分类筛选、距离排序、无门店电话/地址泄露 |
| 救援 | 重复提交同幂等键、2 分钟连点、弱网重试、杀进程恢复草稿、取消工单 |
| 咨询 | 9 张图上限、5MB 限制、上传失败重试、游客提交、登录提交 |
| 我的 | 资料修改、身份选择、注销短信校验、注销后数据匿名化 |
| 通知 | 前台轮询、后台存活本地通知、杀进程无通知（预期） |
| 更新 | 非强制更新、强制更新、下载安装、安装权限拒绝 |
| 兼容 | Android 7 / 10 / 14、2GB 低端机、armeabi-v7a 与 arm64-v8a |
| 安全 | token 过期、封禁即时失效、验证码不落日志、门店信息不泄露 |

### 8.4 发布检查清单

- [ ] 包名、DCloud AppID、高德 Key（绑定包名 + SHA1）确认
- [ ] 短信签名与模板审核通过，`ALLOW_DEMO_SMS_CODE=0`
- [ ] 生产域名 HTTPS + ICP 备案完成
- [ ] 隐私政策包含第三方 SDK 清单与权限说明；首次启动隐私弹窗可用
- [ ] 账号注销入口可用，匿名化结果已验证
- [ ] App 备案号在关于页展示
- [ ] 软著 / 开发者资质 / 应用商店账号就绪
- [ ] release keystore 已备份，versionCode 递增
- [ ] 验收矩阵全部通过，上一版 APK 已归档可回滚
- [ ] 预发环境完成内测，客服已知晓新版流程

## 9. 里程碑

| 阶段 | 交付 | 退出标准 |
|---|---|---|
| M0 服务端基线 | 手机号登录、短信、合并、幂等、注销、版本清单 | 接口在预发环境通过 Postman / 脚本验证，小程序回归通过 |
| M1 App 壳与登录 | app-plus 构建、环境配置、短信登录、隐私弹窗 | 真机可登录并保持会话 |
| M2 功能对等 | 首页、救援、咨询、我的、记录、FAQ、关于、分享 | 与小程序逐项对照通过 |
| M3 安卓增强 | 地图选点、一键拨号、草稿重试、本地通知、应用内更新 | 弱网与权限场景通过 |
| M4 合规与内测 | 注销、权限说明、备案物料、测试矩阵 | 内测司机无阻断问题 |
| M5 上架 | 离线打包工程、正式签名、商店提交 | 至少一个渠道审核通过 |

## 10. 风险与待确认输入

**风险**

- 短信签名/模板与 App 备案有审核周期，晚于开发完成会阻塞真实用户验证。
- 账号合并涉及历史数据，重复手机号处理不当会丢工单或错误合并。
- `targetSdk 35` 需要较新的 HBuilderX / DCloud SDK；旧版本云打包可能不满足商店要求。
- 云打包与离线打包能力不一致（原生插件、推送、崩溃 SDK），迁移时需重新验证。
- 无后台推送，司机杀掉 App 后收不到状态变化；业务上依赖客服电话，需在客服话术中明确。
- 自有渠道 APK 安装会被部分厂商安全策略拦截，需要给司机提供安装指引。

**待确认输入（发布前必须闭环，不阻塞开发）**

1. 公司自有域名 → 最终包名。
2. 短信服务商账号（默认阿里云）与签名/模板主体。
3. 生产 API 域名与 ICP 备案。
4. 高德开放平台账号与 Key。
5. DCloud 账号与正式 AppID。
6. 应用商店开发者账号、软著或开发者资质。
7. 品牌图标、启动图、应用截图与商店文案。
