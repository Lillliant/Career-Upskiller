/** Stage learning blocks for the week shown on the schedule page. */
export function inferStagedWeekOffset(proposedEvents, referenceDate = new Date()) {
  const startIso = proposedEvents?.find((event) => event.start)?.start;
  if (!startIso) return null;

  const sundayOf = (date) => {
    const copy = new Date(date);
    copy.setHours(0, 0, 0, 0);
    copy.setDate(copy.getDate() - copy.getDay());
    return copy;
  };

  const eventSunday = sundayOf(new Date(startIso));
  const currentSunday = sundayOf(referenceDate);
  const diffDays = Math.round((eventSunday - currentSunday) / (24 * 60 * 60 * 1000));
  return Math.round(diffDays / 7);
}

export async function stageWeeklySchedule(setState, { weekOffset = 0 } = {}) {
  const res = await fetch('/api/schedule/stage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ week_offset: weekOffset }),
  });
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
    stagedWeekOffset: data.week_offset ?? weekOffset,
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

/** Fetch workload vs planning-horizon summary. */
export async function fetchScheduleCapacity() {
  const res = await fetch('/api/schedule/capacity');
  if (!res.ok) {
    throw new Error('Failed to fetch schedule capacity');
  }
  return res.json();
}

/** Preview or apply priority-aware due-date rebalancing across all projects. */
export async function rebalanceSchedule({
  preview = false,
  pauseLowerPriority = false,
  hoursPerWeek = null,
} = {}) {
  const body = {
    preview,
    pause_lower_priority: pauseLowerPriority,
  };
  if (hoursPerWeek != null) {
    body.hours_per_week = hoursPerWeek;
  }

  const res = await fetch('/api/schedule/rebalance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let message = 'Failed to rebalance schedule';
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

/** Resume on-hold projects (all, or specific goal IDs). */
export async function resumeOnHoldGoals({ goalIds = null } = {}) {
  const body = {};
  if (goalIds != null) {
    body.goal_ids = goalIds;
  }

  const res = await fetch('/api/schedule/resume', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let message = 'Failed to resume projects';
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
