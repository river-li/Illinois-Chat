// @vitest-environment node
import type { NextApiRequest, NextApiResponse } from 'next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  key: vi.fn(),
  metadata: vi.fn(),
  config: vi.fn(),
  answer: vi.fn(),
}))
vi.mock('~/db/dbClient', () => ({
  apiKeys: { email: 'email', key: 'key', is_active: 'is_active' },
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: mocks.key }) }) }),
  },
}))
vi.mock('~/server/authorization', () => ({ getCourseMetadata: mocks.metadata }))
vi.mock('~/server/nlip/config', () => ({ readNlipConfig: mocks.config }))
vi.mock('~/server/nlip/answerProject', () => ({
  answerProjectQuestion: mocks.answer,
}))
import handler from '~/pages/api/nlip/[course_name]'
import { nlipText, type NlipMessage } from '~/types/nlip'

async function request(
  body: unknown,
  headers: Record<string, string> = { authorization: 'Bearer test-key' },
  method = 'POST',
) {
  let status = 200
  let result: NlipMessage | undefined
  const res = {
    status: (s: number) => {
      status = s
      return res
    },
    json: (b: unknown) => {
      result = b as NlipMessage
      return res
    },
    setHeader: vi.fn(),
  }
  await handler(
    {
      body,
      headers,
      method,
      query: { course_name: 'cs101' },
    } as unknown as NextApiRequest,
    res as unknown as NextApiResponse,
  )
  if (!result) throw new Error('Handler did not send a response')
  return { status, body: result }
}
describe('NLIP project endpoint', () => {
  beforeEach(() => {
    mocks.key.mockResolvedValue([{ email: 'owner@example.test' }])
    mocks.metadata.mockResolvedValue({
      course_owner: 'owner@example.test',
      course_admins: [],
      is_frozen: false,
    })
    mocks.config.mockResolvedValue({ inboundEnabled: true, model: 'gpt-4o' })
    mocks.answer.mockResolvedValue({
      text: 'Answer grounded in slides',
      citations: [{ index: 1, filename: 'lecture.pdf' }],
    })
  })
  it('returns SDK text, citations and correlation without returning credentials', async () => {
    const result = await request(nlipText('Question', 'correlation-1'))
    expect(result.status).toBe(200)
    expect(result.body.content).toBe('Answer grounded in slides')
    expect(result.body.submessages).toContainEqual({
      format: 'token',
      subformat: 'conversation',
      content: 'correlation-1',
    })
    expect(JSON.stringify(result.body)).toContain('lecture.pdf')
    expect(JSON.stringify(result.body)).not.toContain('test-key')
    expect(mocks.answer).toHaveBeenCalledWith(
      'cs101',
      'Question',
      'owner@example.test',
      expect.anything(),
      'gpt-4o',
    )
  })
  it('supports SDK authorization submessages', async () => {
    const message = nlipText('Question')
    message.submessages = [
      { format: 'token', subformat: 'authorization', content: 'test-key' },
    ]
    expect((await request(message, {})).status).toBe(200)
  })
  it('rejects absent/invalid/conflicting authentication before answering', async () => {
    expect((await request(nlipText('Q'), {})).status).toBe(401)
    mocks.key.mockResolvedValue([])
    expect((await request(nlipText('Q'))).status).toBe(401)
    const msg = nlipText('Q')
    msg.submessages = [
      { format: 'token', subformat: 'authorization', content: 'other-key' },
    ]
    expect((await request(msg)).status).toBe(401)
    expect(mocks.answer).not.toHaveBeenCalled()
  })
  it('enforces project permission, frozen status and the inbound switch', async () => {
    mocks.metadata.mockResolvedValue({
      course_owner: 'other@example.test',
      course_admins: [],
      is_private: false,
    })
    expect((await request(nlipText('Q'))).status).toBe(403)
    mocks.metadata.mockResolvedValue({
      course_owner: 'owner@example.test',
      course_admins: [],
      is_frozen: true,
    })
    expect((await request(nlipText('Q'))).status).toBe(403)
    mocks.metadata.mockResolvedValue({
      course_owner: 'owner@example.test',
      course_admins: [],
    })
    mocks.config.mockResolvedValue({ inboundEnabled: false })
    expect((await request(nlipText('Q'))).status).toBe(403)
    expect(mocks.answer).not.toHaveBeenCalled()
  })
  it('rejects malformed and unsupported payloads', async () => {
    expect((await request({ arbitrary: true })).status).toBe(400)
    expect(
      (
        await request({
          format: 'binary',
          subformat: 'image/base64',
          content: 'YQ==',
        })
      ).status,
    ).toBe(422)
    expect((await request(nlipText('Q'), {}, 'GET')).status).toBe(405)
  })
  it('returns a protocol error on missing services instead of an empty successful answer', async () => {
    mocks.answer.mockRejectedValue(new Error('provider-secret-detail'))
    expect(await request(nlipText('Q'))).toMatchObject({
      status: 503,
      body: { format: 'error' },
    })
  })
})
