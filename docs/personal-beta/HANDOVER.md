# WorkDSH 个人内测候选 · 交接说明（HANDOVER）

整合任务 t24 产物。两个仓库的改动均保持未提交状态，等待用户审查；本文说明审查结论、本地运行方式、数据库演练与回滚要求。

## 1. 交付状态（分支与未提交改动）

**workdsh（桌面）** — worktree `D:\code\sanyun\workdsh\.agents\worktrees\dsh-02e451dd-e49b`，分支 `dsh-02e451dd-e49b`，全部未提交：

- 修改 16 个文件：`.gitignore`（+3：新增 `/tmp/` 排除规则）；`apps/desktop/src/` 7 个（connection-entry.ts、connection-mode.ts、connection-preload.ts、deployment-config.ts、enterprise-auth.ts、local-runtime.ts、workdsh-main.ts）；`apps/desktop/tests/` 6 个 spec（connection-entry、connection-lifecycle、connection-mode、deployment-config、enterprise-auth、local-runtime）；`packages/bundle/src/client/harness/client.ts`（+6）、`packages/bundle/src/probe.ts`（+185）。
- 新增：`apps/desktop/src/account-client.ts`、`apps/desktop/src/managed-bridge.ts` 及两个对应 spec、`packages/bundle/src/client/components/AccountFooter.tsx`；`docs/personal-beta/`（GATE-managed-provider.md、ACCEPTANCE.md、probe/ 下 5 个探针脚本、本文件）。
- `apps/web/`、`upstream.json`、官方 DSH 源码：零改动。

**workdsh-admin** — `D:\code\sanyun\workdsh-admin`，分支 `feat/sanyun-buddy-personal-beta`，全部未提交：

- 修改 13 个：`server/pom.xml`（+1：spring-boot-starter-mail，t15 授权项）；AuthController、AuthService、BrowserSessionFilter、MemberController、MemberSecrets；`application.yml`（+7）；schema.sql / schema-sqlite.sql / schema-mysql.sql（纯新增 +127 / +127 / +128）；web 的 App.vue、main.js、style.css。
- 新增：`deploy/postgres/migrations/V008__platform_accounts.sql`；accounts 侧 7 个主类（AccountAuthService、AccountController、AccountMigration、AccountSpaces、CreditLedger、PlatformAudit、VerificationCodes）+ `catalog/` + `managed/` 两个包；9 个测试类；web 的 PlatformApp.vue、Root.vue。
- `web/.smoke/`：16 张冒烟截图，仅为验收证据，不是交付物。
- 整合期清理：`server/smoke-data/`（整合冒烟产生的 H2 运行目录）已删除；`tmp/`（t1/t6 探针 scratch，曾含 `.credentials.yaml`）在 t21 已删除，且 `.gitignore` 增加 `/tmp/` 规则，不会进入交付。

## 2. 最终 diff 审查结论

- 两仓库逐文件审查：无调试残留（src 无 console/debugger/System.out/printStackTrace/TODO/FIXME/HACK）、无凭据（唯一命中是探针脚本与门禁文档中的占位令牌 `gate-managed-placeholder` 与 mock 值 `sk-gate-user`，均为显式假值）、无 tmp 运行目录、无计划外改动。
- 官方 DSH 源码零改动；`apps/web` 未动；`upstream.json` 未动；除 t15 授权的 spring-boot-starter-mail 外未新增依赖。
- git 输出 4 处 LF→CRLF 行尾提示（AuthService.java、schema*.sql、main.js），为行尾归一化提示，非内容改动。

## 3. 最终门禁记录（2026-11-23 复跑）

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| Admin server | `mvn -f server/pom.xml test`（cwd `D:\code\sanyun\workdsh-admin`） | exit 0 — 64 tests, 0 failures, 0 errors, 1 skipped（MysqlEnterpriseTest env-gated） |
| Admin web | `& "D:\Program Files\nvm\v24.15.0\npm.cmd" --prefix web run build`（cwd `D:\code\sanyun\workdsh-admin`） | exit 0 — vite 6.3.5，`dist/assets/index-BacmEek7.js` 947.58 kB，仅预存 >500 kB chunk 警告 |
| Desktop build | `$env:PATH='D:\Program Files\nvm\v24.15.0;'+$env:PATH; corepack yarn workspace dsh-plugin-desktop build` | exit 0 |
| Desktop typecheck | 同上 `corepack yarn workspace dsh-plugin-desktop typecheck` | exit 0 |
| Desktop 8 specs | 同上 `corepack yarn workspace dsh-plugin-desktop vitest run tests/connection-lifecycle.spec.ts tests/local-runtime.spec.ts tests/managed-bridge.spec.ts tests/enterprise-auth.spec.ts tests/account-client.spec.ts tests/connection-mode.spec.ts tests/deployment-config.spec.ts tests/connection-entry.spec.ts` | exit 0 — 8 files / 51 tests（vitest 4.1.8，4.61s） |
| Bundle typecheck | `& .\node_modules\.bin\tsc.cmd -p ../../packages/bundle/tsconfig.json --noEmit`（cwd `apps/web`） | exit 0 |

