/**
 * Session-log usage scanner: turns durable session logs into peak / off-peak
 * token totals and money.
 *
 * Data source (same one token-meter keeps): `~/.dsh/sessions/<cwd>/<id>/session.v<N>.jsonl.zstd`,
 * a multi-frame zstd stream of JSONL events. Each assistant event carries a
 * top-level `time` (epoch ms) and `data.usage`
 * `{ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }`.
 * Repeated samples for the same `turn`/`step` REPLACE the previous one, so the
 * folder subtracts the previous sample before adding the newer one.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { decodeAllFrames } from './zstd.js'
import { PRICES, bjDayKey, bjParts, bucketCost, classifyModel, isPeakInstant } from './schedule.js'

const LOG_RE = /^session\.v\d+\.jsonl\.zstd$/
const CACHE_VERSION = 3
const DAY_MS = 86_400_000

export function sessionsRoot() {
  return path.join(os.homedir(), '.dsh', 'sessions')
}

export function cacheFile() {
  return path.join(os.homedir(), '.dsh', 'storages', 'peak-hours', 'cache.json')
}

function bucketsFrom(u) {
  return [
    Number(u.inputTokens) || 0,
    Number(u.outputTokens) || 0,
    Number(u.cacheReadTokens) || 0,
    Number(u.cacheWriteTokens) || 0,
  ]
}

function lastStreamUsage(stream) {
  if (!Array.isArray(stream)) return undefined
  for (let i = stream.length - 1; i >= 0; i--) {
    const r = stream[i]
    if (r && r.type === 'chunk' && r.chunk && r.chunk.type === 'usage' && r.chunk.usage != null) {
      return r.chunk.usage
    }
  }
  return undefined
}

function usageOf(ev) {
  if (ev.data && ev.data.usage != null) return ev.data.usage
  if (ev.type !== 'assistant/message' && ev.type !== 'assistant/attempt') return undefined
  return lastStreamUsage(ev.data && ev.data.stream)
}

function modelOfEvent(ev) {
  const s = ev && ev.data && ev.data.message && ev.data.message.source
  if (!s || typeof s !== 'object') return ''
  const prov = typeof s.provider === 'string' ? s.provider : ''
  const mod = typeof s.model === 'string' ? s.model : ''
  return prov && mod ? prov + '/' + mod : mod || prov
}

/**
 * Fold one session log's decoded text into `map`.
 * Key: `${dayKey}|${hour}|${model}` → `[input, output, cacheRead, cacheWrite]`.
 * @returns {{ samples: number, parsed: number }}
 */
export function foldSessionText(text, map) {
  let last = null
  let samples = 0
  let parsed = 0
  const add = (key, b, sign) => {
    const cur = map.get(key) || [0, 0, 0, 0]
    cur[0] += sign * b[0]
    cur[1] += sign * b[1]
    cur[2] += sign * b[2]
    cur[3] += sign * b[3]
    map.set(key, cur)
  }
  for (const line of text.split('\n')) {
    if (!line) continue
    let ev
    try {
      ev = JSON.parse(line)
    } catch {
      continue
    }
    parsed++
    const t = Number(ev.time)
    if (!(t > 0)) continue
    const u = usageOf(ev)
    if (u == null) continue
    const b = bucketsFrom(u)
    const data = ev.data || {}
    const turn = data.turn == null ? null : data.turn
    const step = data.step == null ? null : data.step
    const model = modelOfEvent(ev)
    const p = bjParts(t)
    if (last && last.turn === turn && last.step === step && turn !== null) {
      add(last.key, last.b, -1)
    }
    const key = `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}|${p.h}|${model}`
    add(key, b, 1)
    last = { turn, step, key, b }
    samples++
  }
  return { samples, parsed }
}

function listSessionLogs(root) {
  const out = []
  let cwds
  try {
    cwds = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return out
  }
  for (const cwd of cwds) {
    if (!cwd.isDirectory()) continue
    const cwdDir = path.join(root, cwd.name)
    let sessions
    try {
      sessions = fs.readdirSync(cwdDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const s of sessions) {
      if (!s.isDirectory()) continue
      const dir = path.join(cwdDir, s.name)
      let files
      try {
        files = fs.readdirSync(dir)
      } catch {
        continue
      }
      for (const f of files) {
        if (LOG_RE.test(f)) out.push(path.join(dir, f))
      }
    }
  }
  return out
}

function readCache(file) {
  try {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (json && json.version === CACHE_VERSION && json.files && typeof json.files === 'object') return json
  } catch {
    /* missing or corrupt → cold scan */
  }
  return { version: CACHE_VERSION, files: {} }
}

function writeCache(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(data))
    fs.renameSync(tmp, file)
  } catch {
    /* cache is an optimisation only */
  }
}

