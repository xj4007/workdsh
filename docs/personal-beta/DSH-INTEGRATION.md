# 三云Buddy 与官方 DSH 的接缝清单

> **升级官方 DSH 前必读。** 本文件列出三云Buddy 在产品层对官方 DSH 的全部依赖点、改动位置、失效表现和回归方法。
> 新增或修改下列任何一处，**必须同步更新本文件**；提交时在 PR 描述里注明「本文件已更新」。
>
> 一句话结论：**我们没有修改、fork 或复制官方 DSH 源码**，只使用官方公开接缝（Profile patch、`ctx.llm.registerAdapter`、`ctx.slots`、preload 注入）和我们自己的包。
> 但有 6 处「软依赖」（官方 DOM 结构 / 设置项版本常量），官方改版时不会报错、只会悄悄失效，必须靠第 6 节的检查清单回归。

- 锁定的官方版本：`upstream.json` → DSH `0.2.1-rc.5`（Host/Client/SDK 全部同一版本）
- 对齐检查：`corepack yarn check:desktop-dsh-alignment`、`corepack yarn check:web-dsh-alignment`
- 相关文档：`docs/personal-beta/GATE-managed-provider.md`（托管模型接缝的验证记录）、`docs/personal-beta/HANDOVER.md`、`docs/personal-beta/ACCEPTANCE.md`

---

## 1. 运行时启动接缝：Profile patch 层

官方 `@deepseek-ai/dsh/lib/profile-boot.js` 的 `runProfile()` 接受 `patchFiles`，这是唯一被授权修改运行配置的入口。

| 位置 | 做什么 |
| --- | --- |
| `apps/desktop/src/local-runtime.ts` → `officialHostLauncher()` | 生成 `.workdsh-host.mjs`，import 官方 `profile-boot.js` / app-boot，传入 `patchFiles` |
| `apps/desktop/src/workdsh-main.ts` → `startRuntime()` | `layers = basePatch + patches + port.patch`，再交给 launcher |
| `apps/desktop/src/local-runtime.ts` → `materializeRuntimeProfile()` | 从打包 runtime 物化 `profiles/workdsh`，写 `.workdsh-desktop-base.json` |
| `packages/bundle/cordis.patch.yml` | 我们 bundle 自带的 patch（插入 workdsh 插件行） |
| `apps/desktop/scripts/{pack,prepare}-workdsh-*.mjs` | 打包/安装 profile，校验官方版本、bundle 清单、插件库存 |

**升级风险**：`runProfile` 签名、patch 合并语义（`config` 是整块替换，不深合并）、profile 目录结构（`cordis.yml` / `cordis.patch.yml` / `package.json` 的 `dsh.profile.bundles`）变化。
**回归**：`corepack yarn workspace dsh-plugin-desktop prepare:workdsh-runtime` 必须打印 `Prepared official DSH ... with 6 default features`；桌面能正常起 Host（日志有 `dsh web: http://127.0.0.1:...`）。

## 2. 模型路由接缝：托管模型组「三云 Buddy」

**没有改写官方 `llm-pi-ai` 的 `providers` 配置**（那会整块覆盖用户自配模型）。走官方适配器注册：

| 位置 | 做什么 |
| --- | --- |
| `packages/bundle/src/probe.ts` → `apply()` 末尾 | `ctx.inject(['llm'], scope => scope.llm.registerAdapter(['sanyun-buddy'], new ManagedAdapter(...)))` |
| `packages/bundle/src/probe.ts` → `ManagedAdapter` | 把 OpenAI Chat Completions 的 SSE 映射成官方事件流（`block-start`/`*-delta`/`block-end`/`usage`/`finish`），并透传 tool-call |
| `apps/desktop/src/managed-bridge.ts` | 本机 loopback 桥：Host 只拿到 `URL` + 随机 `key`，拿不到后端 account token；固定转发目标、只暴露目录内模型、注入 `request_id`/`price_version`/`include_usage` |
| `apps/desktop/src/workdsh-main.ts` | 启动 Host 时注入 `WORKDSH_MANAGED_PROVIDER_URL/KEY/MODELS`（无目录时不注入，模型入口自然消失） |
| Admin 侧 | `/api/managed/v1/chat/completions`（计费网关），模型目录 `/api/account/models` |

**为什么不加第二行 `llm-pi-ai`**：官方拒绝第二个同 adapter 实例（`DUPLICATE_DIRECTORY`），记录见 `docs/personal-beta/GATE-managed-provider.md`。
**升级风险**：`registerAdapter` 的存在/签名/首参类型、`StreamEvent` 事件形状、`usage` 字段名、tool-call 映射。
**回归**：`docs/personal-beta/probe/` 下的 mock 模型服务器门禁可重跑；真实环境看模型选择器里「三云 Buddy」组是否还在、流式回复、工具调用、积分扣减。

