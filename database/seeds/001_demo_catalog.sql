-- ===========================================================================
-- G WORLD — Seed 001: demo catalog (departments, subjects, courses, skills)
-- ---------------------------------------------------------------------------
-- DEVELOPMENT ONLY. Never apply this to a production database: these are demo
-- records, and the accounts in seed 004 use well-known passwords.
--
-- Idempotent: every statement uses INSERT OR IGNORE with fixed ids, so the seed
-- can be re-applied after adding a new row elsewhere.
--
-- Applied by: npm run db:seed:local
-- ===========================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Departments
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO departments (id, name, slug, tagline, description, icon, display_order, status) VALUES
  ('dep_technology', 'Technology', 'technology',
   'Build the tools the world runs on',
   'Technology covers software engineering, data, cloud infrastructure and cybersecurity. Learn to design systems, write maintainable code and keep them secure.',
   'cpu', 1, 'published'),

  ('dep_science', 'Science', 'science',
   'Understand how the world works',
   'From physics to life sciences, these courses build the analytical foundation that technical careers are built on.',
   'flask', 2, 'published'),

  ('dep_arts', 'Arts & Design', 'arts-and-design',
   'Turn ideas into things people feel',
   'Design, visual communication and creative practice — the craft behind products people actually enjoy using.',
   'palette', 3, 'published'),

  ('dep_business', 'Business & Finance', 'business-and-finance',
   'Learn how organisations make decisions',
   'Entrepreneurship, accounting and operations: the practical skills behind running something of your own or joining a team.',
   'briefcase', 4, 'published'),

  ('dep_health', 'Health Sciences', 'health-sciences',
   'Care for people and communities',
   'Public health, nutrition and community care — knowledge that directly improves lives.',
   'heart-pulse', 5, 'published');

-- ---------------------------------------------------------------------------
-- Subjects
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO subjects (id, department_id, name, slug, description, display_order, status) VALUES
  ('sub_web',       'dep_technology', 'Web Development',      'web-development',      'HTML, CSS, JavaScript and the web platform.', 1, 'published'),
  ('sub_data',      'dep_technology', 'Data & AI',            'data-and-ai',          'Data analysis, machine learning and responsible AI.', 2, 'published'),
  ('sub_security',  'dep_technology', 'Cybersecurity',        'cybersecurity',        'Securing systems, networks and applications.', 3, 'published'),
  ('sub_physics',   'dep_science',    'Physics',              'physics',              'Mechanics, energy and the laws that govern motion.', 1, 'published'),
  ('sub_biology',   'dep_science',    'Biology',              'biology',              'Cells, genetics and living systems.', 2, 'published'),
  ('sub_visual',    'dep_arts',       'Visual Design',        'visual-design',        'Typography, colour and layout for screens and print.', 1, 'published'),
  ('sub_entre',     'dep_business',   'Entrepreneurship',     'entrepreneurship',     'Finding a problem worth solving and building around it.', 1, 'published'),
  ('sub_accounting','dep_business',   'Accounting',           'accounting',           'Recording, reading and trusting financial information.', 2, 'published'),
  ('sub_publichealth','dep_health',   'Public Health',        'public-health',        'Population health, epidemiology and prevention.', 1, 'published');

