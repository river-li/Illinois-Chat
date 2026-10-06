import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AgentExecutionTimeline } from '../AgentExecutionTimeline'
import { type AgentEvent } from '@/types/chat'
import userEvent from '@testing-library/user-event'

const baseTime = '2026-03-09T20:00:00.000Z'

const makeRetrievalEvent = (
  overrides: Partial<AgentEvent> = {},
): AgentEvent => ({
  id: 'agent-step-1-retrieval-0',
  stepNumber: 1,
  type: 'retrieval',
  status: 'done',
  title: 'Searching documents',
  createdAt: baseTime,
  updatedAt: '2026-03-09T20:00:03.000Z',
  metadata: {
    contextQuery: 'transformers',
    contextsRetrieved: 6,
  },
  ...overrides,
})

const makeFinalResponseEvent = (
  overrides: Partial<AgentEvent> = {},
): AgentEvent => ({
  id: 'agent-final-response',
  stepNumber: 2,
  type: 'final_response',
  status: 'running',
  title: 'Generating response',
  createdAt: '2026-03-09T20:00:04.000Z',
  ...overrides,
})

describe('AgentExecutionTimeline', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows remote agents in the collapsed timeline and their questions/replies when expanded', async () => {
    const user = userEvent.setup()
    const events: AgentEvent[] = [
      {
        id: 'lab-call',
        stepNumber: 2,
        type: 'tool',
        status: 'done',
        title: 'Ask Lab TA (NLIP)',
        createdAt: baseTime,
        metadata: {
          toolName: 'ask_nlip_lab',
          readableToolName: 'Ask Lab TA (NLIP)',
          arguments: { question: 'When and where should we meet?' },
          outputText: '09:00 at the north entrance.\n{"citations":["slide 1"]}',
          outputData: { nlipReplyText: '09:00 at the north entrance.' },
        },
      },
      {
        id: 'weather-call',
        stepNumber: 3,
        type: 'tool',
        status: 'running',
        title: 'Ask Weather Agent (NLIP)',
        createdAt: baseTime,
        metadata: {
          toolName: 'ask_nlip_weather',
          readableToolName: 'Ask Weather Agent (NLIP)',
          arguments: { question: 'Will it rain in Champaign?' },
        },
      },
    ]
    render(
      <AgentExecutionTimeline events={events} projectName="course_slides" />,
    )
    expect(screen.getByText('2 agent conversations')).toBeInTheDocument()
    expect(screen.getByText('Lab TA · Reply received')).toBeInTheDocument()
    expect(
      screen.getByText('Weather Agent · Waiting for reply'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Agent reasoning/ }))
    expect(
      await screen.findByRole('region', { name: 'Conversation with Lab TA' }),
    ).toHaveTextContent('course_slides → Lab TA')
    expect(
      screen.getByText('When and where should we meet?'),
    ).toBeInTheDocument()
    expect(screen.getByText('09:00 at the north entrance.')).toBeInTheDocument()
    expect(screen.queryByText(/"citations"/)).not.toBeInTheDocument()
    expect(screen.getByText('Waiting for Weather Agent…')).toBeInTheDocument()
  })

  it('keeps a failed question visible and does not display a stale reply as successful', async () => {
    const user = userEvent.setup()
    render(
      <AgentExecutionTimeline
        events={[
          {
            id: 'failed-call',
            stepNumber: 1,
            type: 'tool',
            status: 'error',
            title: 'Ask Weather Agent (NLIP)',
            createdAt: baseTime,
            metadata: {
              toolName: 'ask_nlip_weather',
              readableToolName: 'Ask Weather Agent (NLIP)',
              arguments: { question: 'Will it rain?' },
              outputText: 'stale forecast',
              errorMessage: 'NLIP agent timed out',
            },
          },
        ]}
      />,
    )
    expect(
      screen.getByText('Weather Agent · Request failed'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Agent reasoning/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'NLIP agent timed out',
    )
    expect(screen.getByText('Will it rain?')).toBeInTheDocument()
    expect(screen.queryByText('stale forecast')).not.toBeInTheDocument()
    expect(
      screen.queryByText('Reply from Weather Agent'),
    ).not.toBeInTheDocument()
  })

  it('shows completed retrieval status for persisted chats without a final response event', () => {
    const events: AgentEvent[] = [
      {
        id: 'agent-initializing',
        stepNumber: 0,
        type: 'initializing',
        status: 'done',
        title: 'Initializing agent...',
        createdAt: baseTime,
        updatedAt: baseTime,
      },
      makeRetrievalEvent(),
    ]

    render(<AgentExecutionTimeline events={events} />)

    expect(screen.getByText('6 chunks retrieved')).toBeInTheDocument()
    expect(
      screen.queryByText('6 chunks retrieved so far'),
    ).not.toBeInTheDocument()
  })

  it('marks retrieval work complete once final response generation starts', () => {
    const events: AgentEvent[] = [
      makeRetrievalEvent(),
      makeFinalResponseEvent(),
    ]

    render(<AgentExecutionTimeline events={events} />)

    expect(screen.getByText('6 chunks retrieved')).toBeInTheDocument()
    expect(screen.queryByText('Active')).not.toBeInTheDocument()
  })

  it('keeps the timeline active between visible agent steps when the run is still in progress', () => {
    render(<AgentExecutionTimeline events={[makeRetrievalEvent()]} isRunning />)

    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('6 chunks so far')).toBeInTheDocument()
    expect(screen.queryByText('6 chunks retrieved')).not.toBeInTheDocument()
  })

  it('freezes elapsed time once agent work completes even if final response updates later', () => {
    vi.useFakeTimers()

    const { rerender } = render(
      <AgentExecutionTimeline
        events={[makeRetrievalEvent(), makeFinalResponseEvent()]}
      />,
    )

    expect(screen.getByText('3s')).toBeInTheDocument()

    rerender(
      <AgentExecutionTimeline
        events={[
          makeRetrievalEvent(),
          makeFinalResponseEvent({
            status: 'done',
            title: 'Done',
            updatedAt: '2026-03-09T20:00:12.000Z',
          }),
        ]}
      />,
    )

    expect(screen.getByText('3s')).toBeInTheDocument()
    expect(screen.queryByText('12s')).not.toBeInTheDocument()
  })
})
