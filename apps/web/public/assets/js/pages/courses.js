/**
 * Page — course catalogue.
 *
 * One endpoint (`GET /courses`) does the searching, filtering, sorting and
 * paging. The form only decides what to send; the URL is kept in sync so a
 * filtered view can be shared, bookmarked or reloaded.
 */
import { api } from '../core/api.js';
import { el, qs } from '../core/dom.js';
import { config } from '../core/config.js';
import { courseCard } from '../components/course-card.js';
import { emptyState } from '../components/empty-state.js';
import { renderPagination } from '../components/pagination.js';
import { skeletonGrid } from '../components/skeletons.js';
import { pageError, setBusy } from './_shared.js';

const SORTS = new Set(['newest', 'oldest', 'title', 'duration', 'difficulty']);
const DIFFICULTIES = new Set(['beginner', 'intermediate', 'advanced']);

export async function init({ signal }) {
  const form = qs('[data-course-filters]');
  const listHost = qs('[data-course-list]');
  const countLabel = qs('[data-result-count]');
  const paginationHost = qs('[data-pagination]');

  const url = new URL(window.location.href);
  const state = {
    q: url.searchParams.get('q') ?? '',
    department: url.searchParams.get('department') ?? '',
    subject: url.searchParams.get('subject') ?? '',
    difficulty: DIFFICULTIES.has(url.searchParams.get('difficulty')) ? url.searchParams.get('difficulty') : '',
    sort: SORTS.has(url.searchParams.get('sort')) ? url.searchParams.get('sort') : 'newest',
    page: Number(url.searchParams.get('page') ?? 1) || 1,
  };

  // Reflect the current state into the form before the first fetch.
  for (const [key, value] of Object.entries(state)) {
    const field = form.elements[key];
    if (field) field.value = key === 'page' ? String(value) : value;
  }

  // Departments and subjects populate the two selects; failures are not fatal.
  const [departments, subjects] = await Promise.all([
    api.get('/departments', { signal }).catch(() => []),
    api.get('/subjects', { query: { per_page: 100 }, signal }).catch(() => []),
  ]);

  const departmentSelect = qs('[data-filter-department]');
  const subjectSelect = qs('[data-filter-subject]');
  departmentSelect.append(
    ...departments.map((department) => el('option', { text: department.name, attrs: { value: department.slug } })),
  );
  const renderSubjectOptions = () => {
    const wanted = departmentSelect.value;
    const visible = wanted ? subjects.filter((subject) => subject.department_slug === wanted) : subjects;
    subjectSelect.replaceChildren(
      el('option', { text: 'All', attrs: { value: '' } }),
      ...visible.map((subject) => el('option', { text: subject.name, attrs: { value: subject.slug } })),
    );
    subjectSelect.value = state.subject;
  };
  renderSubjectOptions();
  departmentSelect.value = state.department;

  async function load() {
    setBusy(listHost, true);
    listHost.replaceChildren(...skeletonGrid(config.pageSize).childNodes);

    const params = {
      page: state.page,
      per_page: config.pageSize,
      sort: state.sort,
    };
    if (state.q) params.q = state.q;
    if (state.department) params.department = state.department;
    if (state.subject) params.subject = state.subject;
    if (state.difficulty) params.difficulty = state.difficulty;

    const data = await api.get('/courses', { query: params, signal });

    countLabel.textContent = `${data.pagination.total} ${data.pagination.total === 1 ? 'course' : 'courses'}${
      state.q ? ` matching “${state.q}”` : ''
    }`;

    listHost.replaceChildren(
      ...(data.items.length
        ? data.items.map((course) => courseCard(course, { showDepartment: true }))
        : [
            emptyState({
              title: 'No courses match those filters',
              message: 'Try clearing the search box or choosing a different department.',
              action: { label: 'Clear filters', href: '/courses.html' },
            }),
          ]),
    );
    setBusy(listHost, false);

    renderPagination(paginationHost, {
      page: data.pagination.page,
      perPage: data.pagination.per_page,
      total: data.pagination.total,
      itemNoun: 'course',
      onPage: (page) => {
        state.page = page;
        syncUrl();
        load().catch((error) => pageError(error, () => load()));
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
    });
  }

  function syncUrl() {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(state)) {
      if (value && !(key === 'page' && value === 1) && !(key === 'sort' && value === 'newest')) {
        params.set(key, String(value));
      }
    }
    const query = params.toString();
    window.history.replaceState(null, '', query ? `${window.location.pathname}?${query}` : window.location.pathname);
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    state.q = String(values.q ?? '').trim();
    state.department = String(values.department ?? '');
    state.subject = String(values.subject ?? '');
    state.difficulty = DIFFICULTIES.has(values.difficulty) ? values.difficulty : '';
    state.sort = SORTS.has(values.sort) ? values.sort : 'newest';
    state.page = 1;
    syncUrl();
    load().catch((error) => pageError(error, () => load()));
  });

  departmentSelect.addEventListener('change', () => {
    state.subject = '';
    renderSubjectOptions();
  });

  form.addEventListener('reset', () => {
    // Let the browser clear the inputs first, then reset the model and reload.
    setTimeout(() => {
      state.q = '';
      state.department = '';
      state.subject = '';
      state.difficulty = '';
      state.sort = 'newest';
      state.page = 1;
      renderSubjectOptions();
      syncUrl();
      load().catch((error) => pageError(error, () => load()));
    }, 0);
  });

  try {
    await load();
  } catch (error) {
    pageError(error, () => load());
  }
}
