/**
 * Host half of dsh-peak-hours.
 *
 * Serves the peak / off-peak usage report on `/dsh-peak-hours/api/usage` so the
 * client half (a settings card) can show tokens and money without touching the
 * filesystem itself.
 */
import { buildReport } from './lib/usage.js'

export const name = 'dsh-peak-hours'
export const inject = ['webServer']

const API = '/dsh-peak-hours/api'
/** The scan walks every session log; a short TTL keeps repeated UI loads cheap. */
const TTL_MS = 60_000

export function apply(ctx) {
  let payload = null
  let payloadAt = 0
  let inflight = null

  async function getReport(fresh) {
    const now = Date.now()
    if (!fresh && payload && now - payloadAt < TTL_MS) return payload
    if (inflight) return inflight
    inflight = (async () => {
      try {
        const report = await buildReport({})
        payload = report
        payloadAt = Date.now()
        return report
      } finally {
        inflight = null
      }
    })()
    return inflight
  }

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: API,
      handler: async (req, res) => {
        const url = req.url || '/'
        const pathname = url.split('?')[0]
        const fresh = /[?&]fresh=1(?:&|$)/.test(url)
        const sub = pathname.startsWith(API) ? pathname.slice(API.length) : pathname
        try {
          if (sub === '/usage') {
            const report = await getReport(fresh)
            res.writeHead(200, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            })
            res.end(JSON.stringify(report))
            return
          }
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          })
          res.end(JSON.stringify({ ok: true, service: name, endpoints: ['/usage', '/usage?fresh=1'] }))
        } catch (err) {
          res.writeHead(500, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          })
          res.end(JSON.stringify({ ok: false, error: String((err && err.message) || err) }))
        }
      },
    }),
  )
}
