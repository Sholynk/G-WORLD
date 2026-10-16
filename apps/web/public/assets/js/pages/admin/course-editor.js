/**
 * Admin page — curriculum editor.
 *
 * Modules and lessons for one course, in order. Reordering sends the whole new
 * order in a single request (`PUT /modules/reorder`, `PUT /lessons/reorder`) so
 * two positions can never disagree, and the list is re-read from the API
 * afterwards rather than patched in the browser.
 */
import { api } from '../../core/api.js';
import { el, qs, queryParam } from '../../core/dom.js';
import { formatNumber, humanize } from '../../core/format.js';
import { confirmAction } from '../../components/modal.js';
import { statusBadge } from '../../components/progress.js';
import { toastError, toastSuccess } from '../../components/toast.js';
import { wireForm } from '../../components/form.js';
import { fill, pageError } from '../_shared.js';
import { requireStaff } from './_shared.js';

export async function init({ signal, session }) {
  const current = await requireStaff(session);
  if (!current) return;

  const courseSelect = qs('[data-editor-course]');
  const modulesHost = qs('[data-editor-modules]');
  const lessonSection = qs('[data-lesson-editor]');
  const lessonForm = qs('[data-lesson-form]');

  let modules = [];

  async function loadCourses() {
    const data = await api.get('/admin/courses', { query: { per_page: 100 }, signal });
    courseSelect.replaceChildren(
      ...data.items.map((course) =>
        el('option', {
          text: `${course.title} (${course.status})`,
          attrs: { value: course.id },
        }),
      ),
    );
    const wanted = queryParam('course');
    if (wanted && data.items.some((course) => course.id === wanted)) courseSelect.value = wanted;
    return data.items;
  }

  async function loadCurriculum() {
    modulesHost.setAttribute('aria-busy', 'true');
    const courseId = courseSelect.value;
    if (!courseId) {
      modulesHost.replaceChildren(el('p', { class: 'muted', text: 'No courses to edit yet.' }));
      return;
    }
    const detail = await api.get(`/admin/courses/${encodeURIComponent(courseId)}/curriculum`, { signal });
    modules = detail.modules ?? detail.curriculum ?? detail;

    fill('[data-editor-course-title]', detail.course?.title ?? '');
    renderModules();
    modulesHost.setAttribute('aria-busy', 'false');
  }

  function move(array, index, delta) {
    const target = index + delta;
    if (target < 0 || target >= array.length) return null;
    const copy = [...array];
    [copy[index], copy[target]] = [copy[target], copy[index]];
    return copy.map((row, position) => ({ id: row.id, position }));
  }

  function renderModules() {
    if (!modules.length) {
      modulesHost.replaceChildren(
        el('p', { class: 'alert alert--info', text: 'This course has no modules yet. Add the first one above.' }),
      );
      return;
    }

    modulesHost.replaceChildren(
      ...modules.map((module, moduleIndex) =>
        el('section', {
          class: 'card',
          children: [
            el('div', {
              class: 'card__section cluster cluster--between',
              children: [
                el('div', {
                  class: 'stack-sm',
                  children: [
                    el('h3', { class: 'card__title mb-0', text: module.title }),
                    el('p', {
                      class: 'subtle mb-0',
                      text: `Position ${moduleIndex + 1} · ${formatNumber(module.lesson_count ?? (module.lessons ?? []).length)} lessons · ${humanize(module.status)}`,
                    }),
                  ],
                }),
                el('div', {
                  class: 'cluster cluster--tight',
                  children: [
                    el('button', {
                      class: 'btn btn--sm',
                      text: '↑',
                      attrs: { type: 'button', 'aria-label': `Move ${module.title} up`, disabled: moduleIndex === 0 ? '' : null },
                      on: {
                        click: async () => {
                          const order = move(modules, moduleIndex, -1);
                          if (!order) return;
                          await api.put('/admin/modules/reorder', { order });
                          toastSuccess('Module order saved.');
                          await loadCurriculum();
                        },
                      },
                    }),
                    el('button', {
                      class: 'btn btn--sm',
                      text: '↓',
                      attrs: { type: 'button', 'aria-label': `Move ${module.title} down`, disabled: moduleIndex === modules.length - 1 ? '' : null },
                      on: {
                        click: async () => {
                          const order = move(modules, moduleIndex, 1);
                          if (!order) return;
                          await api.put('/admin/modules/reorder', { order });
                          toastSuccess('Module order saved.');
                          await loadCurriculum();
                        },
                      },
                    }),
                    el('button', {
                      class: 'btn btn--sm btn--primary',
                      text: 'Add lesson',
                      attrs: { type: 'button' },
                      on: { click: () => openLessonForm({ module_id: module.id, position: (module.lessons ?? []).length }) },
                    }),
                    el('button', {
                      class: 'btn btn--sm btn--danger',
                      text: 'Delete',
                      attrs: { type: 'button' },
                      on: {
                        click: async () => {
                          const confirmed = await confirmAction({
                            title: `Delete “${module.title}”?`,
                            body: 'Lessons inside it are removed too. The API refuses if the module still has content it must keep.',
                            confirmLabel: 'Delete module',
                            tone: 'danger',
                            onConfirm: async () => {
                              await api.delete(`/admin/modules/${encodeURIComponent(module.id)}`);
                            },
                          });
                          if (!confirmed) return;
                          toastSuccess('Module deleted.');
                          await loadCurriculum();
                        },
                      },
                    }),
                  ],
                }),
              ],
            }),
            (module.lessons ?? []).length
              ? el('ul', {
                  class: 'list-plain',
                  children: (module.lessons ?? []).map((lesson, lessonIndex) =>
                    el('li', {
                      class: 'curriculum__lesson',
                      children: [
                        el('span', { class: 'curriculum__lesson-status', text: lesson.status === 'published' ? '✓' : '○', attrs: { 'aria-hidden': 'true' } }),
                        el('span', { class: 'full-width', text: lesson.title }),
                        lesson.is_preview ? el('span', { class: 'badge badge--accent', text: 'Preview' }) : null,
                        statusBadge(lesson.status),
                        el('span', {
                          class: 'cluster cluster--tight',
                          children: [
                            el('button', {
                              class: 'btn btn--sm',
                              text: '↑',
                              attrs: { type: 'button', 'aria-label': `Move ${lesson.title} up` },
                              on: {
                                click: async () => {
                                  const order = move(module.lessons ?? [], lessonIndex, -1);
                                  if (!order) return;
                                  await api.put('/admin/lessons/reorder', { order });
                                  toastSuccess('Lesson order saved.');
                                  await loadCurriculum();
                                },
                              },
                            }),
                            el('button', {
                              class: 'btn btn--sm',
                              text: '↓',
                              attrs: { type: 'button', 'aria-label': `Move ${lesson.title} down` },
                              on: {
                                click: async () => {
                                  const order = move(module.lessons ?? [], lessonIndex, 1);
                                  if (!order) return;
                                  await api.put('/admin/lessons/reorder', { order });
                                  toastSuccess('Lesson order saved.');
                                  await loadCurriculum();
                                },
                              },
                            }),
                            el('button', {
                              class: 'btn btn--sm btn--ghost',
                              text: 'Edit',
                              attrs: { type: 'button' },
                              on: { click: () => openLessonForm(lesson) },
                            }),
                            el('button', {
                              class: 'btn btn--sm btn--danger',
                              text: 'Delete',
                              attrs: { type: 'button' },
                              on: {
                                click: async () => {
                                  const confirmed = await confirmAction({
                                    title: `Delete “${lesson.title}”?`,
                                    body: 'Learner progress for this lesson is removed with it.',
                                    confirmLabel: 'Delete lesson',
                                    tone: 'danger',
                                    onConfirm: async () => {
                                      await api.delete(`/admin/lessons/${encodeURIComponent(lesson.id)}`);
                                    },
                                  });
                                  if (!confirmed) return;
                                  toastSuccess('Lesson deleted.');
                                  await loadCurriculum();
                                },
                              },
                            }),
                          ],
                        }),
                      ],
                    }),
                  ),
                })
              : el('p', { class: 'curriculum__lesson muted', text: 'No lessons in this module yet.' }),
          ],
        }),
      ),
    );
  }

  async function openLessonForm(lesson) {
    lessonSection.hidden = false;
    // The curriculum tree lists lessons without their body; pull the full record
    // (including content_md) only when we are actually editing one.
    if (lesson.id && lesson.content_md === undefined) {
      try {
        const detail = await api.get(`/admin/lessons/${encodeURIComponent(lesson.id)}`, { signal });
        lesson = { ...lesson, ...(detail.lesson ?? detail) };
      } catch (error) {
        toastError(`Could not load the lesson body: ${error.message}`);
      }
    }
    lessonForm.elements.id.value = lesson.id ?? '';
    lessonForm.elements.title.value = lesson.title ?? '';
    lessonForm.elements.position.value = String(lesson.position ?? 0);
    lessonForm.elements.estimated_minutes.value = String(lesson.estimated_minutes ?? 0);
    lessonForm.elements.content_md.value = lesson.content_md ?? '';
    lessonForm.elements.completion_rule.value = lesson.completion_rule ?? 'mark_complete';
    lessonForm.elements.status.value = lesson.status ?? 'draft';
    lessonForm.elements.is_preview.checked = Boolean(lesson.is_preview);
    lessonForm.dataset.moduleId = lesson.module_id ?? '';
    lessonSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  wireForm(lessonForm, async (values, { setStatus }) => {
    const moduleId = lessonForm.dataset.moduleId;
    const payload = {
      title: values.title,
      position: Number(values.position ?? 0),
      estimated_minutes: Number(values.estimated_minutes ?? 0),
      content_md: values.content_md ?? '',
      completion_rule: values.completion_rule ?? 'mark_complete',
      status: values.status ?? 'draft',
      is_preview: Boolean(values.is_preview),
    };

    setStatus('Saving…');
    if (values.id) {
      await api.patch(`/admin/lessons/${encodeURIComponent(values.id)}`, payload, { signal });
      setStatus('Lesson updated.', 'success');
    } else {
      await api.post('/admin/lessons', { ...payload, module_id: moduleId }, { signal });
      setStatus('Lesson created.', 'success');
    }
    toastSuccess('Saved.');
    lessonSection.hidden = true;
    await loadCurriculum();
  });

  qs('[data-add-module]')?.addEventListener('click', async (event) => {
    const title = window.prompt('Title of the new module?');
    if (!title || title.trim().length < 2) return;
    event.currentTarget.disabled = true;
    try {
      await api.post(
        '/admin/modules',
        { course_id: courseSelect.value, title: title.trim(), position: modules.length, status: 'draft' },
        { signal },
      );
      toastSuccess('Module added.');
      await loadCurriculum();
    } catch (error) {
      toastError(error.message);
    } finally {
      event.currentTarget.disabled = false;
    }
  });

  qs('[data-cancel-lesson]')?.addEventListener('click', () => {
    lessonSection.hidden = true;
  });

  courseSelect.addEventListener('change', () => {
    loadCurriculum().catch((error) => pageError(error, () => loadCurriculum()));
  });

  try {
    await loadCourses();
    await loadCurriculum();
  } catch (error) {
    pageError(error, () => window.location.reload());
  }
}
