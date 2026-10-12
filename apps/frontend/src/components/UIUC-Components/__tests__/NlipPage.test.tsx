import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import { renderWithProviders } from '~/test-utils/renderWithProviders'
import NlipPage from '../NlipPage'

function makeJson(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function authorize() {
  globalThis.__TEST_ROUTER__ = { asPath: '/CS101/nlip', replace: vi.fn() }
  globalThis.__TEST_AUTH__ = {
    isLoading: false,
    isAuthenticated: true,
    user: { profile: { email: 'owner@example.com' } },
  }
}

const courseMetadata = {
  course_metadata: {
    is_private: false,
    course_owner: 'owner@example.com',
    course_admins: [],
    project_description: 'desc',
  },
}

const nlipConfig = {
  inboundEnabled: false,
  model: '',
  agents: [],
}

describe('NlipPage', () => {
  it('renders NLIP configuration as its own settings page, not Sim AI', async () => {
    authorize()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      const url = String(input?.url ?? input)
      if (url.includes('getCourseMetadata')) return makeJson(courseMetadata)
      if (url.includes('nlipAgents')) return makeJson(nlipConfig)
      return makeJson({})
    })

    renderWithProviders(<NlipPage course_name="CS101" />)

    expect(
      await screen.findByRole('heading', { name: 'NLIP Agents' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/independent of Sim AI workflows/i),
    ).toBeInTheDocument()
    expect(
      await screen.findByRole('button', { name: 'Save NLIP configuration' }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('table', { name: 'Deployed Sim AI workflows' }),
    ).not.toBeInTheDocument()
  })
})
