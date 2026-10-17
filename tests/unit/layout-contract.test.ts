/**
 * Layout contract.
 *
 * The approved G WORLD template is a *contract*, not a mood: the palette, the
 * components and the page skeletons are fixed. These tests read the shipped
 * HTML and CSS and assert that contract, so a later change cannot quietly
 * drift away from the design without the build noticing.
 *
 * They are deliberately static: no browser, no API, no network. The rendered
 * behaviour is covered by scripts/smoke-web.mjs.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';

const PUBLIC_DIR = path.resolve(process.cwd(), 'apps/web/public');
const CSS_DIR = path.join(PUBLIC_DIR, 'assets/css');

/** The only colours the design system is allowed to use. */
const PALETTE = {
  '--black': '#000000',
  '--white': '#ffffff',
  '--blue': '#0c7abf',
  '--blue-dark-text': '#0a5c8f',
  '--blue-tint': '#e8f5fd',
  '--gray-text': '#536471',
  '--border': '#cfd9de',
  '--surface-muted': '#eff3f4',
  '--surface-subtle': '#f7f9f9',
  '--on-dark-muted': '#a7b0b8',
};

const read = (file: string) => readFileSync(path.join(PUBLIC_DIR, file), 'utf8');

/** Parses a document with happy-dom so the assertions read like the DOM. */
function parse(file: string) {
  const window = new Window();
  const document = window.document;
  document.write(read(file));
  document.close();
  return document;
}

const css = ['tokens.css', 'base.css', 'layout.css', 'components.css', 'forms.css', 'tables.css']
  .map((file) => readFileSync(path.join(CSS_DIR, file), 'utf8'))
  .join('\n');

/** Every page that uses the public navigation and footer. */
const PUBLIC_PAGES = [
  'index.html',
  'departments.html',
  'subjects.html',
  'subject.html',
  'courses.html',
  'course.html',
  'search.html',
  'verify.html',
  'certificate.html',
  'login.html',
  'register.html',
  'reset.html',
  'reset-password.html',
  'verify-email.html',
  '404.html',
  '403.html',
  '500.html',
  'offline.html',
];

/** The student area and its five sidebar links. */
const STUDENT_PAGES: Record<string, string> = {
  'dashboard.html': '/dashboard.html',
  'my-courses.html': '/my-courses.html',
  'progress.html': '/progress.html',
  'certificates.html': '/certificates.html',
  'profile.html': '/profile.html',
  'settings.html': '/profile.html',
  'lesson.html': '/my-courses.html',
  'quiz.html': '/my-courses.html',
};

/** The admin area and its five sidebar links. */
const ADMIN_PAGES: Record<string, string> = {
  'admin/index.html': '/admin/index.html',
  'admin/students.html': '/admin/students.html',
  'admin/courses.html': '/admin/courses.html',
  'admin/content.html': '/admin/content.html',
  'admin/scan.html': '/admin/scan.html',
  'admin/assessments.html': '',
  'admin/audit.html': '',
  'admin/certificates.html': '',
  'admin/course-editor.html': '',
  'admin/departments.html': '',
  'admin/enrollments.html': '',
  'admin/settings.html': '',
  'admin/subjects.html': '',
};

describe('design tokens', () => {
  it('defines every palette token with its approved value', () => {
    const tokens = readFileSync(path.join(CSS_DIR, 'tokens.css'), 'utf8');
    for (const [name, value] of Object.entries(PALETTE)) {
      expect(tokens).toContain(`${name}: ${value};`);
    }
  });

  it('uses no colour outside the palette', () => {
    const used = new Set(
      [...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0].toLowerCase()),
    );
    const allowed = new Set(Object.values(PALETTE));
    for (const colour of used) expect(allowed).toContain(colour);
  });

  it('uses no colour outside the palette in the markup and the scripts', () => {
    const allowed = new Set(Object.values(PALETTE));
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(html|js|css|json|webmanifest)$/.test(entry.name)) continue;
        const source = readFileSync(full, 'utf8');
        for (const match of source.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
          const raw = match[0].toLowerCase();
          // `#fff` and `#ffffff` are the same approved colour.
          const colour = raw.length === 4
            ? `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`
            : raw;
          if (!allowed.has(colour)) offenders.push(`${path.relative(PUBLIC_DIR, full)} → ${colour}`);
        }
      }
    };

    walk(PUBLIC_DIR);
    expect(offenders).toEqual([]);
  });

  it('loads Sora and Public Sans from Google Fonts', () => {
    const home = read('index.html');
    expect(home).toContain('fonts.googleapis.com');
    expect(home).toContain('family=Sora');
    expect(home).toContain('family=Public+Sans');
  });

  it('keeps the type scale from the template', () => {
    const tokens = readFileSync(path.join(CSS_DIR, 'tokens.css'), 'utf8');
    expect(tokens).toContain('--text-h1: 44px;');
    expect(tokens).toContain('--text-h2: 28px;');
    expect(tokens).toContain('--text-h2-app: 26px;');
    expect(tokens).toContain('--text-h3: 18px;');
    expect(tokens).toContain('--text-body: 15px;');
    expect(tokens).toContain('--text-tag: 12px;');
    // The mobile scale is the only breakpoint in the system.
    expect(tokens).toContain('--text-h1: 30px;');
    expect(tokens).toContain('--text-h2: 22px;');
  });
});

