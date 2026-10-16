-- ===========================================================================
-- G WORLD — Seed 002: demo curriculum (modules, lessons, videos, resources)
-- ---------------------------------------------------------------------------
-- DEVELOPMENT ONLY. Applied by: npm run db:seed:local
--
-- Video references are real, publicly available YouTube ids so the lesson player
-- can be exercised end to end. They are third-party content: replace them with
-- your own material before publishing a production course.
-- ===========================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Modules
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO modules (id, course_id, title, description, position, status) VALUES
  ('mod_hc_1', 'crs_html_css', 'Getting started with HTML', 'Document structure, elements and text.', 0, 'published'),
  ('mod_hc_2', 'crs_html_css', 'Styling with CSS', 'Selectors, the box model and colour.', 1, 'published'),
  ('mod_hc_3', 'crs_html_css', 'Layout & accessibility', 'Grid, Flexbox and what makes a page usable.', 2, 'published'),

  ('mod_js_1', 'crs_js_fundamentals', 'Language basics', 'Values, variables, functions and control flow.', 0, 'published'),
  ('mod_js_2', 'crs_js_fundamentals', 'The DOM and events', 'Making pages interactive.', 1, 'published'),
  ('mod_js_3', 'crs_js_fundamentals', 'Talking to APIs', 'fetch, JSON and error handling.', 2, 'published'),

  ('mod_data_1', 'crs_data_basics', 'Data hygiene', 'What makes data messy and how to fix it.', 0, 'published'),
  ('mod_data_2', 'crs_data_basics', 'Describing data', 'Summary statistics that do not mislead.', 1, 'published'),

  ('mod_sec_1', 'crs_security_essentials', 'Thinking like an attacker', 'Threat modelling without the jargon.', 0, 'published'),
  ('mod_sec_2', 'crs_security_essentials', 'Authentication & sessions', 'Passwords, cookies and access control.', 1, 'published'),

  ('mod_phy_1', 'crs_physics_motion', 'Motion in a straight line', 'Speed, velocity and acceleration.', 0, 'published'),
  ('mod_vis_1', 'crs_visual_typography', 'Type fundamentals', 'Scales, rhythm and contrast.', 0, 'published'),
  ('mod_biz_1', 'crs_start_business', 'Validating the idea', 'Talking to customers before building.', 0, 'published'),
  ('mod_acc_1', 'crs_bookkeeping', 'Double entry', 'Debits, credits and the accounting equation.', 0, 'published'),
  ('mod_ph_1', 'crs_public_health', 'How disease spreads', 'Transmission routes and prevention.', 0, 'published'),
  ('mod_bio_1', 'crs_biology_cells', 'The cell', 'Structure and function.', 0, 'draft');

