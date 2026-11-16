import { db, EndpointError } from 'sdk'
import { puzzles } from '../schema.js'
import { validatePuzzle } from '../lib/core.js'
import { ADMIN_USER_ID } from '../lib/config.js'

export default async function (input, ctx) {
  if (ctx.initData?.user?.id !== ADMIN_USER_ID) throw new EndpointError('Forbidden', { code: 'FORBIDDEN' })
  const list = Array.isArray(input.puzzles) ? input.puzzles : []
  let inserted = 0
  let skipped = 0
  const errors = []
  for (const p of list) {
    const problems = validatePuzzle(p)
    if (problems.length || typeof p.slug !== 'string') {
      errors.push({ slug: p?.slug ?? null, problems: problems.slice(0, 5) })
      continue
    }
    const res = await db.insert(puzzles)
      .values({ slug: p.slug, width: p.width, height: p.height, data: p, createdAt: Math.floor(Date.now() / 1000) })
      .onConflictDoNothing({ target: puzzles.slug })
    if (res.rowsAffected) inserted++
    else skipped++
  }
  return { inserted, skipped, errors }
}
