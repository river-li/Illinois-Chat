import { MessagesSquare } from 'lucide-react'
import { Badge } from '~/components/shadcn/ui/badge'
import { Card } from '~/components/shadcn/ui/card'
import type { AgentEventStatus } from '~/types/chat'

export function nlipAgentName(toolName: string, readableName?: string) {
  return (
    readableName
      ?.replace(/^Ask /, '')
      .replace(/ \(NLIP\)$/, '')
      .trim() || toolName.replace(/^ask_nlip_/, '')
  )
}

export function nlipConversationStatus(status: AgentEventStatus) {
  if (status === 'error') return 'Request failed'
  if (status === 'done') return 'Reply received'
  return 'Waiting for reply'
}

interface NlipConversationProps {
  sourceProject?: string
  toolName: string
  readableName?: string
  question?: string
  reply?: string
  status: AgentEventStatus
  errorMessage?: string
}

/** Shared exchange view for Agent Mode and ordinary chat tool results. */
export function NlipConversation({
  sourceProject,
  toolName,
  readableName,
  question,
  reply,
  status,
  errorMessage,
}: NlipConversationProps) {
  const agent = nlipAgentName(toolName, readableName)
  return (
    <Card
      role="region"
      aria-label={`Conversation with ${agent}`}
      className="w-full min-w-0 space-y-3 rounded-lg border border-(--foreground-faded)/20 p-3 text-sm text-(--foreground)"
    >
      <div className="flex flex-wrap items-center gap-2">
        <MessagesSquare className="h-4 w-4 shrink-0" aria-hidden="true" />
        <h3 className="font-semibold">
          {sourceProject || 'This project'} → {agent}
        </h3>
        <Badge variant="secondary">NLIP</Badge>
        <span className="text-xs text-(--foreground-faded)">
          {nlipConversationStatus(status)}
        </span>
      </div>
      <div className="rounded-md bg-(--background-faded) p-3">
        <p className="mb-1 font-medium">Question to {agent}</p>
        <p className="break-words whitespace-pre-wrap">
          {question || 'No question was recorded.'}
        </p>
      </div>
      {status === 'done' && (
        <div className="rounded-md border border-(--foreground-faded)/20 p-3">
          <p className="mb-1 font-medium">Reply from {agent}</p>
          <p className="break-words whitespace-pre-wrap">
            {reply || 'No text reply was returned.'}
          </p>
        </div>
      )}
      {status === 'error' && (
        <p
          role="alert"
          className="break-words whitespace-pre-wrap text-red-500"
        >
          {errorMessage || 'The agent request failed.'}
        </p>
      )}
      {(status === 'pending' || status === 'running') && (
        <p className="text-(--foreground-faded)">Waiting for {agent}…</p>
      )}
    </Card>
  )
}
