# Gate: managed provider coexistence on locked DSH 0.2.1-rc.5

- **Status: PASS**
- **Chosen production mechanism: (b) official adapter registration interface** (`ctx.llm.registerAdapter` from a WorkDSH Profile plugin).
- **Locked runtime:** DSH `0.2.1-rc.5` (`apps/desktop/build/workdsh-runtime/profiles/workdsh`).
- **Scope:** isolated gate home under `tmp/gate/`; no production behavior or official DSH source changed.
- **Task:** `t1`, attempt `bb8d989d-4cb4-480a-91f8-6673480eadea`.

## 1. Result

The managed provider group **三云 Buddy** and a user self-configured provider group **用户自建提供方** coexist on the same Host:

| Check | Result | Evidence |
| --- | --- | --- |
| Both groups appear in the Host model catalog | PASS | `session/modelCatalog` returned `routableProviders:['sanyun-buddy','user-self']` and both groups with their model entries |
| Managed group selectable | PASS | `session/selectModel` returned `{provider:'sanyun-buddy',model:'sanyun-buddy-chat'}` |
| User group selectable | PASS | `session/selectModel` returned `{provider:'user-self',model:'user-model'}` |
| Managed request reaches its own base URL | PASS | POST `http://127.0.0.1:18182/v1/chat/completions`, `model=sanyun-buddy-chat` |
| User request reaches its own base URL | PASS | POST `http://127.0.0.1:18181/v1/chat/completions`, `model=user-model` |
| Managed group removable without rewriting user config | PASS | User profile patch SHA-256 unchanged before/after removal |
| Existing session model choices unchanged after removal | PASS | Both sessions still report their pre-removal `modelSelection` |
| User provider still works after managed removal | PASS | Post-removal prompt produced a POST on 18181 with the user key |
| Official source / production changed | NO | Only `docs/personal-beta/` and `tmp/gate/` are new in the worktree |

The native model selector is fed by `session/modelCatalog`; selection is performed by `session/selectModel`. The gate exercised those exact Host endpoints because session creation through the default GUI preset is blocked by an unrelated rc.5 preset bug (section 7). This is recorded explicitly rather than hidden.

## 2. Mechanism decision

### Rejected: (a) a second `@deepseek-ai/dsh-llm-pi-ai` row

A second `llm-pi-ai` row cannot coexist with the built-in one:

- `@deepseek-ai/dsh-llm-pi-ai/lib/index.js` `apply(ctx, config)` immediately calls `ctx.llm.registerConfigurableProviders(directoryEntries(profiles(), settingsNs))`.
- `directoryEntries` declares the **whole installed provider catalog**, not only the routes in that instance's config.
- `@deepseek-ai/dsh-llm/lib/index.js:1919` `registerConfigurableProviders` throws `DUPLICATE_DIRECTORY` at line 1935 when another registration already owns a provider id.
- The built-in `llm-pi-ai` row has already registered the catalog, so a second full instance fails before it can register an adapter.

### Chosen: (b) official adapter registration interface

The managed bridge is a normal WorkDSH Profile plugin row:

```js
export const name = 'gate-managed-provider'
export const inject = ['llm']

export function apply(ctx, config) {
  ctx.llm.registerAdapter(['sanyun-buddy'], new ManagedAdapter(config.baseURL, config.models))
}
```

`ctx.llm.registerAdapter(providers, adapter)` is the public `dsh-llm` contract. It adds a route without replacing `llm-pi-ai`'s `config`, so the user's `providers` dictionary and the built-in settings UI remain untouched. A minimal adapter implements `providerInfo`, `providerRetryPolicy`, `listModels`, `resolveModel`, `prepareCall`, and `stream`; `LlmAdapter` only requires `stream` to be abstract.

This is why the managed group can be removed by dropping its launch patch: it is a separate composition row, not an overlay that rewrites the user's provider configuration.

### Not needed: (c) STOP

Safe coexistence is demonstrable with (b); no official patch is required.

## 3. Environment and exact commands

Worktree:

```text
D:\code\sanyun\workdsh\.agents\worktrees\dsh-02e451dd-e49b
```

Runtime preparation (already warm during the retry; the command verifies the prepared runtime):

```powershell
corepack yarn install --immutable
corepack yarn workspace dsh-plugin-desktop prepare:workdsh-runtime
```

The successful verification printed:

```text
Verified plugin manager exposes exactly 6 installed WorkDSH product bundles:
workdsh-plugin-connectors, workdsh-plugin-experts, workdsh-plugin-library,
workdsh-plugin-projects, workdsh-plugin-skills, workdsh-plugin-workbenches
Prepared official DSH 0.2.1-rc.5 with 6 default features and no preinstalled
enterprise plugins at ...\apps\desktop\build\workdsh-runtime
```