-- ---------------------------------------------------------------------------
-- Lessons
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO lessons (id, module_id, title, slug, content_md, objectives_json, position, estimated_minutes, is_preview, completion_rule, status) VALUES
  -- HTML & CSS Foundations
  ('lsn_hc_1_1', 'mod_hc_1', 'What a web page actually is', 'what-a-web-page-actually-is',
   '## The three languages

Every page you have ever used is built from three things:

- **HTML** describes *what* the content is
- **CSS** describes *how* it looks
- **JavaScript** describes *what it does*

Start by writing a page with only HTML. If it makes sense with no styling at all, the structure is right.

### Your first document

```
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>My first page</title>
  </head>
  <body>
    <h1>Hello</h1>
    <p>This is a paragraph.</p>
  </body>
</html>
```

Notice `lang="en"`: screen readers use it to pick a pronunciation. Accessibility starts on line one.',
   '["Explain the roles of HTML, CSS and JavaScript","Write a valid HTML5 document","Use lang and meta charset correctly"]',
   0, 20, 1, 'mark_complete', 'published'),

  ('lsn_hc_1_2', 'mod_hc_1', 'Elements, attributes and nesting', 'elements-attributes-and-nesting',
   '## Anatomy of an element

An element is an opening tag, some content and a closing tag: `<p>text</p>`. Attributes add meaning: `<a href="/courses.html">Courses</a>`.

### Nesting rules

Lists go inside lists only when they belong to a list item. Getting this wrong does not break the page visually, but it breaks it for anyone using a screen reader — which is 2–3% of your users.',
   '["Read and write nested markup","Use attributes for links and images","Recognise invalid nesting"]',
   1, 25, 0, 'mark_complete', 'published'),

  ('lsn_hc_2_1', 'mod_hc_2', 'Selectors and the box model', 'selectors-and-the-box-model',
   '## Selecting

`p { }` targets every paragraph. `.card { }` targets a class. `#main { }` targets an id — use ids sparingly.

### The box model

Every element is a box: content, padding, border, margin.

```
.card {
  padding: 16px;
  border: 1px solid #e5e7eb;
  margin-bottom: 24px;
}
```

Set `box-sizing: border-box` globally and padding stops surprising you.',
   '["Write class and element selectors","Explain content, padding, border and margin","Use box-sizing: border-box"]',
   0, 30, 1, 'mark_complete', 'published'),

  ('lsn_hc_3_1', 'mod_hc_3', 'Responsive layout with Grid and Flexbox', 'responsive-layout-with-grid-and-flexbox',
   '## One dimension or two?

Flexbox arranges items along **one** axis; Grid arranges them in **two**. Use Flexbox for a toolbar, Grid for a page skeleton.

```
.layout { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 24px; }
```

That single line is a responsive card grid with no media queries at all.',
   '["Choose between Flexbox and Grid","Build a responsive card grid","Use gap instead of margin hacks"]',
   0, 35, 0, 'mark_complete', 'published'),

  ('lsn_hc_3_2', 'mod_hc_3', 'Accessibility you can test in five minutes', 'accessibility-you-can-test-in-five-minutes',
   '## The five-minute test

1. Press **Tab** through the page. Can you see where you are at every step?
2. Zoom to 200%. Does anything disappear?
3. Check body text contrast against its background.
4. Turn on your operating system''s reduced-motion setting.
5. Read the page heading with your eyes closed — does the order make sense?
',
   '["Run a basic accessibility pass","Identify focus-visible problems","Check contrast ratios"]',
   1, 25, 0, 'mark_complete', 'published'),

  -- JavaScript Fundamentals
  ('lsn_js_1_1', 'mod_js_1', 'Values, variables and types', 'values-variables-and-types',
   '## Declare with const first

Use `const` unless you must reassign, then `let`. Never `var`.

```
const price = 1500;
let quantity = 2;
quantity = 3;
```

JavaScript has six primitive types: string, number, boolean, null, undefined and symbol. Everything else is an object.',
   '["Declare variables with const and let","Identify primitive types","Explain why var is avoided"]',
   0, 25, 1, 'mark_complete', 'published'),

  ('lsn_js_1_2', 'mod_js_1', 'Functions and control flow', 'functions-and-control-flow',
   '## Functions

A function is a named block of behaviour. Keep them small and give them verbs for names: `calculateTotal()`, not `total2()`.

```
function calculateTotal(price, quantity) {
  return price * quantity;
}
```

Control flow (`if`, `for`, `while`) decides what runs. Prefer `for...of` over index loops — fewer off-by-one mistakes.',
   '["Write and call functions","Use if/else and loops","Prefer for...of for iteration"]',
   1, 30, 0, 'mark_complete', 'published'),

  ('lsn_js_2_1', 'mod_js_2', 'Finding and changing elements', 'finding-and-changing-elements',
   '## querySelector

```
const title = document.querySelector(''h1'');
title.textContent = ''Updated'';
```

Use `textContent`, not `innerHTML`, when the value comes from a person — that is how you avoid injecting markup by accident.',
   '["Select elements with querySelector","Update text safely","Understand why innerHTML is risky"]',
   0, 30, 0, 'mark_complete', 'published'),

  ('lsn_js_2_2', 'mod_js_2', 'Events and forms', 'events-and-forms',
   '## Listening

```
form.addEventListener(''submit'', (event) => {
  event.preventDefault();
  save(form.elements.email.value);
});
```

Always `preventDefault()` when you handle a submit yourself, and always show the user something happened — silence reads as a broken page.',
   '["Attach event listeners","Handle form submission","Give users feedback"]',
   1, 30, 0, 'mark_complete', 'published'),

  ('lsn_js_3_1', 'mod_js_3', 'Fetching data', 'fetching-data',
   '## fetch in one example

```
const response = await fetch(''/api/v1/courses'');
if (!response.ok) throw new Error(`Request failed: ${response.status}`);
const { data } = await response.json();
```

Check `response.ok` before parsing. A 404 still has a body, and it is not the data you wanted.',
   '["Call an API with fetch","Check response.ok","Handle failures without crashing"]',
   0, 40, 1, 'quiz_pass', 'published'),

  ('lsn_js_3_2', 'mod_js_3', 'Building a small app', 'building-a-small-app',
   '## Putting it together

You now have everything needed for a search box that filters a list:

1. listen for `input` on the field
2. read `field.value`
3. filter the array
4. render the result into a container

Write it yourself before looking anything up. The struggle is where the learning happens.',
   '["Combine DOM, events and data","Render a filtered list","Structure code into functions"]',
   1, 45, 0, 'mark_complete', 'published'),

  -- Data Analysis Foundations
  ('lsn_data_1_1', 'mod_data_1', 'What makes data messy', 'what-makes-data-messy',
   '## The usual suspects

- inconsistent capitalisation (`Lagos`, `lagos`, `LAGOS`)
- dates as text (`12/03/2026` — is that March or December?)
- duplicates with slightly different spellings

Count before you clean: `SELECT COUNT(*), COUNT(DISTINCT email)` tells you a lot.',
   '["Identify common data-quality problems","Count and de-duplicate records","Store dates as ISO-8601"]',
   0, 30, 1, 'mark_complete', 'published'),

  ('lsn_data_2_1', 'mod_data_2', 'Averages that lie', 'averages-that-lie',
   '## Mean vs median

If nine people earn ₦50,000 and one earns ₦5,000,000, the mean is ₦545,000 — and it describes nobody. The median (₦50,000) is the honest summary.

Always ask: is the distribution skewed? If yes, report the median and the range.',
   '["Choose mean or median appropriately","Report spread alongside centre","Spot a misleading average in the wild"]',
   0, 35, 0, 'mark_complete', 'published'),

  -- Security Essentials
  ('lsn_sec_1_1', 'mod_sec_1', 'Threat modelling in ten minutes', 'threat-modelling-in-ten-minutes',
   '## Four questions

1. What are we building?
2. What can go wrong?
3. What are we going to do about it?
4. Did we do a good enough job?

Answer those on one page and you have done more than most teams ever do.',
   '["Run a lightweight threat model","Rank risks by impact and likelihood","Record mitigations"]',
   0, 30, 1, 'mark_complete', 'published'),

  ('lsn_sec_2_1', 'mod_sec_2', 'Passwords, sessions and cookies', 'passwords-sessions-and-cookies',
   '## Rules that matter

- Hash passwords with a slow algorithm (PBKDF2, bcrypt, scrypt, Argon2) and per-user salt
- Store session tokens **hashed** server-side
- Cookie flags: `HttpOnly`, `Secure`, `SameSite=Lax` at minimum
- Invalidate every session on password change

Everything else is polish.',
   '["Hash passwords safely","Store sessions hashed","Set the right cookie flags"]',
   0, 40, 0, 'mark_complete', 'published'),

  -- Physics
  ('lsn_phy_1_1', 'mod_phy_1', 'Speed, velocity and acceleration', 'speed-velocity-and-acceleration',
   '## Definitions matter

Speed is how fast; velocity includes direction; acceleration is the *rate of change* of velocity.

```
v = u + at
s = ut + ½at²
```

Measure once with a ruler and a phone stopwatch and the formulas stop being abstract.',
   '["Distinguish speed from velocity","Use the equations of motion","Measure acceleration experimentally"]',
   0, 30, 1, 'mark_complete', 'published'),

  -- Typography
  ('lsn_vis_1_1', 'mod_vis_1', 'A type scale that behaves', 'a-type-scale-that-behaves',
   '## Pick a ratio

A 1.25 scale starting at 16px gives: 16, 20, 25, 31, 39. Big enough gaps to read as hierarchy, small enough to stay coherent.

Set line height to 1.5 for body text and 1.2 for headings. Long lines (over ~75 characters) are hard to track — cap the measure.',
   '["Build a modular scale","Set line height by role","Cap line length for readability"]',
   0, 25, 1, 'mark_complete', 'published'),

  -- Business
  ('lsn_biz_1_1', 'mod_biz_1', 'Talking to customers first', 'talking-to-customers-first',
   '## Ask about the past, not the future

"Would you buy this?" produces polite lies. "How did you handle this last month, and what did it cost you?" produces facts.

Ten honest conversations beat a hundred survey responses.',
   '["Write non-leading interview questions","Record what customers already do","Decide whether a problem is real"]',
   0, 30, 1, 'mark_complete', 'published'),

  -- Bookkeeping
  ('lsn_acc_1_1', 'mod_acc_1', 'The accounting equation', 'the-accounting-equation',
   '## Everything balances

```
Assets = Liabilities + Equity
```

Buy ₦200,000 of stock with ₦50,000 cash and a ₦150,000 supplier credit: assets rise by ₦150,000 net, liabilities rise by ₦150,000. The equation holds.

Debits increase assets and expenses; credits increase liabilities, equity and income.',
   '["State the accounting equation","Classify accounts as debit or credit","Record a simple transaction"]',
   0, 35, 1, 'mark_complete', 'published'),

  -- Public health
  ('lsn_ph_1_1', 'mod_ph_1', 'How infections spread', 'how-infections-spread',
   '## Routes

- **Airborne** — droplets and aerosols
- **Contact** — hands, surfaces
- **Vector-borne** — mosquitoes, ticks
- **Food and water** — contaminated supply

Each route has a different intervention. Hand hygiene does nothing for malaria; nets do nothing for flu.',
   '["Name the main transmission routes","Match interventions to routes","Explain why one measure is not universal"]',
   0, 25, 1, 'mark_complete', 'published'),

  -- Biology (draft course)
  ('lsn_bio_1_1', 'mod_bio_1', 'What is a cell', 'what-is-a-cell',
   '## The smallest unit of life

Every living thing is made of cells. Prokaryotes have no nucleus; eukaryotes keep their DNA in one.',
   '["Define a cell","Compare prokaryotes and eukaryotes"]',
   0, 25, 0, 'mark_complete', 'draft');

