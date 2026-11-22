# 三云Buddy 品牌迁移记录

记录时间：2026-11-22。项目显示名称由 `WorkDSH` 改为 `三云Buddy`。新发行包文件名使用 ASCII 前缀 `SanyunBuddy-`。这次改的是本仓库的桌面壳、Web/Profile、分发配置和文档，没有修改官方 DeepSeek Harness 文件，也没有改变上游版本锁。

## 两种升级分别看什么

- **三云Buddy 自己发新版**：产品版本来自[桌面清单](../apps/desktop/package.json)。从本仓库重新打包，继续使用三云Buddy 的品牌配置。本次保留旧安装标识和数据路径，是为了让新版尽量沿用旧版安装和数据，不是为了锁住 Harness 版本。
- **升级 DeepSeek Harness**：上游版本和平台二进制来源由[上游锁定清单](../upstream.json)管理。按[仓库升级规则](../AGENTS.md#current-authorized-npm-migration)对齐 Desktop、Web 和自有插件使用的官方包；不需要把 `WorkDSH` 的内部标识改掉，也不应该去官方安装包里重新做一遍改名。新上游经本仓库构建和验证后才随新的三云Buddy 发行包发布，已安装的旧版不会因为修改版本锁而自动变化。

## 这次改了哪里

| 范围 | 主要维护位置 | 内容 |
| --- | --- | --- |
| 桌面应用与安装器 | [桌面清单](../apps/desktop/package.json)、[安装器文案](../apps/desktop/build/assistedMessages.yml) | Electron `productName`、Windows 快捷方式、安装器文案及 macOS 应用名称；新 DMG、Setup 和 Portable 文件名使用 `SanyunBuddy-`。 |
| 桌面窗口与入口 | [Electron 主进程](../apps/desktop/src/workdsh-main.ts)、[个人与企业入口](../apps/desktop/src/connection-entry.ts) | `app.setName`、窗口标题、选择使用方式和企业登录页文案。修改用户数据路径不是改名的一部分。 |
| Web 与桌面内嵌界面 | [品牌组件](../packages/bundle/src/client/components/Brand.tsx)、[官方槽位注册](../packages/bundle/src/client/harness/client.ts)、[Web 浏览器探针](../apps/web/scripts/probe-browser.mjs) | 自有 Profile 通过官方 `sidebar.brand.name` 和 `sidebar.brand.mark` 槽位显示品牌；升级后确认槽位仍能注入、品牌没有被上游默认值覆盖。 |
| 发行包及验证 | [桌面发行入口](../scripts/package-desktop-release.mjs)、[Windows 安装包验证](../apps/desktop/scripts/verify-win-installer.ts)、[Windows 便携包验证](../apps/desktop/scripts/verify-win-portable.ts)、[Windows 覆盖安装测试构建](../apps/desktop/scripts/build-windows-nsis-ab.ts)、[macOS 包验证](../apps/desktop/scripts/verify-mac-release.ts)、[Web 发布元数据](../apps/web/scripts/pack-project-release.mjs) | 同步新包文件名、macOS 应用及可执行文件的验证期望、Web 发布清单里的显示名称。Windows 验证会区分安装包名与包内 EXE 名。 |
| 官网、说明文档与插件 | [官网](../apps/web/website/)、[中文 README](../README.zh-CN.md)、[英文 README](../README.md)、[说明文档索引](README.md)、[自有插件](../packages/plugins/)、[共享功能清单](../profiles/shared/workdsh-features.json) | 更新网站标题、品牌资源的可读文本、用户指南、插件展示名称和说明。更新中英文对应文档时同步校验记录。 |

## 为什么还能看到 `WorkDSH` / `workdsh`

| 保留项 | 原因 |
| --- | --- |
| Windows 可执行文件 `WorkDSH.exe`、安装标识 `io.techflag.dsh.ssh` | 这是[桌面清单](../apps/desktop/package.json)的 `win.executableName` 和 `appId`，不是快捷方式显示名称。[NSIS 安装脚本](../apps/desktop/build/installer.nsh)按 EXE 名关闭旧进程，安装器也需要识别已有安装。任务管理器或安装目录仍可能看到旧 EXE 名。这不影响以后换 Harness 版本。 |
| 默认 Electron 用户数据目录中的 `WorkDSH` | [主进程](../apps/desktop/src/workdsh-main.ts)先显式指定旧数据目录，再设置新的显示名；优先保留绝对路径覆盖 `WORKDSH_DESKTOP_USER_DATA`。[命令行入口](../apps/desktop/src/command-cli.ts)也要继续查找同一位置。仅换目录名会让应用无法发现旧目录里的设置和运行状态。 |
| `workdsh://`、`workdsh-*` 包和插件标识、`WORKDSH_*` 环境变量、`workdsh-config.json` | 这些是已有链接、依赖、配置和部署接口。只替换用户可见文案，不全局重命名。[WorkDSH Admin 的职责](../AGENTS.md#personal-and-enterprise-product-boundary)也不因本仓库改名而变化。 |
| 历史 `WorkDSH-…` 安装包及下载地址 | 旧链接仍指向已经发布的旧二进制文件。不能只改链接末尾的文件名，否则无法下载。新版本发布后，再把下载入口指到已上传的新包。 |

## 下次升级前后的检查

1. 在仓库根目录用 `corepack yarn check:dsh-upgrade --version=<精确候选版本>` 核对官方发布和各平台来源。预检不是兼容验收。更新版本锁与 Web/插件依赖时保持精确一致；平台二进制使用其真实版本和校验值，不用另一版本冒充。
2. 在新 Harness 上检查官方品牌槽位和完整会话页面。仅按仓库现有授权复核[共享原生工作台外框适配](../scripts/native-workbench-frame-patch.json)；新版本或未知校验值不能直接套用旧补丁。这个适配和品牌改名是两回事。
3. 在根目录运行 `corepack yarn check`；在 [Web 工作区](../apps/web/)运行 `corepack pnpm build`、`corepack pnpm typecheck` 和 `corepack pnpm check:versions`。这些检查不能代替实际安装与 GUI 验收。
4. 用真实发行包验证全新安装和从上一发布版覆盖安装：检查安装器、快捷方式、应用窗口、登录入口和侧栏名称；重启后确认之前的设置、会话及已安装插件仍可访问。另核对新包件名与下载地址。若要连 Windows EXE 名、安装标识或数据目录一起改，单独设计迁移与回滚，并先验收旧版到新版的升级路径。

本次改名已通过桌面无界面检查、Web 构建与类型检查及双语文档校验。**没有生成或发布新版安装包，尚未做实际覆盖安装和 GUI 验收。**
