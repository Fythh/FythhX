/**
 * mp4BoxParser.js
 *
 * Minimal ISO-BMFF (MP4) box + sidx (segment index) parser.
 * Used by rangeDownloader.js to figure out exact byte-offsets of DASH
 * segments without needing to fully download the remote file.
 *
 * Only implements what we actually need: walking top-level boxes, and
 * decoding a `sidx` box's reference table (ISO/IEC 14496-12 §8.16.3).
 */

'use strict';

/**
 * Walk top-level boxes inside `buffer`, which is assumed to be a prefix
 * of the remote file starting at `fileOffsetOfBufferStart` (normally 0,
 * since we always probe from byte 0).
 *
 * Returns array of { type, start, end, headerSize } with ABSOLUTE byte
 * offsets in the original remote file.
 *
 * Stops as soon as there isn't enough buffered data left to read another
 * full box header (caller should re-probe with a bigger chunk if the box
 * it needs wasn't found yet).
 */
function parseTopLevelBoxes(buffer, fileOffsetOfBufferStart = 0) {
  const boxes = [];
  let pos = 0;

  while (pos + 8 <= buffer.length) {
    let size = buffer.readUInt32BE(pos);
    const type = buffer.toString('ascii', pos + 4, pos + 8);
    let headerSize = 8;

    if (size === 1) {
      // 64-bit largesize follows the 8-byte header
      if (pos + 16 > buffer.length) break; // not enough buffered data
      const high = buffer.readUInt32BE(pos + 8);
      const low = buffer.readUInt32BE(pos + 12);
      size = high * 2 ** 32 + low;
      headerSize = 16;
    } else if (size === 0) {
      // Box extends to EOF - can't know true size from a prefix buffer.
      // Not expected for YouTube DASH init/sidx boxes; bail out.
      break;
    }

    if (size < headerSize) break; // corrupt/garbage, stop parsing

    const absStart = fileOffsetOfBufferStart + pos;
    const absEnd = absStart + size;

    boxes.push({ type, start: absStart, end: absEnd, headerSize });
    pos += size;
  }

  return boxes;
}

/**
 * Parse a `sidx` box's bytes into a segment reference table with
 * absolute byte offsets + timestamps (in seconds).
 *
 * @param {Buffer} sidxBuf - raw bytes of the sidx box (header included),
 *   sliced directly out of the probe buffer.
 * @param {number} sidxHeaderSize - 8 (normal) or 16 (64-bit largesize)
 * @param {number} sidxAbsEnd - absolute byte offset (in the remote file)
 *   where the sidx box ends. Per spec this is the "anchor point" that
 *   `first_offset` and all cumulative segment offsets are relative to.
 */
function parseSidx(sidxBuf, sidxHeaderSize, sidxAbsEnd) {
  let p = sidxHeaderSize;

  const version = sidxBuf.readUInt8(p);
  p += 4; // version(1) + flags(3)

  p += 4; // reference_ID (unused)

  const timescale = sidxBuf.readUInt32BE(p);
  p += 4;

  let earliestPresentationTime, firstOffset;
  if (version === 0) {
    earliestPresentationTime = sidxBuf.readUInt32BE(p); p += 4;
    firstOffset = sidxBuf.readUInt32BE(p); p += 4;
  } else {
    earliestPresentationTime = readUInt64BE(sidxBuf, p); p += 8;
    firstOffset = readUInt64BE(sidxBuf, p); p += 8;
  }

  p += 2; // reserved
  const referenceCount = sidxBuf.readUInt16BE(p); p += 2;

  const segments = [];
  let cumulativeByteOffset = sidxAbsEnd + firstOffset;
  let cumulativeTime = earliestPresentationTime;

  for (let i = 0; i < referenceCount; i++) {
    const word1 = sidxBuf.readUInt32BE(p); p += 4;
    const referenceType = (word1 >>> 31) & 0x1;      // 0 = media, 1 = points to ANOTHER sidx box
    const referencedSize = word1 & 0x7fffffff;         // low 31 bits
    const subsegmentDuration = sidxBuf.readUInt32BE(p); p += 4;
    p += 4; // SAP flags/type/delta - not needed, DASH segments are SAP-aligned

    segments.push({
      index: i,
      referenceType,
      byteStart: cumulativeByteOffset,
      byteEnd: cumulativeByteOffset + referencedSize - 1,
      timeStart: cumulativeTime / timescale,
      timeEnd: (cumulativeTime + subsegmentDuration) / timescale
    });

    cumulativeByteOffset += referencedSize;
    cumulativeTime += subsegmentDuration;
  }

  return { timescale, earliestPresentationTime, segments };
}

function readUInt64BE(buf, offset) {
  const high = buf.readUInt32BE(offset);
  const low = buf.readUInt32BE(offset + 4);
  return high * 2 ** 32 + low;
}

module.exports = { parseTopLevelBoxes, parseSidx };
