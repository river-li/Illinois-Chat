import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import NlipAgentsPanel from '../NlipAgentsPanel'

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <NlipAgentsPanel project="cs101" />
    </QueryClientProvider>,
  )
}
const saved = {
  inboundEnabled: true,
  model: 'gpt-4o',
  agents: [
    {
      id: 'weather',
      name: 'Weather',
      description: 'Ask about rain',
      endpoint: 'https://weather.example/nlip/',
      enabled: true,
      authMode: 'bearer',
      hasToken: true,
    },
  ],
}
describe('NLIP project Tools panel', () => {
  it('loads config and saves edits while keeping a blank stored credential out of the payload', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(saved))
      .mockResolvedValueOnce(Response.json(saved))
    mount()
    const token = await screen.findByLabelText(/Access token/)
    expect(
      screen.getByRole('link', { name: 'Open project chat' }),
    ).toHaveAttribute('href', '/cs101/chat')
    expect(token).toHaveAttribute('type', 'password')
    expect(token).toHaveValue('')
    fireEvent.click(
      screen.getByRole('button', { name: 'Save NLIP configuration' }),
    )
    await screen.findByRole('status')
    const payload = JSON.parse(fetch.mock.calls[1]![1]!.body as string)
    expect(payload.agents[0]).not.toHaveProperty('token')
    expect(payload.agents[0]).not.toHaveProperty('hasToken')
    expect(payload.inboundEnabled).toBe(true)
  })
  it('sends explicit null when the admin clears the saved token', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(saved))
      .mockResolvedValueOnce(Response.json(saved))
    mount()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Clear stored token on save' }),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Save NLIP configuration' }),
    )
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(
      JSON.parse(fetch.mock.calls[1]![1]!.body as string).agents[0].token,
    ).toBeNull()
  })
  it('shows configuration errors and prevents editing an unavailable config', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({ error: 'Admin access required' }, { status: 403 }),
    )
    mount()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Admin access required',
    )
    expect(
      screen.queryByRole('button', { name: 'Save NLIP configuration' }),
    ).toBeNull()
  })
})
