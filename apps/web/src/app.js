(() => {
  'use strict';

  let authToken = null;
  let currentUser = null;
  let currentComplaintId = null;
  let currentAppointmentId = null;
  let currentJobCardId = null;
  let workspaceMode = 'complaints';
  let availabilityRequestSequence = 0;
  let calendarView = 'month';
  let calendarCursor = new Date();
  let calendarAppointments = [];
  let calendarRequestSequence = 0;
  let workspaceRetryAction = null;

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

  function setMessage(selector, message, visible = true) {
    const element = $(selector);
    element.textContent = message || '';
    element.hidden = !visible || !message;
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

  function validatePublicForm(data, form) {
    clearErrors(form);
    const required = [
      ['customerType', 'Select a customer type.'],
      ['customerName', 'Enter the customer name.'],
      ['contactNumber', 'Enter a contact number.'],
      ['description', 'Describe the issue.'],
    ];
    let valid = true;
    required.forEach(([field, message]) => {
      if (!data[field]) {
        showFieldError(form, field, message);
        valid = false;
      }
    });
    if (data.customerEmail && !/^\S+@\S+\.\S+$/.test(data.customerEmail)) {
      showFieldError(form, 'customerEmail', 'Enter a valid email address.');
      valid = false;
    }
    return valid;
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

  function setBusy(button, busy, label) {
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.disabled = busy;
    button.textContent = busy ? label : button.dataset.label;
  }

  function resetPublicForm() {
    const form = $('#publicComplaintForm');
    form.reset();
    clearErrors(form);
    $('#publicSuccess').hidden = true;
    $('#complaintFields').hidden = false;
    setMessage('#publicFormMessage', '', false);
    $('#complaint-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $('#publicComplaintForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = formDataObject(form);
    setMessage('#publicFormMessage', '', false);
    if (!validatePublicForm(data, form)) return;
    const button = $('#submitComplaintButton');
    setBusy(button, true, 'Submitting…');
    try {
      const result = await apiRequest('/api/public/complaints', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      $('#successReference').textContent =
        result.complaint?.complaintReference || 'Reference created';
      $('#publicSuccess').hidden = false;
      $('#complaintFields').hidden = true;
      $('#publicSuccess').focus?.();
    } catch (error) {
      setMessage('#publicFormMessage', error.message);
    } finally {
      setBusy(button, false);
    }
  });
  $('#newComplaintButton').addEventListener('click', resetPublicForm);

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
    $('#appointmentsNav').hidden = !hasPermission('appointments.read');
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
    workspaceMode = mode;
    const serviceRequests = mode === 'service-requests';
    const appointments = mode === 'appointments';
    const jobCards = mode === 'job-cards';
    const quotations = mode === 'quotations';
    const inspections = mode === 'inspections';
    const anyOtherPanel = serviceRequests || appointments || jobCards || quotations || inspections;
    $('#complaintsNav').setAttribute('aria-current', anyOtherPanel ? 'false' : 'page');
    $('#serviceRequestsNav').setAttribute('aria-current', serviceRequests ? 'page' : 'false');
    $('#jobCardsNav').setAttribute('aria-current', jobCards ? 'page' : 'false');
    $('#quotationsNav').setAttribute('aria-current', quotations ? 'page' : 'false');
    $('#inspectionsNav').setAttribute('aria-current', inspections ? 'page' : 'false');
    $('#appointmentsNav').setAttribute('aria-current', appointments ? 'page' : 'false');
    $('#complaintWorkspace').hidden = appointments || jobCards || quotations || inspections;
    $('#appointmentWorkspace').hidden = !appointments;
    $('#jobCardWorkspace').hidden = !jobCards;
    $('#quotationWorkspace').hidden = !quotations;
    $('#inspectionWorkspace').hidden = !inspections;
    $('#refreshComplaintsButton').hidden = anyOtherPanel;
    $('#refreshAppointmentsButton').hidden = !appointments;
    $('#refreshJobCardsButton').hidden = !jobCards;
    $('#refreshQuotationsButton').hidden = !quotations;
    $('#refreshInspectionsButton').hidden = !inspections;
    $('#workspace-heading').textContent = appointments
      ? 'Appointments'
      : jobCards
        ? 'Service job cards'
        : quotations
          ? 'Quotations'
          : inspections
            ? 'Inspections'
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
    };
  }

  // ---- Quotations & Inspections (Phase 5 -- docs/DEVELOPMENT_PLAN.md).
  // Same field-template-plus-generic-table approach as the job card forms
  // above. Neither entity has a workflow-lock status in the live system, so
  // there's a single always-editable form per record instead of a status
  // action panel.
  let currentQuotationId = null;
  let currentInspectionId = null;

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
    };
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
          `<tr><td><button class="table-link" type="button" data-job-card-id="${escapeHtml(jobCard.id)}">${escapeHtml(jobCard.jobCardReference)}</button></td><td>${escapeHtml(jobCard.appointmentReference)}</td><td><strong>${escapeHtml(jobCard.customerName)}</strong><br>${escapeHtml(jobCard.contactNumber)}</td><td>${escapeHtml(appointmentDateTime(jobCard))}</td><td><span class="status ${statusClass(jobCard.status)}">${escapeHtml(jobCard.status)}</span></td></tr>`,
      )
      .join('');
    $('#jobCardsEmpty').hidden = jobCards.length > 0;
    body
      .querySelectorAll('[data-job-card-id]')
      .forEach((button) =>
        button.addEventListener('click', () => loadJobCardDetail(button.dataset.jobCardId)),
      );
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
      renderJobCards(result.jobCards || []);
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
    $('#inspectionDetail').hidden = true;
    $('#inspectionCreatePanel').hidden = true;
    $('#inspectionsBody').innerHTML = '';
    $('#inspectionsEmpty').hidden = true;
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
      renderJobCardActions(jobCard);
      $('#jobCardDetailHeading').textContent =
        jobCard.jobCardReference || 'Service job card details';
      $('#jobCardDetailStatus').innerHTML =
        `<span class="status ${statusClass(jobCard.status)}">${escapeHtml(jobCard.status)}</span>`;
      const details = [
        ['Appointment', jobCard.appointmentReference],
        ['Customer', jobCard.customerName],
        ['Contact', jobCard.customerContact],
        ['Appointment date', jobCard.appointmentDate],
        ['Appointment time', jobCard.appointmentTime],
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
    return formatDate(
      `${appointment.appointmentDate}T${appointment.appointmentTime || '00:00'}:00`,
    );
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
        .sort((left, right) =>
          String(left.appointmentTime).localeCompare(String(right.appointmentTime)),
        )
        .map(
          (appointment) =>
            `<button class="calendar-event" type="button" data-calendar-appointment-id="${escapeHtml(appointment.id)}" draggable="${canWrite && appointment.status !== 'Completed' && appointment.status !== 'Cancelled'}" title="${escapeHtml(appointment.appointmentReference)}${canWrite ? '. Drag to reschedule.' : ''}"><strong>${escapeHtml(appointment.appointmentTime || '—')} · ${escapeHtml(appointment.customerName)}</strong><span class="calendar-event-status">${escapeHtml(appointment.status)}</span></button>`,
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
        if (appointment && canWrite)
          await rescheduleAppointment(id, cell.dataset.calendarDate, appointment.appointmentTime);
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
    $('#appointmentRescheduleTime').value = appointment.appointmentTime || '';

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
      const details = [
        ['Customer', appointment.customerName],
        ['Contact', appointment.contactNumber],
        ['Email', appointment.customerEmail],
        ['Complaint', appointment.complaintId],
        ['Appointment', appointmentDateTime(appointment)],
        ['Technician', appointment.technicianId || 'Unassigned'],
        ['Region', appointment.region],
        ['Address', appointment.address],
        ['Brand', appointment.brand],
        ['Model', appointment.model],
        ['Item code', appointment.itemCode],
        ['Warranty', appointment.jobWarranty],
        ['Sales order', appointment.salesOrderNumber],
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
      if (hasPermission('service_job_card.read')) {
        try {
          const jobCardResult = await apiRequest(
            '/api/appointments/' + encodeURIComponent(appointment.id) + '/job-card',
          );
          $('#createJobCardButton').hidden =
            Boolean(jobCardResult.jobCard) || !hasPermission('service_job_card.write');
        } catch (jobCardError) {
          if (jobCardError.status === 403) $('#createJobCardButton').hidden = true;
        }
      } else {
        $('#createJobCardButton').hidden = true;
      }
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
    setMessage('#workspaceMessage', message, success);
  }

  async function rescheduleAppointment(
    id,
    appointmentDate,
    appointmentTime,
    initiatingButton = null,
  ) {
    const button = initiatingButton || $('#saveAppointmentScheduleButton');
    const form = $('#appointmentScheduleForm');
    clearErrors(form);
    const date = String(appointmentDate || '').trim();
    const time = String(appointmentTime || '').trim();
    let valid = true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(localDate(date).valueOf())) {
      showFieldError(form, 'appointmentRescheduleDate', 'Enter a valid appointment date.');
      valid = false;
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      showFieldError(form, 'appointmentRescheduleTime', 'Enter a valid time in HH:mm format.');
      valid = false;
    }
    if (!valid) return;
    setBusy(button, true, 'Saving…');
    setMessage('#calendarMessage', 'Saving the new appointment time…');
    try {
      await apiRequest('/api/appointments/' + encodeURIComponent(id) + '/schedule', {
        method: 'PATCH',
        body: JSON.stringify({ appointmentDate: date, appointmentTime: time }),
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
      if ($('#calendarMessage').textContent === 'Saving the new appointment time…') {
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
    $('#jobCardDetail').hidden = true;
    $('#jobCardsBody').innerHTML = '';
    $('#jobCardsEmpty').hidden = true;
  }

  function resetScheduleForm() {
    availabilityRequestSequence += 1;
    $('#scheduleForm').reset();
    clearErrors($('#scheduleForm'));
    $('#technicianId').innerHTML = '<option value="">Select a date and time first</option>';
    $('#technicianId').disabled = true;
    $('#findTechniciansButton').disabled = false;
    $('#scheduleAvailabilityMessage').textContent = '';
    $('#scheduleResult').textContent = '';
  }

  function renderComplaintActions(complaint) {
    currentComplaintId = complaint.id;
    const canWrite = hasPermission('complaints.write');
    const canSchedule =
      complaint.status === 'Ready for Scheduling' &&
      hasPermission('appointments.write') &&
      hasPermission('technicians.read');
    $('#complaintActions').hidden = !canWrite && !canSchedule;
    $('#notesAction').hidden = !canWrite;
    $('#statusAction').hidden = !canWrite;
    $('#scheduleAction').hidden = !canSchedule;
    resetScheduleForm();
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

  async function loadAvailableTechnicians() {
    const form = $('#scheduleForm');
    clearErrors(form);
    const date = $('#appointmentDate').value;
    const time = $('#appointmentTime').value;
    if (!date) showFieldError(form, 'appointmentDate', 'Select an appointment date.');
    if (!time) showFieldError(form, 'appointmentTime', 'Select an appointment time.');
    if (!date || !time) return;

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
        availableTime: time,
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
    const time = $('#appointmentTime').value;
    const technicianId = $('#technicianId').value;
    let valid = true;
    if (!date) {
      showFieldError(form, 'appointmentDate', 'Select an appointment date.');
      valid = false;
    }
    if (!time) {
      showFieldError(form, 'appointmentTime', 'Select an appointment time.');
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
            ([key, value]) =>
              value !== '' && !['appointmentDate', 'appointmentTime', 'technicianId'].includes(key),
          ),
      );
      const result = await apiRequest('/api/appointments', {
        method: 'POST',
        body: JSON.stringify({
          complaintId: currentComplaintId,
          technicianId,
          appointmentDate: date,
          appointmentTime: time,
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
  $('#applyComplaintFilters').addEventListener('click', loadComplaints);
  $('#applyJobCardFilters').addEventListener('click', loadJobCards);
  $('#applyAppointmentFilters').addEventListener('click', loadAppointments);
  $('#applyQuotationFilters').addEventListener('click', loadQuotations);
  $('#applyInspectionFilters').addEventListener('click', loadInspections);
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
  $('#findTechniciansButton').addEventListener('click', loadAvailableTechnicians);
  $('#technicianId').addEventListener('change', () => {
    $('#scheduleAppointmentButton').disabled = !$('#technicianId').value;
  });
  $('#appointmentDate').addEventListener('change', () => {
    $('#technicianId').disabled = true;
    $('#technicianId').innerHTML = '<option value="">Select a date and time first</option>';
    $('#scheduleAppointmentButton').disabled = true;
    availabilityRequestSequence += 1;
  });
  $('#appointmentTime').addEventListener('change', () => {
    $('#technicianId').disabled = true;
    $('#technicianId').innerHTML = '<option value="">Select a date and time first</option>';
    $('#scheduleAppointmentButton').disabled = true;
    availabilityRequestSequence += 1;
  });
  $('#complaintsNav').addEventListener('click', () => setWorkspaceMode('complaints'));
  $('#serviceRequestsNav').addEventListener('click', () => setWorkspaceMode('service-requests'));
  $('#jobCardsNav').addEventListener('click', () => setWorkspaceMode('job-cards'));
  $('#quotationsNav').addEventListener('click', () => setWorkspaceMode('quotations'));
  $('#inspectionsNav').addEventListener('click', () => setWorkspaceMode('inspections'));
  $('#appointmentsNav').addEventListener('click', () => setWorkspaceMode('appointments'));
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
  $('#appointmentScheduleForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    await rescheduleAppointment(
      currentAppointmentId,
      $('#appointmentRescheduleDate').value,
      $('#appointmentRescheduleTime').value,
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
