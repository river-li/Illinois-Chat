// @vitest-environment node
// Live official Python NLIP service + real Illinois Agent Mode and inbound
// handlers. Storage, document retrieval and LLM behavior are explicit fixtures.
import { createServer, type Server } from 'node:http'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { NextApiRequest, NextApiResponse } from 'next'
import type { AgentStreamEvent } from '~/types/agentStream'
import type { ChatBody, Conversation } from '~/types/chat'
import type { CourseMetadata } from '~/types/courseMetadata'
import type { AllLLMProviders } from '~/utils/modelProviders/LLMProvider'
import type * as StreamProcessing from '~/utils/streamProcessing'

const fixtures = vi.hoisted(() => ({
  store: new Map<string, string>(),
  step: 0,
  prompts: [] as string[],
}))
vi.mock('~/utils/redisClient', () => ({
  ensureRedisConnected: async () => ({
    hGet: async (_hash: string, key: string) => fixtures.store.get(key),
    hSet: async (_hash: string, key: string, value: string) => {
      fixtures.store.set(key, value)
    },
  }),
}))
vi.mock('~/db/dbClient', () => ({
  apiKeys: { email: 'email', key: 'key', is_active: 'active' },
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [{ email: 'demo@example.test' }] }),
      }),
    }),
  },
}))
vi.mock('~/utils/simConfig', () => ({
  resolveSimCredentials: async () => ({ ok: false, reason: 'not_configured' }),
  simConfigErrorResponse: vi.fn(),
  validateSimBaseUrl: vi.fn(),
  SIM_DEFAULT_BASE_URL: 'https://sim.ai',
}))
vi.mock('~/pages/api/conversation', () => ({
  persistMessageServer: async () => {},
}))
vi.mock('~/pages/api/download', () => ({
  generatePresignedUrl: async () => null,
}))
vi.mock('~/pages/api/models', () => ({
  getModels: async () => ({
    OpenAI: {
      enabled: true,
      models: [
        { id: 'gpt-4o', enabled: true, default: true, tokenLimit: 128000 },
      ],
    },
  }),
}))
vi.mock('~/server/authorization', () => ({
  getCourseMetadata: async () => ({
    course_owner: 'demo@example.test',
    course_admins: [],
    system_prompt: 'You are the lab TA. Answer using course evidence.',
  }),
}))
vi.mock('~/pages/api/UIUC-api/getCourseMetadata', () => ({
  getCourseMetadata: async () => ({
    system_prompt: 'You are a helpful course TA.',
  }),
}))
vi.mock('~/utils/fetchContexts', () => ({
  fetchContextsByVectorEngine: async (project: string) => [
    {
      id: 1,
      text:
        project === 'lab_ta'
          ? 'Lab orientation is at 09:00. The meeting point is the north entrance.'
          : 'Course slide: the field trip takes place outdoors in Champaign. Ask the lab TA for the meeting time and the weather agent for rain precautions.',
      readable_filename:
        project === 'lab_ta' ? 'lab-orientation.pdf' : 'course-slides.pdf',
      pagenumber: '1',
      course_name: project,
      s3_path: 'demo/slide.pdf',
      url: '',
      base_url: '',
      'course_name ': project,
    },
  ],
}))
vi.mock('~/utils/server/toolRouting', () => ({
  callToolRouter: async ({
    tools,
  }: {
    tools: { function: { name: string } }[]
  }) => {
    const sequence = [
      { name: 'search_documents', args: { query: 'field trip' } },
      {
        name: 'ask_nlip_lab',
        args: { question: 'When and where do we meet for lab orientation?' },
      },
      {
        name: 'ask_nlip_weather',
        args: {
          question: 'Will it rain in Champaign? What should students bring?',
        },
      },
    ]
    const call = sequence[fixtures.step++]
    if (call && !tools.some((t) => t.function.name === call.name))
      throw new Error('Required tool was not advertised')
    return {
      ok: true,
      toolCalls: call
        ? [
            {
              id: `call-${fixtures.step}`,
              type: 'function',
              function: {
                name: call.name,
                arguments: JSON.stringify(call.args),
              },
            },
          ]
        : [],
    }
  },
}))
vi.mock('~/utils/streamProcessing', async (importOriginal) => {
  const actual = await importOriginal<typeof StreamProcessing>()
  return {
    ...actual,
    routeModelRequest: async (body: ChatBody) => {
      const prompt =
        body.conversation!.messages.at(-1)!.finalPromtEngineeredMessage ?? ''
      fixtures.prompts.push(prompt)
      if (!body.stream) {
        if (!prompt.includes('09:00'))
          throw new Error('Lab TA document evidence did not reach its model')
        return Response.json({
          choices: [
            {
              message: {
                content:
                  'Lab orientation starts at 09:00 at the north entrance (lab-orientation.pdf, page 1).',
              },
            },
          ],
        })
      }
      if (
        !prompt.includes('09:00') ||
        !prompt.includes('14 C') ||
        !prompt.includes('course-slides.pdf')
      )
        throw new Error(
          'Delegated answers or course evidence did not reach the final model',
        )
      return new Response(
        'Meet at the north entrance at 09:00. The course trip is outdoors in Champaign. The demo weather agent predicts rain and 14 C; bring a raincoat.',
      )
    },
  }
})

