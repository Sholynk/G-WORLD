/**
 * Pages Function — `/uploads/*` media files.
 *
 * Uploads live in the API worker's R2 bucket; the browser keeps using the same
 * `/uploads/<filename>` URLs the legacy site served from disk. The worker only
 * streams files that exist in the media-library table (its allow-list).
 */
import { proxiedDocument, serviceUnavailable } from '../_lib/presentation';

export const onRequest = proxiedDocument(
  (context) => {
    const path = String(context.params.path ?? '')
      .split('/')
      .map((segment) => encodeURIComponent(decodeURIComponent(segment)))
      .join('/');
    return { pathname: `/api/v1/uploads/${path}`, search: '' };
  },
  () => serviceUnavailable('Media storage is temporarily unavailable.', 'text/plain; charset=utf-8'),
);
