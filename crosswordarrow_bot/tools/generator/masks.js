// Builds a pool of layouts: node tools/generator/masks.js <count> [width] [height] [seed]
// Annealing is slow, so the work is spread over all CPU cores.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { generateMask, mulberry32 } from './mask.js'

const file = new URL(import.meta.url).pathname
const OUT = process.env.MASK_OUT ?? path.join(path.dirname(file), 'masks.json')

if (isMainThread) {
  const count = Number(process.argv[2] ?? 100)
  const W = Number(process.argv[3] ?? 8)
  const H = Number(process.argv[4] ?? 13)
  const seed = Number(process.argv[5] ?? 1)
  const pool = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : []
  const have = new Set(pool.map((m) => m.mask))
  const target = pool.length + count
  let next = seed
  const threads = Math.max(1, os.cpus().length)
  await Promise.all(Array.from({ length: threads }, () => new Promise((resolve) => {
    const worker = new Worker(file, { workerData: { W, H } })
    const feed = () => (pool.length >= target ? worker.terminate().then(resolve) : worker.postMessage(next++))
    worker.on('message', (m) => {
      if (m && !have.has(m.mask) && pool.length < target) { have.add(m.mask); pool.push(m) }
      feed()
    })
    feed()
  })))
  fs.writeFileSync(OUT, '[\n' + pool.map((m) => JSON.stringify(m)).join(',\n') + '\n]\n')
  console.log(`${pool.length} layouts in ${OUT} (seeds up to ${next - 1})`)
} else {
  const { W, H } = workerData
  parentPort.on('message', (seed) => {
    // Narrow phone-sized grids take fewer long words and fewer short ones.
    const preset = W <= 8 ? { minLong: 4, maxShort: 13, maxDouble: 7, max3: 3 } : {}
    const best = generateMask(W, H, mulberry32(seed * 7919 + W * 31 + H), { ...preset, ...JSON.parse(process.env.MASK_OPTS ?? '{}') })
    if (best.hard !== 0) return parentPort.postMessage(null)
    parentPort.postMessage({ w: W, h: H, seed, soft: Number(best.soft.toFixed(2)), mask: [...best.mask].join('') })
  })
}
