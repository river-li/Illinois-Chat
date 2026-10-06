// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({ values: new Map<string, string>() }))
vi.mock('~/utils/redisClient', () => ({
  ensureRedisConnected: async () => ({
    hGet: async (_hash: string, key: string) => store.values.get(key),
    hSet: async (_hash: string, key: string, value: string) => {
      store.values.set(key, value)
    },
  }),
}))
import {
  saveNlipConfig,
  readNlipConfig,
  publicNlipConfig,
  resolveNlipAgent,
  validateNlipEndpoint,
} from '../config'

const agent = {
  id: 'ta',
  name: 'TA',
  description: 'Explain course slides',
  endpoint: 'https://ta.example/nlip/',
  enabled: true,
  authMode: 'bearer' as const,
}
describe('project NLIP configuration', () => {
  afterEach(() => vi.unstubAllEnvs())
  beforeEach(() => {
    store.values.clear()
    vi.stubEnv(
      'NLIP_ALLOWED_ORIGINS',
      'https://ta.example,https://other.example',
    )
    vi.stubEnv('ENCRYPTION_MASTER_KEY', 'unit-test-master-key')
  })
  it('encrypts credentials, hides them in public config and preserves blank replacements', async () => {
    await saveNlipConfig('course', {
      inboundEnabled: true,
      agents: [{ ...agent, token: 'private-token' }],
    })
    expect(store.values.get('course')).not.toContain('private-token')
    expect(
      JSON.stringify(publicNlipConfig(await readNlipConfig('course'))),
    ).not.toContain('encrypted')
    await saveNlipConfig('course', { inboundEnabled: true, agents: [agent] })
    expect((await resolveNlipAgent('course', 'ta')).credential).toBe(
      'private-token',
    )
    expect(await readNlipConfig('another-course')).toMatchObject({
      inboundEnabled: false,
      agents: [],
    })
  })
  it('does not forward a stored token to a changed endpoint or auth mode', async () => {
    await saveNlipConfig('course', {
      inboundEnabled: false,
      agents: [{ ...agent, token: 'private-token' }],
    })
    await saveNlipConfig('course', {
      inboundEnabled: false,
      agents: [{ ...agent, endpoint: 'https://other.example/nlip/' }],
    })
    expect((await resolveNlipAgent('course', 'ta')).credential).toBeNull()
  })
  it('supports removal and checks project membership/enabled state at execution', async () => {
    await saveNlipConfig('course', {
      inboundEnabled: false,
      agents: [{ ...agent, token: 'private-token' }],
    })
    await saveNlipConfig('course', {
      inboundEnabled: false,
      agents: [{ ...agent, token: null, enabled: false }],
    })
    await expect(resolveNlipAgent('course', 'ta')).rejects.toThrow(
      /not enabled/,
    )
    await expect(resolveNlipAgent('other', 'ta')).rejects.toThrow(/not enabled/)
  })
  it('blocks untrusted destinations, URL credentials and redirect-friendly query URLs', () => {
    for (const url of [
      'http://127.0.0.1:8080/nlip/',
      'https://evil.example/nlip/',
      'https://user:secret@ta.example/nlip/',
      'https://ta.example/nlip/?redirect=evil',
    ]) {
      expect(() => validateNlipEndpoint(url)).toThrow()
    }
    expect(validateNlipEndpoint(agent.endpoint)).toBe(agent.endpoint)
  })
})
