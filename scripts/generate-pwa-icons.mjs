import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  const crc = crc32(Buffer.concat([typeBuf, data]))
  crcBuf.writeUInt32BE(crc, 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

// Render a rounded-corner teal square with gradient + "FM" block
function renderIcon(size) {
  const w = size, h = size
  const pixels = Buffer.alloc(w * h * 4)
  const radius = Math.round(size * 0.22)

  // Teal gradient stops (matches globals: #00675c -> #5bf4de)
  const c1 = [0x00, 0x67, 0x5c]
  const c2 = [0x5b, 0xf4, 0xde]

  // "FM" bitmap in a 5x11 grid (white squares = letter pixels)
  const grid = [
    [1,1,1,1,1, 0, 1,0,0,0,1],
    [1,0,0,0,0, 0, 1,1,0,1,1],
    [1,1,1,0,0, 0, 1,0,1,0,1],
    [1,0,0,0,0, 0, 1,0,0,0,1],
    [1,0,0,0,0, 0, 1,0,0,0,1],
  ]
  const gridRows = grid.length
  const gridCols = grid[0].length

  // Scale letters to fit ~55% of width, center in square
  const letterAreaW = Math.round(size * 0.58)
  const letterAreaH = Math.round(letterAreaW * (gridRows / gridCols))
  const cellW = letterAreaW / gridCols
  const cellH = letterAreaH / gridRows
  const letterX0 = (size - letterAreaW) / 2
  const letterY0 = (size - letterAreaH) / 2

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      // Rounded corner mask
      let inside = true
      // top-left
      if (x < radius && y < radius) {
        const dx = radius - x, dy = radius - y
        if (dx * dx + dy * dy > radius * radius) inside = false
      } else if (x >= w - radius && y < radius) {
        const dx = x - (w - radius - 1), dy = radius - y
        if (dx * dx + dy * dy > radius * radius) inside = false
      } else if (x < radius && y >= h - radius) {
        const dx = radius - x, dy = y - (h - radius - 1)
        if (dx * dx + dy * dy > radius * radius) inside = false
      } else if (x >= w - radius && y >= h - radius) {
        const dx = x - (w - radius - 1), dy = y - (h - radius - 1)
        if (dx * dx + dy * dy > radius * radius) inside = false
      }

      if (!inside) {
        pixels[i] = 0
        pixels[i + 1] = 0
        pixels[i + 2] = 0
        pixels[i + 3] = 0 // transparent corner
        continue
      }

      // Check if pixel is inside a letter cell
      let isLetter = false
      const lx = x - letterX0
      const ly = y - letterY0
      if (lx >= 0 && ly >= 0 && lx < letterAreaW && ly < letterAreaH) {
        const col = Math.floor(lx / cellW)
        const row = Math.floor(ly / cellH)
        if (row >= 0 && row < gridRows && col >= 0 && col < gridCols) {
          if (grid[row][col]) isLetter = true
        }
      }

      if (isLetter) {
        pixels[i] = 0xff
        pixels[i + 1] = 0xff
        pixels[i + 2] = 0xff
        pixels[i + 3] = 0xff
      } else {
        // Diagonal gradient from c1 (top-left) to c2 (bottom-right)
        const t = (x + y) / (w + h - 2)
        pixels[i] = Math.round(c1[0] + (c2[0] - c1[0]) * t)
        pixels[i + 1] = Math.round(c1[1] + (c2[1] - c1[1]) * t)
        pixels[i + 2] = Math.round(c1[2] + (c2[2] - c1[2]) * t)
        pixels[i + 3] = 0xff
      }
    }
  }

  // Build raw scanlines: each row preceded by filter byte 0
  const stride = w * 4
  const raw = Buffer.alloc((stride + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const compressed = deflateSync(raw)

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 6   // color type RGBA
  ihdr[10] = 0  // compression
  ihdr[11] = 0  // filter
  ihdr[12] = 0  // interlace

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const outputs = [
  { size: 192, path: 'public/icons/icon-192.png' },
  { size: 512, path: 'public/icons/icon-512.png' },
  { size: 180, path: 'public/icons/apple-touch-icon.png' },
]

for (const { size, path } of outputs) {
  const buf = renderIcon(size)
  writeFileSync(path, buf)
  console.log(`wrote ${path} (${size}x${size}, ${buf.length} bytes)`)
}