Runtime note: the first install attempt failed during the mandatory-peer promotion step (`npx.cmd exited with 3221226505`). The verified runtime directory was restored from the main checkout's build produced from the same `workdsh-profile-release/release-manifest.json` (`sourceCommit e94c99d5f9e143fb67fec84a74978eb8218daf32`, harness `0.2.1-rc.5`). This is a build-environment issue, not a gate finding.

Probe lifecycle:

```powershell
# Managed provider active (default)
node docs/personal-beta/probe/start-probe.mjs

# Managed provider removed; only the user provider remains
node docs/personal-beta/probe/start-probe.mjs --no-managed

# Stop Host + mock servers recorded in tmp/gate/logs/run.json
node docs/personal-beta/probe/stop-probe.mjs
```

The probe Host uses the same launch seam as `apps/desktop/src/local-runtime.ts:160` `officialHostLauncher`: `runProfile({ profile:'workdsh', resolvedProfile:{profile,installAnchor}, patchFiles, args:['--no-open'], packageManager })`. `patchFiles` are the same launch overlays used by `apps/desktop/src/workdsh-main.ts:221-233` `startRuntime`.

## 4. Probe layout

```text
docs/personal-beta/probe/
  mock-model-server.mjs        OpenAI-compatible SSE mocks on 18181 and 18182
  managed-provider-plugin.mjs  probe adapter registering route `sanyun-buddy`
  launch-host.mjs              official profile-boot launch seam
  start-probe.mjs              starts mocks + Host; --no-managed / --keep-logs
  stop-probe.mjs               kills Host + mocks from run.json

tmp/gate/home/                 isolated DSH_HOME
  profiles/workdsh/            prepared profile copy
  cordis.patch.yml             gate-only welcome-notice acknowledgement
tmp/gate/patches/
  managed.patch.yml            inserts `gate-managed-provider` row
  port.patch.yml               sets webserver port 18990
tmp/gate/logs/
  run-with-managed/            archived evidence for the managed run
```

Managed route configuration:

```yaml
- insert:
    - id: gate-managed-provider
      name: file:///.../managed-provider-plugin.mjs
      config:
        baseURL: http://127.0.0.1:18182/v1
        models:
          - id: sanyun-buddy-chat
            name: 模型 A · ×1.5
            contextWindow: 128000
```

User provider (written once into the isolated profile's own `cordis.patch.yml`, simulating the user's settings):

```yaml
- id: llm-pi-ai
  config:
    providers:
      user-self:
        displayName: 用户自建提供方
        api: openai-completions
        baseURL: http://127.0.0.1:18181/v1
        apiKeyEnv: GATE_USER_KEY
        models:
          - id: user-model
            name: 用户模型 A
            contextWindow: 128000
```

The user patch hash before and after all managed tests:

```text
7CCDFE5CFD96D4C2D93F70561D4B3EDE2964666564925B7AC294C2E670504F74
  tmp/gate/home/profiles/workdsh/cordis.patch.yml
```

## 5. Host API used

The Host gateway is RPC, not REST. Requests are posted to `/api/session/<method>` with a client-request envelope; authentication comes from the `?token=` session cookie.

```json
{
  "type": "client-request",
  "rpcId": "probe-catalog",
  "method": "session/modelCatalog",
  "payload": { "args": {} }
}
```

A bare `{}` payload is rejected with `Remote payload must contain exactly one plain-object args field`; use `{"args":{}}`.

### Catalog with managed provider active

Endpoint: `POST http://127.0.0.1:18990/api/session/modelCatalog`

```json
{
  "default": { "provider": "deepseek-official", "model": "deepseek-flash" },
  "routableProviders": ["sanyun-buddy", "user-self"],
  "groups": [
    {
      "id": "sanyun-buddy",
      "name": "三云 Buddy",
      "models": [{ "id": "sanyun-buddy-chat", "name": "模型 A · ×1.5" }]
    },
    {
      "id": "user-self",
      "name": "用户自建提供方",
      "models": [{ "id": "user-model", "name": "用户模型 A" }]
    }
  ],
  "failures": []
}
```

Both groups and both model entries are visible to the native selector data source.

### Selection and chat

Managed session: `session-68ba17cb-31f3-4f1f-8427-c8df13896464`

```json
// POST /api/session/create
{ "args": { "cwd": "...\\tmp\\gate\\workspace", "agentPreset": "minimal" } }

// POST /api/session/selectModel
{ "args": { "sessionId": "session-68ba17cb-31f3-4f1f-8427-c8df13896464",
            "provider": "sanyun-buddy", "model": "sanyun-buddy-chat" } }
// -> { "selected": { "provider": "sanyun-buddy", "model": "sanyun-buddy-chat" } }

// POST /api/session/prompt
{ "args": { "requestId": "req-managed-1",
            "sessionId": "session-68ba17cb-31f3-4f1f-8427-c8df13896464",
            "mode": "queue",
            "content": [{ "type": "text", "text": "请只回复：managed-ok" }] } }
// -> { "accepted": true }
```

User session: `session-b016d367-9060-4e2e-bfa9-a43750885c1f`

