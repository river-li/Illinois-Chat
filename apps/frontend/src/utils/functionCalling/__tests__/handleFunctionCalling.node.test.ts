/* @vitest-environment node */

import { describe, expect, it, vi } from 'vitest'

vi.mock('~/utils/apiUtils', () => ({
  getBackendUrl: vi.fn(() => undefined),
}))

vi.mock('posthog-js', () => ({
  default: { capture: vi.fn() },
}))

describe('handleFunctionCalling (node)', () => {
  it('executes an NLIP tool through the project API with only its id and question', async () => {
    const { callSimFunction } = await import('../handleFunctionCalling')
    const output = {
      text: 'Orientation is at 09:00',
      data: { protocol: 'NLIP' },
    }
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ success: true, output }))
    const tool = {
      id: 'nlip:lab',
      name: 'ask_nlip_lab',
      readableName: 'Ask Lab TA (NLIP)',
      description: 'Ask for lab details',
      aiGeneratedArgumentValues: {
        question: 'When is orientation?',
        endpoint: 'http://ignored',
      },
    }

    expect(await callSimFunction(tool, 'course_slides')).toEqual(output)
    expect(fetch).toHaveBeenCalledWith(
      '/api/UIUC-api/tools/nlipTools?course_name=course_slides',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ id: 'lab', question: 'When is orientation?' }),
      }),
    )
  })

  it('propagates NLIP execution failures instead of returning successful tool evidence', async () => {
    const { callSimFunction } = await import('../handleFunctionCalling')
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({ error: 'NLIP agent unavailable' }, { status: 502 }),
    )
    await expect(
      callSimFunction(
        {
          id: 'nlip:lab',
          name: 'ask_nlip_lab',
          readableName: 'Lab',
          description: 'Lab',
          aiGeneratedArgumentValues: { question: 'When?' },
        },
        'course_slides',
      ),
    ).rejects.toThrow('NLIP agent unavailable')
  })

  it('fetchSimTools returns [] when course_name is missing', async () => {
    const { fetchSimTools } = await import('../handleFunctionCalling')
    await expect(fetchSimTools()).resolves.toEqual([])
  })

  it('fetchSimTools refuses to run server-side instead of reporting no tools', async () => {
    const { fetchSimTools } = await import('../handleFunctionCalling')
    // It fetches a relative URL, which has no base on the server. Returning []
    // here is what made the public chat API look like a project with no tools;
    // failing loudly points the caller at fetchToolsServer instead.
    await expect(fetchSimTools('proj')).rejects.toThrow(/browser-only/i)
  })

  it('handleToolCall skips tools missing invocationId', async () => {
    const { handleToolCall } = await import('../handleFunctionCalling')
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const tool: any = {
      id: 'w1',
      name: 't',
      readableName: 'Tool',
      description: 'd',
      aiGeneratedArgumentValues: { a: 1 },
    }
    const conversation: any = {
      id: 'c1',
      messages: [{ id: 'm1', role: 'user', content: 'hi', tools: [tool] }],
    }

    await handleToolCall([tool], conversation, 'proj', 'http://localhost')
    expect(conversation.messages[0].tools[0].output).toBeUndefined()
  })

  it('handleToolCall skips when last message has no tools array', async () => {
    const { handleToolCall } = await import('../handleFunctionCalling')
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const tool: any = {
      id: 'w1',
      invocationId: 'inv1',
      name: 't',
      readableName: 'Tool',
      description: 'd',
      aiGeneratedArgumentValues: { a: 1 },
    }
    const conversation: any = {
      id: 'c1',
      messages: [{ id: 'm1', role: 'user', content: 'hi' }],
    }

    await handleToolCall([tool], conversation, 'proj', 'http://localhost')
    expect(conversation.messages[0].tools).toBeUndefined()
  })

  it('handleToolCall skips when invocationId not found in last message tools', async () => {
    const { handleToolCall } = await import('../handleFunctionCalling')
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const tool: any = {
      id: 'w1',
      invocationId: 'inv1',
      name: 't',
      readableName: 'Tool',
      description: 'd',
      aiGeneratedArgumentValues: { a: 1 },
    }
    const conversation: any = {
      id: 'c1',
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: 'hi',
          tools: [{ ...tool, invocationId: 'other' }],
        },
      ],
    }

    await handleToolCall([tool], conversation, 'proj', 'http://localhost')
    expect(conversation.messages[0].tools[0].output).toBeUndefined()
  })

  it('handleToolCall sets error when callSimFunction throws (no api key on server)', async () => {
    const { handleToolCall } = await import('../handleFunctionCalling')
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const tool: any = {
      id: 'w1',
      invocationId: 'inv1',
      name: 't',
      readableName: 'Tool',
      description: 'd',
      aiGeneratedArgumentValues: { a: 1 },
    }
    const conversation: any = {
      id: 'c1',
      messages: [{ id: 'm1', role: 'user', content: 'hi', tools: [tool] }],
    }

    await handleToolCall([tool], conversation, 'proj', 'http://localhost')
    expect(conversation.messages[0].tools[0].error).toMatch(
      /Error running tool/i,
    )
  })

  it('handleToolCall populates tool output via runSimWorkflow on success', async () => {
    const { handleToolCall } = await import('../handleFunctionCalling')

    const storage: Record<string, string> = { sim_api_key_proj: 'sk-sim-test' }
    const mockLocalStorage = { getItem: (k: string) => storage[k] ?? null }
    vi.stubGlobal('window', { localStorage: mockLocalStorage })
    vi.stubGlobal('localStorage', mockLocalStorage)

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, output: 'hello' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const tool: any = {
      id: 'w1',
      invocationId: 'inv1',
      name: 'sim_t',
      readableName: 'Tool',
      description: 'd',
      aiGeneratedArgumentValues: { a: 1 },
    }
    const conversation: any = {
      id: 'c1',
      messages: [{ id: 'm1', role: 'user', content: 'hi', tools: [tool] }],
    }

    await handleToolCall([tool], conversation, 'proj', 'http://localhost')
    expect(conversation.messages[0].tools[0].output).toEqual({ text: 'hello' })

    vi.unstubAllGlobals()
  })

  it('handleToolCall sets error when runSimWorkflow returns success=false', async () => {
    const { handleToolCall } = await import('../handleFunctionCalling')
    vi.spyOn(console, 'error').mockImplementation(() => {})

    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => {
          if (key === 'sim_api_key_proj') return 'sk-sim-test'
          return null
        },
      },
    })

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: false, error: 'workflow failed' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    const tool: any = {
      id: 'w1',
      invocationId: 'inv1',
      name: 'sim_t',
      readableName: 'Tool',
      description: 'd',
      aiGeneratedArgumentValues: {},
    }
    const conversation: any = {
      id: 'c1',
      messages: [{ id: 'm1', role: 'user', content: 'hi', tools: [tool] }],
    }

    await handleToolCall([tool], conversation, 'proj', 'http://localhost')
    expect(conversation.messages[0].tools[0].error).toMatch(
      /Error running tool/i,
    )

    vi.unstubAllGlobals()
  })

  it('handleToolCall sets error when runSimWorkflow HTTP response is not ok', async () => {
    const { handleToolCall } = await import('../handleFunctionCalling')
    vi.spyOn(console, 'error').mockImplementation(() => {})

    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => {
          if (key === 'sim_api_key_proj') return 'sk-sim-test'
          return null
        },
      },
    })

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'bad input' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const tool: any = {
      id: 'w1',
      invocationId: 'inv1',
      name: 'sim_t',
      readableName: 'Tool',
      description: 'd',
      aiGeneratedArgumentValues: {},
    }
    const conversation: any = {
      id: 'c1',
      messages: [{ id: 'm1', role: 'user', content: 'hi', tools: [tool] }],
    }

    await handleToolCall([tool], conversation, 'proj', 'http://localhost')
    expect(conversation.messages[0].tools[0].error).toMatch(
      /Error running tool/i,
    )

    vi.unstubAllGlobals()
  })
})
