#!/usr/bin/env node
/**
 * generate-icons.js
 * 순수 Node.js(zlib)로 PWA 아이콘 PNG를 생성합니다.
 * 의존 패키지 없음.
 */
'use strict';
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

/* ── CRC32 ───────────────────────────────────────── */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++)
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/* ── PNG chunk helper ────────────────────────────── */
function pngChunk(type, data) {
  const lenBuf  = Buffer.alloc(4); lenBuf.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf  = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/* ── PNG 생성: 파란 배경 + 흰 책 실루엣 ──────────── */
function createIconPNG(size) {
  const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // RGB color type

  // 배경: #0064FF
  const [bgR, bgG, bgB] = [0, 100, 255];

  // 흰 책 사각형 (중앙, 전체 40% 너비 × 52% 높이)
  const bW = Math.round(size * 0.40);
  const bH = Math.round(size * 0.52);
  const bX = Math.round((size - bW) / 2);
  const bY = Math.round((size - bH) / 2);
  // 책 척추 (왼쪽 5% 너비, 살짝 어두운 흰색)
  const spineW = Math.max(2, Math.round(bW * 0.10));

  const rowLen = 1 + size * 3;
  const raw    = Buffer.alloc(size * rowLen);

  for (let y = 0; y < size; y++) {
    raw[y * rowLen] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const idx = y * rowLen + 1 + x * 3;
      const inBook  = x >= bX && x < bX + bW && y >= bY && y < bY + bH;
      const inSpine = inBook && (x < bX + spineW);
      if (inSpine) {
        raw[idx] = 210; raw[idx+1] = 225; raw[idx+2] = 255; // 연한 파란 척추
      } else if (inBook) {
        raw[idx] = 255; raw[idx+1] = 255; raw[idx+2] = 255; // 흰 페이지
      } else {
        raw[idx] = bgR; raw[idx+1] = bgG; raw[idx+2] = bgB;
      }
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 6 });

  return Buffer.concat([
    PNG_SIG,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── 파일 저장 ───────────────────────────────────── */
const iconsDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

const sizes = [
  { name: 'icon-192.png',        size: 192 },
  { name: 'icon-512.png',        size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
];

sizes.forEach(({ name, size }) => {
  const buf  = createIconPNG(size);
  const dest = path.join(iconsDir, name);
  fs.writeFileSync(dest, buf);
  console.log(`✅  ${name}  (${size}×${size})  →  ${(buf.length / 1024).toFixed(1)} KB`);
});

console.log('\n🎨 아이콘 생성 완료: public/icons/');