## 3. 客户端插槽：我们注册进官方的全部 UI

全部使用官方 `ctx.slots.inject() + ctx.slots.register()`，没有复制任何官方组件。

| 插槽 | 组件 / 注册点 | 用途 | 官方声明 |
| --- | --- | --- | --- |
| `sidebar.footer.action` | `AccountFooter`（`packages/bundle/src/client/components/AccountFooter.tsx`），`harness/client.ts` 注册 | 左下角账号/空间/积分入口（底栏另一项为官方「更多」） | `dsh-client-ui-sidebar`（list, root） |
| `conversation.hero.brand.mark` | `HeroWelcome`（`.../components/HeroWelcome.tsx`） | 新会话欢迎语 + 云朵 logo | `dsh-client-ui-conversation`（single, root，owner props `{size, className}`） |
| `sidebar.brand.mark` / `sidebar.brand.name` | `BrandMark` / `BrandName`（`.../components/Brand.tsx`，复用 `packages/ui/src/components/LogoMark.tsx`） | 侧栏品牌 logo 与名称 | `dsh-client-ui-sidebar` |
| `shell.overlay` | `ShellAppearance`、`NavigationLocation` | 外观跟随、底栏顺序与账号菜单收口（插件广场迁入更多）、地址栏视图同步 | `dsh-client-ui-renderer` / layout |
| `main` | `workbench` 面板、诊断面板 | 工作台主区 | 官方 `main` |
| `sidebar.panellist` | 企业协作面板、诊断面板 | 侧栏面板 | `dsh-client-ui-sidebar` |
| `plugins.item` | 社区市场条目 | 插件市场 | `dsh-client-ui-plugin-manager` |
| `sidebar.right.pane.tab` | `AgentBrowserPage` | 右栏浏览器标签 | `dsh-client-ui-sidebar-right` |

**升级风险**：插槽改名/改 kind/改 scope/改 owner props；注册到未声明的插槽会直接激活失败（Host 起不来或面板空白）。
**回归**：升级后在 `node_modules/@deepseek-ai/*/lib/types/**/slots.d.ts` 里 grep 上表插槽名；桌面起来后看左下角账号行、欢迎语、品牌 logo。

## 4. 软依赖（官方改版时不会报错，只会静默失效）

| # | 位置 | 依赖的官方结构 | 失效表现 | 回归方法 |
| --- | --- | --- | --- | --- |
| S1 | `HeroWelcome.tsx` 注入的 `STYLE` | 官方 hero 里 `[data-slot="conversation.hero.brand.mark"]` 在标题容器内，原标题/「预览版」徽章是同级的另一个 `span` | 原来的「探索未至之境 · 预览版」重新出现（和我们欢迎语并列），或标题被误隐藏 | CDP 检查 `document.body.innerText` 不含 `探索未至之境`/`预览版`，且 `[data-testid="workdsh-hero-welcome"]` 存在 |
| S2 | `AccountFooter.tsx` 的 effect | 官方底栏 `[data-slot="sidebar.footer.action"]` 的父元素是一个 `flex` 行，且允许通过 `style.flexWrap` 换行 | 账号行和「插件广场」又挤成一行 / 文字被截断 | 量 `row.style.flexWrap === 'wrap'`、两行截图 |
| S3 | `local-runtime.ts` `acknowledgePreviewNotice()` | 用户层设置行 `id: ui-settings-general`、`config.welcomeNoticeVersion: 2026-09-28.1`（官方「预览版说明」弹窗版本号） | 新账号登录又弹「预览版说明」 | 新建账号登录后确认无弹窗；官方改版本号时把常量跟着更新 |
| S4 | `packages/ui/src/components/LogoMark.tsx` | 官方 `sidebar.brand.mark` 只给尺寸/类名，不要求图形格式 | 品牌位退回官方鱼形 logo 或空白 | 看侧栏左上角是否为云朵图 |
| S5 | `managed-bridge.ts` 的注入字段 | 我们的计费网关要求 `price_version` + `request_id`，且 `usage` 要回传 | 网关 400/409，聊天失败或积分不动 | 发一条消息，看 `/api/admin/platform/ledger` 有新 `USAGE` 行 |
| S6 | `ShellAppearance.tsx` 的 effect 与 `<style>` | 官方底栏 `footerActions` 后紧跟 `settingsArea`；官方账号菜单是含 `aria-keyshortcuts="Control+Alt+,"`「设置」项的 `[role="menu"]`，另有「意见反馈」「登录」（已登录为「退出登录」）；第三方 skillhub 在 footer action 内渲染 `.sh-plaza-wrap`，按钮 `.sh-plaza-trigger` 打开 `.sh-plaza-page` 对话框 | 左下角恢复三个入口或「更多」回到账号行下方；更多菜单重新出现「意见反馈」「登录」或没有「插件广场」 | CDP：底栏自上而下只有「更多」和 `[data-testid="workdsh-account-footer"]`（无「插件广场」）；打开账号菜单可见「设置」「插件广场」，点击「插件广场」打开 `.sh-plaza-page` 且菜单关闭 |

