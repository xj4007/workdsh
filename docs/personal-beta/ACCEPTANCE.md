# Acceptance: SANYUN-BUDDY-PERSONAL-BETA-PLAN Section 5

- Verdict date: 2026-11-23 (Asia/Shanghai)
- Verifier: verifier-glm (task t23, attempt 36cd4412-1d37-41d4-8fa0-e6eb5db1171e). Read-only review; no product code changed.
- Desktop substrate: worktree `D:/code/sanyun/workdsh/.agents/worktrees/dsh-02e451dd-e49b`, branch `dsh-02e451dd-e49b`, uncommitted (t21 delivery, t22-verified).
- Admin substrate: `D:/code/sanyun/workdsh-admin`, branch `feat/sanyun-buddy-personal-beta`, HEAD 84a1a32 + uncommitted working tree (t2–t5/t17 deliveries, t16/t12/t19-verified).
- Method: independent rerun of every automatable gate, live-server API smoke, plus cited test names as required by the plan ("须有对应测试名或接口调用证据"). Build pass is never substituted for real-installer / real-model acceptance.

## 1. Automated gates (independent rerun)

| Gate | Command | Result |
| --- | --- | --- |
| Desktop build | icon generators + clean + tsdown + `tsc --emitDeclarationOnly` (apps/desktop) | exit 0 (2026-11-23 ~01:12, workdsh-main.js 198.19 kB) |
| Desktop typecheck | `tsc -p tsconfig.json --noEmit` + `tsc -p tsconfig.tests.json --noEmit` | exit 0 (~01:13) |
| Desktop t6/t21 specs | `vitest run` (connection-lifecycle, local-runtime, managed-bridge, enterprise-auth, account-client, connection-mode, deployment-config, connection-entry) | exit 0 — 8 files / 51 tests passed (~01:14) |
| Bundle typecheck | `tsc -p packages/bundle/tsconfig.json --noEmit` | exit 0 (~01:14) |
| Admin server suite | `mvn -f server/pom.xml test` | **exit 0 — 64 tests, 0 failures, 0 errors, 1 skipped** (MysqlEnterpriseTest, env-gated needs local MySQL), finished 01:33:55, 02:36 min |
| Admin web build | `vite build` (web/) | **exit 0** — 1110-module-equivalent bundle, built in 10.86s, chunk-size warning only |

Environment note: `corepack`/`yarn`/`npm` are not on PATH in this harness; equivalent direct forms were used (`node_modules/.bin` + explicit tsconfig paths, `node node_modules/vite/bin/vite.js build`). The contracted `yarn workspace workdsh-bundle exec tsc` form cannot resolve (bundle lives in the apps/web pnpm workspace) — the equivalent direct tsc form is recorded instead.