/**
 * Read every session log, reusing per-file aggregates for unchanged logs.
 * Yields to the event loop between files so a cold scan never freezes the host.
 * @returns {Promise<{ buckets: Array<[string, number, string, number, number, number, number]>, stats: object }>}
 */
export async function scanSessions(opts = {}) {
  const root = opts.root || sessionsRoot()
  const cachePath = opts.cacheFile || cacheFile()
  const started = Date.now()
  const cache = readCache(cachePath)
  const files = listSessionLogs(root)
  const stats = { sessions: files.length, scanned: 0, cacheHits: 0, dropped: 0, frames: 0 }
  const buckets = []
  const nextCache = { version: CACHE_VERSION, files: {} }
  const tick = () => new Promise((resolve) => setImmediate(resolve))

  for (const file of files) {
    await tick()
    let st
    try {
      st = fs.statSync(file)
    } catch {
      continue
    }
    const prev = cache.files[file]
    if (prev && prev.size === st.size && prev.mtimeMs === Math.trunc(st.mtimeMs)) {
      stats.cacheHits++
      nextCache.files[file] = prev
      for (const row of prev.buckets) buckets.push(row)
      continue
    }
    let buf
    try {
      buf = fs.readFileSync(file)
    } catch {
      continue
    }
    const decoded = decodeAllFrames(buf)
    const map = new Map()
    foldSessionText(decoded.text, map)
    stats.scanned++
    stats.dropped += decoded.dropped
    stats.frames += decoded.frames
    const rows = []
    for (const [key, b] of map) {
      if (b[0] === 0 && b[1] === 0 && b[2] === 0 && b[3] === 0) continue
      const [day, hour, model] = key.split('|')
      rows.push([day, Number(hour), model, b[0], b[1], b[2], b[3]])
      buckets.push([day, Number(hour), model, b[0], b[1], b[2], b[3]])
    }
    nextCache.files[file] = {
      size: st.size,
      mtimeMs: Math.trunc(st.mtimeMs),
      frames: decoded.frames,
      dropped: decoded.dropped,
      buckets: rows,
    }
  }

  writeCache(cachePath, nextCache)
  stats.scanMs = Date.now() - started
  return { buckets, stats }
}

const SERIES_SPAN = 30

const EMPTY = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 })

function addTo(acc, b) {
  acc.input += b[0]
  acc.output += b[1]
  acc.cacheRead += b[2]
  acc.cacheWrite += b[3]
  acc.total += b[0] + b[1] + b[2] + b[3]
}

/**
 * Per-Beijing-day cost series, oldest first, zero-filled for days with no usage.
 * @param {Record<string, any>} perDay
 * @param {{ nowMs: number, days: number|null, span: number }} opts
 */
function buildSeries(perDay, opts) {
  const span = opts.days == null ? opts.span : Math.min(opts.days, opts.span)
  const out = []
  for (let k = span - 1; k >= 0; k--) {
    const day = bjDayKey(opts.nowMs - k * DAY_MS)
    const slot = perDay[day]
    let peakCost = 0
    let offCost = 0
    let peakTokens = 0
    let offTokens = 0
    for (const cls of ['flash', 'pro']) {
      if (!slot) break
      const price = PRICES[cls]
      peakCost += bucketCost(price.peak, toB(slot.peak[cls]))
      offCost += bucketCost(price.off, toB(slot.off[cls]))
      peakTokens += slot.peak[cls].total
      offTokens += slot.off[cls].total
    }
    out.push({
      day,
      cost: peakCost + offCost,
      peakCost,
      offCost,
      peakTokens,
      offTokens,
      tokens: peakTokens + offTokens,
    })
  }
  return out
}

/** Instant at the start of `dayKey` + `hour` in Beijing time. */
function instantOf(day, hour) {
  const [y, mo, d] = day.split('-').map(Number)
  return Date.UTC(y, mo - 1, d, hour, 0, 0) - 8 * 3_600_000
}

/**
 * Aggregate bucket rows into one range.
 * @param {Array} buckets rows from `scanSessions`
 * @param {{ days?: number|null, nowMs?: number }} opts `days = null` means all time
 */
