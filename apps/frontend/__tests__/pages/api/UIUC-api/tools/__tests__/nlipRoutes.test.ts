// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextApiResponse } from 'next'
import type { AuthenticatedRequest } from '~/utils/authMiddleware'
import type { AuthenticatedUser } from '~/proxy'
import type { CourseMetadata } from '~/types/courseMetadata'
const mocks = vi.hoisted(() => ({
  metadata: vi.fn(),
  save: vi.fn(),
  read: vi.fn(),
  tools: vi.fn(),
  ask: vi.fn(),
}))
vi.mock('~/utils/authMiddleware', () => ({
  withAuth: (handler: unknown) => handler,
}))
vi.mock('~/server/authorization', () => ({
  getCourseMetadata: mocks.metadata,
  isCourseAdmin: (u: AuthenticatedUser, m: CourseMetadata) =>
    m.course_admins?.includes(u.email),
  isCourseOwner: (u: AuthenticatedUser, m: CourseMetadata) =>
    m.course_owner === u.email,
  hasCourseAccess: (u: AuthenticatedUser, m: CourseMetadata) =>
    m.course_owner === u.email || m.approved_emails_list?.includes(u.email),
}))
vi.mock('~/server/nlip/config', () => ({
  saveNlipConfig: mocks.save,
  readNlipConfig: mocks.read,
  publicNlipConfig: (c: unknown) => c,
  validateNlipEndpoint: (url: string) => {
    if (!url.startsWith('https://allowed.example/'))
      throw new Error('Not allowed')
    return url
  },
}))
vi.mock('~/server/nlip/client', () => ({
  fetchNlipTools: mocks.tools,
  askNlipAgent: mocks.ask,
}))
import { handler as configHandler } from '~/pages/api/UIUC-api/tools/nlipAgents'
import { handler as toolHandler } from '~/pages/api/UIUC-api/tools/nlipTools'

async function request(
  handler: typeof configHandler,
  email: string,
  method = 'GET',
  body: unknown = undefined,
) {
  let status = 200
  let result: unknown
  const res = {
    status: (s: number) => {
      status = s
      return res
    },
    json: (b: unknown) => {
      result = b
      return res
    },
  }
  await handler(
    {
      method,
      user: { email },
      query: { course_name: 'course' },
      body,
    } as AuthenticatedRequest,
    res as unknown as NextApiResponse,
  )
  return { status, body: result }
}
describe('project NLIP configuration and browser tool routes', () => {
  beforeEach(() => {
    mocks.metadata.mockResolvedValue({
      course_owner: 'owner',
      course_admins: [],
      approved_emails_list: ['student'],
    })
    mocks.read.mockResolvedValue({ agents: [] })
    mocks.tools.mockResolvedValue([])
    mocks.ask.mockResolvedValue({ text: 'Forecast' })
  })
  it('restricts configuration to owner/admin while allowing project users to list tools', async () => {
    expect((await request(configHandler, 'student')).status).toBe(403)
    expect((await request(configHandler, 'owner')).status).toBe(200)
    expect((await request(toolHandler, 'student')).status).toBe(200)
    expect((await request(toolHandler, 'outsider')).status).toBe(403)
  })
  it('rejects untrusted origins before saving and duplicate agent IDs', async () => {
    const agent = {
      id: 'ta',
      name: 'TA',
      description: 'Explain slides',
      endpoint: 'https://untrusted.example/nlip/',
    }
    expect(
      (
        await request(configHandler, 'owner', 'POST', {
          inboundEnabled: false,
          agents: [agent],
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await request(configHandler, 'owner', 'POST', {
          inboundEnabled: false,
          agents: [agent, agent],
        })
      ).status,
    ).toBe(400)
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('executes by project/id and ignores caller-supplied destination and credential', async () => {
    expect(
      (
        await request(toolHandler, 'student', 'POST', {
          id: 'ta',
          question: 'Forecast?',
          endpoint: 'http://evil',
          token: 'caller-token',
        })
      ).status,
    ).toBe(200)
    expect(mocks.ask).toHaveBeenCalledWith('course', 'ta', 'Forecast?')
  })
  it('blocks frozen projects and rejects malformed questions', async () => {
    expect(
      (
        await request(toolHandler, 'student', 'POST', {
          id: 'ta',
          question: '',
        })
      ).status,
    ).toBe(400)
    mocks.metadata.mockResolvedValue({ course_owner: 'owner', is_frozen: true })
    expect((await request(configHandler, 'owner')).status).toBe(403)
    expect((await request(toolHandler, 'owner')).status).toBe(403)
  })
})
