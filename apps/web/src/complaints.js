(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);

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

  // Scroll-reveal for the info cards, matching the landing page's motion.
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 },
    );
    document.querySelectorAll('.reveal').forEach((element) => observer.observe(element));
  }
})();
