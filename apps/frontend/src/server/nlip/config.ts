import { ensureRedisConnected } from '~/utils/redisClient'
import { encryptProjectConfig, decryptProjectConfig } from '~/utils/crypto'
import {
  nlipConfigInputSchema,
  type NlipAgent,
  type PublicNlipAgent,
} from '~/types/nlip'

type StoredAgent = NlipAgent & { token?: { encrypted: string } }
export interface NlipConfig {
  inboundEnabled: boolean
  model: string
  agents: StoredAgent[]
}
const HASH = 'project_nlip_configs'

// Redis is already the project's metadata/provider store. Keep credentials
// encrypted with the existing server-only master key; no database migration.
export async function readNlipConfig(project: string): Promise<NlipConfig> {
  const redis = await ensureRedisConnected()
  const raw = await redis.hGet(HASH, project)
  return raw
    ? (JSON.parse(raw) as NlipConfig)
    : { inboundEnabled: false, model: '', agents: [] }
}

export function publicNlipConfig(config: NlipConfig): {
  inboundEnabled: boolean
  model: string
  agents: PublicNlipAgent[]
} {
  return {
    ...config,
    agents: config.agents.map(({ token, ...agent }) => ({
      ...agent,
      hasToken: Boolean(token),
    })),
  }
}

export function validateNlipEndpoint(endpoint: string): string {
  const url = new URL(endpoint)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'NLIP endpoint must be an HTTP(S) URL without credentials, query or fragment',
    )
  }
  const trusted = (process.env.NLIP_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  // Always explicit, including localhost. Project admins cannot expand egress.
  if (!trusted.includes(url.origin))
    throw new Error('NLIP endpoint origin is not in NLIP_ALLOWED_ORIGINS')
  return url.toString()
}

export async function saveNlipConfig(
  project: string,
  input: unknown,
): Promise<NlipConfig> {
  const parsed = nlipConfigInputSchema.parse(input)
  const previous = await readNlipConfig(project)
  const agents = await Promise.all(
    parsed.agents.map(async ({ token, ...agent }): Promise<StoredAgent> => {
      const endpoint = validateNlipEndpoint(agent.endpoint)
      const old = previous.agents.find((a) => a.id === agent.id)
      // Moving a credential to another destination requires explicit replacement.
      const oldToken =
        old?.endpoint === endpoint && old?.authMode === agent.authMode
          ? old.token
          : undefined
      const storedToken =
        token === null
          ? undefined
          : token === undefined
            ? oldToken
            : await encryptProjectConfig(token)
      return {
        ...agent,
        endpoint,
        ...(storedToken ? { token: storedToken } : {}),
      }
    }),
  )
  const config: NlipConfig = {
    inboundEnabled: parsed.inboundEnabled,
    model: parsed.model,
    agents,
  }
  const redis = await ensureRedisConnected()
  await redis.hSet(HASH, project, JSON.stringify(config))
  return config
}

export async function resolveNlipAgent(project: string, id: string) {
  const config = await readNlipConfig(project)
  const agent = config.agents.find((a) => a.id === id && a.enabled)
  if (!agent) throw new Error('This NLIP agent is not enabled for this project')
  return {
    ...agent,
    endpoint: validateNlipEndpoint(agent.endpoint),
    credential: await decryptProjectConfig<string>(agent.token),
  }
}
