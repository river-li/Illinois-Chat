import { ProviderNames, type OpenAICompatibleProvider } from '../LLMProvider'
import {
  OpenAICompatibleModels,
  type OpenAICompatibleModel,
} from '../types/openaiCompatible'
import { isCountryOfConcern } from '../countriesOfConcern'
import { decryptKeyIfNeeded } from '~/utils/crypto'

interface ModelResponse {
  id: string
  object?: string
  created?: number
  owned_by?: string
}

interface ModelsApiResponse {
  data?: ModelResponse[]
}

const UNKNOWN_MODEL_TOKEN_LIMIT = 128_000

function isEmbeddingModelId(id: string): boolean {
  return /embed/i.test(id)
}

function catalogByLowerId(): Map<string, OpenAICompatibleModel> {
  return new Map(
    Object.values(OpenAICompatibleModels).map((model) => [
      model.id.toLowerCase(),
      model,
    ]),
  )
}

function resolveEndpointModel(
  availableId: string,
  catalog: Map<string, OpenAICompatibleModel>,
  existing: OpenAICompatibleModel[] | undefined,
): OpenAICompatibleModel | null {
  const id = availableId.trim()
  if (!id || isEmbeddingModelId(id)) return null

  const known = catalog.get(id.toLowerCase())
  const existingModel = existing?.find(
    (model) => model.id.toLowerCase() === id.toLowerCase(),
  )
  const flagged = isCountryOfConcern(known?.id ?? id)

  if (known) {
    return {
      ...known,
      enabled: existingModel?.enabled ?? (flagged ? false : known.enabled),
      default: existingModel?.default ?? known.default,
    }
  }

  return {
    id,
    name: id,
    tokenLimit: existingModel?.tokenLimit ?? UNKNOWN_MODEL_TOKEN_LIMIT,
    enabled: existingModel?.enabled ?? !flagged,
    default: existingModel?.default ?? false,
  }
}

export const getOpenAICompatibleModels = async (
  openAICompatibleProvider: OpenAICompatibleProvider,
): Promise<OpenAICompatibleProvider> => {
  try {
    delete openAICompatibleProvider.error
    openAICompatibleProvider.provider = ProviderNames.OpenAICompatible

    // Validate baseUrl includes /v1
    if (
      openAICompatibleProvider.baseUrl &&
      !openAICompatibleProvider.baseUrl.includes('/v1')
    ) {
      openAICompatibleProvider.error =
        'Base URL must include /v1. For example: https://api.example.com/v1'
      openAICompatibleProvider.models = []
      return openAICompatibleProvider
    }

    // If provider is disabled or missing required fields, return empty models
    if (
      !openAICompatibleProvider.enabled ||
      !openAICompatibleProvider.apiKey ||
      !openAICompatibleProvider.baseUrl
    ) {
      openAICompatibleProvider.models = []
      return openAICompatibleProvider
    }

    // Fetch available models from the endpoint
    const decryptedKey = await decryptKeyIfNeeded(
      openAICompatibleProvider.apiKey,
    )
    const modelsUrl = `${openAICompatibleProvider.baseUrl}/models`

    let availableModelIds: string[] = []

    try {
      const response = await fetch(modelsUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${decryptedKey}`,
        },
      })

      if (!response.ok) {
        throw new Error(
          `Failed to fetch models: ${response.status} ${response.statusText}`,
        )
      }

      const data = (await response.json()) as
        | ModelsApiResponse
        | ModelResponse[]
      // Handle both OpenAI-compatible format (data.data) and direct array format
      const modelsData = Array.isArray(data) ? data : data.data
      if (Array.isArray(modelsData)) {
        availableModelIds = modelsData.map((model: ModelResponse) => model.id)
      } else {
        throw new Error('Unexpected response format from models endpoint')
      }
    } catch (fetchError: unknown) {
      console.warn(
        'Error fetching models from OpenAI-compatible endpoint:',
        fetchError,
      )
      // If fetching fails, show no models and set error message
      const errorMessage =
        fetchError instanceof Error ? fetchError.message : 'Unknown error'
      openAICompatibleProvider.error =
        errorMessage || 'Failed to fetch available models from endpoint.'
      // Return empty models array when fetch fails
      openAICompatibleProvider.models = []
      return openAICompatibleProvider
    }

    // The endpoint is the source of truth (LiteLLM, vLLM, Ollama /v1, etc.).
    // Catalog entries only supply display names and token limits for known IDs.
    const catalog = catalogByLowerId()
    const seen = new Set<string>()
    const compatibleModels: OpenAICompatibleModel[] = []
    for (const availableId of availableModelIds) {
      if (typeof availableId !== 'string') continue
      const resolved = resolveEndpointModel(
        availableId,
        catalog,
        openAICompatibleProvider.models,
      )
      if (!resolved) continue
      const key = resolved.id.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      compatibleModels.push(resolved)
    }

    openAICompatibleProvider.models = compatibleModels
    return openAICompatibleProvider
  } catch (error: unknown) {
    console.warn('Error fetching OpenAI-compatible models:', error)
    openAICompatibleProvider.error =
      error instanceof Error ? error.message : 'Failed to load models'
    openAICompatibleProvider.models = []
    return openAICompatibleProvider
  }
}
