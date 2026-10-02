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

  let currentComplaintId = null;
  let currentAppointmentId = null;
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

  const complaintTransitions = {
    New: ['Under Review', 'Cancelled'],
    'Under Review': ['Pending Information', 'Ready for Scheduling', 'Cancelled'],
    'Pending Information': ['Under Review', 'Cancelled'],
    'Ready for Scheduling': ['Scheduled', 'Cancelled'],
    Scheduled: ['Closed', 'Cancelled', 'Ready for Scheduling'],
    Closed: [],
    Cancelled: [],
  };
  const appointmentTransitions = {
    Scheduled: ['In Progress', 'Cancelled'],
    'In Progress': ['Completed', 'Cancelled'],
    Completed: [],
    Cancelled: [],
  };
  const jobCardTransitions = {
    Open: ['In Progress', 'Cancelled'],
    'In Progress': ['Completed', 'Cancelled'],
    Completed: [],
    Cancelled: [],
  };
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

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
      return `<div class="stepper-item ${state}"><span class="stepper-dot" aria-hidden="true">${dot}</span><span class="stepper-label">${escapeHtml(label)}</span></div>${connector}`;
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
    if (hasPermission('appointments.read') && !hasPermission('complaints.read')) {
      setWorkspaceMode('appointments');
    } else if (hasPermission('complaints.read')) {
      setWorkspaceMode('complaints');
    } else if (hasPermission('service_job_card.read')) {
      setWorkspaceMode('job-cards');
    } else {
      showNoWorkspaceAccess();
    }
    if (scrollIntoView) {
      $('#staff-workspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  async function establishSession(result) {
    authToken = result.token;
    saveStoredToken(authToken);
    const session = await apiRequest('/api/auth/me');
    currentUser = session.user;
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
        ['bootstrapPassword', 'Use a password with at least 12 characters.'],
      ])
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
    $('#newRequestNav').hidden = !hasPermission('complaints.write');
    $('#masterDataNav').hidden = !hasPermission('salesmen.write');
    const canReadPricingConfig = hasPermission('pricing_config.read');
    $('#vasAdminNav').hidden = !canReadPricingConfig;
    $('#rateCardAdminNav').hidden = !canReadPricingConfig;
    $('#dandiAdminNav').hidden = !canReadPricingConfig;
    $('#amcAdminNav').hidden = !canReadPricingConfig;
    $('#thomsonAdminNav').hidden = !canReadPricingConfig;
    // Quote calculators (Modification #32) read the same admin data, so they
    // sit behind the same permission.
    $('#vasCalcNav').hidden = !canReadPricingConfig;
    $('#rateCardCalcNav').hidden = !canReadPricingConfig;
    $('#amcCalcNav').hidden = !canReadPricingConfig;
    $('#thomsonCalcNav').hidden = !canReadPricingConfig;
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

  function setWorkspaceMode(mode) {
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
    if (mode === 'new-request' && !hasPermission('complaints.write')) return;
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
                      ? 'Register a service request for a customer who called or emailed in.'
                      : masterData
                        ? 'Manage the Salesman and Sales Channel dropdowns.'
                        : serviceRequests
                          ? 'Review complaints that are ready to be scheduled.'
                          : 'Review incoming service requests and open their history.';
    $('#complaintStatusFilter').value = serviceRequests ? 'Ready for Scheduling' : '';
    $('#complaintStatusFilter').disabled = serviceRequests;
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
    return { start, end: shiftDate(start, 41) };
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
    populateSelectOptions('#jccSalesman', salesmenOptions, 'Select a salesman');
    populateSelectOptions('#jceSalesman', salesmenOptions, 'Select a salesman');
    populateSelectOptions('#jcqSalesman', salesmenOptions, 'Select a salesman');
    populateSelectOptions('#jccSalesChannel', salesChannelOptions, 'Select a sales channel');
    populateSelectOptions('#jceSalesChannel', salesChannelOptions, 'Select a sales channel');
    populateSelectOptions('#jcqSalesChannel', salesChannelOptions, 'Select a sales channel');
  }

  // ---- Service job card content form (create-prefill panel with prefix 'jcc',
  // existing-job-card edit panel with prefix 'jce'). Both share the same field
  // set (packages/contracts jobCardContentFields / docs/code.gs HEADERS_BY_TYPE
  // ['service-job-card']), so one template and one set of handlers, parameterized
  // by prefix, drive both panels instead of duplicating the markup and logic.
  const jobFinalStatusOptions = ['WIP', 'BER', 'Rejected', 'Repair Completed', 'Spare pending'];
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

  function jobCardFieldsHtml(prefix) {
    return `
      <div class="field-grid">
        <div class="field"><label for="${prefix}Date">Job card date</label><input type="date" id="${prefix}Date"></div>
        <div class="field"><label for="${prefix}CustomerName">Customer name</label><input type="text" id="${prefix}CustomerName" maxlength="200"></div>
        <div class="field"><label for="${prefix}CustomerContact">Customer contact</label><input type="text" id="${prefix}CustomerContact" maxlength="50"></div>
        <div class="field"><label for="${prefix}CustomerAddress">Customer address</label><input type="text" id="${prefix}CustomerAddress" maxlength="500"></div>
        <div class="field"><label for="${prefix}ItemDescription">Item description</label><input type="text" id="${prefix}ItemDescription" maxlength="300"></div>
        <div class="field"><label for="${prefix}ModelNo">Model no.</label><input type="text" id="${prefix}ModelNo" maxlength="120"></div>
        <div class="field"><label for="${prefix}Brand">Brand</label><input type="text" id="${prefix}Brand" maxlength="120"></div>
        <div class="field"><label for="${prefix}WarrantyStatus">Warranty status</label><input type="text" id="${prefix}WarrantyStatus" maxlength="50"></div>
        <div class="field"><label for="${prefix}TechnicianName">Technician</label><input type="text" id="${prefix}TechnicianName" maxlength="120"></div>
        <div class="field"><label for="${prefix}Salesman">Salesman</label><select id="${prefix}Salesman"><option value="">Select a salesman</option></select></div>
        <div class="field"><label for="${prefix}SalesChannel">Sales channel</label><select id="${prefix}SalesChannel"><option value="">Select a sales channel</option></select></div>
      </div>
      <div class="field"><label for="${prefix}Complaint">Complaint</label><textarea id="${prefix}Complaint" maxlength="10000"></textarea></div>
      <div class="field"><label for="${prefix}ServiceRendered">Service rendered</label><textarea id="${prefix}ServiceRendered" maxlength="10000"></textarea></div>
      <div class="field-grid">
        <div class="field"><label for="${prefix}PeriodFrom">Period from</label><input type="datetime-local" id="${prefix}PeriodFrom"></div>
        <div class="field"><label for="${prefix}PeriodTo">Period to</label><input type="datetime-local" id="${prefix}PeriodTo"></div>
        <div class="field"><label for="${prefix}TimeConsumed">Time consumed (hours)</label><input type="text" id="${prefix}TimeConsumed" readonly></div>
      </div>
      <h5>Parts used</h5>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Part no.</th><th>Description</th><th>Qty</th><th>Unit price (AED)</th><th>Total</th><th></th></tr></thead>
          <tbody id="${prefix}PartsBody"></tbody>
        </table>
      </div>
      <button class="button button-outline" type="button" id="${prefix}AddPartButton">Add part</button>
      <div class="field-grid">
        <div class="field"><label for="${prefix}TotalCost">Total cost (AED)</label><input type="text" id="${prefix}TotalCost" readonly></div>
        <div class="field"><label for="${prefix}ServiceCharge">Service charge (AED)</label><input type="number" step="0.01" min="0" id="${prefix}ServiceCharge"></div>
        <div class="field"><label for="${prefix}GrandTotal">Grand total (AED)</label><input type="text" id="${prefix}GrandTotal" readonly></div>
        <div class="field"><label for="${prefix}AmountChargeable">Amount chargeable (AED)</label><input type="number" step="0.01" min="0" id="${prefix}AmountChargeable"></div>
      </div>
      <div class="field-grid">
        <div class="field"><label for="${prefix}InvoiceNo">Invoice no.</label><input type="text" id="${prefix}InvoiceNo" maxlength="120"></div>
        <div class="field"><label for="${prefix}DeliveryDate">Delivery date</label><input type="date" id="${prefix}DeliveryDate"></div>
        <div class="field"><label for="${prefix}JobFinalStatus">Job final status</label><select id="${prefix}JobFinalStatus">${jobFinalStatusOptions.map((status) => `<option value="${status}">${status}</option>`).join('')}</select></div>
      </div>
      <div class="field-grid">
        <div class="field"><label for="${prefix}SchoolContactPerson">Site contact person</label><input type="text" id="${prefix}SchoolContactPerson" maxlength="500"></div>
        <div class="field"><label for="${prefix}SchoolContactNumber">Site contact number</label><input type="text" id="${prefix}SchoolContactNumber" maxlength="100"></div>
        <div class="field"><label for="${prefix}CustomerNumber">Customer number</label><input type="text" id="${prefix}CustomerNumber" maxlength="100"></div>
        <div class="field"><label for="${prefix}LegacyReference">Legacy reference</label><input type="text" id="${prefix}LegacyReference" maxlength="120" placeholder="Reference from the old system, if any"></div>
      </div>
    `;
  }

  function initJobCardForms() {
    $('#jobCardCreateFields').innerHTML = jobCardFieldsHtml('jcc');
    $('#jobCardContentFields').innerHTML = jobCardFieldsHtml('jce');
    $('#quotationJobCardCreateFields').innerHTML = jobCardFieldsHtml('jcq');
    ['jcc', 'jce', 'jcq'].forEach((prefix) => {
      $(`#${prefix}AddPartButton`).addEventListener('click', () => {
        jobCardPartsState[prefix].push({ partNo: '', description: '', qty: 1, unitPrice: 0 });
        renderJobCardParts(prefix);
      });
      $(`#${prefix}ServiceCharge`).addEventListener('input', () => recalcJobCardTotals(prefix));
      $(`#${prefix}PeriodFrom`).addEventListener('change', () => calcJobCardTimeConsumed(prefix));
      $(`#${prefix}PeriodTo`).addEventListener('change', () => calcJobCardTimeConsumed(prefix));
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

  function renderLineItemsTable(stateKey, bodyId, onChange) {
    const body = $(`#${bodyId}`);
    const items = lineItemsState[stateKey];
    body.innerHTML = items
      .map(
        (item, idx) => `<tr data-idx="${idx}">
          <td><input type="text" value="${escapeHtml(item.partNo)}" data-field="partNo" maxlength="120"></td>
          <td><input type="text" value="${escapeHtml(item.description)}" data-field="description" maxlength="300"></td>
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
        renderLineItemsTable(stateKey, bodyId, onChange);
      });
    });
    onChange();
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

  function fillJobCardForm(prefix, content) {
    $(`#${prefix}Date`).value = (content.jobCardDate || '').slice(0, 10);
    $(`#${prefix}CustomerName`).value = content.customerName || '';
    $(`#${prefix}CustomerContact`).value = content.customerContact || '';
    $(`#${prefix}CustomerAddress`).value = content.customerAddress || '';
    $(`#${prefix}ItemDescription`).value = content.itemDescription || '';
    $(`#${prefix}ModelNo`).value = content.modelNo || '';
    $(`#${prefix}Brand`).value = content.brand || '';
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
    $(`#${prefix}PeriodFrom`).value = toDateTimeLocal(content.periodFrom);
    $(`#${prefix}PeriodTo`).value = toDateTimeLocal(content.periodTo);
    $(`#${prefix}ServiceCharge`).value = content.serviceCharge || 0;
    $(`#${prefix}AmountChargeable`).value = content.amountChargeable ?? '';
    $(`#${prefix}InvoiceNo`).value = content.invoiceNo || '';
    $(`#${prefix}DeliveryDate`).value = content.deliveryDate
      ? content.deliveryDate.slice(0, 10)
      : '';
    $(`#${prefix}JobFinalStatus`).value = content.jobFinalStatus || 'WIP';
    $(`#${prefix}SchoolContactPerson`).value = content.schoolContactPerson || '';
    $(`#${prefix}SchoolContactNumber`).value = content.schoolContactNumber || '';
    $(`#${prefix}CustomerNumber`).value = content.customerNumber || '';
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
      invoiceNo: $(`#${prefix}InvoiceNo`).value.trim() || undefined,
      deliveryDate: $(`#${prefix}DeliveryDate`).value || undefined,
      jobFinalStatus: $(`#${prefix}JobFinalStatus`).value || undefined,
      schoolContactPerson: $(`#${prefix}SchoolContactPerson`).value.trim() || undefined,
      schoolContactNumber: $(`#${prefix}SchoolContactNumber`).value.trim() || undefined,
      customerNumber: $(`#${prefix}CustomerNumber`).value.trim() || undefined,
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
        <div class="field"><label for="${prefix}ProjectName">Project name</label><input type="text" id="${prefix}ProjectName" maxlength="200"></div>
        <div class="field"><label for="${prefix}SiteLocation">Site / location</label><input type="text" id="${prefix}SiteLocation" maxlength="500"></div>
        <div class="field"><label for="${prefix}DateOfCollection">Date of collection</label><input type="date" id="${prefix}DateOfCollection"></div>
        <div class="field"><label for="${prefix}TechnicianName">Technician</label><input type="text" id="${prefix}TechnicianName" maxlength="120"></div>
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

  function initQuotationForm(prefix) {
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
      renderLineItemsTable(`${prefix}Products`, `${prefix}ProductsBody`, recalc);
    });
    $(`#${prefix}AddPartButton`).addEventListener('click', () => {
      lineItemsState[`${prefix}Parts`].push({ partNo: '', description: '', qty: 1, unitPrice: 0 });
      renderLineItemsTable(`${prefix}Parts`, `${prefix}PartsBody`, recalc);
    });
    $(`#${prefix}LabourAmount`).addEventListener('input', recalc);
    renderLineItemsTable(`${prefix}Products`, `${prefix}ProductsBody`, recalc);
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
    renderLineItemsTable(`${prefix}Products`, `${prefix}ProductsBody`, recalc);
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
        <div class="field"><label for="${prefix}ProjectName">Project name</label><input type="text" id="${prefix}ProjectName" maxlength="200"></div>
        <div class="field"><label for="${prefix}SiteLocation">Site / location</label><input type="text" id="${prefix}SiteLocation" maxlength="500"></div>
        <div class="field"><label for="${prefix}DateOfCollection">Date of collection</label><input type="date" id="${prefix}DateOfCollection"></div>
        <div class="field"><label for="${prefix}TechnicianName">Technician</label><input type="text" id="${prefix}TechnicianName" maxlength="120"></div>
        <div class="field"><label for="${prefix}WarrantyStatus">Warranty status</label><input type="text" id="${prefix}WarrantyStatus" maxlength="50"></div>
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
    lineItemsState[`${prefix}Products`] = [];
    lineItemsState[`${prefix}FaultyParts`] = [];
    $(`#${prefix}AddProductButton`).addEventListener('click', () => {
      lineItemsState[`${prefix}Products`].push({
        partNo: '',
        description: '',
        qty: 1,
        unitPrice: 0,
      });
      renderLineItemsTable(`${prefix}Products`, `${prefix}ProductsBody`, () => {});
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
    renderLineItemsTable(`${prefix}Products`, `${prefix}ProductsBody`, () => {});
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
    $(`#${prefix}WarrantyStatus`).value = i.warrantyStatus || '';
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
    renderLineItemsTable(`${prefix}Products`, `${prefix}ProductsBody`, () => {});
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
      warrantyStatus: $(`#${prefix}WarrantyStatus`).value.trim() || undefined,
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
  .doc-head .logo { height: 42px; display: block; margin-bottom: 4px; }
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

  function printLineItemsTable(items) {
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

  function printDocHead(companyTitle, docTitle, reference, legacyReference) {
    return `<div class="doc-head">
      <div>
        <div class="company">${escapeHtml(companyTitle)}</div>
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

  function printJobCard(jobCard) {
    if (!jobCard) return;
    const body = `
      ${printDocHead("Jacky's Distribution LLC", 'Service Job Card', jobCard.jobCardReference, jobCard.legacyReference)}
      <h2>Job details</h2>
      ${printFieldGrid([
        ['Appointment ref.', jobCard.appointmentReference],
        ['Job card date', jobCard.jobCardDate],
        ['Customer name', jobCard.customerName],
        ['Customer contact', jobCard.customerContact],
        ['Customer address', jobCard.customerAddress],
        ['Item description', jobCard.itemDescription],
        ['Model no.', jobCard.modelNo],
        ['Brand', jobCard.brand],
        ['Warranty status', jobCard.warrantyStatus],
        ['Technician', jobCard.technicianName],
        ['Salesman', jobCard.salesman],
        ['Sales channel', jobCard.salesChannel],
        ['Job final status', jobCard.jobFinalStatus],
        ['Status', jobCard.status],
      ])}
      ${printTextBlock('Complaint', jobCard.complaint)}
      ${printTextBlock('Service rendered', jobCard.serviceRendered)}
      <h2>Parts used</h2>
      ${printLineItemsTable(jobCard.parts)}
      <table class="totals">
        <tr><td>Total cost (AED)</td><td class="num">${money(jobCard.totalCost || 0)}</td></tr>
        <tr><td>Service charge (AED)</td><td class="num">${money(jobCard.serviceCharge || 0)}</td></tr>
        <tr class="grand"><td>Grand total (AED)</td><td class="num">${money(jobCard.grandTotal || 0)}</td></tr>
        ${jobCard.amountChargeable != null ? `<tr><td>Amount chargeable (AED)</td><td class="num">${money(jobCard.amountChargeable)}</td></tr>` : ''}
      </table>
      <h2>Invoice / delivery</h2>
      ${printFieldGrid([
        ['Invoice no.', jobCard.invoiceNo],
        ['Delivery date', jobCard.deliveryDate],
        ['Time consumed (hours)', jobCard.timeConsumedHours],
        ['Site contact person', jobCard.schoolContactPerson],
        ['Site contact number', jobCard.schoolContactNumber],
        ['Customer number', jobCard.customerNumber],
      ])}
      <div class="sign-row">
        <div class="sign-box">Technician signature</div>
        <div class="sign-box">Customer signature</div>
      </div>
    `;
    openPrintWindow(printDocumentShell(`Service Job Card ${jobCard.jobCardReference || ''}`, body));
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

  function renderJobCards(jobCards) {
    const body = $('#jobCardsBody');
    body.innerHTML = jobCards
      .map(
        (jobCard) =>
          `<tr><td><button class="table-link" type="button" data-job-card-id="${escapeHtml(jobCard.id)}">${escapeHtml(jobCard.jobCardReference)}</button></td><td><button class="table-link" type="button" data-appointment-id="${escapeHtml(jobCard.appointmentId)}">${escapeHtml(jobCard.appointmentReference)}</button></td><td><strong>${escapeHtml(jobCard.customerName)}</strong><br>${escapeHtml(jobCard.contactNumber)}</td><td>${escapeHtml(appointmentDateTime(jobCard))}</td><td><span class="status ${statusClass(jobCard.status)}">${escapeHtml(jobCard.status)}</span></td></tr>`,
      )
      .join('');
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
      ['Job final status', (jc) => jc.jobFinalStatus],
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

  async function loadJobCards() {
    if (!hasPermission('service_job_card.read')) return;
    clearWorkspaceRecovery();
    const params = new URLSearchParams({ page: '1', pageSize: '50' });
    const search = $('#jobCardSearch').value.trim();
    const status = $('#jobCardStatusFilter').value;
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    $('#jobCardsBody').innerHTML =
      '<tr><td colspan="5" class="empty-state">Loading service job cards…</td></tr>';
    try {
      const result = await apiRequest('/api/job-cards?' + params);
      lastLoadedJobCards = result.jobCards || [];
      renderJobCards(lastLoadedJobCards);
    } catch (error) {
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
          `<tr><td><button class="table-link" type="button" data-quotation-id="${escapeHtml(q.id)}">${escapeHtml(q.quotationReference)}</button></td><td>${escapeHtml(q.customerName || '—')}<br>${escapeHtml(q.contactNumber || '')}</td><td>${escapeHtml(q.projectName || '—')}<br>${escapeHtml(q.siteLocation || '')}</td><td>${escapeHtml(formatDate(q.updatedAt))}</td></tr>`,
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
      '<tr><td colspan="4" class="empty-state">Loading quotations…</td></tr>';
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

  const teamAccountRoleOptions = ['user', 'sales', 'management', 'admin'];

  function renderTeamAccounts(users) {
    const body = $('#teamAccountsBody');
    body.innerHTML = users
      .map((user) => {
        const isSelf = user.id === currentUser?.id;
        const roleOptions = teamAccountRoleOptions
          .map(
            (role) =>
              `<option value="${role}" ${role === user.role ? 'selected' : ''}>${escapeHtml(role)}</option>`,
          )
          .join('');
        return `<tr data-user-id="${escapeHtml(user.id)}"><td>${escapeHtml(user.name)}</td><td>${escapeHtml(user.email)}</td><td><select class="team-account-role-select" data-user-id="${escapeHtml(user.id)}" ${isSelf ? 'disabled' : ''}>${roleOptions}</select></td><td>${user.active ? 'Active' : 'Inactive'}</td><td>${
          isSelf
            ? '<span class="form-note-inline">(you)</span>'
            : `<button class="button-link" type="button" data-save-role="${escapeHtml(user.id)}">Save role</button> <button class="button-link" type="button" data-toggle-active="${escapeHtml(user.id)}">${user.active ? 'Deactivate' : 'Reactivate'}</button>`
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
    if (!password || password.length < 12) {
      showFieldError(form, 'teamAccountPassword', 'Use a password with at least 12 characters.');
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
    clearErrors($('#newComplaintForm'));
    applyNewComplaintCustomerTypeGating();
    $('#newComplaintB2bBranchSearchInput').value = '';
    $('#newComplaintB2bBranchResults').innerHTML = '';
    $('#newComplaintB2bBranchResults').hidden = true;
    delete $('#newComplaintB2bBranchResults').dataset.branches;
    $('#newComplaintB2bBranchSearchMessage').textContent = '';
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
    if (branch.lastSalesOrderNumber)
      $('#newComplaintSalesOrderNumber').value = branch.lastSalesOrderNumber;
    $('#newComplaintB2bBranchResults').hidden = true;
    $('#newComplaintB2bBranchSearchInput').value = '';
    $('#newComplaintB2bBranchSearchMessage').textContent =
      `Filled from the master list (Cust_Code ${branch.custCode}).`;
  });

  function newComplaintFormData() {
    const fields = {
      customerType: $('#newComplaintCustomerType').value,
      customerName: $('#newComplaintCustomerName').value.trim(),
      contactNumber: $('#newComplaintContactNumber').value.trim(),
      customerEmail: $('#newComplaintCustomerEmail').value.trim(),
      address: $('#newComplaintAddress').value.trim(),
      region: $('#newComplaintRegion').value,
      brand: $('#newComplaintBrand').value.trim(),
      model: $('#newComplaintModel').value.trim(),
      serialOrItemCode: $('#newComplaintSerialOrItemCode').value.trim(),
      description: $('#newComplaintDescription').value.trim(),
      b2bBranchSchool: $('#newComplaintB2bBranchSchool').value.trim(),
      schoolContactPerson: $('#newComplaintSchoolContactPerson').value.trim(),
      schoolContactNumber: $('#newComplaintSchoolContactNumber').value.trim(),
      customerNumber: $('#newComplaintCustomerNumber').value.trim(),
      salesOrderNumber: $('#newComplaintSalesOrderNumber').value.trim(),
    };
    // Optional fields left blank must be OMITTED, not sent as "" -- the
    // server's Zod schema treats each as .optional() but still .min(1)
    // when present (matches apps/web/src/complaints.js's public form).
    return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== ''));
  }

  function validateNewComplaintForm(data, form) {
    clearErrors(form);
    let valid = true;
    if (!data.customerType) {
      showFieldError(form, 'newComplaintCustomerType', 'Select a customer type.');
      valid = false;
    }
    if (!data.customerName) {
      showFieldError(form, 'newComplaintCustomerName', 'Enter the customer name.');
      valid = false;
    }
    if (!data.description) {
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

  $('#newComplaintForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = newComplaintFormData();
    setMessage('#newComplaintMessage', '', false);
    if (!validateNewComplaintForm(data, form)) return;
    const button = $('#submitNewComplaintButton');
    setBusy(button, true, 'Registering…');
    try {
      const result = await apiRequest('/api/complaints', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      $('#newComplaintReference').textContent =
        result.complaint?.complaintReference || 'Reference created';
      $('#newComplaintSuccess').hidden = false;
      $('#newComplaintFields').hidden = true;
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 403) {
        setMessage('#newComplaintMessage', 'You are not authorized to register service requests.');
      } else {
        setMessage('#newComplaintMessage', error.message);
      }
    } finally {
      setBusy(button, false);
    }
  });

  $('#registerAnotherButton').addEventListener('click', resetNewComplaintForm);

  $('#openNewComplaintInInboxButton').addEventListener('click', () => {
    const reference = $('#newComplaintReference').textContent.trim();
    setWorkspaceMode('complaints');
    if (reference && reference !== 'Reference created') {
      $('#complaintSearch').value = reference;
      loadComplaints();
    }
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
        ['Source', approval.jobCardReference || approval.inspectionReference],
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

  function collectWarrantyApprovalForm() {
    const jobCardId = $('#waJobCardId').value.trim();
    const inspectionId = $('#waInspectionId').value.trim();
    return {
      jobCardId: jobCardId || undefined,
      inspectionId: jobCardId ? undefined : inspectionId || undefined,
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
    const inspectionId = $('#waInspectionId').value.trim();
    if (Boolean(jobCardId) === Boolean(inspectionId)) {
      setMessage('#workspaceMessage', 'Enter exactly one of Job card ID or Inspection ID.');
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
      $('#warrantyApprovalCreateForm').reset();
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
    rateCardSales: () => setWorkspaceMode('rate-card-calc'),
    thomsonSales: () => setWorkspaceMode('thomson-calc'),
  };

  // Delegated click handling survives each re-render (innerHTML swap) since
  // the listener lives on the stable container, not the tiles themselves.
  [
    ['dashComplaintTiles', 'complaints'],
    ['dashAppointmentTiles', 'appointments'],
    ['dashJobCardTiles', 'jobCards'],
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
      [['Total', summary.jobCards.total]],
      (status) => status,
    );
    $('#dashJobCardBars').innerHTML = dashboardBarsHtml(summary.jobCards.byStatus);
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

  async function loadDashboard() {
    if (!hasPermission('dashboard.read')) return;
    clearWorkspaceRecovery();
    $('#dashboardEmpty').hidden = true;
    try {
      const result = await apiRequest('/api/dashboard/summary');
      renderDashboard(result.summary);
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
    $('#dashComplaintTiles').innerHTML = '';
    $('#dashAppointmentTiles').innerHTML = '';
    $('#dashJobCardTiles').innerHTML = '';
    $('#dashQuotationInspectionTiles').innerHTML = '';
    $('#dashWarrantyApprovalTiles').innerHTML = '';
    $('#dashVasSaleTiles').innerHTML = '';
    $('#dashAmcContractTiles').innerHTML = '';
  }

  function renderJobCardActions(jobCard) {
    const canWrite = hasPermission('service_job_card.write');
    const terminal = jobCard.status === 'Completed' || jobCard.status === 'Cancelled';
    $('#jobCardActions').hidden = !canWrite || terminal;
    $('#jobCardContentAction').hidden = !canWrite || terminal;
    $('#jobCardStatusAction').hidden = !canWrite || terminal;
    if (canWrite && !terminal) fillJobCardForm('jce', jobCard);
    const nextStatuses = jobCardTransitions[jobCard.status] || [];
    $('#jobCardNextStatus').innerHTML = nextStatuses.length
      ? nextStatuses
          .map((status) => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`)
          .join('')
      : '<option value="">No further transitions</option>';
    $('#jobCardNextStatus').disabled = nextStatuses.length === 0;
    $('#updateJobCardStatusButton').disabled = nextStatuses.length === 0;
    $('#jobCardStatusReason').value = '';
    clearErrors($('#jobCardStatusForm'));
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
      $('#jobCardDetailHeading').textContent =
        jobCard.jobCardReference || 'Service job card details';
      $('#jobCardDetailStatus').innerHTML =
        `<span class="status ${statusClass(jobCard.status)}">${escapeHtml(jobCard.status)}</span>`;
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
      renderWorkflowLinks('jobCardWorkflowLinks', jobCardWorkflowLinks);
      const details = [
        ['Appointment', jobCard.appointmentReference],
        ['Customer', jobCard.customerName],
        ['Contact', jobCard.customerContact],
        ['Appointment date', jobCard.appointmentDate],
        ['Fault description', jobCard.faultDescription],
        ['Complaint', jobCard.complaint],
        ['Service rendered', jobCard.serviceRendered],
        ['Technician', jobCard.technicianName],
        ['Job final status', jobCard.jobFinalStatus],
        ['Time consumed (hours)', jobCard.timeConsumedHours],
        ['Total cost (AED)', jobCard.totalCost],
        ['Service charge (AED)', jobCard.serviceCharge],
        ['Grand total (AED)', jobCard.grandTotal],
        ['Amount chargeable (AED)', jobCard.amountChargeable],
        ['Invoice no.', jobCard.invoiceNo],
        ['Delivery date', jobCard.deliveryDate],
        ['Legacy reference', jobCard.legacyReference],
        ['Finalized at', formatDate(jobCard.finalizedAt)],
        ['Finalized by', jobCard.finalizedBy],
        ['Created', formatDate(jobCard.createdAt)],
        ['Updated', formatDate(jobCard.updatedAt)],
      ];
      $('#jobCardDetailGrid').innerHTML = details
        .map(
          ([label, value]) =>
            `<div class="detail-item"><small>${escapeHtml(label)}</small><p>${escapeHtml(value || '—')}</p></div>`,
        )
        .join('');
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

  async function saveJobCardContent() {
    if (!currentJobCardId) return;
    const button = $('#saveJobCardContentButton');
    setBusy(button, true, 'Saving…');
    try {
      await apiRequest('/api/job-cards/' + encodeURIComponent(currentJobCardId), {
        method: 'PATCH',
        body: JSON.stringify(collectJobCardForm('jce')),
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

  async function updateJobCardStatus() {
    const form = $('#jobCardStatusForm');
    clearErrors(form);
    const status = $('#jobCardNextStatus').value;
    if (!status) {
      showFieldError(
        form,
        'jobCardNextStatus',
        'There are no valid next statuses for this job card.',
      );
      return;
    }
    const button = $('#updateJobCardStatusButton');
    setBusy(button, true, 'Updating…');
    try {
      await apiRequest('/api/job-cards/' + encodeURIComponent(currentJobCardId) + '/status', {
        method: 'PATCH',
        body: JSON.stringify({
          status,
          reason: $('#jobCardStatusReason').value.trim() || undefined,
        }),
      });
      await loadJobCardDetail(currentJobCardId);
      await loadJobCards();
      setMessage('#workspaceMessage', 'Service job-card status updated.', true);
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 403) {
        $('#jobCardActions').hidden = true;
        setMessage(
          '#workspaceMessage',
          'You are not authorized to update service job-card status.',
        );
      } else if (error.status === 404 || error.status === 409) {
        await loadJobCardDetail(currentJobCardId);
        await loadJobCards();
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

  function renderAppointments(appointments) {
    const body = $('#appointmentsBody');
    body.innerHTML = appointments
      .map(
        (appointment) =>
          `<tr><td><button class="table-link" type="button" data-appointment-id="${escapeHtml(appointment.id)}">${escapeHtml(appointment.appointmentReference)}</button></td><td><strong>${escapeHtml(appointment.customerName)}</strong><br>${escapeHtml(appointment.contactNumber)}</td><td>${escapeHtml(appointmentDateTime(appointment))}</td><td>${escapeHtml(appointment.technicianId || 'Unassigned')}</td><td><span class="status ${statusClass(appointment.status)}">${escapeHtml(appointment.status)}</span></td><td>${escapeHtml(appointment.region || '—')}</td></tr>`,
      )
      .join('');
    $('#appointmentsEmpty').hidden = appointments.length > 0;
    body
      .querySelectorAll('[data-appointment-id]')
      .forEach((button) =>
        button.addEventListener('click', () => loadAppointmentDetail(button.dataset.appointmentId)),
      );
  }

  function renderCalendar() {
    const range = calendarRange();
    const calendar = $('#appointmentCalendar');
    const canWrite = hasPermission('appointments.write');
    const days = calendarView === 'week' ? 7 : 42;
    const byDate = new Map();
    calendarAppointments.forEach((appointment) => {
      const key = appointment.appointmentDate;
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key).push(appointment);
    });
    const weekdayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      .map((day) => `<div class="calendar-cell-header">${day}</div>`)
      .join('');
    const cells = Array.from({ length: days }, (_, index) => {
      const date = shiftDate(range.start, index);
      const key = dateInputValue(date);
      const events = (byDate.get(key) || [])
        .sort((left, right) => String(left.customerName).localeCompare(String(right.customerName)))
        .map(
          (appointment) =>
            `<button class="calendar-event" type="button" data-calendar-appointment-id="${escapeHtml(appointment.id)}" draggable="${canWrite && appointment.status !== 'Completed' && appointment.status !== 'Cancelled'}" title="${escapeHtml(appointment.appointmentReference)}${canWrite ? '. Drag to reschedule.' : ''}"><strong>${escapeHtml(appointment.customerName)}</strong><span class="calendar-event-status">${escapeHtml(appointment.status)}</span></button>`,
        )
        .join('');
      const today = dateInputValue(new Date()) === key;
      return `<div class="calendar-cell${today ? ' calendar-cell-today' : ''}" data-calendar-date="${key}"><div class="calendar-cell-header">${date.getDate()}</div>${events}</div>`;
    }).join('');
    calendar.className = `calendar-grid calendar-${calendarView}`;
    calendar.setAttribute('aria-label', `${calendarTitle(range)} appointment calendar`);
    calendar.innerHTML = weekdayHeaders + cells;
    $('#calendarTitle').textContent = calendarTitle(range);
    $('#calendarMonthButton').setAttribute('aria-pressed', String(calendarView === 'month'));
    $('#calendarWeekButton').setAttribute('aria-pressed', String(calendarView === 'week'));
    $('#calendarMonthButton').className =
      calendarView === 'month' ? 'button button-secondary' : 'button button-outline';
    $('#calendarWeekButton').className =
      calendarView === 'week' ? 'button button-secondary' : 'button button-outline';
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
    calendar.querySelectorAll('[data-calendar-date]').forEach((cell) => {
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

  async function loadAppointments() {
    if (!hasPermission('appointments.read')) return;
    clearWorkspaceRecovery();
    const params = new URLSearchParams({ page: '1', pageSize: '50' });
    const search = $('#appointmentSearch').value.trim();
    const status = $('#appointmentStatusFilter').value;
    const from = $('#appointmentFrom').value;
    const to = $('#appointmentTo').value;
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    setMessage('#workspaceMessage', '', false);
    $('#appointmentsBody').innerHTML =
      '<tr><td colspan="6" class="empty-state">Loading appointments…</td></tr>';
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

  async function loadAppointmentDetail(id) {
    if (!hasPermission('appointments.read')) return;
    setMessage('#workspaceMessage', '', false);
    try {
      const result = await apiRequest('/api/appointments/' + encodeURIComponent(id));
      const appointment = result.appointment;
      currentAppointmentId = appointment.id;
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
      const details = [
        ['Customer', appointment.customerName],
        ['Contact', appointment.contactNumber],
        ['Email', appointment.customerEmail],
        ['Complaint', appointment.complaintReference],
        ['Appointment', appointmentDateTime(appointment)],
        ['Technician', appointment.technicianId || 'Unassigned'],
        ['Region', appointment.region],
        ['Address', appointment.address],
        ['Brand', appointment.brand],
        ['Model', appointment.model],
        ['Item code', appointment.itemCode],
        ['Warranty', appointment.jobWarranty],
        ['Sales order', appointment.salesOrderNumber],
        ['Salesman', appointment.salesman],
        ['B2B Branch / School', appointment.b2bBranchSchool],
        ['Site contact person', appointment.schoolContactPerson],
        ['Site contact number', appointment.schoolContactNumber],
        ['Customer number', appointment.customerNumber],
        ['Sub group', appointment.subGroup],
        ['Description', appointment.faultDescription],
        ['Created', formatDate(appointment.createdAt)],
        ['Updated', formatDate(appointment.updatedAt)],
      ];
      $('#appointmentDetailGrid').innerHTML = details
        .map(
          ([label, value]) =>
            `<div class="detail-item"><small>${escapeHtml(label)}</small><p>${escapeHtml(value || '—')}</p></div>`,
        )
        .join('');
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
      $('#appointmentDetail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
    const nextStatuses = complaintTransitions[complaint.status] || [];
    $('#complaintNextStatus').innerHTML = nextStatuses.length
      ? nextStatuses
          .map((status) => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`)
          .join('')
      : '<option value="">No further transitions</option>';
    $('#complaintNextStatus').disabled = nextStatuses.length === 0;
    $('#updateStatusButton').disabled = nextStatuses.length === 0;
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
      const details = [
        ['Customer', complaint.customerName],
        ['Type', complaint.customerType],
        ['Contact', complaint.contactNumber],
        ['Email', complaint.customerEmail],
        ['Region', complaint.region],
        ['Address', complaint.address],
        ['Brand', complaint.brand],
        ['Model', complaint.model],
        ['Serial or item code', complaint.serialOrItemCode],
        ['Sales order', complaint.salesOrderNumber],
        ['B2B Branch / School', complaint.b2bBranchSchool],
        ['Site contact person', complaint.schoolContactPerson],
        ['Site contact number', complaint.schoolContactNumber],
        ['Customer number', complaint.customerNumber],
        ['Description', complaint.description],
        ['Submitted', formatDate(complaint.submittedAt)],
        ['Updated', formatDate(complaint.updatedAt)],
      ];
      $('#detailGrid').innerHTML = details
        .map(
          ([label, value]) =>
            `<div class="detail-item"><small>${escapeHtml(label)}</small><p>${escapeHtml(value || '—')}</p></div>`,
        )
        .join('');
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
    if (!notes) {
      showFieldError(form, 'complaintNotes', 'Enter notes before saving.');
      return;
    }
    const button = $('#saveNotesButton');
    setBusy(button, true, 'Saving…');
    try {
      await apiRequest('/api/complaints/' + encodeURIComponent(currentComplaintId) + '/notes', {
        method: 'POST',
        body: JSON.stringify({ notes }),
      });
      await loadComplaintDetail(currentComplaintId);
      await loadComplaints();
      setMessage('#workspaceMessage', 'Notes saved.', true);
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
      showFieldError(
        form,
        'complaintNextStatus',
        'There are no valid next statuses for this complaint.',
      );
      return;
    }
    const button = $('#updateStatusButton');
    setBusy(button, true, 'Updating…');
    try {
      await apiRequest('/api/complaints/' + encodeURIComponent(currentComplaintId) + '/status', {
        method: 'PATCH',
        body: JSON.stringify({
          status,
          reason: $('#complaintStatusReason').value.trim() || undefined,
        }),
      });
      await loadComplaintDetail(currentComplaintId);
      await loadComplaints();
      setMessage('#workspaceMessage', 'Complaint status updated.', true);
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
  $('#applyComplaintFilters').addEventListener('click', loadComplaints);
  $('#applyJobCardFilters').addEventListener('click', loadJobCards);
  $('#applyAppointmentFilters').addEventListener('click', loadAppointments);
  $('#applyQuotationFilters').addEventListener('click', loadQuotations);
  $('#applyInspectionFilters').addEventListener('click', loadInspections);
  $('#applyWarrantyApprovalFilters').addEventListener('click', loadWarrantyApprovals);
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
    $('#warrantyApprovalCreatePanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  $('#cancelWarrantyApprovalCreateButton').addEventListener('click', () => {
    $('#warrantyApprovalCreatePanel').hidden = true;
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
  $('#jobCardStatusForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    await updateJobCardStatus();
  });
  $('#closeJobCardDetailButton').addEventListener('click', () => {
    $('#jobCardDetail').hidden = true;
  });
  $('#printJobCardButton').addEventListener('click', () => printJobCard(currentJobCard));
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
  $('#complaintSearch').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') loadComplaints();
  });
  $('#closeDetailButton').addEventListener('click', () => {
    $('#complaintDetail').hidden = true;
  });
  $('#signOutButton').addEventListener('click', () => signOut());

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
        '<h4>VAS Plan Pricing Table</h4>' +
        '<p class="form-note">Every plan’s rate, minimum fee, deductible, service fee, claims allowed and coverage &amp; terms &mdash; one row per plan, matching the workbook exactly. The 1-Year Damage Insurance service fee shown to customers is always computed from the claim-fee rule below instead of the text stored here.</p>';
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
        '<h4>Appliance Rates</h4><p class="form-note">Only the Base rate is editable — the 50+/150+/300+/500+ volume-tier rates are always derived from Base (Built-in Hob rounds down at the 50+ tier; every other appliance and tier rounds up), matching the workbook’s own formula.</p>';
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
      description: 'Admin entry for Delivery & Installation pricing.',
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
    'data:image/png;base64,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';

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
      '<p class="form-note">Enter the appliance selling price and pick a plan to see the customer-facing quote. Switch to "VAS Issued" to find and reprint any previously saved sale.</p>' +
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
      '<h4 style="margin-top: 1.5rem">Quick Price — All 4 Plans at Once</h4>' +
      '<p class="form-note">Same selling price above, every plan’s fee side by side.</p>' +
      '<div data-vc-quick></div>' +
      '<h4 style="margin-top: 1.5rem">Issue a VAS Sale — Customer Certificate</h4>' +
      '<div data-vc-sale></div>' +
      '</section>' +
      '<section data-vc-panel="issued" hidden>' +
      '<h4>VAS Issued</h4>' +
      '<p class="form-note">Every VAS sale saved from the calculator above. Print re-opens that exact certificate.</p>' +
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
      '<p class="form-note">Uses the plan and selling price selected above. Fill in the customer &amp; appliance details, save the sale, then print the certificate.</p>' +
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
    const messageHost = saleHost.querySelector('[data-vs-message]');
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

  // --- Rate Card ------------------------------------------------------------
  function printRateCardLineItemsTable(lineItems) {
    const rows = (lineItems || [])
      .map(
        (li) =>
          `<tr><td>${escapeHtml(li.sectionLabel)}</td><td>${escapeHtml(li.activityName)}</td><td class="num">${money(li.rate)} AED</td><td class="num">${escapeHtml(String(li.qty))}</td><td class="num">${money(li.rate * li.qty)} AED</td></tr>`,
      )
      .join('');
    return `<table><thead><tr><th>Section</th><th>Activity</th><th class="num">Rate</th><th class="num">Qty</th><th class="num">Subtotal</th></tr></thead><tbody>${
      rows || '<tr><td colspan="5" style="text-align:center;color:#888;">No lines</td></tr>'
    }</tbody></table>`;
  }

  function buildRateCardSaleCertificateBody(sale) {
    return `
      ${printDocHeadWithLogo('Rate Card Service Quotation', sale.rateCardSaleReference)}
      <h2>Quotation details</h2>
      ${printFieldGrid([
        ['Sale date', sale.saleDate],
        ['Client', sale.clientName],
        ['Contact number', sale.contactNumber],
        ['Site / location', sale.siteLocation],
        ['Contract ref.', sale.contractRef || sale.rateCardSaleReference],
      ])}
      <h2>Quote lines</h2>
      ${printRateCardLineItemsTable(sale.lineItems)}
      <div class="cert-feebox">
        <div class="fee">${money(sale.totalValue)} AED</div>
        <div>Total quotation value</div>
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

  function printRateCardSaleCertificate(sale) {
    if (!sale) return;
    const title = `Rate Card Quotation ${sale.rateCardSaleReference || ''}`;
    openPrintWindow(printDocumentShell(title, buildRateCardSaleCertificateBody(sale)));
  }

  function renderRateCardCalc(container, data) {
    const sections = data;
    const lineItems = [];
    container.innerHTML =
      '<p class="form-note">Build a quote line by line from the Rate Card admin’s own sections and activities, then read the total off the bottom row. Switch to "Rate Card Issued" to find and reprint any previously saved sale.</p>' +
      '<div class="vc-tab-nav" role="tablist" aria-label="Rate Card Calculator sections">' +
      '<button type="button" class="action-tab active" data-rc-tab="quote" role="tab" aria-selected="true">Quote Calculator</button>' +
      '<button type="button" class="action-tab" data-rc-tab="issued" role="tab" aria-selected="false">Rate Card Issued</button>' +
      '</div>' +
      '<div class="vc-tab-panels">' +
      '<section data-rc-panel="quote">' +
      '<div class="pc-split-grid">' +
      '<div class="detail-action-card">' +
      '<h4>Add a line</h4>' +
      '<div class="field-grid">' +
      calcField('Section', '<select data-rcc-section></select>') +
      calcField('Activity', '<select data-rcc-activity></select>') +
      calcField('Quantity', '<input type="number" min="0" step="1" value="1" data-rcc-qty />') +
      '</div>' +
      '<div class="form-footer">' +
      '<button class="button button-primary" type="button" data-rcc-add>Add to quote</button> ' +
      '<button class="button button-outline" type="button" data-rcc-clear>Clear</button>' +
      '</div>' +
      '</div>' +
      '<div class="detail-action-card pc-span-full">' +
      '<h4>Quote</h4>' +
      '<div data-rcc-table></div>' +
      '</div>' +
      '<div class="detail-action-card pc-span-full">' +
      '<h4>Issue a Rate Card Sale — Printable Quotation</h4>' +
      '<div data-rcc-sale></div>' +
      '</div>' +
      '</div>' +
      '</section>' +
      '<section data-rc-panel="issued" hidden>' +
      '<h4>Rate Card Issued</h4>' +
      '<p class="form-note">Every Rate Card sale saved from the calculator above. Print re-opens that exact quotation.</p>' +
      '<div data-rcc-issued></div>' +
      '</section>' +
      '</div>';

    const tabNav = container.querySelector('.vc-tab-nav');
    const panels = Array.from(container.querySelectorAll('[data-rc-panel]'));
    const issuedHost = container.querySelector('[data-rcc-issued]');
    tabNav.addEventListener('click', (event) => {
      const button = event.target.closest('.action-tab');
      if (!button) return;
      const target = button.dataset.rcTab;
      tabNav.querySelectorAll('.action-tab').forEach((tab) => {
        const active = tab === button;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      panels.forEach((panel) => {
        panel.hidden = panel.dataset.rcPanel !== target;
      });
      if (target === 'issued') {
        loadRateCardIssuedList(issuedHost);
      }
    });

    const sectionSelect = container.querySelector('[data-rcc-section]');
    const activitySelect = container.querySelector('[data-rcc-activity]');
    const qtyInput = container.querySelector('[data-rcc-qty]');
    const addButton = container.querySelector('[data-rcc-add]');
    const clearButton = container.querySelector('[data-rcc-clear]');
    const tableHost = container.querySelector('[data-rcc-table]');
    const saleHost = container.querySelector('[data-rcc-sale]');

    sectionSelect.innerHTML = sections
      .map((s, i) => '<option value="' + i + '">' + escapeHtml(s.label) + '</option>')
      .join('');

    function refreshActivities() {
      const section = sections[Number(sectionSelect.value)];
      activitySelect.innerHTML = (section?.activities || [])
        .map(
          (a, i) =>
            '<option value="' +
            i +
            '">' +
            escapeHtml(a.name) +
            ' (' +
            money(a.rate) +
            ' AED)</option>',
        )
        .join('');
    }
    sectionSelect.addEventListener('change', refreshActivities);
    refreshActivities();

    function renderTable() {
      if (!lineItems.length) {
        tableHost.innerHTML = '<p class="empty-state">No lines added yet.</p>';
        return;
      }
      const total = lineItems.reduce((sum, li) => sum + li.rate * li.qty, 0);
      tableHost.innerHTML =
        '<div class="table-wrap"><table><thead><tr>' +
        '<th>Section</th><th>Activity</th><th>Rate (AED)</th><th>Qty</th><th>Subtotal (AED)</th><th></th>' +
        '</tr></thead><tbody>' +
        lineItems
          .map(
            (li, i) =>
              '<tr><td>' +
              escapeHtml(li.sectionLabel) +
              '</td><td>' +
              escapeHtml(li.activityName) +
              '</td><td>' +
              money(li.rate) +
              '</td><td>' +
              li.qty +
              '</td><td>' +
              money(li.rate * li.qty) +
              '</td><td><button class="button button-outline" type="button" data-rcc-remove="' +
              i +
              '">Remove</button></td></tr>',
          )
          .join('') +
        '</tbody><tfoot><tr><td colspan="4"><strong>Total</strong></td><td colspan="2"><strong>' +
        money(total) +
        ' AED</strong></td></tr></tfoot></table></div>';
      tableHost.querySelectorAll('[data-rcc-remove]').forEach((btn) => {
        btn.addEventListener('click', () => {
          lineItems.splice(Number(btn.getAttribute('data-rcc-remove')), 1);
          renderTable();
        });
      });
    }

    // Empties the quote entirely -- used by the explicit Clear button and
    // automatically once a Rate Card sale has been saved, so the next
    // customer's quote starts from nothing (modification.md #43, same
    // Clear-must-actually-clear fix VAS/AMC got in #37/#39).
    function clearLineItems() {
      lineItems.length = 0;
      renderTable();
    }

    addButton.addEventListener('click', () => {
      const section = sections[Number(sectionSelect.value)];
      const activity = section?.activities?.[Number(activitySelect.value)];
      const qty = parseNumber(qtyInput.value);
      if (!section || !activity || qty <= 0) return;
      lineItems.push({
        sectionLabel: section.label,
        activityName: activity.name,
        rate: activity.rate,
        qty,
      });
      renderTable();
    });
    clearButton.addEventListener('click', clearLineItems);

    renderTable();
    renderRateCardSaleSection(saleHost, lineItems, clearLineItems, () => {
      // Keep the Rate Card Issued list in sync if it's the tab currently open.
      const issuedPanel = container.querySelector('[data-rc-panel="issued"]');
      if (issuedPanel && !issuedPanel.hidden) loadRateCardIssuedList(issuedHost);
    });
  }

  // Lists every saved rate_card_sales record (modification.md #43) so a
  // previously issued Rate Card sale can be found again and its quotation
  // reprinted, without anywhere else in the portal to look it up.
  async function loadRateCardIssuedList(host) {
    if (!hasPermission('rate_card_sale.read')) {
      host.innerHTML =
        '<p class="form-note">You don\'t have permission to view issued Rate Card sales.</p>';
      return;
    }
    host.innerHTML = '<p class="form-note">Loading issued Rate Card sales&hellip;</p>';
    try {
      const response = await apiRequest('/api/rate-card-sales?pageSize=100');
      const sales = response.rateCardSales || [];
      if (!sales.length) {
        host.innerHTML = '<p class="form-note">No Rate Card sales issued yet.</p>';
        return;
      }
      host.innerHTML =
        '<div class="table-wrap"><table><thead><tr>' +
        '<th>Reference</th><th>Issued</th><th>Client</th><th>Lines</th><th>Total value</th><th></th>' +
        '</tr></thead><tbody>' +
        sales
          .map(
            (sale) =>
              '<tr>' +
              '<td>' +
              escapeHtml(sale.rateCardSaleReference) +
              '</td><td>' +
              escapeHtml(formatDate(sale.createdAt)) +
              '</td><td>' +
              escapeHtml(sale.clientName || '—') +
              '</td><td>' +
              String((sale.lineItems || []).length) +
              '</td><td>' +
              money(sale.totalValue) +
              ' AED</td><td>' +
              '<button type="button" class="button button-outline" data-rcc-reprint="' +
              escapeHtml(sale.id) +
              '">Print</button>' +
              '</td></tr>',
          )
          .join('') +
        '</tbody></table></div>';
      host.querySelectorAll('[data-rcc-reprint]').forEach((button) => {
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            const detail = await apiRequest('/api/rate-card-sales/' + button.dataset.rccReprint);
            printRateCardSaleCertificate(detail.rateCardSale);
          } catch (error) {
            setMessage(
              '#workspaceMessage',
              'Could not load this Rate Card sale: ' + (error.message || 'unknown error'),
            );
          } finally {
            button.disabled = false;
          }
        });
      });
    } catch (error) {
      host.innerHTML = '<p class="form-note">Could not load issued Rate Card sales.</p>';
    }
  }

  // Fills in the "Issue a Rate Card Sale -- Printable Quotation" section
  // (modification.md #43): uses whichever quote lines are currently built
  // in the calculator above, saves a normalized rate_card_sales record,
  // then enables printing that saved record's quotation. After a
  // successful save, the quote lines and the sale form both reset for the
  // next customer, and onSaved() refreshes the "Rate Card Issued" tab if
  // it's open -- same treatment as renderVasSaleSection / renderAmcContractSection.
  function renderRateCardSaleSection(saleHost, lineItems, clearLineItems, onSaved) {
    if (!hasPermission('rate_card_sale.write')) {
      saleHost.innerHTML =
        '<p class="form-note">You don\'t have permission to issue Rate Card sales.</p>';
      return;
    }
    saleHost.innerHTML =
      '<p class="form-note">Uses the quote lines built above. Fill in the client details and save the sale, then print the quotation.</p>' +
      '<div class="field-grid">' +
      calcField('Client', '<input type="text" data-rs-client />') +
      calcField('Contact number', '<input type="text" data-rs-contact-number />') +
      calcField('Site / location', '<input type="text" data-rs-location />') +
      calcField(
        'Contract ref.',
        '<input type="text" data-rs-contract-ref />',
        'Optional — auto-generated if left blank',
      ) +
      '</div>' +
      '<p>' +
      '<button type="button" class="button button-primary" data-rs-save>Save Rate Card sale</button> ' +
      '<button type="button" class="button button-outline" data-rs-print disabled>Print quotation</button>' +
      '</p>' +
      '<div data-rs-message></div>';

    const saveButton = saleHost.querySelector('[data-rs-save]');
    const printButton = saleHost.querySelector('[data-rs-print]');
    const messageHost = saleHost.querySelector('[data-rs-message]');
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
      if (!lineItems.length) {
        messageHost.innerHTML =
          '<p class="form-note">Add at least one line to the quote above before saving.</p>';
        return;
      }
      const totalValue = lineItems.reduce((s, li) => s + li.rate * li.qty, 0);
      const field = (selector) => saleHost.querySelector(selector).value.trim();
      const payload = {
        clientName: field('[data-rs-client]') || undefined,
        contactNumber: field('[data-rs-contact-number]') || undefined,
        siteLocation: field('[data-rs-location]') || undefined,
        lineItems: lineItems.map((li) => ({
          sectionLabel: li.sectionLabel,
          activityName: li.activityName,
          rate: li.rate,
          qty: li.qty,
        })),
        totalValue,
        contractRef: field('[data-rs-contract-ref]') || undefined,
      };
      try {
        const response = await apiRequest('/api/rate-card-sales', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        savedSale = response.rateCardSale;
        messageHost.innerHTML =
          '<p class="form-note">Saved as <strong>' +
          escapeHtml(savedSale.rateCardSaleReference) +
          '</strong> and added to the "Rate Card Issued" tab. Print below, or reprint it any time from Rate Card Issued. The quote has been reset for the next customer.</p>';
        printButton.disabled = false;
        clearSaleFormInputs();
        clearLineItems();
        onSaved();
      } catch (error) {
        messageHost.innerHTML =
          '<p class="form-note">Could not save the Rate Card sale: ' +
          escapeHtml(error.message || 'unknown error') +
          '</p>';
      }
    });

    printButton.addEventListener('click', () => {
      if (!savedSale) return;
      printRateCardSaleCertificate(savedSale);
    });
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
      '<p class="form-note">Add each appliance type covered by this contract one at a time (nothing is pre-filled from the admin catalog), enter its quantity and unit value, then read the Basic RM / Standard PMC / Premium PMC contract prices below. Saving stores all 3 plans together; you pick which one to print afterwards. Switch to "AMC Issued" to find and reprint any previously saved contract.</p>' +
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
      '<h4>AMC Issued</h4>' +
      '<p class="form-note">Every AMC contract saved from the calculator above, with all 3 plans’ numbers stored. Pick a plan and Print to generate that plan’s certificate.</p>' +
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
        '<th>Reference</th><th>Issued</th><th>Client</th><th>Total appliances</th><th>Plan to print</th><th>Price incl. VAT</th><th></th>' +
        '</tr></thead><tbody>' +
        contracts
          .map((c) => {
            const plans = c.plans || [];
            const defaultPlan = plans[plans.length - 1] || plans[0];
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
      '<p class="form-note">Fill in the client &amp; site details and save the contract — all 3 plans’ numbers are stored together, and you pick which one to print below (or any time from "AMC Issued").</p>' +
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
    const addons = data.addons;
    const teamCapacity = data.techCount * data.hoursDay;
    const lineItems = [];
    // The most recently computed line rows (null whenever there are no
    // lines) -- read by the Issue-a-Sale section below when Save is
    // clicked, so it always saves the exact numbers currently on screen,
    // same pattern as AMC's lastRows (modification.md #39).
    let lastComputed = null;

    container.innerHTML =
      '<p class="form-note">Add project line items (region + appliance + quantity), then read the total project price, cost and margin off the bottom row. Matches the workbook’s “Project Pricing Calculator” section exactly. Switch to "Thomson Issued" to find and reprint any previously saved sale.</p>' +
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
      '<h4>Transport</h4>' +
      calcField(
        'Customer transport share %',
        '<input type="number" min="0" max="100" step="1" value="0" data-tcc-transport-share />',
      ) +
      '<p class="form-note">The rest of the transport cost is absorbed by us (matches the workbook’s default of 0%).</p>' +
      '</div>' +
      '<div class="detail-action-card pc-span-full">' +
      '<h4>Quote</h4>' +
      '<div data-tcc-table></div>' +
      '</div>' +
      '<div class="detail-action-card pc-span-full">' +
      '<h4>Issue a Thomson Sale — Printable Quotation</h4>' +
      '<div data-tcc-sale></div>' +
      '</div>' +
      '</div>' +
      '</section>' +
      '<section data-th-panel="issued" hidden>' +
      '<h4>Thomson Issued</h4>' +
      '<p class="form-note">Every Thomson sale saved from the calculator above. Print re-opens that exact quotation.</p>' +
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
        '<div class="table-wrap"><table style="table-layout: fixed"><thead><tr>' +
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
      '<p class="form-note">Uses the project lines built above. Fill in the client details and save the sale, then print the quotation.</p>' +
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

  const PRICING_CALC_PAGES = {
    'vas-calc': {
      navId: 'vasCalcNav',
      workspaceId: 'vasCalcWorkspace',
      heading: 'VAS Quote Calculator',
      description: 'Stand-alone quote calculator, reading VAS Price Banding & Split’s admin data.',
      domains: ['vas_price_bands', 'vas_pricing_params'],
      render: (root, dataByDomain) => renderVasCalc(root, dataByDomain),
    },
    'rate-card-calc': {
      navId: 'rateCardCalcNav',
      workspaceId: 'rateCardCalcWorkspace',
      heading: 'Rate Card Calculator',
      description: 'Stand-alone quote calculator, reading Rate Card Admin’s admin data.',
      domains: ['rate_card'],
      render: (root, dataByDomain) => renderRateCardCalc(root, dataByDomain.rate_card),
    },
    'amc-calc': {
      navId: 'amcCalcNav',
      workspaceId: 'amcCalcWorkspace',
      heading: 'AMC Quote Calculator',
      description: 'Stand-alone quote calculator, reading AMC Admin Rate Section’s admin data.',
      domains: ['amc_pricing'],
      render: (root, dataByDomain) => renderAmcCalc(root, dataByDomain.amc_pricing),
    },
    'thomson-calc': {
      navId: 'thomsonCalcNav',
      workspaceId: 'thomsonCalcWorkspace',
      heading: 'Thomson Quote Calculator',
      description: 'Stand-alone quote calculator, reading Thomson Pricing Admin’s admin data.',
      domains: ['thomson_pricing'],
      render: (root, dataByDomain) => renderThomsonCalc(root, dataByDomain.thomson_pricing),
    },
  };

  async function activatePricingCalcMode(mode) {
    const page = PRICING_CALC_PAGES[mode];
    if (!page) return;
    if (!hasPermission('pricing_config.read')) return;
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
    $('#pricingCurrencyNote').hidden = false;

    const root = document.querySelector('#' + page.workspaceId + ' [data-calc-root]');
    if (!root) return;
    root.innerHTML = '<p class="form-note">Loading current values&hellip;</p>';
    try {
      const dataByDomain = await calcFetchDomains(page.domains);
      page.render(root, dataByDomain);
    } catch (error) {
      root.innerHTML =
        '<p class="form-note">Could not load current values for this calculator.</p>';
    }
  }

  $('#vasCalcNav')?.addEventListener('click', () => setWorkspaceMode('vas-calc'));
  $('#rateCardCalcNav')?.addEventListener('click', () => setWorkspaceMode('rate-card-calc'));
  $('#amcCalcNav')?.addEventListener('click', () => setWorkspaceMode('amc-calc'));
  $('#thomsonCalcNav')?.addEventListener('click', () => setWorkspaceMode('thomson-calc'));

  initJobCardForms();
  initQuotationForms();
  initInspectionForms();
  initThemeAndPaletteControls();
  initUserMenu();
  initSidebarToggle();
  restoreSession();
})();
