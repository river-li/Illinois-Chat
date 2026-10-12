import type { NextApiResponse } from 'next'
import { withAuth, type AuthenticatedRequest } from '~/utils/authMiddleware'
import {
  getCourseMetadata,
  isCourseAdmin,
  isCourseOwner,
} from '~/server/authorization'
import { nlipConfigInputSchema } from '~/types/nlip'
import {
  readNlipConfig,
  publicNlipConfig,
  saveNlipConfig,
  validateNlipEndpoint,
} from '~/server/nlip/config'

export const config = { api: { bodyParser: { sizeLimit: '128kb' } } }
export async function handler(req: AuthenticatedRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  const project = req.query.course_name
  if (typeof project !== 'string' || !project)
    return res.status(400).json({ error: 'course_name is required' })
  const metadata = await getCourseMetadata(project)
  if (!metadata) return res.status(404).json({ error: 'Project not found' })
  if (
    !req.user ||
    metadata.is_frozen ||
    (!isCourseAdmin(req.user, metadata) && !isCourseOwner(req.user, metadata))
  )
    return res
      .status(403)
      .json({ error: 'Project owner or admin access is required' })
  try {
    if (req.method === 'GET')
      return res.json(publicNlipConfig(await readNlipConfig(project)))
    const parsed = nlipConfigInputSchema.safeParse(req.body)
    if (!parsed.success)
      return res.status(400).json({
        error:
          'Invalid NLIP configuration: use unique lowercase agent IDs and complete descriptions',
      })
    try {
      parsed.data.agents.forEach((a) => validateNlipEndpoint(a.endpoint))
    } catch {
      return res.status(400).json({
        error:
          'Endpoint must use an origin in NLIP_ALLOWED_ORIGINS and have no URL credentials, query or fragment',
      })
    }
    return res.json(
      publicNlipConfig(await saveNlipConfig(project, parsed.data)),
    )
  } catch {
    return res.status(503).json({
      error:
        'Could not read or save NLIP configuration; check Redis and ENCRYPTION_MASTER_KEY',
    })
  }
}
export default withAuth(handler)
