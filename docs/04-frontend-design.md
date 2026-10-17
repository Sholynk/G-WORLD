# Front-end design system

The G WORLD interface is built on one small design system: one palette, two
typefaces, one spacing scale, one breakpoint. Everything else — the hero
slider, the loading states, the motion — is built on top of it.

Files:

| File | What it holds |
| --- | --- |
| `apps/web/public/assets/css/tokens.css` | Palette, type scale, spacing, radii, the single breakpoint |
| `apps/web/public/assets/css/base.css` | Reset, typography, element defaults, focus states |
| `apps/web/public/assets/css/layout.css` | Page shell, navigation, footer, grids, app shell |
| `apps/web/public/assets/css/components.css` | Buttons, cards, tags, progress, tables' parts, hero, CTA band |
| `apps/web/public/assets/css/forms.css` | Fields, inputs, selects, buttons of forms |
| `apps/web/public/assets/css/tables.css` | Table shell, cells, the horizontal scroll container |
| `apps/web/public/assets/css/animations.css` | Keyframes, the reveal system, the reduced-motion switch |

---

## 1. Palette

Ten colours, and no others. A test (`tests/unit/layout-contract.test.ts`) reads
every CSS, HTML and JavaScript file in `apps/web/public` and fails if a colour
outside the list appears anywhere.

| Token | Value | Used for |
| --- | --- | --- |
| `--black` | `#000000` | Sidebar, text, the "danger" badge |
| `--white` | `#FFFFFF` | Cards, text on blue |
| `--blue` | `#0C7ABF` | Primary buttons, active links, progress fill, focus ring |
| `--blue-dark-text` | `#0A5C8F` | Tag text, the hovered primary button |
| `--blue-tint` | `#E8F5FD` | Tag background, image placeholder, hover fills |
| `--gray-text` | `#536471` | Secondary text, input borders |
| `--border` | `#CFD9DE` | Card, table and field borders |
| `--surface-muted` | `#EFF3F4` | The track of a progress bar, badges |
| `--surface-subtle` | `#F7F9F9` | Table headers, the hero background |
| `--on-dark-muted` | `#A7B0B8` | Footer and sidebar text |

White text on blue is the only white-on-blue combination in the system.

## 2. Type

* Sora 600/700 — headings, the brand, the large numbers.
* Public Sans 400/600 — body copy, buttons, inputs.

| Element | Desktop | Mobile |
| --- | --- | --- |
| `h1` | 44px | 30px |
| `h2` (public pages) | 28px | 22px |
| `h2` (`.app-page`) | 26px | 22px |
| `h3` (cards) | 18px | 18px |
| body | 15px / 1.5 | 15px / 1.5 |
| `.tag` | 12px / 600 | 12px / 600 |

## 3. One breakpoint

Everything is written desktop-first with a single `max-width: 767px` query
(the 768px breakpoint). Below it:

* the public navigation folds into the "Menu" disclosure;
* the student and admin sidebar becomes a horizontal, scrollable tab strip;
* the grids collapse to one column;
* tables scroll inside their own container — the page never scrolls sideways;
* the hero shows the text panel only.

### 3.1 Touch targets

Everything a finger has to hit is at least 44px tall, and a control that is
drawn smaller keeps the size somewhere else:

| Control | Drawn as | The tap target is |
| --- | --- | --- |
| Button (`.btn`) | 44px tall | the button |
| Small button (`.btn--sm`) | 36px tall on desktop | 44px on a phone |
| Card title | the title text | the whole card (`.card__title a::after`) |
| Link in a table cell | the text | the cell, or a 44px box |
| Carousel dot | a 4px bar | a 44px box around it (`.hero__dot::before`) |
| Checkbox | a 1.15rem box | its 44px label |
| Brand, footer and auth links | the text | a 44px box |

## 4. Motion and effects

All of it is decorative, and all of it is switched off for visitors who ask
for less motion (`prefers-reduced-motion: reduce`): the stylesheet drops every
transition and keyframe, and the JavaScript helpers (`core/motion.js`) skip
the animation and show the final state instead.

| Effect | Where | Module |
| --- | --- | --- |
| Hero slider, 5 s rotation | Home page | `components/carousel.js` |
| Typewriter line | Home page | `components/typewriter.js` |
| Scroll reveal | Every page | `core/motion.js` |
| Count-up numbers | Home page, dashboard, analytics | `core/motion.js` |
| Skeleton placeholders | Every list and table | `components/skeleton.js` |
| Busy button | Every form | `components/loading.js` |
| Top progress bar | Every page | `components/loading.js` |
| Back to top | Every page | `components/back-to-top.js` |
| Sticky header with a shadow | Public pages | `core/boot.js` |

The reveal system only hides content when JavaScript is running: `config.js`
adds the `js` class to `<html>` before the first paint, and the stylesheet
scopes the hidden state to `.js [data-reveal]`. A page without JavaScript
shows everything.

The carousel pauses when the visitor hovers it, focuses it, or switches to
another tab, and it can be paused by hand. It answers to the arrow keys and to
a swipe.

## 5. Progressive enhancement

Every effect is an addition, never a requirement:

* the hero is readable with JavaScript switched off — the first slide is in the
  HTML;
* the typewriter line has a static sentence for screen readers;
* the carousel is announced as a carousel (`aria-roledescription`) and the
  slides that are not on screen are hidden from assistive technology;
* the skeletons are replaced by the real content, and the empty states carry
  the same message.

## 6. Checking the layout in a browser

The smoke tests (`npm run test:web`) load the pages into a DOM and assert that
they render; they never lay a page out, so they cannot see a broken grid, a
hidden reveal or a tap target that is too small. Those need a real browser:

```bash
npm run dev                 # the site on http://localhost:32951
```

Then open the pages at the two widths of the template and walk this list:

| # | Check | How |
| --- | --- | --- |
| 1 | The page never scrolls sideways | `document.documentElement.scrollWidth === clientWidth` (tables and the tab strip scroll inside their own box) |
| 2 | Every control has a 44px tap target | `document.elementFromPoint()` around the control, or the finger on a phone |
| 3 | The mobile menu opens and closes | the "Menu" disclosure under the nav |
| 4 | The sidebar is a horizontal tab strip on a phone | the student and admin pages |
| 5 | The carousel rotates, pauses and resumes | the home page |
| 6 | The filters narrow the list | the courses page |
| 7 | A keyboard focus is visible | <kbd>Tab</kbd> through the page |
| 8 | The console is clean | the browser's console |

A headless browser (for example Chromium through `puppeteer-core`) can run the
same list automatically; the important part is that it talks to the **dev
server**, not to the API directly, because the dev server is what a developer
and the preview actually use.