**Baseline (honest record):** `corepack yarn check` is **NOT green** and is not claimed to be. It exits 1 solely due to 4 pre-existing failures — `official-command.spec.ts` ×3 and `owned-process-windows.spec.ts` ×1 — whose sources and specs are zero-diff vs main (`git diff main --stat` empty, exit 0) and which reproduce identically on the pristine main checkout (root cause: sandbox PowerShell/CIM process query exceeding `owned-process.ts:56`'s 8.2s timeout). Re-rerun in this acceptance round: 4 failed / 10 passed, same failure lines. These are recorded as an environment baseline, **not a plan regression**. No test was skipped, weakened, or edited to manufacture green.

## 2. Scenario: 新用户、空模型目录 — PASS (server side + desktop integration level)

| Requirement | Result | Evidence |
| --- | --- | --- |
| 邮箱注册并登录成功 | PASS (live server) | Live smoke on a real running Admin server (H2 in-mem, 2026-11-23 01:35): `POST /api/account/request-code` → code 559243; `POST /api/account/register` → 200 token; `POST /api/account/login` → 200 token; `GET /api/account/me` → `pilot@acceptance.test`, role NONE, PERSONAL space, 1 space. Tests: `AccountFlowTest.registrationLoginAndTrialCreditsAreIdempotent` (AccountFlowTest.java:47) |
| 左下角显示正确账号和试用余额 | PASS (test level) | Live `GET /api/account/wallet` → balance 500000 units = **500.000 credits**, unit credit, scale 1000. Desktop side: `AccountFooter.tsx` renders `${displayName} · ${space.name} · ${credits} 积分` above Settings via official `sidebar.footer.action` (ordering verified against installed runtime dsh-client-ui-sidebar/lib/client.js:511-520); 5s poll + manual refresh. Real-desktop UI run: NOT ACCEPTED (see §6) |
| 重复验证不重复发分 | PASS | Live: duplicate `register` on the same email → 400, wallet unchanged (500000/500.000). Test: `registrationLoginAndTrialCreditsAreIdempotent` re-calls `spaces.grantTrial` → wallet still 500000, ledger count for reference `trial:<accountId>` still 1 (AccountFlowTest.java:74-77); code single-use: `verificationCodesAreSingleUseAndLimited` (:92); conflicting registration does not burn the code: `conflictingRegistrationDoesNotConsumeTheVerificationCode` (:425) |
| 未配置平台模型不妨碍进入工作台 | PASS (test level) | Live `GET /api/account/models` → `[]` with active session. Desktop: `workdsh-main.ts` launch tolerates empty catalog (`models=client.models(token).catch(()=>[])`), catalog injected only when present; `PlatformCatalogTest.emptyCatalogAndWalletAreExplicit` (:148). Real-desktop workspace entry with empty catalog: covered at integration-test level (connection-lifecycle register→picker→workspace), not on a real installer — see §6 |

## 3. Scenario: 一个真实平台模型 — NOT ACCEPTED (no real vendor model key / no real installer run)

Missing evidence (explicit): a real vendor model credential (OpenAI-compatible endpoint + key) and a real packaged desktop installer connected to a running Admin server. Neither is available to this verifier; no authorization to spend real vendor tokens.

What IS accepted at the levels reachable without those:

- **Gateway billing on a controlled call (mock upstream returning usage)**: `ManagedGatewayTest` 15/15 — non-stream 800 input + 200 output tokens at multiplier 15000bp settles exactly 1500 units charged (refund of the worst-case reserve, wallet 498500 from 500000); streaming 100+50 → 300 units charged, wallet 499700; `stream_options.include_usage` forwarded and final SSE usage captured (last wins); SSE chunks + `[DONE]` passed through verbatim.
- **Real desktop Host + model route plumbing**: t1 GATE (PASS, on locked DSH 0.2.1-rc.5, real Host launched via the production launch seam): managed group 三云 Buddy and user group coexist in `session/modelCatalog`, both selectable via `session/selectModel`, each reaches its own base URL with its own credential, no cross-routing; managed group removable without rewriting user config (user patch SHA-256 7CCDFE5C… unchanged pre/post removal; session choices preserved; user provider still works after removal).
- **Vendor key handling**: AES/GCM encrypted at rest, never returned (`PlatformCatalogTest.catalogCrudEncryptsVendorKeysAndBumpsPriceVersion`, vendorKey absent from responses; ciphertext `v1:` round-trips through `decryptPlatformSecret`).
- **Three-way consistency** (vendor usage ↔ Admin ledger ↔ desktop balance): partially accepted at test level (settle on actual usage asserted with exact units in `ManagedGatewayTest`), NOT ACCEPTED on a real call because the vendor side is a mock.

## 4. Scenario: 自配模型与异常扣费 — billing matrix PASS (test + live level); real-desktop self-config part NOT ACCEPTED

| Case | Result | Evidence |
| --- | --- | --- |
| 自配模型用原地址和 Key，平台余额不变 | PASS (structural) + NOT ACCEPTED (real run) | Structural: managed route is a separate `ctx.llm.registerAdapter` group (probe.ts), bridge forwards only catalog models (`managed-bridge.spec.ts` model-not-in-catalog 400 for a user model), user `llm-pi-ai` config never rewritten (GATE removal test). Real desktop conversation via a self-config model with balance unchanged: NOT ACCEPTED — needs real installer + real model |
| 重复请求不重复扣款 | PASS | `ManagedGatewayTest` duplicate request → 409, upstream CALLS==1 (unique request_id + `DuplicateKeyException→release+409` double guard) |
| 余额不足 | PASS | Live `POST /api/managed/v1/chat/completions` guards (401 no token / 400 missing price_version / 404 unknown model — all pre-execution, no reserve). Test: insufficient balance → 402 pre-upstream, no request row, no ledger row, upstream never called |
| 并发不透支 | PASS | Atomic conditional reserve `where balance_units-reserved_units>=?`; concurrency test: two parallel requests with balance 3000 → one 200 one 402, CALLS==1, exactly one SETTLED |
| 取消/断流 | PASS | `clientAbortDuringStreamMarksReviewKeepsReservationAndDoesNotRetry` — client abort mid-stream → status REVIEW, reservation kept (3000 units), no ledger charge, no auto retry; stream-no-usage → 502 REVIEW, reservation kept |
| 后台停用模型 | PASS | disabled → 403 before any forward (ManagedGatewayTest); live unknown model → 404 pre-execution |
| 不自动切换收费模型 | PASS | No automatic paid retry anywhere: pre-execution failure → RELEASED; connect-fail 502 RELEASED, timeout 504 RELEASED (platform bears), upstream reject 502 RELEASED; retry only via a new client request with a fresh request_id |
| 计费语义 | PASS | 1 credit = 1000 units (live: 500000 units → "500.000"; `FixedPoint.credits(units, scale)`); charge by actual tokens; price change bumps price_version and stale requests get 409 "refresh" (`PlatformCatalogTest` :98/:106-115, `ManagedGatewayTest` stale → 409 no call); **rotation/enable do NOT bump** (vendor-key rotate → priceVersion still 2, :117-126); missing price_version → 400 (t18, live-confirmed); billing rows store account/space/model/usage/price version/credits/request id — no chat bodies (`rowContains("SECRET-CHAT-BODY")` false) |

## 5. Scenario: 隔离与旧版兼容 — isolation PASS (test level); legacy server compat PASS (live); real two-account desktop run NOT ACCEPTED

| Requirement | Result | Evidence |
| --- | --- | --- |
| 同机两账号会话/凭据不串 | PASS (test level) + NOT ACCEPTED (real run) | Per-account+space partitions `workdsh-account-sha256(accountId,spaceId)` (connection-mode.spec.ts:5 tests), per-namespace homes `userData/accounts/<ns>` mode 0700 (local-runtime.spec.ts:61 'isolates personal account spaces and never reuses the legacy dsh-home'), switch order asserted in connection-lifecycle.spec.ts (bridge.close → stop Host → revoke → open target), token confined to main (env JSON not.toContain(token) ×3). Real two-account run on an installer: NOT ACCEPTED |
| 企业 A 不能访问企业 B 或个人数据 | PASS (test level) | `connection-mode.spec.ts` enterprise partitions differ by principal+org; `AccountFlowTest.crossOrgSpacesAreDeniedAndBackfillIsIdempotent` (:218); session-access autoBindFixedMemberSessions with personal autoBind false; enterprise launch injects models:[] (no managed models in enterprise) |
| 旧企业客户端仍能登录、用原网关、看原授权数据 | PASS (server live) + NOT ACCEPTED (full legacy desktop E2E) | Live: legacy `POST /api/auth/login` owner → token (unchanged shape); `POST /api/admin/members` → member + temporaryPassword (legacy shape); member legacy login with server-issued temp password → token ok; platform account auto-linked with PERSONAL+ENTERPRISE spaces (F4 live-confirmed, query=memberA shows 2 spaces). Tests: `enterpriseMemberKeepsOldLoginAndCanSwitchSpaces` (:150), `existingPersonalAccountCanBeLinkedToAnEnterpriseMember` (:383), migration preserves member identity (`backfillLinksPreexistingMembersAndSecondRunChangesNothing` :264 + "old enterprise login still works" :286). Full legacy-desktop-client E2E: NOT ACCEPTED — needs the real legacy client run |

## 5.1 与官方 DeepSeek Harness 同机共存 — PASS (本机真实自建安装包实测)；签名发布包与 GUI 交互安装仍 NOT ACCEPTED

场景：一台电脑原本已安装官方 DeepSeek Harness（独立安装目录、自身 `~/.dsh` 与 `%APPDATA%\@deepseek-ai\dsh-desktop`），再安装三云Buddy。要求两个产品互不读取、互不覆盖、可同时运行。

实测环境（2026-11-25）：本机 Windows Server 2022（Administrator），官方 DeepSeek Harness `0.2.2-rc.3` 常驻运行中（安装目录 `D:\Program\deepseekherness`、`DSH_HOME=C:\Users\Administrator\.dsh`、Web 端口 8475）。三云Buddy 用 `electron-builder`（26.15.7）现场构建出真实 NSIS 安装包 `SanyunBuddy-3.0.0-alpha.4-x64-Setup.exe`（462.7 MB，**未签名**，`signExecutable=false`），先对官方 `~/.dsh`、`%APPDATA%\@deepseek-ai`、官方安装目录三棵树做全量 SHA-256 快照（32378 文件）作基线，再静默装到临时目录 `D:\sanyun-verify\app`（`/S /D=...`），运行双实例，然后用 `Uninstall WorkDSH.exe /S` 卸载并复比（当次构建的可执行名仍是 `WorkDSH.exe`；同日稍后 `win.executableName` 已改为 `SanyunBuddy`，见下段复验）。验收证据里的“changed 文件”均经哈希 + 路径归属判定。

改名后复验（同日，2026-11-25 晚）：重建新名安装包（485.2 MB，仍未签名），并把上一段那个旧名包另存后实测升级路径——旧名包静默装到 `D:\sanyun-verify\app-legacy` 并启动（4 个 `WorkDSH.exe` 进程），再用新名包对**同一目录**静默覆盖：`UPGRADE_EXIT=0`，旧 `WorkDSH.exe` 进程被旧卸载器自动停止，目录内只剩 `SanyunBuddy.exe` 与 `Uninstall SanyunBuddy.exe`，注册表 `d1a84743-…` 条目的 `UninstallString` 更新为新卸载器，开始菜单/桌面快捷方式目标更新为 `SanyunBuddy.exe`。启动后进程全部为 `SanyunBuddy.exe`×4；官方 `DeepSeek Harness.exe` 进程数 9 不变、8475 照常监听（3080 无监听——官方 DSH Host 子进程是捆绑 `node.exe`，且只在登录后启动，与改名无关）。用 `Uninstall SanyunBuddy.exe /S` 卸载：目录与自身注册表条目删除，官方卸载条目、HKCU PATH 首条、`Software\DeepSeekHarness\Command`、`dsh://` 协议全部保持官方基线值。新包 `app.asar` 已含 `\lib\account-preload.cjs`（修复登录成功后开工作区窗口引用缺失 preload 的打包遗漏）。

| Requirement | Result | Evidence |
| --- | --- | --- |
| 官方 `~/.dsh`（会话、凭据、插件、profile）安装前后逐项不变 | **PASS (local real installer)** | 三棵树前后哈希：ADDED 0 / REMOVED 0。仅 3 个文件 HASH-CHANGED，全部是官方 DSH 自身对**当前正在运行的会话** `session-e14f5a77-…` 的自写（`sessions/…/session.v4.jsonl.zstd` 随对话增长、`rewind-snapshots`、`storages/session_projcache`），与安装器无关；官方安装目录树本身 0 改动。三云Buddy 强制 `DSH_HOME`/`DSH_AGENTS_HOME` 指向自己的账号空间（workdsh-main.ts `runtimeEnvironment`），不解析官方 home |
| 官方 `%APPDATA%\@deepseek-ai\dsh-desktop`（设置、更新状态）不变 | **PASS (local real installer)** | 同一树哈希比对中官方 userData 目录 ADDED/REMOVED/HASH-CHANGED 均为 0。三云Buddy 的 Electron userData 固定为 `%APPDATA%\WorkDSH`，appId `io.techflag.dsh.ssh`，与官方 `com.deepseek.dsh` 不同 |
| 全局注册面（HKCU PATH / `Software\DeepSeekHarness\Command` / `dsh://` 协议）不被改写 | **PASS (local real installer)** | 装后 `HKCU\Environment\Path` 首条仍是官方 `…\runtime\cli\bin`；`Software\DeepSeekHarness\Command` 三值仍是官方；`HKCU\Software\Classes\dsh` 仍指向官方 `DeepSeek Harness.exe`；`D:\sanyun-verify\app\resources\workdsh-runtime\runtime\cli` 不存在（删命令功能生效，安装包不再携带或注册任何 `dsh` 终端命令） |
| 两个应用可同时启动、各自窗口与会话正常 | **PASS (local real installer)** | 三云Buddy 窗口起（主窗口标题「三云Buddy」，4 个 WorkDSH.exe 进程），同时官方 DSH 进程与 8475 端口照常监听，两互不干扰。三云Buddy 监听 loopback 端口，被占时改空闲端口、不停止其他进程 |
| 安装 / 卸载三云Buddy 后官方应用仍能正常启动 | **PASS (local real installer)** | 静默卸载 `UNINSTALL_EXIT=0` 后：官方 `DeepSeek Harness.exe` 与 `resources\runtime\cli\bin\dsh.cmd` 仍在；官方进程与 8475 端口未受影响继续运行；卸载项注册表里官方 `1bf39983-…` GUID 条目完好，仅移除了三云Buddy 自己的 `d1a84743-…` 条目 |
| 卸载/升级不删除官方数据 | **PASS (local real installer)** | 卸载后三棵树前后哈希：ADDED 0 / REMOVED 0，仅上述同样 3 个官方会话自写文件变化；`snap-pre-extra.txt` 与 `snap-post-uninstall-extra.txt` 逐行 `FC` 无差异（PATH、Command 键、协议、卸载项列表、快捷方式全部回到基线）。三云Buddy 自身 userData `%APPDATA%\WorkDSH` 卸载后仍保留（未设 `deleteAppDataOnUninstall`），但那是三云Buddy 自己的数据，与官方无关 |
| 用**签名发布版**安装包 + GUI 交互安装向导实测同机共存 | **NOT ACCEPTED** | 本次为现场构建的未签名安装包、静默安装到临时目录；正式发行签名包、真实用户路径（默认 Program Files 或用户自选目录）与 GUI 向导安装/卸载仍未跑 |
| exe 改名（`WorkDSH.exe`→`SanyunBuddy.exe`）后从旧名包升级与卸载回归 | **PASS (local real installer)** | 旧名包运行中用新名包静默覆盖同目录成功：旧进程被旧卸载器停止、旧 exe 文件清除、注册表 `UninstallString` 与快捷方式更新为 `Uninstall SanyunBuddy.exe`/`SanyunBuddy.exe`；卸载后 PATH、`Software\DeepSeekHarness\Command`、`dsh://`、官方卸载条目全部回到基线，官方进程不受影响。`%APPDATA%\WorkDSH`（userData）与 appId/GUID 故意不改名以保旧数据与升级识别 |


## 6. Explicit NOT ACCEPTED list (what is missing)

| Item | Status | Missing evidence |
| --- | --- | --- |
| Real vendor model conversation (streaming + native tool + three-way billing consistency) | **NOT ACCEPTED** | Real OpenAI-compatible vendor endpoint + key + authorization to spend tokens; a real packaged installer connected to a running server. What exists: gateway tests with a usage-returning mock upstream (§3), GATE real-Host probe with a mock model server |
| Real packaged-installer desktop E2E (register in real UI, footer trial balance, two real accounts, self-config model conversation) | **NOT ACCEPTED** | A real packaged installer run against a running server. What exists: 51 desktop tests (integration, mocked), real-Host GATE probe, live server API smoke |
| Coexistence with an installed official DeepSeek Harness (§5.1) | **PASS (local unsigned real installer)** — signed release package + GUI wizard install still NOT ACCEPTED | Verified on this machine: before/after tree hashes of `~/.dsh` and `%APPDATA%\@deepseek-ai\dsh-desktop` unchanged (only official DSH's own live-session self-writes moved), PATH / `Software\DeepSeekHarness\Command` / `dsh://` untouched, simultaneous launch OK, silent uninstall left `snap-pre-extra` identical via `FC`. Missing: the signed published artifact and an interactive GUI install/uninstall on a standard user path |
| MySQL DDL execution | **NOT ACCEPTED** | No local MySQL instance (MysqlEnterpriseTest env-gated/skipped). DDL is +128/-0 pure-additive and syntax-consistent across the four dialects; needs one real MySQL run |
| Production migration / open registration / official installer release | **NOT ACCEPTED — owner decisions** | Plan Section 5 explicitly reserves these for separate confirmation (§7); this plan did not touch production |

## 7. Items requiring product-owner / ops confirmation (plan does not touch production)

1. Production database migration (admin schema V001–V008 chain) against the live server.
2. Opening registration on the production Admin (`workdsh.accounts.registration-enabled`).
3. Building and publishing the official beta installer package.
4. Setting the production service origin (`https://sanyunbuddy.sycjlht.com` is the compiled default; packaged `workdsh-config.json` via `WORKDSH_DEPLOYMENT_CONFIG` is the ops-owned override path — credentials/keys never belong there).

## 8. Migration and legacy-compat evidence (as required by the task)

- **Schema pure-additive**: `git diff --numstat` → schema.sql **+127/−0**, schema-sqlite.sql **+127/−0**, schema-mysql.sql **+128/−0**; new `deploy/postgres/migrations/V008__platform_accounts.sql`; no existing table altered. `SchemaDeliveryTest` verifies the delivered postgres migration chain contains the current model/transport storage.
- **H2/SQLite re-execution idempotency**: `AccountFlowTest.crossOrgSpacesAreDeniedAndBackfillIsIdempotent` (backfill rerun → 0/0; delete marker → 1 → rerun 0) and `AccountSqliteTest` (SQLite backfill rerun → 0). Migration is transactional (TransactionTemplate, t15 F10).
- **Old `/api/auth/*` shapes unchanged**: live owner login + member login + member create all returned legacy shapes; `browserLoginIsTokenFreeAndCookieWorks` (:330) keeps the new browser-login cookie-only; `enterpriseMemberKeepsOldLoginAndCanSwitchSpaces` (:150). t16 re-review confirmed F1–F14 fixed without shape changes.
- **Member link + disable semantics**: `existingPersonalAccountCanBeLinkedToAnEnterpriseMember` (F4), `inactiveMembersAreNotBackfilledIntoPersonalAccounts` (F5, no trial for inactive), must-change gate (F6) and enterprise-only session cleanup on member disable (F8) covered in AccountFlowTest; live member create → auto-link observed.
- **Platform superadmin only via env bootstrap**: `platformAdminComesOnlyFromExplicitBootstrapConfiguration` (:295) + `platformBootstrapResetsConfiguredPasswordAndRejectsPartialConfig` (:313, F2/F14) — no in-app promotion path.

## 9. Billing correctness evidence summary (with test names)

1 credit = 1000 units (`FixedPoint`, live 500000→"500.000"); charge = ceil(actual(input+output) tokens × basisPoints / 10000); worst-case reserve before forward (context+maxOutput ×bp, min 1); settle refunds the difference; unique request_id per upstream call (unique constraint + pre-check, duplicate → 409); missing price_version → 400 (ManagedGatewayTest.java:248-271, live-confirmed); stale price_version → 409 "refresh" before any reserve/forward; disabled → 403; insufficient → 402 pre-upstream; concurrency no-overdraft (atomic conditional UPDATE); connect-fail/timeout/upstream-reject → RELEASED (platform bears); disconnect/no-usage → REVIEW keeping reservation; no auto paid retry; ledger rows carry no chat bodies. All in `ManagedGatewayTest` 15/15 (green in the fresh 64-test run).

## 10. Honesty disclosure

This verifier authored part of `PlatformAccountsController.java` (t17) during a revoked attempt before the task was reassigned; the final t17 implementation belongs to admin-eng-glm. Accordingly, t17/t5 evidence in this document is cited from the **independent 64-test suite rerun and live API exercise** (platform accounts + ledger endpoints queried live in §2/§5), not from reading my own draft.

## 11. Carried findings (non-blocking, for t24/integration)

Three LOW gateway observations recorded in t19 (none violates Section 3/5 contracts): (1) `ManagedGateway.java:144,204,227-246` streaming mid-stream stall has no idle/read deadline; (2) `ManagedGateway.java:119-122` non-duplicate RuntimeException after reserve leaks the reservation; (3) `ManagedGateway.java:193` forwardOnce settle is unguarded while the streaming path marks REVIEW on settle failure.
