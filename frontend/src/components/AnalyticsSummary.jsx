import React from 'react';
import { useAppState } from '../stateManager';

function parseGoalTitleFromSummary(summary) {
  if (!summary) return null;
  const prefix = summary.includes(' - ') ? summary.split(' - ')[0] : summary;
  if (prefix.startsWith('Learning: ')) return prefix.slice(10).trim();
  if (prefix.startsWith('Micro-learning: ')) return prefix.slice(16).trim();
  return null;
}

function isLearningEvent(evt) {
  return !evt.type || evt.type === 'learning';
}

function eventDurationMins(evt) {
  const start = new Date(evt.start);
  const end = new Date(evt.end);
  return (end - start) / 60000;
}

function getScheduleEvents(state) {
  return state.scheduledEvents?.length > 0 ? state.scheduledEvents : [];
}

function buildScheduledMinsByGoal(events) {
  const map = {};
  (events || []).forEach((evt) => {
    if (!isLearningEvent(evt)) return;
    const goalTitle = parseGoalTitleFromSummary(evt.summary);
    if (!goalTitle) return;
    map[goalTitle] = (map[goalTitle] || 0) + eventDurationMins(evt);
  });
  return map;
}

function buildDoneMinsByGoal(events, now = Date.now()) {
  const map = {};
  (events || []).forEach((evt) => {
    if (!isLearningEvent(evt)) return;
    if (new Date(evt.end).getTime() > now) return;
    const goalTitle = parseGoalTitleFromSummary(evt.summary);
    if (!goalTitle) return;
    map[goalTitle] = (map[goalTitle] || 0) + eventDurationMins(evt);
  });
  return map;
}

function sumLearningEventMins(events, { onlyPast = false, now = Date.now() } = {}) {
  return (events || []).reduce((total, evt) => {
    if (!isLearningEvent(evt)) return total;
    if (onlyPast && new Date(evt.end).getTime() > now) return total;
    return total + eventDurationMins(evt);
  }, 0);
}

function computeGoalScheduledMins(goal) {
  let total = 0;
  (goal.sub_projects || []).forEach((m) => {
    (m.tasks || []).forEach((t) => {
      total += t.allocated_time_mins || 0;
    });
  });
  return total;
}

function formatDurationMins(mins) {
  if (mins < 60) return `${Math.round(mins)}m`;
  const hours = Math.round((mins / 60) * 10) / 10;
  return `${hours}h`;
}