-- ---------------------------------------------------------------------------
-- Courses
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO courses (
  id, subject_id, title, slug, summary, description, learning_outcomes_json, prerequisites_json,
  difficulty, estimated_minutes, instructor_name, instructor_bio, status, is_featured, published_at
) VALUES
  ('crs_html_css', 'sub_web', 'HTML & CSS Foundations', 'html-and-css-foundations',
   'Build accessible, responsive pages with modern HTML and CSS.',
   'This course takes you from a blank file to a finished, responsive, accessible web page. You will write semantic HTML, style it with modern CSS (Grid and Flexbox), and learn how to test your work with a keyboard and a screen reader.

Every lesson includes a short video walkthrough, a written explanation and a downloadable reference sheet.',
   '["Write semantic HTML5 markup","Build responsive layouts with CSS Grid and Flexbox","Apply WCAG 2.2 contrast and focus requirements","Debug layout problems with browser devtools"]',
   '["A computer with a modern browser","No prior programming experience required"]',
   'beginner', 300, 'Adaeze Okonkwo', 'Frontend engineer and accessibility advocate with ten years of experience building public-sector websites.',
   'published', 1, '2026-03-04T09:00:00.000Z'),

  ('crs_js_fundamentals', 'sub_web', 'JavaScript Fundamentals', 'javascript-fundamentals',
   'Learn the language of the web: variables, functions, the DOM and fetch.',
   'A practical introduction to JavaScript for people who already know HTML and CSS. You will write real scripts, manipulate the DOM, handle events and call an API with fetch — finishing with a small app of your own.',
   '["Use variables, functions and control flow confidently","Manipulate the DOM and handle events","Fetch and render data from an API","Debug with the browser console"]',
   '["Comfortable writing HTML and CSS"]',
   'beginner', 420, 'Tunde Balogun', 'Full-stack developer and technical trainer.',
   'published', 1, '2026-03-18T09:00:00.000Z'),

  ('crs_data_basics', 'sub_data', 'Data Analysis Foundations', 'data-analysis-foundations',
   'Turn raw data into answers people can act on.',
   'Learn how to clean, summarise and visualise datasets, then communicate what you found. The course emphasises judgement: knowing when a chart misleads and when a correlation is not a cause.',
   '["Clean and reshape a messy dataset","Choose the right summary statistics","Build honest charts","Write a one-page findings brief"]',
   '["Basic spreadsheet experience"]',
   'intermediate', 480, 'Dr. Ngozi Eze', 'Data scientist and lecturer in applied statistics.',
   'published', 1, '2026-04-02T09:00:00.000Z'),

  ('crs_security_essentials', 'sub_security', 'Security Essentials', 'security-essentials',
   'Practical security habits for developers and small teams.',
   'Understand the vulnerabilities that cause most breaches — injection, broken access control, weak authentication — and the concrete controls that prevent them. Includes a hands-on review checklist.',
   '["Explain the OWASP Top 10 in plain language","Design password and session handling safely","Review a codebase for access-control bugs","Write a basic incident response checklist"]',
   '["Some familiarity with building web applications"]',
   'intermediate', 540, 'Ibrahim Suleiman', 'Application security engineer.',
   'published', 0, '2026-04-20T09:00:00.000Z'),

  ('crs_physics_motion', 'sub_physics', 'Motion, Forces & Energy', 'motion-forces-and-energy',
   'Mechanics explained with demonstrations you can repeat at home.',
   'Newton''s laws, energy conservation and momentum, taught with experiments that need nothing more than a phone camera and a ruler.',
   '["Apply Newton''s three laws to everyday situations","Use conservation of energy to solve motion problems","Interpret distance-time and velocity-time graphs"]',
   '["Secondary-school mathematics"]',
   'beginner', 360, 'Grace Mwangi', 'Physics teacher and curriculum designer.',
   'published', 0, '2026-05-06T09:00:00.000Z'),

  ('crs_visual_typography', 'sub_visual', 'Typography for Screens', 'typography-for-screens',
   'Choose, size and space type so interfaces are readable.',
   'Type is 90% of interface design. This course covers type scales, line height, contrast, and the difference between beautiful-on-paper and readable-on-glass.',
   '["Build a modular type scale","Set readable line lengths and rhythm","Pair typefaces without clutter","Check contrast for accessibility"]',
   '["None — beginners welcome"]',
   'beginner', 240, 'Chiamaka Obi', 'Product designer.',
   'published', 0, '2026-05-21T09:00:00.000Z'),

  ('crs_start_business', 'sub_entre', 'Starting a Small Business', 'starting-a-small-business',
   'From idea to first paying customer, step by step.',
   'A grounded introduction to validating an idea, understanding your unit economics, registering a business and finding your first customers — written for people starting with very little capital.',
   '["Validate demand before spending money","Calculate unit economics","Register and structure a small business","Find and keep your first ten customers"]',
   '["None"]',
   'beginner', 300, 'Femi Adeyemi', 'Founder and small-business advisor.',
   'published', 0, '2026-06-02T09:00:00.000Z'),

  ('crs_bookkeeping', 'sub_accounting', 'Bookkeeping Basics', 'bookkeeping-basics',
   'Keep clean books: double entry, ledgers and month-end checks.',
   'Learn double-entry bookkeeping from first principles, then practise with a full month of transactions for a small shop.',
   '["Record transactions using double entry","Prepare a trial balance","Reconcile a bank account","Produce a simple profit and loss statement"]',
   '["Comfortable with basic arithmetic"]',
   'beginner', 360, 'Sarah Nkemdirim', 'Chartered accountant.',
   'published', 0, '2026-06-17T09:00:00.000Z'),

  ('crs_public_health', 'sub_publichealth', 'Community Health Basics', 'community-health-basics',
   'Prevention, hygiene and health communication that works.',
   'How disease spreads, why hand hygiene matters more than most people think, and how to communicate health information without causing panic.',
   '["Explain modes of disease transmission","Design a simple prevention campaign","Communicate risk clearly and calmly"]',
   '["None"]',
   'beginner', 240, 'Dr. Amara Nwosu', 'Public health physician.',
   'published', 0, '2026-07-01T09:00:00.000Z'),

  ('crs_biology_cells', 'sub_biology', 'Cells & Genetics', 'cells-and-genetics',
   'The machinery of life, from organelles to inheritance.',
   'Start with what a cell is and how it works, then move to DNA, protein synthesis and how traits are inherited.',
   '["Describe the structure and function of a cell","Explain DNA replication and protein synthesis","Predict the outcome of simple genetic crosses"]',
   '["Secondary-school biology is helpful but not required"]',
   'beginner', 420, 'Dr. Peter Ochieng', 'Biologist and science communicator.',
   'draft', 0, NULL);

