/**
 * Multi-frame zstd decoder.
 *
 * A durable session log (`session.v<N>.jsonl.zstd`) is a *sequence* of zstd
 * frames — one frame appended per batched write. `zlib.zstdDecompressSync`
 * decodes only the FIRST frame and silently drops the rest, so we have to walk
 * the physical frame boundaries ourselves: parse a frame header, walk its
 * blocks to find the frame end, then decompress exactly that slice.
 *
 * A torn tail (a frame still being written) is expected: we stop at the last
 * complete frame and report how many frames were dropped, which lets callers
 * resync on the next scan.
 */
import zlib from 'node:zlib'

const ZSTD_MAGIC = 0xfd2fb528

function isSkippableMagic(m) {
  return m >= 0x184d2a50 && m <= 0x184d2a5f
}

function findMagic(buf, from) {
  for (let i = from; i + 4 <= buf.length; i++) {
    if (buf.readUInt32LE(i) === ZSTD_MAGIC) return i
  }
  return -1
}

/** Physical end offset of the frame starting at `off` (throws on a torn frame). */
function parseFrameEnd(buf, off) {
  let p = off + 4
  const fhd = buf[p]
  p += 1
  const fcsFlag = fhd >> 6
  const single = (fhd >> 5) & 1
  const checksum = (fhd >> 2) & 1
  const dictId = fhd & 3
  p += [0, 1, 2, 4][dictId]
  if (!single) p += 1 // window descriptor
  p += fcsFlag === 0 ? (single ? 1 : 0) : fcsFlag === 1 ? 2 : fcsFlag === 2 ? 4 : 8
  let last = false
  let guard = 0
  while (!last) {
    if (p + 3 > buf.length) throw new Error('torn block header')
    const bh = buf.readUIntLE(p, 3)
    p += 3
    last = (bh & 1) === 1
    const type = (bh >>> 1) & 3
    const size = bh >>> 3
    if (type === 3) throw new Error('reserved block type')
    const payload = type === 1 ? 1 : size
    if (p + payload > buf.length) throw new Error('torn block payload')
    p += payload
    if (++guard > 1e7) throw new Error('runaway blocks')
  }
  if (checksum) {
    if (p + 4 > buf.length) throw new Error('torn checksum')
    p += 4
  }
  return p
}

/**
 * Decode every complete frame in `buf`.
 * @param {Buffer} buf
 * @param {(text: string) => void} [onFrame] per-frame UTF-8 text (optional)
 * @returns {{ text: string, frames: number, dropped: number }}
 */
export function decodeAllFrames(buf, onFrame) {
  const parts = []
  let off = 0
  let frames = 0
  let dropped = 0
  while (off < buf.length) {
    if (buf.length - off < 4) {
      if (off < buf.length) dropped += 1
      break
    }
    const magic = buf.readUInt32LE(off)
    if (isSkippableMagic(magic)) {
      // Skippable frame: 4-byte magic + 4-byte LE size + payload.
      if (off + 8 > buf.length) {
        dropped += 1
        break
      }
      const size = buf.readUInt32LE(off + 4)
      if (off + 8 + size > buf.length) {
        dropped += 1
        break
      }
      off += 8 + size
      continue
    }
    if (magic !== ZSTD_MAGIC) {
      const next = findMagic(buf, off + 1)
      if (next < 0) break
      off = next
      continue
    }
    let end
    try {
      end = parseFrameEnd(buf, off)
    } catch {
      dropped += 1
      break
    }
    const slice = buf.subarray(off, end)
    let text
    try {
      text = zlib.zstdDecompressSync(slice).toString('utf8')
    } catch {
      dropped += 1
      off = end
      continue
    }
    frames += 1
    if (onFrame) onFrame(text)
    else parts.push(text)
    off = end
  }
  return { text: parts.join(''), frames, dropped }
}
