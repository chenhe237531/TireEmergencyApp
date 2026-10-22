# 小程序代码留在 service 仓，本仓只承载安卓交付流水线

## Status

accepted

## Context

司机端 UI 已以 uni-app 实现于 `TireEmergencyService/apps/miniapp`，同时服务微信小程序与 H5。安卓端决定复用该代码，但又需要独立于服务端发版。若在本仓复制一份工程，两端会迅速分叉；若整体迁移，则 service 仓的 H5 构建与部署脚本都要跨仓依赖。

## Decision

`TireEmergencyService/apps/miniapp` 继续作为司机端 UI 的唯一源码，新增 `app-plus` 构建目标；`manifest.json` 的 `app-plus` 配置随 UI 源码维护。`TireEmergencyApp` 承载安卓交付物：离线打包工程（上架阶段）、原生插件配置、签名与 CI、上架物料与发布记录。每次打包固定引用 service 仓的 commit 与构建产物。

## Consequences

- UI 与业务页面改动仍需在 service 仓提交并回归微信小程序、H5、安卓三端。
- 安卓发版节奏独立于服务端部署，但每个 APK 必须记录所依赖的 service 仓 commit。
- 不产生代码分叉；安卓专属能力通过条件编译与原生插件实现。