-- ---------------------------------------------------------------------------
-- Videos (public YouTube references used for development only)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO videos (id, lesson_id, provider, provider_video_id, title, duration_seconds, position, is_primary) VALUES
  ('vid_hc_1_1', 'lsn_hc_1_1', 'youtube', 'qz0aGYrrlhU', 'HTML in 100 seconds', 120, 0, 1),
  ('vid_hc_2_1', 'lsn_hc_2_1', 'youtube', '1Rs2ND1ryYc', 'The CSS box model explained', 300, 0, 1),
  ('vid_hc_3_1', 'lsn_hc_3_1', 'youtube', 'rg7Fvvl3taU', 'Learn CSS Grid', 480, 0, 1),
  ('vid_js_1_1', 'lsn_js_1_1', 'youtube', 'W6NZfCO5SIk', 'JavaScript in 100 seconds', 130, 0, 1),
  ('vid_js_2_2', 'lsn_js_2_2', 'youtube', 'y17RuWkWdn8', 'Working with events', 360, 0, 1),
  ('vid_js_3_1', 'lsn_js_3_1', 'youtube', 'cuEtnrL9-H0', 'Using fetch and promises', 420, 0, 1),
  ('vid_sec_2_1', 'lsn_sec_2_1', 'youtube', 'qmzLDrP9iQ0', 'Password storage explained', 300, 0, 1),
  ('vid_phy_1_1', 'lsn_phy_1_1', 'youtube', 'ZM8ECpBuQYE', 'Acceleration and velocity', 420, 0, 1);

-- ---------------------------------------------------------------------------
-- Resources
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO resources (id, lesson_id, course_id, title, kind, url, is_public, position) VALUES
  ('res_hc_1_1', 'lsn_hc_1_1', NULL, 'HTML elements reference (MDN)', 'link', 'https://developer.mozilla.org/en-US/docs/Web/HTML/Element', 1, 0),
  ('res_hc_3_2', 'lsn_hc_3_2', NULL, 'Web Content Accessibility Guidelines (WCAG) 2.2', 'link', 'https://www.w3.org/TR/WCAG22/', 1, 0),
  ('res_js_1_1', 'lsn_js_1_1', NULL, 'JavaScript guide (MDN)', 'link', 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide', 1, 0),
  ('res_data_syllabus', NULL, 'crs_data_basics', 'Data Analysis Foundations — syllabus', 'link', 'https://developer.mozilla.org/en-US/docs/Learn', 1, 0),
  ('res_sec_checklist', NULL, 'crs_security_essentials', 'Application security review checklist', 'article', 'https://owasp.org/www-project-top-ten/', 1, 0),
  ('res_hc_template', NULL, 'crs_html_css', 'Starter HTML/CSS project template', 'download', 'https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web', 1, 0);
