// Extract {width,height,type,sha256,bytes,phash} from raw image bytes.
// sharp = fast native decode (~7ms/img); image-size = header fallback.
import sharp from "sharp";
import { imageSize } from "image-size";
import { sha256 } from "./util.mjs";

sharp.cache(false); // don't hold decoded buffers between calls
sharp.concurrency(1); // we parallelise at the fetch layer

/** 64-bit difference hash as a binary string (rows of 9 greyscale px → 8 comparisons). */
async function dhash(buffer) {
  const raw = await sharp(buffer).resize(9, 8, { fit: "fill" }).greyscale().raw().toBuffer();
  let bits = "";
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) bits += raw[y * 9 + x] < raw[y * 9 + x + 1] ? "0" : "1";
  }
  return bits;
}

export async function imageMeta(buffer) {
  const meta = {
    sha256: sha256(buffer),
    bytes: buffer.length,
    width: null,
    height: null,
    type: null,
    phash: null,
    decodeError: null,
  };
  try {
    const m = await sharp(buffer).metadata();
    meta.width = m.width || null;
    meta.height = m.height || null;
    meta.type = m.format || null;
  } catch (e) {
    meta.decodeError = "sharp-meta:" + (e.message || e);
    try {
      const d = imageSize(buffer);
      meta.width = d.width || null;
      meta.height = d.height || null;
      meta.type = d.type || null;
    } catch (e2) {
      meta.decodeError += "; image-size:" + (e2.message || e2);
    }
  }
  if (meta.width && meta.height) {
    try {
      meta.phash = await dhash(buffer);
    } catch (e) {
      meta.decodeError = (meta.decodeError ? meta.decodeError + "; " : "") + "sharp-hash:" + (e.message || e);
    }
  }
  return meta;
}

export const longestSide = (w, h) => Math.max(w || 0, h || 0);