export function aggregate(buckets, opts = {}) {
  const nowMs = opts.nowMs || Date.now()
  const days = opts.days == null ? null : Number(opts.days)
  const cutoff = days == null ? null : nowMs - days * DAY_MS
  const out = {
    days,
    peak: EMPTY(),
    off: EMPTY(),
    classes: { flash: EMPTY(), pro: EMPTY() },
    peakClasses: { flash: EMPTY(), pro: EMPTY() },
    offClasses: { flash: EMPTY(), pro: EMPTY() },
    classByModel: {},
    other: { tokens: 0, models: {} },
    byModel: {},
    days_seen: new Set(),
    perDay: {},
  }
  for (const row of buckets) {
    const [day, hour, model, i, o, cr, cw] = row
    const b = [i, o, cr, cw]
    const inst = instantOf(day, hour)
    if (cutoff != null && inst < cutoff) continue
    const peak = isPeakInstant(inst)
    const cls = classifyModel(model)
    out.days_seen.add(day)
    addTo(peak ? out.peak : out.off, b)
    const daySlot = (out.perDay[day] ||= {
      peak: { flash: EMPTY(), pro: EMPTY() },
      off: { flash: EMPTY(), pro: EMPTY() },
    })
    if (cls) addTo(daySlot[peak ? 'peak' : 'off'][cls], b)
    const modelTot = (out.byModel[model] ||= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, peak: 0, off: 0 })
    addTo(modelTot, b)
    if (peak) modelTot.peak += i + o + cr + cw
    else modelTot.off += i + o + cr + cw
    if (cls) {
      addTo(out.classes[cls], b)
      addTo(peak ? out.peakClasses[cls] : out.offClasses[cls], b)
      const cm = (out.classByModel[model] ||= { class: cls, peak: EMPTY(), off: EMPTY() })
      addTo(peak ? cm.peak : cm.off, b)
    } else {
      out.other.tokens += i + o + cr + cw
      out.other.models[model] = (out.other.models[model] || 0) + i + o + cr + cw
    }
  }

  const costActual = {}
  const costAllPeak = {}
  const costAllOff = {}
  let actual = 0
  let allPeak = 0
  let allOff = 0
  for (const cls of ['flash', 'pro']) {
    const price = PRICES[cls]
    const a = bucketCost(price.peak, toB(out.peakClasses[cls])) + bucketCost(price.off, toB(out.offClasses[cls]))
    const p = bucketCost(price.peak, toB(out.classes[cls]))
    const o = bucketCost(price.off, toB(out.classes[cls]))
    costActual[cls] = a
    costAllPeak[cls] = p
    costAllOff[cls] = o
    actual += a
    allPeak += p
    allOff += o
  }

  const peakTotal = out.peak.total
  const offTotal = out.off.total
  const total = peakTotal + offTotal
  const priced = out.classes.flash.total + out.classes.pro.total

  return {
    days,
    since: cutoff == null ? null : bjDayKey(cutoff),
    activeDays: out.days_seen.size,
    tokens: {
      peak: out.peak,
      off: out.off,
      total,
      peakShare: total > 0 ? peakTotal / total : 0,
      offShare: total > 0 ? offTotal / total : 0,
      priced,
    },
    classes: out.classes,
    models: Object.entries(out.byModel)
      .map(([model, v]) => ({ model, cls: classifyModel(model), ...v }))
      .sort((a, b) => b.total - a.total),
    classByModel: Object.entries(out.classByModel)
      .map(([model, v]) => {
        const price = PRICES[v.class]
        const peakCost = bucketCost(price.peak, toB(v.peak))
        const offCost = bucketCost(price.off, toB(v.off))
        return {
          model,
          cls: v.class,
          peak: v.peak,
          off: v.off,
          peakCost,
          offCost,
          allPeakCost: bucketCost(price.peak, toB(v.peak)) + bucketCost(price.peak, toB(v.off)),
          cost: peakCost + offCost,
        }
      })
      .sort((a, b) => b.cost - a.cost),
    other: {
      tokens: out.other.tokens,
      models: Object.entries(out.other.models)
        .map(([model, tokens]) => ({ model, tokens }))
        .sort((a, b) => b.tokens - a.tokens),
    },
    series: buildSeries(out.perDay, { nowMs, days, span: SERIES_SPAN }),
    cost: {
      actual,
      allPeak,
      allOff,
      byClass: costActual,
      allPeakByClass: costAllPeak,
      allOffByClass: costAllOff,
      saved: allPeak - actual,
      savedPct: allPeak > 0 ? (allPeak - actual) / allPeak : 0,
    },
  }
}

function toB(acc) {
  return [acc.input, acc.output, acc.cacheRead, acc.cacheWrite]
}

/** One payload for the client: the three ranges it offers. */
export async function buildReport(opts = {}) {
  const nowMs = opts.nowMs || Date.now()
  const { buckets, stats } = await scanSessions(opts)
  return {
    ok: true,
    generatedAt: new Date(nowMs).toISOString(),
    stats,
    ranges: {
      '7': aggregate(buckets, { days: 7, nowMs }),
      '30': aggregate(buckets, { days: 30, nowMs }),
      all: aggregate(buckets, { days: null, nowMs }),
    },
    cache: { file: cacheFile(), raw: false },
  }
}
