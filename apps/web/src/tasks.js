/* Tasks (ROI): a personal task manager (List, Board and Timeline views) whose
 * tasks feed the weekly ROI email. Loaded before app.js; app.js calls
 * JdTasks.create({...}) once and then renderPage(root) / openComposer().
 * Pure ROI maths and email markup live in roi-core.js (JdRoi).
 */
(function () {
  'use strict';

  const Roi = window.JdRoi;

  const STATUSES = ['not_started', 'in_progress', 'on_hold', 'completed'];
  const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
  const KINDS = ['task', 'issue', 'innovation', 'request'];
  const GROUP_ORDER = ['in_progress', 'not_started', 'on_hold', 'completed'];
  const BOARD_ORDER = ['not_started', 'in_progress', 'on_hold', 'completed'];
  const KIND_PLURAL = {
    task: 'Tasks',
    issue: 'Issues',
    innovation: 'Innovations',
    request: 'Requests',
  };

  function pref(key, fallback) {
    try {
      return window.localStorage.getItem(key) || fallback;
    } catch {
      return fallback;
    }
  }
  function setPref(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* preference only */
    }
  }

  function create(deps) {
    const esc = deps.escapeHtml;
    const today = () => Roi.dubaiDay(new Date());

    const st = {
      root: null,
      view: pref('tk-view', 'list'),
      zoom: pref('tk-zoom', 'weeks'),
      anchor: null,
      tasks: [],
      owners: [],
      owner: 'me',
      f: { search: '', status: '', priority: '', kind: '' },
      panel: null,
      collapsed: { completed: true },
      loadError: '',
    };

    // ------------------------------------------------------------------ data
    async function load() {
      const qs = st.owner === 'me' ? '' : '?owner=' + encodeURIComponent(st.owner);
      const data = await deps.apiRequest('/api/roi/tasks' + qs);
      st.tasks = data.tasks;
      st.owners = data.owners || [];
    }
    function replaceTask(task) {
      const i = st.tasks.findIndex((t) => t.id === task.id);
      if (i >= 0) st.tasks[i] = task;
      else st.tasks.push(task);
    }
    async function patchTask(id, body) {
      const { task } = await deps.apiRequest('/api/roi/tasks/' + id, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      replaceTask(task);
      return task;
    }
    const isAdmin = () => Boolean(deps.isAdmin && deps.isAdmin());
    const visible = (t) => {
      const f = st.f;
      if (f.status && t.status !== f.status) return false;
      if (f.priority && t.priority !== f.priority) return false;
      if (f.kind && t.kind !== f.kind) return false;
      if (f.search) {
        const hay = (t.title + ' ' + (t.remarks || '') + ' ' + (t.notes || '')).toLowerCase();
        if (!hay.includes(f.search.toLowerCase())) return false;
      }
      return true;
    };
    const isOverdue = (t) => t.status !== 'completed' && t.dueDate && t.dueDate < today();

    // --------------------------------------------------------------- helpers
    // The timeline opens a week or two before today so recent work is in view.
    const defaultAnchor = () =>
      Roi.isoWeek(Roi.addDays(today(), st.zoom === 'days' ? -7 : -14)).start;
    const statusLabel = (s) => Roi.STATUS_LABELS[s] || s;
    const priorityLabel = (p) => Roi.PRIORITY_LABELS[p] || p;
    function fmtDate(day) {
      return day ? Roi.formatShortDate(day) : '';
    }
    function options(list, labels, selected) {
      return list
        .map(
          (v) =>
            '<option value="' +
            v +
            '"' +
            (v === selected ? ' selected' : '') +
            '>' +
            esc(labels[v] || v) +
            '</option>',
        )
        .join('');
    }
    function kindChip(kind) {
      return kind && kind !== 'task'
        ? '<span class="tk-kind tk-kind-' + kind + '">' + esc(Roi.KIND_LABELS[kind]) + '</span>'
        : '';
    }
    function progressBar(t) {
      return (
        '<span class="tk-progress" aria-hidden="true"><span class="tk-progress-fill tk-s-' +
        t.status +
        '" style="width:' +
        t.percentComplete +
        '%"></span></span>'
      );
    }
    function toast(message, isError) {
      const el = st.root && st.root.querySelector('[data-tk-toast]');
      if (!el) return;
      el.textContent = message;
      el.className = 'tk-toast' + (isError ? ' tk-toast-error' : '');
      el.hidden = !message;
      window.clearTimeout(toast.timer);
      if (message) toast.timer = window.setTimeout(() => (el.hidden = true), isError ? 7000 : 2600);
    }

    // ---------------------------------------------------------------- shell
    async function renderPage(root) {
      st.root = root;
      root.innerHTML = '<p class="form-note">Loading tasks&hellip;</p>';
      try {
        await load();
      } catch (error) {
        root.innerHTML =
          '<p class="form-note pg-error">' + esc(error.message || 'Could not load tasks.') + '</p>';
        return;
      }
      if (!st.anchor) st.anchor = defaultAnchor();
      root.innerHTML =
        '<div class="tk">' +
        '<div class="tk-head"><div class="tk-head-title"><h3>Tasks</h3>' +
        deps.tipHtml(
          'Your weekly task list. Completed tasks appear under Result, open tasks under Objective, and issues, innovations and requests under Issues / Innovation in the ROI email you send to management.',
        ) +
        '</div><div class="tk-head-actions">' +
        '<button class="tk-pill tk-pill-accent" type="button" data-tk-send-roi>' +
        icon('send') +
        'Send ROI</button>' +
        '<button class="button button-outline tk-btn" type="button" data-tk-import>' +
        icon('upload') +
        'Import</button>' +
        '<button class="button button-primary tk-btn" type="button" data-tk-new>' +
        icon('plus') +
        'New task</button>' +
        '</div></div>' +
        '<div data-tk-kpis class="tk-kpis"></div>' +
        '<div class="tk-toolbar">' +
        '<div class="tk-seg" role="tablist" aria-label="View">' +
        [
          ['list', 'List'],
          ['board', 'Board'],
          ['timeline', 'Timeline'],
        ]
          .map(
            ([id, label]) =>
              '<button type="button" role="tab" data-tk-view="' + id + '">' + label + '</button>',
          )
          .join('') +
        '</div>' +
        '<label class="tk-search"><span class="sr-only">Search tasks</span><input type="search" data-tk-search placeholder="Search tasks" value="' +
        esc(st.f.search) +
        '"></label>' +
        '<select data-tk-filter="kind" aria-label="Type"><option value="">All types</option>' +
        KINDS.map((k) => '<option value="' + k + '">' + KIND_PLURAL[k] + '</option>').join('') +
        '</select>' +
        '<select data-tk-filter="status" aria-label="Status"><option value="">All statuses</option>' +
        options(STATUSES, Roi.STATUS_LABELS, '') +
        '</select>' +
        '<select data-tk-filter="priority" aria-label="Priority"><option value="">All priorities</option>' +
        options(PRIORITIES, Roi.PRIORITY_LABELS, '') +
        '</select>' +
        '<span data-tk-owner-host></span>' +
        '</div>' +
        '<div class="tk-toast" data-tk-toast role="status" hidden></div>' +
        '<div data-tk-content></div>' +
        '<div data-tk-overlay></div>' +
        '</div>';
      wire(root);
      draw();
    }

    function icon(name) {
      const paths = {
        plus: '<path d="M12 5v14M5 12h14"/>',
        send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/>',
        upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 20h14"/>',
        close: '<path d="M6 6l12 12M18 6 6 18"/>',
        chevron: '<path d="m9 6 6 6-6 6"/>',
        calendar:
          '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
      };
      return (
        '<svg class="tk-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
        paths[name] +
        '</svg>'
      );
    }

    // ------------------------------------------------------------------ draw
    function draw() {
      if (!st.root) return;
      const root = st.root;
      root.querySelectorAll('[data-tk-view]').forEach((b) => {
        const on = b.dataset.tkView === st.view;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
      });
      const host = root.querySelector('[data-tk-owner-host]');
      if (isAdmin() && st.owners.length) {
        host.innerHTML =
          '<select data-tk-owner aria-label="Whose tasks"><option value="me">My tasks</option><option value="all">Everyone</option>' +
          st.owners
            .map(
              (o) =>
                '<option value="' +
                o.id +
                '">' +
                esc(o.name) +
                (o.tasks ? ' (' + o.tasks + ')' : '') +
                '</option>',
            )
            .join('') +
          '</select>';
        host.querySelector('select').value = st.owner;
      } else host.innerHTML = '';
      drawKpis();
      const content = root.querySelector('[data-tk-content]');
      if (st.view === 'board') content.innerHTML = boardHtml();
      else if (st.view === 'timeline') content.innerHTML = timelineHtml();
      else content.innerHTML = listHtml();
    }

    function drawKpis() {
      const week = Roi.isoWeek(today());
      const tasks = st.tasks.filter((t) => t.kind === 'task');
      const open = tasks.filter((t) => t.status !== 'completed');
      const doneWeek = tasks.filter(
        (t) =>
          t.status === 'completed' &&
          t.completedAt &&
          Roi.dubaiDay(t.completedAt) >= week.start &&
          Roi.dubaiDay(t.completedAt) <= week.end,
      );
      const dueWeek = open.filter(
        (t) => t.dueDate && t.dueDate >= week.start && t.dueDate <= week.end,
      );
      const overdue = open.filter(isOverdue);
      const issues = st.tasks.filter((t) => t.kind !== 'task' && t.status !== 'completed');
      const card = (label, value, sub, tone) =>
        '<div class="tk-kpi' +
        (tone ? ' tk-kpi-' + tone : '') +
        '"><span class="tk-kpi-label">' +
        esc(label) +
        '</span><span class="tk-kpi-value">' +
        value +
        '</span><span class="tk-kpi-sub">' +
        esc(sub) +
        '</span></div>';
      st.root.querySelector('[data-tk-kpis]').innerHTML =
        card(
          'Open tasks',
          open.length,
          open.filter((t) => t.status === 'in_progress').length + ' in progress',
        ) +
        card('Done this week', doneWeek.length, 'Week ' + week.week + ' results', 'good') +
        card('Due this week', dueWeek.length, 'by ' + Roi.formatShortDate(week.end)) +
        card(
          'Overdue',
          overdue.length,
          overdue.length ? 'need attention' : 'all on time',
          overdue.length ? 'bad' : '',
        ) +
        card('Issues / ideas', issues.length, 'open items');
    }

    // ------------------------------------------------------------------ list
    function rowHtml(t) {
      const done = t.status === 'completed';
      return (
        '<tr class="tk-row' +
        (done ? ' tk-done' : '') +
        '" data-id="' +
        t.id +
        '">' +
        '<td class="tk-c-check"><input type="checkbox" data-tk-complete aria-label="Mark ' +
        esc(t.title) +
        ' complete"' +
        (done ? ' checked' : '') +
        '></td>' +
        '<td class="tk-c-title"><button type="button" class="tk-title" data-tk-open>' +
        esc(t.title) +
        '</button>' +
        kindChip(t.kind) +
        '</td>' +
        '<td><select class="tk-inline tk-p-' +
        t.priority +
        '" data-tk-priority aria-label="Priority">' +
        options(PRIORITIES, Roi.PRIORITY_LABELS, t.priority) +
        '</select></td>' +
        '<td class="tk-c-date">' +
        esc(fmtDate(t.startDate)) +
        '</td>' +
        '<td class="tk-c-date' +
        (isOverdue(t) ? ' tk-overdue' : '') +
        '">' +
        esc(fmtDate(t.dueDate)) +
        '</td>' +
        '<td class="tk-c-progress"><input type="range" min="0" max="100" step="5" value="' +
        t.percentComplete +
        '" data-tk-percent aria-label="Percent complete"><output>' +
        t.percentComplete +
        '%</output></td>' +
        '<td class="tk-c-remarks">' +
        esc(t.remarks || '') +
        '</td>' +
        '</tr>'
      );
    }

    function listHtml() {
      const tasks = st.tasks.filter(visible);
      let html =
        '<form class="tk-quickadd" data-tk-quickadd><input type="text" maxlength="500" placeholder="Add a task and press Enter" aria-label="New task title"><button class="button button-outline tk-btn" type="submit">Add</button></form>';
      if (!tasks.length) {
        return (
          html +
          '<p class="tk-empty">' +
          (st.tasks.length
            ? 'No items match these filters.'
            : 'No tasks yet. Add your first one above, or import your weekly tracker.') +
          '</p>'
        );
      }
      html += GROUP_ORDER.map((status) => {
        const rows = tasks.filter((t) => t.status === status);
        if (!rows.length) return '';
        const closed = Boolean(st.collapsed[status]);
        return (
          '<section class="tk-group tk-g-' +
          status +
          '"><button type="button" class="tk-group-head" data-tk-group="' +
          status +
          '" aria-expanded="' +
          !closed +
          '">' +
          icon('chevron') +
          '<span class="tk-dot tk-s-' +
          status +
          '"></span><span class="tk-group-name">' +
          esc(statusLabel(status)) +
          '</span><span class="tk-count">' +
          rows.length +
          '</span></button>' +
          (closed
            ? ''
            : '<div class="tk-table-wrap"><table class="tk-table"><thead><tr><th class="tk-c-check"></th><th>Item</th><th>Priority</th><th>Start</th><th>Due</th><th>Progress</th><th>Remarks / next action</th></tr></thead><tbody>' +
              rows.map(rowHtml).join('') +
              '</tbody></table></div>') +
          '</section>'
        );
      }).join('');
      return html;
    }

    // ----------------------------------------------------------------- board
    function boardHtml() {
      const tasks = st.tasks.filter(visible);
      return (
        '<div class="tk-board">' +
        BOARD_ORDER.map((status) => {
          const cards = tasks.filter((t) => t.status === status);
          return (
            '<section class="tk-col tk-g-' +
            status +
            '" data-tk-col="' +
            status +
            '" aria-label="' +
            esc(statusLabel(status)) +
            '">' +
            '<header><span class="tk-dot tk-s-' +
            status +
            '"></span><span class="tk-group-name">' +
            esc(statusLabel(status)) +
            '</span><span class="tk-count">' +
            cards.length +
            '</span></header>' +
            '<div class="tk-cards">' +
            (cards.length
              ? cards.map(cardHtml).join('')
              : '<p class="tk-col-empty">Drop a card here</p>') +
            '</div></section>'
          );
        }).join('') +
        '</div>'
      );
    }
    function cardHtml(t) {
      return (
        '<article class="tk-card tk-pb-' +
        t.priority +
        '" draggable="true" data-id="' +
        t.id +
        '">' +
        '<button type="button" class="tk-card-title" data-tk-open>' +
        esc(t.title) +
        '</button>' +
        '<div class="tk-card-meta">' +
        kindChip(t.kind) +
        '<span class="tk-prio tk-p-' +
        t.priority +
        '">' +
        esc(priorityLabel(t.priority)) +
        '</span>' +
        (t.dueDate
          ? '<span class="tk-due' +
            (isOverdue(t) ? ' tk-overdue' : '') +
            '">' +
            icon('calendar') +
            esc(fmtDate(t.dueDate)) +
            '</span>'
          : '') +
        '</div>' +
        (t.remarks ? '<p class="tk-card-remarks">' + esc(t.remarks) + '</p>' : '') +
        '<div class="tk-card-foot">' +
        progressBar(t) +
        '<span class="tk-pct">' +
        t.percentComplete +
        '%</span>' +
        '<select class="tk-inline" data-tk-move aria-label="Move to">' +
        options(STATUSES, Roi.STATUS_LABELS, t.status) +
        '</select></div>' +
        '</article>'
      );
    }

    // -------------------------------------------------------------- timeline
    function timelineHtml() {
      const days = st.zoom === 'days' ? 28 : 84;
      const dw = st.zoom === 'days' ? 34 : 11;
      const start = st.anchor;
      const end = Roi.addDays(start, days - 1);
      const t0 = today();
      const dated = st.tasks.filter(visible).filter((t) => t.startDate || t.dueDate);
      const undated = st.tasks.filter(visible).filter((t) => !t.startDate && !t.dueDate);
      const span = (t) => {
        const a = t.startDate || t.dueDate;
        const b = t.dueDate || t.startDate;
        return { a, b };
      };
      dated.sort(
        (x, y) => span(x).a.localeCompare(span(y).a) || span(x).b.localeCompare(span(y).b),
      );

      // Header: week bands, then (days zoom) day cells.
      let weeks = '';
      for (let d = 0; d < days; d += 7) {
        const mon = Roi.addDays(start, d);
        const w = Roi.isoWeek(mon);
        weeks +=
          '<div class="tk-tl-week" style="width:' +
          7 * dw +
          'px"><strong>W' +
          w.week +
          '</strong><span>' +
          esc(fmtDate(mon)) +
          '</span></div>';
      }
      let dayCells = '';
      if (st.zoom === 'days') {
        for (let d = 0; d < days; d++) {
          const day = Roi.addDays(start, d);
          const dow = (new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7;
          dayCells +=
            '<div class="tk-tl-day' +
            (dow > 4 ? ' tk-wknd' : '') +
            (day === t0 ? ' tk-today-cell' : '') +
            '" style="width:' +
            dw +
            'px"><span>' +
            'MTWTFSS'[dow] +
            '</span>' +
            Number(day.slice(8)) +
            '</div>';
        }
      }
      const todayOffset = Roi.daysBetween(start, t0);
      const todayLine =
        todayOffset >= 0 && todayOffset < days
          ? '<span class="tk-today-line" style="left:' +
            (todayOffset * dw + dw / 2) +
            'px" title="Today"></span>'
          : '';
      const grid = 'background-size:' + 7 * dw + 'px 100%;';

      const rows = dated
        .map((t) => {
          const { a, b } = span(t);
          let from = Roi.daysBetween(start, a);
          let to = Roi.daysBetween(start, b);
          const cutL = from < 0;
          const cutR = to >= days;
          let bar = '';
          if (to >= 0 && from < days) {
            from = Math.max(from, 0);
            to = Math.min(to, days - 1);
            const width = (to - from + 1) * dw;
            const label = width > 70 ? esc(t.title) : '';
            bar =
              '<button type="button" class="tk-bar tk-bs-' +
              t.status +
              (isOverdue(t) ? ' tk-bar-overdue' : '') +
              (cutL ? ' tk-cut-l' : '') +
              (cutR ? ' tk-cut-r' : '') +
              '" data-tk-open style="left:' +
              from * dw +
              'px;width:' +
              width +
              'px" title="' +
              esc(t.title + ' - ' + statusLabel(t.status) + ', ' + t.percentComplete + '%') +
              '">' +
              '<span class="tk-bar-fill" style="width:' +
              t.percentComplete +
              '%"></span><span class="tk-bar-label">' +
              label +
              '</span></button>';
          }
          return (
            '<div class="tk-tl-row" data-id="' +
            t.id +
            '"><div class="tk-tl-name"><button type="button" class="tk-title" data-tk-open>' +
            esc(t.title) +
            '</button>' +
            kindChip(t.kind) +
            '<span class="tk-tl-sub">' +
            esc([fmtDate(t.startDate), fmtDate(t.dueDate)].filter(Boolean).join(' → ')) +
            '</span></div>' +
            '<div class="tk-tl-track" style="width:' +
            days * dw +
            'px;' +
            grid +
            '">' +
            bar +
            '</div></div>'
          );
        })
        .join('');

      return (
        '<div class="tk-tl-bar"><div class="tk-tl-nav">' +
        '<button type="button" class="button button-outline tk-btn" data-tk-tl="prev" aria-label="Earlier">&lsaquo;</button>' +
        '<button type="button" class="button button-outline tk-btn" data-tk-tl="today">Today</button>' +
        '<button type="button" class="button button-outline tk-btn" data-tk-tl="next" aria-label="Later">&rsaquo;</button>' +
        '<span class="tk-tl-range">' +
        esc(Roi.formatRoiDate(start)) +
        ' &ndash; ' +
        esc(Roi.formatRoiDate(end)) +
        '</span></div>' +
        '<div class="tk-seg" aria-label="Zoom">' +
        [
          ['days', 'Days'],
          ['weeks', 'Weeks'],
        ]
          .map(
            ([id, label]) =>
              '<button type="button" data-tk-zoom="' +
              id +
              '" class="' +
              (st.zoom === id ? 'active' : '') +
              '">' +
              label +
              '</button>',
          )
          .join('') +
        '</div></div>' +
        (dated.length
          ? '<div class="tk-tl-scroll"><div class="tk-tl" style="--tk-dw:' +
            dw +
            'px">' +
            '<div class="tk-tl-head"><div class="tk-tl-name tk-tl-corner">Item</div><div class="tk-tl-heads" style="width:' +
            days * dw +
            'px"><div class="tk-tl-weeks">' +
            weeks +
            '</div>' +
            (dayCells ? '<div class="tk-tl-days">' + dayCells + '</div>' : '') +
            '</div></div>' +
            '<div class="tk-tl-body">' +
            rows +
            '<div class="tk-tl-today-wrap" style="left:var(--tk-name-w)">' +
            todayLine +
            '</div></div></div></div>'
          : '<p class="tk-empty">No tasks with dates yet. Give a task a start and due date and it appears here as a bar.</p>') +
        (undated.length
          ? '<div class="tk-undated"><strong>No dates yet</strong> ' +
            undated
              .slice(0, 12)
              .map(
                (t) =>
                  '<button type="button" class="tk-chip" data-id="' +
                  t.id +
                  '" data-tk-open>' +
                  esc(t.title) +
                  '</button>',
              )
              .join('') +
            (undated.length > 12
              ? '<span class="tk-count">+' + (undated.length - 12) + ' more</span>'
              : '') +
            '</div>'
          : '')
      );
    }

    // ------------------------------------------------------- side panel (edit)
    function panelHtml(p) {
      const t = p.task;
      const isNew = p.mode === 'new';
      return (
        '<div class="tk-backdrop" data-tk-close></div>' +
        '<aside class="tk-panel" role="dialog" aria-modal="true" aria-labelledby="tkPanelTitle">' +
        '<header><h4 id="tkPanelTitle">' +
        (isNew ? 'New item' : 'Edit item') +
        '</h4><button type="button" class="tk-x" data-tk-close aria-label="Close">' +
        icon('close') +
        '</button></header>' +
        '<form data-tk-form novalidate><div class="tk-panel-body">' +
        '<div class="tk-field"><label for="tkTitle">Title</label><textarea id="tkTitle" name="title" rows="2" maxlength="500" required>' +
        esc(t.title) +
        '</textarea></div>' +
        '<div class="tk-field"><span class="tk-label">Type</span><div class="tk-seg tk-seg-wide" role="radiogroup" aria-label="Type">' +
        KINDS.map(
          (k) =>
            '<label class="' +
            (t.kind === k ? 'active' : '') +
            '"><input type="radio" name="kind" value="' +
            k +
            '"' +
            (t.kind === k ? ' checked' : '') +
            '>' +
            esc(Roi.KIND_LABELS[k]) +
            '</label>',
        ).join('') +
        '</div><p class="tk-hint">Tasks go under Result and Objective in the ROI. Issues, innovations and requests go under Issues / Innovation.</p></div>' +
        '<div class="tk-grid2"><div class="tk-field"><label for="tkStatus">Status</label><select id="tkStatus" name="status">' +
        options(STATUSES, Roi.STATUS_LABELS, t.status) +
        '</select></div>' +
        '<div class="tk-field"><label for="tkPriority">Priority</label><select id="tkPriority" name="priority">' +
        options(PRIORITIES, Roi.PRIORITY_LABELS, t.priority) +
        '</select></div></div>' +
        '<div class="tk-grid2"><div class="tk-field"><label for="tkStart">Start date</label><input id="tkStart" type="date" name="startDate" value="' +
        esc(t.startDate || '') +
        '"></div>' +
        '<div class="tk-field"><label for="tkDue">End date</label><input id="tkDue" type="date" name="dueDate" value="' +
        esc(t.dueDate || '') +
        '"></div></div>' +
        '<div class="tk-field" data-tk-done-field' +
        (t.status === 'completed' ? '' : ' hidden') +
        '><label for="tkDone">Completed on <span class="tk-opt">decides which week\u2019s ROI lists it as a Result</span></label><input id="tkDone" type="date" name="completedOn" value="' +
        esc(t.completedAt ? Roi.dubaiDay(t.completedAt) : today()) +
        '"></div>' +
        '<div class="tk-field"><label for="tkPct">% complete <output data-tk-pct-out>' +
        t.percentComplete +
        '%</output></label><input id="tkPct" type="range" min="0" max="100" step="5" name="percentComplete" value="' +
        t.percentComplete +
        '"></div>' +
        '<div class="tk-field"><label for="tkRemarks">Remarks / next action <span class="tk-opt">shown in the ROI</span></label><textarea id="tkRemarks" name="remarks" rows="3" maxlength="2000">' +
        esc(t.remarks || '') +
        '</textarea></div>' +
        '<div class="tk-field"><label for="tkNotes">Private notes <span class="tk-opt">not emailed</span></label><textarea id="tkNotes" name="notes" rows="3" maxlength="5000">' +
        esc(t.notes || '') +
        '</textarea></div>' +
        (isAdmin() && st.owners.length
          ? '<div class="tk-field"><label for="tkOwner">Owner</label><select id="tkOwner" name="ownerProfileId">' +
            st.owners
              .map(
                (o) =>
                  '<option value="' +
                  o.id +
                  '"' +
                  (String(o.id) === String(t.ownerProfileId) ? ' selected' : '') +
                  '>' +
                  esc(o.name) +
                  '</option>',
              )
              .join('') +
            '</select></div>'
          : '') +
        '<p class="tk-error" data-tk-error role="alert" hidden></p>' +
        '</div><footer>' +
        (isNew
          ? ''
          : '<button type="button" class="button button-outline tk-btn tk-danger" data-tk-delete>Delete</button>') +
        '<span class="tk-spacer"></span><button type="button" class="button button-outline tk-btn" data-tk-close>Cancel</button><button type="submit" class="button button-primary tk-btn">' +
        (isNew ? 'Add' : 'Save') +
        '</button></footer></form></aside>'
      );
    }

    function openPanel(task, mode) {
      const base = {
        title: '',
        kind: 'task',
        status: 'not_started',
        priority: 'medium',
        startDate: today(),
        dueDate: '',
        percentComplete: 0,
        remarks: '',
        notes: '',
        ownerProfileId: st.owner !== 'me' && st.owner !== 'all' ? st.owner : '',
      };
      st.panel = { mode, task: Object.assign(base, task || {}), opener: document.activeElement };
      const host = st.root.querySelector('[data-tk-overlay]');
      host.innerHTML = panelHtml(st.panel);
      const first = host.querySelector('#tkTitle');
      if (first) first.focus();
    }
    function closePanel() {
      const host = st.root && st.root.querySelector('[data-tk-overlay]');
      if (host) host.innerHTML = '';
      if (
        st.panel &&
        st.panel.opener &&
        st.panel.opener.focus &&
        document.contains(st.panel.opener)
      )
        st.panel.opener.focus();
      st.panel = null;
    }
    async function savePanel(form) {
      const errorEl = form.querySelector('[data-tk-error]');
      const fd = new FormData(form);
      const get = (k) => String(fd.get(k) == null ? '' : fd.get(k)).trim();
      const body = {
        title: get('title'),
        kind: get('kind') || 'task',
        status: get('status'),
        priority: get('priority'),
        startDate: get('startDate') || null,
        dueDate: get('dueDate') || null,
        percentComplete: Number(get('percentComplete')),
        remarks: get('remarks') || null,
        notes: get('notes') || null,
      };
      if (body.status === 'completed' && get('completedOn')) body.completedOn = get('completedOn');
      const fail = (m) => {
        errorEl.textContent = m;
        errorEl.hidden = false;
      };
      if (!body.title) return fail('Enter a title.');
      if (body.startDate && body.dueDate && body.dueDate < body.startDate)
        return fail('The end date cannot be before the start date.');
      const owner = get('ownerProfileId');
      const submit = form.querySelector('[type=submit]');
      submit.disabled = true;
      try {
        if (st.panel.mode === 'new') {
          if (owner && isAdmin()) body.ownerProfileId = owner;
          const { task } = await deps.apiRequest('/api/roi/tasks', {
            method: 'POST',
            body: JSON.stringify(body),
          });
          replaceTask(task);
          toast('Added.');
        } else {
          if (owner && isAdmin()) body.ownerProfileId = owner;
          await patchTask(st.panel.task.id, body);
          toast('Saved.');
        }
        closePanel();
        // The owner may have changed; reload so the list matches the filter.
        await load();
        draw();
      } catch (error) {
        fail(error.message || 'Could not save.');
        submit.disabled = false;
      }
    }

    // ----------------------------------------------------------------- events
    function wire(root) {
      root.addEventListener('click', async (event) => {
        const target = event.target.closest('button, [data-tk-open], .tk-backdrop');
        if (!target) return;
        const id =
          (target.closest('[data-id]') || {}).dataset && target.closest('[data-id]').dataset.id;
        if (target.matches('[data-tk-new]')) return openPanel(null, 'new');
        if (target.matches('[data-tk-send-roi]')) return openComposer({ source: 'tasks' });
        if (target.matches('[data-tk-import]')) return openImport();
        if (target.dataset.tkView) {
          st.view = target.dataset.tkView;
          setPref('tk-view', st.view);
          return draw();
        }
        if (target.dataset.tkZoom) {
          st.zoom = target.dataset.tkZoom;
          setPref('tk-zoom', st.zoom);
          st.anchor = defaultAnchor();
          return draw();
        }
        if (target.dataset.tkTl) {
          const step = st.zoom === 'days' ? 28 : 84;
          if (target.dataset.tkTl === 'today')
            st.anchor = Roi.isoWeek(Roi.addDays(today(), st.zoom === 'days' ? -7 : -14)).start;
          else
            st.anchor = Roi.addDays(
              st.anchor,
              (target.dataset.tkTl === 'next' ? 1 : -1) * (step / 2),
            );
          return draw();
        }
        if (target.dataset.tkGroup) {
          st.collapsed[target.dataset.tkGroup] = !st.collapsed[target.dataset.tkGroup];
          return draw();
        }
        if (target.matches('[data-tk-open]') && id) {
          const task = st.tasks.find((t) => t.id === id);
          if (task) openPanel(task, 'edit');
          return;
        }
        if (target.matches('[data-tk-close]')) return closePanel();
        if (target.matches('[data-tk-delete]')) {
          if (!target.dataset.confirm) {
            target.dataset.confirm = '1';
            target.textContent = 'Click again to delete';
            return;
          }
          try {
            await deps.apiRequest('/api/roi/tasks/' + st.panel.task.id, { method: 'DELETE' });
            st.tasks = st.tasks.filter((t) => t.id !== st.panel.task.id);
            closePanel();
            draw();
            toast('Deleted.');
          } catch (error) {
            toast(error.message || 'Could not delete.', true);
          }
        }
      });

      root.addEventListener('change', async (event) => {
        const el = event.target;
        const row = el.closest('[data-id]');
        const id = row && row.dataset.id;
        try {
          if (el.matches('[data-tk-filter]')) {
            st.f[el.dataset.tkFilter] = el.value;
            return draw();
          }
          if (el.matches('[data-tk-owner]')) {
            st.owner = el.value;
            await load();
            return draw();
          }
          if (el.matches('[data-tk-complete]') && id) {
            await patchTask(id, { status: el.checked ? 'completed' : 'in_progress' });
            return draw();
          }
          if (el.matches('[data-tk-priority]') && id) {
            await patchTask(id, { priority: el.value });
            return draw();
          }
          if (el.matches('[data-tk-move]') && id) {
            await patchTask(id, { status: el.value });
            return draw();
          }
          if (el.matches('[data-tk-percent]') && id) {
            await patchTask(id, { percentComplete: Number(el.value) });
            return draw();
          }
          if (el.matches('input[name=kind]')) {
            el.closest('.tk-seg')
              .querySelectorAll('label')
              .forEach((l) => l.classList.toggle('active', l.contains(el)));
          }
          if (el.matches('#tkStatus')) {
            const range = root.querySelector('#tkPct');
            if (el.value === 'completed') range.value = 100;
            else if (el.value === 'not_started') range.value = 0;
            root.querySelector('[data-tk-pct-out]').textContent = range.value + '%';
            const done = root.querySelector('[data-tk-done-field]');
            if (done) done.hidden = el.value !== 'completed';
          }
        } catch (error) {
          toast(error.message || 'Could not save that change.', true);
          await load().catch(() => {});
          draw();
        }
      });

      root.addEventListener('input', (event) => {
        const el = event.target;
        if (el.matches('[data-tk-search]')) {
          st.f.search = el.value;
          const pos = el.selectionStart;
          draw();
          const again = root.querySelector('[data-tk-search]');
          again.focus();
          again.setSelectionRange(pos, pos);
        } else if (el.matches('[data-tk-percent]')) {
          el.nextElementSibling.textContent = el.value + '%';
        } else if (el.matches('#tkPct')) {
          root.querySelector('[data-tk-pct-out]').textContent = el.value + '%';
          const status = root.querySelector('#tkStatus');
          if (Number(el.value) >= 100) status.value = 'completed';
          else if (status.value === 'completed') status.value = 'in_progress';
          else if (status.value === 'not_started' && Number(el.value) > 0)
            status.value = 'in_progress';
          const done = root.querySelector('[data-tk-done-field]');
          if (done) done.hidden = status.value !== 'completed';
        }
      });

      root.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (event.target.matches('[data-tk-form]')) return savePanel(event.target);
        if (event.target.matches('[data-tk-quickadd]')) {
          const input = event.target.querySelector('input');
          const title = input.value.trim();
          if (!title) return;
          input.disabled = true;
          try {
            const body = { title, startDate: today() };
            if (st.owner !== 'me' && st.owner !== 'all') body.ownerProfileId = st.owner;
            const { task } = await deps.apiRequest('/api/roi/tasks', {
              method: 'POST',
              body: JSON.stringify(body),
            });
            replaceTask(task);
            draw();
            const again = root.querySelector('[data-tk-quickadd] input');
            if (again) again.focus();
          } catch (error) {
            input.disabled = false;
            toast(error.message || 'Could not add the task.', true);
          }
        }
      });

      root.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && st.panel) closePanel();
      });

      // Board drag and drop.
      root.addEventListener('dragstart', (event) => {
        const card = event.target.closest && event.target.closest('.tk-card');
        if (!card) return;
        event.dataTransfer.setData('text/plain', card.dataset.id);
        event.dataTransfer.effectAllowed = 'move';
        card.classList.add('tk-dragging');
      });
      root.addEventListener('dragend', (event) => {
        const card = event.target.closest && event.target.closest('.tk-card');
        if (card) card.classList.remove('tk-dragging');
        root.querySelectorAll('.tk-col-over').forEach((c) => c.classList.remove('tk-col-over'));
      });
      root.addEventListener('dragover', (event) => {
        const col = event.target.closest && event.target.closest('[data-tk-col]');
        if (!col) return;
        event.preventDefault();
        root
          .querySelectorAll('.tk-col-over')
          .forEach((c) => c !== col && c.classList.remove('tk-col-over'));
        col.classList.add('tk-col-over');
      });
      root.addEventListener('drop', async (event) => {
        const col = event.target.closest && event.target.closest('[data-tk-col]');
        if (!col) return;
        event.preventDefault();
        const id = event.dataTransfer.getData('text/plain');
        const task = st.tasks.find((t) => t.id === id);
        if (!task || task.status === col.dataset.tkCol) return draw();
        try {
          await patchTask(id, { status: col.dataset.tkCol });
        } catch (error) {
          toast(error.message || 'Could not move that card.', true);
        }
        draw();
      });
    }

    // ======================================================== Send ROI composer
    // Shared by the Tasks tab and the Service Revenue Reports pill.
    async function openComposer(opts) {
      opts = opts || {};
      const mount = document.createElement('div');
      mount.className = 'tk-modal-host';
      document.body.appendChild(mount);
      const opener = document.activeElement;
      const close = () => {
        mount.remove();
        document.removeEventListener('keydown', onKey);
        if (opener && opener.focus && document.contains(opener)) opener.focus();
      };
      const onKey = (e) => {
        if (e.key === 'Escape') close();
      };
      document.addEventListener('keydown', onKey);
      mount.innerHTML =
        '<div class="tk-backdrop" data-c-close></div><div class="tk-modal" role="dialog" aria-modal="true" aria-labelledby="tkComposeTitle"><header><h4 id="tkComposeTitle">Send weekly ROI</h4><button type="button" class="tk-x" data-c-close aria-label="Close">' +
        icon('close') +
        '</button></header><div class="tk-modal-body"><p class="form-note">Loading&hellip;</p></div></div>';
      mount.addEventListener('click', (e) => {
        if (e.target.closest('[data-c-close]')) close();
      });

      let tasks;
      let settings;
      try {
        const [t, s] = await Promise.all([
          deps.apiRequest('/api/roi/tasks'),
          deps.apiRequest('/api/roi/settings'),
        ]);
        tasks = t.tasks;
        settings = s.settings;
      } catch (error) {
        mount.querySelector('.tk-modal-body').innerHTML =
          '<p class="form-note pg-error">' +
          esc(error.message || 'Could not load your tasks.') +
          '</p>';
        return;
      }
      const user = deps.getUser() || {};
      const canSummary = Boolean(deps.canSummary && deps.canSummary());
      const c = {
        week: Roi.isoWeek(today()),
        to: settings.toEmails.join('; '),
        cc: settings.ccEmails.join('; '),
        signature: settings.signature || user.name || '',
        greeting: 'Dear Sir,',
        intro: 'For your information,',
        includeSummary: canSummary,
        summary: null,
        summaryNote: '',
        logged: new Set(),
        html: '',
        text: '',
      };

      const body = mount.querySelector('.tk-modal-body');
      body.innerHTML =
        '<div class="tk-compose">' +
        '<div class="tk-compose-form">' +
        '<div class="tk-weeknav"><button type="button" class="button button-outline tk-btn" data-c-week="-1" aria-label="Previous week">&lsaquo;</button><div class="tk-weeklabel" data-c-weeklabel></div><button type="button" class="button button-outline tk-btn" data-c-week="1" aria-label="Next week">&rsaquo;</button><button type="button" class="button button-link" data-c-week="0">This week</button></div>' +
        '<p class="tk-counts" data-c-counts></p>' +
        '<div class="tk-field"><label for="cTo">To</label><textarea id="cTo" rows="2" data-c="to" placeholder="name@company.com; name@company.com"></textarea></div>' +
        '<div class="tk-field"><label for="cCc">Cc</label><textarea id="cCc" rows="2" data-c="cc"></textarea></div>' +
        '<p class="tk-error" data-c-error role="alert" hidden></p>' +
        '<div class="tk-field"><label for="cGreet">Opening</label><input id="cGreet" data-c="greeting" maxlength="80"><textarea rows="2" data-c="intro" aria-label="Opening note" maxlength="600"></textarea></div>' +
        '<div class="tk-field"><label for="cSig">Signature</label><textarea id="cSig" rows="3" data-c="signature" maxlength="2000"></textarea></div>' +
        (canSummary
          ? '<label class="tk-check"><input type="checkbox" data-c="includeSummary"> Include the Management Summary <span class="tk-opt" data-c-summary-note></span></label>'
          : '<p class="tk-hint">The Management Summary is added for users with Service Revenue Dashboard access.</p>') +
        '<div class="tk-compose-actions">' +
        '<button type="button" class="button button-primary tk-btn" data-c-copy>Copy formatted email</button>' +
        '<button type="button" class="button button-outline tk-btn" data-c-eml>Download Outlook draft (.eml)</button>' +
        '<button type="button" class="button button-outline tk-btn" data-c-mailto>Open mail app (text only)</button>' +
        '<button type="button" class="button button-link" data-c-save>Save recipients &amp; signature as my defaults</button>' +
        '</div><p class="form-note" data-c-msg>Nothing is sent from the portal: copy the formatted email into Outlook, or open the .eml draft, then press Send.</p>' +
        '</div>' +
        '<div class="tk-compose-preview"><div class="tk-preview-label">Preview</div><iframe data-c-frame title="ROI email preview"></iframe></div></div>';

      const $c = (sel) => body.querySelector(sel);
      body.querySelectorAll('[data-c]').forEach((el) => {
        const key = el.dataset.c;
        if (el.type === 'checkbox') el.checked = Boolean(c[key]);
        else el.value = c[key];
      });

      let timer = null;
      async function refresh() {
        const w = c.week;
        $c('[data-c-weeklabel]').innerHTML =
          '<strong>Week ' +
          w.week +
          '</strong><br>' +
          esc(Roi.formatShortDate(w.start)) +
          ' &ndash; ' +
          esc(Roi.formatShortDate(w.end)) +
          '<span>dated ' +
          esc(Roi.formatRoiDate(w.friday)) +
          '</span>';
        const groups = Roi.groupForWeek(tasks, w);
        $c('[data-c-counts]').innerHTML =
          '<span><b>' +
          groups.results.length +
          '</b> results</span><span><b>' +
          groups.objectives.length +
          '</b> objectives</span><span><b>' +
          groups.issues.length +
          '</b> issues / ideas</span>';
        c.groups = groups;
        const noteEl = $c('[data-c-summary-note]');
        if (c.includeSummary) {
          if (noteEl) noteEl.textContent = 'loading…';
          const stamp = c.week.friday;
          const result = await deps.loadSummary(c.week);
          if (stamp !== c.week.friday) return; // the week changed meanwhile
          c.summary = result.data;
          c.summaryNote = result.reason || '';
          if (noteEl)
            noteEl.textContent = result.data ? result.data.monthLabel : result.reason || '';
        } else c.summary = null;
        c.input = {
          week: c.week,
          name: user.name,
          title: '',
          greeting: c.greeting,
          intro: c.intro,
          groups,
          summary: c.summary,
          signature: c.signature,
        };
        c.html = Roi.buildRoiHtml(c.input);
        c.text = Roi.buildRoiText(c.input);
        $c('[data-c-frame]').srcdoc = c.html;
      }
      function schedule() {
        window.clearTimeout(timer);
        timer = window.setTimeout(refresh, 250);
      }
      body.addEventListener('input', (e) => {
        const el = e.target;
        if (!el.dataset || !el.dataset.c) return;
        if (el.type === 'checkbox') return;
        c[el.dataset.c] = el.value;
        if (['greeting', 'intro', 'signature'].includes(el.dataset.c)) schedule();
      });
      body.addEventListener('change', (e) => {
        if (e.target.matches('[data-c=includeSummary]')) {
          c.includeSummary = e.target.checked;
          refresh();
        }
      });

      function recipients() {
        const to = Roi.parseEmails(c.to);
        const cc = Roi.parseEmails(c.cc);
        const bad = to.concat(cc).filter((v) => !Roi.isEmail(v));
        const err = $c('[data-c-error]');
        let message = '';
        if (!to.length) message = 'Add at least one address in To.';
        else if (bad.length) message = 'Check these addresses: ' + bad.join(', ');
        err.textContent = message;
        err.hidden = !message;
        return message ? null : { to, cc };
      }
      async function logIt(kind) {
        const r = recipients();
        if (!r) return null;
        const key = c.week.friday + ':' + kind;
        if (!c.logged.has(key)) {
          c.logged.add(key);
          deps
            .apiRequest('/api/roi/reports', {
              method: 'POST',
              body: JSON.stringify({
                weekYear: c.week.year,
                weekNumber: c.week.week,
                weekEnding: c.week.friday,
                subject: Roi.subjectFor(user.name, c.week),
                toEmails: r.to,
                ccEmails: r.cc,
                includesSummary: Boolean(c.summary),
                counts: {
                  results: c.groups.results.length,
                  objectives: c.groups.objectives.length,
                  issues: c.groups.issues.length,
                },
                source: opts.source === 'revenue' ? 'revenue' : 'tasks',
              }),
            })
            .catch(() => {});
        }
        return r;
      }
      const say = (m) => ($c('[data-c-msg]').textContent = m);

      body.addEventListener('click', async (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        if (btn.dataset.cWeek !== undefined) {
          const n = Number(btn.dataset.cWeek);
          c.week = n === 0 ? Roi.isoWeek(today()) : Roi.shiftWeek(c.week.start, n);
          return refresh();
        }
        if (btn.matches('[data-c-copy]')) {
          if (!(await logIt('copy'))) return;
          try {
            await navigator.clipboard.write([
              new ClipboardItem({
                'text/html': new Blob([c.html], { type: 'text/html' }),
                'text/plain': new Blob([c.text], { type: 'text/plain' }),
              }),
            ]);
            say(
              'Copied with formatting. Paste it into a new email (Ctrl+V) and add the recipients below.',
            );
          } catch {
            say('This browser blocked copying. Use the .eml draft instead.');
          }
        } else if (btn.matches('[data-c-eml]')) {
          const r = await logIt('eml');
          if (!r) return;
          const subject = Roi.subjectFor(user.name, c.week);
          const eml = Roi.buildEml({ to: r.to, cc: r.cc, subject, html: c.html, text: c.text });
          deps.download(
            new Blob([eml], { type: 'message/rfc822' }),
            'Weekly-ROI-Week-' + c.week.week + '.eml',
          );
          say(
            'Draft downloaded. Open it in Outlook: recipients and formatting are filled in; press Send.',
          );
        } else if (btn.matches('[data-c-mailto]')) {
          const r = await logIt('mailto');
          if (!r) return;
          const limit = 1500;
          let text = c.text;
          if (text.length > limit)
            text =
              text.slice(0, text.lastIndexOf('\n', limit)) +
              '\n\n[Shortened - use Copy formatted email for the full ROI.]';
          window.location.href =
            'mailto:' +
            r.to.join(',') +
            '?cc=' +
            encodeURIComponent(r.cc.join(',')) +
            '&subject=' +
            encodeURIComponent(Roi.subjectFor(user.name, c.week)) +
            '&body=' +
            encodeURIComponent(text);
          say('Draft opened in your mail app (text only).');
        } else if (btn.matches('[data-c-save]')) {
          const r = recipients();
          if (!r) return;
          try {
            await deps.apiRequest('/api/roi/settings', {
              method: 'PUT',
              body: JSON.stringify({ toEmails: r.to, ccEmails: r.cc, signature: c.signature }),
            });
            say('Saved as your defaults.');
          } catch (error) {
            say(error.message || 'Could not save.');
          }
        }
      });

      await refresh();
    }

    // =========================================================== Import dialog
    function openImport() {
      const mount = document.createElement('div');
      mount.className = 'tk-modal-host';
      document.body.appendChild(mount);
      const close = () => {
        mount.remove();
        document.removeEventListener('keydown', onKey);
      };
      const onKey = (e) => e.key === 'Escape' && close();
      document.addEventListener('keydown', onKey);
      mount.innerHTML =
        '<div class="tk-backdrop" data-i-close></div><div class="tk-modal tk-modal-sm" role="dialog" aria-modal="true" aria-labelledby="tkImportTitle"><header><h4 id="tkImportTitle">Import from your weekly tracker</h4><button type="button" class="tk-x" data-i-close aria-label="Close">' +
        icon('close') +
        '</button></header>' +
        '<div class="tk-modal-body"><p class="tk-hint">Choose your WeeklyTasks.xlsx. Rows from the Result and Objective tables are read; tasks you already have (same title) are skipped.</p>' +
        '<input type="file" accept=".xlsx" data-i-file><div data-i-out></div></div></div>';
      const out = mount.querySelector('[data-i-out]');
      let sheets = [];
      mount.addEventListener('click', async (e) => {
        if (e.target.closest('[data-i-close]')) return close();
        if (e.target.closest('[data-i-go]')) {
          const date = mount.querySelector('[data-i-date]').value || today();
          const rows = [];
          mount.querySelectorAll('[data-i-sheet]').forEach((cb) => {
            if (!cb.checked) return;
            sheets[Number(cb.dataset.iSheet)].tasks.forEach((t) =>
              rows.push({
                title: t.title,
                kind: 'task',
                status: t.status,
                percentComplete: t.percentComplete,
                remarks: t.remarks,
                completedOn: t.status === 'completed' ? date : null,
              }),
            );
          });
          if (!rows.length) return;
          e.target.disabled = true;
          try {
            const r = await deps.apiRequest('/api/roi/import', {
              method: 'POST',
              body: JSON.stringify({ tasks: rows }),
            });
            await load();
            draw();
            out.innerHTML =
              '<p class="form-note">Added <strong>' +
              r.added +
              '</strong> task(s); ' +
              r.skipped +
              ' already existed.</p><div class="tk-compose-actions"><button type="button" class="button button-primary tk-btn" data-i-close>Done</button></div>';
          } catch (error) {
            e.target.disabled = false;
            out.insertAdjacentHTML(
              'beforeend',
              '<p class="tk-error">' + esc(error.message || 'Import failed.') + '</p>',
            );
          }
        }
      });
      mount.querySelector('[data-i-file]').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        out.innerHTML = '<p class="form-note">Reading&hellip;</p>';
        try {
          const fd = new FormData();
          fd.append('file', file);
          const preview = await deps.apiUpload('/api/roi/import/preview', fd);
          sheets = preview.sheets;
          out.innerHTML =
            '<div class="tk-import-sheets">' +
            sheets
              .map(
                (s, i) =>
                  '<label class="tk-check"><input type="checkbox" data-i-sheet="' +
                  i +
                  '" checked> <strong>' +
                  esc(s.name) +
                  '</strong> &middot; ' +
                  s.tasks.length +
                  ' tasks (' +
                  s.tasks.filter((t) => t.status === 'completed').length +
                  ' completed)</label>',
              )
              .join('') +
            '</div><div class="tk-field"><label for="iDate">Completed rows were finished on</label><input id="iDate" type="date" data-i-date value="' +
            esc(today()) +
            '"><p class="tk-hint">Completed tasks appear in the Result of the week they were finished. This defaults to today, so they show in this week’s ROI. Pick an earlier date to place them in a previous week.</p></div>' +
            '<div class="tk-compose-actions"><button type="button" class="button button-primary tk-btn" data-i-go>Import</button></div>';
        } catch (error) {
          out.innerHTML =
            '<p class="tk-error">' + esc(error.message || 'Could not read that file.') + '</p>';
        }
      });
    }

    return { renderPage, openComposer };
  }

  window.JdTasks = { create };
})();
