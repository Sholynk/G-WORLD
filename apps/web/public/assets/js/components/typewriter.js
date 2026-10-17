/**
 * Components — typewriter.
 *
 * Types a phrase out character by character, pauses, erases it and types the
 * next one. The loop is decorative, so:
 *
 *   · with reduced motion the phrases simply change, without typing;
 *   · the animated text is hidden from assistive technology and a static
 *     sentence is offered to screen readers instead;
 *   · the loop stops while the tab is in the background and picks up again
 *     when it comes back.
 */
import { prefersReducedMotion } from '../core/motion.js';

const TYPE_SPEED = 55;
const ERASE_SPEED = 32;
const HOLD_TIME = 1800;

/**
 * @param {object} options
 * @param {HTMLElement} options.element the element that holds the phrases
 * @param {string[]} options.phrases the phrases to type
 * @param {number} [options.startDelay] milliseconds before the first character
 * @returns {{stop: () => void}|null}
 */
export function createTypewriter({ element, phrases, startDelay = 600 } = {}) {
  if (!element || !phrases?.length) return null;

  const text = element.querySelector('[data-typewriter-text]');
  const caret = element.querySelector('[data-typewriter-caret]');
  if (!text) return null;

  const reduced = prefersReducedMotion();
  let index = 0;
  let timer = null;
  let stopped = false;

  const schedule = (fn, delay) => {
    timer = window.setTimeout(() => {
      if (stopped) return;
      fn();
    }, delay);
  };

  /** Types the current phrase, then erases it and moves to the next. */
  const type = () => {
    const phrase = phrases[index % phrases.length];
    let position = 0;

    const step = () => {
      if (stopped) return;
      position += 1;
      text.textContent = phrase.slice(0, position);
      if (position < phrase.length) {
        schedule(step, TYPE_SPEED);
        return;
      }
      schedule(() => erase(phrase), HOLD_TIME);
    };

    const erase = (current) => {
      let remaining = current.length;

      const step = () => {
        if (stopped) return;
        remaining -= 1;
        text.textContent = current.slice(0, remaining);
        if (remaining > 0) {
          schedule(step, ERASE_SPEED);
          return;
        }
        index += 1;
        type();
      };

      step();
    };

    step();
  };

  /** The reduced-motion version: the phrase simply changes. */
  const swap = () => {
    index += 1;
    text.textContent = phrases[index % phrases.length];
    schedule(swap, HOLD_TIME + 1200);
  };

  const run = () => {
    stopped = false;
    if (reduced) {
      text.textContent = phrases[0];
      schedule(swap, HOLD_TIME);
      return;
    }
    text.textContent = '';
    schedule(type, startDelay);
  };

  const stop = () => {
    stopped = true;
    if (timer) window.clearTimeout(timer);
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else run();
  });

  if (caret) caret.hidden = reduced;

  run();

  return { stop };
}
