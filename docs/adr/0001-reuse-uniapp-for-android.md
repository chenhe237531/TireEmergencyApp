# 司机端 Android App 复用现有 uni-app 代码库

## Status

accepted

## Context

司机端的门店列表、故障找救援、救援咨询、我的记录等页面已在 `TireEmergencyService/apps/miniapp` 以 uni-app（unibest + Vue3 + TS）实现并上线微信小程序与 H5。安卓端需要相同的业务闭环，差异集中在身份登录、定位、通知与打包上架。

## Decision

安卓端不重写 UI，基于同一套 uni-app 代码新增 `app-plus` 构建目标；仅对平台相关能力（登录、定位、推送、上传、分享）做条件编译。Flutter 与 Kotlin 原生方案因需重写全部页面且长期维护第二套前端而被否决。

## Consequences

- 打包依赖 HBuilderX 云打包或 DCloud 离线 SDK，`manifest.json` 的 `targetSdkVersion`（当前 30）需升级后再上架。
- 安卓端不能复用微信 `code2Session` 登录，登录链路必须单独设计（见 ADR-0002）。
- 微信小程序与安卓端共用页面代码，任何 UI 改动需同时回归两端。
