// Maintenance, reachable only through `npx tgcloud run endpoints/admin ... --ctx`
// (see lib/config.js): import puzzles, retire old series, look at the numbers.
import { db, EndpointError } from 'sdk'
import { sql } from 'sdk/db'
import { puzzles } from '../schema.js'
import { validatePuzzle } from '../lib/core.js'
import { ADMIN_USER_ID } from '../lib/config.js'

export default async function (input, ctx) {
  if (ctx.initData?.user?.id !== ADMIN_USER_ID) throw new EndpointError('Forbidden', { code: 'FORBIDDEN' })
  if (input.action === 'import') return importPuzzles(Array.isArray(input.puzzles) ? input.puzzles : [])
  if (input.action === 'retire') return retire(String(input.except ?? ''))
  if (input.action === 'stats') return stats()
  if (input.action === 'abandon') return abandon()
  throw new EndpointError('Unknown action', { code: 'BAD_ACTION' })
}

async function importPuzzles(list) {
  let inserted = 0
  let skipped = 0
  const errors = []
  for (const p of list) {
    const problems = validatePuzzle(p)
    if (problems.length || typeof p?.slug !== 'string') {
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

// Retires every puzzle whose slug does not start with `<except>-`.
async function retire(except) {
  if (!/^[a-z0-9]+$/.test(except)) throw new EndpointError('Give the series to keep', { code: 'BAD_SERIES' })
  const keep = (await db.get(sql`SELECT count(*) AS n FROM puzzles WHERE slug LIKE ${except + '-%'}`)).n
  if (!keep) throw new EndpointError('That series has no puzzles', { code: 'EMPTY_SERIES' })
  const res = await db.run(sql`UPDATE puzzles SET retired = 1 WHERE retired = 0 AND slug NOT LIKE ${except + '-%'}`)
  return { retired: res.rowsAffected, live: keep }
}

// Closes every unfinished game; the chats start from scratch with their next /play.
async function abandon() {
  const res = await db.run(sql`UPDATE games SET status = 'abandoned' WHERE status = 'active'`)
  await db.run(sql`DELETE FROM presence WHERE game_id IN (SELECT id FROM games WHERE status = 'abandoned')`)
  return { abandoned: res.rowsAffected }
}

async function stats() {
  return {
    puzzles: await db.all(sql`SELECT substr(slug, 1, instr(slug, '-') - 1) AS series, retired, count(*) AS n
      FROM puzzles GROUP BY 1, 2 ORDER BY min(id)`),
    games: await db.all(sql`SELECT status, count(*) AS n, count(DISTINCT chat_id) AS chats FROM games GROUP BY status`),
    players: (await db.get(sql`SELECT count(DISTINCT user_id) AS n FROM players`)).n,
  }
}
