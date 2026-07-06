/** Stage this week's learning blocks from project task due dates. */
export async function stageWeeklySchedule(setState) {
  const res = await fetch('/api/schedule/stage', { method: 'POST' });
  if (!res.ok) {
    let message = 'Failed to stage weekly schedule';
    try {
      const err = await res.json();
      message = err.detail || err.message || message;
    } catch (_) {
      // ignore parse errors
    }
    throw new Error(message);
  }

  const data = await res.json();
  setState({
    proposedEvents: data.proposed_events || [],
    scarcityFlag: data.scarcity_flag || false,
    reason: data.reason || '',
    transactionId: data.transaction_id || '',
    token: data.token || '',
    currentWeekOffset: 0,
  });

  return data;
}

/** Approve staged schedule with user-modified event timings. */
export async function approveWeeklySchedule(envelope) {
  const res = await fetch('/api/schedule/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });

  if (!res.ok) {
    let message = 'Failed to approve schedule';
    try {
      const err = await res.json();
      message = err.detail || err.message || message;
    } catch (_) {
      // ignore parse errors
    }
    throw new Error(message);
  }

  return res.json();
}

/** Reject a staged schedule proposal. */
export async function rejectWeeklySchedule(envelope) {
  const res = await fetch('/api/schedule/reject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });

  if (!res.ok) {
    let message = 'Failed to reject schedule';
    try {
      const err = await res.json();
      message = err.detail || err.message || message;
    } catch (_) {
      // ignore parse errors
    }
    throw new Error(message);
  }

  return res.json();
}

/** Delete managed learning blocks on a specific day (YYYY-MM-DD). */
export async function clearDayLearningEvents(date) {
  const res = await fetch('/api/calendar/clear-day', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date }),
  });

  if (!res.ok) {
    let message = 'Failed to clear day';
    try {
      const err = await res.json();
      message = err.detail || err.message || message;
    } catch (_) {
      // ignore parse errors
    }
    throw new Error(message);
  }

  return res.json();
}