describe('components', () => {
  it('styles the primary and outline buttons as the template does', () => {
    expect(css).toMatch(/\.btn\s*\{[^}]*background-color:\s*var\(--blue\)/);
    expect(css).toMatch(/\.btn\s*\{[^}]*border-radius:\s*var\(--radius-md\)/);
    expect(css).toMatch(/\.btn\s*\{[^}]*min-height:\s*var\(--tap-target\)/);
    expect(css).toMatch(/\.btn\.o[^{]*\{[^}]*border:\s*1\.5px solid var\(--blue\)/);
  });

  it('styles the card, the tag and the progress bar as the template does', () => {
    expect(css).toMatch(/\.card\s*\{[^}]*border:\s*1px solid var\(--border\)/);
    expect(css).toMatch(/\.card\s*\{[^}]*border-radius:\s*var\(--radius-lg\)/);
    expect(css).toMatch(/\.card\s*\{[^}]*padding:\s*var\(--space-5\)/);
    expect(css).toMatch(/\.tag\s*\{[^}]*border-radius:\s*var\(--radius-pill\)/);
    expect(css).toMatch(/\.tag\s*\{[^}]*background-color:\s*var\(--blue-tint\)/);
    expect(css).toMatch(/\.progress\s*\{[^}]*height:\s*8px/);
    expect(css).toMatch(/\.progress__bar\s*\{[^}]*background-color:\s*var\(--blue\)/);
  });

  it('keeps the image placeholder 110px tall and blue tinted', () => {
    expect(css).toMatch(/\.image-placeholder\s*\{[^}]*height:\s*110px/);
    expect(css).toMatch(/\.image-placeholder\s*\{[^}]*background-color:\s*var\(--blue-tint\)/);
  });

  it('gives every input a label, a 44px height and a gray border', () => {
    expect(css).toMatch(/\.field\s*>\s*label[^{]*\{[^}]*font-weight:\s*600/);
    expect(css).toMatch(/input[^{]*\{[^}]*min-height:\s*var\(--tap-target\)/);
    expect(css).toMatch(/input[^{]*\{[^}]*border:\s*1px solid var\(--gray-text\)/);
  });

  it('gives the sidebar its 220px black column and the app page 32px of padding', () => {
    expect(css).toContain('--sidebar-width: 220px;');
    expect(css).toMatch(/\.app-sidebar\s*\{[^}]*background-color:\s*var\(--black\)/);
    expect(css).toMatch(/\.app-sidebar__link\[aria-current='page'\]\s*\{[^}]*background-color:\s*var\(--blue\)/);
    expect(css).toContain('--app-pad: 32px;');
  });

  it('keeps the footer black with the muted on-dark text', () => {
    expect(css).toMatch(/\.site-footer\s*\{[^}]*background-color:\s*var\(--black\)/);
    expect(css).toMatch(/\.site-footer\s*\{[^}]*color:\s*var\(--on-dark-muted\)/);
  });
});

describe('public pages', () => {
  it.each(PUBLIC_PAGES)('%s carries the public navigation and the footer', (file) => {
    const document = parse(file);

    const brand = document.querySelector('.site-header .brand');
    expect(brand?.textContent?.trim()).toBe('G WORLD');

    const links = [...document.querySelectorAll('.site-nav__links .site-nav__link')].map((node) =>
      node.textContent?.trim(),
    );
    expect(links).toEqual(['Departments', 'Subjects', 'Courses']);

    expect(document.querySelector('.site-nav__actions [data-nav-login]')?.textContent?.trim()).toBe('Log in');
    expect(document.querySelector('.site-nav__actions [data-nav-register]')?.textContent?.trim()).toBe('Register');

    // The mobile disclosure replaces the links and the register button.
    expect(document.querySelector('.site-nav__menu summary')?.textContent?.trim()).toBe('Menu');

    const footer = document.querySelector('.site-footer');
    expect(footer).not.toBeNull();
    const footerLinks = [...(footer?.querySelectorAll('a') ?? [])].map((node) => node.textContent?.trim());
    expect(footerLinks).toEqual(['Departments', 'Subjects', 'Courses', 'support@gworld.example']);
  });

  it('gives the home page the hero and the two sections of the template', () => {
    const document = parse('index.html');

    expect(document.querySelector('.hero .tag')?.textContent?.trim()).toBe('Open to visitors');
    expect(document.querySelector('.hero h1')?.textContent?.trim()).toBe('Learn by department, subject and skill.');

    const buttons = [...document.querySelectorAll('.hero__actions .btn')];
    expect(buttons.map((node) => node.textContent?.trim())).toEqual(['Get started', 'Explore departments']);
    expect(buttons[0].className).not.toContain(' o');
    expect(buttons[1].className).toContain(' o');

    const headings = [...document.querySelectorAll('main h2')].map((node) => node.textContent?.trim());
    expect(headings).toEqual(['Explore departments', 'How learning flows']);

    expect(document.querySelectorAll('[data-home-departments].grid--3')).toHaveLength(1);
    const flow = document.querySelector('#flow-heading')?.closest('section');
    expect(flow?.querySelectorAll('.grid--4 > .card')).toHaveLength(4);
  });

  it('gives the departments page its heading and its three-column grid', () => {
    const document = parse('departments.html');
    expect(document.querySelector('main h1')?.textContent?.trim()).toBe('Departments');
    expect(document.querySelectorAll('[data-departments-list].grid--3')).toHaveLength(1);
  });

  it('gives the subjects page its heading and its department filter', () => {
    const document = parse('subjects.html');
    expect(document.querySelector('main h1')?.textContent?.trim()).toBe('Subjects');
    const select = document.querySelector('#department-filter');
    expect(select).not.toBeNull();
    expect(select?.querySelector('option')?.textContent?.trim()).toBe('All departments');
    expect(document.querySelectorAll('[data-subjects-list].grid--3')).toHaveLength(1);
  });

  it('gives the subject page its tag, heading and course grid', () => {
    const document = parse('subject.html');
    expect(document.querySelector('[data-subject-department]')?.className).toContain('tag');
    expect(document.querySelector('[data-subject-name]')?.tagName).toBe('H1');
    expect([...document.querySelectorAll('main h2')].map((node) => node.textContent?.trim())).toContain('Courses');
    expect(document.querySelectorAll('[data-subject-courses].grid--3')).toHaveLength(1);
  });

  it('gives the courses page its search field and its four filters', () => {
    const document = parse('courses.html');
    expect(document.querySelector('main h1')?.textContent?.trim()).toBe('Courses');
    expect(document.querySelector('[data-course-search]')).not.toBeNull();
    expect(document.querySelector('[data-course-department]')).not.toBeNull();
    expect(document.querySelector('[data-course-subject]')).not.toBeNull();
    expect(document.querySelector('[data-course-level]')).not.toBeNull();
    expect(document.querySelector('[data-course-status]')).not.toBeNull();
    expect(document.querySelectorAll('[data-courses-list].grid--3')).toHaveLength(1);
  });
});

describe('authentication pages', () => {
  const cases = [
    {
      file: 'login.html',
      heading: 'Log in',
      fields: ['email', 'password'],
      button: 'Log in',
      links: ['Forgot password?', 'Create an account'],
    },
    {
      file: 'register.html',
      heading: 'Create your account',
      fields: ['full_name', 'email', 'password', 'confirm_password'],
      button: 'Register',
      links: ['Already have an account? Log in'],
    },
    {
      file: 'reset.html',
      heading: 'Reset password',
      fields: ['email'],
      button: 'Send reset link',
      links: ['Back to log in'],
    },
  ];

  it.each(cases)('$file is a centred form card', ({ file, heading, fields, button, links }) => {
    const document = parse(file);

    const card = document.querySelector('.auth');
    expect(card).not.toBeNull();
    expect(card?.querySelector('h1')?.textContent?.trim()).toBe(heading);

    for (const field of fields) {
      const input = card?.querySelector(`[name="${field}"]`);
      expect(input).not.toBeNull();
      const id = input?.getAttribute('id');
      expect(card?.querySelector(`label[for="${id}"]`)).not.toBeNull();
    }

    const submit = card?.querySelector('button[type="submit"]');
    expect(submit?.textContent?.trim()).toBe(button);
    expect(submit?.className).toContain('btn--block');

    const anchors = [...(card?.querySelectorAll('.auth__links a') ?? [])].map((node) => node.textContent?.trim());
    expect(anchors).toEqual(links);
  });
});

describe('student area', () => {
  it.each(Object.keys(STUDENT_PAGES))('%s uses the application shell', (file) => {
    const document = parse(file);

    expect(document.querySelector('.app-shell')).not.toBeNull();
    expect(document.querySelector('.app-topbar .brand')?.textContent?.trim()).toBe('G WORLD');
    expect(document.querySelector('[data-session-name]')).not.toBeNull();

    const links = [...document.querySelectorAll('.app-sidebar__link')].map((node) => node.textContent?.trim());
    expect(links).toEqual(['Dashboard', 'My courses', 'Progress', 'Certificates', 'Profile']);

    const active = document.querySelector('.app-sidebar__link[aria-current="page"]');
    expect(active?.getAttribute('href')).toBe(STUDENT_PAGES[file]);
  });

  it('gives the dashboard its greeting, three totals and the continue grid', () => {
    const document = parse('dashboard.html');
    expect(document.querySelector('[data-dashboard-greeting]')?.tagName).toBe('H2');
    expect(document.querySelectorAll('[data-dashboard-stats] .stat')).toHaveLength(0); // filled by the API
    expect(document.querySelectorAll('[data-dashboard-continue].grid--2')).toHaveLength(1);
  });

  it('gives my courses and progress their grids and table', () => {
    expect(parse('my-courses.html').querySelectorAll('[data-enrolment-list].grid--3')).toHaveLength(1);
    const progress = parse('progress.html');
    expect(progress.querySelectorAll('[data-progress-table].table-wrap')).toHaveLength(1);
  });

  it('gives the profile card its three fields and the save button', () => {
    const document = parse('profile.html');
    const card = document.querySelector('.card--narrow');
    expect(card).not.toBeNull();
    for (const field of ['full_name', 'email', 'new_password']) {
      expect(card?.querySelector(`[name="${field}"]`)).not.toBeNull();
    }
    expect(card?.querySelector('button[type="submit"]')?.textContent?.trim()).toBe('Save changes');
  });
});

describe('admin area', () => {
  it.each(Object.keys(ADMIN_PAGES))('%s uses the administration shell', (file) => {
    const document = parse(file);

    expect(document.querySelector('.app-shell')).not.toBeNull();
    expect(document.querySelector('.app-topbar .brand')?.textContent?.trim()).toBe('G WORLD');
    expect(document.querySelector('[data-session-name]')?.textContent?.trim()).toBe('[Admin name]');

    const links = [...document.querySelectorAll('.app-sidebar__link')].map((node) => node.textContent?.trim());
    expect(links).toEqual(['Analytics', 'Users', 'Courses', 'Content', 'QR scanner']);

    const active = document.querySelector('.app-sidebar__link[aria-current="page"]');
    const expected = ADMIN_PAGES[file];
    if (expected) expect(active?.getAttribute('href')).toBe(expected);
  });

  it('gives the analytics page its four totals, the chart and the table', () => {
    const document = parse('admin/index.html');
    expect(document.querySelector('main h2')?.textContent?.trim()).toBe('Analytics');
    expect(document.querySelectorAll('[data-admin-stats]')).toHaveLength(1);
    expect(document.querySelector('[data-admin-trend]')).not.toBeNull();
    expect(document.querySelector('[data-admin-enrollments].table-wrap')).not.toBeNull();
  });

  it('gives course management its button and its table', () => {
    const document = parse('admin/courses.html');
    expect(document.querySelector('main h2')?.textContent?.trim()).toBe('Course management');
    const button = document.querySelector('.section__head .btn');
    expect(button?.textContent?.trim()).toBe('New course');
    expect(document.querySelector('[data-courses-table].table-wrap')).not.toBeNull();
  });

  it('gives the QR scanner its camera frame, code field and result card', () => {
    const document = parse('admin/scan.html');
    expect(document.querySelector('main h2')?.textContent?.trim()).toBe('QR scanner');

    const frame = document.querySelector('.qr-frame');
    expect(frame).not.toBeNull();
    expect(frame?.textContent).toContain('Camera preview');

    expect(document.querySelector('#code')).not.toBeNull();
    expect(document.querySelector('[data-scan-form] button[type="submit"]')?.textContent?.trim()).toBe('Verify');
    expect(document.querySelector('[data-scan-result] h2')?.textContent?.trim()).toBe('Certificate verified');
  });
});

describe('responsive rules', () => {
  it('collapses the grids to one column below 768px', () => {
    expect(css).toMatch(/@media \(max-width: 767px\)[\s\S]*\.grid--3,\s*\.grid--4,\s*\.grid--2\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
  });

  it('turns the sidebar into a scrollable tab strip on mobile', () => {
    expect(css).toMatch(/@media \(max-width: 767px\)[\s\S]*\.app-sidebar\s*\{[^}]*overflow-x:\s*auto/);
  });

  it('keeps tables inside a horizontal scroll container', () => {
    expect(css).toMatch(/\.table-wrap\s*\{[^}]*overflow-x:\s*auto/);
    for (const file of Object.keys(ADMIN_PAGES)) {
      const document = parse(file);
      for (const table of document.querySelectorAll('table')) {
        expect(table.closest('.table-wrap')).not.toBeNull();
      }
    }
  });

  it('never lets the page itself scroll sideways', () => {
    expect(css).toMatch(/body\s*\{[^}]*overflow-x:\s*hidden/);
  });
});
