/**
 * Components — video player.
 *
 * Lessons embed YouTube videos through `youtube-nocookie.com` (no tracking
 * cookie until playback). The URL is built by the API (`embed_url`), not here,
 * so the allow-list of hosts lives in one place — the backend.
 *
 * Nothing is loaded into the iframe until the learner asks for it: the poster
 * plus a button keeps third-party requests (and their cost) off the page until
 * they are actually wanted.
 */
import { el } from '../core/dom.js';
import { formatClock } from '../core/format.js';

/**
 * @param {object} video  A lesson video DTO: `{ id, title, embed_url, watch_url, thumbnail_url, duration_seconds, provider }`.
 * @param {object} [options]
 * @param {boolean} [options.autoload]  Render the iframe immediately (used after a click).
 */
export function videoPlayer(video, { autoload = false } = {}) {
  if (!video?.embed_url) {
    return el('p', { class: 'alert alert--info', text: 'This lesson has no video.' });
  }

  const frame = el('div', { class: 'video-frame' });

  const mount = () => {
    frame.replaceChildren(
      el('iframe', {
        attrs: {
          src: video.embed_url,
          title: video.title ? `Video: ${video.title}` : 'Lesson video',
          loading: 'lazy',
          allow: 'accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
          allowfullscreen: '',
          referrerpolicy: 'strict-origin-when-cross-origin',
        },
      }),
    );
  };

  if (autoload) {
    mount();
    return frame;
  }

  const button = el('button', {
    class: 'btn btn--primary',
    text: video.title ? `Play: ${video.title}` : 'Play video',
    attrs: { type: 'button' },
    on: { click: mount },
  });

  frame.append(
    el('div', {
      class: 'stack-sm',
      attrs: { style: 'padding: var(--space-6); text-align: center; color: #fff;' },
      children: [
        video.thumbnail_url
          ? el('img', {
              attrs: { src: video.thumbnail_url, alt: '', width: '640', height: '360', style: 'border-radius: var(--radius-md)' },
            })
          : null,
        button,
        el('p', {
          class: 'subtle',
          attrs: { style: 'color: #d1d5db;' },
          text: video.provider === 'youtube' ? 'Loads from YouTube (privacy-enhanced mode).' : '',
        }),
      ],
    }),
  );

  return frame;
}

/** Playlist of the other videos in the lesson. */
export function videoList(videos, { onSelect, activeId = null } = {}) {
  return el('ul', {
    class: 'video-list',
    children: videos.map((video) =>
      el('li', {
        children: [
          el('button', {
            class: 'video-list__item',
            attrs: { type: 'button', ...(video.id === activeId ? { 'aria-current': 'true' } : {}) },
            on: { click: () => onSelect?.(video) },
            children: [
              video.thumbnail_url
                ? el('img', { class: 'video-list__thumb', attrs: { src: video.thumbnail_url, alt: '', loading: 'lazy' } })
                : el('span', { class: 'video-list__thumb', attrs: { 'aria-hidden': 'true' } }),
              el('span', {
                class: 'stack-sm',
                children: [
                  el('span', { class: 'video-list__title', text: video.title ?? 'Untitled video' }),
                  el('span', {
                    class: 'subtle',
                    text: [
                      video.provider,
                      video.duration_seconds ? formatClock(video.duration_seconds) : null,
                      video.is_primary ? 'primary' : null,
                    ]
                      .filter(Boolean)
                      .join(' · '),
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ),
  });
}