> S1/S2/S6 的查询只用结构选择器，不硬编码官方 hash 类名：官方改版时最坏情况是「多显示一行」，不会把布局弄崩。S6 还会克隆官方菜单项节点（保留其当前 class 以复用样式），并依赖第三方 skillhub 的 `.sh-plaza-wrap`/`.sh-plaza-trigger` 类名和菜单项中文文案；skillhub 或官方菜单改版时按 S6 的回归方法重新截图并更新本表。

## 5. 本地账号桥（renderer 拿不到 token）

| 位置 | 做什么 |
| --- | --- |
| `apps/desktop/src/account-preload.ts` | 用 `contextBridge` 注入 `window.__workdshAccountBridge = { url, key }`，参数来自 `--workdsh-account-url/key` |
| `apps/desktop/tsdown.config.ts` | 额外的 cjs 入口 `account-preload`（和 `connection-preload` 并列） |
| `apps/desktop/src/workdsh-main.ts` `openWindow()` | 工作台窗口用 `preload: ./account-preload.cjs` + `additionalArguments` |
| `packages/bundle/src/client/account.ts` | `accountBridge()` / `accountCall()` / `useAccountSummary()`，渲染层只用 bridge key 调 loopback，5s 轮询 |
| `packages/bundle/src/client/components/{AccountFooter,HeroWelcome}.tsx` | 复用上面的 hook 显示账号名/空间/积分；读取失败只显示「账户暂不可用」，绝不显示 0 |

**升级风险**：Electron 的 preload / `contextBridge` 是我们自己的代码，不受 DSH 版本影响；但窗口创建参数在 `workdsh-main.ts`，改官方 app-boot 启动方式时要一起看。
**回归**：登录后左下角出现 `空间名 · 积分`，欢迎语里出现账号名。

## 6. 升级官方 DSH 时的检查清单

1. 改 `upstream.json` 版本 → `corepack yarn install --immutable`。
2. `corepack yarn check:desktop-dsh-alignment && corepack yarn check:web-dsh-alignment`。
3. grep 第 3 节表格里的插槽名（新的 `lib/types/**/slots.d.ts`）与 `registerAdapter` 签名。
4. 重建前端产物：`apps/web` 下 `node node_modules/pnpm/bin/pnpm.cjs --filter workdsh-bundle build`（内部会先 build `workdsh-ui` 和 `workdsh-plugin-workbench`）。
5. 重新打包并安装 runtime：`node apps/desktop/scripts/pack-workdsh-profile.mjs apps/web apps/desktop/build/workdsh-profile-release`（同名目录存在会拒绝，先挪走旧目录）→ `prepare:workdsh-runtime` → `prepare:workdsh-primary-runtime` → `prepare:workdsh-command` → 桌面载体 `build`。
6. 本地验收（CDP 脚本在 `tmp/`，已在 `.gitignore`）：
   - `verify-hero.mjs`：`[data-testid="workdsh-hero-welcome"]` 存在、文案正确、`body.innerText` 不含 `探索未至之境`/`预览版`
   - 底栏：自上而下只有「更多」和账号行（无「插件广场」）；账号行积分非 0、无截断；打开「更多」可见「设置」「插件广场」，点击插件广场打开 SkillHub 面板且菜单关闭
   - 品牌位：侧栏左上角是云朵图
7. 托管模型回归：模型选择器里有「三云 Buddy」组，发一句话、流式正常、后台 ledger 有 `USAGE` 行。
8. 通过后再合并；不通过就先改回旧版本，**不要**改官方源码兜底。

## 7. 明确不属于 DSH 接缝的改动

- 桌面载体：登录/注册页（`apps/desktop/src/connection-entry.ts`、`connection-preload.ts`）、账号客户端（`account-client.ts`）、空间切换/退出、标签页与图标。
- Admin（Spring 服务端 + Vue 控制台）：账号、空间、目录、计费、平台控制台，全部是我们自己的代码。
- 安装器与部署脚本。

## 8. 已知边界与不做的事

- 不修改官方 DSH 源码，不做 `native-workbench-frame-patch` 之外未授权的官方文件改动；本文件列出的所有改动都在 `apps/desktop`、`packages/*` 和 profile 用户层。
- 不复制官方 settings / 侧栏 / 右栏实现。
- 企业模式不注入托管模型组（只对个人空间会话生效），企业自配模型的路径保持不变。
- 助手回复里仍自称「DeepSeek Harness」，因为官方 system prompt 未改（产品层改名不影响模型身份）。
