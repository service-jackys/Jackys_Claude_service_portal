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
  // Tasks imported from the weekly tracker are dated from the start of the 15 Oct 2026 week.
  const IMPORT_START_DEFAULT = '2026-10-15';
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
      archive: false,
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
    async function patchTask(id, body, opts) {
      const before = st.tasks.find((t) => t.id === id);
      const { task } = await deps.apiRequest('/api/roi/tasks/' + id, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      replaceTask(task);
      // Finishing a task from the list, board or a slider offers the Remarks / next action box.
      if (
        !(opts && opts.noPrompt) &&
        task.status === 'completed' &&
        before &&
        before.status !== 'completed'
      )
        askCompletionRemarks(task);
      return task;
    }

    // Admins add tasks for other people, so the owner is asked in a pop-up with nothing
    // pre-selected; the task is not created until a person is chosen.
    function pickOwner(title) {
      return new Promise((resolve) => {
        const mount = document.createElement('div');
        mount.className = 'tk-modal-host';
        (window.tkModalHost_ ? window.tkModalHost_() : document.body).appendChild(mount);
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          mount.remove();
          document.removeEventListener('keydown', onKey);
          resolve(value);
        };
        const onKey = (e) => e.key === 'Escape' && finish(null);
        document.addEventListener('keydown', onKey);
        mount.innerHTML =
          '<div class="tk-backdrop" data-o-close></div><div class="tk-modal tk-modal-sm" role="dialog" aria-modal="true" aria-labelledby="tkOwnerTitle"><header><h4 id="tkOwnerTitle">Who is this task for?</h4><button type="button" class="tk-x" data-o-close aria-label="Close">' +
          icon('close') +
          '</button></header><div class="tk-modal-body">' +
          '<p class="tk-hint">Choose the owner of <strong>' +
          esc(title) +
          '</strong>. It will appear on their task board and in their weekly ROI.</p>' +
          '<div class="tk-field"><label for="tkOwnerPick">Owner</label><select id="tkOwnerPick"><option value="">Select the owner&hellip;</option>' +
          st.owners
            .map((o) => '<option value="' + o.id + '">' + esc(o.name) + '</option>')
            .join('') +
          '</select></div><p class="tk-error" data-o-error hidden></p>' +
          '<div class="tk-compose-actions"><button type="button" class="button button-outline tk-btn" data-o-close>Cancel</button><button type="button" class="button button-primary tk-btn" data-o-ok>Add task</button></div></div></div>';
        const pick = mount.querySelector('#tkOwnerPick');
        pick.focus();
        mount.addEventListener('click', (e) => {
          if (e.target.closest('[data-o-close]')) return finish(null);
          if (!e.target.closest('[data-o-ok]')) return;
          if (!pick.value) {
            const err = mount.querySelector('[data-o-error]');
            err.textContent = 'Select who this task is for.';
            err.hidden = false;
            return pick.focus();
          }
          finish(pick.value);
        });
      });
    }

    // Shown right after a task reaches 100% / Completed so the ROI line can be worded
    // while it is fresh. Skipping keeps the existing remarks.
    function askCompletionRemarks(task) {
      const mount = document.createElement('div');
      mount.className = 'tk-modal-host';
      (window.tkModalHost_ ? window.tkModalHost_() : document.body).appendChild(mount);
      const close = () => {
        mount.remove();
        document.removeEventListener('keydown', onKey);
      };
      const onKey = (e) => e.key === 'Escape' && close();
      document.addEventListener('keydown', onKey);
      const done = task.completedAt ? Roi.dubaiDay(task.completedAt) : today();
      mount.innerHTML =
        '<div class="tk-backdrop" data-r-close></div><div class="tk-modal tk-modal-sm" role="dialog" aria-modal="true" aria-labelledby="tkDoneTitle"><header><h4 id="tkDoneTitle">Task completed</h4><button type="button" class="tk-x" data-r-close aria-label="Close">' +
        icon('close') +
        '</button></header><div class="tk-modal-body">' +
        '<p class="tk-hint"><strong>' +
        esc(task.title) +
        '</strong> is complete and now shows under Result in your ROI. Completed on ' +
        esc(fmtDate(done)) +
        (task.dueDate ? '; end date ' + esc(fmtDate(task.dueDate)) : '') +
        '.</p>' +
        '<div class="tk-field"><label for="tkDoneRemarks">Remarks / next action <span class="tk-opt">shown in the ROI</span></label><textarea id="tkDoneRemarks" rows="4" maxlength="2000">' +
        esc(task.remarks || '') +
        '</textarea></div><p class="tk-error" data-r-error hidden></p>' +
        '<div class="tk-compose-actions"><button type="button" class="button button-outline tk-btn" data-r-close>Skip</button><button type="button" class="button button-primary tk-btn" data-r-save>Save remarks</button></div></div></div>';
      const box = mount.querySelector('#tkDoneRemarks');
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
      mount.addEventListener('click', async (e) => {
        if (e.target.closest('[data-r-close]')) return close();
        if (!e.target.closest('[data-r-save]')) return;
        const btn = e.target.closest('[data-r-save]');
        const remarks = box.value.trim() || null;
        if (remarks === (task.remarks || null)) return close();
        btn.disabled = true;
        try {
          const { task: saved } = await deps.apiRequest('/api/roi/tasks/' + task.id, {
            method: 'PATCH',
            body: JSON.stringify({ remarks }),
          });
          replaceTask(saved);
          const i = lane.tasks.findIndex((t) => t.id === saved.id);
          if (i >= 0) lane.tasks[i] = saved;
          if (st.root && st.root.isConnected) draw();
          if (lane.host && lane.host.isConnected) laneDraw();
          close();
          toast('Remarks saved.');
        } catch (error) {
          btn.disabled = false;
          const err = mount.querySelector('[data-r-error]');
          err.textContent = error.message || 'Could not save the remarks.';
          err.hidden = false;
        }
      });
    }
    const isAdmin = () => Boolean(deps.isAdmin && deps.isAdmin());
    const visible = (t) => {
      const f = st.f;
      if (Boolean(t.archivedAt) !== st.archive) return false;
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
      st.flow = pref('tk.flow', '0') === '1';
      root.innerHTML =
        '<div class="tk' +
        (st.flow ? ' tk-flow' : '') +
        '">' +
        '<div class="tk-head"><div class="tk-head-title"><h3>Tasks</h3>' +
        deps.tipHtml(
          'Your weekly task list. Completed tasks appear under Result, open tasks under Objective, and issues, innovations and requests under Issues / Innovation in the ROI email you send to management.',
        ) +
        '<span class="tk-orb" data-tk-orb aria-hidden="true"><span class="tk-orb-fill"></span><b>0%</b></span>' +
        '</div><div class="tk-head-actions">' +
        '<button class="tk-pill" type="button" data-tk-flow aria-pressed="' +
        st.flow +
        '" title="Dark glass look for the Tasks section">Flow look</button>' +
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
        '<button type="button" class="tk-archive-toggle" data-tk-archive-toggle></button>' +
        '</div>' +
        '<div class="tk-toast" data-tk-toast role="status" hidden></div>' +
        '<div data-tk-content></div>' +
        '<div data-tk-overlay></div>' +
        '</div>';
      // The page root is reused on every visit: wire its listeners only once, or every
      // click would fire once per visit.
      if (!root.dataset.tkWired) {
        wire(root);
        root.dataset.tkWired = '1';
      }
      draw();
      openPending();
    }

    // Dashboard kanban asks for one task to be opened in the full editor.
    function openPending() {
      if (!st.pendingOpen || !st.root) return;
      const task = st.tasks.find((t) => t.id === st.pendingOpen);
      st.pendingOpen = null;
      if (task) openPanel(task, 'edit');
    }
    function openTask(id) {
      // The page (re)loads the task list when it opens, then opens this one.
      st.pendingOpen = String(id);
      st.owner = 'me';
    }

    function icon(name) {
      const paths = {
        plus: '<path d="M12 5v14M5 12h14"/>',
        send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/>',
        upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 20h14"/>',
        close: '<path d="M6 6l12 12M18 6 6 18"/>',
        chevron: '<path d="m9 6 6 6-6 6"/>',
        archive:
          '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"/>',
        restore: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
        clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
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
      const archiveCount = st.tasks.filter((t) => t.archivedAt).length;
      const toggle = root.querySelector('[data-tk-archive-toggle]');
      toggle.classList.toggle('active', st.archive);
      toggle.setAttribute('aria-pressed', String(st.archive));
      toggle.innerHTML = st.archive
        ? icon('chevron').replace('<svg', '<svg style="transform:rotate(180deg)"') + 'Back to tasks'
        : icon('archive') +
          'Archive' +
          (archiveCount ? ' <span class="tk-count">' + archiveCount + '</span>' : '');
      root.querySelector('.tk-toolbar').classList.toggle('tk-archiving', st.archive);
      const content = root.querySelector('[data-tk-content]');
      if (st.archive) content.innerHTML = archiveHtml();
      else if (st.view === 'board') content.innerHTML = boardHtml();
      else if (st.view === 'timeline') content.innerHTML = timelineHtml();
      else content.innerHTML = listHtml();
    }

    function drawKpis() {
      const week = Roi.isoWeek(today());
      const live = st.tasks.filter((t) => !t.archivedAt);
      const tasks = live.filter((t) => t.kind === 'task');
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
      const issues = live.filter((t) => t.kind !== 'task' && t.status !== 'completed');
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
      const orb = st.root.querySelector('[data-tk-orb]');
      if (orb) {
        const all = live.filter((t) => t.kind === 'task');
        const pct = all.length
          ? Math.round((all.filter((t) => t.status === 'completed').length / all.length) * 100)
          : 0;
        orb.querySelector('.tk-orb-fill').style.height = pct + '%';
        orb.querySelector('b').textContent = pct + '%';
        orb.title = pct + '% of tasks completed';
      }
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
        '<td class="tk-c-act">' +
        (done
          ? '<button type="button" class="tk-icon-btn" data-tk-archive title="Move to archive" aria-label="Move ' +
            esc(t.title) +
            ' to archive">' +
            icon('archive') +
            '</button>'
          : '') +
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
          '"><div class="tk-group-bar"><button type="button" class="tk-group-head" data-tk-group="' +
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
          (status === 'completed'
            ? '<button type="button" class="tk-link-btn" data-tk-archive-all title="After sending your ROI, move the completed tasks to the archive so next week starts clean">' +
              icon('archive') +
              'Archive all</button>'
            : '') +
          '</div>' +
          (closed
            ? ''
            : '<div class="tk-table-wrap"><table class="tk-table"><thead><tr><th class="tk-c-check"></th><th>Item</th><th>Priority</th><th>Start</th><th>Due</th><th>Progress</th><th>Remarks / next action</th><th class="tk-c-act"></th></tr></thead><tbody>' +
              rows.map(rowHtml).join('') +
              '</tbody></table></div>') +
          '</section>'
        );
      }).join('');
      return html;
    }

    function archiveHtml() {
      const rows = st.tasks
        .filter(visible)
        .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
      const head =
        '<div class="tk-archive-note"><strong>Archive</strong><span>Archived tasks stay out of the list and out of every weekly ROI. Restore one to bring it back.</span></div>';
      if (!rows.length)
        return (
          head +
          '<p class="tk-empty">Nothing archived yet. Use Archive all on the Completed group.</p>'
        );
      return (
        head +
        '<section class="tk-group tk-g-archive"><div class="tk-table-wrap"><table class="tk-table"><thead><tr><th>Item</th><th>Completed on</th><th>Remarks</th><th class="tk-c-act"></th></tr></thead><tbody>' +
        rows
          .map(
            (t) =>
              '<tr class="tk-row tk-done" data-id="' +
              t.id +
              '"><td class="tk-c-title"><button type="button" class="tk-title" data-tk-open>' +
              esc(t.title) +
              '</button>' +
              kindChip(t.kind) +
              '</td><td class="tk-c-date">' +
              esc(t.completedAt ? fmtDate(Roi.dubaiDay(t.completedAt)) : '') +
              '</td><td class="tk-c-remarks">' +
              esc(t.remarks || '') +
              '</td><td class="tk-c-act"><button type="button" class="tk-link-btn" data-tk-restore>' +
              icon('restore') +
              'Restore</button></td></tr>',
          )
          .join('') +
        '</tbody></table></div></section>'
      );
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
        '><label for="tkDone">Completed on <span class="tk-opt">shown in the ROI Result until you archive it</span></label><input id="tkDone" type="date" name="completedOn" value="' +
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
        (!isNew && isAdmin() && st.owners.length
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
    // Finishing a task closes its end date on the day it was completed (never before the start).
    function syncEndOnComplete(root) {
      if (!st.panel || st.panel.task.status === 'completed') return;
      const doneInput = root.querySelector('#tkDone');
      const day = (doneInput && doneInput.value) || today();
      const start = root.querySelector('#tkStart').value;
      root.querySelector('#tkDue').value = start && start > day ? start : day;
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
      let owner = get('ownerProfileId');
      if (st.panel.mode === 'new' && isAdmin() && st.owners.length) {
        owner = await pickOwner(body.title);
        if (!owner) return;
      }
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
          await patchTask(st.panel.task.id, body, { noPrompt: true });
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
        if (target.matches('[data-tk-flow]')) {
          st.flow = !st.flow;
          setPref('tk.flow', st.flow ? '1' : '0');
          target.setAttribute('aria-pressed', String(st.flow));
          const shell = st.root.querySelector('.tk');
          if (shell) shell.classList.toggle('tk-flow', st.flow);
          return;
        }
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
        if (target.matches('[data-tk-archive-toggle]')) {
          st.archive = !st.archive;
          return draw();
        }
        if (target.matches('[data-tk-archive], [data-tk-restore]') && id) {
          const restoring = target.matches('[data-tk-restore]');
          try {
            await patchTask(id, { archived: !restoring });
            toast(restoring ? 'Restored to Completed.' : 'Moved to the archive.');
          } catch (error) {
            toast(error.message || 'Could not update the archive.', true);
          }
          return draw();
        }
        if (target.matches('[data-tk-archive-all]')) {
          const ids = st.tasks
            .filter((t) => t.status === 'completed' && !t.archivedAt && visible(t))
            .map((t) => t.id);
          if (!ids.length) return;
          if (!target.dataset.confirm) {
            target.dataset.confirm = '1';
            target.lastChild.textContent = 'Click again to archive ' + ids.length;
            return;
          }
          try {
            await deps.apiRequest('/api/roi/tasks/archive', {
              method: 'POST',
              body: JSON.stringify({ ids }),
            });
            const stamp = new Date().toISOString();
            st.tasks.forEach((t) => {
              if (ids.includes(t.id)) t.archivedAt = stamp;
            });
            toast(ids.length + ' task(s) moved to the archive.');
          } catch (error) {
            toast(error.message || 'Could not archive.', true);
          }
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
          if (el.matches('#tkDone') && st.panel && st.panel.task.status !== 'completed')
            syncEndOnComplete(root);
          if (el.matches('input[name=kind]')) {
            el.closest('.tk-seg')
              .querySelectorAll('label')
              .forEach((l) => l.classList.toggle('active', l.contains(el)));
          }
          if (el.matches('#tkStatus')) {
            const range = root.querySelector('#tkPct');
            if (el.value === 'completed') syncEndOnComplete(root);
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
          if (status.value === 'completed') syncEndOnComplete(root);
        }
      });

      root.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (event.target.matches('[data-tk-form]')) return savePanel(event.target);
        if (event.target.matches('[data-tk-quickadd]')) {
          const input = event.target.querySelector('input');
          const title = input.value.trim();
          if (!title) return;
          let chosen = '';
          if (isAdmin() && st.owners.length) {
            chosen = await pickOwner(title);
            if (!chosen) return;
          }
          input.disabled = true;
          try {
            const body = { title, startDate: today() };
            if (chosen) body.ownerProfileId = chosen;
            else if (st.owner !== 'me' && st.owner !== 'all') body.ownerProfileId = st.owner;
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
          // Copy the rendered email exactly as the preview shows it (the same
          // thing as selecting it and pressing Ctrl+C), so Outlook receives the
          // browser's fully styled version, matching the .eml draft.
          let copied = false;
          try {
            const frame = $c('[data-c-frame]');
            const win = frame.contentWindow;
            const doc = frame.contentDocument;
            const range = doc.createRange();
            range.selectNodeContents(doc.body);
            const selection = win.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            win.focus();
            copied = doc.execCommand('copy');
            selection.removeAllRanges();
          } catch {
            copied = false;
          }
          if (!copied) {
            try {
              await navigator.clipboard.write([
                new ClipboardItem({
                  'text/html': new Blob([c.html], { type: 'text/html' }),
                  'text/plain': new Blob([c.text], { type: 'text/plain' }),
                }),
              ]);
              copied = true;
            } catch {
              copied = false;
            }
          }
          say(
            copied
              ? 'Copied with formatting, exactly as in the preview. Paste it into a new email (Ctrl+V) and add the recipients above.'
              : 'This browser blocked copying. Use the .eml draft instead.',
          );
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
          const start = mount.querySelector('[data-i-start]').value || null;
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
                startDate: start,
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
            '</div><div class="tk-field"><label for="iStart">Imported tasks started on</label><input id="iStart" type="date" data-i-start value="' +
            esc(IMPORT_START_DEFAULT) +
            '"><p class="tk-hint">Sets the start date, so the Dashboard kanban can show how many days each open task has been pending.</p></div><div class="tk-field"><label for="iDate">Completed rows were finished on</label><input id="iDate" type="date" data-i-date value="' +
            esc(today()) +
            '"><p class="tk-hint">Completed tasks stay in the ROI Result until you archive them. This date is just the record of when they were finished.</p></div>' +
            '<div class="tk-compose-actions"><button type="button" class="button button-primary tk-btn" data-i-go>Import</button></div>';
        } catch (error) {
          out.innerHTML =
            '<p class="tk-error">' + esc(error.message || 'Could not read that file.') + '</p>';
        }
      });
    }

    // ====================================== Dashboard kanban lane (modification #112)
    // "My tasks": the in-progress and not-started tasks beside the service board, each with
    // a days-pending pill, quick status / progress edits and a link into the full task.
    const LANE_COLS = [
      ['in_progress', 'In progress', 'Work underway'],
      ['not_started', 'Not started', 'Waiting to begin'],
    ];
    const LANE_ON_TRACK = 7;
    const LANE_LATE = 14;
    const lane = { host: null, tasks: [], loaded: false, q: '', error: '', note: '' };

    function pendingDays(t) {
      return t.startDate ? Roi.daysBetween(t.startDate, today()) : null;
    }
    function pendingPill(t) {
      const d = pendingDays(t);
      if (d === null)
        return '<span class="tkl-tat tkl-tat-none" title="Set a start date to see the days pending">No start date</span>';
      const tone = d < 0 ? 'future' : d <= LANE_ON_TRACK ? 'ok' : d <= LANE_LATE ? 'warn' : 'late';
      const label = d < 0 ? 'Starts in ' + -d + 'd' : d === 0 ? 'Started today' : d + 'd pending';
      return (
        '<span class="tkl-tat tkl-tat-' +
        tone +
        '" title="Started ' +
        esc(fmtDate(t.startDate)) +
        ' (' +
        esc(t.startDate) +
        ')">' +
        icon('clock') +
        esc(label) +
        '</span>'
      );
    }
    function laneVisible(t) {
      if (t.archivedAt || (t.status !== 'in_progress' && t.status !== 'not_started')) return false;
      if (!lane.q) return true;
      return (t.title + ' ' + (t.remarks || '')).toLowerCase().includes(lane.q);
    }
    function laneCard(t) {
      const d = pendingDays(t);
      const tone =
        d === null || d < 0 ? 'none' : d <= LANE_ON_TRACK ? 'ok' : d <= LANE_LATE ? 'warn' : 'late';
      return (
        '<article class="tkl-card tkl-b-' +
        tone +
        '" draggable="true" data-lane-id="' +
        t.id +
        '">' +
        '<div class="tkl-top"><button type="button" class="tkl-title" data-lane-open title="Open this task">' +
        esc(t.title) +
        '</button>' +
        pendingPill(t) +
        '</div>' +
        '<div class="tkl-meta">' +
        kindChip(t.kind) +
        '<span class="tk-prio tk-p-' +
        t.priority +
        '">' +
        esc(priorityLabel(t.priority)) +
        '</span>' +
        (t.startDate
          ? '<span class="tkl-since">' +
            icon('calendar') +
            'Since ' +
            esc(fmtDate(t.startDate)) +
            '</span>'
          : '') +
        (t.dueDate
          ? '<span class="tk-due' +
            (isOverdue(t) ? ' tk-overdue' : '') +
            '">Due ' +
            esc(fmtDate(t.dueDate)) +
            '</span>'
          : '') +
        '</div>' +
        (t.remarks ? '<p class="tkl-remarks">' + esc(t.remarks) + '</p>' : '') +
        '<div class="tkl-ctrl">' +
        '<label class="tkl-range"><span class="sr-only">Progress</span><input type="range" min="0" max="100" step="5" value="' +
        t.percentComplete +
        '" data-lane-pct aria-label="Progress for ' +
        esc(t.title) +
        '"><span class="tkl-pct" data-lane-pct-label>' +
        t.percentComplete +
        '%</span></label>' +
        '<select data-lane-status aria-label="Status for ' +
        esc(t.title) +
        '">' +
        options(STATUSES, Roi.STATUS_LABELS, t.status) +
        '</select>' +
        '<button type="button" class="tkl-go" data-lane-open>Open' +
        icon('chevron') +
        '</button></div></article>'
      );
    }
    function laneDraw() {
      const host = lane.host;
      if (!host) return;
      if (lane.error) {
        host.innerHTML = '<p class="kb-empty">' + esc(lane.error) + '</p>';
        return;
      }
      const open = lane.tasks.filter(
        (t) => !t.archivedAt && (t.status === 'in_progress' || t.status === 'not_started'),
      );
      const withStart = open.map(pendingDays).filter((d) => d !== null && d >= 0);
      const late = withStart.filter((d) => d > LANE_LATE).length;
      const avg = withStart.length
        ? Math.round(withStart.reduce((a, b) => a + b, 0) / withStart.length)
        : null;
      const onHold = lane.tasks.filter((t) => !t.archivedAt && t.status === 'on_hold').length;
      host.innerHTML =
        '<div class="tkl-head"><div><h3>My tasks</h3><p>In-progress and not-started work from your ROI task list. Change status or progress right here; open a card for the full task.</p></div>' +
        '<div class="tkl-stats"><span><b>' +
        open.length +
        '</b> open</span>' +
        (avg !== null ? '<span><b>' + avg + 'd</b> avg pending</span>' : '') +
        (late ? '<span class="tkl-late"><b>' + late + '</b> over ' + LANE_LATE + 'd</span>' : '') +
        (onHold ? '<span><b>' + onHold + '</b> on hold</span>' : '') +
        '</div><button type="button" class="button button-outline tk-btn" data-lane-page>All tasks' +
        icon('chevron') +
        '</button></div>' +
        (lane.note ? '<p class="tkl-note" role="status">' + esc(lane.note) + '</p>' : '') +
        '<div class="tkl-board">' +
        LANE_COLS.map(([status, label, hint]) => {
          const cards = lane.tasks.filter((t) => t.status === status && laneVisible(t));
          cards.sort((a, b) => (pendingDays(b) ?? -999) - (pendingDays(a) ?? -999));
          return (
            '<section class="kb-col tkl-col" data-lane-col="' +
            status +
            '" style="--col:' +
            (status === 'in_progress' ? '#2563eb' : '#94a3b8') +
            '" aria-label="' +
            esc(label) +
            '"><div class="kb-col-head"><div class="kb-col-title"><span>' +
            esc(label) +
            '</span><span class="kb-count">' +
            cards.length +
            '</span></div><div class="kb-col-meta">' +
            esc(hint) +
            ' &middot; longest pending first</div></div><div class="kb-list">' +
            (cards.length
              ? cards.map(laneCard).join('')
              : '<p class="kb-empty">No tasks here. Drop a card to move it.</p>') +
            '</div></section>'
          );
        }).join('') +
        '</div>';
    }
    async function lanePatch(id, body, doneNote) {
      try {
        const { task } = await deps.apiRequest('/api/roi/tasks/' + id, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        const i = lane.tasks.findIndex((t) => t.id === id);
        if (i >= 0) lane.tasks[i] = task;
        replaceTask(task);
        lane.note =
          task.status === 'completed'
            ? '"' + task.title + '" is complete and has moved to the Result of your ROI.'
            : doneNote || '';
        if (task.status === 'completed') window.setTimeout(() => askCompletionRemarks(task), 0);
      } catch (error) {
        lane.note = error.message || 'Could not update the task.';
      }
      laneDraw();
    }
    function laneWire(host) {
      if (host.dataset.laneWired) return;
      host.dataset.laneWired = '1';
      let dragId = null;
      host.addEventListener('click', (e) => {
        if (e.target.closest('[data-lane-page]')) return deps.openTask && deps.openTask(null);
        const open = e.target.closest('[data-lane-open]');
        const card = e.target.closest('[data-lane-id]');
        if (open && card && deps.openTask) deps.openTask(card.dataset.laneId);
      });
      host.addEventListener('input', (e) => {
        if (!e.target.matches('[data-lane-pct]')) return;
        const label = e.target.closest('.tkl-range').querySelector('[data-lane-pct-label]');
        label.textContent = e.target.value + '%';
      });
      host.addEventListener('change', (e) => {
        const card = e.target.closest('[data-lane-id]');
        if (!card) return;
        if (e.target.matches('[data-lane-pct]'))
          lanePatch(card.dataset.laneId, { percentComplete: Number(e.target.value) });
        else if (e.target.matches('[data-lane-status]'))
          lanePatch(card.dataset.laneId, { status: e.target.value });
      });
      host.addEventListener('dragstart', (e) => {
        const card = e.target.closest('[data-lane-id]');
        if (!card) return;
        dragId = card.dataset.laneId;
        card.classList.add('tk-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dragId);
      });
      host.addEventListener('dragend', () => {
        dragId = null;
        host
          .querySelectorAll('.tk-dragging, .tkl-over')
          .forEach((el) => el.classList.remove('tk-dragging', 'tkl-over'));
      });
      host.addEventListener('dragover', (e) => {
        const col = e.target.closest('[data-lane-col]');
        if (!col || !dragId) return;
        e.preventDefault();
        host
          .querySelectorAll('.tkl-over')
          .forEach((el) => el !== col && el.classList.remove('tkl-over'));
        col.classList.add('tkl-over');
      });
      host.addEventListener('drop', (e) => {
        const col = e.target.closest('[data-lane-col]');
        if (!col || !dragId) return;
        e.preventDefault();
        const id = dragId;
        dragId = null;
        const task = lane.tasks.find((t) => t.id === id);
        if (task && task.status !== col.dataset.laneCol)
          lanePatch(
            id,
            { status: col.dataset.laneCol },
            'Moved to ' + statusLabel(col.dataset.laneCol) + '.',
          );
        else laneDraw();
      });
    }
    // opts: { refresh } reload from the server; { q } search text from the board toolbar.
    async function renderBoardLane(host, opts) {
      opts = opts || {};
      lane.host = host;
      if (opts.q !== undefined) lane.q = String(opts.q || '').toLowerCase();
      laneWire(host);
      if (opts.refresh || !lane.loaded) {
        try {
          const data = await deps.apiRequest('/api/roi/tasks');
          lane.tasks = data.tasks;
          lane.error = '';
          lane.loaded = true;
        } catch (error) {
          lane.error = error.message || 'Could not load your tasks.';
        }
      }
      laneDraw();
    }

    return { renderPage, openComposer, openTask, renderBoardLane };
  }

  window.JdTasks = { create };
})();
