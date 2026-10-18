/**
 * Sholynk Tech — upload validation without native dependencies.
 *
 * The legacy CMS decoded every upload with `sharp` before storing it, so HTML or
 * arbitrary bytes could never be published from /uploads under an
 * image-looking extension. Workers cannot run sharp; instead we sniff the
 * container magic bytes of the five accepted formats. This is not a full decode
 * (a truncated image still passes) but it does guarantee the stored content
 * type matches the actual container, which is what the served Content-Type and
 * the "no HTML in the media library" rule depend on.
 */

export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'gif' | 'avif';

export const IMAGE_EXTENSIONS: Readonly<Record<ImageFormat, string>> = {
  jpeg: '.jpg',
  png: '.png',
  webp: '.webp',
  gif: '.gif',
  avif: '.avif',
};

export const IMAGE_MIME_TYPES: Readonly<Record<ImageFormat, string>> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
};

const MIME_TO_FORMAT: Readonly<Record<string, ImageFormat>> = {
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/pjpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

/** Detects the container format from magic bytes, or null when unrecognised. */
export function sniffImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (bytes.length < 16) return null;
  const ascii = (start: number, length: number): string => {
    let out = '';
    for (let i = start; i < start + length && i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]!);
    return out;
  };

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 && ascii(1, 3) === 'PNG' &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'png';
  }

  // GIF: "GIF87a" / "GIF89a"
  if (ascii(0, 3) === 'GIF' && ascii(3, 2) === '87' || ascii(0, 3) === 'GIF' && ascii(3, 2) === '89') {
    return 'gif';
  }

  // WebP: "RIFF" … "WEBP"
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'webp';

  // AVIF: ISO-BMFF with an "ftyp" box whose major brand is avif/avis
  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4);
    if (brand === 'avif' || brand === 'avis') return 'avif';
  }

  return null;
}

/**
 * Validates an upload: the declared MIME type must be one we accept AND the
 * bytes must actually be that container. Returns the canonical format, or an
 * error message written for the uploader.
 */
export function validateImageUpload(
  declaredMime: string,
  bytes: Uint8Array,
): { format: ImageFormat; mime: string } | { error: string } {
  const normalizedMime = String(declaredMime || '').split(';')[0]!.trim().toLowerCase();
  if (!MIME_TO_FORMAT[normalizedMime]) {
    return { error: 'Unsupported image type. Use JPEG, PNG, WebP, GIF or AVIF.' };
  }
  const sniffed = sniffImageFormat(bytes);
  if (!sniffed) {
    return { error: 'The uploaded file is not a valid supported image.' };
  }
  if (sniffed !== MIME_TO_FORMAT[normalizedMime]) {
    return { error: 'Image content does not match its declared MIME type.' };
  }
  return { format: sniffed, mime: IMAGE_MIME_TYPES[sniffed] };
}

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** Builds the stored filename: sanitised base + random suffix + real extension. */
export function storedFilename(originalName: string, format: ImageFormat, randomHex: string): string {
  const ext = IMAGE_EXTENSIONS[format];
  const base = originalName
    .replace(/\.[^.]*$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'image';
  return `${base}-${randomHex}${ext}`;
}
