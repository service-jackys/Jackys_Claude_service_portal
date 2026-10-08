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
    $('#amcCalcNav').hidden = !canReadPricingConfig;
    $('#thomsonCalcNav').hidden = !canReadPricingConfig;
    const canReadRevenue = hasPermission('revenue_dashboard.read');
    $('#revenueDashNav').hidden = !canReadRevenue;
    $('#budgetDashNav').hidden = !canReadRevenue;
    $('#budgetVarNav').hidden = !canReadRevenue;
    $('#financeNav').hidden = !canReadRevenue;
    $('#pricingMastersNav').hidden = !canReadPricingConfig;
    $('#reportsNav').hidden = !hasPermission('reports.read');
    $('#rateCardNav').hidden = !hasPermission('rate_card.view');
    $('#activityLogNav').hidden = !hasPermission('audit.read');
    $('#rolesNav').hidden = !hasPermission('admin.users');
    $('#stockMasterNav').hidden = !hasPermission('stock.write');
    $('#walkInNav').hidden = !hasPermission('service_job_card.write');
    $('#awaitingDraftsNav').hidden = !hasPermission('scheduler.read');
    $('#dailyListNav').hidden = !hasPermission('appointments.read');
    $('#invoicesNav').hidden = !hasPermission('service_job_card.read');
    $('#billingNav').hidden = !hasPermission('service_job_card.read');
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
    'WIP',
    'Spare pending',
    'BER',
    'Rejected',
    'Repair Completed',
    'Delivered',
    'Cancelled',
  ];
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
      <div class="field-grid">
        <div class="field"><label for="${prefix}Date">Job card date</label><input type="date" id="${prefix}Date"></div>
        <div class="field"><label for="${prefix}CustomerName">Customer name</label><input type="text" id="${prefix}CustomerName" maxlength="200"></div>
        <div class="field"><label for="${prefix}CustomerContact">Customer contact</label><input type="text" id="${prefix}CustomerContact" maxlength="50"></div>
        <div class="field"><label for="${prefix}CustomerAddress">Customer address</label><input type="text" id="${prefix}CustomerAddress" maxlength="500"></div>
        <div class="field"><label for="${prefix}ItemDescription">Item description</label><input type="text" id="${prefix}ItemDescription" maxlength="300"></div>
        <div class="field"><label for="${prefix}ModelNo">Model no. (item code) <span class="tooltip" tabindex="0"><span class="tooltip-icon" aria-hidden="true">i</span><span class="tooltip-bubble" role="tooltip">Type an item code or description to search the stock master, or pick a brand first to list only its models. Picking a result fills brand, description, group and sub group.</span></span></label><input type="text" id="${prefix}ModelNo" maxlength="120" autocomplete="off"></div>
        <div class="field"><label for="${prefix}Brand">Brand</label><input type="text" id="${prefix}Brand" maxlength="120" autocomplete="off"></div>
        <div class="field"><label for="${prefix}MainGroup">Main group</label><input type="text" id="${prefix}MainGroup" maxlength="120"></div>
        <div class="field"><label for="${prefix}GroupName">Group</label><input type="text" id="${prefix}GroupName" maxlength="120"></div>
        <div class="field"><label for="${prefix}SubGroup">Sub group</label><input type="text" id="${prefix}SubGroup" maxlength="120"></div>
        <div class="field"><label for="${prefix}SerialNo">Serial number</label><input type="text" id="${prefix}SerialNo" maxlength="120"></div>
        <div class="field"><label for="${prefix}PurchaseDate">Purchase date</label><input type="date" id="${prefix}PurchaseDate"></div>
        <input type="hidden" id="${prefix}ItemCode">
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
        <div class="field"><label for="${prefix}ServiceCharge">Service charge (AED)</label><input type="number" step="0.01" min="0" id="${prefix}ServiceCharge"><span class="form-note" id="${prefix}ServiceChargeNote" hidden>Major appliances (MDA) are charged the rate card &ldquo;MDA &ndash; Standard&rdquo; amount, in or out of warranty.</span></div>
        <div class="field"><label for="${prefix}GrandTotal">Grand total (AED)</label><input type="text" id="${prefix}GrandTotal" readonly></div>
        <div class="field"><label for="${prefix}AmountChargeable">Amount chargeable (AED)</label><input type="number" step="0.01" min="0" id="${prefix}AmountChargeable"></div>
      </div>
      <div class="field-grid">
        <div class="field"><label for="${prefix}InvoiceNo">Invoice no.</label><input type="text" id="${prefix}InvoiceNo" maxlength="120"></div>
        <div class="field"><label for="${prefix}DeliveryDate">Delivery date</label><input type="date" id="${prefix}DeliveryDate"></div>
        <div class="field"><label for="${prefix}JobFinalStatus">Job status</label><select id="${prefix}JobFinalStatus">${jobFinalStatusOptions.map((status) => `<option value="${status}">${status}</option>`).join('')}</select><span class="form-note">The only status for this job. Repair Completed, then Delivered once the customer has the item. Delivered locks the card; only an admin can edit it after that.</span></div>
      </div>
      <h5>Warranty and billing</h5>
      <div class="field-grid">
        <div class="field"><label for="${prefix}FinalWarrantyStatus">Final warranty status</label><select id="${prefix}FinalWarrantyStatus"><option value="">Same as registered warranty</option><option>In Warranty</option><option>Out Warranty</option></select><span class="form-note">Set after inspection. If it differs from the registered warranty (for example customer-induced damage or misuse), billing follows this one.</span></div>
        <div class="field" id="${prefix}WarrantyReasonField" hidden><label for="${prefix}WarrantyOverrideReason">Reason for the change</label><input type="text" id="${prefix}WarrantyOverrideReason" maxlength="1000" placeholder="Required when the final warranty differs"></div>
        <div class="field"><label for="${prefix}PaymentBy">Payment by</label><select id="${prefix}PaymentBy"><option value="">Automatic</option><option>Sales channel</option><option>Customer</option></select><span class="form-note">In warranty is always billed to the sales channel. For out of warranty choose who pays.</span></div>
        <div class="field"><label for="${prefix}BillToChannel">Bill to channel</label><select id="${prefix}BillToChannel"><option value="">Auto (billing rule / sales channel)</option></select></div>
        <div class="field"><label for="${prefix}BillingJobType">Job type</label><input type="text" id="${prefix}BillingJobType" readonly></div>
        <div class="field"><label for="${prefix}InvoiceDate">Invoice date</label><input type="date" id="${prefix}InvoiceDate"></div>
        <div class="field"><label for="${prefix}PaymentMode">Payment mode</label><select id="${prefix}PaymentMode"><option value="">Select mode</option><option>Cash</option><option>Online</option><option>Bank transfer</option><option>Card</option></select></div>
        <div class="field"><label for="${prefix}PaymentReference">Payment reference</label><input type="text" id="${prefix}PaymentReference" maxlength="200" placeholder="Receipt or transaction no."></div>
        <div class="field"><label class="check-label"><input type="checkbox" id="${prefix}PaymentConfirmed"> Payment received and confirmed</label><span class="form-note" id="${prefix}PaymentConfirmedNote">A job paid by the customer can be delivered only after the invoice number is recorded and the payment is confirmed.</span></div>
      </div>
      <div class="field-grid">
        <div class="field"><label for="${prefix}CustomerType">Customer type</label><select id="${prefix}CustomerType"><option value="">Select a type</option><option value="B2C">B2C (Direct customer)</option><option value="B2B">B2B (Corporate client)</option></select></div>
        <div class="field"><label for="${prefix}CustomerEmail">Email address</label><input type="email" id="${prefix}CustomerEmail" maxlength="320"></div>
        <div class="field"><label for="${prefix}Region">Region</label><select id="${prefix}Region"><option value="">Select region</option>${REGION_LIST.map((r) => `<option>${r}</option>`).join('')}</select></div>
        <div class="field"><label for="${prefix}B2bBranchSchool">B2B Branch / School</label><input type="text" id="${prefix}B2bBranchSchool" maxlength="300"></div>
        <div class="field"><label for="${prefix}SalesOrderNumber">Sales order no.</label><input type="text" id="${prefix}SalesOrderNumber" maxlength="100"></div>
      </div>
      <div class="field-grid">
        <div class="field"><label for="${prefix}SchoolContactPerson">Site contact person</label><input type="text" id="${prefix}SchoolContactPerson" maxlength="500"></div>
        <div class="field"><label for="${prefix}SchoolContactNumber">Site contact number</label><input type="text" id="${prefix}SchoolContactNumber" maxlength="100"></div>
        <div class="field"><label for="${prefix}CustomerNumber">Customer number</label><input type="text" id="${prefix}CustomerNumber" maxlength="100"></div>
        <div class="field"><label for="${prefix}LegacyReference">Legacy reference</label><input type="text" id="${prefix}LegacyReference" maxlength="120" placeholder="Reference from the old system, if any"></div>
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

  function refreshBillingPreview(prefix) {
    const registered = normalizeWarrantyText($(`#${prefix}WarrantyStatus`).value);
    const finalValue = $(`#${prefix}FinalWarrantyStatus`).value;
    const effective = finalValue || registered;
    const changed = Boolean(finalValue && registered && finalValue !== registered);
    $(`#${prefix}WarrantyReasonField`).hidden = !changed;
    const paymentBy = $(`#${prefix}PaymentBy`);
    paymentBy.disabled = effective === 'In Warranty';
    if (effective === 'In Warranty') paymentBy.value = 'Sales channel';
    // Payment mode, reference and confirmation only apply when the customer pays.
    const customerPays =
      paymentBy.value === 'Customer' ||
      (!paymentBy.value &&
        effective === 'Out Warranty' &&
        $(`#${prefix}CustomerType`).value === 'B2C');
    ['PaymentMode', 'PaymentReference', 'PaymentConfirmed'].forEach((name) => {
      const input = $(`#${prefix}${name}`);
      input.disabled = !customerPays;
      input.title = customerPays ? '' : 'Only used when the customer pays';
    });
    refreshMdaServiceCharge(prefix);
    $(`#${prefix}BillingJobType`).value =
      effective === 'In Warranty'
        ? 'CSIJW - Warranty repair'
        : effective === 'Out Warranty'
          ? 'CSIJO - Non-warranty repair'
          : 'Set the warranty status';
  }

  function initJobCardForms() {
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
      ].forEach((selector) =>
        $(selector).addEventListener('input', () => refreshBillingPreview(prefix)),
      );
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
    $(`#${prefix}MainGroup`).value = content.mainGroup || '';
    $(`#${prefix}GroupName`).value = content.groupName || '';
    $(`#${prefix}SubGroup`).value = content.subGroup || '';
    $(`#${prefix}SerialNo`).value = content.serialNo || '';
    $(`#${prefix}PurchaseDate`).value = content.purchaseDate
      ? content.purchaseDate.slice(0, 10)
      : '';
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
    $(`#${prefix}PeriodFrom`).value = toDateTimeLocal(content.periodFrom);
    $(`#${prefix}PeriodTo`).value = toDateTimeLocal(content.periodTo);
    $(`#${prefix}ServiceCharge`).value = content.serviceCharge || 0;
    $(`#${prefix}AmountChargeable`).value = content.amountChargeable ?? '';
    $(`#${prefix}InvoiceNo`).value = content.invoiceNo || '';
    $(`#${prefix}DeliveryDate`).value = content.deliveryDate
      ? content.deliveryDate.slice(0, 10)
      : '';
    $(`#${prefix}JobFinalStatus`).value = content.jobFinalStatus || 'WIP';
    $(`#${prefix}FinalWarrantyStatus`).value = content.finalWarrantyStatus || '';
    $(`#${prefix}WarrantyOverrideReason`).value = content.warrantyOverrideReason || '';
    $(`#${prefix}PaymentBy`).value = content.paymentBy || '';
    populateSelectOptions(
      `#${prefix}BillToChannel`,
      salesChannelOptions,
      'Auto (billing rule / sales channel)',
      content.billToOverridden ? content.billToChannel || '' : '',
    );
    $(`#${prefix}InvoiceDate`).value = content.invoiceDate ? content.invoiceDate.slice(0, 10) : '';
    $(`#${prefix}PaymentMode`).value = content.paymentMode || '';
    $(`#${prefix}PaymentReference`).value = content.paymentReference || '';
    $(`#${prefix}PaymentConfirmed`).checked = Boolean(content.paymentConfirmedAt);
    $(`#${prefix}PaymentConfirmed`).dataset.saved = content.paymentConfirmedAt ? '1' : '';
    $(`#${prefix}PaymentConfirmedNote`).textContent = content.paymentConfirmedAt
      ? `Confirmed ${new Date(content.paymentConfirmedAt).toLocaleString()}. Untick to undo a mistake.`
      : 'A job paid by the customer can be delivered only after the invoice number is recorded and the payment is confirmed.';
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
      invoiceNo: $(`#${prefix}InvoiceNo`).value.trim() || undefined,
      deliveryDate: $(`#${prefix}DeliveryDate`).value || undefined,
      jobFinalStatus: $(`#${prefix}JobFinalStatus`).value || undefined,
      finalWarrantyStatus: $(`#${prefix}FinalWarrantyStatus`).value || undefined,
      warrantyOverrideReason: $(`#${prefix}WarrantyOverrideReason`).value.trim() || undefined,
      paymentBy: $(`#${prefix}PaymentBy`).value || undefined,
      billToChannel: $(`#${prefix}BillToChannel`).value,
      invoiceDate: $(`#${prefix}InvoiceDate`).value || undefined,
      paymentMode: $(`#${prefix}PaymentMode`).value || undefined,
      paymentReference: $(`#${prefix}PaymentReference`).value.trim() || undefined,
      // Only send a confirmation when it changed, so saving an unrelated edit
      // never re-stamps who confirmed the payment.
      paymentConfirmed:
        $(`#${prefix}PaymentConfirmed`).checked ===
        Boolean($(`#${prefix}PaymentConfirmed`).dataset.saved)
          ? undefined
          : $(`#${prefix}PaymentConfirmed`).checked,
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
        ['Job type', jobCard.billingJobType],
        ['Payment by', jobCard.paymentBy],
        ['Technician', jobCard.technicianName],
        ['Salesman', jobCard.salesman],
        ['Sales channel', jobCard.salesChannel],
        ['Job final status', jobCard.jobFinalStatus],
        ['Status', jobCard.jobFinalStatus || jobCard.status],
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
        ['Customer type', jobCard.customerType],
        ['Region', jobCard.region],
        ['B2B branch / school', jobCard.b2bBranchSchool],
        ['Sales order no.', jobCard.salesOrderNumber],
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

  // Filter value for completed appointments that have no job card yet. They
  // are not job cards, so the list switches to /api/job-cards/awaiting.
  const AWAITING_JOB_CARD_FILTER = 'awaiting-job-card';

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
        }</td><td><button class="table-link" type="button" data-appointment-id="${escapeHtml(row.appointmentId)}">${escapeHtml(row.appointmentReference)}</button>${row.complaintReference ? '<br><small>' + escapeHtml(row.complaintReference) + '</small>' : ''}</td><td><strong>${escapeHtml(row.customerName)}</strong><br>${escapeHtml(row.contactNumber || '')}${item ? '<br><small>' + escapeHtml(item) + '</small>' : ''}</td><td>${escapeHtml(formatDate(row.appointmentDate))}${row.technicianName ? '<br><small>' + escapeHtml(row.technicianName) + '</small>' : ''}</td><td><span class="status status-in-progress">Awaiting job card</span></td></tr>`;
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
          `<tr><td><button class="table-link" type="button" data-job-card-id="${escapeHtml(jobCard.id)}">${escapeHtml(jobCard.jobCardReference)}</button></td><td><button class="table-link" type="button" data-appointment-id="${escapeHtml(jobCard.appointmentId)}">${escapeHtml(jobCard.appointmentReference)}</button></td><td><strong>${escapeHtml(jobCard.customerName)}</strong><br>${escapeHtml(jobCard.contactNumber)}</td><td>${escapeHtml(appointmentDateTime(jobCard))}</td><td><span class="status ${statusClass(jobCard.jobFinalStatus || jobCard.status)}">${escapeHtml(jobCard.jobFinalStatus || jobCard.status)}</span></td></tr>`,
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
    const awaiting = status === AWAITING_JOB_CARD_FILTER;
    if (status && !awaiting) params.set('status', status);
    $('#jobCardsBody').innerHTML =
      '<tr><td colspan="5" class="empty-state">Loading service job cards…</td></tr>';
    try {
      if (awaiting) {
        const awaitingResult = await apiRequest('/api/job-cards/awaiting?' + params);
        lastLoadedJobCards = [];
        renderAwaitingJobCards(awaitingResult.appointments || []);
        return;
      }
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
    clearItemPickerMarks($('#newComplaintForm'));
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
      warrantyClassification: $('#newComplaintWarranty').value,
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
    if (!hasPermission('service_job_card.read')) {
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

  function renderKanban() {
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
    return (
      ['Delivered', 'Cancelled'].includes(jobCard.jobFinalStatus) ||
      jobCard.status === 'Cancelled' ||
      (jobCard.status === 'Completed' && ['WIP', 'Spare pending'].includes(jobCard.jobFinalStatus))
    );
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
  }

  function renderJobCardGuide(jobCard) {
    const box = $('#jobCardNextStep');
    const guides = {
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
        text: 'Enter the invoice number and delivery date, hand the item to the customer, then set the job status to Delivered.',
      },
      BER: {
        title: 'Beyond economical repair',
        text: 'Return the item to the customer, then set the job status to Delivered to close the job.',
        warn: true,
      },
      Rejected: {
        title: 'Job rejected',
        text: 'Return the item to the customer, then set the job status to Delivered to close the job.',
        warn: true,
      },
      Delivered: {
        title: 'Delivered to customer',
        text: isAdminUser()
          ? 'This job is closed. As an administrator you can still edit it.'
          : 'This job is closed and locked. Only an administrator can edit it.',
        done: true,
      },
      Cancelled: {
        title: 'Job cancelled',
        text: isAdminUser()
          ? 'This job is cancelled. As an administrator you can still edit it.'
          : 'This job is cancelled and locked. Only an administrator can edit it.',
        warn: true,
      },
    };
    const guide = guides[jobCard.jobFinalStatus];
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

  function renderJobCardDetailSections(jobCard) {
    const dateOnly = (value) => (value ? String(value).slice(0, 10) : '');
    renderDetailSections('#jobCardDetailGrid', [
      {
        strip: [
          ['Job status', jobCard.jobFinalStatus, 'pill'],
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
          ['Invoice no.', jobCard.invoiceNo],
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
      renderJobCardGuide(jobCard);
      $('#jobCardDetailHeading').textContent =
        jobCard.jobCardReference || 'Service job card details';
      $('#jobCardDetailStatus').innerHTML =
        `<span class="status ${statusClass(jobCard.jobFinalStatus)}">${escapeHtml(jobCard.jobFinalStatus)}</span>`;
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
      renderJobCardDetailSections(jobCard);
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

  function appointmentDateTime(appointment) {
    if (!appointment?.appointmentDate) return '—';
    const date = localDate(appointment.appointmentDate);
    return Number.isNaN(date.valueOf())
      ? appointment.appointmentDate
      : date.toLocaleDateString(undefined, { dateStyle: 'medium' });
  }

  function renderAppointments(appointments) {
    const body = $('#appointmentsBody');
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
        const tech = appointment.technicianName
          ? `<span class="ap-tech"><b aria-hidden="true">${escapeHtml(initials(appointment.technicianName))}</b>${escapeHtml(appointment.technicianName)}</span>`
          : '<span class="ap-none">Unassigned</span>';
        return `<tr class="row-${key}"><td><button class="table-link" type="button" data-appointment-id="${escapeHtml(appointment.id)}">${escapeHtml(appointment.appointmentReference)}</button></td><td><span class="ap-name">${escapeHtml(appointment.customerName)}</span>${appointment.contactNumber ? `<span class="ap-sub">${escapeHtml(appointment.contactNumber)}</span>` : ''}</td><td class="ap-date">${escapeHtml(appointmentDateTime(appointment))}</td><td>${tech}</td><td><span class="ap-pill st-${key}">${escapeHtml(appointment.status)}</span></td><td>${escapeHtml(appointment.region || '—')}</td></tr>`;
      })
      .join('');
    $('#appointmentListCount').textContent = appointments.length ? String(appointments.length) : '';
    $('#appointmentsEmpty').hidden = appointments.length > 0;
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
      return `<div class="calendar-cell${key === todayKey ? ' calendar-cell-today' : ''}${outside ? ' is-outside' : ''}" data-calendar-date="${key}"><span class="cal-day">${date.getDate()}</span>${events}${more}</div>`;
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
    calendar.querySelectorAll('[data-cal-more]').forEach((button) =>
      button.addEventListener('click', () => {
        calendarCursor = localDate(button.dataset.calMore);
        calendarView = 'week';
        loadCalendar();
      }),
    );
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
      renderDetailSections('#appointmentDetailGrid', [
        {
          strip: [
            ['Status', appointment.status, 'pill'],
            ['Date', appointmentDateTime(appointment)],
            ['Technician', appointment.technicianName || 'Unassigned'],
            ['Warranty', appointment.jobWarranty],
            ['Complaint', appointment.complaintReference],
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
  ]);
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
    'inspectionWorkspace',
    'inspectionTabs',
    'createInspectionButton',
    'cancelInspectionCreateButton',
    'inspectionCreatePanel',
  );
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
      ? 'You are signed in with a temporary password. Choose your own (at least 12 characters) to continue.'
      : 'Use at least 12 characters. Other devices signed in with your old password are signed out.';
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
    if (next.length < 12) {
      showFieldError(form, 'pwNew', 'Use at least 12 characters.');
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
    if (value.length < 12) {
      showFieldError(form, 'resetPasswordValue', 'Use at least 12 characters.');
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
      '<div><h4>Transport per trip (AED)</h4><table class="rc-table"><thead><tr><th>Region</th><th class="num">Round trip</th></tr></thead><tbody>' +
      transport +
      '</tbody></table><p class="form-note">' +
      (withTransport
        ? 'Transport is always added to Delivery &amp; Installation quotes.'
        : 'Transport is added only when the job needs a separate trip.') +
      '</p></div></div>' +
      '<p class="form-note">Minimum rate per unit: ' +
      money(dandi.minUnitRate) +
      ' AED &middot; up to ' +
      dandi.maxUnits +
      ' units per quote.</p></section>'
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

  function smReport(upload) {
    const report = upload.report || {};
    const parts = [];
    parts.push(
      '<p class="sm-summary"><strong>' +
        escapeHtml(upload.channel) +
        '</strong> · ' +
        escapeHtml(upload.fileName) +
        ' · ' +
        upload.rowCount +
        ' rows · ' +
        upload.itemCount +
        ' unique items · <strong>' +
        upload.newItems +
        ' new</strong> · ' +
        upload.changedItems +
        ' changed' +
        (report.conflictCount
          ? ' (' + report.conflictCount + ' differ from another channel)'
          : '') +
        '</p>',
    );
    if (report.changes && report.changes.length) {
      parts.push(
        '<details class="sm-details"' +
          (report.conflictCount ? ' open' : '') +
          '><summary>Changed items (' +
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
                (change.conflict
                  ? ' <span class="sm-tag">was ' + escapeHtml(change.previousChannel) + '</span>'
                  : '') +
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

  async function renderStockMasterPage(root) {
    root.innerHTML = '<p class="form-note">Loading&hellip;</p>';
    let status;
    try {
      status = await apiRequest('/api/stock/status');
    } catch (error) {
      root.innerHTML = '<p class="form-note pg-error">' + escapeHtml(error.message) + '</p>';
      return;
    }
    const channelNames = {
      JDI: 'JDI · Jacky’s Distribution & Innovation',
      JMS: 'JMS · Jacky’s Electronics (Corporate)',
      TGE: 'TGE · Thomson Gulf Electronics',
    };
    root.innerHTML =
      '<div class="rcv-banner"><strong>Stock master</strong><span>' +
      status.totalItems +
      ' unique items · ' +
      status.searchableItems +
      ' searchable (MDA and SDA)</span></div>' +
      '<div class="sm-channels">' +
      status.channels
        .map(
          (channel) =>
            '<div class="sm-channel"><h4>' +
            escapeHtml(channel.channel) +
            '</h4>' +
            (channel.lastUpload
              ? '<p>' +
                channel.itemCount +
                ' items · ' +
                channel.positionRows +
                ' location rows</p><p class="form-note">Uploaded ' +
                escapeHtml(smDate(channel.lastUpload.uploadedAt)) +
                (channel.lastUpload.uploadedByName
                  ? ' by ' + escapeHtml(channel.lastUpload.uploadedByName)
                  : '') +
                '</p>' +
                (channel.notSeenCount
                  ? '<p class="sm-warn">' +
                    channel.notSeenCount +
                    ' item(s) not in the latest file (kept)</p>'
                  : '')
              : '<p class="form-note">No upload yet.</p>') +
            '</div>',
        )
        .join('') +
      '</div>' +
      '<section class="detail-action-card"><h4>Upload ERP stock file</h4>' +
      '<p class="form-note">Choose the channel, then the “Current Stock Valuation” .xlsx exported from the ERP. ' +
      'Each upload replaces that channel’s location rows and updates the unique item list; items that are no longer in the file are kept.</p>' +
      '<div class="sm-upload"><select data-sm-channel aria-label="Channel">' +
      '<option value="">Select channel…</option>' +
      Object.entries(channelNames)
        .map(([code, label]) => '<option value="' + code + '">' + escapeHtml(label) + '</option>')
        .join('') +
      '</select><input type="file" accept=".xlsx" data-sm-file />' +
      '<button class="button button-primary" type="button" data-sm-upload>Upload</button></div>' +
      '<p class="form-note" data-sm-msg role="status"></p><div data-sm-report></div></section>' +
      '<section class="detail-action-card"><h4>Recent uploads</h4>' +
      (status.recentUploads.length
        ? status.recentUploads
            .map(
              (upload) =>
                '<details class="sm-details"><summary>' +
                escapeHtml(upload.channel) +
                ' · ' +
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
    const button = root.querySelector('[data-sm-upload]');
    const msg = root.querySelector('[data-sm-msg]');
    button.addEventListener('click', async () => {
      const channel = root.querySelector('[data-sm-channel]').value;
      const file = root.querySelector('[data-sm-file]').files[0];
      if (!channel) {
        msg.textContent = 'Select the channel this file belongs to.';
        return;
      }
      if (!file) {
        msg.textContent = 'Choose the .xlsx file first.';
        return;
      }
      button.disabled = true;
      msg.textContent = 'Uploading and reading the file…';
      try {
        const form = new FormData();
        form.append('channel', channel);
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
      '</label><input id="wiB2bLookup" type="text" autocomplete="off" placeholder="Start typing a branch or school name…" /></div>' +
      '<ul id="wiB2bResults" class="b2b-branch-results field-wide" hidden></ul>' +
      '<div class="field"><label for="wiB2bBranchSchool">B2B Branch / School <span class="required">*</span></label><input id="wiB2bBranchSchool" maxlength="300" /><span class="field-error" data-error-for="wiB2bBranchSchool"></span></div>' +
      '<div class="field"><label for="wiSchoolContactPerson">Site contact person</label><input id="wiSchoolContactPerson" maxlength="500" /></div>' +
      '<div class="field"><label for="wiSchoolContactNumber">Site contact number</label><input id="wiSchoolContactNumber" type="tel" maxlength="100" /></div>' +
      '</div></section>' +
      '<section class="detail-action-card"><h4>Sales and handling</h4><div class="field-grid">' +
      '<div class="field"><label for="wiSalesOrderNumber">Sales order no.</label><input id="wiSalesOrderNumber" maxlength="100" /></div>' +
      '<div class="field"><label for="wiSalesman">Salesman</label><select id="wiSalesman"><option value="">Select a salesman</option></select></div>' +
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
    $$('wiCustomerType').addEventListener('change', () => {
      b2bBox.hidden = $$('wiCustomerType').value !== 'B2B';
      $$('wiContactStar').hidden = $$('wiCustomerType').value === 'B2B';
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
          '</p><p class="form-note">Print the intake receipt for the customer to sign, then hand the item to the technician.</p>' +
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
      ' &middot; All prices in AED, excluding VAT.</span></div>' +
      '<div class="rcv-grid-top">' +
      simple +
      '</div>' +
      rcModeCard('Delivery & Installations', data.dandi.modes.dandi, data.dandi, true) +
      rcModeCard('Installations', data.dandi.modes.install, data.dandi, false) +
      '<p class="form-note">Delivery &amp; Installations and Installations are priced from the factors in D+I Admin Entry, so the figures above are starting points rather than final quotes.</p>';
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
      '<p class="form-note">Every AMC contract saved from the calculator above, with all 3 plans’ numbers stored. Pick a plan and Print to generate that plan’s certificate. A saved record is a Quote until you pick the plan the customer took and press Sold; only Sold contracts count as AMC revenue (ex-VAT, in the contract start month).</p>' +
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
      '<div class="card-row-header"><h4>Additional Services</h4>' +
      (canAmendAddons
        ? '<button class="button button-outline" type="button" data-tcc-addons-reset>Reset to admin defaults</button>'
        : '') +
      '</div>' +
      '<p class="form-note">' +
      (canAmendAddons
        ? 'Rates come from Thomson Pricing Admin. Amend them below to override for this quote only — this never changes the saved admin defaults.'
        : 'Rates used in this quote, set in Thomson Pricing Admin.') +
      '</p>' +
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
      permission: 'revenue_dashboard.read',
      domains: [],
      load: (root) => renderBudgetDashboard(root),
    },
    'budget-variance': {
      navId: 'budgetVarNav',
      workspaceId: 'budgetVarWorkspace',
      heading: 'Budget Variance',
      description: 'Budget by revenue stream compared with actual revenue on closed months.',
      permission: 'revenue_dashboard.read',
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
    'stock-master': {
      navId: 'stockMasterNav',
      workspaceId: 'stockMasterWorkspace',
      heading: 'Stock master',
      description: 'Upload the ERP stock file; items are searched by item code on the forms.',
      permission: 'stock.write',
      hideCurrencyNote: true,
      domains: [],
      load: (root) => renderStockMasterPage(root),
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
    invoices: {
      navId: 'invoicesNav',
      workspaceId: 'invoicesWorkspace',
      heading: 'Invoices',
      description: 'Jobs with an amount, by job type and payment stage.',
      permission: 'service_job_card.read',
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
      permission: 'service_job_card.read',
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
  };

  async function activatePricingCalcMode(mode) {
    const page = PRICING_CALC_PAGES[mode];
    if (!page) return;
    if (!hasPermission(page.permission || 'pricing_config.read')) return;
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
        ['Contact number', row.contactNumber],
        ['Address', row.address],
        ['Region', row.region],
        ['Branch / school', row.branchName],
        [
          'School contact',
          [row.schoolContactPerson, row.schoolContactNumber].filter(Boolean).join(' · '),
        ],
        ['Brand / model', [row.brand, row.model].filter(Boolean).join(' ')],
        ['Item code', row.itemCode],
        ['Warranty', row.jobWarranty],
        ['Sales order', row.salesOrderNumber],
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
  async function renderBilling(root) {
    const canRecord = hasPermission('service_job_card.write');
    const range = pgRangeFor('ytd');
    const state = {
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
    };
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
            '<tr><td class="acc-sticky"><button class="table-link" type="button" data-acc-open="' +
            plain(r.id) +
            '">' +
            plain(r.jobCardReference) +
            '</button></td>' +
            '<td>' +
            plain(r.jobCardDate) +
            '</td><td>' +
            plain(r.billingJobType || '') +
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
              ? '<td><button class="button button-outline" type="button" data-acc-record-open="' +
                plain(r.id) +
                '">Record</button></td>'
              : '') +
            '</tr>',
        )
        .join('');
      const t = d.totals;
      return (
        recordPanel() +
        '<div class="table-wrap acc-wrap"><table class="acc-table"><thead><tr><th class="acc-sticky">Job card</th><th>Date</th><th>Type</th><th>Warranty</th><th>Bill to</th><th>Customer / branch</th><th>Sales order / salesman</th><th>Item code</th><th>Brand</th><th>Model / serial</th><th>Main / group / sub group</th><th class="num">Service</th><th class="num">Parts</th><th class="num">Adj.</th><th class="num">Billed (AED)</th><th>ERP invoice</th><th>Payment</th><th>Stage</th><th>Job status</th>' +
        (canRecord ? '<th></th>' : '') +
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
        '<p class="form-note">One line per party that receives a bill: the sales channel (or the channel a billing rule redirects to), or the customer when the customer pays. Use these totals for the ERP billing run; open a party to see its jobs.</p>' +
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
        '<p class="form-note">Billed amount split by brand, main group and group (from the stock master on each job card) for ERP cost allocation. Jobs without an item code show as Unassigned.</p>' +
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
      if (!state.data) return;
      body.innerHTML =
        state.tab === 'statement'
          ? statementHtml()
          : state.tab === 'allocation'
            ? allocationHtml()
            : ledgerHtml();
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
      rules: [],
      selected: null,
      message: '',
      error: '',
    };
    const canRecord = hasPermission('service_job_card.write');
    const canEditRules = hasPermission('sales_channels.write');
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
      '<div class="ws-tabs" role="tablist">' +
      '<button type="button" role="tab" class="ws-tab is-active" data-inv-tab="invoices" aria-selected="true">Job invoices</button>' +
      '<button type="button" role="tab" class="ws-tab" data-inv-tab="rules" aria-selected="false">Billing rules</button>' +
      '</div><div data-inv-message class="form-note" role="status"></div><div data-inv-body></div>';
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
      const row = state.selected;
      if (!row) return '';
      const lockedNote =
        row.paymentBy === 'Customer'
          ? 'The customer pays for this job: confirm the payment so it can be delivered.'
          : 'This job is billed to ' +
            escapeHtml(row.billToChannel || 'the sales channel') +
            '. No payment confirmation is needed; finance bills it through the ledger.';
      return (
        '<div class="detail-action-card" data-inv-record>' +
        '<h4>Invoice and payment: ' +
        escapeHtml(row.jobCardReference) +
        '</h4>' +
        '<p class="form-note">' +
        lockedNote +
        '</p>' +
        '<div class="field-grid">' +
        '<div class="field"><label>Invoice no.<input type="text" data-rec="invoiceNo" maxlength="120" value="' +
        escapeHtml(row.invoiceNo || '') +
        '"></label></div>' +
        '<div class="field"><label>Invoice date<input type="date" data-rec="invoiceDate" value="' +
        escapeHtml((row.invoiceDate || '').slice(0, 10)) +
        '"></label></div>' +
        '<div class="field"><label>Payment mode<select data-rec="paymentMode"' +
        (row.paymentBy === 'Customer' ? '' : ' disabled title="Only used when the customer pays"') +
        '><option value="">Select mode</option>' +
        ['Cash', 'Online', 'Bank transfer', 'Card']
          .map(
            (m) => '<option' + (row.paymentMode === m ? ' selected' : '') + '>' + m + '</option>',
          )
          .join('') +
        '</select></label></div>' +
        '<div class="field"><label>Payment reference<input type="text" data-rec="paymentReference" maxlength="200"' +
        (row.paymentBy === 'Customer' ? '' : ' disabled title="Only used when the customer pays"') +
        ' value="' +
        escapeHtml(row.paymentReference || '') +
        '"></label></div>' +
        (row.paymentBy === 'Customer'
          ? '<div class="field"><label class="check-label"><input type="checkbox" data-rec="paymentConfirmed"' +
            (row.paymentConfirmedAt ? ' checked' : '') +
            '> Payment received and confirmed</label></div>'
          : '') +
        '</div>' +
        '<div class="form-footer"><span></span><button class="button button-outline" type="button" data-rec-cancel>Close</button><button class="button button-primary" type="button" data-rec-save>Save</button></div>' +
        '</div>'
      );
    }

    function drawInvoices() {
      const rows = state.rows
        .map(
          (r) =>
            '<tr><td><button class="table-link" type="button" data-inv-open="' +
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
            escapeHtml(r.invoiceNo || '—') +
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
            (canRecord
              ? '<td><button class="button button-outline" type="button" data-inv-record-open="' +
                escapeHtml(r.id) +
                '">Record</button></td>'
              : '') +
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
        '</div><p class="form-note">For Excel, use Reports: Job Invoices, or Sales Channel Reconciliation for finance.</p></div>' +
        recordPanel() +
        '<div class="table-wrap"><table><thead><tr><th>Job card</th><th>Type</th><th>Customer</th><th>Payment by / bill to</th><th class="num">Amount</th><th>Invoice</th><th>Mode</th><th>Stage</th><th>Job status</th>' +
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
      body.querySelectorAll('[data-inv-record-open]').forEach((el) =>
        el.addEventListener('click', () => {
          state.selected = state.rows.find((r) => r.id === el.dataset.invRecordOpen) || null;
          drawInvoices();
          body.querySelector('[data-inv-record]')?.scrollIntoView({ block: 'nearest' });
        }),
      );
      body.querySelector('[data-rec-cancel]')?.addEventListener('click', () => {
        state.selected = null;
        drawInvoices();
      });
      body.querySelector('[data-rec-save]')?.addEventListener('click', saveRecord);
    }

    async function saveRecord() {
      const row = state.selected;
      if (!row) return;
      const field = (name) => body.querySelector('[data-rec="' + name + '"]');
      const payload = {};
      const text = (name) => field(name).value.trim();
      if (text('invoiceNo')) payload.invoiceNo = text('invoiceNo');
      if (text('invoiceDate')) payload.invoiceDate = text('invoiceDate');
      if (text('paymentMode')) payload.paymentMode = text('paymentMode');
      if (text('paymentReference')) payload.paymentReference = text('paymentReference');
      const confirmBox = field('paymentConfirmed');
      if (confirmBox && confirmBox.checked !== Boolean(row.paymentConfirmedAt)) {
        payload.paymentConfirmed = confirmBox.checked;
      }
      try {
        await apiRequest('/api/job-cards/' + encodeURIComponent(row.id), {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        state.selected = null;
        say('Saved ' + row.jobCardReference + '.');
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
      } catch (error) {
        body.innerHTML = '<p class="form-note">' + escapeHtml(error.message) + '</p>';
      }
    }

    // ---- Billing rules tab ----
    function drawRules() {
      const rows = state.rules
        .map(
          (r) =>
            '<tr><td>' +
            escapeHtml(r.salesman || 'Any') +
            '</td><td>' +
            escapeHtml(r.branchKeyword || 'Any') +
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
        '<p class="form-note">When a job is billed to a sales channel, the first matching rule decides which channel. A rule matches when the salesman is the same (blank = any) and the B2B branch / school name contains the keyword (blank = any). With no match, the job\'s own sales channel is billed.</p>' +
        '<div class="table-wrap"><table><thead><tr><th>Salesman</th><th>Branch / school contains</th><th>Bill to</th><th>Status</th><th>Notes</th>' +
        (canEditRules ? '<th></th>' : '') +
        '</tr></thead><tbody>' +
        (rows || '<tr><td colspan="6" class="empty-state">No rules yet.</td></tr>') +
        '</tbody></table></div>' +
        (canEditRules
          ? '<div class="detail-action-card"><h4>Add a rule</h4><div class="field-grid">' +
            '<div class="field"><label>Salesman<input type="text" data-rule="salesman" maxlength="200"></label></div>' +
            '<div class="field"><label>Branch / school contains<input type="text" data-rule="branchKeyword" maxlength="200" placeholder="e.g. GEMS"></label></div>' +
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
        drawRules();
      } catch (error) {
        body.innerHTML = '<p class="form-note">' + escapeHtml(error.message) + '</p>';
      }
    }

    root.querySelectorAll('[data-inv-tab]').forEach((tab) =>
      tab.addEventListener('click', () => {
        state.tab = tab.dataset.invTab;
        root.querySelectorAll('[data-inv-tab]').forEach((other) => {
          const active = other === tab;
          other.classList.toggle('is-active', active);
          other.setAttribute('aria-selected', String(active));
        });
        say('');
        if (state.tab === 'rules') loadRules();
        else loadInvoices();
      }),
    );
    await loadInvoices();
  }

  async function renderDailyList(root) {
    const today = pgYmd(new Date());
    const state = {
      from: today,
      to: today,
      by: 'technician',
      includeCancelled: false,
      rows: [],
      truncated: false,
      error: '',
    };
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
        '<div class="th-field"><label><input type="checkbox" data-dl="cancelled"' +
        (state.includeCancelled ? ' checked' : '') +
        ' /> Include cancelled</label></div>' +
        '<div class="th-field rd-filter-actions"><button class="button button-primary" type="button" data-dl-print-list' +
        (state.rows.length ? '' : ' disabled') +
        '>Print list</button></div>' +
        '<div class="th-field rd-filter-actions"><button class="button button-outline" type="button" data-dl-print-sheets' +
        (state.rows.length ? '' : ' disabled') +
        '>Print appointment sheets</button></div>';
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
      control('cancelled').addEventListener('change', (event) => {
        state.includeCancelled = event.target.checked;
        load();
      });
      bar
        .querySelector('[data-dl-print-list]')
        ?.addEventListener('click', () => dlPrintList(state.rows, state.by, state.from, state.to));
      bar
        .querySelector('[data-dl-print-sheets]')
        ?.addEventListener('click', () => dlPrintSheets(state.rows, state.by));
    }

    function drawResults() {
      if (state.error) {
        results.innerHTML = '<p class="form-note pg-error">' + escapeHtml(state.error) + '</p>';
        return;
      }
      if (!state.rows.length) {
        results.innerHTML = '<p class="empty-state">No appointments in this range.</p>';
        return;
      }
      const groups = dlGroups(state.rows, state.by);
      const unassigned = state.rows.filter((row) => !row.technicianId).length;
      results.innerHTML =
        '<p class="form-note">' +
        state.rows.length +
        (state.rows.length === 1 ? ' appointment' : ' appointments') +
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
                  '<tr><td>' +
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
              '</span></h3><table class="rc-table"><thead><tr><th>Appointment</th><th>Customer</th><th>Address</th><th>Item</th><th>Fault</th><th>' +
              (state.by === 'branch' ? 'Technician' : 'Branch') +
              '</th><th>Status</th><th></th></tr></thead><tbody>' +
              lines +
              '</tbody></table></section>'
            );
          })
          .join('');
      results.querySelectorAll('[data-dl-sheet]').forEach((button) =>
        button.addEventListener('click', () => {
          const row = state.rows.find((entry) => entry.id === button.dataset.dlSheet);
          if (row) {
            openPrintWindow(printDocumentShell('Appointment sheet', dlSheetBody(row, true)));
          }
        }),
      );
    }

    async function load() {
      results.innerHTML = '<p class="form-note">Loading appointments&hellip;</p>';
      try {
        const result = await apiRequest(
          '/api/appointments/daily-list?' +
            new URLSearchParams({
              from: state.from,
              to: state.to,
              includeCancelled: String(state.includeCancelled),
            }),
        );
        state.rows = result.rows;
        state.truncated = result.truncated;
        state.error = '';
      } catch (error) {
        state.rows = [];
        state.error = error.message;
      }
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

  // ---------- Roles & permissions (modification #55) ----------  // ---------- Roles & permissions (modification #55) ----------
  async function renderRolesPage(root) {
    root.innerHTML = '<p class="form-note">Loading roles&hellip;</p>';
    let data;
    try {
      data = await apiRequest('/api/role-matrix');
    } catch (error) {
      root.innerHTML = '<p class="form-note pg-error">' + escapeHtml(error.message) + '</p>';
      return;
    }
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
    const head = data.roles
      .map((role) => '<th class="rm-check">' + escapeHtml(roleLabel(role)) + '</th>')
      .join('');
    let rows = '';
    groups.forEach((permissions, key) => {
      rows +=
        '<tr class="rm-group"><td colspan="' +
        (data.roles.length + 1) +
        '">' +
        escapeHtml(AL_MODULE_LABELS[key] || alSentence(key)) +
        '</td></tr>';
      permissions.forEach((permission) => {
        const cells = data.roles
          .map((role) =>
            role.code === 'admin'
              ? '<td class="rm-check"><span class="rm-locked" title="Always on">✓</span></td>'
              : '<td class="rm-check"><input type="checkbox" data-role="' +
                escapeHtml(role.code) +
                '" data-perm="' +
                escapeHtml(permission.code) +
                '" aria-label="' +
                escapeHtml(roleLabel(role) + ': ' + permission.code) +
                '"' +
                (draft[role.code].has(permission.code) ? ' checked' : '') +
                ' /></td>',
          )
          .join('');
        rows +=
          '<tr' +
          (key === 'admin' ? ' class="rm-sensitive"' : '') +
          '><td>' +
          escapeHtml(permission.description) +
          '<small>' +
          escapeHtml(permission.code) +
          '</small></td>' +
          cells +
          '</tr>';
      });
    });
    root.innerHTML =
      '<div class="rm-bar"><button type="button" class="button button-primary" data-rm-save disabled>Save changes</button>' +
      '<button type="button" class="button" data-rm-discard disabled>Discard</button>' +
      '<span class="form-note" data-rm-status>No changes</span></div>' +
      '<div class="rm-wrap"><table class="rc-table rm-table"><thead><tr><th>Permission</th>' +
      head +
      '</tr></thead><tbody>' +
      rows +
      '</tbody></table></div>' +
      '<p class="form-note">Rows marked with an amber edge (admin.*) control who can manage logins and permissions &mdash; grant them with care.</p>';
    const saveButton = root.querySelector('[data-rm-save]');
    const discardButton = root.querySelector('[data-rm-discard]');
    const status = root.querySelector('[data-rm-status]');
    const changedRoles = () =>
      editable.filter((role) => {
        const before = original[role.code];
        const after = draft[role.code];
        return before.size !== after.size || [...after].some((code) => !before.has(code));
      });
    const refresh = () => {
      const count = changedRoles().length;
      saveButton.disabled = !count;
      discardButton.disabled = !count;
      status.textContent = count
        ? count + (count === 1 ? ' role' : ' roles') + ' with unsaved changes'
        : 'No changes';
    };
    root.addEventListener('change', (event) => {
      const box = event.target.closest('input[data-role]');
      if (!box) return;
      const set = draft[box.dataset.role];
      if (box.checked) set.add(box.dataset.perm);
      else set.delete(box.dataset.perm);
      refresh();
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
    'revenue_dashboard.email_drafted': 'Revenue summary email drafted',
    'revenue_dashboard.summary_copied': 'Revenue summary copied',
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
      '<strong>Refresh data</strong><span class="form-note">Upload the latest ' +
      escapeHtml(label) +
      '. The newest upload replaces what the dashboard shows; earlier uploads are kept as history.</span>' +
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
        msg.textContent = 'Imported ' + rdMoney(result.batch.rowCount) + ' rows.';
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
      '<div class="table-wrap"><table class="rc-table rd-jobs-table"><thead><tr><th>Date</th><th>Wk</th><th>Type</th><th>Inv/Del no</th><th>CSOSC order</th><th>Customer</th><th>Channel</th><th>Salesperson</th><th>Order status</th><th>Billing code</th><th>Cost status</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Revenue</th></tr></thead><tbody>' +
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
            escapeHtml(r.orderStatus || '') +
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
            '</div><div><strong>Original job value</strong> AED ' +
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
    let tab = 'overview';
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
        ]
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
        '<p class="form-note rd-pad">Revenue is the figure calculated in the master workbook (rate card, RWR/BER flat charge and tiered delivery pricing already applied).</p>';

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
      void bySales;
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
    const DRILL_SEQUENCE = ['year', 'period', 'jobType', 'customer', 'channel'];
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
      'orderStatus',
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
        '</select></label></div>';
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
            '<p class="form-note rd-pad">Click a month to drill into its job types, customers and jobs.</p>',
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
            '<p class="form-note rd-pad">Same layout as the workbook&rsquo;s Accounts Review pivot (Count of Qty), recalculated live from the uploaded data.</p>',
        );
      bindJump(reportBody, 'period', 'jobType');
      await rdDrawChart(
        reportBody.querySelector('#rdc-r-acc'),
        rdStackedConfig(m, 'period', 'qty', { labels: true }),
      );
    }

    async function drawBilling() {
      const [billing, cost, order] = await Promise.all([
        rdApi('group', { ...F, dimension: 'billingCode' }),
        rdApi('group', { ...F, dimension: 'costStatus' }),
        rdApi('group', { ...F, dimension: 'orderStatus' }),
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
        '<div class="rd-two-col">' +
        rdSection(
          'By cost status',
          rdGroupTable(cost.data, 'costStatus', { drill: true, title: 'Cost status' }),
        ) +
        rdSection(
          'By order status',
          rdGroupTable(order.data, 'orderStatus', { drill: true, title: 'Order status' }),
        ) +
        '</div>';
      const tables = reportBody.querySelectorAll('.rc-table');
      const dims = ['billingCode', 'costStatus', 'orderStatus'];
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
          '<p class="form-note rd-pad">Jobs in the selected period that finance should review before the revenue is relied on. Click a check to see the individual jobs.</p>' +
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
        '<p class="form-note rd-pad">A job can appear under several checks, so the rows overlap and should not be added together.</p>';
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

    async function managementSummary(sum) {
      const [byType, byChannel, byCustomer, byPeriod, exc] = await Promise.all([
        rdApi('group', { ...F, dimension: 'jobType' }),
        rdApi('group', { ...F, dimension: 'channel' }),
        rdApi('group', { ...F, dimension: 'customer' }),
        rdApi('group', { ...F, month: '', week: '', dimension: 'period' }),
        rdApi('exceptions', F),
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
        open.forEach((e) =>
          lines.push(
            '  - ' + e.label + ': ' + rdMoney(e.jobs) + ' jobs, AED ' + rdMoney(e.revenue),
          ),
        );
      else lines.push('  - None');
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
      const [byType, byChannel, bySales, byPeriod, exc] = await Promise.all([
        rdApi('group', { ...F, dimension: 'jobType' }),
        rdApi('group', { ...F, dimension: 'channel' }),
        rdApi('group', { ...F, dimension: 'salesPerson' }),
        rdApi('group', { ...F, month: '', week: '', dimension: 'period' }),
        rdApi('exceptions', F),
      ]);
      const periods = [...byPeriod.data.rows].sort((a, b) => a.key.localeCompare(b.key));
      return {
        t: sum.summary.totals,
        byType: byType.data.rows,
        byChannel: byChannel.data.rows,
        salesPeople: bySales.data.rows,
        periods,
        open: exc.data.exceptions.filter((e) => e.jobs),
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
                '</td></tr>',
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
        '<span class="rd-spacer"></span><button class="button" type="button" data-rd-export>Export report (.xlsx)</button><button class="button button-outline" type="button" data-rd-summary>Management summary</button><button class="button button-outline" type="button" data-rd-email>Email draft</button><button class="button button-outline" type="button" data-rd-html-email>Formatted email</button></div>' +
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
        '<p class="form-note">Only closed months count in the totals' +
        (data.settings.includeRunning
          ? ' (the running month is included by setting)'
          : '; months not yet closed are shown faded') +
        '. Budget is the version annual figure phased across the fiscal year; VAT-inclusive streams are restated ex-VAT at ' +
        Math.round(data.settings.vatRate * 100) +
        '%.</p>';
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
      '<h3>Which records feed which stream</h3><p class="form-note">Each job type from the master workbook, and each portal record type, is mapped to one revenue stream. A new product or job type needs a new row here, not a code change.</p>' +
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
      ' /> Count CSIJW / CSIJO from portal job-card billing (ignores those two job types in the workbook upload)</label></div>';
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

    const cells = (fn) => periods.map((p) => '<td>' + fn(p) + '</td>').join('');
    const compare =
      '<div class="table-wrap"><table class="rd-budget-table"><thead><tr><th>Measure</th>' +
      periods.map((p) => '<th>' + monthName(p) + '</th>').join('') +
      '<th>Total</th></tr></thead><tbody>' +
      '<tr><td>Budget revenue</td>' +
      cells((p) => rdMoney(budgetRevenue[p])) +
      '<td><strong>' +
      rdMoney(fyBudget) +
      '</strong></td></tr>' +
      '<tr><td>Actual revenue</td>' +
      cells((p) => (actualMap[p] ? rdMoney(actualMap[p].revenue) : '&mdash;')) +
      '<td><strong>' +
      rdMoney(ytdActual) +
      '</strong></td></tr>' +
      '<tr><td>Variance</td>' +
      cells((p) =>
        actualMap[p]
          ? '<span class="' +
            varClass(actualMap[p].revenue - (budgetRevenue[p] || 0)).trim() +
            '">' +
            rdMoney(actualMap[p].revenue - (budgetRevenue[p] || 0)) +
            '</span>'
          : '&mdash;',
      ) +
      '<td><strong class="' +
      varClass(ytdActual - ytdBudget).trim() +
      '">' +
      rdMoney(ytdActual - ytdBudget) +
      '</strong></td></tr>' +
      '<tr><td>Achievement</td>' +
      cells((p) =>
        actualMap[p] ? rdPercent(actualMap[p].revenue, budgetRevenue[p] || 0) : '&mdash;',
      ) +
      '<td><strong>' +
      rdPercent(ytdActual, ytdBudget) +
      '</strong></td></tr>' +
      '<tr><td>Budget volume</td>' +
      cells((p) => rdMoney(budgetVolume[p])) +
      '<td>' +
      rdMoney(periods.reduce((s, p) => s + (budgetVolume[p] || 0), 0)) +
      '</td></tr>' +
      '<tr><td>Actual volume</td>' +
      cells((p) => (actualMap[p] ? rdMoney(actualMap[p].qty) : '&mdash;')) +
      '<td>' +
      rdMoney(actualPeriods.reduce((s, p) => s + actualMap[p].qty, 0)) +
      '</td></tr>' +
      '</tbody></table></div>';

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
        'Budget vs actual by month',
        compare +
          '<p class="form-note rd-pad">Actuals come from the uploaded revenue workbook. The latest month can be partial until its data is complete.</p>',
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
    group.members.forEach(([memberMode, label]) => {
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
    setWorkspaceMode(navGroupLast.finance || NAV_GROUPS.finance.members[0][0]),
  );
  $('#pricingMastersNav')?.addEventListener('click', () =>
    setWorkspaceMode(navGroupLast.pricing || NAV_GROUPS.pricing.members[0][0]),
  );

  $('#rateCardNav')?.addEventListener('click', () => setWorkspaceMode('rate-card'));
  $('#reportsNav')?.addEventListener('click', () => setWorkspaceMode('reports'));
  $('#activityLogNav')?.addEventListener('click', () => setWorkspaceMode('activity-log'));
  $('#rolesNav')?.addEventListener('click', () => setWorkspaceMode('roles'));
  $('#stockMasterNav')?.addEventListener('click', () => setWorkspaceMode('stock-master'));
  $('#walkInNav')?.addEventListener('click', () => setWorkspaceMode('walk-in'));
  initItemPickers();
  $('#dailyListNav')?.addEventListener('click', () => setWorkspaceMode('daily-list'));
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
  restoreSession();
})();
