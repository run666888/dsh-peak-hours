/**
 * Peak / off-peak schedule and price table (host half).
 *
 * Kept in sync with `client.js` by hand: the client half is a standalone
 * `window.__ModuleLoader__` bundle and cannot import package files, so the two
 * copies are cross-checked by `test/schedule.test.mjs` against the published
 * rules (09:00–12:00 and 14:00–18:00 Beijing time; weekends, Chinese public
 * holidays and make-up rest days are all off-peak; off-peak is half price).
 */

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
/** Beijing is UTC+8 with no DST: shifting the instant is exact. */
export const BEIJING_OFFSET_MS = 8 * 3_600_000

/** Peak windows as minutes-of-day, Beijing time. */
export const PEAK_WINDOWS = [
  [540, 720], // 09:00–12:00
  [840, 1080], // 14:00–18:00
]

/** Chinese public holidays, keyed by year → MM-DD. Extend as the calendar is announced. */
export const HOLIDAYS = {
  2026: [
    '01-01', // 元旦
    '02-17', '02-18', '02-19', '02-20', '02-21', '02-22', '02-23', // 春节
    '04-04', '04-05', '04-06', // 清明
    '05-01', '05-02', '05-03', '05-04', '05-05', // 劳动节
    '06-19', '06-20', '06-21', // 端午
    '09-25', '09-26', '09-27', // 中秋
    '10-01', '10-02', '10-03', '10-04', '10-05', '10-06', '10-07', // 国庆
  ],
}

/** Beijing calendar fields of an instant. */
export function bjParts(ms) {
  const d = new Date(ms + BEIJING_OFFSET_MS)
  return {
    y: d.getUTCFullYear(),
    mo: String(d.getUTCMonth() + 1).padStart(2, '0'),
    d: String(d.getUTCDate()).padStart(2, '0'),
    h: d.getUTCHours(),
    mi: d.getUTCMinutes(),
    dow: d.getUTCDay(),
  }
}

export function bjDayKey(ms) {
  const p = bjParts(ms)
  return `${p.y}-${p.mo}-${p.d}`
}

export function isHoliday(ms) {
  const p = bjParts(ms)
  const list = HOLIDAYS[p.y]
  return Array.isArray(list) && list.includes(`${p.mo}-${p.d}`)
}

export function isWeekend(ms) {
  const dow = bjParts(ms).dow
  return dow === 0 || dow === 6
}

/** Whole day is off-peak (weekend or public holiday). */
export function isOffDay(ms) {
  return isWeekend(ms) || isHoliday(ms)
}

export function minuteOfDay(ms) {
  const p = bjParts(ms)
  return p.h * 60 + p.mi
}

export function isPeakInstant(ms) {
  if (isOffDay(ms)) return false
  const m = minuteOfDay(ms)
  return PEAK_WINDOWS.some(([a, b]) => m >= a && m < b)
}

/**
 * Prices in CNY per million tokens.
 * `miss` also prices cache writes (a cache write is billed as uncached input).
 */
export const PRICES = {
  flash: {
    peak: { hit: 0.04, miss: 2, out: 8 },
    off: { hit: 0.02, miss: 1, out: 4 },
  },
  pro: {
    peak: { hit: 0.3, miss: 9, out: 27 },
    off: { hit: 0.15, miss: 4.5, out: 13.5 },
  },
}

/**
 * Which price class a model falls into, or `null` when the model is not billed
 * on the DeepSeek peak/off-peak table (third-party providers routed through the
 * harness are still counted as usage, but not as money).
 */
export function classifyModel(model) {
  const m = String(model || '').toLowerCase()
  if (!m.includes('deepseek')) return null
  if (m.includes('pro') || m.includes('reasoner')) return 'pro'
  return 'flash'
}

/** `[input, output, cacheRead, cacheWrite]` → CNY. */
export function bucketCost(price, b) {
  const miss = (b[0] || 0) + (b[3] || 0)
  const hit = b[2] || 0
  const out = b[1] || 0
  return (miss * price.miss + hit * price.hit + out * price.out) / 1e6
}

export function fmtYuan(n) {
  const v = Number(n) || 0
  if (v > 0 && v < 0.01) return '¥' + v.toFixed(4)
  if (v < 1) return '¥' + v.toFixed(3)
  return '¥' + v.toFixed(2)
}
