// ai-excited-01 entry (Node 22, standard library only): the entry is the image
// file entry.png beside this program, and this program copies it to the output
// directory as entry.png, after a sanity check on the file it ships: it must be
// a PNG or a JPEG, at most 1 MiB, and at most 1024 by 1024 pixels.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { closeSync, copyFileSync, mkdirSync, openSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 1_048_576;
const MAX_SIDE = 1024;

// PNG magic: 89 50 4E 47 0D 0A 1A 0A. JPEG magic: FF D8 FF.
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

const here = fileURLToPath(new URL('.', import.meta.url));
const source = join(here, 'entry.png');
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const target = join(outDir, 'entry.png');

const stats = statSync(source);
if (stats.size > MAX_BYTES) {
  throw new Error(`entry.png is ${stats.size} bytes, over the 1 MiB cap`);
}

// Read only the header: enough for the magic bytes, the PNG IHDR dimensions,
// and a JPEG frame header (its start-of-frame marker sits near the top).
const fd = openSync(source, 'r');
try {
  const head = Buffer.alloc(65_536);
  const read = readSync(fd, head, 0, head.length, 0);
  const bytes = head.subarray(0, read);
  const isPng = bytes.subarray(0, 8).equals(PNG_MAGIC);
  const isJpeg = bytes.subarray(0, 3).equals(JPEG_MAGIC);
  if (!isPng && !isJpeg) {
    throw new Error('entry.png is neither a PNG nor a JPEG');
  }
  const { width, height } = readDimensions(bytes, isPng);
  if (width > MAX_SIDE || height > MAX_SIDE) {
    throw new Error(`entry.png is ${width}x${height}, over the 1024x1024 cap`);
  }
  mkdirSync(outDir, { recursive: true });
  copyFileSync(source, target);
  console.log(`wrote ${target} (${stats.size} bytes, ${isPng ? 'PNG' : 'JPEG'}, ${width}x${height})`);
} finally {
  closeSync(fd);
}

// PNG: width and height are the first 8 bytes of the IHDR chunk, right after
// the 8-byte magic. JPEG: walk the marker segments until a start-of-frame
// marker (SOF0/SOF2 and kin); its payload holds precision, height, width.
function readDimensions(bytes, isPng) {
  if (isPng) {
    if (bytes.length < 24 || bytes.subarray(12, 16).toString('latin1') !== 'IHDR') {
      throw new Error('entry.png has no IHDR chunk');
    }
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  let offset = 2; // past the SOI marker
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      throw new Error('entry.png has a broken JPEG marker stream');
    }
    let marker = bytes[offset + 1];
    while (marker === 0xff) {
      offset += 1; // padding byte before the real marker
      marker = bytes[offset + 1];
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2; // standalone marker, no length field
      continue;
    }
    if (marker === 0xda) {
      break; // start of scan: no frame header before it
    }
    const length = bytes.readUInt16BE(offset + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (offset + 9 > bytes.length) {
        throw new Error('entry.png has a truncated JPEG frame header');
      }
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  throw new Error('entry.png has no JPEG frame header');
}