```json
// POST /api/session/selectModel
{ "args": { "sessionId": "session-b016d367-9060-4e2e-bfa9-a43750885c1f",
            "provider": "user-self", "model": "user-model" } }
// -> { "selected": { "provider": "user-self", "model": "user-model" } }
```

### Mock request evidence

Managed mock (`18182`), managed run:

```text
GET  /v1/models
POST /v1/chat/completions  Bearer gate-managed-placeholder  model=sanyun-buddy-chat  messages=3
POST /v1/chat/completions  Bearer gate-managed-placeholder  model=sanyun-buddy-chat  messages=2
```

The first POST is the main generation request (with tool schemas); the second is the session-title request. Both went to port 18182 with the managed model id.

User mock (`18181`), same run:

```text
GET  /v1/models
POST /v1/chat/completions  Bearer sk-gate-user  model=user-model  messages=3
POST /v1/chat/completions  Bearer sk-gate-user  model=user-model  messages=2
```

Each request reached its own port, used its own model id, and carried its own credential. No cross-routing occurred.

## 6. Removal test

Steps:

1. Archived the managed run to `tmp/gate/logs/run-with-managed/`.
2. `node docs/personal-beta/probe/stop-probe.mjs`
3. `node docs/personal-beta/probe/start-probe.mjs --no-managed`

The restarted Host had only the user provider patch (plus the gate-only welcome patch and the port patch).

Catalog after removal (`POST /api/session/modelCatalog`):

```json
{
  "default": { "provider": "deepseek-official", "model": "deepseek-flash" },
  "routableProviders": ["user-self"],
  "groups": [
    {
      "id": "user-self",
      "name": "用户自建提供方",
      "models": [{ "id": "user-model", "name": "用户模型 A" }]
    }
  ],
  "failures": []
}
```

`sanyun-buddy` is gone; the user group remains.

Session choices after removal (`POST /api/session/projections`, `values.modelSelection`):

```json
{
  "managed": {
    "lastUsed": { "provider": "sanyun-buddy", "model": "sanyun-buddy-chat" },
    "next":     { "provider": "sanyun-buddy", "model": "sanyun-buddy-chat" }
  },
  "user": {
    "lastUsed": { "provider": "user-self", "model": "user-model" },
    "next":     { "provider": "user-self", "model": "user-model" }
  }
}
```

Both choices are unchanged. The managed session still records its previous choice; the route is simply unavailable until the user selects another model. The user's own configuration was not rewritten.

Config hashes after removal:

```text
7CCDFE5CFD96D4C2D93F70561D4B3EDE2964666564925B7AC294C2E670504F74
  tmp/gate/home/profiles/workdsh/cordis.patch.yml
BB34269404E607D38DA260F487712562D000297018B3125E9C26A7E96FC8FCCD
  tmp/gate/home/cordis.patch.yml
```

Both are identical to the pre-removal values.

Post-removal user prompt (`req-user-2`) was accepted and reached the user mock:

```text
POST /v1/chat/completions  Bearer sk-gate-user  model=user-model  messages=5
```

The managed mock recorded only `GET /v1/models` during the removed run, confirming the managed route was gone.

## 7. Findings outside the gate

These were encountered while reaching the model selector; they are **not** provider-coexistence failures and were not patched.

1. **Default preset session creation fails on rc.5.**
   `session/create` with `agentPreset:'standard'` returns:
   `agent-preset/invalid: tool-subagent (@deepseek-ai/dsh-tool-subagent): tool-subagent: standing modelSelectionSettings requires a scoped preset Context`.
   `dsh-web-app/presets/standard.patch.yml:98` and `ptc.patch.yml:98` set `modelSelectionSettings: true` on `tool-subagent`; `dsh-tool-subagent/lib/index.js:563` throws when `compositionScope` is undefined. The `minimal` preset has no `tool-subagent` row and succeeds. The gate used `agentPreset:'minimal'` for that reason.

2. **Preview notice acknowledgement in an isolated home.**
   The welcome modal's `继续` action returned `暂时无法保存确认状态，请重试。` with `settings/rejected: dsh: profile reload requires the root Include entry` (`dsh-app-boot/lib/index.js:3803`). The gate wrote a gate-only `ui-settings-general.welcomeNoticeVersion` value into `tmp/gate/home/cordis.patch.yml` to dismiss it. This is a fixture workaround, not a product change.

## 8. Production recommendation

Implement the managed provider bridge as a WorkDSH Profile plugin row that calls `ctx.llm.registerAdapter` with a stable route (for example `sanyun-buddy`) and an explicit model catalog. Do not inject managed profiles into `llm-pi-ai`'s `config` through a launch overlay: patch semantics replace the whole `config` object, which would shadow the user's providers and the Models page.

The adapter owns the managed credential and base URL, so the managed route is independent of the user's `llm-pi-ai` configuration. Removing the managed plugin row removes the route; the user's settings document and recorded session selections stay intact.

No official DSH source change is required.
