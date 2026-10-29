import assert from 'node:assert/strict'
import test from 'node:test'

import {
  HOLIDAYS,
  PEAK_WINDOWS,
  bucketCost,
  classifyModel,
  isHoliday,
  isOffDay,
  isPeakInstant,
  PRICES,
} from '../lib/schedule.js'
import { aggregate, foldSessionText } from '../lib/usage.js'

/** Beijing wall clock → epoch ms (UTC+8, no DST). */
function bj(y, mo, d, h, mi = 0) {
  return Date.UTC(y, mo - 1, d, h, mi) - 8 * 3_600_000
}

test('peak windows are 09:00–12:00 and 14:00–18:00', () => {
  assert.deepEqual(PEAK_WINDOWS, [
    [540, 720],
    [840, 1080],
  ])
  // 2026-10-28 is a Wednesday.
  assert.equal(isPeakInstant(bj(2026, 10, 28, 9, 0)), true)
  assert.equal(isPeakInstant(bj(2026, 10, 28, 11, 59)), true)
  assert.equal(isPeakInstant(bj(2026, 10, 28, 12, 0)), false)
  assert.equal(isPeakInstant(bj(2026, 10, 28, 13, 59)), false)
  assert.equal(isPeakInstant(bj(2026, 10, 28, 14, 0)), true)
  assert.equal(isPeakInstant(bj(2026, 10, 28, 17, 59)), true)
  assert.equal(isPeakInstant(bj(2026, 10, 28, 18, 0)), false)
  assert.equal(isPeakInstant(bj(2026, 10, 28, 3, 0)), false)
})

test('weekends and public holidays are off-peak all day', () => {
  // 2026-10-31 is a Saturday, 2026-11-01 a Sunday.
  assert.equal(isOffDay(bj(2026, 10, 31, 10, 0)), true)
  assert.equal(isPeakInstant(bj(2026, 10, 31, 10, 0)), false)
  assert.equal(isPeakInstant(bj(2026, 11, 1, 15, 0)), false)
  // National Day 2026-10-01 (a Thursday) is a holiday.
  assert.equal(isHoliday(bj(2026, 10, 1, 10, 0)), true)
  assert.equal(isPeakInstant(bj(2026, 10, 1, 10, 0)), false)
  // Mid-Autumn 2026-09-25 is a Friday but a holiday.
  assert.equal(isPeakInstant(bj(2026, 9, 25, 15, 0)), false)
  // 2026-09-24 is a plain Thursday.
  assert.equal(isPeakInstant(bj(2026, 9, 24, 15, 0)), true)
})

test('holiday table is keyed by year and month-day', () => {
  for (const [year, list] of Object.entries(HOLIDAYS)) {
    for (const md of list) assert.match(md, /^\d{2}-\d{2}$/, `${year} ${md}`)
  }
})

test('model classification picks flash / pro / not priced', () => {
  assert.equal(classifyModel('deepseek-account/deepseek-flash'), 'flash')
  assert.equal(classifyModel('deepseek-official/deepseek-v4-flash'), 'flash')
  assert.equal(classifyModel('deepseek-official/deepseek-v4-pro'), 'pro')
  assert.equal(classifyModel('deepseek-official/deepseek-reasoner'), 'pro')
  assert.equal(classifyModel('claude/claude-opus-5-5'), null)
  assert.equal(classifyModel(''), null)
})

test('cost uses hit / miss / output prices and prices writes as miss', () => {
  const million = [1_000_000, 0, 0, 0]
  assert.equal(bucketCost(PRICES.flash.peak, million), 2)
  assert.equal(bucketCost(PRICES.flash.off, million), 1)
  assert.equal(bucketCost(PRICES.flash.off, [0, 0, 1_000_000, 0]), 0.02)
  assert.equal(bucketCost(PRICES.flash.peak, [0, 1_000_000, 0, 0]), 8)
  assert.equal(bucketCost(PRICES.pro.off, [0, 0, 0, 1_000_000]), 4.5)
})

test('a repeated turn/step sample replaces the previous one', () => {
  const ev = (turn, step, input) =>
    JSON.stringify({
      type: 'assistant/message',
      time: bj(2026, 10, 28, 10, 30),
      data: { turn, step, usage: { inputTokens: input, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } },
    }) + '\n'
  const map = new Map()
  foldSessionText(ev(1, 1, 100) + ev(1, 1, 300) + ev(1, 2, 50), map)
  const rows = [...map.values()]
  const total = rows.reduce((n, b) => n + b[0], 0)
  assert.equal(total, 350, 'second sample of step 1 replaces the first (300), plus step 2 (50)')
})

test('fold splits by Beijing day+hour and keeps the model key', () => {
  const line = (time, model, input) =>
    JSON.stringify({
      type: 'assistant/message',
      time,
      data: {
        turn: 1,
        step: time,
        message: { source: { provider: 'deepseek-official', model } },
        usage: { inputTokens: input, outputTokens: 1, cacheReadTokens: 2, cacheWriteTokens: 3 },
      },
    }) + '\n'
  const text =
    line(bj(2026, 10, 28, 10, 10), 'deepseek-flash', 1000) +
    line(bj(2026, 10, 28, 13, 10), 'deepseek-flash', 2000)
  const map = new Map()
  foldSessionText(text, map)
  assert.deepEqual([...map.keys()].sort(), ['2026-10-28|10|deepseek-official/deepseek-flash', '2026-10-28|13|deepseek-official/deepseek-flash'])
})

test('aggregate splits peak/off-peak tokens and compares money', () => {
  // One million uncached input tokens in a peak hour, one in an off-peak hour.
  const buckets = [
    ['2026-10-28', 10, 'deepseek-official/deepseek-flash', 1_000_000, 0, 0, 0],
    ['2026-10-28', 13, 'deepseek-official/deepseek-flash', 1_000_000, 0, 0, 0],
    ['2026-10-28', 10, 'claude/claude-opus-5-5', 500_000, 0, 0, 0],
  ]
  const r = aggregate(buckets, { days: null, nowMs: bj(2026, 10, 29, 12, 0) })
  assert.equal(r.tokens.peak.total, 1_500_000)
  assert.equal(r.tokens.off.total, 1_000_000)
  assert.equal(r.tokens.priced, 2_000_000)
  assert.equal(r.other.tokens, 500_000)
  assert.equal(r.cost.actual, 2 + 1) // peak 2 + off 1
  assert.equal(r.cost.allPeak, 2 + 2)
  assert.equal(r.cost.allOff, 1 + 1)
  assert.equal(r.cost.saved, 1)
  assert.equal(r.cost.savedPct, 0.25)
  assert.equal(r.classByModel.length, 1)
  assert.equal(r.classByModel[0].cls, 'flash')
  assert.equal(r.classByModel[0].cost, 3)
})

test('range filter drops buckets older than the window', () => {
  const buckets = [
    ['2026-09-01', 10, 'deepseek-official/deepseek-flash', 1_000_000, 0, 0, 0],
    ['2026-10-28', 10, 'deepseek-official/deepseek-flash', 1_000_000, 0, 0, 0],
  ]
  const nowMs = bj(2026, 10, 29, 12, 0)
  assert.equal(aggregate(buckets, { days: 7, nowMs }).tokens.total, 1_000_000)
  assert.equal(aggregate(buckets, { days: null, nowMs }).tokens.total, 2_000_000)
})
