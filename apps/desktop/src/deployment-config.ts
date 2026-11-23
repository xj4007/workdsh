import { enterpriseConnection } from './connection-mode.ts'

export type DeploymentConfig = {
  /** Account service origin. `enterprise.backendUrl` remains accepted for older installers. */
  service?: { origin: string }
  enterprise?: { backendUrl: string }
}

/** Administrator-owned packaging input. Never accepts credentials or arbitrary settings. */
export function parseDeploymentConfig(value: unknown): DeploymentConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('打包配置必须是 JSON 对象')
  const root = value as Record<string, unknown>
  if (Object.keys(root).some(key => key !== 'enterprise' && key !== 'service')) throw new Error('打包配置仅允许 service 或 enterprise 后台地址，不接受密钥或其他设置')
  const result: DeploymentConfig = {}
  if (root.service !== undefined) {
    if (!root.service || typeof root.service !== 'object' || Array.isArray(root.service)) throw new Error('service 配置必须包含 origin')
    const service = root.service as Record<string, unknown>
    if (Object.keys(service).some(key => key !== 'origin') || typeof service.origin !== 'string') {
      throw new Error('service 配置仅允许 origin，不接受账号或密钥')
    }
    result.service = { origin: enterpriseConnection(service.origin).portalOrigin }
  }
  if (root.enterprise !== undefined) {
    if (!root.enterprise || typeof root.enterprise !== 'object' || Array.isArray(root.enterprise)) throw new Error('enterprise 配置必须包含 backendUrl')
    const enterprise = root.enterprise as Record<string, unknown>
    if (Object.keys(enterprise).some(key => key !== 'backendUrl') || typeof enterprise.backendUrl !== 'string') {
      throw new Error('enterprise 配置仅允许 backendUrl，不接受账号或密钥')
    }
    result.enterprise = { backendUrl: enterpriseConnection(enterprise.backendUrl).portalOrigin }
  }
  return result
}

/** One account origin per install: explicit service wins, then the legacy enterprise field, then production. */
export function serviceOrigin(config: DeploymentConfig, environment: NodeJS.ProcessEnv = process.env): string {
  const value = environment.WORKDSH_SERVICE_ORIGIN ?? config.service?.origin ?? config.enterprise?.backendUrl ?? 'https://sanyunbuddy.sycjlht.com'
  return enterpriseConnection(value).portalOrigin
}