-- ---------------------------------------------------------------------------
-- Skills
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO skills (id, name, slug, category, description) VALUES
  ('skl_html',        'HTML',              'html',              'Web',        'Semantic markup and document structure.'),
  ('skl_css',         'CSS',               'css',               'Web',        'Layout, responsive design and visual styling.'),
  ('skl_accessibility','Accessibility',    'accessibility',     'Design',     'Designing for keyboard, screen reader and low-vision users.'),
  ('skl_javascript',  'JavaScript',        'javascript',        'Web',        'The language of the browser, and increasingly of the server.'),
  ('skl_dom',         'DOM manipulation',  'dom-manipulation',  'Web',        'Reading and updating the document from script.'),
  ('skl_fetch_api',   'HTTP & fetch API',  'http-and-fetch-api','Web',        'Calling APIs and handling responses and errors.'),
  ('skl_data_cleaning','Data cleaning',    'data-cleaning',     'Data',       'Turning messy data into something analysable.'),
  ('skl_statistics',  'Statistics',        'statistics',        'Data',       'Describing data and reasoning about uncertainty.'),
  ('skl_data_viz',    'Data visualisation','data-visualisation','Data',       'Communicating findings with honest charts.'),
  ('skl_threat_model','Threat modelling',  'threat-modelling',  'Security',   'Systematically finding what could go wrong.'),
  ('skl_auth',        'Authentication',    'authentication',    'Security',   'Sessions, passwords and access control done safely.'),
  ('skl_mechanics',   'Mechanics',         'mechanics',         'Science',    'Forces, motion and energy.'),
  ('skl_typography',  'Typography',        'typography',        'Design',     'Choosing and setting type for readability.'),
  ('skl_unit_econ',   'Unit economics',    'unit-economics',    'Business',   'Understanding cost and margin per unit sold.'),
  ('skl_double_entry','Double-entry bookkeeping','double-entry-bookkeeping','Business','Recording transactions so the books balance.'),
  ('skl_epi',         'Epidemiology',      'epidemiology',      'Health',     'How disease spreads through populations.');

-- ---------------------------------------------------------------------------
-- Course ↔ skill links
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO course_skills (course_id, skill_id, kind, weight) VALUES
  ('crs_html_css', 'skl_html', 'acquired', 5),
  ('crs_html_css', 'skl_css', 'acquired', 5),
  ('crs_html_css', 'skl_accessibility', 'acquired', 3),
  ('crs_html_css', 'skl_typography', 'acquired', 2),
  ('crs_js_fundamentals', 'skl_javascript', 'acquired', 5),
  ('crs_js_fundamentals', 'skl_dom', 'acquired', 4),
  ('crs_js_fundamentals', 'skl_fetch_api', 'acquired', 3),
  ('crs_js_fundamentals', 'skl_html', 'required', 3),
  ('crs_js_fundamentals', 'skl_css', 'required', 2),
  ('crs_data_basics', 'skl_data_cleaning', 'acquired', 5),
  ('crs_data_basics', 'skl_statistics', 'acquired', 4),
  ('crs_data_basics', 'skl_data_viz', 'acquired', 4),
  ('crs_security_essentials', 'skl_threat_model', 'acquired', 4),
  ('crs_security_essentials', 'skl_auth', 'acquired', 5),
  ('crs_physics_motion', 'skl_mechanics', 'acquired', 5),
  ('crs_visual_typography', 'skl_typography', 'acquired', 5),
  ('crs_visual_typography', 'skl_accessibility', 'acquired', 3),
  ('crs_start_business', 'skl_unit_econ', 'acquired', 4),
  ('crs_bookkeeping', 'skl_double_entry', 'acquired', 5),
  ('crs_public_health', 'skl_epi', 'acquired', 4);
