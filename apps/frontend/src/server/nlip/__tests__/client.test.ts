// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), read: vi.fn() }))
vi.mock('../config', () => ({
  resolveNlipAgent: mocks.resolve,
  readNlipConfig: mocks.read,
}))
import { askNlipAgent, fetchNlipTools, executeNlipTool } from '../client'
import {
  nlipMessageSchema,
  nlipQuestion,
  nlipToken,
  nlipText,
  nlipConfigInputSchema,
} from '~/types/nlip'

describe('NLIP HTTP client and tool adapter', () => {
  afterEach(() => vi.unstubAllGlobals())
  beforeEach(() => {
    mocks.resolve.mockResolvedValue({
      endpoint: 'https://ta.example/nlip/',
      credential: 'private-token',
      authMode: 'bearer',
    })
  })
  it('sends SDK text/correlation with Bearer auth and returns structured answers without auth tokens', async () => {
    const fetch = vi.fn(async (_url, init) => {
      const request = JSON.parse(init.body)
      expect(init.redirect).toBe('error')
      expect(init.headers.Authorization).toBe('Bearer private-token')
      return Response.json({
        ...request,
        content: 'Answer',
        submessages: [
          ...request.submessages,
          {
            format: 'token',
            subformat: 'authorization',
            content: 'do-not-display',
          },
          {
            format: 'structured',
            subformat: 'JSON',
            content: { evidence: 'slide 1' },
          },
        ],
      })
    })
    vi.stubGlobal('fetch', fetch)
    const result = await askNlipAgent('course', 'ta', 'Question')
    expect(result.text).toContain('slide 1')
    expect(result.data?.nlipReplyText).toBe('Answer')
    expect(JSON.stringify(result)).not.toMatch(/private-token|do-not-display/)
    expect(mocks.resolve).toHaveBeenCalledWith('course', 'ta')
  })
  it('supports the SDK authorization token profile', async () => {
    mocks.resolve.mockResolvedValue({
      endpoint: 'https://ta.example/nlip/',
      credential: 'private-token',
      authMode: 'nlip-token',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        const message = JSON.parse(init.body)
        expect(message.submessages).toContainEqual({
          format: 'token',
          subformat: 'authorization',
          content: 'private-token',
        })
        expect(init.headers.Authorization).toBeUndefined()
        return Response.json({
          format: 'text',
          subformat: 'english',
          content: 'Answer',
        })
      }),
    )
    expect((await askNlipAgent('course', 'ta', 'Question')).text).toBe('Answer')
  })
  it.each([
    [503, { content: 'private upstream detail' }],
    [
      200,
      {
        format: 'error',
        subformat: 'text',
        content: 'private upstream detail',
      },
    ],
    [
      200,
      {
        format: 'text',
        subformat: 'english',
        content: 'answer',
        submessages: [
          { format: 'token', subformat: 'conversation', content: 'wrong-id' },
        ],
      },
    ],
    [200, { arbitrary: 'not NLIP' }],
  ])(
    'reports failure for HTTP %s or invalid/protocol responses',
    async (status, body) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json(body, { status })),
      )
      const tool = await executeNlipTool(
        {
          id: 'nlip:ta',
          name: 'ask_nlip_ta',
          readableName: 'TA',
          description: 'TA',
          aiGeneratedArgumentValues: { question: 'Question' },
        },
        'course',
      )
      expect(tool.error).toBeTruthy()
      expect(tool.output).toBeUndefined()
      expect(tool.error).not.toContain('private')
    },
  )
  it('rejects oversized responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ content: 'x'.repeat(260000) })),
    )
    await expect(askNlipAgent('course', 'ta', 'Question')).rejects.toThrow(
      /256 KB/,
    )
  })
  it('publishes only enabled agents with model-safe function names', async () => {
    mocks.read.mockResolvedValue({
      agents: [
        {
          id: 'weather',
          name: 'Weather',
          description: 'Get forecast',
          enabled: true,
        },
        { id: 'hidden', enabled: false },
      ],
    })
    expect(await fetchNlipTools('course')).toMatchObject([
      {
        id: 'nlip:weather',
        name: 'ask_nlip_weather',
        inputParameters: { required: ['question'] },
      },
    ])
  })
  it('propagates cancellation into HTTP and distinguishes it in the tool result', async () => {
    const controller = new AbortController()
    controller.abort()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        expect(init.signal.aborted).toBe(true)
        throw new DOMException('Aborted', 'AbortError')
      }),
    )
    const result = await executeNlipTool(
      {
        id: 'nlip:ta',
        name: 'ask_nlip_ta',
        readableName: 'TA',
        description: 'TA',
        aiGeneratedArgumentValues: { question: 'Question' },
      },
      'course',
      controller.signal,
    )
    expect(result.error).toBe('NLIP request cancelled')
  })
})

describe('NLIP SDK 0.1.3 text profile', () => {
  it('accepts SDK nullable fields and case-insensitive formats', () => {
    const message = nlipMessageSchema.parse({
      format: 'TEXT',
      subformat: 'english',
      content: 'Question',
      messagetype: null,
      label: null,
      submessages: null,
    })
    expect(nlipQuestion(message)).toBe('Question')
  })
  it('joins text submessages and extracts the SDK conversation token', () => {
    const message = nlipText('Question', 'correlation-1')
    message.submessages!.push({
      format: 'text',
      subformat: 'english',
      content: 'Relevant detail',
    })
    expect(nlipToken(message, 'conversation')).toBe('correlation-1')
    expect(nlipQuestion(message)).toBe('Question\nRelevant detail')
  })
  it('rejects ambiguous credentials and unsupported control/binary input', () => {
    const message = nlipText('Question')
    message.submessages = [
      { format: 'token', subformat: 'authorization', content: 'a' },
      { format: 'token', subformat: 'authorization', content: 'b' },
    ]
    expect(() => nlipToken(message, 'authorization')).toThrow(/duplicate/)
    expect(() => nlipQuestion({ ...message, messagetype: 'CONTROL' })).toThrow(
      /Control/,
    )
    expect(() =>
      nlipQuestion({
        format: 'binary',
        subformat: 'image/base64',
        content: 'YQ==',
      }),
    ).toThrow(/Only text/)
  })
  it('rejects empty/oversized questions and duplicate agent IDs', () => {
    expect(() => nlipQuestion(nlipText(' '))).toThrow()
    expect(() => nlipQuestion(nlipText('a'.repeat(16001)))).toThrow()
    const agent = {
      id: 'ta',
      name: 'TA',
      description: 'Explain slides',
      endpoint: 'https://ta.example/nlip/',
    }
    expect(
      nlipConfigInputSchema.safeParse({
        inboundEnabled: false,
        agents: [agent, agent],
      }).success,
    ).toBe(false)
  })
})
