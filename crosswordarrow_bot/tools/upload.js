// Uploads a generated series into the bot's puzzle pool and, with --retire, takes
// every other series out of rotation (games already started on them go on).
//   node tools/upload.js <series> [--retire]
// Uses `tgcloud run`, so it needs the project to be linked (npx tgcloud login).
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import JSON5 from 'json5'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const ADMIN_CTX = '{ initData: { user: { id: -1 } } }'
const BATCH = 10

function admin(input) {
  const out = execFileSync('npx', ['tgcloud', '--no-pager', 'run', 'endpoints/admin', JSON.stringify(input), '--ctx', ADMIN_CTX], {
    cwd: root, encoding: 'utf8', maxBuffer: 1 << 26,
  })
  const at = out.lastIndexOf('\n< ')
  if (at === -1) throw new Error(`unexpected output:\n${out}`)
  return JSON5.parse(out.slice(at + 3).replace(/\s+\d+ms\s*$/, ''))
}

const series = process.argv[2]
if (!series) throw new Error('usage: node tools/upload.js <series> [--retire]')
const puzzles = JSON.parse(fs.readFileSync(`${root}/data/puzzles/${series}.json`, 'utf8'))
let inserted = 0
let skipped = 0
for (let i = 0; i < puzzles.length; i += BATCH) {
  const res = admin({ action: 'import', puzzles: puzzles.slice(i, i + BATCH) })
  if (res.errors.length) throw new Error(`rejected: ${JSON.stringify(res.errors)}`)
  inserted += res.inserted
  skipped += res.skipped
  process.stdout.write(`\r${Math.min(i + BATCH, puzzles.length)}/${puzzles.length}`)
}
console.log(`\ninserted ${inserted}, already there ${skipped}`)
if (process.argv.includes('--retire')) console.log('retire:', admin({ action: 'retire', except: series }))
console.log(JSON.stringify(admin({ action: 'stats' }), null, 1))