- 契约原写法 `yarn workspace workdsh-bundle` 无法解析：bundle 位于 apps/web 的 pnpm workspace（`apps/web/pnpm-workspace.yaml` 含 `../../packages/*`），不在根 Yarn workspace；以等价直接 tsc 记录（与 t21 同款说明）。
- desktop 命令运行前 PATH 前置 `D:\Program Files\nvm\v24.15.0`（corepack/node 所在目录）。
- `corepack yarn check` 基线：本机 exit 1，唯一原因是 4 个预存环境性失败（official-command.spec.ts ×3、owned-process-windows.spec.ts ×1）。其源码与 spec 在本分支与 pristine main 零差异，可复现；根因是沙箱 PowerShell/CIM 进程查询超过 `owned-process.ts:56` 的 8.2s 超时。未跳过、未改写任何基线测试。

## 4. 本地运行 Admin

- 端口：server 18890（`server.port: ${PORT:18890}`，绑定 `${BIND_ADDRESS:127.0.0.1}`）；web dev 18891（vite `server.port: ${WORKDSH_WEB_PORT:18891}`，`/api` 代理到 `${WORKDSH_ADMIN_URL:http://127.0.0.1:18890}`）。
- 启动：server `mvn -f server/pom.xml spring-boot:run`；web `npm --prefix web run dev`（Node 24）。
- bootstrap 管理员（每次启动都会用配置值重置密码并清会话）：
  - 企业管理员（旧 /auth 侧）：`WORKDSH_BOOTSTRAP_ADMIN_EMAIL` / `WORKDSH_BOOTSTRAP_ADMIN_PASSWORD`
  - 平台超管：`WORKDSH_PLATFORM_ADMIN_EMAIL` / `WORKDSH_PLATFORM_ADMIN_PASSWORD`（两项都配置才创建；缺一启动失败 IllegalStateException）
- secrets：`WORKDSH_SECRETS_ENCRYPTION_KEY`（Base64 32 字节；缺省时平台模型 vendor key 加密不可用，返回 503 “Authorization store key is not configured”）；`WORKDSH_SECRETS_SERVICE_KEY` 可选。
- 数据库：`JDBC_URL`（默认 `jdbc:h2:file:./data/workdsh-admin;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE`）、`JDBC_USER` / `JDBC_PASSWORD`。
- 验证码邮件（Spring Mail，t15）：`SPRING_MAIL_*`（host/port/username/password 等）+ `WORKDSH_ACCOUNTS_MAIL_FROM`；未配置 SMTP 时 request-code 返回显式 503；本地联调可临时设 `WORKDSH_ACCOUNTS_EXPOSE_VERIFICATION_CODE=true` 让响应携带验证码（生产禁用）。
- 账号开关：`WORKDSH_ACCOUNTS_REGISTRATION_ENABLED`（默认 true）、`WORKDSH_ACCOUNTS_TRIAL_CREDITS_UNITS`（默认 500000 units = 500 积分）。
- 平台管理台入口：web 登录卡片下方「平台管理员？进入平台控制台」（`/#platform`）；登录后侧栏 账号与企业 / 模型目录 / 积分流水。

## 5. 桌面端配置（受管模型组与自配模型）

