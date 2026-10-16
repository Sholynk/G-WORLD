/**
 * G WORLD — YouTube video reference handling.
 *
 * Videos are stored as a provider + video id, never as an arbitrary embed URL.
 * That means an administrator cannot paste a URL that ends up as an `<iframe>`
 * pointing at an untrusted origin: only ids matching YouTube's format are
 * accepted, and embed URLs are always rebuilt from the id here.
 */

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const LOOSE_ID_PATTERN = /^[A-Za-z0-9_-]{6,20}$/;

const HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'youtu.be',
  'www.youtu.be',
]);

/**
 * Extracts a YouTube video id from any common URL shape, or returns null.
 *
 * Accepts: youtu.be/<id>, /watch?v=<id>, /embed/<id>, /shorts/<id>, /live/<id>,
 * /v/<id>, and a bare 11-character id.
 */
export function extractYouTubeId(input: string | null | undefined): string | null {
  if (!input) return null;
  const value = input.trim();
  if (!value) return null;

  if (VIDEO_ID_PATTERN.test(value)) return value;

  let url: URL;
  try {
    url = new URL(value.includes('://') ? value : `https://${value}`);
  } catch {
    return null;
  }

  if (!HOSTS.has(url.hostname.toLowerCase())) return null;
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const path = url.pathname.replace(/\/+$/, '');
  const segments = path.split('/').filter(Boolean);
  const queryId = url.searchParams.get('v');

  const candidates: (string | null | undefined)[] = [
    queryId,
    segments.length === 1 ? segments[0] : null, // youtu.be/<id>
    segments.length >= 2 ? segments[1] : null, // /embed/<id>, /shorts/<id>, /live/<id>, /v/<id>
  ];

  for (const candidate of candidates) {
    if (candidate && VIDEO_ID_PATTERN.test(candidate)) return candidate;
  }
  return null;
}

/** True when a value could be a video id in the looser sense used by validation. */
export function isLooseVideoId(value: string): boolean {
  return LOOSE_ID_PATTERN.test(value);
}

export interface EmbedOptions {
  /** Start playback at this second. */
  startSeconds?: number;
  /** Avoids YouTube setting cookies on the student's browser. */
  privacyEnhanced?: boolean;
  autoplay?: boolean;
  controls?: boolean;
}

export function buildEmbedUrl(videoId: string, options: EmbedOptions = {}): string {
  if (!VIDEO_ID_PATTERN.test(videoId)) {
    throw new RangeError(`invalid YouTube video id: ${videoId}`);
  }
  const host = options.privacyEnhanced === false ? 'www.youtube.com' : 'www.youtube-nocookie.com';
  const params = new URLSearchParams({ rel: '0', modestbranding: '1' });
  if (options.startSeconds && options.startSeconds > 0) params.set('start', String(Math.floor(options.startSeconds)));
  params.set('autoplay', options.autoplay ? '1' : '0');
  params.set('controls', options.controls === false ? '0' : '1');
  return `https://${host}/embed/${videoId}?${params.toString()}`;
}

export function buildWatchUrl(videoId: string, startSeconds?: number): string {
  const base = `https://www.youtube.com/watch?v=${videoId}`;
  return startSeconds && startSeconds > 0 ? `${base}&t=${Math.floor(startSeconds)}s` : base;
}

export function buildThumbnailUrl(videoId: string, quality: 'default' | 'medium' | 'high' = 'high'): string {
  const file = quality === 'default' ? 'default.jpg' : quality === 'medium' ? 'mqdefault.jpg' : 'hqdefault.jpg';
  return `https://i.ytimg.com/vi/${videoId}/${file}`;
}

/** Validates a stored video reference (used by tests and by the admin API). */
export function isPlayableReference(videoId: string): boolean {
  return VIDEO_ID_PATTERN.test(videoId);
}
