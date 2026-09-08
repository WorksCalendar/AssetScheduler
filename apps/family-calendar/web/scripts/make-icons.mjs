/**
 * Generate the PWA icons.
 *
 * Committed as a script rather than as binaries-from-nowhere, so the icons can
 * be regenerated when the family's colours change. PNG is written by hand
 * because a home calendar should not need an image toolchain to build:
 *
 *   node scripts/make-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

/** Member colours, matching the server's seed. */
const DOTS = ['#2563eb', '#db2777', '#059669'];
const BACKGROUND = '#1e293b';
const PAPER = '#f8fafc';

/**
 * @param {string} hex
 * @returns {[number, number, number]}
 */
function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

/**
 * @param {Buffer} buf
 * @returns {number}
 */
function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/**
 * @param {string} type
 * @param {Buffer} data
 * @returns {Buffer}
 */
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * Draw the icon into an RGBA buffer and encode it.
 *
 * @param {number} size
 * @returns {Buffer}
 */
function renderIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const [br, bg, bb] = rgb(BACKGROUND);
  const [pr, pg, pb] = rgb(PAPER);

  const radius = size * 0.22;
  const pageX0 = size * 0.18;
  const pageX1 = size * 0.82;
  const pageY0 = size * 0.26;
  const pageY1 = size * 0.8;
  const bandY = size * 0.4;

  const set = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number[]} */ colour) => {
    const i = (y * size + x) * 4;
    px[i] = colour[0];
    px[i + 1] = colour[1];
    px[i + 2] = colour[2];
    px[i + 3] = 255;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!insideRoundedSquare(x, y, size, radius)) {
        px[(y * size + x) * 4 + 3] = 0; // transparent outside the tile
        continue;
      }
      set(x, y, [br, bg, bb]);

      // The white "page" of the calendar, with a coloured band across the top.
      if (x >= pageX0 && x <= pageX1 && y >= pageY0 && y <= pageY1) {
        set(x, y, y < bandY ? [br, bg, bb] : [pr, pg, pb]);
      }
    }
  }

  // Two hanging rings above the page.
  for (const cx of [size * 0.34, size * 0.66]) {
    fillCircle(px, size, cx, size * 0.21, size * 0.045, rgb(PAPER));
  }

  // One dot per family member, on the page.
  const dotY = size * 0.62;
  DOTS.forEach((colour, i) => {
    const cx = size * (0.32 + i * 0.18);
    fillCircle(px, size, cx, dotY, size * 0.062, rgb(colour));
  });

  return encodePng(size, px);
}

/**
 * @param {number} x
 * @param {number} y
 * @param {number} size
 * @param {number} radius
 * @returns {boolean}
 */
function insideRoundedSquare(x, y, size, radius) {
  const nx = Math.min(Math.max(x, radius), size - radius);
  const ny = Math.min(Math.max(y, radius), size - radius);
  return (x - nx) ** 2 + (y - ny) ** 2 <= radius ** 2;
}

/**
 * @param {Buffer} px
 * @param {number} size
 * @param {number} cx
 * @param {number} cy
 * @param {number} r
 * @param {[number, number, number]} colour
 */
function fillCircle(px, size, cx, cy, r, colour) {
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(size - 1, Math.ceil(cy + r)); y++) {
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(size - 1, Math.ceil(cx + r)); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const i = (y * size + x) * 4;
      px[i] = colour[0];
      px[i + 1] = colour[1];
      px[i + 2] = colour[2];
      px[i + 3] = 255;
    }
  }
}

/**
 * @param {number} size
 * @param {Buffer} px  RGBA, row-major
 * @returns {Buffer}
 */
function encodePng(size, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // truecolour with alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // Each scanline carries a leading filter byte; 0 means "store as-is".
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));

for (const size of [192, 512]) {
  writeFileSync(`${publicDir}icon-${size}.png`, renderIcon(size));
  console.log(`wrote public/icon-${size}.png`);
}

// A vector copy for the browser tab, where a 512px PNG is overkill.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" fill="${BACKGROUND}"/>
  <circle cx="34" cy="21" r="4.5" fill="${PAPER}"/>
  <circle cx="66" cy="21" r="4.5" fill="${PAPER}"/>
  <rect x="18" y="40" width="64" height="40" fill="${PAPER}"/>
  ${DOTS.map((c, i) => `<circle cx="${32 + i * 18}" cy="62" r="6.2" fill="${c}"/>`).join('\n  ')}
</svg>
`;
writeFileSync(`${publicDir}icon.svg`, svg);
console.log('wrote public/icon.svg');
