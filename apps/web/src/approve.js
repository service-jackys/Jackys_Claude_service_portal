(function () {
  function $(selector) {
    return document.querySelector(selector);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
    );
  }

  function money(value) {
    return (Number(value) || 0).toFixed(2);
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.valueOf())
      ? String(value)
      : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');

  async function fetchApproval() {
    const response = await fetch('/api/public/warranty-approvals/' + encodeURIComponent(token));
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error((body && body.detail) || 'This approval link is no longer valid.');
    }
    return body.approval;
  }

  async function submitDecision(decision) {
    const decidedByName = $('#decidedByName').value.trim();
    if (!decidedByName) {
      $('#decisionError').textContent = 'Please enter your name before continuing.';
      $('#decisionError').hidden = false;
      return;
    }
    $('#decisionError').hidden = true;
    $('#approveButton').disabled = true;
    $('#declineButton').disabled = true;
    try {
      const response = await fetch(
        '/api/public/warranty-approvals/' + encodeURIComponent(token) + '/decision',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            decision,
            decidedByName,
            decisionNotes: $('#decisionNotes').value.trim() || undefined,
          }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((body && body.detail) || 'Could not submit your decision.');
      }
      render(body.approval);
    } catch (error) {
      $('#decisionError').textContent = error.message;
      $('#decisionError').hidden = false;
      $('#approveButton').disabled = false;
      $('#declineButton').disabled = false;
    }
  }

  function render(approval) {
    $('#loadingState').hidden = true;
    $('#errorState').hidden = true;
    $('#content').hidden = false;
    $('#approvalReference').textContent = approval.approvalReference;

    const details = [
      ['Item', approval.itemDescription],
      ['Warranty status', approval.warrantyStatus],
      [
        'Estimated cost (AED)',
        approval.estimatedCost != null ? money(approval.estimatedCost) : null,
      ],
      ['Customer', approval.customerName],
    ];
    $('#detailsGrid').innerHTML = details
      .map(
        ([label, value]) =>
          `<div class="item"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value || '—')}</span></div>`,
      )
      .join('');

    if (approval.notes) {
      $('#notesBlockWrap').hidden = false;
      $('#notesBlock').textContent = approval.notes;
    } else {
      $('#notesBlockWrap').hidden = true;
    }

    const banner = $('#statusBanner');
    const form = $('#decisionForm');
    if (approval.status === 'Pending') {
      banner.hidden = true;
      form.hidden = false;
    } else {
      form.hidden = true;
      banner.hidden = false;
      banner.className = 'status-banner ' + approval.status.toLowerCase();
      banner.textContent =
        approval.status === 'Approved'
          ? `Approved by ${approval.decidedByName || 'the customer'} on ${formatDate(approval.decidedAt)}.`
          : `Declined by ${approval.decidedByName || 'the customer'} on ${formatDate(approval.decidedAt)}.`;
    }
  }

  $('#approveButton').addEventListener('click', () => submitDecision('Approved'));
  $('#declineButton').addEventListener('click', () => submitDecision('Declined'));

  if (!token) {
    $('#loadingState').hidden = true;
    $('#errorState').hidden = false;
    $('#errorState').textContent = 'This approval link is missing its token and cannot be opened.';
  } else {
    fetchApproval()
      .then(render)
      .catch((error) => {
        $('#loadingState').hidden = true;
        $('#errorState').hidden = false;
        $('#errorState').textContent = error.message;
      });
  }
})();
