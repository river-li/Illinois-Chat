import { describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  decryptKeyIfNeeded: vi.fn(async (k: string) => `dec:${k}`),
}))

vi.mock('~/utils/crypto', () => ({
  decryptKeyIfNeeded: hoisted.decryptKeyIfNeeded,
}))

import { getOpenAICompatibleModels } from '../openaiCompatible'
import { OpenAICompatibleModelID } from '../../types/openaiCompatible'

describe('getOpenAICompatibleModels', () => {
  it('requires baseUrl to include /v1', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const provider: any = {
      enabled: true,
      apiKey: 'k',
      baseUrl: 'https://api.example.com',
      models: [],
    }

    const result = await getOpenAICompatibleModels(provider)
    expect(result.models).toEqual([])
    expect(result.error).toMatch(/include \/v1/i)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns empty models when disabled or missing fields', async () => {
    const provider: any = {
      enabled: false,
      apiKey: '',
      baseUrl: '',
      models: [{ id: 'x' }],
    }
    const result = await getOpenAICompatibleModels(provider)
    expect(result.models).toEqual([])
  })

  it('lists models returned by the endpoint even when they are not in the catalog', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            { id: 'gpt-4o' },
            { id: 'my-litellm-proxy/gemma-3-12b' },
            { id: 'text-embedding-3-small' },
            { id: '  ' },
          ],
        }),
        { status: 200 },
      ),
    )

    const provider: any = {
      enabled: true,
      apiKey: 'sk-litellm',
      baseUrl: 'http://127.0.0.1:4000/v1',
      models: [
        {
          id: 'my-litellm-proxy/gemma-3-12b',
          enabled: true,
          default: true,
        },
      ],
    }

    const result = await getOpenAICompatibleModels(provider)
    const ids = result.models?.map((m: { id: string }) => m.id)
    expect(ids).toContain('my-litellm-proxy/gemma-3-12b')
    expect(ids).not.toContain('text-embedding-3-small')
    expect(
      result.models?.find(
        (m: { id: string }) => m.id === 'my-litellm-proxy/gemma-3-12b',
      ),
    ).toMatchObject({
      name: 'my-litellm-proxy/gemma-3-12b',
      tokenLimit: 128000,
      enabled: true,
      default: true,
    })
  })

  it('includes a locally pulled Ollama chat model when the endpoint lists it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: 'qwen3.5:9b' }] }), {
        status: 200,
      }),
    )

    const provider: any = {
      enabled: true,
      apiKey: 'ollama',
      baseUrl: 'http://host.docker.internal:11434/v1',
      models: [],
    }

    const result = await getOpenAICompatibleModels(provider)
    expect(result.models?.map((m: { id: string }) => m.id)).toContain(
      OpenAICompatibleModelID.Ollama_Qwen35_9B,
    )
  })

  it('filters to only endpoint-available models (case-insensitive) and preserves states', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: 'OPENAI/GPT-4O' }] }), {
        status: 200,
      }),
    )

    const provider: any = {
      enabled: true,
      apiKey: 'k',
      baseUrl: 'https://openrouter.ai/api/v1',
      models: [
        { id: OpenAICompatibleModelID.GPT_4o, enabled: false, default: true },
      ],
    }

    const result = await getOpenAICompatibleModels(provider)
    const models = result.models ?? []
    expect(models).toHaveLength(1)
    expect(models[0]).toMatchObject({
      id: OpenAICompatibleModelID.GPT_4o,
      enabled: false,
      default: true,
    })
  })

  it('sets error and clears models when fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('nope', { status: 500, statusText: 'fail' }),
    )

    const provider: any = {
      enabled: true,
      apiKey: 'k',
      baseUrl: 'https://openrouter.ai/api/v1',
      models: [{ id: OpenAICompatibleModelID.GPT_4o }],
    }

    const result = await getOpenAICompatibleModels(provider)
    expect(result.models).toEqual([])
    expect(result.error).toMatch(/failed to fetch models/i)
  })

  it('returns empty models when endpoint returns an empty list', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    )

    const provider: any = {
      enabled: true,
      apiKey: 'k',
      baseUrl: 'https://openrouter.ai/api/v1',
      models: [{ id: OpenAICompatibleModelID.GPT_4o, enabled: true }],
    }

    const result = await getOpenAICompatibleModels(provider)
    expect(result.models).toEqual([])
    expect(result.error).toBeUndefined()
  })

  it('sets error when models endpoint returns an unexpected format', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    )

    const provider: any = {
      enabled: true,
      apiKey: 'k',
      baseUrl: 'https://openrouter.ai/api/v1',
      models: [],
    }

    const result = await getOpenAICompatibleModels(provider)
    expect(result.models).toEqual([])
    expect(result.error).toMatch(/unexpected response format/i)
  })

  it('uses a fallback error message when error.message is empty', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error(''))

    const provider: any = {
      enabled: true,
      apiKey: 'k',
      baseUrl: 'https://openrouter.ai/api/v1',
      models: [],
    }

    const result = await getOpenAICompatibleModels(provider)
    expect(result.models).toEqual([])
    expect(result.error).toMatch(/failed to fetch available models/i)
  })

  it('uses "Unknown error" when fetch throws a non-Error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce('boom')

    const provider: any = {
      enabled: true,
      apiKey: 'k',
      baseUrl: 'https://openrouter.ai/api/v1',
      models: [],
    }

    const result = await getOpenAICompatibleModels(provider)
    expect(result.models).toEqual([])
    expect(result.error).toBe('Unknown error')
  })

  it('handles outer errors and clears models', async () => {
    hoisted.decryptKeyIfNeeded.mockRejectedValueOnce(new Error('badkey'))

    const provider: any = {
      enabled: true,
      apiKey: 'k',
      baseUrl: 'https://openrouter.ai/api/v1',
      models: [{ id: OpenAICompatibleModelID.GPT_4o }],
    }

    const result = await getOpenAICompatibleModels(provider)
    expect(result.models).toEqual([])
    expect(result.error).toMatch(/badkey/i)
  })
})
