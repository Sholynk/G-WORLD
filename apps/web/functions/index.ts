/**
 * Pages Function — the homepage (`/`).
 *
 * Serves the static index.html shell with live site settings (title,
 * description, keywords, tagline, JSON-LD) injected from the database, and
 * canonical/Open Graph URLs rewritten to the origin serving the request —
 * exactly what the legacy Express `renderHomepage` did.
 */
import { homepage } from './_lib/presentation';

export const onRequest = homepage;
