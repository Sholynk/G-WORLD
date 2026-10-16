/**
 * G WORLD — QR code rendering.
 *
 * QR images are rendered on demand as SVG rather than stored as binary blobs:
 * the payload is tiny (a verification URL), the image is cacheable, and the
 * database stays free of binary data. `uqr` is pure JavaScript with no Node
 * built-ins, so it runs in the Workers runtime and in Miniflare tests.
 *
 * Encoding level M (≈15% recovery) is the practical default for links; the
 * modules are drawn with a quiet-zone border so phone cameras lock on quickly.
 */
import { renderSVG } from 'uqr';

export interface QrRenderOptions {
  /** Module size in SVG user units. */
  pixelSize?: number;
  /** Quiet zone, in modules. 2 is comfortable for screen scanning. */
  border?: number;
  darkColor?: string;
  lightColor?: string;
  /** Accessible label used for the SVG `title`/`aria-label`. */
  label?: string;
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
}

export interface RenderedQr {
  svg: string;
  /** Payload encoded in the image — useful for logs and tests. */
  payload: string;
  size: number;
}

export function renderQrSvg(payload: string, options: QrRenderOptions = {}): RenderedQr {
  if (!payload || payload.length > 1200) {
    throw new RangeError('QR payload must be between 1 and 1200 characters');
  }

  const {
    pixelSize = 8,
    border = 2,
    darkColor = '#0b1220',
    lightColor = '#ffffff',
    label,
    errorCorrectionLevel = 'M',
  } = options;

  const svg = renderSVG(payload, {
    ecc: errorCorrectionLevel,
    border,
    pixelSize,
    blackColor: darkColor,
    whiteColor: lightColor,
  });

  const size = (svg.match(/width="(\d+)"/)?.[1] ?? '0') as string;

  if (!label) return { svg, payload, size: Number.parseInt(size, 10) || 0 };

  // Add an accessible title without altering the drawing itself.
  const labelled = svg.replace(
    /<svg([^>]*)>/,
    `<svg$1 role="img" aria-label="${escapeAttribute(label)}"><title>${escapeText(label)}</title>`,
  );
  return { svg: labelled, payload, size: Number.parseInt(size, 10) || 0 };
}

function escapeText(value: string): string {
  return value.replace(/[<>&]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[char] ?? char);
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;');
}

/**
 * Builds the canonical public verification payload for a student identity code
 * or a certificate. Scanners open this URL, which resolves to the verification
 * page — the code itself is not a secret, the page shows only public facts.
 */
export function buildVerificationUrl(baseUrl: string, code: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/verify.html?code=${encodeURIComponent(code)}`;
}
