import React from 'react';
import { useAppState } from '../stateManager';

export default function ProgressDashboard() {
  const [state] = useAppState();

  // Helper to parse duration in hours
  const calculateTotalHours = () => {
    let totalMs = 0;
    state.proposedEvents.forEach(evt => {
      const start = new Date(evt.start);
      const end = new Date(evt.end);
      totalMs += (end - start);
    });
    return (totalMs / (1000 * 60 * 60)); // convert to hours
  };

  const totalHours = calculateTotalHours();
  const weeklyTarget = state.hoursPerWeek || 5;
  const progressPercent = Math.min(Math.round((totalHours / weeklyTarget) * 100), 100);

  // Dynamic Milestone Projections: assume 60 hours needed for standard upskilling certification
  const totalHoursRequired = 60;
  // Based on current daily/weekly pace, calculate weeks to complete
  const weeksToComplete = totalHours > 0
    ? (totalHoursRequired / (totalHours * 5)).toFixed(1) // assume 5 working days scheduled similarly
    : '∞';

  return (
    <div style={styles.container} className="glass-card animate-fade-in">
      <h2 style={styles.title}>Dynamic Analytics Dashboard 📊</h2>
      <p style={styles.subtitle}>Real-time scheduling analytics mirrored from your Interactive Vibe Diff canvas.</p>

      <div style={styles.grid}>
        {/* Metric 1: Hours Allocated */}
        <div style={styles.metricCard}>
          <div style={styles.metricHeader}>
            <span style={styles.metricLabel}>Daily Allocated Time</span>
            <span style={styles.metricIcon}>⏱️</span>
          </div>
          <div style={styles.metricValue}>
            {totalHours.toFixed(1)} <span style={styles.unit}>hrs</span>
          </div>
          <p style={styles.metricDesc}>
            Sum of current learning blocks staged in the timeline matrix.
          </p>
        </div>

        {/* Metric 2: Completion Projection */}
        <div style={styles.metricCard}>
          <div style={styles.metricHeader}>
            <span style={styles.metricLabel}>Certification Projection</span>
            <span style={styles.metricIcon}>🎯</span>
          </div>
          <div style={styles.metricValue}>
            {weeksToComplete} <span style={styles.unit}>weeks</span>
          </div>
          <p style={styles.metricDesc}>
            Estimated time to hit 60 hours based on your modified daily pace.
          </p>
        </div>

        {/* Progress Bar Section */}
        <div style={styles.progressSection}>
          <div style={styles.progressLabelRow}>
            <span>Weekly Target Achievement Pace (Daily Contribution)</span>
            <span>{totalHours.toFixed(1)}h / {weeklyTarget}h ({progressPercent}%)</span>
          </div>
          <div style={styles.progressBarBg}>
            <div
              style={{
                ...styles.progressBarFill,
                width: `${progressPercent}%`,
                background: progressPercent >= 100
                  ? 'linear-gradient(to right, #10b981, #34d399)'
                  : 'linear-gradient(to right, #6366f1, #38bdf8)'
              }}
            ></div>
          </div>
        </div>

        {/* Milestone Timeline Visualization */}
        <div style={styles.milestoneBox}>
          <h4 style={styles.sectionHeader}>upskilling milestones</h4>

          <div style={styles.timeline}>
            <div style={styles.timelineItem}>
              <div style={styles.timelineBulletActive}>✓</div>
              <div style={styles.timelineContent}>
                <div style={styles.timelineTitle}>Onboarding & Scoping Complete</div>
                <div style={styles.timelineDate}>Configured goal: "{state.careerGoals || 'Not specified'}"</div>
              </div>
            </div>

            <div style={styles.timelineItem}>
              <div style={totalHours > 0 ? styles.timelineBulletActive : styles.timelineBullet}>
                {totalHours > 0 ? '✓' : '2'}
              </div>
              <div style={styles.timelineContent}>
                <div style={styles.timelineTitle}>Initial Blocks Scheduled</div>
                <div style={styles.timelineDate}>
                  {totalHours > 0
                    ? `Staged ${state.proposedEvents.length} blocks (${totalHours.toFixed(1)} hours)`
                    : 'Awaiting scheduling configuration'
                  }
                </div>
              </div>
            </div>

            <div style={styles.timelineItem}>
              <div style={state.isSubmitted ? styles.timelineBulletActive : styles.timelineBullet}>
                {state.isSubmitted ? '✓' : '3'}
              </div>
              <div style={styles.timelineContent}>
                <div style={styles.timelineTitle}>Zero-Trust Write Approval</div>
                <div style={styles.timelineDate}>
                  {state.isSubmitted
                    ? 'Cryptographic handshake completed.'
                    : 'Pending final interactive execution approval.'
                  }
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      );
}

      const styles = {
        container: {
        maxWidth: '850px',
      margin: '30px auto',
      padding: '30px',
  },
      title: {
        fontSize: '24px',
      marginBottom: '8px',
      background: 'linear-gradient(to right, #34d399, #3b82f6)',
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
  },
      subtitle: {
        fontSize: '14px',
      color: '#94a3b8',
      marginBottom: '30px',
      lineHeight: '1.5',
  },
      grid: {
        display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
      gap: '20px',
      marginBottom: '30px',
  },
      metricCard: {
        backgroundColor: 'rgba(255, 255, 255, 0.02)',
      border: '1px solid rgba(255, 255, 255, 0.05)',
      borderRadius: '12px',
      padding: '20px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
  },
      metricHeader: {
        display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '12px',
  },
      metricLabel: {
        fontSize: '12px',
      color: '#94a3b8',
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      fontWeight: '600',
  },
      metricIcon: {
        fontSize: '18px',
  },
      metricValue: {
        fontSize: '32px',
      fontWeight: '700',
      color: '#f8fafc',
      marginBottom: '8px',
      fontFamily: "'Outfit', sans-serif",
  },
      unit: {
        fontSize: '16px',
      color: '#94a3b8',
      fontWeight: '400',
  },
      metricDesc: {
        fontSize: '12px',
      color: '#64748b',
      lineHeight: '1.4',
  },
      progressSection: {
        marginBottom: '35px',
  },
      progressLabelRow: {
        display: 'flex',
      justifyContent: 'space-between',
      fontSize: '13px',
      color: '#cbd5e1',
      marginBottom: '8px',
  },
      progressBarBg: {
        height: '10px',
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
      borderRadius: '5px',
      overflow: 'hidden',
  },
      progressBarFill: {
        height: '100%',
      borderRadius: '5px',
      transition: 'width 0.3s ease',
  },
      milestoneBox: {
        backgroundColor: 'rgba(255, 255, 255, 0.01)',
      border: '1px solid rgba(255, 255, 255, 0.04)',
      borderRadius: '12px',
      padding: '20px',
  },
      sectionHeader: {
        fontSize: '12px',
      color: '#94a3b8',
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      marginBottom: '16px',
  },
      timeline: {
        display: 'flex',
      flexDirection: 'column',
      gap: '20px',
  },
      timelineItem: {
        display: 'flex',
      gap: '16px',
      alignItems: 'flex-start',
  },
      timelineBulletActive: {
        width: '24px',
      height: '24px',
      borderRadius: '50%',
      backgroundColor: '#10b981',
      color: '#ffffff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '11px',
      fontWeight: '700',
      flexShrink: 0,
  },
      timelineBullet: {
        width: '24px',
      height: '24px',
      borderRadius: '50%',
      backgroundColor: '#1e293b',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      color: '#94a3b8',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '11px',
      fontWeight: '700',
      flexShrink: 0,
  },
      timelineContent: {
        flex: 1,
  },
      timelineTitle: {
        fontSize: '14px',
      fontWeight: '600',
      color: '#e2e8f0',
  },
      timelineDate: {
        fontSize: '12px',
      color: '#64748b',
      marginTop: '2px',
  }
};
