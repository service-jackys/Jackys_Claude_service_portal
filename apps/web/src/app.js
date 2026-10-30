(() => {
  'use strict';

  let authToken = null;
  let currentUser = null;
  // The staff session token is kept in sessionStorage (not localStorage) so
  // a page refresh doesn't force a fresh sign-in, while still clearing
  // automatically when the tab/browser is closed -- matching what "session"
  // implies. The server independently expires the underlying session after
  // a fixed window regardless of activity (see SESSION_TTL_MS in
  // apps/api/src/auth/local-auth.ts, currently 8 hours), so a stale token
  // left over from a closed tab/private window can't be replayed forever
  // even if a copy of it somehow persisted. Wrapped in try/catch because
  // storage access can throw in some private-browsing contexts.
  const SESSION_STORAGE_KEY = 'jackys-service-portal:authToken';
  function getStoredToken() {
    try {
      return sessionStorage.getItem(SESSION_STORAGE_KEY);
    } catch {
      return null;
    }
  }
  function saveStoredToken(token) {
    try {
      sessionStorage.setItem(SESSION_STORAGE_KEY, token);
    } catch {
      // Non-fatal -- the user just won't survive a refresh this session.
    }
  }
  function clearStoredToken() {
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Non-fatal.
    }
  }

  // Theme (light/dark) and color-palette preference (Modification #25).
  // Unlike the auth token above, this is a non-sensitive per-user display
  // preference that should survive across browser restarts, so it belongs
  // in localStorage rather than sessionStorage. A small inline script in
  // index.html's <head> reads the same two keys and applies them before
  // first paint, so the page never flashes the default look first.
  const THEME_STORAGE_KEY = 'jackys-service-portal:theme';
  const PALETTE_STORAGE_KEY = 'jackys-service-portal:palette';
  const VALID_PALETTES = ['navy', 'emerald', 'indigo', 'teal', 'amber'];

  function getStoredTheme() {
    try {
      const value = localStorage.getItem(THEME_STORAGE_KEY);
      return value === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  }
  function getStoredPalette() {
    try {
      const value = localStorage.getItem(PALETTE_STORAGE_KEY);
      return VALID_PALETTES.includes(value) ? value : 'navy';
    } catch {
      return 'navy';
    }
  }
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Non-fatal -- the choice just won't be remembered next visit.
    }
    const button = document.getElementById('themeToggleButton');
    const icon = document.getElementById('themeToggleIcon');
    if (button) {
      button.setAttribute(
        'aria-label',
        theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
      );
    }
    if (icon) {
      icon.textContent = theme === 'dark' ? '\u2600' : '\u263D';
    }
  }
  function applyPalette(palette) {
    document.documentElement.setAttribute('data-palette', palette);
    try {
      localStorage.setItem(PALETTE_STORAGE_KEY, palette);
    } catch {
      // Non-fatal.
    }
    document.querySelectorAll('.palette-swatch').forEach((swatch) => {
      swatch.setAttribute('aria-current', String(swatch.dataset.palette === palette));
    });
  }
  function initThemeAndPaletteControls() {
    applyTheme(getStoredTheme());
    applyPalette(getStoredPalette());

    const themeButton = document.getElementById('themeToggleButton');
    if (themeButton) {
      themeButton.addEventListener('click', () => {
        const next =
          document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        applyTheme(next);
      });
    }

    const paletteButton = document.getElementById('paletteToggleButton');
    const palettePopover = document.getElementById('palettePopover');
    if (paletteButton && palettePopover) {
      paletteButton.addEventListener('click', (event) => {
        event.stopPropagation();
        const isHidden = palettePopover.hidden;
        palettePopover.hidden = !isHidden;
        paletteButton.setAttribute('aria-expanded', String(isHidden));
      });
      palettePopover.querySelectorAll('.palette-swatch').forEach((swatch) => {
        swatch.addEventListener('click', () => {
          applyPalette(swatch.dataset.palette);
          palettePopover.hidden = true;
          paletteButton.setAttribute('aria-expanded', 'false');
        });
      });
      document.addEventListener('click', (event) => {
        if (!palettePopover.hidden && !palettePopover.contains(event.target)) {
          palettePopover.hidden = true;
          paletteButton.setAttribute('aria-expanded', 'false');
        }
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !palettePopover.hidden) {
          palettePopover.hidden = true;
          paletteButton.setAttribute('aria-expanded', 'false');
        }
      });
    }
  }

  // Account menu in the top bar (Modification #25 follow-up) -- the same
  // open/close-on-outside-click/Escape pattern as the palette popover above,
  // for the avatar button that now holds the profile info and sign-out link
  // that used to live in the sidebar.
  function initUserMenu() {
    const menuButton = document.getElementById('userMenuButton');
    const menuPopover = document.getElementById('userMenuPopover');
    if (!menuButton || !menuPopover) return;
    menuButton.addEventListener('click', (event) => {
      event.stopPropagation();
      const isHidden = menuPopover.hidden;
      menuPopover.hidden = !isHidden;
      menuButton.setAttribute('aria-expanded', String(isHidden));
    });
    document.addEventListener('click', (event) => {
      if (
        !menuPopover.hidden &&
        !menuPopover.contains(event.target) &&
        event.target !== menuButton
      ) {
        menuPopover.hidden = true;
        menuButton.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !menuPopover.hidden) {
        menuPopover.hidden = true;
        menuButton.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // Collapsible sidebar (Modification #25 follow-up) -- toggled on the
  // <html> element (not <body>) so the choice can be read and applied by a
  // tiny inline script in index.html's <head> before first paint, the same
  // reason the theme/palette choice above lives on <html> rather than
  // <body>. Persisted per browser, same pattern as theme/palette.
  const SIDEBAR_STORAGE_KEY = 'jackys-service-portal:sidebarCollapsed';

  function applySidebarCollapsed(collapsed) {
    document.documentElement.classList.toggle('sidebar-collapsed', collapsed);
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      // Non-fatal.
    }
    const button = document.getElementById('sidebarToggleButton');
    if (button) {
      button.setAttribute('aria-expanded', String(!collapsed));
      button.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
      button.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    }
  }
  function initSidebarToggle() {
    const button = document.getElementById('sidebarToggleButton');
    if (!button) return;
    applySidebarCollapsed(document.documentElement.classList.contains('sidebar-collapsed'));
    button.addEventListener('click', () => {
      applySidebarCollapsed(!document.documentElement.classList.contains('sidebar-collapsed'));
    });
  }

  // Sidebar groups (Service desk, Records, ...) work as an accordion: only one group
  // is open at a time. Opening a group, or moving to a page in another group, closes
  // the rest. The open group is remembered per browser, and a group whose items are
  // all hidden by permissions disappears.
  const NAV_GROUPS_STORAGE_KEY = 'jackys-service-portal:navGroups';

  function initNavGroups() {
    const links = document.querySelector('.dashboard-links');
    const groups = Array.from(document.querySelectorAll('.nav-group'));
    if (!links || !groups.length) return;
    let savedOpen = '';
    try {
      const raw = JSON.parse(localStorage.getItem(NAV_GROUPS_STORAGE_KEY) || '{}') || {};
      savedOpen = typeof raw.open === 'string' ? raw.open : '';
    } catch {
      savedOpen = '';
    }
    const remember = (slug) => {
      try {
        localStorage.setItem(NAV_GROUPS_STORAGE_KEY, JSON.stringify({ open: slug }));
      } catch {
        // Non-fatal.
      }
    };
    const openOnly = (target) => groups.forEach((group) => setOpen(group, group === target));
    const setOpen = (group, open) => {
      group.classList.toggle('is-collapsed', !open);
      group.querySelector('.nav-group-toggle').setAttribute('aria-expanded', String(open));
      applyInert(group);
    };
    // Items of a closed group leave the tab order, except in the icon-only sidebar,
    // which always shows every item.
    const applyInert = (group) => {
      const iconOnly = document.documentElement.classList.contains('sidebar-collapsed');
      group
        .querySelector('.nav-group-items')
        .toggleAttribute('inert', group.classList.contains('is-collapsed') && !iconOnly);
    };
    new MutationObserver(() => groups.forEach(applyInert)).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    const startSlug = groups.some((g) => g.dataset.navGroup === savedOpen)
      ? savedOpen
      : 'service-desk';
    groups.forEach((group) => setOpen(group, group.dataset.navGroup === startSlug));
    groups.forEach((group) => {
      const slug = group.dataset.navGroup;
      group.querySelector('.nav-group-toggle').addEventListener('click', () => {
        if (group.classList.contains('is-collapsed')) {
          openOnly(group);
          remember(slug);
        } else {
          setOpen(group, false);
          remember('');
        }
      });
    });
    let lastCurrent = null;
    const sync = () => {
      const current = links.querySelector('.dashboard-link[aria-current="page"]');
      const currentId = current ? current.id : null;
      groups.forEach((group) => {
        const anyVisible = Array.from(group.querySelectorAll('.dashboard-link')).some(
          (item) => !item.hidden,
        );
        group.classList.toggle('is-hidden', !anyVisible);
        const hasCurrent = Boolean(current && group.contains(current));
        group.classList.toggle('has-current', hasCurrent);
        if (hasCurrent && currentId !== lastCurrent) {
          openOnly(group);
          remember(group.dataset.navGroup);
        }
      });
      lastCurrent = currentId;
    };
    new MutationObserver(sync).observe(links, {
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden', 'aria-current'],
    });
    sync();
  }

  let currentComplaintId = null;
  let currentAppointmentId = null;
  let currentAppointment = null;
  let pendingInvoiceJobId = null;
  let currentJobCardId = null;
  let currentJobCard = null;
  let lastLoadedJobCards = [];
  let workspaceMode = 'complaints';
  let availabilityRequestSequence = 0;
  let calendarView = 'month';
  let calendarCursor = new Date();
  let calendarAppointments = [];
  let calendarRequestSequence = 0;
  let workspaceRetryAction = null;
  let currentComplaintB2bBranchCustCode = null;
  let b2bBranchSearchSequence = 0;
  let b2bBranchSearchDebounce = null;
  let salesmenOptions = [];
  let salesChannelOptions = [];
  let scheduleB2bBranchSearchSequence = 0;
  let scheduleB2bBranchSearchDebounce = null;

  // Manual moves only. Scheduled (appointment booked) and Closed (appointment
  // completed) are set by the system and are deliberately not listed here.
  const complaintTransitions = {
    New: ['Under Review', 'Cancelled'],
    'Under Review': ['Ready for Scheduling', 'Pending Information', 'Cancelled'],
    'Pending Information': ['Under Review', 'Ready for Scheduling', 'Cancelled'],
    'Ready for Scheduling': ['Cancelled'],
    Scheduled: ['Ready for Scheduling', 'Cancelled'],
    Closed: [],
    Cancelled: [],
  };
  const COMPLAINT_STATUS_HINTS = {
    'Under Review': 'Staff are checking the details and the warranty classification.',
    'Pending Information':
      'Waiting for the customer to send something missing, for example the invoice.',
    'Ready for Scheduling':
      'Everything needed is in. Next you book a date and a technician in the Schedule appointment tab.',
    Cancelled: 'Ends the complaint without service. This cannot be undone.',
  };
  const WORKFLOW_STAGE_TIPS = [
    'Register and review the complaint, check the warranty and collect any missing information.',
    'Book a date and an available technician. The complaint becomes Scheduled automatically.',
    'Created from the completed appointment: record the work done, parts and costs.',
    'Closed automatically once the appointment and job card are completed.',
  ];
  const appointmentTransitions = {
    Scheduled: ['In Progress', 'Cancelled'],
    'In Progress': ['Completed', 'Cancelled'],
    Completed: [],
    Cancelled: [],
  };
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  // Help text is shown as an (i) tooltip next to the label or heading it
  // explains, never as a line of text on the page. `text` is trusted static
  // markup (entities such as &amp; are fine).
  function tipHtml(text, wrapperAttrs = '', bubbleAttrs = '') {
    return `<span class="tooltip" tabindex="0" ${wrapperAttrs}><span class="tooltip-icon" aria-hidden="true">i</span><span class="tooltip-bubble" role="tooltip" ${bubbleAttrs}>${text}</span></span>`;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(
      /[&<>'"]/g,
      (character) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character],
    );
  }

  // Toast-style feedback for every staff action (save notes, update status,
  // schedule, etc. -- see modification.md #3). `kind` is one of:
  //   true      -- success (green, auto-dismisses after a few seconds)
  //   undefined -- error / neutral (red, stays until replaced or cleared)
  //   false     -- hide/clear the toast now
  // This keeps every existing call site's meaning: `setMessage(sel, msg)` was
  // already "show an error-ish message", `setMessage(sel, msg, true)` was
  // already "show a success message", and `setMessage(sel, '', false)` was
  // already "clear it" -- only the visual presentation changes.
  const messageDismissTimers = new Map();

  function setMessage(selector, message, kind) {
    const element = $(selector);
    if (messageDismissTimers.has(selector)) {
      clearTimeout(messageDismissTimers.get(selector));
      messageDismissTimers.delete(selector);
    }
    const isSuccess = kind === true;
    const visible = kind !== false && Boolean(message);
    element.textContent = message || '';
    element.hidden = !visible;
    element.classList.toggle('notice-success', isSuccess);
    element.classList.toggle('notice-error', !isSuccess);
    if (visible && isSuccess) {
      messageDismissTimers.set(
        selector,
        setTimeout(() => {
          element.hidden = true;
          messageDismissTimers.delete(selector);
        }, 4000),
      );
    }
  }

  function clearErrors(scope) {
    scope.querySelectorAll('.field-error').forEach((element) => {
      element.textContent = '';
    });
    scope.querySelectorAll('[aria-invalid="true"]').forEach((element) => {
      element.removeAttribute('aria-invalid');
    });
  }

  function showFieldError(scope, fieldId, message) {
    const field = scope.querySelector('#' + fieldId);
    const error = scope.querySelector('[data-error-for="' + fieldId + '"]');
    if (field) field.setAttribute('aria-invalid', 'true');
    if (error) error.textContent = message;
  }

  function formDataObject(form) {
    // Optional fields left blank must be OMITTED, not sent as "" — every
    // optional string field on the server's Zod schemas is `.optional()`
    // (undefined allowed) but still `.min(1)` when present, so an empty
    // string fails validation instead of being treated as "not provided".
    // This was already true for the pre-existing optional fields (address,
    // region, brand, model, serialOrItemCode, customerEmail) before the
    // B2B/school fields were added here — fixed once, for all of them.
    return Object.fromEntries(
      [...new FormData(form)]
        .map(([key, value]) => [key, String(value).trim()])
        .filter(([, value]) => value !== ''),
    );
  }

  async function apiRequest(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !headers.has('content-type'))
      headers.set('content-type', 'application/json');
    if (authToken) headers.set('authorization', 'Bearer ' + authToken);
    const response = await fetch(url, { ...options, headers });
    let body = null;
    if (response.status !== 204) {
      try {
        body = await response.json();
      } catch {
        body = null;
      }
    }
    if (!response.ok) {
      const error = new Error(body?.detail || body?.title || 'The request could not be completed.');
      error.status = response.status;
      throw error;
    }
    return body;
  }

  async function apiBlobRequest(url) {
    const headers = new Headers();
    if (authToken) headers.set('authorization', 'Bearer ' + authToken);
    const response = await fetch(url, { headers });
    if (!response.ok) {
      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      const error = new Error(body?.detail || body?.title || 'The request could not be completed.');
      error.status = response.status;
      throw error;
    }
    return response.blob();
  }

  // multipart/form-data upload -- deliberately not routed through
  // apiRequest(), which always sets Content-Type: application/json when a
  // body is present; a FormData body needs the browser to set its own
  // multipart boundary in that header instead.
  async function apiUploadRequest(url, formData) {
    const headers = new Headers();
    if (authToken) headers.set('authorization', 'Bearer ' + authToken);
    const response = await fetch(url, { method: 'POST', headers, body: formData });
    let body = null;
    if (response.status !== 204) {
      try {
        body = await response.json();
      } catch {
        body = null;
      }
    }
    if (!response.ok) {
      const error = new Error(body?.detail || body?.title || 'The request could not be completed.');
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function setBusy(button, busy, label) {
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.disabled = busy;
    button.textContent = busy ? label : button.dataset.label;
  }

  // ---------- Workflow pipeline stepper ----------
  // Shows a contextual "Complaint -> Scheduling -> Job Card -> Completion"
  // stepper on a detail view, highlighting the current stage. Cancelled
  // records show a dedicated cancelled marker instead of a stage.
  const WORKFLOW_STAGES = ['Complaint', 'Scheduling', 'Job Card', 'Completion'];

  function workflowStageForComplaintStatus(status) {
    switch (status) {
      case 'New':
      case 'Under Review':
      case 'Pending Information':
        return 0;
      case 'Ready for Scheduling':
      case 'Scheduled':
        return 1;
      case 'Closed':
        return 3;
      case 'Cancelled':
        return -1;
      default:
        return 0;
    }
  }

  function workflowStageForAppointmentStatus(status) {
    switch (status) {
      case 'Scheduled':
        return 1;
      case 'In Progress':
        return 2;
      case 'Completed':
        return 3;
      case 'Cancelled':
        return -1;
      default:
        return 1;
    }
  }

  function workflowStageForJobCardStatus(status) {
    switch (status) {
      case 'Open':
      case 'In Progress':
        return 2;
      case 'Completed':
        return 3;
      case 'Cancelled':
        return -1;
      default:
        return 2;
    }
  }

  function renderWorkflowStepper(elementId, stageIndex) {
    const container = $('#' + elementId);
    if (!container) return;
    if (stageIndex < 0) {
      container.hidden = false;
      container.innerHTML =
        '<div class="stepper-item is-cancelled"><span class="stepper-dot" aria-hidden="true">&times;</span><span class="stepper-label">Cancelled</span></div>';
      return;
    }
    container.hidden = false;
    container.innerHTML = WORKFLOW_STAGES.map((label, index) => {
      const state = index < stageIndex ? 'is-done' : index === stageIndex ? 'is-current' : '';
      const dot = index < stageIndex ? '&#10003;' : String(index + 1);
      const connector =
        index < WORKFLOW_STAGES.length - 1
          ? '<span class="stepper-connector" aria-hidden="true"></span>'
          : '';
      return `<div class="stepper-item ${state}" title="${escapeHtml(WORKFLOW_STAGE_TIPS[index] || '')}"><span class="stepper-dot" aria-hidden="true">${dot}</span><span class="stepper-label">${escapeHtml(label)}</span></div>${connector}`;
    }).join('');
  }

  // Clickable Complaint -> Appointment -> Job card trail (and back) -- see
  // modification.md #5. `links` is an ordered array of
  // { label, onClick } -- onClick should switch workspace mode and open the
  // target record's detail.
  function renderWorkflowLinks(elementId, links) {
    const container = $('#' + elementId);
    if (!container) return;
    if (!links.length) {
      container.hidden = true;
      container.innerHTML = '';
      return;
    }
    container.hidden = false;
    container.innerHTML = links
      .map(
        (link, index) =>
          `<button type="button" class="workflow-link-chip" data-link-index="${index}">${escapeHtml(link.label)}</button>`,
      )
      .join('<span class="workflow-link-sep" aria-hidden="true">→</span>');
    container.querySelectorAll('[data-link-index]').forEach((button) => {
      button.addEventListener('click', () => links[Number(button.dataset.linkIndex)].onClick());
    });
  }

  function selectAuthTab(tab) {
    const login = tab === 'login';
    $('#loginTab').setAttribute('aria-selected', String(login));
    $('#bootstrapTab').setAttribute('aria-selected', String(!login));
    $('#loginPanel').hidden = !login;
    $('#bootstrapPanel').hidden = login;
    setMessage('#authMessage', '', false);
  }
  $('#loginTab').addEventListener('click', () => selectAuthTab('login'));
  $('#bootstrapTab').addEventListener('click', () => selectAuthTab('bootstrap'));

  // Password rule (modification #148): 10+ characters, first one a capital
  // letter, with at least one number and one symbol.
  const PASSWORD_RULE_TEXT =
    'Use at least 10 characters: a capital letter first, then include a number and a symbol.';
  function isStrongPassword(value) {
    return (
      typeof value === 'string' &&
      value.length >= 10 &&
      /^[A-Z]/.test(value) &&
      /\d/.test(value) &&
      /[^A-Za-z0-9\s]/.test(value)
    );
  }

  function checkPasswordField(form, id, value) {
    if (isStrongPassword(value)) return true;
    showFieldError(form, id, PASSWORD_RULE_TEXT);
    return false;
  }

  function validateAuthForm(form, fields) {
    clearErrors(form);
    let valid = true;
    fields.forEach(([id, message]) => {
      if (!$('#' + id).value.trim()) {
        showFieldError(form, id, message);
        valid = false;
      }
    });
    return valid;
  }

  function showWorkspaceForCurrentUser(scrollIntoView) {
    $('#authCard').hidden = true;
    $('#staff-access').hidden = true;
    $('#staff-workspace').hidden = false;
    // Signed-in staff get the full-page app-shell layout (see the
    // "Modification #24" CSS block in index.html) instead of the public
    // marketing page it's the reverse of on sign-out.
    document.body.classList.add('is-authenticated');
    renderUser();
    loadMasterDataOptions();
    // Signed-in users always land on the dashboard when they can see it.
    if (
      hasPermission('dashboard.read') &&
      (hasPermission('complaints.read') ||
        hasPermission('appointments.read') ||
        hasPermission('service_job_card.read'))
    ) {
      setWorkspaceMode('dashboard');
    } else if (hasPermission('appointments.read') && !hasPermission('complaints.read')) {
      setWorkspaceMode('appointments');
    } else if (hasPermission('complaints.read')) {
      setWorkspaceMode('complaints');
    } else if (hasPermission('service_job_card.read')) {
      setWorkspaceMode('job-cards');
    } else {
      showNoWorkspaceAccess();
    }
    openChatFromLink();
    if (scrollIntoView) {
      $('#staff-workspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // ?chat=<id> comes from a notification click; ?chatPopout=1 is the pop-out window.
  function openChatFromLink() {
    if (!hasPermission('chat.use')) return;
    const params = new URLSearchParams(location.search);
    const popout = params.has('chatPopout');
    const chatId = params.get('chat');
    if (!popout && !chatId) return;
    if (popout) document.body.classList.add('chat-popout');
    pendingChatOpen = chatId;
    setWorkspaceMode('chat');
    history.replaceState(null, '', location.pathname + (popout ? '?chatPopout=1' : ''));
  }

  async function establishSession(result) {
    authToken = result.token;
    saveStoredToken(authToken);
    const session = await apiRequest('/api/auth/me');
    currentUser = session.user;
    if (currentUser.mustChangePassword) {
      openPasswordDialog(true);
      return;
    }
    showWorkspaceForCurrentUser(true);
  }

  // Runs once at page load. If a session token survived from before this
  // refresh (see SESSION_STORAGE_KEY above), try to resume it instead of
  // showing the sign-in form. A token that's since expired or been revoked
  // (server restart, logout elsewhere, past the session's fixed lifetime)
  // just falls through to the ordinary sign-in screen -- no error shown,
  // since "please sign in again" is the expected, unremarkable outcome
  // here, not a failure.
  async function restoreSession() {
    if (new URLSearchParams(location.search).has('chatPopout')) adoptPopoutToken();
    const token = getStoredToken();
    if (!token) return;
    authToken = token;
    // Hide the sign-in form immediately rather than flashing it before the
    // session check comes back -- most refreshes resolve this in one quick
    // round trip.
    $('#staff-access').hidden = true;
    try {
      const session = await apiRequest('/api/auth/me');
      currentUser = session.user;
      if (currentUser.mustChangePassword) {
        openPasswordDialog(true);
        return;
      }
      showWorkspaceForCurrentUser(false);
    } catch {
      authToken = null;
      clearStoredToken();
      $('#staff-access').hidden = false;
    }
  }

  $('#loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    setMessage('#authMessage', '', false);
    if (
      !validateAuthForm(form, [
        ['loginEmail', 'Enter your email address.'],
        ['loginPassword', 'Enter your password.'],
      ])
    )
      return;
    const button = $('#loginButton');
    setBusy(button, true, 'Signing in…');
    try {
      await establishSession(
        await apiRequest('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify(formDataObject(form)),
        }),
      );
    } catch (error) {
      authToken = null;
      setMessage('#authMessage', error.message);
    } finally {
      setBusy(button, false);
    }
  });

  $('#bootstrapForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    setMessage('#authMessage', '', false);
    if (
      !validateAuthForm(form, [
        ['bootstrapToken', 'Enter the bootstrap token.'],
        ['bootstrapName', 'Enter the administrator name.'],
        ['bootstrapEmail', 'Enter an email address.'],
        ['bootstrapPassword', PASSWORD_RULE_TEXT],
      ]) ||
      !checkPasswordField(form, 'bootstrapPassword', $('#bootstrapPassword').value)
    )
      return;
    const button = $('#bootstrapButton');
    setBusy(button, true, 'Creating…');
    try {
      await establishSession(
        await apiRequest('/api/auth/bootstrap', {
          method: 'POST',
          body: JSON.stringify(formDataObject(form)),
        }),
      );
    } catch (error) {
      authToken = null;
      setMessage('#authMessage', error.message);
    } finally {
      setBusy(button, false);
    }
  });

  function hasPermission(permission) {
    return (
      currentUser?.permissions?.includes('*') || currentUser?.permissions?.includes(permission)
    );
  }

  function renderUser() {
    const name = currentUser?.name || 'Staff user';
    $('#userAvatar').textContent = name.charAt(0).toUpperCase();
    $('#userName').textContent = name;
    $('#userEmail').textContent = currentUser?.email || '';
    $('#userRole').textContent = currentUser?.role || 'Staff';
    const canReadComplaints = hasPermission('complaints.read');
    $('#complaintsNav').hidden = !canReadComplaints;
    $('#serviceRequestsNav').hidden = !canReadComplaints;
    $('#jobCardsNav').hidden = !hasPermission('service_job_card.read');
    $('#quotationsNav').hidden = !hasPermission('quotation.read');
    $('#inspectionsNav').hidden = !hasPermission('inspection.read');
    $('#warrantyApprovalsNav').hidden = !hasPermission('warranty_approval.read');
    $('#dashboardNav').hidden = !hasPermission('dashboard.read');
    $('#appointmentsNav').hidden = !hasPermission('appointments.read');
    $('#techniciansNav').hidden = !hasPermission('technicians.read');
    $('#teamAccountsNav').hidden = !hasPermission('admin.users');
    $('#newRequestNav').hidden = !hasPermission('appointments.write');
    $('#masterDataNav').hidden = !hasPermission('salesmen.write');
    const canReadPricingConfig = hasPermission('pricing_config.read');
    $('#vasAdminNav').hidden = !canReadPricingConfig;
    $('#rateCardAdminNav').hidden = !canReadPricingConfig;
    $('#dandiAdminNav').hidden = !canReadPricingConfig;
    $('#amcAdminNav').hidden = !canReadPricingConfig;
    $('#thomsonAdminNav').hidden = !canReadPricingConfig;
    // Quote calculators have their own permission (#114); the API lets it read
    // only the rate data the calculators use.
    const canUseCalculators = hasPermission('quote_calculators.use');
    $('#vasCalcNav').hidden = !canUseCalculators;
    $('#amcCalcNav').hidden = !canUseCalculators;
    $('#thomsonCalcNav').hidden = !canUseCalculators;
    const canReadRevenue = hasPermission('revenue_dashboard.read');
    $('#revenueDashNav').hidden = !revenueTabs().length;
    $('#budgetDashNav').hidden = !hasPermission('revenue_dashboard.budget_actual');
    $('#budgetVarNav').hidden = !hasPermission('revenue_dashboard.budget_variance');
    $('#financeNav').hidden = !financeMembers().length;
    $('#pricingMastersNav').hidden = !canReadPricingConfig;
    $('#reportsNav').hidden = !hasPermission('reports.read');
    $('#tasksNav').hidden = !hasPermission('tasks.use');
    const canChat = hasPermission('chat.use');
    $('#chatNav').hidden = !canChat;
    ['discussJobCardButton', 'discussAppointmentButton', 'discussComplaintButton'].forEach((id) => {
      const button = document.getElementById(id);
      if (button) button.hidden = !canChat;
    });
    if (canChat && window.JdChat) getChatUi().startBadge();
    else if (chatUi) chatUi.stopBadge();
    $('#rateCardNav').hidden = !hasPermission('rate_card.view');
    $('#activityLogNav').hidden = !hasPermission('audit.read');
    $('#rolesNav').hidden = !hasPermission('admin.users');
    $('#changelogNav').hidden = !hasPermission('admin.users');
    $('#mastersNav').hidden = !(hasPermission('stock.write') || hasPermission('b2b_master.write'));
    $('#walkInNav').hidden = !hasPermission('service_job_card.write');
    $('#awaitingDraftsNav').hidden = !hasPermission('scheduler.read');
    $('#dailyListNav').hidden = !hasPermission('appointments.read');
    $('#deliveryInstallNav').hidden = !hasPermission('di_jobs.read');
    $('#invoicesNav').hidden = !hasPermission('invoices.read');
    $('#billingNav').hidden = !hasPermission('billing.read');
    if (hasPermission('scheduler.read')) {
      apiRequest('/api/schedules/awaiting')
        .then((result) => {
          const badge = $('#awaitingDraftsCount');
          badge.textContent = String(result.drafts.length);
          badge.hidden = !result.drafts.length;
        })
        .catch(() => {});
    }
  }

  function showNoWorkspaceAccess() {
    workspaceMode = 'none';
    $('#complaintsNav').setAttribute('aria-current', 'false');
    $('#serviceRequestsNav').setAttribute('aria-current', 'false');
    $('#appointmentsNav').setAttribute('aria-current', 'false');
    $('#jobCardsNav').setAttribute('aria-current', 'false');
    $('#complaintWorkspace').hidden = true;
    $('#appointmentWorkspace').hidden = true;
    $('#jobCardWorkspace').hidden = true;
    $('#refreshComplaintsButton').hidden = true;
    $('#refreshAppointmentsButton').hidden = true;
    $('#refreshJobCardsButton').hidden = true;
    $('#workspace-heading').textContent = 'No workspace access';
    $('#workspaceDescription').textContent =
      'Your account does not have permission to open a service workspace.';
    setMessage(
      '#workspaceMessage',
      'Ask an administrator to grant the required workspace permission.',
    );
  }

  // ---- Way back (modification #165) ------------------------------------
  // A link inside one page that opens another page (Billing -> a Delivery &
  // Installation job, a job card -> its complaint, ...) remembers where the
  // user came from and shows "Back to <page>" at the top of the new page.
  // Only a click inside the page content counts; the sidebar starts a fresh trail.
  const navTrail = [];
  const pageMemo = {};
  let returningFromLink = false;
  const lastClick = { content: false, at: 0 };
  document.addEventListener(
    'click',
    (event) => {
      lastClick.content = !!(event.target.closest && event.target.closest('.dashboard-content'));
      lastClick.at = Date.now();
    },
    true,
  );
  function currentPageLabel() {
    const active = document.querySelector('.dashboard-nav [aria-current="page"]');
    if (!active) return '';
    const label = active.querySelector('.nav-label');
    const text = label
      ? label.textContent
      : active.getAttribute('aria-label') || active.textContent;
    return text
      .replace(/\s+/g, ' ')
      .replace(/\s*[→›]+\s*$/, '')
      .trim();
  }
  function goBackTo(level) {
    // level = index in navTrail of the page to return to; the pages after it are dropped.
    const target = navTrail[level];
    if (!target) return;
    navTrail.length = level;
    returningFromLink = true;
    try {
      activateWorkspaceMode(target.mode);
    } finally {
      returningFromLink = false;
    }
    drawReturnBar();
    window.scrollTo({ top: 0 });
  }
  function drawReturnBar() {
    const bar = document.getElementById('returnBar');
    if (!bar) return;
    bar.hidden = navTrail.length === 0;
    if (!navTrail.length) {
      bar.innerHTML = '';
      return;
    }
    const top = navTrail[navTrail.length - 1];
    bar.innerHTML =
      '<button type="button" class="return-back" data-return-level="' +
      (navTrail.length - 1) +
      '" title="Back to ' +
      escapeHtml(top.label) +
      '"><svg class="return-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" /></svg><span>Back to ' +
      escapeHtml(top.label) +
      '</span></button>' +
      '<nav class="return-crumbs" aria-label="Where you came from"><ol>' +
      navTrail
        .map(
          (t, index) =>
            '<li><button type="button" data-return-level="' +
            index +
            '">' +
            escapeHtml(t.label) +
            '</button></li>',
        )
        .join('') +
      '<li aria-current="page"><span>' +
      escapeHtml(currentPageLabel() || 'This page') +
      '</span></li></ol></nav>';
    bar
      .querySelectorAll('[data-return-level]')
      .forEach((el) =>
        el.addEventListener('click', () => goBackTo(Number(el.dataset.returnLevel))),
      );
  }
  function setWorkspaceMode(mode) {
    const from = workspaceMode;
    const drillIn =
      lastClick.content && Date.now() - lastClick.at < 10000 && from && from !== 'none';
    if (!drillIn) {
      navTrail.length = 0;
    } else if (mode !== from) {
      const seen = navTrail.findIndex((t) => t.mode === mode);
      if (seen >= 0) navTrail.length = seen;
      else navTrail.push({ mode: from, label: currentPageLabel() || 'previous page' });
      if (navTrail.length > 6) navTrail.shift();
    }
    activateWorkspaceMode(mode);
    drawReturnBar();
    // A link far down a long table opens the next page at its top, where the way back is.
    if (drillIn && mode !== from) window.scrollTo({ top: 0 });
  }

  function activateWorkspaceMode(mode) {
    if (PRICING_ADMIN_PAGES[mode]) {
      activatePricingAdminMode(mode);
      return;
    }
    if (PRICING_CALC_PAGES[mode]) {
      activatePricingCalcMode(mode);
      return;
    }
    // Leaving a Management admin page (or a quote calculator) for any other
    // workspace: none of the per-mode branches below know about those
    // panels, so they never got hidden on their own -- clear them here,
    // once, for every mode.
    Object.values(PRICING_ADMIN_PAGES).forEach((page) => {
      const nav = document.getElementById(page.navId);
      const workspace = document.getElementById(page.workspaceId);
      if (nav) nav.setAttribute('aria-current', 'false');
      if (workspace) workspace.hidden = true;
    });
    Object.values(PRICING_CALC_PAGES).forEach((page) => {
      const nav = document.getElementById(page.navId);
      const workspace = document.getElementById(page.workspaceId);
      if (nav) nav.setAttribute('aria-current', 'false');
      if (workspace) workspace.hidden = true;
    });
    const currencyNote = document.getElementById('pricingCurrencyNote');
    if (currencyNote) currencyNote.hidden = true;
    if (mode === 'complaints' && !hasPermission('complaints.read')) return;
    if (mode === 'service-requests' && !hasPermission('complaints.read')) return;
    if (mode === 'appointments' && !hasPermission('appointments.read')) return;
    if (mode === 'job-cards' && !hasPermission('service_job_card.read')) return;
    if (mode === 'quotations' && !hasPermission('quotation.read')) return;
    if (mode === 'inspections' && !hasPermission('inspection.read')) return;
    if (mode === 'warranty-approvals' && !hasPermission('warranty_approval.read')) return;
    if (mode === 'dashboard' && !hasPermission('dashboard.read')) return;
    if (mode === 'technicians' && !hasPermission('technicians.read')) return;
    if (mode === 'team-accounts' && !hasPermission('admin.users')) return;
    if (mode === 'new-request' && !hasPermission('appointments.write')) return;
    if (mode === 'master-data' && !hasPermission('salesmen.write')) return;
    workspaceMode = mode;
    const serviceRequests = mode === 'service-requests';
    const appointments = mode === 'appointments';
    const jobCards = mode === 'job-cards';
    const quotations = mode === 'quotations';
    const inspections = mode === 'inspections';
    const warrantyApprovals = mode === 'warranty-approvals';
    const dashboard = mode === 'dashboard';
    const technicians = mode === 'technicians';
    const teamAccounts = mode === 'team-accounts';
    const newRequest = mode === 'new-request';
    const masterData = mode === 'master-data';
    const anyOtherPanel =
      serviceRequests ||
      appointments ||
      jobCards ||
      quotations ||
      inspections ||
      warrantyApprovals ||
      dashboard ||
      technicians ||
      teamAccounts ||
      newRequest ||
      masterData;
    $('#complaintsNav').setAttribute('aria-current', anyOtherPanel ? 'false' : 'page');
    $('#serviceRequestsNav').setAttribute('aria-current', serviceRequests ? 'page' : 'false');
    $('#jobCardsNav').setAttribute('aria-current', jobCards ? 'page' : 'false');
    $('#quotationsNav').setAttribute('aria-current', quotations ? 'page' : 'false');
    $('#inspectionsNav').setAttribute('aria-current', inspections ? 'page' : 'false');
    $('#warrantyApprovalsNav').setAttribute('aria-current', warrantyApprovals ? 'page' : 'false');
    $('#dashboardNav').setAttribute('aria-current', dashboard ? 'page' : 'false');
    $('#appointmentsNav').setAttribute('aria-current', appointments ? 'page' : 'false');
    $('#techniciansNav').setAttribute('aria-current', technicians ? 'page' : 'false');
    $('#teamAccountsNav').setAttribute('aria-current', teamAccounts ? 'page' : 'false');
    $('#newRequestNav').setAttribute('aria-current', newRequest ? 'page' : 'false');
    $('#masterDataNav').setAttribute('aria-current', masterData ? 'page' : 'false');
    $('#complaintWorkspace').hidden =
      appointments ||
      jobCards ||
      quotations ||
      inspections ||
      warrantyApprovals ||
      dashboard ||
      technicians ||
      teamAccounts ||
      newRequest ||
      masterData;
    $('#appointmentWorkspace').hidden = !appointments;
    $('#jobCardWorkspace').hidden = !jobCards;
    $('#quotationWorkspace').hidden = !quotations;
    $('#inspectionWorkspace').hidden = !inspections;
    $('#warrantyApprovalWorkspace').hidden = !warrantyApprovals;
    $('#dashboardWorkspace').hidden = !dashboard;
    $('#technicianWorkspace').hidden = !technicians;
    $('#teamAccountWorkspace').hidden = !teamAccounts;
    $('#newComplaintWorkspace').hidden = !newRequest;
    $('#masterDataWorkspace').hidden = !masterData;
    $('#refreshComplaintsButton').hidden = anyOtherPanel;
    $('#refreshAppointmentsButton').hidden = !appointments;
    $('#refreshJobCardsButton').hidden = !jobCards;
    $('#refreshQuotationsButton').hidden = !quotations;
    $('#refreshInspectionsButton').hidden = !inspections;
    $('#refreshWarrantyApprovalsButton').hidden = !warrantyApprovals;
    $('#refreshDashboardButton').hidden = !dashboard;
    $('#refreshTechniciansButton').hidden = !technicians;
    $('#refreshTeamAccountsButton').hidden = !teamAccounts;
    $('#workspace-heading').textContent = appointments
      ? 'Appointments'
      : jobCards
        ? 'Service job cards'
        : quotations
          ? 'Quotations'
          : inspections
            ? 'Inspections'
            : warrantyApprovals
              ? 'Warranty approvals'
              : dashboard
                ? 'Dashboard'
                : technicians
                  ? 'Technicians'
                  : teamAccounts
                    ? 'Team logins'
                    : newRequest
                      ? 'New request'
                      : masterData
                        ? 'Salesmen & channels'
                        : serviceRequests
                          ? 'Service requests'
                          : 'Complaint inbox';
    $('#workspaceDescription').textContent = appointments
      ? 'Review scheduled service visits and update their operations status.'
      : jobCards
        ? 'Track service work from an open job card through completion or cancellation.'
        : quotations
          ? 'Prepare and edit customer repair quotations.'
          : inspections
            ? 'Record inspection findings and link them to a quotation.'
            : warrantyApprovals
              ? 'Raise out-of-warranty approval requests and share the customer-facing approval link.'
              : dashboard
                ? 'Operational summary across complaints, appointments, job cards, and approvals.'
                : technicians
                  ? "Manage the technician roster and each technician's daily appointment cap."
                  : teamAccounts
                    ? 'Add teammate logins so they can test the portal with their own accounts.'
                    : newRequest
                      ? 'Book an appointment for a request that came by email, WhatsApp, phone or through a salesman.'
                      : masterData
                        ? 'Manage the Salesman and Sales Channel dropdowns.'
                        : serviceRequests
                          ? 'Review complaints that are ready to be scheduled.'
                          : 'Review incoming service requests and open their history.';
    $('#complaintStatusFilter').value = serviceRequests ? 'Ready for Scheduling' : '';
    $('#complaintStatusFilter').disabled = serviceRequests;
    if (newRequest) loadNewRequestTechnicians();
    if (appointments) {
      loadAppointments();
    } else if (jobCards) {
      loadJobCards();
    } else if (quotations) {
      loadQuotations();
    } else if (inspections) {
      loadInspections();
    } else if (warrantyApprovals) {
      loadWarrantyApprovals();
    } else if (dashboard) {
      loadDashboard();
    } else if (technicians) {
      loadTechnicians();
    } else if (teamAccounts) {
      loadTeamAccounts();
    } else if (newRequest) {
      resetNewComplaintForm();
    } else if (masterData) {
      loadSalesmen();
      loadDandiMasters();
    } else {
      loadComplaints();
    }
  }

  function setWorkspaceRecovery(message, retryAction = null, returnToAppointments = false) {
    const recovery = $('#workspaceRecovery');
    $('#workspaceRecoveryMessage').textContent = message || '';
    recovery.hidden = !message;
    workspaceRetryAction = retryAction;
    $('#retryWorkspaceButton').hidden = !retryAction;
    $('#returnAppointmentsButton').hidden = !returnToAppointments;
  }

  function clearWorkspaceRecovery() {
    setWorkspaceRecovery();
  }

  function localDate(value) {
    if (value instanceof Date)
      return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    const [year, month, day] = String(value).split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
      ? date
      : new Date(NaN);
  }

  function dateInputValue(value) {
    const date = localDate(value);
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
  }

  function shiftDate(value, days) {
    const date = localDate(value);
    date.setDate(date.getDate() + days);
    return date;
  }

  function calendarRange() {
    if (calendarView === 'week') {
      const start = shiftDate(calendarCursor, -calendarCursor.getDay());
      return { start, end: shiftDate(start, 6) };
    }
    const monthStart = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), 1);
    const start = shiftDate(monthStart, -monthStart.getDay());
    const daysInMonth = new Date(
      calendarCursor.getFullYear(),
      calendarCursor.getMonth() + 1,
      0,
    ).getDate();
    const weeks = Math.ceil((monthStart.getDay() + daysInMonth) / 7);
    return { start, end: shiftDate(start, weeks * 7 - 1) };
  }

  function calendarTitle(range) {
    if (calendarView === 'week') {
      return `${range.start.toLocaleDateString(undefined, { dateStyle: 'medium' })} – ${range.end.toLocaleDateString(undefined, { dateStyle: 'medium' })}`;
    }
    return calendarCursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  function statusClass(status) {
    return (
      'status-' +
      String(status || '')
        .toLowerCase()
        .replace(/\s+/g, '-')
    );
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.valueOf())
      ? String(value)
      : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  // Populates a <select> with the given master-data options (each an object
  // with a `name`), preserving/re-adding the currently selected value even if
  // it isn't (or is no longer) in the active list -- e.g. an existing job
  // card recorded against a salesman who was since deactivated (see
  // modification.md #8).
  function populateSelectOptions(selector, options, placeholder, selectedValue) {
    const select = $(selector);
    if (!select) return;
    const current = selectedValue !== undefined ? selectedValue : select.value;
    const names = options.map((option) => option.name);
    if (current && !names.includes(current)) names.push(current);
    select.innerHTML =
      `<option value="">${escapeHtml(placeholder)}</option>` +
      names
        .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
        .join('');
    select.value = current || '';
  }

  // Loads the salesmen / sales channels master lists once per session (see
  // modification.md #8) and fills every dropdown that offers them: the
  // Schedule appointment form and both job-card content panels.
  async function loadMasterDataOptions() {
    if (hasPermission('salesmen.read')) {
      try {
        const result = await apiRequest('/api/salesmen?active=true&page=1&pageSize=200');
        salesmenOptions = result.salesmen || [];
      } catch {
        salesmenOptions = [];
      }
    }
    if (hasPermission('sales_channels.read')) {
      try {
        const result = await apiRequest('/api/sales-channels?active=true&page=1&pageSize=200');
        salesChannelOptions = result.salesChannels || [];
      } catch {
        salesChannelOptions = [];
      }
    }
    populateSelectOptions('#scheduleSalesman', salesmenOptions, 'Select a salesman');
    populateSelectOptions('#newComplaintSalesman', salesmenOptions, 'Select a salesman');
    populateSelectOptions('#jccSalesman', salesmenOptions, 'Select a salesman');
    populateSelectOptions('#jceSalesman', salesmenOptions, 'Select a salesman');
    populateSelectOptions('#jcqSalesman', salesmenOptions, 'Select a salesman');
    populateSelectOptions('#jccSalesChannel', salesChannelOptions, 'Select a sales channel');
    populateSelectOptions('#jceSalesChannel', salesChannelOptions, 'Select a sales channel');
    populateSelectOptions('#jcqSalesChannel', salesChannelOptions, 'Select a sales channel');
    ['jcc', 'jce', 'jcq'].forEach((prefix) =>
      populateSelectOptions(
        `#${prefix}BillToChannel`,
        salesChannelOptions,
        'Auto (billing rule / sales channel)',
      ),
    );
  }

  // ---- Service job card content form (create-prefill panel with prefix 'jcc',
  // existing-job-card edit panel with prefix 'jce'). Both share the same field
  // set (packages/contracts jobCardContentFields / docs/code.gs HEADERS_BY_TYPE
  // ['service-job-card']), so one template and one set of handlers, parameterized
  // by prefix, drive both panels instead of duplicating the markup and logic.
  const jobFinalStatusOptions = [
    'Customer approval pending',
    'WIP',
    'Spare pending',
    'BER',
    'Rejected',
    'Cancelled',
    'Repair Completed',
  ];
  // Job statuses where the work ends and the unit goes back to the customer.
  const jobOutcomeStatuses = ['BER', 'Rejected', 'Cancelled'];
  const jobReadyToDeliver = ['Repair Completed', 'BER', 'Rejected', 'Cancelled'];
  const finalStatusOptions = ['Delivered'];
  const finalStatusReasonOptions = [
    'Parts fitted, written off',
    'Parts returned to stock',
    'Diagnosis charge only',
    'Customer declined the quote',
    'No charge',
    'Duplicate job card',
    'Entered by mistake',
    'Customer cancelled the job',
    'Other',
  ];
  const BER_HANDLING_CHARGE = 60;
  const jobCardPartsState = { jcc: [], jce: [], jcq: [] };

  function parseNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function money(value) {
    return (Number(value) || 0).toFixed(2);
  }

  function toDateTimeLocal(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  const REGION_LIST = [
    'Dubai',
    'Sharjah',
    'Ajman',
    'Ras Al Khaimah',
    'Fujairah',
    'Umm Al Quwain',
    'Abu Dhabi',
    'Al Ain',
  ];
  function jobCardFieldsHtml(prefix) {
    return `
      <div class="jc-sections">
      <section class="jc-sec">
        <header class="ds-head"><h5>Customer</h5></header>
        <div class="jc-sec-body">
      <div class="field-grid">
        <div class="field"><label for="${prefix}CustomerName">Customer name</label><input type="text" id="${prefix}CustomerName" maxlength="200"></div>
        <div class="field"><label for="${prefix}CustomerContact">Customer contact</label><input type="text" id="${prefix}CustomerContact" maxlength="50"></div>
        <div class="field"><label for="${prefix}CustomerAddress">Customer address</label><input type="text" id="${prefix}CustomerAddress" maxlength="500"></div>
        <div class="field"><label for="${prefix}CustomerType">Customer type</label><select id="${prefix}CustomerType"><option value="">Select a type</option><option value="B2C">B2C (Direct customer)</option><option value="B2B">B2B (Corporate client)</option></select></div>
        <div class="field"><label for="${prefix}CustomerEmail">Email address</label><input type="email" id="${prefix}CustomerEmail" maxlength="320"></div>
        <div class="field"><label for="${prefix}Region">Region</label><select id="${prefix}Region"><option value="">Select region</option>${REGION_LIST.map((r) => `<option>${r}</option>`).join('')}</select></div>
        <div class="field"><label for="${prefix}B2bBranchSchool">B2B Branch / School</label><input type="text" id="${prefix}B2bBranchSchool" maxlength="300" list="${prefix}BranchList" autocomplete="off"><datalist id="${prefix}BranchList"></datalist><small id="${prefix}BranchHint" class="field-hint" hidden></small></div>
        <div class="field"><label for="${prefix}SchoolContactPerson">Site contact person</label><input type="text" id="${prefix}SchoolContactPerson" maxlength="500"></div>
        <div class="field"><label for="${prefix}SchoolContactNumber">Site contact number</label><input type="text" id="${prefix}SchoolContactNumber" maxlength="100"></div>
        <div class="field"><label for="${prefix}CustomerNumber">Customer number</label><input type="text" id="${prefix}CustomerNumber" maxlength="100"></div>
      </div>
        </div>
      </section>
      <section class="jc-sec">
        <header class="ds-head"><h5>Product</h5></header>
        <div class="jc-sec-body">
      <div class="field-grid">
        <div class="field"><label for="${prefix}ItemDescription">Item description</label><input type="text" id="${prefix}ItemDescription" maxlength="300"></div>
        <div class="field"><label for="${prefix}ModelNo">Model no. (item code) <span class="tooltip" tabindex="0"><span class="tooltip-icon" aria-hidden="true">i</span><span class="tooltip-bubble" role="tooltip">Type an item code or description to search the stock master, or pick a brand first to list only its models. Picking a result fills brand, description, group and sub group.</span></span></label><input type="text" id="${prefix}ModelNo" maxlength="120" autocomplete="off"></div>
        <div class="field"><label for="${prefix}Brand">Brand</label><input type="text" id="${prefix}Brand" maxlength="120" autocomplete="off"></div>
        <div class="field"><label for="${prefix}MainGroup">Main group</label><input type="text" id="${prefix}MainGroup" maxlength="120"></div>
        <div class="field"><label for="${prefix}GroupName">Group</label><input type="text" id="${prefix}GroupName" maxlength="120"></div>
        <div class="field"><label for="${prefix}SubGroup">Sub group</label><input type="text" id="${prefix}SubGroup" maxlength="120"></div>
        <div class="field"><label for="${prefix}SerialNo">Serial number</label><input type="text" id="${prefix}SerialNo" maxlength="120"></div>
        <div class="field"><label for="${prefix}PurchaseDate">Purchase date <span class="warranty-pill" id="${prefix}WarrantyDaysPill" hidden></span></label><input type="date" id="${prefix}PurchaseDate"></div>
        <input type="hidden" id="${prefix}ItemCode">
        <div class="field"><label for="${prefix}WarrantyStatus">Warranty status</label><input type="text" id="${prefix}WarrantyStatus" maxlength="50"></div>
      </div>
        </div>
      </section>
      <section class="jc-sec">
        <header class="ds-head"><h5>Job details</h5></header>
        <div class="jc-sec-body">
      <div class="field-grid">
        <div class="field"><label for="${prefix}Date">Job card date</label><input type="date" id="${prefix}Date"></div>
        <div class="field"><label for="${prefix}TechnicianName">Technician</label><input type="text" id="${prefix}TechnicianName" maxlength="120"></div>
        <div class="field"><label for="${prefix}Salesman">Salesman ${tipHtml('Loaded from the B2B branch master for this school. Change it here only if this job should be credited to a different salesman. Required for a direct customer (B2C) job under warranty: the sales channel fills in from the salesman and the job is billed to it.')}</label><select id="${prefix}Salesman"><option value="">Select a salesman</option></select></div>
        <div class="field"><label for="${prefix}SalesChannel">Sales channel</label><select id="${prefix}SalesChannel"><option value="">Select a sales channel</option></select></div>
        <div class="field"><label for="${prefix}SalesOrderNumber">Sales order no.</label><input type="text" id="${prefix}SalesOrderNumber" maxlength="100"></div>
        <div class="field"><label for="${prefix}LegacyReference">Legacy reference</label><input type="text" id="${prefix}LegacyReference" maxlength="120" placeholder="Reference from the old system, if any"></div>
      </div>
        </div>
      </section>
      <section class="jc-sec">
        <header class="ds-head"><h5>Service</h5></header>
        <div class="jc-sec-body">
      <div class="field"><label for="${prefix}Complaint">Complaint</label><textarea id="${prefix}Complaint" maxlength="10000"></textarea></div>
      <div class="field"><label for="${prefix}ServiceRendered">Service rendered</label><textarea id="${prefix}ServiceRendered" maxlength="10000"></textarea></div>
      <div class="field-grid">
        <div class="field"><label for="${prefix}PeriodFrom">Period from ${tipHtml(`Set automatically to the time the job card was created. It cannot be changed.`)}</label><input type="datetime-local" id="${prefix}PeriodFrom" readonly></div>
        <div class="field"><label for="${prefix}PeriodTo">Period to</label><input type="datetime-local" id="${prefix}PeriodTo"></div>
        <div class="field"><label for="${prefix}TimeConsumed">Time consumed (hours)</label><input type="text" id="${prefix}TimeConsumed" readonly></div>
      </div>
        </div>
      </section>
      <div class="jc-post-create" id="${prefix}PostCreate"${prefix === 'jce' ? '' : ' hidden'}>
      <section class="jc-sec">
        <header class="ds-head"><h5>Parts and charges</h5></header>
        <div class="jc-sec-body">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Part no.</th><th>Description</th><th>Qty</th><th>Unit price (AED)</th><th>Total</th><th></th></tr></thead>
          <tbody id="${prefix}PartsBody"></tbody>
        </table>
      </div>
      <button class="button button-outline" type="button" id="${prefix}AddPartButton">Add part</button>
      <div class="field-grid">
        <div class="field"><label for="${prefix}TotalCost">Total cost (AED)</label><input type="text" id="${prefix}TotalCost" readonly></div>
        <div class="field"><label for="${prefix}ServiceCharge">Service charge (AED) ${tipHtml(`Major appliances (MDA) are charged the rate card &ldquo;MDA &ndash; Standard&rdquo; amount, in or out of warranty.`, `id="${prefix}ServiceChargeNote" hidden`)}</label><input type="number" step="0.01" min="0" id="${prefix}ServiceCharge"></div>
        <div class="field"><label for="${prefix}GrandTotal">Grand total (AED)</label><input type="text" id="${prefix}GrandTotal" readonly></div>
        <div class="field"><label for="${prefix}AmountChargeable">Amount chargeable (AED)</label><input type="number" step="0.01" min="0" id="${prefix}AmountChargeable"></div>
      </div>
        </div>
      </section>
      <section class="jc-sec">
        <header class="ds-head"><h5>Status and delivery</h5></header>
        <div class="jc-sec-body">
      <div class="field-grid">
        <div class="field"><label for="${prefix}DeliveryDate">Delivery date ${tipHtml('Captured automatically on the day the job is saved as Delivered. Enter a date here only to record a different delivery day.')}</label><input type="date" id="${prefix}DeliveryDate"></div>
        <div class="field"><label for="${prefix}JobFinalStatus">Job status ${tipHtml('Where the job is right now. Customer approval pending waits for the customer to approve out-of-warranty work, then WIP. Use BER when the item cannot be repaired economically. Repair Completed when the work is finished.')}</label><select id="${prefix}JobFinalStatus">${jobFinalStatusOptions.map((status) => `<option value="${status}">${status}</option>`).join('')}</select></div>
        <div class="field"><label for="${prefix}FinalStatus">Final status ${tipHtml('Delivered once the customer has the unit back. It can be chosen when the job status is Repair Completed, BER, Rejected or Cancelled. Leave it blank while the job is open. A BER, Rejected or Cancelled job asks for a reason. Delivered locks the card; only an admin can edit it after that.')}</label><select id="${prefix}FinalStatus"><option value="">Open (not delivered)</option>${finalStatusOptions.map((status) => `<option value="${status}">${status}</option>`).join('')}</select></div>
        <div class="field" id="${prefix}FinalStatusReasonField" hidden><label for="${prefix}FinalStatusReason">Reason ${tipHtml('Why this BER, Rejected or Cancelled job is being delivered back.')}</label><select id="${prefix}FinalStatusReason"><option value="">Select a reason</option>${finalStatusReasonOptions.map((reason) => `<option value="${reason}">${reason}</option>`).join('')}</select><p class="field-hint is-warn" id="${prefix}FinalStatusWarning"></p></div>
      </div>
        </div>
      </section>
      <section class="jc-sec">
        <header class="ds-head"><h5>Warranty and billing</h5></header>
        <div class="jc-sec-body">
      <div class="field-grid">
        <div class="field"><label for="${prefix}FinalWarrantyStatus">Final warranty status ${tipHtml(`Set after inspection. If it differs from the registered warranty (for example customer-induced damage or misuse), billing follows this one.`)}</label><select id="${prefix}FinalWarrantyStatus"><option value="">Same as registered warranty</option><option>In Warranty</option><option>Out Warranty</option></select></div>
        <div class="field" id="${prefix}WarrantyReasonField" hidden><label for="${prefix}WarrantyOverrideReason">Reason for the change</label><input type="text" id="${prefix}WarrantyOverrideReason" maxlength="1000" placeholder="Required when the final warranty differs"></div>
        <div class="field"><label for="${prefix}PaymentBy">Payment by ${tipHtml(`In warranty is always billed to the sales channel. For out of warranty choose who pays.`)}</label><select id="${prefix}PaymentBy"><option value="">Automatic</option><option>Sales channel</option><option>Customer</option></select></div>
        <div class="field"><label for="${prefix}BillToChannel">Bill to channel</label><select id="${prefix}BillToChannel"><option value="">Auto (billing rule / sales channel)</option></select></div>
        <div class="field"><label for="${prefix}BillingJobType">Job type</label><input type="text" id="${prefix}BillingJobType" readonly></div>
        <div class="field field-wide" id="${prefix}InvoiceBox"><label>Invoice and payment ${tipHtml(`A job with an amount (anything other than internal billing) cannot be delivered until its tax invoice is issued and, when the customer pays, the payment is confirmed. Both are done under Service desk, Invoices.`)}</label><div class="jc-invoice-status"><span class="status" id="${prefix}InvoiceState">No invoice needed</span><span class="jc-invoice-no" id="${prefix}InvoiceNote"></span><button class="button button-outline" type="button" id="${prefix}OpenInvoice" hidden>Open invoice</button></div></div>
      </div>
        </div>
      </section>
      </div>
      </div>
    `;
  }

  // Shows the job type and payer that the billing rules will apply, as the
  // user edits the warranty fields (the server recomputes on save).
  function normalizeWarrantyText(value) {
    const text = String(value || '')
      .trim()
      .toLowerCase();
    if (!text) return '';
    if (/\bout\b|non[- ]?warranty|expired/.test(text)) return 'Out Warranty';
    if (/warranty/.test(text)) return 'In Warranty';
    return '';
  }

  // The rate card's "MDA – Standard" service charge, read once and reused.
  let mdaRatePromise = null;
  function loadMdaRate() {
    if (!mdaRatePromise) {
      mdaRatePromise = apiRequest('/api/rate-card')
        .then((data) => {
          for (const section of data.sections || []) {
            for (const activity of section.activities || []) {
              const name = String(activity.name)
                .replace(/[\u2012-\u2015\u2212]/g, '-')
                .trim()
                .toLowerCase();
              if (name === 'mda - standard') return Number(activity.rate);
            }
          }
          return null;
        })
        .catch(() => null);
    }
    return mdaRatePromise;
  }

  // Major appliances (MDA) bill the rate card charge, in or out of warranty, so
  // the service charge is filled in and locked while the main group is MDA.
  function refreshMdaServiceCharge(prefix) {
    const field = $(`#${prefix}ServiceCharge`);
    const note = $(`#${prefix}ServiceChargeNote`);
    if (!field) return;
    if (isOutcomeJob(prefix)) {
      // BER, Rejected and Cancelled jobs use the outcome charge, not the MDA rate.
      note.hidden = true;
      refreshOutcomeCharge(prefix);
      return;
    }
    const isMda = ($(`#${prefix}MainGroup`).value || '').trim().toUpperCase() === 'MDA';
    note.hidden = !isMda;
    if (!isMda) {
      field.readOnly = false;
      return;
    }
    loadMdaRate().then((rate) => {
      const stillMda = ($(`#${prefix}MainGroup`).value || '').trim().toUpperCase() === 'MDA';
      if (!stillMda || rate === null) return;
      field.value = rate;
      field.readOnly = true;
      recalcJobCardTotals(prefix);
    });
  }

  // Read-only invoice and payment status on the job card; all entry is under Invoices.
  function refreshInvoiceBox(prefix) {
    const box = $(`#${prefix}InvoiceBox`);
    if (!box) return;
    const amount =
      parseNumber($(`#${prefix}AmountChargeable`).value || $(`#${prefix}GrandTotal`).value) || 0;
    const paymentBy = $(`#${prefix}PaymentBy`).value;
    const effective =
      normalizeWarrantyText($(`#${prefix}FinalWarrantyStatus`).value) ||
      normalizeWarrantyText($(`#${prefix}WarrantyStatus`).value);
    const customerPays =
      paymentBy === 'Customer' ||
      (!paymentBy && effective === 'Out Warranty' && $(`#${prefix}CustomerType`).value === 'B2C');
    const invoiceNo = box.dataset.portalNo || '';
    const paid = box.dataset.confirmed === '1';
    let label = 'No invoice needed';
    let cls = '';
    if (amount > 0 && !invoiceNo) {
      label = 'Invoice required before delivery';
      cls = 'status-warn';
    } else if (invoiceNo && customerPays) {
      label = paid ? 'Invoiced and paid' : 'Invoiced, awaiting payment';
      cls = paid ? 'status-ok' : 'status-warn';
    } else if (invoiceNo) {
      label = 'Invoiced';
      cls = 'status-ok';
    }
    const state = $(`#${prefix}InvoiceState`);
    state.textContent = label;
    state.className = `status ${cls}`;
    $(`#${prefix}InvoiceNote`).textContent = invoiceNo;
    $(`#${prefix}OpenInvoice`).hidden =
      !(box.dataset.jobId && amount > 0) || !hasPermission('invoices.read');
  }

  // A B2C job under warranty is billed internally to the salesman's sales channel, so
  // the salesman is required (modification #153). Marks the field and tells the user.
  function salesmanRequired(prefix) {
    const effective =
      $(`#${prefix}FinalWarrantyStatus`).value ||
      normalizeWarrantyText($(`#${prefix}WarrantyStatus`).value);
    const jobStatus = $(`#${prefix}JobFinalStatus`)?.value;
    return (
      $(`#${prefix}CustomerType`).value === 'B2C' &&
      effective === 'In Warranty' &&
      jobStatus !== 'Cancelled'
    );
  }

  function refreshSalesmanRequirement(prefix) {
    const label = $(`#${prefix}Salesman`)?.closest('.field')?.querySelector('label');
    if (!label) return;
    let star = label.querySelector('.required');
    const needed = salesmanRequired(prefix);
    if (needed && !star) {
      label.insertAdjacentHTML('afterbegin', '<span class="required" aria-hidden="true">*</span> ');
      star = label.querySelector('.required');
    }
    if (!needed && star) star.nextSibling?.nodeType === 3 && star.nextSibling.remove();
    if (!needed && star) star.remove();
    if (!needed) clearMissingMark($(`#${prefix}Salesman`));
  }

  async function demandSalesman(prefix) {
    if (!salesmanRequired(prefix) || $(`#${prefix}Salesman`).value.trim()) return true;
    const select = $(`#${prefix}Salesman`);
    select.closest('.field')?.classList.add('field-missing');
    select.addEventListener('change', () => clearMissingMark(select), { once: true });
    await notifyDialog(
      'Salesman is required',
      "This is a direct customer (B2C) job under warranty. It is billed internally to the salesman's sales channel, so choose the salesman. The sales channel fills in by itself.",
    );
    select.closest('.field')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    select.focus({ preventScroll: true });
    return false;
  }

  // A B2C warranty job is billed to the salesman's sales channel. If the salesman is not
  // linked to a channel in the Salesmen master (and no channel is set by hand), tell the
  // user to contact the admin instead of letting the job fail at delivery.
  async function demandSalesmanChannel(prefix) {
    if (!salesmanRequired(prefix)) return true;
    const name = $(`#${prefix}Salesman`).value.trim();
    if (!name) return true;
    if ($(`#${prefix}SalesChannel`).value || $(`#${prefix}BillToChannel`)?.value) return true;
    const field = $(`#${prefix}SalesChannel`).closest('.field');
    field?.classList.add('field-missing');
    $(`#${prefix}SalesChannel`).addEventListener(
      'change',
      () => clearMissingMark($(`#${prefix}SalesChannel`)),
      {
        once: true,
      },
    );
    await notifyDialog(
      'Salesman has no sales channel',
      `${name} is not linked to a sales channel yet, so this job cannot be billed. Contact the admin to link the salesman to a channel under Salesmen, then try again. You can also pick the sales channel by hand.`,
    );
    return false;
  }

  function refreshBillingPreview(prefix) {
    const registered = normalizeWarrantyText($(`#${prefix}WarrantyStatus`).value);
    const finalValue = $(`#${prefix}FinalWarrantyStatus`).value;
    const effective = finalValue || registered;
    const changed = Boolean(finalValue && registered && finalValue !== registered);
    $(`#${prefix}WarrantyReasonField`).hidden = !changed;
    const paymentBy = $(`#${prefix}PaymentBy`);
    paymentBy.disabled = effective === 'In Warranty';
    if (effective === 'In Warranty') paymentBy.value = 'Sales channel';
    refreshInvoiceBox(prefix);
    refreshMdaServiceCharge(prefix);
    refreshSalesmanRequirement(prefix);
    $(`#${prefix}BillingJobType`).value =
      effective === 'In Warranty'
        ? 'CSIJW - Warranty repair'
        : effective === 'Out Warranty'
          ? 'CSIJO - Non-warranty repair'
          : 'Set the warranty status';
  }

  function initJobCardForms() {
    $('#jobCardViewTabs').addEventListener('click', (event) => {
      const tab = event.target.closest('[data-jc-view]');
      if (tab && !tab.hidden) setJobCardView(tab.dataset.jcView);
    });
    document.addEventListener('click', (event) => {
      const open = event.target.closest('[id$="OpenInvoice"]');
      if (!open) return;
      const jobId = $(`#${open.id.replace('OpenInvoice', 'InvoiceBox')}`)?.dataset.jobId;
      if (!jobId) return;
      pendingInvoiceJobId = jobId;
      setWorkspaceMode('invoices');
    });
    $('#jobCardCreateFields').innerHTML = jobCardFieldsHtml('jcc');
    $('#jobCardContentFields').innerHTML = jobCardFieldsHtml('jce');
    $('#quotationJobCardCreateFields').innerHTML = jobCardFieldsHtml('jcq');
    ['jcc', 'jce', 'jcq'].forEach((prefix) => {
      attachItemPicker({
        brand: $(`#${prefix}Brand`),
        model: $(`#${prefix}ModelNo`),
        desc: $(`#${prefix}ItemDescription`),
        code: $(`#${prefix}ItemCode`),
        mainGroup: $(`#${prefix}MainGroup`),
        group: $(`#${prefix}GroupName`),
        subGroup: $(`#${prefix}SubGroup`),
        onFilled: () => refreshBillingPreview(prefix),
      });
      attachSalesLinking(prefix);
      $(`#${prefix}AddPartButton`).addEventListener('click', () => {
        jobCardPartsState[prefix].push({ partNo: '', description: '', qty: 1, unitPrice: 0 });
        renderJobCardParts(prefix);
      });
      $(`#${prefix}ServiceCharge`).addEventListener('input', () => recalcJobCardTotals(prefix));
      [
        `#${prefix}FinalWarrantyStatus`,
        `#${prefix}WarrantyStatus`,
        `#${prefix}PaymentBy`,
        `#${prefix}CustomerType`,
        `#${prefix}MainGroup`,
        `#${prefix}AmountChargeable`,
      ].forEach((selector) =>
        $(selector).addEventListener('input', () => refreshBillingPreview(prefix)),
      );
      [`#${prefix}FinalWarrantyStatus`, `#${prefix}CustomerType`].forEach((selector) =>
        $(selector).addEventListener('change', () => {
          if (salesmanRequired(prefix) && !$(`#${prefix}Salesman`).value.trim()) {
            demandSalesman(prefix);
          }
        }),
      );
      $(`#${prefix}PurchaseDate`).addEventListener('input', () => refreshWarrantyDaysPill(prefix));
      $(`#${prefix}PeriodFrom`).addEventListener('change', () => calcJobCardTimeConsumed(prefix));
      $(`#${prefix}PeriodTo`).addEventListener('change', () => calcJobCardTimeConsumed(prefix));
    });
  }

  // Salesman -> Sales channel, and B2B Branch / School -> Salesman, Sales channel,
  // Customer number and Sales order (modification #128). The masters supply the values;
  // every field stays editable.
  function channelForSalesman(name) {
    const record = salesmenOptions.find(
      (option) =>
        String(option.name).toLowerCase() ===
        String(name || '')
          .trim()
          .toLowerCase(),
    );
    return record?.salesChannel || '';
  }

  function setSelectValue(selector, value) {
    const select = $(selector);
    if (!select || !value) return;
    if (![...select.options].some((option) => option.value === value)) {
      select.insertAdjacentHTML(
        'beforeend',
        `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`,
      );
    }
    select.value = value;
  }

  function clearMissingMark(element) {
    element?.classList.remove('field-missing');
    element?.closest('.field')?.classList.remove('field-missing');
  }

  // Scrolls to the first empty field a delivery needs and shades each one, so the CCE
  // sees exactly what to fill. The shading clears as soon as the field is touched.
  function highlightMissingForDelivery(prefix) {
    const targets = [];
    const type = $(`#${prefix}CustomerType`).value;
    if (type && type !== 'B2C' && !$(`#${prefix}B2bBranchSchool`).value.trim()) {
      targets.push($(`#${prefix}B2bBranchSchool`));
    }
    if (((type && type !== 'B2C') || salesmanRequired(prefix)) && !$(`#${prefix}Salesman`).value) {
      targets.push($(`#${prefix}Salesman`));
    }
    if (!$(`#${prefix}SalesChannel`).value && !$(`#${prefix}BillToChannel`)?.value) {
      targets.push($(`#${prefix}SalesChannel`));
    }
    targets.forEach((input) => {
      const field = input.closest('.field');
      field?.classList.add('field-missing');
      const clear = () => clearMissingMark(input);
      input.addEventListener('input', clear, { once: true });
      input.addEventListener('change', clear, { once: true });
    });
    const first = targets[0];
    if (first) {
      first.closest('.field')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      first.focus({ preventScroll: true });
    }
  }

  function setBranchHint(prefix, text, kind) {
    const hint = $(`#${prefix}BranchHint`);
    if (!hint) return;
    hint.hidden = !text;
    hint.textContent = text || '';
    hint.dataset.kind = kind || '';
  }

  async function applyBranchLookup(prefix) {
    const input = $(`#${prefix}B2bBranchSchool`);
    const name = input.value.trim();
    if (!name || $(`#${prefix}CustomerType`).value === 'B2C') {
      setBranchHint(prefix, '', '');
      return;
    }
    let branch = null;
    try {
      const result = await apiRequest('/api/b2b-branches?query=' + encodeURIComponent(name));
      // The field takes the customer name, or the customer code (Cust_Code) -- either loads the customer.
      const wanted = name.toLowerCase();
      branch = (result.branches || []).find(
        (item) =>
          String(item.branchName).trim().toLowerCase() === wanted ||
          String(item.custCode).trim().toLowerCase() === wanted,
      );
    } catch {
      return;
    }
    if (input.value.trim() !== name) return;
    if (!branch) {
      setBranchHint(
        prefix,
        'This name or customer code is not in the B2B Branch / School list. Pick the correct school from the suggestions to load its salesman and sales channel.',
        'warn',
      );
      return;
    }
    input.value = branch.branchName;
    clearMissingMark(input);
    if (branch.custCode) $(`#${prefix}CustomerNumber`).value = branch.custCode;
    if (branch.lastSalesOrderNumber) {
      $(`#${prefix}SalesOrderNumber`).value = branch.lastSalesOrderNumber;
    }
    if (branch.salesman) setSelectValue(`#${prefix}Salesman`, branch.salesman);
    const channel = channelForSalesman(branch.salesman);
    if (channel) setSelectValue(`#${prefix}SalesChannel`, channel);
    clearMissingMark($(`#${prefix}Salesman`));
    clearMissingMark($(`#${prefix}SalesChannel`));
    markMasterFields(prefix, [
      'b2bBranchSchool',
      'customerNumber',
      'salesOrderNumber',
      'salesman',
      'salesChannel',
    ]);
    setBranchHint(prefix, 'Matched in the B2B Branch / School list. Details loaded.', 'ok');
    refreshBillingPreview(prefix);
  }

  function attachSalesLinking(prefix) {
    const branch = $(`#${prefix}B2bBranchSchool`);
    const list = $(`#${prefix}BranchList`);
    let timer = null;
    let seq = 0;
    branch.addEventListener('input', () => {
      clearTimeout(timer);
      setBranchHint(prefix, '', '');
      const term = branch.value.trim();
      if (term.length < 2) {
        list.innerHTML = '';
        return;
      }
      timer = setTimeout(async () => {
        const mine = ++seq;
        try {
          const result = await apiRequest('/api/b2b-branches?query=' + encodeURIComponent(term));
          if (mine !== seq) return;
          // The name is what gets filled in; the label also carries the customer code, which can be typed too.
          list.innerHTML = (result.branches || [])
            .map(
              (item) =>
                `<option value="${escapeHtml(item.branchName)}" label="${escapeHtml(item.branchName)} (${escapeHtml(item.custCode)})"></option>`,
            )
            .join('');
        } catch {
          list.innerHTML = '';
        }
      }, 250);
    });
    branch.addEventListener('change', () => applyBranchLookup(prefix));
    $(`#${prefix}Salesman`).addEventListener('change', () => {
      clearMissingMark($(`#${prefix}Salesman`));
      const channel = channelForSalesman($(`#${prefix}Salesman`).value);
      if (channel) {
        setSelectValue(`#${prefix}SalesChannel`, channel);
        clearMissingMark($(`#${prefix}SalesChannel`));
      }
      refreshBillingPreview(prefix);
      if (!channel && $(`#${prefix}Salesman`).value) demandSalesmanChannel(prefix);
    });
  }

  function initQuotationForms() {
    $('#quotationCreateFields').innerHTML = quotationFieldsHtml('qtc');
    $('#quotationEditFields').innerHTML = quotationFieldsHtml('qte');
    initQuotationForm('qtc');
    initQuotationForm('qte');
  }

  function initInspectionForms() {
    $('#inspectionCreateFields').innerHTML = inspectionFieldsHtml('iqc');
    $('#inspectionEditFields').innerHTML = inspectionFieldsHtml('iqe');
    initInspectionForm('iqc');
    initInspectionForm('iqe');
  }

  // Generic add/remove/qty*price-total line-item table, driven off
  // lineItemsState[stateKey] and rendered into #<bodyId>. Used by the job
  // card parts table and by the quotation/inspection products & parts
  // tables -- each table gets its own stateKey (and its own bodyId) so
  // several tables can live on the same form (e.g. quotation has both a
  // Products table and a Parts table). onChange fires after every edit so
  // the caller can recompute whatever totals depend on this table.
  const lineItemsState = jobCardPartsState;

  function renderLineItemsTable(stateKey, bodyId, onChange, itemLookup = false) {
    const body = $(`#${bodyId}`);
    const items = lineItemsState[stateKey];
    body.innerHTML = items
      .map(
        (item, idx) => `<tr data-idx="${idx}">
          <td><input type="text" value="${escapeHtml(item.partNo)}" data-field="partNo" maxlength="120"${item.fromMaster ? ' class="master-filled"' : ''}></td>
          <td><input type="text" value="${escapeHtml(item.description)}" data-field="description" maxlength="300"${item.fromMaster ? ' class="master-filled"' : ''}></td>
          <td><input type="number" min="0" value="${item.qty}" data-field="qty" style="width:70px;"></td>
          <td><input type="number" min="0" step="0.01" value="${item.unitPrice}" data-field="unitPrice" style="width:90px;"></td>
          <td>${money((item.qty || 0) * (item.unitPrice || 0))}</td>
          <td><button type="button" class="button-link" data-remove-part="${idx}">Remove</button></td>
        </tr>`,
      )
      .join('');
    body.querySelectorAll('input[data-field]').forEach((input) => {
      input.addEventListener('input', (event) => {
        const row = event.target.closest('tr');
        const idx = Number(row.dataset.idx);
        const field = event.target.dataset.field;
        items[idx][field] =
          field === 'partNo' || field === 'description'
            ? event.target.value
            : parseNumber(event.target.value);
        row.children[4].textContent = money((items[idx].qty || 0) * (items[idx].unitPrice || 0));
        onChange();
      });
    });
    body.querySelectorAll('[data-remove-part]').forEach((button) => {
      button.addEventListener('click', () => {
        items.splice(Number(button.dataset.removePart), 1);
        renderLineItemsTable(stateKey, bodyId, onChange, itemLookup);
      });
    });
    if (itemLookup) attachStockItemLookup(body, items, onChange);
    onChange();
  }

  // Product rows: Part no. and Description suggest items from the stock master.
  // Picking an item fills both (green = loaded from the master); typing anything
  // else is kept as a manual entry.
  function attachStockItemLookup(body, items, onChange) {
    const wrap = body.closest('.table-wrap') || body.parentElement;
    const codesId = `${body.id}Codes`;
    const namesId = `${body.id}Names`;
    let codes = wrap.querySelector(`#${codesId}`);
    let names = wrap.querySelector(`#${namesId}`);
    if (!codes) {
      codes = document.createElement('datalist');
      codes.id = codesId;
      wrap.appendChild(codes);
    }
    if (!names) {
      names = document.createElement('datalist');
      names.id = namesId;
      wrap.appendChild(names);
    }
    const known = new Map();
    const lookup = (term) => {
      const key = term.trim().toLowerCase();
      for (const item of known.values()) {
        if (item.itemCode.toLowerCase() === key || item.itemDesc.toLowerCase() === key) return item;
      }
      return null;
    };
    let timer = null;
    let seq = 0;
    body.querySelectorAll('tr').forEach((row) => {
      const partNo = row.querySelector('[data-field="partNo"]');
      const description = row.querySelector('[data-field="description"]');
      partNo.setAttribute('list', codesId);
      description.setAttribute('list', namesId);
      partNo.setAttribute('autocomplete', 'off');
      description.setAttribute('autocomplete', 'off');
      const idx = Number(row.dataset.idx);
      const search = (input) => {
        clearTimeout(timer);
        const term = input.value.trim();
        if (term.length < 2) return;
        timer = setTimeout(async () => {
          const mine = ++seq;
          try {
            const data = await apiRequest(
              '/api/stock/items?' + new URLSearchParams({ q: term, limit: '12' }),
            );
            if (mine !== seq) return;
            (data.items || []).forEach((item) => known.set(item.itemCode, item));
            codes.innerHTML = (data.items || [])
              .map(
                (item) =>
                  `<option value="${escapeHtml(item.itemCode)}" label="${escapeHtml(item.itemDesc)}"></option>`,
              )
              .join('');
            names.innerHTML = (data.items || [])
              .map(
                (item) =>
                  `<option value="${escapeHtml(item.itemDesc)}" label="${escapeHtml(item.itemCode)}"></option>`,
              )
              .join('');
          } catch {
            codes.innerHTML = '';
            names.innerHTML = '';
          }
        }, 250);
      };
      const pick = (input) => {
        const item = lookup(input.value);
        if (!item) return;
        partNo.value = item.itemCode;
        description.value = item.itemDesc;
        items[idx].partNo = item.itemCode;
        items[idx].description = item.itemDesc;
        items[idx].fromMaster = true;
        [partNo, description].forEach((field) => {
          field.classList.add('master-filled');
          field.title = 'Filled from the stock master';
        });
        onChange();
      };
      [partNo, description].forEach((input) => {
        input.addEventListener('input', () => {
          input.classList.remove('master-filled');
          items[idx].fromMaster = false;
          search(input);
          pick(input);
        });
        input.addEventListener('change', () => pick(input));
      });
    });
  }

  function renderJobCardParts(prefix) {
    renderLineItemsTable(prefix, `${prefix}PartsBody`, () => recalcJobCardTotals(prefix));
  }

  function recalcJobCardTotals(prefix) {
    const totalCost = jobCardPartsState[prefix].reduce(
      (sum, part) => sum + (part.qty || 0) * (part.unitPrice || 0),
      0,
    );
    const serviceCharge = parseNumber($(`#${prefix}ServiceCharge`).value);
    $(`#${prefix}TotalCost`).value = money(totalCost);
    $(`#${prefix}GrandTotal`).value = money(totalCost + serviceCharge);
    if ($(`#${prefix}InvoiceBox`)) refreshInvoiceBox(prefix);
    if (typeof refreshFinalStatusReason === 'function') refreshFinalStatusReason(prefix);
  }

  // Warranty is one year from the purchase date; the pill shows the days left.
  function refreshWarrantyDaysPill(prefix) {
    const pill = $(`#${prefix}WarrantyDaysPill`);
    const value = $(`#${prefix}PurchaseDate`).value;
    if (!value) {
      pill.hidden = true;
      return;
    }
    const [y, m, d] = value.split('-').map(Number);
    const end = Date.UTC(y + 1, m - 1, d);
    const now = new Date();
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const days = Math.round((end - today) / 86400000);
    pill.hidden = false;
    pill.classList.toggle('is-expired', days <= 0);
    pill.textContent =
      days > 0 ? `${days} warranty day${days === 1 ? '' : 's'} left` : 'Warranty expired';
  }

  function calcJobCardTimeConsumed(prefix) {
    const fromValue = $(`#${prefix}PeriodFrom`).value;
    const toValue = $(`#${prefix}PeriodTo`).value;
    const field = $(`#${prefix}TimeConsumed`);
    if (!fromValue || !toValue) {
      field.value = '';
      return;
    }
    const diffMs = new Date(toValue) - new Date(fromValue);
    field.value = Number.isNaN(diffMs) || diffMs < 0 ? '' : String(Math.round(diffMs / 3600000));
  }

  // Highlights the fields a master supplied (see enrichDefaultsFromMasters on
  // the API) so staff can see what was loaded and what was typed by a person.
  const MASTER_FIELD_IDS = {
    b2bBranchSchool: 'B2bBranchSchool',
    customerNumber: 'CustomerNumber',
    salesOrderNumber: 'SalesOrderNumber',
    salesman: 'Salesman',
    salesChannel: 'SalesChannel',
    modelNo: 'ModelNo',
    brand: 'Brand',
    itemDescription: 'ItemDescription',
    mainGroup: 'MainGroup',
    groupName: 'GroupName',
    subGroup: 'SubGroup',
  };
  function markMasterFields(prefix, fields) {
    Object.values(MASTER_FIELD_IDS).forEach((suffix) => {
      const input = $(`#${prefix}${suffix}`);
      if (!input) return;
      input.classList.remove('master-filled');
      input.closest('.field')?.classList.remove('master-field');
    });
    (fields || []).forEach((name) => {
      const suffix = MASTER_FIELD_IDS[name];
      const input = suffix ? $(`#${prefix}${suffix}`) : null;
      if (!input || !input.value) return;
      input.classList.add('master-filled');
      input.closest('.field')?.classList.add('master-field');
    });
  }

  // For a saved job card opened in Edit: the stock master fills item fields that
  // are still blank (nothing is saved until the form is saved), then every field
  // a master supplies is highlighted.
  function applyMasterContext(prefix, context) {
    const fill = context?.masterFill || {};
    const fieldIds = { ...MASTER_FIELD_IDS, itemCode: 'ItemCode' };
    Object.entries(fill).forEach(([key, value]) => {
      const input = $(`#${prefix}${fieldIds[key]}`);
      if (!input || input.value || !value) return;
      const max = Number(input.getAttribute('maxlength')) || 0;
      input.value = max ? String(value).slice(0, max) : String(value);
    });
    if (fill.itemCode || (context?.masterFields || []).includes('modelNo')) {
      const model = $(`#${prefix}ModelNo`);
      setItemPickerState(model, true, $(`#${prefix}ItemCode`).value || model.value);
    }
    markMasterFields(prefix, [...(context?.masterFields || []), ...Object.keys(fill)]);
    // The stock master can fill the main group (MDA), which sets the service charge.
    refreshMdaServiceCharge(prefix);
  }

  // The rate card's OOW inspection charge (AED 60), billed to the sales channel when a
  // business job ends as BER or Rejected. Falls back to 60 when the line is missing.
  let oowRatePromise = null;
  function loadOowRate() {
    if (!oowRatePromise) {
      oowRatePromise = apiRequest('/api/rate-card')
        .then((data) => {
          for (const section of data.sections || []) {
            for (const activity of section.activities || []) {
              const name = String(activity.name).toLowerCase();
              if (name.includes('oow') && name.includes('inspection')) return Number(activity.rate);
            }
          }
          return BER_HANDLING_CHARGE;
        })
        .catch(() => BER_HANDLING_CHARGE);
    }
    return oowRatePromise;
  }

  function isOutcomeJob(prefix) {
    return jobOutcomeStatuses.includes($(`#${prefix}JobFinalStatus`)?.value);
  }

  // A job that ends as BER, Rejected or Cancelled is not charged the repair rate: B2C
  // pays nothing, a business job that is finally Out Warranty is billed the OOW
  // inspection charge (not for Cancelled). Mirrors the server.
  function refreshOutcomeCharge(prefix) {
    const charge = $(`#${prefix}ServiceCharge`);
    const amount = $(`#${prefix}AmountChargeable`);
    if (!charge || !amount) return;
    if (!isOutcomeJob(prefix)) {
      if (charge.dataset.outcomeLocked) {
        delete charge.dataset.outcomeLocked;
        charge.readOnly = false;
        amount.readOnly = false;
        charge.value = 0;
        amount.value = '';
        recalcJobCardTotals(prefix);
        refreshMdaServiceCharge(prefix);
      }
      return;
    }
    loadOowRate().then((rate) => {
      if (!isOutcomeJob(prefix)) return;
      const job = $(`#${prefix}JobFinalStatus`).value;
      const effective =
        normalizeWarrantyText($(`#${prefix}FinalWarrantyStatus`).value) ||
        normalizeWarrantyText($(`#${prefix}WarrantyStatus`).value);
      const channelPays =
        $(`#${prefix}CustomerType`).value !== 'B2C' &&
        effective === 'Out Warranty' &&
        job !== 'Cancelled';
      const value = channelPays ? rate : 0;
      charge.value = value;
      amount.value = value;
      charge.readOnly = true;
      amount.readOnly = true;
      charge.dataset.outcomeLocked = '1';
      recalcJobCardTotals(prefix);
    });
  }

  function notifyDialog(title, message) {
    return new Promise((resolve) => {
      const dialog = document.createElement('dialog');
      dialog.className = 'pw-dialog';
      dialog.innerHTML = `<h3>${escapeHtml(title)}</h3><form method="dialog" novalidate><p>${escapeHtml(message)}</p><div class="form-footer"><button type="button" class="button button-primary" data-nd-ok>OK</button></div></form>`;
      dialog.addEventListener('click', (event) => {
        if (event.target.closest('[data-nd-ok]')) dialog.close();
      });
      dialog.addEventListener('close', () => {
        dialog.remove();
        resolve();
      });
      document.body.appendChild(dialog);
      dialog.showModal();
    });
  }

  // Final status can only be chosen once the job is ready to hand back. A BER, Rejected or
  // Cancelled job needs a reason, shown in the box below (and asked in a pop-up).
  function refreshFinalStatusReason(prefix) {
    const job = $(`#${prefix}JobFinalStatus`);
    const final = $(`#${prefix}FinalStatus`);
    const field = $(`#${prefix}FinalStatusReasonField`);
    if (!job || !final || !field) return;
    const ready = jobReadyToDeliver.includes(job.value);
    final.disabled = !ready;
    if (!ready) final.value = '';
    const needs = Boolean(final.value) && jobOutcomeStatuses.includes(job.value);
    field.hidden = !needs;
    const warning = $(`#${prefix}FinalStatusWarning`);
    if (warning) {
      warning.textContent = needs
        ? `This job ended as ${job.value}. Choose why it is being delivered back.`
        : '';
    }
    if (!needs) $(`#${prefix}FinalStatusReason`).value = '';
  }

  // The charge goes to the sales channel, so one must be chosen before delivery.
  function salesChannelMissing(prefix) {
    const effective =
      normalizeWarrantyText($(`#${prefix}FinalWarrantyStatus`).value) ||
      normalizeWarrantyText($(`#${prefix}WarrantyStatus`).value);
    return (
      isOutcomeJob(prefix) &&
      $(`#${prefix}JobFinalStatus`).value !== 'Cancelled' &&
      $(`#${prefix}CustomerType`).value !== 'B2C' &&
      effective === 'Out Warranty' &&
      !$(`#${prefix}SalesChannel`).value &&
      !$(`#${prefix}BillToChannel`).value
    );
  }

  // Asks why a BER, Rejected or Cancelled job is being delivered back.
  function askFinalStatusReason(summary) {
    return new Promise((resolve) => {
      const dialog = document.createElement('dialog');
      dialog.className = 'pw-dialog';
      dialog.innerHTML = `<h3>Reason</h3>
        <form method="dialog" novalidate>
          <p>${escapeHtml(summary)}</p>
          <div class="field"><label for="fsReason">Why is this job being delivered back?</label>
            <select id="fsReason"><option value="">Select a reason</option>${finalStatusReasonOptions
              .map(
                (reason) => `<option value="${escapeHtml(reason)}">${escapeHtml(reason)}</option>`,
              )
              .join('')}</select></div>
          <p class="field-error" id="fsError" role="alert"></p>
          <div class="form-footer"><button type="button" class="button button-outline" data-fs-cancel>Cancel</button><button type="button" class="button button-primary" data-fs-confirm>Confirm</button></div>
        </form>`;
      let result = null;
      dialog.addEventListener('click', (event) => {
        if (event.target.closest('[data-fs-cancel]')) {
          dialog.close();
        } else if (event.target.closest('[data-fs-confirm]')) {
          const reason = dialog.querySelector('#fsReason').value;
          if (!reason) {
            dialog.querySelector('#fsError').textContent = 'Choose a reason.';
            return;
          }
          result = reason;
          dialog.close();
        }
      });
      dialog.addEventListener('close', () => {
        dialog.remove();
        resolve(result);
      });
      document.body.appendChild(dialog);
      dialog.showModal();
    });
  }

  document.addEventListener('change', async (event) => {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement)) return;
    const warrantyMatch = /^(jc[a-z]+?)(FinalWarrantyStatus|CustomerType)$/.exec(select.id);
    if (warrantyMatch) {
      refreshOutcomeCharge(warrantyMatch[1]);
      return;
    }
    const match = /^(jc[a-z]+?)(JobFinalStatus|FinalStatus)$/.exec(select.id);
    if (!match) return;
    const prefix = match[1];
    refreshFinalStatusReason(prefix);
    if (match[2] === 'JobFinalStatus') {
      refreshOutcomeCharge(prefix);
      return;
    }
    const final = $(`#${prefix}FinalStatus`);
    if (!final.value) return;
    if (final.value === 'Delivered') {
      const date = $(`#${prefix}DeliveryDate`);
      if (date && !date.value) {
        date.value = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(
          new Date(),
        );
      }
    }
    if (salesChannelMissing(prefix)) {
      await notifyDialog(
        'Choose the sales channel',
        'This job is billed to the sales channel (AED 60). Choose the Sales channel, or the Bill to channel under Warranty and billing, before delivering it.',
      );
      final.value = '';
      refreshFinalStatusReason(prefix);
      highlightMissingForDelivery(prefix);
      return;
    }
    const field = $(`#${prefix}FinalStatusReasonField`);
    if (field && !field.hidden && !$(`#${prefix}FinalStatusReason`).value) {
      const reason = await askFinalStatusReason(
        $(`#${prefix}FinalStatusWarning`)?.textContent ||
          'Choose why this job is being delivered back.',
      );
      if (reason) {
        $(`#${prefix}FinalStatusReason`).value = reason;
      } else {
        final.value = '';
        refreshFinalStatusReason(prefix);
      }
    }
  });

  function fillJobCardForm(prefix, content) {
    $(`#${prefix}Date`).value = (content.jobCardDate || '').slice(0, 10);
    $(`#${prefix}CustomerName`).value = content.customerName || '';
    $(`#${prefix}CustomerContact`).value = content.customerContact || '';
    $(`#${prefix}CustomerAddress`).value = content.customerAddress || '';
    $(`#${prefix}ItemDescription`).value = content.itemDescription || '';
    $(`#${prefix}ModelNo`).value = content.modelNo || '';
    $(`#${prefix}Brand`).value = content.brand || '';
    $(`#${prefix}MainGroup`).value = content.mainGroup || '';
    $(`#${prefix}GroupName`).value = content.groupName || '';
    $(`#${prefix}SubGroup`).value = content.subGroup || '';
    $(`#${prefix}SerialNo`).value = content.serialNo || '';
    $(`#${prefix}PurchaseDate`).value = content.purchaseDate
      ? content.purchaseDate.slice(0, 10)
      : '';
    refreshWarrantyDaysPill(prefix);
    markMasterFields(prefix, []);
    $(`#${prefix}ItemCode`).value = content.itemCode || '';
    [
      `#${prefix}ModelNo`,
      `#${prefix}Brand`,
      `#${prefix}ItemDescription`,
      `#${prefix}MainGroup`,
      `#${prefix}GroupName`,
      `#${prefix}SubGroup`,
    ].forEach((selector) => {
      const input = $(selector);
      input.classList.remove('sm-filled');
      input.removeAttribute('title');
      input.closest('.field')?.classList.remove('sm-autofilled');
    });
    setItemPickerState($(`#${prefix}ModelNo`), content.itemInMaster ?? null, content.itemCode);
    $(`#${prefix}WarrantyStatus`).value = content.warrantyStatus || '';
    $(`#${prefix}TechnicianName`).value = content.technicianName || '';
    populateSelectOptions(
      `#${prefix}Salesman`,
      salesmenOptions,
      'Select a salesman',
      content.salesman || '',
    );
    populateSelectOptions(
      `#${prefix}SalesChannel`,
      salesChannelOptions,
      'Select a sales channel',
      content.salesChannel || '',
    );
    $(`#${prefix}Complaint`).value = content.complaint || '';
    $(`#${prefix}ServiceRendered`).value = content.serviceRendered || '';
    $(`#${prefix}PeriodFrom`).value = toDateTimeLocal(
      content.periodFrom || (prefix === 'jce' ? '' : new Date()),
    );
    $(`#${prefix}PeriodTo`).value = toDateTimeLocal(content.periodTo);
    $(`#${prefix}ServiceCharge`).value = content.serviceCharge || 0;
    $(`#${prefix}AmountChargeable`).value = content.amountChargeable ?? '';
    $(`#${prefix}DeliveryDate`).value = content.deliveryDate
      ? content.deliveryDate.slice(0, 10)
      : '';
    $(`#${prefix}JobFinalStatus`).value = content.jobFinalStatus || 'WIP';
    $(`#${prefix}FinalStatus`).value = content.finalStatus || '';
    $(`#${prefix}FinalStatusReason`).value = content.finalStatusReason || '';
    refreshFinalStatusReason(prefix);
    $(`#${prefix}FinalWarrantyStatus`).value = content.finalWarrantyStatus || '';
    $(`#${prefix}WarrantyOverrideReason`).value = content.warrantyOverrideReason || '';
    $(`#${prefix}PaymentBy`).value = content.paymentBy || '';
    refreshOutcomeCharge(prefix);
    populateSelectOptions(
      `#${prefix}BillToChannel`,
      salesChannelOptions,
      'Auto (billing rule / sales channel)',
      content.billToOverridden ? content.billToChannel || '' : '',
    );
    const invoiceBox = $(`#${prefix}InvoiceBox`);
    invoiceBox.dataset.portalNo = content.portalInvoiceNo || '';
    invoiceBox.dataset.confirmed = content.paymentConfirmedAt ? '1' : '';
    invoiceBox.dataset.jobId = prefix === 'jce' && content.id ? String(content.id) : '';
    refreshBillingPreview(prefix);
    $(`#${prefix}SchoolContactPerson`).value = content.schoolContactPerson || '';
    $(`#${prefix}SchoolContactNumber`).value = content.schoolContactNumber || '';
    $(`#${prefix}CustomerNumber`).value = content.customerNumber || '';
    $(`#${prefix}CustomerType`).value = content.customerType || '';
    $(`#${prefix}CustomerEmail`).value = content.customerEmail || '';
    $(`#${prefix}Region`).value = content.region || '';
    $(`#${prefix}B2bBranchSchool`).value = content.b2bBranchSchool || '';
    $(`#${prefix}SalesOrderNumber`).value = content.salesOrderNumber || '';
    $(`#${prefix}LegacyReference`).value = content.legacyReference || '';
    jobCardPartsState[prefix] = (content.parts || []).map((part) => ({
      partNo: part.partNo || '',
      description: part.description || '',
      qty: part.qty || 0,
      unitPrice: part.unitPrice || 0,
    }));
    renderJobCardParts(prefix);
    calcJobCardTimeConsumed(prefix);
  }

  function collectJobCardForm(prefix) {
    return {
      jobCardDate: $(`#${prefix}Date`).value || undefined,
      customerName: $(`#${prefix}CustomerName`).value.trim() || undefined,
      customerContact: $(`#${prefix}CustomerContact`).value.trim() || undefined,
      customerAddress: $(`#${prefix}CustomerAddress`).value.trim() || undefined,
      itemDescription: $(`#${prefix}ItemDescription`).value.trim() || undefined,
      modelNo: $(`#${prefix}ModelNo`).value.trim() || undefined,
      brand: $(`#${prefix}Brand`).value.trim() || undefined,
      mainGroup: $(`#${prefix}MainGroup`).value.trim() || undefined,
      groupName: $(`#${prefix}GroupName`).value.trim() || undefined,
      subGroup: $(`#${prefix}SubGroup`).value.trim() || undefined,
      serialNo: $(`#${prefix}SerialNo`).value.trim() || undefined,
      purchaseDate: $(`#${prefix}PurchaseDate`).value || undefined,
      itemCode: $(`#${prefix}ItemCode`).value.trim() || undefined,
      itemInMaster: readItemInMaster($(`#${prefix}ModelNo`)),
      warrantyStatus: $(`#${prefix}WarrantyStatus`).value.trim() || undefined,
      technicianName: $(`#${prefix}TechnicianName`).value.trim() || undefined,
      salesman: $(`#${prefix}Salesman`).value.trim() || undefined,
      salesChannel: $(`#${prefix}SalesChannel`).value.trim() || undefined,
      complaint: $(`#${prefix}Complaint`).value.trim() || undefined,
      serviceRendered: $(`#${prefix}ServiceRendered`).value.trim() || undefined,
      periodFrom: $(`#${prefix}PeriodFrom`).value || undefined,
      periodTo: $(`#${prefix}PeriodTo`).value || undefined,
      parts: jobCardPartsState[prefix].map((part) => ({
        partNo: part.partNo,
        description: part.description,
        qty: parseNumber(part.qty),
        unitPrice: parseNumber(part.unitPrice),
      })),
      serviceCharge: parseNumber($(`#${prefix}ServiceCharge`).value),
      amountChargeable: $(`#${prefix}AmountChargeable`).value
        ? parseNumber($(`#${prefix}AmountChargeable`).value)
        : undefined,
      deliveryDate: $(`#${prefix}DeliveryDate`).value || undefined,
      jobFinalStatus: $(`#${prefix}JobFinalStatus`).value || undefined,
      finalStatus: $(`#${prefix}FinalStatus`).value || null,
      finalStatusReason: $(`#${prefix}FinalStatusReason`).value || null,
      finalWarrantyStatus: $(`#${prefix}FinalWarrantyStatus`).value || undefined,
      warrantyOverrideReason: $(`#${prefix}WarrantyOverrideReason`).value.trim() || undefined,
      paymentBy: $(`#${prefix}PaymentBy`).value || undefined,
      billToChannel: $(`#${prefix}BillToChannel`).value,
      schoolContactPerson: $(`#${prefix}SchoolContactPerson`).value.trim() || undefined,
      schoolContactNumber: $(`#${prefix}SchoolContactNumber`).value.trim() || undefined,
      customerNumber: $(`#${prefix}CustomerNumber`).value.trim() || undefined,
      customerType: $(`#${prefix}CustomerType`).value || undefined,
      customerEmail: $(`#${prefix}CustomerEmail`).value.trim() || undefined,
      region: $(`#${prefix}Region`).value || undefined,
      b2bBranchSchool: $(`#${prefix}B2bBranchSchool`).value.trim() || undefined,
      salesOrderNumber: $(`#${prefix}SalesOrderNumber`).value.trim() || undefined,
      legacyReference: $(`#${prefix}LegacyReference`).value.trim() || undefined,
    };
  }

  // ---- Quotations & Inspections (Phase 5 -- docs/DEVELOPMENT_PLAN.md).
  // Same field-template-plus-generic-table approach as the job card forms
  // above. Neither entity has a workflow-lock status in the live system, so
  // there's a single always-editable form per record instead of a status
  // action panel.
  let currentQuotationId = null;
  let currentQuotation = null;
  let currentInspectionId = null;
  let currentInspection = null;

  function quotationFieldsHtml(prefix) {
    return `
      <div class="field-grid">
        <div class="field"><label for="${prefix}Date">Quotation date</label><input type="date" id="${prefix}Date"></div>
        <div class="field"><label for="${prefix}CustomerName">Customer name</label><input type="text" id="${prefix}CustomerName" maxlength="200"></div>
        <div class="field"><label for="${prefix}ContactNumber">Contact number</label><input type="text" id="${prefix}ContactNumber" maxlength="50"></div>
        <div class="field"><label for="${prefix}ProjectName">Project name ${tipHtml('Start typing to pick a school or branch from the B2B Branch / School master; only the name is filled in. You can also type any other project name.')}</label><input type="text" id="${prefix}ProjectName" maxlength="200" list="${prefix}ProjectList" autocomplete="off"><datalist id="${prefix}ProjectList"></datalist></div>
        <div class="field"><label for="${prefix}SiteLocation">Site / location</label><input type="text" id="${prefix}SiteLocation" maxlength="500"></div>
        <div class="field"><label for="${prefix}DateOfCollection">Date of collection</label><input type="date" id="${prefix}DateOfCollection"></div>
        <div class="field"><label for="${prefix}TechnicianName">Technician</label><input type="text" id="${prefix}TechnicianName" maxlength="120"></div>
        <div class="field"><label for="${prefix}WarrantyStatus">Warranty status ${tipHtml('The service job warranty status. Out-of-warranty approval requests raised from this quotation pull it in automatically.')}</label><select id="${prefix}WarrantyStatus"><option value="">Select</option><option>In Warranty</option><option>Out Warranty</option></select></div>
      </div>
      <div class="field"><label for="${prefix}CustomerComplaint">Customer complaint</label><textarea id="${prefix}CustomerComplaint" maxlength="10000"></textarea></div>
      <div class="field"><label for="${prefix}TechnicalDiagnosis">Technical diagnosis</label><textarea id="${prefix}TechnicalDiagnosis" maxlength="10000"></textarea></div>
      <h5>Products</h5>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Part no.</th><th>Description</th><th>Qty</th><th>Unit price (AED)</th><th>Total</th><th></th></tr></thead>
          <tbody id="${prefix}ProductsBody"></tbody>
        </table>
      </div>
      <button class="button button-outline" type="button" id="${prefix}AddProductButton">Add product</button>
      <h5>Parts</h5>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Part no.</th><th>Description</th><th>Qty</th><th>Unit price (AED)</th><th>Total</th><th></th></tr></thead>
          <tbody id="${prefix}PartsBody"></tbody>
        </table>
      </div>
      <button class="button button-outline" type="button" id="${prefix}AddPartButton">Add part</button>
      <div class="field-grid">
        <div class="field"><label for="${prefix}LabourAmount">Labour (AED)</label><input type="number" step="0.01" min="0" id="${prefix}LabourAmount"></div>
        <div class="field"><label for="${prefix}GrandTotal">Grand total (AED)</label><input type="text" id="${prefix}GrandTotal" readonly></div>
      </div>
      <div class="field-grid">
        <div class="field"><label for="${prefix}PreparedBy">Prepared by</label><input type="text" id="${prefix}PreparedBy" maxlength="120"></div>
        <div class="field"><label for="${prefix}PreparedDate">Prepared date</label><input type="date" id="${prefix}PreparedDate"></div>
        <div class="field"><label for="${prefix}ApprovedBy">Approved by</label><input type="text" id="${prefix}ApprovedBy" maxlength="120"></div>
        <div class="field"><label for="${prefix}ApprovedDate">Approved date</label><input type="date" id="${prefix}ApprovedDate"></div>
      </div>
      <div class="field-grid">
        <div class="field"><label for="${prefix}CustomerSignature">Customer signature (name)</label><input type="text" id="${prefix}CustomerSignature" maxlength="200"></div>
        <div class="field"><label for="${prefix}SignatureDate">Signature date</label><input type="date" id="${prefix}SignatureDate"></div>
        <div class="field"><label for="${prefix}LegacyReference">Legacy reference</label><input type="text" id="${prefix}LegacyReference" maxlength="120" placeholder="Reference from the old system, if any"></div>
      </div>
    `;
  }

  // Project name type-ahead: suggests names from the B2B Branch / School master.
  // Only the name is used; anything typed that is not in the master is kept as is.
  function attachProjectNameLookup(prefix) {
    const input = $(`#${prefix}ProjectName`);
    const list = $(`#${prefix}ProjectList`);
    if (!input || !list) return;
    let timer = null;
    let seq = 0;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const term = input.value.trim();
      if (term.length < 2) {
        list.innerHTML = '';
        return;
      }
      timer = setTimeout(async () => {
        const mine = ++seq;
        try {
          const result = await apiRequest('/api/b2b-branches?query=' + encodeURIComponent(term));
          if (mine !== seq) return;
          list.innerHTML = (result.branches || [])
            .map(
              (branch) =>
                `<option value="${escapeHtml(branch.branchName)}" label="${escapeHtml(branch.branchName)} (${escapeHtml(branch.custCode)})"></option>`,
            )
            .join('');
        } catch {
          list.innerHTML = '';
        }
      }, 250);
    });
  }

  function initQuotationForm(prefix) {
    attachProjectNameLookup(prefix);
    lineItemsState[`${prefix}Products`] = [];
    lineItemsState[`${prefix}Parts`] = [];
    const recalc = () => {
      const products = lineItemsState[`${prefix}Products`];
      const parts = lineItemsState[`${prefix}Parts`];
      const lineTotal = [...products, ...parts].reduce(
        (sum, item) => sum + (item.qty || 0) * (item.unitPrice || 0),
        0,
      );
      const labour = parseNumber($(`#${prefix}LabourAmount`).value);
      $(`#${prefix}GrandTotal`).value = money(lineTotal + labour);
    };
    $(`#${prefix}AddProductButton`).addEventListener('click', () => {
      lineItemsState[`${prefix}Products`].push({
        partNo: '',
        description: '',
        qty: 1,
        unitPrice: 0,
      });
      renderLineItemsTable(`${prefix}Products`, `${prefix}ProductsBody`, recalc, true);
    });
    $(`#${prefix}AddPartButton`).addEventListener('click', () => {
      lineItemsState[`${prefix}Parts`].push({ partNo: '', description: '', qty: 1, unitPrice: 0 });
      renderLineItemsTable(`${prefix}Parts`, `${prefix}PartsBody`, recalc);
    });
    $(`#${prefix}LabourAmount`).addEventListener('input', recalc);
    renderLineItemsTable(`${prefix}Products`, `${prefix}ProductsBody`, recalc, true);
    renderLineItemsTable(`${prefix}Parts`, `${prefix}PartsBody`, recalc);
  }

  function fillQuotationForm(prefix, q) {
    $(`#${prefix}Date`).value = (q.quotationDate || '').slice(0, 10);
    $(`#${prefix}CustomerName`).value = q.customerName || '';
    $(`#${prefix}ContactNumber`).value = q.contactNumber || '';
    $(`#${prefix}ProjectName`).value = q.projectName || '';
    $(`#${prefix}SiteLocation`).value = q.siteLocation || '';
    $(`#${prefix}DateOfCollection`).value = (q.dateOfCollection || '').slice(0, 10);
    $(`#${prefix}TechnicianName`).value = q.technicianName || '';
    $(`#${prefix}CustomerComplaint`).value = q.customerComplaint || '';
    $(`#${prefix}TechnicalDiagnosis`).value = q.technicalDiagnosis || '';
    $(`#${prefix}WarrantyStatus`).value = q.warrantyStatus || '';
    $(`#${prefix}LabourAmount`).value = q.labourAmount || 0;
    $(`#${prefix}PreparedBy`).value = q.preparedBy || '';
    $(`#${prefix}PreparedDate`).value = (q.preparedDate || '').slice(0, 10);
    $(`#${prefix}ApprovedBy`).value = q.approvedBy || '';
    $(`#${prefix}ApprovedDate`).value = (q.approvedDate || '').slice(0, 10);
    $(`#${prefix}CustomerSignature`).value = q.customerSignature || '';
    $(`#${prefix}SignatureDate`).value = (q.signatureDate || '').slice(0, 10);
    $(`#${prefix}LegacyReference`).value = q.legacyReference || '';
    const recalc = () => {
      const products = lineItemsState[`${prefix}Products`];
      const parts = lineItemsState[`${prefix}Parts`];
      const lineTotal = [...products, ...parts].reduce(
        (sum, item) => sum + (item.qty || 0) * (item.unitPrice || 0),
        0,
      );
      const labour = parseNumber($(`#${prefix}LabourAmount`).value);
      $(`#${prefix}GrandTotal`).value = money(lineTotal + labour);
    };
    lineItemsState[`${prefix}Products`] = (q.products || []).map((item) => ({
      partNo: item.partNo || '',
      description: item.description || '',
      qty: item.qty || 0,
      unitPrice: item.unitPrice || 0,
    }));
    lineItemsState[`${prefix}Parts`] = (q.parts || []).map((item) => ({
      partNo: item.partNo || '',
      description: item.description || '',
      qty: item.qty || 0,
      unitPrice: item.unitPrice || 0,
    }));
    renderLineItemsTable(`${prefix}Products`, `${prefix}ProductsBody`, recalc, true);
    renderLineItemsTable(`${prefix}Parts`, `${prefix}PartsBody`, recalc);
  }

  function collectQuotationForm(prefix) {
    return {
      quotationDate: $(`#${prefix}Date`).value || undefined,
      customerName: $(`#${prefix}CustomerName`).value.trim() || undefined,
      contactNumber: $(`#${prefix}ContactNumber`).value.trim() || undefined,
      projectName: $(`#${prefix}ProjectName`).value.trim() || undefined,
      siteLocation: $(`#${prefix}SiteLocation`).value.trim() || undefined,
      dateOfCollection: $(`#${prefix}DateOfCollection`).value || undefined,
      technicianName: $(`#${prefix}TechnicianName`).value.trim() || undefined,
      customerComplaint: $(`#${prefix}CustomerComplaint`).value.trim() || undefined,
      technicalDiagnosis: $(`#${prefix}TechnicalDiagnosis`).value.trim() || undefined,
      warrantyStatus: $(`#${prefix}WarrantyStatus`).value || undefined,
      products: lineItemsState[`${prefix}Products`].map((item) => ({
        partNo: item.partNo,
        description: item.description,
        qty: parseNumber(item.qty),
        unitPrice: parseNumber(item.unitPrice),
      })),
      parts: lineItemsState[`${prefix}Parts`].map((item) => ({
        partNo: item.partNo,
        description: item.description,
        qty: parseNumber(item.qty),
        unitPrice: parseNumber(item.unitPrice),
      })),
      labourAmount: parseNumber($(`#${prefix}LabourAmount`).value),
      preparedBy: $(`#${prefix}PreparedBy`).value.trim() || undefined,
      preparedDate: $(`#${prefix}PreparedDate`).value || undefined,
      approvedBy: $(`#${prefix}ApprovedBy`).value.trim() || undefined,
      approvedDate: $(`#${prefix}ApprovedDate`).value || undefined,
      customerSignature: $(`#${prefix}CustomerSignature`).value.trim() || undefined,
      signatureDate: $(`#${prefix}SignatureDate`).value || undefined,
      legacyReference: $(`#${prefix}LegacyReference`).value.trim() || undefined,
    };
  }

  function inspectionFieldsHtml(prefix) {
    return `
      <div class="field-grid">
        <div class="field"><label for="${prefix}Date">Inspection date</label><input type="date" id="${prefix}Date"></div>
        <div class="field"><label for="${prefix}CustomerName">Customer name</label><input type="text" id="${prefix}CustomerName" maxlength="200"></div>
        <div class="field"><label for="${prefix}ContactNumber">Contact number</label><input type="text" id="${prefix}ContactNumber" maxlength="50"></div>
        <div class="field"><label for="${prefix}ProjectName">Project name ${tipHtml('Start typing to pick a school or branch from the B2B Branch / School master; only the name is filled in. You can also type any other project name.')}</label><input type="text" id="${prefix}ProjectName" maxlength="200" list="${prefix}ProjectList" autocomplete="off"><datalist id="${prefix}ProjectList"></datalist></div>
        <div class="field"><label for="${prefix}SiteLocation">Site / location</label><input type="text" id="${prefix}SiteLocation" maxlength="500"></div>
        <div class="field"><label for="${prefix}DateOfCollection">Date of collection</label><input type="date" id="${prefix}DateOfCollection"></div>
        <div class="field"><label for="${prefix}TechnicianName">Technician</label><input type="text" id="${prefix}TechnicianName" maxlength="120"></div>
        <div class="field"><label for="${prefix}WarrantyStatus">Warranty status ${tipHtml('The service job warranty status. Out-of-warranty approval requests raised from a quotation or job pull it in automatically.')}</label><select id="${prefix}WarrantyStatus"><option value="">Select</option><option>In Warranty</option><option>Out Warranty</option></select></div>
      </div>
      <div class="field"><label for="${prefix}CustomerComplaint">Customer complaint</label><textarea id="${prefix}CustomerComplaint" maxlength="10000"></textarea></div>
      <div class="field"><label for="${prefix}VisualFindings">Visual findings</label><textarea id="${prefix}VisualFindings" maxlength="10000"></textarea></div>
      <div class="field"><label for="${prefix}TechnicalDiagnosis">Technical diagnosis</label><textarea id="${prefix}TechnicalDiagnosis" maxlength="10000"></textarea></div>
      <div class="field"><label for="${prefix}RecommendedAction">Recommended action</label><textarea id="${prefix}RecommendedAction" maxlength="10000"></textarea></div>
      <h5>Products</h5>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Part no.</th><th>Description</th><th>Qty</th><th>Unit price (AED)</th><th>Total</th><th></th></tr></thead>
          <tbody id="${prefix}ProductsBody"></tbody>
        </table>
      </div>
      <button class="button button-outline" type="button" id="${prefix}AddProductButton">Add product</button>
      <h5>Faulty parts</h5>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Part no.</th><th>Description</th><th>Qty</th><th>Unit price (AED)</th><th>Total</th><th></th></tr></thead>
          <tbody id="${prefix}FaultyPartsBody"></tbody>
        </table>
      </div>
      <button class="button button-outline" type="button" id="${prefix}AddFaultyPartButton">Add faulty part</button>
      <div class="field-grid">
        <div class="field"><label for="${prefix}RefQuotationNo">Ref. quotation no.</label><input type="text" id="${prefix}RefQuotationNo" maxlength="120"></div>
        <div class="field"><label for="${prefix}EstRepairCost">Est. repair cost (AED)</label><input type="number" step="0.01" min="0" id="${prefix}EstRepairCost"></div>
      </div>
      <div class="field-grid">
        <div class="field"><label for="${prefix}InspectedBy">Inspected by</label><input type="text" id="${prefix}InspectedBy" maxlength="120"></div>
        <div class="field"><label for="${prefix}InspectedDate">Inspected date</label><input type="date" id="${prefix}InspectedDate"></div>
        <div class="field"><label for="${prefix}ReviewedBy">Reviewed by</label><input type="text" id="${prefix}ReviewedBy" maxlength="120"></div>
        <div class="field"><label for="${prefix}ReviewedDate">Reviewed date</label><input type="date" id="${prefix}ReviewedDate"></div>
      </div>
      <div class="field-grid">
        <div class="field"><label for="${prefix}CustomerSignature">Customer signature (name)</label><input type="text" id="${prefix}CustomerSignature" maxlength="200"></div>
        <div class="field"><label for="${prefix}SignatureDate">Signature date</label><input type="date" id="${prefix}SignatureDate"></div>
        <div class="field"><label for="${prefix}LegacyReference">Legacy reference</label><input type="text" id="${prefix}LegacyReference" maxlength="120" placeholder="Reference from the old system, if any"></div>
      </div>
    `;
  }

  function initInspectionForm(prefix) {
    attachProjectNameLookup(prefix);
    lineItemsState[`${prefix}Products`] = [];
    lineItemsState[`${prefix}FaultyParts`] = [];
    $(`#${prefix}AddProductButton`).addEventListener('click', () => {
      lineItemsState[`${prefix}Products`].push({
        partNo: '',
        description: '',
        qty: 1,
        unitPrice: 0,
      });
      renderLineItemsTable(`${prefix}Products`, `${prefix}ProductsBody`, () => {}, true);
    });
    $(`#${prefix}AddFaultyPartButton`).addEventListener('click', () => {
      lineItemsState[`${prefix}FaultyParts`].push({
        partNo: '',
        description: '',
        qty: 1,
        unitPrice: 0,
      });
      renderLineItemsTable(`${prefix}FaultyParts`, `${prefix}FaultyPartsBody`, () => {});
    });
    renderLineItemsTable(`${prefix}Products`, `${prefix}ProductsBody`, () => {}, true);
    renderLineItemsTable(`${prefix}FaultyParts`, `${prefix}FaultyPartsBody`, () => {});
  }

  function fillInspectionForm(prefix, i) {
    $(`#${prefix}Date`).value = (i.inspectionDate || '').slice(0, 10);
    $(`#${prefix}CustomerName`).value = i.customerName || '';
    $(`#${prefix}ContactNumber`).value = i.contactNumber || '';
    $(`#${prefix}ProjectName`).value = i.projectName || '';
    $(`#${prefix}SiteLocation`).value = i.siteLocation || '';
    $(`#${prefix}DateOfCollection`).value = (i.dateOfCollection || '').slice(0, 10);
    $(`#${prefix}TechnicianName`).value = i.technicianName || '';
    const warrantySelect = $(`#${prefix}WarrantyStatus`);
    if (
      i.warrantyStatus &&
      ![...warrantySelect.options].some((o) => o.value === i.warrantyStatus)
    ) {
      warrantySelect.add(new Option(i.warrantyStatus, i.warrantyStatus));
    }
    warrantySelect.value = i.warrantyStatus || '';
    $(`#${prefix}CustomerComplaint`).value = i.customerComplaint || '';
    $(`#${prefix}VisualFindings`).value = i.visualFindings || '';
    $(`#${prefix}TechnicalDiagnosis`).value = i.technicalDiagnosis || '';
    $(`#${prefix}RecommendedAction`).value = i.recommendedAction || '';
    $(`#${prefix}RefQuotationNo`).value = i.refQuotationNo || '';
    $(`#${prefix}EstRepairCost`).value = i.estRepairCost ?? '';
    $(`#${prefix}InspectedBy`).value = i.inspectedBy || '';
    $(`#${prefix}InspectedDate`).value = (i.inspectedDate || '').slice(0, 10);
    $(`#${prefix}ReviewedBy`).value = i.reviewedBy || '';
    $(`#${prefix}ReviewedDate`).value = (i.reviewedDate || '').slice(0, 10);
    $(`#${prefix}CustomerSignature`).value = i.customerSignature || '';
    $(`#${prefix}SignatureDate`).value = (i.signatureDate || '').slice(0, 10);
    $(`#${prefix}LegacyReference`).value = i.legacyReference || '';
    lineItemsState[`${prefix}Products`] = (i.products || []).map((item) => ({
      partNo: item.partNo || '',
      description: item.description || '',
      qty: item.qty || 0,
      unitPrice: item.unitPrice || 0,
    }));
    lineItemsState[`${prefix}FaultyParts`] = (i.faultyParts || []).map((item) => ({
      partNo: item.partNo || '',
      description: item.description || '',
      qty: item.qty || 0,
      unitPrice: item.unitPrice || 0,
    }));
    renderLineItemsTable(`${prefix}Products`, `${prefix}ProductsBody`, () => {}, true);
    renderLineItemsTable(`${prefix}FaultyParts`, `${prefix}FaultyPartsBody`, () => {});
  }

  function collectInspectionForm(prefix) {
    return {
      inspectionDate: $(`#${prefix}Date`).value || undefined,
      customerName: $(`#${prefix}CustomerName`).value.trim() || undefined,
      contactNumber: $(`#${prefix}ContactNumber`).value.trim() || undefined,
      projectName: $(`#${prefix}ProjectName`).value.trim() || undefined,
      siteLocation: $(`#${prefix}SiteLocation`).value.trim() || undefined,
      dateOfCollection: $(`#${prefix}DateOfCollection`).value || undefined,
      technicianName: $(`#${prefix}TechnicianName`).value.trim() || undefined,
      warrantyStatus: $(`#${prefix}WarrantyStatus`).value || undefined,
      customerComplaint: $(`#${prefix}CustomerComplaint`).value.trim() || undefined,
      visualFindings: $(`#${prefix}VisualFindings`).value.trim() || undefined,
      technicalDiagnosis: $(`#${prefix}TechnicalDiagnosis`).value.trim() || undefined,
      recommendedAction: $(`#${prefix}RecommendedAction`).value.trim() || undefined,
      products: lineItemsState[`${prefix}Products`].map((item) => ({
        partNo: item.partNo,
        description: item.description,
        qty: parseNumber(item.qty),
        unitPrice: parseNumber(item.unitPrice),
      })),
      faultyParts: lineItemsState[`${prefix}FaultyParts`].map((item) => ({
        partNo: item.partNo,
        description: item.description,
        qty: parseNumber(item.qty),
        unitPrice: parseNumber(item.unitPrice),
      })),
      refQuotationNo: $(`#${prefix}RefQuotationNo`).value.trim() || undefined,
      estRepairCost: $(`#${prefix}EstRepairCost`).value
        ? parseNumber($(`#${prefix}EstRepairCost`).value)
        : undefined,
      inspectedBy: $(`#${prefix}InspectedBy`).value.trim() || undefined,
      inspectedDate: $(`#${prefix}InspectedDate`).value || undefined,
      reviewedBy: $(`#${prefix}ReviewedBy`).value.trim() || undefined,
      reviewedDate: $(`#${prefix}ReviewedDate`).value || undefined,
      customerSignature: $(`#${prefix}CustomerSignature`).value.trim() || undefined,
      signatureDate: $(`#${prefix}SignatureDate`).value || undefined,
      legacyReference: $(`#${prefix}LegacyReference`).value.trim() || undefined,
    };
  }

  // ---- Print views (Phase 5 -- docs/DEVELOPMENT_PLAN.md: "Add print views
  // and legacy-reference preservation"). Builds a clean, self-contained
  // printable document from already-loaded detail data and opens it in a
  // new tab so the browser's own Print/Save-as-PDF dialog produces a clean
  // page -- no server round trip or auth header needed in the new tab,
  // matching the live system's per-document "Print / PDF" buttons. Each
  // document also shows its optional legacy reference (see
  // packages/db/migrations/008_print_legacy_reference.sql) alongside this
  // project's own auto-generated reference.
  function printDocumentShell(title, bodyHtml) {
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; font-size: 12px; margin: 0; padding: 12px; }
  .doc-head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #17324d; padding-bottom: 10px; margin-bottom: 14px; }
  .doc-head .company { font-size: 17px; font-weight: 700; color: #17324d; }
  .doc-head .title { font-size: 13px; color: #444; margin-top: 2px; }
  .doc-head .ref { text-align: right; }
  .doc-head .ref strong { display: block; font-size: 15px; }
  .doc-head .legacy-ref { font-size: 11px; color: #666; margin-top: 2px; }
  .doc-head .printed-at { font-size: 10px; color: #888; margin-top: 6px; }
  h2 { font-size: 12.5px; margin: 16px 0 6px; border-bottom: 1px solid #bbb; padding-bottom: 3px; color: #17324d; }
  .doc-head .logo { height: 46px; width: auto; display: block; margin-bottom: 4px; }
  ol { margin: 4px 0 10px; padding-left: 20px; }
  li { margin-bottom: 4px; }
  .cert-feebox { background: #17324d; color: #fff; padding: 10px 14px; border-radius: 6px; margin: 10px 0; }
  .cert-feebox .fee { font-size: 22px; font-weight: 800; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 3px 24px; margin-bottom: 8px; }
  .grid .item span.label { display: block; font-size: 9.5px; color: #666; text-transform: uppercase; letter-spacing: .03em; }
  .grid .item span.value { display: block; font-size: 12px; }
  .block-label { font-size: 9.5px; color: #666; text-transform: uppercase; letter-spacing: .03em; margin-bottom: 2px; }
  .block { white-space: pre-wrap; font-size: 12px; border: 1px solid #ddd; padding: 6px 8px; border-radius: 4px; background: #fafafa; margin-bottom: 10px; min-height: 1em; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  th, td { border: 1px solid #ccc; padding: 4px 6px; font-size: 11px; text-align: left; }
  th { background: #f0f2f5; }
  td.num, th.num { text-align: right; }
  .totals { width: 260px; margin-left: auto; border-collapse: collapse; }
  .totals td { border: none; padding: 2px 6px; font-size: 12px; }
  .totals td.num { text-align: right; }
  .totals tr.grand td { font-weight: 700; border-top: 1.5px solid #17324d; padding-top: 4px; }
  .sign-row { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 32px; }
  .sign-box { border-top: 1px solid #333; padding-top: 4px; font-size: 11px; color: #444; }
  @media print { .no-print { display: none !important; } }
</style>
</head>
<body>
${bodyHtml}
<p class="no-print" style="margin-top:20px;color:#888;font-size:11px;">This window opened for printing / Save as PDF -- use your browser's print dialog.</p>
</body>
</html>`;
  }

  function printFieldGrid(pairs) {
    return `<div class="grid">${pairs
      .map(
        ([label, value]) =>
          `<div class="item"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value || '\u2014')}</span></div>`,
      )
      .join('')}</div>`;
  }

  function printTextBlock(label, value) {
    return `<div class="block-label">${escapeHtml(label)}</div><div class="block">${escapeHtml(value || '\u2014')}</div>`;
  }

  function printLineItemsTable(items, withPrices = true) {
    if (!withPrices) {
      const plain = (items || [])
        .map(
          (item) =>
            `<tr><td>${escapeHtml(item.partNo || '')}</td><td>${escapeHtml(item.description || '')}</td><td class="num">${escapeHtml(String(item.qty ?? 0))}</td></tr>`,
        )
        .join('');
      return `<table><thead><tr><th>Part no.</th><th>Description</th><th class="num">Qty</th></tr></thead><tbody>${
        plain || '<tr><td colspan="3" style="text-align:center;color:#888;">No parts used</td></tr>'
      }</tbody></table>`;
    }
    const rows = (items || [])
      .map(
        (item) =>
          `<tr><td>${escapeHtml(item.partNo || '')}</td><td>${escapeHtml(item.description || '')}</td><td class="num">${escapeHtml(String(item.qty ?? 0))}</td><td class="num">${money(item.unitPrice || 0)}</td><td class="num">${money((item.qty || 0) * (item.unitPrice || 0))}</td></tr>`,
      )
      .join('');
    return `<table><thead><tr><th>Part no.</th><th>Description</th><th class="num">Qty</th><th class="num">Unit price (AED)</th><th class="num">Total (AED)</th></tr></thead><tbody>${
      rows || '<tr><td colspan="5" style="text-align:center;color:#888;">No line items</td></tr>'
    }</tbody></table>`;
  }

  // Every printed document carries the JDI logo (same artwork as the portal
  // header); the company-name argument is kept for the callers' signature.
  function printDocHead(_companyTitle, docTitle, reference, legacyReference) {
    return `<div class="doc-head">
      <div>
        <img class="logo" src="${JDI_LOGO_DATA_URI}" alt="Jacky's Distribution LLC" />
        <div class="title">${escapeHtml(docTitle)}</div>
      </div>
      <div class="ref">
        <strong>${escapeHtml(reference || '\u2014')}</strong>
        ${legacyReference ? `<div class="legacy-ref">Legacy ref: ${escapeHtml(legacyReference)}</div>` : ''}
        <div class="printed-at">Printed ${escapeHtml(formatDate(new Date().toISOString()))}</div>
      </div>
    </div>`;
  }

  // Certificate print header carrying the JDI logo -- every OTHER printed
  // document (job card / quotation / inspection) keeps printDocHead()'s
  // text-only header unchanged; only the VAS sale certificate uses this
  // one (modification.md #35, item e).
  function printDocHeadWithLogo(docTitle, reference) {
    return `<div class="doc-head">
      <div>
        <img class="logo" src="${JDI_LOGO_DATA_URI}" alt="Jacky's Distribution LLC" />
        <div class="title">${escapeHtml(docTitle)}</div>
      </div>
      <div class="ref">
        <strong>${escapeHtml(reference || '\u2014')}</strong>
        <div class="printed-at">Printed ${escapeHtml(formatDate(new Date().toISOString()))}</div>
      </div>
    </div>`;
  }

  function buildVasCertificateBody(sale, depreciation) {
    const plan = VAS_CALC_PLANS.find((p) => p.key === sale.planKey);
    const content = VAS_PLAN_CONTENT[sale.planKey] || VAS_PLAN_CONTENT.ew1;
    const dep = depreciation && depreciation.length === 3 ? depreciation : [0.25, 0.4, 0.55];
    const exclusions = vasCertificateExclusions(sale.planKey);
    const planLabel = (plan && plan.label) || sale.vasProduct;
    return `
      ${printDocHeadWithLogo(planLabel + ' \u2014 Terms & Conditions Certificate', sale.vasSaleReference)}
      <h2>Certificate &amp; customer details</h2>
      ${printFieldGrid([
        ['Customer name', sale.customerName],
        ['Contact number', sale.contactNumber],
        ['Address / Emirates', sale.address],
        ['Invoice number', sale.invoiceNumber],
        ['Purchase date', sale.purchaseDate],
        ['Item code', sale.itemCode],
        ['Item description', sale.itemDescription],
        ['VAS plan', sale.vasProduct],
        ['Selling price (AED)', money(sale.sellingPrice)],
        ['Plan fee (AED)', money(sale.planFee)],
        ['Contract ref.', sale.contractRef || sale.vasSaleReference],
      ])}
      <h2>The plan &amp; cover</h2>
      ${printTextBlock('Cover', content.cover)}
      <p style="font-size:12px;"><strong>Territorial limit:</strong> United Arab Emirates.</p>
      <h2>Exclusions &mdash; this plan does not cover</h2>
      <ol>${exclusions.map((text) => `<li>${escapeHtml(text)}</li>`).join('')}</ol>
      <h2>Limit of liability</h2>
      <p style="font-size:12px;">The total repair cost payable shall not exceed the purchase price of the appliance. If repair cost (parts + labour) equals or exceeds the market price, Jacky's may treat the appliance as a total loss and compensate with a similar unit after applying the depreciation scale below.</p>
      <h2>Basis of claim settlement</h2>
      <table><thead><tr><th>Depreciation</th><th>Year 1</th><th>Year 2</th><th>Year 3</th></tr></thead>
      <tbody><tr><td>% of purchase price deducted</td><td>${Math.round(dep[0] * 100)}%</td><td>${Math.round(dep[1] * 100)}%</td><td>${Math.round(dep[2] * 100)}%</td></tr></tbody></table>
      <p style="font-size:12px;"><strong>Deductible:</strong> ${money(sale.deductible || 0)} AED per claim. <strong>Service fee:</strong> ${escapeHtml(String(sale.serviceFeeText || '\u2014'))}.</p>
      <h2>Claims process</h2>
      <ol>
        <li>Check the manufacturer's instructions and confirm controls are properly set.</li>
        <li>Report the incident within 2 days of occurrence and within the Plan Period.</li>
        <li>Call Jacky's Service or email the Service Department to proceed with the claim.</li>
        <li>Provide the original purchase receipt and this certificate.</li>
        <li>The faulty appliance is collected from your doorstep, or delivered to a Jacky's authorized service centre.</li>
        <li>Repairs are carried out only by Jacky's nominated authorized service centres; in-home service for large appliances.</li>
        <li>On completion, the appliance is returned to you or you are notified to collect it.</li>
        <li>If not covered, you will be charged for the repair cost should you agree to proceed.</li>
      </ol>
      <h2>Cancellations &amp; refund schedule</h2>
      <p style="font-size:12px;"><strong>Fraud:</strong> a false or fraudulent claim cancels this plan from inception without return of the plan fee, and all claim payments received must be returned. <strong>Refund:</strong> applies only if cancelled before any claim, calculated from the date of purchase.</p>
      <table><thead><tr><th>Month 1</th><th>Month 2</th><th>Month 3</th><th>Month 4</th><th>Month 5</th><th>Month 6</th><th>Month 7</th><th>Month 8</th></tr></thead>
      <tbody><tr><td>100%</td><td>70%</td><td>60%</td><td>50%</td><td>40%</td><td>30%</td><td>10%</td><td>5%</td></tr></tbody></table>
      <div class="cert-feebox">
        <div class="fee">${money(sale.planFee)} AED</div>
        <div>${escapeHtml(sale.vasProduct)} plan fee${sale.bandLabel ? ' \u2014 band ' + escapeHtml(sale.bandLabel) : ''}</div>
      </div>
      <h2>Signatures</h2>
      <p style="font-size:11px;color:#444;">By signing below, the customer confirms they have read, understood and accepted these Terms &amp; Conditions and that the appliance was in full working order at the time of purchase.</p>
      <div class="sign-row">
        <div class="sign-box">Customer name / signature / date</div>
        <div class="sign-box">Jacky's Distribution LLC (Service Dept.) &mdash; name / signature / date</div>
      </div>
      <p style="font-size:9.5px;color:#777;font-style:italic;margin-top:16px;">This document is issued by Jacky's Distribution LLC Service Department, governed by the laws of the United Arab Emirates. This is a service plan sold directly by Jacky's &mdash; it is not an insurance policy issued by an insurance company. Jacky's reserves the right to amend these Terms &amp; Conditions; amendments will not reduce cover for plans already activated.</p>
    `;
  }

  function printVasSaleCertificate(sale, depreciation) {
    if (!sale) return;
    const plan = VAS_CALC_PLANS.find((p) => p.key === sale.planKey);
    const title = `${(plan && plan.label) || sale.vasProduct} Certificate ${sale.vasSaleReference || ''}`;
    openPrintWindow(printDocumentShell(title, buildVasCertificateBody(sale, depreciation)));
  }

  // Per-plan coverage text for the AMC contract certificate (modification.md
  // #38, "Issue an AMC Contract -- Customer Certificate"), ported verbatim
  // from docs/index_sep_15.html's updateAMCContractUI(). Keyed by the same
  // plan keys the AMC Quote Calculator computes (basic-rm / standard-pmc /
  // premium-pmc), so a reprint always finds the exact plan's text by key.
  // Fallback coverage text for each plan key (modification.md #38/#39),
  // used only if a saved record's plan entry has no coverage/coverageDetail
  // of its own (older data, or a client-side preview before save).
  // `included`/`notIncluded` are the Contract Quotation sheet's section 4
  // "Service Scope" wording, ported verbatim (modification.md #41).
  const AMC_CONTRACT_PLAN_FALLBACKS = {
    'basic-rm': {
      label: 'Basic RM',
      coverage: 'Reactive maintenance only',
      coverageDetail: 'No spare parts included; reactive visits based on the approved quote.',
      included:
        'Technical diagnosis and troubleshooting, preventive cleaning and functional checks, minor adjustments, tightening and calibration where applicable, and labor for the listed RM services.',
      notIncluded:
        'Replacement parts, major repairs, compressor or sealed-system work, refrigerant/gas recharge or leak repair, cosmetic damage, consumables, and damage caused by misuse, power events, water, fire, corrosion or unauthorized repair.',
    },
    'standard-pmc': {
      label: 'Standard PMC',
      coverage: 'Standard coverage with minor parts',
      coverageDetail: 'Planned visits plus minor parts (filters, belts, seals).',
      included:
        'Scheduled preventive maintenance, inspection, cleaning, functional checks, troubleshooting, corrective-service labor, and minor routine service parts such as filters, belts, seals/gaskets, clamps and fasteners, subject to inspection, availability and the listed appliance schedule.',
      notIncluded:
        'Major mechanical/electrical components, compressor or sealed-system work, refrigerant/gas, PCB/control boards, motors, pumps, heating elements, glass, cosmetic items, consumables, and damage caused by misuse or external causes.',
    },
    'premium-pmc': {
      label: 'Premium PMC',
      coverage: 'Comprehensive coverage with parts',
      coverageDetail: 'Planned visits plus mechanical parts except compressor.',
      included:
        'All Standard PMC services plus covered mechanical replacement parts commonly used for the listed home and kitchen appliances, subject to inspection, availability and normal AMC conditions.',
      notIncluded:
        'Compressor or sealed-system work, refrigerant/gas, PCB/control boards and other electronic assemblies, glass/cosmetic parts, consumables, pre-existing or abuse-related damage, and work outside the listed appliances. Special or high-value components not expressly covered are separately quoted.',
    },
  };

  // Section 7 "GENERAL TERMS AND CONDITIONS" from the Contract Quotation
  // sheet, ported verbatim -- mandatory on every AMC print regardless of
  // which plan is selected (modification.md #41).
  const AMC_GENERAL_TERMS_AND_CONDITIONS = [
    'Service Request Process: All service requests must be logged through the Jacky’s Distribution helpdesk by phone or email.',
    'Response Time: Valid service requests will be acknowledged and registered promptly. Standard service calls will be attended to within 24–48 hours subject to site access, working hours, and service team availability.',
    'Spare Parts: Major spare parts and consumables are excluded under a standard labor-only AMC unless covered under a comprehensive plan. Where required, a quotation will be submitted for client approval prior to replacement.',
    'Client’s Responsibility: The client shall ensure the appliances are used as per the manufacturer’s instructions and are accessible for service.',
    'Limitation of Liability: Jacky’s Distribution shall not be liable for losses, delays, or damages arising from misuse, unauthorized repair, external causes, force majeure events, or circumstances beyond its reasonable control. Liability under this agreement is limited to the services expressly stated herein.',
    'Contract Validity: This agreement shall remain valid for one year from the commencement date. Renewal, extension, or amendment shall be subject to written confirmation by both parties.',
    'Site Access and Safety: The client shall provide reasonable access to the equipment and ensure that the service area is safe and available for maintenance work at the scheduled time.',
    'Working Hours: Standard service support will be provided during normal business working hours, excluding public holidays, unless otherwise agreed in writing.',
    'Out-of-Scope Work: Any work outside the agreed scope, including unlisted appliances, additional visits, relocation, installation changes, or third-party damage rectification, will be quoted separately for client approval.',
    'Governing Terms: This quotation and any resulting AMC shall be governed by the mutually accepted commercial terms stated herein and the applicable laws of the United Arab Emirates.',
  ];

  function printAmcApplianceTable(appliances) {
    const rows = (appliances || [])
      .map(
        (a) =>
          `<tr><td>${escapeHtml(a.name)}</td><td class="num">${escapeHtml(String(a.qty))}</td><td class="num">${money(a.price)} AED</td><td class="num">${money(a.qty * a.price)} AED</td></tr>`,
      )
      .join('');
    return `<table><thead><tr><th>Appliance type</th><th class="num">Qty</th><th class="num">Unit selling price</th><th class="num">Total equipment value</th></tr></thead><tbody>${
      rows || '<tr><td colspan="4" style="text-align:center;color:#888;">No appliances</td></tr>'
    }</tbody></table>`;
  }

  // Builds the certificate body for exactly one plan of a saved AMC
  // contract (modification.md #39 -- a saved contract carries all 3
  // computed plans; the plan to print is picked afterwards, per print, so
  // this always takes the specific `plan` entry to print, not the whole
  // contract).
  function buildAmcContractCertificateBody(contract, plan) {
    const fallback =
      AMC_CONTRACT_PLAN_FALLBACKS[plan.planKey] || AMC_CONTRACT_PLAN_FALLBACKS['premium-pmc'];
    const planLabel = plan.planLabel || fallback.label;
    const vat = Number(plan.priceInclVat) - Number(plan.priceExclVat);
    return `
      ${printDocHeadWithLogo('Annual Maintenance Contract', contract.amcContractReference)}
      <h2>Contract details</h2>
      ${printFieldGrid([
        ['Contract date', contract.contractDate],
        ['Contract period', contract.contractPeriod],
        ['Client', contract.clientName],
        ['Attention to', contract.attentionTo],
        ['Site / location', contract.siteLocation],
        ['Commencement date', contract.commencementDate],
        ['Contract ref.', contract.contractRef || contract.amcContractReference],
      ])}
      <h2>Approved service plan</h2>
      ${printFieldGrid([
        ['Selected plan', planLabel],
        ['Visits', plan.visitsText || `${plan.annualVisits} visits/year`],
        ['Coverage / basis', plan.coverage || fallback.coverage],
        ['Plan coverage', plan.coverageDetail || fallback.coverageDetail],
        ['Contract value incl. VAT', money(plan.priceInclVat) + ' AED'],
      ])}
      <h2>Service Scope &mdash; Inclusions &amp; Exclusions</h2>
      <p style="font-size:12px;"><strong>Plan:</strong> ${escapeHtml(planLabel)}</p>
      ${printTextBlock('Included', plan.included || fallback.included)}
      ${printTextBlock('Not included / separately quoted', plan.notIncluded || fallback.notIncluded)}
      <p style="font-size:11px;color:#555;"><strong>Coverage note:</strong> Coverage applies only to the appliances listed in this quotation and is subject to inspection, parts availability, fair-use conditions and the approved AMC terms. Parts and work not expressly included above require separate approval.</p>
      <h2>Appliance schedule covered under this AMC</h2>
      ${printAmcApplianceTable(contract.appliances)}
      <h2>Service inclusions</h2>
      <p style="font-size:12px;"><strong>Planned Preventive Maintenance:</strong> Scheduled visits as per the approved plan, including inspection, cleaning, functional checks and performance verification.</p>
      <p style="font-size:12px;"><strong>Corrective Maintenance:</strong> Valid breakdown calls attended within 24&ndash;48 hours from logging, subject to site access, fault condition and parts availability.</p>
      <p style="font-size:12px;"><strong>Labor Coverage:</strong> Labor for covered repair, service and maintenance activities is included during the contract period unless otherwise stated in the approved plan.</p>
      <h2>Service exclusions</h2>
      <p style="font-size:12px;">Major spare parts, consumables, cosmetic parts and compressor are excluded unless specifically covered under the selected plan.</p>
      <p style="font-size:12px;">Damage due to misuse, negligence, external causes, power surge, fire, flood, unauthorized repair or force majeure is excluded.</p>
      <p style="font-size:12px;">Appliances not listed in the appliance schedule are outside this AMC. Out-of-scope work, relocation, installation changes or additional visits will be quoted separately.</p>
      <h2>General Terms and Conditions</h2>
      <ul style="font-size:11.5px;margin:0 0 0 18px;padding:0;">
        ${AMC_GENERAL_TERMS_AND_CONDITIONS.map((term) => `<li style="margin-bottom:4px;">${escapeHtml(term)}</li>`).join('')}
      </ul>
      <h2>Payment terms and validity</h2>
      <p style="font-size:12px;"><strong>Payment Terms:</strong> 100% payment in advance is required against the selected AMC plan before service commencement. Services will commence only after receipt of the signed acceptance, confirmed purchase order where applicable, and full advance payment.</p>
      <p style="font-size:12px;">Prices are in AED and include 5% VAT where shown. This AMC is valid for one year from commencement unless renewed or amended in writing by both parties.</p>
      <h2>Customer confirmation</h2>
      ${printFieldGrid([
        ['Approved plan', planLabel],
        ['Excl. VAT', money(plan.priceExclVat) + ' AED'],
        ['VAT @ 5%', money(vat) + ' AED'],
        ['Incl. VAT', money(plan.priceInclVat) + ' AED'],
        ['Total appliances', String(contract.totalCount)],
        ['Total equipment value', money(contract.totalValue) + ' AED'],
      ])}
      <div class="cert-feebox">
        <div class="fee">${money(plan.priceInclVat)} AED</div>
        <div>${escapeHtml(planLabel)} &mdash; contract value incl. VAT</div>
      </div>
      <h2>Signatures</h2>
      <p style="font-size:11px;color:#444;">By signing below, the client confirms acceptance of the selected AMC plan, scope, pricing, payment terms, exclusions and general terms stated in this agreement &amp; contract.</p>
      <div class="sign-row">
        <div class="sign-box">For Jacky's Distribution LLC &mdash; name / designation / date / signature &amp; company stamp</div>
        <div class="sign-box">For Client Acceptance &mdash; name / designation / date / signature &amp; company stamp (if applicable)</div>
      </div>
      <p style="font-size:9.5px;color:#777;font-style:italic;margin-top:16px;">This document is issued by Jacky's Distribution LLC Service Department, governed by the laws of the United Arab Emirates. Jacky's reserves the right to amend these Terms &amp; Conditions; amendments will not reduce cover for contracts already commenced.</p>
    `;
  }

  // Prints exactly one plan from a saved AMC contract -- `planKey` picks
  // which of the contract's saved `plans` entries to print (modification.md
  // #39). Falls back to the first saved plan if the key doesn't match.
  function printAmcContractCertificate(contract, planKey) {
    if (!contract || !contract.plans || !contract.plans.length) return;
    const plan = contract.plans.find((p) => p.planKey === planKey) || contract.plans[0];
    const title = `${plan.planLabel} AMC Contract ${contract.amcContractReference || ''}`;
    openPrintWindow(printDocumentShell(title, buildAmcContractCertificateBody(contract, plan)));
  }

  // Tax invoice print, laid out like the ERP sample: Jacky's Electronics LLC letterhead
  // with the JDI logo, the company TRN (always), the customer TRN (only when entered),
  // VAT split lines, and the fixed system-generated note, bank details and terms.
  const COMPANY_TRN = '100268906300003';

  function printTaxInvoice(invoice) {
    const dmy = (iso) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
      return m ? `${m[3]}/${m[2]}/${m[1]}` : '-';
    };
    const dash = (value) => escapeHtml(value || '-');
    const lines = (invoice.lines || [])
      .map(
        (l) => `<tr>
          <td class="c">${l.sno}</td><td>${escapeHtml(l.itemCode)}</td><td>${escapeHtml(l.description)}</td>
          <td class="c">${escapeHtml(l.uom)}</td><td class="n">${l.qty}</td><td class="n">${money(l.rate)}</td>
          <td class="n">${money(l.value)}</td><td class="c">${l.taxRate}%</td><td class="n">${money(l.vat)}</td><td class="n">${money(l.amount)}</td></tr>`,
      )
      .join('');
    const totals = invoice.totals || { net: 0, vat: 0, gross: 0 };
    const invoiceDate = dmy(invoice.invoiceDate);
    // Terms and conditions, English and Arabic side by side (modelled on a service
    // receipt of a comparable company). Static text: nothing here comes from user input.
    const termsRows = [
      [
        '<strong>Out of Warranty Service Charges:</strong> For Out of Warranty Service, we shall provide Estimate Quote applicable for the repair of Unit for your approval. 30% (+or-) variation is allowed in the estimate, and we shall conclude the repair without further approval from you. Actual charges shall be charged at the time of collection of the Unit. <strong>If you do not wish to proceed with the repair after you receive the Estimate Quote for Repair, a handling charge of AED 60 (inclusive of VAT) will be applicable and upon payment, the Unit shall be returned to you.</strong>',
        '<strong>رسوم الصيانة خارج الضمان:</strong> بالنسبة لرسوم الصيانة خارج الضمان، سنوافيك بعرض أسعار تقديري للإصلاحات اللازمة للوحدة للحصول على موافقتك، مع إمكانية اختلاف السعر النهائي بنسبة 30% (أكثر أو أقل من) من المبلغ التقديري، وسنجري بعد ذلك الإصلاح دون طلب موافقة أخرى منك. وستُحتسب الرسوم الفعلية عند استلام الوحدة. <strong>حال عدم رغبتك في مباشرة الإصلاح بعد استلام عرض الأسعار التقديري للإصلاحات، ستُطبَّق رسوم مناولة قدرها 60 درهمًا شاملة ضريبة القيمة المضافة، وتُرد الوحدة إليك بعد سدادها.</strong>',
      ],
      [
        '<strong>Secure your Data:</strong> You must secure your Data by taking BACKUP and delete the same from Unit prior to handing over the Unit for repair. We shall not be held liable for data loss and/or data leak during the repair.',
        '<strong>تأمين بياناتك:</strong> يتعين عليك تأمين بياناتك بالاحتفاظ بنسخة احتياطية منها وحذف بياناتك من الوحدة قبل تسليمها لإصلاحها، ولن نتحمل مسؤولية فقد و/أو تسريب أي بيانات أثناء الإصلاح.',
      ],
      [
        '<strong>Record Accessories in the Service Slip:</strong> We do not collect accessories along with the Unit unless it is required for examination of the Unit. You should ensure to record all accessories handed over to us in the Service Slip, failing which, we may be unable to honor your claim for accessories at a later stage.',
        '<strong>تسجيل الملحقات في إيصال الصيانة:</strong> لا نتسلم أي ملحقات مع الوحدة ما لم تكن لازمة لفحص الوحدة، ويتعين عليك تسجيل جميع الملحقات المسلمة إلينا في إيصال الصيانة، وإلا لن نتمكن من الوفاء بمطالبتك بالملحقات لاحقًا.',
      ],
      [
        '<strong>Collection of Unit:</strong> Please ensure to collect the Unit immediately upon receipt of notification of completion of repair/return of Unit. A storage charge @ AED 2/- per day shall be charged after one month of notification. We shall store your Units for a maximum period of 3 months from the date of notification of completion of repair / return of Unit. If you fail to collect the Unit within this period, we shall dispose of such Units without further notification and without any liability for compensation payable to you.',
        '<strong>استلام الوحدة:</strong> يُرجى التأكد من استلام الوحدة فور استلام إخطار بالانتهاء من الإصلاح/ إعادة الوحدة، وستحتسب رسوم تخزين قدرها 2 درهم لكل يوم بعد مضي شهر واحد من تاريخ الإخطار. سنحتفظ بوحداتك لمدة 3 أشهر بحد أقصى من تاريخ الإخطار بانتهاء الإصلاح/ إعادة الوحدة، وإذا لم تتسلم الوحدة خلال هذه المدة، سنتخلص من تلك الوحدات دون إخطار آخر ودون تحمل مسؤولية تعويضك.',
      ],
      [
        "<strong>Warranty on workmanship:</strong> The Warranty on Unit shall be subject to the brand/supplier warranty provided at the time of your purchase of Unit. Jacky's Electronics LLC does not provide any warranty in addition to the warranty provided the brand/supplier.",
        '<strong>ضمان المصنعية:</strong> يخضع ضمان الوحدة لضمان العلامة التجارية/ المورد المقدم وقت شرائك الوحدة، ولا تقدم جاكيز للإلكترونيات ذ.م.م أي ضمان بالإضافة إلى ضمان العلامة التجارية/ المورد.',
      ],
      [
        'The Unit will be returned against payment of Service charges. We shall have a right of lien on the Unit against the service charges.',
        'تُعاد الوحدة بعد دفع رسوم الصيانة، ولنا حق امتياز على الوحدة فيما يتعلق برسوم الصيانة.',
      ],
      [
        '<strong>Limited Service workmanship warranty:</strong> We provide 30 days limited warranty against our <u>workmanship</u> on all products (90 days for consumer electronics product). However, this limited warranty shall not be applicable for spare parts used for such repair. If spare parts need to be replaced, you shall be responsible for payment for such spare parts.',
        '<strong>ضمان محدود لمصنعية الصيانة:</strong> نقدم لك ضمان محدود لمدة 30 يومًا عن <u>مصنعيتنا</u> لجميع المنتجات (90 يومًا للإلكترونيات الاستهلاكية)، ولا يشمل هذا الضمان المحدود قطع الغيار المستخدمة في الإصلاحات، فحال الحاجة إلى استبدال قطع الغيار، ستتحمل تكلفة تلك القطع.',
      ],
    ]
      .map(
        ([en, ar], i) =>
          `<tr><td class="tn">${i + 1}.</td><td class="te">${en}</td><td class="ta" dir="rtl">${ar}</td><td class="tn ta">-${i + 1}</td></tr>`,
      )
      .join('');
    const row = (label, value) =>
      `<tr><td class="k">${escapeHtml(label)}</td><td class="s">:</td><td>${value}</td></tr>`;
    const left = [
      row('Customer', `<strong>${dash(invoice.customerName)}</strong>`),
      invoice.customerTrn ? row('Customer TRN', escapeHtml(invoice.customerTrn)) : '',
      row('Customer Code', dash(invoice.customerCode)),
      row('Contact', dash(invoice.contact)),
      row('Payment Term', dash(invoice.paymentTerm)),
      row('Salesman', dash(invoice.salesman)),
    ].join('');
    const right = [
      row('Invoice No.', `<strong>${dash(invoice.invoiceNo)}</strong>`),
      row('Invoice Date', invoiceDate),
      row('Ref. Doc.', dash(invoice.jobCardReference)),
      row('Currency Code', 'AED'),
      row('Exge Rate', '1'),
      row('Date of Delivery', dmy(invoice.deliveryDate)),
    ].join('');
    const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(invoice.invoiceNo || 'Tax Invoice')}</title>
<style>
  @page { size: A4; margin: 12mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 11px; margin: 0; padding: 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding-bottom: 8px; border-bottom: 2px solid #17324d; }
  .head img { height: 54px; width: auto; display: block; }
  .co { text-align: right; font-size: 10.5px; line-height: 1.45; color: #333; }
  .co strong { display: block; font-size: 14px; color: #17324d; margin-bottom: 2px; }
  .title { text-align: center; margin: 10px 0 8px; }
  .title h1 { font-size: 18px; margin: 0; letter-spacing: .02em; color: #17324d; }
  .title .trn { font-size: 12px; margin-top: 3px; font-weight: 700; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 0 22px; border: 1px solid #b9c2cc; border-radius: 4px; padding: 6px 10px; }
  .meta table { width: 100%; border-collapse: collapse; }
  .meta td { padding: 2px 3px; vertical-align: top; border: none; font-size: 11px; }
  .meta td.k { width: 34%; color: #555; white-space: nowrap; }
  .meta td.s { width: 3%; color: #555; }
  table.lines { width: 100%; border-collapse: collapse; margin-top: 10px; }
  table.lines th { background: #17324d; color: #fff; font-size: 10px; padding: 5px 4px; border: 1px solid #17324d; text-align: left; }
  table.lines td { border: 1px solid #c7ced6; padding: 5px 4px; vertical-align: top; }
  .n { text-align: right; white-space: nowrap; } .c { text-align: center; white-space: nowrap; }
  table.lines th.n { text-align: right; } table.lines th.c { text-align: center; }
  .sum { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-top: 8px; }
  .words { flex: 1; font-size: 11px; }
  .words strong { display: block; margin-bottom: 4px; }
  table.tot { width: 250px; border-collapse: collapse; }
  table.tot td { padding: 3px 6px; font-size: 11.5px; }
  table.tot tr.g td { font-weight: 700; border-top: 1.5px solid #17324d; font-size: 12.5px; }
  .remarks { margin-top: 8px; font-size: 11px; }
  .sign { display: flex; justify-content: space-between; gap: 20px; margin-top: 12px; align-items: flex-end; }
  .sign .blk { width: 42%; }
  .sign .line { border-top: 1px solid #333; margin-top: 38px; padding-top: 3px; text-align: center; font-size: 10.5px; }
  .ack { text-align: right; font-size: 10.5px; color: #333; width: 52%; }
  .sysnote { text-align: center; font-style: italic; margin: 12px 0 8px; font-size: 11px; }
  .bank { border-top: 1px solid #b9c2cc; padding-top: 6px; }
  .bank table { border-collapse: collapse; width: 100%; }
  .bank td { padding: 2px 3px; font-size: 10.5px; vertical-align: top; }
  .bank td.k { width: 22%; color: #555; }
  table.terms { width: 100%; border-collapse: collapse; margin-top: 0; break-before: page; page-break-before: always; font-size: 8.6px; line-height: 1.35; color: #222; page-break-inside: auto; }
  table.terms th, table.terms td { border: 1px solid #9aa5b1; padding: 3px 5px; vertical-align: top; }
  table.terms th { background: #eef2f7; font-size: 9px; text-align: left; }
  table.terms tr { page-break-inside: avoid; }
  table.terms .tn { width: 3%; text-align: center; font-weight: 700; }
  table.terms .te { width: 48%; text-align: justify; }
  table.terms .ta { width: 46%; text-align: right; }
  table.terms th.ta { text-align: right; }
  .foot { margin-top: 8px; font-size: 9px; color: #777; text-align: right; }
  .no-print { margin-top: 14px; color: #888; font-size: 11px; }
  @media print { .no-print { display: none !important; } }
</style></head><body>
<div class="head">
  <img src="${JDI_LOGO_DATA_URI}" alt="Jacky's Electronics LLC" />
  <div class="co"><strong>Jacky's Electronics LLC</strong>
    P.O Box:13745, Suites No: 607 &amp; 608, Level 6, ENBD Tower,<br>
    Baniyas Square, Deira. Dubai, United Arab Emirates.<br>
    Ph: +971 4 336 1695<br>
    Email: service@jackys.com &middot; http://www.jackyselectronics.com</div>
</div>
<div class="title"><h1>Tax Invoice (<bdi dir="rtl">فاتورة ضريبية</bdi>)</h1><div class="trn">TRN: ${COMPANY_TRN}</div></div>
<div class="meta"><table>${left}</table><table>${right}</table></div>
<table class="lines"><thead><tr><th class="c">SNo</th><th>Item Code</th><th>Item Desc</th><th class="c">UOM</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">Value</th><th class="c">Tax Rate</th><th class="n">VAT Amt.</th><th class="n">Amount</th></tr></thead>
<tbody>${lines}</tbody></table>
<div class="sum">
  <div class="words"><strong>Amount in Words : ${escapeHtml(invoice.amountInWords || '')}</strong></div>
  <table class="tot">
    <tr><td>Total Before VAT :</td><td class="n">${money(totals.net)}</td></tr>
    <tr><td>VAT Amount :</td><td class="n">${money(totals.vat)}</td></tr>
    <tr class="g"><td>Total Amount :</td><td class="n">${money(totals.gross)}</td></tr>
  </table>
</div>
<div class="remarks"><strong>Remarks :</strong> ${escapeHtml(invoice.remarks || '')}</div>
<div class="sign">
  <div class="blk"><strong>For Jacky&rsquo;s Electronics LLC</strong><div class="line">Authorised Signatory</div></div>
  <div class="ack">The above items received in good condition<br>and agreed to the terms &amp; conditions printed below
    <div class="line" style="margin-left:auto;width:70%">Received By</div></div>
</div>
<div class="sysnote">&ldquo;This is system generated invoice. No need of signature and stamp.&rdquo;</div>
<div class="bank"><table>
  <tr><td class="k">A/C Payee in favour of :</td><td>Jacky\`s Electronics LLC</td><td><strong>** Payment for this invoice is due on ${dmy(invoice.dueDate)}</strong></td></tr>
  <tr><td class="k">Bank :</td><td>Habib Bank AG Zurich, Dubai, UAE</td><td>Swift: HBZUAEADXXX</td></tr>
  <tr><td class="k">IBAN Details (AED) :</td><td colspan="2">AE18 0290 1203 1110 5178 162</td></tr>
</table></div>
<table class="terms"><thead><tr><th colspan="2" class="te">TERMS AND CONDITIONS</th><th colspan="2" class="ta" dir="rtl">الشروط والأحكام:</th></tr></thead><tbody>${termsRows}</tbody></table>
<div class="foot">Printed ${escapeHtml(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dubai' }))}</div>
<p class="no-print">This window opened for printing / Save as PDF &mdash; use your browser's print dialog.</p>
</body></html>`;
    openPrintWindow(html);
  }

  function openPrintWindow(html) {
    // No 'noopener' here: this window only ever gets same-origin,
    // app-generated content written into it via document.write below, so
    // there is no untrusted page for noopener to protect against -- and
    // modern Chromium returns null from window.open() whenever 'noopener'
    // is set, which made this silently no-op for every real user (caught by
    // a Playwright print test, not manual testing).
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      setMessage(
        '#workspaceMessage',
        'Your browser blocked the print window -- please allow pop-ups for this site and try again.',
      );
      return;
    }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.addEventListener('load', () => printWindow.print());
  }

  // Small "which copy?" chooser used before printing. Resolves to the chosen
  // value, or null when the user cancels.
  function askPrintVariant(title, choices) {
    return new Promise((resolve) => {
      const dialog = document.createElement('dialog');
      dialog.className = 'pw-dialog print-choice';
      dialog.innerHTML =
        `<h3>${escapeHtml(title)}</h3>` +
        choices
          .map(
            (choice) =>
              `<button type="button" class="button button-outline print-choice-option" data-print-choice="${escapeHtml(choice.value)}"><strong>${escapeHtml(choice.label)}</strong><span>${escapeHtml(choice.note)}</span></button>`,
          )
          .join('') +
        '<div class="form-footer"><button type="button" class="button" data-print-cancel>Cancel</button></div>';
      let result = null;
      dialog.addEventListener('click', (event) => {
        const option = event.target.closest('[data-print-choice]');
        if (option) {
          result = option.dataset.printChoice;
          dialog.close();
        } else if (event.target.closest('[data-print-cancel]')) {
          dialog.close();
        }
      });
      dialog.addEventListener('close', () => {
        dialog.remove();
        resolve(result);
      });
      document.body.appendChild(dialog);
      dialog.showModal();
    });
  }

  // variant 'internal': the full job card with parts prices, charges and billing
  // (for the sales team and accounts). variant 'customer': the copy handed to
  // the customer (B2C or B2B) -- no amounts, prices, billing or sales details.
  function printJobCard(jobCard, variant = 'internal') {
    if (!jobCard) return;
    const customerCopy = variant === 'customer';
    const internalOnly = (pairs) => (customerCopy ? [] : pairs);
    const body = `
      ${printDocHead("Jacky's Distribution LLC", customerCopy ? 'Service Job Card \u2014 Customer copy' : 'Service Job Card', jobCard.jobCardReference, jobCard.legacyReference)}
      <h2>Job details</h2>
      ${printFieldGrid([
        ['Appointment ref.', jobCard.appointmentReference],
        ['Source', jobCard.sourceType],
        ['Job card date', jobCard.jobCardDate],
        ['Customer name', jobCard.customerName],
        ['Customer contact', jobCard.customerContact],
        ['Customer address', jobCard.customerAddress],
        ['Item description', jobCard.itemDescription],
        ['Model no.', jobCard.modelNo],
        ['Brand', jobCard.brand],
        ['Main group / group', [jobCard.mainGroup, jobCard.groupName].filter(Boolean).join(' / ')],
        ['Sub group', jobCard.subGroup],
        ['Serial number', jobCard.serialNo],
        ['Purchase date', jobCard.purchaseDate],
        ['Accessories received', jobCard.accessoriesReceived],
        ['Condition at drop-off', jobCard.conditionNotes],
        ['Warranty status', jobCard.warrantyStatus],
        ['Final warranty status', jobCard.finalWarrantyStatus],
        ...internalOnly([
          ['Job type', jobCard.billingJobType],
          ['Payment by', jobCard.paymentBy],
        ]),
        ['Technician', jobCard.technicianName],
        ...internalOnly([
          ['Salesman', jobCard.salesman],
          ['Sales channel', jobCard.salesChannel],
        ]),
        ['Job status', jobCard.jobFinalStatus],
        ['Final status', jobCard.finalStatus || 'Open'],
      ])}
      ${printTextBlock('Complaint', jobCard.complaint)}
      ${printTextBlock('Service rendered', jobCard.serviceRendered)}
      <h2>Parts used</h2>
      ${printLineItemsTable(jobCard.parts, !customerCopy)}
      ${
        customerCopy
          ? ''
          : `<table class="totals">
        <tr><td>Total cost (AED)</td><td class="num">${money(jobCard.totalCost || 0)}</td></tr>
        <tr><td>Service charge (AED)</td><td class="num">${money(jobCard.serviceCharge || 0)}</td></tr>
        <tr class="grand"><td>Grand total (AED)</td><td class="num">${money(jobCard.grandTotal || 0)}</td></tr>
        ${jobCard.amountChargeable != null ? `<tr><td>Amount chargeable (AED)</td><td class="num">${money(jobCard.amountChargeable)}</td></tr>` : ''}
      </table>`
      }
      <h2>${customerCopy ? 'Delivery' : 'Invoice / delivery'}</h2>
      ${printFieldGrid([
        ...internalOnly([['Invoice no.', jobCard.portalInvoiceNo || jobCard.invoiceNo]]),
        ['Delivery date', jobCard.deliveryDate],
        ['Time consumed (hours)', jobCard.timeConsumedHours],
        ['Site contact person', jobCard.schoolContactPerson],
        ['Site contact number', jobCard.schoolContactNumber],
        ['Customer number', jobCard.customerNumber],
        ['Customer type', jobCard.customerType],
        ['Region', jobCard.region],
        ['B2B branch / school', jobCard.b2bBranchSchool],
        ...internalOnly([['Sales order no.', jobCard.salesOrderNumber]]),
      ])}
      <div class="sign-row">
        <div class="sign-box">Technician signature</div>
        <div class="sign-box">Customer signature</div>
      </div>
    `;
    openPrintWindow(
      printDocumentShell(
        `Service Job Card ${jobCard.jobCardReference || ''}${customerCopy ? ' (customer copy)' : ''}`,
        body,
      ),
    );
  }

  function printQuotation(quotation) {
    if (!quotation) return;
    const body = `
      ${printDocHead("Jacky's Distribution LLC", 'Quotation', quotation.quotationReference, quotation.legacyReference)}
      <h2>Customer details</h2>
      ${printFieldGrid([
        ['Quotation date', quotation.quotationDate],
        ['Customer name', quotation.customerName],
        ['Contact number', quotation.contactNumber],
        ['Project name', quotation.projectName],
        ['Site / location', quotation.siteLocation],
        ['Date of collection', quotation.dateOfCollection],
        ['Technician', quotation.technicianName],
        ['Warranty status', quotation.warrantyStatus],
      ])}
      ${printTextBlock('Customer complaint', quotation.customerComplaint)}
      ${printTextBlock('Technical diagnosis', quotation.technicalDiagnosis)}
      <h2>Products</h2>
      ${printLineItemsTable(quotation.products)}
      <h2>Spare parts</h2>
      ${printLineItemsTable(quotation.parts)}
      <table class="totals">
        <tr><td>Labour (AED)</td><td class="num">${money(quotation.labourAmount || 0)}</td></tr>
        <tr class="grand"><td>Grand total (AED)</td><td class="num">${money(quotation.grandTotal || 0)}</td></tr>
      </table>
      <h2>Approval</h2>
      ${printFieldGrid([
        ['Prepared by', quotation.preparedBy],
        ['Prepared date', quotation.preparedDate],
        ['Approved by', quotation.approvedBy],
        ['Approved date', quotation.approvedDate],
      ])}
      <div class="sign-row">
        <div class="sign-box">${escapeHtml(quotation.customerSignature || 'Customer signature')}${quotation.signatureDate ? ` \u2014 ${escapeHtml(quotation.signatureDate)}` : ''}</div>
        <div class="sign-box">Authorized signature</div>
      </div>
    `;
    openPrintWindow(printDocumentShell(`Quotation ${quotation.quotationReference || ''}`, body));
  }

  function printInspection(inspection) {
    if (!inspection) return;
    const body = `
      ${printDocHead("Jacky's Distribution LLC", 'Inspection Report', inspection.inspectionReference, inspection.legacyReference)}
      <h2>Customer details</h2>
      ${printFieldGrid([
        ['Inspection date', inspection.inspectionDate],
        ['Customer name', inspection.customerName],
        ['Contact number', inspection.contactNumber],
        ['Project name', inspection.projectName],
        ['Site / location', inspection.siteLocation],
        ['Date of collection', inspection.dateOfCollection],
        ['Technician', inspection.technicianName],
        ['Warranty status', inspection.warrantyStatus],
      ])}
      ${printTextBlock('Customer complaint', inspection.customerComplaint)}
      ${printTextBlock('Visual findings', inspection.visualFindings)}
      ${printTextBlock('Technical diagnosis', inspection.technicalDiagnosis)}
      ${printTextBlock('Recommended action', inspection.recommendedAction)}
      <h2>Products</h2>
      ${printLineItemsTable(inspection.products)}
      <h2>Faulty parts</h2>
      ${printLineItemsTable(inspection.faultyParts)}
      ${printFieldGrid([
        ['Ref. quotation no.', inspection.refQuotationNo],
        [
          'Est. repair cost (AED)',
          inspection.estRepairCost != null ? money(inspection.estRepairCost) : null,
        ],
      ])}
      <h2>Review</h2>
      ${printFieldGrid([
        ['Inspected by', inspection.inspectedBy],
        ['Inspected date', inspection.inspectedDate],
        ['Reviewed by', inspection.reviewedBy],
        ['Reviewed date', inspection.reviewedDate],
      ])}
      <div class="sign-row">
        <div class="sign-box">${escapeHtml(inspection.customerSignature || 'Customer signature')}${inspection.signatureDate ? ` \u2014 ${escapeHtml(inspection.signatureDate)}` : ''}</div>
        <div class="sign-box">Authorized signature</div>
      </div>
    `;
    openPrintWindow(
      printDocumentShell(`Inspection Report ${inspection.inspectionReference || ''}`, body),
    );
  }

  function renderComplaints(complaints) {
    const body = $('#complaintsBody');
    body.innerHTML = complaints
      .map(
        (complaint) =>
          `<tr><td><button class="table-link" type="button" data-complaint-id="${escapeHtml(complaint.id)}">${escapeHtml(complaint.complaintReference)}</button></td><td><strong>${escapeHtml(complaint.customerName)}</strong><br>${escapeHtml(complaint.contactNumber)}</td><td>${escapeHtml(complaint.description)}</td><td><span class="status ${statusClass(complaint.status)}">${escapeHtml(complaint.status)}</span></td><td>${escapeHtml(formatDate(complaint.submittedAt))}</td></tr>`,
      )
      .join('');
    $('#complaintsEmpty').hidden = complaints.length > 0;
    body
      .querySelectorAll('[data-complaint-id]')
      .forEach((button) =>
        button.addEventListener('click', () => loadComplaintDetail(button.dataset.complaintId)),
      );
  }

  async function loadComplaints() {
    const params = new URLSearchParams({ page: '1', pageSize: '50' });
    const search = $('#complaintSearch').value.trim();
    const status =
      workspaceMode === 'service-requests'
        ? 'Ready for Scheduling'
        : $('#complaintStatusFilter').value;
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    setMessage('#workspaceMessage', '', false);
    $('#complaintsBody').innerHTML =
      '<tr><td colspan="5" class="empty-state">Loading complaints…</td></tr>';
    try {
      const result = await apiRequest('/api/complaints?' + params);
      renderComplaints(result.complaints || []);
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 403) {
        setWorkspaceRecovery('You are not authorized to view complaints.', loadComplaints);
      } else {
        setWorkspaceRecovery(error.message, loadComplaints);
      }
      $('#complaintsBody').innerHTML = '';
    }
  }

  // Filter value for completed appointments that have no job card yet. They
  // are not job cards, so the list switches to /api/job-cards/awaiting.
  const AWAITING_JOB_CARD_FILTER = 'awaiting-job-card';

  // Small badge for the customer type column (B2C / B2B / B2B-SalesChannel).
  function customerTypeBadge(type) {
    if (!type) return '';
    const kind = type === 'B2C' ? 'ctype-b2c' : 'ctype-b2b';
    return `<span class="ctype ${kind}">${escapeHtml(type)}</span>`;
  }

  function renderAwaitingJobCards(appointments) {
    const body = $('#jobCardsBody');
    const canCreate = hasPermission('service_job_card.write');
    body.innerHTML = appointments
      .map((row) => {
        const item = [row.brand, row.model].filter(Boolean).join(' ');
        return `<tr><td>${
          canCreate
            ? `<button class="button button-secondary" type="button" data-create-for="${escapeHtml(row.appointmentId)}">Create job card</button>`
            : '<em>Not created</em>'
        }</td><td><button class="table-link" type="button" data-appointment-id="${escapeHtml(row.appointmentId)}">${escapeHtml(row.appointmentReference)}</button>${row.complaintReference ? '<br><small>' + escapeHtml(row.complaintReference) + '</small>' : ''}</td><td><strong>${escapeHtml(row.customerName)}</strong><br>${escapeHtml(row.contactNumber || '')}${item ? '<br><small>' + escapeHtml(item) + '</small>' : ''}</td><td>${customerTypeBadge(row.customerType)}</td><td>${escapeHtml(formatDate(row.appointmentDate))}${row.technicianName ? '<br><small>' + escapeHtml(row.technicianName) + '</small>' : ''}</td><td><span class="status status-in-progress">Awaiting job card</span></td></tr>`;
      })
      .join('');
    const empty = $('#jobCardsEmpty');
    empty.textContent = 'No completed appointments are waiting for a job card.';
    empty.hidden = appointments.length > 0;
    body.querySelectorAll('[data-appointment-id]').forEach((button) =>
      button.addEventListener('click', () => {
        setWorkspaceMode('appointments');
        loadAppointmentDetail(button.dataset.appointmentId);
      }),
    );
    body.querySelectorAll('[data-create-for]').forEach((button) =>
      button.addEventListener('click', async () => {
        setWorkspaceMode('appointments');
        await loadAppointmentDetail(button.dataset.createFor);
        createJobCard();
      }),
    );
  }

  function renderJobCards(jobCards) {
    const body = $('#jobCardsBody');
    body.innerHTML = jobCards
      .map(
        (jobCard) =>
          `<tr><td><button class="table-link" type="button" data-job-card-id="${escapeHtml(jobCard.id)}">${escapeHtml(jobCard.jobCardReference)}</button></td><td><button class="table-link" type="button" data-appointment-id="${escapeHtml(jobCard.appointmentId)}">${escapeHtml(jobCard.appointmentReference)}</button></td><td><strong>${escapeHtml(jobCard.customerName)}</strong><br>${escapeHtml(jobCard.contactNumber)}</td><td>${customerTypeBadge(jobCard.customerType)}</td><td>${escapeHtml(appointmentDateTime(jobCard))}</td><td><span class="status ${statusClass(jobCard.jobFinalStatus || jobCard.status)}">${escapeHtml(jobCard.jobFinalStatus || jobCard.status)}</span></td><td>${jobCard.finalStatus ? `<span class="status ${statusClass(jobCard.finalStatus)}">${escapeHtml(jobCard.finalStatus)}</span>` : ''}</td></tr>`,
      )
      .join('');
    $('#jobCardsEmpty').textContent = 'No service job cards match the selected filters.';
    $('#jobCardsEmpty').hidden = jobCards.length > 0;
    body
      .querySelectorAll('[data-job-card-id]')
      .forEach((button) =>
        button.addEventListener('click', () => loadJobCardDetail(button.dataset.jobCardId)),
      );
    // Workflow link (see modification.md #5): jump straight to the
    // appointment this job card came from.
    body.querySelectorAll('[data-appointment-id]').forEach((button) =>
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        setWorkspaceMode('appointments');
        loadAppointmentDetail(button.dataset.appointmentId);
      }),
    );
  }

  // ---- Service report (Phase 5 -- docs/DEVELOPMENT_PLAN.md: "Add service
  // reports and operational dashboard summaries"). A CSV export of whatever
  // job-card list is currently on screen -- built entirely client-side from
  // already-loaded data, the same approach the print views use, so it needs
  // no new API endpoint.
  function csvEscape(value) {
    const text = value == null ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function exportJobCardsCsv() {
    if (!lastLoadedJobCards.length) {
      setMessage('#workspaceMessage', 'There are no service job cards to export.');
      return;
    }
    const columns = [
      ['Reference', (jc) => jc.jobCardReference],
      ['Appointment', (jc) => jc.appointmentReference],
      ['Customer', (jc) => jc.customerName],
      ['Contact', (jc) => jc.customerContact],
      ['Status', (jc) => jc.status],
      ['Technician', (jc) => jc.technicianName],
      ['Job status', (jc) => jc.jobFinalStatus],
      ['Final status', (jc) => jc.finalStatus || ''],
      ['Final status reason', (jc) => jc.finalStatusReason || ''],
      ['Total cost (AED)', (jc) => jc.totalCost],
      ['Service charge (AED)', (jc) => jc.serviceCharge],
      ['Grand total (AED)', (jc) => jc.grandTotal],
      ['Created', (jc) => jc.createdAt],
      ['Updated', (jc) => jc.updatedAt],
    ];
    const rows = [
      columns.map(([label]) => csvEscape(label)).join(','),
      ...lastLoadedJobCards.map((jc) => columns.map(([, get]) => csvEscape(get(jc))).join(',')),
    ];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `service-job-cards-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  // Opening the page (setWorkspaceMode) and a dashboard tile (goToJobCardsFiltered)
  // can each start a load; only the newest one may draw, otherwise the slower
  // unfiltered response overwrites the filtered list.
  let jobCardsLoadSeq = 0;
  async function loadJobCards() {
    if (!hasPermission('service_job_card.read')) return;
    const loadSeq = ++jobCardsLoadSeq;
    clearWorkspaceRecovery();
    const params = new URLSearchParams({ page: '1', pageSize: '50' });
    const search = $('#jobCardSearch').value.trim();
    const status = $('#jobCardStatusFilter').value;
    if (search) params.set('search', search);
    const awaiting = status === AWAITING_JOB_CARD_FILTER;
    if (status && !awaiting) params.set('status', status);
    $('#jobCardsBody').innerHTML =
      '<tr><td colspan="7" class="empty-state">Loading service job cards…</td></tr>';
    try {
      if (awaiting) {
        const awaitingResult = await apiRequest('/api/job-cards/awaiting?' + params);
        if (loadSeq !== jobCardsLoadSeq) return;
        lastLoadedJobCards = [];
        renderAwaitingJobCards(awaitingResult.appointments || []);
        return;
      }
      const result = await apiRequest('/api/job-cards?' + params);
      if (loadSeq !== jobCardsLoadSeq) return;
      lastLoadedJobCards = result.jobCards || [];
      renderJobCards(lastLoadedJobCards);
    } catch (error) {
      if (loadSeq !== jobCardsLoadSeq) return;
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 403) {
        setWorkspaceRecovery('You are not authorized to view service job cards.', loadJobCards);
      } else {
        setWorkspaceRecovery(error.message, loadJobCards);
      }
      $('#jobCardsBody').innerHTML = '';
      $('#jobCardsEmpty').hidden = false;
    }
  }

  // ---- Quotations ----
  function renderQuotations(quotations) {
    const body = $('#quotationsBody');
    body.innerHTML = quotations
      .map(
        (q) =>
          `<tr><td><button class="table-link" type="button" data-quotation-id="${escapeHtml(q.id)}">${escapeHtml(q.quotationReference)}</button></td><td>${escapeHtml(q.customerName || '—')}<br>${escapeHtml(q.contactNumber || '')}</td><td>${escapeHtml(q.projectName || '—')}<br>${escapeHtml(q.siteLocation || '')}</td><td>${q.approvalStatus ? `<span class="status ${statusClass(q.approvalStatus)}">${escapeHtml(q.approvalStatus)}</span>` : '—'}</td><td>${escapeHtml(formatDate(q.updatedAt))}</td></tr>`,
      )
      .join('');
    $('#quotationsEmpty').hidden = quotations.length > 0;
    $$('#quotationsBody [data-quotation-id]').forEach((button) =>
      button.addEventListener('click', () => loadQuotationDetail(button.dataset.quotationId)),
    );
  }

  async function loadQuotations() {
    if (!hasPermission('quotation.read')) return;
    clearWorkspaceRecovery();
    const params = new URLSearchParams({ page: '1', pageSize: '50' });
    const search = $('#quotationSearch').value.trim();
    if (search) params.set('search', search);
    $('#quotationsBody').innerHTML =
      '<tr><td colspan="5" class="empty-state">Loading quotations…</td></tr>';
    try {
      const result = await apiRequest('/api/quotations?' + params);
      renderQuotations(result.quotations || []);
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 403) {
        setWorkspaceRecovery('You are not authorized to view quotations.', loadQuotations);
      } else {
        setWorkspaceRecovery(error.message, loadQuotations);
      }
      $('#quotationsBody').innerHTML = '';
      $('#quotationsEmpty').hidden = false;
    }
  }

  // The newest out-of-warranty approval request for this quotation, with a link
  // to it in Warranty approvals.
  function renderQuotationApprovalLine(quotation) {
    const line = $('#quotationApprovalStatus');
    if (!quotation.approvalId) {
      line.textContent = '';
      return;
    }
    line.innerHTML = `Customer approval: <span class="status ${statusClass(quotation.approvalStatus)}">${escapeHtml(quotation.approvalStatus)}</span>${quotation.approvalMethod ? ` (${escapeHtml(quotation.approvalMethod)})` : ''} <button class="table-link" type="button" id="viewQuotationApprovalButton">${escapeHtml(quotation.approvalReference)}</button>`;
    $('#viewQuotationApprovalButton').addEventListener('click', () => {
      setWorkspaceMode('warranty-approvals');
      loadWarrantyApprovalDetail(quotation.approvalId);
    });
  }

  async function loadQuotationDetail(id) {
    if (!hasPermission('quotation.read')) return;
    setMessage('#workspaceMessage', '', false);
    try {
      const result = await apiRequest('/api/quotations/' + encodeURIComponent(id));
      currentQuotationId = result.quotation.id;
      currentQuotation = result.quotation;
      $('#quotationDetailHeading').textContent = result.quotation.quotationReference;
      fillQuotationForm('qte', result.quotation);
      $('#saveQuotationButton').hidden = !hasPermission('quotation.write');
      $('#quotationJobCardCreatePanel').hidden = true;
      $('#quotationJobCardStatus').textContent = '';
      renderQuotationApprovalLine(result.quotation);
      $('#createJobCardFromQuotationButton').hidden = true;
      if (hasPermission('service_job_card.read')) {
        try {
          const jobCardResult = await apiRequest(
            '/api/quotations/' + encodeURIComponent(currentQuotationId) + '/job-card',
          );
          if (jobCardResult.jobCard) {
            const jobCardId = jobCardResult.jobCard.id;
            $('#quotationJobCardStatus').innerHTML =
              `Service job card already created: <button class="table-link" type="button" id="viewQuotationJobCardButton">${escapeHtml(jobCardResult.jobCard.jobCardReference)}</button>`;
            $('#viewQuotationJobCardButton').addEventListener('click', () => {
              setWorkspaceMode('job-cards');
              loadJobCardDetail(jobCardId);
            });
          } else {
            $('#createJobCardFromQuotationButton').hidden =
              !hasPermission('service_job_card.write');
          }
        } catch (jobCardError) {
          if (jobCardError.status !== 403) throw jobCardError;
        }
      }
      $('#quotationDetail').hidden = false;
      $('#quotationDetail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 404) {
        currentQuotationId = null;
        $('#quotationDetail').hidden = true;
        setWorkspaceRecovery('This quotation no longer exists.', loadQuotations);
      } else {
        setWorkspaceRecovery(error.message, () => loadQuotationDetail(id));
      }
    }
  }

  async function submitQuotationCreate() {
    const button = $('#submitQuotationCreateButton');
    setBusy(button, true, 'Saving…');
    try {
      const result = await apiRequest('/api/quotations', {
        method: 'POST',
        body: JSON.stringify(collectQuotationForm('qtc')),
      });
      $('#quotationCreatePanel').hidden = true;
      await loadQuotations();
      await loadQuotationDetail(result.quotation.id);
      setMessage(
        '#workspaceMessage',
        `Quotation ${result.quotation.quotationReference} created.`,
        true,
      );
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else {
        setMessage('#workspaceMessage', error.message);
      }
    } finally {
      setBusy(button, false);
    }
  }

  async function saveQuotation() {
    if (!currentQuotationId) return;
    const button = $('#saveQuotationButton');
    setBusy(button, true, 'Saving…');
    try {
      await apiRequest('/api/quotations/' + encodeURIComponent(currentQuotationId), {
        method: 'PATCH',
        body: JSON.stringify(collectQuotationForm('qte')),
      });
      await loadQuotationDetail(currentQuotationId);
      await loadQuotations();
      setMessage('#workspaceMessage', 'Quotation saved.', true);
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 404) {
        await loadQuotations();
        setMessage('#workspaceMessage', error.message);
      } else {
        setMessage('#workspaceMessage', error.message);
      }
    } finally {
      setBusy(button, false);
    }
  }

  function resetQuotationWorkspace() {
    currentQuotationId = null;
    currentQuotation = null;
    $('#quotationDetail').hidden = true;
    $('#quotationCreatePanel').hidden = true;
    $('#quotationJobCardCreatePanel').hidden = true;
    $('#quotationsBody').innerHTML = '';
    $('#quotationsEmpty').hidden = true;
  }

  // ---- Inspections ----
  function renderInspections(inspections) {
    const body = $('#inspectionsBody');
    body.innerHTML = inspections
      .map(
        (i) =>
          `<tr><td><button class="table-link" type="button" data-inspection-id="${escapeHtml(i.id)}">${escapeHtml(i.inspectionReference)}</button></td><td>${escapeHtml(i.customerName || '—')}<br>${escapeHtml(i.contactNumber || '')}</td><td>${escapeHtml(i.projectName || '—')}<br>${escapeHtml(i.siteLocation || '')}</td><td>${escapeHtml(formatDate(i.updatedAt))}</td></tr>`,
      )
      .join('');
    $('#inspectionsEmpty').hidden = inspections.length > 0;
    $$('#inspectionsBody [data-inspection-id]').forEach((button) =>
      button.addEventListener('click', () => loadInspectionDetail(button.dataset.inspectionId)),
    );
  }

  async function loadInspections() {
    if (!hasPermission('inspection.read')) return;
    clearWorkspaceRecovery();
    const params = new URLSearchParams({ page: '1', pageSize: '50' });
    const search = $('#inspectionSearch').value.trim();
    if (search) params.set('search', search);
    $('#inspectionsBody').innerHTML =
      '<tr><td colspan="4" class="empty-state">Loading inspections…</td></tr>';
    try {
      const result = await apiRequest('/api/inspections?' + params);
      renderInspections(result.inspections || []);
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 403) {
        setWorkspaceRecovery('You are not authorized to view inspections.', loadInspections);
      } else {
        setWorkspaceRecovery(error.message, loadInspections);
      }
      $('#inspectionsBody').innerHTML = '';
      $('#inspectionsEmpty').hidden = false;
    }
  }

  async function loadInspectionDetail(id) {
    if (!hasPermission('inspection.read')) return;
    setMessage('#workspaceMessage', '', false);
    try {
      const result = await apiRequest('/api/inspections/' + encodeURIComponent(id));
      currentInspectionId = result.inspection.id;
      currentInspection = result.inspection;
      $('#inspectionDetailHeading').textContent = result.inspection.inspectionReference;
      fillInspectionForm('iqe', result.inspection);
      $('#saveInspectionButton').hidden = !hasPermission('inspection.write');
      $('#inspectionDetail').hidden = false;
      $('#inspectionDetail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 404) {
        currentInspectionId = null;
        $('#inspectionDetail').hidden = true;
        setWorkspaceRecovery('This inspection no longer exists.', loadInspections);
      } else {
        setWorkspaceRecovery(error.message, () => loadInspectionDetail(id));
      }
    }
  }

  async function submitInspectionCreate() {
    const button = $('#submitInspectionCreateButton');
    setBusy(button, true, 'Saving…');
    try {
      const result = await apiRequest('/api/inspections', {
        method: 'POST',
        body: JSON.stringify(collectInspectionForm('iqc')),
      });
      $('#inspectionCreatePanel').hidden = true;
      await loadInspections();
      await loadInspectionDetail(result.inspection.id);
      setMessage(
        '#workspaceMessage',
        `Inspection ${result.inspection.inspectionReference} created.`,
        true,
      );
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else {
        setMessage('#workspaceMessage', error.message);
      }
    } finally {
      setBusy(button, false);
    }
  }

  async function saveInspection() {
    if (!currentInspectionId) return;
    const button = $('#saveInspectionButton');
    setBusy(button, true, 'Saving…');
    try {
      await apiRequest('/api/inspections/' + encodeURIComponent(currentInspectionId), {
        method: 'PATCH',
        body: JSON.stringify(collectInspectionForm('iqe')),
      });
      await loadInspectionDetail(currentInspectionId);
      await loadInspections();
      setMessage('#workspaceMessage', 'Inspection saved.', true);
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 404) {
        await loadInspections();
        setMessage('#workspaceMessage', error.message);
      } else {
        setMessage('#workspaceMessage', error.message);
      }
    } finally {
      setBusy(button, false);
    }
  }

  function resetInspectionWorkspace() {
    currentInspectionId = null;
    currentInspection = null;
    $('#inspectionDetail').hidden = true;
    $('#inspectionCreatePanel').hidden = true;
    $('#inspectionsBody').innerHTML = '';
    $('#inspectionsEmpty').hidden = true;
  }

  // ---- Warranty approvals (Phase 5 -- docs/DEVELOPMENT_PLAN.md: "Add
  // out-of-warranty approval flow and customer-facing approval links").
  // New functionality, not live-system parity -- staff raise a request
  // against a job card or inspection, and the customer decides through an
  // unauthenticated link (apps/web/src/approve.html) built from the
  // request's opaque access token.
  let currentWarrantyApprovalId = null;

  // ---- Technician management (modification.md #8) -- admin-only roster
  // page: list, add, and edit technicians, including each one's daily
  // appointment cap. There's no per-technician detail view; the same form
  // panel is reused for both "add" and "edit" (editingTechnicianId tracks
  // which mode it's in), matching the light-weight master-data pattern used
  // elsewhere in this app rather than the full list/detail split appointments
  // and job cards use.
  let editingTechnicianId = null;

  function resetTechnicianForm() {
    editingTechnicianId = null;
    $('#technicianForm').reset();
    clearErrors($('#technicianForm'));
    $('#technicianMaxAppointmentsPerDay').value = '10';
    $('#technicianActive').checked = true;
    $('#technicianFormHeading').textContent = 'Add a technician';
    $('#saveTechnicianButton').textContent = 'Add technician';
    $('#cancelTechnicianEditButton').hidden = true;
  }

  function startEditTechnician(technician) {
    editingTechnicianId = technician.id;
    $('#technicianName').value = technician.name || '';
    $('#technicianRegion').value = technician.region || '';
    $('#technicianPhone').value = technician.phone || '';
    $('#technicianEmail').value = technician.email || '';
    $('#technicianMaxAppointmentsPerDay').value = String(technician.maxAppointmentsPerDay ?? 10);
    $('#technicianActive').checked = technician.active !== false;
    $('#technicianFormHeading').textContent = `Edit ${technician.name}`;
    $('#saveTechnicianButton').textContent = 'Save changes';
    $('#cancelTechnicianEditButton').hidden = false;
    clearErrors($('#technicianForm'));
    $('#technicianFormPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderTechnicians(technicians) {
    const body = $('#techniciansBody');
    const canWrite = hasPermission('technicians.write');
    body.innerHTML = technicians
      .map(
        (technician) =>
          `<tr><td>${escapeHtml(technician.name)}</td><td>${escapeHtml(technician.region || '—')}</td><td>${escapeHtml(technician.phone || '—')}</td><td>${escapeHtml(technician.email || '—')}</td><td>${escapeHtml(String(technician.maxAppointmentsPerDay))}</td><td>${technician.active ? 'Active' : 'Inactive'}</td><td>${canWrite ? `<button class="button-link" type="button" data-edit-technician-id="${escapeHtml(technician.id)}">Edit</button>` : ''}</td></tr>`,
      )
      .join('');
    $('#techniciansEmpty').hidden = technicians.length > 0;
    $$('#techniciansBody [data-edit-technician-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const technician = technicians.find((item) => item.id === button.dataset.editTechnicianId);
        if (technician) startEditTechnician(technician);
      });
    });
  }

  async function loadTechnicians() {
    if (!hasPermission('technicians.read')) return;
    clearWorkspaceRecovery();
    $('#technicianFormPanel').hidden = !hasPermission('technicians.write');
    $('#techniciansBody').innerHTML =
      '<tr><td colspan="7" class="empty-state">Loading technicians…</td></tr>';
    try {
      const result = await apiRequest('/api/technicians?page=1&pageSize=200');
      renderTechnicians(result.technicians || []);
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 403) {
        setWorkspaceRecovery('You are not authorized to view technicians.', loadTechnicians);
      } else {
        setWorkspaceRecovery(error.message, loadTechnicians);
      }
      $('#techniciansBody').innerHTML = '';
      $('#techniciansEmpty').hidden = false;
    }
  }

  $('#technicianForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    clearErrors(form);
    const name = $('#technicianName').value.trim();
    const email = $('#technicianEmail').value.trim();
    const maxAppointmentsPerDay = Number($('#technicianMaxAppointmentsPerDay').value);
    let valid = true;
    if (!name) {
      showFieldError(form, 'technicianName', "Enter the technician's name.");
      valid = false;
    }
    if (email && !/^\S+@\S+\.\S+$/.test(email)) {
      showFieldError(form, 'technicianEmail', 'Enter a valid email address.');
      valid = false;
    }
    if (!Number.isInteger(maxAppointmentsPerDay) || maxAppointmentsPerDay < 1) {
      showFieldError(form, 'technicianMaxAppointmentsPerDay', 'Enter a whole number of 1 or more.');
      valid = false;
    }
    if (!valid) return;
    const button = $('#saveTechnicianButton');
    setBusy(button, true, editingTechnicianId ? 'Saving…' : 'Adding…');
    try {
      const payload = {
        name,
        region: $('#technicianRegion').value.trim() || undefined,
        phone: $('#technicianPhone').value.trim() || undefined,
        email: email || undefined,
        active: $('#technicianActive').checked,
        maxAppointmentsPerDay,
      };
      if (editingTechnicianId) {
        await apiRequest('/api/technicians/' + encodeURIComponent(editingTechnicianId), {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await apiRequest('/api/technicians', { method: 'POST', body: JSON.stringify(payload) });
      }
      setMessage(
        '#workspaceMessage',
        editingTechnicianId ? 'Technician updated.' : 'Technician added.',
        true,
      );
      resetTechnicianForm();
      await loadTechnicians();
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 403) {
        $('#technicianFormPanel').hidden = true;
        setMessage('#workspaceMessage', 'You are not authorized to manage technicians.');
      } else {
        setMessage('#workspaceMessage', error.message);
      }
    } finally {
      setBusy(button, false);
    }
  });

  $('#cancelTechnicianEditButton').addEventListener('click', resetTechnicianForm);

  // ---- Team logins (modification.md #10) -- admin-only: add another
  // local-auth login so a teammate can test with their own account instead
  // of sharing the bootstrap admin's credentials. There's no edit/deactivate
  // here yet (local-auth has no such endpoint) -- see modification.md's
  // follow-up list. This list is only ever additive and lives in the
  // server's memory, same as every other local-auth session.
  function resetTeamAccountForm() {
    $('#teamAccountForm').reset();
    clearErrors($('#teamAccountForm'));
    $('#teamAccountRole').value = 'sales';
  }

  // Roles come from the server (built-in + custom roles an administrator
  // created in Roles & permissions, modification #176); the list below is only
  // the fallback until /api/role-matrix answers.
  let teamAccountRoles = [
    { code: 'user', displayName: 'User' },
    { code: 'sales', displayName: 'Sales' },
    { code: 'management', displayName: 'Management' },
    { code: 'admin', displayName: 'Administrator' },
  ];

  function fillTeamAccountRoleSelect() {
    const select = $('#teamAccountRole');
    const keep = select.value || 'sales';
    select.innerHTML = teamAccountRoles
      .map(
        (role) =>
          `<option value="${escapeHtml(role.code)}">${escapeHtml(role.displayName)}</option>`,
      )
      .join('');
    select.value = teamAccountRoles.some((role) => role.code === keep) ? keep : 'sales';
  }

  async function loadTeamAccountRoles() {
    try {
      const data = await apiRequest('/api/role-matrix');
      teamAccountRoles = data.roles.map((role) => ({
        code: role.code,
        displayName: role.code === 'admin' ? 'Administrator' : role.displayName,
      }));
    } catch (error) {
      // keep the fallback list; the Users page still works for built-in roles
    }
    fillTeamAccountRoleSelect();
  }

  function renderTeamAccounts(users) {
    const body = $('#teamAccountsBody');
    body.innerHTML = users
      .map((user) => {
        const isSelf = user.id === currentUser?.id;
        const knownRoles = teamAccountRoles.some((role) => role.code === user.role)
          ? teamAccountRoles
          : [...teamAccountRoles, { code: user.role, displayName: user.role }];
        const roleOptions = knownRoles
          .map(
            (role) =>
              `<option value="${escapeHtml(role.code)}" ${role.code === user.role ? 'selected' : ''}>${escapeHtml(role.displayName)}</option>`,
          )
          .join('');
        return `<tr data-user-id="${escapeHtml(user.id)}"><td>${escapeHtml(user.name)}</td><td>${escapeHtml(user.email)}</td><td><select class="team-account-role-select" data-user-id="${escapeHtml(user.id)}" ${isSelf ? 'disabled' : ''}>${roleOptions}</select></td><td>${user.active ? 'Active' : 'Inactive'}</td><td>${
          isSelf
            ? '<span class="form-note-inline">(you)</span>'
            : `<button class="button-link" type="button" data-save-role="${escapeHtml(user.id)}">Save role</button> <button class="button-link" type="button" data-toggle-active="${escapeHtml(user.id)}">${user.active ? 'Deactivate' : 'Reactivate'}</button> <button class="button-link" type="button" data-reset-password="${escapeHtml(user.id)}" data-name="${escapeHtml(user.name)}">Reset password</button>`
        }</td></tr>`;
      })
      .join('');
    $('#teamAccountsEmpty').hidden = users.length > 0;
  }

  async function loadTeamAccounts() {
    if (!hasPermission('admin.users')) return;
    clearWorkspaceRecovery();
    $('#teamAccountsBody').innerHTML =
      '<tr><td colspan="5" class="empty-state">Loading team logins…</td></tr>';
    try {
      await loadTeamAccountRoles();
      const result = await apiRequest('/api/auth/users');
      renderTeamAccounts(result.users || []);
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 403) {
        setWorkspaceRecovery('You are not authorized to manage team logins.', loadTeamAccounts);
      } else {
        setWorkspaceRecovery(error.message, loadTeamAccounts);
      }
      $('#teamAccountsBody').innerHTML = '';
      $('#teamAccountsEmpty').hidden = false;
    }
  }

  async function updateTeamAccount(userId, payload) {
    try {
      await apiRequest('/api/auth/users/' + encodeURIComponent(userId), {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      await loadTeamAccounts();
      setMessage('#workspaceMessage', 'Team login updated.', true);
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 403) {
        setMessage('#workspaceMessage', 'You are not authorized to manage team logins.');
      } else if (error.status === 409) {
        setMessage('#workspaceMessage', 'You cannot change your own role or active status here.');
      } else {
        setMessage('#workspaceMessage', error.message);
      }
    }
  }

  $('#teamAccountsBody').addEventListener('click', (event) => {
    const saveRoleButton = event.target.closest('button[data-save-role]');
    if (saveRoleButton) {
      const userId = saveRoleButton.dataset.saveRole;
      const select = $(`select.team-account-role-select[data-user-id="${userId}"]`);
      if (select) updateTeamAccount(userId, { role: select.value });
      return;
    }
    const resetButton = event.target.closest('button[data-reset-password]');
    if (resetButton) {
      openResetPasswordDialog(resetButton.dataset.resetPassword, resetButton.dataset.name);
      return;
    }
    const toggleButton = event.target.closest('button[data-toggle-active]');
    if (toggleButton) {
      const userId = toggleButton.dataset.toggleActive;
      const activatingNow = toggleButton.textContent.trim() === 'Reactivate';
      updateTeamAccount(userId, { active: activatingNow });
    }
  });

  $('#teamAccountForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    clearErrors(form);
    const name = $('#teamAccountName').value.trim();
    const email = $('#teamAccountEmail').value.trim();
    const password = $('#teamAccountPassword').value;
    const role = $('#teamAccountRole').value;
    let valid = true;
    if (!name) {
      showFieldError(form, 'teamAccountName', "Enter the teammate's name.");
      valid = false;
    }
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      showFieldError(form, 'teamAccountEmail', 'Enter a valid email address.');
      valid = false;
    }
    if (!isStrongPassword(password)) {
      showFieldError(form, 'teamAccountPassword', PASSWORD_RULE_TEXT);
      valid = false;
    }
    if (!valid) return;
    const button = $('#saveTeamAccountButton');
    setBusy(button, true, 'Adding…');
    try {
      await apiRequest('/api/auth/users', {
        method: 'POST',
        body: JSON.stringify({ name, email, password, role }),
      });
      setMessage(
        '#workspaceMessage',
        `Login added for ${name}. Share the email and password with them directly.`,
        true,
      );
      resetTeamAccountForm();
      await loadTeamAccounts();
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 403) {
        setMessage('#workspaceMessage', 'You are not authorized to manage team logins.');
      } else if (error.status === 409) {
        showFieldError(form, 'teamAccountEmail', 'A login with that email already exists.');
      } else {
        setMessage('#workspaceMessage', error.message);
      }
    } finally {
      setBusy(button, false);
    }
  });

  // ---- New service request (modification.md #12) -- staff-only equivalent
  // of the public complaint form, for a CCE registering a request that came
  // in by phone or email instead of directing the customer to fill in the
  // public form themselves. Same fields and validation as
  // apps/web/src/complaints.js's public form, plus a B2B branch/school
  // lookup against the authenticated master list (the public form can only
  // ever offer free text for that -- see modification.md #2) that fills
  // branch, customer number and sales order no. together.
  const newComplaintB2bOnlyFieldIds = [
    'newComplaintB2bBranchSearchInput',
    'newComplaintB2bBranchSchool',
    'newComplaintSchoolContactPerson',
    'newComplaintSchoolContactNumber',
  ];
  let newComplaintB2bBranchSearchSequence = 0;
  let newComplaintB2bBranchSearchDebounce = null;

  function applyNewComplaintCustomerTypeGating() {
    const customerType = $('#newComplaintCustomerType').value;
    const isB2c = customerType === 'B2C';
    newComplaintB2bOnlyFieldIds.forEach((id) => {
      $('#' + id).disabled = isB2c;
      if (isB2c) $('#' + id).value = '';
    });
    if (isB2c) {
      $('#newComplaintB2bBranchResults').innerHTML = '';
      $('#newComplaintB2bBranchResults').hidden = true;
      delete $('#newComplaintB2bBranchResults').dataset.branches;
      $('#newComplaintB2bBranchSearchMessage').textContent = '';
    }
    const contactRequired = customerType !== 'B2B';
    $('#newComplaintContactNumberRequiredMark').hidden = !contactRequired;
    $('#newComplaintContactNumberHint').hidden = contactRequired;
  }

  $('#newComplaintCustomerType').addEventListener('change', applyNewComplaintCustomerTypeGating);

  function resetNewComplaintForm() {
    $('#newComplaintForm').reset();
    clearItemPickerMarks($('#newComplaintForm'));
    clearErrors($('#newComplaintForm'));
    applyNewComplaintCustomerTypeGating();
    $('#newComplaintB2bBranchSearchInput').value = '';
    $('#newComplaintB2bBranchResults').innerHTML = '';
    $('#newComplaintB2bBranchResults').hidden = true;
    delete $('#newComplaintB2bBranchResults').dataset.branches;
    $('#newComplaintB2bBranchSearchMessage').textContent = '';
    delete $('#newComplaintB2bBranchSchool').dataset.branchSalesman;
    $('#newComplaintSalesmanField').hidden = true;
    $('#newComplaintSourceWarning').hidden = true;
    $('#newComplaintWarning').hidden = true;
    $('#newComplaintSuccess').hidden = true;
    $('#newComplaintFields').hidden = false;
    setMessage('#newComplaintMessage', '', false);
  }

  async function searchNewComplaintB2bBranches(query) {
    const requestSequence = ++newComplaintB2bBranchSearchSequence;
    $('#newComplaintB2bBranchSearchMessage').textContent = 'Searching…';
    try {
      const params = query ? '?query=' + encodeURIComponent(query) : '';
      const result = await apiRequest('/api/b2b-branches' + params);
      if (requestSequence !== newComplaintB2bBranchSearchSequence) return;
      const branches = result.branches || [];
      $('#newComplaintB2bBranchResults').innerHTML = branches
        .map(
          (branch, index) =>
            `<li><button type="button" data-branch-index="${index}"><span class="branch-name">${escapeHtml(branch.branchName)}</span><br><span class="branch-code">Cust_Code ${escapeHtml(branch.custCode)}${branch.lastSalesOrderNumber ? ' · SO ' + escapeHtml(branch.lastSalesOrderNumber) : ''}</span></button></li>`,
        )
        .join('');
      $('#newComplaintB2bBranchResults').hidden = branches.length === 0;
      $('#newComplaintB2bBranchSearchMessage').textContent = branches.length
        ? ''
        : 'No matches in the master list.';
      $('#newComplaintB2bBranchResults').dataset.branches = JSON.stringify(branches);
    } catch (error) {
      if (requestSequence !== newComplaintB2bBranchSearchSequence) return;
      $('#newComplaintB2bBranchResults').hidden = true;
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status !== 403) {
        $('#newComplaintB2bBranchSearchMessage').textContent = error.message;
      }
    }
  }

  $('#newComplaintB2bBranchSearchInput').addEventListener('input', (event) => {
    const value = event.currentTarget.value.trim();
    if (newComplaintB2bBranchSearchDebounce) clearTimeout(newComplaintB2bBranchSearchDebounce);
    newComplaintB2bBranchSearchDebounce = setTimeout(
      () => searchNewComplaintB2bBranches(value),
      250,
    );
  });

  $('#newComplaintB2bBranchResults').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-branch-index]');
    if (!button) return;
    const branches = JSON.parse($('#newComplaintB2bBranchResults').dataset.branches || '[]');
    const branch = branches[Number(button.dataset.branchIndex)];
    if (!branch) return;
    $('#newComplaintB2bBranchSchool').value = branch.branchName;
    $('#newComplaintB2bBranchSchool').dataset.branchSalesman = branch.salesman || '';
    updateNewRequestSourceWarning();
    if (branch.lastSalesOrderNumber)
      $('#newComplaintSalesOrderNumber').value = branch.lastSalesOrderNumber;
    $('#newComplaintB2bBranchResults').hidden = true;
    $('#newComplaintB2bBranchSearchInput').value = '';
    $('#newComplaintB2bBranchSearchMessage').textContent =
      `Filled from the master list (Cust_Code ${branch.custCode}).`;
  });

  // Staff New request books an appointment directly (modification.md #80):
  // no complaint record and no CMP- reference. Field names are mapped to the
  // appointment API here.
  function newComplaintFormData() {
    const source = $('#newComplaintSource').value;
    const fields = {
      complaintSource: source,
      salesman: source === 'Salesman' ? $('#newComplaintSalesman').value : '',
      appointmentDate: $('#newComplaintAppointmentDate').value,
      technicianId: $('#newComplaintTechnician').value,
      customerType: $('#newComplaintCustomerType').value,
      customerName: $('#newComplaintCustomerName').value.trim(),
      contactNumber: $('#newComplaintContactNumber').value.trim(),
      customerEmail: $('#newComplaintCustomerEmail').value.trim(),
      address: $('#newComplaintAddress').value.trim(),
      region: $('#newComplaintRegion').value,
      brand: $('#newComplaintBrand').value.trim(),
      model: $('#newComplaintModel').value.trim(),
      itemCode: $('#newComplaintSerialOrItemCode').value.trim(),
      faultDescription: $('#newComplaintDescription').value.trim(),
      jobWarranty: $('#newComplaintWarranty').value,
      b2bBranchSchool: $('#newComplaintB2bBranchSchool').value.trim(),
      schoolContactPerson: $('#newComplaintSchoolContactPerson').value.trim(),
      schoolContactNumber: $('#newComplaintSchoolContactNumber').value.trim(),
      customerNumber: $('#newComplaintCustomerNumber').value.trim(),
      salesOrderNumber: $('#newComplaintSalesOrderNumber').value.trim(),
    };
    // Optional fields left blank must be OMITTED, not sent as "" -- the
    // server's Zod schema treats each as .optional() but still .min(1)
    // when present.
    return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== ''));
  }

  function validateNewComplaintForm(data, form) {
    clearErrors(form);
    let valid = true;
    if (!data.complaintSource) {
      showFieldError(form, 'newComplaintSource', 'Select how the request reached us.');
      valid = false;
    }
    if (data.complaintSource === 'Salesman' && !data.salesman) {
      showFieldError(form, 'newComplaintSalesman', 'Pick the salesman.');
      valid = false;
    }
    if (!data.appointmentDate) {
      showFieldError(form, 'newComplaintAppointmentDate', 'Pick the appointment date.');
      valid = false;
    }
    if (!data.customerType) {
      showFieldError(form, 'newComplaintCustomerType', 'Select a customer type.');
      valid = false;
    }
    if (!data.customerName) {
      showFieldError(form, 'newComplaintCustomerName', 'Enter the customer name.');
      valid = false;
    }
    if (!data.faultDescription) {
      showFieldError(form, 'newComplaintDescription', 'Describe the issue.');
      valid = false;
    }
    if (data.customerType !== 'B2B' && !data.contactNumber) {
      showFieldError(form, 'newComplaintContactNumber', 'Enter a contact number.');
      valid = false;
    }
    if (data.customerEmail && !/^\S+@\S+\.\S+$/.test(data.customerEmail)) {
      showFieldError(form, 'newComplaintCustomerEmail', 'Enter a valid email address.');
      valid = false;
    }
    return valid;
  }

  async function loadNewRequestTechnicians() {
    const select = $('#newComplaintTechnician');
    if (!hasPermission('technicians.read')) {
      select.disabled = true;
      return;
    }
    const current = select.value;
    try {
      const result = await apiRequest('/api/technicians?active=true&page=1&pageSize=100');
      select.innerHTML =
        '<option value="">Assign later</option>' +
        (result.technicians || [])
          .map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`)
          .join('');
      select.value = current;
    } catch {
      // Technician is optional; leave "Assign later" as the only choice.
    }
  }

  // Advisory only: for a B2B request that came through a salesman, compare the
  // chosen salesman with the one the B2B branch master lists for the school.
  function updateNewRequestSourceWarning() {
    const note = $('#newComplaintSourceWarning');
    const listed = $('#newComplaintB2bBranchSchool').dataset.branchSalesman || '';
    const chosen = $('#newComplaintSalesman').value;
    const mismatch =
      $('#newComplaintSource').value === 'Salesman' &&
      $('#newComplaintCustomerType').value !== 'B2C' &&
      listed &&
      chosen &&
      listed.trim().toLowerCase() !== chosen.trim().toLowerCase();
    note.hidden = !mismatch;
    note.textContent = mismatch
      ? `The B2B branch master lists ${listed} as the salesman for this school, but you picked ${chosen}. You can still book it; please check the source.`
      : '';
  }

  function applyNewComplaintSourceGating() {
    const isSalesman = $('#newComplaintSource').value === 'Salesman';
    $('#newComplaintSalesmanField').hidden = !isSalesman;
    if (!isSalesman) $('#newComplaintSalesman').value = '';
    updateNewRequestSourceWarning();
  }

  $('#newComplaintSource').addEventListener('change', applyNewComplaintSourceGating);
  $('#newComplaintSalesman').addEventListener('change', updateNewRequestSourceWarning);
  $('#newComplaintCustomerType').addEventListener('change', updateNewRequestSourceWarning);
  $('#newComplaintB2bBranchSchool').addEventListener('input', () => {
    // A hand-typed school no longer matches the master list entry that was picked.
    delete $('#newComplaintB2bBranchSchool').dataset.branchSalesman;
    updateNewRequestSourceWarning();
  });

  $('#newComplaintForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = newComplaintFormData();
    setMessage('#newComplaintMessage', '', false);
    if (!validateNewComplaintForm(data, form)) return;
    const button = $('#submitNewComplaintButton');
    setBusy(button, true, 'Booking…');
    try {
      const result = await apiRequest('/api/appointments', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      const appointment = result.appointment || {};
      $('#newComplaintReference').textContent =
        appointment.appointmentReference || 'Reference created';
      $('#openNewComplaintInInboxButton').dataset.appointmentId = appointment.id || '';
      $('#newComplaintSuccessNote').textContent = appointment.appointmentDate
        ? `Booked for ${appointment.appointmentDate}${appointment.technicianName ? ' with ' + appointment.technicianName : ', technician not assigned yet'}.`
        : '';
      const warnings = result.warnings || [];
      $('#newComplaintWarning').hidden = warnings.length === 0;
      $('#newComplaintWarning').textContent = warnings.join(' ');
      $('#newComplaintSuccess').hidden = false;
      $('#newComplaintFields').hidden = true;
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 403) {
        setMessage('#newComplaintMessage', 'You are not authorized to book appointments.');
      } else {
        setMessage('#newComplaintMessage', error.message);
      }
    } finally {
      setBusy(button, false);
    }
  });

  $('#registerAnotherButton').addEventListener('click', resetNewComplaintForm);

  $('#openNewComplaintInInboxButton').addEventListener('click', () => {
    const id = $('#openNewComplaintInInboxButton').dataset.appointmentId;
    setWorkspaceMode('appointments');
    if (id) loadAppointmentDetail(id);
  });

  // ---- Salesmen / Sales channels (modification.md #14, edit/deactivate
  // added in #15, merged into one table with Sales channel as a column
  // instead of its own section in #17). The salesmen table feeds the
  // Salesman dropdown on the Schedule form and job cards; the Sales
  // channel column feeds the Sales channel dropdown on job cards (see
  // modification.md #8, #17). Sales channels themselves stay a small
  // master list under the hood (so the dropdown has real, reusable
  // values), but the admin page only shows a one-line "add a new channel
  // name" control for it now, not a separate table.
  let salesChannelDropdownOptions = [];

  function renderSalesmenRows(items) {
    const body = $('#salesmenBody');
    const canWrite = hasPermission('salesmen.write');
    const channelOptionsHtml = (selected) =>
      `<option value="">Select a channel</option>` +
      salesChannelDropdownOptions
        .map(
          (channel) =>
            `<option value="${escapeHtml(channel.name)}" ${channel.name === selected ? 'selected' : ''}>${escapeHtml(channel.name)}</option>`,
        )
        .join('');
    body.innerHTML = items
      .map((item) => {
        const nameCell = canWrite
          ? `<input type="text" class="master-data-name-input" data-id="${escapeHtml(item.id)}" value="${escapeHtml(item.name)}" maxlength="200" />`
          : escapeHtml(item.name);
        const channelCell = canWrite
          ? `<select class="master-data-channel-select" data-id="${escapeHtml(item.id)}">${channelOptionsHtml(item.salesChannel)}</select>`
          : escapeHtml(item.salesChannel || '—');
        const actionsCell = canWrite
          ? `<button class="button-link" type="button" data-save-id="${escapeHtml(item.id)}">Save</button> <button class="button-link" type="button" data-toggle-id="${escapeHtml(item.id)}">${item.active ? 'Deactivate' : 'Reactivate'}</button>`
          : '';
        return `<tr data-id="${escapeHtml(item.id)}"><td>${nameCell}</td><td>${channelCell}</td><td>${item.active ? 'Active' : 'Inactive'}</td><td>${actionsCell}</td></tr>`;
      })
      .join('');
    $('#salesmenEmpty').hidden = items.length > 0;
  }

  // ---- Delivery & installation masters (modification.md #154): the channel
  // "reporting name" (JDI -> HAA) and the category mapping (item group ->
  // installable -> pricing category). Both sit under Salesmen & channels.
  let categoryMappingState = { rows: [], unmapped: [], pricingCategories: [] };

  async function loadDandiMasters() {
    await Promise.all([loadChannelReporting(), loadCategoryMappings(), loadSalesmanAliases()]);
  }

  async function loadSalesmanAliases() {
    const section = $('#salesmanAliasSection');
    if (!hasPermission('salesmen.read')) {
      section.hidden = true;
      return;
    }
    try {
      const canWrite = hasPermission('salesmen.write');
      const [aliases, salesmen] = await Promise.all([
        apiRequest('/api/salesman-aliases'),
        canWrite ? apiRequest('/api/salesmen?page=1&pageSize=200') : Promise.resolve(null),
      ]);
      $('#salesmanAliasBody').innerHTML =
        (aliases.aliases || [])
          .map(
            (a) =>
              '<tr><td>' +
              escapeHtml(a.alias) +
              '</td><td>' +
              escapeHtml(a.salesmanName) +
              '</td><td>' +
              (canWrite
                ? '<button class="button-link" type="button" data-alias-remove="' +
                  escapeHtml(a.id) +
                  '">Remove</button>'
                : '') +
              '</td></tr>',
          )
          .join('') || '<tr><td colspan="3" class="empty-state">No other spellings yet.</td></tr>';
      if (salesmen) {
        $('#salesmanAliasSalesman').innerHTML =
          '<option value="">Select a salesman</option>' +
          (salesmen.salesmen || [])
            .map(
              (s) => '<option value="' + escapeHtml(s.id) + '">' + escapeHtml(s.name) + '</option>',
            )
            .join('');
      }
      $('#salesmanAliasForm').hidden = !canWrite;
      section.hidden = false;
    } catch (error) {
      section.hidden = true;
    }
  }

  $('#salesmanAliasForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const alias = $('#salesmanAliasText').value.trim();
    const salesmanId = $('#salesmanAliasSalesman').value;
    if (!alias || !salesmanId) {
      setMessage('#workspaceMessage', 'Enter the other spelling and choose the salesman.');
      return;
    }
    try {
      await apiRequest('/api/salesman-aliases', {
        method: 'POST',
        body: JSON.stringify({ alias, salesmanId }),
      });
      $('#salesmanAliasText').value = '';
      setMessage('#workspaceMessage', 'Spelling added.', true);
      await loadSalesmanAliases();
    } catch (error) {
      setMessage('#workspaceMessage', error.message);
    }
  });

  $('#salesmanAliasBody').addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-alias-remove]');
    if (!button) return;
    try {
      await apiRequest('/api/salesman-aliases/' + encodeURIComponent(button.dataset.aliasRemove), {
        method: 'DELETE',
      });
      setMessage('#workspaceMessage', 'Spelling removed.', true);
      await loadSalesmanAliases();
    } catch (error) {
      setMessage('#workspaceMessage', error.message);
    }
  });

  async function loadChannelReporting() {
    const section = $('#channelReportingSection');
    if (!hasPermission('sales_channels.read')) {
      section.hidden = true;
      return;
    }
    try {
      const result = await apiRequest('/api/sales-channels?page=1&pageSize=200');
      const canWrite = hasPermission('sales_channels.write');
      $('#channelReportingBody').innerHTML = (result.salesChannels || [])
        .map(
          (c) =>
            '<tr><td>' +
            escapeHtml(c.name) +
            (c.active ? '' : ' <span class="status status-muted">Inactive</span>') +
            '</td><td>' +
            (canWrite
              ? '<input type="text" maxlength="50" data-reporting-for="' +
                escapeHtml(c.id) +
                '" value="' +
                escapeHtml(c.reportingName || '') +
                '" placeholder="e.g. HAA">'
              : escapeHtml(c.reportingName || '—')) +
            '</td><td>' +
            (canWrite
              ? '<button class="button-link" type="button" data-reporting-save="' +
                escapeHtml(c.id) +
                '" data-name="' +
                escapeHtml(c.name) +
                '">Save</button>'
              : '') +
            '</td></tr>',
        )
        .join('');
      section.hidden = false;
    } catch (error) {
      section.hidden = true;
    }
  }

  $('#channelReportingBody').addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-reporting-save]');
    if (!button) return;
    const id = button.dataset.reportingSave;
    const input = $('#channelReportingBody input[data-reporting-for="' + id + '"]');
    try {
      await apiRequest('/api/sales-channels/' + encodeURIComponent(id), {
        method: 'PATCH',
        body: JSON.stringify({ name: button.dataset.name, reportingName: input.value.trim() }),
      });
      setMessage('#workspaceMessage', 'Reporting name saved.', true);
      await loadChannelReporting();
    } catch (error) {
      setMessage('#workspaceMessage', error.message);
    }
  });

  function categoryPricingOptions(selected) {
    return (
      '<option value="">Select a category</option>' +
      categoryMappingState.pricingCategories
        .map(
          (name) =>
            '<option' +
            (name === selected ? ' selected' : '') +
            '>' +
            escapeHtml(name) +
            '</option>',
        )
        .join('')
    );
  }

  function drawCategoryMappings() {
    const canWrite = hasPermission('category_mappings.write');
    $('#categoryMappingBody').innerHTML =
      categoryMappingState.rows
        .map((row) => {
          const id = escapeHtml(row.id);
          const group = canWrite
            ? '<input type="text" maxlength="200" data-cm-group="' +
              id +
              '" value="' +
              escapeHtml(row.groupName) +
              '">'
            : escapeHtml(row.groupName);
          const installable = canWrite
            ? '<input type="checkbox" data-cm-installable="' +
              id +
              '"' +
              (row.installable ? ' checked' : '') +
              ' aria-label="Installable">'
            : row.installable
              ? 'Yes'
              : 'No';
          const pricing = canWrite
            ? '<select data-cm-pricing="' +
              id +
              '"' +
              (row.installable ? '' : ' disabled') +
              '>' +
              categoryPricingOptions(row.pricingCategory) +
              '</select>'
            : escapeHtml(row.pricingCategory || '—');
          const actions = canWrite
            ? '<button class="button-link" type="button" data-cm-save="' +
              id +
              '">Save</button> <button class="button-link" type="button" data-cm-toggle="' +
              id +
              '">' +
              (row.active ? 'Deactivate' : 'Reactivate') +
              '</button>'
            : '';
          return (
            '<tr><td>' +
            group +
            '</td><td>' +
            installable +
            '</td><td>' +
            pricing +
            '</td><td>' +
            (row.active ? 'Active' : 'Inactive') +
            '</td><td>' +
            actions +
            '</td></tr>'
          );
        })
        .join('') || '<tr><td colspan="5" class="empty-state">No groups mapped yet.</td></tr>';
    const unmapped = categoryMappingState.unmapped;
    $('#categoryUnmapped').innerHTML = unmapped.length
      ? '<p class="form-note"><strong>' +
        unmapped.length +
        ' stock group(s) are not linked yet</strong> (they can be delivered, but only groups linked as installable can be installed): ' +
        unmapped
          .slice(0, 12)
          .map(
            (g) =>
              '<button class="button-link" type="button" data-cm-fill="' +
              escapeHtml(g.groupName) +
              '">' +
              escapeHtml(g.groupName) +
              ' (' +
              g.itemCount +
              ')</button>',
          )
          .join(', ') +
        (unmapped.length > 12 ? ' and ' + (unmapped.length - 12) + ' more' : '') +
        '</p>'
      : '';
    $('#categoryGroupList').innerHTML = unmapped
      .map((g) => '<option value="' + escapeHtml(g.groupName) + '"></option>')
      .join('');
    $('#categoryPricing').innerHTML = categoryPricingOptions('');
    $('#categoryPricing').disabled = $('#categoryInstallable').value !== 'yes';
    $('#categoryMappingForm').hidden = !canWrite;
  }

  async function loadCategoryMappings() {
    const section = $('#categoryMappingSection');
    if (!hasPermission('category_mappings.read')) {
      section.hidden = true;
      return;
    }
    try {
      const result = await apiRequest('/api/category-mappings');
      categoryMappingState = {
        rows: result.categoryMappings || [],
        unmapped: result.unmappedGroups || [],
        pricingCategories: result.pricingCategories || [],
      };
      drawCategoryMappings();
      section.hidden = false;
    } catch (error) {
      section.hidden = true;
    }
  }

  $('#categoryInstallable').addEventListener('change', () => {
    $('#categoryPricing').disabled = $('#categoryInstallable').value !== 'yes';
  });

  $('#categoryUnmapped').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-cm-fill]');
    if (!button) return;
    $('#categoryGroupName').value = button.dataset.cmFill;
    $('#categoryGroupName').focus();
  });

  $('#categoryMappingBody').addEventListener('change', (event) => {
    const box = event.target.closest('input[data-cm-installable]');
    if (!box) return;
    const select = $(
      '#categoryMappingBody select[data-cm-pricing="' + box.dataset.cmInstallable + '"]',
    );
    select.disabled = !box.checked;
    if (!box.checked) select.value = '';
  });

  async function saveCategoryMapping(id, overrides) {
    const row = categoryMappingState.rows.find((r) => r.id === id);
    const scope = '#categoryMappingBody ';
    const installable = $(scope + 'input[data-cm-installable="' + id + '"]').checked;
    const payload = {
      groupName: $(scope + 'input[data-cm-group="' + id + '"]').value.trim(),
      installable,
      pricingCategory: installable
        ? $(scope + 'select[data-cm-pricing="' + id + '"]').value || null
        : null,
      notes: row.notes,
      ...overrides,
    };
    if (!payload.groupName) {
      setMessage('#workspaceMessage', 'Enter the item group name.');
      return;
    }
    if (payload.installable && !payload.pricingCategory) {
      setMessage('#workspaceMessage', 'Choose the pricing category for an installable group.');
      return;
    }
    try {
      await apiRequest('/api/category-mappings/' + encodeURIComponent(id), {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      setMessage('#workspaceMessage', 'Category mapping saved.', true);
      await loadCategoryMappings();
    } catch (error) {
      setMessage('#workspaceMessage', error.message);
    }
  }

  $('#categoryMappingBody').addEventListener('click', (event) => {
    const save = event.target.closest('button[data-cm-save]');
    if (save) {
      saveCategoryMapping(save.dataset.cmSave, {});
      return;
    }
    const toggle = event.target.closest('button[data-cm-toggle]');
    if (toggle) {
      const row = categoryMappingState.rows.find((r) => r.id === toggle.dataset.cmToggle);
      saveCategoryMapping(toggle.dataset.cmToggle, { active: !row.active });
    }
  });

  $('#categoryMappingForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    clearErrors(form);
    const groupName = $('#categoryGroupName').value.trim();
    const installable = $('#categoryInstallable').value === 'yes';
    const pricingCategory = $('#categoryPricing').value;
    if (!groupName) {
      showFieldError(form, 'categoryGroupName', 'Enter the item group name.');
      return;
    }
    if (installable && !pricingCategory) {
      showFieldError(form, 'categoryPricing', 'Choose the pricing category.');
      return;
    }
    const button = $('#saveCategoryButton');
    setBusy(button, true, 'Adding…');
    try {
      await apiRequest('/api/category-mappings', {
        method: 'POST',
        body: JSON.stringify({
          groupName,
          installable,
          pricingCategory: installable ? pricingCategory : null,
        }),
      });
      $('#categoryGroupName').value = '';
      $('#categoryInstallable').value = 'no';
      setMessage('#workspaceMessage', 'Item group mapped.', true);
      await loadCategoryMappings();
    } catch (error) {
      setMessage('#workspaceMessage', error.message);
    } finally {
      setBusy(button, false);
    }
  });

  async function loadSalesChannelDropdownOptions() {
    if (!hasPermission('sales_channels.read')) {
      salesChannelDropdownOptions = [];
      return;
    }
    try {
      const result = await apiRequest('/api/sales-channels?active=true&page=1&pageSize=200');
      salesChannelDropdownOptions = result.salesChannels || [];
    } catch {
      salesChannelDropdownOptions = [];
    }
    populateSelectOptions('#salesmanSalesChannel', salesChannelDropdownOptions, 'Select a channel');
  }

  async function loadSalesmen() {
    if (!hasPermission('salesmen.read')) return;
    clearWorkspaceRecovery();
    $('#salesmenBody').innerHTML =
      '<tr><td colspan="4" class="empty-state">Loading salesmen…</td></tr>';
    try {
      await loadSalesChannelDropdownOptions();
      const result = await apiRequest('/api/salesmen?page=1&pageSize=200');
      renderSalesmenRows(result.salesmen || []);
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 403) {
        setWorkspaceRecovery('You are not authorized to view salesmen.', loadSalesmen);
      } else {
        setWorkspaceRecovery(error.message, loadSalesmen);
      }
      $('#salesmenBody').innerHTML = '';
      $('#salesmenEmpty').hidden = false;
    }
  }

  async function updateSalesman(id, payload) {
    try {
      await apiRequest('/api/salesmen/' + encodeURIComponent(id), {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      await loadSalesmen();
      setMessage('#workspaceMessage', 'Salesman updated.', true);
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 403) {
        setMessage('#workspaceMessage', 'You are not authorized to manage salesmen.');
      } else if (error.status === 404) {
        setMessage('#workspaceMessage', 'That salesman was not found.');
        await loadSalesmen();
      } else {
        setMessage('#workspaceMessage', error.message);
      }
    }
  }

  $('#salesmenBody').addEventListener('click', (event) => {
    const saveButton = event.target.closest('button[data-save-id]');
    if (saveButton) {
      const id = saveButton.dataset.saveId;
      const input = $(`input.master-data-name-input[data-id="${id}"]`);
      const select = $(`select.master-data-channel-select[data-id="${id}"]`);
      const name = input ? input.value.trim() : '';
      if (!name) {
        setMessage('#workspaceMessage', "Enter the salesman's name.");
        return;
      }
      updateSalesman(id, { name, salesChannel: select && select.value ? select.value : undefined });
      return;
    }
    const toggleButton = event.target.closest('button[data-toggle-id]');
    if (toggleButton) {
      const id = toggleButton.dataset.toggleId;
      const input = $(`input.master-data-name-input[data-id="${id}"]`);
      const name = input ? input.value.trim() : '';
      const activatingNow = toggleButton.textContent.trim() === 'Reactivate';
      updateSalesman(id, { name, active: activatingNow });
    }
  });

  $('#salesmanForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    clearErrors(form);
    const name = $('#salesmanName').value.trim();
    const salesChannel = $('#salesmanSalesChannel').value;
    if (!name) {
      showFieldError(form, 'salesmanName', "Enter the salesman's name.");
      return;
    }
    const button = $('#saveSalesmanButton');
    setBusy(button, true, 'Adding…');
    try {
      await apiRequest('/api/salesmen', {
        method: 'POST',
        body: JSON.stringify({ name, ...(salesChannel ? { salesChannel } : {}) }),
      });
      $('#salesmanName').value = '';
      setMessage('#workspaceMessage', 'Salesman added.', true);
      await loadSalesmen();
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 403) {
        setMessage('#workspaceMessage', 'You are not authorized to manage salesmen.');
      } else {
        setMessage('#workspaceMessage', error.message);
      }
    } finally {
      setBusy(button, false);
    }
  });

  $('#salesChannelForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    clearErrors(form);
    const name = $('#salesChannelName').value.trim();
    if (!name) {
      showFieldError(form, 'salesChannelName', 'Enter the sales channel name.');
      return;
    }
    const button = $('#saveSalesChannelButton');
    setBusy(button, true, 'Adding…');
    try {
      await apiRequest('/api/sales-channels', { method: 'POST', body: JSON.stringify({ name }) });
      $('#salesChannelName').value = '';
      setMessage('#workspaceMessage', 'Sales channel added.', true);
      await loadSalesChannelDropdownOptions();
      await loadSalesmen();
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 403) {
        setMessage('#workspaceMessage', 'You are not authorized to manage sales channels.');
      } else {
        setMessage('#workspaceMessage', error.message);
      }
    } finally {
      setBusy(button, false);
    }
  });

  function renderWarrantyApprovals(approvals) {
    const body = $('#warrantyApprovalsBody');
    body.innerHTML = approvals
      .map(
        (approval) =>
          `<tr><td><button class="table-link" type="button" data-warranty-approval-id="${escapeHtml(approval.id)}">${escapeHtml(approval.approvalReference)}</button></td><td>${escapeHtml(approval.customerName || '—')}<br>${escapeHtml(approval.contactNumber || '')}</td><td>${escapeHtml(approval.itemDescription || '—')}</td><td><span class="status ${statusClass(approval.status)}">${escapeHtml(approval.status)}</span></td><td>${escapeHtml(formatDate(approval.updatedAt))}</td></tr>`,
      )
      .join('');
    $('#warrantyApprovalsEmpty').hidden = approvals.length > 0;
    $$('#warrantyApprovalsBody [data-warranty-approval-id]').forEach((button) =>
      button.addEventListener('click', () =>
        loadWarrantyApprovalDetail(button.dataset.warrantyApprovalId),
      ),
    );
  }

  async function loadWarrantyApprovals() {
    if (!hasPermission('warranty_approval.read')) return;
    clearWorkspaceRecovery();
    const params = new URLSearchParams({ page: '1', pageSize: '50' });
    const search = $('#warrantyApprovalSearch').value.trim();
    const status = $('#warrantyApprovalStatusFilter').value;
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    $('#warrantyApprovalsBody').innerHTML =
      '<tr><td colspan="5" class="empty-state">Loading warranty approvals…</td></tr>';
    try {
      const result = await apiRequest('/api/warranty-approvals?' + params);
      renderWarrantyApprovals(result.approvals || []);
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 403) {
        setWorkspaceRecovery(
          'You are not authorized to view warranty approval requests.',
          loadWarrantyApprovals,
        );
      } else {
        setWorkspaceRecovery(error.message, loadWarrantyApprovals);
      }
      $('#warrantyApprovalsBody').innerHTML = '';
      $('#warrantyApprovalsEmpty').hidden = false;
    }
  }

  function warrantyApprovalLinkUrl(approval) {
    return `${window.location.origin}/portal/approve.html?token=${encodeURIComponent(approval.accessToken)}`;
  }

  async function loadWarrantyApprovalDetail(id) {
    if (!hasPermission('warranty_approval.read')) return;
    setMessage('#workspaceMessage', '', false);
    try {
      const result = await apiRequest('/api/warranty-approvals/' + encodeURIComponent(id));
      const approval = result.approval;
      currentWarrantyApprovalId = approval.id;
      $('#warrantyApprovalDetailHeading').textContent = approval.approvalReference;
      $('#warrantyApprovalDetailStatus').innerHTML =
        `<span class="status ${statusClass(approval.status)}">${escapeHtml(approval.status)}</span>`;
      const details = [
        [
          'Source',
          approval.jobCardReference || approval.quotationReference || approval.inspectionReference,
        ],
        ['Customer name', approval.customerName],
        ['Contact number', approval.contactNumber],
        ['Item description', approval.itemDescription],
        ['Warranty status', approval.warrantyStatus],
        [
          'Estimated cost (AED)',
          approval.estimatedCost != null ? money(approval.estimatedCost) : null,
        ],
        ['Notes', approval.notes],
        ['Decided at', formatDate(approval.decidedAt)],
        ['Decided by (customer)', approval.decidedByName],
        ['How it was given', approval.decisionMethod],
        ['Decision notes', approval.decisionNotes],
        ['Created', formatDate(approval.createdAt)],
        ['Updated', formatDate(approval.updatedAt)],
      ];
      $('#warrantyApprovalDetailGrid').innerHTML = details
        .map(
          ([label, value]) =>
            `<div class="detail-item"><small>${escapeHtml(label)}</small><p>${escapeHtml(value || '—')}</p></div>`,
        )
        .join('');
      $('#warrantyApprovalLinkInput').value = warrantyApprovalLinkUrl(approval);
      const approvalLinks = [];
      if (approval.jobCardId && hasPermission('service_job_card.read')) {
        approvalLinks.push({
          label: `Job card ${approval.jobCardReference}`,
          onClick: () => {
            setWorkspaceMode('job-cards');
            loadJobCardDetail(approval.jobCardId);
          },
        });
      }
      if (approval.quotationId && hasPermission('quotation.read')) {
        approvalLinks.push({
          label: `Quotation ${approval.quotationReference}`,
          onClick: () => {
            setWorkspaceMode('quotations');
            loadQuotationDetail(approval.quotationId);
          },
        });
      }
      renderWorkflowLinks('warrantyApprovalWorkflowLinks', approvalLinks);
      $('#warrantyApprovalManualPanel').hidden =
        approval.status !== 'Pending' || !hasPermission('warranty_approval.write');
      $('#warrantyApprovalDetail').hidden = false;
      $('#warrantyApprovalDetail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 404) {
        currentWarrantyApprovalId = null;
        $('#warrantyApprovalDetail').hidden = true;
        setWorkspaceRecovery(
          'This warranty approval request no longer exists.',
          loadWarrantyApprovals,
        );
      } else {
        setWorkspaceRecovery(error.message, () => loadWarrantyApprovalDetail(id));
      }
    }
  }

  // Out-of-warranty approval form: pick a WIP / out-of-warranty job card or a
  // quotation and the remaining fields are filled from it (green = pulled in).
  const waPickers = {
    jobCard: {
      ref: '#waJobCardRef',
      id: '#waJobCardId',
      list: '#waJobCardList',
      url: '/api/job-cards?forApproval=true&pageSize=50&',
      items: (result) => result.jobCards || [],
      reference: (row) => row.jobCardReference,
      label: (row) =>
        [row.customerName, row.itemDescription || row.modelNo, row.jobFinalStatus]
          .filter(Boolean)
          .join(' · '),
      fill: (row) => ({
        waCustomerName: row.customerName,
        waContactNumber: row.customerContact,
        waItemDescription: row.itemDescription || row.modelNo,
        waWarrantyStatus: row.warrantyStatus,
        waEstimatedCost: Number(row.amountChargeable || row.grandTotal) || '',
      }),
    },
    quotation: {
      ref: '#waQuotationRef',
      id: '#waQuotationId',
      list: '#waQuotationList',
      url: '/api/quotations?pageSize=50&',
      items: (result) => result.quotations || [],
      reference: (row) => row.quotationReference,
      label: (row) => [row.customerName, row.projectName].filter(Boolean).join(' · '),
      fill: (row) => ({
        waCustomerName: row.customerName,
        waContactNumber: row.contactNumber,
        waItemDescription: row.projectName,
        waWarrantyStatus: row.warrantyStatus,
        waEstimatedCost: Number(row.grandTotal) || '',
      }),
    },
  };
  const waFilledFields = [
    'waCustomerName',
    'waContactNumber',
    'waItemDescription',
    'waWarrantyStatus',
    'waEstimatedCost',
  ];
  const waRows = { jobCard: new Map(), quotation: new Map() };

  function clearWarrantyApprovalFill() {
    waFilledFields.forEach((id) => {
      const input = $(`#${id}`);
      input.classList.remove('master-filled');
      input.closest('.field')?.classList.remove('master-field');
    });
  }

  function resetWarrantyApprovalForm() {
    $('#warrantyApprovalCreateForm').reset();
    $('#waJobCardId').value = '';
    $('#waQuotationId').value = '';
    clearWarrantyApprovalFill();
  }

  async function searchWarrantyApprovalSource(kind, term) {
    const picker = waPickers[kind];
    try {
      const params = term ? 'search=' + encodeURIComponent(term) : '';
      const result = await apiRequest(picker.url + params);
      waRows[kind] = new Map();
      picker.items(result).forEach((row) => waRows[kind].set(picker.reference(row), row));
      $(picker.list).innerHTML = [...waRows[kind].entries()]
        .map(
          ([reference, row]) =>
            `<option value="${escapeHtml(reference)}">${escapeHtml(picker.label(row))}</option>`,
        )
        .join('');
    } catch {
      $(picker.list).innerHTML = '';
    }
  }

  function applyWarrantyApprovalSource(kind) {
    const picker = waPickers[kind];
    const other = waPickers[kind === 'jobCard' ? 'quotation' : 'jobCard'];
    const row = waRows[kind].get($(picker.ref).value.trim());
    $(picker.id).value = row ? row.id : '';
    if (!row) return;
    $(other.ref).value = '';
    $(other.id).value = '';
    clearWarrantyApprovalFill();
    Object.entries(picker.fill(row)).forEach(([id, value]) => {
      const input = $(`#${id}`);
      input.value = value ?? '';
      if (!input.value) return;
      input.classList.add('master-filled');
      input.closest('.field')?.classList.add('master-field');
    });
  }

  function initWarrantyApprovalPickers() {
    Object.keys(waPickers).forEach((kind) => {
      const picker = waPickers[kind];
      let timer = null;
      $(picker.ref).addEventListener('input', () => {
        applyWarrantyApprovalSource(kind);
        clearTimeout(timer);
        timer = setTimeout(
          () => searchWarrantyApprovalSource(kind, $(picker.ref).value.trim()),
          250,
        );
      });
      $(picker.ref).addEventListener('focus', () => {
        if (!waRows[kind].size) searchWarrantyApprovalSource(kind, '');
      });
    });
  }

  function collectWarrantyApprovalForm() {
    const jobCardId = $('#waJobCardId').value.trim();
    const quotationId = $('#waQuotationId').value.trim();
    return {
      jobCardId: jobCardId || undefined,
      quotationId: quotationId || undefined,
      customerName: $('#waCustomerName').value.trim() || undefined,
      contactNumber: $('#waContactNumber').value.trim() || undefined,
      itemDescription: $('#waItemDescription').value.trim() || undefined,
      warrantyStatus: $('#waWarrantyStatus').value.trim() || undefined,
      estimatedCost: $('#waEstimatedCost').value
        ? parseNumber($('#waEstimatedCost').value)
        : undefined,
      notes: $('#waNotes').value.trim() || undefined,
    };
  }

  async function submitWarrantyApprovalCreate() {
    const jobCardId = $('#waJobCardId').value.trim();
    const quotationId = $('#waQuotationId').value.trim();
    if (Boolean(jobCardId) === Boolean(quotationId)) {
      setMessage('#workspaceMessage', 'Pick exactly one of a job card or a quotation.');
      return;
    }
    const button = $('#submitWarrantyApprovalCreateButton');
    setBusy(button, true, 'Saving…');
    try {
      const result = await apiRequest('/api/warranty-approvals', {
        method: 'POST',
        body: JSON.stringify(collectWarrantyApprovalForm()),
      });
      $('#warrantyApprovalCreatePanel').hidden = true;
      resetWarrantyApprovalForm();
      await loadWarrantyApprovals();
      await loadWarrantyApprovalDetail(result.approval.id);
      setMessage(
        '#workspaceMessage',
        `Warranty approval request ${result.approval.approvalReference} created.`,
        true,
      );
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else {
        setMessage('#workspaceMessage', error.message);
      }
    } finally {
      setBusy(button, false);
    }
  }

  function resetWarrantyApprovalWorkspace() {
    currentWarrantyApprovalId = null;
    $('#warrantyApprovalDetail').hidden = true;
    $('#warrantyApprovalCreatePanel').hidden = true;
    $('#warrantyApprovalsBody').innerHTML = '';
    $('#warrantyApprovalsEmpty').hidden = true;
  }

  // ---- Dashboard (Phase 5 -- docs/DEVELOPMENT_PLAN.md: "Add service
  // reports and operational dashboard summaries"; visual/interactive rework
  // is modification.md #6). Deliberately covers the day-to-day service
  // workflows only; revenue/pricing reporting is Phase 6 scope. Renders
  // whatever statuses /api/dashboard/summary returns rather than a
  // hardcoded list, so a status this page doesn't otherwise track still
  // shows up as a tile instead of silently vanishing.
  //
  // Each tile can carry a `data-tile-key` that a click-delegation listener
  // on its container turns into a jump to the filtered underlying list --
  // e.g. clicking the "Ready for Scheduling" complaints tile opens the
  // Complaint inbox pre-filtered to that status. Tiles built from `extra`
  // (totals, "Today", the quotations/inspections tiles) don't get a
  // clickable key unless the caller supplies one.
  function dashboardTileHtml(label, value, tileKey) {
    const attrs = tileKey
      ? ` is-clickable" role="button" tabindex="0" data-tile-key="${escapeHtml(tileKey)}`
      : '';
    return `<div class="dashboard-tile${attrs}"><span class="tile-value">${escapeHtml(String(value))}</span><span class="tile-label">${escapeHtml(label)}</span></div>`;
  }

  function dashboardTilesHtml(byStatus, extra = [], statusTileKey) {
    const statusTiles = Object.entries(byStatus || {}).map(([label, value]) =>
      dashboardTileHtml(label, value, statusTileKey ? statusTileKey(label) : undefined),
    );
    const extraTiles = extra.map(([label, value, tileKey]) =>
      dashboardTileHtml(label, value, tileKey),
    );
    const tiles = [...statusTiles, ...extraTiles];
    return tiles.length
      ? tiles.join('')
      : '<div class="dashboard-tile"><span class="tile-value">0</span><span class="tile-label">No records yet</span></div>';
  }

  // Lightweight horizontal bar chart (no charting library) showing the same
  // byStatus breakdown as the tiles above, scaled to the largest count.
  function dashboardBarsHtml(byStatus) {
    const entries = Object.entries(byStatus || {}).filter(([, value]) => Number(value) > 0);
    if (!entries.length) return '';
    const max = Math.max(1, ...entries.map(([, value]) => Number(value) || 0));
    return entries
      .map(([label, value]) => {
        const percent = Math.max(4, Math.round((Number(value) / max) * 100));
        return `<div class="dashboard-bar-row"><span class="bar-label">${escapeHtml(label)}</span><span class="dashboard-bar-track"><span class="dashboard-bar-fill" style="width:${percent}%"></span></span><span class="bar-count">${escapeHtml(String(value))}</span></div>`;
      })
      .join('');
  }

  function goToComplaintsFiltered(status) {
    setWorkspaceMode('complaints');
    $('#complaintStatusFilter').value = status || '';
    loadComplaints();
  }

  function goToAppointmentsFiltered(status) {
    setWorkspaceMode('appointments');
    $('#appointmentStatusFilter').value = status || '';
    $('#appointmentFrom').value = '';
    $('#appointmentTo').value = '';
    loadAppointments();
  }

  function goToAppointmentsToday() {
    setWorkspaceMode('appointments');
    const today = dateInputValue(new Date());
    $('#appointmentStatusFilter').value = '';
    $('#appointmentFrom').value = today;
    $('#appointmentTo').value = today;
    loadAppointments();
  }

  function goToJobCardsFiltered(status) {
    setWorkspaceMode('job-cards');
    $('#jobCardStatusFilter').value = status || '';
    loadJobCards();
  }

  function goToWarrantyApprovalsFiltered(status) {
    setWorkspaceMode('warranty-approvals');
    $('#warrantyApprovalStatusFilter').value = status || '';
    loadWarrantyApprovals();
  }

  const DASHBOARD_TILE_ACTIONS = {
    complaints: goToComplaintsFiltered,
    appointments: (key) =>
      key === 'today' ? goToAppointmentsToday() : goToAppointmentsFiltered(key),
    jobCards: goToJobCardsFiltered,
    warrantyApprovals: goToWarrantyApprovalsFiltered,
    quotations: () => setWorkspaceMode('quotations'),
    inspections: () => setWorkspaceMode('inspections'),
    vasSales: () => setWorkspaceMode('vas-calc'),
    amcContracts: () => setWorkspaceMode('amc-calc'),
    outOfWarranty: () => setWorkspaceMode('invoices'),
    rateCardSales: () => setWorkspaceMode('reports'),
    thomsonSales: () => setWorkspaceMode('thomson-calc'),
  };

  // Delegated click handling survives each re-render (innerHTML swap) since
  // the listener lives on the stable container, not the tiles themselves.
  [
    ['dashComplaintTiles', 'complaints'],
    ['dashAppointmentTiles', 'appointments'],
    ['dashJobCardTiles', 'jobCards'],
    ['dashOutOfWarrantyTiles', 'outOfWarranty'],
    ['dashQuotationInspectionTiles', null],
    ['dashWarrantyApprovalTiles', 'warrantyApprovals'],
    ['dashVasSaleTiles', null],
    ['dashAmcContractTiles', null],
    ['dashRateCardSaleTiles', null],
    ['dashThomsonSaleTiles', null],
  ].forEach(([containerId, section]) => {
    $('#' + containerId).addEventListener('click', (event) => {
      const tile = event.target.closest('[data-tile-key]');
      if (!tile) return;
      const key = tile.dataset.tileKey;
      const resolvedSection = section || key.split(':')[0];
      const resolvedKey = section ? key : key.split(':')[1];
      const action = DASHBOARD_TILE_ACTIONS[resolvedSection];
      if (action) action(resolvedKey);
    });
    $('#' + containerId).addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const tile = event.target.closest('[data-tile-key]');
      if (!tile) return;
      event.preventDefault();
      tile.click();
    });
  });

  // Out-of-warranty (CSIJO) jobs that are not delivered yet, by where the money
  // stands. Read from the invoices summary; hidden if the user cannot see it.
  async function renderOutOfWarrantyTiles() {
    const group = $('#dashOutOfWarrantyGroup');
    if (!group) return;
    if (!hasPermission('invoices.read')) {
      group.hidden = true;
      return;
    }
    try {
      const result = await apiRequest('/api/invoices/summary');
      const stages = result.summary.outOfWarrantyPendingDelivery || [];
      const byStage = {};
      stages.forEach((row) => {
        byStage[row.stage] = row.jobs;
      });
      const total = stages.reduce((sum, row) => sum + row.jobs, 0);
      const amount = stages.reduce((sum, row) => sum + row.amount, 0);
      $('#dashOutOfWarrantyTiles').innerHTML = dashboardTilesHtml(
        byStage,
        [['Pending delivery (AED ' + amount.toLocaleString('en-AE') + ')', total]],
        (stage) => stage,
      );
      group.hidden = false;
    } catch {
      group.hidden = true;
    }
  }

  function renderDashboard(summary) {
    $('#dashComplaintTiles').innerHTML = dashboardTilesHtml(
      summary.complaints.byStatus,
      [['Total', summary.complaints.total]],
      (status) => status,
    );
    $('#dashComplaintBars').innerHTML = dashboardBarsHtml(summary.complaints.byStatus);
    $('#dashAppointmentTiles').innerHTML = dashboardTilesHtml(
      summary.appointments.byStatus,
      [
        ['Today', summary.appointments.today, 'today'],
        ['Total', summary.appointments.total],
      ],
      (status) => status,
    );
    $('#dashAppointmentBars').innerHTML = dashboardBarsHtml(summary.appointments.byStatus);
    $('#dashJobCardTiles').innerHTML = dashboardTilesHtml(
      summary.jobCards.byStatus,
      [
        [
          'Awaiting final status',
          summary.jobCards.awaitingFinalStatus ?? 0,
          'Awaiting final status',
        ],
        ['Delivered', summary.jobCards.byFinalStatus?.Delivered ?? 0, 'Delivered'],
        [
          'Closure approvals waiting',
          summary.jobCards.closureApprovalPending ?? 0,
          'Closure approval pending',
        ],
        ['BER (all, incl. delivered)', summary.jobCards.berTotal ?? 0],
        ['Awaiting job card', summary.jobCards.awaitingCreation ?? 0, AWAITING_JOB_CARD_FILTER],
        ['Total', summary.jobCards.total],
      ],
      (status) => status,
    );
    $('#dashJobCardBars').innerHTML = dashboardBarsHtml(summary.jobCards.byStatus);
    renderOutOfWarrantyTiles();
    $('#dashQuotationInspectionTiles').innerHTML = dashboardTilesHtml({}, [
      ['Quotations (total)', summary.quotations.total, 'quotations:total'],
      ['Quotations (this month)', summary.quotations.thisMonth, 'quotations:month'],
      ['Inspections (total)', summary.inspections.total, 'inspections:total'],
      ['Inspections (this month)', summary.inspections.thisMonth, 'inspections:month'],
    ]);
    $('#dashWarrantyApprovalTiles').innerHTML = dashboardTilesHtml(
      summary.warrantyApprovals.byStatus,
      [['Total', summary.warrantyApprovals.total]],
      (status) => status,
    );
    $('#dashWarrantyApprovalBars').innerHTML = dashboardBarsHtml(
      summary.warrantyApprovals.byStatus,
    );
    $('#dashVasSaleTiles').innerHTML = dashboardTilesHtml({}, [
      ['VAS sales (total)', summary.vasSales.total, 'vasSales:total'],
      ['VAS sales (this month)', summary.vasSales.thisMonth, 'vasSales:month'],
    ]);
    $('#dashAmcContractTiles').innerHTML = dashboardTilesHtml({}, [
      ['AMC contracts (total)', summary.amcContracts.total, 'amcContracts:total'],
      ['AMC contracts (this month)', summary.amcContracts.thisMonth, 'amcContracts:month'],
    ]);
    $('#dashRateCardSaleTiles').innerHTML = dashboardTilesHtml({}, [
      ['Rate Card sales (total)', summary.rateCardSales.total, 'rateCardSales:total'],
      ['Rate Card sales (this month)', summary.rateCardSales.thisMonth, 'rateCardSales:month'],
    ]);
    $('#dashThomsonSaleTiles').innerHTML = dashboardTilesHtml({}, [
      ['Thomson sales (total)', summary.thomsonSales.total, 'thomsonSales:total'],
      ['Thomson sales (this month)', summary.thomsonSales.thisMonth, 'thomsonSales:month'],
    ]);
    $('#dashboardUpdatedAt').textContent = `Last updated ${formatDate(new Date().toISOString())}`;
  }

  // ---- Dashboard redesign (#67): hero KPIs + live kanban board -----------------
  let dashboardBoard = null;
  let dashboardSummary = null;
  const BOARD_COLOURS = {
    scheduled: '#1769aa',
    on_site: '#0f7d8c',
    awaiting_job_card: '#b5750a',
    jc_open: '#6b46c1',
    jc_progress: '#3a4fb5',
    done: '#176b4d',
  };
  const TAT_LABEL = { on_track: 'On track', at_risk: 'At risk', late: 'Late' };
  const boardFilter = { q: '', tech: '', type: '', tat: '' };

  function setDashTab(name) {
    const board = name === 'board';
    $('#dashOverviewPanel').hidden = board;
    $('#dashBoardPanel').hidden = !board;
    document.querySelectorAll('[data-dash-tab]').forEach((tab) => {
      const on = tab.dataset.dashTab === name;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  function kpiHtml(label, value, note, color, action) {
    const inner = `<span class="dash-kpi-label">${escapeHtml(label)}</span><span class="dash-kpi-value">${escapeHtml(String(value))}</span><span class="dash-kpi-note">${escapeHtml(note || '')}</span>`;
    const style = `--kpi-color:${color}`;
    return action
      ? `<button type="button" class="dash-kpi" style="${style}" data-kpi="${action}">${inner}</button>`
      : `<div class="dash-kpi" style="${style}">${inner}</div>`;
  }

  function renderDashHero(summary, board) {
    const st = board?.stats;
    const limits = board?.thresholds;
    const tiles = [
      kpiHtml(
        'Open cases',
        st ? st.open : '-',
        'Appointments and job cards in flight',
        '#1769aa',
        'board',
      ),
      kpiHtml(
        'Appointments today',
        summary.appointments.today,
        'Open the schedule',
        '#0f7d8c',
        'today',
      ),
      kpiHtml(
        'Awaiting job card',
        summary.jobCards.awaitingCreation ?? 0,
        'Completed visits with no job card',
        '#b5750a',
        'awaiting',
      ),
      kpiHtml(
        'Late cases',
        st ? st.late : '-',
        limits ? `${limits.late}+ days since logged` : '',
        '#c53030',
        'late',
      ),
      kpiHtml(
        'Average TAT',
        st && st.avgTatDays != null ? `${st.avgTatDays} d` : '-',
        st && st.onTimePercent != null
          ? `${st.onTimePercent}% on time, last 30 days (${st.completed30} done)`
          : 'No completed job cards in the last 30 days',
        '#176b4d',
        null,
      ),
    ];
    $('#dashHero').innerHTML = tiles.join('');
  }

  function boardCardMatches(card) {
    if (boardFilter.tech && (card.technician || '') !== boardFilter.tech) return false;
    if (boardFilter.type && (card.customerType || '') !== boardFilter.type) return false;
    if (boardFilter.tat && card.tat !== boardFilter.tat) return false;
    if (boardFilter.q) {
      const hay = `${card.reference} ${card.customerName || ''} ${card.item || ''}`.toLowerCase();
      if (!hay.includes(boardFilter.q)) return false;
    }
    return true;
  }

  function boardDueLabel(value) {
    if (!value) return '';
    const d = new Date(String(value).slice(0, 10) + 'T00:00:00');
    return Number.isNaN(d.getTime())
      ? ''
      : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  }

  function boardCardHtml(card, limits) {
    const kind =
      card.kind === 'appointment'
        ? 'Appt'
        : String(card.source || '')
              .toLowerCase()
              .startsWith('walk')
          ? 'Walk-in'
          : 'Job card';
    const chips = [card.customerType, card.warranty]
      .filter(Boolean)
      .map((c) => `<span class="kb-chip">${escapeHtml(c)}</span>`)
      .join('');
    const percent = Math.min(100, Math.round((card.ageDays / Math.max(1, limits.late)) * 100));
    const due = boardDueLabel(card.dueDate);
    const dueText = due ? (card.kind === 'appointment' ? `Visit ${due}` : `Due ${due}`) : '';
    return `<article class="kb-card tat-${card.tat}" tabindex="0" role="button" data-kb-kind="${card.kind}" data-kb-id="${escapeHtml(card.id)}" aria-label="${escapeHtml(`${kind} ${card.reference}, ${card.ageDays} days, ${TAT_LABEL[card.tat]}`)}">
      <div class="kb-card-top"><span class="kb-ref">${escapeHtml(card.reference)}</span><span class="kb-kind">${kind}</span></div>
      <div class="kb-cust">${escapeHtml(card.customerName || 'Customer not recorded')}</div>
      ${card.item ? `<div class="kb-item">${escapeHtml(card.item)}</div>` : ''}
      ${chips ? `<div class="kb-chips">${chips}</div>` : ''}
      <div class="kb-meter" aria-hidden="true"><span style="width:${percent}%"></span></div>
      <div class="kb-foot"><span class="kb-tech">${escapeHtml(card.technician || dueText || 'Unassigned')}</span><span class="kb-tat">${card.ageDays}d &middot; ${TAT_LABEL[card.tat]}</span></div>
    </article>`;
  }

  // "My tasks" lane under the service board (modification #112). Needs the Tasks permission.
  function renderTaskLane(refresh) {
    const host = $('#dashTaskLane');
    if (!host) return;
    const allowed = hasPermission('tasks.use');
    host.hidden = !allowed;
    if (!allowed) return;
    getTasksUi().renderBoardLane(host, { refresh: Boolean(refresh), q: boardFilter.q });
  }

  function renderKanban() {
    renderTaskLane(false);
    const board = dashboardBoard;
    if (!board) {
      $('#dashBoard').innerHTML = '<p class="kb-empty">Board data is not available right now.</p>';
      $('#dashBoardStats').innerHTML = '';
      $('#dashBoardLegend').textContent = '';
      return;
    }
    const techSelect = $('#dashBoardTech');
    const techs = [
      ...new Set(board.columns.flatMap((c) => c.cards.map((x) => x.technician)).filter(Boolean)),
    ].sort();
    if (techs.join('|') !== techSelect.dataset.techs) {
      techSelect.dataset.techs = techs.join('|');
      techSelect.innerHTML =
        '<option value="">All technicians</option>' +
        techs.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
      techSelect.value = boardFilter.tech;
    }
    const st = board.stats;
    $('#dashBoardStats').innerHTML = [
      kpiHtml('Open cases', st.open, 'Not yet completed', '#1769aa', null),
      kpiHtml('At risk', st.atRisk, `Over ${board.thresholds.target} days`, '#b5750a', null),
      kpiHtml('Late', st.late, `${board.thresholds.late}+ days`, '#c53030', null),
      kpiHtml(
        'Average TAT',
        st.avgTatDays != null ? `${st.avgTatDays} d` : '-',
        'Completed, last 30 days',
        '#176b4d',
        null,
      ),
      kpiHtml(
        'On time',
        st.onTimePercent != null ? `${st.onTimePercent}%` : '-',
        `Within ${board.thresholds.target} days`,
        '#176b4d',
        null,
      ),
    ].join('');
    $('#dashBoard').innerHTML = board.columns
      .map((col) => {
        const shown = col.cards.filter(boardCardMatches);
        const filtered = shown.length !== col.cards.length;
        const meta = [
          col.avgDays != null ? `Avg ${col.avgDays} d` : null,
          col.late ? `${col.late} late` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        const body = shown.length
          ? shown.map((c) => boardCardHtml(c, board.thresholds)).join('')
          : '<p class="kb-empty">No cases</p>';
        const more =
          !filtered && col.count > col.cards.length
            ? `<p class="kb-more">Showing the ${col.cards.length} oldest of ${col.count}</p>`
            : '';
        return `<section class="kb-col" style="--col:${BOARD_COLOURS[col.key] || '#1769aa'}" aria-label="${escapeHtml(col.label)}">
          <div class="kb-col-head"><div class="kb-col-title"><span>${escapeHtml(col.label)}</span><span class="kb-count">${filtered ? `${shown.length}/${col.count}` : col.count}</span></div><div class="kb-col-meta" title="${escapeHtml(col.hint)}">${escapeHtml(meta || col.hint)}</div></div>
          <div class="kb-list">${body}${more}</div>
        </section>`;
      })
      .join('');
    $('#dashBoardLegend').textContent =
      `Turnaround counts calendar days (Dubai) from when the complaint was logged, or the walk-in was received. ` +
      `On track up to ${board.thresholds.target} days, at risk after that, late from ${board.thresholds.late} days. ` +
      `Updates automatically every minute.`;
  }

  async function refreshDashboardQuiet() {
    try {
      const [summary, board] = await Promise.all([
        apiRequest('/api/dashboard/summary'),
        apiRequest('/api/dashboard/board').catch(() => null),
      ]);
      dashboardSummary = summary.summary;
      dashboardBoard = board?.board || null;
      renderDashboard(dashboardSummary);
      renderDashHero(dashboardSummary, dashboardBoard);
      renderKanban();
      renderTaskLane(true);
    } catch {
      /* keep the last good view on a transient failure */
    }
  }

  document
    .querySelectorAll('[data-dash-tab]')
    .forEach((tab) => tab.addEventListener('click', () => setDashTab(tab.dataset.dashTab)));
  $('#dashHero').addEventListener('click', (event) => {
    const kpi = event.target.closest('[data-kpi]');
    if (!kpi) return;
    const action = kpi.dataset.kpi;
    if (action === 'today') goToAppointmentsToday();
    else if (action === 'awaiting') goToJobCardsFiltered(AWAITING_JOB_CARD_FILTER);
    else if (action === 'late') {
      boardFilter.tat = 'late';
      $('#dashBoardTat').value = 'late';
      setDashTab('board');
      renderKanban();
    } else setDashTab('board');
  });
  $('#dashBoardSearch').addEventListener('input', (event) => {
    boardFilter.q = event.target.value.trim().toLowerCase();
    renderKanban();
  });
  [
    ['#dashBoardTech', 'tech'],
    ['#dashBoardType', 'type'],
    ['#dashBoardTat', 'tat'],
  ].forEach(([sel, key]) =>
    $(sel).addEventListener('change', (event) => {
      boardFilter[key] = event.target.value;
      renderKanban();
    }),
  );
  function openBoardCard(card) {
    if (!card) return;
    if (card.dataset.kbKind === 'appointment') {
      setWorkspaceMode('appointments');
      loadAppointmentDetail(card.dataset.kbId);
    } else {
      setWorkspaceMode('job-cards');
      loadJobCardDetail(card.dataset.kbId);
    }
  }
  $('#dashBoard').addEventListener('click', (event) =>
    openBoardCard(event.target.closest('[data-kb-id]')),
  );
  $('#dashBoard').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target.closest('[data-kb-id]');
    if (!card) return;
    event.preventDefault();
    openBoardCard(card);
  });
  setInterval(() => {
    if (document.hidden || $('#dashboardWorkspace').hidden || !hasPermission('dashboard.read'))
      return;
    refreshDashboardQuiet();
  }, 60000);

  async function loadDashboard() {
    if (!hasPermission('dashboard.read')) return;
    clearWorkspaceRecovery();
    $('#dashboardEmpty').hidden = true;
    try {
      const [result, boardResult] = await Promise.all([
        apiRequest('/api/dashboard/summary'),
        apiRequest('/api/dashboard/board').catch(() => null),
      ]);
      dashboardSummary = result.summary;
      dashboardBoard = boardResult?.board || null;
      renderDashboard(result.summary);
      renderDashHero(result.summary, dashboardBoard);
      renderKanban();
      renderTaskLane(true);
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 403) {
        setWorkspaceRecovery('You are not authorized to view the dashboard.', loadDashboard);
      } else {
        setWorkspaceRecovery(error.message, loadDashboard);
        $('#dashboardEmpty').hidden = false;
      }
    }
  }

  function resetDashboardWorkspace() {
    dashboardBoard = null;
    dashboardSummary = null;
    $('#dashHero').innerHTML = '';
    $('#dashBoard').innerHTML = '';
    $('#dashBoardStats').innerHTML = '';
    setDashTab('overview');
    $('#dashComplaintTiles').innerHTML = '';
    $('#dashAppointmentTiles').innerHTML = '';
    $('#dashJobCardTiles').innerHTML = '';
    $('#dashOutOfWarrantyTiles').innerHTML = '';
    $('#dashQuotationInspectionTiles').innerHTML = '';
    $('#dashWarrantyApprovalTiles').innerHTML = '';
    $('#dashVasSaleTiles').innerHTML = '';
    $('#dashAmcContractTiles').innerHTML = '';
  }

  function isJobCardLocked(jobCard) {
    return jobCard.finalStatus === 'Delivered';
  }

  function isAdminUser() {
    return currentUser?.role === 'admin' || currentUser?.permissions?.includes('*');
  }

  function renderJobCardActions(jobCard) {
    const editable =
      hasPermission('service_job_card.write') && (!isJobCardLocked(jobCard) || isAdminUser());
    $('#jobCardActions').hidden = !editable;
    $('#jobCardContentAction').hidden = !editable;
    if (editable) fillJobCardForm('jce', jobCard);
    // Delivered jobs open read-only; every other editable job opens in Edit.
    $('#jobCardViewTabs [data-jc-view="edit"]').hidden = !editable;
    setJobCardView(editable && jobCard.finalStatus !== 'Delivered' ? 'edit' : 'view');
  }

  function setJobCardView(view) {
    $('#jobCardDetail').dataset.jcView = view;
    $('#jobCardViewTabs')
      .querySelectorAll('.ws-tab')
      .forEach((tab) => {
        const active = tab.dataset.jcView === view;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-selected', String(active));
      });
  }

  // B2C BER or Rejected job with spare parts: a manager must approve before the parts are
  // removed or the job is delivered. The CCE sends it; a manager approves or declines.
  function renderClosureApproval(jobCard) {
    const box = $('#jobCardClosureApproval');
    if (!box) return;
    const hasParts = (jobCard.parts || []).some((part) => part.partNo || part.description);
    const applies =
      jobCard.customerType === 'B2C' &&
      ['BER', 'Rejected'].includes(jobCard.jobFinalStatus) &&
      hasParts &&
      jobCard.finalStatus !== 'Delivered';
    if (!applies) {
      box.hidden = true;
      return;
    }
    const status = jobCard.closureApprovalStatus;
    const canApprove = hasPermission('service_job_card.approve_closure');
    let text;
    let buttons = '';
    if (status === 'Pending') {
      text =
        'This job went to a manager for approval. Spare parts cannot be removed and the job cannot be delivered until it is approved.';
      if (canApprove) {
        buttons =
          '<button type="button" class="button button-primary" data-closure-action="Approved">Approve</button> <button type="button" class="button button-outline" data-closure-action="Declined">Decline</button>';
      }
    } else if (status === 'Approved') {
      text =
        'A manager approved this job. You can now remove the spare parts, choose the reason and set Final status to Delivered.';
    } else {
      text =
        status === 'Declined'
          ? `A manager declined the request${jobCard.closureApprovalNote ? ': ' + jobCard.closureApprovalNote : '.'} Send it again if the situation changed.`
          : 'This job carries spare parts. Send it for manager approval before removing the parts or delivering it.';
      buttons =
        '<button type="button" class="button button-primary" data-closure-action="request">Send for manager approval</button>';
    }
    box.className = 'next-step' + (status === 'Approved' ? ' is-done' : ' is-warn');
    box.innerHTML = `<div class="next-step-kicker">Manager approval</div><div class="next-step-title">${escapeHtml(status || 'Approval needed')}</div><p class="next-step-text">${escapeHtml(text)}</p>${buttons}`;
    box.hidden = false;
  }

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-closure-action]');
    if (!button || !currentJobCardId) return;
    const action = button.dataset.closureAction;
    button.disabled = true;
    try {
      if (action === 'request') {
        await apiRequest(
          '/api/job-cards/' + encodeURIComponent(currentJobCardId) + '/closure-approval',
          {
            method: 'POST',
          },
        );
        setMessage('#workspaceMessage', 'Sent to a manager for approval.', true);
      } else {
        await apiRequest(
          '/api/job-cards/' + encodeURIComponent(currentJobCardId) + '/closure-approval/decision',
          { method: 'POST', body: JSON.stringify({ decision: action }) },
        );
        setMessage('#workspaceMessage', `Closure ${action.toLowerCase()}.`, true);
      }
      await loadJobCardDetail(currentJobCardId);
      await loadJobCards();
    } catch (error) {
      setMessage('#workspaceMessage', error.message);
      button.disabled = false;
    }
  });

  function renderJobCardGuide(jobCard) {
    const box = $('#jobCardNextStep');
    const guides = {
      'Customer approval pending': {
        title: 'Waiting for customer approval',
        text: 'Raise an out-of-warranty approval request for this job in Warranty approvals. The job moves to WIP by itself when the customer approves. If the customer approved another way, set the job status to WIP here and you will be asked how they approved.',
        warn: true,
      },
      WIP: {
        title: 'Work in progress',
        text: 'Record the service rendered, spare parts used and charges in Job card details. When the repair is done set the job status to Repair Completed. If you are waiting for parts use Spare pending; if it cannot be repaired use BER or Rejected.',
      },
      'Spare pending': {
        title: 'Waiting for spare parts',
        text: 'Add the parts once they arrive, then set the job status back to WIP, or straight to Repair Completed if the repair is finished.',
        warn: true,
      },
      'Repair Completed': {
        title: 'Ready for delivery',
        text: 'Enter the invoice number and delivery date, hand the item to the customer, then set the final status to Delivered.',
      },
      BER: {
        title: 'Beyond economical repair',
        text: 'B2C: no charge, and the job can be delivered back after the reason is chosen. If spare parts were fitted, send the job for manager approval first. B2B out of warranty: AED 60 is billed to the sales channel. Hand the unit back, then set Final status to Delivered.',
        warn: true,
      },
      Rejected: {
        title: 'Job rejected',
        text: 'The customer declined. B2C: no charge, and spare parts need manager approval. B2B out of warranty: AED 60 is billed to the sales channel. Hand the unit back, then set Final status to Delivered.',
        warn: true,
      },
      Cancelled: {
        title: 'Job cancelled',
        text: 'Cancelled jobs are never billed. Hand the unit back, then set Final status to Delivered and choose a reason.',
        warn: true,
      },
      Delivered: {
        title: 'Delivered to customer',
        text: isAdminUser()
          ? 'This job is closed. As an administrator you can still edit it.'
          : 'This job is closed and locked. Only an administrator can edit it.',
        done: true,
      },
    };
    const guide =
      guides[jobCard.finalStatus === 'Delivered' ? 'Delivered' : jobCard.jobFinalStatus];
    if (!guide) {
      box.hidden = true;
      return;
    }
    box.className = 'next-step' + (guide.warn ? ' is-warn' : guide.done ? ' is-done' : '');
    box.innerHTML = `<div class="next-step-kicker">Next step</div><div class="next-step-title">${escapeHtml(guide.title)}</div><p class="next-step-text">${escapeHtml(guide.text)}</p>`;
    box.hidden = false;
  }

  // ---- CRM-style detail sections shared by complaint, appointment and job card
  function detailValueHtml(value, kind) {
    if (value === null || value === undefined || value === '') {
      return '<span class="ds-empty">Not provided</span>';
    }
    const text = escapeHtml(value);
    if (kind === 'pill') return `<span class="status ${statusClass(value)}">${text}</span>`;
    if (kind === 'money') return `<span class="ds-money">AED ${text}</span>`;
    if (kind === 'phone') {
      return `<a href="tel:${escapeHtml(String(value).replace(/[^\d+]/g, ''))}">${text}</a>`;
    }
    if (kind === 'email') return `<a href="mailto:${text}">${text}</a>`;
    return text;
  }

  function renderDetailSections(selector, sections) {
    const element = $(selector);
    element.className = 'detail-sections';
    element.innerHTML = sections
      .map((section) => {
        if (section.strip) {
          return `<div class="ds-strip">${section.strip
            .map(
              ([label, value, kind]) =>
                `<div class="ds-kpi"><small>${escapeHtml(label)}</small><strong>${detailValueHtml(value, kind)}</strong></div>`,
            )
            .join('')}</div>`;
        }
        const body =
          section.html ||
          `<dl class="ds-grid">${section.items
            .map(
              ([label, value, kind]) =>
                `<div class="ds-item${kind === 'wide' ? ' ds-wide' : ''}"><dt>${escapeHtml(label)}</dt><dd>${detailValueHtml(value, kind)}</dd></div>`,
            )
            .join('')}</dl>`;
        return `<section class="ds-card"><header class="ds-head"><h5>${escapeHtml(section.title)}</h5>${section.meta ? `<span class="ds-meta">${escapeHtml(section.meta)}</span>` : ''}</header>${body}</section>`;
      })
      .join('');
  }

  function jobCardPartsHtml(jobCard) {
    const parts = jobCard.parts || [];
    const rows = parts
      .map(
        (part) =>
          `<tr><td>${escapeHtml(part.partNo || '—')}</td><td>${escapeHtml(part.description || '—')}</td><td class="num">${escapeHtml(part.qty)}</td><td class="num">${money(part.unitPrice)}</td><td class="num">${money(Number(part.qty) * Number(part.unitPrice))}</td></tr>`,
      )
      .join('');
    const table = parts.length
      ? `<table class="ds-table"><thead><tr><th>Part no.</th><th>Description</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Line total</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="ds-note">No spare parts recorded.</p>';
    const totals = `<dl class="ds-grid">${[
      ['Parts total', money(jobCard.totalCost), 'money'],
      ['Service charge', money(jobCard.serviceCharge), 'money'],
      ['Grand total', money(jobCard.grandTotal), 'money'],
      [
        'Amount chargeable',
        jobCard.amountChargeable == null ? null : money(jobCard.amountChargeable),
        'money',
      ],
    ]
      .map(
        ([label, value, kind]) =>
          `<div class="ds-item"><dt>${escapeHtml(label)}</dt><dd>${detailValueHtml(value, kind)}</dd></div>`,
      )
      .join('')}</dl>`;
    return table + totals;
  }

  function billingJobTypeLabel(type) {
    return type === 'CSIJW'
      ? 'CSIJW - Warranty repair'
      : type === 'CSIJO'
        ? 'CSIJO - Non-warranty repair'
        : '';
  }

  function renderJobCardDetailSections(jobCard, approval = null) {
    const dateOnly = (value) => (value ? String(value).slice(0, 10) : '');
    renderDetailSections('#jobCardDetailGrid', [
      {
        strip: [
          ['Job status', jobCard.jobFinalStatus, 'pill'],
          ['Final status', jobCard.finalStatus, 'pill'],
          ['Job type', jobCard.billingJobType],
          ['Warranty', jobCard.finalWarrantyStatus || jobCard.warrantyStatus],
          ['Customer type', jobCard.customerType],
          ['Technician', jobCard.technicianName || jobCard.appointmentTechnicianName],
          ['Grand total', money(jobCard.grandTotal), 'money'],
        ],
      },
      {
        title: 'Customer',
        items: [
          ['Customer', jobCard.customerName],
          ['Customer type', jobCard.customerType],
          ['Contact', jobCard.customerContact, 'phone'],
          ['Email', jobCard.customerEmail, 'email'],
          ['Customer number', jobCard.customerNumber],
          ['Region', jobCard.region],
          ['B2B branch / school', jobCard.b2bBranchSchool],
          ['Site contact person', jobCard.schoolContactPerson],
          ['Site contact number', jobCard.schoolContactNumber, 'phone'],
          ['Address', jobCard.customerAddress, 'wide'],
        ],
      },
      {
        title: 'Product',
        items: [
          ['Brand', jobCard.brand],
          ['Model', jobCard.modelNo],
          ['Item code', jobCard.itemCode],
          ['Main group', jobCard.mainGroup],
          ['Group', jobCard.groupName],
          ['Sub group', jobCard.subGroup],
          ['Serial number', jobCard.serialNo],
          ['Purchase date', jobCard.purchaseDate],
          [
            'In stock master',
            jobCard.itemInMaster === null || jobCard.itemInMaster === undefined
              ? ''
              : jobCard.itemInMaster
                ? 'Yes'
                : 'No (typed in)',
          ],
          ['Item description', jobCard.itemDescription, 'wide'],
          ['Accessories received', jobCard.accessoriesReceived, 'wide'],
          ['Condition at drop-off', jobCard.conditionNotes, 'wide'],
        ],
      },
      {
        title: 'Warranty and sales',
        items: [
          ['Registered warranty', jobCard.warrantyStatus],
          ['Final warranty', jobCard.finalWarrantyStatus || jobCard.warrantyStatus],
          ['Reason for change', jobCard.warrantyOverrideReason, 'wide'],
          ['Warranty classification', jobCard.warrantyClassification],
          ['Appointment warranty', jobCard.appointmentJobWarranty],
          ['Sales order no.', jobCard.salesOrderNumber],
          ['Salesman', jobCard.salesman],
          ['Sales channel', jobCard.salesChannel],
          ['Delivery date', jobCard.deliveryDate],
        ],
      },
      {
        title: 'Billing and payment',
        items: [
          ['Job type', billingJobTypeLabel(jobCard.billingJobType)],
          ['Payment by', jobCard.paymentBy],
          ['Bill to channel', jobCard.billToChannel],
          ['Tax invoice no.', jobCard.portalInvoiceNo],
          ['Customer TRN', jobCard.customerTrn],
          ['ERP reference', jobCard.invoiceNo],
          ['Invoice date', jobCard.invoiceDate],
          ['Payment mode', jobCard.paymentMode],
          ['Payment reference', jobCard.paymentReference],
          [
            'Payment confirmed',
            jobCard.paymentConfirmedAt
              ? formatDate(jobCard.paymentConfirmedAt)
              : jobCard.paymentBy === 'Customer'
                ? 'Not yet'
                : '',
          ],
        ],
      },
      {
        title: 'Service record',
        items: [
          ['Technician', jobCard.technicianName || jobCard.appointmentTechnicianName],
          ['Job card date', jobCard.jobCardDate],
          ['Work started', jobCard.periodFrom ? formatDate(jobCard.periodFrom) : ''],
          ['Work ended', jobCard.periodTo ? formatDate(jobCard.periodTo) : ''],
          ['Time consumed (hours)', jobCard.timeConsumedHours],
          ['Job status', jobCard.jobFinalStatus, 'pill'],
          ['Complaint reported', jobCard.complaint, 'wide'],
          ['Fault at booking', jobCard.faultDescription, 'wide'],
          ['Service rendered', jobCard.serviceRendered, 'wide'],
        ],
      },
      {
        title: 'Spare parts and charges',
        meta: `${(jobCard.parts || []).length} part${(jobCard.parts || []).length === 1 ? '' : 's'}`,
        html: jobCardPartsHtml(jobCard),
      },
      {
        title: 'Customer approval',
        items: approval
          ? [
              ['Approval request', approval.approvalReference],
              ['Status', approval.status, 'pill'],
              ['How it was given', approval.decisionMethod],
              ['Given by', approval.decidedByName],
              ['Decided at', approval.decidedAt ? formatDate(approval.decidedAt) : ''],
              ['Notes', approval.decisionNotes, 'wide'],
            ]
          : [['Approval request', 'None raised yet']],
      },
      {
        title: 'Origin',
        items: [
          ['Source', jobCard.sourceType],
          ['Complaint', jobCard.complaintReference],
          ['Complaint status', jobCard.complaintStatus],
          [
            'Complaint logged',
            jobCard.complaintSubmittedAt ? formatDate(jobCard.complaintSubmittedAt) : '',
          ],
          ['Appointment', jobCard.appointmentReference],
          ['Appointment status', jobCard.appointmentStatus],
          ['Appointment date', jobCard.appointmentDate],
          ['Quotation', jobCard.quotationReference],
          ['Received (walk-in)', jobCard.intakeAt ? formatDate(jobCard.intakeAt) : ''],
          ['Legacy reference', jobCard.legacyReference],
          ['CCE notes', jobCard.cceNotes, 'wide'],
        ],
      },
      {
        title: 'Record',
        items: [
          ['Created', formatDate(jobCard.createdAt)],
          ['Last updated', formatDate(jobCard.updatedAt)],
          ['Closed at', jobCard.finalizedAt ? formatDate(jobCard.finalizedAt) : ''],
        ],
      },
    ]);
  }

  async function loadJobCardDetail(id) {
    if (!hasPermission('service_job_card.read')) return;
    setMessage('#workspaceMessage', '', false);
    try {
      const result = await apiRequest('/api/job-cards/' + encodeURIComponent(id));
      const jobCard = result.jobCard;
      currentJobCardId = jobCard.id;
      currentJobCard = jobCard;
      renderJobCardActions(jobCard);
      if (!$('#jobCardActions').hidden) applyMasterContext('jce', result);
      renderJobCardGuide(jobCard);
      renderClosureApproval(jobCard);
      $('#jobCardDetailHeading').textContent =
        jobCard.jobCardReference || 'Service job card details';
      $('#jobCardDetailStatus').innerHTML =
        `<span class="status ${statusClass(jobCard.jobFinalStatus)}">${escapeHtml(jobCard.jobFinalStatus)}</span>` +
        (jobCard.finalStatus
          ? ` <span class="status ${statusClass(jobCard.finalStatus)}">${escapeHtml(jobCard.finalStatus)}</span>`
          : '');
      renderWorkflowStepper(
        'jobCardWorkflowStepper',
        workflowStageForJobCardStatus(jobCard.status),
      );
      // Breadcrumb order matches the chain's direction: Complaint ->
      // Appointment -> (this job card).
      const jobCardWorkflowLinks = [];
      if (jobCard.complaintId && jobCard.complaintReference) {
        const complaintId = jobCard.complaintId;
        jobCardWorkflowLinks.push({
          label: `Complaint ${jobCard.complaintReference}`,
          onClick: () => {
            setWorkspaceMode('complaints');
            loadComplaintDetail(complaintId);
          },
        });
      }
      if (jobCard.appointmentId) {
        const appointmentId = jobCard.appointmentId;
        jobCardWorkflowLinks.push({
          label: `Appointment ${jobCard.appointmentReference}`,
          onClick: () => {
            setWorkspaceMode('appointments');
            loadAppointmentDetail(appointmentId);
          },
        });
      }
      if (jobCard.quotationId && jobCard.quotationReference && hasPermission('quotation.read')) {
        const quotationId = jobCard.quotationId;
        jobCardWorkflowLinks.push({
          label: `Quotation ${jobCard.quotationReference}`,
          onClick: () => {
            setWorkspaceMode('quotations');
            loadQuotationDetail(quotationId);
          },
        });
      }
      const approval = result.approval;
      if (approval && hasPermission('warranty_approval.read')) {
        jobCardWorkflowLinks.push({
          label: `Approval ${approval.approvalReference} (${approval.status})`,
          onClick: () => {
            setWorkspaceMode('warranty-approvals');
            loadWarrantyApprovalDetail(approval.id);
          },
        });
      }
      renderWorkflowLinks('jobCardWorkflowLinks', jobCardWorkflowLinks);
      renderJobCardDetailSections(jobCard, approval);
      $('#jobCardHistoryList').innerHTML =
        (result.history || [])
          .map(
            (entry) =>
              `<li><time>${escapeHtml(formatDate(entry.changedAt))}</time><div><strong>${escapeHtml(entry.fromStatus ? entry.fromStatus + ' → ' : '')}${escapeHtml(entry.toStatus)}</strong>${entry.reason ? `<br><span>${escapeHtml(entry.reason)}</span>` : ''}</div></li>`,
          )
          .join('') || '<li><span>No history recorded.</span></li>';
      $('#jobCardAttachmentUpload').hidden = !hasPermission('service_job_card.write');
      await loadJobCardAttachments(jobCard.id);
      $('#jobCardDetail').hidden = false;
      $('#jobCardDetail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 403) {
        $('#jobCardDetail').hidden = true;
        setWorkspaceRecovery('You are not authorized to view service job-card details.', () =>
          loadJobCardDetail(id),
        );
      } else if (error.status === 404) {
        currentJobCardId = null;
        $('#jobCardDetail').hidden = true;
        setWorkspaceRecovery(
          'This service job card no longer exists. Return to the job-card list and try again.',
          loadJobCards,
        );
      } else {
        $('#jobCardDetail').hidden = true;
        setWorkspaceRecovery(error.message, () => loadJobCardDetail(id));
      }
    }
  }

  function renderJobCardAttachments(attachments) {
    const canWrite = hasPermission('service_job_card.write');
    const list = $('#jobCardAttachmentsList');
    list.innerHTML =
      attachments
        .map(
          (attachment) =>
            `<li><a href="${escapeHtml(attachment.downloadUrl)}" target="_blank" rel="noopener">${escapeHtml(attachment.fileName)}</a> <small>(${escapeHtml(attachment.contentType)}, ${(attachment.sizeBytes / 1024).toFixed(0)} KB)</small>${
              canWrite
                ? ` <button type="button" class="button-link" data-remove-attachment="${escapeHtml(attachment.id)}">Delete</button>`
                : ''
            }</li>`,
        )
        .join('') || '<li><span>No attachments yet.</span></li>';
    list.querySelectorAll('[data-remove-attachment]').forEach((button) => {
      button.addEventListener('click', () =>
        removeJobCardAttachment(button.dataset.removeAttachment),
      );
    });
  }

  async function loadJobCardAttachments(jobCardId) {
    if (!hasPermission('service_job_card.read')) return;
    try {
      const result = await apiRequest(
        '/api/job-cards/' + encodeURIComponent(jobCardId) + '/attachments',
      );
      renderJobCardAttachments(result.attachments || []);
    } catch (error) {
      if (error.status !== 403) {
        $('#jobCardAttachmentsList').innerHTML =
          '<li><span>Attachments could not be loaded.</span></li>';
      }
    }
  }

  async function uploadJobCardAttachment() {
    if (!currentJobCardId) return;
    const input = $('#jobCardAttachmentFile');
    const file = input.files?.[0];
    if (!file) {
      setMessage('#workspaceMessage', 'Choose a file to upload first.');
      return;
    }
    const button = $('#uploadJobCardAttachmentButton');
    setBusy(button, true, 'Uploading…');
    try {
      const formData = new FormData();
      formData.append('file', file);
      await apiUploadRequest(
        '/api/job-cards/' + encodeURIComponent(currentJobCardId) + '/attachments',
        formData,
      );
      input.value = '';
      await loadJobCardAttachments(currentJobCardId);
      setMessage('#workspaceMessage', 'Attachment uploaded.', true);
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else {
        setMessage('#workspaceMessage', error.message);
      }
    } finally {
      setBusy(button, false);
    }
  }

  async function removeJobCardAttachment(attachmentId) {
    if (!currentJobCardId) return;
    try {
      await apiRequest('/api/attachments/' + encodeURIComponent(attachmentId), {
        method: 'DELETE',
      });
      await loadJobCardAttachments(currentJobCardId);
      setMessage('#workspaceMessage', 'Attachment deleted.', true);
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else {
        setMessage('#workspaceMessage', error.message);
      }
    }
  }

  async function createJobCard() {
    // Step 1 of 2: pull the default job-card content from the completed
    // appointment (matching the live system's pullJobCardFromScheduler) and
    // show it in an editable form -- nothing is created yet. Step 2 is
    // submitJobCardCreate() below, fired by the form's own submit button.
    if (!currentAppointmentId || !hasPermission('service_job_card.write')) return;
    const button = $('#createJobCardButton');
    setBusy(button, true, 'Loading…');
    try {
      const result = await apiRequest(
        '/api/appointments/' + encodeURIComponent(currentAppointmentId) + '/job-card/prefill',
      );
      fillJobCardForm('jcc', result.content);
      markMasterFields('jcc', result.masterFields);
      $('#jobCardCreatePanel').hidden = false;
      $('#jobCardCreatePanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 403) {
        button.hidden = true;
        setMessage('#workspaceMessage', 'You are not authorized to create service job cards.');
      } else {
        setMessage('#workspaceMessage', error.message);
      }
    } finally {
      setBusy(button, false);
    }
  }

  async function submitJobCardCreate() {
    if (!currentAppointmentId) return;
    if (!(await demandSalesman('jcc')) || !(await demandSalesmanChannel('jcc'))) return;
    const button = $('#submitJobCardCreateButton');
    setBusy(button, true, 'Creating…');
    try {
      const result = await apiRequest(
        '/api/appointments/' + encodeURIComponent(currentAppointmentId) + '/job-card',
        { method: 'POST', body: JSON.stringify(collectJobCardForm('jcc')) },
      );
      $('#jobCardCreatePanel').hidden = true;
      await loadAppointments();
      setWorkspaceMode('job-cards');
      await loadJobCardDetail(result.jobCard.id);
      setMessage(
        '#workspaceMessage',
        `Service job card ${result.jobCard.jobCardReference} created.`,
        true,
      );
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 403) {
        $('#jobCardCreatePanel').hidden = true;
        setMessage('#workspaceMessage', 'You are not authorized to create service job cards.');
      } else if (error.status === 400 || error.status === 404 || error.status === 409) {
        setMessage('#workspaceMessage', error.message);
      } else {
        setMessage('#workspaceMessage', error.message);
      }
    } finally {
      setBusy(button, false);
    }
  }

  // ---- Create a service job card from a Quotation (modification.md #18),
  // matching the live system's "pull from Quotation" flow. Same two-step
  // pattern as createJobCard()/submitJobCardCreate() above -- prefill into an
  // editable form first, nothing is created until the form is submitted --
  // reusing the same jobCardFieldsHtml/fillJobCardForm/collectJobCardForm
  // machinery with its own 'jcq' field prefix.
  async function createJobCardFromQuotation() {
    if (!currentQuotationId || !hasPermission('service_job_card.write')) return;
    const button = $('#createJobCardFromQuotationButton');
    setBusy(button, true, 'Loading…');
    try {
      const result = await apiRequest(
        '/api/quotations/' + encodeURIComponent(currentQuotationId) + '/job-card/prefill',
      );
      fillJobCardForm('jcq', result.content);
      if (result.initialJobFinalStatus) {
        $('#jcqJobFinalStatus').value = result.initialJobFinalStatus;
      }
      $('#quotationJobCardCreatePanel').hidden = false;
      $('#quotationJobCardCreatePanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 403) {
        button.hidden = true;
        setMessage('#workspaceMessage', 'You are not authorized to create service job cards.');
      } else {
        setMessage('#workspaceMessage', error.message);
      }
    } finally {
      setBusy(button, false);
    }
  }

  async function submitJobCardCreateFromQuotation() {
    if (!currentQuotationId) return;
    if (!(await demandSalesman('jcq')) || !(await demandSalesmanChannel('jcq'))) return;
    const button = $('#submitQuotationJobCardCreateButton');
    setBusy(button, true, 'Creating…');
    try {
      const result = await apiRequest(
        '/api/quotations/' + encodeURIComponent(currentQuotationId) + '/job-card',
        { method: 'POST', body: JSON.stringify(collectJobCardForm('jcq')) },
      );
      $('#quotationJobCardCreatePanel').hidden = true;
      setWorkspaceMode('job-cards');
      await loadJobCardDetail(result.jobCard.id);
      setMessage(
        '#workspaceMessage',
        `Service job card ${result.jobCard.jobCardReference} created.`,
        true,
      );
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 403) {
        $('#quotationJobCardCreatePanel').hidden = true;
        setMessage('#workspaceMessage', 'You are not authorized to create service job cards.');
      } else {
        setMessage('#workspaceMessage', error.message);
      }
    } finally {
      setBusy(button, false);
    }
  }

  // Pop-up shown when a job is moved from Customer approval pending to WIP by
  // hand: how the customer approved, an optional note and an optional attachment
  // (the email, message screenshot or signed approval).
  function askCustomerApproval() {
    return new Promise((resolve) => {
      const dialog = document.createElement('dialog');
      dialog.className = 'pw-dialog';
      dialog.innerHTML = `<h3>Customer approval ${tipHtml('Record how the customer approved the work before the job moves to WIP. Attach the email, message screenshot or signed approval if you have one; the attachment is optional.')}</h3>
        <form method="dialog" novalidate>
          <div class="field"><label for="caMethod">How did the customer approve?</label>
            <select id="caMethod"><option value="">Select</option><option>Phone</option><option>Email</option><option>WhatsApp</option><option>In person</option><option>Other</option></select></div>
          <div class="field"><label for="caNotes">Notes</label><textarea id="caNotes" maxlength="2000"></textarea></div>
          <div class="field"><label for="caFile">Attachment (optional)</label><input type="file" id="caFile"></div>
          <p class="field-error" id="caError" role="alert"></p>
          <div class="form-footer"><button type="button" class="button button-outline" data-ca-cancel>Cancel</button><button type="button" class="button button-primary" data-ca-confirm>Confirm and move to WIP</button></div>
        </form>`;
      let result = null;
      dialog.addEventListener('click', (event) => {
        if (event.target.closest('[data-ca-cancel]')) {
          dialog.close();
        } else if (event.target.closest('[data-ca-confirm]')) {
          const method = dialog.querySelector('#caMethod').value;
          if (!method) {
            dialog.querySelector('#caError').textContent = 'Choose how the customer approved.';
            return;
          }
          result = {
            method,
            notes: dialog.querySelector('#caNotes').value.trim(),
            file: dialog.querySelector('#caFile').files?.[0] || null,
          };
          dialog.close();
        }
      });
      dialog.addEventListener('close', () => {
        dialog.remove();
        resolve(result);
      });
      document.body.appendChild(dialog);
      dialog.showModal();
    });
  }

  async function saveJobCardContent() {
    if (!currentJobCardId) return;
    if (!(await demandSalesman('jce')) || !(await demandSalesmanChannel('jce'))) return;
    const payload = collectJobCardForm('jce');
    let approvalFile = null;
    if (
      currentJobCard?.jobFinalStatus === 'Customer approval pending' &&
      payload.jobFinalStatus === 'WIP'
    ) {
      const approval = await askCustomerApproval();
      if (!approval) return;
      payload.approvalMethod = approval.method;
      if (approval.notes) payload.approvalNotes = approval.notes;
      approvalFile = approval.file;
    }
    const button = $('#saveJobCardContentButton');
    setBusy(button, true, 'Saving…');
    try {
      if (approvalFile) {
        const formData = new FormData();
        formData.append('file', approvalFile);
        await apiUploadRequest(
          '/api/job-cards/' + encodeURIComponent(currentJobCardId) + '/attachments',
          formData,
        );
      }
      await apiRequest('/api/job-cards/' + encodeURIComponent(currentJobCardId), {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      await loadJobCardDetail(currentJobCardId);
      await loadJobCards();
      setMessage('#workspaceMessage', 'Service job-card details saved.', true);
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 403) {
        $('#jobCardContentAction').hidden = true;
        setMessage('#workspaceMessage', 'You are not authorized to edit service job cards.');
      } else if (
        /^(Choose the reason this BER|Choose the sales channel this job|Choose the salesman|This job is waiting for manager approval|This job carries spare parts)/.test(
          error.message || '',
        )
      ) {
        // Keep the form as it is, so nothing typed is lost, and explain what is needed.
        await notifyDialog('Before this job can be closed', error.message);
        if (/^Choose the sales channel/.test(error.message || ''))
          highlightMissingForDelivery('jce');
      } else if (error.status === 400 || error.status === 404 || error.status === 409) {
        await loadJobCardDetail(currentJobCardId);
        setMessage('#workspaceMessage', error.message);
      } else {
        setMessage('#workspaceMessage', error.message);
      }
    } finally {
      setBusy(button, false);
    }
  }

  function appointmentDateTime(appointment) {
    if (!appointment?.appointmentDate) return '—';
    const date = localDate(appointment.appointmentDate);
    return Number.isNaN(date.valueOf())
      ? appointment.appointmentDate
      : date.toLocaleDateString(undefined, { dateStyle: 'medium' });
  }

  // The selected calendar day is simply From = To = that day, so the list, the
  // date filters and the calendar highlight can never disagree.
  function selectedAppointmentDay() {
    const from = $('#appointmentFrom').value;
    return from && from === $('#appointmentTo').value ? from : '';
  }

  function toggleAppointmentDay(key) {
    const clear = selectedAppointmentDay() === key;
    $('#appointmentFrom').value = clear ? '' : key;
    $('#appointmentTo').value = clear ? '' : key;
    loadAppointments();
  }

  function clearAppointmentDay() {
    $('#appointmentFrom').value = '';
    $('#appointmentTo').value = '';
    loadAppointments();
  }

  function updateAppointmentDayBar(count) {
    const day = selectedAppointmentDay();
    const bar = $('#appointmentDayBar');
    bar.hidden = !day;
    if (!day) return;
    const label = localDate(day).toLocaleDateString('en-GB', { dateStyle: 'full' });
    $('#appointmentDayLabel').textContent =
      `${label}: ${count} appointment${count === 1 ? '' : 's'}`;
  }

  function renderAppointments(appointments) {
    const body = $('#appointmentsBody');
    const canMessage = hasPermission('appointments.write');
    const initials = (name) =>
      String(name)
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0].toUpperCase())
        .join('');
    body.innerHTML = appointments
      .map((appointment) => {
        const key = CAL_STATUS_KEY[appointment.status] || 'scheduled';
        const messageable =
          canMessage &&
          (appointment.status === 'Scheduled' || appointment.status === 'In Progress');
        const tech = appointment.technicianName
          ? `<span class="ap-tech"><b aria-hidden="true">${escapeHtml(initials(appointment.technicianName))}</b>${escapeHtml(appointment.technicianName)}</span>`
          : '<span class="ap-none">Unassigned</span>';
        return `<tr class="row-${key}"><td><button class="table-link" type="button" data-appointment-id="${escapeHtml(appointment.id)}">${escapeHtml(appointment.appointmentReference)}</button></td><td><span class="ap-name">${escapeHtml(appointment.customerName)}</span>${appointment.contactNumber ? `<span class="ap-sub">${escapeHtml(appointment.contactNumber)}</span>` : ''}</td><td class="ap-date">${escapeHtml(appointmentDateTime(appointment))}</td><td>${tech}</td><td><span class="ap-pill st-${key}">${escapeHtml(appointment.status)}</span></td><td>${escapeHtml(appointment.region || '—')}</td><td class="ap-actions">${messageable ? `<button class="button button-outline ap-msg-btn" type="button" data-appointment-message="${escapeHtml(appointment.id)}" aria-label="Send WhatsApp or email to ${escapeHtml(appointment.customerName)}">Message</button>` : ''}</td></tr>`;
      })
      .join('');
    $('#appointmentListCount').textContent = appointments.length ? String(appointments.length) : '';
    $('#appointmentsEmpty').hidden = appointments.length > 0;
    updateAppointmentDayBar(appointments.length);
    body
      .querySelectorAll('[data-appointment-message]')
      .forEach((button) =>
        button.addEventListener('click', () =>
          loadAppointmentDetail(button.dataset.appointmentMessage, { focusMessages: true }),
        ),
      );
    body
      .querySelectorAll('[data-appointment-id]')
      .forEach((button) =>
        button.addEventListener('click', () => loadAppointmentDetail(button.dataset.appointmentId)),
      );
  }

  const CAL_STATUS_KEY = {
    Scheduled: 'scheduled',
    'In Progress': 'in-progress',
    Completed: 'completed',
    Cancelled: 'cancelled',
  };
  const CAL_MONTH_CHIPS = 3;

  function calChipHtml(appointment, canWrite) {
    const key = CAL_STATUS_KEY[appointment.status] || 'scheduled';
    const draggable =
      canWrite && appointment.status !== 'Completed' && appointment.status !== 'Cancelled';
    const tip = `${appointment.appointmentReference} · ${appointment.status}${
      appointment.technicianName ? ' · ' + appointment.technicianName : ''
    }${draggable ? '. Drag to reschedule.' : ''}`;
    const meta =
      calendarView === 'week'
        ? `${escapeHtml(appointment.appointmentReference)} · ${escapeHtml(appointment.status)}`
        : escapeHtml(appointment.appointmentReference.split('-').pop());
    return `<button class="cal-chip st-${key}" type="button" data-calendar-appointment-id="${escapeHtml(appointment.id)}" draggable="${draggable}" title="${escapeHtml(tip)}"><i aria-hidden="true"></i><span class="cn">${escapeHtml(appointment.customerName)}</span><span class="cm">${meta}</span></button>`;
  }

  function renderCalendar() {
    const range = calendarRange();
    const calendar = $('#appointmentCalendar');
    const canWrite = hasPermission('appointments.write');
    const days = Math.round((range.end - range.start) / 86400000) + 1;
    const byDate = new Map();
    const counts = { Scheduled: 0, 'In Progress': 0, Completed: 0, Cancelled: 0 };
    calendarAppointments.forEach((appointment) => {
      const key = appointment.appointmentDate;
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key).push(appointment);
      if (appointment.status in counts) counts[appointment.status] += 1;
    });
    const weekdayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      .map((day) => `<div class="calendar-cell-header">${day}</div>`)
      .join('');
    const todayKey = dateInputValue(new Date());
    const selectedDay = selectedAppointmentDay();
    const cells = Array.from({ length: days }, (_, index) => {
      const date = shiftDate(range.start, index);
      const key = dateInputValue(date);
      const all = (byDate.get(key) || []).sort((left, right) =>
        String(left.customerName).localeCompare(String(right.customerName)),
      );
      const limit = calendarView === 'week' ? all.length : CAL_MONTH_CHIPS;
      const events = all
        .slice(0, limit)
        .map((appointment) => calChipHtml(appointment, canWrite))
        .join('');
      const more =
        all.length > limit
          ? `<button class="cal-more" type="button" data-cal-more="${key}">+${all.length - limit} more</button>`
          : '';
      const outside = calendarView === 'month' && date.getMonth() !== calendarCursor.getMonth();
      const selected = key === selectedDay;
      const dayLabel = date.toLocaleDateString('en-GB', { dateStyle: 'full' });
      return `<div class="calendar-cell${key === todayKey ? ' calendar-cell-today' : ''}${outside ? ' is-outside' : ''}${selected ? ' is-selected' : ''}" data-calendar-date="${key}"><button class="cal-day" type="button" data-cal-day="${key}" aria-pressed="${selected}" aria-label="${selected ? 'Selected, click to show all dates: ' : 'Show only appointments on '}${escapeHtml(dayLabel)}" title="${selected ? 'Click to show all dates' : 'Show only this day'}">${date.getDate()}</button>${events}${more}</div>`;
    }).join('');
    calendar.className = `calendar-grid calendar-${calendarView}`;
    calendar.setAttribute('aria-label', `${calendarTitle(range)} appointment calendar`);
    calendar.innerHTML = weekdayHeaders + cells;
    $('#calendarTitle').textContent = calendarTitle(range);
    $('#calendarLegend').innerHTML = [
      ['Scheduled', 'scheduled'],
      ['In Progress', 'progress'],
      ['Completed', 'completed'],
      ['Cancelled', 'cancelled'],
    ]
      .map(
        ([label, key]) =>
          `<span style="--st:var(--st-${key})"><i aria-hidden="true"></i>${label} <b>${counts[label]}</b></span>`,
      )
      .join('');
    ['Month', 'Week'].forEach((name) => {
      const button = $('#calendar' + name + 'Button');
      const on = calendarView === name.toLowerCase();
      button.setAttribute('aria-pressed', String(on));
      button.className = 'cal-seg-btn' + (on ? ' is-active' : '');
    });
    calendar.querySelectorAll('[data-calendar-appointment-id]').forEach((button) => {
      button.addEventListener('click', () =>
        loadAppointmentDetail(button.dataset.calendarAppointmentId),
      );
      if (button.draggable) {
        button.addEventListener('dragstart', (event) => {
          event.dataTransfer.setData('text/plain', button.dataset.calendarAppointmentId);
          event.dataTransfer.effectAllowed = 'move';
        });
      }
    });
    calendar
      .querySelectorAll('[data-cal-day]')
      .forEach((button) =>
        button.addEventListener('click', () => toggleAppointmentDay(button.dataset.calDay)),
      );
    calendar.querySelectorAll('[data-cal-more]').forEach((button) =>
      button.addEventListener('click', () => {
        calendarCursor = localDate(button.dataset.calMore);
        calendarView = 'week';
        loadCalendar();
      }),
    );
    calendar.querySelectorAll('[data-calendar-date]').forEach((cell) => {
      // A click on empty space in a day also selects it; chips and "+n more"
      // keep their own behaviour.
      cell.addEventListener('click', (event) => {
        if (event.target.closest('button')) return;
        toggleAppointmentDay(cell.dataset.calendarDate);
      });
      cell.addEventListener('dragover', (event) => {
        if (canWrite) event.preventDefault();
      });
      cell.addEventListener('drop', async (event) => {
        event.preventDefault();
        const id = event.dataTransfer.getData('text/plain');
        const appointment = calendarAppointments.find((item) => item.id === id);
        if (appointment && canWrite) await rescheduleAppointment(id, cell.dataset.calendarDate);
      });
    });
  }

  async function loadCalendar() {
    if (!hasPermission('appointments.read')) return;
    const sequence = ++calendarRequestSequence;
    const range = calendarRange();
    const params = new URLSearchParams({
      from: dateInputValue(range.start),
      to: dateInputValue(range.end),
      page: '1',
      pageSize: '100',
    });
    const status = $('#appointmentStatusFilter').value;
    const search = $('#appointmentSearch').value.trim();
    const calendarTechnician = $('#appointmentTechnicianFilter').value;
    if (calendarTechnician) params.set('technicianId', calendarTechnician);
    if (status) params.set('status', status);
    if (search) params.set('search', search);
    $('#appointmentCalendar').innerHTML = '<div class="calendar-empty">Loading calendar…</div>';
    setMessage('#calendarMessage', '', false);
    try {
      const appointments = [];
      let page = 1;
      let total = 0;
      do {
        params.set('page', String(page));
        const result = await apiRequest('/api/appointments?' + params);
        appointments.push(...(result.appointments || []));
        total = Number(result.pagination?.total || appointments.length);
        page += 1;
      } while (appointments.length < total && sequence === calendarRequestSequence);
      if (sequence !== calendarRequestSequence) return;
      calendarAppointments = appointments;
      renderCalendar();
    } catch (error) {
      if (sequence !== calendarRequestSequence) return;
      calendarAppointments = [];
      $('#appointmentCalendar').innerHTML =
        '<div class="calendar-empty">Calendar data could not be loaded.</div>';
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 403) {
        setMessage('#calendarMessage', 'You are not authorized to view the appointment calendar.');
      } else {
        setMessage('#calendarMessage', error.message);
      }
    }
  }

  // Technician filter for the Appointments page (also drives the print buttons).
  let appointmentTechniciansLoaded = false;
  async function loadAppointmentTechnicianFilter() {
    if (appointmentTechniciansLoaded || !hasPermission('technicians.read')) return;
    try {
      const result = await apiRequest('/api/technicians?page=1&pageSize=200');
      const select = $('#appointmentTechnicianFilter');
      const current = select.value;
      select.innerHTML =
        '<option value="">All technicians</option>' +
        (result.technicians || [])
          .map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`)
          .join('');
      select.value = current;
      appointmentTechniciansLoaded = true;
    } catch {
      // The filter simply stays on "All technicians".
    }
  }

  // Print the scheduled visits in the chosen date range (and technician), the
  // same list and sheets as the Daily schedule page.
  async function printAppointmentRange(kind) {
    const today = pgYmd(new Date());
    const from = $('#appointmentFrom').value || $('#appointmentTo').value || today;
    const to = $('#appointmentTo').value || from;
    const technicianId = $('#appointmentTechnicianFilter').value;
    const button = $(
      kind === 'list' ? '#appointmentPrintListButton' : '#appointmentPrintSheetsButton',
    );
    setBusy(button, true, 'Loading…');
    try {
      const result = await apiRequest(
        '/api/appointments/daily-list?' + new URLSearchParams({ from, to }),
      );
      const rows = (result.rows || []).filter(
        (row) => !technicianId || row.technicianId === technicianId,
      );
      if (!rows.length) {
        setMessage('#workspaceMessage', 'No scheduled appointments in that date range.', false);
        return;
      }
      setMessage('#workspaceMessage', '', false);
      if (!dlPrintAllowed(rows)) return;
      if (kind === 'list') dlPrintList(rows, 'technician', from, to);
      else dlPrintSheets(rows, 'technician');
    } catch (error) {
      setMessage('#workspaceMessage', error.message, false);
    } finally {
      setBusy(button, false);
    }
  }

  async function loadAppointments() {
    if (!hasPermission('appointments.read')) return;
    clearWorkspaceRecovery();
    loadAppointmentTechnicianFilter();
    const params = new URLSearchParams({ page: '1', pageSize: '50' });
    const search = $('#appointmentSearch').value.trim();
    const status = $('#appointmentStatusFilter').value;
    const from = $('#appointmentFrom').value;
    const to = $('#appointmentTo').value;
    const technicianId = $('#appointmentTechnicianFilter').value;
    if (technicianId) params.set('technicianId', technicianId);
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    setMessage('#workspaceMessage', '', false);
    $('#appointmentsBody').innerHTML =
      '<tr><td colspan="7" class="empty-state">Loading appointments…</td></tr>';
    try {
      const result = await apiRequest('/api/appointments?' + params);
      renderAppointments(result.appointments || []);
      await loadCalendar();
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 403) {
        setWorkspaceRecovery('You are not authorized to view appointments.', loadAppointments);
      } else {
        setWorkspaceRecovery(error.message, loadAppointments);
      }
      $('#appointmentsBody').innerHTML = '';
      $('#appointmentsEmpty').hidden = false;
      $('#appointmentCalendar').innerHTML =
        '<div class="calendar-empty">Calendar unavailable until the appointment list loads.</div>';
    }
  }

  function renderAppointmentActions(appointment) {
    const canWrite = hasPermission('appointments.write');
    const terminal = appointment.status === 'Completed' || appointment.status === 'Cancelled';
    // A job card is created FROM a completed appointment (it records what was
    // actually done), never before -- so the button only ever shows once the
    // appointment reaches Completed, not merely once it stops being editable.
    const eligibleForJobCard = appointment.status === 'Completed';
    $('#appointmentActions').hidden = !canWrite;
    $('#createJobCardButton').hidden =
      !hasPermission('service_job_card.write') || !eligibleForJobCard;
    $('#jobCardCreatePanel').hidden = true;
    $('#appointmentAssignmentAction').hidden = !canWrite;
    $('#appointmentScheduleAction').hidden = !canWrite || terminal;
    $('#appointmentStatusAction').hidden = !canWrite;
    $('#downloadAppointmentIcsButton').hidden = !hasPermission('appointments.read');
    $('#appointmentRescheduleDate').value = appointment.appointmentDate || '';

    const nextStatuses = appointmentTransitions[appointment.status] || [];
    $('#appointmentNextStatus').innerHTML = nextStatuses.length
      ? nextStatuses
          .map((status) => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`)
          .join('')
      : '<option value="">No further transitions</option>';
    $('#appointmentNextStatus').disabled = nextStatuses.length === 0;
    $('#updateAppointmentStatusButton').disabled = nextStatuses.length === 0;
    $('#appointmentStatusReason').value = '';
    $('#appointmentTechnician').innerHTML = appointment.technicianId
      ? `<option value="${escapeHtml(appointment.technicianId)}">Current technician (${escapeHtml(appointment.technicianId)})</option>`
      : '<option value="">Select a technician</option>';
    $('#appointmentTechnician').disabled = !hasPermission('technicians.read');
    $('#unassignAppointmentButton').disabled = !appointment.technicianId;
    clearErrors($('#appointmentAssignmentForm'));
    clearErrors($('#appointmentStatusForm'));
  }

  async function loadAppointmentTechnicians(appointment) {
    const select = $('#appointmentTechnician');
    if (!hasPermission('technicians.read')) return;
    select.disabled = true;
    select.innerHTML = '<option value="">Loading technicians…</option>';
    try {
      const result = await apiRequest('/api/technicians?active=true&page=1&pageSize=100');
      const technicians = result.technicians || [];
      const currentId = appointment.technicianId;
      const hasCurrent = technicians.some((technician) => technician.id === currentId);
      select.innerHTML =
        '<option value="">Select a technician</option>' +
        (!hasCurrent && currentId
          ? `<option value="${escapeHtml(currentId)}">Current technician (${escapeHtml(currentId)})</option>`
          : '') +
        technicians
          .map(
            (technician) =>
              `<option value="${escapeHtml(technician.id)}">${escapeHtml(technician.name)}</option>`,
          )
          .join('');
      select.value = currentId || '';
      select.disabled = false;
    } catch (error) {
      select.innerHTML = '<option value="">Technicians could not be loaded</option>';
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 403) {
        $('#appointmentAssignmentAction').hidden = true;
        setMessage('#workspaceMessage', 'You are not authorized to view technicians.');
      } else {
        setMessage('#workspaceMessage', error.message);
      }
    }
  }

  // WhatsApp / email messages prepared from an appointment. The portal builds
  // the text and opens wa.me or the mail app; staff press Send there.
  const MESSAGE_CHANNEL_LABEL = { whatsapp: 'WhatsApp', email: 'Email' };

  async function loadAppointmentMessages(id) {
    const panel = $('#appointmentMessagePanel');
    panel.hidden = true;
    if (!hasPermission('appointments.read')) return;
    let result;
    try {
      result = await apiRequest('/api/appointments/' + encodeURIComponent(id) + '/messages');
    } catch {
      return;
    }
    const canWrite = hasPermission('appointments.write');
    const drafts = canWrite ? result.drafts || [] : [];
    const history = result.history || [];
    if (!drafts.length && !history.length) return;
    panel.hidden = false;
    panel.dataset.appointmentId = id;
    $('#appointmentMessageIntro').closest('.tooltip').hidden = !drafts.length;
    $('#appointmentMessageDrafts').innerHTML = drafts
      .map((draft, index) => {
        const button = (channel, reason, ok) =>
          `<button class="button button-outline" type="button" data-message-template="${draft.template}" data-message-channel="${channel}"${ok ? '' : ' disabled'} title="${escapeHtml(ok ? 'Open ' + MESSAGE_CHANNEL_LABEL[channel] + ' with this message' : reason || '')}">${MESSAGE_CHANNEL_LABEL[channel]}</button>`;
        const reasons = [draft.whatsappUnavailableReason, draft.emailUnavailableReason]
          .filter((reason, position, all) => reason && all.indexOf(reason) === position)
          .join(' ');
        return `<div class="msg-draft"><div class="msg-draft-head"><div><strong>${escapeHtml(draft.label)}${reasons ? ' ' + tipHtml(escapeHtml(reasons)) : ''}</strong><span class="ap-sub">${escapeHtml([draft.recipientName, draft.phone].filter(Boolean).join(' · ') || 'No recipient')}</span></div><div class="msg-draft-actions">${button('whatsapp', draft.whatsappUnavailableReason, Boolean(draft.whatsappNumber))}${button('email', draft.emailUnavailableReason, Boolean(draft.email))}</div></div>${draft.body ? `<details><summary>Preview message</summary><pre class="msg-preview">${escapeHtml(draft.body)}</pre></details>` : ''}</div>`;
      })
      .join('');
    $('#appointmentMessageHistory').innerHTML =
      history
        .map(
          (entry) =>
            `<li><time>${escapeHtml(formatDate(entry.createdAt))}</time><div><strong>${escapeHtml(MESSAGE_CHANNEL_LABEL[entry.channel] || entry.channel)} to ${escapeHtml(entry.recipientType)}</strong> <span>${escapeHtml(entry.recipient)}</span><br><span>${escapeHtml(entry.template.replaceAll('_', ' '))}${entry.sentByName ? ' · by ' + escapeHtml(entry.sentByName) : ''}</span></div></li>`,
        )
        .join('') || '<li style="grid-column: 1 / -1"><span>No messages prepared yet.</span></li>';
    $('#appointmentMessageDrafts')
      .querySelectorAll('[data-message-template]')
      .forEach((button) =>
        button.addEventListener('click', () =>
          sendAppointmentMessage(
            id,
            button.dataset.messageTemplate,
            button.dataset.messageChannel,
            button,
          ),
        ),
      );
  }

  async function sendAppointmentMessage(id, template, channel, button) {
    setBusy(button, true, 'Opening…');
    setMessage('#workspaceMessage', '', false);
    try {
      const result = await apiRequest('/api/appointments/' + encodeURIComponent(id) + '/messages', {
        method: 'POST',
        body: JSON.stringify({ template, channel }),
      });
      const link = document.createElement('a');
      link.href = result.url;
      if (channel === 'whatsapp') {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
      document.body.append(link);
      link.click();
      link.remove();
      setBusy(button, false);
      await loadAppointmentMessages(id);
      setMessage(
        '#workspaceMessage',
        `${MESSAGE_CHANNEL_LABEL[channel]} opened with the message. Press Send there to deliver it.`,
        false,
      );
    } catch (error) {
      setBusy(button, false);
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else {
        setMessage('#workspaceMessage', error.message);
        await loadAppointmentMessages(id);
      }
    }
  }

  async function loadAppointmentDetail(id, options = {}) {
    if (!hasPermission('appointments.read')) return;
    setMessage('#workspaceMessage', '', false);
    try {
      const result = await apiRequest('/api/appointments/' + encodeURIComponent(id));
      const appointment = result.appointment;
      currentAppointmentId = appointment.id;
      currentAppointment = appointment;
      $('#createJobCardButton').hidden = true;
      renderAppointmentActions(appointment);
      $('#appointmentDetailHeading').textContent =
        appointment.appointmentReference || 'Appointment details';
      $('#appointmentDetailStatus').innerHTML =
        `<span class="status ${statusClass(appointment.status)}">${escapeHtml(appointment.status)}</span>`;
      renderWorkflowStepper(
        'appointmentWorkflowStepper',
        workflowStageForAppointmentStatus(appointment.status),
      );
      renderDetailSections('#appointmentDetailGrid', [
        {
          strip: [
            ['Status', appointment.status, 'pill'],
            ['Date', appointmentDateTime(appointment)],
            ['Technician', appointment.technicianName || 'Unassigned'],
            ['Warranty', appointment.jobWarranty],
            ['Complaint', appointment.complaintReference],
            ['Complaint source', appointment.complaintSource],
          ],
        },
        {
          title: 'Customer',
          items: [
            ['Customer', appointment.customerName],
            ['Customer type', appointment.customerType],
            ['Contact', appointment.contactNumber, 'phone'],
            ['Email', appointment.customerEmail, 'email'],
            ['Customer number', appointment.customerNumber],
            ['Region', appointment.region],
            ['B2B branch / school', appointment.b2bBranchSchool],
            ['Site contact person', appointment.schoolContactPerson],
            ['Site contact number', appointment.schoolContactNumber, 'phone'],
            ['Address', appointment.address, 'wide'],
          ],
        },
        {
          title: 'Product',
          items: [
            ['Brand', appointment.brand],
            ['Model', appointment.model],
            ['Item code', appointment.itemCode],
            ['Sub group', appointment.subGroup],
          ],
        },
        {
          title: 'Warranty and sales',
          items: [
            ['Job warranty', appointment.jobWarranty],
            ['Sales order no.', appointment.salesOrderNumber],
            ['Salesman', appointment.salesman],
          ],
        },
        {
          title: 'Visit',
          items: [
            ['Appointment', appointment.appointmentReference],
            ['Appointment date', appointmentDateTime(appointment)],
            ['Technician', appointment.technicianName || 'Unassigned'],
            ['Complaint', appointment.complaintReference],
            ['Fault description', appointment.faultDescription, 'wide'],
          ],
        },
        {
          title: 'Record',
          items: [
            ['Created', formatDate(appointment.createdAt)],
            ['Last updated', formatDate(appointment.updatedAt)],
            ['Closed at', appointment.closedAt ? formatDate(appointment.closedAt) : ''],
          ],
        },
      ]);
      $('#appointmentHistoryList').innerHTML =
        (result.history || [])
          .map(
            (entry) =>
              `<li><time>${escapeHtml(formatDate(entry.changedAt))}</time><div><strong>${escapeHtml(entry.fromStatus ? entry.fromStatus + ' → ' : '')}${escapeHtml(entry.toStatus)}</strong>${entry.reason ? `<br><span>${escapeHtml(entry.reason)}</span>` : ''}</div></li>`,
          )
          .join('') || '<li><span>No history recorded.</span></li>';
      $('#appointmentDetail').hidden = false;
      const appointmentWorkflowLinks = [];
      if (appointment.complaintId && appointment.complaintReference) {
        const complaintId = appointment.complaintId;
        appointmentWorkflowLinks.push({
          label: `Complaint ${appointment.complaintReference}`,
          onClick: () => {
            setWorkspaceMode('complaints');
            loadComplaintDetail(complaintId);
          },
        });
      }
      if (hasPermission('service_job_card.read')) {
        try {
          const jobCardResult = await apiRequest(
            '/api/appointments/' + encodeURIComponent(appointment.id) + '/job-card',
          );
          $('#createJobCardButton').hidden =
            Boolean(jobCardResult.jobCard) || !hasPermission('service_job_card.write');
          if (jobCardResult.jobCard) {
            const jobCardId = jobCardResult.jobCard.id;
            appointmentWorkflowLinks.push({
              label: `Job card ${jobCardResult.jobCard.jobCardReference}`,
              onClick: () => {
                setWorkspaceMode('job-cards');
                loadJobCardDetail(jobCardId);
              },
            });
          }
        } catch (jobCardError) {
          if (jobCardError.status === 403) $('#createJobCardButton').hidden = true;
        }
      } else {
        $('#createJobCardButton').hidden = true;
      }
      renderWorkflowLinks('appointmentWorkflowLinks', appointmentWorkflowLinks);
      if (hasPermission('appointments.write') && hasPermission('technicians.read')) {
        await loadAppointmentTechnicians(appointment);
      }
      await loadAppointmentMessages(appointment.id);
      if (options.focusMessages && !$('#appointmentMessagePanel').hidden) {
        $('#appointmentMessagePanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        $('#appointmentDetail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 403) {
        $('#appointmentDetail').hidden = true;
        setWorkspaceRecovery(
          'You are not authorized to view appointment details.',
          () => loadAppointmentDetail(id),
          true,
        );
      } else if (error.status === 404) {
        currentAppointmentId = null;
        $('#appointmentDetail').hidden = true;
        setWorkspaceRecovery(
          'This appointment no longer exists. Return to the appointment list and try again.',
          loadAppointments,
          true,
        );
      } else {
        $('#appointmentDetail').hidden = true;
        setWorkspaceRecovery(error.message, () => loadAppointmentDetail(id), true);
      }
    }
  }

  async function refreshAppointmentView(message, success = false) {
    if (currentAppointmentId) await loadAppointmentDetail(currentAppointmentId);
    await loadAppointments();
    setMessage('#workspaceMessage', message, success ? true : undefined);
  }

  async function rescheduleAppointment(id, appointmentDate, initiatingButton = null) {
    const button = initiatingButton || $('#saveAppointmentScheduleButton');
    const form = $('#appointmentScheduleForm');
    clearErrors(form);
    const date = String(appointmentDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(localDate(date).valueOf())) {
      showFieldError(form, 'appointmentRescheduleDate', 'Enter a valid appointment date.');
      return;
    }
    setBusy(button, true, 'Saving…');
    setMessage('#calendarMessage', 'Saving the new appointment date…');
    try {
      await apiRequest('/api/appointments/' + encodeURIComponent(id) + '/schedule', {
        method: 'PATCH',
        body: JSON.stringify({ appointmentDate: date }),
      });
      await refreshAppointmentView('Appointment schedule updated.', true);
      setMessage('#calendarMessage', '', false);
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 403) {
        $('#appointmentScheduleAction').hidden = true;
        setMessage('#workspaceMessage', 'You are not authorized to reschedule appointments.');
      } else if (error.status === 404) {
        currentAppointmentId = null;
        $('#appointmentDetail').hidden = true;
        setWorkspaceRecovery(
          'This appointment is no longer available. Return to the appointment list and try again.',
          loadAppointments,
          true,
        );
      } else if (error.status === 409) {
        await refreshAppointmentView(error.message);
      } else {
        setMessage('#calendarMessage', error.message);
      }
    } finally {
      setBusy(button, false);
      if ($('#calendarMessage').textContent === 'Saving the new appointment date…') {
        setMessage('#calendarMessage', '', false);
      }
    }
  }

  async function updateAppointmentAssignment(technicianId) {
    const button = $('#saveAppointmentAssignmentButton');
    setBusy(button, true, 'Saving…');
    try {
      await apiRequest(
        '/api/appointments/' + encodeURIComponent(currentAppointmentId) + '/assignment',
        {
          method: 'PATCH',
          body: JSON.stringify({ technicianId }),
        },
      );
      await refreshAppointmentView('Technician assignment updated.', true);
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 403) {
        $('#appointmentAssignmentAction').hidden = true;
        setMessage('#workspaceMessage', 'You are not authorized to assign technicians.');
      } else if (error.status === 404 || error.status === 409) {
        await refreshAppointmentView(error.message);
      } else {
        setMessage('#workspaceMessage', error.message);
      }
    } finally {
      setBusy(button, false);
    }
  }

  async function updateAppointmentStatus() {
    const form = $('#appointmentStatusForm');
    clearErrors(form);
    const status = $('#appointmentNextStatus').value;
    if (!status) {
      showFieldError(form, 'appointmentNextStatus', 'Select a next appointment status.');
      return;
    }
    const button = $('#updateAppointmentStatusButton');
    setBusy(button, true, 'Updating…');
    try {
      await apiRequest(
        '/api/appointments/' + encodeURIComponent(currentAppointmentId) + '/status',
        {
          method: 'PATCH',
          body: JSON.stringify({
            status,
            reason: $('#appointmentStatusReason').value.trim() || undefined,
          }),
        },
      );
      await refreshAppointmentView('Appointment status updated.', true);
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 403) {
        $('#appointmentStatusAction').hidden = true;
        setMessage('#workspaceMessage', 'You are not authorized to update appointment status.');
      } else if (error.status === 404 || error.status === 409) {
        await refreshAppointmentView(error.message);
      } else {
        setMessage('#workspaceMessage', error.message);
      }
    } finally {
      setBusy(button, false);
    }
  }

  function resetAppointmentWorkspace() {
    currentAppointmentId = null;
    $('#appointmentDetail').hidden = true;
    $('#appointmentsBody').innerHTML = '';
    $('#appointmentsEmpty').hidden = true;
  }

  function resetJobCardWorkspace() {
    currentJobCardId = null;
    currentJobCard = null;
    lastLoadedJobCards = [];
    $('#jobCardDetail').hidden = true;
    $('#jobCardsBody').innerHTML = '';
    $('#jobCardsEmpty').hidden = true;
    $('#jobCardAttachmentsList').innerHTML = '';
  }

  function resetScheduleForm() {
    availabilityRequestSequence += 1;
    scheduleB2bBranchSearchSequence += 1;
    if (scheduleB2bBranchSearchDebounce) clearTimeout(scheduleB2bBranchSearchDebounce);
    $('#scheduleForm').reset();
    clearItemPickerMarks($('#scheduleForm'));
    clearErrors($('#scheduleForm'));
    $('#technicianId').innerHTML = '<option value="">Select a date first</option>';
    $('#technicianId').disabled = true;
    $('#findTechniciansButton').disabled = false;
    $('#scheduleAvailabilityMessage').textContent = '';
    $('#scheduleResult').textContent = '';
    $('#scheduleB2bBranchSearchInput').value = '';
    $('#scheduleB2bBranchResults').innerHTML = '';
    $('#scheduleB2bBranchResults').hidden = true;
    delete $('#scheduleB2bBranchResults').dataset.branches;
    $('#scheduleB2bBranchSearchMessage').textContent = '';
  }

  // Vertical-tab wiring for the complaint's action cards (Notes, B2B Branch
  // match, Update status, Schedule appointment) -- see modification.md #4.
  // Each entry's `available` flag is set by whichever render function owns
  // that card (permission/context gating); `activateActionTab` is the only
  // place that actually shows/hides a panel, so gating and tab-selection
  // never fight each other.
  const ACTION_TABS = [
    { panel: 'notesAction', tab: 'notesActionTab' },
    { panel: 'b2bBranchAction', tab: 'b2bBranchActionTab' },
    { panel: 'statusAction', tab: 'statusActionTab' },
    { panel: 'scheduleAction', tab: 'scheduleActionTab' },
  ];

  function setActionTabAvailability(panelId, available) {
    const entry = ACTION_TABS.find((item) => item.panel === panelId);
    if (!entry) return;
    $('#' + entry.tab).hidden = !available;
    $('#' + panelId).dataset.tabAvailable = available ? 'true' : 'false';
  }

  // Remembers which tab the staff member had open, per complaint, so
  // linking/unlinking a B2B branch or saving notes (which both reload the
  // complaint detail) doesn't yank them back to the default tab.
  let activeActionTabId = null;
  let activeActionTabComplaintId = null;

  function activateActionTab(panelId) {
    activeActionTabId = panelId;
    ACTION_TABS.forEach(({ panel, tab }) => {
      const panelEl = $('#' + panel);
      const tabEl = $('#' + tab);
      const isActive = panel === panelId;
      panelEl.hidden = !(isActive && panelEl.dataset.tabAvailable === 'true');
      tabEl.classList.toggle('active', isActive);
      tabEl.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  }

  $('#complaintActionTabs').addEventListener('click', (event) => {
    const button = event.target.closest('.action-tab');
    if (!button || button.hidden) return;
    activateActionTab(button.dataset.panel);
  });

  // Pre-fills the Schedule appointment card with the complaint's current
  // Sales order no. / B2B Branch / site-contact data, which previously always
  // showed blank even when the complaint already had this data on file (see
  // modification.md #4). Also defaults the Salesman field from the matched
  // B2B Branch / School's master-list record, the same way the Schedule
  // form's own B2B Branch lookup already does -- the CCE can still change it
  // (see modification.md #19).
  async function populateScheduleFormFromComplaint(complaint) {
    $('#scheduleSalesOrderNumber').value = complaint.salesOrderNumber || '';
    $('#scheduleB2bBranchSchool').value = complaint.b2bBranchSchool || '';
    $('#scheduleSchoolContactPerson').value = complaint.schoolContactPerson || '';
    $('#scheduleSchoolContactNumber').value = complaint.schoolContactNumber || '';
    $('#scheduleCustomerNumber').value = complaint.customerNumber || '';
    const matchNote = $('#scheduleB2bBranchMatchNote');
    if (complaint.b2bBranchCustCode) {
      matchNote.textContent = `Matched to the master list (Cust_Code ${complaint.b2bBranchCustCode}).`;
      try {
        const result = await apiRequest(
          '/api/b2b-branches/' + encodeURIComponent(complaint.b2bBranchCustCode),
        );
        if (result.branch?.salesman) {
          populateSelectOptions(
            '#scheduleSalesman',
            salesmenOptions,
            'Select a salesman',
            result.branch.salesman,
          );
        }
      } catch {
        // Non-fatal -- the CCE can still pick the salesman by hand.
      }
    } else if (complaint.b2bBranchSchool) {
      matchNote.textContent =
        'Not yet matched to the master list -- see the "B2B Branch match" tab.';
    } else {
      matchNote.textContent = '';
    }
  }

  function renderComplaintActions(complaint) {
    currentComplaintId = complaint.id;
    // A Cancelled complaint has no further status transitions
    // (complaintTransitions.Cancelled = []) and shouldn't be touched at all
    // from here -- no new notes, no status change, and no re-linking (or
    // unlinking) its B2B Branch / School match. The complaint stays fully
    // visible (detail grid + History), it's only these edit actions that
    // lock, the same way a Completed/Cancelled job card or appointment
    // already locks its own action panels (see modification.md #21).
    const locked = complaint.status === 'Cancelled';
    const canWrite = hasPermission('complaints.write') && !locked;
    const canSchedule =
      !locked &&
      complaint.status === 'Ready for Scheduling' &&
      hasPermission('appointments.write') &&
      hasPermission('technicians.read');
    $('#complaintActions').hidden = locked || (!canWrite && !canSchedule);
    setActionTabAvailability('notesAction', canWrite);
    setActionTabAvailability('statusAction', canWrite);
    setActionTabAvailability('scheduleAction', canSchedule);
    resetScheduleForm();
    populateScheduleFormFromComplaint(complaint);
    const showB2bBranch = renderB2bBranchAction(complaint, canWrite);
    setActionTabAvailability('b2bBranchAction', showB2bBranch);
    // Default to the Schedule tab once a complaint is ready to schedule --
    // that's the action staff came here to take -- otherwise Notes. If we're
    // just reloading the SAME complaint (e.g. after linking a branch or
    // saving notes) and the tab the staff was on is still available, stay on
    // it instead of jumping back to the default.
    const fallbackTab = canSchedule ? 'scheduleAction' : canWrite ? 'notesAction' : null;
    const keepCurrentTab =
      activeActionTabComplaintId === complaint.id &&
      activeActionTabId &&
      $('#' + activeActionTabId).dataset.tabAvailable === 'true';
    activeActionTabComplaintId = complaint.id;
    activateActionTab(keepCurrentTab ? activeActionTabId : fallbackTab);
    if (!canWrite) return;

    $('#complaintNotes').value = complaint.cceNotes || '';
    $('#complaintWarranty').value = complaint.warrantyClassification || '';
    $('#complaintWarranty').dataset.saved = complaint.warrantyClassification || '';
    const nextStatuses = complaintTransitions[complaint.status] || [];
    $('#complaintNextStatus').innerHTML = nextStatuses.length
      ? '<option value="">Select the next status…</option>' +
        nextStatuses
          .map(
            (status) =>
              `<option value="${escapeHtml(status)}" title="${escapeHtml(COMPLAINT_STATUS_HINTS[status] || '')}">${escapeHtml(status)}</option>`,
          )
          .join('')
      : '<option value="">No further transitions</option>';
    $('#complaintNextStatus').disabled = nextStatuses.length === 0;
    $('#updateStatusButton').disabled = nextStatuses.length === 0;
    $('#complaintStatusHint').textContent = '';
    $('#complaintStatusReason').value = '';
    $('#notesActionTab').title = 'Record internal notes and the warranty classification.';
    $('#statusActionTab').title = 'Move the complaint to its next stage.';
    $('#scheduleActionTab').title = canSchedule
      ? 'Book a date and an available technician.'
      : 'Available once the status is Ready for Scheduling.';
  }

  $('#complaintNextStatus').addEventListener('change', (event) => {
    $('#complaintStatusHint').textContent = COMPLAINT_STATUS_HINTS[event.target.value] || '';
  });

  async function changeComplaintStatus(status, reason, button) {
    setBusy(button, true, 'Updating…');
    try {
      await apiRequest('/api/complaints/' + encodeURIComponent(currentComplaintId) + '/status', {
        method: 'PATCH',
        body: JSON.stringify({ status, reason: reason || undefined }),
      });
      await loadComplaintDetail(currentComplaintId);
      await loadComplaints();
      setMessage('#workspaceMessage', `Complaint moved to ${status}.`, true);
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else {
        setMessage('#workspaceMessage', error.message);
      }
    } finally {
      if (button) setBusy(button, false);
    }
  }

  // "What to do next" card above the action tabs: says where the complaint is,
  // what the next step is, and offers that step as a button.
  function renderComplaintGuide(complaint, appointment) {
    const box = $('#complaintNextStep');
    const canEdit = hasPermission('complaints.write');
    const canBook = hasPermission('appointments.write') && hasPermission('technicians.read');
    const ref = appointment ? appointment.appointmentReference : '';
    const guides = {
      New: {
        title: 'Start the review',
        text: 'A new complaint has arrived. Read the details and record the warranty classification in Notes, then move it to Under Review.',
        buttons: canEdit ? [['Start review', 'status', 'Under Review']] : [],
      },
      'Under Review': {
        title: 'Check the details, then decide',
        text: 'Confirm the customer details and warranty classification (Notes tab). If something is missing, mark it Pending Information. If everything is in, mark it Ready for Scheduling.',
        buttons: canEdit
          ? [
              ['Ready for Scheduling', 'status', 'Ready for Scheduling'],
              ['Pending Information', 'status', 'Pending Information', true],
            ]
          : [],
      },
      'Pending Information': {
        title: 'Waiting for the customer',
        text: 'Chase the missing information (add a note of what was asked). When it arrives, mark the complaint Ready for Scheduling, or send it back to Under Review.',
        buttons: canEdit
          ? [
              ['Information received: Ready for Scheduling', 'status', 'Ready for Scheduling'],
              ['Back to Under Review', 'status', 'Under Review', true],
            ]
          : [],
        warn: true,
      },
      'Ready for Scheduling': {
        title: 'Book the appointment',
        text: 'Open the Schedule appointment tab, choose a date and an available technician, and save. The complaint moves to Scheduled by itself once the appointment exists.',
        buttons: canBook ? [['Go to Schedule appointment', 'tab', 'scheduleAction']] : [],
      },
      Scheduled: appointment
        ? {
            title: 'Appointment booked',
            text: `Appointment ${ref} is ${appointment.status}. This complaint closes automatically when the technician completes it. To redo the booking, use Update status and choose Ready for Scheduling (this cancels the appointment).`,
            buttons: [['Open appointment ' + ref, 'appointment', appointment.id]],
            done: true,
          }
        : {
            title: 'No appointment found',
            text: 'This complaint is marked Scheduled but has no active appointment, so nothing is booked. Reopen scheduling and book a technician.',
            buttons: canEdit ? [['Reopen scheduling', 'status', 'Ready for Scheduling']] : [],
            warn: true,
          },
      Closed: {
        title: 'Complete',
        text: 'The appointment was completed and this complaint is closed. Nothing more to do.',
        buttons: [],
        done: true,
      },
      Cancelled: {
        title: 'Cancelled',
        text: 'This complaint was cancelled and is locked.',
        buttons: [],
        done: true,
      },
    };
    const guide = guides[complaint.status];
    if (!guide) {
      box.hidden = true;
      return;
    }
    box.className = 'next-step' + (guide.warn ? ' is-warn' : guide.done ? ' is-done' : '');
    box.innerHTML = `<div class="next-step-kicker">Next step</div><div class="next-step-title">${escapeHtml(guide.title)}</div><p class="next-step-text">${escapeHtml(guide.text)}</p>${
      guide.buttons.length
        ? `<div class="next-step-actions">${guide.buttons
            .map(
              ([label, kind, value, secondary], index) =>
                `<button type="button" class="button ${secondary ? 'button-outline' : 'button-primary'}" data-guide="${index}">${escapeHtml(label)}</button>`,
            )
            .join('')}</div>`
        : ''
    }`;
    box.hidden = false;
    box.querySelectorAll('[data-guide]').forEach((button) => {
      const [, kind, value] = guide.buttons[Number(button.dataset.guide)];
      button.addEventListener('click', () => {
        if (kind === 'status') changeComplaintStatus(value, '', button);
        else if (kind === 'tab') activateActionTab(value);
        else if (kind === 'appointment') {
          setWorkspaceMode('appointments');
          loadAppointmentDetail(value);
        }
      });
    });
  }

  // Staff-only matching of a complaint's free-text B2B Branch / School to the
  // authenticated master list (see modification.md #2). Only relevant for B2B
  // complaints, and only for staff who can write complaints.
  function renderB2bBranchAction(complaint, canWrite) {
    const show = canWrite && complaint.customerType === 'B2B';
    b2bBranchSearchSequence += 1;
    if (b2bBranchSearchDebounce) {
      clearTimeout(b2bBranchSearchDebounce);
      b2bBranchSearchDebounce = null;
    }
    $('#b2bBranchSearchInput').value = '';
    $('#b2bBranchResults').innerHTML = '';
    $('#b2bBranchResults').hidden = true;
    $('#b2bBranchSearchMessage').textContent = '';
    if (!show) {
      currentComplaintB2bBranchCustCode = null;
      return show;
    }
    currentComplaintB2bBranchCustCode = complaint.b2bBranchCustCode || null;
    const typedText = complaint.b2bBranchSchool || '(not entered)';
    $('#b2bBranchCurrent').textContent = currentComplaintB2bBranchCustCode
      ? `${typedText} — matched (Cust_Code ${currentComplaintB2bBranchCustCode})`
      : `${typedText} — not yet matched`;
    $('#unlinkB2bBranchButton').hidden = !currentComplaintB2bBranchCustCode;
    return show;
  }

  async function searchB2bBranches(query) {
    const requestSequence = ++b2bBranchSearchSequence;
    $('#b2bBranchSearchMessage').textContent = 'Searching…';
    try {
      const params = query ? '?query=' + encodeURIComponent(query) : '';
      const result = await apiRequest('/api/b2b-branches' + params);
      if (requestSequence !== b2bBranchSearchSequence) return;
      const branches = result.branches || [];
      $('#b2bBranchResults').innerHTML = branches
        .map(
          (branch) =>
            `<li><button type="button" data-cust-code="${escapeHtml(branch.custCode)}" data-branch-name="${escapeHtml(branch.branchName)}"><span class="branch-name">${escapeHtml(branch.branchName)}</span><br><span class="branch-code">Cust_Code ${escapeHtml(branch.custCode)}${branch.salesman ? ' · ' + escapeHtml(branch.salesman) : ''}</span></button></li>`,
        )
        .join('');
      $('#b2bBranchResults').hidden = branches.length === 0;
      $('#b2bBranchSearchMessage').textContent = branches.length
        ? ''
        : 'No matches in the master list.';
    } catch (error) {
      if (requestSequence !== b2bBranchSearchSequence) return;
      $('#b2bBranchResults').hidden = true;
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 403) {
        $('#b2bBranchAction').hidden = true;
        setMessage('#workspaceMessage', 'You are not authorized to search the branch master list.');
      } else {
        $('#b2bBranchSearchMessage').textContent = error.message;
      }
    }
  }

  // Same master-list search as the B2B Branch match tab above, reused on the
  // Schedule appointment form so staff can pick a branch (and its sales
  // order no. / salesman) instead of retyping them -- see modification.md
  // #8. Picking a result fills the plain-text Sales order no. / B2B Branch
  // fields (and the Salesman dropdown, if it's a recognized name); those
  // fields stay editable afterwards, this is just a shortcut.
  async function searchScheduleB2bBranches(query) {
    const requestSequence = ++scheduleB2bBranchSearchSequence;
    $('#scheduleB2bBranchSearchMessage').textContent = 'Searching…';
    try {
      const params = query ? '?query=' + encodeURIComponent(query) : '';
      const result = await apiRequest('/api/b2b-branches' + params);
      if (requestSequence !== scheduleB2bBranchSearchSequence) return;
      const branches = result.branches || [];
      $('#scheduleB2bBranchResults').innerHTML = branches
        .map(
          (branch, index) =>
            `<li><button type="button" data-branch-index="${index}"><span class="branch-name">${escapeHtml(branch.branchName)}</span><br><span class="branch-code">Cust_Code ${escapeHtml(branch.custCode)}${branch.salesman ? ' · ' + escapeHtml(branch.salesman) : ''}${branch.lastSalesOrderNumber ? ' · SO ' + escapeHtml(branch.lastSalesOrderNumber) : ''}</span></button></li>`,
        )
        .join('');
      $('#scheduleB2bBranchResults').hidden = branches.length === 0;
      $('#scheduleB2bBranchSearchMessage').textContent = branches.length
        ? ''
        : 'No matches in the master list.';
      $('#scheduleB2bBranchResults').dataset.branches = JSON.stringify(branches);
    } catch (error) {
      if (requestSequence !== scheduleB2bBranchSearchSequence) return;
      $('#scheduleB2bBranchResults').hidden = true;
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status !== 403) {
        $('#scheduleB2bBranchSearchMessage').textContent = error.message;
      }
    }
  }

  $('#scheduleB2bBranchSearchInput').addEventListener('input', (event) => {
    const value = event.currentTarget.value.trim();
    if (scheduleB2bBranchSearchDebounce) clearTimeout(scheduleB2bBranchSearchDebounce);
    scheduleB2bBranchSearchDebounce = setTimeout(() => searchScheduleB2bBranches(value), 250);
  });

  $('#scheduleB2bBranchResults').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-branch-index]');
    if (!button) return;
    const branches = JSON.parse($('#scheduleB2bBranchResults').dataset.branches || '[]');
    const branch = branches[Number(button.dataset.branchIndex)];
    if (!branch) return;
    $('#scheduleB2bBranchSchool').value = branch.branchName;
    if (branch.lastSalesOrderNumber)
      $('#scheduleSalesOrderNumber').value = branch.lastSalesOrderNumber;
    populateSelectOptions(
      '#scheduleSalesman',
      salesmenOptions,
      'Select a salesman',
      branch.salesman || $('#scheduleSalesman').value,
    );
    $('#scheduleB2bBranchResults').hidden = true;
    $('#scheduleB2bBranchSearchInput').value = '';
    $('#scheduleB2bBranchSearchMessage').textContent =
      `Filled from the master list (Cust_Code ${branch.custCode}).`;
  });

  async function linkB2bBranch(custCode) {
    try {
      await apiRequest(
        '/api/complaints/' + encodeURIComponent(currentComplaintId) + '/b2b-branch',
        {
          method: 'PATCH',
          body: JSON.stringify({ custCode }),
        },
      );
      await loadComplaintDetail(currentComplaintId);
      await loadComplaints();
      setMessage('#workspaceMessage', custCode ? 'Branch matched.' : 'Match cleared.', true);
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else {
        setMessage('#workspaceMessage', error.message);
      }
    }
  }

  $('#b2bBranchSearchInput').addEventListener('input', (event) => {
    const value = event.currentTarget.value.trim();
    if (b2bBranchSearchDebounce) clearTimeout(b2bBranchSearchDebounce);
    b2bBranchSearchDebounce = setTimeout(() => searchB2bBranches(value), 250);
  });

  $('#b2bBranchResults').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-cust-code]');
    if (!button) return;
    linkB2bBranch(button.getAttribute('data-cust-code'));
  });

  $('#unlinkB2bBranchButton').addEventListener('click', () => {
    linkB2bBranch(null);
  });

  async function loadAvailableTechnicians() {
    const form = $('#scheduleForm');
    clearErrors(form);
    const date = $('#appointmentDate').value;
    if (!date) {
      showFieldError(form, 'appointmentDate', 'Select an appointment date.');
      return;
    }

    const requestSequence = ++availabilityRequestSequence;
    const button = $('#findTechniciansButton');
    const technicianSelect = $('#technicianId');
    setBusy(button, true, 'Checking availability…');
    technicianSelect.disabled = true;
    technicianSelect.innerHTML = '<option value="">Loading technicians…</option>';
    $('#scheduleAvailabilityMessage').textContent = '';
    $('#scheduleAppointmentButton').disabled = true;
    try {
      const params = new URLSearchParams({
        active: 'true',
        availableDate: date,
        page: '1',
        pageSize: '100',
      });
      const result = await apiRequest('/api/technicians?' + params);
      if (requestSequence !== availabilityRequestSequence) return;
      const technicians = result.technicians || [];
      technicianSelect.innerHTML = technicians.length
        ? '<option value="">Select a technician</option>' +
          technicians
            .map(
              (technician) =>
                `<option value="${escapeHtml(technician.id)}">${escapeHtml(technician.name)}</option>`,
            )
            .join('')
        : '<option value="">No technicians available</option>';
      technicianSelect.disabled = technicians.length === 0;
      $('#scheduleAvailabilityMessage').textContent = technicians.length
        ? 'Select an available technician.'
        : 'No active technicians are available for this date and time.';
    } catch (error) {
      if (requestSequence !== availabilityRequestSequence) return;
      technicianSelect.innerHTML = '<option value="">Availability could not be loaded</option>';
      $('#scheduleAvailabilityMessage').textContent = '';
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 403) {
        $('#scheduleAction').hidden = true;
        setMessage('#workspaceMessage', 'You are not authorized to check technician availability.');
      } else {
        setMessage('#workspaceMessage', error.message);
      }
    } finally {
      if (requestSequence === availabilityRequestSequence) setBusy(button, false);
    }
  }

  async function loadComplaintDetail(id) {
    setMessage('#workspaceMessage', '', false);
    try {
      const result = await apiRequest('/api/complaints/' + encodeURIComponent(id));
      const complaint = result.complaint;
      renderComplaintActions(complaint);
      renderComplaintGuide(complaint, result.appointment);
      $('#detailHeading').textContent = complaint.complaintReference || 'Complaint details';
      $('#detailStatus').innerHTML =
        `<span class="status ${statusClass(complaint.status)}">${escapeHtml(complaint.status)}</span>`;
      renderWorkflowStepper('workflowStepper', workflowStageForComplaintStatus(complaint.status));
      const complaintWorkflowLinks = [];
      if (result.appointment) {
        const appointmentId = result.appointment.id;
        complaintWorkflowLinks.push({
          label: `Appointment ${result.appointment.appointmentReference}`,
          onClick: () => {
            setWorkspaceMode('appointments');
            loadAppointmentDetail(appointmentId);
          },
        });
      }
      if (result.jobCard) {
        const jobCardId = result.jobCard.id;
        complaintWorkflowLinks.push({
          label: `Job card ${result.jobCard.jobCardReference}`,
          onClick: () => {
            setWorkspaceMode('job-cards');
            loadJobCardDetail(jobCardId);
          },
        });
      }
      renderWorkflowLinks('complaintWorkflowLinks', complaintWorkflowLinks);
      renderDetailSections('#detailGrid', [
        {
          strip: [
            ['Status', complaint.status, 'pill'],
            ['Warranty classification', complaint.warrantyClassification],
            ['Customer type', complaint.customerType],
            ['Region', complaint.region],
            ['Logged', formatDate(complaint.submittedAt)],
          ],
        },
        {
          title: 'Customer',
          items: [
            ['Customer', complaint.customerName],
            ['Customer type', complaint.customerType],
            ['Contact', complaint.contactNumber, 'phone'],
            ['Email', complaint.customerEmail, 'email'],
            ['Customer number', complaint.customerNumber],
            ['Region', complaint.region],
            ['B2B branch / school', complaint.b2bBranchSchool],
            ['Site contact person', complaint.schoolContactPerson],
            ['Site contact number', complaint.schoolContactNumber, 'phone'],
            ['Address', complaint.address, 'wide'],
          ],
        },
        {
          title: 'Product',
          items: [
            ['Brand', complaint.brand],
            ['Model', complaint.model],
            ['Serial or item code', complaint.serialOrItemCode],
            ['Sales order no.', complaint.salesOrderNumber],
          ],
        },
        {
          title: 'Complaint',
          items: [
            ['Warranty classification', complaint.warrantyClassification],
            ['Status', complaint.status, 'pill'],
            ['Description', complaint.description, 'wide'],
            ['CCE notes', complaint.cceNotes, 'wide'],
          ],
        },
        {
          title: 'Record',
          items: [
            ['Submitted', formatDate(complaint.submittedAt)],
            ['Last updated', formatDate(complaint.updatedAt)],
          ],
        },
      ]);
      $('#historyList').innerHTML =
        (result.history || [])
          .map(
            (entry) =>
              `<li><time>${escapeHtml(formatDate(entry.changedAt))}</time><div><strong>${escapeHtml(entry.fromStatus ? entry.fromStatus + ' → ' : '')}${escapeHtml(entry.toStatus)}</strong>${entry.reason ? `<br><span>${escapeHtml(entry.reason)}</span>` : ''}</div></li>`,
          )
          .join('') || '<li><span>No history recorded.</span></li>';
      $('#complaintDetail').hidden = false;
      $('#complaintDetail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 403) {
        $('#complaintDetail').hidden = true;
        setWorkspaceRecovery(
          'You are not authorized to view complaint details.',
          () => loadComplaintDetail(id),
          true,
        );
      } else if (error.status === 404) {
        currentComplaintId = null;
        $('#complaintDetail').hidden = true;
        setWorkspaceRecovery(
          'This complaint no longer exists. Return to the complaint list and try again.',
          loadComplaints,
          false,
        );
      } else {
        $('#complaintDetail').hidden = true;
        setWorkspaceRecovery(error.message, () => loadComplaintDetail(id), false);
      }
    }
  }

  $('#notesForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    clearErrors(form);
    const notes = $('#complaintNotes').value.trim();
    const warrantyClassification = $('#complaintWarranty').value;
    const classificationChanged =
      warrantyClassification !== ($('#complaintWarranty').dataset.saved || '');
    if (!notes && !classificationChanged) {
      showFieldError(form, 'complaintNotes', 'Enter notes or change the warranty classification.');
      return;
    }
    const button = $('#saveNotesButton');
    setBusy(button, true, 'Saving…');
    try {
      await apiRequest('/api/complaints/' + encodeURIComponent(currentComplaintId) + '/notes', {
        method: 'POST',
        body: JSON.stringify({
          ...(notes ? { notes } : {}),
          ...(classificationChanged ? { warrantyClassification } : {}),
        }),
      });
      await loadComplaintDetail(currentComplaintId);
      await loadComplaints();
      setMessage('#workspaceMessage', 'Complaint updated.', true);
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else {
        setMessage('#workspaceMessage', error.message);
      }
    } finally {
      setBusy(button, false);
    }
  });

  $('#statusForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    clearErrors(form);
    const status = $('#complaintNextStatus').value;
    if (!status) {
      showFieldError(form, 'complaintNextStatus', 'Select the status this complaint moves to.');
      return;
    }
    await changeComplaintStatus(
      status,
      $('#complaintStatusReason').value.trim(),
      $('#updateStatusButton'),
    );
  });

  $('#scheduleForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    clearErrors(form);
    setMessage('#workspaceMessage', '', false);
    const date = $('#appointmentDate').value;
    const technicianId = $('#technicianId').value;
    let valid = true;
    if (!date) {
      showFieldError(form, 'appointmentDate', 'Select an appointment date.');
      valid = false;
    }
    if (!technicianId) {
      showFieldError(form, 'technicianId', 'Select an available technician.');
      valid = false;
    }
    if (!valid) return;

    const button = $('#scheduleAppointmentButton');
    setBusy(button, true, 'Scheduling…');
    // Capture which complaint this particular submission is for. The user
    // can navigate to a different complaint (or Cancel/reload) while this
    // request is still in flight -- by the time it resolves, the shared
    // `currentComplaintId` may already point at whatever they're looking
    // at now. Without this guard, a slow/failed response for complaint A
    // would reload complaint B's detail and stamp complaint A's error
    // message onto complaint B's page, making an unrelated old failure
    // look like it just happened on the complaint the user is currently
    // viewing (e.g. a stale "already has an active appointment" appearing
    // on a fresh complaint that was never actually scheduled).
    const requestedComplaintId = currentComplaintId;
    const stillOnSameComplaint = () => currentComplaintId === requestedComplaintId;
    try {
      // Optional overrides: send only what the staff actually typed here.
      // Left blank, the created appointment falls back to whatever the
      // linked complaint already captured (see appointments/service.ts) —
      // these fields are never required to schedule a job.
      const overrides = Object.fromEntries(
        [...new FormData(form)]
          .map(([key, value]) => [key, String(value).trim()])
          .filter(
            ([key, value]) => value !== '' && !['appointmentDate', 'technicianId'].includes(key),
          ),
      );
      const result = await apiRequest('/api/appointments', {
        method: 'POST',
        body: JSON.stringify({
          complaintId: requestedComplaintId,
          technicianId,
          appointmentDate: date,
          ...overrides,
        }),
      });
      const appointment = result.appointment;
      await loadComplaints();
      if (!stillOnSameComplaint()) {
        // The user has moved on to a different complaint -- the list
        // refresh above already reflects the new appointment; leave their
        // current screen alone rather than overwriting it.
        return;
      }
      $('#scheduleResult').textContent = appointment?.appointmentReference
        ? `Appointment ${appointment.appointmentReference} created.`
        : 'Appointment created.';
      await loadComplaintDetail(requestedComplaintId);
      setMessage(
        '#workspaceMessage',
        appointment?.appointmentReference
          ? `Appointment ${appointment.appointmentReference} scheduled successfully.`
          : 'Appointment scheduled successfully.',
        true,
      );
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 404 || error.status === 409) {
        await loadComplaints();
        if (!stillOnSameComplaint()) return;
        await loadComplaintDetail(requestedComplaintId);
        setMessage('#workspaceMessage', error.message);
      } else if (error.status === 403) {
        if (stillOnSameComplaint()) $('#scheduleAction').hidden = true;
        setMessage('#workspaceMessage', 'You are not authorized to schedule appointments.');
      } else if (stillOnSameComplaint()) {
        setMessage('#workspaceMessage', error.message);
      }
    } finally {
      setBusy(button, false);
    }
  });

  async function signOut(callApi = true) {
    if (callApi && authToken) {
      try {
        await apiRequest('/api/auth/logout', { method: 'POST' });
      } catch {}
    }
    authToken = null;
    clearStoredToken();
    if (chatUi) chatUi.stopBadge();
    document.body.classList.remove('is-authenticated');
    currentUser = null;
    workspaceMode = 'complaints';
    resetAppointmentWorkspace();
    resetJobCardWorkspace();
    resetQuotationWorkspace();
    resetInspectionWorkspace();
    resetWarrantyApprovalWorkspace();
    resetDashboardWorkspace();
    $('#staff-workspace').hidden = true;
    $('#staff-access').hidden = false;
    $('#authCard').hidden = false;
    $('#complaintDetail').hidden = true;
    $('#appointmentWorkspace').hidden = true;
    $('#loginForm').reset();
    $('#bootstrapForm').reset();
    setMessage('#authMessage', '', false);
    $('#staff-access').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function downloadAppointmentIcs() {
    const button = $('#downloadAppointmentIcsButton');
    setBusy(button, true, 'Preparing…');
    try {
      const blob = await apiBlobRequest(
        '/api/appointments/' + encodeURIComponent(currentAppointmentId) + '/ics',
      );
      const reference = $('#appointmentDetailHeading').textContent.trim() || 'appointment';
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = reference + '.ics';
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 403) {
        button.hidden = true;
        setMessage('#workspaceMessage', 'You are not authorized to download calendar files.');
      } else {
        setMessage('#workspaceMessage', error.message);
      }
    } finally {
      setBusy(button, false);
    }
  }

  $('#refreshComplaintsButton').addEventListener('click', loadComplaints);
  $('#refreshAppointmentsButton').addEventListener('click', loadAppointments);
  $('#refreshJobCardsButton').addEventListener('click', loadJobCards);
  $('#refreshQuotationsButton').addEventListener('click', loadQuotations);
  $('#refreshInspectionsButton').addEventListener('click', loadInspections);
  $('#refreshWarrantyApprovalsButton').addEventListener('click', loadWarrantyApprovals);
  $('#refreshDashboardButton').addEventListener('click', loadDashboard);
  $('#refreshTechniciansButton').addEventListener('click', loadTechnicians);
  $('#refreshTeamAccountsButton').addEventListener('click', loadTeamAccounts);
  // Filters apply as soon as they change: drop-downs and dates immediately,
  // the search box 300 ms after the last keystroke (Enter applies at once).
  function bindLiveFilters(load, searchSelector, otherSelectors = []) {
    let timer = null;
    const search = searchSelector ? $(searchSelector) : null;
    if (search) {
      search.addEventListener('input', () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(load, 300);
      });
      search.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        window.clearTimeout(timer);
        load();
      });
    }
    otherSelectors.forEach((selector) => $(selector)?.addEventListener('change', load));
  }
  bindLiveFilters(loadComplaints, '#complaintSearch', ['#complaintStatusFilter']);
  bindLiveFilters(loadJobCards, '#jobCardSearch', ['#jobCardStatusFilter']);
  bindLiveFilters(loadAppointments, '#appointmentSearch', [
    '#appointmentStatusFilter',
    '#appointmentFrom',
    '#appointmentTo',
    '#appointmentTechnicianFilter',
  ]);
  $('#appointmentPrintListButton').addEventListener('click', () => printAppointmentRange('list'));
  $('#appointmentPrintSheetsButton').addEventListener('click', () =>
    printAppointmentRange('sheets'),
  );
  bindLiveFilters(loadQuotations, '#quotationSearch');
  bindLiveFilters(loadInspections, '#inspectionSearch');
  bindLiveFilters(loadWarrantyApprovals, '#warrantyApprovalSearch', [
    '#warrantyApprovalStatusFilter',
  ]);
  $('#appointmentSearch').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') loadAppointments();
  });
  $('#jobCardSearch').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') loadJobCards();
  });
  $('#quotationSearch').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') loadQuotations();
  });
  $('#inspectionSearch').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') loadInspections();
  });
  $('#warrantyApprovalSearch').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') loadWarrantyApprovals();
  });
  $('#createQuotationButton').addEventListener('click', () => {
    $('#quotationDetail').hidden = true;
    $('#quotationCreatePanel').hidden = false;
    $('#quotationCreatePanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  $('#cancelQuotationCreateButton').addEventListener('click', () => {
    $('#quotationCreatePanel').hidden = true;
  });
  $('#quotationCreateForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    await submitQuotationCreate();
  });
  $('#quotationEditForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    await saveQuotation();
  });
  $('#closeQuotationDetailButton').addEventListener('click', () => {
    $('#quotationDetail').hidden = true;
    $('#quotationJobCardCreatePanel').hidden = true;
  });
  $('#printQuotationButton').addEventListener('click', () => printQuotation(currentQuotation));
  $('#createInspectionButton').addEventListener('click', () => {
    $('#inspectionDetail').hidden = true;
    $('#inspectionCreatePanel').hidden = false;
    $('#inspectionCreatePanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  $('#cancelInspectionCreateButton').addEventListener('click', () => {
    $('#inspectionCreatePanel').hidden = true;
  });
  $('#inspectionCreateForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    await submitInspectionCreate();
  });
  $('#inspectionEditForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    await saveInspection();
  });
  $('#closeInspectionDetailButton').addEventListener('click', () => {
    $('#inspectionDetail').hidden = true;
  });
  $('#printInspectionButton').addEventListener('click', () => printInspection(currentInspection));
  $('#createWarrantyApprovalButton').addEventListener('click', () => {
    $('#warrantyApprovalDetail').hidden = true;
    $('#warrantyApprovalCreatePanel').hidden = false;
    resetWarrantyApprovalForm();
    waRows.jobCard = new Map();
    waRows.quotation = new Map();
    searchWarrantyApprovalSource('jobCard', '');
    searchWarrantyApprovalSource('quotation', '');
    $('#warrantyApprovalCreatePanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  $('#cancelWarrantyApprovalCreateButton').addEventListener('click', () => {
    $('#warrantyApprovalCreatePanel').hidden = true;
  });
  initWarrantyApprovalPickers();
  $('#warrantyApprovalManualForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!currentWarrantyApprovalId) return;
    const button = $('#submitWarrantyApprovalManualButton');
    setBusy(button, true, 'Saving…');
    try {
      await apiRequest(
        '/api/warranty-approvals/' + encodeURIComponent(currentWarrantyApprovalId) + '/decision',
        {
          method: 'POST',
          body: JSON.stringify({
            decision: $('#waManualDecision').value,
            method: $('#waManualMethod').value,
            decidedByName: $('#waManualBy').value.trim() || undefined,
            decisionNotes: $('#waManualNotes').value.trim() || undefined,
          }),
        },
      );
      $('#warrantyApprovalManualForm').reset();
      await loadWarrantyApprovals();
      await loadWarrantyApprovalDetail(currentWarrantyApprovalId);
      setMessage('#workspaceMessage', 'Customer decision recorded.', true);
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else {
        setMessage('#workspaceMessage', error.message);
      }
    } finally {
      setBusy(button, false);
    }
  });
  $('#warrantyApprovalCreateForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    await submitWarrantyApprovalCreate();
  });
  $('#closeWarrantyApprovalDetailButton').addEventListener('click', () => {
    $('#warrantyApprovalDetail').hidden = true;
  });
  $('#copyWarrantyApprovalLinkButton').addEventListener('click', async () => {
    const input = $('#warrantyApprovalLinkInput');
    input.select();
    try {
      await navigator.clipboard.writeText(input.value);
      setMessage('#workspaceMessage', 'Approval link copied.', true);
    } catch (error) {
      setMessage(
        '#workspaceMessage',
        'Could not copy automatically -- the link is selected, copy it manually.',
      );
    }
  });
  $('#warrantyApprovalsNav').addEventListener('click', () =>
    setWorkspaceMode('warranty-approvals'),
  );
  $('#dashboardNav').addEventListener('click', () => setWorkspaceMode('dashboard'));
  $('#findTechniciansButton').addEventListener('click', loadAvailableTechnicians);
  $('#technicianId').addEventListener('change', () => {
    $('#scheduleAppointmentButton').disabled = !$('#technicianId').value;
  });
  $('#appointmentDate').addEventListener('change', () => {
    $('#technicianId').disabled = true;
    $('#technicianId').innerHTML = '<option value="">Select a date first</option>';
    $('#scheduleAppointmentButton').disabled = true;
    availabilityRequestSequence += 1;
  });
  $('#complaintsNav').addEventListener('click', () => setWorkspaceMode('complaints'));
  $('#serviceRequestsNav').addEventListener('click', () => setWorkspaceMode('service-requests'));
  $('#jobCardsNav').addEventListener('click', () => setWorkspaceMode('job-cards'));
  $('#quotationsNav').addEventListener('click', () => setWorkspaceMode('quotations'));
  $('#inspectionsNav').addEventListener('click', () => setWorkspaceMode('inspections'));
  $('#appointmentsNav').addEventListener('click', () => setWorkspaceMode('appointments'));
  $('#techniciansNav').addEventListener('click', () => setWorkspaceMode('technicians'));
  $('#teamAccountsNav').addEventListener('click', () => setWorkspaceMode('team-accounts'));
  $('#newRequestNav').addEventListener('click', () => setWorkspaceMode('new-request'));
  $('#masterDataNav').addEventListener('click', () => setWorkspaceMode('master-data'));
  $('#printAppointmentButton').addEventListener('click', () => {
    const a = currentAppointment;
    if (!a) return;
    if (!dlPrintAllowed([a])) return;
    // Same sheet the Daily schedule prints, built from the open appointment.
    openPrintWindow(
      printDocumentShell(
        `Appointment ${a.appointmentReference || ''}`,
        dlSheetBody({ ...a, branchName: a.b2bBranchSchool }, true),
      ),
    );
  });
  $('#closeAppointmentDetailButton').addEventListener('click', () => {
    $('#appointmentDetail').hidden = true;
  });
  $('#appointmentAssignmentForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const technicianId = $('#appointmentTechnician').value;
    if (!technicianId) {
      showFieldError(
        $('#appointmentAssignmentForm'),
        'appointmentTechnician',
        'Select a technician or use Unassign.',
      );
      return;
    }
    await updateAppointmentAssignment(technicianId);
  });
  $('#unassignAppointmentButton').addEventListener('click', () =>
    updateAppointmentAssignment(null),
  );
  $('#appointmentStatusForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    await updateAppointmentStatus();
  });
  $('#createJobCardButton').addEventListener('click', createJobCard);
  $('#uploadJobCardAttachmentButton').addEventListener('click', uploadJobCardAttachment);
  $('#exportJobCardsCsvButton').addEventListener('click', exportJobCardsCsv);
  $('#cancelJobCardCreateButton').addEventListener('click', () => {
    $('#jobCardCreatePanel').hidden = true;
  });
  $('#jobCardCreateForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    await submitJobCardCreate();
  });
  $('#createJobCardFromQuotationButton').addEventListener('click', createJobCardFromQuotation);
  $('#cancelQuotationJobCardCreateButton').addEventListener('click', () => {
    $('#quotationJobCardCreatePanel').hidden = true;
  });
  $('#quotationJobCardCreateForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    await submitJobCardCreateFromQuotation();
  });
  $('#jobCardContentForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    await saveJobCardContent();
  });
  // Quotations and Inspections: "Created ..." and "New ..." are tabs on one page
  // instead of the list and the create form stacked together (modification #73).
  function initWorkspaceTabs(workspaceId, tabsId, createButtonId, cancelButtonId, panelId) {
    const workspace = $('#' + workspaceId);
    const tabs = $('#' + tabsId);
    const panel = $('#' + panelId);
    const createButton = $('#' + createButtonId);
    if (!workspace || !tabs || !panel || !createButton) return;
    const newTab = tabs.querySelector('[data-tab="new"]');
    const sync = () => {
      const tab = panel.hidden ? 'list' : 'new';
      workspace.dataset.tab = tab;
      tabs.querySelectorAll('.ws-tab').forEach((button) => {
        const active = button.dataset.tab === tab;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-selected', String(active));
      });
      newTab.hidden = createButton.hidden;
    };
    new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
    new MutationObserver(sync).observe(createButton, {
      attributes: true,
      attributeFilter: ['hidden'],
    });
    tabs.addEventListener('click', (event) => {
      const button = event.target.closest('.ws-tab');
      if (!button) return;
      if (button.dataset.tab === 'new' && panel.hidden) createButton.click();
      if (button.dataset.tab === 'list' && !panel.hidden) $('#' + cancelButtonId).click();
    });
    sync();
  }
  initWorkspaceTabs(
    'quotationWorkspace',
    'quotationTabs',
    'createQuotationButton',
    'cancelQuotationCreateButton',
    'quotationCreatePanel',
  );
  initWorkspaceTabs(
    'warrantyApprovalWorkspace',
    'warrantyApprovalTabs',
    'createWarrantyApprovalButton',
    'cancelWarrantyApprovalCreateButton',
    'warrantyApprovalCreatePanel',
  );
  initWorkspaceTabs(
    'inspectionWorkspace',
    'inspectionTabs',
    'createInspectionButton',
    'cancelInspectionCreateButton',
    'inspectionCreatePanel',
  );
  $('#closeJobCardDetailButton').addEventListener('click', () => {
    $('#jobCardDetail').hidden = true;
  });
  $('#printJobCardButton').addEventListener('click', async () => {
    if (!currentJobCard) return;
    const variant = await askPrintVariant('Print service job card', [
      {
        value: 'customer',
        label: 'Customer copy',
        note: 'For the customer (B2C or B2B). No amounts, prices, billing or sales details.',
      },
      {
        value: 'internal',
        label: 'Internal copy',
        note: 'For the sales team and accounts. Includes parts prices, charges and billing.',
      },
    ]);
    if (variant) printJobCard(currentJobCard, variant);
  });
  $('#appointmentScheduleForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    await rescheduleAppointment(
      currentAppointmentId,
      $('#appointmentRescheduleDate').value,
      $('#saveAppointmentScheduleButton'),
    );
  });
  $('#calendarPreviousButton').addEventListener('click', () => {
    calendarCursor =
      calendarView === 'week'
        ? shiftDate(calendarCursor, -7)
        : new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1);
    loadCalendar();
  });
  $('#calendarTodayButton').addEventListener('click', () => {
    calendarCursor = new Date();
    loadCalendar();
  });
  $('#calendarNextButton').addEventListener('click', () => {
    calendarCursor =
      calendarView === 'week'
        ? shiftDate(calendarCursor, 7)
        : new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1);
    loadCalendar();
  });
  $('#calendarMonthButton').addEventListener('click', () => {
    calendarView = 'month';
    loadCalendar();
  });
  $('#calendarWeekButton').addEventListener('click', () => {
    calendarView = 'week';
    loadCalendar();
  });
  $('#retryWorkspaceButton').addEventListener('click', () => workspaceRetryAction?.());
  $('#returnAppointmentsButton').addEventListener('click', () => {
    clearWorkspaceRecovery();
    setWorkspaceMode('appointments');
  });
  $('#downloadAppointmentIcsButton').addEventListener('click', downloadAppointmentIcs);
  $('#appointmentDayClearButton').addEventListener('click', clearAppointmentDay);
  $('#complaintSearch').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') loadComplaints();
  });
  $('#closeDetailButton').addEventListener('click', () => {
    $('#complaintDetail').hidden = true;
  });
  $('#signOutButton').addEventListener('click', () => signOut());

  // ---------- Change password / forced change (modification #55) ----------
  let passwordForced = false;

  function openPasswordDialog(forced) {
    passwordForced = Boolean(forced);
    const dialog = $('#passwordDialog');
    $('#passwordForm').reset();
    clearErrors($('#passwordForm'));
    $('#passwordMessage').hidden = true;
    $('#passwordDialogTitle').textContent = forced ? 'Choose your own password' : 'Change password';
    $('#passwordDialogNote').textContent = forced
      ? 'You are signed in with a temporary password. Choose your own (10+ characters, capital first, with a number and a symbol) to continue.'
      : PASSWORD_RULE_TEXT + ' Other devices signed in with your old password are signed out.';
    $('#passwordCancel').textContent = forced ? 'Sign out' : 'Cancel';
    if (!dialog.open) dialog.showModal();
    $('#pwCurrent').focus();
  }

  $('#passwordDialog').addEventListener('cancel', (event) => {
    // Escape must not skip a forced change.
    if (passwordForced) event.preventDefault();
  });

  $('#passwordCancel').addEventListener('click', () => {
    $('#passwordDialog').close();
    if (passwordForced) signOut();
  });

  $('#changePasswordButton').addEventListener('click', () => {
    $('#userMenuPopover').hidden = true;
    $('#userMenuButton').setAttribute('aria-expanded', 'false');
    openPasswordDialog(false);
  });

  $('#passwordForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    clearErrors(form);
    $('#passwordMessage').hidden = true;
    const current = $('#pwCurrent').value;
    const next = $('#pwNew').value;
    const again = $('#pwConfirm').value;
    let valid = true;
    if (!current) {
      showFieldError(form, 'pwCurrent', 'Enter your current password.');
      valid = false;
    }
    if (!isStrongPassword(next)) {
      showFieldError(form, 'pwNew', PASSWORD_RULE_TEXT);
      valid = false;
    } else if (next === current) {
      showFieldError(form, 'pwNew', 'Choose a password different from the current one.');
      valid = false;
    }
    if (again !== next) {
      showFieldError(form, 'pwConfirm', 'The two passwords do not match.');
      valid = false;
    }
    if (!valid) return;
    const button = $('#passwordSave');
    setBusy(button, true, 'Saving…');
    try {
      const result = await apiRequest('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const wasForced = passwordForced;
      passwordForced = false;
      currentUser = result.user;
      $('#passwordDialog').close();
      if (wasForced) {
        showWorkspaceForCurrentUser(true);
      }
      setMessage('#workspaceMessage', 'Password changed.', true);
    } catch (error) {
      const message = $('#passwordMessage');
      message.textContent = error.message;
      message.hidden = false;
    } finally {
      setBusy(button, false);
    }
  });

  // Admin reset of a teammate's password (Team logins).
  let resetPasswordUserId = null;

  function openResetPasswordDialog(userId, name) {
    resetPasswordUserId = userId;
    $('#resetPasswordForm').reset();
    clearErrors($('#resetPasswordForm'));
    $('#resetPasswordMessage').hidden = true;
    $('#resetPasswordNote').textContent =
      'Set a temporary password for ' +
      name +
      '. They are signed out everywhere and must choose their own at the next sign-in.';
    $('#resetPasswordDialog').showModal();
    $('#resetPasswordValue').focus();
  }

  $('#resetPasswordCancel').addEventListener('click', () => $('#resetPasswordDialog').close());

  $('#resetPasswordForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    clearErrors(form);
    const value = $('#resetPasswordValue').value;
    if (!isStrongPassword(value)) {
      showFieldError(form, 'resetPasswordValue', PASSWORD_RULE_TEXT);
      return;
    }
    const button = $('#resetPasswordSave');
    setBusy(button, true, 'Resetting…');
    try {
      await apiRequest('/api/auth/users/' + encodeURIComponent(resetPasswordUserId), {
        method: 'PATCH',
        body: JSON.stringify({ password: value }),
      });
      $('#resetPasswordDialog').close();
      setMessage(
        '#workspaceMessage',
        'Password reset. Share the temporary password directly.',
        true,
      );
    } catch (error) {
      const message = $('#resetPasswordMessage');
      message.textContent = error.message;
      message.hidden = false;
    } finally {
      setBusy(button, false);
    }
  });

  // ---------- Phase 6 (see modification.md #26): admin pricing config ----------
  // Generic engine for the 5 "Management" admin pages (VAS price banding &
  // split, Rate Card, D+I, AMC, Thomson). Each page is 1 or 3 "domain
  // cards" -- one card per pricing_config domain on the server -- built
  // from two shared primitives (a scalar field grid, and an editable
  // add/remove-row table) so the 7 domains' very different shapes don't
  // need 7 bespoke save/reset/history implementations, only 7 bespoke
  // render() functions describing their fields.

  function pcGet(object, path) {
    return path.split('.').reduce((value, key) => (value == null ? value : value[key]), object);
  }
  function pcSet(object, path, value) {
    const parts = path.split('.');
    let target = object;
    for (let i = 0; i < parts.length - 1; i += 1) {
      if (target[parts[i]] == null) target[parts[i]] = {};
      target = target[parts[i]];
    }
    target[parts[parts.length - 1]] = value;
  }

  // Only Built-in Hob (30cm) rounds down at the 50+ tier -- mirrors
  // deriveThomsonTierRates in packages/contracts/src/index.ts exactly.
  function pcDeriveThomsonRates(base, applianceName) {
    const isHob = String(applianceName || '')
      .trim()
      .toLowerCase()
      .startsWith('built-in hob');
    const round50 = isHob ? Math.floor : Math.ceil;
    return {
      Base: base,
      '50+': round50(base * 0.95),
      '150+': Math.ceil(base * 0.9),
      '300+': Math.ceil(base * 0.88),
      '500+': Math.ceil(base * 0.85),
    };
  }

  function pcRenderScalarFields(container, fields, data, markDirty) {
    container.innerHTML =
      '<div class="field-grid">' +
      fields
        .map((field) => {
          const raw = pcGet(data, field.path);
          const value = field.type === 'percent' ? Number(raw || 0) * 100 : Number(raw || 0);
          const step = field.step || (field.type === 'percent' ? '0.1' : '0.01');
          return (
            '<div class="field"><label for="pc-' +
            field.path +
            '">' +
            escapeHtml(field.label) +
            (field.type === 'percent' ? ' (%)' : '') +
            (field.tooltip
              ? ' <span class="tooltip" tabindex="0"><span class="tooltip-icon" aria-hidden="true">i</span><span class="tooltip-bubble" role="tooltip">' +
                escapeHtml(field.tooltip) +
                '</span></span>'
              : '') +
            '</label><input type="number" step="' +
            step +
            '" min="0" id="pc-' +
            field.path +
            '" data-pc-path="' +
            field.path +
            '" data-pc-type="' +
            field.type +
            '" value="' +
            value +
            '"></div>'
          );
        })
        .join('') +
      '</div>';
    container.querySelectorAll('[data-pc-path]').forEach((input) => {
      input.addEventListener('input', () => {
        const raw = Number(input.value || 0);
        const value = input.dataset.pcType === 'percent' ? raw / 100 : raw;
        pcSet(data, input.dataset.pcPath, value);
        markDirty();
      });
    });
  }

  // columns: [{key,label,type:'text'|'number'|'percent'|'checkbox'|'readonly'}]
  // rows live directly in `rows` (the array from `data`, or a sub-array) --
  // inputs mutate row objects in place, so no separate "collect" step is
  // needed before Save.
  function pcRenderTable(container, rows, columns, options) {
    const opts = options || {};
    const minRows = opts.minRows ?? 1;
    const canRemove = rows.length > minRows;
    const table = document.createElement('table');
    // A column can request extra width (e.g. a free-text "name" column
    // that needs more room than the numeric columns beside it) via
    // `column.width` (any CSS width value, typically a %). Setting
    // table-layout: fixed makes the browser actually honor it instead of
    // auto-sizing every column by content (modification.md #30).
    if (columns.some((c) => c.width)) table.style.tableLayout = 'fixed';
    table.innerHTML =
      '<thead><tr>' +
      columns
        .map(
          (c) =>
            '<th' +
            (c.tooltip ? ' title="' + escapeHtml(c.tooltip) + '"' : '') +
            (c.width ? ' style="width: ' + c.width + '"' : '') +
            '>' +
            escapeHtml(c.label) +
            '</th>',
        )
        .join('') +
      (opts.noRemove ? '' : '<th></th>') +
      '</tr></thead><tbody></tbody>';
    const tbody = table.querySelector('tbody');
    rows.forEach((row, index) => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        columns
          .map((c) => {
            const value = pcGet(row, c.key);
            if (c.type === 'readonly') return '<td>' + escapeHtml(String(value ?? '')) + '</td>';
            if (c.type === 'checkbox') {
              return (
                '<td><input type="checkbox" data-pc-row="' +
                index +
                '" data-pc-col="' +
                c.key +
                '" ' +
                (value !== false ? 'checked' : '') +
                '></td>'
              );
            }
            if (c.type === 'percent') {
              return (
                '<td><input type="number" step="0.1" min="0" data-pc-row="' +
                index +
                '" data-pc-col="' +
                c.key +
                '" data-pc-percent="1" value="' +
                Number(value || 0) * 100 +
                '"></td>'
              );
            }
            if (c.type === 'number') {
              return (
                '<td><input type="number" step="' +
                (c.step || '0.01') +
                '" data-pc-row="' +
                index +
                '" data-pc-col="' +
                c.key +
                '" value="' +
                Number(value || 0) +
                '"></td>'
              );
            }
            return (
              '<td><input type="text" data-pc-row="' +
              index +
              '" data-pc-col="' +
              c.key +
              '" value="' +
              escapeHtml(String(value ?? '')) +
              '"></td>'
            );
          })
          .join('') +
        (opts.noRemove
          ? ''
          : '<td>' +
            (canRemove
              ? '<button type="button" class="btn-remove" data-pc-remove-row="' +
                index +
                '">✕</button>'
              : '') +
            '</td>');
      tbody.appendChild(tr);
    });
    container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    wrap.appendChild(table);
    container.appendChild(wrap);
    if (opts.onAdd) {
      const addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.className = 'button button-outline';
      addButton.textContent = opts.addLabel || 'Add row';
      addButton.style.marginTop = '10px';
      addButton.addEventListener('click', () => {
        rows.push(opts.onAdd());
        opts.rerender();
      });
      container.appendChild(addButton);
    }
    table.querySelectorAll('[data-pc-row]').forEach((input) => {
      const handler = () => {
        const rowIndex = Number(input.dataset.pcRow);
        const key = input.dataset.pcCol;
        let value;
        if (input.type === 'checkbox') value = input.checked;
        else if (input.dataset.pcPercent) value = Number(input.value || 0) / 100;
        else if (input.type === 'number') value = Number(input.value || 0);
        else value = input.value;
        pcSet(rows[rowIndex], key, value);
        if (opts.onCellChange) opts.onCellChange(rows[rowIndex], key);
        if (opts.markDirty) opts.markDirty();
      };
      input.addEventListener('input', handler);
      input.addEventListener('change', handler);
    });
    table.querySelectorAll('[data-pc-remove-row]').forEach((button) => {
      button.addEventListener('click', () => {
        rows.splice(Number(button.dataset.pcRemoveRow), 1);
        if (opts.markDirty) opts.markDirty();
        opts.rerender();
      });
    });
  }

  function pcSourceNoteText(meta) {
    if (!meta) return '';
    if (!meta.isOverride) return 'Active source: initial workbook (Excel) defaults.';
    const when = meta.updatedAt ? new Date(meta.updatedAt).toLocaleString() : '';
    return 'Active source: admin override' + (when ? ' — last saved ' + when + '.' : '.');
  }

  // ---- Domain card render functions -- one per pricing_config domain ----
  const PRICING_DOMAIN_RENDERERS = {
    vas_price_bands(container, data, ctx) {
      const rerender = () =>
        pcRenderTable(
          container,
          data,
          [
            {
              key: 'start',
              label: 'Band start',
              type: 'number',
              tooltip: 'Inclusive lower bound of this order-value band.',
            },
            {
              key: 'end',
              label: 'Band end',
              type: 'number',
              tooltip: 'Inclusive upper bound of this order-value band.',
            },
            {
              key: 'label',
              label: 'Label',
              type: 'text',
              tooltip: 'Display name shown for this band on the quote screen.',
            },
          ],
          {
            minRows: 1,
            markDirty: ctx.markDirty,
            rerender,
            onAdd: () => ({ start: 0, end: 0, label: '' }),
            addLabel: 'Add value band',
          },
        );
      rerender();
    },
    vas_pricing_params(container, data, ctx) {
      // One row per VAS plan -- Rate / Min fee / Deductible / Service fee /
      // Claims allowed / Coverage & terms -- matching the workbook's own
      // "PLAN DEFINITIONS" table row for row (modification.md #33). This
      // replaced two field-grid boxes of individual inputs that never
      // actually rendered as a table.
      const VAS_PLAN_ROWS = [
        {
          label: '1-Year Extended Warranty',
          ratePath: 'ew1Rate',
          minFeePath: 'ew1MinFee',
          deductiblePath: 'deductibleEw1',
          serviceFeePath: 'ew1ServiceFee',
          claimsPath: 'ew1Claims',
          coveragePath: 'ew1Coverage',
        },
        {
          label: '2-Year Extended Warranty',
          ratePath: 'ew2Rate',
          minFeePath: 'ew2MinFee',
          deductiblePath: 'deductibleEw2',
          serviceFeePath: 'ew2ServiceFee',
          claimsPath: 'ew2Claims',
          coveragePath: 'ew2Coverage',
        },
        {
          label: '1-Year Damage Insurance',
          ratePath: 'di1Rate',
          minFeePath: 'di1MinFee',
          deductiblePath: 'deductibleDi1',
          serviceFeePath: 'di1ServiceFee',
          claimsPath: 'di1Claims',
          coveragePath: 'di1Coverage',
        },
        {
          label: 'Premium Service (24hr SLA)',
          ratePath: 'premiumRate',
          minFeePath: 'premiumMinFee',
          deductiblePath: 'deductiblePremium',
          serviceFeePath: 'premiumServiceFee',
          claimsPath: 'premiumClaims',
          coveragePath: 'premiumCoverage',
        },
      ];

      const tableHost = document.createElement('div');
      tableHost.className = 'detail-action-card';
      tableHost.innerHTML =
        '<h4>VAS Plan Pricing Table ' +
        tipHtml(
          'Every plan’s rate, minimum fee, deductible, service fee, claims allowed and coverage &amp; terms &mdash; one row per plan, matching the workbook exactly. The 1-Year Damage Insurance service fee shown to customers is always computed from the claim-fee rule below instead of the text stored here.',
        ) +
        '</h4>';
      const tableFields = document.createElement('div');
      tableHost.appendChild(tableFields);

      const sharedHost = document.createElement('div');
      sharedHost.className = 'detail-action-card';
      sharedHost.innerHTML = '<h4>Shared Claim Fee &amp; Depreciation Rules</h4>';
      const sharedFields = document.createElement('div');
      sharedHost.appendChild(sharedFields);

      container.innerHTML = '';
      container.appendChild(tableHost);
      container.appendChild(sharedHost);

      function renderPlanTable() {
        tableFields.innerHTML =
          '<div class="table-wrap"><table style="table-layout: fixed"><thead><tr>' +
          '<th style="width: 15%">Plan</th>' +
          '<th style="width: 8%">Rate (%)</th>' +
          '<th style="width: 9%">Min fee</th>' +
          '<th style="width: 9%">Deductible</th>' +
          '<th style="width: 17%">Service fee</th>' +
          '<th style="width: 12%">Claims allowed</th>' +
          '<th style="width: 30%">Coverage &amp; terms</th>' +
          '</tr></thead><tbody>' +
          VAS_PLAN_ROWS.map(
            (p) =>
              '<tr>' +
              '<td>' +
              escapeHtml(p.label) +
              '</td>' +
              '<td><input type="number" step="0.01" min="0" value="' +
              Number(data[p.ratePath] || 0) * 100 +
              '" data-vpp-percent="' +
              p.ratePath +
              '" /></td>' +
              '<td><input type="number" step="0.01" min="0" value="' +
              Number(data[p.minFeePath] || 0) +
              '" data-vpp-field="' +
              p.minFeePath +
              '" /></td>' +
              '<td><input type="number" step="0.01" min="0" value="' +
              Number(data[p.deductiblePath] || 0) +
              '" data-vpp-field="' +
              p.deductiblePath +
              '" /></td>' +
              '<td><input type="text" value="' +
              escapeHtml(data[p.serviceFeePath] || '') +
              '" data-vpp-text="' +
              p.serviceFeePath +
              '" /></td>' +
              '<td><input type="text" value="' +
              escapeHtml(data[p.claimsPath] || '') +
              '" data-vpp-text="' +
              p.claimsPath +
              '" /></td>' +
              '<td><textarea rows="2" data-vpp-text="' +
              p.coveragePath +
              '">' +
              escapeHtml(data[p.coveragePath] || '') +
              '</textarea></td>' +
              '</tr>',
          ).join('') +
          '</tbody></table></div>';
        tableFields.querySelectorAll('[data-vpp-percent]').forEach((input) => {
          input.addEventListener('input', () => {
            data[input.getAttribute('data-vpp-percent')] = parseNumber(input.value) / 100;
            ctx.markDirty();
          });
        });
        tableFields.querySelectorAll('[data-vpp-field]').forEach((input) => {
          input.addEventListener('input', () => {
            data[input.getAttribute('data-vpp-field')] = parseNumber(input.value);
            ctx.markDirty();
          });
        });
        tableFields.querySelectorAll('[data-vpp-text]').forEach((input) => {
          input.addEventListener('input', () => {
            data[input.getAttribute('data-vpp-text')] = input.value;
            ctx.markDirty();
          });
        });
      }
      renderPlanTable();

      pcRenderScalarFields(
        sharedFields,
        [
          {
            path: 'roundingStep',
            label: 'Rounding step',
            type: 'number',
            tooltip: 'The computed fee is rounded to the nearest multiple of this amount.',
          },
          {
            path: 'claimFeeLow',
            label: 'Claim fee — items below threshold',
            type: 'number',
            tooltip: 'Flat fee charged per claim when the item value is below the threshold.',
          },
          {
            path: 'claimFeeHigh',
            label: 'Claim fee — items at/above threshold',
            type: 'number',
            tooltip:
              'Flat fee charged per claim when the item value meets or exceeds the threshold.',
          },
          {
            path: 'claimFeeThreshold',
            label: 'Claim fee threshold',
            type: 'number',
            tooltip: 'Item value that decides which of the two claim fees applies.',
          },
          {
            path: 'depreciationYear1',
            label: 'Depreciation — Year 1',
            type: 'percent',
            tooltip: '% of purchase price deducted from a total-loss settlement in claim year 1.',
          },
          {
            path: 'depreciationYear2',
            label: 'Depreciation — Year 2',
            type: 'percent',
            tooltip: '% of purchase price deducted from a total-loss settlement in claim year 2.',
          },
          {
            path: 'depreciationYear3',
            label: 'Depreciation — Year 3',
            type: 'percent',
            tooltip: '% of purchase price deducted from a total-loss settlement in claim year 3.',
          },
        ],
        data,
        ctx.markDirty,
      );
    },
    rate_card(container, data, ctx) {
      function rerenderAll() {
        container.innerHTML = '';
        const grid = document.createElement('div');
        grid.className = 'pc-split-grid';
        container.appendChild(grid);
        data.forEach((section, sectionIndex) => {
          const card = document.createElement('div');
          card.className = 'detail-action-card';
          const head = document.createElement('div');
          head.className = 'field-grid';
          head.innerHTML =
            '<div class="field field-wide"><label>Section label</label><input type="text" data-pc-section-label="' +
            sectionIndex +
            '" value="' +
            escapeHtml(section.label) +
            '"></div>';
          card.appendChild(head);
          const tableHost = document.createElement('div');
          card.appendChild(tableHost);
          const removeSectionButton = document.createElement('button');
          removeSectionButton.type = 'button';
          removeSectionButton.className = 'button button-outline';
          removeSectionButton.textContent = 'Remove section';
          removeSectionButton.style.marginTop = '10px';
          removeSectionButton.disabled = data.length <= 1;
          removeSectionButton.addEventListener('click', () => {
            data.splice(sectionIndex, 1);
            ctx.markDirty();
            rerenderAll();
          });
          card.appendChild(removeSectionButton);
          grid.appendChild(card);
          const rerenderTable = () =>
            pcRenderTable(
              tableHost,
              section.activities,
              [
                {
                  key: 'name',
                  label: 'Activity',
                  type: 'text',
                  tooltip: 'Name of the billable activity shown on the job card / quote.',
                },
                {
                  key: 'rate',
                  label: 'Rate',
                  type: 'number',
                  tooltip: 'Amount charged for one instance of this activity.',
                },
              ],
              {
                minRows: 1,
                markDirty: ctx.markDirty,
                rerender: rerenderTable,
                onAdd: () => ({ name: 'New activity', rate: 0 }),
                addLabel: 'Add activity',
              },
            );
          rerenderTable();
          head.querySelector('[data-pc-section-label]').addEventListener('input', (event) => {
            section.label = event.target.value;
            section.key =
              section.label
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '_')
                .replace(/^_+|_+$/g, '') || section.key;
            ctx.markDirty();
          });
        });
        const addSectionButton = document.createElement('button');
        addSectionButton.type = 'button';
        addSectionButton.className = 'button button-primary';
        addSectionButton.style.marginTop = '10px';
        addSectionButton.textContent = 'Add section';
        addSectionButton.addEventListener('click', () => {
          data.push({
            key: 'new_section_' + (data.length + 1),
            label: 'New section',
            activities: [{ name: 'New activity', rate: 0 }],
          });
          ctx.markDirty();
          rerenderAll();
        });
        container.appendChild(addSectionButton);
      }
      rerenderAll();
    },
    dandi_pricing(container, data, ctx) {
      container.innerHTML = '';
      const grid = document.createElement('div');
      grid.className = 'pc-split-grid';
      container.appendChild(grid);

      const commonInputsHost = document.createElement('div');
      commonInputsHost.className = 'detail-action-card pc-span-full';
      commonInputsHost.innerHTML = '<h4>Common Master Inputs</h4>';
      grid.appendChild(commonInputsHost);
      const maxUnitsField = document.createElement('div');
      maxUnitsField.className = 'field-grid';
      maxUnitsField.innerHTML =
        '<div class="field"><label>Maximum units per quote ' +
        '<span class="tooltip" tabindex="0"><span class="tooltip-icon" aria-hidden="true">i</span>' +
        '<span class="tooltip-bubble" role="tooltip">Caps how many appliance units a single D&amp;I quote can cover.</span>' +
        '</span></label><select data-pc-maxunits>' +
        [50, 60, 100]
          .map(
            (n) =>
              '<option value="' +
              n +
              '"' +
              (data.maxUnits === n ? ' selected' : '') +
              '>' +
              n +
              ' units</option>',
          )
          .join('') +
        '</select></div>';
      commonInputsHost.appendChild(maxUnitsField);
      maxUnitsField.querySelector('[data-pc-maxunits]').addEventListener('change', (event) => {
        data.maxUnits = Number(event.target.value);
        ctx.markDirty();
      });
      const scalarHost = document.createElement('div');
      commonInputsHost.appendChild(scalarHost);
      pcRenderScalarFields(
        scalarHost,
        [
          { path: 'minUnitRate', label: 'Minimum charge per unit', type: 'number' },
          {
            path: 'laborCostPerHour',
            label: 'Labor cost per technician hour',
            type: 'number',
          },
          {
            path: 'crewFactors.1',
            label: 'Crew size 1 loading factor',
            type: 'number',
            step: '0.05',
            tooltip: 'Multiplier applied to labor cost when a 1-person crew is dispatched.',
          },
          {
            path: 'crewFactors.2',
            label: 'Crew size 2 loading factor',
            type: 'number',
            step: '0.05',
            tooltip: 'Multiplier applied to labor cost when a 2-person crew is dispatched.',
          },
          {
            path: 'crewFactors.3',
            label: 'Crew size 3 loading factor',
            type: 'number',
            step: '0.05',
            tooltip: 'Multiplier applied to labor cost when a 3-person crew is dispatched.',
          },
          {
            path: 'capacities.fridge',
            label: 'Refrigerator load capacity / trip',
            type: 'number',
            step: '1',
            tooltip: 'Maximum number of refrigerators that fit in one transport trip.',
          },
          {
            path: 'capacities.washer',
            label: 'Washer load capacity / trip',
            type: 'number',
            step: '1',
            tooltip: 'Maximum number of washing machines that fit in one transport trip.',
          },
          {
            path: 'capacities.cooker',
            label: 'Cooker load capacity / trip',
            type: 'number',
            step: '1',
            tooltip: 'Maximum number of cookers that fit in one transport trip.',
          },
          {
            path: 'laborMinutes.fridge',
            label: 'Refrigerator technician minutes',
            type: 'number',
            step: '1',
            tooltip: 'Standard technician time budgeted to install/dismantle one refrigerator.',
          },
          {
            path: 'laborMinutes.washer',
            label: 'Washer technician minutes',
            type: 'number',
            step: '1',
            tooltip: 'Standard technician time budgeted to install/dismantle one washing machine.',
          },
          {
            path: 'laborMinutes.cooker',
            label: 'Cooker technician minutes',
            type: 'number',
            step: '1',
            tooltip: 'Standard technician time budgeted to install/dismantle one cooker.',
          },
        ],
        data,
        ctx.markDirty,
      );
      // Flat job-type rates (#114): repairs and delivery-only jobs are charged a
      // fixed amount per job rather than per appliance. Logic applied reads them
      // from here instead of the uploaded workbook.
      if (!data.flatRates) data.flatRates = { CSIJW: 100, CSIJO: 125, CSIDO: 100, RWR: 60 };
      const flatHost = document.createElement('div');
      flatHost.className = 'detail-action-card pc-span-full';
      flatHost.innerHTML =
        '<h4>Flat job-type rates (AED, incl. VAT)</h4>' +
        '<p class="form-note">Fixed charge per job for the revenue streams that are not priced per appliance. ' +
        'These replace the values from the uploaded workbook on Service Revenue Dashboard &gt; Logic applied.</p>';
      grid.appendChild(flatHost);
      const flatFields = document.createElement('div');
      flatHost.appendChild(flatFields);
      pcRenderScalarFields(
        flatFields,
        [
          {
            path: 'flatRates.CSIJW',
            label: 'CSIJW: warranty repair, per job',
            type: 'number',
            step: '0.01',
            tooltip: 'Flat charge for an in-warranty repair job, billed to the sales channel.',
          },
          {
            path: 'flatRates.CSIJO',
            label: 'CSIJO: non-warranty repair, per job',
            type: 'number',
            step: '0.01',
            tooltip: 'Flat charge for an out-of-warranty repair job.',
          },
          {
            path: 'flatRates.CSIDO',
            label: 'CSIDO: delivery only, per invoice',
            type: 'number',
            step: '0.01',
            tooltip:
              'Charged once per invoice, on the first CSIDO line; later CSIDO lines of the same invoice show 0.',
          },
          {
            path: 'flatRates.RWR',
            label: 'RWR / BER: flat charge, per job',
            type: 'number',
            step: '0.01',
            tooltip: 'Flat charge for a BER / RWR job.',
          },
        ],
        data,
        ctx.markDirty,
      );
      const groupingsHost = document.createElement('div');
      groupingsHost.className = 'detail-action-card';
      grid.appendChild(groupingsHost);
      const rerenderGroupings = () => {
        groupingsHost.innerHTML = '<h4>Customer groupings</h4>';
        const list = document.createElement('div');
        data.groupings.forEach((value, index) => {
          const row = document.createElement('div');
          row.className = 'field-grid';
          row.innerHTML =
            '<div class="field field-wide"><input type="text" data-pc-grouping="' +
            index +
            '" value="' +
            escapeHtml(value) +
            '"></div>';
          list.appendChild(row);
        });
        groupingsHost.appendChild(list);
        const addButton = document.createElement('button');
        addButton.type = 'button';
        addButton.className = 'button button-outline';
        addButton.textContent = 'Add grouping';
        addButton.addEventListener('click', () => {
          data.groupings.push('New grouping');
          ctx.markDirty();
          rerenderGroupings();
        });
        groupingsHost.appendChild(addButton);
        groupingsHost.querySelectorAll('[data-pc-grouping]').forEach((input) => {
          input.addEventListener('input', () => {
            data.groupings[Number(input.dataset.pcGrouping)] = input.value;
            ctx.markDirty();
          });
        });
      };
      rerenderGroupings();
      const regionsHost = document.createElement('div');
      regionsHost.className = 'detail-action-card';
      regionsHost.innerHTML = '<h4>Regional Transport</h4>';
      grid.appendChild(regionsHost);
      const regionsTable = document.createElement('div');
      regionsHost.appendChild(regionsTable);
      const rerenderRegions = () =>
        pcRenderTable(
          regionsTable,
          data.regions,
          [
            { key: 'name', label: 'Region', type: 'text' },
            { key: 'km', label: 'One-way km', type: 'number' },
            {
              key: 'costPerKm',
              label: 'Cost / km',
              type: 'number',
              tooltip: 'Transport cost per kilometer used to price the round trip.',
            },
            {
              key: 'roundTripCost',
              label: 'Round-trip cost',
              type: 'number',
              tooltip: 'Total transport cost for a round trip to this region.',
            },
          ],
          {
            minRows: 1,
            markDirty: ctx.markDirty,
            rerender: rerenderRegions,
            onAdd: () => ({ name: 'New region', km: 0, costPerKm: 1.5, roundTripCost: 0 }),
            addLabel: 'Add region',
          },
        );
      rerenderRegions();
      ['dandi', 'install'].forEach((modeKey) => {
        const mode = data.modes[modeKey];
        const modeHost = document.createElement('div');
        modeHost.className = 'detail-action-card';
        modeHost.innerHTML = '<h4>' + escapeHtml(mode.label) + ' Rates</h4>';
        grid.appendChild(modeHost);
        const ratesTable = document.createElement('div');
        modeHost.appendChild(ratesTable);
        pcRenderTable(
          ratesTable,
          [
            { name: 'Refrigerator', rates: mode.rates.fridge },
            { name: 'Washing machine', rates: mode.rates.washer },
            { name: 'Cooker', rates: mode.rates.cooker },
          ],
          [
            { key: 'name', label: 'Appliance', type: 'readonly' },
            {
              key: 'rates.batch',
              label: 'Batch rate',
              type: 'number',
              tooltip: 'Per-unit rate when this appliance is done as part of a multi-unit batch.',
            },
            {
              key: 'rates.standard',
              label: 'Standard rate',
              type: 'number',
              tooltip: 'Per-unit rate for a single, non-batched job.',
            },
          ],
          { minRows: 3, noRemove: true, markDirty: ctx.markDirty, rerender: () => {} },
        );
        const discountsHost = document.createElement('div');
        discountsHost.style.marginTop = '10px';
        modeHost.appendChild(discountsHost);
        const rerenderDiscounts = () =>
          pcRenderTable(
            discountsHost,
            mode.discounts,
            [
              { key: 'min', label: 'Min units', type: 'number', step: '1' },
              { key: 'max', label: 'Max units', type: 'number', step: '1' },
              { key: 'label', label: 'Tier label', type: 'text' },
              {
                key: 'rate',
                label: 'Discount %',
                type: 'percent',
                tooltip:
                  'Discount applied to the standard rate once a quote falls in this unit range.',
              },
            ],
            {
              minRows: 1,
              markDirty: ctx.markDirty,
              rerender: rerenderDiscounts,
              onAdd: () => ({ min: 1, max: 1, label: '', rate: 0 }),
              addLabel: 'Add discount tier',
            },
          );
        rerenderDiscounts();
      });
    },
    amc_pricing(container, data, ctx) {
      container.innerHTML = '';
      const grid = document.createElement('div');
      grid.className = 'pc-split-grid';
      container.appendChild(grid);

      const plansHost = document.createElement('div');
      plansHost.className = 'detail-action-card';
      plansHost.innerHTML = '<h4>Plan Percentages &amp; Markups</h4>';
      grid.appendChild(plansHost);
      const plansFields = document.createElement('div');
      plansHost.appendChild(plansFields);
      pcRenderScalarFields(
        plansFields,
        [
          {
            path: 'basicPct',
            label: 'Basic RM percentage',
            type: 'percent',
            tooltip:
              'Percentage of appliance value charged for the Basic (reactive-maintenance) plan.',
          },
          {
            path: 'standardPct',
            label: 'Standard PMC percentage',
            type: 'percent',
            tooltip:
              'Percentage of appliance value charged for the Standard planned-maintenance plan.',
          },
          {
            path: 'premiumPct',
            label: 'Premium PMC percentage',
            type: 'percent',
            tooltip:
              'Percentage of appliance value charged for the Premium planned-maintenance plan.',
          },
          {
            path: 'riskUplift',
            label: 'Risk uplift',
            type: 'percent',
            tooltip: 'Extra margin added to cover unplanned repairs during the contract period.',
          },
          {
            path: 'overhead',
            label: 'Overhead / contingency',
            type: 'percent',
            tooltip: 'Share of the contract price reserved for indirect/operating costs.',
          },
          {
            path: 'profitMarkup',
            label: 'Profit markup',
            type: 'percent',
            tooltip: 'Target profit margin built into the contract price.',
          },
          {
            path: 'standardPartsReserve',
            label: 'Standard parts reserve',
            type: 'percent',
            tooltip: 'Share of the Standard plan price reserved to cover spare parts.',
          },
          {
            path: 'premiumPartsReserve',
            label: 'Premium parts reserve',
            type: 'percent',
            tooltip: 'Share of the Premium plan price reserved to cover spare parts.',
          },
        ],
        data,
        ctx.markDirty,
      );

      const staffingHost = document.createElement('div');
      staffingHost.className = 'detail-action-card';
      staffingHost.innerHTML = '<h4>Visit &amp; Staffing Economics</h4>';
      grid.appendChild(staffingHost);
      const staffingFields = document.createElement('div');
      staffingHost.appendChild(staffingFields);
      pcRenderScalarFields(
        staffingFields,
        [
          {
            path: 'handledPerVisit',
            label: 'Appliances handled per visit',
            type: 'number',
            step: '1',
            tooltip: 'Average number of appliances a technician services in one visit.',
          },
          {
            path: 'transportPerVisit',
            label: 'Transport cost per visit',
            type: 'number',
            tooltip: 'Transport cost allocated to a single technician visit.',
          },
          { path: 'salary', label: 'Technician monthly salary', type: 'number' },
          { path: 'technicians', label: 'Number of technicians', type: 'number', step: '1' },
          { path: 'workingDays', label: 'Working days per month', type: 'number', step: '1' },
          { path: 'hoursPerDay', label: 'Working hours per day', type: 'number', step: '0.5' },
          {
            path: 'visitHours',
            label: 'Average visit duration (hours)',
            type: 'number',
            step: '0.5',
            tooltip: 'Average technician time per visit, used to size visit capacity.',
          },
          {
            path: 'standardVisits',
            label: 'Standard visits per year',
            type: 'number',
            step: '1',
            tooltip: 'Routine maintenance visits included per year on the Standard plan.',
          },
          {
            path: 'premiumVisits',
            label: 'Premium visits per year',
            type: 'number',
            step: '1',
            tooltip: 'Routine maintenance visits included per year on the Premium plan.',
          },
        ],
        data,
        ctx.markDirty,
      );

      // Appliance Catalog goes first and spans the full row (like D+I's
      // "Common Master Inputs") so the Appliance name column has enough
      // room to actually read, instead of being squeezed into a
      // half-width column (modification.md #30). The tiers card follows,
      // taking whatever half-width slot is left.
      const appliancesHost = document.createElement('div');
      appliancesHost.className = 'detail-action-card pc-span-full';
      appliancesHost.innerHTML = '<h4>Appliance Catalog</h4>';
      grid.appendChild(appliancesHost);
      const appliancesTable = document.createElement('div');
      appliancesHost.appendChild(appliancesTable);
      const rerenderAppliances = () =>
        pcRenderTable(
          appliancesTable,
          data.appliances,
          [
            { key: 'name', label: 'Appliance', type: 'text', width: '42%' },
            {
              key: 'qty',
              label: 'Qty under contract',
              type: 'number',
              step: '1',
              width: '18%',
              tooltip: 'Number of this appliance currently under contract.',
            },
            {
              key: 'price',
              label: 'Unit price',
              type: 'number',
              width: '18%',
              tooltip: 'Reference/replacement price used to size the plan percentage.',
            },
            {
              key: 'active',
              label: 'Active',
              type: 'checkbox',
              width: '12%',
              tooltip: 'Whether this appliance is included in current AMC pricing.',
            },
          ],
          {
            minRows: 1,
            markDirty: ctx.markDirty,
            rerender: rerenderAppliances,
            onAdd: () => ({ name: 'New appliance', qty: 0, price: 0, active: true }),
            addLabel: 'Add appliance',
          },
        );
      rerenderAppliances();

      const tiersHost = document.createElement('div');
      tiersHost.className = 'detail-action-card';
      tiersHost.innerHTML = '<h4>Basic RM Reactive-Visit Tiers</h4>';
      grid.appendChild(tiersHost);
      const tiersTable = document.createElement('div');
      tiersHost.appendChild(tiersTable);
      const tierRows = data.basicVisitTiers.map((tier) => ({ min: tier[0], visits: tier[1] }));
      const syncTiers = () => {
        data.basicVisitTiers = tierRows.map((row) => [
          Number(row.min) || 1,
          Number(row.visits) || 0,
        ]);
      };
      const rerenderTiers = () =>
        pcRenderTable(
          tiersTable,
          tierRows,
          [
            {
              key: 'min',
              label: 'Minimum appliance qty',
              type: 'number',
              step: '1',
              tooltip: 'Contract must cover at least this many appliances to unlock this tier.',
            },
            {
              key: 'visits',
              label: 'Annual reactive visits',
              type: 'number',
              step: '1',
              tooltip: 'Reactive-visit allowance per year included at this tier.',
            },
          ],
          {
            minRows: 1,
            markDirty: () => {
              syncTiers();
              ctx.markDirty();
            },
            rerender: () => {
              syncTiers();
              rerenderTiers();
            },
            onAdd: () => ({ min: 1, visits: 0 }),
            addLabel: 'Add tier',
          },
        );
      rerenderTiers();
    },
    thomson_pricing(container, data, ctx) {
      container.innerHTML = '';
      const grid = document.createElement('div');
      grid.className = 'pc-split-grid';
      container.appendChild(grid);

      const scalarCardHost = document.createElement('div');
      scalarCardHost.className = 'detail-action-card';
      scalarCardHost.innerHTML = '<h4>Deployment Economics</h4>';
      grid.appendChild(scalarCardHost);
      const scalarHost = document.createElement('div');
      scalarCardHost.appendChild(scalarHost);
      pcRenderScalarFields(
        scalarHost,
        [
          {
            path: 'techCount',
            label: 'Technicians deployed per project',
            type: 'number',
            step: '1',
          },
          { path: 'hoursDay', label: 'Working hours per day', type: 'number', step: '0.5' },
          { path: 'techRate', label: 'Technician cost / hour', type: 'number' },
          { path: 'costPerKm', label: 'Cost per km (round-trip)', type: 'number' },
        ],
        data,
        ctx.markDirty,
      );
      const regionsHost = document.createElement('div');
      regionsHost.className = 'detail-action-card';
      regionsHost.innerHTML = '<h4>Regions</h4>';
      grid.appendChild(regionsHost);
      const regionsTable = document.createElement('div');
      regionsHost.appendChild(regionsTable);
      const rerenderRegions = () =>
        pcRenderTable(
          regionsTable,
          data.regions,
          [
            { key: 'name', label: 'Region', type: 'text' },
            {
              key: 'km',
              label: 'One-way km',
              type: 'number',
              tooltip: 'One-way distance from base to this region.',
            },
            {
              key: 'roundTripCost',
              label: 'Round-trip cost',
              type: 'number',
              tooltip: 'Total transport cost for a round trip to this region.',
            },
            {
              key: 'active',
              label: 'Active',
              type: 'checkbox',
              tooltip: 'Whether this region is currently offered for Thomson installs.',
            },
          ],
          {
            minRows: 1,
            markDirty: ctx.markDirty,
            rerender: rerenderRegions,
            onAdd: () => ({ name: 'New region', km: 0, roundTripCost: 0, active: true }),
            addLabel: 'Add region',
          },
        );
      rerenderRegions();
      // Appliance Rates spans the full row (like AMC's Appliance Catalog
      // and D+I's Common Master Inputs) so the Appliance name column has
      // room to actually read (modification.md #31).
      const appliancesHost = document.createElement('div');
      appliancesHost.className = 'detail-action-card pc-span-full';
      appliancesHost.innerHTML =
        '<h4>Appliance Rates ' +
        tipHtml(
          'Only the Base rate is editable — the 50+/150+/300+/500+ volume-tier rates are always derived from Base (Built-in Hob rounds down at the 50+ tier; every other appliance and tier rounds up), matching the workbook’s own formula.',
        ) +
        '</h4>';
      grid.appendChild(appliancesHost);
      const appliancesTable = document.createElement('div');
      appliancesHost.appendChild(appliancesTable);
      const rerenderAppliances = () =>
        pcRenderTable(
          appliancesTable,
          data.appliances,
          [
            { key: 'name', label: 'Appliance', type: 'text', width: '38%' },
            {
              key: 'rates.Base',
              label: 'Base rate',
              type: 'number',
              width: '18%',
              tooltip:
                'Every volume-tier rate for this appliance is automatically derived from this value.',
            },
            {
              key: 'avgMin',
              label: 'Avg install minutes',
              type: 'number',
              step: '0.5',
              width: '20%',
              tooltip: 'Average technician minutes to install one unit of this appliance.',
            },
            { key: 'active', label: 'Active', type: 'checkbox', width: '12%' },
          ],
          {
            minRows: 1,
            markDirty: ctx.markDirty,
            rerender: rerenderAppliances,
            onCellChange: (row, key) => {
              if (key === 'rates.Base')
                row.rates = pcDeriveThomsonRates(Number(row.rates.Base) || 0, row.name);
            },
            onAdd: () => ({
              name: 'New appliance',
              rates: pcDeriveThomsonRates(0, ''),
              avgMin: 30,
              active: true,
            }),
            addLabel: 'Add appliance',
          },
        );
      rerenderAppliances();
      // Also full-width, like Appliance Rates above -- the Note column
      // needs real room, and this card would otherwise sit alone in a
      // half-width row with empty space beside it (modification.md #32).
      const addonsHost = document.createElement('div');
      addonsHost.className = 'detail-action-card pc-span-full';
      addonsHost.innerHTML = '<h4>Additional Services</h4>';
      grid.appendChild(addonsHost);
      const addonsTable = document.createElement('div');
      addonsHost.appendChild(addonsTable);
      const addonNames = [
        'Project Management Fee',
        'Site Survey',
        'Testing & Commissioning',
        'Training (End User)',
      ];
      const addonRows = addonNames.map((name) => ({ name, entry: data.addons[name] }));
      pcRenderTable(
        addonsTable,
        addonRows,
        [
          { key: 'name', label: 'Service', type: 'readonly', width: '20%' },
          {
            key: 'entry.rate',
            label: 'Rate (or % for PM fee)',
            type: 'number',
            width: '18%',
            tooltip:
              'Flat rate for this service, or a percentage of project value for the Project Management Fee row.',
          },
          {
            key: 'entry.hours',
            label: 'Technician hours',
            type: 'number',
            step: '0.25',
            width: '18%',
            tooltip: 'Technician hours budgeted for this service.',
          },
          { key: 'entry.note', label: 'Note', type: 'text', width: '44%' },
        ],
        { minRows: 4, noRemove: true, markDirty: ctx.markDirty, rerender: () => {} },
      );
    },
  };

  // ---- Phase 6 (modification.md #26): "Management" admin pages wiring ----
  // Maps each of the 5 sidebar admin pages to its nav id, workspace panel id,
  // heading/description and the pricing_config domain(s) shown on it (VAS is
  // 3 domain cards; the rest are 1 each).
  const PRICING_ADMIN_PAGES = {
    'vas-admin': {
      navId: 'vasAdminNav',
      workspaceId: 'vasAdminWorkspace',
      heading: 'VAS Pricing Master',
      description:
        'Admin entry for VAS price banding and the VAS plan pricing master table, sourced entirely from the VAS Pricing sheet.',
      domains: ['vas_price_bands', 'vas_pricing_params'],
    },
    'rate-card-admin': {
      navId: 'rateCardAdminNav',
      workspaceId: 'rateCardAdminWorkspace',
      heading: 'Rate Card Admin',
      description: 'Admin entry for the Rate Card sections and activity rates.',
      domains: ['rate_card'],
    },
    'dandi-admin': {
      navId: 'dandiAdminNav',
      workspaceId: 'dandiAdminWorkspace',
      heading: 'D+I Admin Entry',
      description:
        'Admin entry for Delivery & Installation pricing. Standard, batch and minimum rates are entered in AED including VAT.',
      domains: ['dandi_pricing'],
    },
    'amc-admin': {
      navId: 'amcAdminNav',
      workspaceId: 'amcAdminWorkspace',
      heading: 'AMC Admin Rate Section',
      description: 'Admin entry for the AMC rate configuration.',
      domains: ['amc_pricing'],
    },
    'thomson-admin': {
      navId: 'thomsonAdminNav',
      workspaceId: 'thomsonAdminWorkspace',
      heading: 'Thomson Pricing Admin',
      description: 'Admin entry for Thomson pricing.',
      domains: ['thomson_pricing'],
    },
  };

  const pricingCardState = new Map(); // domain -> { data, meta }

  function pcFormatWhen(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString();
    } catch (error) {
      return iso;
    }
  }

  async function pcLoadCard(domain) {
    const card = document.querySelector('[data-pc-domain="' + domain + '"]');
    if (!card) return;
    const fields = card.querySelector('[data-pc-fields]');
    const sourceNote = card.querySelector('[data-pc-source-note]');
    const saveButton = card.querySelector('[data-pc-save]');
    sourceNote.textContent = 'Loading current values…';
    try {
      const result = await apiRequest('/api/pricing-config/' + domain, { method: 'GET' });
      pricingCardState.set(domain, { data: result.payload, dirty: false });
      const ctx = {
        markDirty: () => {
          const state = pricingCardState.get(domain);
          if (state) state.dirty = true;
          if (saveButton) saveButton.textContent = 'Save*';
        },
      };
      const renderer = PRICING_DOMAIN_RENDERERS[domain];
      if (renderer) renderer(fields, pricingCardState.get(domain).data, ctx);
      sourceNote.textContent = pcSourceNoteText(result);
      if (saveButton) saveButton.textContent = 'Save';
    } catch (error) {
      sourceNote.textContent = 'Could not load current values for this section.';
    }
  }

  async function pcSaveCard(domain) {
    const card = document.querySelector('[data-pc-domain="' + domain + '"]');
    if (!card) return;
    const state = pricingCardState.get(domain);
    if (!state) return;
    const saveButton = card.querySelector('[data-pc-save]');
    const sourceNote = card.querySelector('[data-pc-source-note]');
    setBusy(saveButton, true, 'Saving…');
    try {
      const result = await apiRequest('/api/pricing-config/' + domain, {
        method: 'PUT',
        body: JSON.stringify(state.data),
      });
      state.dirty = false;
      if (saveButton) saveButton.textContent = 'Save';
      sourceNote.textContent = pcSourceNoteText(result);
      setMessage('#workspaceMessage', 'Saved.', true);
    } catch (error) {
      setMessage('#workspaceMessage', error?.message || 'Could not save changes.', false);
    } finally {
      setBusy(saveButton, false);
    }
  }

  async function pcResetCard(domain) {
    const card = document.querySelector('[data-pc-domain="' + domain + '"]');
    if (!card) return;
    const resetButton = card.querySelector('[data-pc-reset]');
    setBusy(resetButton, true, 'Reverting…');
    try {
      await apiRequest('/api/pricing-config/' + domain + '/reset', { method: 'POST' });
      await pcLoadCard(domain);
      setMessage('#workspaceMessage', 'Reverted to the Excel default.', true);
    } catch (error) {
      setMessage(
        '#workspaceMessage',
        error?.message || 'Could not revert to the Excel default.',
        false,
      );
    } finally {
      setBusy(resetButton, false);
    }
  }

  async function pcToggleHistory(domain) {
    const card = document.querySelector('[data-pc-domain="' + domain + '"]');
    if (!card) return;
    const historyPanel = card.querySelector('[data-pc-history]');
    const historyBody = card.querySelector('[data-pc-history-body]');
    const historyEmpty = card.querySelector('[data-pc-history-empty]');
    if (!historyPanel.hidden) {
      historyPanel.hidden = true;
      return;
    }
    historyPanel.hidden = false;
    historyBody.innerHTML = '<tr><td colspan="4">Loading…</td></tr>';
    try {
      const result = await apiRequest('/api/pricing-config/' + domain + '/history?limit=20', {
        method: 'GET',
      });
      const entries = result.history || [];
      historyEmpty.hidden = entries.length > 0;
      historyBody.innerHTML = entries
        .map((entry) => {
          const actionLabel =
            entry.action === 'pricing_config.saved'
              ? 'Saved'
              : entry.action === 'pricing_config.reset'
                ? 'Reverted to Excel default'
                : entry.action === 'pricing_config.restored'
                  ? 'Restored'
                  : escapeHtml(entry.action);
          return (
            '<tr><td>' +
            escapeHtml(pcFormatWhen(entry.occurredAt)) +
            '</td><td>' +
            actionLabel +
            '</td><td>' +
            escapeHtml(entry.actorProfileId != null ? String(entry.actorProfileId) : '—') +
            '</td><td><button type="button" class="button button-outline" data-pc-restore="' +
            entry.id +
            '">Load this entry</button></td></tr>'
          );
        })
        .join('');
      historyBody.querySelectorAll('[data-pc-restore]').forEach((button) => {
        button.addEventListener('click', () => pcRestoreCard(domain, button.dataset.pcRestore));
      });
    } catch (error) {
      historyBody.innerHTML = '<tr><td colspan="4">Could not load history.</td></tr>';
    }
  }

  async function pcRestoreCard(domain, auditEventId) {
    try {
      await apiRequest('/api/pricing-config/' + domain + '/restore', {
        method: 'POST',
        body: JSON.stringify({ auditEventId }),
      });
      await pcLoadCard(domain);
      await pcToggleHistory(domain); // close
      setMessage('#workspaceMessage', 'Loaded that saved entry as the current value.', true);
    } catch (error) {
      setMessage('#workspaceMessage', error?.message || 'Could not load that saved entry.', false);
    }
  }

  const pricingCardsWired = new Set();

  function pcWireCard(domain) {
    if (pricingCardsWired.has(domain)) return;
    pricingCardsWired.add(domain);
    const card = document.querySelector('[data-pc-domain="' + domain + '"]');
    if (!card) return;
    card.querySelector('[data-pc-save]')?.addEventListener('click', () => pcSaveCard(domain));
    card.querySelector('[data-pc-reset]')?.addEventListener('click', () => pcResetCard(domain));
    card
      .querySelector('[data-pc-toggle-history]')
      ?.addEventListener('click', () => pcToggleHistory(domain));
  }

  function activatePricingAdminMode(mode) {
    const page = PRICING_ADMIN_PAGES[mode];
    if (!page) return;
    if (!hasPermission('pricing_config.read')) return;
    workspaceMode = mode;
    Object.values(PRICING_ADMIN_PAGES).forEach((other) => {
      $('#' + other.navId).setAttribute('aria-current', other === page ? 'page' : 'false');
      $('#' + other.workspaceId).hidden = other !== page;
    });
    // Also hide every Quote Calculator panel -- those live in a separate
    // nav group from the Management admin pages above, so the toggle loop
    // just above never touches them (modification.md #36 fix).
    Object.values(PRICING_CALC_PAGES).forEach((other) => {
      $('#' + other.navId).setAttribute('aria-current', 'false');
      $('#' + other.workspaceId).hidden = true;
    });
    // Also hide every other workspace panel outside the Management group.
    [
      'complaintWorkspace',
      'appointmentWorkspace',
      'jobCardWorkspace',
      'quotationWorkspace',
      'inspectionWorkspace',
      'warrantyApprovalWorkspace',
      'dashboardWorkspace',
      'technicianWorkspace',
      'teamAccountWorkspace',
      'masterDataWorkspace',
      'newComplaintWorkspace',
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.hidden = true;
    });
    // Also release every legacy nav item's "current" state and hide its
    // per-mode header "Refresh" button -- otherwise navigating here from,
    // say, Appointments leaves that selection and its Refresh button
    // showing on top of every Management page (modification.md #27 fix).
    [
      'complaintsNav',
      'serviceRequestsNav',
      'jobCardsNav',
      'quotationsNav',
      'inspectionsNav',
      'warrantyApprovalsNav',
      'dashboardNav',
      'appointmentsNav',
      'techniciansNav',
      'teamAccountsNav',
      'newRequestNav',
      'masterDataNav',
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.setAttribute('aria-current', 'false');
    });
    [
      'refreshComplaintsButton',
      'refreshAppointmentsButton',
      'refreshJobCardsButton',
      'refreshQuotationsButton',
      'refreshInspectionsButton',
      'refreshWarrantyApprovalsButton',
      'refreshDashboardButton',
      'refreshTechniciansButton',
      'refreshTeamAccountsButton',
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.hidden = true;
    });
    $('#workspace-heading').textContent = page.heading;
    $('#workspaceDescription').textContent = page.description;
    $('#pricingCurrencyNote').hidden = false;
    page.domains.forEach((domain) => {
      pcWireCard(domain);
      pcLoadCard(domain);
    });
  }

  $('#vasAdminNav')?.addEventListener('click', () => setWorkspaceMode('vas-admin'));
  $('#rateCardAdminNav')?.addEventListener('click', () => setWorkspaceMode('rate-card-admin'));
  $('#dandiAdminNav')?.addEventListener('click', () => setWorkspaceMode('dandi-admin'));
  $('#amcAdminNav')?.addEventListener('click', () => setWorkspaceMode('amc-admin'));
  $('#thomsonAdminNav')?.addEventListener('click', () => setWorkspaceMode('thomson-admin'));

  // ---------------------------------------------------------------------
  // Quote calculators (Modification #32) -- stand-alone pricing tools that
  // read the same admin-configured data as the 5 Management pages above,
  // but never save or create any record. Per the user's locked-in build
  // order (2026-09-30): calculators first, not wired into job-cards or
  // quotations yet; Thomson Proposal and the Revenue Dashboard come later.
  // Every formula below was traced cell-by-cell against the master
  // workbook (see modification.md #32) rather than guessed -- the same
  // rigor that caught the vas_profit_split mistake in #29.
  // ---------------------------------------------------------------------

  const calcDataCache = new Map(); // domain -> data, refetched each time a calculator page opens

  async function calcFetchDomains(domains) {
    const result = {};
    await Promise.all(
      domains.map(async (domain) => {
        const response = await apiRequest('/api/pricing-config/' + domain, { method: 'GET' });
        result[domain] = response.payload;
        calcDataCache.set(domain, response.payload);
      }),
    );
    return result;
  }

  function calcField(labelText, inputHtml, hint) {
    const titleAttr = hint ? ' title="' + escapeHtml(hint) + '"' : '';
    return '<label' + titleAttr + '>' + escapeHtml(labelText) + '<br />' + inputHtml + '</label>';
  }

  // --- VAS ----------------------------------------------------------------
  const VAS_CALC_PLANS = [
    {
      key: 'ew1',
      label: '1-Year Extended Warranty',
      rateKey: 'ew1Rate',
      minFeeKey: 'ew1MinFee',
      deductibleKey: 'deductibleEw1',
      serviceFeeKey: 'ew1ServiceFee',
      claimsKey: 'ew1Claims',
      coverageKey: 'ew1Coverage',
    },
    {
      key: 'ew2',
      label: '2-Year Extended Warranty',
      rateKey: 'ew2Rate',
      minFeeKey: 'ew2MinFee',
      deductibleKey: 'deductibleEw2',
      serviceFeeKey: 'ew2ServiceFee',
      claimsKey: 'ew2Claims',
      coverageKey: 'ew2Coverage',
    },
    {
      key: 'di1',
      label: '1-Year Damage Insurance',
      rateKey: 'di1Rate',
      minFeeKey: 'di1MinFee',
      deductibleKey: 'deductibleDi1',
      serviceFeeKey: 'di1ServiceFee',
      claimsKey: 'di1Claims',
      coverageKey: 'di1Coverage',
    },
    {
      key: 'premium',
      label: 'Premium Service (24hr SLA)',
      rateKey: 'premiumRate',
      minFeeKey: 'premiumMinFee',
      deductibleKey: 'deductiblePremium',
      serviceFeeKey: 'premiumServiceFee',
      claimsKey: 'premiumClaims',
      coverageKey: 'premiumCoverage',
    },
  ];

  // 1-Year Damage Insurance is the one plan whose displayed service fee is
  // never the stored text -- it's always computed from the selling price
  // against the claim-fee threshold, exactly like the legacy calculator
  // (modification.md #34).
  function vasCalcServiceFeeText(plan, params, orderValue) {
    if (plan.key === 'di1') {
      return orderValue < params.claimFeeThreshold
        ? money(params.claimFeeLow) +
            ' AED per claim (items below ' +
            money(params.claimFeeThreshold) +
            ' AED)'
        : money(params.claimFeeHigh) +
            ' AED per claim (items at/above ' +
            money(params.claimFeeThreshold) +
            ' AED)';
    }
    return params[plan.serviceFeeKey];
  }

  function vasCalcFee(plan, params, band) {
    const midpoint = (band.start + band.end) / 2;
    const rate = params[plan.rateKey];
    const minFee = params[plan.minFeeKey];
    const roundingStep = params.roundingStep || 1;
    const rawFee = Math.round((midpoint * rate) / roundingStep) * roundingStep;
    return Math.max(rawFee, minFee);
  }

  // --- VAS Sale + printable certificate (modification.md #35) --------------
  // JDI logo (apps/web/src/assets/landing/jdi-logogt.png), embedded as a
  // data URI rather than referenced by path -- the certificate print window
  // is opened via window.open('', '_blank') + document.write, whose base
  // URI can't reliably resolve a relative/absolute asset path.
  const JDI_LOGO_DATA_URI =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAooAAACJCAYAAACrfxkLAAAKOmlDQ1BzUkdCIElFQzYxOTY2LTIuMQAASImdU3dYU3cXPvfe7MFKiICMsJdsgQAiI+whU5aoxCRAGCGGBNwDERWsKCqyFEWqAhasliF1IoqDgqjgtiBFRK3FKi4cfaLP09o+/b6vX98/7n2f8zvn3t9533MAaAEhInEWqgKQKZZJI/292XHxCWxiD6BABgLYAfD42ZLQKL9oAIBAXy47O9LfG/6ElwOAKN5XrQLC2Wz4/6DKl0hlAEg4ADgIhNl8ACQfADJyZRJFfBwAmAvSFRzFKbg0Lj4BANVQ8JTPfNqnnM/cU8EFmWIBAKq4s0SQKVDwTgBYnyMXCgCwEAAoyBEJcwGwawBglCHPFAFgrxW1mUJeNgCOpojLhPxUAJwtANCk0ZFcANwMABIt5Qu+4AsuEy6SKZriZkkWS0UpqTK2Gd+cbefiwmEHCHMzhDKZVTiPn86TCtjcrEwJT7wY4HPPn6Cm0JYd6Mt1snNxcrKyt7b7Qqj/evgPofD2M3se8ckzhNX9R+zv8rJqADgTANjmP2ILygFa1wJo3PojZrQbQDkfoKX3i35YinlJlckkrjY2ubm51iIh31oh6O/4nwn/AF/8z1rxud/lYfsIk3nyDBlboRs/KyNLLmVnS3h8Idvqr0P8rwv//h7TIoXJQqlQzBeyY0TCXJE4hc3NEgtEMlGWmC0S/ycT/2XZX/B5rgGAUfsBmPOtQaWXCdjP3YBjUAFL3KVw/XffQsgxoNi8WL3Rz3P/CZ+2+c9AixWPbFHKpzpuZDSbL5fmfD5TrCXggQLKwARN0AVDMAMrsAdncANP8IUgCINoiId5wIdUyAQp5MIyWA0FUASbYTtUQDXUQh00wmFohWNwGs7BJbgM/XAbBmEEHsM4vIRJBEGICB1hIJqIHmKMWCL2CAeZifgiIUgkEo8kISmIGJEjy5A1SBFSglQge5A65FvkKHIauYD0ITeRIWQM+RV5i2IoDWWiOqgJaoNyUC80GI1G56Ip6EJ0CZqPbkLL0Br0INqCnkYvof3oIPoYncAAo2IsTB+zwjgYFwvDErBkTIqtwAqxUqwGa8TasS7sKjaIPcHe4Ag4Bo6Ns8K54QJws3F83ELcCtxGXAXuAK4F14m7ihvCjeM+4Ol4bbwl3hUfiI/Dp+Bz8QX4Uvw+fDP+LL4fP4J/SSAQWARTgjMhgBBPSCMsJWwk7CQ0EU4R+gjDhAkikahJtCS6E8OIPKKMWEAsJx4kniReIY4QX5OoJD2SPcmPlEASk/JIpaR60gnSFdIoaZKsQjYmu5LDyALyYnIxuZbcTu4lj5AnKaoUU4o7JZqSRllNKaM0Us5S7lCeU6lUA6oLNYIqoq6illEPUc9Th6hvaGo0CxqXlkiT0zbR9tNO0W7SntPpdBO6Jz2BLqNvotfRz9Dv0V8rMZSslQKVBEorlSqVWpSuKD1VJisbK3spz1NeolyqfES5V/mJClnFRIWrwlNZoVKpclTlusqEKkPVTjVMNVN1o2q96gXVh2pENRM1XzWBWr7aXrUzasMMjGHI4DL4jDWMWsZZxgiTwDRlBjLTmEXMb5g9zHF1NfXp6jHqi9Qr1Y+rD7IwlgkrkJXBKmYdZg2w3k7RmeI1RThlw5TGKVemvNKYquGpIdQo1GjS6Nd4q8nW9NVM19yi2ap5VwunZaEVoZWrtUvrrNaTqcypblP5UwunHp56SxvVttCO1F6qvVe7W3tCR1fHX0eiU65zRueJLkvXUzdNd5vuCd0xPYbeTD2R3ja9k3qP2OpsL3YGu4zdyR7X19YP0Jfr79Hv0Z80MDWYbZBn0GRw15BiyDFMNtxm2GE4bqRnFGq0zKjB6JYx2ZhjnGq8w7jL+JWJqUmsyTqTVpOHphqmgaZLTBtM75jRzTzMFprVmF0zJ5hzzNPNd5pftkAtHC1SLSotei1RSydLkeVOy75p+Gku08TTaqZdt6JZeVnlWDVYDVmzrEOs86xbrZ/aGNkk2Gyx6bL5YOtom2Fba3vbTs0uyC7Prt3uV3sLe759pf01B7qDn8NKhzaHZ9Mtpwun75p+w5HhGOq4zrHD8b2Ts5PUqdFpzNnIOcm5yvk6h8kJ52zknHfBu3i7rHQ55vLG1clV5nrY9Rc3K7d0t3q3hzNMZwhn1M4Ydjdw57nvcR+cyZ6ZNHP3zEEPfQ+eR43HfU9DT4HnPs9RL3OvNK+DXk+9bb2l3s3er7iu3OXcUz6Yj79PoU+Pr5rvbN8K33t+Bn4pfg1+4/6O/kv9TwXgA4IDtgRcD9QJ5AfWBY4HOQctD+oMpgVHBVcE3w+xCJGGtIeioUGhW0PvzDKeJZ7VGgZhgWFbw+6Gm4YvDP8+ghARHlEZ8SDSLnJZZFcUI2p+VH3Uy2jv6OLo27PNZstnd8QoxyTG1MW8ivWJLYkdjLOJWx53KV4rXhTflkBMiEnYlzAxx3fO9jkjiY6JBYkDc03nLpp7YZ7WvIx5x+crz+fNP5KET4pNqk96xwvj1fAmFgQuqFowzufyd/AfCzwF2wRjQndhiXA02T25JPlhinvK1pSxVI/U0tQnIq6oQvQsLSCtOu1Velj6/vSPGbEZTZmkzKTMo2I1cbq4M0s3a1FWn8RSUiAZXOi6cPvCcWmwdF82kj03u03GlElk3XIz+Vr5UM7MnMqc17kxuUcWqS4SL+pebLF4w+LRJX5Lvl6KW8pf2rFMf9nqZUPLvZbvWYGsWLCiY6XhyvyVI6v8Vx1YTVmdvvqHPNu8krwXa2LXtOfr5K/KH17rv7ahQKlAWnB9ndu66vW49aL1PRscNpRv+FAoKLxYZFtUWvRuI3/jxa/svir76uOm5E09xU7FuzYTNos3D2zx2HKgRLVkScnw1tCtLdvY2wq3vdg+f/uF0uml1TsoO+Q7BstCytrKjco3l7+rSK3or/SubKrSrtpQ9WqnYOeVXZ67Gqt1qouq3+4W7b6xx39PS41JTelewt6cvQ9qY2q7vuZ8XbdPa1/Rvvf7xfsHD0Qe6Kxzrqur164vbkAb5A1jBxMPXv7G55u2RqvGPU2spqJDcEh+6NG3Sd8OHA4+3HGEc6TxO+PvqpoZzYUtSMvilvHW1NbBtvi2vqNBRzva3dqbv7f+fv8x/WOVx9WPF5+gnMg/8fHkkpMTpySnnpxOOT3cMb/j9pm4M9c6Izp7zgafPX/O79yZLq+uk+fdzx+74Hrh6EXOxdZLTpdauh27m39w/KG5x6mnpde5t+2yy+X2vhl9J654XDl91efquWuB1y71z+rvG5g9cON64vXBG4IbD29m3Hx2K+fW5O1Vd/B3Cu+q3C29p32v5kfzH5sGnQaPD/kMdd+Pun97mD/8+Kfsn96N5D+gPygd1Rute2j/8NiY39jlR3MejTyWPJ58UvCz6s9VT82efveL5y/d43HjI8+kzz7+uvG55vP9L6a/6JgIn7j3MvPl5KvC15qvD7zhvOl6G/t2dDL3HfFd2Xvz9+0fgj/c+Zj58eNv94Tz+8WoiUIAAAAJcEhZcwAACxMAAAsTAQCanBgAAEteSURBVHic7Z0JtFxFncYrsjiKIqEcFywUQ+EGjGgQcEPARNEBRSGACIIoiQsioLKqo6AYRnBhWKPsCkgUYUBAAVkFQaKioIJFFChEZYqACopLMufr89U79Sp37e7X3e+9/++cdyC93L597+17v/tfvv+MFStWKEEQBEEQBEHIecJKjwiCIAiCIAiCCEVBEARBEAShDBGKgiAIgiAIQiEiFAVBEARBEIRCRCgKgiAIgiAIhYhQFARBEARBEAoRoSgIgiAIgiAUIkJREARBEARBKESEoiAIgiAIglCICEVBEARBEAShEBGKgiAIgiAIQiGrqgExY8aMQX3UlCAYO08pdbpS6hjt3aeGvT6CIAiCIIwOK1asGMjnzBjYB4lQbEww9uVKqZuUUqvzoV20d+cP4HOfqJTaCDcQ2rubJ/rzBEEQBEHojkHpt4FFFCczwdjPKaU2VkrdopQ6Q3t37wR/5FGJSATHBGO/rb37x0R8WDD2SUqpw5VS+yqlnqaUOkspJUJREARBEKY5ElFsQDD2LUqpi/hPiLUjlFKf1d71vPGCsWtweYgi3q+UOlUp9f2Cl35QKfU2pdTLKFg/pL27uw+fD2F4hVLqFXwI3+ll2rvbel22IAiCIAgTw6D0mzSzNEB7979KqRv4z9WUUkcqpT7fp8X/TSn1PKXUVkqpdyqlrix53QlKqTlYHaXU35VSv+3T5y9KRCI4SUSiIAiCIAhAIooNCca+VCm1RCm1Ch/ChlsvTUMHY5HKf6NSah2l1HXauzsbLhvLPFYp9eEGLz9bKfVu7d2/Gi57Y4rMP1EEfid57vlKqaXJy+9TSr1Ee/eXJssWBEEQBGE4SERxxGCU7cvJQ1C+b47/CMZCHOI1l0DIKaWe3GLZ/9Le7Y90coPo355NRSKX/XOu9+uxbsHYvZOnX5m9/AMiEgVBEARBiIhQbMd/KaXuSf79hqTODwLxJXx+rvbuJ20Xrr07Xin1mZKnkfr+YDd1kdq7b6Gmkv9cFIzdg/+/ZfKyy7R3+A6CIAiCIAgdJPXckmAsxOF3+c/HlVLHKaV2UEptwMcWau8O7dGiBvWHz8qe2kx796Melov1uyt56CGl1NpJg85G2rv0eUEQBEEQRhRJPY8o2rvv0T4GQNR9LBGJ4Nc9Lh/i87LsYd+LSCR/zP4dRSL4kohEQRAEQRByRCh2x4FKqQdLnkNXcinB2Cbb/HfZvx+pW2Ywdq2aZc4sefz3FeluQRAEQRCmMSIUu0B7F5RSHy15+tU1bz8uGHtGMLYqF49ax5QNgrFPrXj9yUqpO4Oxz6l4zVtLHj9Ee4eOaEEQBEEQhHGIUOwe2NRcW/D4fwZjc6HXIRh7EI2z91RKvbfkNXjvdtnDq9O7sej18F/cRyn1DKXUOcHYpxS8xiqlPlHw9puTNLogCD2C32Mw9qhg7JHB2NnDXh9BEIRekWaWHqCou61gFCImrCxgJ/HyYOwzOH0Fj0X+yn+fE+1ugrEw1D5DKVUWGUSK+ETt3QPBWKOU2pWd2Kk4/A3tcG7kjcDWSqmDlVJFqenNtXe3tPzOMOd+j1LqG9q7q9UUJxiLRqVN+rS4C7V3P1VTkGDsFkqpbRu+HA1fMJqfMtD54Fyl1Juyp07q1q1AEAShioHpt+kuFIOxO9GQ+rfau827eP9CCrEiHmZ94boV0dtlbICBOKxKHfebM7V3e7V9UzD2EKUUZl8rdnwfxAYcPLc+rIGUUvdq7y5VU4Bg7OlKqdbbqYS9tHdnqilIMPb9uIlp+PKZ2jv8NqYMwdjzlFK7lDz9Hu3daQNeJUEQpjgrRCj2j2Ds69mAgtrCU7V31wZjn6SU+ohS6tMUcX/W3q3ZxbJhrH27UgpTTiYLMNV+ofYub5oZB+soX0exe6f27rFg7Os4izoK3weUUj9WSj1XKYUpMJEPa+8gJCc9wVg0KL2YETOYojc9TpxS6n9YouC0d4+qKUww9ukcbbnXdBKKwVhYWeG3VHaSu6Wbm1BBEIQqRCj29yIPE+w1sije6tljGG/3AaZ/383nztXefaPBZ2Bs3+Vq8nCY9i5GBetS63fwn0gVfoVNPBDdde+/W3uH2sgpRTB2y5La1JwHKcZxrE0b2HS1LBl1OR2EYuqtWsQ/tXeYES8IgtA3xEexf7wtE4TRKiZ9DPV8Hw3GflEpdYVSajd2CW/U5AO0d7hInKomB6hh/ELD16LWMo4L/DdG0zBG8Gil1OKa964fjH2BmmJo767jNqzjoukmEoH27s+cGT6dqBLFYNUa1wJBEISRJW/CmIqU2cJE/kAx+T6lFOYt513BTdmfs5MHWWfYDQfEmsI6tHePBGMhol+bPLwHo4of5narOoYWML0/1XANSg3wmulKpe/nFATz1Kt4hAJaEARh0jGlhWIwdsOCLsQcdBH/MRhbZFcDkdQI7R3q/vB5U4Jg7HNZ03lzJhQRhV5He/ezYOyvWbtXxoHB2OVKqWO0d3/Ilo/U/yeVUugWPZTbr2g9EP19pvbuV2p0eKzBaxqJ8SnKlEkrN0F754OxmGxUFkFHTa/QgGDsfHTFM+uzjD6vyGJMO2Rb9IZsvykuFNlogrqef1S8ZjNGtT6nvbs9e25tWsd8qkFaCJNJwEWZ6MFnr82u5hO0d7DBmRYEYxEtu5O1nf/Mtsk+FInYR+s1WByijx8JxmIE4d7au1jziH1zKFPbhxSsA+x/vqSUmsVSAEEYZa6uEIpXqhEkGAu3BpzfegUX36W4GPdyIS5YH1zgT8HNovYO5S7ThqbbIhiL8+PdNYu7UnsHN4ppgxxL00AoUjxgpz6HQvCagtfMo4DYIhj70hiRCsai+WTHBgIxgojjIu3docHYe+h7BlB8/isu57lNPeLYDPNVNXp8XXt3eMPXxvR53ozyGdi7cL+gJhNisYyL+Ty2BzqZNuOF9I5g7LORAufrrsi7gYOx6zGSiYjl1kiBN/+agjAUrsp8UlMwH37k4AXz6ILoS1vw3g7B2FMoHBdr79oK5IMrHp9uF/dG20J7B4E+o4+if6ogx9JUb2bR3v1de7e3UuoG3KkHYz9acfLFHdVhyeObJyIRzRj7MjpWxg7B2O8EY/9de3dy1qiwSiJ6mq47To7fUUo9b4T+kPb97xbf4YaSiS1/5H9hgYJO7zJwh7sb72J/kTz+2+THiuaY5Yws5nyVJuJvF5EoTBKKbmYV/VlHvl6VkcAyoRtZoL2bEf+YCTi6RDheEYw9n6UjwmBE/5Jhr4cwNRlJoRjR3h3JyNXng7GvzZ67goIMHMCaOkVPvwhqEk5go0oViHatyUhWPsHkzy2MhCOIln1bjQawcnlDF4ILIjvnmGDs4fx+l1W898dJzWF83Vnau58EY5/HCxJE4r7au5sL6krhe3kBakdbrrMgDAXt3YMlTS04T00WEJ1qJU60dxCL65eIFGR97maWpQllkZ6hRICQ1g3G1qV1J4putsWUF4ot9slIHUuTnVFNPadgRB2ii4cXpH/fqZS6RCn1Gka5MBkBJ65NOQ0lnqSrDqx7OVsZRtKLClLWsNHBXfFDbSKiiIbRh/AZFEV/otF1WvM3CB5o2uUcQXS1pFt8DY4RfB1T9phb/Ral1KN8DI0pcd71yyAMlVInc3TdDTQnP4P740MlIwDntm0kmsoEYxF5xd9jPK4G8ZkzuC+Xa+9w3ArN+H5mOt+zUAzG4nwEa52/DWDsYVd2Tkh/BmPn8rvm861nMro4ty4VDeEZjF02Qg0IQ0vljuC2GBUa7RPZftNMKGrv7g/GIn35eggNTAfJ7Fu2oTg8OBi7J2voXojXo9OW3bWfK0ht3stGFozewutPKalrRNT14mAsUqn3tFz3X2Sp15EnGLsBi+9jhLaIudy+mLzSmb5Cz8TLWAoAQXhjMHY/7R1MumPqbW/uCxRXQzwX8aJk4su0Ihj7FN60bM/50tgXY0bNwdi/87hF89ZNnLd9Tx8+d3V+Lm4OtuA+7Jwb2LWOWl2UI5zNsoS+E4zNranqOCkZHQnDa9yUteVa3sxEc3ksp4qLtXdVN51Xs8EusoK1i22FIWqs3063gXWS57Dvf8Df2bcRtcd5CfXHsKrS3l2ohgQ8Q4OxyBTcWvISpKE3ZU1d1XJwIR/6xZw1m/PaRln7yahsi1Gh7T6R7TeNhGKSBt2QXcnjwuvsjD4yGItRaTsiBa29wwn1El4Af5OcbHHR+4D2DqKwQxLlqtoWr2KEa9Q9EgtBh7L27q9JtHAN7V2sF8zZskYkRr4ejMXs4k76X3t3F8f7oXv85YyCQeyMob07vsFyn579d8oTjH0iBcZhSVQWIuiX7DTH8YsGoNXZYIS/HZBGCcbC7P2jeed/w8/FTdA+tCkaEyQcR/drCkZE5l/Cv/nB2Gv5G+r3DRDM7tuA32yMlEMs7dnFZ6KE4idJ+UndOuA3c3dNneLypKRnifaucSYiGAuD/3OyqCTEpue+fy7/3oHjIhj7QMPf6kDQ3i0Jxi5Km1vyrtMkYzCysJNYGkNGCNknw2WkaxQTcCEFEDmFYCSY9u5UisT0JAshqJge3TWKRExK4Azoqxr6H8YL+EoEY9EQg/nRnYtVMPYTwdjTGSEaKsHYneBrF4w9Nhi7GuuofsPvXkTTCNXTKcYfiM1G8JNjROo9SqmjlFJHtFxXlAzgTzGlPeUJxq7DKNHRyTEGQf107R26+RGFwWteWjI6EE1FuEC/o+XnPpOR45MTkdixP4I41N5tRaGI0o4U3AzcHIx9s+ovT+GNBSyTilKsj/BCgePrKdkIQESytkmsrqp4nA1uEFhfjg9q787gdtitYPLOpYx04yaoFNYBR+HZqtuZdl8/yETi2fQsxc3vs7h+2D4oB1htlERiwxqwOcFYRIRGFjbfIIUuTTgjguyT4TPyEcVg7JpKqVfwn3thUkjTuilEG4OxW/EC9D3t3QPJxfmWlhHCq7Iarnex/vB4RoI66xiMvTARSCcEY39eY0o9UTyuvUNEyjAagW2ARhIIBPASRhePZQouehVezwsRtnsTnsVmo9vQYMQI72ltVjQYi9rHIxlVizcv2wdjP6uU+hZtdtZjqnXQNZ4TXX94eSYOIFKQsh83xJPelagL/WmBXx/279eCsUF7VytO2FB0FZsQUv5Lezdm7YRtHYw9mWnpXNR9Mxi7CSLJqg/QIglepbcFY7elII1cQg/OB0ve+zjdEfZqMHP9Oja4FS0H54dzGamL9bNwDHhHi1rNK5M6vUb2MPR9vTD7zWH/7JkeB1y/hcHYb/J75vtv6LBeEd+7rIFlfoPxn8MWJLhBEkYA2SejwaojemDg7wGm2z6fRAXRrPIa1MLElGcdNMrOzbIXdZFGTk9u/8nUl+Jd/f0UiquyYeV+dkvDXBoRva+pwfMvNJRwvXejeHuA0ZrVmUq/JtrQpBdd2AUxvdWGLxQU8tcSjH0xxSD++wgvgM9kg9Jh/IOv5oenkkgk+xdsM9x8rFPUdY7yAQq3olndENgnoT63ajsFYzUjXbnIgCA6puAtZVE6iPePMQLZNxhZSx0OcLPwiVw4l81cD8b+kFHHMppE4VJReHzLhp5raP/0GCOETTiE57qUr5V9Z9jtsHlkyYhGWaqEIqKKs5GmVqMpSPJmHGFIyD4ZHUZOKCqlUEv3w4Koyf+x8/gFTHmexs7ZJuPUxgjGvpJCry1Yp0iamnotp8AgKvYV7R0EGpoQ/sm7oMb+hX1mFabK9qa3JNbvMRbsY91+mQhwWBCl/KQLobhRMPY1bZodgrFYr+8y5YoC/d1jTRdPEltyvW/S3uXpwKlAUV0dvu/ZsBQpafhJj8OcWbxAV0XVTiuZIHJeySSk0ulIFPN9Ixj7dNboPaGonrgh+L1dUPH8C9F4VRMJjRkA/E7QjNWG67jNrm3RpV40eahTU1wGfg/B2I+NqLl/nQhE+rlvQpHnivn8m5UFBNA4t5iG1PhNzS2pfzt/UIKETRnzk8+LNkOD+Gxs+/gXWUyD9JGJ9A56n5Ssw2yeT+dnx9XSxFR+6QR8Zjw+Ip2mnGHeXI2cUIQFBKMKsL6B4HqQaZhbcIfNOrZvUADNRsdjS7891M91w5gPIcbQBWNR57SfUupMziHudEwGYz/COruZrJsa61odAs9nCu2vrPNENOrj/DdS0lvxGMgjH63EdwIaLBoJRY7ou5giEXeNO6QXVnRR1tWETQHQbV/E1tw3RTOCccNUxavLhGIw9u0VtZ9FVkVg3IzujHij0TNsKruIkU4IrZ277OLFMXUfm3DK2ANRyornYzTs0nxGeR24cWX9ZqOufboFFGU3tuN5roozGXEftbRc3QVtXLQxGFsXLV6qvVu/4sJaVr/WueAGY0vXix6P51dEZmcVrN/Y+vD9dRZIHWugiggZHDuwzEW9bIsq+Nnnl0R6O8KRJQMLysRPw+kv68f3c0pPUWNT5XfpZZ/0a/vBLD4T0ymxsQZlIIu5zZZV3BSc0mSbVWzfeBzjc4bSxT2SzSwoCtfenai9O0B7dxRMmWMaRnt3Ky+kv2OB//dbNo1UTRSpYq0sfbcBIx5fDMb+bzAWtU03MX23Kz9nmCIxTxNiX3+AUdm/ssMTdZqo1/o9ozm1jTs1jDNFrwG1naiRxA9st0F5BI4YVSe1sjR+VYRPlQkk1tVWNRcVzjKnUCpLP2N+d79E4iV0F8CxuX23Vi9Mu9edmPemDU3RuqyWeIie1uU6XJnMNK8DN0xF7B6M/UCD7xpLYEaGsotmwjhhm0x56Vb8pIJi52xyTMo44ZGIvK7T9/SGLDMcz9f11ooI2exetkWD7Y3PrjM+72wPRvPKpr/Mbeq3qb1b0GDaj+rnPul1+2E/BWNvzUTilRRzMwr2NV53K29YitZnEQNHlZHHYGxHeNasHsYaD+WmcCSFYh3sbN6d/9ywaXqXnZ5lJ+Y60AAQeT8bL75Ci5E3UhxW1UaNGs9h6vDF/FFuUeBl2JaNKUgqoc9lvBh/QXtXFyWbqtzW5XPd8LqK7v7lJZN4IrCeynmYZvg9QQur83jzh/re7VBr2ONiv1IjqFEDWta1/Ub+Hv7IbueJBqUGZaAZ7oJgrK16DbfdhPhb9kDVhREX41kFIqRt6vPgPNWcpk+5zPXL1oWCPorKBRURqBnZ37iIFCNodRM/GjdkdLktqpjFPyx3bX7fMvEyq+pGi8K4cVSLQqnxd+nHPulx++UR32W8+ehsK/5350wsd9LkFQJ7Sc02m89j+ZBk35SJ8aoI7fRJPTcFUz0QyWMqDWHZTzVIQRfVZqWkHmg5myVdjKsmqV0ILlzsilJ50Qcv/4xBT7vYKusiVfyeccyeyqJGVYIXURbL+sGiyCWaMerSdelFemgmwSMAGjXQwZrzvRIrnF54W8Vzfy6pT4ws5IlrWx6/P+dFGXZI/YgkQuiAy7R3Ren2VuA8wNQRyleqSlCKZri/M2kmqYve9oPCTu5sv70lGIuGuM/kc6NZ01s2Z3qy0bbeK79orhSFYkoPF/ZbJ7jxZ0nN72c2hcDRJSnG/P39NvoeNxmHnpdzS3xB0XA0vyLN2XaCzzBMy1t/JvdLHhm8Mo+Q85hanB1/MR2NY63t8RFF4tGZHykez2k6DrOvTFqhSL5OobgKG1ROr7EieXYWEVkru2gj7XRQySLeQG9AcC5MjpVSdzIFXsRxw5yUkAIRXSAUcUDCD++AJKUfo31Iq5cR66aiUDyd2y1GeJ/JuowbSkb0gY3S1VPTFO3dt+hn+W6mjHHRRzTttIouXwjxbigS9pFHa9YT4vAk/vWFApGoWCeFu3eIvF45oUYobheMfZb2buwGCd6qrLNVVeeSPgO7o8cTr9giVmHjE9LROOd9jnXRk5lZBRfzxgKE0Ztc+M0rEji88B4yRMPmMZGYjZc7JWlmWdSPcYolQOysZNWUCJ6iWjw81i+h2M/vMiGfydKAg1sIvKUFj+H4Q8NUI1usdFnx2Giw/pJ67oK0E7a0eJ0niV2z4vudEpuR5RxFh5N2ys1Jkf+Wwdj1+AO7k6JzM3Q5q8lJp2FFe/cl/GWF/jGqtR47MpdnKdGreSDjux/Iovr0mMINyHfY1VxEKtAn5bSbfoEImvZuDxhca+/eji7fPJIF8Y5jOBi7hMdkK1gOUDXirrZcoM88tUAkRlDQn5Z5dIX27qbM/LpIfEGgp2B0Hm4of9TNpJtu4PzmpvZZq9C/9efB2C8FY7utJR4FJko8oI6rSBAuGpJgST9/DAjDJG06kI7nEsqEEKKKo2i9NFEguDGzRWRyacnj3RjKF5UtlB2rQ9knk10orlsXFQnGfjCZ9YzUKEC05seJULyGaeu0TussdJBq77ZhZyEuplhWB+3dnxOROOhU8kSCC9H32VBwj/YO0dPP8Lnfo7mBQuYcXlAfZld6FNmrUVhiW6PJJxp8p9zQMCU6bYHFEiLBNGz/FY/hl3c5A/vfS8ojIoOeIHRpiUgET6N5eGGzSUvqRka+J6upfWcvTSw9ACeCNt3Vq7JGGibsbRrIRollE/h+dBGPazBA+lB7B2PzYQAblWGK1G5TtENJcw6Jsu+6rOXj3QjFthHIgTPZhWKMfhV2YHL2MCKFuTfZqTxx3E/BGEd53cxU6N8ZKXtpMPYZ2rvP0a+s7OL2r0FGaYKxa1X8rVpl7UN+VlEbiIMWNirLYW8QjD2RKZvfx/cEY9HscjhnbOPC/h9M/R/PbbxekiY9raDBBcuMs4L3Y7p72oPGjmAs0os4Du9is8hGPL7OpvUNOoPbUmdj89Q+CbOmpKUHRbyGo+p6BU0yVRfo9Vm/G6c14abwb3zfwGD6e25FGUuVefhVwVhEQkeNyshHr/5zFF5VDQsQiRCLRenEQTNS5uIZVfth1GyXRkkoVjVqTTmD8EkrFIOx/5nUE93G0XMqs7A5N/mOz6Io3FJ7tw8ijbSEQYH+5cHYj3MU2FGMqK1Kc2PY76yB91R4MGpexNOoZmVaCGnEYOxD8H2q+Lsuef0m8XEevGV/RSbIab0bzIhfrr0r7BTX3mFU2iP0mZvPDu9tOUUEM6wRKYSQ2ZEm2VgO0nyztHcfYmQkdjTHxpVxNh/czqgtvZ/RrEtrOjunNBDSHD93NwUhGqciOK431N69S3uHaToTxSAvCnc2iPYhmtqNKB6DZvx10cH4m96N54oLsjnSA0F793NGjBtNnEpABP+cYCzeO1mEYr+EU12nsaLXXanly4AY1WjiqK/bQKg5NpZ1scgpJ7AnpVBk7RtSnwB34zsWFP9/OWteeS+jhb8Ixn6VF6pT+ZpvMTq2Lv0FD+AFe7XUfofjANP1WJONG7tQVMZmlyagLuVLJc0cuMB9mobe6Z0f0k2wBiq7+O5J0VYFmnZgTIq01R0UKOPg6D+k2yMooP8NbWy25EzaU/kjwveHeLwmGIuasNsLLhKYBY0O8TG0d3dz7OH1/GHdEowtM4OestB4/Do2T+TWTSh/2Jo1sb3QmXZTQ5l1zkTwRv7Gqo7VVZiCbjpzvIyTavwqd2It1u4DbmJZCZZ1bMdyjHHdzTWsXjLWcSg0iKj0JdVG25EmPn3RH3BYkZ5hdP0KwxN2M9UUY9IJxWDs2+h1tCYjW5tTdKSvmVvQ8Yg0E+w8/i+JIkCYQPzh5AxeRsGJup901NMHgrFvLIhY/pCda+fSUgYNII3Q3l2hvTuCs6xzMO0Fdj9jzTWYN6u9Qxq9SEwtp6A4i9G6Kh5lwf6L2OBwejD21cn3ejJFcprChhCMqcmtS6KmeH6Tkq7cJxWloLV3DzDddyBF+UUYzdgHcTApCMbCVHtJSRQY5QH79KNZirOK6+poMdpyUDxCs+jdM4umnOezTKFreG6oGmmIbuPP0bwfN2E92/P0Ct0SXsx6YVhsNeF1wdgmc6xH4cLbN49Adgs3MYHGOg07sigIk5JJIxQxMSEY+3mmTnGR+RCbTe4tsMHp9uISBdPl/IyU8zOxeFQyE/Y8pgVhlNmWonRiaQSJUc186sPdFF1NwDzlnzHCGoFxOLq6t6E9Sx5dQmdujP50aroSUFf165LPSr8H3rdPwff5J6bbcJwduqcR4bydtjFTForh71TY3RzZ52k1eUd/TlouMBBYp4bfcRXvDMYWzUJua5VTxYLkBq1ovvaEgfMVa4ufUPC7OJv1nO9oKBjTkoVhUhW5W9LvmbW0I9m0QaQSkZ62s8OnM9MlLd3viO8yNcWYFEKR81BvZroK84o30N4dXxJtQRF8rHdbXjKHcznFZG523JnXrL3DrNhjs+fWZC3jL9mJGoXWb2n4/dQsXduUIoFXZ/R7ew8H5kHB2Jcg+qiU+jYfezENnq/Kolv3sUN1QRJtnJ2JxC34/jz1dTcvcjskTURHlVkuaO9+p72DSNycUSbMRsXrB23dMigOrZlHjH3RT+oiZbDgQUR4oGjvzigxHU85ucdI0GUNLwbDSDsfwt9voc8lhKv27jz+lvau+a0jyzEKVE2PWDRRNx3aO0QW66xmYPsiUcXB1pKOOv0WdkvVFGPkhSI7+nDAIlL4Cu3d+7V3oUJQxhPFHRQdaMRIawshWt6qvYPVzW5ZuhgNIya5kCP1A7PqsxP7ihfxpB233TmwyuHnphf+aMVTRx65VDVWJp2vmv27Lt2cLzv6jBXViCE6iG2zjvbuudq7/0ymQbwqSUk/xnFr90Gwa+8+opT6WNIBfhCjIhdRXJ7LbX9EzQn/R0nt4qGjOMu2IXXD6VFPWga2Z79PXuc3tGkZBgtqRgg+lfWKXQ0ISAzDq7hae5f6sg6aSisSCkYI2ZdXdEfjPDRUgrHzKsQHjJ8nRChGaFy8aY3ImXJdqT1Qtq/gCjIthCLPtW2/66zptN1GWigGY/dhtAFpl1dq76oMdBUbVO5kh+5sTBvhRQIXoocZIdtWe3cJDxBE7uZlQrKTgkOtIlI/2rtPo+OUjQb7F0T74mSHWOcYqZq00Cv5OrSt6UNtXJHARG3Uxtq7E0tS2dskn79Lvj+0d8dwJvYLtXeYUbtqMBZpM9gUoeZyXXZTV6K9e5T1a/icdwVjy7rN+waHwaMT/gvB2IP60IX9SMVnPT1rtMpZJRhb5m3YlY2N9u6XDWpod8xrcWs6tXft0lYnT7M+ROG8oqaG8pOqe06j9U0ZQ2tiIXs2EcLau9+yqa2IdAznsCizo1nWsPGkMXSNKBrbh/R2VSp6yjUb9ECZ4JlQQT+ClNXNzppqnohTSigGYzdlehhCbx4tW6pejxTlm7R38PRDavjQYOxhHNOFtDUuzutp78YsZ5JC/7lJdC2dQ5y+DtGxLxfU2T04hLqEtgbJuRk5bILA37OLDCaEVEUn53KuLNLN/xeM/XIw9r+DsbtEYQNvSu3dXfz3JexORzTnVxwXVefp14G1p2gWUmx2mTCQiqev4/Esb0BU4k52tHdLlcUKouN1rOTZCZsm1JP2sE7wvqyrwftanUimODyZUeKVuubrrKGyyTwdtHdXJX6mZRxOb9TWUIxifcsicXA+GCYmt5GqoGg05uPJ72UolMzKjedGzBrud0qubOxaB6aiiz6zzbm6H6Jy2KnumX0WikunYFdx2eSeWS3XYUoK7JEVikxR4g77dkwIqXsxu5VnBWMh+K6iWTGsYG7A6D2mRzsXSUwzCMaeGoyFoLmP9YbodH4HO6OrPgcNF52IJInd0YNMka7aMqKYRyCPZ/F8ar+D+bFVHajgddo7dFdHk/L9mG5GDdWDwdgLg7FHQEBSeKXRqRkcm4hGlTz6WkYUrS/Ji/37BZd7Pn02U/D4iTQX74aqY/bBBnWosBQaa3ThetxQYfo+7gTG5q+8y/zWki77FNxQ3VhmVRSMxY0Ybrbms/Gp6LivOx7LTrKHVdg/xX1yLiOy3VDm3YhmtM5IyyHz2WAsuq/rQCo+5+I+fIeZ3T5PkbiwRFTMbZiOaysAlnIKy5wWkaJlJVGfRiPTYLGDQQRq4umnGKoSakXbDrOnq8RgldDOtxfOE/O7/I697JOZXaSfj26x7WY3nandgFktf2sDj4iPslCMac7lLQy4lzDaldviYDYqxskhWuJ4oUNh+Aa8kz+QQhIXjCbpkX2TBo29grGv4LzWcTY9I7off6K9Q0Ri56Rr+15GiCrJLkT3FETJ3srU8n4VjRo4yC/GPNaqtGUw9olJF+ejE9iNukWFh+AqBTZLTfhHVZcqo7a1zSXw0gvGYmb2Lay53YQTW6osc7YOxiIydTFFfFFUEQ1KdSP/YFV0WzD2WIgARo5vYJkGalVxDGE29bh1oSF77geZU7i9tXf4TRUawSc8mw4EdXW8Rcv/cUnUbdhp58hT2DCH80nTiVQxM4Ba6l6pq92bl3sR8tjADUjZfOVNW9RslV2UZ9VcHGF7M6/hMjFjuUiAlAqjON2Fn4HmyCUtt103EbVut0URKKtZSaxRYOfrjbR9ZUMQ92eZiFuYbbdTKtK6M2u+Sy/7pPX2Y31rvpz5+evZDDWvZWlF1fExs09R4GkpFGO6dEPYR1S9MBiLRor/LbnTjifg7XnRh3BMQc0Pausawwjnfsk2/AJ94VJbnlHt1o0dpjAJV6zb2qfOigUzmzHOLxj7vmDsv2vvdmZh/WEUDW2F3MGcelMmKj6WRKYmsu6j7kdX1Zlcxk3au6p6OMX52XXb7KkshXgFj7OrKGxvrHnPCYzmrvT7prCbx99LHf/BtP9C7o9oH3Uqa33HRbBYbgChVyfiUBaCZY+D4q/MLigFUdWz2YXfq1XOnYn10yiAyPb1vJGCYB8X/Q7G7l1Q5/sB7V1umdUKCokisVc0Fm9sehTfk18EITTWx01306YsXvir5uRinGh+8UyXjZsH/M2pWObSsmkuFD9lgmYhv+v5RQ05XK+qMpWD25SxdLkt6jglXQcKrLzBbUnmH9zNVJw52bGB5VXdKJRGZ7vdJz1uv50zgTqTx1bnOsEbpfPblFbwPXXHx+xs31SNnlw46KjiKAvFaJK7WtncV05GOYdCr813Qb0S0qObaO9g6ntSMPZDSFsHY1F7d1xdkb72DtNd5jDFHe/ml7ao0xoWnW5s7R2My5+jlFpbe1fZ5EAx9wOO80O94e+CsbDWwcG6UHuH6O86TGsWdXGXsSUn5RwQaxyx3fFvTqYBjzdpgOmBwg76hG6ixGW1cGNo725oUXuJesf38WS0jBN9qnic4qHwwk+Bh3neB9U0eOSg23Yn7d178xsLNhw9xGh7HUij38bf2prJ+//UomFl56TWtg2Lk7pi1WDE3yBBFBr75om8UPyBoz6/xd/bbynScU5UfO2e2js81hpGA+NFHRfsbi8+iygOcXzOQGSmTT1iIiqqwMUTzSvpBTcXoZ3oUiZUxomgGuG6oEbUrDQJhsL0obqudYoTrNesCdoWRcf5ppmgi+sQBdbMLNK6aVNhz+hbVT1eFE9XNohSr+jXPul1+/G43TQTqHNwHeCyb81ujK6siprzM/CeWQ1uwCCyD27gUNE55gZp8zRjxYoVg/mgGe0CbMHYDXkhiNEJnIiOQUSEIu7t9DpsE/GJs5wRAfwLa51wsZxfIOxO0N7t22J9n8gdHGu70C1dmw5C/STG42UPH6C9KxUDwdgzMnsVNJCUpvs4pu/05OLyPtr61E79YCfm9QUp/Qgahw7X3l2cjFdEDWfbOrK/05oH4nWtpMHm3dq7qskaPUERjDrVMoH2Yu3duG7SYCxEc9kcYkz+eX6Des+4rG15o5OnY/HDvIXH1KJ8ecHY93OiyNOy4/t8HnuNBG4wFqncfVmfO27MIlnO/Y/SirPLmp3YZIKbj7YcipRzl+9/iNONWhGM/Swj4Tj+Tb5/B0kw9lO82cR2QKTg3xiF2YUXhGcWvA2OBN/mTVrZsTvlQQSRqdKjkzTqvOxCvritLQ8v1gcnQmopf4NNZksPDdbp4bsfkgo0RqvmZN8JxIjd4m4bjRj9mp8I5U6tX7+31TD2ScV2i3oEx95Qu5wHpt9GVSiCYOzO7PJcM7kI38naurVbLg7REHgC/pRCc39Gqqoif1tp765tsJ7zGfWE6FN9EIqwkvl0C6GIkWhrNRSKEcxurr0jCcbu16AbVbFrdG90kfMH9oMuLYIu58nrdtZT1jV99AzqAEu63RGVO6lAOP+xIvoCYdu6sYmdxiiLWJVRzjvoz1n1ntVZt4h0JVwBflz3nprlISo8iyL/b4y8/YK1g1MGpm8RhbtEe7f9kNcF0dUXcF1WKkXgWD7sk7V4EcZNYZs50IIgTFFWDEi/dWVgOyi0d6gNuJTRm1cwVYm77RldRKu2o0h8JkXN2HzjClDID5Pvur3xvkwk9sog6htrhXYwFq8pFawZMEbfAKMAEYZnpAQRrzYgQlJYZjDBfIjHWC62ixpSdq0QiZgW1FX3Oy/+rQQA07+IOvYFTMepMHOeSuw1Kk0s2rtfwTqq4vl7azrBBUEQpm2NYgek3FBDp737rPbujRQkbfkSzKE5Zu/KhiIRzG7Y9Yraqm4psrSoi8S1jfB0OzMYEdfKRqKM/0hGH34pqwVrwjfUEGDaBTcgeQoSPpGb02oGzTy4IShKYS1nc0pqNySMIIzcvpbZiU65hCAIgjCJhWIBGAnXJr2GaOD/JHUFGL/Xhs80sOIoSo8+qQcRV/feNiP7QGt/NRiVc5RfWzp1Zuz6bes3Npg4egH0GHwJSx3+kQjfH3IfQUSelO0brC8i3ptr7z7RIPIsTBAo4QjGYhrQY8HYfwZjryjxwIzRxLMHUdYgCIIw2Zl0QpF1PG2E0g3au2iijdR1W57XIKqYTz5RLerzhiUuMOWjir2T7spuU9pntXxvmZ/hQEDHn/YO9aaG0cHz2FCFGtJ72GyDxo6vstMuzsKGyBSGBO2zruNNCoT8KixC/x6bzOLr8P9xHGQvE24EQRCmDSNdo1gE7TTadNTCPifSbQThXTX1TGX+jbVgNGEwK01Ma5Pu7RbMYYaVRZlQLevqVTSLvpHbBcX2KWPzn7V3vw7G/prG5k3YLNtfQ0F790dGoWMkWhht3lvifrAuy0duTG5+ECm/irOvBUEQhKkWUVRKbdzitSsyY+ELsuf/wce2Y/foH0qWg67EKio9F0eAshrKqo5v1HAVcRNnaiPV+jx6TsHe5aeM6uTu9E2MnSPYB4LQljhhqIhOmUow9jmsI1XJfwVBEISpFlFsKRQxISPt4jyJog61ZzdjSon2DmapHYKxaJSBEXLOj9TEgno++KdF0v/vB2XNL1Wp5U8zVZ9768G7aqyukkajVYao8HvD5JwmdGOnIwhlNzVgK3plHsuyiG9r764Z4LoJgiBMaiajUGzaJKLyNCYNpks9AbV3PwjG/jX7jLMbTpvopdP48Uwc1tnj5Cn0P3cpFNco60zW3v0mGLsRoy/7J+vUyLk/4UbafxQ1FuRiOR+vJghNOJ/G+UUcl/z//fDGHNA6CYIgTAkmY+r5Qp7w6wgUed0KPIjKXbV374KJdBeCu02n8aMt7W/y19fNDMaEkSIqBSlGvWnvMGYOkyy6qp9kDeRHakQv5gM/T3uH6R+C0ApGteFoUMVvOZ96aFNYBEEQJiOTTigi0qWUsrS5qDIoPqyBwBsHuyJj3d6p2rumvn5Pabj8HYKxmFyCuZEvTJ7Ku7jrurrz8XDdzpVu+j5EYeO4v9bzJbV3l1ZEck/U3h3MBhJB6AqO8nqTUuraLOJ+B/1AMdcd034EQRCEqSwUo0ef9u5MNqEUcUGX9hcYYRb5Xov3/bVh/d9CdkhDbH0+eTwXtL9rkKZtY3XTU3pce4casDgLdNdgbNl2rwJRxdMKHp8Ok0CEAYCZ4Nq7rVg6guk5q2rvNtLefQbuAsNeP0EQhMnIpBSKCfC2y0GTyh5tzY853PyK5KE2pt5FaeZxY96CsYg6plHEV1Ys776WEUVY3VQ1ppQ1x7RJj/8t6QC/OBiLSSaNYX0obEyOzJ56eZvlCEKTY0179zCPOUEQBGEaC8X1s39frZR6I2rr2iyEo/2+ki0PUzqaUiQq/72mjjH995Oz52DyXEWRKMQM6zLKGkkabSeK3NwiaA/VEoh37d0n+d6YHnwru1IFQRAEQRgxJrtQhOFzOtrvTV2mmGDg/YNsSkqb9OqYxU5FpOyRzMbjmhJRCS/Hn9V8Xm5ZUySacyPrIprWcB6aWNfcwm0TJ1y0hk0rO7MJ598YoazzqhQEQRAEYcBMSqGICGAw9hNJN+13lVI7au/azkAea5DBKDZ6NMI0Grye6egmYPpIzqxg7JiBNFPh30yev5TfZcOsk/gUjimsarjZqeCp15a8Hp3NuxQ8dR/nMZeCdHYwFhHAw/jQUZjYor37Tq9zcrV3FyZ1mthOtwdj/ycYm0dXBUEQBEEYEpNOKAZjd2cN3xE0z4YNzu79qEfS3qFDchul1Jf40NeDsR8PxtY1i8QRYTkfzf59ZOJbOCcY+0aagEfu4pSTQoKxH2G0sWgk3pHB2BuCse/IHn9rSafyDRWfMwMd2kyBw3gbHKG9O7zPdV8Lk/T3avSrLP3+giAIgiAMlkklFIOxGBl3RmbrAnuVqskM3RTCH8DZzqtR3N0TjMWc2CqhCMGas1swdotk2ejw3YrzkJF6vTyJBKK+8vXau6ommj1Zi/hIwR/84Uw6zozRx9QDselovb05UQWG2zH6+SnVZ9BwkERwI2/r9+cIgiAIgjA9JrNsXTBXuY2NTRswweFV7FTWmPAQjL0wHfkXQRo2GHt6QQQRad8zg7GbRgGovftFMHa2Uuo1Simknf+JEYHau9vqVkh7h9GDbTiipCnnDxSCZaSNKvi+B1I0t5k205R8vvazgrGrSMeqIAiCIAyfVadABLTtSLlKgrFrcsbxOox2RUsbpJ9RF4loYxFfYOo0t6JBk8ZZwdidovhhveL1/JsQgrG7Vow1W1hUzxmMXZWRw9clD6/NEXzLg7FIzcOE/Pg++tLl3eFxW7cySxcGTzAWdlJzlFJztXdXDnt9hPEEY+ez7ORgZDC0d4vVJIQ31vP4t0R7t3Py3MEsYTmEpuuCIExzoVjU5LEupy80hoLoRRQkP4edTjD2aRRJCyrmSe8fjH22UmqfPEWsvXsgGIu5yPjLQb3fScHY9w8iUhaMfQsimSVP/xLp+oL3rMWmoNghvYKTb5AuX5WRyY359+Fg7J6Mhh7Di9EDSqlvKaU+13QiDm2Jtkw+DxFY+N8NTSQGY3HRwcWniKO1d3Wj4oTREhf5vlxMsXF0MPb8VHRMQZF4SsvtdWvLj1mmvcON5IQRjJ2VrRfGNY4cwdiZJe4XkdZCveZchGN403ZrWfk5uOHDMRDBjd+VU/13IjRjxooVrXypu2bGjMqxwo0Ixu7IzmGIrRmMMJ6hvXt3w/fjPWgIOYTp5M7DSqmPM20Mi5nHOdnlOtb9PZl1f29OLG9wsprDGrt0+auxXrHsB3wO6gy1dxBYEwKbWc4s8VpEp/IrORs33y5XM5KIKTOfY/f1uLF6wdjNGKXEflB87ZO4zS6mWEQH+RcbrusJTPFfwos66jWfqL3Dv4dKdpKe1tEKbguI5L5G7ycKXNh4POFit1h7tyh57mA+h4viUu1dla3UpCcYC/Eys06oUCgiQrwgfV0wFiJtdv4bSH4faw/iuAjGQvTO5/4cWdGSCFts8yWMti/r03fv67koicYu4+873b/z+TuBgFSD2s9COwal3yZbRBHeg++nZ+JT2bm7ZzD2PO0domFN/BIh/j6olHo1l6WTzmMs753au3sL3vuJYCxmyZ7ME+c5FI95reI8Tod5RsEydlNKPScYu4v2Lq/N6wnU9bEmMVrZFIGI5pKSmkSIRKzT1to7RB1XQnsHD8WdgrFIsf9PEnmFyfm1LdbVsJsaTTMreHH6WzYZZ9gsToTipEzZ9TFSgovG0ZMsHV4Y/eXF8Gi+Lo2gTHdmcZs1OtaxbSmKBsWkECnau6XB2E4ggRG5fqz34kQojt309EIi9AvFLG+uFiWvmzWq0Vxh4plUXc/au6C9OxlpXu3dXexIRjTswmDs4cHY19S8/0GYPWvvvqG9208p9V/J09/mD+beivdfxqgXopBvor1N/prfKqXeUjL/WVGQ/Zjp4b4QjEUa/doakYiU8Kklz8WI7P5lIjFFe3d8Mkt7WUuReDztjWIX+Q/ZDT7KTIqL1ASxMB9HOaow8hIv0HUlAiMblRoSS7q4IZoUNw9T4HzR7zr8+clNMG7SS5fP35EIxGnOpBKKBSBFrNhAgtrA64OxVTOUc27ifx+hF2OlATWgkIw+i7uUvOZmPldmSo1GmYvQRR2MRc1fVwRj1w3GYl1uY4S0DLzm8IrnX93AMifnCH6/JwdjV2+4vnhdbmKOOkhhBGE0IUYyRhpG8uc3FTC8OCJiMilE8CAiYfhr+R7UyU3nm6jJShSJuKFqIgIRXRxk9FgYMSZb6nkc2rv7g7F/Zho6smciAOuIY+MubDkf+ucVo/TiumEs3ZvZ4IFO6iLeylnHl9Ef8oq6Ey/TtttQiL6hwT48CkbZNXOcUc/4WJttoL3zwdgbGSF9u1LqvAZv+2BBSj56NU42ATWb0au1KVBih+lS1oN1TsBMz82PtT4oQM/qH6/k65eV1BDhb2by2kUxPUhxhHq8wiL3gufH6tQKCuXzZcc6v8hDwdixGilGJbAN5hfVv7HmLRbJg44wyyN9/I5xG8Uo39j2YsSjSbotruvSph3YZVFHfrf4/cCV/N497VOK0lx857V/+faYxfcsZcYDqc34WLp/FnNZrcRer+Tbgut8PrfdWPq/7nirOXaw/5dVNCzNT4+tHvZPvl2XcrlTJnLKc0IUfU1/J31JdwuTl0kdUQzGwnwaQidl12DssxouIs4rbmtTUzeppQMvWJuz07iKN9F2JgRjcSG4Ihh7Bpo9grHolj47GHt1MPZ3TNuiWeXNNSIR0b69q0Qi1/EvSqm/MDI4TvgGY/8tGIu6zjJQswhq0+jB2FexSSbyJwruF7UYlTh0WNt2cHIROyVpiljAk3Aqzm7l63FRm8n0KC4+KJlYxOWcUlFrtylfC/EHoXE+xYTiRRafG8UBCv3HGqn4fPz33EQE3soLaVz2IXE9YoSNDQNpUxaK2WdQJOLz0wL7fN2xP29lxGJG8l0PxmfHz0iK6eNyOmJbezeX32sZ16lJLWHcHz2lyRJBsYDrvYDLviJZj9b7NO3e5etwg4Hzw0KK8rLtgX0GoTKLnxWXMyvuE76m6KZhEIzbFlyPnXlMzmp6vBU01XS2E18f62Tz18XPzqPC3e4ffC7+uz5fu4T7Z0XyN9kj0OlvSVLKwtQXikw3IxX8Q6VUtKuBzc33GHmrI47CK7wLD8a+GkbawVg0oaRsy//eWfcB2rtfUSye22B9cHJ6Pk9ke7Ij+H1Ii3OiC6x5mvAb2M5o72AC3oSr+F+MK+y0pwdj38vmlgeDsXEmc06ciFM5n5lNQGg2wqQYzwjkTBqIIw3/vhpBOjJQxOAvMtYAwDvvZZzzHaMZEARjkSvtHQRIPN4WZSInj1juHF/LaNbOXD4uXp0TPp+vinjMpoDsRA+4XrHjt3OhYMQEy5mZr0vJNsB3nlES5ZnJi/C4LkpGexbxs08pWU7HjiP5XjHiUblO3BbxAl4aUYMQyy766d9sCtyD0+gh9ynWKX6vrvYpRRzqeRckqe+4P+fhswu2B6LD2E+HUDRhneZxXdJGibguswctZLJtMZOCrHPjhJuNNscb1/18vnbsN8ablrzZYgm31UpRsS73z0KKxM76F3xuR+ROgVR7mkKe7N9FGBCTVigGY19Lm5zna+9QlwihsYBNJBuzYWSlZpMSX8Yi8+kNeIe5F2c+fwUTVnjXHyeXfL3JusJzUXsHsblrjddWP/iaUmoT7R3Ec1NwklRsMLmDEYCvJCnzjwZjO3nHDAg/8GiZXyW9Jb/DyC/211bau29r7zrbnhZDexQYlTcCAjMY+65gLDwudwjGlnlg9pP0BJsLk/jvogv2srLXJlG2GD1Zqf6LF7CYqhuLsFDMLKXgyGuJYlQqgov1soL17tdFI0Z4itJaUTgWrWfbbVlG6WsTIZYK60WZCFtWkA5dmgixWV3s09lRsGfrsyx5f5EYLor4LC343FG54EPg5evS5niL5RtFTTVladK67167f2oi0o1uVgRhKjOUGsVgLKZxPAe+ez3YxKABZT9OOcFJ9+8sTocY+SonflzOZo9DSxpV4PuHu8+1S8YFpqLjvfyLnKO9a5WyRrd1MBYdwicwqtZP7kFkTnuH+dGtgKgMxh7K1PDYrOjsZFs0y9omEcxxsAP9OKXUy5KHkeJeaS53j13Pe9L0O3JfMHbnlkJ5lMAFaWbFBXBJyYUr2vngYntIGmlLhQ8v5GPHO298crPdXtdfFa0/6+tiShKv61ftU/pZs1paH6UCJKYqq8zJuonYxW2LSPDCXpbLfTmjwCx5JGl5vKW1gTmDEsOTPbVcx6jcVAiTiCcMWiAGY2FkDSPnn0Coddv1q737GcVhTm5mvT9qBGnWnRNTx6mYiSyuSC1/K6lvbAynv0CIYRv0u+gcAvndEHwQaU07kSPaO1xwdi7oQr6WUcC88BvHzuv5z04NJtLWwdit0c3Nus98uz4tWgPFFHcf+L+CST2XBWNxIzIZqRM6S0ouaFF0pbVcnSL/ijTsQ7xod6aVqOGuf9cw0joW9ethUR2BHmvjSv662U7xu8YUctFfY7seRMJQd0dBi+098tOCGh5v8dgZaEMOiTdTueiuLWmYZKTfQ3xEhdESisFYpCkxcQMp48iMuvq2Fst/SjD2s4wm5qyHiS4wQg3G7sXRceB2/vdt+RsojCB09uV6QzCh5m9b7d1OTax0uF6WHo/XMSr3fdrVzKoQfI/wLzBSmP6VgeXhYnMURdrDwdgLgrF7cH51o2iF9g4p9w3Yzbyu9g4i8WclHdtRjJlg7NEUjN9now1qEg9nlGBr1nWi5vJm1mtCvC8Ixva0/7V3Z/Lkjs7xyFoVo69GnWUNT+JLStLSM3lRjo0FiwpERiz2R+3W3D53NXa1/n0gfofO9+9hObFhpJAeawCrltvIfoRR4ru5fTt1gKPclNDl8TYMK5boFzg/Ntex+z36ci6eoG2zsM/LRNS6avulHeQjG4kWpm/q+ePJHGGA2rTPdzFftMjeZV+O4HuMJtpXUVT9jVGsl1C8vINiDylqWOjEFNPL0HBBQ+0xtHd/ZZr4hJbr9GR+FqKORb6Of2W0cinFIITcXKZosE4fyc2xOXkF69EphmfH8AWMqOHihU7v5zEdbJk2fxv//grRiLrDJubY2jtX5W/I7/ffyUMLk1pFCMYvVpQUoItbMyqLKTc4sWGfnMjPbY32Dvv7qmDsNjROX3MSnwRjKhQNMbMLIlipVU5O7H6NKbyiyRCxG7TxFI6WYL3iBXZRRdSukTVHU9iNHUfz4WKP2sO2abY4UaMjavIn2XDSzTZbktRmYrsXRac6DR8NlnUKt2HZckaNNsdb3P4r1XNONDhWcMzE7nFaQS2b4PGd+J30ex/inLG0wffsjLIsOceMg8Kz02zV53UVJgmDFIrvSWxbEGk6idYsXRGMfa5S6kNKqX0oBjHx46Pau7wx5WGKRqQjP8qGko+hKzh7HcTjpr2M1mOn9X6sZUwjD79ghO16CjwUfS/P3rsGRS7W7atIHWvvOqMFmaY9id8V6fYPVd2VU8htxqjgWzij+p34C8b+jOP3zmnpHZkKVjTMpM0tj3L7H6O9W6kGsWjCDj0m4cP4UqXUASgRCMZ+l2L4uxiH2HbdtHffD8aew07x1FuzV6pqBvsK6/ii4MPJPE9Jzon+bgXvXcwawNlJhDknRhuafJ9uvjPWa37RRYjRuI5oUBPDzonFCS72hf6UFUTrFAjNWZl3YvQ3bC1gIIo51q1j6UKx2NkG/JxTWqSP2+y/UaDN+l6ZbP98tvjMiawhZPRwITume6V2HZOmtbn9WF5yjC5tOH4x+sCihGHMXaFgmdh/B8dufWF6MsgaxWjtcpr27vPdiESIlGDs9sHYi9lAcSBF4je1dxBPK3Uvp+B5pio3poBKGx4g8q6kAG27XohIfo3r9LFkIPyBTN9uqL07kN2+LheJXLdHtXcHMT0LTkzqKg+kSERaevu61A0EoPbuGu3dp7V3s2m580mlFMYL/gc7mmGY/fncO7Hme2qm4d+WRRDXo4VHrUhM15GRYHAq/x/eedi399ND8pVd1DJunHk8dksakZxX8dzs7KQ6q+A1c0o6LeeV/D9Oyp0u3OixlxlwY1uXXXjjsVEWtUujW5314WfMSiKZSF3HyMRYKhlWJzGtm1nSjKW6KKyi6Dk/SeNFf8klmcH0nKLlZNutUXSY6zs3ERx356m9bIJLZzsl71+c2afcGu1zCuZdt92n0WqlY7qdLPdubpMlBdtjZsX+m5/sh9QTEPup8+8sBdm6Ho3LLjqec+Y0WN8mx9vR3HczU9/KpAGm81ncdnOy75V/v7b7p9OtX2GfhPWpTYnzNWXrFF8zL/GKXBrfhxpO/uWfk65n2TKxz3GspzdmnTrWeDyk0H4I27pTysCU9cyCtPgpIhKFGStWVDX49Y+H1t3gN6wVxKzlaC/TiGDsCzmP+F0UnPhxfVkp9SpOKHlpSR1dk2Uj6oaO32ilg5M5BNsZ2rt/VrwP0djtGNXcJnnvWUip0j+xK4Kxx3G5EGI7crQemlMg/D7Vw3KfwHrB97DrGnWjK2hfg4jg92IXefa+p3L7Q2xqmmWf1DSCWLE+azDi+ynt3WcpCjFOcA9eWFFr+BvaEJ2lvft1zfL2ZbR0OX0kf9DFOuUTJFKOLunYXMxjsmltHITUvKLlpE0NBevSMV+uShXxZH937mOYvSadutKZ6MF/xwvNWJqQkZZ4oYlTWYq20dhEmEyQzSmbclGyHPyGFpSYRyPi36geL01DFwiYTjNFxfaJ3eOz8qkn3L4PdbNP6yZ/VBx7Y987iUDG7dqZfpIYtF/J7Rf3Z8qyJhGzxMy6iHTyT9m2yI/jxsdbZjzeWefExzI2Z8VjoOgYWbub/RMjijXRu3HHeErFtqhiURRhqSE79/fSmnNRGesn4jOa4o99TsF6z4tR3Oypxdw2Ay0BENoxKP02SKF4EH/wiPptrr3DfOI6EbErvf0gCCFIvomUqVLqBgiaYOwnKDKQDu0JRAX5o9xJKbUKJ6Ag8va/6bqyS3sX2rJEU2+IwmMpgv/Wh3WBMFtKb0iIniewueXZrJvsmWDs2hR/72ckDzieiJESRvp6Q55EXk+fQ5ibH8daxz81+IwZFKVv5fsh9C5IzJ9XpX3LgwXvXY2fuztFLWoub6JoxD65LzlOYEb+4SSNA9skCEZBEIRaomCqEFRRSEKITZa0vzDFWTEFhSJEweW8+CPt/GkKDgigVFhsysjhHkwrX8W6tUuK6tbQzBLT2Bg5R+HzdtqkQFSh7u2gEiudsjrD9zPVCy9GgHX8GecUI7oZuY4NOd8pisT1Av0fIX4ip2vvIJr7CqOMSMMfVNJ480/ut9OQFq6KshYs+82MVuZcipsAGJE3XA4E8ymZ9yTu3v/OfRJLKFCLuq/2DulxQRCEWpJoXqUIRNQ2nRgjCMNmygnFGTNmxCaLkygEAUTHT1GTxjToJuzeVayney87WmvhfGekXzYqePoN2rtOTUhT6EP4JqZ+t2caNHItTbwR4eoaCuMnaO/+VfDcbtnkFwiglbqvg7EvwvGivasdJ9hgfeYw6ovml7EuRE5P6WZ5SOeXGYBfpL3boeX++AP3wwMU7qvw79e8Ibi4myYYQRCmL0zbz65Ky/PcOKvPVlKC0BOD0m8DNdxmk8We9FKEJcpttHR5M332okj8E9PTjUQiWVwiElU3Y/MQgdTeXaSUOpI2O4rp4O3pLdirSPwklwvrGjTA5OTicaWUdjD2WHoX/oqj8nqCKeFN2TX8KOt5Pss0cNn3WDMYuyVtinKuZu3jzUzPpx3lbw3GbtFyFSGsEYV8gfZuW3qybcNZrkhpi0gUBKEtnQYa+D0WeXCyVlBEojBtGWhEsQpGG+F3+COKAd30wg+hwihfFFj44f+e4upG7d1ZBe95FevfPlM2Qo5dxzg54E6zahRgKzg15N5EqP9Ae/ea7DVfoG1M5Djt3Yez11yeNOGglvEZsJ7pdf2SdMwlnCTzS0Y0v1/wuqcw+vswZ0z/pUEtUCxCP0J7918N1uWJTD3vyfrU1LRdEAShJ9jAM7+gqeNoNoNMBs9KYZqxYkD6bSiznivsUnBHdwebKD6NiSYNa//QyRtFIqJ9NzRIU0NM3kVBWSTkTmATBthbe4cIaL/YJIvmjmsM4SSVmJ4/j0098ED8eFbXl05qeQLrJ9GI0jPsutuKoxZfTEPr8+lVeV/yur9wZB+aVpBK/lrNcuH1dzHT+ahBbcKFjDiPjQsUBEHoF+wqRyOLWMEIwjBTzw2JzQ+wrIGgaEK0NLi0TiSSN7CL9vrU0xBduMFYNLLckYjE0/ssEov4Q1aLdyZtaJbQKPs6/vscdvmOvXwihb/2DjO5O6bfjPLC8uKuYOyXo9cXo33RixGNJU2IE3Caju+7kaIYhuV9HXklCIIgCMIkiCgmIOW6Iy1bmjZRxChbpeVOQf0fonSXsjt6M0bFXkBrnGsoFh+meFujj7YIucfia4KxH+T+wDpszI5e1N4tD8buw5T8dhRq57KhI/WjXM4IaV8IxmJmNKK50Q8NaXBPAY/pM/sFYz2bS2J9IoRcE6LYbeQ1qb1DnSj+BEEQBEGYzkIRI/SCsS+gvc1KaeESYjoy2tk0iWjFKQkQihF8HgTbV5VSW1AoHsDHliXNNj2hvYMT/k2JHY1l00cqZN8dTXa1dxCHOzAFuw5mQRcs9kztXdPt1QQYfqcNKndp7yAEvxuMRT3lwRSuEdRcruSHWFKLGtM73+vj+gqCIAiCMA1SzxBGy7V399SN5MuEHyJwOwVjm6Q/MV84nShyN8XL87R3J9Jz8fpkDNzq2bi/frAHLV3SGswV/FxMFYGx+Bjau6s5fu/0LOX8O0bb0KncT17NBhJ0k+9FkRjXBQ0l27P5CP6K2F4YfQhBe2ow9rWcCT2OYOx6/M6WZQK393mdBUEQBEGYil3PvRKMRXfyPkxnojv4quhPSNGyARsidk/GOEEIHstZ0SvNX+b7kAbGcm7vt6l20rgSR4Xd0zS9zfct72Zmdr8Jxj6TM6qRNkcjEPgLvQ5R54judcP0/ip8HP6MtRFIQRAEQRCmieH2REKblssZCVMUJ7A0wLSWZ7B5JZp8I4X7Re1dXzqEhXHCeg4nvWD+9QuyqDUit2dxRjS63AVBEARB6AIRil3A2cF7sFN4Q9YUPs6uYpg+wwcQxsyIcgkTDEcqxrrOh5rMhxYEQRAEYRoKRUEQBEEQBGFyMZLNLIIgCIIgCMLwEaEoCIIgCIIgFCJCURAEQRAEQShEhKIgCIIgCIJQiAhFQRAEQRAEoRARioIgCIIgCEIhIhQFQRAEQRCEQkQoCoIgCIIgCIWIUBQEQRAEQRAKEaEoCIIgCIIgFCJCURAEQRAEQShEhKIgCIIgCIJQiAhFQRAEQRAEoRARioIgCIIgCEIhIhQFQRAEQRCEQkQoCoIgCIIgCIWIUBQEQRAEQRAKEaEoCIIgCIIgFCJCURAEQRAEQShEhKIgCIIgCIJQiAhFQRAEQRAEoRARioIgCIIgCEIhIhQFQRAEQRAEVcT/A1r2w+6b1fFqAAAAAElFTkSuQmCC';

  // Plan-specific legal text for the printed certificate, ported verbatim
  // from the legacy Apps Script prototype's VAS_PLAN_CONTENT
  // (docs/index.html) -- keyed by VAS_CALC_PLANS' plan key ('ew1'/'ew2'/
  // 'di1'/'premium') instead of the legacy's numeric priceCol (1-4), since
  // this system already looks plans up by key everywhere else.
  const VAS_PLAN_CONTENT = {
    ew1: {
      cover:
        "If the appliance fails to operate due to any sudden and unforeseen mechanical or electrical breakdown after the expiry of the manufacturer's warranty and during the Plan Period, Jacky's Service will repair it free of charge (parts & labour). Repairs are carried out only by Jacky's nominated authorized service centres; in-home service is provided for all large appliances when necessary. If, in our discretion, the appliance cannot be repaired economically, it is treated as a total loss and compensated per Basis of Claim Settlement.",
      ex4: 'Any defect caused by improper usage, negligence, or damage sustained during transit or transportation.',
      ex8: 'Cosmetic damage to paintwork, dents or scratches, and any physical or liquid damage.',
      ex11: "Claims occurring during the first year of purchase or during the manufacturer's warranty period, which are the responsibility of the manufacturer.",
    },
    ew2: {
      cover:
        "If the appliance fails to operate due to any sudden and unforeseen mechanical or electrical breakdown after the expiry of the manufacturer's warranty and during the Plan Period, Jacky's Service will repair it free of charge (parts & labour). Repairs are carried out only by Jacky's nominated authorized service centres; in-home service is provided for all large appliances when necessary. If, in our discretion, the appliance cannot be repaired economically, it is treated as a total loss and compensated per Basis of Claim Settlement.",
      ex4: 'Any defect caused by improper usage, negligence, or damage sustained during transit or transportation.',
      ex8: 'Cosmetic damage to paintwork, dents or scratches, and any physical or liquid damage.',
      ex11: "Claims occurring during the first year of purchase or during the manufacturer's warranty period, which are the responsibility of the manufacturer.",
    },
    di1: {
      cover:
        "If the appliance suffers sudden and unexpected accidental damage, including liquid damage, during the Plan Period, Jacky's Service will repair it free of cost (a fixed service fee per claim applies). Maximum 1 claim per Plan Period. If, in our discretion, the appliance cannot be repaired economically, it is treated as a total loss and compensated per Basis of Claim Settlement.",
      ex4: 'Damage caused deliberately, by improper usage, or by negligence, or damage sustained during transit or transportation.',
      ex8: "Cosmetic damage only — dents, scratches or discolouration that do not affect the appliance's function.",
      ex11: 'Any breakdown (mechanical or electrical failure) — this plan covers accidental damage only, not breakdown.',
    },
    premium: {
      cover:
        "On reporting a fault, Jacky's Service guarantees a service visit within 24 hours, with priority handling and priority parts sourcing. Manufacturer's warranty is retained and unaffected. No limit on the number of service visits requested during the Plan Period. Repairs are carried out only by Jacky's nominated authorized service centres.",
      ex4: 'Any defect caused by improper usage, negligence, or damage sustained during transit or transportation.',
      ex8: 'Cosmetic damage to paintwork, dents or scratches, and any physical or liquid damage.',
      ex11: "Claims occurring during the manufacturer's warranty period remain the manufacturer's responsibility.",
    },
  };
  const VAS_EX_COMMON = [
    'Loss or damage caused by wear and tear or normal deterioration, or by fire or theft accidents.',
    'Accessories used in or with the appliance, consumables and batteries, cables and remote controls.',
    'Routine maintenance and cleaning, corrosion, rust, or stains.',
    null, // ex4 -- plan-specific
    'Any appliance whose serial number or model number has been tampered with or removed.',
    'Any appliance used for commercial or rental purposes.',
    "Repairs carried out without prior approval from Jacky's Service, or repairs performed by unauthorised third parties.",
    null, // ex8 -- plan-specific
    'Loss or damage to recording media, software or data, software defects or software-generated problems.',
    "Any used appliance, or any appliance that did not have a manufacturer's warranty at the time of purchase.",
    null, // ex11 -- plan-specific
  ];

  function vasCertificateExclusions(planKey) {
    const content = VAS_PLAN_CONTENT[planKey] || VAS_PLAN_CONTENT.ew1;
    return [
      VAS_EX_COMMON[0],
      VAS_EX_COMMON[1],
      VAS_EX_COMMON[2],
      content.ex4,
      VAS_EX_COMMON[4],
      VAS_EX_COMMON[5],
      VAS_EX_COMMON[6],
      content.ex8,
      VAS_EX_COMMON[8],
      VAS_EX_COMMON[9],
      content.ex11,
    ];
  }

  function renderVasCalc(container, data) {
    const bands = data.vas_price_bands;
    const params = data.vas_pricing_params;
    container.innerHTML =
      '<div class="card-help"><span>About this section</span>' +
      tipHtml(
        'Enter the appliance selling price and pick a plan to see the customer-facing quote. Switch to "VAS Issued" to find and reprint any previously saved sale.',
      ) +
      '</div>' +
      '<div class="vc-tab-nav" role="tablist" aria-label="VAS Quote Calculator sections">' +
      '<button type="button" class="action-tab active" data-vc-tab="quote" role="tab" aria-selected="true">Quote Calculator</button>' +
      '<button type="button" class="action-tab" data-vc-tab="issued" role="tab" aria-selected="false">VAS Issued</button>' +
      '</div>' +
      '<div class="vc-tab-panels">' +
      '<section data-vc-panel="quote">' +
      '<div class="field-grid">' +
      calcField(
        'Appliance selling price (AED)',
        '<input type="number" min="0" step="0.01" placeholder="e.g. 1000" data-vc-order-value />',
      ) +
      calcField(
        'Plan',
        '<select data-vc-plan>' +
          VAS_CALC_PLANS.map(
            (p) => '<option value="' + p.key + '">' + escapeHtml(p.label) + '</option>',
          ).join('') +
          '</select>',
      ) +
      '</div>' +
      '<p><button type="button" class="button button-outline" data-vc-clear>Clear</button></p>' +
      '<div data-vc-output></div>' +
      '<h4 style="margin-top: 1.5rem">Quick Price — All 4 Plans at Once ' +
      tipHtml('Same selling price above, every plan’s fee side by side.') +
      '</h4>' +
      '<div data-vc-quick></div>' +
      '<h4 style="margin-top: 1.5rem">Issue a VAS Sale — Customer Certificate</h4>' +
      '<div data-vc-sale></div>' +
      '</section>' +
      '<section data-vc-panel="issued" hidden>' +
      '<h4>VAS Issued ' +
      tipHtml(
        'Every VAS sale saved from the calculator above. Print re-opens that exact certificate.',
      ) +
      '</h4>' +
      '<div data-vc-issued></div>' +
      '</section>' +
      '</div>';

    const tabNav = container.querySelector('.vc-tab-nav');
    const panels = Array.from(container.querySelectorAll('[data-vc-panel]'));
    const issuedHost = container.querySelector('[data-vc-issued]');
    tabNav.addEventListener('click', (event) => {
      const button = event.target.closest('.action-tab');
      if (!button) return;
      const target = button.dataset.vcTab;
      tabNav.querySelectorAll('.action-tab').forEach((tab) => {
        const active = tab === button;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      panels.forEach((panel) => {
        panel.hidden = panel.dataset.vcPanel !== target;
      });
      if (target === 'issued') {
        loadVasIssuedList(issuedHost, params);
      }
    });

    const orderValueInput = container.querySelector('[data-vc-order-value]');
    const planSelect = container.querySelector('[data-vc-plan]');
    const output = container.querySelector('[data-vc-output]');
    const quickHost = container.querySelector('[data-vc-quick]');
    const saleHost = container.querySelector('[data-vc-sale]');
    const clearButton = container.querySelector('[data-vc-clear]');

    function recompute() {
      if (!orderValueInput.value.trim()) {
        output.innerHTML = '';
        quickHost.innerHTML = '';
        return;
      }
      const orderValue = parseNumber(orderValueInput.value);
      const plan = VAS_CALC_PLANS.find((p) => p.key === planSelect.value) || VAS_CALC_PLANS[0];
      const band =
        bands.find((b) => orderValue >= b.start && orderValue <= b.end) || bands[bands.length - 1];
      const fee = vasCalcFee(plan, params, band);
      const serviceFee = vasCalcServiceFeeText(plan, params, orderValue);
      const claims = params[plan.claimsKey];
      const coverage = params[plan.coverageKey];
      const deductible = params[plan.deductibleKey] || 0;

      output.innerHTML =
        '<div class="vas-quote-card">' +
        '<div class="vas-quote-head">' +
        '<div class="fee">' +
        money(fee) +
        ' AED</div>' +
        '<div class="sub">' +
        escapeHtml(plan.label) +
        ' — band ' +
        escapeHtml(band.label) +
        '</div>' +
        '</div>' +
        '<div class="vas-quote-body">' +
        '<div class="vas-quote-row"><span class="k">Selling price</span><span class="v">' +
        money(orderValue) +
        ' AED</span></div>' +
        '<div class="vas-quote-row"><span class="k">Deductible per claim</span><span class="v">' +
        money(deductible) +
        ' AED</span></div>' +
        '<div class="vas-quote-row"><span class="k">Service fee per claim</span><span class="v">' +
        escapeHtml(String(serviceFee)) +
        '</span></div>' +
        '<div class="vas-quote-row"><span class="k">Claims allowed</span><span class="v">' +
        escapeHtml(claims) +
        '</span></div>' +
        '<div class="vas-quote-row"><span class="k">Coverage &amp; terms</span><span class="v">' +
        escapeHtml(coverage) +
        '</span></div>' +
        '</div>' +
        '</div>';

      quickHost.innerHTML =
        '<div class="table-wrap"><table><thead><tr>' +
        '<th>Plan</th><th>Plan fee</th><th>Service fee</th><th>Claims allowed</th>' +
        '</tr></thead><tbody>' +
        VAS_CALC_PLANS.map((p) => {
          const planFee = vasCalcFee(p, params, band);
          const planServiceFee = vasCalcServiceFeeText(p, params, orderValue);
          return (
            '<tr><td>' +
            escapeHtml(p.label) +
            '</td><td><strong>' +
            money(planFee) +
            ' AED</strong></td><td>' +
            escapeHtml(String(planServiceFee)) +
            '</td><td>' +
            escapeHtml(params[p.claimsKey]) +
            '</td></tr>'
          );
        }).join('') +
        '</tbody></table></div>' +
        '<p class="form-note">Value band: ' +
        escapeHtml(band.label) +
        '</p>';
    }

    // Resets the calculator's own inputs back to their defaults -- used by
    // the explicit Clear button and automatically once a VAS sale has been
    // saved, so the next customer starts from a blank slate (modification.md
    // #36, issues 1 & 3).
    function resetCalculatorInputs() {
      orderValueInput.value = '';
      planSelect.value = VAS_CALC_PLANS[0].key;
      recompute();
    }

    clearButton.addEventListener('click', resetCalculatorInputs);
    orderValueInput.addEventListener('input', recompute);
    planSelect.addEventListener('change', recompute);
    recompute();
    renderVasSaleSection(
      saleHost,
      VAS_CALC_PLANS,
      planSelect,
      orderValueInput,
      params,
      bands,
      resetCalculatorInputs,
      () => {
        // Keep the VAS Issued list in sync if it's the tab currently open.
        const issuedPanel = container.querySelector('[data-vc-panel="issued"]');
        if (issuedPanel && !issuedPanel.hidden) loadVasIssuedList(issuedHost, params);
      },
    );
  }

  // Lists every saved vas_sales record (modification.md #36, issue 2) so a
  // previously issued VAS sale can be found again and its certificate
  // reprinted, without anywhere else in the portal to look it up.
  async function loadVasIssuedList(host, params) {
    if (!hasPermission('vas_sale.read')) {
      host.innerHTML =
        '<p class="form-note">You don\'t have permission to view issued VAS sales.</p>';
      return;
    }
    host.innerHTML = '<p class="form-note">Loading issued VAS sales&hellip;</p>';
    try {
      const response = await apiRequest('/api/vas-sales?pageSize=100');
      const sales = response.vasSales || [];
      if (!sales.length) {
        host.innerHTML = '<p class="form-note">No VAS sales issued yet.</p>';
        return;
      }
      host.innerHTML =
        '<div class="table-wrap"><table><thead><tr>' +
        '<th>Reference</th><th>Issued</th><th>Customer</th><th>Plan</th><th>Selling price</th><th>Plan fee</th><th></th>' +
        '</tr></thead><tbody>' +
        sales
          .map(
            (sale) =>
              '<tr>' +
              '<td>' +
              escapeHtml(sale.vasSaleReference) +
              '</td><td>' +
              escapeHtml(formatDate(sale.createdAt)) +
              '</td><td>' +
              escapeHtml(sale.customerName || '—') +
              '</td><td>' +
              escapeHtml(sale.vasProduct) +
              '</td><td>' +
              money(sale.sellingPrice) +
              ' AED</td><td>' +
              money(sale.planFee) +
              ' AED</td><td>' +
              '<button type="button" class="button button-outline" data-vc-reprint="' +
              escapeHtml(sale.id) +
              '">Print</button>' +
              '</td></tr>',
          )
          .join('') +
        '</tbody></table></div>';
      host.querySelectorAll('[data-vc-reprint]').forEach((button) => {
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            const detail = await apiRequest('/api/vas-sales/' + button.dataset.vcReprint);
            printVasSaleCertificate(detail.vasSale, [
              params.depreciationYear1,
              params.depreciationYear2,
              params.depreciationYear3,
            ]);
          } catch (error) {
            setMessage(
              '#workspaceMessage',
              'Could not load this VAS sale: ' + (error.message || 'unknown error'),
            );
          } finally {
            button.disabled = false;
          }
        });
      });
    } catch (error) {
      host.innerHTML = '<p class="form-note">Could not load issued VAS sales.</p>';
    }
  }

  // Fills in the "Issue a VAS Sale -- Customer Certificate" section (#35):
  // reads whichever plan/selling price is currently selected in the
  // calculator above, saves a normalized vas_sales record via the API, then
  // enables printing that saved record's certificate. Gated separately from
  // the read-only quote calculator above it -- a pricing_config.read user
  // can look up quotes without being able to issue a sale. After a
  // successful save, the customer/appliance fields and the calculator's own
  // inputs are cleared automatically for the next sale (modification.md #36,
  // issue 3) -- the Print button stays enabled against the just-saved
  // record, and onSaved() refreshes the "VAS Issued" tab if it's open.
  function renderVasSaleSection(
    saleHost,
    plans,
    planSelect,
    orderValueInput,
    params,
    bands,
    resetCalculatorInputs,
    onSaved,
  ) {
    if (!hasPermission('vas_sale.write')) {
      saleHost.innerHTML =
        '<p class="form-note">You don\'t have permission to issue VAS sales.</p>';
      return;
    }
    saleHost.innerHTML =
      '<div class="card-help"><span>About this section</span>' +
      tipHtml(
        'Uses the plan and selling price selected above. Fill in the customer &amp; appliance details, save the sale, then print the certificate.',
      ) +
      '</div>' +
      '<div class="field-grid">' +
      calcField('Customer name', '<input type="text" data-vs-customer-name />') +
      calcField('Contact number', '<input type="text" data-vs-contact-number />') +
      calcField('Address / Emirates', '<input type="text" data-vs-address />') +
      calcField('Invoice number', '<input type="text" data-vs-invoice-number />') +
      calcField('Purchase date', '<input type="date" data-vs-purchase-date />') +
      calcField('Item code', '<input type="text" data-vs-item-code />') +
      calcField('Item description', '<input type="text" data-vs-item-description />') +
      calcField(
        'Contract ref.',
        '<input type="text" data-vs-contract-ref />',
        'Optional — auto-generated if left blank',
      ) +
      '</div>' +
      '<p>' +
      '<button type="button" class="button button-primary" data-vs-save>Save VAS sale</button> ' +
      '<button type="button" class="button button-outline" data-vs-print disabled>Print certificate</button>' +
      '</p>' +
      '<div data-vs-message></div>';

    const saveButton = saleHost.querySelector('[data-vs-save]');
    const printButton = saleHost.querySelector('[data-vs-print]');
    const vsCode = saleHost.querySelector('[data-vs-item-code]');
    const vsDesc = saleHost.querySelector('[data-vs-item-description]');
    attachItemPicker({ model: vsCode, desc: vsDesc });
    const messageHost = saleHost.querySelector('[data-vs-message]');
    let savedSale = null;

    function clearSaleFormInputs() {
      saleHost.querySelectorAll('.field-grid input').forEach((el) => {
        el.value = '';
        el.classList.remove('sm-filled');
        el.removeAttribute('title');
        el.closest('.field')?.classList.remove('sm-autofilled');
      });
      setItemPickerState(vsCode, null);
    }

    saveButton.addEventListener('click', async () => {
      savedSale = null;
      printButton.disabled = true;
      messageHost.innerHTML = '';
      const orderValue = parseNumber(orderValueInput.value);
      if (!orderValueInput.value.trim() || orderValue <= 0) {
        messageHost.innerHTML =
          '<p class="form-note">Enter the appliance selling price above before saving.</p>';
        return;
      }
      const plan = plans.find((p) => p.key === planSelect.value) || plans[0];
      const band =
        bands.find((b) => orderValue >= b.start && orderValue <= b.end) || bands[bands.length - 1];
      const fee = vasCalcFee(plan, params, band);
      const serviceFee = vasCalcServiceFeeText(plan, params, orderValue);
      const deductible = params[plan.deductibleKey] || 0;
      const field = (selector) => saleHost.querySelector(selector).value.trim();
      const payload = {
        customerName: field('[data-vs-customer-name]') || undefined,
        contactNumber: field('[data-vs-contact-number]') || undefined,
        address: field('[data-vs-address]') || undefined,
        invoiceNumber: field('[data-vs-invoice-number]') || undefined,
        purchaseDate: field('[data-vs-purchase-date]') || undefined,
        itemCode: field('[data-vs-item-code]') || undefined,
        itemDescription: field('[data-vs-item-description]') || undefined,
        contractRef: field('[data-vs-contract-ref]') || undefined,
        planKey: plan.key,
        vasProduct: plan.label,
        sellingPrice: orderValue,
        planFee: fee,
        deductible,
        serviceFeeText: String(serviceFee),
      };
      try {
        const response = await apiRequest('/api/vas-sales', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        savedSale = response.vasSale;
        savedSale.bandLabel = band.label;
        messageHost.innerHTML =
          '<p class="form-note">Saved as <strong>' +
          escapeHtml(savedSale.vasSaleReference) +
          '</strong> and added to the "VAS Issued" tab. Print below, or reprint it any time from VAS Issued. The form has been cleared for the next sale.</p>';
        printButton.disabled = false;
        clearSaleFormInputs();
        resetCalculatorInputs();
        onSaved();
      } catch (error) {
        messageHost.innerHTML =
          '<p class="form-note">Could not save the VAS sale: ' +
          escapeHtml(error.message || 'unknown error') +
          '</p>';
      }
    });

    printButton.addEventListener('click', () => {
      if (!savedSale) return;
      printVasSaleCertificate(savedSale, [
        params.depreciationYear1,
        params.depreciationYear2,
        params.depreciationYear3,
      ]);
    });
  }

  // --- Rate Card page (read-only price list, modification #54) ----------------
  const RC_SECTION_TITLES = {
    warranty_repairs: 'Warranty Repairs',
    non_warranty_repairs: 'Non-Warranty Repairs (Customer Paying)',
    inspections: 'Inspections & Site Visits',
  };
  const RC_DANDI_NOTE =
    'These rates depend on factors set in D+I Admin Entry (region, grouping, crew size, quantity discounts and minimum unit rate). Figures shown are the current base rates; the final quote can differ once those factors are applied.';

  function rcInfo(text) {
    return (
      '<span class="tooltip" tabindex="0"><span class="tooltip-icon" aria-hidden="true">i</span>' +
      '<span class="tooltip-bubble" role="tooltip">' +
      escapeHtml(text) +
      '</span></span>'
    );
  }

  function rcActivityCard(section) {
    const rows = section.activities
      .map(
        (activity) =>
          '<tr><td>' +
          escapeHtml(activity.name) +
          '</td><td class="num">' +
          money(activity.rate) +
          '</td></tr>',
      )
      .join('');
    return (
      '<section class="rcv-card"><h3>' +
      escapeHtml(RC_SECTION_TITLES[section.key] || section.label) +
      '</h3><table class="rc-table"><thead><tr><th>Activity</th><th class="num">Rate (AED)</th></tr></thead><tbody>' +
      rows +
      '</tbody></table></section>'
    );
  }

  function rcModeCard(title, mode, dandi, withTransport) {
    const appliances = [
      ['fridge', 'Refrigerator'],
      ['washer', 'Washing machine'],
      ['cooker', 'Cooker'],
    ];
    const rateRows = appliances
      .map(
        ([key, label]) =>
          '<tr><td>' +
          label +
          '</td><td class="num">' +
          money(mode.rates[key].standard) +
          '</td><td class="num">' +
          money(mode.rates[key].batch) +
          '</td></tr>',
      )
      .join('');
    const tierRows = mode.discounts
      .map(
        (tier) =>
          '<tr><td>' +
          escapeHtml(tier.label) +
          '</td><td class="num">' +
          (tier.rate ? Math.round(tier.rate * 1000) / 10 + '%' : '—') +
          '</td></tr>',
      )
      .join('');
    const transport = dandi.regions
      .map(
        (region) =>
          '<tr><td>' +
          escapeHtml(region.name) +
          '</td><td class="num">' +
          money(region.roundTripCost) +
          '</td></tr>',
      )
      .join('');
    return (
      '<section class="rcv-card rcv-wide"><h3>' +
      escapeHtml(title) +
      rcInfo(RC_DANDI_NOTE) +
      '</h3><div class="rcv-note">Depends on D+I Admin Entry factors &mdash; shown here as base rates only.</div>' +
      '<div class="rcv-grid">' +
      '<div><h4>Base rate per unit (AED)</h4><table class="rc-table"><thead><tr><th>Appliance</th><th class="num">Standard</th><th class="num">Batch</th></tr></thead><tbody>' +
      rateRows +
      '</tbody></table></div>' +
      '<div><h4>Quantity discount</h4><table class="rc-table"><thead><tr><th>Units</th><th class="num">Discount</th></tr></thead><tbody>' +
      tierRows +
      '</tbody></table></div>' +
      '<div><h4>Transport per trip (AED) ' +
      tipHtml(
        withTransport
          ? 'Transport is always added to Delivery &amp; Installation quotes.'
          : 'Transport is added only when the job needs a separate trip.',
      ) +
      '</h4><table class="rc-table"><thead><tr><th>Region</th><th class="num">Round trip</th></tr></thead><tbody>' +
      transport +
      '</tbody></table></div></div>' +
      '<div class="card-help"><span>Quote limits</span>' +
      tipHtml(
        'Minimum rate per unit: ' +
          money(dandi.minUnitRate) +
          ' AED &middot; up to ' +
          dandi.maxUnits +
          ' units per quote.',
      ) +
      '</div></section>'
    );
  }

  // --- Stock master ---------------------------------------------------------
  // --- Item picker (stock master) -------------------------------------------
  // One lookup used by every form that has a brand / model: pick a brand first
  // and the model list narrows to that brand, or just type an item code or
  // description. Picking a result fills model (the ItemCode), brand,
  // description, main group, group and sub group; manual typing is always
  // allowed and is remembered as "not in stock master".
  let stockFacetsPromise = null;
  function loadStockFacets() {
    if (!stockFacetsPromise) {
      stockFacetsPromise = apiRequest('/api/stock/facets').catch(() => {
        stockFacetsPromise = null;
        return { brands: [], groups: [] };
      });
    }
    return stockFacetsPromise;
  }

  const PICKER_HINT =
    'Search the stock master: choose a brand first to list only its models, or type an item code or description. Picking a result fills brand, group and sub group.';

  function pickerFieldWrap(input) {
    return input.closest('.field') || input.parentElement;
  }

  // The hint is a tooltip (info icon beside the label and the input's title),
  // not text in the form body.
  function setPickerHint(modelInput, kind, code) {
    const wrap = pickerFieldWrap(modelInput);
    const text =
      kind === 'found'
        ? 'Stock master item ' + code + ' — related fields were filled; you can still edit them.'
        : kind === 'manual'
          ? 'Not in the stock master — it will be saved as typed.'
          : PICKER_HINT;
    const label = wrap.querySelector('label');
    let tip = label?.querySelector('.tooltip');
    if (!tip && label) {
      tip = document.createElement('span');
      tip.className = 'tooltip';
      tip.tabIndex = 0;
      tip.innerHTML =
        '<span class="tooltip-icon" aria-hidden="true">i</span>' +
        '<span class="tooltip-bubble" role="tooltip"></span>';
      label.appendChild(tip);
    }
    if (tip) {
      tip.dataset.kind = kind;
      tip.querySelector('.tooltip-bubble').textContent = text;
    }
    const old = wrap.querySelector('.sm-hint');
    if (old) old.remove();
  }

  function clearItemPickerMarks(container) {
    container.querySelectorAll('.sm-filled').forEach((input) => {
      input.classList.remove('sm-filled');
      input.removeAttribute('title');
    });
    container
      .querySelectorAll('.sm-autofilled')
      .forEach((wrap) => wrap.classList.remove('sm-autofilled'));
    container.querySelectorAll('input[data-in-master]').forEach((input) => {
      input.dataset.inMaster = '';
      setPickerHint(input, 'idle');
    });
  }

  // Called when a form is loaded with an existing record, so the hint and the
  // in-master flag reflect what was saved.
  function setItemPickerState(modelInput, inMaster, code) {
    if (!modelInput) return;
    modelInput.dataset.inMaster = inMaster === true ? 'true' : inMaster === false ? 'false' : '';
    modelInput.classList.toggle('sm-filled', inMaster === true);
    setPickerHint(
      modelInput,
      inMaster === true ? 'found' : inMaster === false ? 'manual' : 'idle',
      code || modelInput.value,
    );
  }

  function readItemInMaster(modelInput) {
    const value = modelInput?.dataset.inMaster;
    return value === 'true' ? true : value === 'false' ? false : undefined;
  }

  function attachItemPicker(fields) {
    const { model, brand, desc } = fields;
    const anchor = model || desc || brand;
    if (!anchor || anchor.dataset.itemPicker) return;
    anchor.dataset.itemPicker = '1';
    const state = { picked: null, filling: false, allBrands: false };
    const marked = [];

    function exactBrand(facets) {
      const typed = (brand?.value || '').trim().toLowerCase();
      if (!typed || state.allBrands) return '';
      const match = facets.brands.find((entry) => entry.brand.toLowerCase() === typed);
      return match ? match.brand : '';
    }

    function setValue(input, value) {
      if (!input || value === null || value === undefined || value === '') return;
      const max = Number(input.getAttribute('maxlength')) || 0;
      input.value = max ? String(value).slice(0, max) : String(value);
      if (input.type !== 'hidden') {
        input.classList.add('sm-filled');
        input.title = 'Filled from the stock master';
        pickerFieldWrap(input).classList.add('sm-autofilled');
        marked.push(input);
      }
    }

    function clearMark(input) {
      input.classList.remove('sm-filled');
      input.removeAttribute('title');
      pickerFieldWrap(input).classList.remove('sm-autofilled');
    }

    function fill(item) {
      state.filling = true;
      marked.splice(0).forEach(clearMark);
      setValue(model, item.itemCode);
      setValue(fields.code, item.itemCode);
      setValue(brand, item.brand);
      setValue(desc, item.itemDesc);
      setValue(fields.mainGroup, item.mainGroup);
      setValue(fields.group, item.groupName);
      setValue(fields.subGroup, item.subGroup);
      state.picked = item.itemCode;
      state.allBrands = false;
      if (model) setItemPickerState(model, true, item.itemCode);
      else if (desc) desc.dataset.inMaster = 'true';
      state.filling = false;
      if (fields.onFilled) fields.onFilled();
    }

    function makeDropdown(input, getHits, renderHeader) {
      const wrap = pickerFieldWrap(input);
      wrap.classList.add('sm-host');
      input.classList.add('sm-lookup');
      const list = document.createElement('div');
      list.className = 'sm-suggest';
      list.hidden = true;
      list.setAttribute('role', 'listbox');
      wrap.appendChild(list);
      let hits = [];
      let active = -1;
      let sequence = 0;
      let timer = null;
      let stale = false;
      const close = () => {
        list.hidden = true;
        active = -1;
      };
      const highlight = () =>
        list.querySelectorAll('.sm-hit').forEach((el, index) => {
          el.classList.toggle('is-active', index === active);
        });
      async function run() {
        if (!hasPermission('stock.read')) return close();
        const mine = ++sequence;
        const result = await getHits();
        if (mine !== sequence) return;
        stale = false;
        hits = result.hits;
        const header = renderHeader ? renderHeader(result) : '';
        if (!hits.length && !result.message) return close();
        list.innerHTML =
          (header ? '<div class="sm-head">' + header + '</div>' : '') +
          (hits.length
            ? hits.map((entry, index) => entry.html(index)).join('')
            : '<div class="sm-empty">' + escapeHtml(result.message) + '</div>');
        list.hidden = false;
        active = -1;
      }
      const schedule = () => {
        // The list on screen belongs to the previous text until the new
        // search returns, so it must not be selectable in the meantime.
        stale = true;
        active = -1;
        highlight();
        clearTimeout(timer);
        timer = setTimeout(run, 180);
      };
      input.addEventListener('input', schedule);
      input.addEventListener('focus', run);
      input.addEventListener('blur', () => setTimeout(close, 150));
      input.addEventListener('keydown', (event) => {
        if (list.hidden) return;
        if (stale) {
          if (event.key === 'Enter') event.preventDefault();
          return;
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          active = Math.min(active + 1, hits.length - 1);
          highlight();
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          active = Math.max(active - 1, 0);
          highlight();
        } else if (event.key === 'Enter' && active >= 0) {
          event.preventDefault();
          hits[active].pick();
          close();
        } else if (event.key === 'Escape') {
          close();
        }
      });
      list.addEventListener('mousedown', (event) => {
        if (stale) {
          event.preventDefault();
          return;
        }
        const allBrands = event.target.closest('[data-sm-all-brands]');
        if (allBrands) {
          event.preventDefault();
          state.allBrands = true;
          run();
          return;
        }
        const button = event.target.closest('.sm-hit');
        if (!button) return;
        event.preventDefault();
        hits[Number(button.dataset.index)].pick();
        close();
      });
      return { close };
    }

    const itemHit = (item) => ({
      pick: () => fill(item),
      html: (index) =>
        '<button type="button" class="sm-hit" role="option" data-index="' +
        index +
        '"><strong>' +
        escapeHtml(item.itemCode) +
        '</strong><span>' +
        escapeHtml(item.itemDesc) +
        '</span><em>' +
        escapeHtml([item.brand, item.groupName, item.subGroup].filter(Boolean).join(' · ')) +
        '</em></button>',
    });

    async function searchItems(input) {
      const facets = await loadStockFacets();
      const term = input.value.trim();
      const brandFilter = exactBrand(facets);
      if (term.length < 2 && !brandFilter) {
        return {
          hits: [],
          brandFilter,
          message: 'Type at least 2 characters, or choose a brand first.',
        };
      }
      const params = new URLSearchParams({ q: term, limit: '12' });
      if (brandFilter) params.set('brand', brandFilter);
      try {
        const data = await apiRequest('/api/stock/items?' + params);
        return {
          hits: data.items.map(itemHit),
          brandFilter,
          message: 'No match in the stock master. Keep typing to enter it manually.',
        };
      } catch {
        return { hits: [], brandFilter, message: '' };
      }
    }

    const brandHeader = (result) =>
      result.brandFilter
        ? 'Models for <strong>' +
          escapeHtml(result.brandFilter) +
          '</strong> · <a href="#" data-sm-all-brands>search all brands</a>'
        : '';

    if (model) makeDropdown(model, () => searchItems(model), brandHeader);
    if (desc && desc !== model) makeDropdown(desc, () => searchItems(desc), brandHeader);
    if (brand) {
      const dropdown = makeDropdown(brand, async () => {
        const facets = await loadStockFacets();
        const typed = brand.value.trim().toLowerCase();
        const matches = facets.brands
          .filter((entry) => !typed || entry.brand.toLowerCase().includes(typed))
          .sort(
            (a, b) =>
              Number(b.brand.toLowerCase().startsWith(typed)) -
              Number(a.brand.toLowerCase().startsWith(typed)),
          )
          .slice(0, 10);
        return {
          hits: matches.map((entry) => ({
            pick: () => {
              state.filling = true;
              brand.value = entry.brand;
              state.allBrands = false;
              state.filling = false;
              (model || desc)?.focus();
            },
            html: (index) =>
              '<button type="button" class="sm-hit sm-brand" role="option" data-index="' +
              index +
              '"><strong>' +
              escapeHtml(entry.brand) +
              '</strong><em>' +
              entry.count +
              ' items</em></button>',
          })),
          message: typed ? 'No brand matches — it will be saved as typed.' : '',
        };
      });
      void dropdown;
      brand.addEventListener('input', () => {
        if (state.filling) return;
        state.allBrands = false;
        clearMark(brand);
      });
    }

    // Manual typing in the model / description after a pick means the item is
    // no longer the stock-master one.
    [model, desc].filter(Boolean).forEach((input) => {
      input.addEventListener('input', () => {
        if (state.filling) return;
        clearMark(input);
        if (model) {
          const typed = model.value.trim();
          if (state.picked && typed === state.picked) return;
          state.picked = null;
          model.dataset.inMaster = typed ? 'false' : '';
          if (fields.code) fields.code.value = '';
          setPickerHint(model, 'idle');
        }
      });
    });
    [fields.mainGroup, fields.group, fields.subGroup].filter(Boolean).forEach((input) => {
      input.addEventListener('input', () => {
        if (!state.filling) clearMark(input);
      });
    });
    if (model) {
      setPickerHint(model, 'idle');
      model.addEventListener('blur', () => {
        if (model.dataset.inMaster === 'false' && model.value.trim()) {
          setPickerHint(model, 'manual');
        }
      });
    }
  }

  function initItemPickers() {
    // New request: brand, model (item code)
    attachItemPicker({
      brand: $('#newComplaintBrand'),
      model: $('#newComplaintModel'),
    });
    // Schedule appointment (overrides on the complaint's own values)
    attachItemPicker({
      brand: $('#scheduleBrand'),
      model: $('#scheduleModel'),
      code: $('#scheduleItemCode'),
      subGroup: $('#scheduleSubGroup'),
    });
    // Warranty approvals and VAS sale carry only an item description
    attachItemPicker({ desc: $('#waItemDescription') });
  }

  function smDate(value) {
    return value ? new Date(value).toLocaleString('en-GB') : '—';
  }

  // Download an uploaded master file for checking. The server sends the file
  // exactly as uploaded when it still holds it, else an Excel rebuilt from the
  // stored rows (X-Download-Source says which). Returns a short status line.
  async function downloadMasterFile(url, fallbackName, rebuiltNote) {
    const headers = new Headers();
    if (authToken) headers.set('authorization', 'Bearer ' + authToken);
    const response = await fetch(url, { headers });
    if (!response.ok) {
      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      throw new Error(body?.detail || body?.title || 'The download could not be completed.');
    }
    const disposition = response.headers.get('content-disposition') || '';
    const match = /filename="([^"]+)"/.exec(disposition);
    const fileName = match ? match[1] : fallbackName;
    rdDownloadBlob(await response.blob(), fileName);
    return response.headers.get('x-download-source') === 'original'
      ? 'Downloaded ' + fileName + ' (the file exactly as uploaded).'
      : 'Downloaded ' +
          fileName +
          (rebuiltNote ||
            ' (rebuilt from the data the portal stored; the original file was uploaded before the portal kept copies).');
  }

  function smReport(upload) {
    const report = upload.report || {};
    const parts = [];
    parts.push(
      '<p class="sm-summary"><strong>' +
        escapeHtml(upload.fileName) +
        '</strong> · ' +
        upload.rowCount +
        ' rows · ' +
        upload.itemCount +
        ' unique items · <strong>' +
        upload.newItems +
        ' new</strong> · ' +
        upload.changedItems +
        ' changed</p>',
    );
    if (report.changes && report.changes.length) {
      parts.push(
        '<details class="sm-details"><summary>Changed items (' +
          report.changeCount +
          (report.changes.length < report.changeCount
            ? ', showing first ' + report.changes.length
            : '') +
          ')</summary><ul>' +
          report.changes
            .map(
              (change) =>
                '<li><strong>' +
                escapeHtml(change.itemCode) +
                '</strong>' +
                change.fields
                  .map(
                    (field) =>
                      '<div>' +
                      escapeHtml(field.field) +
                      ': ' +
                      escapeHtml(field.from ?? '—') +
                      ' → ' +
                      escapeHtml(field.to ?? '—') +
                      '</div>',
                  )
                  .join('') +
                '</li>',
            )
            .join('') +
          '</ul></details>',
      );
    }
    if (report.warnings && report.warnings.length) {
      parts.push(
        '<details class="sm-details"><summary>Warnings (' +
          report.warningCount +
          ')</summary><ul>' +
          report.warnings.map((warning) => '<li>' + escapeHtml(warning) + '</li>').join('') +
          '</ul></details>',
      );
    }
    return parts.join('');
  }

  // Admin > Masters: one place for the master lists that the forms read.
  let mastersTab = 'stock';
  async function renderMastersPage(root) {
    const tabs = [];
    if (hasPermission('stock.write')) tabs.push(['stock', 'Stock master']);
    if (hasPermission('b2b_master.write')) tabs.push(['customers', 'Customers']);
    if (!tabs.some(([key]) => key === mastersTab)) mastersTab = tabs[0][0];
    root.innerHTML =
      '<div class="ws-tabs" role="tablist" aria-label="Masters">' +
      tabs
        .map(
          ([key, label]) =>
            '<button type="button" role="tab" class="ws-tab' +
            (key === mastersTab ? ' is-active' : '') +
            '" data-masters-tab="' +
            key +
            '" aria-selected="' +
            (key === mastersTab ? 'true' : 'false') +
            '">' +
            label +
            '</button>',
        )
        .join('') +
      '</div><div data-masters-body></div>';
    const body = root.querySelector('[data-masters-body]');
    root.querySelectorAll('[data-masters-tab]').forEach((button) =>
      button.addEventListener('click', () => {
        mastersTab = button.dataset.mastersTab;
        renderMastersPage(root);
      }),
    );
    if (mastersTab === 'customers') await renderCustomerMasterPage(body);
    else await renderStockMasterPage(body);
  }

  function b2bReport(upload) {
    const report = upload.report || {};
    const parts = [
      '<p class="sm-summary"><strong>' +
        escapeHtml(upload.fileName) +
        '</strong> · ' +
        upload.rowCount +
        ' rows · ' +
        upload.customerCount +
        ' customers · <strong>' +
        upload.newCustomers +
        ' new</strong> · ' +
        upload.changedCustomers +
        ' changed</p>',
    ];
    if (report.changes && report.changes.length) {
      parts.push(
        '<details class="sm-details"><summary>Changed customers (' +
          report.changeCount +
          (report.changeCount > report.changes.length
            ? ', first ' + report.changes.length + ' shown'
            : '') +
          ')</summary><ul>' +
          report.changes
            .map(
              (change) =>
                '<li><strong>' +
                escapeHtml(change.custCode) +
                '</strong>: ' +
                change.fields
                  .map(
                    (f) =>
                      escapeHtml(f.field) +
                      ' “' +
                      escapeHtml(f.from ?? '—') +
                      '” → “' +
                      escapeHtml(f.to ?? '—') +
                      '”',
                  )
                  .join('; ') +
                '</li>',
            )
            .join('') +
          '</ul></details>',
      );
    }
    if (report.warnings && report.warnings.length) {
      parts.push(
        '<details class="sm-details" open><summary>Warnings (' +
          report.warningCount +
          ')</summary><ul>' +
          report.warnings.map((warning) => '<li>' + escapeHtml(warning) + '</li>').join('') +
          '</ul></details>',
      );
    }
    return parts.join('');
  }

  async function renderCustomerMasterPage(root) {
    root.innerHTML = '<p class="form-note">Loading&hellip;</p>';
    let status;
    try {
      status = await apiRequest('/api/b2b-master/status');
    } catch (error) {
      root.innerHTML = '<p class="form-note pg-error">' + escapeHtml(error.message) + '</p>';
      return;
    }
    const last = status.lastUpload;
    const n = (value) => Number(value).toLocaleString('en-GB');
    root.innerHTML =
      '<div class="rcv-banner"><strong>B2B customers</strong><span>' +
      n(status.totalCustomers) +
      ' customers · ' +
      n(status.withoutSalesman) +
      ' without a salesman</span></div>' +
      '<section class="detail-action-card"><h4>Customer master ' +
      tipHtml(
        'The list behind every “Look up B2B customer / Branch / School” box: complaints, appointments, job cards and Delivery & Installation. ' +
          'Each upload adds new customers and updates the ones that changed (matched by Cust Code). A blank salesman keeps what is already stored. Customers that are not in the file are kept and counted below. The sales channel is not part of this list: it comes from the salesman, on Salesmen & channels.',
      ) +
      '</h4>' +
      (last
        ? '<p>' +
          escapeHtml(last.fileName) +
          ' · ' +
          n(last.customerCount) +
          ' customers · uploaded ' +
          escapeHtml(smDate(last.uploadedAt)) +
          (last.uploadedByName ? ' by ' + escapeHtml(last.uploadedByName) : '') +
          '</p>' +
          (status.notInFileCount
            ? '<p class="sm-warn">' +
              n(status.notInFileCount) +
              ' customer(s) not in the latest file (kept)</p>'
            : '')
        : '<p class="form-note">No upload yet. The list below came from the original import.</p>') +
      '<p><button class="button dl-pill" type="button" data-b2b-dl>Download customer master</button>' +
      (last && last.hasFile
        ? ' <button class="button dl-pill" type="button" data-b2b-dl-up>Download last uploaded file</button>'
        : '') +
      '</p><p class="form-note" data-b2b-dl-msg role="status"></p></section>' +
      '<section class="detail-action-card"><h4>Upload customer list ' +
      tipHtml(
        'Choose an .xlsx with the columns: Cust Code, Customer, Salesman. Only Cust Code and Customer are required; any other column is ignored. ' +
          'Download the customer master, edit it in Excel and upload it back. Where a customer has several rows, the first is used.',
      ) +
      '</h4>' +
      '<div class="sm-upload"><input type="file" accept=".xlsx" data-b2b-file />' +
      '<button class="button button-primary" type="button" data-b2b-upload>Upload</button></div>' +
      '<p class="form-note" data-b2b-msg role="status"></p><div data-b2b-report></div></section>' +
      '<section class="detail-action-card"><h4>Look up a customer</h4>' +
      '<div class="field"><label for="b2bMasterSearch">Customer name or Cust Code</label>' +
      '<input id="b2bMasterSearch" type="text" autocomplete="off" placeholder="e.g. GEMS Wellington or 191065" /></div>' +
      '<div data-b2b-hits></div></section>' +
      '<section class="detail-action-card"><h4>Recent uploads</h4>' +
      (status.recentUploads.length
        ? status.recentUploads
            .map(
              (upload) =>
                '<details class="sm-details"><summary>' +
                escapeHtml(upload.fileName) +
                ' · ' +
                escapeHtml(smDate(upload.uploadedAt)) +
                '</summary>' +
                b2bReport(upload) +
                '</details>',
            )
            .join('')
        : '<p class="form-note">Nothing uploaded yet.</p>') +
      '</section>';

    const note = root.querySelector('[data-b2b-dl-msg]');
    const wireDownload = (selector, url, fallback, rebuiltNote) => {
      const button = root.querySelector(selector);
      if (!button) return;
      button.addEventListener('click', async () => {
        button.disabled = true;
        note.textContent = 'Preparing the file…';
        try {
          note.textContent = await downloadMasterFile(url, fallback, rebuiltNote);
        } catch (error) {
          note.textContent = error.message || 'The download failed.';
        } finally {
          button.disabled = false;
        }
      });
    };
    wireDownload(
      '[data-b2b-dl]',
      '/api/b2b-master/download',
      'B2B_customers.xlsx',
      ' (every customer in the master; edit it and upload it back).',
    );
    wireDownload(
      '[data-b2b-dl-up]',
      '/api/b2b-master/download?source=upload',
      'B2B_customers_upload.xlsx',
    );

    const button = root.querySelector('[data-b2b-upload]');
    const msg = root.querySelector('[data-b2b-msg]');
    button.addEventListener('click', async () => {
      const file = root.querySelector('[data-b2b-file]').files[0];
      if (!file) {
        msg.textContent = 'Choose the .xlsx file first.';
        return;
      }
      button.disabled = true;
      msg.textContent = 'Uploading and reading the file…';
      try {
        const form = new FormData();
        form.append('file', file);
        const result = await apiUploadRequest('/api/b2b-master/upload', form);
        await renderCustomerMasterPage(root);
        root.querySelector('[data-b2b-report]').innerHTML = b2bReport(result.upload);
        root.querySelector('[data-b2b-msg]').textContent = 'Upload complete.';
      } catch (error) {
        msg.textContent = error.message || 'The upload failed.';
        button.disabled = false;
      }
    });

    const search = root.querySelector('#b2bMasterSearch');
    const hits = root.querySelector('[data-b2b-hits]');
    let timer = null;
    let seq = 0;
    const draw = async () => {
      const term = search.value.trim();
      const mine = ++seq;
      try {
        const result = await apiRequest(
          '/api/b2b-branches' + (term ? '?query=' + encodeURIComponent(term) : ''),
        );
        if (mine !== seq) return;
        const rows = result.branches || [];
        hits.innerHTML = rows.length
          ? '<div class="acc-wrap"><table class="acc-table"><thead><tr><th>Cust Code</th><th>Customer</th><th>Salesman</th></tr></thead><tbody>' +
            rows
              .map(
                (r) =>
                  '<tr><td>' +
                  escapeHtml(r.custCode) +
                  '</td><td>' +
                  escapeHtml(r.branchName) +
                  '</td><td>' +
                  escapeHtml(r.salesman || '—') +
                  '</td></tr>',
              )
              .join('') +
            '</tbody></table></div><p class="form-note">Showing up to 20 matches.</p>'
          : '<p class="form-note">No customer matches.</p>';
      } catch (error) {
        hits.innerHTML = '<p class="form-note pg-error">' + escapeHtml(error.message) + '</p>';
      }
    };
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(draw, 250);
    });
    draw();
  }

  async function renderStockMasterPage(root) {
    root.innerHTML = '<p class="form-note">Loading&hellip;</p>';
    let status;
    try {
      status = await apiRequest('/api/stock/status');
    } catch (error) {
      root.innerHTML = '<p class="form-note pg-error">' + escapeHtml(error.message) + '</p>';
      return;
    }
    const last = status.lastUpload;
    root.innerHTML =
      '<div class="rcv-banner"><strong>Stock master</strong><span>' +
      status.totalItems.toLocaleString('en-GB') +
      ' items · ' +
      status.searchableItems.toLocaleString('en-GB') +
      ' appliances (MDA and SDA)</span></div>' +
      '<section class="detail-action-card"><h4>ERP Item Listing ' +
      tipHtml(
        'The stock master is the ERP “Item Listing” (every item once it is created, with or without stock). ' +
          'Each upload adds new items and updates the ones that changed. Items that are no longer in the file are kept and counted below.',
      ) +
      '</h4>' +
      (last
        ? '<p>' +
          escapeHtml(last.fileName) +
          ' · ' +
          last.itemCount.toLocaleString('en-GB') +
          ' items · uploaded ' +
          escapeHtml(smDate(last.uploadedAt)) +
          (last.uploadedByName ? ' by ' + escapeHtml(last.uploadedByName) : '') +
          '</p>' +
          (status.notInFileCount
            ? '<p class="sm-warn">' +
              status.notInFileCount.toLocaleString('en-GB') +
              ' item(s) not in the latest file (kept)</p>'
            : '') +
          '<p><button class="button dl-pill" type="button" data-sm-dl>Download Excel</button></p>' +
          '<p class="form-note" data-sm-dl-msg role="status"></p>'
        : '<p class="form-note">No upload yet.</p>') +
      '</section>' +
      '<section class="detail-action-card"><h4>Upload ERP Item Listing ' +
      tipHtml(
        'Choose the “Item Listing” .xlsx exported from the ERP. Columns read: Item Code, Item Desc, Maingrp Name, Grp Name, SUBGRPNAME, BRANDNAME. ' +
          'An item that appears on several rows (for example one per barcode) is stored once.',
      ) +
      '</h4>' +
      '<div class="sm-upload"><input type="file" accept=".xlsx" data-sm-file />' +
      '<button class="button button-primary" type="button" data-sm-upload>Upload</button></div>' +
      '<p class="form-note" data-sm-msg role="status"></p><div data-sm-report></div></section>' +
      '<section class="detail-action-card"><h4>Recent uploads</h4>' +
      (status.recentUploads.length
        ? status.recentUploads
            .map(
              (upload) =>
                '<details class="sm-details"><summary>' +
                escapeHtml(upload.fileName) +
                ' · ' +
                escapeHtml(smDate(upload.uploadedAt)) +
                '</summary>' +
                smReport(upload) +
                '</details>',
            )
            .join('')
        : '<p class="form-note">Nothing uploaded yet.</p>') +
      '</section>';
    const download = root.querySelector('[data-sm-dl]');
    if (download) {
      download.addEventListener('click', async () => {
        const note = root.querySelector('[data-sm-dl-msg]');
        download.disabled = true;
        note.textContent = 'Preparing the file…';
        try {
          note.textContent = await downloadMasterFile('/api/stock/download', 'Stock_master.xlsx');
        } catch (error) {
          note.textContent = error.message || 'The download failed.';
        } finally {
          download.disabled = false;
        }
      });
    }
    const button = root.querySelector('[data-sm-upload]');
    const msg = root.querySelector('[data-sm-msg]');
    button.addEventListener('click', async () => {
      const file = root.querySelector('[data-sm-file]').files[0];
      if (!file) {
        msg.textContent = 'Choose the .xlsx file first.';
        return;
      }
      button.disabled = true;
      msg.textContent =
        'Uploading and reading the file — about 10 seconds for a full item listing…';
      try {
        const form = new FormData();
        form.append('file', file);
        const result = await apiUploadRequest('/api/stock/upload', form);
        stockFacetsPromise = null;
        await renderStockMasterPage(root);
        const fresh = root.querySelector('[data-sm-report]');
        fresh.innerHTML = smReport(result.upload);
        root.querySelector('[data-sm-msg]').textContent = 'Upload complete.';
      } catch (error) {
        msg.textContent = error.message || 'The upload failed.';
        button.disabled = false;
      }
    });
  }

  // --- Walk-in service job card -----------------------------------------------
  // The customer comes straight to the service centre: no complaint, no
  // appointment. Counter staff capture the essentials; the technician, parts
  // and charges are added later from the normal job card screen.
  function walkInIntakeHtml() {
    const tip = (text) =>
      '<span class="tooltip" tabindex="0"><span class="tooltip-icon" aria-hidden="true">i</span><span class="tooltip-bubble" role="tooltip">' +
      escapeHtml(text) +
      '</span></span>';
    return (
      '<div class="rcv-banner"><strong>Walk-in job card</strong><span>Customer at the counter — no complaint or appointment needed</span></div>' +
      '<div class="wi-dup" data-wi-dup hidden></div>' +
      '<form id="walkInForm" novalidate>' +
      '<section class="detail-action-card"><h4>Customer</h4><div class="field-grid">' +
      '<div class="field"><label for="wiCustomerType">Customer type <span class="required">*</span></label><select id="wiCustomerType"><option value="">Select a type</option><option value="B2C">B2C (Direct customer)</option><option value="B2B">B2B (Corporate client)</option></select><span class="field-error" data-error-for="wiCustomerType"></span></div>' +
      '<div class="field"><label for="wiCustomerName">Customer name <span class="required">*</span></label><input id="wiCustomerName" maxlength="200" /><span class="field-error" data-error-for="wiCustomerName"></span></div>' +
      '<div class="field"><label for="wiCustomerContact">Contact number <span class="required" id="wiContactStar">*</span> ' +
      tip(
        'Used to warn you if this customer already has an open complaint, appointment or walk-in card.',
      ) +
      '</label><input id="wiCustomerContact" type="tel" maxlength="50" /><span class="field-error" data-error-for="wiCustomerContact"></span></div>' +
      '<div class="field"><label for="wiCustomerEmail">Email address</label><input id="wiCustomerEmail" type="email" maxlength="320" /></div>' +
      '<div class="field"><label for="wiCustomerAddress">Address</label><input id="wiCustomerAddress" maxlength="500" /></div>' +
      '<div class="field"><label for="wiRegion">Region</label><select id="wiRegion"><option value="">Select region</option>' +
      REGION_LIST.map((r) => '<option>' + r + '</option>').join('') +
      '</select></div>' +
      '<div class="field"><label for="wiCustomerNumber">Customer number</label><input id="wiCustomerNumber" maxlength="100" /></div>' +
      '</div>' +
      '<div class="field-grid" id="wiB2bFields" hidden>' +
      '<div class="field"><label for="wiB2bLookup">Look up B2B Branch / School ' +
      tip('Picks the branch, sales order no. and salesman together.') +
      '</label><input id="wiB2bLookup" type="text" autocomplete="off" placeholder="Type a branch or school name, or its customer code (e.g. 191065)…" /></div>' +
      '<ul id="wiB2bResults" class="b2b-branch-results field-wide" hidden></ul>' +
      '<div class="field"><label for="wiB2bBranchSchool">B2B Branch / School <span class="required">*</span></label><input id="wiB2bBranchSchool" maxlength="300" /><span class="field-error" data-error-for="wiB2bBranchSchool"></span></div>' +
      '<div class="field"><label for="wiSchoolContactPerson">Site contact person</label><input id="wiSchoolContactPerson" maxlength="500" /></div>' +
      '<div class="field"><label for="wiSchoolContactNumber">Site contact number</label><input id="wiSchoolContactNumber" type="tel" maxlength="100" /></div>' +
      '</div></section>' +
      '<section class="detail-action-card"><h4>Sales and handling</h4><div class="field-grid">' +
      '<div class="field"><label for="wiSalesOrderNumber">Sales order no.</label><input id="wiSalesOrderNumber" maxlength="100" /></div>' +
      '<div class="field"><label for="wiSalesman">Salesman <span class="required" id="wiSalesmanStar" hidden>*</span></label><select id="wiSalesman"><option value="">Select a salesman</option></select><span class="field-error" data-error-for="wiSalesman"></span></div>' +
      '<div class="field"><label for="wiSalesChannel">Sales channel</label><select id="wiSalesChannel"><option value="">Select a sales channel</option></select></div>' +
      '<div class="field"><label for="wiTechnician">Technician (optional)</label><select id="wiTechnician"><option value="">Assign later</option></select></div>' +
      '</div></section>' +
      '<section class="detail-action-card"><h4>Item brought in</h4><div class="field-grid">' +
      '<div class="field"><label for="wiBrand">Brand ' +
      tip('Start typing or click to pick a brand. The model list then shows only that brand.') +
      '</label><input id="wiBrand" maxlength="120" autocomplete="off" /></div>' +
      '<div class="field"><label for="wiModelNo">Model (item code) ' +
      tip(
        'Type an item code or part of the description. Picking a result fills brand, description, group and sub group.',
      ) +
      '</label><input id="wiModelNo" maxlength="120" autocomplete="off" /><span class="field-error" data-error-for="wiModelNo"></span></div>' +
      '<div class="field field-wide"><label for="wiItemDescription">Item description</label><input id="wiItemDescription" maxlength="300" autocomplete="off" /></div>' +
      '<div class="field"><label for="wiMainGroup">Main group</label><input id="wiMainGroup" maxlength="120" /></div>' +
      '<div class="field"><label for="wiGroup">Group</label><input id="wiGroup" maxlength="120" /></div>' +
      '<div class="field"><label for="wiSubGroup">Sub group</label><input id="wiSubGroup" maxlength="120" /></div>' +
      '<div class="field"><label for="wiSerialNo">Serial number</label><input id="wiSerialNo" maxlength="120" /></div>' +
      '<div class="field"><label for="wiPurchaseDate">Purchase date</label><input id="wiPurchaseDate" type="date" /></div>' +
      '<div class="field"><label for="wiInvoiceNo">Invoice no. ' +
      tip('Ask for the purchase invoice: it proves the warranty period.') +
      '</label><input id="wiInvoiceNo" maxlength="120" /></div>' +
      '<div class="field"><label for="wiWarrantyStatus">Warranty status</label><select id="wiWarrantyStatus"><option value="To be verified">To be verified</option><option value="In Warranty">In Warranty</option><option value="Out of Warranty">Out of Warranty</option></select></div>' +
      '<input id="wiItemCode" type="hidden" />' +
      '</div></section>' +
      '<section class="detail-action-card"><h4>Fault and condition</h4>' +
      '<div class="field"><label for="wiComplaint">Fault reported by the customer <span class="required">*</span></label><textarea id="wiComplaint" maxlength="10000"></textarea><span class="field-error" data-error-for="wiComplaint"></span></div>' +
      '<div class="field-grid">' +
      '<div class="field"><label for="wiAccessories">Accessories received ' +
      tip('Power cord, remote, charger, box, SIM tray… so nothing is disputed at collection.') +
      '</label><input id="wiAccessories" maxlength="1000" placeholder="e.g. power cord, remote" /></div>' +
      '<div class="field"><label for="wiCondition">Condition at drop-off ' +
      tip(
        'Scratches, dents, missing parts: written down now, agreed by the customer on the receipt.',
      ) +
      '</label><input id="wiCondition" maxlength="2000" placeholder="e.g. scratch on the lid" /></div>' +
      '</div></section>' +
      '<div class="form-footer"><span class="form-note" id="wiResult" role="status"></span>' +
      '<button class="button button-primary" type="submit" id="wiSubmit">Open walk-in job card</button></div>' +
      '</form><div data-wi-done hidden></div>'
    );
  }

  function printWalkInReceipt(jobCard) {
    if (!jobCard) return;
    const intake = jobCard.intakeAt ? new Date(jobCard.intakeAt).toLocaleString('en-GB') : '';
    const body = `
      ${printDocHeadWithLogo('Service Intake Receipt', jobCard.jobCardReference)}
      <h2>Customer</h2>
      ${printFieldGrid([
        ['Received on', intake],
        ['Customer name', jobCard.customerName],
        ['Customer type', jobCard.customerType],
        ['Contact', jobCard.customerContact],
        ['Email', jobCard.customerEmail],
        ['Address', jobCard.customerAddress],
        ['Region', jobCard.region],
        ['B2B branch / school', jobCard.b2bBranchSchool],
        [
          'Site contact',
          [jobCard.schoolContactPerson, jobCard.schoolContactNumber].filter(Boolean).join(' · '),
        ],
        ['Sales order no.', jobCard.salesOrderNumber],
        ['Salesman', jobCard.salesman],
      ])}
      <h2>Item received</h2>
      ${printFieldGrid([
        ['Brand', jobCard.brand],
        ['Model / item code', jobCard.modelNo],
        ['Description', jobCard.itemDescription],
        ['Serial number', jobCard.serialNo],
        ['Purchase date', jobCard.purchaseDate],
        ['Invoice no.', jobCard.invoiceNo],
        ['Warranty status', jobCard.warrantyStatus],
        ['Accessories received', jobCard.accessoriesReceived],
        ['Condition at drop-off', jobCard.conditionNotes],
      ])}
      ${printTextBlock('Fault reported', jobCard.complaint)}
      <h2>Terms</h2>
      <ol style="font-size:12px;">
        <li>Warranty cover is confirmed only after inspection and proof of purchase; an inspection or diagnosis fee may apply to out-of-warranty items, even if the repair is declined.</li>
        <li>A quotation is given before any chargeable repair. Work starts only after the customer approves it.</li>
        <li>Please back up and remove personal data from phones, computers and storage devices. Jacky's is not responsible for data loss.</li>
        <li>Items not collected within 30 days of the completion notice are left at the owner's risk and may incur storage charges.</li>
        <li>Please present this receipt to collect the item. Accessories are returned only as listed above.</li>
      </ol>
      <div class="sign-row">
        <div class="sign-box">Received by (service centre)</div>
        <div class="sign-box">Customer signature</div>
      </div>
    `;
    openPrintWindow(printDocumentShell(`Intake receipt ${jobCard.jobCardReference || ''}`, body));
  }

  async function renderWalkInPage(root) {
    root.innerHTML = walkInIntakeHtml();
    const form = root.querySelector('#walkInForm');
    const done = root.querySelector('[data-wi-done]');
    const dup = root.querySelector('[data-wi-dup]');
    const $$ = (id) => root.querySelector('#' + id);
    attachItemPicker({
      brand: $$('wiBrand'),
      model: $$('wiModelNo'),
      desc: $$('wiItemDescription'),
      code: $$('wiItemCode'),
      mainGroup: $$('wiMainGroup'),
      group: $$('wiGroup'),
      subGroup: $$('wiSubGroup'),
    });

    // Customer type: B2B shows the branch / school block and makes the contact
    // number optional, exactly like the New request form.
    const b2bBox = $$('wiB2bFields');
    // A B2C walk-in under warranty is billed internally to the salesman's channel, so
    // the salesman is required and fills the sales channel (modification #153).
    const wiSalesmanNeeded = () =>
      $$('wiCustomerType').value === 'B2C' && $$('wiWarrantyStatus').value === 'In Warranty';
    const syncWiSalesman = () => {
      $$('wiSalesmanStar').hidden = !wiSalesmanNeeded();
      if (wiSalesmanNeeded() && !$$('wiSalesman').value) {
        notifyDialog(
          'Salesman is required',
          "This is a direct customer (B2C) job under warranty. It is billed internally to the salesman's sales channel, so choose the salesman. The sales channel fills in by itself.",
        );
      }
    };
    $$('wiCustomerType').addEventListener('change', () => {
      b2bBox.hidden = $$('wiCustomerType').value !== 'B2B';
      $$('wiContactStar').hidden = $$('wiCustomerType').value === 'B2B';
      syncWiSalesman();
    });
    $$('wiWarrantyStatus').addEventListener('change', syncWiSalesman);
    const wiSalesmanNoChannel = () => {
      const name = $$('wiSalesman').value;
      return wiSalesmanNeeded() && name && !$$('wiSalesChannel').value && !channelForSalesman(name);
    };
    const wiChannelPopup = (name) =>
      notifyDialog(
        'Salesman has no sales channel',
        `${name} is not linked to a sales channel yet, so this job cannot be billed. Contact the admin to link the salesman to a channel under Salesmen, then try again. You can also pick the sales channel by hand.`,
      );
    $$('wiSalesman').addEventListener('change', () => {
      const channel = channelForSalesman($$('wiSalesman').value);
      if (channel) setSelectValue('#wiSalesChannel', channel);
      else if (wiSalesmanNoChannel()) wiChannelPopup($$('wiSalesman').value);
    });
    populateSelectOptions('#wiSalesman', salesmenOptions, 'Select a salesman');
    populateSelectOptions('#wiSalesChannel', salesChannelOptions, 'Select a sales channel');
    if (hasPermission('technicians.read')) {
      apiRequest('/api/technicians?active=true&page=1&pageSize=100')
        .then((result) => {
          populateSelectOptions('#wiTechnician', result.technicians || [], 'Assign later');
        })
        .catch(() => {});
    } else {
      $$('wiTechnician').disabled = true;
    }
    let b2bSequence = 0;
    let b2bTimer = null;
    const b2bResults = $$('wiB2bResults');
    $$('wiB2bLookup').addEventListener('input', (event) => {
      const query = event.target.value.trim();
      clearTimeout(b2bTimer);
      if (query.length < 2) {
        b2bResults.hidden = true;
        return;
      }
      b2bTimer = setTimeout(async () => {
        const mine = ++b2bSequence;
        try {
          const result = await apiRequest('/api/b2b-branches?query=' + encodeURIComponent(query));
          if (mine !== b2bSequence) return;
          const branches = result.branches || [];
          b2bResults.innerHTML = branches
            .map(
              (branch, index) =>
                '<li><button type="button" data-i="' +
                index +
                '"><span class="branch-name">' +
                escapeHtml(branch.branchName) +
                '</span><br><span class="branch-code">Cust_Code ' +
                escapeHtml(branch.custCode) +
                (branch.salesman ? ' · ' + escapeHtml(branch.salesman) : '') +
                '</span></button></li>',
            )
            .join('');
          b2bResults.hidden = branches.length === 0;
          b2bResults.dataset.branches = JSON.stringify(branches);
        } catch {
          b2bResults.hidden = true;
        }
      }, 250);
    });
    b2bResults.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-i]');
      if (!button) return;
      const branch = JSON.parse(b2bResults.dataset.branches || '[]')[Number(button.dataset.i)];
      if (!branch) return;
      $$('wiB2bBranchSchool').value = branch.branchName;
      if (branch.lastSalesOrderNumber) $$('wiSalesOrderNumber').value = branch.lastSalesOrderNumber;
      if (branch.salesman) {
        populateSelectOptions('#wiSalesman', salesmenOptions, 'Select a salesman', branch.salesman);
      }
      b2bResults.hidden = true;
      $$('wiB2bLookup').value = '';
    });

    // Duplicate check on the phone number (does not block, only informs).
    let dupSequence = 0;
    async function checkContact() {
      const contact = $$('wiCustomerContact').value.trim();
      const mine = ++dupSequence;
      if (contact.replace(/\D/g, '').length < 7) {
        dup.hidden = true;
        return;
      }
      try {
        const found = await apiRequest(
          '/api/job-cards/walk-in/contact-check?contact=' + encodeURIComponent(contact),
        );
        if (mine !== dupSequence) return;
        const rows = [
          ...found.complaints.map(
            (row) =>
              '<li>Complaint <strong>' +
              escapeHtml(row.reference) +
              '</strong> (' +
              escapeHtml(row.status) +
              ') — ' +
              escapeHtml(row.summary) +
              '</li>',
          ),
          ...found.appointments.map(
            (row) =>
              '<li>Appointment <strong>' +
              escapeHtml(row.reference) +
              '</strong> (' +
              escapeHtml(row.status) +
              ') on ' +
              escapeHtml(row.appointmentDate) +
              '</li>',
          ),
          ...found.walkIns.map(
            (row) =>
              '<li>Walk-in card <strong>' +
              escapeHtml(row.reference) +
              '</strong> (' +
              escapeHtml(row.status) +
              ')' +
              (row.item ? ' — ' + escapeHtml(row.item) : '') +
              '</li>',
          ),
        ];
        dup.hidden = rows.length === 0;
        dup.innerHTML = rows.length
          ? '<strong>This number already has open records.</strong> Check it is not the same repair before opening another card:<ul>' +
            rows.join('') +
            '</ul>'
          : '';
      } catch {
        dup.hidden = true;
      }
    }
    $$('wiCustomerContact').addEventListener('change', checkContact);
    $$('wiCustomerContact').addEventListener('blur', checkContact);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearErrors(form);
      let valid = true;
      const need = (id, message) => {
        if (!$$(id).value.trim()) {
          showFieldError(form, id, message);
          valid = false;
        }
      };
      need('wiCustomerType', 'Select the customer type.');
      need('wiCustomerName', 'Enter the customer name.');
      if ($$('wiCustomerType').value === 'B2B') {
        if (!$$('wiB2bBranchSchool').value.trim() && !$$('wiCustomerContact').value.trim()) {
          showFieldError(
            form,
            'wiB2bBranchSchool',
            'Enter the branch / school or a contact number.',
          );
          valid = false;
        }
      } else {
        need('wiCustomerContact', 'Enter a contact number.');
      }
      need('wiComplaint', 'Describe the fault.');
      if (
        $$('wiCustomerType').value === 'B2C' &&
        $$('wiWarrantyStatus').value === 'In Warranty' &&
        !$$('wiSalesman').value
      ) {
        showFieldError(form, 'wiSalesman', 'Choose the salesman for a B2C job under warranty.');
        valid = false;
      } else if (wiSalesmanNoChannel()) {
        showFieldError(
          form,
          'wiSalesman',
          'This salesman has no sales channel. Contact the admin, or pick the channel by hand.',
        );
        wiChannelPopup($$('wiSalesman').value);
        valid = false;
      }
      if (!$$('wiModelNo').value.trim() && !$$('wiItemDescription').value.trim()) {
        showFieldError(form, 'wiModelNo', 'Enter the model, item code or description.');
        valid = false;
      }
      if (!valid) return;
      const value = (id) => $$(id).value.trim() || undefined;
      const payload = {
        customerName: value('wiCustomerName'),
        customerContact: value('wiCustomerContact'),
        customerAddress: value('wiCustomerAddress'),
        customerNumber: value('wiCustomerNumber'),
        customerType: value('wiCustomerType'),
        customerEmail: value('wiCustomerEmail'),
        region: value('wiRegion'),
        b2bBranchSchool:
          $$('wiCustomerType').value === 'B2B' ? value('wiB2bBranchSchool') : undefined,
        schoolContactPerson:
          $$('wiCustomerType').value === 'B2B' ? value('wiSchoolContactPerson') : undefined,
        schoolContactNumber:
          $$('wiCustomerType').value === 'B2B' ? value('wiSchoolContactNumber') : undefined,
        salesOrderNumber: value('wiSalesOrderNumber'),
        salesman: value('wiSalesman'),
        salesChannel: value('wiSalesChannel'),
        technicianName: value('wiTechnician'),
        brand: value('wiBrand'),
        modelNo: value('wiModelNo'),
        itemDescription: value('wiItemDescription'),
        itemCode: value('wiItemCode'),
        mainGroup: value('wiMainGroup'),
        groupName: value('wiGroup'),
        subGroup: value('wiSubGroup'),
        itemInMaster: readItemInMaster($$('wiModelNo')),
        serialNo: value('wiSerialNo'),
        purchaseDate: $$('wiPurchaseDate').value || undefined,
        invoiceNo: value('wiInvoiceNo'),
        warrantyStatus: value('wiWarrantyStatus'),
        complaint: value('wiComplaint'),
        accessoriesReceived: value('wiAccessories'),
        conditionNotes: value('wiCondition'),
      };
      const button = $$('wiSubmit');
      setBusy(button, true, 'Opening…');
      try {
        const result = await apiRequest('/api/job-cards/walk-in', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        const jobCard = result.jobCard;
        form.hidden = true;
        dup.hidden = true;
        done.hidden = false;
        done.innerHTML =
          '<section class="detail-action-card wi-done"><h4>Walk-in job card opened</h4>' +
          '<p class="wi-ref">' +
          escapeHtml(jobCard.jobCardReference) +
          '</p><div class="card-help"><span>Next step</span>' +
          tipHtml(
            'Print the intake receipt for the customer to sign, then hand the item to the technician.',
          ) +
          '</div>' +
          '<p><button class="button button-primary" type="button" data-wi-print>Print intake receipt</button> ' +
          '<button class="button button-outline" type="button" data-wi-open>Open job card</button> ' +
          '<button class="button button-outline" type="button" data-wi-new>New walk-in</button></p></section>';
        done
          .querySelector('[data-wi-print]')
          .addEventListener('click', () => printWalkInReceipt(jobCard));
        done.querySelector('[data-wi-open]').addEventListener('click', () => {
          setWorkspaceMode('job-cards');
          loadJobCardDetail(jobCard.id);
        });
        done.querySelector('[data-wi-new]').addEventListener('click', () => renderWalkInPage(root));
      } catch (error) {
        setBusy(button, false);
        $$('wiResult').textContent = error.message || 'The job card could not be opened.';
      }
    });
  }

  async function renderRateCardPage(root) {
    root.innerHTML = '<p class="form-note">Loading rates&hellip;</p>';
    let data;
    try {
      data = await apiRequest('/api/rate-card');
    } catch (error) {
      root.innerHTML = '<p class="form-note pg-error">' + escapeHtml(error.message) + '</p>';
      return;
    }
    const byKey = Object.fromEntries(data.sections.map((section) => [section.key, section]));
    const simple = ['warranty_repairs', 'non_warranty_repairs', 'inspections']
      .filter((key) => byKey[key])
      .map((key) => rcActivityCard(byKey[key]))
      .join('');
    const updated = data.updatedAt
      ? 'Last updated ' + escapeHtml(new Date(data.updatedAt).toLocaleDateString('en-GB'))
      : 'Standard rates';
    root.innerHTML =
      '<div class="rcv-banner"><strong>Service rate card</strong><span>' +
      updated +
      ' &middot; All prices in AED, including VAT.</span></div>' +
      '<div class="rcv-grid-top">' +
      simple +
      '</div>' +
      rcModeCard('Delivery & Installations', data.dandi.modes.dandi, data.dandi, true) +
      rcModeCard('Installations', data.dandi.modes.install, data.dandi, false) +
      '<div class="card-help"><span>About this section</span>' +
      tipHtml(
        'Delivery &amp; Installations and Installations are priced from the factors in D+I Admin Entry, so the figures above are starting points rather than final quotes.',
      ) +
      '</div>';
  }

  // --- AMC ------------------------------------------------------------------
  function amcCostPerVisit(data) {
    return (
      ((data.salary * data.technicians) / data.workingDays / data.hoursPerDay) * data.visitHours
    );
  }

  function amcLookupBasicVisits(count, tiers) {
    if (count === 0) return 0;
    let visits = 0;
    [...tiers]
      .sort((a, b) => a[0] - b[0])
      .forEach(([minQty, v]) => {
        if (count >= minQty) visits = v;
      });
    return visits;
  }

  function renderAmcCalc(container, data) {
    // Catalog of appliance types from AMC Admin Rate Section -- used only
    // to populate the "+ Add appliance" dropdown (modification.md #39).
    // The working appliance list below always starts EMPTY: nothing is
    // pre-filled from the master catalog any more, matching the Excel
    // workflow where the user builds the schedule one appliance at a time,
    // each starting at qty 0 / unit value 0.
    const catalog = data.appliances.filter((a) => a.active !== false);
    const appliances = [];

    container.innerHTML =
      '<div class="card-help"><span>About this section</span>' +
      tipHtml(
        'Add each appliance type covered by this contract one at a time (nothing is pre-filled from the admin catalog), enter its quantity and unit value, then read the Basic RM / Standard PMC / Premium PMC contract prices below. Saving stores all 3 plans together; you pick which one to print afterwards. Switch to "AMC Issued" to find and reprint any previously saved contract.',
      ) +
      '</div>' +
      '<div class="vc-tab-nav" role="tablist" aria-label="AMC Quote Calculator sections">' +
      '<button type="button" class="action-tab active" data-ac-tab="quote" role="tab" aria-selected="true">Quote Calculator</button>' +
      '<button type="button" class="action-tab" data-ac-tab="issued" role="tab" aria-selected="false">AMC Issued</button>' +
      '</div>' +
      '<div class="vc-tab-panels">' +
      '<section data-ac-panel="quote">' +
      '<div class="detail-action-card pc-span-full">' +
      '<h4>Appliances for this contract</h4>' +
      (catalog.length
        ? '<div class="field-grid">' +
          calcField(
            'Appliance type',
            '<select data-ac-add-select>' +
              catalog
                .map(
                  (a) =>
                    '<option value="' +
                    escapeHtml(a.name) +
                    '">' +
                    escapeHtml(a.name) +
                    '</option>',
                )
                .join('') +
              '</select>',
          ) +
          '</div>' +
          '<p><button type="button" class="button button-outline" data-ac-add>+ Add appliance</button> ' +
          '<button type="button" class="button button-outline" data-ac-clear>Clear</button></p>'
        : '<p class="form-note">No appliance types are configured in AMC Admin Rate Section yet.</p>' +
          '<p><button type="button" class="button button-outline" data-ac-clear>Clear</button></p>') +
      '<div data-ac-appliances></div>' +
      '</div>' +
      '<div class="detail-action-card pc-span-full">' +
      '<h4>Plan pricing</h4>' +
      '<div data-ac-output></div>' +
      '</div>' +
      '<div class="detail-action-card pc-span-full">' +
      '<h4>Issue an AMC Contract — Customer Certificate</h4>' +
      '<div data-ac-sale></div>' +
      '</div>' +
      '</section>' +
      '<section data-ac-panel="issued" hidden>' +
      '<h4>AMC Issued ' +
      tipHtml(
        'Every AMC contract saved from the calculator above, with all 3 plans’ numbers stored. Pick a plan and Print to generate that plan’s certificate. A saved record is a Quote until you pick the plan the customer took and press Sold; only Sold contracts count as AMC revenue (ex-VAT, in the contract start month).',
      ) +
      '</h4>' +
      '<div data-ac-issued></div>' +
      '</section>' +
      '</div>';

    const tabNav = container.querySelector('.vc-tab-nav');
    const panels = Array.from(container.querySelectorAll('[data-ac-panel]'));
    const issuedHost = container.querySelector('[data-ac-issued]');
    tabNav.addEventListener('click', (event) => {
      const button = event.target.closest('.action-tab');
      if (!button) return;
      const target = button.dataset.acTab;
      tabNav.querySelectorAll('.action-tab').forEach((tab) => {
        const active = tab === button;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      panels.forEach((panel) => {
        panel.hidden = panel.dataset.acPanel !== target;
      });
      if (target === 'issued') {
        loadAmcIssuedList(issuedHost);
      }
    });

    const appliancesHost = container.querySelector('[data-ac-appliances]');
    const output = container.querySelector('[data-ac-output]');
    const saleHost = container.querySelector('[data-ac-sale]');
    const clearButton = container.querySelector('[data-ac-clear]');
    const addButton = container.querySelector('[data-ac-add]');
    const addSelect = container.querySelector('[data-ac-add-select]');

    // The 3 computed plan rows from the most recent recompute() -- null
    // whenever there are no appliances (or none with a quantity > 0) --
    // read by the Issue-a-Contract section below when Save is clicked, so
    // it always saves the exact numbers currently on screen.
    let lastRows = null;

    function renderAppliancesTable() {
      if (!appliances.length) {
        appliancesHost.innerHTML =
          '<p class="form-note">No appliances added yet. Pick an appliance type above and click "+ Add appliance".</p>';
        return;
      }
      appliancesHost.innerHTML =
        '<div class="table-wrap"><table style="table-layout: fixed"><thead><tr>' +
        '<th style="width: 35%">Appliance</th><th style="width: 15%">Qty</th><th style="width: 20%">Unit value (AED)</th><th style="width: 20%">Total value (AED)</th><th style="width: 10%"></th>' +
        '</tr></thead><tbody>' +
        appliances
          .map(
            (a, i) =>
              '<tr><td>' +
              escapeHtml(a.name) +
              '</td><td><input type="number" min="0" step="1" value="' +
              a.qty +
              '" data-ac-qty="' +
              i +
              '" /></td><td><input type="number" min="0" step="0.01" value="' +
              a.price +
              '" data-ac-price="' +
              i +
              '" /></td><td data-ac-total="' +
              i +
              '">' +
              money(a.qty * a.price) +
              '</td><td><button type="button" class="button button-outline" data-ac-remove="' +
              i +
              '">Remove</button></td></tr>',
          )
          .join('') +
        '</tbody></table></div>';
      // Updates this row's own "Total value" cell in place -- the Plan
      // pricing card below already recomputes from the live appliances
      // array on every keystroke, but that card doesn't touch the
      // appliance table's own total column, so it needs its own update
      // here (otherwise it stays frozen at whatever it showed when the
      // table was last rebuilt).
      function updateRowTotal(index) {
        const cell = appliancesHost.querySelector('[data-ac-total="' + index + '"]');
        if (cell) cell.textContent = money(appliances[index].qty * appliances[index].price);
      }
      appliancesHost.querySelectorAll('[data-ac-qty]').forEach((input) => {
        input.addEventListener('input', () => {
          const index = Number(input.getAttribute('data-ac-qty'));
          appliances[index].qty = parseNumber(input.value);
          updateRowTotal(index);
          recompute();
        });
      });
      appliancesHost.querySelectorAll('[data-ac-price]').forEach((input) => {
        input.addEventListener('input', () => {
          const index = Number(input.getAttribute('data-ac-price'));
          appliances[index].price = parseNumber(input.value);
          updateRowTotal(index);
          recompute();
        });
      });
      appliancesHost.querySelectorAll('[data-ac-remove]').forEach((button) => {
        button.addEventListener('click', () => {
          appliances.splice(Number(button.getAttribute('data-ac-remove')), 1);
          renderAppliancesTable();
          recompute();
        });
      });
    }

    function planFor(visits, partsReserveRate, pct, totalValue, costPerVisit) {
      const labor = visits * costPerVisit;
      const transport = visits * data.transportPerVisit;
      const parts = Math.max(totalValue * (partsReserveRate || 0), 0);
      const direct = labor + transport + parts;
      const overhead = direct * data.overhead;
      const priceExclVat = Math.max(
        direct + overhead + (direct + overhead) * data.profitMarkup,
        totalValue * pct,
      );
      const priceInclVat = priceExclVat * 1.05;
      return { visits, labor, transport, parts, direct, overhead, priceExclVat, priceInclVat };
    }

    function recompute() {
      const totalCount = appliances.reduce((s, a) => s + a.qty, 0);
      const totalValue = appliances.reduce((s, a) => s + a.qty * a.price, 0);

      // Dynamic, like VAS's empty-price state: no appliances (or none with
      // a quantity entered yet) means no plan pricing shown at all, rather
      // than quietly pricing a 0 AED contract (modification.md #39).
      if (!appliances.length || totalCount <= 0) {
        lastRows = null;
        output.innerHTML = appliances.length
          ? '<p class="form-note">Enter a quantity for at least one appliance above to see plan pricing.</p>'
          : '<p class="form-note">Add at least one appliance above to see plan pricing.</p>';
        return;
      }

      const costPerVisit = amcCostPerVisit(data);

      const basicVisits = amcLookupBasicVisits(totalCount, data.basicVisitTiers);
      const standardVisits = Math.ceil(
        (totalCount * data.standardPct * (1 + data.riskUplift) * data.standardVisits) /
          data.handledPerVisit,
      );
      const premiumVisits = Math.ceil(
        (totalCount * data.premiumPct * (1 + data.riskUplift) * data.premiumVisits) /
          data.handledPerVisit,
      );

      const rows = [
        ['Basic RM', planFor(basicVisits, 0, data.basicPct, totalValue, costPerVisit)],
        [
          'Standard PMC',
          planFor(
            standardVisits,
            data.standardPartsReserve,
            data.standardPct,
            totalValue,
            costPerVisit,
          ),
        ],
        [
          'Premium PMC',
          planFor(
            premiumVisits,
            data.premiumPartsReserve,
            data.premiumPct,
            totalValue,
            costPerVisit,
          ),
        ],
      ];

      lastRows = rows;

      output.innerHTML =
        '<p class="form-note">Total appliances: <strong>' +
        totalCount +
        '</strong> &middot; Total equipment value: <strong>' +
        money(totalValue) +
        ' AED</strong></p>' +
        '<div class="table-wrap"><table style="table-layout: fixed"><thead><tr>' +
        '<th>Plan</th><th>Annual visits</th><th>Labor cost</th><th>Transport cost</th><th>Parts reserve</th><th>Direct cost</th><th>Overhead</th><th>Price (excl. VAT)</th><th>Price (incl. 5% VAT)</th>' +
        '</tr></thead><tbody>' +
        rows
          .map(
            ([label, p]) =>
              '<tr><td>' +
              escapeHtml(label) +
              '</td><td>' +
              p.visits +
              '</td><td>' +
              money(p.labor) +
              '</td><td>' +
              money(p.transport) +
              '</td><td>' +
              money(p.parts) +
              '</td><td>' +
              money(p.direct) +
              '</td><td>' +
              money(p.overhead) +
              '</td><td><strong>' +
              money(p.priceExclVat) +
              '</strong></td><td><strong>' +
              money(p.priceInclVat) +
              '</strong></td></tr>',
          )
          .join('') +
        '</tbody></table></div>';
    }

    // Empties the appliance list entirely -- used by the explicit Clear
    // button and automatically once an AMC contract has been saved, so
    // the next customer's contract starts from nothing, not the previous
    // customer's numbers or the admin catalog's defaults (modification.md
    // #39 -- Clear must actually clear, the same fix VAS got in #37).
    function clearAppliances() {
      appliances.length = 0;
      renderAppliancesTable();
      recompute();
    }

    if (addButton) {
      addButton.addEventListener('click', () => {
        if (!addSelect || !addSelect.value) return;
        appliances.push({ name: addSelect.value, qty: 0, price: 0 });
        renderAppliancesTable();
        recompute();
      });
    }
    clearButton.addEventListener('click', clearAppliances);
    renderAppliancesTable();
    recompute();
    renderAmcContractSection(
      saleHost,
      appliances,
      () => lastRows,
      clearAppliances,
      () => {
        // Keep the AMC Issued list in sync if it's the tab currently open.
        const issuedPanel = container.querySelector('[data-ac-panel="issued"]');
        if (issuedPanel && !issuedPanel.hidden) loadAmcIssuedList(issuedHost);
      },
    );
  }

  // Lists every saved amc_contracts record (modification.md #38/#39) so a
  // previously issued AMC contract can be found again and a chosen plan's
  // certificate reprinted. Each saved record carries all 3 computed plans
  // -- the plan to print is picked per row, per print, from a dropdown.
  async function loadAmcIssuedList(host) {
    if (!hasPermission('amc_contract.read')) {
      host.innerHTML =
        '<p class="form-note">You don\'t have permission to view issued AMC contracts.</p>';
      return;
    }
    const canChangeStatus = hasPermission('amc_contract.write');
    host.innerHTML = '<p class="form-note">Loading issued AMC contracts&hellip;</p>';
    try {
      const response = await apiRequest('/api/amc-contracts?pageSize=100');
      const contracts = response.amcContracts || [];
      if (!contracts.length) {
        host.innerHTML = '<p class="form-note">No AMC contracts issued yet.</p>';
        return;
      }
      host.innerHTML =
        '<div class="table-wrap"><table><thead><tr>' +
        '<th>Reference</th><th>Issued</th><th>Client</th><th>Total appliances</th><th>Status</th><th>Plan</th><th>Price incl. VAT</th><th></th>' +
        '</tr></thead><tbody>' +
        contracts
          .map((c) => {
            const plans = c.plans || [];
            const defaultPlan =
              (c.soldPlanKey && plans.find((p) => p.planKey === c.soldPlanKey)) ||
              plans[plans.length - 1] ||
              plans[0];
            return (
              '<tr>' +
              '<td>' +
              escapeHtml(c.amcContractReference) +
              '</td><td>' +
              escapeHtml(formatDate(c.createdAt)) +
              '</td><td>' +
              escapeHtml(c.clientName || '—') +
              '</td><td>' +
              escapeHtml(String(c.totalCount)) +
              '</td><td><span class="status ' +
              (c.status === 'Sold' ? 'status-ok' : c.status === 'Lost' ? '' : 'status-warn') +
              '">' +
              escapeHtml(c.status || 'Quote') +
              '</span>' +
              (c.status === 'Sold'
                ? '<br><small>' +
                  escapeHtml(c.soldPlanLabel || '') +
                  ' &middot; ' +
                  escapeHtml(c.soldDate || '') +
                  ' &middot; ' +
                  money(c.soldPriceExclVat) +
                  ' ex-VAT</small>'
                : c.status === 'Lost' && c.lostReason
                  ? '<br><small>' + escapeHtml(c.lostReason) + '</small>'
                  : '') +
              '</td><td><select data-ac-plan-select="' +
              escapeHtml(c.id) +
              '">' +
              plans
                .map(
                  (p) =>
                    '<option value="' +
                    escapeHtml(p.planKey) +
                    '"' +
                    (defaultPlan && p.planKey === defaultPlan.planKey ? ' selected' : '') +
                    '>' +
                    escapeHtml(p.planLabel) +
                    '</option>',
                )
                .join('') +
              '</select></td><td data-ac-price-cell="' +
              escapeHtml(c.id) +
              '">' +
              money(defaultPlan ? defaultPlan.priceInclVat : 0) +
              ' AED</td><td>' +
              '<button type="button" class="button button-outline" data-ac-reprint="' +
              escapeHtml(c.id) +
              '">Print</button>' +
              (canChangeStatus
                ? c.status === 'Quote' || !c.status
                  ? ' <input type="date" data-ac-sold-date="' +
                    escapeHtml(c.id) +
                    '" value="' +
                    escapeHtml(pgYmd(new Date())) +
                    '" title="Sold date"> <button type="button" class="button button-primary" data-ac-status="Sold" data-ac-id="' +
                    escapeHtml(c.id) +
                    '" title="Mark as sold with the plan selected">Sold</button> <button type="button" class="button button-outline" data-ac-status="Lost" data-ac-id="' +
                    escapeHtml(c.id) +
                    '">Lost</button>'
                  : ' <button type="button" class="button button-outline" data-ac-status="Quote" data-ac-id="' +
                    escapeHtml(c.id) +
                    '">Reopen</button>'
                : '') +
              '</td></tr>'
            );
          })
          .join('') +
        '</tbody></table></div>';
      host.querySelectorAll('[data-ac-plan-select]').forEach((select) => {
        select.addEventListener('change', () => {
          const id = select.getAttribute('data-ac-plan-select');
          const contract = contracts.find((c) => String(c.id) === String(id));
          const plan =
            contract && contract.plans && contract.plans.find((p) => p.planKey === select.value);
          const cell = host.querySelector('[data-ac-price-cell="' + id + '"]');
          if (cell && plan) cell.textContent = money(plan.priceInclVat) + ' AED';
        });
      });
      host.querySelectorAll('[data-ac-status]').forEach((button) => {
        button.addEventListener('click', async () => {
          const id = button.getAttribute('data-ac-id');
          const status = button.getAttribute('data-ac-status');
          const payload = { status };
          if (status === 'Sold') {
            const select = host.querySelector('[data-ac-plan-select="' + id + '"]');
            const date = host.querySelector('[data-ac-sold-date="' + id + '"]');
            payload.planKey = select ? select.value : '';
            payload.soldDate = date ? date.value : '';
          } else if (status === 'Lost') {
            const reason = window.prompt('Why was this AMC quote lost? (optional)') || '';
            if (reason.trim()) payload.reason = reason.trim();
          }
          button.disabled = true;
          try {
            await apiRequest('/api/amc-contracts/' + id + '/status', {
              method: 'PATCH',
              body: JSON.stringify(payload),
            });
            await loadAmcIssuedList(host);
          } catch (error) {
            setMessage('#workspaceMessage', error.message || 'Could not change the status.');
            button.disabled = false;
          }
        });
      });
      host.querySelectorAll('[data-ac-reprint]').forEach((button) => {
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            const id = button.getAttribute('data-ac-reprint');
            const select = host.querySelector('[data-ac-plan-select="' + id + '"]');
            const detail = await apiRequest('/api/amc-contracts/' + id);
            printAmcContractCertificate(detail.amcContract, select ? select.value : undefined);
          } catch (error) {
            setMessage(
              '#workspaceMessage',
              'Could not load this AMC contract: ' + (error.message || 'unknown error'),
            );
          } finally {
            button.disabled = false;
          }
        });
      });
    } catch (error) {
      host.innerHTML = '<p class="form-note">Could not load issued AMC contracts.</p>';
    }
  }

  // Fills in the "Issue an AMC Contract -- Customer Certificate" section
  // (modification.md #38/#39): fills in client/site details and saves a
  // normalized amc_contracts record carrying the appliance schedule and
  // ALL 3 computed plans -- no plan is chosen at save time, matching the
  // Excel workflow where which plan prints is decided afterwards. After a
  // successful save, the appliances and the contract form both reset for
  // the next customer -- a "Plan to print" dropdown + Print button stay
  // enabled against the just-saved record, and onSaved() refreshes the
  // "AMC Issued" tab if it's open.
  function renderAmcContractSection(saleHost, appliances, getRows, clearAppliances, onSaved) {
    if (!hasPermission('amc_contract.write')) {
      saleHost.innerHTML =
        '<p class="form-note">You don\'t have permission to issue AMC contracts.</p>';
      return;
    }
    saleHost.innerHTML =
      '<div class="card-help"><span>About this section</span>' +
      tipHtml(
        'Fill in the client &amp; site details and save the contract — all 3 plans’ numbers are stored together, and you pick which one to print below (or any time from "AMC Issued").',
      ) +
      '</div>' +
      '<div class="field-grid">' +
      calcField('Contract period', '<input type="text" value="1 Year" data-as-period />') +
      calcField('Client', '<input type="text" data-as-client />') +
      calcField('Attention to', '<input type="text" data-as-attention />') +
      calcField('Site / location', '<input type="text" data-as-location />') +
      calcField('Commencement date', '<input type="date" data-as-commencement />') +
      calcField(
        'Contract ref.',
        '<input type="text" data-as-contract-ref />',
        'Optional — auto-generated if left blank',
      ) +
      '</div>' +
      '<p><button type="button" class="button button-primary" data-as-save>Save AMC contract</button></p>' +
      '<div data-as-message></div>' +
      '<div class="field-grid">' +
      calcField(
        'Plan to print',
        '<select data-as-print-plan disabled><option value="">Save first to choose a plan</option></select>',
      ) +
      '</div>' +
      '<p><button type="button" class="button button-outline" data-as-print disabled>Print certificate</button></p>';

    const saveButton = saleHost.querySelector('[data-as-save]');
    const printPlanSelect = saleHost.querySelector('[data-as-print-plan]');
    const printButton = saleHost.querySelector('[data-as-print]');
    const messageHost = saleHost.querySelector('[data-as-message]');
    let savedContract = null;

    function clearContractFormInputs() {
      saleHost.querySelectorAll('.field-grid input[type="text"]').forEach((el) => {
        el.value = '';
      });
      saleHost.querySelectorAll('.field-grid input[type="date"]').forEach((el) => {
        el.value = '';
      });
      saleHost.querySelector('[data-as-period]').value = '1 Year';
    }

    saveButton.addEventListener('click', async () => {
      savedContract = null;
      printPlanSelect.innerHTML = '<option value="">Save first to choose a plan</option>';
      printPlanSelect.disabled = true;
      printButton.disabled = true;
      messageHost.innerHTML = '';
      const totalCount = appliances.reduce((s, a) => s + a.qty, 0);
      if (totalCount <= 0) {
        messageHost.innerHTML =
          '<p class="form-note">Add at least one appliance with a quantity above before saving.</p>';
        return;
      }
      const rows = getRows();
      if (!rows) {
        messageHost.innerHTML =
          '<p class="form-note">Could not find pricing for the appliances above -- adjust the quantities first.</p>';
        return;
      }
      const totalValue = appliances.reduce((s, a) => s + a.qty * a.price, 0);
      const plans = Object.keys(AMC_CONTRACT_PLAN_FALLBACKS).map((planKey) => {
        const fallback = AMC_CONTRACT_PLAN_FALLBACKS[planKey];
        const rowEntry = rows.find(([label]) => label === fallback.label);
        const plan = rowEntry[1];
        return {
          planKey,
          planLabel: fallback.label,
          coverage: fallback.coverage,
          coverageDetail: fallback.coverageDetail,
          included: fallback.included,
          notIncluded: fallback.notIncluded,
          visitsText: plan.visits + ' visits/year',
          annualVisits: plan.visits,
          laborCost: plan.labor,
          transportCost: plan.transport,
          partsReserve: plan.parts,
          directCost: plan.direct,
          overhead: plan.overhead,
          priceExclVat: plan.priceExclVat,
          priceInclVat: plan.priceInclVat,
        };
      });
      const field = (selector) => saleHost.querySelector(selector).value.trim();
      const payload = {
        contractPeriod: field('[data-as-period]') || undefined,
        clientName: field('[data-as-client]') || undefined,
        attentionTo: field('[data-as-attention]') || undefined,
        siteLocation: field('[data-as-location]') || undefined,
        appliances: appliances.map((a) => ({ name: a.name, qty: a.qty, price: a.price })),
        totalCount,
        totalValue,
        plans,
        commencementDate: field('[data-as-commencement]') || undefined,
        contractRef: field('[data-as-contract-ref]') || undefined,
      };
      try {
        const response = await apiRequest('/api/amc-contracts', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        savedContract = response.amcContract;
        messageHost.innerHTML =
          '<p class="form-note">Saved as <strong>' +
          escapeHtml(savedContract.amcContractReference) +
          '</strong> and added to the "AMC Issued" tab. Pick a plan below to print, or reprint it any time from AMC Issued. The appliances have been reset for the next contract.</p>';
        printPlanSelect.innerHTML = savedContract.plans
          .map(
            (p) =>
              '<option value="' +
              escapeHtml(p.planKey) +
              '">' +
              escapeHtml(p.planLabel) +
              ' — ' +
              money(p.priceInclVat) +
              ' AED incl. VAT</option>',
          )
          .join('');
        printPlanSelect.disabled = false;
        printButton.disabled = false;
        clearContractFormInputs();
        clearAppliances();
        onSaved();
      } catch (error) {
        messageHost.innerHTML =
          '<p class="form-note">Could not save the AMC contract: ' +
          escapeHtml(error.message || 'unknown error') +
          '</p>';
      }
    });

    printButton.addEventListener('click', () => {
      if (!savedContract) return;
      printAmcContractCertificate(savedContract, printPlanSelect.value);
    });
  }

  // --- Thomson --------------------------------------------------------------
  function thomsonCalcTier(qty) {
    if (qty >= 500) return '500+';
    if (qty >= 300) return '300+';
    if (qty >= 150) return '150+';
    if (qty >= 50) return '50+';
    return 'Base';
  }

  function thomsonCalcUnitRate(appliance, qty) {
    const tier = thomsonCalcTier(qty);
    return tier === 'Base' ? appliance.rates.Base : appliance.rates[tier];
  }

  function printThomsonLineItemsTable(lineItems) {
    const rows = (lineItems || [])
      .map(
        (li) =>
          `<tr><td>${escapeHtml(li.region)}</td><td>${escapeHtml(li.applianceName)}</td><td class="num">${escapeHtml(String(li.qty))}</td><td class="num">${money(li.unitRate)} AED</td><td class="num">${money(li.applianceSubtotal)} AED</td><td class="num">${money(li.addonRevenue)} AED</td><td class="num">${money(li.transportCost)} AED</td><td class="num">${money(li.totalPrice)} AED</td></tr>`,
      )
      .join('');
    return `<table><thead><tr><th>Region</th><th>Appliance</th><th class="num">Qty</th><th class="num">Unit rate</th><th class="num">Appliance subtotal</th><th class="num">Add-on revenue</th><th class="num">Transport cost</th><th class="num">Total price</th></tr></thead><tbody>${
      rows || '<tr><td colspan="8" style="text-align:center;color:#888;">No lines</td></tr>'
    }</tbody></table>`;
  }

  function buildThomsonSaleCertificateBody(sale) {
    return `
      ${printDocHeadWithLogo('Thomson Project Quotation', sale.thomsonSaleReference)}
      <h2>Quotation details</h2>
      ${printFieldGrid([
        ['Sale date', sale.saleDate],
        ['Client', sale.clientName],
        ['Contact number', sale.contactNumber],
        ['Site / location', sale.siteLocation],
        ['Customer transport share', String(sale.transportSharePercent) + '%'],
        ['Contract ref.', sale.contractRef || sale.thomsonSaleReference],
      ])}
      <h2>Project lines</h2>
      ${printThomsonLineItemsTable(sale.lineItems)}
      <div class="cert-feebox">
        <div class="fee">${money(sale.totalPrice)} AED</div>
        <div>Total project price</div>
      </div>
      <h2>Signatures</h2>
      <p style="font-size:11px;color:#444;">By signing below, the client confirms acceptance of this quotation's scope, pricing and payment terms.</p>
      <div class="sign-row">
        <div class="sign-box">For Jacky's Distribution LLC &mdash; name / designation / date / signature &amp; company stamp</div>
        <div class="sign-box">For Client Acceptance &mdash; name / designation / date / signature &amp; company stamp (if applicable)</div>
      </div>
      <p style="font-size:9.5px;color:#777;font-style:italic;margin-top:16px;">This document is issued by Jacky's Distribution LLC Service Department, governed by the laws of the United Arab Emirates. Prices are in AED. This quotation is valid for 30 days from the date shown above unless otherwise agreed in writing.</p>
    `;
  }

  function printThomsonSaleCertificate(sale) {
    if (!sale) return;
    const title = `Thomson Quotation ${sale.thomsonSaleReference || ''}`;
    openPrintWindow(printDocumentShell(title, buildThomsonSaleCertificateBody(sale)));
  }

  function renderThomsonCalc(container, data) {
    const regions = data.regions.filter((r) => r.active !== false);
    const appliances = data.appliances.filter((a) => a.active !== false);
    // The 4 "Additional Services" rows from Thomson Pricing Admin, as a
    // mutable working copy -- a pricing_config.write user can amend these
    // for this quote only (modification.md #48); editing them never writes
    // back to the saved admin defaults in data.addons.
    const THOMSON_ADDON_NAMES = [
      'Project Management Fee',
      'Site Survey',
      'Testing & Commissioning',
      'Training (End User)',
    ];
    const canAmendAddons = hasPermission('pricing_config.write');
    function cloneAddonDefaults() {
      return THOMSON_ADDON_NAMES.reduce((acc, name) => {
        const entry = data.addons[name] || {};
        acc[name] = {
          rate: Number(entry.rate) || 0,
          hours: Number(entry.hours) || 0,
          note: entry.note || '',
        };
        return acc;
      }, {});
    }
    let addons = cloneAddonDefaults();
    const teamCapacity = data.techCount * data.hoursDay;
    const lineItems = [];
    // The most recently computed line rows (null whenever there are no
    // lines) -- read by the Issue-a-Sale section below when Save is
    // clicked, so it always saves the exact numbers currently on screen,
    // same pattern as AMC's lastRows (modification.md #39).
    let lastComputed = null;

    container.innerHTML =
      '<div class="card-help"><span>About this section</span>' +
      tipHtml(
        'Add project line items (region + appliance + quantity), then read the total project price, cost and margin off the bottom row. Matches the workbook’s “Project Pricing Calculator” section exactly. Switch to "Thomson Issued" to find and reprint any previously saved sale.',
      ) +
      '</div>' +
      '<div class="vc-tab-nav" role="tablist" aria-label="Thomson Quote Calculator sections">' +
      '<button type="button" class="action-tab active" data-th-tab="quote" role="tab" aria-selected="true">Quote Calculator</button>' +
      '<button type="button" class="action-tab" data-th-tab="issued" role="tab" aria-selected="false">Thomson Issued</button>' +
      '</div>' +
      '<div class="vc-tab-panels">' +
      '<section data-th-panel="quote">' +
      '<div class="pc-split-grid">' +
      '<div class="detail-action-card">' +
      '<h4>Add a line</h4>' +
      '<div class="field-grid">' +
      calcField(
        'Region',
        '<select data-tcc-region>' +
          regions
            .map(
              (r) =>
                '<option value="' + escapeHtml(r.name) + '">' + escapeHtml(r.name) + '</option>',
            )
            .join('') +
          '</select>',
      ) +
      calcField(
        'Appliance',
        '<select data-tcc-appliance>' +
          appliances
            .map((a, i) => '<option value="' + i + '">' + escapeHtml(a.name) + '</option>')
            .join('') +
          '</select>',
      ) +
      calcField('Qty', '<input type="number" min="0" step="1" value="1" data-tcc-qty />') +
      calcField(
        'Site visits',
        '<input type="number" min="0" step="1" value="1" data-tcc-visits />',
      ) +
      calcField(
        'Training sessions',
        '<input type="number" min="0" step="1" value="0" data-tcc-training />',
      ) +
      '</div>' +
      '<div class="form-footer">' +
      '<button class="button button-primary" type="button" data-tcc-add>Add line</button> ' +
      '<button class="button button-outline" type="button" data-tcc-clear>Clear</button>' +
      '</div>' +
      '</div>' +
      '<div class="detail-action-card">' +
      '<h4>Transport ' +
      tipHtml(
        'The rest of the transport cost is absorbed by us (matches the workbook’s default of 0%).',
      ) +
      '</h4>' +
      calcField(
        'Customer transport share %',
        '<input type="number" min="0" max="100" step="1" value="0" data-tcc-transport-share />',
      ) +
      '</div>' +
      '<div class="detail-action-card pc-span-full">' +
      '<div class="card-row-header"><h4>Additional Services ' +
      tipHtml(
        canAmendAddons
          ? 'Rates come from Thomson Pricing Admin. Amend them below to override for this quote only — this never changes the saved admin defaults.'
          : 'Rates used in this quote, set in Thomson Pricing Admin.',
      ) +
      '</h4>' +
      (canAmendAddons
        ? '<button class="button button-outline" type="button" data-tcc-addons-reset>Reset to admin defaults</button>'
        : '') +
      '</div>' +
      '<div data-tcc-addons></div>' +
      '</div>' +
      '<div class="detail-action-card pc-span-full">' +
      '<div class="card-row-header"><h4>Quote</h4><span class="live-pill" data-tcc-live-pill>Live</span></div>' +
      '<div data-tcc-table></div>' +
      '</div>' +
      '<div class="detail-action-card pc-span-full">' +
      '<h4>Issue a Thomson Sale — Printable Quotation</h4>' +
      '<div data-tcc-sale></div>' +
      '</div>' +
      '</div>' +
      '</section>' +
      '<section data-th-panel="issued" hidden>' +
      '<h4>Thomson Issued ' +
      tipHtml(
        'Every Thomson sale saved from the calculator above. Print re-opens that exact quotation.',
      ) +
      '</h4>' +
      '<div data-tcc-issued></div>' +
      '</section>' +
      '</div>';

    const tabNav = container.querySelector('.vc-tab-nav');
    const panels = Array.from(container.querySelectorAll('[data-th-panel]'));
    const issuedHost = container.querySelector('[data-tcc-issued]');
    tabNav.addEventListener('click', (event) => {
      const button = event.target.closest('.action-tab');
      if (!button) return;
      const target = button.dataset.thTab;
      tabNav.querySelectorAll('.action-tab').forEach((tab) => {
        const active = tab === button;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      panels.forEach((panel) => {
        panel.hidden = panel.dataset.thPanel !== target;
      });
      if (target === 'issued') {
        loadThomsonIssuedList(issuedHost);
      }
    });

    const regionSelect = container.querySelector('[data-tcc-region]');
    const applianceSelect = container.querySelector('[data-tcc-appliance]');
    const qtyInput = container.querySelector('[data-tcc-qty]');
    const visitsInput = container.querySelector('[data-tcc-visits]');
    const trainingInput = container.querySelector('[data-tcc-training]');
    const addButton = container.querySelector('[data-tcc-add]');
    const clearButton = container.querySelector('[data-tcc-clear]');
    const transportShareInput = container.querySelector('[data-tcc-transport-share]');
    const tableHost = container.querySelector('[data-tcc-table]');
    const saleHost = container.querySelector('[data-tcc-sale]');
    const livePill = container.querySelector('[data-tcc-live-pill]');
    const addonsHost = container.querySelector('[data-tcc-addons]');
    const addonsResetButton = container.querySelector('[data-tcc-addons-reset]');

    // Renders the "Additional Services" table -- editable inputs for a
    // pricing_config.write user, plain values for everyone else (they can
    // still see which rates this quote is using, just not change them).
    function renderAddonsTable() {
      addonsHost.innerHTML =
        '<div class="table-wrap"><table><thead><tr>' +
        '<th>Service</th><th>Rate (or % for PM fee)</th><th>Technician hours</th><th>Note</th>' +
        '</tr></thead><tbody>' +
        THOMSON_ADDON_NAMES.map((name, i) => {
          const entry = addons[name];
          return (
            '<tr><td>' +
            escapeHtml(name) +
            '</td><td>' +
            (canAmendAddons
              ? '<input type="number" step="0.01" value="' +
                entry.rate +
                '" data-tcc-addon-rate="' +
                i +
                '" />'
              : escapeHtml(String(entry.rate))) +
            '</td><td>' +
            (canAmendAddons
              ? '<input type="number" step="0.25" value="' +
                entry.hours +
                '" data-tcc-addon-hours="' +
                i +
                '" />'
              : escapeHtml(String(entry.hours))) +
            '</td><td>' +
            escapeHtml(entry.note || '') +
            '</td></tr>'
          );
        }).join('') +
        '</tbody></table></div>';
      if (!canAmendAddons) return;
      addonsHost.querySelectorAll('[data-tcc-addon-rate]').forEach((input) => {
        input.addEventListener('input', () => {
          addons[THOMSON_ADDON_NAMES[Number(input.dataset.tccAddonRate)]].rate = parseNumber(
            input.value,
          );
          renderTable();
        });
      });
      addonsHost.querySelectorAll('[data-tcc-addon-hours]').forEach((input) => {
        input.addEventListener('input', () => {
          addons[THOMSON_ADDON_NAMES[Number(input.dataset.tccAddonHours)]].hours = parseNumber(
            input.value,
          );
          renderTable();
        });
      });
    }

    // Briefly flashes the "Live" pill -- called every time renderTable()
    // actually re-renders, so a Transport % edit (or adding/removing a
    // line) gives a visible confirmation the Quote table just updated
    // (modification.md #47).
    function flashLivePill() {
      if (!livePill) return;
      livePill.classList.remove('is-flashing');
      // Force a reflow so the animation restarts even if triggered again
      // before the previous flash finished.
      void livePill.offsetWidth;
      livePill.classList.add('is-flashing');
      setTimeout(() => livePill.classList.remove('is-flashing'), 520);
    }

    function computeLine(li) {
      const region = regions.find((r) => r.name === li.region) || regions[0];
      const appliance = appliances[li.applianceIdx];
      const tier = thomsonCalcTier(li.qty);
      const baseRate = appliance.rates.Base;
      const unitRate = thomsonCalcUnitRate(appliance, li.qty);
      const applianceSubtotal = li.qty * unitRate;
      const installLaborCost = li.qty * (appliance.avgMin / 60) * data.techRate;
      const installDays =
        teamCapacity > 0 ? Math.ceil((li.qty * (appliance.avgMin / 60)) / teamCapacity) : 0;
      const testingTotal = li.qty * addons['Testing & Commissioning'].rate;
      const pmFee = applianceSubtotal * addons['Project Management Fee'].rate;
      const addonRevenue =
        li.siteVisits * addons['Site Survey'].rate +
        li.trainingSessions * addons['Training (End User)'].rate +
        testingTotal +
        pmFee;
      const addonServicesCost =
        li.siteVisits * addons['Site Survey'].hours * data.techRate +
        li.qty * addons['Testing & Commissioning'].hours * data.techRate +
        li.trainingSessions * addons['Training (End User)'].hours * data.techRate;
      const totalTrips = installDays + li.siteVisits + li.trainingSessions;
      const transportCost = totalTrips * region.roundTripCost;
      const transportSharePct = parseNumber(transportShareInput.value) / 100;
      const customerTransportCharge = transportCost * transportSharePct;
      const totalPrice = applianceSubtotal + addonRevenue + customerTransportCharge;
      const totalCost = installLaborCost + addonServicesCost + transportCost;
      const margin = totalPrice - totalCost;
      return {
        ...li,
        applianceName: appliance.name,
        tier,
        baseRate,
        unitRate,
        applianceSubtotal,
        addonRevenue,
        transportCost,
        totalPrice,
        totalCost,
        margin,
      };
    }

    function renderTable() {
      flashLivePill();
      if (!lineItems.length) {
        tableHost.innerHTML = '<p class="empty-state">No lines added yet.</p>';
        lastComputed = null;
        return;
      }
      const computed = lineItems.map(computeLine);
      lastComputed = computed;
      const totalPrice = computed.reduce((s, c) => s + c.totalPrice, 0);
      const totalCost = computed.reduce((s, c) => s + c.totalCost, 0);
      const margin = totalPrice - totalCost;
      const marginPct = totalPrice ? (margin / totalPrice) * 100 : 0;
      tableHost.innerHTML =
        '<div class="table-wrap"><table class="calc-quote-table" style="table-layout: fixed"><thead><tr>' +
        '<th style="width: 8%">Region</th><th style="width: 15%">Appliance</th><th style="width: 5%">Qty</th><th style="width: 11%">Unit rate</th><th style="width: 11%">Appliance subtotal</th><th style="width: 10%">Add-on revenue</th><th style="width: 10%">Transport cost</th><th style="width: 9%">Total price</th><th style="width: 9%">Total cost</th><th style="width: 9%">Margin</th><th style="width: 3%"></th>' +
        '</tr></thead><tbody>' +
        computed
          .map(
            (c, i) =>
              '<tr><td>' +
              escapeHtml(c.region) +
              '</td><td>' +
              escapeHtml(c.applianceName) +
              '</td><td>' +
              c.qty +
              '</td><td>' +
              money(c.unitRate) +
              (c.tier === 'Base'
                ? '<span class="cell-sub">Base rate</span>'
                : '<span class="cell-sub">Tier ' +
                  escapeHtml(c.tier) +
                  ' &middot; base ' +
                  money(c.baseRate) +
                  '</span>') +
              '</td><td>' +
              money(c.applianceSubtotal) +
              '</td><td>' +
              money(c.addonRevenue) +
              '</td><td>' +
              money(c.transportCost) +
              '</td><td>' +
              money(c.totalPrice) +
              '</td><td>' +
              money(c.totalCost) +
              '</td><td>' +
              money(c.margin) +
              '</td><td><button class="button button-outline" type="button" data-tcc-remove="' +
              i +
              '">Remove</button></td></tr>',
          )
          .join('') +
        '</tbody><tfoot><tr><td colspan="7"><strong>Grand total</strong></td><td><strong>' +
        money(totalPrice) +
        '</strong></td><td><strong>' +
        money(totalCost) +
        '</strong></td><td><strong>' +
        money(margin) +
        ' (' +
        marginPct.toFixed(1) +
        '%)</strong></td><td></td></tr></tfoot></table></div>';
      tableHost.querySelectorAll('[data-tcc-remove]').forEach((btn) => {
        btn.addEventListener('click', () => {
          lineItems.splice(Number(btn.getAttribute('data-tcc-remove')), 1);
          renderTable();
        });
      });
    }

    // Empties the project lines entirely -- used by the explicit Clear
    // button and automatically once a Thomson sale has been saved, so the
    // next customer's quote starts from nothing (modification.md #44,
    // same Clear-must-actually-clear fix VAS/AMC/Rate Card got).
    function clearLineItems() {
      lineItems.length = 0;
      renderTable();
    }

    addButton.addEventListener('click', () => {
      const qty = parseNumber(qtyInput.value);
      if (qty <= 0 || !appliances.length || !regions.length) return;
      lineItems.push({
        region: regionSelect.value,
        applianceIdx: Number(applianceSelect.value),
        qty,
        siteVisits: parseNumber(visitsInput.value),
        trainingSessions: parseNumber(trainingInput.value),
      });
      renderTable();
    });
    clearButton.addEventListener('click', clearLineItems);
    transportShareInput.addEventListener('input', renderTable);
    if (addonsResetButton) {
      addonsResetButton.addEventListener('click', () => {
        addons = cloneAddonDefaults();
        renderAddonsTable();
        renderTable();
      });
    }

    renderAddonsTable();
    renderTable();
    renderThomsonSaleSection(
      saleHost,
      () => lastComputed,
      transportShareInput,
      clearLineItems,
      () => {
        // Keep the Thomson Issued list in sync if it's the tab currently open.
        const issuedPanel = container.querySelector('[data-th-panel="issued"]');
        if (issuedPanel && !issuedPanel.hidden) loadThomsonIssuedList(issuedHost);
      },
    );
  }

  // Lists every saved thomson_sales record (modification.md #44) so a
  // previously issued Thomson sale can be found again and its quotation
  // reprinted, without anywhere else in the portal to look it up.
  async function loadThomsonIssuedList(host) {
    if (!hasPermission('thomson_sale.read')) {
      host.innerHTML =
        '<p class="form-note">You don\'t have permission to view issued Thomson sales.</p>';
      return;
    }
    host.innerHTML = '<p class="form-note">Loading issued Thomson sales&hellip;</p>';
    try {
      const response = await apiRequest('/api/thomson-sales?pageSize=100');
      const sales = response.thomsonSales || [];
      if (!sales.length) {
        host.innerHTML = '<p class="form-note">No Thomson sales issued yet.</p>';
        return;
      }
      host.innerHTML =
        '<div class="table-wrap"><table><thead><tr>' +
        '<th>Reference</th><th>Issued</th><th>Client</th><th>Lines</th><th>Total price</th><th>Margin</th><th></th>' +
        '</tr></thead><tbody>' +
        sales
          .map(
            (sale) =>
              '<tr>' +
              '<td>' +
              escapeHtml(sale.thomsonSaleReference) +
              '</td><td>' +
              escapeHtml(formatDate(sale.createdAt)) +
              '</td><td>' +
              escapeHtml(sale.clientName || '—') +
              '</td><td>' +
              String((sale.lineItems || []).length) +
              '</td><td>' +
              money(sale.totalPrice) +
              ' AED</td><td>' +
              money(sale.margin) +
              ' AED</td><td>' +
              '<button type="button" class="button button-outline" data-tcc-reprint="' +
              escapeHtml(sale.id) +
              '">Print</button>' +
              '</td></tr>',
          )
          .join('') +
        '</tbody></table></div>';
      host.querySelectorAll('[data-tcc-reprint]').forEach((button) => {
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            const detail = await apiRequest('/api/thomson-sales/' + button.dataset.tccReprint);
            printThomsonSaleCertificate(detail.thomsonSale);
          } catch (error) {
            setMessage(
              '#workspaceMessage',
              'Could not load this Thomson sale: ' + (error.message || 'unknown error'),
            );
          } finally {
            button.disabled = false;
          }
        });
      });
    } catch (error) {
      host.innerHTML = '<p class="form-note">Could not load issued Thomson sales.</p>';
    }
  }

  // Fills in the "Issue a Thomson Sale -- Printable Quotation" section
  // (modification.md #44): uses whichever project lines are currently
  // computed in the calculator above (full numbers, not just raw inputs --
  // see 023_thomson_sales.sql for why), saves a normalized thomson_sales
  // record, then enables printing that saved record's quotation. After a
  // successful save, the project lines and the sale form both reset for
  // the next customer, and onSaved() refreshes the "Thomson Issued" tab if
  // it's open -- same treatment as renderRateCardSaleSection.
  function renderThomsonSaleSection(
    saleHost,
    getComputed,
    transportShareInput,
    clearLineItems,
    onSaved,
  ) {
    if (!hasPermission('thomson_sale.write')) {
      saleHost.innerHTML =
        '<p class="form-note">You don\'t have permission to issue Thomson sales.</p>';
      return;
    }
    saleHost.innerHTML =
      '<div class="card-help"><span>About this section</span>' +
      tipHtml(
        'Uses the project lines built above. Fill in the client details and save the sale, then print the quotation.',
      ) +
      '</div>' +
      '<div class="field-grid">' +
      calcField('Client', '<input type="text" data-ths-client />') +
      calcField('Contact number', '<input type="text" data-ths-contact-number />') +
      calcField('Site / location', '<input type="text" data-ths-location />') +
      calcField(
        'Contract ref.',
        '<input type="text" data-ths-contract-ref />',
        'Optional — auto-generated if left blank',
      ) +
      '</div>' +
      '<p>' +
      '<button type="button" class="button button-primary" data-ths-save>Save Thomson sale</button> ' +
      '<button type="button" class="button button-outline" data-ths-print disabled>Print quotation</button>' +
      '</p>' +
      '<div data-ths-message></div>';

    const saveButton = saleHost.querySelector('[data-ths-save]');
    const printButton = saleHost.querySelector('[data-ths-print]');
    const messageHost = saleHost.querySelector('[data-ths-message]');
    let savedSale = null;

    function clearSaleFormInputs() {
      saleHost.querySelectorAll('.field-grid input').forEach((el) => {
        el.value = '';
      });
    }

    saveButton.addEventListener('click', async () => {
      savedSale = null;
      printButton.disabled = true;
      messageHost.innerHTML = '';
      const computed = getComputed();
      if (!computed || !computed.length) {
        messageHost.innerHTML =
          '<p class="form-note">Add at least one project line above before saving.</p>';
        return;
      }
      const totalPrice = computed.reduce((s, c) => s + c.totalPrice, 0);
      const totalCost = computed.reduce((s, c) => s + c.totalCost, 0);
      const margin = totalPrice - totalCost;
      const field = (selector) => saleHost.querySelector(selector).value.trim();
      const payload = {
        clientName: field('[data-ths-client]') || undefined,
        contactNumber: field('[data-ths-contact-number]') || undefined,
        siteLocation: field('[data-ths-location]') || undefined,
        transportSharePercent: parseNumber(transportShareInput.value),
        lineItems: computed.map((c) => ({
          region: c.region,
          applianceName: c.applianceName,
          qty: c.qty,
          siteVisits: c.siteVisits,
          trainingSessions: c.trainingSessions,
          unitRate: c.unitRate,
          applianceSubtotal: c.applianceSubtotal,
          addonRevenue: c.addonRevenue,
          transportCost: c.transportCost,
          totalPrice: c.totalPrice,
          totalCost: c.totalCost,
          margin: c.margin,
        })),
        totalPrice,
        totalCost,
        margin,
        contractRef: field('[data-ths-contract-ref]') || undefined,
      };
      try {
        const response = await apiRequest('/api/thomson-sales', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        savedSale = response.thomsonSale;
        messageHost.innerHTML =
          '<p class="form-note">Saved as <strong>' +
          escapeHtml(savedSale.thomsonSaleReference) +
          '</strong> and added to the "Thomson Issued" tab. Print below, or reprint it any time from Thomson Issued. The project lines have been reset for the next customer.</p>';
        printButton.disabled = false;
        clearSaleFormInputs();
        clearLineItems();
        onSaved();
      } catch (error) {
        messageHost.innerHTML =
          '<p class="form-note">Could not save the Thomson sale: ' +
          escapeHtml(error.message || 'unknown error') +
          '</p>';
      }
    });

    printButton.addEventListener('click', () => {
      if (!savedSale) return;
      printThomsonSaleCertificate(savedSale);
    });
  }

  // ---------------------------------------------------------------------------
  // Tasks (ROI) -- modification.md #107. The task manager and the ROI composer
  // live in tasks.js; roi-core.js holds the week maths and email markup. The
  // Management Summary block below reads the same revenue / budget endpoints as
  // the Service Revenue Dashboard, so the ROI and the dashboard always agree.
  // ---------------------------------------------------------------------------
  // Chat -- modification.md #140. chat.js holds the screen, the record slide-over and
  // the unread badge; this file only supplies the API, permissions and navigation.
  let chatUi = null;
  function setChatBadge(summary) {
    const badge = document.getElementById('chatNavBadge');
    if (!badge) return;
    const count = Number(summary?.unread || 0);
    badge.hidden = count < 1;
    badge.textContent = count > 99 ? '99+' : String(count);
    const nav = document.getElementById('chatNav');
    if (nav)
      nav.setAttribute('aria-label', count ? 'Live Chat, ' + count + ' unread' : 'Live Chat');
  }
  function chatGoToRecord(type, id) {
    document.querySelector('.ch-drawer-host')?.remove();
    if (type === 'job_card') {
      setWorkspaceMode('job-cards');
      loadJobCardDetail(id);
    } else if (type === 'appointment') {
      setWorkspaceMode('appointments');
      loadAppointmentDetail(id);
    } else if (type === 'complaint') {
      setWorkspaceMode('service-requests');
      loadComplaintDetail(id);
    } else if (type === 'task') {
      setWorkspaceMode('tasks');
      getTasksUi().openTask(id);
    } else if (type === 'schedule') {
      setWorkspaceMode('daily-list');
    }
  }
  // Chat pop-out window (modification #144): a small separate window showing only the
  // Chat screen. The new window cannot see this tab's sign-in (it is per tab), so the
  // token is passed through localStorage for a few seconds and removed on arrival.
  let pendingChatOpen = null;
  const POPOUT_TOKEN_KEY = 'jackys-service-portal:popoutToken';
  function openChatPopOut(conversationId) {
    try {
      localStorage.setItem(POPOUT_TOKEN_KEY, JSON.stringify({ token: authToken, at: Date.now() }));
    } catch {
      /* the pop-out will ask to sign in */
    }
    const url =
      '/portal/?chatPopout=1' +
      (conversationId ? '&chat=' + encodeURIComponent(conversationId) : '');
    const win = window.open(url, 'jd-chat-popout', 'popup=yes,width=440,height=720');
    if (win) win.focus();
  }
  function adoptPopoutToken() {
    try {
      const raw = localStorage.getItem(POPOUT_TOKEN_KEY);
      if (!raw) return;
      localStorage.removeItem(POPOUT_TOKEN_KEY);
      const handoff = JSON.parse(raw);
      if (handoff && handoff.token && Date.now() - handoff.at < 30000 && !getStoredToken())
        saveStoredToken(handoff.token);
    } catch {
      /* ignore */
    }
  }
  function getChatUi() {
    if (!chatUi) {
      chatUi = window.JdChat.create({
        apiRequest,
        apiUpload: apiUploadRequest,
        showChatPage: (id) => {
          pendingChatOpen = id ? String(id) : null;
          setWorkspaceMode('chat');
        },
        consumePendingOpen: () => {
          const id = pendingChatOpen;
          pendingChatOpen = null;
          return id;
        },
        popOut: openChatPopOut,
        apiFetch: (url, options = {}) => {
          const headers = new Headers(options.headers || {});
          if (authToken) headers.set('authorization', 'Bearer ' + authToken);
          return fetch(url, { ...options, headers });
        },
        escapeHtml,
        can: (permission) => Boolean(hasPermission(permission)),
        onUnread: setChatBadge,
        goToRecord: chatGoToRecord,
      });
    }
    return chatUi;
  }
  function discussRecord(type, id) {
    if (!id || !hasPermission('chat.use')) return;
    getChatUi().openRecord(type, id);
  }

  let tasksUi = null;
  function getTasksUi() {
    if (!tasksUi) {
      tasksUi = window.JdTasks.create({
        apiRequest,
        apiUpload: apiUploadRequest,
        escapeHtml,
        tipHtml,
        isAdmin: () => Boolean(currentUser?.permissions?.includes('*')),
        getUser: () => ({ name: currentUser?.name || '', email: currentUser?.email || '' }),
        canSummary: () => hasPermission('revenue_dashboard.read'),
        openChatRecord: (type, id) => discussRecord(type, id),
        loadSummary: roiSummaryData,
        download: rdDownloadBlob,
        // Dashboard kanban -> the full task (or the Tasks page when no id is given).
        openTask: (id) => {
          setWorkspaceMode('tasks');
          if (id) tasksUi.openTask(id);
        },
      });
    }
    return tasksUi;
  }

  // Management Summary for the month the ROI week ends in: month totals, revenue
  // by job type, the weekly table, and budget achievement when a budget exists.
  async function roiSummaryData(week) {
    if (!hasPermission('revenue_dashboard.read')) {
      return { data: null, reason: 'No Service Revenue access' };
    }
    const year = Number(week.friday.slice(0, 4));
    const month = Number(week.friday.slice(5, 7));
    const period = week.friday.slice(0, 7);
    try {
      const [byType, byWeek, budget] = await Promise.all([
        rdApi('group', { year, month, dimension: 'jobType' }),
        rdApi('group', { year, month, dimension: 'week' }),
        apiRequest('/api/revenue-dashboard/budget').catch(() => null),
      ]);
      if (!byType.batch) return { data: null, reason: 'No revenue workbook uploaded' };
      const totals = byType.data.totals;
      if (!totals.jobs) {
        return {
          data: null,
          reason: 'No revenue data for ' + RD_MONTHS_FULL[month - 1] + ' ' + year,
        };
      }
      const weeks = [...byWeek.data.rows].sort((a, b) => Number(a.key) - Number(b.key));
      const data = {
        monthLabel: RD_MONTHS_FULL[month - 1] + ' ' + year,
        totals,
        byType: rdSortJobTypes(byType.data.rows.map((r) => r.key)).map((code) => {
          const r = byType.data.rows.find((x) => x.key === code);
          return { code, label: rdJobLabel(code), jobs: r.jobs, revenue: r.revenue };
        }),
        weeks: weeks.map((w) => ({
          label: 'W' + w.key,
          jobs: w.jobs,
          qty: w.qty,
          revenue: w.revenue,
        })),
        budget: null,
        source: byType.batch.fileName,
      };
      if (budget && budget.budgetBatch) {
        const lines = new Map();
        budget.budget.forEach((row) => {
          if (row.section !== 'revenue') return;
          if (!lines.has(row.lineItem)) lines.set(row.lineItem, {});
          lines.get(row.lineItem)[row.period] = Number(row.amount);
        });
        const revenueBudget = lines.size ? [...lines.values()][0] : {};
        const monthBudget = revenueBudget[period] || 0;
        const actualByPeriod = {};
        budget.actual.forEach((row) => {
          actualByPeriod[row.period] = Number(row.revenue);
        });
        const upTo = Object.keys(actualByPeriod).filter(
          (p) => p.slice(0, 4) === String(year) && p <= period,
        );
        data.budget = {
          monthLabel: RD_MONTHS[month - 1] + ' ' + String(year).slice(2),
          monthBudget,
          monthActual: totals.revenue,
          weeks: JdRoi.weeklyBudget(
            monthBudget,
            year,
            month,
            weeks.map((w) => ({ week: w.key, actual: w.revenue, jobs: w.jobs, qty: w.qty })),
          ),
          ytd: {
            budget: upTo.reduce((sum, p) => sum + (revenueBudget[p] || 0), 0),
            actual: upTo.reduce((sum, p) => sum + actualByPeriod[p], 0),
          },
        };
      }
      return { data };
    } catch (error) {
      return { data: null, reason: error.message || 'Could not load the revenue data' };
    }
  }

  const PRICING_CALC_PAGES = {
    'vas-calc': {
      navId: 'vasCalcNav',
      workspaceId: 'vasCalcWorkspace',
      heading: 'VAS Quote Calculator',
      permission: 'quote_calculators.use',
      description: 'Stand-alone quote calculator, reading VAS Price Banding & Split’s admin data.',
      domains: ['vas_price_bands', 'vas_pricing_params'],
      render: (root, dataByDomain) => renderVasCalc(root, dataByDomain),
    },
    'amc-calc': {
      navId: 'amcCalcNav',
      workspaceId: 'amcCalcWorkspace',
      heading: 'AMC Quote Calculator',
      permission: 'quote_calculators.use',
      description: 'Stand-alone quote calculator, reading AMC Admin Rate Section’s admin data.',
      domains: ['amc_pricing'],
      render: (root, dataByDomain) => renderAmcCalc(root, dataByDomain.amc_pricing),
    },
    'thomson-calc': {
      navId: 'thomsonCalcNav',
      workspaceId: 'thomsonCalcWorkspace',
      heading: 'Thomson Quote Calculator',
      permission: 'quote_calculators.use',
      description: 'Stand-alone quote calculator, reading Thomson Pricing Admin’s admin data.',
      domains: ['thomson_pricing'],
      render: (root, dataByDomain) => renderThomsonCalc(root, dataByDomain.thomson_pricing),
    },
    chat: {
      navId: 'chatNav',
      workspaceId: 'chatWorkspace',
      heading: 'Live Chat',
      description:
        'Message your team, or discuss a job card, appointment, complaint or task in its own thread.',
      permission: 'chat.use',
      hideCurrencyNote: true,
      domains: [],
      load: (root) => getChatUi().renderPage(root),
    },
    tasks: {
      navId: 'tasksNav',
      workspaceId: 'tasksWorkspace',
      heading: 'Tasks',
      description: 'Your weekly tasks, objectives and issues; send them to management as the ROI.',
      permission: 'tasks.use',
      hideCurrencyNote: true,
      domains: [],
      load: (root) => getTasksUi().renderPage(root),
    },
    'revenue-dashboard': {
      navId: 'revenueDashNav',
      workspaceId: 'revenueDashWorkspace',
      heading: 'Service Revenue Dashboard',
      description: 'Commercial revenue reporting, fed from the master Service Dashboard workbook.',
      permission: 'revenue_dashboard.read',
      domains: [],
      load: (root) => renderRevenueDashboard(root),
    },
    'budget-dashboard': {
      navId: 'budgetDashNav',
      workspaceId: 'budgetDashWorkspace',
      heading: 'Budget vs Actual',
      description: 'Prepared service budget compared with actual revenue.',
      permission: 'revenue_dashboard.budget_actual',
      domains: [],
      load: (root) => renderBudgetDashboard(root),
    },
    'budget-variance': {
      navId: 'budgetVarNav',
      workspaceId: 'budgetVarWorkspace',
      heading: 'Budget Variance',
      description: 'Budget by revenue stream compared with actual revenue on closed months.',
      permission: 'revenue_dashboard.budget_variance',
      domains: [],
      load: (root) => renderBudgetVariance(root),
    },
    'rate-card': {
      navId: 'rateCardNav',
      workspaceId: 'rateCardWorkspace',
      heading: 'Rate Card',
      description: 'Standard service rates for sales and the service desk.',
      permission: 'rate_card.view',
      hideCurrencyNote: true,
      domains: [],
      load: (root) => renderRateCardPage(root),
    },
    masters: {
      navId: 'mastersNav',
      workspaceId: 'mastersWorkspace',
      heading: 'Masters',
      description:
        'Upload and check the master lists the forms read: stock items and B2B customers.',
      permission: ['stock.write', 'b2b_master.write'],
      hideCurrencyNote: true,
      domains: [],
      load: (root) => renderMastersPage(root),
    },
    'walk-in': {
      navId: 'walkInNav',
      workspaceId: 'walkInWorkspace',
      heading: 'Walk-in job card',
      description: 'Open a job card for a customer at the service counter.',
      permission: 'service_job_card.write',
      hideCurrencyNote: true,
      domains: [],
      load: (root) => renderWalkInPage(root),
    },
    reports: {
      navId: 'reportsNav',
      workspaceId: 'reportsWorkspace',
      heading: 'Reports',
      description: 'Download service records as Excel workbooks.',
      permission: 'reports.read',
      hideCurrencyNote: true,
      domains: [],
      load: (root) => renderReportsPage(root),
    },
    'delivery-install': {
      navId: 'deliveryInstallNav',
      workspaceId: 'deliveryInstallWorkspace',
      heading: 'Delivery & Installation',
      description:
        'Enter delivery and installation jobs (CSIDI, CSIDO, CSIII) for B2B customers; the price shows live.',
      permission: 'di_jobs.read',
      hideCurrencyNote: true,
      domains: [],
      load: (root) => renderDeliveryInstall(root),
    },
    invoices: {
      navId: 'invoicesNav',
      workspaceId: 'invoicesWorkspace',
      heading: 'Invoice [Warranty and billing]',
      description:
        'Tax invoices and payment confirmation for jobs with an amount, by job type and payment stage.',
      permission: 'invoices.read',
      hideCurrencyNote: true,
      domains: [],
      load: (root) => renderInvoices(root),
    },
    billing: {
      navId: 'billingNav',
      workspaceId: 'billingWorkspace',
      heading: 'Billing',
      description:
        'Accounts view: billed jobs, bill-to statement and cost allocation for ERP billing.',
      permission: 'billing.read',
      hideCurrencyNote: true,
      domains: [],
      load: (root) => renderBilling(root),
    },
    'daily-list': {
      navId: 'dailyListNav',
      workspaceId: 'dailyListWorkspace',
      heading: 'Daily schedule',
      description: 'Appointments by day, grouped by technician or branch, with print.',
      permission: 'appointments.read',
      hideCurrencyNote: true,
      domains: [],
      load: (root) => renderDailyList(root),
    },
    'awaiting-drafts': {
      navId: 'awaitingDraftsNav',
      workspaceId: 'awaitingDraftsWorkspace',
      heading: 'Awaiting drafts',
      description: 'Draft schedules waiting to be promoted or cancelled.',
      permission: 'scheduler.read',
      hideCurrencyNote: true,
      domains: [],
      load: (root) => renderAwaitingDrafts(root),
    },
    roles: {
      navId: 'rolesNav',
      workspaceId: 'rolesWorkspace',
      heading: 'Roles & permissions',
      description: 'Choose what each role can open and do.',
      permission: 'admin.users',
      hideCurrencyNote: true,
      domains: [],
      load: (root) => renderRolesPage(root),
    },
    'activity-log': {
      navId: 'activityLogNav',
      workspaceId: 'activityLogWorkspace',
      heading: 'Activity log',
      description: 'Who did what, and when.',
      permission: 'audit.read',
      hideCurrencyNote: true,
      domains: [],
      load: (root) => renderActivityLog(root),
    },
    changelog: {
      navId: 'changelogNav',
      workspaceId: 'changelogWorkspace',
      heading: 'Changelog',
      description: 'Every change made to the portal, newest first.',
      permission: 'admin.users',
      hideCurrencyNote: true,
      domains: [],
      load: (root) => renderChangelogPage(root),
    },
  };

  async function activatePricingCalcMode(mode) {
    const page = PRICING_CALC_PAGES[mode];
    if (!page) return;
    const allowed = Array.isArray(page.permission)
      ? page.permission.some((code) => hasPermission(code))
      : hasPermission(page.permission || 'pricing_config.read');
    if (!allowed) return;
    workspaceMode = mode;
    Object.values(PRICING_ADMIN_PAGES).forEach((other) => {
      $('#' + other.navId).setAttribute('aria-current', 'false');
      $('#' + other.workspaceId).hidden = true;
    });
    Object.values(PRICING_CALC_PAGES).forEach((other) => {
      $('#' + other.navId).setAttribute('aria-current', other === page ? 'page' : 'false');
      $('#' + other.workspaceId).hidden = other !== page;
    });
    [
      'complaintWorkspace',
      'appointmentWorkspace',
      'jobCardWorkspace',
      'quotationWorkspace',
      'inspectionWorkspace',
      'warrantyApprovalWorkspace',
      'dashboardWorkspace',
      'technicianWorkspace',
      'teamAccountWorkspace',
      'masterDataWorkspace',
      'newComplaintWorkspace',
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.hidden = true;
    });
    [
      'complaintsNav',
      'serviceRequestsNav',
      'jobCardsNav',
      'quotationsNav',
      'inspectionsNav',
      'warrantyApprovalsNav',
      'dashboardNav',
      'appointmentsNav',
      'techniciansNav',
      'teamAccountsNav',
      'newRequestNav',
      'masterDataNav',
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.setAttribute('aria-current', 'false');
    });
    [
      'refreshComplaintsButton',
      'refreshAppointmentsButton',
      'refreshJobCardsButton',
      'refreshQuotationsButton',
      'refreshInspectionsButton',
      'refreshWarrantyApprovalsButton',
      'refreshDashboardButton',
      'refreshTechniciansButton',
      'refreshTeamAccountsButton',
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.hidden = true;
    });
    $('#workspace-heading').textContent = page.heading;
    $('#workspaceDescription').textContent = page.description;
    $('#pricingCurrencyNote').hidden = !!page.hideCurrencyNote;
    $('#pricingCurrencyNote').style.display = page.hideCurrencyNote ? 'none' : '';

    const root = document.querySelector('#' + page.workspaceId + ' [data-calc-root]');
    if (!root) return;
    if (page.load) {
      // Dashboard pages load their own data (modification.md #49).
      await page.load(root);
      return;
    }
    root.innerHTML = '<p class="form-note">Loading current values&hellip;</p>';
    try {
      const dataByDomain = await calcFetchDomains(page.domains);
      page.render(root, dataByDomain);
    } catch (error) {
      root.innerHTML =
        '<p class="form-note">Could not load current values for this calculator.</p>';
    }
  }

  // --- Reports page (modification.md #52) ----------------------------------
  // The legacy portal's "Download service reports" tab: choose a record type
  // and a date range, preview the rows, download an Excel workbook. Rows come
  // from GET /api/reports/{type}; the download is GET /api/reports/{type}/export
  // and is written to the Activity log by the server.
  function pgYmd(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function pgRangeFor(kind) {
    const now = new Date();
    if (kind === 'month') {
      return {
        from: pgYmd(new Date(now.getFullYear(), now.getMonth(), 1)),
        to: pgYmd(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
      };
    }
    if (kind === 'last-month') {
      return {
        from: pgYmd(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        to: pgYmd(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    }
    if (kind === 'ytd') {
      return { from: pgYmd(new Date(now.getFullYear(), 0, 1)), to: pgYmd(now) };
    }
    return { from: '', to: '' };
  }

  function pgCellHtml(value, kind) {
    if (value === null || value === undefined || value === '') return '<td></td>';
    if (kind === 'money') {
      return (
        '<td class="num">' +
        Number(value).toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }) +
        '</td>'
      );
    }
    if (kind === 'number') {
      return '<td class="num">' + Number(value).toLocaleString('en-US') + '</td>';
    }
    const text = String(value);
    return (
      '<td class="pg-cell"' +
      (text.length > 24 ? ' title="' + escapeHtml(text) + '"' : '') +
      '>' +
      escapeHtml(text) +
      '</td>'
    );
  }

  // ---------- Daily schedule: technician list, batch print, sheets (modification #57) ----------
  function dlDayLabel(ymd) {
    const [year, month, day] = ymd.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  function dlGroupLabel(row, by) {
    if (by === 'branch') return row.branchName || row.region || 'No branch';
    return row.technicianName || 'Unassigned';
  }

  function dlGroups(rows, by) {
    const map = new Map();
    rows.forEach((row) => {
      const label = dlGroupLabel(row, by);
      const key = row.appointmentDate + '|' + label;
      if (!map.has(key)) map.set(key, { date: row.appointmentDate, label, rows: [] });
      map.get(key).rows.push(row);
    });
    const unassigned = (group) =>
      group.label === 'Unassigned' || group.label === 'No branch' ? 1 : 0;
    return [...map.values()].sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        unassigned(a) - unassigned(b) ||
        a.label.localeCompare(b.label),
    );
  }

  // Printing sends a technician out, so every appointment being printed must
  // have one. When some do not, a pop-up lists them; clicking one opens it so a
  // technician can be assigned, and the print is not done.
  function dlPrintAllowed(rows) {
    const missing = rows.filter((row) => !row.technicianId);
    if (!missing.length) return true;
    const dialog = document.createElement('dialog');
    dialog.className = 'pw-dialog print-choice';
    dialog.setAttribute('aria-labelledby', 'noTechTitle');
    dialog.innerHTML =
      '<h3 id="noTechTitle">Technician not assigned</h3>' +
      '<p>' +
      missing.length +
      (missing.length === 1 ? ' appointment has' : ' appointments have') +
      ' no technician assigned. Open each one, assign a technician, then print again.</p>' +
      missing
        .slice(0, 12)
        .map(
          (row) =>
            '<button type="button" class="button button-outline print-choice-option" data-open-appointment="' +
            escapeHtml(row.id) +
            '"><strong>' +
            escapeHtml(row.appointmentReference) +
            '</strong><span>' +
            escapeHtml(
              [row.customerName, row.appointmentDate ? dlDayLabel(row.appointmentDate) : '']
                .filter(Boolean)
                .join(' \u00b7 '),
            ) +
            '</span></button>',
        )
        .join('') +
      (missing.length > 12 ? '<p>and ' + (missing.length - 12) + ' more.</p>' : '') +
      '<div class="form-footer"><button type="button" class="button" data-print-cancel>Close</button></div>';
    dialog.addEventListener('click', (event) => {
      const open = event.target.closest('[data-open-appointment]');
      if (open) {
        const id = open.dataset.openAppointment;
        dialog.close();
        setWorkspaceMode('appointments');
        loadAppointmentDetail(id);
      } else if (event.target.closest('[data-print-cancel]')) {
        dialog.close();
      }
    });
    dialog.addEventListener('close', () => dialog.remove());
    document.body.appendChild(dialog);
    dialog.showModal();
    return false;
  }

  function dlTechnicianOptions(rows, selected) {
    const byId = new Map();
    rows.forEach((row) => {
      if (row.technicianId) byId.set(row.technicianId, row.technicianName || row.technicianId);
    });
    const options = [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    const opt = (value, label) =>
      '<option value="' +
      escapeHtml(value) +
      '"' +
      (selected === value ? ' selected' : '') +
      '>' +
      escapeHtml(label) +
      '</option>';
    return (
      opt('', 'All technicians') +
      options.map(([id, name]) => opt(id, name)).join('') +
      (rows.some((row) => !row.technicianId) ? opt('__none', 'Unassigned') : '')
    );
  }

  function dlRangeLabel(from, to) {
    return from === to ? dlDayLabel(from) : dlDayLabel(from) + ' to ' + dlDayLabel(to);
  }

  function dlPrintList(rows, by, from, to) {
    const groups = dlGroups(rows, by);
    const body = groups
      .map((group, index) => {
        const lines = group.rows
          .map(
            (row, i) =>
              '<tr><td>' +
              (i + 1) +
              '</td><td>' +
              escapeHtml(row.appointmentReference) +
              '</td><td><strong>' +
              escapeHtml(row.customerName) +
              '</strong><br>' +
              escapeHtml(row.contactNumber || '') +
              '</td><td>' +
              escapeHtml([row.address, row.region].filter(Boolean).join(', ') || '—') +
              '</td><td>' +
              escapeHtml([row.brand, row.model].filter(Boolean).join(' ') || '—') +
              '</td><td>' +
              escapeHtml(row.faultDescription) +
              '</td><td>' +
              escapeHtml(row.jobWarranty || '—') +
              '</td><td>' +
              escapeHtml(
                by === 'branch' ? row.technicianName || 'Unassigned' : row.branchName || '—',
              ) +
              '</td><td style="width:44px"></td></tr>',
          )
          .join('');
        return (
          '<div' +
          (index ? ' style="page-break-before:always"' : '') +
          '><h2>' +
          escapeHtml(dlDayLabel(group.date) + ' — ' + group.label) +
          ' (' +
          group.rows.length +
          (group.rows.length === 1 ? ' job' : ' jobs') +
          ')</h2><table><thead><tr><th>#</th><th>Appointment</th><th>Customer</th><th>Address</th><th>Item</th><th>Fault</th><th>Warranty</th><th>' +
          (by === 'branch' ? 'Technician' : 'Branch') +
          '</th><th>Done</th></tr></thead><tbody>' +
          lines +
          '</tbody></table></div>'
        );
      })
      .join('');
    openPrintWindow(
      printDocumentShell(
        'Daily schedule',
        printDocHeadWithLogo(
          (by === 'branch' ? 'Daily schedule by branch' : 'Technician daily list') +
            ' — ' +
            rows.length +
            ' appointments',
          dlRangeLabel(from, to),
        ) + body,
      ),
    );
  }

  function dlSheetBody(row, first) {
    return (
      '<div' +
      (first ? '' : ' style="page-break-before:always"') +
      '>' +
      printDocHeadWithLogo('Appointment sheet', row.appointmentReference) +
      printFieldGrid([
        ['Appointment date', dlDayLabel(row.appointmentDate)],
        ['Technician', row.technicianName || 'Unassigned'],
        ['Customer', row.customerName],
        ['Customer type', row.customerType],
        ['Contact number', row.contactNumber],
        ['Email', row.customerEmail],
        ['Customer number', row.customerNumber],
        ['Address', row.address],
        ['Region', row.region],
        ['Branch / school', row.branchName],
        [
          'School contact',
          [row.schoolContactPerson, row.schoolContactNumber].filter(Boolean).join(' · '),
        ],
        ['Brand / model', [row.brand, row.model].filter(Boolean).join(' ')],
        ['Item code', row.itemCode],
        ['Sub group', row.subGroup],
        ['Warranty', row.jobWarranty],
        ['Sales order', row.salesOrderNumber],
        ['Salesman', row.salesman],
        ['Complaint source', row.complaintSource],
        ['Complaint', row.complaintReference],
        ['Status', row.status],
      ]) +
      '<div class="block-label">Fault reported</div><div class="block">' +
      escapeHtml(row.faultDescription) +
      '</div><div class="block-label">Work done</div><div class="block" style="min-height:90px"></div>' +
      '<div class="block-label">Parts used</div><div class="block" style="min-height:60px"></div>' +
      '<div class="sign-row"><div class="sign-box">Technician — name / signature / date</div><div class="sign-box">Customer — name / signature / date</div></div></div>'
    );
  }

  function dlPrintSheets(rows, by) {
    const ordered = dlGroups(rows, by).flatMap((group) => group.rows);
    openPrintWindow(
      printDocumentShell(
        'Appointment sheets',
        ordered.map((row, index) => dlSheetBody(row, index === 0)).join(''),
      ),
    );
  }

  // --- Invoices page -------------------------------------------------------
  // Every job that carries an amount, by job type (CSIJW warranty, CSIJO
  // non-warranty) and payment stage. Finance/CCE record the ERP invoice number
  // and confirm customer payments here; a customer-paid job can be delivered
  // only after that. A second tab holds the billing rules (which sales channel
  // is billed), editable by the super admin.
  // --- Billing (Management): accounts view of billed jobs -------------------
  // Ledger of every job with an amount, bill-to statement per channel /
  // customer, and cost allocation by brand and product group, with an Excel
  // download of all three. Invoice numbers are the ERP's; the portal records
  // them (Record button) but never issues invoices.
  // ---------------------------------------------------------------------
  // Delivery & Installation (CSIDI / CSIDO / CSIII): one job = one ERP
  // delivery note. Entered after the physical job; a job counts as revenue
  // once it is Completed and its figures are then frozen.
  // ---------------------------------------------------------------------
  // Ref doc no pill (worked examples): colour by what the number is.
  // Customer code from the master workbook (Cust Code), shown beside the Ref doc no pill.
  function custCodePill(custCode) {
    if (!custCode) return '';
    return (
      '<span class="ref-pill ref-pill-cust" title="Cust Code from the master workbook"><span class="ref-pill-label">Cust code</span>' +
      escapeHtml(custCode) +
      '</span>'
    );
  }
  function refDocPill(refDocNo) {
    if (!refDocNo) return '';
    const kind = /^direct$/i.test(refDocNo)
      ? 'direct'
      : /csosc/i.test(refDocNo)
        ? 'order'
        : 'other';
    return (
      '<span class="ref-pill ref-pill-' +
      kind +
      '" title="Ref DocNo from the master workbook"><span class="ref-pill-label">Ref doc no</span>' +
      escapeHtml(refDocNo) +
      '</span>'
    );
  }
  // Set by the Billing ledger to open a Delivery & Installation job when that page opens.
  let pendingDiJobId = null;
  async function renderDeliveryInstall(root) {
    const canWrite = hasPermission('di_jobs.write');
    const canReopen = hasPermission('di_jobs.reopen');
    const canConfigure = hasPermission('di_jobs.configure');
    const fmt = (value) =>
      (Number(value) || 0).toLocaleString('en-AE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    const localToday = () => {
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    };
    const TYPE_LABELS = {
      CSIDI: 'Delivery + Installation (CSIDI)',
      CSIDO: 'Delivery only (CSIDO)',
      CSIII: 'Installation only (CSIII)',
    };
    const blankForm = () => ({
      serviceDate: localToday(),
      region: 'Dubai',
      salesman: '',
      deliveryNoteRef: '',
      erpInvNo: '',
      csoscNo: '',
      notes: '',
    });
    const state = {
      tab: 'job',
      options: { regions: ['Dubai', 'Sharjah'], salesmen: [], erpInvMandatory: false },
      job: null,
      form: blankForm(),
      custCode: '',
      customerName: '',
      lines: [],
      priced: null,
      priceError: '',
      duplicates: [],
      completionWarnings: [],
      list: { status: '', from: '', to: '', search: '', page: 1, data: null },
      compare: {
        refreshedAt: null,
        month: localToday().slice(0, 7),
        data: null,
        error: '',
        showMatched: false,
        example: { invoice: '', data: null, error: '', loading: false },
      },
    };
    const locked = () => Boolean(state.job && state.job.status !== 'Draft') || !canWrite;

    root.innerHTML =
      '<div class="rcv-banner"><strong>Delivery &amp; Installation</strong><span>Enter the job after it is done — one entry for each ERP delivery note</span></div>' +
      '<div class="ws-tabs" role="tablist">' +
      '<button type="button" role="tab" class="ws-tab is-active" data-di-tab="job" aria-selected="true">New job</button>' +
      '<button type="button" role="tab" class="ws-tab" data-di-tab="jobs" aria-selected="false">Jobs</button>' +
      (hasPermission('di_jobs.compare')
        ? '<button type="button" role="tab" class="ws-tab" data-di-tab="compare" aria-selected="false">Compare with Excel</button>'
        : '') +
      '</div><div data-di-body></div>';
    const body = root.querySelector('[data-di-body]');
    const q = (selector) => root.querySelector(selector);

    try {
      state.options = await apiRequest('/api/di-jobs/options');
    } catch (error) {
      setMessage('#workspaceMessage', error.message);
    }

    function syncTabs() {
      root.querySelectorAll('[data-di-tab]').forEach((button) => {
        const active = button.dataset.diTab === state.tab;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      const tab = q('[data-di-tab="job"]');
      tab.textContent = state.job ? state.job.reference : 'New job';
    }

    root.querySelectorAll('[data-di-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        state.tab = button.dataset.diTab;
        syncTabs();
        if (state.tab === 'job') drawJob();
        else if (state.tab === 'compare') loadCompare();
        else loadJobs();
      });
    });

    function channelOfSalesman(name) {
      const found = state.options.salesmen.find(
        (s) => s.name.toLowerCase() === String(name || '').toLowerCase(),
      );
      return found ? found.salesChannel || '' : '';
    }

    // ---------------- New job / open job ----------------
    function resetJob() {
      state.job = null;
      state.form = blankForm();
      state.custCode = '';
      state.customerName = '';
      state.lines = [];
      state.priced = null;
      state.priceError = '';
      state.duplicates = [];
      state.completionWarnings = [];
    }

    function applyJob(result) {
      const job = result.job;
      state.job = job;
      state.form = {
        serviceDate: job.serviceDate,
        region: job.region,
        salesman: job.salesman || '',
        deliveryNoteRef: job.deliveryNoteRef || '',
        erpInvNo: job.erpInvNo || '',
        csoscNo: job.csoscNo || '',
        notes: job.notes || '',
      };
      state.custCode = job.custCode || '';
      state.customerName = job.customerName || '';
      state.lines = job.lines.map((line) => ({
        itemCode: line.itemCode,
        itemDesc: line.itemDesc,
        brand: line.brand,
        groupName: line.groupName,
        installable: line.installable,
        qty: line.qty,
        type: line.type,
        salesChannel: line.salesChannel,
        frozen: job.status === 'Completed' ? line : null,
      }));
      state.duplicates = result.duplicates || [];
      state.priced = null;
      state.priceError = '';
    }

    function jobHtml() {
      const f = state.form;
      const dis = locked() ? ' disabled' : '';
      const erpStar = state.options.erpInvMandatory ? ' <span class="required">*</span>' : '';
      const regionOptions = state.options.regions
        .map(
          (r) =>
            '<option' + (r === f.region ? ' selected' : '') + '>' + escapeHtml(r) + '</option>',
        )
        .join('');
      const salesmanOptions =
        '<option value="">Select a salesman</option>' +
        state.options.salesmen
          .map(
            (s) =>
              '<option value="' +
              escapeHtml(s.name) +
              '"' +
              (s.name === f.salesman ? ' selected' : '') +
              '>' +
              escapeHtml(s.name) +
              '</option>',
          )
          .join('') +
        (f.salesman && !state.options.salesmen.some((s) => s.name === f.salesman)
          ? '<option selected value="' +
            escapeHtml(f.salesman) +
            '">' +
            escapeHtml(f.salesman) +
            '</option>'
          : '');
      const statusLine = state.job
        ? '<p class="form-note"><strong>' +
          escapeHtml(state.job.reference) +
          '</strong> · ' +
          escapeHtml(state.job.status) +
          (state.job.completedAt ? ' on ' + escapeHtml(formatDate(state.job.completedAt)) : '') +
          '</p>'
        : '';
      return (
        statusLine +
        '<div data-di-dup></div>' +
        '<form id="diForm" novalidate>' +
        '<section class="detail-action-card"><h4>Job</h4><div class="field-grid">' +
        '<div class="field"><label for="diServiceDate">Service date <span class="required">*</span></label><input id="diServiceDate" type="date" value="' +
        escapeHtml(f.serviceDate) +
        '"' +
        dis +
        ' /><span class="field-error" data-error-for="diServiceDate"></span></div>' +
        '<div class="field"><label for="diRegion">Region <span class="required">*</span></label><select id="diRegion"' +
        dis +
        '>' +
        regionOptions +
        '</select></div>' +
        '<div class="field"><label for="diDeliveryNote">ERP delivery note (Ref Inv) <span class="required">*</span> ' +
        tipHtml(
          'One entry for each ERP delivery note. Delivery and installation on different days are two entries.',
        ) +
        '</label><input id="diDeliveryNote" maxlength="100" value="' +
        escapeHtml(f.deliveryNoteRef) +
        '"' +
        dis +
        ' /><span class="field-error" data-error-for="diDeliveryNote"></span></div>' +
        '<div class="field"><label for="diErpInv">ERP Inv No' +
        erpStar +
        ' ' +
        tipHtml('The zero-value CSIDI document number in the ERP.') +
        '</label><input id="diErpInv" maxlength="100" value="' +
        escapeHtml(f.erpInvNo) +
        '"' +
        dis +
        ' /><span class="field-error" data-error-for="diErpInv"></span></div>' +
        '<div class="field"><label for="diCsosc">CSOSC order no. (optional)</label><input id="diCsosc" maxlength="100" value="' +
        escapeHtml(f.csoscNo) +
        '"' +
        dis +
        ' /></div>' +
        '</div></section>' +
        '<section class="detail-action-card"><h4>Customer and sales</h4><div class="field-grid">' +
        (locked()
          ? ''
          : '<div class="field"><label for="diCustLookup">Look up B2B customer</label><input id="diCustLookup" type="text" autocomplete="off" placeholder="Type a branch or school name, or its customer code (e.g. 191065)…" /></div>' +
            '<ul id="diCustResults" class="b2b-branch-results field-wide" hidden></ul>') +
        '<div class="field"><label>B2B customer <span class="required">*</span></label><div class="di-readonly" data-di-customer></div><span class="field-error" data-error-for="diCustLookup"></span></div>' +
        '<div class="field"><label for="diSalesman">Salesman <span class="required">*</span></label><select id="diSalesman"' +
        dis +
        '>' +
        salesmanOptions +
        '</select><span class="field-error" data-error-for="diSalesman"></span></div>' +
        '<div class="field"><label>Sales channel</label><div class="di-readonly" data-di-channel></div></div>' +
        '</div></section>' +
        '<section class="detail-action-card"><h4>Items</h4>' +
        (locked()
          ? ''
          : '<div class="field"><label for="diItemSearch">Add an item ' +
            tipHtml(
              'Type an item code or part of the description. The item master decides if it can be installed.',
            ) +
            '</label><input id="diItemSearch" type="text" autocomplete="off" placeholder="Item code or description…" /></div>' +
            '<ul id="diItemResults" class="b2b-branch-results" hidden></ul>') +
        '<div class="di-lines-wrap"><table class="di-lines"><thead><tr><th>#</th><th>Item</th><th>Group</th><th>Qty</th><th>Activity</th><th class="num">Net rate</th><th class="num">Revenue (AED)</th><th></th></tr></thead><tbody data-di-lines></tbody></table></div>' +
        '<span class="field-error" data-error-for="diItemSearch"></span>' +
        '</section>' +
        '<div class="di-price" data-di-price></div>' +
        '<section class="detail-action-card"><div class="field field-wide"><label for="diNotes">Notes (optional)</label><textarea id="diNotes" maxlength="1000"' +
        dis +
        '>' +
        escapeHtml(f.notes) +
        '</textarea></div></section>' +
        '<div class="form-footer" data-di-actions></div>' +
        '</form>'
      );
    }

    function drawCustomer() {
      const box = q('[data-di-customer]');
      if (!box) return;
      box.textContent = state.custCode
        ? state.customerName + ' (' + state.custCode + ')'
        : 'Not chosen yet';
    }

    function drawChannel() {
      const box = q('[data-di-channel]');
      if (!box) return;
      const channel = channelOfSalesman(state.form.salesman);
      const job = state.job && state.job.salesChannel;
      if (locked() && job) box.textContent = job;
      else if (!state.form.salesman) box.textContent = '—';
      else if (channel) box.textContent = channel;
      else {
        box.textContent = 'No channel linked — contact the admin';
        box.style.color = 'var(--red)';
        return;
      }
      box.style.color = '';
    }

    function drawDuplicates() {
      const box = q('[data-di-dup]');
      if (!box) return;
      box.innerHTML = state.duplicates.length
        ? '<div class="di-banner"><strong>Warning:</strong> delivery note ' +
          escapeHtml(state.form.deliveryNoteRef) +
          ' is already on ' +
          state.duplicates
            .map((d) => escapeHtml(d.reference) + ' (' + escapeHtml(d.status) + ')')
            .join(', ') +
          '. You can still continue — check it is not entered twice.</div>'
        : '';
    }

    function typeOptionsFor(line) {
      return line.installable === false ? ['CSIDO'] : ['CSIDI', 'CSIDO', 'CSIII'];
    }

    function groupBadge(line) {
      const group = escapeHtml(line.groupName || '—');
      if (line.installable === true) return group + ' · installable';
      if (line.installable === false) return group + ' · delivery only';
      return group + ' · <span class="di-issue-warning">not linked</span>';
    }

    function drawLines() {
      const tbody = q('[data-di-lines]');
      if (!tbody) return;
      const isLocked = locked();
      tbody.innerHTML = state.lines.length
        ? state.lines
            .map((line, i) => {
              const priceLine = line.frozen || (state.priced && state.priced.lines[i]) || null;
              const options = typeOptionsFor(line)
                .map(
                  (t) =>
                    '<option value="' +
                    t +
                    '"' +
                    (t === line.type ? ' selected' : '') +
                    '>' +
                    escapeHtml(TYPE_LABELS[t]) +
                    '</option>',
                )
                .join('');
              return (
                '<tr><td>' +
                (i + 1) +
                '</td><td><strong>' +
                escapeHtml(line.itemCode) +
                '</strong><br><span class="form-note">' +
                escapeHtml(line.itemDesc || '') +
                '</span></td><td>' +
                groupBadge(line) +
                '</td><td>' +
                (isLocked
                  ? escapeHtml(line.qty)
                  : '<input type="number" min="1" step="1" data-di-qty="' +
                    i +
                    '" value="' +
                    escapeHtml(line.qty) +
                    '" aria-label="Quantity" />') +
                '</td><td>' +
                (isLocked
                  ? escapeHtml(TYPE_LABELS[line.type])
                  : '<select data-di-type="' +
                    i +
                    '" aria-label="Activity">' +
                    options +
                    '</select>') +
                '</td><td class="num">' +
                (priceLine && priceLine.netRate != null ? fmt(priceLine.netRate) : '—') +
                '</td><td class="num" title="' +
                escapeHtml((priceLine && (priceLine.note || priceLine.rateNote)) || '') +
                '">' +
                (priceLine && !priceLine.blocked ? fmt(priceLine.revenue) : '—') +
                '</td><td>' +
                (isLocked
                  ? ''
                  : '<button class="button-link" type="button" data-di-remove="' +
                    i +
                    '">Remove</button>') +
                '</td></tr>'
              );
            })
            .join('')
        : '<tr><td colspan="8" class="empty-state">No items yet. Search for an item above.</td></tr>';
    }

    function frozenSummary() {
      const job = state.job;
      return {
        totals: {
          CSIDI: job.totalCsidi,
          CSIDO: job.totalCsido,
          CSIII: job.totalCsiii,
          total: job.totalRevenue,
        },
        issues: [],
      };
    }

    function drawPrice() {
      const box = q('[data-di-price]');
      if (!box) return;
      const completed = state.job && state.job.status === 'Completed';
      const source = completed ? frozenSummary() : state.priced;
      let html = '<h4>' + (completed ? 'Frozen price' : 'Live price') + '</h4>';
      if (!state.lines.length) {
        html += '<p class="form-note">The price shows here as soon as you add items.</p>';
      } else if (state.priceError) {
        html += '<p class="di-issue-error">' + escapeHtml(state.priceError) + '</p>';
      } else if (!source) {
        html += '<p class="form-note">Calculating…</p>';
      } else {
        const t = source.totals;
        html +=
          '<div class="di-totals"><span>Delivery + Installation <strong>' +
          fmt(t.CSIDI) +
          '</strong></span><span>Delivery only <strong>' +
          fmt(t.CSIDO) +
          '</strong></span><span>Installation only <strong>' +
          fmt(t.CSIII) +
          '</strong></span><span>Total (AED) <strong>' +
          fmt(t.total) +
          '</strong></span></div>';
        const issues = [...source.issues, ...state.completionWarnings.map((w) => w)];
        if (issues.length) {
          html +=
            '<ul class="di-issues">' +
            issues
              .map(
                (issue) =>
                  '<li class="di-issue-' +
                  (issue.level === 'error' ? 'error' : 'warning') +
                  '">' +
                  (issue.line != null ? 'Line ' + (issue.line + 1) + ': ' : '') +
                  escapeHtml(issue.message) +
                  '</li>',
              )
              .join('') +
            '</ul>';
        }
        html += completed
          ? '<p class="form-note">These figures were frozen when the job was completed.</p>'
          : '<p class="form-note">Recalculated on every change from the Delivery + Installation pricing master. Figures freeze when you complete the job.</p>';
      }
      box.innerHTML = html;
    }

    function drawActions() {
      const box = q('[data-di-actions]');
      if (!box) return;
      const job = state.job;
      let html = '';
      if (!locked()) {
        html +=
          '<button class="button button-outline" type="button" data-di-save>Save draft</button>' +
          '<button class="button button-primary" type="button" data-di-complete>Complete job</button>';
        if (job)
          html +=
            '<button class="button button-outline" type="button" data-di-cancel>Cancel job</button>';
      } else if (job) {
        if (job.status === 'Completed' && canReopen) {
          html +=
            '<button class="button button-outline" type="button" data-di-cancel>Cancel job</button>';
        }
        if (canReopen) {
          html +=
            '<button class="button button-outline" type="button" data-di-reopen>Reopen as draft</button>';
        }
      }
      html += '<button class="button button-outline" type="button" data-di-new>New job</button>';
      box.innerHTML = html;
    }

    let priceTimer = null;
    let priceSequence = 0;
    function schedulePrice() {
      clearTimeout(priceTimer);
      if (locked() && state.job && state.job.status === 'Completed') return;
      if (!state.lines.length) {
        state.priced = null;
        state.priceError = '';
        drawLines();
        drawPrice();
        return;
      }
      priceTimer = setTimeout(async () => {
        const mine = ++priceSequence;
        try {
          const result = await apiRequest('/api/di-jobs/price', {
            method: 'POST',
            body: JSON.stringify({
              region: state.form.region,
              lines: state.lines.map((l) => ({
                itemCode: l.itemCode,
                qty: Number(l.qty) || 0,
                type: l.type,
              })),
            }),
          });
          if (mine !== priceSequence) return;
          state.priced = result;
          state.priceError = '';
        } catch (error) {
          if (mine !== priceSequence) return;
          state.priced = null;
          state.priceError = error.message;
        }
        drawLines();
        drawPrice();
      }, 300);
    }

    function drawJob() {
      body.innerHTML = jobHtml();
      drawCustomer();
      drawChannel();
      drawDuplicates();
      drawLines();
      drawPrice();
      drawActions();
      wireJob();
      schedulePrice();
    }

    function readFields() {
      const form = q('#diForm');
      if (!form) return;
      state.form.serviceDate = q('#diServiceDate').value;
      state.form.region = q('#diRegion').value;
      state.form.salesman = q('#diSalesman').value;
      state.form.deliveryNoteRef = q('#diDeliveryNote').value.trim();
      state.form.erpInvNo = q('#diErpInv').value.trim();
      state.form.csoscNo = q('#diCsosc').value.trim();
      state.form.notes = q('#diNotes').value.trim();
    }

    function payload() {
      readFields();
      const f = state.form;
      return {
        serviceDate: f.serviceDate,
        custCode: state.custCode || null,
        salesman: f.salesman || null,
        region: f.region,
        deliveryNoteRef: f.deliveryNoteRef || null,
        erpInvNo: f.erpInvNo || null,
        csoscNo: f.csoscNo || null,
        notes: f.notes || null,
        lines: state.lines.map((l) => ({
          itemCode: l.itemCode,
          qty: Number(l.qty) || 0,
          type: l.type,
        })),
      };
    }

    function validateForComplete() {
      const form = q('#diForm');
      clearErrors(form);
      readFields();
      let valid = true;
      const need = (ok, id, message) => {
        if (!ok) {
          showFieldError(form, id, message);
          valid = false;
        }
      };
      need(Boolean(state.form.serviceDate), 'diServiceDate', 'Enter the service date.');
      need(Boolean(state.custCode), 'diCustLookup', 'Choose the B2B customer from the list.');
      need(Boolean(state.form.salesman), 'diSalesman', 'Choose the salesman.');
      if (state.form.salesman && !channelOfSalesman(state.form.salesman)) {
        showFieldError(
          form,
          'diSalesman',
          'This salesman has no sales channel. Contact the admin to link one.',
        );
        valid = false;
      }
      need(Boolean(state.form.deliveryNoteRef), 'diDeliveryNote', 'Enter the ERP delivery note.');
      if (state.options.erpInvMandatory) {
        need(Boolean(state.form.erpInvNo), 'diErpInv', 'Enter the ERP Inv No.');
      }
      need(state.lines.length > 0, 'diItemSearch', 'Add at least one item.');
      need(
        state.lines.every((l) => Number(l.qty) > 0),
        'diItemSearch',
        'Every quantity must be more than zero.',
      );
      return valid;
    }

    async function save() {
      const data = payload();
      const result = state.job
        ? await apiRequest('/api/di-jobs/' + encodeURIComponent(state.job.id), {
            method: 'PATCH',
            body: JSON.stringify(data),
          })
        : await apiRequest('/api/di-jobs', { method: 'POST', body: JSON.stringify(data) });
      applyJob(result);
      return result;
    }

    function wireJob() {
      const form = q('#diForm');
      if (!form) return;
      form.addEventListener('submit', (event) => event.preventDefault());
      const isLocked = locked();
      q('#diRegion').addEventListener('change', () => {
        readFields();
        schedulePrice();
      });
      q('#diDeliveryNote').addEventListener('change', readFields);
      q('#diSalesman').addEventListener('change', () => {
        readFields();
        drawChannel();
        if (state.form.salesman && !channelOfSalesman(state.form.salesman)) {
          notifyDialog(
            'Salesman has no sales channel',
            state.form.salesman +
              ' is not linked to a sales channel yet, so this job cannot be completed. Contact the admin to link the salesman to a channel under Salesmen & channels, then try again.',
          );
        }
      });

      if (!isLocked) {
        // B2B customer type-ahead: picks the customer and fills the salesman from the customer record.
        let custTimer = null;
        let custSequence = 0;
        const custResults = q('#diCustResults');
        q('#diCustLookup').addEventListener('input', (event) => {
          const text = event.target.value.trim();
          clearTimeout(custTimer);
          if (text.length < 2) {
            custResults.hidden = true;
            return;
          }
          custTimer = setTimeout(async () => {
            const mine = ++custSequence;
            try {
              const result = await apiRequest(
                '/api/di-jobs/customers?query=' + encodeURIComponent(text),
              );
              if (mine !== custSequence) return;
              const customers = result.customers || [];
              custResults.innerHTML = customers
                .map(
                  (c, index) =>
                    '<li><button type="button" data-i="' +
                    index +
                    '"><span class="branch-name">' +
                    escapeHtml(c.branchName) +
                    '</span><br><span class="branch-code">Cust_Code ' +
                    escapeHtml(c.custCode) +
                    (c.salesman ? ' · ' + escapeHtml(c.salesman) : '') +
                    '</span></button></li>',
                )
                .join('');
              custResults.dataset.customers = JSON.stringify(customers);
              custResults.hidden = customers.length === 0;
            } catch {
              custResults.hidden = true;
            }
          }, 250);
        });
        custResults.addEventListener('click', (event) => {
          const button = event.target.closest('button[data-i]');
          if (!button) return;
          const customer = JSON.parse(custResults.dataset.customers || '[]')[
            Number(button.dataset.i)
          ];
          if (!customer) return;
          state.custCode = customer.custCode;
          state.customerName = customer.branchName;
          const match = state.options.salesmen.find(
            (s) => s.name.toLowerCase() === String(customer.salesman || '').toLowerCase(),
          );
          readFields();
          state.form.salesman = match ? match.name : '';
          q('#diSalesman').value = state.form.salesman;
          custResults.hidden = true;
          q('#diCustLookup').value = '';
          drawCustomer();
          drawChannel();
          clearErrors(form);
          if (!match && customer.salesman) {
            notifyDialog(
              'Choose the salesman',
              'The customer record names ' +
                customer.salesman +
                ', who is not in the salesmen list. Choose the salesman from the list.',
            );
          } else if (match && !match.salesChannel) {
            notifyDialog(
              'Salesman has no sales channel',
              match.name +
                ' is not linked to a sales channel yet, so this job cannot be completed. Contact the admin to link the salesman to a channel, then try again.',
            );
          }
        });

        // Item type-ahead.
        let itemTimer = null;
        let itemSequence = 0;
        const itemResults = q('#diItemResults');
        q('#diItemSearch').addEventListener('input', (event) => {
          const text = event.target.value.trim();
          clearTimeout(itemTimer);
          if (text.length < 2) {
            itemResults.hidden = true;
            return;
          }
          itemTimer = setTimeout(async () => {
            const mine = ++itemSequence;
            try {
              const result = await apiRequest(
                '/api/di-jobs/items?query=' + encodeURIComponent(text),
              );
              if (mine !== itemSequence) return;
              const items = result.items || [];
              itemResults.innerHTML = items
                .map(
                  (item, index) =>
                    '<li><button type="button" data-i="' +
                    index +
                    '"><span class="branch-name">' +
                    escapeHtml(item.itemCode) +
                    ' · ' +
                    escapeHtml(item.itemDesc || '') +
                    '</span><br><span class="branch-code">' +
                    escapeHtml(item.brand || '') +
                    ' · ' +
                    groupBadge(item) +
                    '</span></button></li>',
                )
                .join('');
              itemResults.dataset.items = JSON.stringify(items);
              itemResults.hidden = items.length === 0;
            } catch {
              itemResults.hidden = true;
            }
          }, 250);
        });
        itemResults.addEventListener('click', (event) => {
          const button = event.target.closest('button[data-i]');
          if (!button) return;
          const item = JSON.parse(itemResults.dataset.items || '[]')[Number(button.dataset.i)];
          if (!item) return;
          const type = item.installable === true ? 'CSIDI' : 'CSIDO';
          const same = state.lines.find((l) => l.itemCode === item.itemCode && l.type === type);
          if (same) same.qty = Number(same.qty) + 1;
          else {
            state.lines.push({
              itemCode: item.itemCode,
              itemDesc: item.itemDesc,
              brand: item.brand,
              groupName: item.groupName,
              installable: item.installable,
              qty: 1,
              type,
              salesChannel: null,
              frozen: null,
            });
          }
          itemResults.hidden = true;
          q('#diItemSearch').value = '';
          clearErrors(form);
          state.priced = null;
          drawLines();
          drawPrice();
          schedulePrice();
        });

        const linesBody = q('[data-di-lines]');
        linesBody.addEventListener('input', (event) => {
          const qty = event.target.closest('[data-di-qty]');
          if (!qty) return;
          state.lines[Number(qty.dataset.diQty)].qty = qty.value;
          schedulePrice();
        });
        linesBody.addEventListener('change', (event) => {
          const select = event.target.closest('[data-di-type]');
          if (!select) return;
          const line = state.lines[Number(select.dataset.diType)];
          line.type = select.value;
          if (line.type === 'CSIDO' && line.installable !== false) {
            notifyDialog(
              'Delivery only for an installable item',
              line.itemCode +
                ' can be installed. Choose Delivery only (CSIDO) only when the installation was not done by us. You can continue.',
            );
          }
          state.priced = null;
          drawLines();
          drawPrice();
          schedulePrice();
        });
        linesBody.addEventListener('click', (event) => {
          const remove = event.target.closest('[data-di-remove]');
          if (!remove) return;
          state.lines.splice(Number(remove.dataset.diRemove), 1);
          state.priced = null;
          drawLines();
          drawPrice();
          schedulePrice();
        });
      }

      q('[data-di-actions]').addEventListener('click', async (event) => {
        const button = event.target.closest('button');
        if (!button) return;
        try {
          if (button.hasAttribute('data-di-new')) {
            resetJob();
            syncTabs();
            drawJob();
          } else if (button.hasAttribute('data-di-save')) {
            await save();
            setMessage('#workspaceMessage', state.job.reference + ' saved as a draft.', true);
            syncTabs();
            drawJob();
          } else if (button.hasAttribute('data-di-complete')) {
            if (!validateForComplete()) {
              setMessage(
                '#workspaceMessage',
                'Some details are missing. Check the highlighted fields.',
              );
              return;
            }
            button.disabled = true;
            await save();
            const result = await apiRequest(
              '/api/di-jobs/' + encodeURIComponent(state.job.id) + '/complete',
              { method: 'POST' },
            );
            applyJob(result);
            state.completionWarnings = result.warnings || [];
            setMessage(
              '#workspaceMessage',
              state.job.reference + ' completed: AED ' + fmt(state.job.totalRevenue) + '.',
              true,
            );
            syncTabs();
            drawJob();
          } else if (button.hasAttribute('data-di-cancel')) {
            if (!confirm('Cancel ' + state.job.reference + '? It will not count as revenue.'))
              return;
            applyJob(
              await apiRequest('/api/di-jobs/' + encodeURIComponent(state.job.id) + '/cancel', {
                method: 'POST',
              }),
            );
            setMessage('#workspaceMessage', state.job.reference + ' cancelled.', true);
            syncTabs();
            drawJob();
          } else if (button.hasAttribute('data-di-reopen')) {
            if (
              !confirm(
                'Reopen ' + state.job.reference + ' as a draft? Its frozen figures are cleared.',
              )
            )
              return;
            applyJob(
              await apiRequest('/api/di-jobs/' + encodeURIComponent(state.job.id) + '/reopen', {
                method: 'POST',
              }),
            );
            setMessage('#workspaceMessage', state.job.reference + ' reopened as a draft.', true);
            syncTabs();
            drawJob();
          }
        } catch (error) {
          button.disabled = false;
          setMessage('#workspaceMessage', error.message);
          if (state.job) {
            syncTabs();
          }
        }
      });
    }

    // ---------------- Compare with the master Excel ----------------
    async function loadCompare() {
      const c = state.compare;
      body.innerHTML = '<p class="form-note">Loading…</p>';
      try {
        c.data = await apiRequest('/api/di-jobs/compare?month=' + encodeURIComponent(c.month));
        c.error = '';
      } catch (error) {
        c.data = null;
        c.error = error.message;
      }
      drawCompare();
    }

    // Worked example (Compare with Excel): pick any invoice / delivery note and
    // see, line by line, how the master workbook priced it and how the portal
    // prices it, so every figure can be checked by hand.
    const EX_STATUS = {
      match: 'Matches',
      differs: 'Differs',
      'only-excel': 'Only in Excel',
      'only-portal': 'Only in the portal',
      none: 'Not found',
    };
    const exMoney = (value) => (value === null || value === undefined ? '—' : fmt(value));
    const exRate = (line) =>
      line.baseRate === null || line.baseRate === undefined
        ? line.charge
          ? 'Charge ' + fmt(line.charge)
          : '—'
        : (line.rateKind === 'batch' ? 'Batch ' : 'Standard ') + fmt(line.baseRate);

    function exampleExcelHtml(ex) {
      if (!ex.excel) {
        return '<p class="form-note">The master workbook has no Delivery &amp; Installation line for this number.</p>';
      }
      const rows = ex.excel.lines
        .map(
          (l) =>
            '<tr' +
            (l.revenue === 0 ? ' class="di-ex-zero"' : '') +
            '><td>' +
            escapeHtml(l.jobType) +
            '</td><td>' +
            escapeHtml(l.item || '—') +
            '</td><td class="num">' +
            escapeHtml(String(l.qty)) +
            '</td><td style="white-space:normal">' +
            escapeHtml(l.how) +
            (l.check ? '<div class="di-ex-check">' + escapeHtml(l.check) + '</div>' : '') +
            '</td><td class="num"><strong>' +
            fmt(l.revenue) +
            '</strong></td></tr>',
        )
        .join('');
      return (
        (ex.excel.refDocNo || ex.excel.custCode
          ? '<p class="di-ex-ref">' +
            refDocPill(ex.excel.refDocNo) +
            ' ' +
            custCodePill(ex.excel.custCode) +
            '</p>'
          : '') +
        '<div class="acc-wrap"><table class="acc-table"><thead><tr><th>Type</th><th>Item</th><th class="num">Qty</th><th>How the workbook priced it</th><th class="num">Revenue (AED)</th></tr></thead><tbody>' +
        rows +
        '<tr><td></td><td><strong>Invoice total</strong></td><td></td><td></td><td class="num"><strong>' +
        fmt(ex.excel.total) +
        '</strong></td></tr></tbody></table></div>' +
        (ex.excel.notes && ex.excel.notes.length
          ? '<ul class="di-ex-notes">' +
            ex.excel.notes.map((n) => '<li>' + escapeHtml(n) + '</li>').join('') +
            '</ul>'
          : '')
      );
    }

    function exampleJobHtml(job) {
      const head =
        '<div class="di-ex-job"><div class="di-ex-job-head"><button class="button-link" type="button" data-di-cmp-open="' +
        escapeHtml(job.id) +
        '"><strong>' +
        escapeHtml(job.reference) +
        '</strong></button> <span class="di-ex-tag">' +
        escapeHtml(job.status) +
        '</span> <span>' +
        escapeHtml(
          [
            job.serviceDate,
            job.customerName,
            job.salesman && 'Salesman ' + job.salesman,
            job.salesChannel && 'Channel ' + job.salesChannel,
            'Region ' + job.region,
          ]
            .filter(Boolean)
            .join(' · '),
        ) +
        '</span></div><p class="form-note">Delivery note ' +
        escapeHtml(job.deliveryNoteRef || '—') +
        (job.erpInvNo ? ' · ERP Inv No ' + escapeHtml(job.erpInvNo) : '') +
        ' · Units on the note: Delivery + Installation ' +
        job.note.csidiQty +
        ', Installation only ' +
        job.note.csiiiQty +
        ', Delivery only lines ' +
        job.note.csidoLines +
        '. The note’s unit total decides the batch rate and the discount tier.</p>';
      if (!job.lines.length) {
        return (
          head +
          (job.messages.length
            ? '<p class="form-note">' + escapeHtml(job.messages[0]) + '</p>'
            : '') +
          '</div>'
        );
      }
      const rows = job.lines
        .map(
          (l) =>
            '<tr' +
            (l.revenue === 0 ? ' class="di-ex-zero"' : '') +
            '><td>' +
            l.lineNo +
            '</td><td><strong>' +
            escapeHtml(l.itemCode) +
            '</strong><div class="form-note">' +
            escapeHtml(l.itemDesc || '') +
            '</div></td><td>' +
            escapeHtml(l.type) +
            '</td><td class="num">' +
            escapeHtml(String(l.qty)) +
            '</td><td>' +
            escapeHtml(l.pricingCategory || '—') +
            '</td><td class="num">' +
            escapeHtml(exRate(l)) +
            '</td><td class="num">' +
            (l.discountTier
              ? escapeHtml(String(Math.round((l.discountRate || 0) * 1000) / 10)) +
                '% (' +
                escapeHtml(l.discountTier) +
                ')'
              : '—') +
            '</td><td class="num">' +
            exMoney(l.netRate) +
            '</td><td class="num">' +
            exMoney(l.labour) +
            '</td><td class="num">' +
            exMoney(l.transport) +
            '</td><td class="num">' +
            exMoney(l.charge) +
            '</td><td class="num"><strong>' +
            exMoney(l.revenue) +
            '</strong></td></tr>',
        )
        .join('');
      const totals = job.totals;
      return (
        head +
        '<div class="acc-wrap"><table class="acc-table"><thead><tr><th>#</th><th>Item</th><th>Type</th><th class="num">Qty</th><th>Pricing category</th><th class="num">Base rate</th><th class="num">Discount</th><th class="num">Net rate</th><th class="num">Labour</th><th class="num">Transport</th><th class="num">Delivery only charge</th><th class="num">Revenue (AED)</th></tr></thead><tbody>' +
        rows +
        (totals
          ? '<tr><td></td><td><strong>Total</strong></td><td colspan="9">Delivery + Installation ' +
            fmt(totals.CSIDI) +
            ' · Delivery only ' +
            fmt(totals.CSIDO) +
            ' · Installation only ' +
            fmt(totals.CSIII) +
            '</td><td class="num"><strong>' +
            fmt(totals.total) +
            '</strong></td></tr>'
          : '') +
        '</tbody></table></div>' +
        '<ul class="di-ex-notes">' +
        job.lines
          .filter((l) => l.note)
          .map((l) => '<li><strong>Line ' + l.lineNo + ':</strong> ' + escapeHtml(l.note) + '</li>')
          .join('') +
        job.messages.map((m) => '<li>' + escapeHtml(m) + '</li>').join('') +
        '</ul></div>'
      );
    }

    function exampleResultHtml(ex) {
      const cmp = ex.comparison;
      const typeRows = ['CSIDI', 'CSIDO', 'CSIII']
        .map((type) => {
          const t = cmp.byType[type];
          if (!t.excelQty && !t.excelRevenue && !t.portalQty && !t.portalRevenue) return '';
          return (
            '<tr><td>' +
            type +
            '</td><td class="num">' +
            t.excelQty +
            '</td><td class="num">' +
            fmt(t.excelRevenue) +
            '</td><td class="num">' +
            t.portalQty +
            '</td><td class="num">' +
            fmt(t.portalRevenue) +
            '</td><td class="num">' +
            fmt(t.portalRevenue - t.excelRevenue) +
            '</td></tr>'
          );
        })
        .join('');
      return (
        '<h5>Excel &mdash; master workbook</h5>' +
        exampleExcelHtml(ex) +
        '<h5>Portal</h5>' +
        (ex.jobs.length
          ? ex.jobs.map(exampleJobHtml).join('')
          : '<p class="form-note">No portal job carries this delivery note or ERP Inv No.</p>') +
        '<h5>Comparison &mdash; ' +
        escapeHtml(EX_STATUS[cmp.status] || cmp.status) +
        '</h5>' +
        (typeRows
          ? '<div class="acc-wrap"><table class="acc-table"><thead><tr><th>Activity</th><th class="num">Excel qty</th><th class="num">Excel revenue</th><th class="num">Portal qty</th><th class="num">Portal revenue</th><th class="num">Difference</th></tr></thead><tbody>' +
            typeRows +
            '<tr><td><strong>Total</strong></td><td></td><td class="num"><strong>' +
            fmt(cmp.excelTotal || 0) +
            '</strong></td><td></td><td class="num"><strong>' +
            fmt(cmp.portalTotal || 0) +
            '</strong></td><td class="num"><strong>' +
            fmt(cmp.difference) +
            '</strong></td></tr></tbody></table></div>'
          : '') +
        (cmp.notes.length
          ? '<ul class="di-ex-notes">' +
            cmp.notes.map((n) => '<li>' + escapeHtml(n) + '</li>').join('') +
            '</ul>'
          : '') +
        '<p class="form-note">To check by hand: Net rate = the larger of the minimum rate and base rate × (1 − discount); Labour = net rate × quantity; Delivery + Installation revenue = labour + the transport charged once for the note; Delivery only = one charge for the note (flat, or regional transport when the note also has Delivery + Installation units).</p>'
      );
    }

    function exampleSectionHtml(data) {
      const ex = state.compare.example;
      const STATUS_SHORT = {
        match: 'matches',
        differs: 'differs',
        'only-excel': 'only in Excel',
        'only-portal': 'only in portal',
      };
      const options = data.rows
        .map(
          (r) =>
            '<option value="' +
            escapeHtml(r.key) +
            '"' +
            (r.key === ex.invoice ? ' selected' : '') +
            '>' +
            escapeHtml(
              r.key +
                ' · ' +
                (r.customer || 'No customer') +
                ' · ' +
                (r.date || '') +
                ' · ' +
                STATUS_SHORT[r.status] +
                ' · AED ' +
                fmt(r.excel ? r.excel.total : r.portal ? r.portal.total : 0),
            ) +
            '</option>',
        )
        .join('');
      return (
        '<section class="detail-action-card di-ex"><h4>Worked example &mdash; pick any invoice ' +
        tipHtml(
          'Choose an invoice or delivery note of the month, or type one. You see how the master workbook priced each line (the same reading as the Logic tab of the Service Revenue Dashboard), how the portal prices the job with that note, and the difference.',
        ) +
        '</h4><div class="field-grid"><div class="field"><label for="diExPick">Invoice / delivery note</label><select id="diExPick"><option value="">Choose…</option>' +
        options +
        '</select></div><div class="field"><label for="diExPaste">Or type one</label><span class="rl-paste-row"><input id="diExPaste" type="text" autocomplete="off" placeholder="e.g. 16101083" value="' +
        escapeHtml(ex.invoice) +
        '" /><button type="button" class="button button-primary" data-di-ex-load>Load</button></span></div></div>' +
        '<p class="form-note" data-di-ex-msg role="status">' +
        escapeHtml(ex.loading ? 'Loading…' : ex.error) +
        '</p><div data-di-ex-out>' +
        (ex.data ? exampleResultHtml(ex.data) : '') +
        '</div></section>'
      );
    }

    // Fetch the worked example for one invoice into state (no redraw).
    async function fetchExample(text) {
      const ex = state.compare.example;
      ex.error = '';
      try {
        ex.data = await apiRequest(
          '/api/di-jobs/compare/example?' + new URLSearchParams({ invoice: text }),
        );
        if (!ex.data.excel && !ex.data.jobs.length) {
          ex.error = 'Nothing found for ' + text + ' in the master workbook or the portal jobs.';
          ex.data = null;
        }
      } catch (error) {
        ex.data = null;
        ex.error = error.message || 'The example could not be loaded.';
      }
    }

    async function loadExample(invoice, scrollToIt) {
      const ex = state.compare.example;
      const text = (invoice || '').trim();
      if (!text) return;
      ex.invoice = text;
      ex.loading = true;
      ex.error = '';
      drawCompare();
      await fetchExample(text);
      ex.loading = false;
      drawCompare();
      // Clicking a row of the table jumps down to the worked example.
      if (scrollToIt)
        body.querySelector('.di-ex')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Re-read the comparison (and the invoice shown in the worked example) from
    // the database, so a job completed in another tab shows up without reloading.
    async function refreshCompare() {
      const c = state.compare;
      const button = q('[data-di-cmp-refresh]');
      if (button) {
        button.disabled = true;
        button.textContent = 'Refreshing…';
      }
      try {
        c.data = await apiRequest('/api/di-jobs/compare?month=' + encodeURIComponent(c.month));
        c.error = '';
        if (c.example.invoice) await fetchExample(c.example.invoice);
        c.refreshedAt = new Date();
      } catch (error) {
        c.error = error.message;
      }
      drawCompare();
    }

    function drawCompare() {
      const c = state.compare;
      const data = c.data;
      const monthBar =
        '<div class="field-grid"><div class="field"><label for="diCMonth">Month</label><input id="diCMonth" type="month" value="' +
        escapeHtml(c.month) +
        '" /></div><div class="field"><label><input type="checkbox" id="diCShowMatched"' +
        (c.showMatched ? ' checked' : '') +
        ' /> Also list the delivery notes that match</label></div><div class="field"><label>&nbsp;</label><span class="rl-paste-row"><button type="button" class="button button-outline" data-di-cmp-refresh title="Read the jobs and the master workbook again, e.g. after completing a job in another tab">Refresh</button>' +
        (c.refreshedAt
          ? '<span class="form-note">Updated ' +
            escapeHtml(
              c.refreshedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
            ) +
            '</span>'
          : '') +
        '</span></div></div>';
      let html = monthBar;
      if (!data) {
        html +=
          '<p class="di-issue-error">' +
          escapeHtml(c.error || 'The comparison could not be loaded.') +
          '</p>';
      } else {
        const s = data.summary;
        html +=
          '<p class="form-note">Master workbook: ' +
          escapeHtml(data.workbook.fileName) +
          ' (uploaded ' +
          escapeHtml(formatDate(data.workbook.uploadedAt)) +
          '). Excel lines are matched to Completed portal jobs by the delivery note or the ERP Inv No.</p>' +
          '<div class="acc-wrap"><table class="acc-table"><thead><tr><th>Activity</th><th class="num">Excel qty</th><th class="num">Excel revenue</th><th class="num">Portal qty</th><th class="num">Portal revenue</th><th class="num">Difference</th></tr></thead><tbody>' +
          ['CSIDI', 'CSIDO', 'CSIII']
            .map((type) => {
              const t = s.byType[type];
              return (
                '<tr><td>' +
                type +
                '</td><td class="num">' +
                t.excelQty +
                '</td><td class="num">' +
                fmt(t.excelRevenue) +
                '</td><td class="num">' +
                t.portalQty +
                '</td><td class="num">' +
                fmt(t.portalRevenue) +
                '</td><td class="num">' +
                fmt(t.difference) +
                '</td></tr>'
              );
            })
            .join('') +
          '<tr><td><strong>Total</strong></td><td></td><td class="num"><strong>' +
          fmt(s.excelTotal) +
          '</strong></td><td></td><td class="num"><strong>' +
          fmt(s.portalTotal) +
          '</strong></td><td class="num"><strong>' +
          fmt(s.difference) +
          '</strong></td></tr></tbody></table></div>' +
          '<p class="form-note">Delivery notes: <strong>' +
          s.counts.match +
          '</strong> match · <strong>' +
          s.counts.differs +
          '</strong> differ · <strong>' +
          s.counts.onlyExcel +
          '</strong> only in Excel · <strong>' +
          s.counts.onlyPortal +
          '</strong> only in the portal.' +
          (s.counts.differs + s.counts.onlyExcel + s.counts.onlyPortal === 0
            ? ' Nothing to reconcile for this month.'
            : '') +
          '</p>';
        const STATUS = {
          match: 'Matches',
          differs: 'Differs',
          'only-excel': 'Only in Excel',
          'only-portal': 'Only in portal',
        };
        const shown = data.rows.filter((r) => c.showMatched || r.status !== 'match');
        html +=
          '<p class="form-note">Click an Inv/Del No to see why it matches or differs in the worked example below.</p>' +
          '<div class="acc-wrap"><table class="acc-table"><thead><tr><th>Status</th><th>Inv/Del No</th><th>Customer</th><th>Date</th><th class="num">Excel (AED)</th><th class="num">Portal (AED)</th><th class="num">Difference</th><th>Portal job</th></tr></thead><tbody>' +
          (shown.length
            ? shown
                .map(
                  (r) =>
                    '<tr><td><span class="di-st di-st-' +
                    escapeHtml(r.status) +
                    '">' +
                    escapeHtml(STATUS[r.status]) +
                    '</span></td><td><button class="button-link" type="button" data-di-ex-key="' +
                    escapeHtml(r.key) +
                    '" title="Show the worked example">' +
                    escapeHtml(r.key) +
                    '</button></td><td>' +
                    escapeHtml(r.customer || '—') +
                    '</td><td>' +
                    escapeHtml(r.date || '—') +
                    '</td><td class="num">' +
                    fmt(r.excel ? r.excel.total : 0) +
                    '</td><td class="num">' +
                    fmt(r.portal ? r.portal.total : 0) +
                    '</td><td class="num">' +
                    fmt(r.difference) +
                    '</td><td>' +
                    r.jobs
                      .map(
                        (j) =>
                          '<button class="button-link" type="button" data-di-cmp-open="' +
                          escapeHtml(j.id) +
                          '">' +
                          escapeHtml(j.reference) +
                          '</button>',
                      )
                      .join(' ') +
                    '</td></tr>',
                )
                .join('')
            : '<tr><td colspan="8" class="empty-state">Nothing to show.</td></tr>') +
          '</tbody></table></div>';
        html += exampleSectionHtml(data);
      }
      body.innerHTML = html;
      q('#diCMonth').addEventListener('change', () => {
        if (!q('#diCMonth').value) return;
        c.month = q('#diCMonth').value;
        c.example = { invoice: '', data: null, error: '', loading: false };
        loadCompare();
      });
      q('[data-di-cmp-refresh]').addEventListener('click', refreshCompare);
      q('#diCShowMatched').addEventListener('change', () => {
        c.showMatched = q('#diCShowMatched').checked;
        drawCompare();
      });
      const pick = q('#diExPick');
      if (pick) {
        pick.addEventListener('change', () => pick.value && loadExample(pick.value));
        const paste = q('#diExPaste');
        const go = () => paste.value.trim() && loadExample(paste.value);
        q('[data-di-ex-load]').addEventListener('click', go);
        paste.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') go();
        });
      }
      body
        .querySelectorAll('[data-di-ex-key]')
        .forEach((button) =>
          button.addEventListener('click', () => loadExample(button.dataset.diExKey, true)),
        );
      body.querySelectorAll('[data-di-cmp-open]').forEach((button) =>
        button.addEventListener('click', async () => {
          try {
            applyJob(
              await apiRequest('/api/di-jobs/' + encodeURIComponent(button.dataset.diCmpOpen)),
            );
            state.tab = 'job';
            syncTabs();
            drawJob();
          } catch (error) {
            setMessage('#workspaceMessage', error.message);
          }
        }),
      );
    }

    // ---------------- Jobs list ----------------
    async function loadJobs() {
      const f = state.list;
      const params = new URLSearchParams({ page: String(f.page), pageSize: '50' });
      if (f.status) params.set('status', f.status);
      if (f.from) params.set('from', f.from);
      if (f.to) params.set('to', f.to);
      if (f.search) params.set('search', f.search);
      body.innerHTML = '<p class="form-note">Loading…</p>';
      try {
        f.data = await apiRequest('/api/di-jobs?' + params.toString());
      } catch (error) {
        body.innerHTML = '';
        setMessage('#workspaceMessage', error.message);
        return;
      }
      drawJobs();
    }

    function drawJobs() {
      const f = state.list;
      const data = f.data;
      const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
      const statusOptions = ['', 'Draft', 'Completed', 'Cancelled']
        .map(
          (s) =>
            '<option value="' +
            s +
            '"' +
            (s === f.status ? ' selected' : '') +
            '>' +
            (s || 'All statuses') +
            '</option>',
        )
        .join('');
      body.innerHTML =
        '<div class="field-grid">' +
        '<div class="field"><label for="diFStatus">Status</label><select id="diFStatus">' +
        statusOptions +
        '</select></div>' +
        '<div class="field"><label for="diFFrom">From</label><input id="diFFrom" type="date" value="' +
        escapeHtml(f.from) +
        '" /></div>' +
        '<div class="field"><label for="diFTo">To</label><input id="diFTo" type="date" value="' +
        escapeHtml(f.to) +
        '" /></div>' +
        '<div class="field"><label for="diFSearch">Search</label><input id="diFSearch" placeholder="Reference, customer, delivery note…" value="' +
        escapeHtml(f.search) +
        '" /></div>' +
        '</div>' +
        '<div class="acc-wrap"><table class="acc-table"><thead><tr><th>Reference</th><th>Date</th><th>Customer</th><th>Delivery note</th><th>Salesman</th><th>Channel</th><th>Status</th><th class="num">Lines</th><th class="num">Revenue (AED)</th><th></th></tr></thead><tbody>' +
        (data.jobs.length
          ? data.jobs
              .map(
                (job) =>
                  '<tr><td>' +
                  escapeHtml(job.reference) +
                  '</td><td>' +
                  escapeHtml(job.serviceDate) +
                  '</td><td>' +
                  escapeHtml(job.customerName || '—') +
                  '</td><td>' +
                  escapeHtml(job.deliveryNoteRef || '—') +
                  '</td><td>' +
                  escapeHtml(job.salesman || '—') +
                  '</td><td>' +
                  escapeHtml(job.salesChannel || '—') +
                  '</td><td>' +
                  escapeHtml(job.status) +
                  '</td><td class="num">' +
                  job.lineCount +
                  '</td><td class="num">' +
                  (job.status === 'Completed' ? fmt(job.totalRevenue) : '—') +
                  '</td><td><button class="button" type="button" data-di-open="' +
                  escapeHtml(job.id) +
                  '">Open</button></td></tr>',
              )
              .join('')
          : '<tr><td colspan="10" class="empty-state">No jobs match.</td></tr>') +
        '</tbody></table></div>' +
        '<div class="form-footer"><span class="form-note">' +
        data.total +
        ' job(s) · page ' +
        f.page +
        ' of ' +
        pages +
        '</span>' +
        '<button class="button button-outline" type="button" data-di-page="-1"' +
        (f.page <= 1 ? ' disabled' : '') +
        '>Previous</button>' +
        '<button class="button button-outline" type="button" data-di-page="1"' +
        (f.page >= pages ? ' disabled' : '') +
        '>Next</button></div>' +
        (canConfigure
          ? '<section class="detail-action-card"><h4>Settings</h4><label><input type="checkbox" id="diErpMandatory"' +
            (state.options.erpInvMandatory ? ' checked' : '') +
            ' /> The ERP Inv No is required before a job can be completed</label><p class="form-note">Leave this off while testing; switch it on once the ERP Inv No is entered on every job.</p></section>'
          : '');
      const refilter = () => {
        f.status = q('#diFStatus').value;
        f.from = q('#diFFrom').value;
        f.to = q('#diFTo').value;
        f.search = q('#diFSearch').value.trim();
        f.page = 1;
        loadJobs();
      };
      ['#diFStatus', '#diFFrom', '#diFTo'].forEach((sel) =>
        q(sel).addEventListener('change', refilter),
      );
      q('#diFSearch').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') refilter();
      });
      q('#diFSearch').addEventListener('change', refilter);
      body.querySelectorAll('[data-di-page]').forEach((button) =>
        button.addEventListener('click', () => {
          f.page += Number(button.dataset.diPage);
          loadJobs();
        }),
      );
      body.querySelectorAll('[data-di-open]').forEach((button) =>
        button.addEventListener('click', async () => {
          try {
            applyJob(await apiRequest('/api/di-jobs/' + encodeURIComponent(button.dataset.diOpen)));
            state.tab = 'job';
            syncTabs();
            drawJob();
          } catch (error) {
            setMessage('#workspaceMessage', error.message);
          }
        }),
      );
      const erp = q('#diErpMandatory');
      if (erp) {
        erp.addEventListener('change', async () => {
          try {
            await apiRequest('/api/di-jobs/settings', {
              method: 'PATCH',
              body: JSON.stringify({ erpInvMandatory: erp.checked }),
            });
            state.options.erpInvMandatory = erp.checked;
            setMessage('#workspaceMessage', 'Setting saved.', true);
          } catch (error) {
            erp.checked = !erp.checked;
            setMessage('#workspaceMessage', error.message);
          }
        });
      }
    }

    if (pendingDiJobId) {
      const wanted = pendingDiJobId;
      pendingDiJobId = null;
      try {
        applyJob(await apiRequest('/api/di-jobs/' + encodeURIComponent(wanted)));
        state.tab = 'job';
      } catch (error) {
        setMessage('#workspaceMessage', error.message);
      }
    }
    syncTabs();
    drawJob();
  }

  async function renderBilling(root) {
    const canRecord = hasPermission('invoices.write');
    const range = pgRangeFor('ytd');
    const fresh = {
      tab: 'ledger',
      range: 'ytd',
      from: range.from,
      to: range.to,
      type: '',
      payer: '',
      billTo: '',
      stage: '',
      search: '',
      page: 1,
      data: null,
      selected: null,
      downloading: false,
      rules: [],
      salesmen: [],
      brands: [],
    };
    // Coming back from a job opened out of the ledger keeps the filters, tab and page.
    const state = returningFromLink && pageMemo.billing ? pageMemo.billing : fresh;
    pageMemo.billing = state;
    const canEditRules = hasPermission('sales_channels.write');
    const money = (value) => {
      const n = Number(value) || 0;
      const text = Math.abs(n).toLocaleString('en-AE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      return n < 0 ? '<span class="acc-neg">(' + text + ')</span>' : text;
    };
    const plain = (value) => escapeHtml(value === null || value === undefined ? '' : value);
    const stageClass = (stage) =>
      stage === 'Paid'
        ? 'status-ok'
        : stage === 'Not invoiced' || stage === 'Invoiced, awaiting payment'
          ? 'status-warn'
          : stage === 'Internal billing'
            ? 'status-muted'
            : '';
    const RANGES = [
      ['month', 'This month'],
      ['last-month', 'Last month'],
      ['ytd', 'Year to date'],
      ['custom', 'Custom'],
      ['all', 'All dates'],
    ];

    root.innerHTML =
      '<div class="acc-bar" data-acc-bar></div>' +
      '<div class="form-note" data-acc-msg role="status"></div>' +
      '<div data-acc-kpi></div>' +
      '<div class="ws-tabs" role="tablist">' +
      '<button type="button" role="tab" class="ws-tab is-active" data-acc-tab="ledger" aria-selected="true">Billing ledger</button>' +
      '<button type="button" role="tab" class="ws-tab" data-acc-tab="statement" aria-selected="false">Bill-to statement</button>' +
      '<button type="button" role="tab" class="ws-tab" data-acc-tab="allocation" aria-selected="false">Cost allocation</button>' +
      '<button type="button" role="tab" class="ws-tab" data-acc-tab="rules" aria-selected="false">Billing rules</button>' +
      '</div><div data-acc-body></div>';
    const bar = root.querySelector('[data-acc-bar]');
    const msg = root.querySelector('[data-acc-msg]');
    const kpi = root.querySelector('[data-acc-kpi]');
    const body = root.querySelector('[data-acc-body]');

    function say(text, isError) {
      msg.textContent = text || '';
      msg.className = 'form-note' + (isError ? ' form-note-error' : '');
    }
    const query = (extra) =>
      rdQs({
        from: state.range === 'all' ? '' : state.from,
        to: state.range === 'all' ? '' : state.to,
        type: state.type,
        payer: state.payer,
        billTo: state.billTo,
        stage: state.stage,
        search: state.search,
        ...extra,
      });

    function drawBar() {
      const d = state.data;
      const opt = (value, label, current) =>
        '<option value="' +
        escapeHtml(value) +
        '"' +
        (value === current ? ' selected' : '') +
        '>' +
        escapeHtml(label) +
        '</option>';
      bar.innerHTML =
        '<div class="th-field"><label>Period<select data-acc="range">' +
        RANGES.map(([v, l]) => opt(v, l, state.range)).join('') +
        '</select></label></div>' +
        '<div class="th-field"><label>From<input type="date" data-acc="from" value="' +
        escapeHtml(state.from) +
        '"' +
        (state.range === 'custom' ? '' : ' disabled') +
        '></label></div>' +
        '<div class="th-field"><label>To<input type="date" data-acc="to" value="' +
        escapeHtml(state.to) +
        '"' +
        (state.range === 'custom' ? '' : ' disabled') +
        '></label></div>' +
        '<div class="th-field"><label>Job type<select data-acc="type">' +
        opt('', 'All', state.type) +
        opt('CSIJW', 'CSIJW Warranty', state.type) +
        opt('CSIJO', 'CSIJO Non-warranty', state.type) +
        opt('CSIDI', 'CSIDI Delivery + Installation', state.type) +
        opt('CSIDO', 'CSIDO Delivery only', state.type) +
        opt('CSIII', 'CSIII Installation only', state.type) +
        '</select></label></div>' +
        '<div class="th-field"><label>Payment by<select data-acc="payer">' +
        opt('', 'All', state.payer) +
        opt('Sales channel', 'Sales channel', state.payer) +
        opt('Customer', 'Customer', state.payer) +
        '</select></label></div>' +
        '<div class="th-field"><label>Bill to<select data-acc="billTo">' +
        opt('', 'All', state.billTo) +
        ((d && d.billToOptions) || []).map((p) => opt(p, p, state.billTo)).join('') +
        '</select></label></div>' +
        '<div class="th-field"><label>Stage<select data-acc="stage">' +
        opt('', 'All', state.stage) +
        ((d && d.stages) || []).map((s) => opt(s, s, state.stage)).join('') +
        '</select></label></div>' +
        '<div class="th-field acc-search"><label>Search<input type="search" data-acc="search" placeholder="Job card, invoice, customer, item, serial" value="' +
        escapeHtml(state.search) +
        '"></label></div>' +
        '<div class="th-field rd-filter-actions"><button class="button button-primary" type="button" data-acc-download' +
        (state.downloading ? ' disabled' : '') +
        '>' +
        (state.downloading ? 'Preparing&hellip;' : 'Download Excel') +
        '</button></div>';
      const ctl = (name) => bar.querySelector('[data-acc="' + name + '"]');
      ctl('range').addEventListener('change', (event) => {
        state.range = event.target.value;
        if (state.range !== 'custom' && state.range !== 'all') {
          const r = pgRangeFor(state.range);
          state.from = r.from;
          state.to = r.to;
        }
        state.page = 1;
        load();
      });
      ['from', 'to', 'type', 'payer', 'billTo', 'stage'].forEach((name) =>
        ctl(name).addEventListener('change', (event) => {
          state[name] = event.target.value;
          state.page = 1;
          load();
        }),
      );
      let timer = null;
      ctl('search').addEventListener('input', (event) => {
        state.search = event.target.value.trim();
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          state.page = 1;
          load(true);
        }, 350);
      });
      bar.querySelector('[data-acc-download]').addEventListener('click', download);
    }

    function drawKpi() {
      const t = state.data && state.data.totals;
      if (!t) {
        kpi.innerHTML = '';
        return;
      }
      const cell = (label, value, cls) =>
        '<div class="acc-kpi ' +
        (cls || '') +
        '"><span>' +
        label +
        '</span><strong>' +
        value +
        '</strong></div>';
      kpi.innerHTML =
        '<div class="acc-kpis">' +
        cell('Jobs', String(t.jobs)) +
        cell('Service charge', money(t.serviceCharge)) +
        cell('Parts', money(t.partsCost)) +
        cell('Adjustment', money(t.adjustment)) +
        cell('Billed (AED)', money(t.billedAmount), 'acc-kpi-main') +
        cell('Internal billing', money(t.internalAmount || 0)) +
        cell('Invoiced in ERP', money(t.invoicedAmount)) +
        cell(
          'Not yet invoiced',
          money(t.notInvoicedAmount),
          t.notInvoicedAmount > 0 ? 'acc-kpi-warn' : '',
        ) +
        '</div>';
    }

    function recordPanel() {
      const row = state.selected;
      if (!row) return '';
      return (
        '<div class="detail-action-card" data-acc-record><h4>ERP invoice and payment: ' +
        plain(row.jobCardReference) +
        ' &middot; bill to ' +
        plain(row.billTo) +
        ' &middot; AED ' +
        money(row.billedAmount) +
        '</h4><div class="field-grid">' +
        '<div class="field"><label>ERP invoice no.<input type="text" data-rec="invoiceNo" maxlength="120" value="' +
        plain(row.invoiceNo) +
        '"></label></div>' +
        '<div class="field"><label>Invoice date<input type="date" data-rec="invoiceDate" value="' +
        plain((row.invoiceDate || '').slice(0, 10)) +
        '"></label></div>' +
        '<div class="field"><label>Payment mode<select data-rec="paymentMode"' +
        (row.payer === 'Customer' ? '' : ' disabled title="Only used when the customer pays"') +
        '><option value="">Select mode</option>' +
        ['Cash', 'Online', 'Bank transfer', 'Card']
          .map(
            (m) => '<option' + (row.paymentMode === m ? ' selected' : '') + '>' + m + '</option>',
          )
          .join('') +
        '</select></label></div>' +
        '<div class="field"><label>Payment reference<input type="text" data-rec="paymentReference" maxlength="200"' +
        (row.payer === 'Customer' ? '' : ' disabled title="Only used when the customer pays"') +
        ' value="' +
        plain(row.paymentReference) +
        '"></label></div>' +
        (row.payer === 'Customer'
          ? '<div class="field"><label class="check-label"><input type="checkbox" data-rec="paymentConfirmed"' +
            (row.paymentConfirmedAt ? ' checked' : '') +
            '> Payment received and confirmed</label></div>'
          : '') +
        '</div><div class="form-footer"><span></span><button class="button button-outline" type="button" data-rec-cancel>Close</button><button class="button button-primary" type="button" data-rec-save>Save</button></div></div>'
      );
    }

    function ledgerHtml() {
      const d = state.data;
      const rows = d.rows;
      const pageSum = (key) => rows.reduce((sum, r) => sum + (Number(r[key]) || 0), 0);
      const totalPages = Math.max(1, Math.ceil(d.total / d.pageSize));
      const body = rows
        .map(
          (r) =>
            '<tr><td class="acc-sticky"><button class="table-link" type="button" ' +
            (r.source === 'dandi'
              ? 'data-acc-open-di="' +
                plain(r.sourceRef) +
                '" title="Open the Delivery &amp; Installation job"'
              : 'data-acc-open="' + plain(r.id) + '"') +
            '>' +
            plain(r.jobCardReference) +
            '</button></td>' +
            '<td>' +
            plain(r.jobCardDate) +
            '</td><td>' +
            plain(r.billingJobType || '') +
            (r.source === 'dandi' && r.otherTypes
              ? '<br><small title="This line is one part of the job. Open the job to see all of it.">job also has ' +
                plain(r.otherTypes) +
                (r.jobTotal !== null && r.jobTotal !== undefined
                  ? ' &middot; job total ' + money(r.jobTotal)
                  : '') +
                '</small>'
              : '') +
            '</td><td>' +
            plain(r.registeredWarranty) +
            (r.finalWarranty && r.finalWarranty !== r.registeredWarranty
              ? '<br><small title="' +
                plain(r.warrantyChangeReason) +
                '">&rarr; ' +
                plain(r.finalWarranty) +
                '</small>'
              : '') +
            '</td><td><strong>' +
            plain(r.billTo) +
            '</strong><br><small>' +
            plain(r.payer || 'Payer not chosen') +
            '</small></td><td>' +
            plain(r.customerName) +
            (r.b2bBranchSchool ? '<br><small>' + plain(r.b2bBranchSchool) + '</small>' : '') +
            '</td><td>' +
            plain(r.salesOrderNumber) +
            (r.salesman ? '<br><small>' + plain(r.salesman) + '</small>' : '') +
            '</td><td>' +
            plain(r.itemCode) +
            '</td><td>' +
            plain(r.brand) +
            '</td><td>' +
            plain(r.modelNo) +
            (r.serialNo ? '<br><small>S/N ' + plain(r.serialNo) + '</small>' : '') +
            '</td><td>' +
            plain([r.mainGroup, r.groupName, r.subGroup].filter(Boolean).join(' / ')) +
            '</td><td class="num">' +
            money(r.serviceCharge) +
            '</td><td class="num">' +
            money(r.partsCost) +
            '</td><td class="num">' +
            money(r.adjustment) +
            '</td><td class="num"><strong>' +
            money(r.billedAmount) +
            '</strong></td><td>' +
            plain(r.invoiceNo || '') +
            (r.invoiceDate ? '<br><small>' + plain(r.invoiceDate) + '</small>' : '') +
            '</td><td>' +
            plain(r.paymentMode) +
            (r.paymentReference ? '<br><small>' + plain(r.paymentReference) + '</small>' : '') +
            '</td><td><span class="status ' +
            stageClass(r.stage) +
            '">' +
            plain(r.stage) +
            '</span></td><td>' +
            plain(r.jobFinalStatus) +
            '</td>' +
            (canRecord
              ? r.stage === 'Internal billing'
                ? '<td><small class="form-note" title="Billed to the sales channel (JDI or JER-C/INS) as internal billing. No ERP invoice is recorded; accounts adjust from the report.">Channel</small></td>'
                : '<td><button class="button button-outline" type="button" data-acc-record-open="' +
                  plain(r.id) +
                  '">Record</button></td>'
              : '') +
            '</tr>',
        )
        .join('');
      const t = d.totals;
      const typeNote = ['CSIDI', 'CSIDO', 'CSIII'].includes(state.type)
        ? '<p class="form-note">Showing only the ' +
          state.type +
          ' lines of Delivery &amp; Installation jobs. A job that also has other activity types appears again under those types; clear the Type filter to see the whole job.</p>'
        : '';
      return (
        recordPanel() +
        typeNote +
        '<div class="table-wrap acc-wrap"><table class="acc-table"><thead><tr><th class="acc-sticky">Job card</th><th>Date</th><th>Type</th><th>Warranty</th><th>Bill to</th><th>Customer / branch</th><th>Sales order / salesman</th><th>Item code</th><th>Brand</th><th>Model / serial</th><th>Main / group / sub group</th><th class="num">Service</th><th class="num">Parts</th><th class="num">Adj.</th><th class="num">Billed (AED)</th><th>ERP invoice</th><th>Payment</th><th>Stage</th><th>Job status</th><th></th>' +
        '</tr></thead><tbody>' +
        (body ||
          '<tr><td colspan="20" class="empty-state">No billed jobs match these filters.</td></tr>') +
        '</tbody><tfoot><tr><td class="acc-sticky" colspan="11">Page total (' +
        rows.length +
        ' jobs)</td><td class="num">' +
        money(pageSum('serviceCharge')) +
        '</td><td class="num">' +
        money(pageSum('partsCost')) +
        '</td><td class="num">' +
        money(pageSum('adjustment')) +
        '</td><td class="num">' +
        money(pageSum('billedAmount')) +
        '</td><td colspan="' +
        (canRecord ? 5 : 4) +
        '"></td></tr><tr class="acc-grand"><td class="acc-sticky" colspan="11">Total, all ' +
        t.jobs +
        ' matching jobs</td><td class="num">' +
        money(t.serviceCharge) +
        '</td><td class="num">' +
        money(t.partsCost) +
        '</td><td class="num">' +
        money(t.adjustment) +
        '</td><td class="num">' +
        money(t.billedAmount) +
        '</td><td colspan="' +
        (canRecord ? 5 : 4) +
        '"></td></tr></tfoot></table></div>' +
        '<div class="rd-pager"><button class="button button-outline" type="button" data-acc-prev' +
        (d.page <= 1 ? ' disabled' : '') +
        '>Previous</button><span class="form-note">Page ' +
        d.page +
        ' of ' +
        totalPages +
        '</span><button class="button button-outline" type="button" data-acc-next' +
        (d.page >= totalPages ? ' disabled' : '') +
        '>Next</button></div>'
      );
    }

    function statementHtml() {
      const rows = state.data.statement;
      const sum = (key) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
      return (
        '<div class="card-help"><span>About this section</span>' +
        tipHtml(
          'One line per party that receives a bill: the sales channel (or the channel a billing rule redirects to), or the customer when the customer pays. Use these totals for the ERP billing run; open a party to see its jobs.',
        ) +
        '</div>' +
        '<div class="table-wrap acc-wrap"><table class="acc-table"><thead><tr><th>Bill to</th><th class="num">Jobs</th><th class="num">Warranty CSIJW</th><th class="num">Non-warranty CSIJO</th><th class="num">Billed (AED)</th><th class="num">Invoiced in ERP</th><th class="num">Not yet invoiced</th><th class="num">Paid</th><th></th></tr></thead><tbody>' +
        (rows
          .map(
            (r) =>
              '<tr><td><strong>' +
              plain(r.billTo) +
              '</strong></td><td class="num">' +
              r.jobs +
              '</td><td class="num">' +
              money(r.warrantyAmount) +
              '</td><td class="num">' +
              money(r.nonWarrantyAmount) +
              '</td><td class="num"><strong>' +
              money(r.billedAmount) +
              '</strong></td><td class="num">' +
              money(r.invoicedAmount) +
              '</td><td class="num">' +
              money(r.notInvoicedAmount) +
              '</td><td class="num">' +
              money(r.paidAmount) +
              '</td><td><button class="button button-outline" type="button" data-acc-party="' +
              plain(r.billTo) +
              '">Jobs</button></td></tr>',
          )
          .join('') ||
          '<tr><td colspan="9" class="empty-state">Nothing to bill for these filters.</td></tr>') +
        '</tbody><tfoot><tr class="acc-grand"><td>Total</td><td class="num">' +
        sum('jobs') +
        '</td><td class="num">' +
        money(sum('warrantyAmount')) +
        '</td><td class="num">' +
        money(sum('nonWarrantyAmount')) +
        '</td><td class="num">' +
        money(sum('billedAmount')) +
        '</td><td class="num">' +
        money(sum('invoicedAmount')) +
        '</td><td class="num">' +
        money(sum('notInvoicedAmount')) +
        '</td><td class="num">' +
        money(sum('paidAmount')) +
        '</td><td></td></tr></tfoot></table></div>'
      );
    }

    function allocationHtml() {
      const rows = state.data.allocation;
      const sum = (list, key) => list.reduce((s, r) => s + (Number(r[key]) || 0), 0);
      const brands = [...new Set(rows.map((r) => r.brand))];
      const lines = brands
        .map((brand) => {
          const list = rows.filter((r) => r.brand === brand);
          return (
            list
              .map(
                (r) =>
                  '<tr><td>' +
                  plain(r.brand) +
                  '</td><td>' +
                  plain(r.mainGroup) +
                  '</td><td>' +
                  plain(r.groupName) +
                  '</td><td class="num">' +
                  r.jobs +
                  '</td><td class="num">' +
                  money(r.serviceCharge) +
                  '</td><td class="num">' +
                  money(r.partsCost) +
                  '</td><td class="num">' +
                  money(r.billedAmount) +
                  '</td></tr>',
              )
              .join('') +
            '<tr class="acc-subtotal"><td colspan="3">Subtotal ' +
            plain(brand) +
            '</td><td class="num">' +
            sum(list, 'jobs') +
            '</td><td class="num">' +
            money(sum(list, 'serviceCharge')) +
            '</td><td class="num">' +
            money(sum(list, 'partsCost')) +
            '</td><td class="num">' +
            money(sum(list, 'billedAmount')) +
            '</td></tr>'
          );
        })
        .join('');
      return (
        '<div class="card-help"><span>About this section</span>' +
        tipHtml(
          'Billed amount split by brand, main group and group (from the stock master on each job card) for ERP cost allocation. Jobs without an item code show as Unassigned.',
        ) +
        '</div>' +
        '<div class="table-wrap acc-wrap"><table class="acc-table"><thead><tr><th>Brand</th><th>Main group</th><th>Group</th><th class="num">Jobs</th><th class="num">Service charge</th><th class="num">Parts</th><th class="num">Billed (AED)</th></tr></thead><tbody>' +
        (lines ||
          '<tr><td colspan="7" class="empty-state">Nothing to allocate for these filters.</td></tr>') +
        '</tbody><tfoot><tr class="acc-grand"><td colspan="3">Total</td><td class="num">' +
        sum(rows, 'jobs') +
        '</td><td class="num">' +
        money(sum(rows, 'serviceCharge')) +
        '</td><td class="num">' +
        money(sum(rows, 'partsCost')) +
        '</td><td class="num">' +
        money(sum(rows, 'billedAmount')) +
        '</td></tr></tfoot></table></div>'
      );
    }

    function drawBody() {
      // The rules tab is not about the ledger: no filters or totals above it.
      bar.hidden = state.tab === 'rules';
      kpi.hidden = state.tab === 'rules';
      if (state.tab === 'rules') {
        loadRules();
        return;
      }
      if (!state.data) return;
      body.innerHTML =
        state.tab === 'statement'
          ? statementHtml()
          : state.tab === 'allocation'
            ? allocationHtml()
            : ledgerHtml();
      body.querySelectorAll('[data-acc-open-di]').forEach((el) =>
        el.addEventListener('click', () => {
          pendingDiJobId = el.dataset.accOpenDi;
          setWorkspaceMode('delivery-install');
        }),
      );
      body.querySelectorAll('[data-acc-open]').forEach((el) =>
        el.addEventListener('click', () => {
          setWorkspaceMode('job-cards');
          loadJobCardDetail(el.dataset.accOpen);
        }),
      );
      body.querySelectorAll('[data-acc-record-open]').forEach((el) =>
        el.addEventListener('click', () => {
          state.selected = state.data.rows.find((r) => r.id === el.dataset.accRecordOpen) || null;
          drawBody();
          body.querySelector('[data-acc-record]')?.scrollIntoView({ block: 'nearest' });
        }),
      );
      body.querySelectorAll('[data-acc-party]').forEach((el) =>
        el.addEventListener('click', () => {
          state.billTo = el.dataset.accParty;
          state.tab = 'ledger';
          syncTabs();
          state.page = 1;
          load();
        }),
      );
      body.querySelector('[data-rec-cancel]')?.addEventListener('click', () => {
        state.selected = null;
        drawBody();
      });
      body.querySelector('[data-rec-save]')?.addEventListener('click', saveRecord);
      body.querySelector('[data-acc-prev]')?.addEventListener('click', () => {
        state.page = Math.max(1, state.page - 1);
        load(true);
      });
      body.querySelector('[data-acc-next]')?.addEventListener('click', () => {
        state.page += 1;
        load(true);
      });
    }

    // ---- Billing rules tab (moved here from Invoices, modification #155) ----
    function drawRules() {
      const rows = state.rules
        .map(
          (r) =>
            '<tr><td>' +
            escapeHtml(r.salesman || 'Any') +
            '</td><td>' +
            escapeHtml(r.branchKeyword || 'Any') +
            '</td><td>' +
            escapeHtml(r.brand ? (r.brandMatch === 'is_not' ? 'Not ' : '') + r.brand : 'Any') +
            '</td><td><strong>' +
            escapeHtml(r.billToChannel) +
            '</strong></td><td>' +
            (r.active ? 'Active' : 'Off') +
            '</td><td>' +
            escapeHtml(r.notes || '') +
            '</td>' +
            (canEditRules
              ? '<td><button class="button button-outline" type="button" data-rule-toggle="' +
                escapeHtml(r.id) +
                '">' +
                (r.active ? 'Turn off' : 'Turn on') +
                '</button></td>'
              : '') +
            '</tr>',
        )
        .join('');
      body.innerHTML =
        '<div class="card-help"><span>About this section</span>' +
        tipHtml(
          "When a job is billed to a sales channel, the matching rule decides which channel. A rule matches when the salesman is the same (blank = any), the B2B branch / school name contains the keyword (blank = any) and the item brand is, or is not, the brand given (blank = any). When several rules match, the most specific one (the most conditions filled in) wins. With no match, the job's own sales channel is billed.",
        ) +
        '</div>' +
        '<div class="table-wrap"><table><thead><tr><th>Salesman</th><th>Branch / school contains</th><th>Brand</th><th>Bill to</th><th>Status</th><th>Notes</th>' +
        (canEditRules ? '<th></th>' : '') +
        '</tr></thead><tbody>' +
        (rows || '<tr><td colspan="7" class="empty-state">No rules yet.</td></tr>') +
        '</tbody></table></div>' +
        (canEditRules
          ? '<div class="detail-action-card"><h4>Add a rule</h4><div class="field-grid">' +
            '<div class="field"><label>Salesman<select data-rule="salesman"><option value="">Any salesman</option>' +
            state.salesmen.map((m) => '<option>' + escapeHtml(m) + '</option>').join('') +
            '</select></label></div>' +
            '<div class="field"><label>Branch / school contains<input type="text" data-rule="branchKeyword" maxlength="200" placeholder="e.g. GEMS"></label></div>' +
            '<div class="field"><label>Brand<select data-rule="brandMatch"><option value="is">is</option><option value="is_not">is not</option></select></label></div>' +
            '<div class="field"><label>Brand name' +
            (state.brands.length
              ? '<select data-rule="brand"><option value="">Any brand</option>' +
                state.brands.map((b) => '<option>' + escapeHtml(b) + '</option>').join('') +
                '</select>'
              : '<input type="text" data-rule="brand" maxlength="200" placeholder="e.g. VENUS">') +
            '</label></div>' +
            '<div class="field"><label>Bill to channel<select data-rule="billToChannel"><option value="">Select channel</option>' +
            salesChannelOptions.map((c) => '<option>' + escapeHtml(c.name) + '</option>').join('') +
            '</select></label></div>' +
            '<div class="field"><label>Notes<input type="text" data-rule="notes" maxlength="500"></label></div>' +
            '</div><div class="form-footer"><span></span><button class="button button-primary" type="button" data-rule-add>Add rule</button></div></div>'
          : '<p class="form-note">Only the super admin can change billing rules.</p>');
      body.querySelector('[data-rule-add]')?.addEventListener('click', async () => {
        const val = (name) => body.querySelector('[data-rule="' + name + '"]').value.trim();
        const payload = { billToChannel: val('billToChannel') };
        if (val('salesman')) payload.salesman = val('salesman');
        if (val('branchKeyword')) payload.branchKeyword = val('branchKeyword');
        if (val('brand')) {
          payload.brand = val('brand');
          payload.brandMatch = val('brandMatch');
        }
        if (val('notes')) payload.notes = val('notes');
        try {
          await apiRequest('/api/billing-rules', { method: 'POST', body: JSON.stringify(payload) });
          say('Rule added.');
          await loadRules();
        } catch (error) {
          say(error.message, true);
        }
      });
      body.querySelectorAll('[data-rule-toggle]').forEach((el) =>
        el.addEventListener('click', async () => {
          const rule = state.rules.find((r) => r.id === el.dataset.ruleToggle);
          if (!rule) return;
          try {
            await apiRequest('/api/billing-rules/' + encodeURIComponent(rule.id), {
              method: 'PATCH',
              body: JSON.stringify({
                salesman: rule.salesman,
                branchKeyword: rule.branchKeyword,
                brand: rule.brand,
                brandMatch: rule.brandMatch,
                billToChannel: rule.billToChannel,
                notes: rule.notes,
                active: !rule.active,
              }),
            });
            await loadRules();
          } catch (error) {
            say(error.message, true);
          }
        }),
      );
    }

    async function loadRules() {
      try {
        const result = await apiRequest('/api/billing-rules');
        state.rules = result.billingRules || [];
        // Salesman and brand are picked from the masters, never typed. A saved rule
        // whose salesman or brand is no longer in the master is still shown as is.
        state.salesmen = (salesmenOptions || []).map((m) => m.name);
        const facets = canEditRules ? await loadStockFacets() : { brands: [] };
        state.brands = (facets.brands || []).map((b) => b.brand);
        drawRules();
      } catch (error) {
        body.innerHTML = '<p class="form-note">' + escapeHtml(error.message) + '</p>';
      }
    }

    function syncTabs() {
      root.querySelectorAll('[data-acc-tab]').forEach((tab) => {
        const on = tab.dataset.accTab === state.tab;
        tab.classList.toggle('is-active', on);
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
      });
    }
    root.querySelectorAll('[data-acc-tab]').forEach((tab) =>
      tab.addEventListener('click', () => {
        state.tab = tab.dataset.accTab;
        syncTabs();
        drawBody();
      }),
    );

    async function saveRecord() {
      const row = state.selected;
      if (!row) return;
      const field = (name) => body.querySelector('[data-rec="' + name + '"]');
      const value = (name) => field(name).value.trim();
      const payload = {};
      if (value('invoiceNo')) payload.invoiceNo = value('invoiceNo');
      if (value('invoiceDate')) payload.invoiceDate = value('invoiceDate');
      if (value('paymentMode')) payload.paymentMode = value('paymentMode');
      if (value('paymentReference')) payload.paymentReference = value('paymentReference');
      const box = field('paymentConfirmed');
      if (box && box.checked !== Boolean(row.paymentConfirmedAt)) {
        payload.paymentConfirmed = box.checked;
      }
      try {
        await apiRequest('/api/job-cards/' + encodeURIComponent(row.id), {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        state.selected = null;
        say('Saved ' + row.jobCardReference + '.');
        await load(true);
      } catch (error) {
        say(error.message, true);
      }
    }

    async function download() {
      state.downloading = true;
      drawBar();
      say('');
      try {
        const blob = await apiBlobRequest('/api/billing/export?' + query({}));
        const label = state.range === 'all' ? 'All' : state.from + '_to_' + state.to;
        rdDownloadBlob(blob, 'Billing_' + label + '.xlsx');
        say('Downloaded Billing_' + label + '.xlsx (ledger, bill-to statement, cost allocation).');
      } catch (error) {
        say(error.message, true);
      } finally {
        state.downloading = false;
        drawBar();
      }
    }

    async function load(keepBar) {
      if (state.range === 'custom' && state.from && state.to && state.to < state.from) {
        say('The To date must be on or after the From date.', true);
        return;
      }
      try {
        state.data = await apiRequest(
          '/api/billing/ledger?' + query({ page: state.page, pageSize: 50 }),
        );
        if (!keepBar) drawBar();
        drawKpi();
        drawBody();
      } catch (error) {
        body.innerHTML = '<p class="form-note">' + escapeHtml(error.message) + '</p>';
      }
    }

    syncTabs();
    drawBar();
    await load(true);
    drawBar();
  }

  async function renderInvoices(root) {
    const state = {
      tab: 'invoices',
      type: '',
      paymentStatus: '',
      search: '',
      rows: [],
      summary: null,
      selected: null,
      message: '',
      error: '',
    };
    const canRecord = hasPermission('invoices.write');
    const aed = (value) =>
      'AED ' +
      (Number(value) || 0).toLocaleString('en-AE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    const typeLabel = (type) =>
      type === 'CSIJW'
        ? 'CSIJW Warranty'
        : type === 'CSIJO'
          ? 'CSIJO Non-warranty'
          : type || 'Unclassified';
    const statusClass = (status) =>
      status === 'Paid'
        ? 'status-ok'
        : status === 'Awaiting invoice' || status === 'Awaiting payment'
          ? 'status-warn'
          : '';

    root.innerHTML =
      '<div data-inv-message class="form-note" role="status"></div><div data-inv-body></div>';
    const body = root.querySelector('[data-inv-body]');
    const messageEl = root.querySelector('[data-inv-message]');

    function say(text, isError) {
      messageEl.textContent = text || '';
      messageEl.className = 'form-note' + (isError ? ' form-note-error' : '');
    }

    function tiles() {
      const s = state.summary;
      if (!s) return '';
      const typeTiles = s.byType
        .map(
          (t) =>
            '<div class="dash-tile"><span class="dash-tile-label">' +
            escapeHtml(typeLabel(t.billingJobType)) +
            '</span><strong>' +
            t.jobs +
            ' jobs</strong><span>' +
            aed(t.amount) +
            '</span></div>',
        )
        .join('');
      const stageTiles = s.byPaymentStatus
        .map(
          (t) =>
            '<button type="button" class="dash-tile dash-tile-click" data-inv-stage="' +
            escapeHtml(t.paymentStatus) +
            '"><span class="dash-tile-label">' +
            escapeHtml(t.paymentStatus) +
            '</span><strong>' +
            t.jobs +
            ' jobs</strong><span>' +
            aed(t.amount) +
            '</span></button>',
        )
        .join('');
      return '<div class="dash-tiles">' + typeTiles + stageTiles + '</div>';
    }

    function recordPanel() {
      const detail = state.selected;
      if (!detail) return '';
      const job = detail.job;
      const invoice = detail.invoice;
      const customerPays = job.paymentBy === 'Customer';
      const issued = detail.issued;
      const lines = (invoice.lines || [])
        .map(
          (l) =>
            '<tr><td>' +
            l.sno +
            '</td><td>' +
            escapeHtml(l.itemCode) +
            '</td><td>' +
            escapeHtml(l.description) +
            '</td><td class="num">' +
            l.qty +
            '</td><td class="num">' +
            money(l.value) +
            '</td><td class="num">' +
            money(l.vat) +
            '</td><td class="num">' +
            money(l.amount) +
            '</td></tr>',
        )
        .join('');
      const totals = invoice.totals || { net: 0, vat: 0, gross: 0 };
      const pills =
        '<span class="status ' +
        (issued ? 'status-ok' : 'status-warn') +
        '">' +
        (issued ? 'Issued ' + escapeHtml(detail.portalInvoiceNo) : 'Not invoiced') +
        '</span>' +
        (detail.stale
          ? ' <span class="status status-warn">Amount changed after issue</span>' +
            tipHtml(
              'The job amount is now different from the issued invoice. The print keeps the issued figures; raise it with finance before delivery.',
            )
          : '') +
        (detail.deliveryBlockReason
          ? ' <span class="status status-warn">Cannot be delivered yet</span>' +
            tipHtml(escapeHtml(detail.deliveryBlockReason))
          : '');
      return (
        '<div class="detail-action-card" data-inv-record>' +
        '<h4>Invoice: ' +
        escapeHtml(job.jobCardReference) +
        ' &middot; ' +
        escapeHtml(invoice.customerName || '') +
        ' &middot; ' +
        aed(totals.gross) +
        '</h4><div class="inv-pills">' +
        pills +
        '</div>' +
        '<div class="field-grid">' +
        '<div class="field"><label>Customer TRN ' +
        tipHtml(
          'Optional, for a B2B or B2C customer who is VAT registered: 15 digits. It prints on the invoice only when entered. Jacky&rsquo;s own TRN always prints.',
        ) +
        '<input type="text" inputmode="numeric" data-rec="customerTrn" maxlength="20" value="' +
        escapeHtml(detail.customerTrn || '') +
        '"></label></div>' +
        '<div class="field"><label>Invoice date<input type="date" data-rec="invoiceDate"' +
        (issued ? ' disabled' : '') +
        ' value="' +
        escapeHtml((invoice.invoiceDate || '').slice(0, 10)) +
        '"></label></div>' +
        '<div class="field"><label>ERP reference ' +
        tipHtml(
          'Optional. The invoice number from the ERP, if the job was also invoiced there. The portal numbers its own invoices (SINV series).',
        ) +
        '<input type="text" data-rec="erpReference" maxlength="120" value="' +
        escapeHtml(detail.erpReference || '') +
        '"></label></div>' +
        '<div class="field field-wide"><label>Remarks<input type="text" data-rec="remarks" maxlength="500" value="' +
        escapeHtml(invoice.remarks || '') +
        '"></label></div>' +
        (customerPays
          ? '<div class="field"><label>Payment mode<select data-rec="paymentMode"><option value="">Select mode</option>' +
            ['Cash', 'Online', 'Bank transfer', 'Card']
              .map(
                (m) =>
                  '<option' + (detail.paymentMode === m ? ' selected' : '') + '>' + m + '</option>',
              )
              .join('') +
            '</select></label></div>' +
            '<div class="field"><label>Payment reference<input type="text" data-rec="paymentReference" maxlength="200" placeholder="Receipt or transaction no." value="' +
            escapeHtml(detail.paymentReference || '') +
            '"></label></div>' +
            '<div class="field"><label class="check-label"><input type="checkbox" data-rec="paymentConfirmed"' +
            (detail.paymentConfirmedAt ? ' checked' : '') +
            (issued ? '' : ' disabled') +
            '> Payment received and confirmed ' +
            tipHtml(
              'The job can be delivered only after the invoice is issued and the payment is confirmed. Untick to undo a mistake.',
            ) +
            '</label></div>'
          : '') +
        '</div>' +
        '<div class="table-wrap acc-wrap"><table class="acc-table"><thead><tr><th>#</th><th>Item code</th><th>Description</th><th class="num">Qty</th><th class="num">Value</th><th class="num">VAT 5%</th><th class="num">Amount</th></tr></thead><tbody>' +
        lines +
        '</tbody><tfoot><tr><th colspan="4">Total (VAT inclusive)</th><th class="num">' +
        money(totals.net) +
        '</th><th class="num">' +
        money(totals.vat) +
        '</th><th class="num">' +
        money(totals.gross) +
        '</th></tr></tfoot></table></div>' +
        '<div class="form-footer"><span></span><button class="button button-outline" type="button" data-rec-cancel>Close</button>' +
        (issued
          ? '<button class="button button-outline" type="button" data-rec-print>Print invoice</button>'
          : canRecord
            ? '<button class="button button-outline" type="button" data-rec-issue>Issue invoice</button>'
            : '') +
        (canRecord
          ? '<button class="button button-primary" type="button" data-rec-save>Save</button>'
          : '') +
        '</div></div>'
      );
    }

    function drawInvoices() {
      const rows = state.rows
        .map(
          (r) =>
            '<tr><td class="acc-sticky"><button class="table-link" type="button" data-inv-open="' +
            escapeHtml(r.id) +
            '">' +
            escapeHtml(r.jobCardReference) +
            '</button></td>' +
            '<td>' +
            escapeHtml(typeLabel(r.billingJobType)) +
            '</td>' +
            '<td><strong>' +
            escapeHtml(r.customerName || '') +
            '</strong></td>' +
            '<td>' +
            escapeHtml(r.paymentBy || '—') +
            (r.billToChannel ? '<br><small>' + escapeHtml(r.billToChannel) + '</small>' : '') +
            '</td>' +
            '<td class="num">' +
            aed(r.amount) +
            '</td>' +
            '<td>' +
            (r.portalInvoiceNo
              ? escapeHtml(r.portalInvoiceNo) +
                (r.invoiceNo ? '<br><small>ERP ' + escapeHtml(r.invoiceNo) + '</small>' : '')
              : r.invoiceNo
                ? '<small>ERP ' + escapeHtml(r.invoiceNo) + '</small>'
                : '—') +
            '</td>' +
            '<td>' +
            escapeHtml(r.paymentMode || '—') +
            '</td>' +
            '<td><span class="status ' +
            statusClass(r.paymentStatus) +
            '">' +
            escapeHtml(r.paymentStatus) +
            '</span></td>' +
            '<td>' +
            escapeHtml(r.jobFinalStatus) +
            '</td>' +
            '<td><button class="button button-outline" type="button" data-inv-record-open="' +
            escapeHtml(r.id) +
            '">Invoice</button></td>' +
            '</tr>',
        )
        .join('');
      body.innerHTML =
        tiles() +
        '<div class="rc-section rd-filter-card"><div class="rd-report-toolbar">' +
        '<div class="th-field"><label>Search<input type="search" data-inv-filter="search" value="' +
        escapeHtml(state.search) +
        '" placeholder="Job card, customer, invoice, channel"></label></div>' +
        '<div class="th-field"><label>Job type<select data-inv-filter="type"><option value="">All</option><option value="CSIJW"' +
        (state.type === 'CSIJW' ? ' selected' : '') +
        '>CSIJW Warranty</option><option value="CSIJO"' +
        (state.type === 'CSIJO' ? ' selected' : '') +
        '>CSIJO Non-warranty</option></select></label></div>' +
        '<div class="th-field"><label>Payment stage<select data-inv-filter="paymentStatus"><option value="">All</option>' +
        ['Awaiting invoice', 'Awaiting payment', 'Paid', 'Channel', 'Unassigned']
          .map(
            (v) =>
              '<option' + (state.paymentStatus === v ? ' selected' : '') + '>' + v + '</option>',
          )
          .join('') +
        '</select></label></div>' +
        '</div><div class="card-help card-help-up"><span>Need Excel?</span>' +
        tipHtml(
          'For Excel, use Reports: Job Invoices, or Sales Channel Reconciliation for finance.',
        ) +
        '</div></div>' +
        recordPanel() +
        '<div class="table-wrap acc-wrap"><table class="acc-table"><thead><tr><th class="acc-sticky">Job card</th><th>Type</th><th>Customer</th><th>Payment by / bill to</th><th class="num">Amount</th><th>Invoice</th><th>Mode</th><th>Stage</th><th>Job status</th>' +
        (canRecord ? '<th></th>' : '') +
        '</tr></thead><tbody>' +
        (rows ||
          '<tr><td colspan="10" class="empty-state">No jobs with an amount match these filters.</td></tr>') +
        '</tbody></table></div>';

      body.querySelectorAll('[data-inv-filter]').forEach((el) => {
        el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'change', () => {
          state[el.dataset.invFilter] = el.value;
          loadInvoices();
        });
      });
      body.querySelectorAll('[data-inv-stage]').forEach((el) =>
        el.addEventListener('click', () => {
          state.paymentStatus = el.dataset.invStage;
          loadInvoices();
        }),
      );
      body.querySelectorAll('[data-inv-open]').forEach((el) =>
        el.addEventListener('click', () => {
          setWorkspaceMode('job-cards');
          loadJobCardDetail(el.dataset.invOpen);
        }),
      );
      body
        .querySelectorAll('[data-inv-record-open]')
        .forEach((el) => el.addEventListener('click', () => openInvoice(el.dataset.invRecordOpen)));
      body.querySelector('[data-rec-cancel]')?.addEventListener('click', () => {
        state.selected = null;
        drawInvoices();
      });
      body.querySelector('[data-rec-save]')?.addEventListener('click', () => saveRecord(false));
      body.querySelector('[data-rec-issue]')?.addEventListener('click', () => saveRecord(true));
      body
        .querySelector('[data-rec-print]')
        ?.addEventListener('click', () => printTaxInvoice(state.selected.invoice));
    }

    async function openInvoice(jobId) {
      try {
        const result = await apiRequest('/api/invoices/' + encodeURIComponent(jobId));
        state.selected = result.invoice;
        drawInvoices();
        body.querySelector('[data-inv-record]')?.scrollIntoView({ block: 'nearest' });
      } catch (error) {
        say(error.message, true);
      }
    }

    async function saveRecord(issue) {
      const detail = state.selected;
      if (!detail) return;
      const field = (name) => body.querySelector('[data-rec="' + name + '"]');
      const text = (name) => (field(name) ? field(name).value.trim() : undefined);
      const trn = (text('customerTrn') || '').replace(/[\s-]/g, '');
      if (trn && !/^\d{15}$/.test(trn)) {
        say('The customer TRN must be 15 digits.', true);
        return;
      }
      try {
        let current = detail;
        if (issue) {
          const payload = {};
          if (trn) payload.customerTrn = trn;
          if (text('invoiceDate')) payload.invoiceDate = text('invoiceDate');
          if (text('erpReference')) payload.erpReference = text('erpReference');
          if (text('remarks')) payload.remarks = text('remarks');
          const result = await apiRequest(
            '/api/invoices/' + encodeURIComponent(detail.job.id) + '/issue',
            { method: 'POST', body: JSON.stringify(payload) },
          );
          current = result.invoice;
          say('Issued ' + current.portalInvoiceNo + '.');
        } else {
          const payload = { customerTrn: trn, erpReference: text('erpReference') };
          if (detail.issued && text('remarks')) payload.remarks = text('remarks');
          if (text('paymentMode')) payload.paymentMode = text('paymentMode');
          if (text('paymentReference') !== undefined) {
            payload.paymentReference = text('paymentReference');
          }
          const box = field('paymentConfirmed');
          if (box && box.checked !== Boolean(detail.paymentConfirmedAt)) {
            payload.paymentConfirmed = box.checked;
          }
          const result = await apiRequest('/api/invoices/' + encodeURIComponent(detail.job.id), {
            method: 'PATCH',
            body: JSON.stringify(payload),
          });
          current = result.invoice;
          say('Saved ' + detail.job.jobCardReference + '.');
        }
        state.selected = current;
        await loadInvoices();
      } catch (error) {
        say(error.message, true);
      }
    }

    async function loadInvoices() {
      try {
        const params = new URLSearchParams({ page: '1', pageSize: '100' });
        if (state.search) params.set('search', state.search);
        if (state.type) params.set('type', state.type);
        if (state.paymentStatus) params.set('paymentStatus', state.paymentStatus);
        const [list, summary] = await Promise.all([
          apiRequest('/api/invoices?' + params),
          apiRequest('/api/invoices/summary'),
        ]);
        state.rows = list.invoices || [];
        state.summary = summary.summary;
        drawInvoices();
        if (pendingInvoiceJobId) {
          const jobId = pendingInvoiceJobId;
          pendingInvoiceJobId = null;
          await openInvoice(jobId);
        }
      } catch (error) {
        body.innerHTML = '<p class="form-note">' + escapeHtml(error.message) + '</p>';
      }
    }

    await loadInvoices();
  }

  async function renderDailyList(root) {
    const today = pgYmd(new Date());
    const state = {
      from: today,
      to: today,
      by: 'technician',
      technician: '',
      selected: new Set(),
      rows: [],
      truncated: false,
      error: '',
    };
    // Rows after the technician filter, and the rows a print button acts on:
    // the ticked ones, or every visible one when nothing is ticked.
    function visibleRows() {
      if (!state.technician) return state.rows;
      if (state.technician === '__none') return state.rows.filter((row) => !row.technicianId);
      return state.rows.filter((row) => row.technicianId === state.technician);
    }
    function printableRows() {
      const visible = visibleRows();
      const ticked = visible.filter((row) => state.selected.has(row.id));
      return ticked.length ? ticked : visible;
    }
    function printScopeLabel() {
      const visible = visibleRows();
      const ticked = visible.filter((row) => state.selected.has(row.id)).length;
      return ticked ? ticked + ' selected' : 'all ' + visible.length;
    }
    root.innerHTML =
      '<div class="rc-section rd-filter-card"><div class="rd-report-toolbar" data-dl-bar></div></div>' +
      '<div data-dl-results></div>';
    const bar = root.querySelector('[data-dl-bar]');
    const results = root.querySelector('[data-dl-results]');

    function drawBar() {
      bar.innerHTML =
        '<div class="th-field"><label>From<input type="date" data-dl="from" value="' +
        state.from +
        '" /></label></div><div class="th-field"><label>To<input type="date" data-dl="to" value="' +
        state.to +
        '" /></label></div>' +
        '<div class="th-field rd-filter-actions"><button class="button button-outline" type="button" data-dl-day="0">Today</button></div>' +
        '<div class="th-field rd-filter-actions"><button class="button button-outline" type="button" data-dl-day="1">Tomorrow</button></div>' +
        '<div class="th-field"><label>Group by<select data-dl="by"><option value="technician"' +
        (state.by === 'technician' ? ' selected' : '') +
        '>Technician</option><option value="branch"' +
        (state.by === 'branch' ? ' selected' : '') +
        '>Branch</option></select></label></div>' +
        '<div class="th-field"><label>Technician<select data-dl="technician">' +
        dlTechnicianOptions(state.rows, state.technician) +
        '</select></label></div>' +
        '<div class="th-field rd-filter-actions"><button class="button button-primary" type="button" data-dl-print-list' +
        (visibleRows().length ? '' : ' disabled') +
        '>Print list (' +
        printScopeLabel() +
        ')</button></div>' +
        '<div class="th-field rd-filter-actions"><button class="button button-outline" type="button" data-dl-print-sheets' +
        (visibleRows().length ? '' : ' disabled') +
        '>Print appointment sheets (' +
        printScopeLabel() +
        ')</button></div>';
      const control = (name) => bar.querySelector('[data-dl="' + name + '"]');
      ['from', 'to'].forEach((name) =>
        control(name).addEventListener('change', (event) => {
          state[name] = event.target.value;
          if (name === 'from' && state.to < state.from) state.to = state.from;
          load();
        }),
      );
      bar.querySelectorAll('[data-dl-day]').forEach((button) =>
        button.addEventListener('click', () => {
          const day = new Date();
          day.setDate(day.getDate() + Number(button.dataset.dlDay));
          state.from = state.to = pgYmd(day);
          load();
        }),
      );
      control('by').addEventListener('change', (event) => {
        state.by = event.target.value;
        drawResults();
        drawBar();
      });
      control('technician').addEventListener('change', (event) => {
        state.technician = event.target.value;
        drawBar();
        drawResults();
      });
      bar.querySelector('[data-dl-print-list]')?.addEventListener('click', () => {
        const rows = printableRows();
        if (dlPrintAllowed(rows)) dlPrintList(rows, state.by, state.from, state.to);
      });
      bar.querySelector('[data-dl-print-sheets]')?.addEventListener('click', () => {
        const rows = printableRows();
        if (dlPrintAllowed(rows)) dlPrintSheets(rows, state.by);
      });
    }

    function drawResults() {
      if (state.error) {
        results.innerHTML = '<p class="form-note pg-error">' + escapeHtml(state.error) + '</p>';
        return;
      }
      const rowsNow = visibleRows();
      if (!rowsNow.length) {
        results.innerHTML = '<p class="empty-state">No appointments in this range.</p>';
        return;
      }
      const groups = dlGroups(rowsNow, state.by);
      const unassigned = rowsNow.filter((row) => !row.technicianId).length;
      results.innerHTML =
        '<p class="form-note">' +
        rowsNow.length +
        (rowsNow.length === 1 ? ' appointment' : ' appointments') +
        ' in ' +
        groups.length +
        (groups.length === 1 ? ' group' : ' groups') +
        (unassigned ? ' &middot; <strong>' + unassigned + ' without a technician</strong>' : '') +
        (state.truncated ? ' &middot; showing the first 1,000 only &mdash; narrow the dates' : '') +
        '</p>' +
        groups
          .map((group) => {
            const open = group.label === 'Unassigned' || group.label === 'No branch';
            const lines = group.rows
              .map(
                (row) =>
                  '<tr><td><input type="checkbox" data-dl-pick="' +
                  escapeHtml(row.id) +
                  '" aria-label="Select ' +
                  escapeHtml(row.appointmentReference) +
                  '"' +
                  (state.selected.has(row.id) ? ' checked' : '') +
                  ' /></td><td>' +
                  escapeHtml(row.appointmentReference) +
                  '</td><td><strong>' +
                  escapeHtml(row.customerName) +
                  '</strong><br>' +
                  escapeHtml(row.contactNumber || '') +
                  '</td><td>' +
                  escapeHtml([row.address, row.region].filter(Boolean).join(', ') || '—') +
                  '</td><td>' +
                  escapeHtml([row.brand, row.model].filter(Boolean).join(' ') || '—') +
                  '</td><td class="pg-cell" title="' +
                  escapeHtml(row.faultDescription) +
                  '">' +
                  escapeHtml(row.faultDescription) +
                  '</td><td>' +
                  escapeHtml(
                    state.by === 'branch'
                      ? row.technicianName || 'Unassigned'
                      : row.branchName || '—',
                  ) +
                  '</td><td><span class="status ' +
                  statusClass(row.status) +
                  '">' +
                  escapeHtml(row.status) +
                  '</span></td><td><button class="button-link" type="button" data-dl-sheet="' +
                  escapeHtml(row.id) +
                  '">Sheet</button></td></tr>',
              )
              .join('');
            return (
              '<section class="dl-group' +
              (open ? ' dl-unassigned' : '') +
              '"><h3>' +
              escapeHtml(dlDayLabel(group.date) + ' — ' + group.label) +
              ' <span>' +
              group.rows.length +
              (group.rows.length === 1 ? ' job' : ' jobs') +
              '</span></h3><table class="rc-table"><thead><tr><th><input type="checkbox" data-dl-pick-group="' +
              escapeHtml(group.rows.map((row) => row.id).join(',')) +
              '" aria-label="Select all in this group"' +
              (group.rows.every((row) => state.selected.has(row.id)) ? ' checked' : '') +
              ' /></th><th>Appointment</th><th>Customer</th><th>Address</th><th>Item</th><th>Fault</th><th>' +
              (state.by === 'branch' ? 'Technician' : 'Branch') +
              '</th><th>Status</th><th></th></tr></thead><tbody>' +
              lines +
              '</tbody></table></section>'
            );
          })
          .join('');
      results.querySelectorAll('[data-dl-pick]').forEach((box) =>
        box.addEventListener('change', () => {
          if (box.checked) state.selected.add(box.dataset.dlPick);
          else state.selected.delete(box.dataset.dlPick);
          drawBar();
          drawResults();
        }),
      );
      results.querySelectorAll('[data-dl-pick-group]').forEach((box) =>
        box.addEventListener('change', () => {
          box.dataset.dlPickGroup.split(',').forEach((id) => {
            if (box.checked) state.selected.add(id);
            else state.selected.delete(id);
          });
          drawBar();
          drawResults();
        }),
      );
      results.querySelectorAll('[data-dl-sheet]').forEach((button) =>
        button.addEventListener('click', () => {
          const row = state.rows.find((entry) => entry.id === button.dataset.dlSheet);
          if (row && dlPrintAllowed([row])) {
            openPrintWindow(printDocumentShell('Appointment sheet', dlSheetBody(row, true)));
          }
        }),
      );
    }

    async function load() {
      results.innerHTML = '<p class="form-note">Loading appointments&hellip;</p>';
      try {
        const result = await apiRequest(
          '/api/appointments/daily-list?' + new URLSearchParams({ from: state.from, to: state.to }),
        );
        state.rows = result.rows;
        state.truncated = result.truncated;
        state.error = '';
      } catch (error) {
        state.rows = [];
        state.error = error.message;
      }
      const ids = new Set(state.rows.map((row) => row.id));
      state.selected = new Set([...state.selected].filter((id) => ids.has(id)));
      if (
        state.technician &&
        state.technician !== '__none' &&
        !state.rows.some((row) => row.technicianId === state.technician)
      )
        state.technician = '';
      drawBar();
      drawResults();
    }

    drawBar();
    await load();
  }

  // ---------- Awaiting drafts (modification #56) ----------  // ---------- Awaiting drafts (modification #56) ----------
  async function renderAwaitingDrafts(root) {
    root.innerHTML = '<p class="form-note">Loading drafts&hellip;</p>';
    let drafts;
    try {
      drafts = (await apiRequest('/api/schedules/awaiting')).drafts;
    } catch (error) {
      root.innerHTML = '<p class="form-note pg-error">' + escapeHtml(error.message) + '</p>';
      return;
    }
    const badge = $('#awaitingDraftsCount');
    badge.textContent = String(drafts.length);
    badge.hidden = !drafts.length;
    if (!drafts.length) {
      root.innerHTML = '<p class="empty-state">No drafts are waiting. You are all caught up.</p>';
      return;
    }
    const canWrite = hasPermission('scheduler.write');
    root.innerHTML = drafts
      .map((draft) => {
        const rows = draft.items
          .map(
            (item) =>
              '<tr><td>' +
              escapeHtml(item.complaintReference) +
              '</td><td>' +
              escapeHtml(item.customerName) +
              '</td><td>' +
              escapeHtml(item.region || '—') +
              '</td><td>' +
              escapeHtml(item.technicianName || 'Unassigned') +
              '</td><td>' +
              escapeHtml(item.appointmentDate + ' ' + item.appointmentTime) +
              '</td><td>' +
              escapeHtml(item.complaintStatus) +
              (item.complaintStatus === 'Ready for Scheduling'
                ? ''
                : ' <span class="ad-warn">(cannot be promoted)</span>') +
              '</td></tr>',
          )
          .join('');
        return (
          '<section class="ad-card" data-draft="' +
          escapeHtml(draft.id) +
          '"><div class="ad-head"><div><h3>Draft #' +
          escapeHtml(draft.id) +
          ' &middot; ' +
          draft.items.length +
          (draft.items.length === 1 ? ' job' : ' jobs') +
          '</h3><small>Created ' +
          escapeHtml(new Date(draft.createdAt).toLocaleString('en-GB')) +
          (draft.createdByName ? ' by ' + escapeHtml(draft.createdByName) : '') +
          '</small></div>' +
          (canWrite
            ? '<div class="ad-actions"><button type="button" class="button button-primary" data-ad-promote>Promote</button><button type="button" class="button" data-ad-cancel>Cancel draft</button></div>'
            : '') +
          '</div><table class="rc-table"><thead><tr><th>Complaint</th><th>Customer</th><th>Region</th><th>Technician</th><th>When</th><th>Complaint status</th></tr></thead><tbody>' +
          (rows || '<tr><td colspan="6">No jobs in this draft.</td></tr>') +
          '</tbody></table></section>'
        );
      })
      .join('');
    root.querySelectorAll('.ad-card').forEach((card) => {
      const id = card.dataset.draft;
      const promote = card.querySelector('[data-ad-promote]');
      const cancel = card.querySelector('[data-ad-cancel]');
      if (!promote) return;
      let armed = false;
      const act = async (button, path, label, busyLabel, done) => {
        setBusy(button, true, busyLabel);
        try {
          await apiRequest('/api/schedules/drafts/' + encodeURIComponent(id) + path, {
            method: 'POST',
          });
          await renderAwaitingDrafts(root);
          setMessage('#workspaceMessage', done, true);
        } catch (error) {
          setBusy(button, false);
          setMessage('#workspaceMessage', error.message);
        }
      };
      promote.addEventListener('click', () =>
        act(promote, '/promote', 'Promote', 'Promoting…', 'Draft promoted: appointments created.'),
      );
      cancel.addEventListener('click', () => {
        if (!armed) {
          armed = true;
          cancel.textContent = 'Click again to confirm';
          setTimeout(() => {
            armed = false;
            cancel.textContent = 'Cancel draft';
          }, 4000);
          return;
        }
        act(cancel, '/cancel', 'Cancel draft', 'Cancelling…', 'Draft cancelled.');
      });
    });
  }

  // ---------- Roles & permissions (modification #55, custom roles #176) ----------
  // The role being edited on Roles & permissions; kept across re-renders so
  // saving, renaming or creating a role does not jump back to the first one.
  let rolesPageSelected = '';

  async function renderRolesPage(root) {
    root.innerHTML = '<p class="form-note">Loading roles&hellip;</p>';
    let data;
    try {
      data = await apiRequest('/api/role-matrix');
    } catch (error) {
      root.innerHTML = '<p class="form-note pg-error">' + escapeHtml(error.message) + '</p>';
      return;
    }
    const roleByCode = new Map(data.roles.map((role) => [role.code, role]));
    const editable = data.roles.filter((role) => role.code !== 'admin');
    const original = {};
    const draft = {};
    editable.forEach((role) => {
      original[role.code] = new Set(data.grants[role.code] || []);
      draft[role.code] = new Set(data.grants[role.code] || []);
    });
    const groups = new Map();
    data.permissions.forEach((permission) => {
      const key = permission.code.split('.')[0];
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(permission);
    });
    const roleLabel = (role) => (role.code === 'admin' ? 'Administrator' : role.displayName);
    if (!roleByCode.has(rolesPageSelected) || rolesPageSelected === 'admin') {
      rolesPageSelected = (editable.find((role) => role.code === 'sales') || editable[0]).code;
    }
    const isChanged = (code) => {
      const before = original[code];
      const after = draft[code];
      return before.size !== after.size || [...after].some((item) => !before.has(item));
    };
    const changedRoles = () => editable.filter((role) => isChanged(role.code));

    const optionHtml = (role) =>
      '<option value="' +
      escapeHtml(role.code) +
      '"' +
      (role.code === rolesPageSelected ? ' selected' : '') +
      '>' +
      escapeHtml(roleLabel(role)) +
      (isChanged(role.code) ? ' (unsaved)' : '') +
      '</option>';
    const builtinOptions = () =>
      editable
        .filter((role) => role.builtin)
        .map(optionHtml)
        .join('');
    const customOptions = () =>
      editable
        .filter((role) => !role.builtin)
        .map(optionHtml)
        .join('');
    const copyOptions = data.roles
      .map(
        (role) =>
          '<option value="' +
          escapeHtml(role.code) +
          '">' +
          escapeHtml(roleLabel(role)) +
          '</option>',
      )
      .join('');

    root.innerHTML =
      '<div class="rm-toolbar">' +
      '<div class="rm-picker"><label for="rmRoleSelect">Role to edit</label>' +
      '<select id="rmRoleSelect"></select></div>' +
      '<div class="rm-role-meta" data-rm-meta></div>' +
      '<div class="rm-toolbar-end">' +
      '<button type="button" class="button button-outline rm-btn" data-rm-new>+ New role</button>' +
      '</div></div>' +
      '<form class="rm-new" data-rm-form hidden novalidate>' +
      '<div class="field"><label for="rmRoleName" data-rm-form-title>Role name</label>' +
      '<input type="text" id="rmRoleName" maxlength="40" autocomplete="off" placeholder="e.g. Service Coordinator" />' +
      '</div>' +
      '<div class="field" data-rm-copy-field><label for="rmRoleCopy">Copy permissions from</label>' +
      '<select id="rmRoleCopy"><option value="">Start with no permissions</option>' +
      copyOptions +
      '</select></div>' +
      '<div class="rm-form-actions"><button type="submit" class="button button-primary rm-btn" data-rm-form-save>Create role</button>' +
      '<button type="button" class="button button-outline rm-btn" data-rm-form-cancel>Cancel</button></div>' +
      '<span class="field-error" data-rm-form-error></span></form>' +
      '<div class="rm-savebar"><span class="rm-status" data-rm-status role="status">No changes</span>' +
      '<button type="button" class="button button-outline rm-btn" data-rm-discard disabled>Discard</button>' +
      '<button type="button" class="button button-primary rm-btn" data-rm-save disabled>Save changes</button></div>' +
      '<div class="rm-wrap" data-rm-wrap></div>' +
      '<div class="card-help"><span>About this section</span>' +
      tipHtml(
        'Pick a role in <strong>Role to edit</strong> and tick what it can do. Administrator and Management stay on screen so you can compare. Rows marked with an amber edge (admin.*) control who can manage logins and permissions &mdash; grant them with care.',
      ) +
      '</div>';

    const select = root.querySelector('#rmRoleSelect');
    const meta = root.querySelector('[data-rm-meta]');
    const wrap = root.querySelector('[data-rm-wrap]');
    const saveButton = root.querySelector('[data-rm-save]');
    const discardButton = root.querySelector('[data-rm-discard]');
    const status = root.querySelector('[data-rm-status]');

    const fillSelect = () => {
      const custom = customOptions();
      select.innerHTML = custom
        ? '<optgroup label="Built-in roles">' +
          builtinOptions() +
          '</optgroup><optgroup label="Custom roles">' +
          custom +
          '</optgroup>'
        : builtinOptions();
      select.value = rolesPageSelected;
    };

    const renderMeta = () => {
      const role = roleByCode.get(rolesPageSelected);
      if (role.builtin) {
        meta.innerHTML = '<span class="rm-chip">Built-in role</span>';
        return;
      }
      meta.innerHTML =
        '<span class="rm-chip rm-chip-custom">Custom role</span>' +
        '<span class="rm-usercount">' +
        role.userCount +
        (role.userCount === 1 ? ' user' : ' users') +
        '</span>' +
        '<button type="button" class="button button-outline rm-btn rm-btn-sm" data-rm-rename>Rename</button>' +
        '<button type="button" class="button button-outline rm-btn rm-btn-sm rm-btn-danger" data-rm-delete>Delete</button>';
      meta
        .querySelector('[data-rm-rename]')
        .addEventListener('click', () =>
          openForm({ kind: 'rename', code: role.code, name: role.displayName }),
        );
      meta
        .querySelector('[data-rm-delete]')
        .addEventListener('click', () => deleteRoleAction(role));
    };

    // Administrator and Management are always shown as read-only reference
    // columns; the role being edited gets the only editable column. When the
    // role being edited is Management itself, its column is the editable one.
    const renderTable = () => {
      const selected = roleByCode.get(rolesPageSelected);
      const referenceCodes = ['admin', 'management'].filter(
        (code) => roleByCode.has(code) && code !== rolesPageSelected,
      );
      const columns = [
        ...referenceCodes.map((code) => ({ role: roleByCode.get(code), editing: false })),
        { role: selected, editing: true },
      ].sort((x, y) => {
        const order = { admin: 0, management: 1 };
        return (order[x.role.code] ?? 2) - (order[y.role.code] ?? 2);
      });
      const head = columns
        .map(
          ({ role, editing }) =>
            '<th class="rm-col' +
            (editing ? ' rm-col-edit' : ' rm-col-ref') +
            '" scope="col"><span class="rm-col-name">' +
            escapeHtml(roleLabel(role)) +
            '</span><span class="rm-col-tag">' +
            (editing ? 'Editing' : 'Reference') +
            '</span></th>',
        )
        .join('');
      let rows = '';
      groups.forEach((permissions, key) => {
        rows +=
          '<tr class="rm-group"><td colspan="' +
          (columns.length + 1) +
          '"><span class="rm-group-label">' +
          escapeHtml(AL_MODULE_LABELS[key] || alSentence(key)) +
          '</span></td></tr>';
        permissions.forEach((permission) => {
          const cells = columns
            .map(({ role, editing }) => {
              if (role.code === 'admin') {
                return '<td class="rm-cell rm-cell-ref" title="Always on"><span class="rm-mark rm-on" aria-label="Allowed">✓</span></td>';
              }
              const on = draft[role.code].has(permission.code);
              if (!editing) {
                return (
                  '<td class="rm-cell rm-cell-ref"><span class="rm-mark ' +
                  (on ? 'rm-on" aria-label="Allowed">✓' : 'rm-off" aria-label="Not allowed">–') +
                  '</span></td>'
                );
              }
              const dirty = on !== original[role.code].has(permission.code);
              return (
                '<td class="rm-cell rm-cell-edit' +
                (dirty ? ' rm-dirty' : '') +
                '"><input type="checkbox" data-role="' +
                escapeHtml(role.code) +
                '" data-perm="' +
                escapeHtml(permission.code) +
                '" aria-label="' +
                escapeHtml(roleLabel(role) + ': ' + permission.code) +
                '"' +
                (on ? ' checked' : '') +
                ' /></td>'
              );
            })
            .join('');
          rows +=
            '<tr' +
            (key === 'admin' ? ' class="rm-sensitive"' : '') +
            '><th scope="row" class="rm-perm">' +
            escapeHtml(permission.description) +
            '<small>' +
            escapeHtml(permission.code) +
            '</small></th>' +
            cells +
            '</tr>';
        });
      });
      wrap.innerHTML =
        '<table class="rm-table"><thead><tr><th class="rm-perm" scope="col">Permission</th>' +
        head +
        '</tr></thead><tbody>' +
        rows +
        '</tbody></table>';
    };

    const refresh = () => {
      const count = changedRoles().length;
      saveButton.disabled = !count;
      discardButton.disabled = !count;
      status.textContent = count
        ? count + (count === 1 ? ' role has' : ' roles have') + ' unsaved changes'
        : 'No changes';
      status.classList.toggle('rm-status-dirty', count > 0);
      fillSelect();
    };

    wrap.addEventListener('change', (event) => {
      const box = event.target.closest('input[data-role]');
      if (!box) return;
      const set = draft[box.dataset.role];
      if (box.checked) set.add(box.dataset.perm);
      else set.delete(box.dataset.perm);
      box
        .closest('td')
        .classList.toggle(
          'rm-dirty',
          box.checked !== original[box.dataset.role].has(box.dataset.perm),
        );
      refresh();
    });
    select.addEventListener('change', () => {
      rolesPageSelected = select.value;
      root.querySelector('[data-rm-form]').hidden = true;
      renderMeta();
      renderTable();
    });
    discardButton.addEventListener('click', () => renderRolesPage(root));
    saveButton.addEventListener('click', async () => {
      setBusy(saveButton, true, 'Saving…');
      try {
        for (const role of changedRoles()) {
          await apiRequest('/api/role-matrix/' + encodeURIComponent(role.code), {
            method: 'PUT',
            body: JSON.stringify({ permissions: [...draft[role.code]].sort() }),
          });
        }
        await renderRolesPage(root);
        setMessage('#workspaceMessage', 'Permissions saved.', true);
      } catch (error) {
        setBusy(saveButton, false);
        status.textContent = error.message;
      }
    });

    // ---- New role / rename / delete (custom roles, modification #176) ----
    const roleForm = root.querySelector('[data-rm-form]');
    const formError = root.querySelector('[data-rm-form-error]');
    const nameInput = root.querySelector('#rmRoleName');
    const formSave = root.querySelector('[data-rm-form-save]');
    let formMode = { kind: 'create', code: '' };
    function openForm(mode) {
      formMode = mode;
      formError.textContent = '';
      roleForm.hidden = false;
      root.querySelector('[data-rm-form-title]').textContent =
        mode.kind === 'create' ? 'Role name' : 'New name for this role';
      root.querySelector('[data-rm-copy-field]').hidden = mode.kind !== 'create';
      formSave.textContent = mode.kind === 'create' ? 'Create role' : 'Save name';
      formSave.dataset.label = formSave.textContent;
      nameInput.value = mode.name || '';
      nameInput.focus();
    }
    const loseDraftOk = () =>
      !changedRoles().length ||
      confirm('You have unsaved permission changes. Continue and discard them?');
    root
      .querySelector('[data-rm-new]')
      .addEventListener('click', () => openForm({ kind: 'create' }));
    root.querySelector('[data-rm-form-cancel]').addEventListener('click', () => {
      roleForm.hidden = true;
    });
    async function deleteRoleAction(role) {
      if (role.userCount > 0) {
        setMessage(
          '#workspaceMessage',
          role.userCount +
            (role.userCount === 1 ? ' user still has' : ' users still have') +
            ' the role "' +
            role.displayName +
            '". Move them to another role in Users first.',
        );
        return;
      }
      if (!confirm('Delete the role "' + role.displayName + '"? This cannot be undone.')) return;
      if (!loseDraftOk()) return;
      try {
        await apiRequest('/api/role-matrix/' + encodeURIComponent(role.code), {
          method: 'DELETE',
        });
        rolesPageSelected = '';
        await renderRolesPage(root);
        setMessage('#workspaceMessage', 'Role "' + role.displayName + '" deleted.', true);
      } catch (error) {
        setMessage('#workspaceMessage', error.message);
      }
    }
    roleForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const name = nameInput.value.trim();
      formError.textContent = '';
      if (name.length < 2) {
        formError.textContent = 'Enter a role name of at least 2 characters.';
        return;
      }
      if (!loseDraftOk()) return;
      setBusy(formSave, true, formMode.kind === 'create' ? 'Creating…' : 'Saving…');
      try {
        if (formMode.kind === 'create') {
          const copyFrom = root.querySelector('#rmRoleCopy').value;
          const created = await apiRequest('/api/role-matrix', {
            method: 'POST',
            body: JSON.stringify(copyFrom ? { name, copyFrom } : { name }),
          });
          if (created && created.code) rolesPageSelected = created.code;
        } else {
          await apiRequest('/api/role-matrix/' + encodeURIComponent(formMode.code), {
            method: 'PATCH',
            body: JSON.stringify({ name }),
          });
        }
        await renderRolesPage(root);
        setMessage(
          '#workspaceMessage',
          formMode.kind === 'create'
            ? 'Role "' + name + '" created. Tick its permissions below, then assign it in Users.'
            : 'Role renamed to "' + name + '".',
          true,
        );
      } catch (error) {
        setBusy(formSave, false);
        formError.textContent = error.message;
      }
    });

    fillSelect();
    renderMeta();
    renderTable();
  }

  async function renderReportsPage(root) {
    root.innerHTML = '<p class="form-note">Loading report types&hellip;</p>';
    let types;
    try {
      types = (await apiRequest('/api/reports')).items;
    } catch (error) {
      root.innerHTML = '<p class="form-note pg-error">' + escapeHtml(error.message) + '</p>';
      return;
    }
    if (!types.length) {
      root.innerHTML =
        '<p class="form-note">Your role cannot download any record types yet. Ask an administrator.</p>';
      return;
    }
    const month = pgRangeFor('month');
    const state = {
      type: types[0].type,
      range: 'month',
      from: month.from,
      to: month.to,
      search: '',
      page: 1,
      pageSize: 25,
      data: null,
      loading: false,
      downloading: false,
      error: '',
      month: month.from.slice(0, 7),
    };

    const RANGES = [
      ['month', 'This month'],
      ['last-month', 'Last month'],
      ['pick-month', 'Pick a month'],
      ['ytd', 'Year to date'],
      ['custom', 'Custom range'],
      ['all', 'All dates'],
    ];

    root.innerHTML =
      '<div class="rc-section rd-filter-card"><div class="rd-report-toolbar" data-pg-bar></div>' +
      '<p class="form-note" data-pg-msg style="margin:0.5rem 0 0"></p></div>' +
      '<div class="rc-section" data-pg-results></div>';
    const bar = root.querySelector('[data-pg-bar]');
    const message = root.querySelector('[data-pg-msg]');
    const results = root.querySelector('[data-pg-results]');

    const current = () => types.find((entry) => entry.type === state.type);

    function applyMonth(value) {
      const [year, monthNumber] = value.split('-').map(Number);
      state.from = pgYmd(new Date(year, monthNumber - 1, 1));
      state.to = pgYmd(new Date(year, monthNumber, 0));
    }

    function params(extra) {
      return rdQs({
        from: state.range === 'all' ? '' : state.from,
        to: state.range === 'all' ? '' : state.to,
        search: state.search,
        ...extra,
      });
    }

    function validate() {
      if (state.range === 'all') return '';
      if (!state.from || !state.to) return 'Choose both a From and a To date.';
      if (state.to < state.from) return 'The To date must be on or after the From date.';
      return '';
    }

    function drawBar() {
      bar.innerHTML =
        '<div class="th-field"><label>Report type<select data-pg="type">' +
        types
          .map(
            (entry) =>
              '<option value="' +
              escapeHtml(entry.type) +
              '"' +
              (entry.type === state.type ? ' selected' : '') +
              '>' +
              escapeHtml(entry.label) +
              '</option>',
          )
          .join('') +
        '</select></label></div>' +
        '<div class="th-field"><label>Date range<select data-pg="range">' +
        RANGES.map(
          ([value, label]) =>
            '<option value="' +
            value +
            '"' +
            (value === state.range ? ' selected' : '') +
            '>' +
            label +
            '</option>',
        ).join('') +
        '</select></label></div>' +
        (state.range === 'pick-month'
          ? '<div class="th-field"><label>Month<input type="month" data-pg="month" value="' +
            escapeHtml(state.month) +
            '" /></label></div>'
          : '') +
        '<div class="th-field"><label>From<input type="date" data-pg="from" value="' +
        escapeHtml(state.from) +
        '"' +
        (state.range === 'custom' ? '' : ' disabled') +
        ' /></label></div>' +
        '<div class="th-field"><label>To<input type="date" data-pg="to" value="' +
        escapeHtml(state.to) +
        '"' +
        (state.range === 'custom' ? '' : ' disabled') +
        ' /></label></div>' +
        '<div class="th-field"><label>Search<input type="search" data-pg="search" placeholder="Number, customer, contact&hellip;" value="' +
        escapeHtml(state.search) +
        '" /></label></div>' +
        '<div class="th-field rd-filter-actions"><button class="button button-outline" type="button" data-pg-refresh>Refresh</button></div>' +
        '<div class="th-field rd-filter-actions"><button class="button button-primary" type="button" data-pg-download' +
        (state.downloading ? ' disabled' : '') +
        '>' +
        (state.downloading ? 'Preparing&hellip;' : 'Download XLSX') +
        '</button></div>';
      const control = (name) => bar.querySelector('[data-pg="' + name + '"]');
      control('type').addEventListener('change', (event) => {
        state.type = event.target.value;
        state.page = 1;
        load();
      });
      control('range').addEventListener('change', (event) => {
        state.range = event.target.value;
        if (state.range === 'pick-month') {
          applyMonth(state.month);
        } else if (state.range !== 'custom' && state.range !== 'all') {
          const range = pgRangeFor(state.range);
          state.from = range.from;
          state.to = range.to;
        }
        state.page = 1;
        drawBar();
        load();
      });
      ['from', 'to'].forEach((name) =>
        control(name).addEventListener('change', (event) => {
          state[name] = event.target.value;
          state.page = 1;
          load();
        }),
      );
      let timer = null;
      control('search').addEventListener('input', (event) => {
        state.search = event.target.value.trim();
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          state.page = 1;
          load();
        }, 350);
      });
      control('month')?.addEventListener('change', (event) => {
        if (!event.target.value) return;
        state.month = event.target.value;
        applyMonth(state.month);
        state.page = 1;
        drawBar();
        load();
      });
      bar.querySelector('[data-pg-refresh]').addEventListener('click', () => load());
      bar.querySelector('[data-pg-download]').addEventListener('click', download);
    }

    function drawResults() {
      const meta = current();
      const data = state.data;
      if (state.loading && !data) {
        results.innerHTML = '<p class="pg-empty">Loading records&hellip;</p>';
        return;
      }
      if (state.error) {
        results.innerHTML = '<p class="pg-empty pg-error">' + escapeHtml(state.error) + '</p>';
        return;
      }
      if (!data) {
        results.innerHTML = '';
        return;
      }
      const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
      const head =
        '<div class="rc-section-head"><span>' +
        escapeHtml(data.label) +
        '</span><span class="rc-count">' +
        data.total.toLocaleString('en-US') +
        ' matching record' +
        (data.total === 1 ? '' : 's') +
        ' &middot; filtered on ' +
        escapeHtml(String(meta?.dateLabel || 'date').toLowerCase()) +
        '</span></div>';
      if (!data.rows.length) {
        results.innerHTML =
          head +
          '<p class="pg-empty">No records match this report type, date range and search.</p>';
        return;
      }
      results.innerHTML =
        head +
        '<div class="table-wrap"><table class="rc-table rd-jobs-table"><thead><tr>' +
        data.columns
          .map(
            (column) =>
              '<th' +
              (column.kind === 'money' || column.kind === 'number' ? ' class="num"' : '') +
              '>' +
              escapeHtml(column.label) +
              '</th>',
          )
          .join('') +
        '</tr></thead><tbody>' +
        data.rows
          .map(
            (row) =>
              '<tr>' +
              row.map((value, index) => pgCellHtml(value, data.columns[index].kind)).join('') +
              '</tr>',
          )
          .join('') +
        '</tbody></table></div>' +
        '<div class="rd-pager"><button class="button button-outline" type="button" data-pg-prev' +
        (data.page <= 1 ? ' disabled' : '') +
        '>Previous</button><span class="form-note">Page ' +
        data.page +
        ' of ' +
        totalPages +
        '</span><button class="button button-outline" type="button" data-pg-next' +
        (data.page >= totalPages ? ' disabled' : '') +
        '>Next</button></div>';
      results.querySelector('[data-pg-prev]')?.addEventListener('click', () => {
        state.page = Math.max(1, state.page - 1);
        load();
      });
      results.querySelector('[data-pg-next]')?.addEventListener('click', () => {
        state.page += 1;
        load();
      });
    }

    async function load() {
      const problem = validate();
      message.textContent = problem;
      message.classList.toggle('pg-error', Boolean(problem));
      if (problem) return;
      state.loading = true;
      state.error = '';
      drawResults();
      try {
        state.data = await apiRequest(
          '/api/reports/' +
            encodeURIComponent(state.type) +
            '?' +
            params({ page: state.page, pageSize: state.pageSize }),
        );
      } catch (error) {
        state.data = null;
        state.error = error.message;
      } finally {
        state.loading = false;
      }
      drawResults();
    }

    async function download() {
      const problem = validate();
      if (problem) {
        message.textContent = problem;
        message.classList.add('pg-error');
        return;
      }
      state.downloading = true;
      drawBar();
      message.classList.remove('pg-error');
      message.textContent = '';
      try {
        const blob = await apiBlobRequest(
          '/api/reports/' + encodeURIComponent(state.type) + '/export?' + params({}),
        );
        const label = (current()?.label || 'Report')
          .replace(/[^A-Za-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '');
        const range = state.range === 'all' ? 'All' : state.from + '_to_' + state.to;
        const fileName = 'Report_' + label + '_' + range + '.xlsx';
        rdDownloadBlob(blob, fileName);
        message.textContent = 'Downloaded ' + fileName + '.';
      } catch (error) {
        message.textContent = error.message;
        message.classList.add('pg-error');
      } finally {
        state.downloading = false;
        drawBar();
      }
    }

    drawBar();
    await load();
  }

  // --- Activity log screen (modification.md #53) ----------------------------
  // Reads the audit trail (audit_events) through GET /api/audit-events. Every
  // write the portal makes is recorded there with the user who made it; as of
  // #53 sign-ins, sign-outs, failed sign-ins, team-login changes and report
  // downloads are recorded too.
  const AL_MODULE_LABELS = {
    auth: 'Sign-in & team logins',
    complaint: 'Complaints',
    appointment: 'Appointments',
    job_card: 'Job cards',
    job_card_attachment: 'Job card files',
    quotation: 'Quotations',
    inspection: 'Inspections',
    warranty_approval: 'Warranty approvals',
    invoices: 'Invoices',
    billing: 'Billing',
    quote_calculators: 'Quote calculators',
    vas_sale: 'VAS sales',
    amc_contract: 'AMC contracts',
    thomson_sale: 'Thomson sales',
    rate_card_sale: 'Rate card sales',
    pricing_config: 'Pricing masters',
    revenue_dashboard: 'Revenue dashboard',
    report: 'Reports',
    customer: 'Customers',
    branch: 'Branches',
    technician: 'Technicians',
    salesman: 'Salesmen',
    sales_channel: 'Sales channels',
    schedule: 'Scheduler drafts',
    role: 'Roles & permissions',
  };
  const AL_ACTION_LABELS = {
    'auth.login': 'Signed in',
    'auth.login_failed': 'Failed sign-in',
    'auth.logout': 'Signed out',
    'auth.user_created': 'Team login created',
    'auth.user_updated': 'Team login changed',
    'auth.password_changed': 'Password changed',
    'auth.password_reset': 'Password reset by admin',
    'report.exported': 'Report downloaded',
    'budget_variance.config_saved': 'Stream mapping / settings saved',
    'budget_variance.version_created': 'Budget version created',
    'budget_variance.version_updated': 'Budget version updated',
    'revenue_dashboard.imported': 'Revenue workbook uploaded',
    'revenue_dashboard.viewed': 'Revenue dashboard viewed',
    'revenue_dashboard.exported': 'Revenue report downloaded',
    'revenue_dashboard.view_exported': 'Revenue view (drill-down) downloaded',
    'revenue_dashboard.email_drafted': 'Revenue summary email drafted',
    'revenue_dashboard.summary_copied': 'Revenue summary copied',
    'roi.report_drafted': 'Weekly ROI email drafted',
    'roi.tasks_imported': 'Tasks imported from the weekly tracker',
    'pricing_config.saved': 'Pricing master saved',
    'pricing_config.reset': 'Pricing master reset to defaults',
    'pricing_config.restored': 'Pricing master restored',
  };

  function alSentence(text) {
    const spaced = String(text).replace(/_/g, ' ').trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }

  function alActionLabel(action) {
    if (AL_ACTION_LABELS[action]) return AL_ACTION_LABELS[action];
    const [moduleKey, ...rest] = String(action).split('.');
    const moduleLabel = AL_MODULE_LABELS[moduleKey] || alSentence(moduleKey);
    return rest.length
      ? moduleLabel + ': ' + alSentence(rest.join(' ')).toLowerCase()
      : moduleLabel;
  }

  function alDetails(event) {
    const meta = event.metadata || {};
    const parts = [];
    const used = new Set();
    Object.entries(meta).forEach(([key, value]) => {
      if (/Reference$/.test(key) && value) {
        parts.push(String(value));
        used.add(key);
      }
    });
    if (meta.fromStatus !== undefined || meta.toStatus !== undefined) {
      parts.push('Status: ' + (meta.fromStatus ?? '—') + ' → ' + (meta.toStatus ?? '—'));
      used.add('fromStatus');
      used.add('toStatus');
    }
    if (event.action === 'report.exported') {
      parts.push(
        [
          meta.report,
          meta.from || meta.to ? (meta.from || '…') + ' to ' + (meta.to || '…') : 'all dates',
        ]
          .filter(Boolean)
          .join(' · ') +
          ' · ' +
          (meta.rows ?? 0) +
          (Number(meta.rows) === 1 ? ' row' : ' rows'),
      );
      ['report', 'reportType', 'from', 'to', 'rows', 'totalMatching', 'fileName', 'search'].forEach(
        (key) => used.add(key),
      );
    }
    Object.entries(meta).forEach(([key, value]) => {
      if (used.has(key) || value === null || value === undefined || value === '') return;
      const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
      parts.push(alSentence(key.replace(/([A-Z])/g, ' $1')) + ': ' + text);
    });
    return parts.join(' · ');
  }

  // Changelog page (administrator only). Reads GET /api/changelog, which is built
  // from modification.md by scripts/build-changelog.mjs.
  async function renderChangelogPage(root) {
    root.innerHTML = '<p class="form-note">Loading changelog&hellip;</p>';
    let payload;
    try {
      payload = await apiRequest('/api/changelog');
    } catch (error) {
      root.innerHTML = '<p class="form-note pg-error">' + escapeHtml(error.message) + '</p>';
      return;
    }
    const entries = Array.isArray(payload?.entries) ? payload.entries : [];
    const state = { area: '', search: '' };
    const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
    const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
    const parse = (ymd) => (ymd ? new Date(ymd + 'T00:00:00') : null);
    const areaCounts = new Map();
    entries.forEach((e) => areaCounts.set(e.area, (areaCounts.get(e.area) || 0) + 1));
    const areas = [...areaCounts.entries()].sort((a, b) => b[1] - a[1]);
    const dated = entries
      .filter((e) => e.date)
      .map((e) => e.date)
      .sort();
    const latestId = entries.length ? entries[0].id : null;
    const migrationCount = new Set(entries.flatMap((e) => e.migrations || [])).size;

    root.innerHTML =
      '<div class="cl-stats">' +
      '<div class="cl-stat"><b>' +
      entries.length +
      '</b><span>Changes recorded</span></div>' +
      '<div class="cl-stat"><b>' +
      areas.length +
      '</b><span>Areas of the portal</span></div>' +
      '<div class="cl-stat"><b>' +
      migrationCount +
      '</b><span>Database migrations</span></div>' +
      '<div class="cl-stat"><b>' +
      (dated.length
        ? escapeHtml(
            dayFmt.format(parse(dated[0])) + ' – ' + dayFmt.format(parse(dated[dated.length - 1])),
          )
        : '—') +
      '</b><span>Build period</span></div></div>' +
      '<div class="cl-toolbar"><label class="sr-only" for="clSearch">Search the changelog</label>' +
      '<input id="clSearch" class="cl-search" type="search" placeholder="Search changes, e.g. CSIDO, invoice, permission" autocomplete="off" />' +
      '<button type="button" class="cl-chip" data-cl-toggle>Expand all</button></div>' +
      '<div class="cl-chips" role="group" aria-label="Filter by area" data-cl-chips></div>' +
      '<p class="cl-count" role="status" aria-live="polite" data-cl-count></p>' +
      '<div data-cl-list></div>';
    const chips = root.querySelector('[data-cl-chips]');
    const count = root.querySelector('[data-cl-count]');
    const list = root.querySelector('[data-cl-list]');
    const search = root.querySelector('#clSearch');
    const toggle = root.querySelector('[data-cl-toggle]');

    function drawChips() {
      const chip = (value, label, n) =>
        '<button type="button" class="cl-chip" data-cl-area="' +
        escapeHtml(value) +
        '" aria-pressed="' +
        (state.area === value) +
        '">' +
        escapeHtml(label) +
        '<small>' +
        n +
        '</small></button>';
      chips.innerHTML =
        chip('', 'All', entries.length) + areas.map(([name, n]) => chip(name, name, n)).join('');
    }

    function matches(e) {
      if (state.area && e.area !== state.area) return false;
      if (!state.search) return true;
      const hay = [
        '#' + e.id,
        e.title,
        e.area,
        e.summary,
        e.needsYou,
        e.files,
        ...(e.changes || []),
        ...(e.migrations || []),
      ]
        .join(' ')
        .toLowerCase();
      return state.search.split(/\s+/).every((word) => hay.includes(word));
    }

    function card(e) {
      const d = parse(e.date);
      const dateLabel = d
        ? (e.approxDate ? '≈ ' : '') + dayFmt.format(d) + ' ' + d.getFullYear()
        : 'Date not recorded';
      const changes = (e.changes || []).length
        ? '<h4>What changed</h4><ul>' +
          e.changes.map((c) => '<li>' + escapeHtml(c) + '</li>').join('') +
          '</ul>'
        : '';
      const migrations = (e.migrations || []).length
        ? '<h4>Database migrations</h4><p class="cl-files">' +
          e.migrations.map(escapeHtml).join('<br />') +
          '</p>'
        : '';
      const needs = e.needsYou
        ? '<h4>On release</h4><p class="cl-needs">' + escapeHtml(e.needsYou) + '</p>'
        : '';
      const files = e.files
        ? '<h4>Files</h4><p class="cl-files">' + escapeHtml(e.files) + '</p>'
        : '';
      const body = changes + needs + migrations + files;
      return (
        '<li class="cl-item' +
        (e.id === latestId ? ' is-latest' : '') +
        '"><details class="cl-card"><summary>' +
        '<div class="cl-head"><span class="cl-num">#' +
        e.id +
        '</span>' +
        '<span class="cl-title">' +
        escapeHtml(e.title) +
        '</span>' +
        '<span class="cl-meta">' +
        (e.id === latestId ? '<span class="cl-tag latest">Latest</span>' : '') +
        '<span class="cl-tag">' +
        escapeHtml(e.area) +
        '</span>' +
        (e.status ? '<span class="cl-tag">' + escapeHtml(e.status) + '</span>' : '') +
        '<span>' +
        escapeHtml(dateLabel) +
        '</span><span class="cl-chev" aria-hidden="true"></span></span></div>' +
        (e.summary ? '<p class="cl-sum">' + escapeHtml(e.summary) + '</p>' : '') +
        '</summary>' +
        (body ? '<div class="cl-body">' + body + '</div>' : '') +
        '</details></li>'
      );
    }

    function draw() {
      const shown = entries.filter(matches);
      count.textContent =
        shown.length === entries.length
          ? 'Showing all ' + entries.length + ' changes, newest first.'
          : 'Showing ' + shown.length + ' of ' + entries.length + ' changes.';
      if (!shown.length) {
        list.innerHTML = '<p class="pg-empty">Nothing matches. Clear the search or choose All.</p>';
        return;
      }
      let html = '';
      let month = null;
      let open = false;
      shown.forEach((e) => {
        const d = parse(e.date);
        const label = d ? monthFmt.format(d) : 'Undated';
        if (label !== month) {
          if (open) html += '</ol>';
          html += '<h3 class="cl-month">' + escapeHtml(label) + '</h3><ol class="cl-list">';
          month = label;
          open = true;
        }
        html += card(e);
      });
      list.innerHTML = html + (open ? '</ol>' : '');
    }

    chips.addEventListener('click', (event) => {
      const button = event.target.closest('[data-cl-area]');
      if (!button) return;
      state.area = button.dataset.clArea;
      drawChips();
      draw();
    });
    let timer = 0;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.search = search.value.trim().toLowerCase();
        draw();
      }, 120);
    });
    toggle.addEventListener('click', () => {
      const open = toggle.dataset.open !== '1';
      toggle.dataset.open = open ? '1' : '0';
      toggle.textContent = open ? 'Collapse all' : 'Expand all';
      list.querySelectorAll('details').forEach((d) => (d.open = open));
    });
    drawChips();
    draw();
  }

  async function renderActivityLog(root) {
    root.innerHTML = '<p class="form-note">Loading activity&hellip;</p>';
    let options;
    try {
      options = await apiRequest('/api/audit-events/filters');
    } catch (error) {
      root.innerHTML = '<p class="form-note pg-error">' + escapeHtml(error.message) + '</p>';
      return;
    }
    const state = {
      range: 'week',
      from: '',
      to: '',
      actorId: '',
      module: '',
      search: '',
      page: 1,
      pageSize: 50,
      data: null,
      loading: false,
      error: '',
    };
    const RANGES = [
      ['today', 'Today'],
      ['week', 'Last 7 days'],
      ['month', 'Last 30 days'],
      ['custom', 'Custom range'],
      ['all', 'All time'],
    ];

    function applyRange(kind) {
      const now = new Date();
      const back = (days) =>
        pgYmd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days));
      if (kind === 'today') {
        state.from = pgYmd(now);
        state.to = pgYmd(now);
      } else if (kind === 'week') {
        state.from = back(6);
        state.to = pgYmd(now);
      } else if (kind === 'month') {
        state.from = back(29);
        state.to = pgYmd(now);
      }
    }
    applyRange(state.range);

    root.innerHTML =
      '<div class="rc-section rd-filter-card"><div class="rd-report-toolbar" data-al-bar></div>' +
      '<p class="form-note" data-al-msg style="margin:0.5rem 0 0"></p></div>' +
      '<div class="rc-section" data-al-results></div>';
    const bar = root.querySelector('[data-al-bar]');
    const message = root.querySelector('[data-al-msg]');
    const results = root.querySelector('[data-al-results]');

    function validate() {
      if (state.range === 'all') return '';
      if (!state.from || !state.to) return 'Choose both a From and a To date.';
      if (state.to < state.from) return 'The To date must be on or after the From date.';
      return '';
    }

    function drawBar() {
      const opt = (value, label, selected) =>
        '<option value="' +
        escapeHtml(value) +
        '"' +
        (selected ? ' selected' : '') +
        '>' +
        escapeHtml(label) +
        '</option>';
      bar.innerHTML =
        '<div class="th-field"><label>Date range<select data-al="range">' +
        RANGES.map(([value, label]) => opt(value, label, value === state.range)).join('') +
        '</select></label></div>' +
        '<div class="th-field"><label>From<input type="date" data-al="from" value="' +
        escapeHtml(state.from) +
        '"' +
        (state.range === 'custom' ? '' : ' disabled') +
        ' /></label></div>' +
        '<div class="th-field"><label>To<input type="date" data-al="to" value="' +
        escapeHtml(state.to) +
        '"' +
        (state.range === 'custom' ? '' : ' disabled') +
        ' /></label></div>' +
        '<div class="th-field"><label>User<select data-al="actorId">' +
        opt('', 'All users', state.actorId === '') +
        options.actors
          .map((actor) =>
            opt(actor.id, actor.name + ' (' + actor.email + ')', state.actorId === actor.id),
          )
          .join('') +
        opt('none', 'No signed-in user (public / failed sign-in)', state.actorId === 'none') +
        '</select></label></div>' +
        '<div class="th-field"><label>Area<select data-al="module">' +
        opt('', 'All areas', state.module === '') +
        options.modules
          .map((key) => opt(key, AL_MODULE_LABELS[key] || alSentence(key), state.module === key))
          .join('') +
        '</select></label></div>' +
        '<div class="th-field"><label>Search<input type="search" data-al="search" placeholder="Reference, name, detail&hellip;" value="' +
        escapeHtml(state.search) +
        '" /></label></div>' +
        '<div class="th-field rd-filter-actions"><button class="button button-outline" type="button" data-al-refresh>Refresh</button></div>';
      const control = (name) => bar.querySelector('[data-al="' + name + '"]');
      control('range').addEventListener('change', (event) => {
        state.range = event.target.value;
        applyRange(state.range);
        state.page = 1;
        drawBar();
        load();
      });
      ['from', 'to'].forEach((name) =>
        control(name).addEventListener('change', (event) => {
          state[name] = event.target.value;
          state.page = 1;
          load();
        }),
      );
      ['actorId', 'module'].forEach((name) =>
        control(name).addEventListener('change', (event) => {
          state[name] = event.target.value;
          state.page = 1;
          load();
        }),
      );
      let timer = null;
      control('search').addEventListener('input', (event) => {
        state.search = event.target.value.trim();
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          state.page = 1;
          load();
        }, 350);
      });
      bar.querySelector('[data-al-refresh]').addEventListener('click', () => load());
    }

    function drawResults() {
      const data = state.data;
      if (state.loading && !data) {
        results.innerHTML = '<p class="pg-empty">Loading activity&hellip;</p>';
        return;
      }
      if (state.error) {
        results.innerHTML = '<p class="pg-empty pg-error">' + escapeHtml(state.error) + '</p>';
        return;
      }
      if (!data) {
        results.innerHTML = '';
        return;
      }
      const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
      const head =
        '<div class="rc-section-head"><span>Activity</span><span class="rc-count">' +
        data.total.toLocaleString('en-US') +
        ' event' +
        (data.total === 1 ? '' : 's') +
        '</span></div>';
      if (!data.items.length) {
        results.innerHTML = head + '<p class="pg-empty">No activity matches these filters.</p>';
        return;
      }
      results.innerHTML =
        head +
        '<div class="table-wrap"><table class="rc-table"><thead><tr><th>Time (Dubai)</th><th>User</th><th>Action</th><th>Details</th><th>Record</th></tr></thead><tbody>' +
        data.items
          .map((event) => {
            const details = alDetails(event);
            const warn = event.action === 'auth.login_failed';
            return (
              '<tr><td class="num" style="text-align:left">' +
              escapeHtml(event.occurredAt) +
              '</td><td>' +
              (event.actorName
                ? escapeHtml(event.actorName) +
                  '<br /><span class="form-note" style="margin:0">' +
                  escapeHtml(event.actorEmail || '') +
                  '</span>'
                : '<span class="form-note" style="margin:0">—</span>') +
              '</td><td><span class="pg-chip' +
              (warn ? ' warn' : '') +
              '" title="' +
              escapeHtml(event.action) +
              '">' +
              escapeHtml(alActionLabel(event.action)) +
              '</span></td><td class="pg-wrap">' +
              escapeHtml(details) +
              '</td><td>' +
              (event.targetType
                ? escapeHtml(alSentence(event.targetType)) +
                  (event.targetId ? ' #' + escapeHtml(event.targetId) : '')
                : '') +
              '</td></tr>'
            );
          })
          .join('') +
        '</tbody></table></div>' +
        '<div class="rd-pager"><button class="button button-outline" type="button" data-al-prev' +
        (data.page <= 1 ? ' disabled' : '') +
        '>Previous</button><span class="form-note">Page ' +
        data.page +
        ' of ' +
        totalPages +
        '</span><button class="button button-outline" type="button" data-al-next' +
        (data.page >= totalPages ? ' disabled' : '') +
        '>Next</button></div>';
      results.querySelector('[data-al-prev]')?.addEventListener('click', () => {
        state.page = Math.max(1, state.page - 1);
        load();
      });
      results.querySelector('[data-al-next]')?.addEventListener('click', () => {
        state.page += 1;
        load();
      });
    }

    async function load() {
      const problem = validate();
      message.textContent = problem;
      message.classList.toggle('pg-error', Boolean(problem));
      if (problem) return;
      state.loading = true;
      state.error = '';
      drawResults();
      try {
        state.data = await apiRequest(
          '/api/audit-events?' +
            rdQs({
              from: state.range === 'all' ? '' : state.from,
              to: state.range === 'all' ? '' : state.to,
              actorId: state.actorId,
              module: state.module,
              search: state.search,
              page: state.page,
              pageSize: state.pageSize,
            }),
        );
      } catch (error) {
        state.data = null;
        state.error = error.message;
      } finally {
        state.loading = false;
      }
      drawResults();
    }

    drawBar();
    await load();
  }

  // --- Service Revenue + Budget dashboards (modification.md #49, #50) -----
  // Fed by admin uploads of the master Excel workbooks (Service Dashboard
  // .xlsm and Service Budget .xlsx) until ERP gives us an API or table
  // access. Charts use Chart.js (self-hosted at /portal/vendor, because the
  // production CSP only allows same-origin scripts) in the same style as the
  // legacy portal's Revenue Dashboard.
  const RD_MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const RD_MONTHS_FULL = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const RD_JOB_LABELS = {
    CSIJW: 'Warranty Repairs',
    CSIDI: 'Delivery + Install',
    CSIJO: 'Non-Warranty Repairs',
    CSIDO: 'Delivery Only',
    CSIII: 'Installation Only',
  };
  // Same job-type palette as the legacy Revenue Dashboard.
  const RD_JT_COLORS = {
    CSIJW: '#F5B84B',
    CSIDI: '#33D6C0',
    CSIJO: '#F2637E',
    CSIDO: '#9C8DF2',
    CSIII: '#4E7FF2',
  };
  const RD_FALLBACK_COLORS = [
    '#EB6834',
    '#4E7FF2',
    '#33D6C0',
    '#9C8DF2',
    '#F5B84B',
    '#F2637E',
    '#2f9e6f',
    '#7a4fb5',
    '#4a5a6a',
    '#c8453b',
  ];
  const RD_JOB_ORDER = ['CSIJW', 'CSIDI', 'CSIJO', 'CSIDO', 'CSIII'];

  function rdJtColor(code, i) {
    return RD_JT_COLORS[code] || RD_FALLBACK_COLORS[(i || 0) % RD_FALLBACK_COLORS.length];
  }
  function rdMoney(value) {
    return Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  function rdMoney2(value) {
    return Number(value || 0).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  function rdPercent(part, whole) {
    return whole ? ((part / whole) * 100).toFixed(1) + '%' : '--';
  }
  function rdJobLabel(code) {
    return RD_JOB_LABELS[code] ? RD_JOB_LABELS[code] : code;
  }
  function rdSortJobTypes(codes) {
    return [...codes].sort((a, b) => {
      const ia = RD_JOB_ORDER.indexOf(a);
      const ib = RD_JOB_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
  }
  // Human label for a dimension value (period 2026-09 -> "Sep 2026" etc.).
  function rdLabel(dimension, key) {
    if (dimension === 'period') {
      const [y, m] = String(key).split('-');
      return RD_MONTHS[Number(m) - 1] + ' ' + y;
    }
    if (dimension === 'month') return RD_MONTHS_FULL[Number(key) - 1] || key;
    if (dimension === 'week') return 'Week ' + key;
    if (dimension === 'yearWeek') return String(key).replace('-W', ' W');
    if (dimension === 'jobType') return key + ' - ' + rdJobLabel(key);
    return String(key);
  }
  const RD_DIM_NAMES = {
    year: 'Year',
    period: 'Month',
    month: 'Month of year',
    week: 'Week',
    yearWeek: 'Week',
    jobType: 'Job type',
    channel: 'Sales channel',
    salesPerson: 'Salesperson',
    customer: 'Customer',
    costStatus: 'Cost status',
    billingCode: 'Billing code',
    jobStatus: 'Job status',
    orderStatus: 'Order status',
    exception: 'Exception',
  };

  function rdSourceBanner(batch, kindLabel) {
    if (!batch) {
      return (
        '<p class="form-note rd-banner rd-banner-empty">No ' +
        escapeHtml(kindLabel) +
        ' workbook has been uploaded yet.</p>'
      );
    }
    return (
      '<p class="form-note rd-banner">Source: <strong>' +
      escapeHtml(batch.fileName) +
      '</strong> &middot; uploaded ' +
      escapeHtml(formatDate(batch.uploadedAt)) +
      ' &middot; ' +
      rdMoney(batch.rowCount) +
      ' rows &middot; AED ' +
      rdMoney(batch.totalAmount) +
      (hasPermission('revenue_dashboard.write') && batch.id
        ? ' &middot; <button class="button dl-pill" type="button" data-rd-dl="' +
          escapeHtml(String(batch.id)) +
          '">Download Excel</button><span class="form-note" data-rd-dl-msg role="status"></span>'
        : '') +
      '</p>'
    );
  }

  // Upload card, shown only to users who may upload. `kind` is
  // 'revenue' or 'budget'; onDone re-renders the page.
  function rdUploadCard(host, kind, onDone) {
    if (!hasPermission('revenue_dashboard.write')) return;
    const label =
      kind === 'revenue' ? 'Service Dashboard master (.xlsm)' : 'Service Budget workbook (.xlsx)';
    const card = document.createElement('div');
    card.className = 'rd-upload';
    card.innerHTML =
      '<strong>Refresh data ' +
      tipHtml(
        'Upload the latest ' +
          escapeHtml(label) +
          '. The newest upload replaces what the dashboard shows; earlier uploads are kept as history.',
      ) +
      '</strong>' +
      '<input type="file" accept=".xlsx,.xlsm" data-rd-file />' +
      '<button class="button" type="button" data-rd-upload>Upload</button>' +
      '<span class="form-note" data-rd-upload-msg></span>';
    host.appendChild(card);
    const msg = card.querySelector('[data-rd-upload-msg]');
    card.querySelector('[data-rd-upload]').addEventListener('click', async () => {
      const file = card.querySelector('[data-rd-file]').files[0];
      if (!file) {
        msg.textContent = 'Choose a file first.';
        return;
      }
      msg.textContent = 'Uploading and reading the workbook - this can take a few seconds...';
      try {
        const form = new FormData();
        form.append('kind', kind);
        form.append('file', file);
        const result = await apiUploadRequest('/api/revenue-dashboard/import', form);
        msg.textContent =
          'Imported ' +
          rdMoney(result.batch.rowCount) +
          ' rows.' +
          (result.batch.budgetVersion
            ? ' Budget Variance now uses this budget: ' +
              result.batch.budgetVersion.versionName +
              (result.batch.budgetVersion.createdNewVersion
                ? ' (new version - activate it under Budget versions).'
                : ' (refreshed).')
            : '');
        onDone();
      } catch (error) {
        msg.textContent = error.message || 'The upload failed.';
      }
    });
  }

  // --- Chart.js plumbing --------------------------------------------------
  let rdChartLibPromise = null;
  function rdLoadChartLib() {
    if (window.Chart) return Promise.resolve(window.Chart);
    if (!rdChartLibPromise) {
      rdChartLibPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/portal/vendor/chart.umd.js';
        script.onload = () => resolve(window.Chart);
        script.onerror = () => {
          rdChartLibPromise = null;
          reject(new Error('The chart library could not be loaded.'));
        };
        document.head.appendChild(script);
      });
    }
    return rdChartLibPromise;
  }

  function rdCssVar(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  // Draws numbers on the chart: the stack total above stacked bars
  // (mode 'total') or the value above every bar (mode 'each'). Values read
  // "AED 40,972"; dense charts switch to a compact "41.0k".
  const rdValueLabelPlugin = {
    id: 'rdValueLabels',
    afterDatasetsDraw(chart, _args, opts) {
      if (!opts || !opts.mode) return;
      const { ctx, scales } = chart;
      const yScale = scales.y;
      if (!yScale) return;
      const first = chart.getDatasetMeta(0);
      if (!first || !first.data) return;
      const count = first.data.length;
      const compact = count > 14 || (opts.mode === 'each' && chart.data.datasets.length > 1);
      const fmt = (v) => {
        if (compact) return v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(Math.round(v));
        return (opts.prefix || '') + rdMoney(v) + (opts.suffix || '');
      };
      ctx.save();
      ctx.font = '600 ' + (compact ? 10 : 11) + 'px Inter, system-ui, sans-serif';
      ctx.fillStyle = rdCssVar('--ink', '#172334');
      ctx.textAlign = 'center';
      for (let i = 0; i < count; i += 1) {
        let total = 0;
        chart.data.datasets.forEach((dataset, di) => {
          if (!chart.isDatasetVisible(di)) return;
          total += Number(dataset.data[i]) || 0;
        });
        if (!total) continue;
        if (opts.mode === 'total') {
          ctx.fillText(fmt(total), first.data[i].x, yScale.getPixelForValue(total) - 6);
        } else {
          chart.data.datasets.forEach((dataset, di) => {
            const value = Number(dataset.data[i]) || 0;
            if (!value || !chart.isDatasetVisible(di)) return;
            const bar = chart.getDatasetMeta(di).data[i];
            ctx.fillText(fmt(value), bar.x, bar.y - 6);
          });
        }
      }
      ctx.restore();
    },
  };

  // Horizontal bars with the value written at the end of each bar.
  const rdBarEndLabelPlugin = {
    id: 'rdBarEndLabels',
    afterDatasetsDraw(chart, _args, opts) {
      if (!opts || !opts.enabled) return;
      const { ctx } = chart;
      ctx.save();
      ctx.font = '600 11px Inter, system-ui, sans-serif';
      ctx.fillStyle = rdCssVar('--ink', '#172334');
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      chart.data.datasets.forEach((dataset, di) => {
        if (!chart.isDatasetVisible(di)) return;
        chart.getDatasetMeta(di).data.forEach((bar, i) => {
          const value = Number(dataset.data[i]) || 0;
          if (!value) return;
          ctx.fillText(
            (opts.prefix || '') + rdMoney(value) + (opts.suffix || ''),
            bar.x + 6,
            bar.y,
          );
        });
      });
      ctx.restore();
    },
  };

  // Percent share written on each doughnut segment.
  const rdDonutLabelPlugin = {
    id: 'rdDonutLabels',
    afterDatasetsDraw(chart, _args, opts) {
      if (!opts || !opts.enabled) return;
      const dataset = chart.data.datasets[0];
      const total = dataset.data.reduce((a, b) => a + (Number(b) || 0), 0);
      if (!total) return;
      const { ctx } = chart;
      ctx.save();
      ctx.font = '700 11px Inter, system-ui, sans-serif';
      ctx.fillStyle = '#10233f';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      chart.getDatasetMeta(0).data.forEach((arc, i) => {
        const value = Number(dataset.data[i]) || 0;
        if (value / total < 0.04) return;
        const pos = arc.tooltipPosition();
        ctx.fillText(((value / total) * 100).toFixed(0) + '%', pos.x, pos.y);
      });
      ctx.restore();
    },
  };

  async function rdDrawChart(canvas, config) {
    if (!canvas) return null;
    const Chart = await rdLoadChartLib();
    if (!Chart.registry.plugins.get('rdValueLabels')) {
      Chart.register(rdValueLabelPlugin, rdBarEndLabelPlugin, rdDonutLabelPlugin);
    }
    Chart.defaults.color = rdCssVar('--muted', '#5e6d7e');
    Chart.defaults.borderColor = rdCssVar('--line', '#d9e2eb');
    Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
    Chart.getChart(canvas)?.destroy();
    return new Chart(canvas, config);
  }

  function rdDestroyCharts(host) {
    if (!window.Chart) return;
    host.querySelectorAll('canvas').forEach((canvas) => window.Chart.getChart(canvas)?.destroy());
  }

  function rdLegend(items) {
    return (
      '<div class="rd-legend-row">' +
      items
        .map(
          (item) =>
            '<span><i style="background:' +
            item.color +
            '"></i>' +
            escapeHtml(item.label) +
            (item.value !== undefined ? ' &mdash; AED ' + rdMoney(item.value) : '') +
            '</span>',
        )
        .join('') +
      '</div>'
    );
  }

  // Stacked-by-job-type bar chart from a two-way matrix (row x jobType).
  function rdStackedConfig(matrix, rowDimension, metric, options = {}) {
    const rows = [...new Set(matrix.cells.map((c) => c.row))].sort();
    const types = rdSortJobTypes([...new Set(matrix.cells.map((c) => c.col))]);
    const lookup = new Map(matrix.cells.map((c) => [c.row + '|' + c.col, c[metric]]));
    return {
      type: 'bar',
      data: {
        labels: rows.map((r) =>
          rowDimension === 'period' ? rdLabel('period', r) : rdLabel(rowDimension, r),
        ),
        datasets: types.map((type, i) => ({
          label: rdJobLabel(type),
          data: rows.map((r) => lookup.get(r + '|' + type) || 0),
          backgroundColor: rdJtColor(type, i),
          borderRadius: options.borderRadius ?? 4,
          stack: 'stack',
          barPercentage: options.barPercentage ?? 0.8,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        resizeDelay: 200,
        layout: { padding: { top: 22 } },
        plugins: {
          legend: { display: false },
          rdValueLabels: options.labels
            ? { mode: 'total', prefix: metric === 'revenue' ? 'AED ' : '' }
            : {},
          tooltip: {
            callbacks: {
              label: (c) =>
                ' ' +
                c.dataset.label +
                ': ' +
                (metric === 'revenue' ? 'AED ' : '') +
                rdMoney(c.raw) +
                (metric === 'qty' ? ' units' : ''),
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: {
              maxRotation: options.rotate ? 60 : 0,
              autoSkip: rows.length > 14,
              maxTicksLimit: options.maxTicks || 24,
            },
          },
          y: {
            stacked: true,
            beginAtZero: true,
            grace: '8%',
            title: { display: true, text: metric === 'revenue' ? 'Value (AED)' : 'Units' },
            ticks: { callback: (v) => rdMoney(v) },
          },
        },
      },
      _types: types,
    };
  }

  function rdHBarConfig(rows, options = {}) {
    return {
      type: 'bar',
      data: {
        labels: rows.map((r) => r.label),
        datasets: [
          {
            data: rows.map((r) => r.value),
            backgroundColor: rows.map((r, i) => r.color || rdJtColor(r.key, i)),
            borderRadius: 6,
            maxBarThickness: 26,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        resizeDelay: 200,
        layout: { padding: { right: options.padRight || 90 } },
        plugins: {
          legend: { display: false },
          rdBarEndLabels: {
            enabled: true,
            prefix: options.prefix ?? 'AED ',
            suffix: options.suffix || '',
          },
          tooltip: {
            callbacks: {
              label: (c) =>
                ' ' + (options.prefix ?? 'AED ') + rdMoney(c.raw) + (options.suffix || ''),
            },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            title: { display: true, text: options.axisTitle || 'Value (AED)' },
            ticks: { callback: (v) => rdMoney(v) },
          },
          y: {
            grid: { display: false },
            ticks: {
              callback(value) {
                const l = this.getLabelForValue(value);
                return l.length > 22 ? l.slice(0, 21) + '…' : l;
              },
            },
          },
        },
      },
    };
  }

  function rdDonutConfig(rows) {
    return {
      type: 'doughnut',
      data: {
        labels: rows.map((r) => r.label),
        datasets: [
          {
            data: rows.map((r) => r.value),
            backgroundColor: rows.map((r, i) => r.color || rdJtColor(r.key, i)),
            borderWidth: 3,
            borderColor: rdCssVar('--surface', '#fff'),
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        resizeDelay: 200,
        cutout: '62%',
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 9, padding: 14, font: { size: 11 } } },
          rdDonutLabels: { enabled: true },
          tooltip: { callbacks: { label: (c) => ' ' + c.label + ': AED ' + rdMoney(c.raw) } },
        },
      },
    };
  }

  function rdKpis(items) {
    return (
      '<div class="rd-kpi-grid">' +
      items
        .map(
          (k, i) =>
            '<div class="rd-kpi-card" style="animation-delay:' +
            i * 0.04 +
            's"><div class="lbl">' +
            escapeHtml(k[0]) +
            '</div><div class="val">' +
            escapeHtml(k[1]) +
            '</div><div class="sub">' +
            escapeHtml(k[2] || '') +
            '</div></div>',
        )
        .join('') +
      '</div>'
    );
  }

  function rdSection(title, inner, extra) {
    return (
      '<div class="rc-section"><div class="rc-section-head"><span>' +
      title +
      '</span>' +
      (extra ? '<span class="rc-count">' + extra + '</span>' : '') +
      '</div>' +
      inner +
      '</div>'
    );
  }

  // Table of one grouped level (drill-down / breakdown). Rows with
  // data-rd-drill are clickable.
  function rdGroupTable(group, dimension, options = {}) {
    if (!group.rows.length)
      return '<p class="form-note rd-pad">No data for the selected filters.</p>';
    const total = group.totals.revenue;
    const max = Math.max(...group.rows.map((r) => Math.abs(r.revenue)), 1);
    return (
      '<div class="table-wrap"><table class="rc-table"><thead><tr><th>' +
      escapeHtml(options.title || RD_DIM_NAMES[dimension] || 'Item') +
      '</th><th class="num">Jobs</th><th class="num">Qty</th><th class="num">Revenue (AED)</th><th class="num">Share</th><th class="num">Avg / job</th>' +
      (options.drill ? '<th></th>' : '') +
      '</tr></thead><tbody>' +
      group.rows
        .map(
          (r, i) =>
            '<tr' +
            (options.drill
              ? ' class="is-drill" data-rd-drill="' + escapeHtml(r.key) + '" tabindex="0"'
              : '') +
            '><td>' +
            (dimension === 'jobType'
              ? '<i class="rd-dot" style="background:' + rdJtColor(r.key, i) + '"></i>'
              : '') +
            escapeHtml(rdLabel(dimension, r.key)) +
            '<div class="rd-mix-track"><div class="rd-mix-fill" style="width:' +
            ((Math.abs(r.revenue) / max) * 100).toFixed(1) +
            '%;background:' +
            (dimension === 'jobType' ? rdJtColor(r.key, i) : '#4E7FF2') +
            '"></div></div></td>' +
            '<td class="num">' +
            rdMoney(r.jobs) +
            '</td><td class="num">' +
            rdMoney(r.qty) +
            '</td><td class="num">' +
            rdMoney2(r.revenue) +
            '</td><td class="num">' +
            rdPercent(r.revenue, total) +
            '</td><td class="num">' +
            rdMoney2(r.jobs ? r.revenue / r.jobs : 0) +
            '</td>' +
            (options.drill ? '<td class="rd-drill-cue">Drill &rsaquo;</td>' : '') +
            '</tr>',
        )
        .join('') +
      '</tbody><tfoot><tr><td>Total</td><td class="num">' +
      rdMoney(group.totals.jobs) +
      '</td><td class="num">' +
      rdMoney(group.totals.qty) +
      '</td><td class="num">' +
      rdMoney2(total) +
      '</td><td class="num">100%</td><td class="num">' +
      rdMoney2(group.totals.jobs ? total / group.totals.jobs : 0) +
      '</td>' +
      (options.drill ? '<td></td>' : '') +
      '</tr></tfoot></table></div>'
    );
  }

  // Row x job-type matrix table with totals (finance view).
  function rdMatrixTable(matrix, rowDimension, metric, options = {}) {
    const rows = [...new Set(matrix.cells.map((c) => c.row))].sort();
    const types = rdSortJobTypes([...new Set(matrix.cells.map((c) => c.col))]);
    if (!rows.length) return '<p class="form-note rd-pad">No data for the selected filters.</p>';
    const lookup = new Map(matrix.cells.map((c) => [c.row + '|' + c.col, c[metric]]));
    const colTotals = types.map(() => 0);
    const fmt = metric === 'revenue' ? rdMoney : rdMoney;
    let previous = null;
    const body = rows
      .map((row) => {
        const values = types.map((t) => lookup.get(row + '|' + t) || 0);
        values.forEach((v, i) => (colTotals[i] += v));
        const sum = values.reduce((a, b) => a + b, 0);
        const change = previous && previous > 0 ? ((sum - previous) / previous) * 100 : null;
        previous = sum;
        return (
          '<tr' +
          (options.drill
            ? ' class="is-drill" data-rd-drill="' + escapeHtml(row) + '" tabindex="0"'
            : '') +
          '><td>' +
          escapeHtml(rdLabel(rowDimension, row)) +
          '</td>' +
          values
            .map(
              (v) => '<td class="num">' + (v ? fmt(v) : '<span class="rd-zero">-</span>') + '</td>',
            )
            .join('') +
          '<td class="num"><strong>' +
          fmt(sum) +
          '</strong></td>' +
          (options.change
            ? '<td class="num ' +
              (change === null ? '' : change < 0 ? 'rd-neg' : 'rd-pos') +
              '">' +
              (change === null ? '--' : (change > 0 ? '+' : '') + change.toFixed(1) + '%') +
              '</td>'
            : '') +
          '</tr>'
        );
      })
      .join('');
    const grand = colTotals.reduce((a, b) => a + b, 0);
    return (
      '<div class="table-wrap"><table class="rc-table"><thead><tr><th>' +
      escapeHtml(options.title || 'Period') +
      '</th>' +
      types
        .map(
          (t, i) =>
            '<th class="num"><i class="rd-dot" style="background:' +
            rdJtColor(t, i) +
            '"></i>' +
            escapeHtml(t) +
            '</th>',
        )
        .join('') +
      '<th class="num">Total</th>' +
      (options.change ? '<th class="num">vs prior</th>' : '') +
      '</tr></thead><tbody>' +
      body +
      '</tbody><tfoot><tr><td>Total</td>' +
      colTotals.map((v) => '<td class="num">' + fmt(v) + '</td>').join('') +
      '<td class="num">' +
      fmt(grand) +
      '</td>' +
      (options.change ? '<td></td>' : '') +
      '</tr></tfoot></table></div>'
    );
  }

  function rdQs(params) {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== '' && value !== undefined && value !== null) q.set(key, value);
    });
    return q.toString();
  }
  // Tell the server who looked at / copied / emailed the revenue dashboard.
  // Fire-and-forget; a view is logged at most once per 10 minutes per tab.
  const rdActivitySeen = new Map();
  function rdLogActivity(action, view, period) {
    if (action === 'viewed') {
      const last = rdActivitySeen.get(view) || 0;
      if (Date.now() - last < 10 * 60 * 1000) return;
      rdActivitySeen.set(view, Date.now());
    }
    apiRequest('/api/revenue-dashboard/activity?' + rdQs({ action, view, period }), {
      method: 'POST',
    }).catch(() => {});
  }

  const rdApi = (path, params) => apiRequest('/api/revenue-dashboard/' + path + '?' + rdQs(params));

  function rdDownloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // Job rows table with click-to-expand detail (remarks, billing logic).
  function rdJobsTable(lines) {
    if (!lines.length) return '<p class="form-note rd-pad">No jobs match the selected filters.</p>';
    return (
      '<div class="table-wrap"><table class="rc-table rd-jobs-table"><thead><tr><th>Date</th><th>Wk</th><th>Type</th><th>Inv/Del no</th><th>CSOSC order</th><th>Customer</th><th>Channel</th><th>Salesperson</th><th>ERP parent brand</th><th>Billing code</th><th>Cost status</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Revenue</th></tr></thead><tbody>' +
      lines
        .map(
          (r, i) =>
            '<tr class="is-drill" data-rd-expand="' +
            i +
            '" tabindex="0"><td>' +
            escapeHtml(r.orderDate || '') +
            '</td><td>' +
            escapeHtml(r.weekNo ?? '') +
            '</td><td>' +
            escapeHtml(r.jobType) +
            '</td><td>' +
            escapeHtml(r.invDelNo || '') +
            '</td><td>' +
            escapeHtml(r.csoscOrderNo || '') +
            '</td><td>' +
            escapeHtml(r.customer || '') +
            '</td><td>' +
            escapeHtml(r.salesChannel || '') +
            '</td><td>' +
            escapeHtml(r.salesPerson || '') +
            '</td><td>' +
            escapeHtml(r.erpBrand || '') +
            '</td><td>' +
            escapeHtml(r.billingCode || '') +
            '</td><td>' +
            escapeHtml(r.costStatus || '') +
            '</td><td class="num">' +
            rdMoney(r.qty) +
            '</td><td class="num">' +
            rdMoney2(r.unitPrice) +
            '</td><td class="num">' +
            rdMoney2(r.revenue) +
            '</td></tr>' +
            '<tr class="rd-detail" data-rd-detail="' +
            i +
            '" hidden><td colspan="14"><div class="rd-detail-grid"><div><strong>Description</strong> ' +
            escapeHtml(r.description || '-') +
            '</div><div><strong>Job status</strong> ' +
            escapeHtml(r.jobSheetStatus || '-') +
            '</div>' +
            (r.refDocNo
              ? '<div><strong>Ref doc no</strong> ' + refDocPill(r.refDocNo) + '</div>'
              : '') +
            '<div><strong>Original job value</strong> AED ' +
            rdMoney2(r.originalJobValue) +
            '</div><div><strong>Workbook row</strong> ' +
            escapeHtml(r.sourceRow ?? '-') +
            '</div></div><pre>' +
            escapeHtml(r.remarks || 'No remarks') +
            '</pre></td></tr>',
        )
        .join('') +
      '</tbody></table></div>'
    );
  }

  function rdBindExpand(host) {
    host.querySelectorAll('[data-rd-expand]').forEach((row) => {
      const toggle = () => {
        const detail = host.querySelector('[data-rd-detail="' + row.dataset.rdExpand + '"]');
        if (detail) detail.hidden = !detail.hidden;
      };
      row.addEventListener('click', toggle);
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') toggle();
      });
    });
  }

  function rdPager(pg) {
    return (
      '<div class="rd-pager"><button class="button button-outline" type="button" data-rd-prev' +
      (pg.page <= 1 ? ' disabled' : '') +
      '>Previous</button><span class="form-note">Page ' +
      pg.page +
      ' of ' +
      Math.max(1, pg.totalPages) +
      ' &middot; ' +
      rdMoney(pg.total) +
      ' jobs</span><button class="button button-outline" type="button" data-rd-next' +
      (pg.page >= pg.totalPages ? ' disabled' : '') +
      '>Next</button></div>'
    );
  }

  async function renderRevenueDashboard(root) {
    rdDestroyCharts(root);
    const F = { year: '', month: '', week: '', jobType: '', channel: '', costStatus: '' };
    const allowedTabs = revenueTabs();
    let tab = allowedTabs[0] || 'overview';
    let reportView = 'drill';
    let drill = { path: [], groupBy: null, page: 1, search: '' };
    let explorer = { page: 1, search: '' };
    let seeded = false;

    root.innerHTML =
      '<div data-rd-top></div><div data-rd-tabs></div><div data-rd-bar></div><div data-rd-body><p class="form-note">Loading revenue data&hellip;</p></div>';
    const top = root.querySelector('[data-rd-top]');
    const tabsEl = root.querySelector('[data-rd-tabs]');
    const barEl = root.querySelector('[data-rd-bar]');
    const body = root.querySelector('[data-rd-body]');

    function periodLabel() {
      const parts = [];
      if (F.year) parts.push(F.year);
      if (F.month) parts.push(RD_MONTHS_FULL[Number(F.month) - 1]);
      if (F.week) parts.push('Week ' + F.week);
      if (F.jobType) parts.push(F.jobType);
      if (F.channel) parts.push(F.channel);
      if (F.costStatus) parts.push(F.costStatus);
      return parts.length ? parts.join(' / ') : 'All periods';
    }

    function drawTabs() {
      tabsEl.innerHTML =
        '<div class="rd-subtabs" role="tablist">' +
        [
          ['overview', 'Overview'],
          ['explorer', 'Explorer'],
          ['reports', 'Reports'],
          ['logic', 'Logic applied'],
        ]
          .filter(([id]) => allowedTabs.includes(id))
          .map(
            ([id, name]) =>
              '<button type="button" role="tab" class="rd-subtab-btn' +
              (tab === id ? ' active' : '') +
              '" data-rd-tab="' +
              id +
              '">' +
              name +
              '</button>',
          )
          .join('') +
        '</div>';
      tabsEl.querySelectorAll('[data-rd-tab]').forEach((button) => {
        button.addEventListener('click', () => {
          tab = button.dataset.rdTab;
          draw();
        });
      });
    }

    function drawFilterBar(options) {
      const sel = (name, label, values, labelFor) =>
        '<div class="th-field"><label>' +
        label +
        '<select data-rd-filter="' +
        name +
        '"><option value="">All</option>' +
        values
          .map(
            (v) =>
              '<option value="' +
              escapeHtml(String(v)) +
              '"' +
              (String(F[name]) === String(v) ? ' selected' : '') +
              '>' +
              escapeHtml(labelFor ? labelFor(v) : String(v)) +
              '</option>',
          )
          .join('') +
        '</select></label></div>';
      barEl.innerHTML =
        '<div class="rc-section rd-filter-card"><div class="rd-report-toolbar">' +
        sel('year', 'Year', options.years) +
        sel(
          'month',
          'Month',
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
          (v) => RD_MONTHS_FULL[v - 1],
        ) +
        sel('week', 'Week', options.weeks, (v) => 'Week ' + v) +
        sel('jobType', 'Job type', options.jobTypes, (v) => rdLabel('jobType', v)) +
        sel('channel', 'Sales channel', options.channels) +
        sel('costStatus', 'Cost status', options.costStatuses) +
        '<div class="th-field rd-filter-actions"><button class="button button-outline" type="button" data-rd-reset>Reset filters</button></div></div></div>';
      barEl.querySelectorAll('[data-rd-filter]').forEach((select) => {
        select.addEventListener('change', () => {
          F[select.dataset.rdFilter] = select.value;
          if (select.dataset.rdFilter === 'year') {
            F.month = '';
            F.week = '';
          }
          if (select.dataset.rdFilter === 'month') F.week = '';
          explorer.page = 1;
          drill.page = 1;
          draw();
        });
      });
      barEl.querySelector('[data-rd-reset]').addEventListener('click', () => {
        Object.keys(F).forEach((key) => (F[key] = ''));
        explorer.page = 1;
        drill = { path: [], groupBy: null, page: 1, search: '' };
        draw();
      });
    }

    // ---------------------------------------------------------------- Overview
    async function drawOverview(sum) {
      const [monthly, weekly, byType, byChannel, byCustomer, bySales] = await Promise.all([
        rdApi('matrix', {
          ...F,
          month: '',
          week: '',
          rowDimension: 'period',
          columnDimension: 'jobType',
        }),
        rdApi('matrix', { ...F, week: '', rowDimension: 'yearWeek', columnDimension: 'jobType' }),
        rdApi('group', { ...F, dimension: 'jobType' }),
        rdApi('group', { ...F, dimension: 'channel' }),
        rdApi('group', { ...F, dimension: 'customer' }),
        rdApi('group', { ...F, dimension: 'salesPerson' }),
      ]);
      const t = sum.summary.totals;
      const types = byType.data.rows;
      const rates = Object.fromEntries((sum.summary.rates || []).map((r) => [r.jobType, r.price]));
      const topType = types[0];
      body.innerHTML =
        rdKpis([
          ['Total revenue', 'AED ' + rdMoney(t.revenue), periodLabel()],
          ['Jobs billed', rdMoney(t.jobs), 'Revenue lines in the workbook'],
          ['Units / qty', rdMoney(t.qty), 'Billing quantity'],
          [
            'Avg revenue / job',
            'AED ' + rdMoney(t.jobs ? t.revenue / t.jobs : 0),
            'Across all job types',
          ],
          [
            'Largest revenue line',
            topType ? topType.key : '--',
            topType ? rdPercent(topType.revenue, t.revenue) + ' of revenue' : '',
          ],
        ]) +
        rdSection(
          'Monthly revenue by job type (value in AED)',
          '<div class="rd-chart-pad"><div class="rd-chart-box"><canvas id="rdc-monthly"></canvas></div>' +
            rdLegend(
              types.map((r, i) => ({
                label: rdJobLabel(r.key),
                color: rdJtColor(r.key, i),
                value: r.revenue,
              })),
            ) +
            '</div>',
        ) +
        '<div class="rd-two-col">' +
        rdSection('Revenue mix', '<div class="rd-chart-box"><canvas id="rdc-mix"></canvas></div>') +
        rdSection(
          'Monthly job quantity (units)',
          '<div class="rd-chart-box"><canvas id="rdc-qty"></canvas></div>',
        ) +
        '</div>' +
        rdSection(
          'Weekly revenue trend (AED per week, stacked by job type)',
          '<div class="rd-chart-box"><canvas id="rdc-weekly"></canvas></div>',
        ) +
        '<div class="rd-two-col">' +
        rdSection(
          'Revenue by sales channel',
          '<div class="rd-chart-box short"><canvas id="rdc-channel"></canvas></div>',
        ) +
        rdSection(
          'Top 10 customers',
          '<div class="rd-chart-box tall"><canvas id="rdc-customers"></canvas></div>',
        ) +
        '</div>' +
        rdSection(
          'Top 10 salespeople',
          '<div class="rd-chart-box tall"><canvas id="rdc-salespeople"></canvas></div>',
        ) +
        rdSection(
          'Job type breakdown',
          '<div class="table-wrap"><table class="rc-table"><thead><tr><th>Job type</th><th class="num">Rate (AED)</th><th class="num">Qty</th><th class="num">Jobs</th><th class="num">Revenue (AED)</th></tr></thead><tbody>' +
            types
              .map(
                (r, i) =>
                  '<tr><td><i class="rd-dot" style="background:' +
                  rdJtColor(r.key, i) +
                  '"></i>' +
                  escapeHtml(r.key + ' - ' + rdJobLabel(r.key)) +
                  '</td><td class="num">' +
                  (rates[r.key] !== undefined ? rdMoney2(rates[r.key]) : '--') +
                  '</td><td class="num">' +
                  rdMoney(r.qty) +
                  '</td><td class="num">' +
                  rdMoney(r.jobs) +
                  '</td><td class="num">' +
                  rdMoney2(r.revenue) +
                  ' (' +
                  rdPercent(r.revenue, t.revenue) +
                  ')</td></tr>',
              )
              .join('') +
            '</tbody></table></div>',
        ) +
        '<div class="card-help rd-pad"><span>About this view</span>' +
        tipHtml(
          'Revenue is the figure calculated in the master workbook (rate card, RWR/BER flat charge and tiered delivery pricing already applied).',
        ) +
        '</div>';

      const c = (id) => body.querySelector('#' + id);
      await rdDrawChart(
        c('rdc-monthly'),
        rdStackedConfig(monthly.data, 'period', 'revenue', { labels: true }),
      );
      await rdDrawChart(
        c('rdc-mix'),
        rdDonutConfig(
          types.map((r, i) => ({
            key: r.key,
            label: rdJobLabel(r.key),
            value: r.revenue,
            color: rdJtColor(r.key, i),
          })),
        ),
      );
      await rdDrawChart(
        c('rdc-qty'),
        rdStackedConfig(monthly.data, 'period', 'qty', { labels: true }),
      );
      await rdDrawChart(
        c('rdc-weekly'),
        rdStackedConfig(weekly.data, 'yearWeek', 'revenue', {
          borderRadius: 2,
          barPercentage: 0.9,
          maxTicks: 18,
        }),
      );
      await rdDrawChart(
        c('rdc-channel'),
        rdHBarConfig(
          byChannel.data.rows.map((r, i) => ({
            key: r.key,
            label: r.key,
            value: r.revenue,
            color: RD_FALLBACK_COLORS[i % RD_FALLBACK_COLORS.length],
          })),
        ),
      );
      await rdDrawChart(
        c('rdc-customers'),
        rdHBarConfig(
          byCustomer.data.rows
            .slice(0, 10)
            .map((r) => ({ key: r.key, label: r.key, value: r.revenue, color: '#4E7FF2' })),
          { padRight: 100 },
        ),
      );
      await rdDrawChart(
        c('rdc-salespeople'),
        rdHBarConfig(
          bySales.data.rows
            .slice(0, 10)
            .map((r) => ({ key: r.key, label: r.key, value: r.revenue, color: '#2F9E8F' })),
          { padRight: 100 },
        ),
      );
    }

    // ---------------------------------------------------------------- Explorer
    async function drawExplorer(sum) {
      const [months, byType, byCustomer, lines] = await Promise.all([
        rdApi('group', { ...F, month: '', week: '', dimension: 'month' }),
        rdApi('group', { ...F, dimension: 'jobType' }),
        rdApi('group', { ...F, dimension: 'customer' }),
        rdApi('lines', { ...F, search: explorer.search, page: explorer.page, pageSize: 50 }),
      ]);
      const t = sum.summary.totals;
      const withData = new Set(months.data.rows.map((r) => Number(r.key)));
      const counts = RD_MONTHS.map(
        (_, i) => (months.data.rows.find((r) => Number(r.key) === i + 1) || { jobs: 0 }).jobs,
      );
      const maxCust = Math.max(1, ...byCustomer.data.rows.slice(0, 8).map((r) => r.revenue));
      body.innerHTML =
        rdSection(
          'Click a month to drill in',
          '<div class="rd-pad"><div class="rd-month-pills"><button type="button" class="rd-mpill' +
            (F.month === '' ? ' active' : '') +
            '" data-rd-month="">All year</button>' +
            RD_MONTHS_FULL.map(
              (name, i) =>
                '<button type="button" class="rd-mpill' +
                (F.month === String(i + 1) ? ' active' : '') +
                (withData.has(i + 1) ? '' : ' disabled') +
                '" data-rd-month="' +
                (i + 1) +
                '">' +
                name.slice(0, 3) +
                '</button>',
            ).join('') +
            '</div><p class="form-note">Period: ' +
            escapeHtml(periodLabel()) +
            '</p></div>',
        ) +
        rdSection(
          'Monthly job volume' + (F.year ? ' &mdash; ' + F.year : ''),
          '<div class="rd-chart-box"><canvas id="rdc-volume"></canvas></div>',
          rdMoney(counts.reduce((a, b) => a + b, 0)) + ' total jobs',
        ) +
        rdKpis([
          ['Revenue', 'AED ' + rdMoney(t.revenue), periodLabel()],
          ['Jobs', rdMoney(t.jobs), 'Revenue lines'],
          [
            'Avg revenue / job',
            'AED ' + rdMoney(t.jobs ? t.revenue / t.jobs : 0),
            'Selected period',
          ],
        ]) +
        '<div class="rd-two-col">' +
        rdSection(
          'Revenue by job type',
          '<div class="rd-chart-box short"><canvas id="rdc-exp-type"></canvas></div>',
        ) +
        rdSection(
          'Top customers',
          '<div class="table-wrap"><table class="rc-table"><tbody>' +
            (byCustomer.data.rows
              .slice(0, 8)
              .map(
                (r) =>
                  '<tr><td>' +
                  escapeHtml(r.key.length > 40 ? r.key.slice(0, 40) + '…' : r.key) +
                  '<div class="rd-mix-track"><div class="rd-mix-fill" style="width:' +
                  ((r.revenue / maxCust) * 100).toFixed(1) +
                  '%;background:#4E7FF2"></div></div></td><td class="num">AED ' +
                  rdMoney(r.revenue) +
                  '</td></tr>',
              )
              .join('') || '<tr><td>No data</td></tr>') +
            '</tbody></table></div>',
        ) +
        '</div>' +
        rdSection('Job type detail', rdGroupTable(byType.data, 'jobType', { title: 'Job type' })) +
        rdSection(
          'Jobs',
          '<div class="rd-pad"><label class="rd-search">Search<input type="search" data-rd-search value="' +
            escapeHtml(explorer.search) +
            '" placeholder="Customer, invoice, order, salesperson, remarks" /></label></div>' +
            rdJobsTable(lines.lines || []) +
            rdPager(lines.pagination),
          rdMoney(lines.pagination.total) + ' jobs',
        );
      body.querySelectorAll('[data-rd-month]').forEach((pill) => {
        pill.addEventListener('click', () => {
          if (pill.classList.contains('disabled')) return;
          F.month = pill.dataset.rdMonth;
          F.week = '';
          explorer.page = 1;
          draw();
        });
      });
      rdBindExpand(body);
      const search = body.querySelector('[data-rd-search]');
      let timer = null;
      search.addEventListener('input', () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          explorer.search = search.value.trim();
          explorer.page = 1;
          draw().then(() => body.querySelector('[data-rd-search]')?.focus());
        }, 350);
      });
      body.querySelector('[data-rd-prev]')?.addEventListener('click', () => {
        explorer.page -= 1;
        draw();
      });
      body.querySelector('[data-rd-next]')?.addEventListener('click', () => {
        explorer.page += 1;
        draw();
      });
      await rdDrawChart(body.querySelector('#rdc-volume'), {
        type: 'bar',
        data: {
          labels: RD_MONTHS,
          datasets: [
            { data: counts, backgroundColor: '#EB6834', borderRadius: 4, maxBarThickness: 46 },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          resizeDelay: 200,
          layout: { padding: { top: 24 } },
          plugins: {
            legend: { display: false },
            rdValueLabels: { mode: 'each', prefix: '', suffix: '' },
            tooltip: { callbacks: { label: (c) => ' ' + rdMoney(c.raw) + ' jobs' } },
          },
          scales: {
            x: { grid: { display: false } },
            y: { beginAtZero: true, grace: '15%', title: { display: true, text: 'Jobs' } },
          },
        },
      });
      await rdDrawChart(
        body.querySelector('#rdc-exp-type'),
        rdHBarConfig(
          byType.data.rows.map((r, i) => ({
            key: r.key,
            label: rdJobLabel(r.key),
            value: r.revenue,
            color: rdJtColor(r.key, i),
          })),
        ),
      );
    }

    // ----------------------------------------------------------------- Reports
    const DRILL_SEQUENCE = ['year', 'period', 'jobType', 'salesPerson', 'channel'];
    const DRILL_DIMENSIONS = [
      'year',
      'period',
      'yearWeek',
      'jobType',
      'channel',
      'salesPerson',
      'customer',
      'costStatus',
      'billingCode',
      'jobStatus',
    ];

    function drillFilters() {
      const f = { ...F };
      drill.path.forEach((p) => {
        if (p.dim === 'exception') f.exception = p.value;
        else f[p.dim] = p.value;
      });
      return f;
    }
    function drillUsed() {
      const used = new Set(drill.path.map((p) => p.dim));
      if (F.year) used.add('year');
      if (F.jobType) used.add('jobType');
      if (F.channel) used.add('channel');
      if (F.costStatus) used.add('costStatus');
      if (F.month || F.week) used.add('period');
      return used;
    }
    function nextDrillDim() {
      const used = drillUsed();
      return DRILL_SEQUENCE.find((d) => !used.has(d)) || '__jobs';
    }
    function startDrill(path, groupBy) {
      drill = { path, groupBy: groupBy || null, page: 1, search: '' };
      reportView = 'drill';
      drawReportsView();
    }

    async function drawDrill() {
      const used = drillUsed();
      if (!drill.groupBy || (used.has(drill.groupBy) && drill.groupBy !== '__jobs'))
        drill.groupBy = nextDrillDim();
      const filters = drillFilters();
      const crumbs =
        '<div class="rd-crumbs"><button type="button" class="rd-crumb" data-rd-crumb="-1">All data</button>' +
        Object.entries(F)
          .filter(([, v]) => v !== '')
          .map(
            ([k, v]) =>
              '<span class="rd-chip">' +
              escapeHtml(
                (RD_DIM_NAMES[k] || k) + ': ' + (k === 'month' ? RD_MONTHS_FULL[v - 1] : v),
              ) +
              '</span>',
          )
          .join('') +
        drill.path
          .map(
            (p, i) =>
              '<span class="rd-sep">&rsaquo;</span><button type="button" class="rd-crumb" data-rd-crumb="' +
              i +
              '">' +
              escapeHtml(
                (RD_DIM_NAMES[p.dim] || p.dim) +
                  ': ' +
                  (p.dim === 'exception' ? p.label || p.value : rdLabel(p.dim, p.value)),
              ) +
              '</button><button type="button" class="rd-crumb rd-crumb-x" data-rd-crumb-x="' +
              i +
              '" title="Remove this step" aria-label="Remove this step">&times;</button>',
          )
          .join('') +
        '</div>';
      const options = [
        '<option value="__jobs"' +
          (drill.groupBy === '__jobs' ? ' selected' : '') +
          '>Individual jobs</option>',
      ]
        .concat(
          DRILL_DIMENSIONS.filter((d) => !used.has(d)).map(
            (d) =>
              '<option value="' +
              d +
              '"' +
              (drill.groupBy === d ? ' selected' : '') +
              '>' +
              escapeHtml(RD_DIM_NAMES[d]) +
              '</option>',
          ),
        )
        .join('');
      const controls =
        '<div class="rd-pad rd-drill-controls"><label class="rd-search">Break down by<select data-rd-groupby>' +
        options +
        '</select></label><span class="rd-spacer"></span><button class="button" type="button" data-rd-view-export>Download this view (.xlsx)</button>' +
        tipHtml(
          'Downloads only what you see here: the filters and drill steps above, this breakdown and every job behind it, as a formatted Excel file for finance review. The Export report button at the top downloads the full report for the selection.',
        ) +
        '</div>';
      let content = '';
      let chartInit = null;
      if (drill.groupBy === '__jobs') {
        const lines = await rdApi('lines', {
          ...filters,
          search: drill.search,
          page: drill.page,
          pageSize: 50,
        });
        content =
          '<div class="rd-pad"><label class="rd-search">Search<input type="search" data-rd-drill-search value="' +
          escapeHtml(drill.search) +
          '" placeholder="Customer, invoice, order, salesperson, remarks" /></label></div>' +
          rdJobsTable(lines.lines || []) +
          rdPager(lines.pagination);
        content = rdSection(
          'Jobs &mdash; revenue AED ' + rdMoney(lines.revenue),
          content,
          rdMoney(lines.pagination.total) + ' jobs',
        );
      } else {
        const data = (await rdApi('group', { ...filters, dimension: drill.groupBy })).data;
        const timeDim =
          drill.groupBy === 'period' || drill.groupBy === 'yearWeek' || drill.groupBy === 'year';
        const rows = timeDim
          ? [...data.rows].sort((a, b) => a.key.localeCompare(b.key))
          : data.rows.slice(0, 15);
        content =
          rdSection(
            escapeHtml(RD_DIM_NAMES[drill.groupBy]) +
              ' &mdash; AED ' +
              rdMoney(data.totals.revenue),
            '<div class="rd-chart-pad"><div class="rd-chart-box' +
              (timeDim ? '' : ' tall') +
              '"><canvas id="rdc-drill"></canvas></div></div>',
          ) +
          rdSection(
            'Click a row to drill deeper',
            rdGroupTable({ rows: timeDim ? rows : data.rows, totals: data.totals }, drill.groupBy, {
              drill: true,
            }),
            rdMoney(data.rows.length) + ' rows',
          );
        chartInit = () =>
          timeDim
            ? rdDrawChart(body.querySelector('#rdc-drill'), {
                type: 'bar',
                data: {
                  labels: rows.map((r) => rdLabel(drill.groupBy, r.key)),
                  datasets: [
                    {
                      data: rows.map((r) => r.revenue),
                      backgroundColor: '#4E7FF2',
                      borderRadius: 4,
                      maxBarThickness: 46,
                    },
                  ],
                },
                options: {
                  responsive: true,
                  maintainAspectRatio: false,
                  resizeDelay: 200,
                  layout: { padding: { top: 24 } },
                  plugins: {
                    legend: { display: false },
                    rdValueLabels: { mode: 'each', prefix: 'AED ' },
                    tooltip: { callbacks: { label: (c) => ' AED ' + rdMoney(c.raw) } },
                  },
                  scales: {
                    x: { grid: { display: false } },
                    y: {
                      beginAtZero: true,
                      grace: '10%',
                      title: { display: true, text: 'Value (AED)' },
                      ticks: { callback: (v) => rdMoney(v) },
                    },
                  },
                },
              })
            : rdDrawChart(
                body.querySelector('#rdc-drill'),
                rdHBarConfig(
                  rows.map((r, i) => ({
                    key: r.key,
                    label: rdLabel(drill.groupBy, r.key),
                    value: r.revenue,
                    color: drill.groupBy === 'jobType' ? rdJtColor(r.key, i) : '#4E7FF2',
                  })),
                ),
              );
      }
      reportBody.innerHTML = rdSection('Where you are', crumbs + controls) + content;
      if (!hasPermission('revenue_dashboard.export'))
        reportBody.querySelector('[data-rd-view-export]').hidden = true;
      reportBody.querySelector('[data-rd-view-export]').addEventListener('click', async (e) => {
        const button = e.currentTarget;
        button.disabled = true;
        const original = button.textContent;
        button.textContent = 'Preparing workbook...';
        try {
          const steps = ['All data']
            .concat(
              Object.entries(F)
                .filter(([, v]) => v !== '')
                .map(
                  ([k, v]) =>
                    (RD_DIM_NAMES[k] || k) + ': ' + (k === 'month' ? RD_MONTHS_FULL[v - 1] : v),
                ),
            )
            .concat(
              drill.path.map(
                (p) =>
                  (RD_DIM_NAMES[p.dim] || p.dim) +
                  ': ' +
                  (p.dim === 'exception' ? p.label || p.value : rdLabel(p.dim, p.value)),
              ),
            );
          const viewFilters = { ...filters };
          if (drill.groupBy === '__jobs' && drill.search) viewFilters.search = drill.search;
          if (drill.groupBy === '__jobs' && drill.search) steps.push('Search: ' + drill.search);
          const blob = await apiBlobRequest(
            '/api/revenue-dashboard/export-view?' +
              rdQs({
                ...viewFilters,
                groupBy: drill.groupBy === '__jobs' ? 'jobs' : drill.groupBy,
                viewPath: steps.join(' > '),
              }),
          );
          const stamp = new Date().toISOString().slice(0, 10);
          const part = (drill.path[drill.path.length - 1] || {}).value;
          const slug = String(part || 'all-data')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 40);
          rdDownloadBlob(blob, 'service-revenue-view-' + slug + '-' + stamp + '.xlsx');
        } catch (error) {
          window.alert(error.message || 'The download failed.');
        } finally {
          button.disabled = false;
          button.textContent = original;
        }
      });
      reportBody.querySelectorAll('[data-rd-crumb]').forEach((button) => {
        button.addEventListener('click', () => {
          drill.path = drill.path.slice(0, Number(button.dataset.rdCrumb) + 1);
          drill.groupBy = null;
          drill.page = 1;
          drawReportsView();
        });
      });
      reportBody.querySelectorAll('[data-rd-crumb-x]').forEach((button) => {
        button.addEventListener('click', () => {
          drill.path = drill.path.slice(0, Number(button.dataset.rdCrumbX));
          drill.groupBy = null;
          drill.page = 1;
          drawReportsView();
        });
      });
      reportBody.querySelector('[data-rd-groupby]').addEventListener('change', (e) => {
        drill.groupBy = e.target.value;
        drill.page = 1;
        drawReportsView();
      });
      reportBody.querySelectorAll('[data-rd-drill]').forEach((row) => {
        const go = () => {
          drill.path.push({ dim: drill.groupBy, value: row.dataset.rdDrill });
          drill.groupBy = null;
          drill.page = 1;
          drawReportsView();
        };
        row.addEventListener('click', go);
        row.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') go();
        });
      });
      rdBindExpand(reportBody);
      const search = reportBody.querySelector('[data-rd-drill-search]');
      if (search) {
        let timer = null;
        search.addEventListener('input', () => {
          window.clearTimeout(timer);
          timer = window.setTimeout(() => {
            drill.search = search.value.trim();
            drill.page = 1;
            drawDrill().then(() => reportBody.querySelector('[data-rd-drill-search]')?.focus());
          }, 350);
        });
      }
      reportBody.querySelector('[data-rd-prev]')?.addEventListener('click', () => {
        drill.page -= 1;
        drawReportsView();
      });
      reportBody.querySelector('[data-rd-next]')?.addEventListener('click', () => {
        drill.page += 1;
        drawReportsView();
      });
      if (chartInit) await chartInit();
    }

    // Wire row clicks on a table to jump into the drill-down.
    function bindJump(host, dimension, groupBy) {
      host.querySelectorAll('[data-rd-drill]').forEach((row) => {
        const go = () => startDrill([{ dim: dimension, value: row.dataset.rdDrill }], groupBy);
        row.addEventListener('click', go);
        row.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') go();
        });
      });
    }

    async function drawMonthly() {
      const m = (
        await rdApi('matrix', {
          ...F,
          month: '',
          week: '',
          rowDimension: 'period',
          columnDimension: 'jobType',
        })
      ).data;
      reportBody.innerHTML =
        rdSection(
          'Monthly revenue by job type (value in AED)',
          '<div class="rd-chart-pad"><div class="rd-chart-box"><canvas id="rdc-r-monthly"></canvas></div></div>',
        ) +
        rdSection(
          'Monthly management report &mdash; revenue (AED) with change vs prior month',
          rdMatrixTable(m, 'period', 'revenue', { title: 'Month', change: true, drill: true }) +
            '<div class="card-help rd-pad"><span>About this view</span>' +
            tipHtml('Click a month to drill into its job types, customers and jobs.') +
            '</div>',
        );
      bindJump(reportBody, 'period', 'jobType');
      await rdDrawChart(
        reportBody.querySelector('#rdc-r-monthly'),
        rdStackedConfig(m, 'period', 'revenue', { labels: true }),
      );
    }

    async function drawWeekly() {
      const m = (
        await rdApi('matrix', {
          ...F,
          week: '',
          rowDimension: 'yearWeek',
          columnDimension: 'jobType',
        })
      ).data;
      reportBody.innerHTML =
        rdSection(
          'Weekly revenue by job type (AED per week)',
          '<div class="rd-chart-pad"><div class="rd-chart-box"><canvas id="rdc-r-weekly"></canvas></div></div>',
        ) +
        rdSection(
          'Weekly management report &mdash; revenue (AED) with change vs prior week',
          rdMatrixTable(m, 'yearWeek', 'revenue', { title: 'Week', change: true, drill: true }),
        );
      bindJump(reportBody, 'yearWeek', 'jobType');
      await rdDrawChart(
        reportBody.querySelector('#rdc-r-weekly'),
        rdStackedConfig(m, 'yearWeek', 'revenue', {
          borderRadius: 2,
          barPercentage: 0.9,
          maxTicks: 20,
        }),
      );
    }

    async function drawAccounts() {
      const m = (
        await rdApi('matrix', {
          ...F,
          month: '',
          week: '',
          rowDimension: 'period',
          columnDimension: 'jobType',
        })
      ).data;
      reportBody.innerHTML =
        rdSection(
          'Accounts Review &mdash; monthly units by job type',
          '<div class="rd-chart-pad"><div class="rd-chart-box short"><canvas id="rdc-r-acc"></canvas></div></div>',
        ) +
        rdSection(
          'Accounts Review &mdash; count of qty by month and job type',
          rdMatrixTable(m, 'period', 'qty', { title: 'Month', drill: true }) +
            '<div class="card-help rd-pad"><span>About this view</span>' +
            tipHtml(
              'Same layout as the workbook&rsquo;s Accounts Review pivot (Count of Qty), recalculated live from the uploaded data.',
            ) +
            '</div>',
        );
      bindJump(reportBody, 'period', 'jobType');
      await rdDrawChart(
        reportBody.querySelector('#rdc-r-acc'),
        rdStackedConfig(m, 'period', 'qty', { labels: true }),
      );
    }

    async function drawBilling() {
      const [billing, cost] = await Promise.all([
        rdApi('group', { ...F, dimension: 'billingCode' }),
        rdApi('group', { ...F, dimension: 'costStatus' }),
      ]);
      reportBody.innerHTML =
        rdSection(
          'Revenue by billing code (what accounts post against)',
          '<div class="rd-chart-pad"><div class="rd-chart-box tall"><canvas id="rdc-r-billing"></canvas></div></div>',
        ) +
        rdSection(
          'Billing code detail &mdash; click to drill',
          rdGroupTable(billing.data, 'billingCode', { drill: true, title: 'Billing code' }),
        ) +
        rdSection(
          'By cost status',
          rdGroupTable(cost.data, 'costStatus', { drill: true, title: 'Cost status' }),
        );
      const tables = reportBody.querySelectorAll('.rc-table');
      const dims = ['billingCode', 'costStatus'];
      tables.forEach((table, i) => bindJump(table, dims[i], 'period'));
      await rdDrawChart(
        reportBody.querySelector('#rdc-r-billing'),
        rdHBarConfig(
          billing.data.rows.slice(0, 12).map((r, i) => ({
            key: r.key,
            label: r.key,
            value: r.revenue,
            color: RD_FALLBACK_COLORS[i % RD_FALLBACK_COLORS.length],
          })),
        ),
      );
    }

    async function drawCustomers() {
      const data = (await rdApi('group', { ...F, dimension: 'customer' })).data;
      const rows = data.rows;
      const total = data.totals.revenue || 1;
      const share = (n) => rows.slice(0, n).reduce((s, r) => s + r.revenue, 0) / total;
      const top = rows.slice(0, 15);
      let running = 0;
      const cumulative = top.map((r) => ((running += r.revenue) / total) * 100);
      reportBody.innerHTML =
        rdKpis([
          ['Customers billed', rdMoney(rows.length), periodLabel()],
          [
            'Top customer share',
            rdPercent(rows[0] ? rows[0].revenue : 0, total),
            rows[0] ? rows[0].key : '',
          ],
          ['Top 5 share', (share(5) * 100).toFixed(1) + '%', 'Concentration of revenue'],
          ['Top 10 share', (share(10) * 100).toFixed(1) + '%', 'Concentration of revenue'],
        ]) +
        rdSection(
          'Customer concentration (Pareto: revenue and cumulative share)',
          '<div class="rd-chart-pad"><div class="rd-chart-box tall"><canvas id="rdc-r-pareto"></canvas></div></div>',
        ) +
        rdSection(
          'Top customers &mdash; click to drill',
          rdGroupTable({ rows: rows.slice(0, 50), totals: data.totals }, 'customer', {
            drill: true,
            title: 'Customer',
          }),
          'top 50 of ' + rdMoney(rows.length),
        );
      bindJump(reportBody, 'customer', 'period');
      await rdDrawChart(reportBody.querySelector('#rdc-r-pareto'), {
        type: 'bar',
        data: {
          labels: top.map((r) => (r.key.length > 22 ? r.key.slice(0, 21) + '…' : r.key)),
          datasets: [
            {
              type: 'line',
              label: 'Cumulative share %',
              data: cumulative,
              yAxisID: 'y1',
              borderColor: '#F2637E',
              backgroundColor: '#F2637E',
              tension: 0.25,
              pointRadius: 3,
            },
            {
              label: 'Revenue (AED)',
              data: top.map((r) => r.revenue),
              backgroundColor: '#4E7FF2',
              borderRadius: 4,
              yAxisID: 'y',
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          resizeDelay: 200,
          layout: { padding: { top: 24 } },
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 10 } },
            tooltip: {
              callbacks: {
                label: (c) =>
                  c.dataset.yAxisID === 'y1'
                    ? ' ' + c.raw.toFixed(1) + '% cumulative'
                    : ' AED ' + rdMoney(c.raw),
              },
            },
          },
          scales: {
            x: { grid: { display: false }, ticks: { maxRotation: 60, minRotation: 40 } },
            y: {
              beginAtZero: true,
              title: { display: true, text: 'Value (AED)' },
              ticks: { callback: (v) => rdMoney(v) },
            },
            y1: {
              position: 'right',
              min: 0,
              max: 100,
              grid: { drawOnChartArea: false },
              title: { display: true, text: 'Cumulative %' },
            },
          },
        },
      });
    }

    async function drawChannels() {
      const [channel, sales] = await Promise.all([
        rdApi('group', { ...F, dimension: 'channel' }),
        rdApi('group', { ...F, dimension: 'salesPerson' }),
      ]);
      reportBody.innerHTML =
        '<div class="rd-two-col">' +
        rdSection(
          'Revenue by sales channel',
          '<div class="rd-chart-box"><canvas id="rdc-r-channel"></canvas></div>',
        ) +
        rdSection(
          'Revenue by salesperson (top 10)',
          '<div class="rd-chart-box"><canvas id="rdc-r-sales"></canvas></div>',
        ) +
        '</div>' +
        rdSection(
          'Channel detail &mdash; click to drill',
          rdGroupTable(channel.data, 'channel', { drill: true, title: 'Sales channel' }),
        ) +
        rdSection(
          'Salesperson detail &mdash; click to drill',
          rdGroupTable(sales.data, 'salesPerson', { drill: true, title: 'Salesperson' }),
        );
      const tables = reportBody.querySelectorAll('.rc-table');
      bindJump(tables[0], 'channel', 'period');
      bindJump(tables[1], 'salesPerson', 'period');
      await rdDrawChart(
        reportBody.querySelector('#rdc-r-channel'),
        rdDonutConfig(
          channel.data.rows.map((r, i) => ({
            key: r.key,
            label: r.key,
            value: r.revenue,
            color: RD_FALLBACK_COLORS[i % RD_FALLBACK_COLORS.length],
          })),
        ),
      );
      await rdDrawChart(
        reportBody.querySelector('#rdc-r-sales'),
        rdHBarConfig(
          sales.data.rows
            .slice(0, 10)
            .map((r) => ({ key: r.key, label: r.key, value: r.revenue, color: '#9C8DF2' })),
        ),
      );
    }

    async function drawExceptions() {
      const data = (await rdApi('exceptions', F)).data;
      const rows = data.exceptions;
      reportBody.innerHTML =
        rdSection(
          'Finance &amp; data-quality checks',
          '<div class="card-help rd-pad"><span>About this view</span>' +
            tipHtml(
              'Jobs in the selected period that finance should review before the revenue is relied on. Click a check to see the individual jobs.',
            ) +
            '</div>' +
            '<div class="table-wrap"><table class="rc-table"><thead><tr><th>Check</th><th class="num">Jobs</th><th class="num">Revenue at stake (AED)</th><th class="num">% of revenue</th><th>What it means</th><th></th></tr></thead><tbody>' +
            rows
              .map(
                (r) =>
                  '<tr class="' +
                  (r.jobs ? 'is-drill' : '') +
                  '" data-rd-exc="' +
                  r.key +
                  '" data-rd-exc-label="' +
                  escapeHtml(r.label) +
                  '"><td>' +
                  (r.jobs
                    ? '<i class="rd-dot rd-dot-warn"></i>'
                    : '<i class="rd-dot rd-dot-ok"></i>') +
                  escapeHtml(r.label) +
                  '</td><td class="num">' +
                  rdMoney(r.jobs) +
                  '</td><td class="num">' +
                  rdMoney2(r.revenue) +
                  '</td><td class="num">' +
                  rdPercent(r.revenue, data.totals.revenue) +
                  '</td><td class="rd-meaning">' +
                  escapeHtml(r.description) +
                  '</td><td class="rd-drill-cue">' +
                  (r.jobs ? 'View jobs &rsaquo;' : 'Clear') +
                  '</td></tr>',
              )
              .join('') +
            '</tbody></table></div>',
        ) +
        '<div class="card-help rd-pad"><span>About this view</span>' +
        tipHtml(
          'A job can appear under several checks, so the rows overlap and should not be added together.',
        ) +
        '</div>';
      reportBody.querySelectorAll('[data-rd-exc]').forEach((row) => {
        if (!row.classList.contains('is-drill')) return;
        row.addEventListener('click', () =>
          startDrill(
            [{ dim: 'exception', value: row.dataset.rdExc, label: row.dataset.rdExcLabel }],
            '__jobs',
          ),
        );
      });
    }

    // Plain-language notes for management emails, from the same live "logic" data as
    // the Logic applied tab, so a zero-revenue or CSOSC item never reaches management
    // without its reason. Returns no zero-revenue note when the logic data is unavailable.
    async function emailLogicNotes() {
      let d = null;
      try {
        d = (await rdApi('logic')).data;
      } catch {
        d = null;
      }
      const notes = {
        unmatchedOrder:
          'The job\u2019s CSOSC order number is not in the workbook\u2019s CSOSC export (mostly older orders) or the job is Direct. The revenue is still counted; finance only confirms the order status.',
      };
      let basis = '';
      if (d && d.logicVersion === 3) {
        const z = d.zeroRevenue;
        const flat = 'AED ' + rdMoney(d.csidoFlat);
        notes.zeroRevenue =
          'Whole upload: ' +
          rdMoney(z.explainedLines) +
          ' of ' +
          rdMoney(z.lines) +
          ' zero-revenue jobs are extra delivery-only lines on invoices that already carry the one flat ' +
          flat +
          ' delivery charge, so they show AED 0 by design and no revenue is lost.' +
          (z.otherLines
            ? ' ' + rdMoney(z.otherLines) + ' show AED 0 for another reason and need review.'
            : '');
        basis =
          'Delivery + installation and installation-only lines are priced as quantity x net rate (base rate less volume discount, never below the minimum rate). Transport is added once per multi-unit installation invoice. Each delivery-only invoice carries one flat ' +
          flat +
          ' charge on its first line; its other lines show AED 0' +
          (d.csidoMixedRegional
            ? ' (on an invoice that also has a delivery + installation line, that charge is the regional transport rate instead)'
            : '') +
          '. Full rules: Service Revenue Dashboard > Logic applied.';
      }
      return { notes, basis };
    }

    async function managementSummary(sum) {
      const [byType, byChannel, byCustomer, byPeriod, exc, logicNotes] = await Promise.all([
        rdApi('group', { ...F, dimension: 'jobType' }),
        rdApi('group', { ...F, dimension: 'channel' }),
        rdApi('group', { ...F, dimension: 'customer' }),
        rdApi('group', { ...F, month: '', week: '', dimension: 'period' }),
        rdApi('exceptions', F),
        emailLogicNotes(),
      ]);
      const t = sum.summary.totals;
      const periods = [...byPeriod.data.rows].sort((a, b) => a.key.localeCompare(b.key));
      const last = periods[periods.length - 1];
      const prev = periods[periods.length - 2];
      const lines = [
        'SERVICE REVENUE - MANAGEMENT SUMMARY',
        'Period: ' + periodLabel(),
        'Source: ' +
          (sum.batch ? sum.batch.fileName : 'workbook') +
          ' (uploaded ' +
          formatDate(sum.batch.uploadedAt) +
          ')',
        '',
        'Revenue: AED ' +
          rdMoney(t.revenue) +
          ' | Jobs: ' +
          rdMoney(t.jobs) +
          ' | Units: ' +
          rdMoney(t.qty) +
          ' | Avg per job: AED ' +
          rdMoney(t.jobs ? t.revenue / t.jobs : 0),
      ];
      if (last && prev && prev.revenue) {
        const change = ((last.revenue - prev.revenue) / prev.revenue) * 100;
        lines.push(
          'Latest month (' +
            rdLabel('period', last.key) +
            '): AED ' +
            rdMoney(last.revenue) +
            ' (' +
            (change > 0 ? '+' : '') +
            change.toFixed(1) +
            '% vs ' +
            rdLabel('period', prev.key) +
            ')',
        );
      }
      lines.push('', 'By job type:');
      byType.data.rows.forEach((r) =>
        lines.push(
          '  - ' +
            rdLabel('jobType', r.key) +
            ': AED ' +
            rdMoney(r.revenue) +
            ' (' +
            rdPercent(r.revenue, t.revenue) +
            '), ' +
            rdMoney(r.jobs) +
            ' jobs',
        ),
      );
      lines.push('', 'By sales channel:');
      byChannel.data.rows.forEach((r) =>
        lines.push(
          '  - ' +
            r.key +
            ': AED ' +
            rdMoney(r.revenue) +
            ' (' +
            rdPercent(r.revenue, t.revenue) +
            ')',
        ),
      );
      lines.push('', 'Top 5 customers:');
      byCustomer.data.rows
        .slice(0, 5)
        .forEach((r, i) =>
          lines.push(
            '  ' +
              (i + 1) +
              '. ' +
              r.key +
              ': AED ' +
              rdMoney(r.revenue) +
              ' (' +
              rdPercent(r.revenue, t.revenue) +
              ')',
          ),
        );
      const open = exc.data.exceptions.filter((e) => e.jobs);
      lines.push('', 'Items for finance review:');
      if (open.length)
        open.forEach((e) => {
          lines.push(
            '  - ' + e.label + ': ' + rdMoney(e.jobs) + ' jobs, AED ' + rdMoney(e.revenue),
          );
          if (logicNotes.notes[e.key]) lines.push('      ' + logicNotes.notes[e.key]);
        });
      else lines.push('  - None');
      if (logicNotes.basis) lines.push('', 'How revenue is calculated:', '  ' + logicNotes.basis);
      lines.push(
        '',
        'Basis: figures are the Revenue calculated in the master Service Dashboard workbook; management analysis, not an ERP ledger extract.',
      );
      return lines.join('\n');
    }

    // ---- Formatted (HTML) management email --------------------------------
    // Email-safe markup: tables and inline styles only, because mail clients
    // ignore <style> blocks, flexbox and most modern CSS. Bars are table cells.
    async function managementEmailData(sum) {
      const [byType, byChannel, bySales, byPeriod, exc, logicNotes] = await Promise.all([
        rdApi('group', { ...F, dimension: 'jobType' }),
        rdApi('group', { ...F, dimension: 'channel' }),
        rdApi('group', { ...F, dimension: 'salesPerson' }),
        rdApi('group', { ...F, month: '', week: '', dimension: 'period' }),
        rdApi('exceptions', F),
        emailLogicNotes(),
      ]);
      const periods = [...byPeriod.data.rows].sort((a, b) => a.key.localeCompare(b.key));
      return {
        t: sum.summary.totals,
        byType: byType.data.rows,
        byChannel: byChannel.data.rows,
        salesPeople: bySales.data.rows,
        periods,
        open: exc.data.exceptions.filter((e) => e.jobs),
        notes: logicNotes.notes,
        basis: logicNotes.basis,
        source: sum.batch ? sum.batch.fileName : 'workbook',
        uploadedAt: sum.batch ? sum.batch.uploadedAt : null,
      };
    }

    function managementEmailHtml(d) {
      const NAVY = '#12305c';
      const INK = '#1f2933';
      const MUTED = '#667085';
      const LINE = '#e4e7ec';
      const GREEN = '#15803d';
      const RED = '#b42318';
      const font = "font-family:'Segoe UI',Calibri,Arial,Helvetica,sans-serif;";
      const e = escapeHtml;
      const total = d.t.revenue || 0;
      const last = d.periods[d.periods.length - 1];
      const prev = d.periods[d.periods.length - 2];
      const change =
        last && prev && prev.revenue ? ((last.revenue - prev.revenue) / prev.revenue) * 100 : null;

      const kpi = (label, value) =>
        '<td width="33%" valign="top" style="padding:0 4px;">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f8fc;border:1px solid ' +
        LINE +
        ';border-top:3px solid ' +
        NAVY +
        ';"><tr><td style="padding:12px 10px;' +
        font +
        '"><div style="font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:' +
        MUTED +
        ';">' +
        e(label) +
        '</div><div style="font-size:21px;font-weight:700;color:' +
        NAVY +
        ';padding-top:4px;">' +
        e(value) +
        '</div></td></tr></table></td>';

      // Each section gets its own coloured heading band; the data underneath is a plain table.
      const section = (title, color) =>
        '<tr><td style="padding:24px 28px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td bgcolor="' +
        color +
        '" style="background:' +
        color +
        ';padding:9px 14px;' +
        font +
        'font-size:13px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#ffffff;">' +
        e(title) +
        '</td></tr></table></td></tr>';

      const wrap = (inner) =>
        '<tr><td style="padding:4px 28px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="' +
        font +
        'font-size:13px;color:' +
        INK +
        ';">' +
        inner +
        '</table></td></tr>';

      const cell = (align, extra) =>
        'padding:8px 0 8px ' +
        (align === 'right' ? '12px' : '0') +
        ';border-bottom:1px solid ' +
        LINE +
        ';' +
        (extra || '');

      const shareTable = (rows, labelFor) =>
        wrap(
          '<tr><td style="' +
            cell(
              'left',
              'color:' + MUTED + ';font-size:11px;text-transform:uppercase;letter-spacing:.5px;',
            ) +
            '">&nbsp;</td><td align="right" style="' +
            cell(
              'right',
              'color:' + MUTED + ';font-size:11px;text-transform:uppercase;letter-spacing:.5px;',
            ) +
            '">Revenue</td><td align="right" style="' +
            cell(
              'right',
              'color:' + MUTED + ';font-size:11px;text-transform:uppercase;letter-spacing:.5px;',
            ) +
            '">Share</td></tr>' +
            rows
              .map(
                (r) =>
                  '<tr><td style="' +
                  cell('left') +
                  '">' +
                  e(labelFor(r)) +
                  '</td><td align="right" style="' +
                  cell('right', 'font-weight:600;') +
                  '">AED ' +
                  rdMoney(r.revenue) +
                  '</td><td align="right" width="70" style="' +
                  cell('right', 'color:' + MUTED + ';') +
                  '">' +
                  rdPercent(r.revenue, total) +
                  '</td></tr>',
              )
              .join(''),
        );

      const trend = d.periods.slice(-6);
      const trendRows = trend
        .map((p, i) => {
          const before = i > 0 ? trend[i - 1] : d.periods[d.periods.length - trend.length - 1];
          const delta =
            before && before.revenue ? ((p.revenue - before.revenue) / before.revenue) * 100 : null;
          return (
            '<tr><td style="' +
            cell('left') +
            '">' +
            e(rdLabel('period', p.key)) +
            '</td><td align="right" style="' +
            cell('right', 'font-weight:600;') +
            '">AED ' +
            rdMoney(p.revenue) +
            '</td><td align="right" width="90" style="' +
            cell(
              'right',
              'font-weight:600;color:' + (delta === null ? MUTED : delta >= 0 ? GREEN : RED) + ';',
            ) +
            '">' +
            (delta === null
              ? '&ndash;'
              : (delta >= 0 ? '&#9650; +' : '&#9660; ') + delta.toFixed(1) + '%') +
            '</td></tr>'
          );
        })
        .join('');

      const headlineNote =
        change === null
          ? ''
          : '<span style="color:' +
            (change >= 0 ? GREEN : RED) +
            ';font-weight:700;">' +
            (change >= 0 ? '&#9650; +' : '&#9660; ') +
            change.toFixed(1) +
            '%</span> ' +
            e(
              'in ' +
                rdLabel('period', last.key) +
                ' versus ' +
                rdLabel('period', prev.key) +
                ' (AED ' +
                rdMoney(last.revenue) +
                ' against AED ' +
                rdMoney(prev.revenue) +
                ').',
            );

      const reviewRows = d.open.length
        ? d.open
            .map(
              (x) =>
                '<tr><td style="' +
                cell('left') +
                '">' +
                e(x.label) +
                '</td><td align="right" style="' +
                cell('right', 'color:' + MUTED + ';') +
                '">' +
                rdMoney(x.jobs) +
                ' jobs</td><td align="right" style="' +
                cell('right', 'font-weight:600;') +
                '">AED ' +
                rdMoney(x.revenue) +
                '</td></tr>' +
                (d.notes && d.notes[x.key]
                  ? '<tr><td colspan="3" style="padding:0 0 8px;border-bottom:1px solid ' +
                    LINE +
                    ';font-size:12px;line-height:1.5;color:' +
                    MUTED +
                    ';">' +
                    e(d.notes[x.key]) +
                    '</td></tr>'
                  : ''),
            )
            .join('')
        : '<tr><td style="padding:8px 0;color:' + GREEN + ';">No open items &#10003;</td></tr>';

      return (
        '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Service revenue summary</title></head>' +
        '<body style="margin:0;padding:0;background:#eef1f5;">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f5;"><tr><td align="center" style="padding:24px 10px;">' +
        '<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#ffffff;border:1px solid ' +
        LINE +
        ';">' +
        '<tr><td bgcolor="' +
        NAVY +
        '" style="background:' +
        NAVY +
        ';padding:26px 28px;' +
        font +
        '"><div style="font-size:12px;letter-spacing:1.4px;text-transform:uppercase;color:#a9c2e6;">Jacky&#39;s Distribution &middot; After-Sales Service</div>' +
        '<div style="font-size:24px;font-weight:700;color:#ffffff;padding-top:6px;">Service Revenue Summary</div>' +
        '<div style="font-size:14px;color:#d6e3f5;padding-top:6px;">' +
        e(periodLabel()) +
        '</div></td></tr>' +
        '<tr><td style="padding:22px 28px 6px;' +
        font +
        'font-size:14px;line-height:1.55;color:' +
        INK +
        ';">Dear Management,<br><br>Please find below the service revenue summary for <strong>' +
        e(periodLabel()) +
        '</strong>.' +
        (headlineNote ? ' Latest month: ' + headlineNote : '') +
        '</td></tr>' +
        '<tr><td style="padding:14px 24px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
        kpi('Revenue', 'AED ' + rdMoney(d.t.revenue)) +
        kpi('Jobs', rdMoney(d.t.jobs)) +
        kpi('Units', rdMoney(d.t.qty)) +
        '</tr></table></td></tr>' +
        section('Revenue by job type', '#1d5fa8') +
        shareTable(d.byType, (r) => rdLabel('jobType', r.key)) +
        section('Revenue by sales channel', '#0e7490') +
        shareTable(d.byChannel, (r) => r.key) +
        section('Revenue by salesman', '#7c3aed') +
        shareTable(d.salesPeople, (r) => r.key || 'Not assigned') +
        (trend.length > 1
          ? section('Monthly trend (last ' + trend.length + ' months)', '#0f766e') +
            wrap(
              '<tr><td style="' +
                cell(
                  'left',
                  'color:' +
                    MUTED +
                    ';font-size:11px;text-transform:uppercase;letter-spacing:.5px;',
                ) +
                '">Month</td><td align="right" style="' +
                cell(
                  'right',
                  'color:' +
                    MUTED +
                    ';font-size:11px;text-transform:uppercase;letter-spacing:.5px;',
                ) +
                '">Revenue</td><td align="right" style="' +
                cell(
                  'right',
                  'color:' +
                    MUTED +
                    ';font-size:11px;text-transform:uppercase;letter-spacing:.5px;',
                ) +
                '">vs prior</td></tr>' +
                trendRows,
            )
          : '') +
        section('Items for finance review', '#b45309') +
        wrap(reviewRows) +
        (d.basis
          ? section('How revenue is calculated', '#475467') +
            '<tr><td style="padding:10px 28px 0;' +
            font +
            'font-size:13px;line-height:1.55;color:' +
            INK +
            ';">' +
            e(d.basis) +
            '</td></tr>'
          : '') +
        '<tr><td style="padding:26px 28px 24px;' +
        font +
        'font-size:13px;line-height:1.55;color:' +
        INK +
        ';">Kind regards,<br><strong>Jacky&#39;s Distribution &mdash; After-Sales Service</strong></td></tr>' +
        '<tr><td bgcolor="#f5f8fc" style="background:#f5f8fc;border-top:1px solid ' +
        LINE +
        ';padding:14px 28px;' +
        font +
        'font-size:11px;line-height:1.5;color:' +
        MUTED +
        ';">Basis: figures are the Revenue calculated in the master Service Dashboard workbook (' +
        e(d.source) +
        (d.uploadedAt ? ', uploaded ' + e(formatDate(d.uploadedAt)) : '') +
        '); management analysis, not an ERP ledger extract. Generated from the Service Portal on ' +
        e(formatDate(new Date().toISOString())) +
        '.</td></tr>' +
        '</table></td></tr></table></body></html>'
      );
    }

    function emailDownload(content, fileName, type) {
      rdDownloadBlob(new Blob([content], { type }), fileName);
    }

    // An .eml with X-Unsent opens in Outlook as an editable draft with the
    // formatting intact; the user adds recipients and presses Send.
    function buildEml(subject, html, text) {
      const b64 = (value) => {
        const bytes = new TextEncoder().encode(value);
        let binary = '';
        bytes.forEach((byte) => {
          binary += String.fromCharCode(byte);
        });
        return btoa(binary).replace(/(.{76})/g, '$1\r\n');
      };
      const boundary = '=_jd_' + Date.now().toString(36);
      return [
        'X-Unsent: 1',
        'Subject: ' + subject,
        'MIME-Version: 1.0',
        'Content-Type: multipart/alternative; boundary="' + boundary + '"',
        '',
        '--' + boundary,
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        b64(text),
        '--' + boundary,
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        b64(html),
        '--' + boundary + '--',
        '',
      ].join('\r\n');
    }

    let reportBody = null;
    let currentSum = null;
    async function drawReportsView() {
      if (!reportBody) return;
      try {
        rdDestroyCharts(reportBody);
        reportBody.innerHTML = '<p class="form-note rd-pad">Loading&hellip;</p>';
        const views = {
          drill: drawDrill,
          monthly: drawMonthly,
          weekly: drawWeekly,
          accounts: drawAccounts,
          billing: drawBilling,
          customers: drawCustomers,
          channels: drawChannels,
          exceptions: drawExceptions,
        };
        await views[reportView]();
        rdLogActivity('viewed', 'reports:' + reportView, periodLabel());
      } catch (error) {
        reportBody.innerHTML =
          '<p class="form-note rd-pad">' +
          escapeHtml(error.message || 'Could not load this report.') +
          '</p>';
      }
      body
        .querySelectorAll('[data-rd-view]')
        .forEach((b) => b.classList.toggle('active', b.dataset.rdView === reportView));
    }

    async function drawReports(sum) {
      currentSum = sum;
      const t = sum.summary.totals;
      const periodRows = (await rdApi('group', { ...F, month: '', week: '', dimension: 'period' }))
        .data.rows;
      const monthlyAvg = periodRows.length
        ? periodRows.reduce((s, r) => s + r.revenue, 0) / periodRows.length
        : 0;
      const VIEWS = [
        ['drill', 'Drill-down'],
        ['monthly', 'Monthly report'],
        ['weekly', 'Weekly report'],
        ['accounts', 'Accounts Review'],
        ['billing', 'Billing & cost'],
        ['customers', 'Customers'],
        ['channels', 'Channel & sales'],
        ['exceptions', 'Exceptions'],
      ];
      body.innerHTML =
        rdKpis([
          ['Filtered jobs', rdMoney(t.jobs), periodLabel()],
          ['Total quantity', rdMoney(t.qty), 'Units across filtered rows'],
          ['Total revenue', 'AED ' + rdMoney(t.revenue), 'Revenue across filtered rows'],
          ['Monthly average', 'AED ' + rdMoney(monthlyAvg), 'Per month with data in the period'],
        ]) +
        '<div class="rc-section"><div class="rd-report-actions">' +
        '<div class="rd-view-pills">' +
        VIEWS.map(
          ([id, name]) =>
            '<button type="button" class="rd-mpill' +
            (id === reportView ? ' active' : '') +
            '" data-rd-view="' +
            id +
            '">' +
            name +
            '</button>',
        ).join('') +
        '</div>' +
        '<span class="rd-spacer"></span><button class="button" type="button" data-rd-export>Export report (.xlsx)</button><button class="button button-outline" type="button" data-rd-summary>Management summary</button><button class="button button-outline" type="button" data-rd-email>Email draft</button><button class="button button-outline" type="button" data-rd-html-email>Formatted email</button>' +
        (hasPermission('tasks.use')
          ? '<button class="tk-pill tk-pill-accent" type="button" data-rd-send-roi title="Build this week\u2019s ROI (Results, Management Summary, Objectives, Issues) as an email draft">Send ROI</button>'
          : '') +
        '</div>' +
        '<div data-rd-html-box hidden class="rd-pad"><div class="rd-report-actions"><button class="button" type="button" data-rd-html-copy>Copy formatted email</button><button class="button button-outline" type="button" data-rd-html-eml>Download as email draft (.eml)</button><button class="button button-outline" type="button" data-rd-html-file>Download .html</button><span class="form-note" data-rd-html-msg>Paste into Outlook or Gmail, or open the .eml file; add recipients and send yourself. Nothing is sent from the portal.</span></div><iframe data-rd-html-frame title="Formatted email preview" style="width:100%;height:760px;border:1px solid #d7dbe0;background:#eef1f5;margin-top:10px;"></iframe></div>' +
        '<div data-rd-summary-box hidden class="rd-pad"><textarea class="rd-summary-text" readonly rows="14"></textarea><div class="rd-report-actions"><button class="button button-outline" type="button" data-rd-copy>Copy text</button><span class="form-note" data-rd-copy-msg>Plain-text summary for email &mdash; nothing is sent.</span></div></div></div>' +
        '<div data-rd-report-body></div>';
      reportBody = body.querySelector('[data-rd-report-body]');
      body.querySelectorAll('[data-rd-view]').forEach((button) => {
        button.addEventListener('click', () => {
          reportView = button.dataset.rdView;
          drawReportsView();
        });
      });
      if (!hasPermission('revenue_dashboard.export'))
        body.querySelector('[data-rd-export]').hidden = true;
      body.querySelector('[data-rd-export]').addEventListener('click', async (e) => {
        const button = e.currentTarget;
        button.disabled = true;
        const original = button.textContent;
        button.textContent = 'Preparing workbook...';
        try {
          const blob = await apiBlobRequest(
            '/api/revenue-dashboard/export?' + rdQs(reportView === 'drill' ? drillFilters() : F),
          );
          rdDownloadBlob(blob, 'service-revenue-report.xlsx');
        } catch (error) {
          window.alert(error.message || 'The export failed.');
        } finally {
          button.disabled = false;
          button.textContent = original;
        }
      });
      body.querySelector('[data-rd-summary]').addEventListener('click', async () => {
        const box = body.querySelector('[data-rd-summary-box]');
        box.hidden = false;
        const area = box.querySelector('textarea');
        area.value = 'Preparing summary...';
        try {
          area.value = await managementSummary(sum);
        } catch (error) {
          area.value = error.message || 'Could not build the summary.';
        }
      });
      // Email draft: opens the user's own mail app with the summary filled in;
      // nothing is sent. Mail clients cap mailto: links at roughly 2,000
      // characters, so a longer summary is trimmed in the draft and the full
      // text is copied to the clipboard to paste underneath.
      body.querySelector('[data-rd-email]').addEventListener('click', async (e) => {
        const button = e.currentTarget;
        const box = body.querySelector('[data-rd-summary-box]');
        const area = box.querySelector('textarea');
        const msg = body.querySelector('[data-rd-copy-msg]');
        box.hidden = false;
        button.disabled = true;
        try {
          const text = await managementSummary(sum);
          area.value = text;
          const subject = 'Service revenue summary - ' + periodLabel();
          const limit = 1500;
          const trimmed = text.length > limit;
          const draftBody = trimmed
            ? text.slice(0, text.lastIndexOf('\n', limit)) +
              '\n\n[Summary shortened - the full text is in the Management summary box; paste it here.]'
            : text;
          if (trimmed) {
            try {
              await navigator.clipboard.writeText(text);
            } catch {
              /* the full text stays visible in the box */
            }
          }
          rdLogActivity('email_drafted', tab, periodLabel());
          window.location.href =
            'mailto:?subject=' +
            encodeURIComponent(subject) +
            '&body=' +
            encodeURIComponent(draftBody);
          msg.textContent = trimmed
            ? 'Draft opened with a shortened summary; the full text was copied to your clipboard.'
            : 'Draft opened in your mail app. Nothing is sent until you press Send.';
        } catch (error) {
          msg.textContent = error.message || 'Could not build the email draft.';
        } finally {
          button.disabled = false;
        }
      });
      // Formatted email: a styled HTML version for management, previewed here.
      let emailBuilt = null;
      body.querySelector('[data-rd-html-email]').addEventListener('click', async (e) => {
        const button = e.currentTarget;
        const box = body.querySelector('[data-rd-html-box]');
        const msg = body.querySelector('[data-rd-html-msg]');
        button.disabled = true;
        try {
          const data = await managementEmailData(sum);
          const html = managementEmailHtml(data);
          const text = await managementSummary(sum);
          emailBuilt = { html, text, subject: 'Service revenue summary - ' + periodLabel() };
          box.hidden = false;
          body.querySelector('[data-rd-html-frame]').srcdoc = html;
          box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          rdLogActivity('email_drafted', 'html-email', periodLabel());
        } catch (error) {
          box.hidden = false;
          msg.textContent = error.message || 'Could not build the formatted email.';
        } finally {
          button.disabled = false;
        }
      });
      body.querySelector('[data-rd-html-copy]').addEventListener('click', async () => {
        const msg = body.querySelector('[data-rd-html-msg]');
        if (!emailBuilt) return;
        try {
          await navigator.clipboard.write([
            new ClipboardItem({
              'text/html': new Blob([emailBuilt.html], { type: 'text/html' }),
              'text/plain': new Blob([emailBuilt.text], { type: 'text/plain' }),
            }),
          ]);
          msg.textContent = 'Copied with formatting. Paste it into a new email (Ctrl+V).';
        } catch {
          msg.textContent =
            'This browser blocked copying. Download the .eml draft or the .html file instead.';
        }
      });
      body.querySelector('[data-rd-html-eml]').addEventListener('click', () => {
        if (!emailBuilt) return;
        emailDownload(
          buildEml(emailBuilt.subject, emailBuilt.html, emailBuilt.text),
          'service-revenue-summary.eml',
          'message/rfc822',
        );
      });
      body.querySelector('[data-rd-html-file]').addEventListener('click', () => {
        if (!emailBuilt) return;
        emailDownload(emailBuilt.html, 'service-revenue-summary.html', 'text/html');
      });
      body.querySelector('[data-rd-send-roi]')?.addEventListener('click', () => {
        getTasksUi().openComposer({ source: 'revenue' });
      });
      body.querySelector('[data-rd-copy]').addEventListener('click', async () => {
        const area = body.querySelector('[data-rd-summary-box] textarea');
        const msg = body.querySelector('[data-rd-copy-msg]');
        try {
          await navigator.clipboard.writeText(area.value);
          rdLogActivity('summary_copied', tab, periodLabel());
          msg.textContent = 'Copied.';
        } catch {
          area.select();
          msg.textContent = 'Press Ctrl+C to copy the selected text.';
        }
      });
      await drawReportsView();
    }

    // -------------------------------------------------------------------- main
    // ------------------------------------------------------------ Logic applied
    // Plain-language rules, live figures and a worked example for management.
    async function drawLogic(sum) {
      barEl.innerHTML = '';
      const res = await rdApi('logic');
      const d = res.data;
      if (!d) {
        body.innerHTML = '<p class="form-note">Upload the master workbook to see the logic.</p>';
        return;
      }
      const v3 = d.logicVersion === 3;
      const aed = (n) => 'AED ' + rdMoney2(n).replace(/\.00$/, '');
      const e = escapeHtml;
      const M = d.master;
      const steps = [
        [
          'Read the ERP line',
          'Each delivery and installation line comes from the ERP net-sale report: invoice, product, category and city. Repairs come from the job-sheet lists.',
        ],
        [
          'Decide the job type',
          'Repairs are CSIJW or CSIJO. Fridge, washer or cooker delivered and installed is CSIDI; installed only is CSIII; every other delivery is CSIDO.',
        ],
        [
          'Price the line',
          'Quantity × the rate in the rate cards below. Bigger invoices earn a volume discount; a minimum rate protects the floor.',
        ],
        [
          'Add once-per-invoice charges',
          'Transport on multi-unit installs and the flat delivery charge are added once for the whole invoice, never once per line.',
        ],
      ];

      const z = d.zeroRevenue;
      const example = d.example;
      const maxMonth = Math.max(1, ...z.byMonth.map((m) => m.lines));
      const period = (p) => {
        const [y, m] = String(p).split('-');
        return RD_MONTHS_FULL[Number(m) - 1]
          ? RD_MONTHS_FULL[Number(m) - 1].slice(0, 3) + ' ' + y
          : p;
      };

      const table = (heads, rows, right) =>
        '<div class="table-wrap"><table class="rc-table"><thead><tr>' +
        heads
          .map(
            (h, i) =>
              '<th' + (right && right.includes(i) ? ' class="num"' : '') + '>' + e(h) + '</th>',
          )
          .join('') +
        '</tr></thead><tbody>' +
        rows
          .map(
            (r) =>
              '<tr' +
              (r.cls ? ' class="' + r.cls + '"' : '') +
              '>' +
              r.cells
                .map(
                  (c, i) =>
                    '<td' + (right && right.includes(i) ? ' class="num"' : '') + '>' + c + '</td>',
                )
                .join('') +
              '</tr>',
          )
          .join('') +
        '</tbody></table></div>';

      const exampleTable = (ex) =>
        '<div class="rl-example"><div class="rl-example-head"><b>Invoice ' +
        e(ex.invoice) +
        '</b>' +
        refDocPill(ex.refDocNo) +
        custCodePill(ex.custCode) +
        '<span>' +
        e((ex.customer || '') + (ex.date ? ' · ' + ex.date : '')) +
        '</span></div>' +
        table(
          ['Type', 'Item', 'Qty', 'How it is priced', 'Revenue (AED)'],
          ex.lines
            .map((l) => ({
              cls: l.revenue === 0 ? 'rl-row-zero' : '',
              cells: [
                '<span class="rl-code sm" style="--rl-accent:' +
                  rdJtColor(l.jobType, 0) +
                  '">' +
                  e(l.jobType) +
                  '</span>',
                e(l.item),
                rdMoney(l.qty),
                e(l.how) + (l.check ? '<div class="rl-check">' + e(l.check) + '</div>' : ''),
                '<b>' + rdMoney2(l.revenue) + '</b>',
              ],
            }))
            .concat([
              {
                cls: 'rl-row-total',
                cells: ['', '<b>Invoice total</b>', '', '', '<b>' + rdMoney2(ex.total) + '</b>'],
              },
            ]),
          [2, 4],
        ) +
        (ex.notes && ex.notes.length
          ? '<ul class="rl-notes">' +
            ex.notes.map((n) => '<li>' + e(n) + '</li>').join('') +
            '</ul>'
          : '') +
        '</div>';
      const liveOpts = (sum && sum.summary && sum.summary.options) || {};
      const liveSel = (name, label, values, labelFor) =>
        '<div class="th-field"><label>' +
        label +
        '<select data-rl-f="' +
        name +
        '"><option value="">All</option>' +
        (values || [])
          .map(
            (v) =>
              '<option value="' +
              e(String(v)) +
              '">' +
              e(labelFor ? labelFor(v) : String(v)) +
              '</option>',
          )
          .join('') +
        '</select></label></div>';
      const exampleHtml = rdSection(
        'Worked example &mdash; pick any invoice',
        '<div class="rd-pad rl-live"><p class="rl-live-note">Pick a period and job type, choose an invoice, and see how each line was priced &mdash; or paste invoice numbers. Amounts are workbook figures; a note shows where the current rules differ.</p>' +
          '<div class="rl-live-bar">' +
          liveSel('year', 'Year', liveOpts.years) +
          liveSel('month', 'Month', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], (v) =>
            RD_MONTHS_FULL[v - 1].slice(0, 3),
          ) +
          liveSel('week', 'Week', liveOpts.weeks, (v) => 'Wk ' + v) +
          liveSel('jobType', 'Job type', liveOpts.jobTypes) +
          '<div class="th-field rl-grow"><label>Search<input type="search" data-rl-f="search" placeholder="Customer or invoice no." /></label></div>' +
          '</div><div class="rl-live-bar">' +
          '<div class="th-field rl-grow rl-wide"><label>Invoice<select data-rl-pick><option value="">Loading&hellip;</option></select></label></div>' +
          '<div class="th-field rl-grow"><label for="rlPaste">Or paste invoice number(s)</label><span class="rl-paste-row"><input id="rlPaste" type="text" data-rl-paste placeholder="e.g. 16101083, 16101084" autocomplete="off" /><button type="button" class="button button-primary" data-rl-load>Load</button></span></div>' +
          '</div>' +
          '<p class="form-note rl-live-msg" data-rl-msg></p></div>' +
          '<div data-rl-out class="rl-out">' +
          (example ? exampleTable(example) : '') +
          '</div>',
        'Any job type',
      );

      // The explanation sits in an info tooltip on the section title; the card itself keeps
      // only the button and the by-month bars (modification #133).
      const zeroExplain =
        (v3
          ? 'A delivery-only invoice often has one line for each product delivered. The customer is charged <b>one delivery fee for the invoice</b>, not one per product. So the first delivery-only line carries the flat ' +
            aed(d.csidoFlat) +
            ' and the other lines of that invoice show AED 0. They are not missed revenue.'
          : 'Some lines show AED 0 because of how the workbook prices them (for example zero-cost RWR repairs).') +
        '<br><br><b>' +
        rdMoney(z.lines) +
        '</b> of the ' +
        rdMoney(d.totals.lines) +
        ' jobs show AED 0. ' +
        (v3
          ? '<b>' +
            rdMoney(z.explainedLines) +
            '</b> of them are these extra delivery lines, on ' +
            rdMoney(z.invoices) +
            ' invoices; every one of those invoices has exactly one paid delivery line. ' +
            (z.otherLines
              ? '<b>' +
                rdMoney(z.otherLines) +
                '</b> show AED 0 for another reason and need a look.'
              : 'No job shows AED 0 for any other reason.')
          : '');
      const zeroTitle =
        'Why some jobs show AED 0 ' +
        tipHtml(zeroExplain, '', 'style="max-width:380px;width:380px"').replace(
          'class="tooltip"',
          'class="tooltip tooltip-below"',
        );
      const zeroHtml =
        '<div class="rl-zero"><div class="rl-zero-text">' +
        (v3 && z.otherLines
          ? '<p class="rl-zero-warn"><b>' +
            rdMoney(z.otherLines) +
            '</b> jobs show AED 0 for a reason other than extra delivery lines.</p>'
          : '') +
        '<button type="button" class="button button-outline" data-rl-zero-jobs>See the zero-revenue jobs</button></div>' +
        '<div class="rl-zero-bars"><div class="rl-bars-title">Zero-revenue jobs by month</div>' +
        z.byMonth
          .map(
            (m) =>
              '<div class="rl-bar-row"><span>' +
              e(period(m.period)) +
              '</span><div class="rl-bar"><i style="width:' +
              Math.round((m.lines / maxMonth) * 100) +
              '%"></i></div><b>' +
              rdMoney(m.lines) +
              '</b></div>',
          )
          .join('') +
        '</div></div>';

      const di = M.deliveryInstall;
      const ratesHtml =
        '<div class="rd-two-col">' +
        rdSection(
          'Job-type rates',
          table(
            ['Job type', 'Meaning', 'AED incl. VAT'],
            M.jobRates.map((r) => ({
              cells: [e(r.label), e(r.description), rdMoney2(r.price)],
            })),
            [2],
          ),
          'AED per job, incl. VAT ' +
            tipHtml(
              'All prices include VAT. Delivery + installation, installation-only and the flat charges are gross amounts (VAT output / input is handled by Accounts outside this calculation). Rates are read from Pricing Masters &rsaquo; D+I Admin Entry.',
            ),
        ) +
        rdSection(
          'Volume discount',
          table(
            ['Units on the invoice', 'Delivery + installation', 'Installation only'],
            di.discounts.map((x, i) => ({
              cells: [
                e(x.tier),
                Math.round(x.discount * 1000) / 10 + '%',
                Math.round(((M.install.discounts[i] || x).discount || 0) * 1000) / 10 + '%',
              ],
            })),
            [1, 2],
          ),
        ) +
        '</div><div class="rd-two-col">' +
        rdSection(
          'Delivery + installation rate card (CSIDI)',
          table(
            ['Category', 'Batch rate', 'Standard rate', 'Minimum'],
            di.categories.map((c) => ({
              cells: [
                e(c.category),
                rdMoney2(c.batchRate),
                rdMoney2(c.standardRate),
                rdMoney2(c.minimumRate),
              ],
            })),
            [1, 2, 3],
          ),
          'AED per unit, incl. VAT',
        ) +
        rdSection(
          'Installation-only rate card (CSIII)',
          table(
            ['Category', 'Batch rate', 'Standard rate', 'Minimum'],
            M.install.categories.map((c) => ({
              cells: [
                e(c.category),
                rdMoney2(c.batchRate),
                rdMoney2(c.standardRate),
                rdMoney2(c.minimumRate),
              ],
            })),
            [1, 2, 3],
          ),
          'AED per unit, incl. VAT',
        ) +
        '</div>' +
        (v3
          ? rdSection(
              'Once-per-invoice charges',
              table(
                ['Charge', 'Applies to', 'AED incl. VAT'],
                M.transport
                  .map((t) => ({
                    cells: [
                      'Transport &mdash; ' + e(t.region),
                      'CSIDI invoices with more than 1 unit and no delivery-only line',
                      rdMoney2(t.roundTrip),
                    ],
                  }))
                  .concat([
                    {
                      cells: [
                        'Flat delivery charge',
                        'CSIDO &mdash; once per invoice, on the first delivery-only line',
                        rdMoney2(d.csidoFlat),
                      ],
                    },
                  ]),
                [2],
              ),
              'Sharjah = city containing SHJ or SHARJAH; otherwise Dubai',
            )
          : '');

      const rec = d.reconciliation;
      const causeText = {
        'CSIDO flat charge':
          'Delivery-only invoices whose first line still shows an older amount than the current rule (the flat charge, or the regional transport rate when the invoice also has a delivery + installation line).',
        'CSIDI transport':
          'Multi-unit installs with no delivery-only line where the transport charge is missing in the workbook.',
        'Rate or quantity': 'A locked row kept at an older rate or quantity.',
      };
      const recHtml = v3
        ? rdSection(
            'How the workbook compares with these rules',
            '<div class="rd-pad"><p class="rl-p">The portal shows the revenue calculated in the workbook. To check it, every delivery and installation line (' +
              rdMoney(rec.matchedLines) +
              ' lines) was re-priced with the rules above. ' +
              (rec.differingLines
                ? '<b>' +
                  rdMoney(rec.differingLines) +
                  '</b> lines differ, by <b>' +
                  aed(rec.differenceAmount) +
                  '</b> in total (workbook minus rules). The workbook keeps earlier rows as locked history and does not recalculate them when a rate changes.'
                : 'All lines agree with the rules.') +
              '</p>' +
              (rec.causes.length
                ? table(
                    ['What differs', 'Lines', 'Workbook minus rules (AED)', 'In plain words'],
                    rec.causes.map((c) => ({
                      cells: [
                        e(c.cause),
                        rdMoney(c.lines),
                        rdMoney2(c.amount),
                        e(causeText[c.cause] || ''),
                      ],
                    })),
                    [1, 2],
                  )
                : '') +
              '</div>',
          )
        : '';

      body.innerHTML =
        '<div class="rl-hero"><div><h2>How revenue is calculated</h2><p>Every revenue figure in this dashboard is the amount calculated in the master workbook. This page explains the rules behind it in plain language, with live figures from the data you uploaded.</p></div><div class="rl-hero-meta"><span class="rl-chip">' +
        (v3 ? 'Invoice-level rules' : 'Earlier per-line rules') +
        '</span><span class="rl-chip muted">' +
        e(d.batch.fileName) +
        '</span><span class="rl-chip muted">Uploaded ' +
        e(
          new Date(d.batch.uploadedAt).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          }),
        ) +
        '</span></div></div>' +
        rdKpis([
          ['Revenue', aed(d.totals.revenue), 'Whole upload'],
          ['Jobs', rdMoney(d.totals.lines), 'Every revenue line'],
          ['Invoices', rdMoney(d.totals.invoices), 'Distinct invoice numbers'],
          [
            'Jobs showing AED 0',
            rdMoney(z.lines),
            v3 ? rdMoney(z.explainedLines) + ' are covered by a flat charge' : 'See below',
          ],
        ]) +
        (v3
          ? '<div class="rl-flow">' +
            steps
              .map(
                (s, i) =>
                  '<div class="rl-step"><span class="rl-step-n">' +
                  (i + 1) +
                  '</span><b>' +
                  e(s[0]) +
                  '</b><p>' +
                  e(s[1]) +
                  '</p></div>',
              )
              .join('') +
            '</div>'
          : '<p class="form-note">This workbook uses the earlier per-line rules. The rates below are read from it; the Revenue Logic sheet of the Excel export lists the detail.</p>') +
        rdSection(zeroTitle, zeroHtml) +
        exampleHtml +
        ratesHtml +
        recHtml +
        '<p class="form-note rl-foot">Revenue everywhere in the portal is the workbook figure, not an ERP posting. Rates, tiers and charges on this page are read from the workbook’s pricing sheets, so they change when a new workbook is uploaded.</p>';

      // ---- Worked example: filters -> invoice picker -> calculation; or paste.
      const liveRoot = body.querySelector('[data-rl-out]');
      const liveMsg = body.querySelector('[data-rl-msg]');
      const pick = body.querySelector('[data-rl-pick]');
      const pasteInput = body.querySelector('[data-rl-paste]');
      const lf = { year: '', month: '', week: '', jobType: '', search: '' };
      let liveSeq = 0;
      const showExamples = (res) => {
        liveRoot.innerHTML = res.examples.map(exampleTable).join('');
        liveMsg.textContent = res.notFound.length
          ? 'Not found in the active upload: ' + res.notFound.join(', ')
          : '';
        if (!res.examples.length && !res.notFound.length) liveRoot.innerHTML = '';
      };
      // After a paste, make the Invoice box show what was loaded instead of the
      // first invoice of the list: select the invoice if it is listed, otherwise
      // add it (or the pasted set) at the top.
      const showPastedInPicker = (res) => {
        const found = (res.examples || []).map((x) => x.invoice);
        pick.querySelectorAll('option[data-pasted]').forEach((o) => o.remove());
        if (!found.length) return;
        if (found.length === 1) {
          const listed = Array.from(pick.options).find((o) => o.value === found[0]);
          if (listed) {
            pick.value = found[0];
            return;
          }
        }
        const ex = res.examples[0];
        const option = document.createElement('option');
        option.dataset.pasted = '1';
        option.value = found.length === 1 ? found[0] : '';
        option.textContent =
          found.length === 1
            ? found[0] +
              ' · ' +
              (ex.customer || 'No customer') +
              ' · ' +
              (ex.date || '') +
              ' · pasted'
            : 'Pasted: ' + found.join(', ');
        pick.insertBefore(option, pick.firstChild);
        pick.value = option.value;
        option.selected = true;
      };
      const loadExample = async (invoices, pasted) => {
        const seq = ++liveSeq;
        liveMsg.textContent = 'Loading…';
        try {
          const res = await rdApi('logic/example', { invoices });
          if (seq === liveSeq) {
            showExamples(res);
            if (pasted) showPastedInPicker(res);
            if (res.examples.length) liveMsg.textContent = liveMsg.textContent || '';
          }
        } catch (error) {
          if (seq === liveSeq) liveMsg.textContent = error.message || 'Could not load the invoice.';
        }
      };
      const loadPicker = async () => {
        pick.innerHTML = '<option value="">Loading…</option>';
        try {
          const res = await rdApi('logic/invoices', lf);
          const list = res.invoices || [];
          pick.innerHTML = list.length
            ? list
                .map(
                  (i) =>
                    '<option value="' +
                    e(i.invoice) +
                    '">' +
                    e(
                      i.invoice +
                        ' · ' +
                        (i.customer || 'No customer') +
                        ' · ' +
                        (i.date || '') +
                        ' · ' +
                        i.jobTypes.join('/') +
                        ' · AED ' +
                        rdMoney2(i.revenue),
                    ) +
                    '</option>',
                )
                .join('')
            : '<option value="">No invoices match</option>';
          liveMsg.textContent = list.length
            ? rdMoney(list.length) + (list.length >= 300 ? '+' : '') + ' invoices match.'
            : '';
          if (list.length) await loadExample(list[0].invoice);
          else liveRoot.innerHTML = '';
        } catch (error) {
          pick.innerHTML = '<option value="">—</option>';
          liveMsg.textContent = error.message || 'Could not load invoices.';
        }
      };
      body.querySelectorAll('[data-rl-f]').forEach((control) => {
        const name = control.dataset.rlF;
        let timer;
        const apply = () => {
          lf[name] = control.value.trim();
          if (name === 'year') {
            lf.month = '';
            lf.week = '';
          }
          loadPicker();
        };
        if (control.tagName === 'INPUT')
          control.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(apply, 350);
          });
        else control.addEventListener('change', apply);
      });
      pick.addEventListener('change', () => pick.value && loadExample(pick.value));
      const loadPasted = () => {
        const text = pasteInput.value.trim();
        if (text) loadExample(text, true);
      };
      body.querySelector('[data-rl-load]').addEventListener('click', loadPasted);
      pasteInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') loadPasted();
      });
      loadPicker();

      const zeroButton = body.querySelector('[data-rl-zero-jobs]');
      if (zeroButton)
        zeroButton.addEventListener('click', () => {
          drill = {
            path: [{ dim: 'exception', value: 'zeroRevenue', label: 'Zero-revenue jobs' }],
            groupBy: '__jobs',
            page: 1,
            search: '',
          };
          reportView = 'drill';
          tab = 'reports';
          draw();
        });
    }

    async function draw() {
      try {
        rdDestroyCharts(body);
        reportBody = null;
        const sum = await rdApi('summary', F);
        rdLogActivity('viewed', tab, periodLabel());
        top.innerHTML = '';
        const banner = document.createElement('div');
        banner.innerHTML = rdSourceBanner(sum.batch, 'revenue');
        top.appendChild(banner);
        rdUploadCard(top, 'revenue', () => renderRevenueDashboard(root));
        if (!allowedTabs.length) {
          tabsEl.innerHTML = '';
          barEl.innerHTML = '';
          body.innerHTML =
            '<p class="form-note">You do not have access to any Service Revenue Dashboard tab. Ask an administrator.</p>';
          return;
        }
        if (!sum.summary) {
          tabsEl.innerHTML = '';
          barEl.innerHTML = '';
          body.innerHTML =
            '<p class="form-note">Upload the Service Dashboard master workbook to see revenue here.</p>';
          return;
        }
        // First load: default to the latest year in the data.
        if (!seeded) {
          seeded = true;
          const years = sum.summary.options.years;
          if (years.length) {
            F.year = String(years[years.length - 1]);
            return draw();
          }
        }
        drawTabs();
        if (tab === 'logic') {
          await drawLogic(sum);
          return;
        }
        drawFilterBar(sum.summary.options);
        if (tab === 'explorer') await drawExplorer(sum);
        else if (tab === 'reports') await drawReports(sum);
        else await drawOverview(sum);
      } catch (error) {
        body.innerHTML =
          '<p class="form-note">' +
          escapeHtml(error.message || 'Could not load the revenue dashboard.') +
          '</p>';
      }
    }
    await draw();
  }

  // ---- Budget Variance (#64): versions, stream mapping, variance on closed months ----
  const BV_SOURCE_LABELS = {
    excel_job_type: 'Job type in the master workbook',
    portal_vas: 'Portal: VAS sales',
    portal_amc: 'Portal: AMC contracts',
    portal_rate_card: 'Portal: Rate card sales',
    portal_thomson: 'Portal: Thomson sales',
    portal_job_csijw: 'Portal: warranty job cards (CSIJW)',
    portal_job_csijo: 'Portal: non-warranty job cards (CSIJO)',
    portal_dandi_csidi: 'Portal: Delivery + Installation jobs (CSIDI)',
    portal_dandi_csido: 'Portal: Delivery only jobs (CSIDO)',
    portal_dandi_csiii: 'Portal: Installation only jobs (CSIII)',
  };
  async function renderBudgetVariance(root, state) {
    const st = state || { tab: 'variance', versionId: '' };
    const canWrite = hasPermission('revenue_dashboard.write');
    root.innerHTML = '<p class="form-note">Loading&hellip;</p>';
    let cfg;
    let data;
    try {
      cfg = await apiRequest('/api/budget-variance/config');
      data = await apiRequest(
        '/api/budget-variance/variance' + (st.versionId ? '?versionId=' + st.versionId : ''),
      );
    } catch (error) {
      root.innerHTML =
        '<p class="form-note">' + escapeHtml(error.message || 'Could not load.') + '</p>';
      return;
    }
    const reload = () => renderBudgetVariance(root, st);
    root.innerHTML = '';
    const tabs = document.createElement('div');
    tabs.className = 'form-row';
    [
      ['variance', 'Variance'],
      ['versions', 'Budget versions'],
      ['mapping', 'Stream mapping & settings'],
    ].forEach(([key, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'button ' + (st.tab === key ? 'button-primary' : 'button-outline');
      b.textContent = label;
      b.addEventListener('click', () => {
        st.tab = key;
        reload();
      });
      tabs.appendChild(b);
    });
    root.appendChild(tabs);
    const body = document.createElement('div');
    root.appendChild(body);
    const monthLabel = (p) => RD_MONTHS[Number(p.slice(5, 7)) - 1] + ' ' + p.slice(2, 4);
    const varCls = (v) => (v < 0 ? 'rd-neg' : 'rd-pos');
    const versionOptions = cfg.versions
      .map(
        (v) =>
          '<option value="' +
          v.id +
          '"' +
          (data.version && v.id === data.version.id ? ' selected' : '') +
          '>' +
          escapeHtml(v.name + ' (' + v.status + (v.isActive ? ', active' : '') + ')') +
          '</option>',
      )
      .join('');

    if (st.tab === 'variance') {
      if (!data.version) {
        body.innerHTML =
          '<p class="form-note">No budget version yet. Create one under Budget versions.</p>';
        return;
      }
      const m = data.months;
      const closedCount = m.filter((x) => x.closed).length;
      const tot = data.streams.reduce(
        (t, s) => ({
          budget: t.budget + s.closed.budget,
          actual: t.actual + s.closed.actual,
          fy: t.fy + s.fullYear.budget,
        }),
        { budget: 0, actual: 0, fy: 0 },
      );
      const dim = (i) => (m[i].closed ? '' : ' style="opacity:.55;font-style:italic"');
      let html =
        '<div class="form-row"><label>Budget version <select id="bvVersion">' +
        versionOptions +
        '</select></label></div>' +
        rdKpis([
          ['Full-year budget (ex-VAT)', 'AED ' + rdMoney(tot.fy), data.version.name],
          [
            'Budget, closed months',
            'AED ' + rdMoney(tot.budget),
            closedCount + ' of 12 months closed',
          ],
          [
            'Actual, closed months',
            'AED ' + rdMoney(tot.actual),
            'Workbook upload + portal records',
          ],
          [
            'Variance',
            'AED ' + rdMoney(tot.actual - tot.budget),
            tot.actual < tot.budget ? 'Behind budget' : 'Ahead of budget',
          ],
          ['Achievement', rdPercent(tot.actual, tot.budget), 'Closed months only'],
        ]);
      html +=
        '<div class="card-help"><span>How these figures work</span>' +
        tipHtml(
          'Only closed months count in the totals' +
            (data.settings.includeRunning
              ? ' (the running month is included by setting)'
              : '; months not yet closed are shown faded') +
            '. Budget is the version annual figure phased across the fiscal year; VAT-inclusive streams are restated ex-VAT at ' +
            Math.round(data.settings.vatRate * 100) +
            '%.',
        ) +
        '</div>';
      html +=
        '<div class="table-wrap"><table class="rd-budget-table"><thead><tr><th>Stream</th><th>Measure</th>' +
        m.map((x, i) => '<th' + dim(i) + '>' + monthLabel(x.period) + '</th>').join('') +
        '<th>Closed total</th></tr></thead><tbody>';
      data.streams.forEach((s) => {
        const line = (label, first, fn, total, cls) =>
          '<tr><td>' +
          (first ? '<strong>' + escapeHtml(s.name) + '</strong>' : '') +
          '</td><td>' +
          label +
          '</td>' +
          s.months
            .map(
              (c, i) =>
                '<td' + dim(i) + (cls ? ' class="' + cls(c) + '"' : '') + '>' + fn(c) + '</td>',
            )
            .join('') +
          '<td><strong>' +
          total +
          '</strong></td></tr>';
        html += line('Budget', true, (c) => rdMoney(c.budget), rdMoney(s.closed.budget));
        html += line('Actual', false, (c) => rdMoney(c.actual), rdMoney(s.closed.actual));
        html += line(
          'Variance',
          false,
          (c) => rdMoney(c.actual - c.budget),
          rdMoney(s.closed.actual - s.closed.budget),
          (c) => varCls(c.actual - c.budget),
        );
        if (data.settings.compareQuantity) {
          html += line(
            'Qty budget / actual',
            false,
            (c) =>
              c.budgetQty || c.actualQty
                ? Math.round(c.budgetQty) + ' / ' + Math.round(c.actualQty)
                : '',
            Math.round(s.closed.budgetQty) + ' / ' + Math.round(s.closed.actualQty),
          );
        }
      });
      html += '</tbody></table></div>';
      if (data.unmapped.length) {
        html +=
          '<p class="form-note rd-banner rd-banner-empty">Not in any stream (add a mapping): ' +
          data.unmapped.map((u) => escapeHtml(u.source) + ' AED ' + rdMoney(u.revenue)).join(', ') +
          '</p>';
      }
      if (!data.revenueBatch) {
        html +=
          '<p class="form-note">No revenue workbook is uploaded; only portal records (VAS, AMC, rate card, Thomson) count as actuals.</p>';
      }
      body.innerHTML = html;
      body.querySelector('#bvVersion').addEventListener('change', (e) => {
        st.versionId = e.target.value;
        reload();
      });
      return;
    }

    if (st.tab === 'versions') {
      let html =
        '<div class="table-wrap"><table><thead><tr><th>Name</th><th>Kind</th><th>Fiscal year</th><th>Status</th><th>Active</th><th></th></tr></thead><tbody>' +
        cfg.versions
          .map(
            (v) =>
              '<tr><td>' +
              escapeHtml(v.name) +
              '</td><td>' +
              v.kind +
              '</td><td>Jul ' +
              v.fiscalYear +
              ' - Jun ' +
              (v.fiscalYear + 1) +
              '</td><td>' +
              v.status +
              '</td><td>' +
              (v.isActive ? 'Yes' : '') +
              '</td><td><button class="button button-outline" type="button" data-bv-open="' +
              v.id +
              '">Open</button></td></tr>',
          )
          .join('') +
        '</tbody></table></div>';
      if (canWrite) {
        html +=
          '<h3>New version</h3><div class="form-row"><label>Name <input id="bvNewName" placeholder="Revised budget Q2" /></label>' +
          '<label>Kind <select id="bvNewKind"><option value="revised">Revised</option><option value="forecast">Forecast</option><option value="original">Original</option></select></label>' +
          '<label>Fiscal year starts (July of) <input id="bvNewFy" type="number" value="' +
          (data.version ? data.version.fiscalYear : 2026) +
          '" /></label>' +
          '<label>Copy from <select id="bvNewCopy"><option value="">(blank)</option>' +
          versionOptions.replace(/ selected/, '') +
          '</select></label>' +
          '<button class="button button-primary" type="button" id="bvNewBtn">Create</button></div><p class="form-note" id="bvMsg"></p>';
      }
      html += '<div id="bvEditor"></div>';
      body.innerHTML = html;
      body
        .querySelectorAll('[data-bv-open]')
        .forEach((b) =>
          b.addEventListener('click', () =>
            bvOpenVersion(body.querySelector('#bvEditor'), cfg, b.dataset.bvOpen, canWrite, reload),
          ),
        );
      body.querySelector('#bvNewBtn')?.addEventListener('click', async () => {
        const msg = body.querySelector('#bvMsg');
        try {
          const payload = {
            name: body.querySelector('#bvNewName').value.trim(),
            kind: body.querySelector('#bvNewKind').value,
            fiscalYear: Number(body.querySelector('#bvNewFy').value),
          };
          const copy = body.querySelector('#bvNewCopy').value;
          if (copy) payload.copyFromVersionId = copy;
          await apiRequest('/api/budget-variance/versions', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          reload();
        } catch (e) {
          msg.textContent = e.message;
        }
      });
      return;
    }

    // Stream mapping and settings.
    const set = Object.fromEntries(cfg.settings.map((x) => [x.key, x.value]));
    const streamOpts = (sel) =>
      cfg.streams
        .map(
          (s) =>
            '<option value="' +
            s.code +
            '"' +
            (s.code === sel ? ' selected' : '') +
            '>' +
            escapeHtml(s.name) +
            '</option>',
        )
        .join('');
    const kindOpts = (sel) =>
      Object.entries(BV_SOURCE_LABELS)
        .map(
          ([k, l]) =>
            '<option value="' +
            k +
            '"' +
            (k === sel ? ' selected' : '') +
            '>' +
            escapeHtml(l) +
            '</option>',
        )
        .join('');
    const dis = canWrite ? '' : ' disabled';
    let html =
      '<h3>Which records feed which stream ' +
      tipHtml(
        'Each job type from the master workbook, and each portal record type, is mapped to one revenue stream. A new product or job type needs a new row here, not a code change.',
      ) +
      '</h3>' +
      '<div class="table-wrap"><table id="bvMapTable"><thead><tr><th>Source</th><th>Job type (workbook only)</th><th>Stream</th><th>Notes</th><th></th></tr></thead><tbody>' +
      cfg.mappings.map((mp) => bvMapRow(mp, kindOpts, streamOpts, dis)).join('') +
      '</tbody></table></div>';
    if (cfg.unmappedJobTypes.length) {
      html +=
        '<p class="form-note rd-banner rd-banner-empty">Job types in the uploaded workbook with no mapping: ' +
        cfg.unmappedJobTypes
          .map((u) => escapeHtml(u.jobType) + ' (AED ' + rdMoney(u.revenue) + ')')
          .join(', ') +
        '</p>';
    }
    if (canWrite)
      html +=
        '<button class="button button-outline" type="button" id="bvAddMap">Add mapping</button>';
    html +=
      '<h3>Revenue streams</h3><div class="table-wrap"><table id="bvStreamTable"><thead><tr><th>Code</th><th>Name</th><th>Order</th><th>Active</th></tr></thead><tbody>' +
      cfg.streams
        .map(
          (s) =>
            '<tr data-code="' +
            s.code +
            '"><td>' +
            s.code +
            '</td><td><input data-f="name" value="' +
            escapeHtml(s.name) +
            '"' +
            dis +
            ' /></td><td><input data-f="sortOrder" type="number" style="width:70px" value="' +
            s.sortOrder +
            '"' +
            dis +
            ' /></td><td><input data-f="isActive" type="checkbox"' +
            (s.isActive ? ' checked' : '') +
            dis +
            ' /></td></tr>',
        )
        .join('') +
      '</tbody></table></div>';
    if (canWrite) {
      html +=
        '<div class="form-row"><label>New stream code <input id="bvNewStreamCode" placeholder="extended_warranty" /></label> <label>Name <input id="bvNewStreamName" /></label> <button class="button button-outline" type="button" id="bvAddStream">Add stream</button></div>';
    }
    html +=
      '<h3>Settings</h3><div class="form-row">' +
      '<label>Fiscal year starts in month (7 = July) <input id="bvSetFiscal" type="number" min="1" max="12" value="' +
      set.fiscal_start_month +
      '"' +
      dis +
      ' /></label>' +
      '<label>VAT rate (0.05 = 5%) <input id="bvSetVat" type="number" step="0.01" value="' +
      set.vat_rate +
      '"' +
      dis +
      ' /></label>' +
      '<label>Months counted <select id="bvSetMonths"' +
      dis +
      '><option value="closed"' +
      (set.variance_months === 'closed' ? ' selected' : '') +
      '>Closed months only</option><option value="all"' +
      (set.variance_months === 'all' ? ' selected' : '') +
      '>Include running month</option></select></label>' +
      '<label><input id="bvSetQty" type="checkbox"' +
      (set.compare_quantity ? ' checked' : '') +
      dis +
      ' /> Compare quantity too</label>' +
      '<label><input id="bvSetJobCards" type="checkbox"' +
      (set.portal_job_card_revenue ? ' checked' : '') +
      dis +
      ' /> Count CSIJW / CSIJO from portal job-card billing (ignores those two job types in the workbook upload)</label>' +
      '<label><input id="bvSetDandi" type="checkbox"' +
      (set.portal_dandi_revenue ? ' checked' : '') +
      dis +
      ' /> Count CSIDI / CSIDO / CSIII from Completed Delivery &amp; Installation jobs (ignores those three job types in the workbook upload)</label></div>';
    if (canWrite) {
      html +=
        '<button class="button button-primary" type="button" id="bvSaveCfg">Save mapping and settings</button> <span class="form-note" id="bvCfgMsg"></span>';
    }
    body.innerHTML = html;
    if (!canWrite) return;
    const tbody = body.querySelector('#bvMapTable tbody');
    const msg = body.querySelector('#bvCfgMsg');
    body.querySelector('#bvAddMap').addEventListener('click', () => {
      tbody.insertAdjacentHTML(
        'beforeend',
        bvMapRow(
          {
            sourceKind: 'excel_job_type',
            matchValue: '',
            streamCode: cfg.streams[0].code,
            notes: '',
          },
          kindOpts,
          streamOpts,
          '',
        ),
      );
    });
    body.querySelector('#bvMapTable').addEventListener('click', (e) => {
      if (e.target.matches('[data-del]')) e.target.closest('tr').remove();
    });
    body.querySelector('#bvAddStream').addEventListener('click', async () => {
      const code = body.querySelector('#bvNewStreamCode').value.trim();
      const name = body.querySelector('#bvNewStreamName').value.trim();
      try {
        await apiRequest('/api/budget-variance/config', {
          method: 'PUT',
          body: JSON.stringify({
            streams: [{ code, name, sortOrder: cfg.streams.length + 1, isActive: true }],
          }),
        });
        reload();
      } catch (e) {
        msg.textContent = e.message;
      }
    });
    body.querySelector('#bvSaveCfg').addEventListener('click', async () => {
      const mappings = [...tbody.querySelectorAll('tr')].map((tr) => ({
        sourceKind: tr.querySelector('[data-f=sourceKind]').value,
        matchValue: tr.querySelector('[data-f=matchValue]').value.trim() || '*',
        streamCode: tr.querySelector('[data-f=streamCode]').value,
        notes: tr.querySelector('[data-f=notes]').value.trim() || null,
      }));
      const streams = [...body.querySelectorAll('#bvStreamTable tbody tr')].map((tr) => {
        const orig = cfg.streams.find((s) => s.code === tr.dataset.code);
        return {
          code: tr.dataset.code,
          name: tr.querySelector('[data-f=name]').value.trim(),
          sortOrder: Number(tr.querySelector('[data-f=sortOrder]').value),
          isActive: tr.querySelector('[data-f=isActive]').checked,
          notes: orig.notes,
        };
      });
      try {
        await apiRequest('/api/budget-variance/config', {
          method: 'PUT',
          body: JSON.stringify({
            streams,
            mappings,
            settings: {
              fiscal_start_month: Number(body.querySelector('#bvSetFiscal').value),
              vat_rate: Number(body.querySelector('#bvSetVat').value),
              variance_months: body.querySelector('#bvSetMonths').value,
              compare_quantity: body.querySelector('#bvSetQty').checked,
              portal_job_card_revenue: body.querySelector('#bvSetJobCards').checked,
              portal_dandi_revenue: body.querySelector('#bvSetDandi').checked,
            },
          }),
        });
        reload();
      } catch (e) {
        msg.textContent = e.message;
      }
    });
  }
  function bvMapRow(m, kindOpts, streamOpts, dis) {
    return (
      '<tr><td><select data-f="sourceKind"' +
      dis +
      '>' +
      kindOpts(m.sourceKind) +
      '</select></td>' +
      '<td><input data-f="matchValue" value="' +
      escapeHtml(m.matchValue === '*' ? '' : m.matchValue) +
      '" placeholder="CSIDI"' +
      dis +
      ' /></td>' +
      '<td><select data-f="streamCode"' +
      dis +
      '>' +
      streamOpts(m.streamCode) +
      '</select></td>' +
      '<td><input data-f="notes" value="' +
      escapeHtml(m.notes || '') +
      '"' +
      dis +
      ' /></td>' +
      '<td>' +
      (dis ? '' : '<button class="button button-outline" type="button" data-del>Remove</button>') +
      '</td></tr>'
    );
  }
  async function bvOpenVersion(host, cfg, id, canWrite, reload) {
    host.innerHTML = '<p class="form-note">Loading&hellip;</p>';
    let d;
    try {
      d = await apiRequest('/api/budget-variance/versions/' + id);
    } catch (e) {
      host.textContent = e.message;
      return;
    }
    const v = d.version;
    const locked = v.status !== 'draft' || !canWrite;
    const dis = locked ? ' disabled' : '';
    const by = Object.fromEntries(d.streams.map((s) => [s.streamCode, s]));
    const months = [
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
    ];
    let html =
      '<h3>' +
      escapeHtml(v.name) +
      ' <small>(' +
      v.status +
      (v.isActive ? ', active' : '') +
      ')</small></h3>' +
      (v.status === 'draft'
        ? ''
        : '<p class="form-note">Approved and archived budgets are locked. To change numbers, create a revised version copied from this one.</p>') +
      '<div class="table-wrap"><table id="bvStreamBudget"><thead><tr><th>Stream</th><th>Annual revenue (AED)</th><th>Annual volume</th><th>VAT-inclusive</th></tr></thead><tbody>' +
      cfg.streams
        .filter((s) => s.isActive)
        .map((s) => {
          const x = by[s.code] || { annualRevenue: 0, annualVolume: 0, vatInclusive: false };
          return (
            '<tr data-code="' +
            s.code +
            '"><td>' +
            escapeHtml(s.name) +
            '</td><td><input data-f="rev" type="number" step="0.01" value="' +
            Number(x.annualRevenue) +
            '"' +
            dis +
            ' /></td><td><input data-f="vol" type="number" step="0.01" value="' +
            Number(x.annualVolume) +
            '"' +
            dis +
            ' /></td><td><input data-f="vat" type="checkbox"' +
            (x.vatInclusive ? ' checked' : '') +
            dis +
            ' /></td></tr>'
          );
        })
        .join('') +
      '</tbody></table></div><h4>Monthly phasing (% of the year, fiscal order)</h4><div class="form-row" id="bvPhasing">' +
      months
        .map(
          (mn, i) =>
            '<label>' +
            mn +
            ' <input data-i="' +
            i +
            '" type="number" step="0.1" style="width:70px" value="' +
            (v.phasing[i] * 100).toFixed(2) +
            '"' +
            dis +
            ' /></label>',
        )
        .join('') +
      '</div><p class="form-note" id="bvPhaseNote"></p>';
    if (canWrite) {
      html +=
        (v.status === 'draft'
          ? '<button class="button button-primary" type="button" id="bvSaveV">Save draft</button> <button class="button button-outline" type="button" id="bvApprove">Approve</button> '
          : '') +
        (v.status !== 'archived' && !v.isActive
          ? '<button class="button button-outline" type="button" id="bvActivate">Make active for its fiscal year</button> '
          : '') +
        (v.status !== 'archived'
          ? '<button class="button button-outline" type="button" id="bvArchive">Archive</button>'
          : '');
    }
    html += ' <span class="form-note" id="bvVMsg"></span>';
    host.innerHTML = html;
    const phasing = () =>
      [...host.querySelectorAll('#bvPhasing input')].map((i) => Number(i.value) / 100);
    const sumNote = () => {
      const t = phasing().reduce((a, b) => a + b, 0) * 100;
      host.querySelector('#bvPhaseNote').textContent = 'Phasing total: ' + t.toFixed(2) + '%';
    };
    host.querySelector('#bvPhasing').addEventListener('input', sumNote);
    sumNote();
    const send = async (payload) => {
      try {
        await apiRequest('/api/budget-variance/versions/' + id, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        reload();
      } catch (e) {
        host.querySelector('#bvVMsg').textContent = e.message;
      }
    };
    const numbers = () => ({
      phasing: phasing(),
      streams: [...host.querySelectorAll('#bvStreamBudget tbody tr')].map((tr) => ({
        streamCode: tr.dataset.code,
        annualRevenue: Number(tr.querySelector('[data-f=rev]').value || 0),
        annualVolume: Number(tr.querySelector('[data-f=vol]').value || 0),
        vatInclusive: tr.querySelector('[data-f=vat]').checked,
      })),
    });
    host.querySelector('#bvSaveV')?.addEventListener('click', () => send(numbers()));
    host.querySelector('#bvApprove')?.addEventListener('click', () => {
      if (confirm('Approve this budget? It becomes read-only.'))
        send({ ...numbers(), status: 'approved' });
    });
    host.querySelector('#bvActivate')?.addEventListener('click', () => send({ makeActive: true }));
    host.querySelector('#bvArchive')?.addEventListener('click', () => {
      if (confirm('Archive this budget?')) send({ status: 'archived' });
    });
  }

  async function renderBudgetDashboard(root) {
    root.innerHTML = '<p class="form-note">Loading budget data&hellip;</p>';
    let data;
    try {
      data = await apiRequest('/api/revenue-dashboard/budget');
    } catch (error) {
      root.innerHTML =
        '<p class="form-note">' +
        escapeHtml(error.message || 'Could not load the budget dashboard.') +
        '</p>';
      return;
    }
    root.innerHTML = '';
    const head = document.createElement('div');
    head.innerHTML =
      rdSourceBanner(data.budgetBatch, 'budget') +
      (data.revenueBatch
        ? ''
        : '<p class="form-note rd-banner rd-banner-empty">No revenue workbook is uploaded, so actuals are empty.</p>');
    root.appendChild(head);
    rdUploadCard(root, 'budget', () => renderBudgetDashboard(root));
    if (!data.budgetBatch) {
      const note = document.createElement('p');
      note.className = 'form-note';
      note.textContent = 'Upload the Service Budget workbook to see budget vs actual here.';
      root.appendChild(note);
      return;
    }

    const periods = [...new Set(data.budget.map((row) => row.period))].sort();
    const lineMap = new Map();
    data.budget.forEach((row) => {
      if (!lineMap.has(row.lineItem)) {
        lineMap.set(row.lineItem, { section: row.section, lineItem: row.lineItem, values: {} });
      }
      lineMap.get(row.lineItem).values[row.period] = Number(row.amount);
    });
    const lines = [...lineMap.values()];
    const budgetRevenue = lines.find((l) => l.section === 'revenue')?.values || {};
    const budgetVolume = lines.find((l) => l.section === 'volume')?.values || {};
    const actualMap = {};
    data.actual.forEach((row) => {
      actualMap[row.period] = { revenue: Number(row.revenue), qty: Number(row.qty) };
    });
    // Months that have any actual revenue count towards year-to-date.
    const actualPeriods = periods.filter((p) => actualMap[p]);
    const ytdBudget = actualPeriods.reduce((sum, p) => sum + (budgetRevenue[p] || 0), 0);
    const ytdActual = actualPeriods.reduce((sum, p) => sum + actualMap[p].revenue, 0);
    const fyBudget = periods.reduce((sum, p) => sum + (budgetRevenue[p] || 0), 0);
    const monthName = (p) => RD_MONTHS[Number(p.slice(5, 7)) - 1] + ' ' + p.slice(2, 4);
    const varClass = (v) => (v < 0 ? ' rd-neg' : ' rd-pos');

    const tiles = rdKpis([
      ['Budget revenue, full year', 'AED ' + rdMoney(fyBudget), 'From the Service Budget workbook'],
      ['Budget to date', 'AED ' + rdMoney(ytdBudget), 'Months with actual revenue'],
      ['Actual revenue to date', 'AED ' + rdMoney(ytdActual), 'From the uploaded revenue workbook'],
      [
        'Variance to date',
        'AED ' + rdMoney(ytdActual - ytdBudget),
        ytdActual - ytdBudget < 0 ? 'Behind budget' : 'Ahead of budget',
      ],
      ['Achievement', rdPercent(ytdActual, ytdBudget), 'Actual vs budget to date'],
    ]);

    // Month-by-month table for management (modification #136): one row per month with the
    // variance as a coloured pill. Months with no actual revenue yet are "Not yet reported"
    // rather than a -100% shortfall.
    const pill = (value, text) =>
      '<span class="rd-var-pill ' +
      (value > 0 ? 'is-up' : value < 0 ? 'is-down' : 'is-flat') +
      '">' +
      text +
      '</span>';
    const varianceCells = (budget, actual, reported) => {
      if (!reported) {
        return (
          '<td class="rd-bm-var"><div class="rd-var-stack"><span class="rd-var-pill is-none">&mdash;</span><span class="rd-var-caption">Not yet reported</span></div></td>' +
          '<td class="rd-bm-var"><div class="rd-var-stack"><span class="rd-var-pill is-none">&mdash;</span></div></td>'
        );
      }
      const v = actual - budget;
      const arrow = v > 0 ? '&#9650;' : v < 0 ? '&#9660;' : '&bull;';
      const caption = v > 0 ? 'Above budget' : v < 0 ? 'Below budget' : 'On budget';
      const pct = budget ? (v / budget) * 100 : null;
      return (
        '<td class="rd-bm-var"><div class="rd-var-stack">' +
        pill(v, arrow + ' AED ' + rdMoney(Math.abs(v))) +
        '<span class="rd-var-caption">' +
        caption +
        '</span></div></td>' +
        '<td class="rd-bm-var"><div class="rd-var-stack">' +
        pill(v, pct === null ? '&mdash;' : (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%') +
        '</div></td>'
      );
    };
    const monthRows = periods
      .map((p) => {
        const reported = Boolean(actualMap[p]);
        const budget = budgetRevenue[p] || 0;
        const actual = reported ? actualMap[p].revenue : 0;
        return (
          '<tr' +
          (reported ? '' : ' class="rd-bm-future"') +
          '><td class="rd-bm-period">' +
          monthName(p) +
          '</td><td class="rd-bm-num">AED ' +
          rdMoney(budget) +
          '</td><td class="rd-bm-num">' +
          (reported ? 'AED ' + rdMoney(actual) : '&mdash;') +
          '</td>' +
          varianceCells(budget, actual, reported) +
          '<td class="rd-bm-num">' +
          rdMoney(budgetVolume[p] || 0) +
          '</td><td class="rd-bm-num">' +
          (reported ? rdMoney(actualMap[p].qty) : '&mdash;') +
          '</td></tr>'
        );
      })
      .join('');
    const totalActualQty = actualPeriods.reduce((sum, p) => sum + actualMap[p].qty, 0);
    const compare =
      '<div class="table-wrap"><table class="rd-bm-table"><thead><tr><th>Period</th><th>Budget revenue</th><th>Actual revenue</th><th>Variance</th><th>Variance %</th><th>Budget qty</th><th>Actual qty</th></tr></thead><tbody>' +
      monthRows +
      '</tbody><tfoot><tr><td class="rd-bm-period">Total</td><td class="rd-bm-num">AED ' +
      rdMoney(fyBudget) +
      '<span class="rd-var-caption">Full year</span></td><td class="rd-bm-num">AED ' +
      rdMoney(ytdActual) +
      '<span class="rd-var-caption">To date</span></td>' +
      varianceCells(ytdBudget, ytdActual, actualPeriods.length > 0).replace(
        /(Below budget|Above budget|On budget)/,
        '$1 (to date)',
      ) +
      '<td class="rd-bm-num">' +
      rdMoney(periods.reduce((sum, p) => sum + (budgetVolume[p] || 0), 0)) +
      '</td><td class="rd-bm-num">' +
      rdMoney(totalActualQty) +
      '</td></tr></tfoot></table></div>';

    const pl =
      '<div class="table-wrap"><table class="rd-budget-table"><thead><tr><th>P&amp;L line (budget)</th>' +
      periods.map((p) => '<th>' + monthName(p) + '</th>').join('') +
      '<th>Total</th></tr></thead><tbody>' +
      lines
        .filter((l) => l.section !== 'volume')
        .map((l) => {
          const total = periods.reduce((s, p) => s + (l.values[p] || 0), 0);
          const strong = ['revenue', 'opex', 'nop', 'np'].includes(l.section);
          return (
            '<tr' +
            (strong ? ' class="rd-strong"' : '') +
            '><td>' +
            escapeHtml(l.lineItem) +
            '</td>' +
            periods.map((p) => '<td>' + rdMoney(l.values[p]) + '</td>').join('') +
            '<td>' +
            rdMoney(total) +
            '</td></tr>'
          );
        })
        .join('') +
      '</tbody></table></div>';

    const rest = document.createElement('div');
    rest.innerHTML =
      tiles +
      rdSection(
        'Monthly revenue: budget vs actual (value in AED)',
        '<div class="rd-chart-pad"><div class="rd-chart-box"><canvas id="rdc-budget"></canvas></div></div>',
      ) +
      rdSection(
        'Monthly revenue budget and actual',
        compare +
          '<div class="card-help rd-pad"><span>About this view</span>' +
          tipHtml(
            'Actuals come from the uploaded revenue workbook (master Excel). The latest month can be partial until its data is complete. Months with no revenue yet show "Not yet reported" instead of a shortfall.',
          ) +
          '</div>',
      ) +
      rdSection('Budget P&amp;L', pl);
    root.appendChild(rest);
    rdDestroyCharts(root);
    await rdDrawChart(rest.querySelector('#rdc-budget'), {
      type: 'bar',
      data: {
        labels: periods.map(monthName),
        datasets: [
          {
            label: 'Budget',
            data: periods.map((p) => budgetRevenue[p] || 0),
            backgroundColor: '#4E7FF2',
            borderRadius: 4,
          },
          {
            label: 'Actual',
            data: periods.map((p) => (actualMap[p] ? actualMap[p].revenue : 0)),
            backgroundColor: '#EB6834',
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        resizeDelay: 200,
        layout: { padding: { top: 22 } },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10 } },
          rdValueLabels: { mode: 'each', prefix: '' },
          tooltip: {
            callbacks: { label: (c) => ' ' + c.dataset.label + ': AED ' + rdMoney(c.raw) },
          },
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            beginAtZero: true,
            grace: '10%',
            title: { display: true, text: 'Value (AED)' },
            ticks: { callback: (v) => rdMoney(v) },
          },
        },
      },
    });
  }

  $('#vasCalcNav')?.addEventListener('click', () => setWorkspaceMode('vas-calc'));
  $('#revenueDashNav')?.addEventListener('click', () => setWorkspaceMode('revenue-dashboard'));
  $('#budgetDashNav')?.addEventListener('click', () => setWorkspaceMode('budget-dashboard'));
  $('#budgetVarNav')?.addEventListener('click', () => setWorkspaceMode('budget-variance'));

  // Tab-wise Finance access (#109): revenue_dashboard.read opens Finance, the
  // codes below decide which tabs / pages inside it a role sees.
  const RD_TAB_PERMS = {
    overview: 'revenue_dashboard.tab_overview',
    explorer: 'revenue_dashboard.tab_explorer',
    reports: 'revenue_dashboard.tab_reports',
    logic: 'revenue_dashboard.tab_logic',
  };
  function revenueTabs() {
    if (!hasPermission('revenue_dashboard.read')) return [];
    return Object.keys(RD_TAB_PERMS).filter((id) => hasPermission(RD_TAB_PERMS[id]));
  }
  function financeMembers() {
    if (!hasPermission('revenue_dashboard.read')) return [];
    const ok = {
      'revenue-dashboard': revenueTabs().length > 0,
      'budget-dashboard': hasPermission('revenue_dashboard.budget_actual'),
      'budget-variance': hasPermission('revenue_dashboard.budget_variance'),
    };
    return NAV_GROUPS.finance.members.filter((m) => ok[m[0]]);
  }

  // ---- Sidebar groups (#65): one entry, tabs inside --------------------------
  // The member pages and their workspaces are unchanged; their own sidebar
  // buttons are hidden (.nav-child) and a tab strip on each page switches
  // between the members.
  const NAV_GROUPS = {
    finance: {
      navId: 'financeNav',
      members: [
        ['revenue-dashboard', 'Service Revenue Dashboard'],
        ['budget-dashboard', 'Budget vs Actual'],
        ['budget-variance', 'Budget Variance'],
      ],
    },
    pricing: {
      navId: 'pricingMastersNav',
      members: [
        ['vas-admin', 'VAS Pricing Master'],
        ['rate-card-admin', 'Rate Card Admin'],
        ['dandi-admin', 'D+I Admin Entry'],
        ['amc-admin', 'AMC Admin Rates'],
        ['thomson-admin', 'Thomson Pricing Admin'],
      ],
    },
  };
  const navGroupLast = {};
  function navGroupOf(mode) {
    return Object.entries(NAV_GROUPS).find(([, g]) => g.members.some((m) => m[0] === mode));
  }
  function syncNavGroups(mode) {
    const found = navGroupOf(mode);
    Object.entries(NAV_GROUPS).forEach(([key, g]) => {
      const nav = document.getElementById(g.navId);
      if (nav) nav.setAttribute('aria-current', found && found[0] === key ? 'page' : 'false');
    });
    if (!found) return;
    const [key, group] = found;
    navGroupLast[key] = mode;
    const workspaceId =
      PRICING_ADMIN_PAGES[mode]?.workspaceId || PRICING_CALC_PAGES[mode]?.workspaceId;
    const body = workspaceId && document.querySelector('#' + workspaceId + ' .card-body');
    if (!body) return;
    let strip = body.querySelector(':scope > .group-tabs');
    if (!strip) {
      strip = document.createElement('div');
      strip.className = 'group-tabs';
      body.insertBefore(strip, body.firstChild);
    }
    strip.innerHTML = '';
    (key === 'finance' ? financeMembers() : group.members).forEach(([memberMode, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'button ' + (memberMode === mode ? 'button-primary' : 'button-outline');
      b.textContent = label;
      b.addEventListener('click', () => setWorkspaceMode(memberMode));
      strip.appendChild(b);
    });
  }
  const setWorkspaceModeBase = setWorkspaceMode;
  setWorkspaceMode = function (mode) {
    setWorkspaceModeBase(mode);
    syncNavGroups(mode);
  };
  $('#financeNav')?.addEventListener('click', () =>
    setWorkspaceMode(
      financeMembers().some((m) => m[0] === navGroupLast.finance)
        ? navGroupLast.finance
        : (financeMembers()[0] || NAV_GROUPS.finance.members[0])[0],
    ),
  );
  $('#pricingMastersNav')?.addEventListener('click', () =>
    setWorkspaceMode(navGroupLast.pricing || NAV_GROUPS.pricing.members[0][0]),
  );

  $('#rateCardNav')?.addEventListener('click', () => setWorkspaceMode('rate-card'));
  $('#reportsNav')?.addEventListener('click', () => setWorkspaceMode('reports'));
  $('#activityLogNav')?.addEventListener('click', () => setWorkspaceMode('activity-log'));
  $('#rolesNav')?.addEventListener('click', () => setWorkspaceMode('roles'));
  $('#changelogNav')?.addEventListener('click', () => setWorkspaceMode('changelog'));
  $('#mastersNav')?.addEventListener('click', () => setWorkspaceMode('masters'));
  // "Download Excel" on the revenue / budget source banner.
  document.addEventListener('click', async (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-rd-dl]') : null;
    if (!button) return;
    const note = button.parentElement?.querySelector('[data-rd-dl-msg]');
    button.disabled = true;
    if (note) note.textContent = ' Preparing the file…';
    try {
      const text = await downloadMasterFile(
        '/api/revenue-dashboard/import/' +
          encodeURIComponent(button.getAttribute('data-rd-dl')) +
          '/download',
        'workbook.xlsx',
      );
      if (note) note.textContent = ' ' + text;
    } catch (error) {
      if (note) note.textContent = ' ' + (error.message || 'The download failed.');
    } finally {
      button.disabled = false;
    }
  });
  $('#tasksNav')?.addEventListener('click', () => setWorkspaceMode('tasks'));
  $('#chatNav')?.addEventListener('click', () => setWorkspaceMode('chat'));
  $('#discussJobCardButton')?.addEventListener('click', () =>
    discussRecord('job_card', currentJobCardId),
  );
  $('#discussAppointmentButton')?.addEventListener('click', () =>
    discussRecord('appointment', currentAppointmentId),
  );
  $('#discussComplaintButton')?.addEventListener('click', () =>
    discussRecord('complaint', currentComplaintId),
  );
  $('#walkInNav')?.addEventListener('click', () => setWorkspaceMode('walk-in'));
  initItemPickers();
  $('#dailyListNav')?.addEventListener('click', () => setWorkspaceMode('daily-list'));
  $('#deliveryInstallNav')?.addEventListener('click', () => setWorkspaceMode('delivery-install'));
  $('#invoicesNav')?.addEventListener('click', () => setWorkspaceMode('invoices'));
  $('#billingNav')?.addEventListener('click', () => setWorkspaceMode('billing'));
  $('#awaitingDraftsNav')?.addEventListener('click', () => setWorkspaceMode('awaiting-drafts'));
  $('#amcCalcNav')?.addEventListener('click', () => setWorkspaceMode('amc-calc'));
  $('#thomsonCalcNav')?.addEventListener('click', () => setWorkspaceMode('thomson-calc'));

  initJobCardForms();
  initQuotationForms();
  initInspectionForms();
  initThemeAndPaletteControls();
  initUserMenu();
  initSidebarToggle();
  initNavGroups();
  restoreSession();
})();