import inboundHandler from '~/pages/api/nlip/[course_name]'
import { runAgentConversation } from '~/server/agent/runAgentConversation'
import { saveNlipConfig } from '../config'
import { askNlipAgent } from '../client'
import { server as mockServer } from '~/test-utils/server'

async function listen(server: Server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return (server.address() as { port: number }).port
}

describe.skipIf(!process.env.NLIP_DEMO_PYTHON)(
  'live official NLIP interoperability demo',
  () => {
    let weather: ChildProcess
    let app: Server
    let weatherPort: number
    let appPort: number
    const exchanges: unknown[] = []
    beforeAll(async () => {
      mockServer.close() // This demo uses real loopback HTTP, without MSW handlers.
      // Bind the real Next API handler to a local HTTP harness. This is not a
      // Next browser deployment; it exercises the production handler unchanged.
      app = createServer(async (req, res) => {
        try {
          const chunks = []
          for await (const chunk of req) chunks.push(chunk)
          const body = JSON.parse(Buffer.concat(chunks).toString())
          const adapted = {
            method: req.method,
            headers: req.headers,
            body,
            query: { course_name: 'lab_ta' },
          } as unknown as NextApiRequest
          const response = {
            status(s: number) {
              res.statusCode = s
              return response
            },
            setHeader(k: string, v: string) {
              res.setHeader(k, v)
            },
            json(value: unknown) {
              exchanges.push({ request: body, response: value })
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(value))
              return response
            },
          }
          await inboundHandler(adapted, response as unknown as NextApiResponse)
        } catch {
          res.statusCode = 500
          res.end('demo harness failure')
        }
      })
      appPort = await listen(app)
      const allocator = createServer()
      weatherPort = await listen(allocator)
      await new Promise<void>((resolve) => allocator.close(() => resolve()))
      weather = spawn(
        process.env.NLIP_DEMO_PYTHON!,
        [
          path.resolve('scripts/nlip-demo/weather_agent.py'),
          '--port',
          String(weatherPort),
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      )
      let diagnostic = ''
      weather.stderr?.on('data', (data) => {
        diagnostic += data.toString()
      })
      let ready = false
      for (let attempt = 0; attempt < 80; attempt++) {
        if (weather.exitCode !== null) throw new Error(diagnostic)
        try {
          ready = (await fetch(`http://127.0.0.1:${weatherPort}/health/ready`))
            .ok
        } catch {
          /* starting */
        }
        if (ready) break
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      if (!ready)
        throw new Error(`Official NLIP server did not start: ${diagnostic}`)
      vi.stubEnv(
        'NLIP_ALLOWED_ORIGINS',
        `http://127.0.0.1:${weatherPort},http://127.0.0.1:${appPort}`,
      )
      vi.stubEnv('ENCRYPTION_MASTER_KEY', 'demo-only-test-master-key')
      await saveNlipConfig('lab_ta', {
        inboundEnabled: true,
        model: 'gpt-4o',
        agents: [],
      })
      await saveNlipConfig('course_slides', {
        inboundEnabled: false,
        agents: [
          {
            id: 'weather',
            name: 'Weather Agent',
            description: 'Ask for weather in Champaign and rain precautions.',
            endpoint: `http://127.0.0.1:${weatherPort}/nlip/`,
          },
          {
            id: 'lab',
            name: 'Lab TA',
            description:
              'Ask for lab orientation time and meeting place from lab documents.',
            endpoint: `http://127.0.0.1:${appPort}/api/nlip/lab_ta`,
            token: 'demo-fixture-api-key',
          },
        ],
      })
    }, 15000)
    afterAll(async () => {
      weather?.kill('SIGTERM')
      if (weather && weather.exitCode === null) await once(weather, 'exit')
      if (app) await new Promise<void>((resolve) => app.close(() => resolve()))
      vi.unstubAllEnvs()
    })
    it('course Agent retrieves slides, asks a second Illinois TA and official SDK weather Agent, then synthesizes both answers', async () => {
      expect(
        (
          await askNlipAgent(
            'course_slides',
            'lab',
            'When and where do we meet?',
          )
        ).text,
      ).toContain('09:00')
      const events: AgentStreamEvent[] = []
      const user = {
        id: 'user-1',
        role: 'user' as const,
        content:
          'For the Champaign field trip, when and where should I meet, and should I bring a raincoat?',
      }
      const conversation: Conversation = {
        id: 'demo-conversation',
        name: 'Course PDF chat',
        messages: [],
        model: {
          id: 'gpt-4o',
          name: 'GPT-4o',
          tokenLimit: 128000,
        } as Conversation['model'],
        prompt:
          'Use course documents and ask other agents for missing information.',
        temperature: 0.1,
        folderId: null,
        projectName: 'course_slides',
        agentModeEnabled: true,
      }
      const result = await runAgentConversation({
        conversation,
        courseName: 'course_slides',
        userMessage: user,
        documentGroups: ['All Documents'],
        courseMetadata: {
          system_prompt: 'You are a course TA.',
        } as CourseMetadata,
        llmProviders: {} as AllLLMProviders,
        openaiKey: '',
        toolRouter: {
          source: 'custom',
          provider: 'OpenAI',
          endpointUrl: 'http://fixture.invalid/chat/completions',
          apiKey: 'fixture-only',
          modelId: 'gpt-4o',
        },
        userIdentifier: 'demo@example.test',
        assistantMessageId: 'assistant-1',
        emit: (event) => events.push(event),
      })
      expect(result.success).toBe(true)
      expect(result.conversation.messages.at(-1)?.content).toContain('raincoat')
      expect(result.conversation.messages.at(-1)?.content).toContain('09:00')
      const tools = events.filter(
        (e) => e.type === 'tool' && e.status === 'done',
      )
      expect(tools).toHaveLength(2)
      expect(JSON.stringify(tools)).toContain('14 C')
      expect(JSON.stringify(tools)).toContain('north entrance')
      // Validate the Illinois response with the actual official SDK parser.
      const exchange = exchanges.at(-1) as { response: unknown }
      const checked = spawnSync(
        process.env.NLIP_DEMO_PYTHON!,
        [
          '-c',
          'import sys; from nlip_sdk.nlip import NLIP_Message; m=NLIP_Message.model_validate_json(sys.stdin.read()); assert m.extract_conversation_token(); assert "09:00" in m.extract_text(); print("Official SDK accepted Illinois NLIP response")',
        ],
        { input: JSON.stringify(exchange.response), encoding: 'utf8' },
      )
      expect(checked.status, checked.stderr).toBe(0)
      writeFileSync(
        path.join(tmpdir(), 'illinois-nlip-demo-result.json'),
        JSON.stringify(
          {
            runAt: new Date().toISOString(),
            profile: 'nlip-sdk 0.1.3 HTTP JSON',
            fixtures: [
              'LLM selection/generation',
              'document retrieval',
              'Redis storage',
              'API-key lookup',
            ],
            real: [
              'Illinois Agent Mode loop',
              'prompt builder',
              'NLIP tools',
              'Illinois inbound handler and RAG adapter',
              'HTTP transport',
              'official Python NLIP SDK/server',
            ],
            tools,
            finalAnswer: result.conversation.messages.at(-1)?.content,
            inboundExchanges: exchanges,
            sdkValidation: checked.stdout.trim(),
          },
          null,
          2,
        ),
      )
    }, 15000)
    it('propagates official SDK errors rather than inventing a successful response', async () => {
      await expect(
        askNlipAgent('course_slides', 'weather', 'Weather in an unknown city?'),
      ).rejects.toThrow(/protocol error/)
    })
  },
)
