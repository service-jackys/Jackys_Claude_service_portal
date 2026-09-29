(() => {
  'use strict';

  let authToken = null;
  let currentUser = null;
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

  async function establishSession(result) {
    authToken = result.token;
    const session = await apiRequest('/api/auth/me');
    currentUser = session.user;
    $('#authCard').hidden = true;
    $('#staff-access').hidden = true;
    $('#staff-workspace').hidden = false;
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
    $('#staff-workspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      loadSalesChannels();
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
    populateSelectOptions('#jccSalesChannel', salesChannelOptions, 'Select a sales channel');
    populateSelectOptions('#jceSalesChannel', salesChannelOptions, 'Select a sales channel');
  }

  // ---- Service job card content form (create-prefill panel with prefix 'jcc',
  // existing-job-card edit panel with prefix 'jce'). Both share the same field
  // set (packages/contracts jobCardContentFields / docs/code.gs HEADERS_BY_TYPE
  // ['service-job-card']), so one template and one set of handlers, parameterized
  // by prefix, drive both panels instead of duplicating the markup and logic.
  const jobFinalStatusOptions = ['WIP', 'BER', 'Rejected', 'Repair Completed', 'Spare pending'];
  const jobCardPartsState = { jcc: [], jce: [] };

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
    ['jcc', 'jce'].forEach((prefix) => {
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
    $('#newComplaintCustomerNumber').value = branch.custCode;
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

  // ---- Salesmen / Sales channels (modification.md #14) -- small
  // add-only admin lists that feed the Salesman/Sales Channel dropdowns on
  // the Schedule form and job cards (see modification.md #8). No
  // edit/deactivate yet -- the backend only exposes list+create for either
  // list, so this mirrors that rather than promising more than it does.
  function renderMasterDataRows(bodySelector, emptySelector, items) {
    const body = $(bodySelector);
    body.innerHTML = items
      .map(
        (item) =>
          `<tr><td>${escapeHtml(item.name)}</td><td>${item.active ? 'Active' : 'Inactive'}</td></tr>`,
      )
      .join('');
    $(emptySelector).hidden = items.length > 0;
  }

  async function loadSalesmen() {
    if (!hasPermission('salesmen.read')) return;
    clearWorkspaceRecovery();
    $('#salesmenBody').innerHTML =
      '<tr><td colspan="2" class="empty-state">Loading salesmen…</td></tr>';
    try {
      const result = await apiRequest('/api/salesmen?page=1&pageSize=200');
      renderMasterDataRows('#salesmenBody', '#salesmenEmpty', result.salesmen || []);
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

  async function loadSalesChannels() {
    if (!hasPermission('sales_channels.read')) return;
    clearWorkspaceRecovery();
    $('#salesChannelsBody').innerHTML =
      '<tr><td colspan="2" class="empty-state">Loading sales channels…</td></tr>';
    try {
      const result = await apiRequest('/api/sales-channels?page=1&pageSize=200');
      renderMasterDataRows('#salesChannelsBody', '#salesChannelsEmpty', result.salesChannels || []);
    } catch (error) {
      if (error.status === 401) {
        await signOut(false);
        setMessage('#authMessage', 'Your session has expired. Please sign in again.');
      } else if (error.status === 403) {
        setWorkspaceRecovery('You are not authorized to view sales channels.', loadSalesChannels);
      } else {
        setWorkspaceRecovery(error.message, loadSalesChannels);
      }
      $('#salesChannelsBody').innerHTML = '';
      $('#salesChannelsEmpty').hidden = false;
    }
  }

  $('#salesmanForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    clearErrors(form);
    const name = $('#salesmanName').value.trim();
    if (!name) {
      showFieldError(form, 'salesmanName', "Enter the salesman's name.");
      return;
    }
    const button = $('#saveSalesmanButton');
    setBusy(button, true, 'Adding…');
    try {
      await apiRequest('/api/salesmen', { method: 'POST', body: JSON.stringify({ name }) });
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
      await loadSalesChannels();
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
  };

  // Delegated click handling survives each re-render (innerHTML swap) since
  // the listener lives on the stable container, not the tiles themselves.
  [
    ['dashComplaintTiles', 'complaints'],
    ['dashAppointmentTiles', 'appointments'],
    ['dashJobCardTiles', 'jobCards'],
    ['dashQuotationInspectionTiles', null],
    ['dashWarrantyApprovalTiles', 'warrantyApprovals'],
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
  // modification.md #4).
  function populateScheduleFormFromComplaint(complaint) {
    $('#scheduleSalesOrderNumber').value = complaint.salesOrderNumber || '';
    $('#scheduleB2bBranchSchool').value = complaint.b2bBranchSchool || '';
    $('#scheduleSchoolContactPerson').value = complaint.schoolContactPerson || '';
    $('#scheduleSchoolContactNumber').value = complaint.schoolContactNumber || '';
    $('#scheduleCustomerNumber').value = complaint.customerNumber || '';
    const matchNote = $('#scheduleB2bBranchMatchNote');
    if (complaint.b2bBranchCustCode) {
      matchNote.textContent = `Matched to the master list (Cust_Code ${complaint.b2bBranchCustCode}).`;
    } else if (complaint.b2bBranchSchool) {
      matchNote.textContent =
        'Not yet matched to the master list -- see the "B2B Branch match" tab.';
    } else {
      matchNote.textContent = '';
    }
  }

  function renderComplaintActions(complaint) {
    currentComplaintId = complaint.id;
    const canWrite = hasPermission('complaints.write');
    const canSchedule =
      complaint.status === 'Ready for Scheduling' &&
      hasPermission('appointments.write') &&
      hasPermission('technicians.read');
    $('#complaintActions').hidden = !canWrite && !canSchedule;
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
          complaintId: currentComplaintId,
          technicianId,
          appointmentDate: date,
          ...overrides,
        }),
      });
      const appointment = result.appointment;
      $('#scheduleResult').textContent = appointment?.appointmentReference
        ? `Appointment ${appointment.appointmentReference} created.`
        : 'Appointment created.';
      await loadComplaintDetail(currentComplaintId);
      await loadComplaints();
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
        await loadComplaintDetail(currentComplaintId);
        await loadComplaints();
        setMessage('#workspaceMessage', error.message);
      } else if (error.status === 403) {
        $('#scheduleAction').hidden = true;
        setMessage('#workspaceMessage', 'You are not authorized to schedule appointments.');
      } else {
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
  initJobCardForms();
  initQuotationForms();
  initInspectionForms();
})();
