import React from 'react';
import { useAppState } from '../stateManager';

export default function AnalyticsSummary() {
  const [state] = useAppState();

  // Helper to calculate total hours scheduled
  const calculateScheduledHours = () => {
    let totalMs = 0;
    state.calendarEvents.forEach(evt => {
      if (evt.type === 'learning') {
        const start = new Date(evt.start);
        const end = new Date(evt.end);
        totalMs += (end - start);
      }
    });
    return (totalMs / (1000 * 60 * 60)); // convert to hours
  };

  const totalHoursScheduled = calculateScheduledHours();
  const weeklyTarget = state.hoursPerWeek || 5;
  const progressPercent = Math.min(Math.round((totalHoursScheduled / weeklyTarget) * 100), 100);

  // Group goals and count milestones
  const activeGoalsCount = state.goals.filter(g => g.status === 'in-progress' || g.status === 'to-do').length;
  const completedGoalsCount = state.goals.filter(g => g.status === 'done').length;

  let totalTasks = 0;
  let completedTasks = 0;
  state.goals.forEach(g => {
    if (g.sub_projects) {
      totalTasks += g.sub_projects.length;
      completedTasks += g.sub_projects.filter(t => t.completed).length;
    }
  });

  // Calculate calendar counts
  const allowedCount = state.targetCalendars.filter(c => c.selected).length;
  const totalCount = state.targetCalendars.length;

  return (
    <div style={styles.container} className="animate-fade-in">
      <div style={styles.header}>
        <h2 style={styles.pageTitle}>Upskilling Analytics Summary 📊</h2>
        <p style={styles.pageSubtitle}>Monitor goals completion rates, pacing statistics, and security whitelists.</p>
      </div>

      <div style={styles.grid}>
        {/* Metric 1: Hours Allocated */}
        <div style={styles.metricCard} className="glass-card">
          <div style={styles.metricHeader}>
            <span style={styles.metricLabel}>Total Weekly Allocated</span>
            <span style={styles.metricIcon}>⏱️</span>
          </div>
          <div style={styles.metricValue}>
            {totalHoursScheduled.toFixed(1)} <span style={styles.unit}>hrs</span>
          </div>
          <p style={styles.metricDesc}>
            Sum of approved skill development blocks scheduled this week.
          </p>
        </div>

        {/* Metric 2: Completion Projection */}
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

        {/* Metric 3: Security Status */}
        <div style={styles.metricCard} className="glass-card">
          <div style={styles.metricHeader}>
            <span style={styles.metricLabel}>Calendar Scoping</span>
            <span style={styles.metricIcon}>🛡️</span>
          </div>
          <div style={styles.metricValue}>
            {allowedCount} / {totalCount}
          </div>
          <p style={styles.metricDesc}>
            Calendars whitelisted for scheduling. Others remain strictly isolated.
          </p>
        </div>
      </div>

      {/* Target Progress Bar Section */}
      <div style={styles.progressSection} className="glass-card">
        <div style={styles.progressLabelRow}>
          <span>Weekly Allocation Target Pace</span>
          <span>{totalHoursScheduled.toFixed(1)}h / {weeklyTarget}h ({progressPercent}%)</span>
        </div>
        <div style={styles.progressBarBg}>
          <div 
            style={{ 
              ...styles.progressBarFill, 
              width: `${progressPercent}%`,
              background: progressPercent >= 100 
                ? 'linear-gradient(to right, var(--color-success), #34d399)' 
                : 'linear-gradient(to right, var(--color-accent), #38bdf8)'
            }}
          ></div>
        </div>
      </div>

      {/* Goal Pacing Categories List */}
      <div style={styles.goalListingBox} className="glass-card">
        <h3 style={styles.boxTitle}>Goals Distribution & Time Invested</h3>
        
        {state.goals.length === 0 ? (
          <div style={styles.emptyText}>No goals created yet. Complete onboarding or head to Goal Builder.</div>
        ) : (
          <div style={styles.goalsProgressContainer}>
            {state.goals.map((g) => {
              // Calculate completion of task list
              const tCount = g.sub_projects ? g.sub_projects.length : 0;
              const cCount = g.sub_projects ? g.sub_projects.filter(t => t.completed).length : 0;
              const pct = tCount > 0 ? Math.round((cCount / tCount) * 100) : 0;

              return (
                <div key={g.id} style={styles.goalProgressItem}>
                  <div style={styles.goalInfoRow}>
                    <div>
                      <strong style={styles.goalName}>{g.title}</strong>
                      <span style={styles.goalDescText}> ({g.status})</span>
                    </div>
                    <span style={styles.goalTimeSpent}>⏱️ {g.time_spent_mins || 0} mins logged</span>
                  </div>

                  <div style={styles.progressBarWrapper}>
                    <div style={styles.barBg}>
                      <div style={{ ...styles.barFill, width: `${pct}%` }}></div>
                    </div>
                    <span style={styles.barPct}>{pct}% done</span>
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
  goalProgressItemLast: {
    borderBottom: 'none',
    paddingBottom: 0,
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
  }
};
