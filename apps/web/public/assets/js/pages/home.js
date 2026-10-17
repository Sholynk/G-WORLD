/**
 * Page — home.
 *
 * The page is mostly static: the hero slider, the "How learning flows" row and
 * the footer are in the HTML. This module adds the behaviour:
 *
 *   · the hero carousel (three slides, five seconds each);
 *   · the typewriter line under the hero;
 *   · the numbers strip, which counts up from the public statistics;
 *   · the department cards, which come from the public catalogue API and are
 *     preceded by skeletons while they are on their way.
 */
import { api } from '../core/api.js';
import { qs } from '../core/dom.js';
import { countUpOnScroll, revealOnScroll } from '../core/motion.js';
import { departmentCard } from '../components/cards.js';
import { createCarousel } from '../components/carousel.js';
import { emptyState } from '../components/empty-state.js';
import { skeletonGrid } from '../components/skeleton.js';
import { createTypewriter } from '../components/typewriter.js';
import { pageError, setBusy } from './_shared.js';

const PHRASES = [
  'short video lessons',
  'quizzes that check what you understood',
  'certificates anyone can verify with a QR code',
];

export async function init({ signal }) {
  mountHero();
  revealOnScroll();

  const host = qs('[data-home-departments]');
  if (host) {
    skeletonGrid(host, 3);
    await loadDepartments(host, signal);
  }

  await loadStats(signal);
}

/* -------------------------------------------------------------------- hero */

/** Wires the carousel and the typewriter of the hero. */
function mountHero() {
  const slider = qs('[data-hero-slider]');
  if (slider) {
    createCarousel({
      root: slider,
      duration: 5000,
    });
  }

  const typewriter = qs('[data-typewriter]');
  if (typewriter) {
    createTypewriter({ element: typewriter, phrases: PHRASES });
  }
}

/* -------------------------------------------------------------- departments */

async function loadDepartments(host, signal) {
  try {
    const departments = await api.get('/departments', { signal });
    const visible = (departments ?? []).slice(0, 3);

    host.replaceChildren(
      ...(visible.length
        ? visible.map((department) => departmentCard(department))
        : [
            emptyState({
              title: 'No departments published yet',
              message: 'The catalogue is being prepared — check back soon.',
            }),
          ]),
    );
    setBusy(host, false);
    revealOnScroll(host);
  } catch (error) {
    setBusy(host, false);
    pageError(error, () => init({ signal }));
  }
}

/* ------------------------------------------------------------------- stats */

/** Fills the numbers strip and counts the numbers up. */
async function loadStats(signal) {
  const host = qs('[data-home-stats]');
  if (!host) return;

  try {
    const stats = await api.get('/stats', { signal });
    const values = [
      stats?.departments ?? 0,
      stats?.courses ?? 0,
      stats?.lessons ?? 0,
      stats?.learners ?? 0,
      stats?.certificates ?? 0,
    ];

    host.querySelectorAll('[data-count]').forEach((node, index) => {
      node.setAttribute('data-count', String(values[index] ?? 0));
    });

    countUpOnScroll(host);
  } catch {
    // The strip is decorative: if the numbers cannot be loaded, they simply
    // stay at zero rather than breaking the page.
    for (const node of host.querySelectorAll('[data-count]')) {
      node.textContent = '0';
    }
  }
}