export default function AnalyticsSummary() {
  const [state] = useAppState();
  const scheduleEvents = getScheduleEvents(state);

  const totalHoursScheduled = sumLearningEventMins(scheduleEvents) / 60;
  const totalHoursDone = sumLearningEventMins(scheduleEvents, { onlyPast: true }) / 60;

  const calculateWeeklyScheduledHours = () => {
    let totalMs = 0;
    state.calendarEvents.forEach((evt) => {
      if (evt.type === 'learning') {
        const start = new Date(evt.start);
        const end = new Date(evt.end);
        totalMs += (end - start);
      }
    });
    return totalMs / (1000 * 60 * 60);
  };

  const weeklyHoursScheduled = calculateWeeklyScheduledHours();
  const weeklyTarget = state.hoursPerWeek || 5;
  const progressPercent = Math.min(Math.round((weeklyHoursScheduled / weeklyTarget) * 100), 100);
  const scheduledMinsByGoal = buildScheduledMinsByGoal(scheduleEvents);
  const doneMinsByGoal = buildDoneMinsByGoal(scheduleEvents);

  let totalTasks = 0;
  let completedTasks = 0;
  state.goals.forEach((g) => {
    if (g.sub_projects) {
      g.sub_projects.forEach((m) => {
        if (m.tasks && m.tasks.length > 0) {
          totalTasks += m.tasks.length;
          completedTasks += m.tasks.filter((t) => t.completed).length;
        } else {
          totalTasks += 1;
          if (m.completed) completedTasks += 1;
        }
      });
    }
  });

  return (
    <div style={styles.container} className="animate-fade-in">
      <div style={styles.header}>
        <h2 style={styles.pageTitle}>Upskilling Analytics Summary 📊</h2>
        <p style={styles.pageSubtitle}>Monitor goals completion rates and pacing statistics.</p>
      </div>

      <div style={styles.grid}>
        <div style={styles.metricCard} className="glass-card">
          <div style={styles.metricHeader}>
            <span style={styles.metricLabel}>Total Scheduled Time</span>
            <span style={styles.metricIcon}>⏱️</span>
          </div>
          <div style={styles.metricValue}>
            {totalHoursScheduled.toFixed(1)} <span style={styles.unit}>hrs</span>
          </div>
          <p style={styles.metricDesc}>
            Sum of all approved skill development blocks scheduled across all weeks.
          </p>
        </div>

        <div style={styles.metricCard} className="glass-card">
          <div style={styles.metricHeader}>
            <span style={styles.metricLabel}>Total Time Done</span>
            <span style={styles.metricIcon}>✅</span>
          </div>
          <div style={styles.metricValue}>
            {totalHoursDone.toFixed(1)} <span style={styles.unit}>hrs</span>
          </div>
          <p style={styles.metricDesc}>
            Approved learning blocks from the schedule whose end time has already passed.
          </p>
        </div>

        <div style={styles.metricCard} className="glass-card">
          <div style={styles.metricHeader}>
            <span style={styles.metricLabel}>Milestones Finished</span>
            <span style={styles.metricIcon}>🎯</span>
          </div>
          <div style={styles.metricValue}>
            {completedTasks} / {totalTasks}
          </div>
          <p style={styles.metricDesc}>
            Number of project tasks and checklist items checked off.
          </p>
        </div>
      </div>

      <div style={styles.progressSection} className="glass-card">
        <div style={styles.progressLabelRow}>
          <span>Weekly Allocation Target Pace (Week Offset: {state.currentWeekOffset})</span>
          <span>{weeklyHoursScheduled.toFixed(1)}h / {weeklyTarget}h ({progressPercent}%)</span>
        </div>
        <div style={styles.progressBarBg}>
          <div
            style={{
              ...styles.progressBarFill,
              width: `${progressPercent}%`,
              background: progressPercent >= 100
                ? 'linear-gradient(to right, var(--color-success), #34d399)'
                : 'linear-gradient(to right, var(--color-accent), #38bdf8)',
            }}
          />
        </div>
      </div>

      <div style={styles.goalListingBox} className="glass-card">
        <h3 style={styles.boxTitle}>Goals Distribution & Time Invested</h3>

        {state.goals.length === 0 ? (
          <div style={styles.emptyText}>No goals created yet. Complete onboarding or head to Goal Builder.</div>
        ) : (
          <div style={styles.goalsProgressContainer}>
            {state.goals.map((g) => {
              let tCount = 0;
              let cCount = 0;
              if (g.sub_projects) {
                g.sub_projects.forEach((m) => {
                  if (m.tasks && m.tasks.length > 0) {
                    tCount += m.tasks.length;
                    cCount += m.tasks.filter((t) => t.completed).length;
                  } else {
                    tCount += 1;
                    if (m.completed) cCount += 1;
                  }
                });
              }
              const pct = tCount > 0 ? Math.round((cCount / tCount) * 100) : 0;
              const scheduledMins = scheduledMinsByGoal[g.title] || computeGoalScheduledMins(g) || 0;
              const doneMins = doneMinsByGoal[g.title] || 0;

              return (
                <div key={g.id} style={styles.goalProgressItem}>
                  <div style={styles.goalInfoRow}>
                    <div>
                      <strong style={styles.goalName}>{g.title}</strong>
                      <span style={styles.goalDescText}> ({g.status})</span>
                    </div>
                    <span style={styles.goalTimeSpent}>
                      <span>⏱️ {formatDurationMins(scheduledMins)} scheduled</span>
                      <span style={styles.goalDoneTime}> · ✅ {formatDurationMins(doneMins)} done</span>
                    </span>
                  </div>

                  <div style={styles.progressBarWrapper}>
                    <div style={styles.barBg}>
                      <div style={{ ...styles.barFill, width: `${pct}%` }} />
                    </div>
                    <span style={styles.barPct}>{pct}% tasks done</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    width: '100%',
    maxWidth: '900px',
    margin: '0 auto',
  },
  header: {
    marginBottom: '28px',
  },
  pageTitle: {
    fontSize: '22px',
    color: 'var(--color-text-main)',
    margin: 0,
  },
  pageSubtitle: {
    fontSize: '13px',
    color: 'var(--color-text-muted)',
    marginTop: '4px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '20px',
    marginBottom: '24px',
  },
  metricCard: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    padding: '20px',
  },
  metricHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  },
  metricLabel: {
    fontSize: '11px',
    color: 'var(--color-text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    fontWeight: '600',
  },
  metricIcon: {
    fontSize: '18px',
  },
  metricValue: {
    fontSize: '28px',
    fontWeight: '700',
    color: 'var(--color-text-main)',
    marginBottom: '8px',
  },
  unit: {
    fontSize: '14px',
    color: 'var(--color-text-muted)',
    fontWeight: '400',
  },
  metricDesc: {
    fontSize: '11px',
    color: 'var(--color-text-muted)',
    lineHeight: '1.4',
    margin: 0,
  },
  progressSection: {
    padding: '20px',
    marginBottom: '24px',
  },
  progressLabelRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '13px',
    color: 'var(--color-text-main)',
    marginBottom: '8px',
    fontWeight: '600',
  },
  progressBarBg: {
    height: '8px',
    backgroundColor: 'var(--bg-main)',
    borderRadius: '4px',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: '4px',
    transition: 'width 0.3s ease',
  },
  goalListingBox: {
    padding: '24px',
  },
  boxTitle: {
    fontSize: '14px',
    color: 'var(--color-text-main)',
    marginBottom: '16px',
    fontWeight: '700',
  },
  emptyText: {
    fontSize: '12px',
    color: 'var(--color-text-muted)',
    textAlign: 'center',
    padding: '20px 0',
  },
  goalsProgressContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  goalProgressItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    borderBottom: '1px solid var(--border-divider)',
    paddingBottom: '16px',
  },
  goalInfoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  goalName: {
    fontSize: '13px',
    color: 'var(--color-text-main)',
  },
  goalDescText: {
    fontSize: '11px',
    color: 'var(--color-text-muted)',
  },
  goalTimeSpent: {
    fontSize: '12px',
    color: 'var(--color-accent)',
    fontWeight: '600',
  },
  goalDoneTime: {
    color: 'var(--color-success, #10b981)',
    fontWeight: '600',
  },
  progressBarWrapper: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  barBg: {
    flex: 1,
    height: '6px',
    backgroundColor: 'var(--bg-main)',
    borderRadius: '3px',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: 'var(--color-accent)',
    borderRadius: '3px',
  },
  barPct: {
    fontSize: '11px',
    color: 'var(--color-text-muted)',
    width: '70px',
    textAlign: 'right',
  },
};
