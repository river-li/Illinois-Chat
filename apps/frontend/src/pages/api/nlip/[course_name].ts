import { randomUUID } from 'node:crypto'
import type { NextApiRequest, NextApiResponse } from 'next'
import { and, eq } from 'drizzle-orm'
import { apiKeys, db } from '~/db/dbClient'
import { getCourseMetadata } from '~/server/authorization'
import { readNlipConfig } from '~/server/nlip/config'
import { answerProjectQuestion } from '~/server/nlip/answerProject'
import {
  nlipMessageSchema,
  nlipQuestion,
  nlipText,
  nlipToken,
} from '~/types/nlip'

export const config = {
  api: { bodyParser: { sizeLimit: '64kb' } },
  maxDuration: 60,
}

// HTTP JSON text profile; conversation tokens correlate independent questions.
// They never select a saved UI conversation or grant access to its contents.
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  let conversation: string | undefined
  const fail = (status: number, content: string) =>
    res.status(status).json({
      format: 'error',
      subformat: 'text',
      content,
      ...(conversation
        ? {
            submessages: [
              {
                format: 'token',
                subformat: 'conversation',
                content: conversation,
              },
            ],
          }
        : {}),
    })
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return fail(405, 'Method not allowed')
  }
  const project = req.query.course_name
  if (typeof project !== 'string' || !project)
    return fail(400, 'Project name is required')
  const parsed = nlipMessageSchema.safeParse(req.body)
  if (!parsed.success) return fail(400, 'Invalid NLIP message')
  let question: string
  let apiKey: string | undefined
  try {
    question = nlipQuestion(parsed.data)
    conversation = nlipToken(parsed.data, 'conversation')
    const token = nlipToken(parsed.data, 'authorization')
    const header = req.headers.authorization
    const bearer = header?.match(/^Bearer (\S+)$/i)?.[1]
    if (header && !bearer) return fail(401, 'Expected Bearer authorization')
    if (token && bearer && token !== bearer)
      return fail(401, 'Conflicting authorization credentials')
    apiKey = bearer ?? token
  } catch {
    return fail(
      422,
      'Expected a text question with optional conversation and authorization tokens',
    )
  }
  if (!apiKey) return fail(401, 'An Illinois Chat API key is required')
  try {
    // Reuse active Illinois Chat API keys without copying their values into
    // telemetry. The existing public chat API requires project edit access.
    const [key] = await db
      .select({ email: apiKeys.email })
      .from(apiKeys)
      .where(and(eq(apiKeys.key, apiKey), eq(apiKeys.is_active, true)))
      .limit(1)
    if (!key?.email) return fail(401, 'Invalid API key')
    const metadata = await getCourseMetadata(project)
    if (!metadata) return fail(404, 'Project not found')
    if (
      metadata.is_frozen ||
      (metadata.course_owner !== key.email &&
        !metadata.course_admins?.includes(key.email))
    )
      return fail(403, 'Project owner or admin access is required')
    const settings = await readNlipConfig(project)
    if (!settings.inboundEnabled)
      return fail(403, 'NLIP inbound access is disabled for this project')
    const answer = await answerProjectQuestion(
      project,
      question,
      key.email,
      metadata,
      settings.model,
    )
    const result = nlipText(answer.text, conversation ?? randomUUID())
    result.submessages!.push({
      format: 'structured',
      subformat: 'JSON',
      label: 'citations',
      content: { citations: answer.citations },
    })
    return res.status(200).json(result)
  } catch {
    return fail(
      503,
      'Could not answer using this project; check its services and model configuration',
    )
  }
}