- 服务地址：编译默认 `https://sanyunbuddy.sycjlht.com`；覆盖顺序 `WORKDSH_SERVICE_ORIGIN` → 打包 `workdsh-config.json` 的 `service.origin`（经 `WORKDSH_DEPLOYMENT_CONFIG` 预置；该文件只允许 origin 一个键，不得放账号/密钥）→ 旧字段 `enterprise.backendUrl` → 默认值（`deployment-config.ts` `serviceOrigin()`）。
- 账号入口：连接页为固定地址的账号登录/注册（邮箱 + 密码，密码 ≥12 位；注册需邮箱验证码），服务地址不可编辑。
- 受管模型组（三云 Buddy）：个人账号登录后，主进程用账号 token 调 `GET /api/account/models` 拉取启用模型，经官方 `ctx.llm.registerAdapter` 注册独立提供方组 `sanyun-buddy`（桥进程 env：`WORKDSH_MANAGED_PROVIDER_URL` / `WORKDSH_MANAGED_PROVIDER_KEY` / `WORKDSH_MANAGED_PROVIDER_MODELS`）；模型目录由平台超管在 Admin「模型目录」维护。对话经本地回环桥转发 Admin `POST /api/managed/v1/chat/completions`，桥注入 `request_id` / `price_version` / `include_usage`；账号 token 只在主进程，不进渲染层。
- 自配模型：完全走官方设置 UI（llm-pi-ai providers），与受管组并存、互不重写；移除受管组不影响用户配置与会话选择（GATE 移除测试）。
- 隔离：每账号+空间独立 userData 分区 `workdsh-account-<sha256(accountId,spaceId)>`（mode 0700）；切换空间顺序 bridge.close → stop Host → revoke → open target；企业成员会话不注入受管模型（企业启动 models=[]）。
- 页脚：官方 `sidebar.footer.action` 显示「账号 · 空间 · 余额 积分」，5s 轮询 + 手动刷新。

## 6. 数据库增量迁移与演练要求

- 结构纯新增：三个 schema 各 +127 / +127 / +128 行（只加表和索引，不改既有表）；postgres 迁移链新增 `V008__platform_accounts.sql`（V001–V008）。四方言同构，回填幂等（TransactionTemplate，可重跑）。
- 新表：accounts、account_spaces（每账号固定一个 personal + 至多一个 enterprise）、account_sessions、verification_codes、credit_wallets、credit_ledger、platform_models、managed_requests、platform_audit_events、platform_migrations（marker `platform-accounts-v1`）。
- 演练步骤（对应 admin 仓库 `docs/ENTERPRISE-DATABASES.md`）：
  1. 先在既有生产库的【拷贝】上演练；绝不直接对生产库执行；绝不在既有库上运行新库初始化脚本。
  2. 演练前记录成员数、企业/组织关系数、最近会话与流水计数；演练后逐一核对一致（迁移只增不减不改）。
  3. 用旧客户端验证：旧 `/api/auth/login` 业主/成员仍能登录，原网关与授权数据不变。
  4. 冲突即停：任何报错或计数差异立即停止，列出差异清单人工判断后再继续；迁移为事务性，失败可整体回退。

## 7. 回滚手段

1. 先关注册：`WORKDSH_ACCOUNTS_REGISTRATION_ENABLED=false` 重启 Admin（新用户无法注册；已注册账号不受影响）。
2. 停受管调用：Admin 模型目录把平台模型全部停用 → `GET /api/account/models` 返回空 → 桌面不再注入受管组；停用后受管请求在网关前置被 403 拒绝，不产生新扣费。
3. 保留数据：accounts / account_spaces / credit_wallets / credit_ledger 等全部新表保留，不清库；企业既有表本就未被改动，回滚不影响企业功能。
4. 桌面端无需卸载：平台模型清空后桌面只剩用户自配模型；账号入口仍可登录，个人本地分区数据不丢失。
5. 彻底移除：以迁移前数据库备份恢复（V008 只增不改，恢复备份即回到迁移前状态）；桌面分支回退 main 后重新构建。

## 8. 尚未验收项与确认人（详见 ACCEPTANCE.md §6/§7）

| 项 | 状态 | 需要什么 / 谁确认 |
| --- | --- | --- |
| 真实厂商模型对话（streaming + 原生工具 + 三方计费一致） | 未验收 | 真实 OpenAI 兼容厂商端点 + key + 消费授权；产品负责人提供并确认 |
| 真实打包安装器 E2E（真 UI 注册、页脚余额、双账号隔离、自配模型对话） | 未验收 | 真实安装器 + 运行中的 server；产品负责人 / 发布负责人 |
| MySQL DDL 实测 | 未验收 | 本地无 MySQL（MysqlEnterpriseTest env-gated skip）；DBA / 运维在真实 MySQL 执行一次（DDL +128 纯新增、四方言同构） |
| 生产库迁移、开放注册、正式安装器发布、生产服务地址 | 未验收（计划未触碰生产） | 产品负责人 + 运维单独确认（ACCEPTANCE §7 四项） |
| t19 三条 LOW 网关观察（流中停滞无读超时 `ManagedGateway.java:144,204,227-246`；reserve 后非重复异常泄漏预留 `ManagedGateway.java:119-122`；forwardOnce settle 未防护 `ManagedGateway.java:193`） | 非阻塞 | 留待后续修复轮 |

## 9. 明确不做的事

不 push、不合并、不部署、不迁移生产库、不发布安装包。两个工作树保持未提交状态供用户审查；上述动作需产品负责人单独确认后另行执行。
