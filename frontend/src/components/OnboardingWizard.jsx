import React, { useState } from 'react';
import { useAppState } from '../stateManager';

export default function OnboardingWizard() {
  const [state, setState] = useAppState();
  const [goals, setGoals] = useState(state.careerGoals || 'AI Engineering');
  const [hours, setHours] = useState(state.hoursPerWeek || 5);
  const [localCalendars, setLocalCalendars] = useState(state.targetCalendars);
  const [step, setStep] = useState(1);

  const toggleCalendar = (id) => {
    const updated = localCalendars.map(cal => 
      cal.id === id ? { ...cal, selected: !cal.selected } : cal
    );
    setLocalCalendars(updated);
    setState({ targetCalendars: updated });
  };

  const handleNext = () => {
    if (step === 1) {
      setStep(2);
    } else {
      // Complete onboarding and stage schedule (with mock data if simulating)
      const selectedIds = localCalendars.filter(c => c.selected).map(c => c.id);
      
      const updatedState = {
        careerGoals: goals,
        hoursPerWeek: hours,
        onboarded: true,
        activeTab: 'schedule'
      };

      if (state.isSimulating) {
        // Mock a schedule proposal (Phase 2 / 2b Scarcity)
        const mockTransactionId = `tx-sim-${Math.random().toString(36).substring(2, 8)}`;
        const mockToken = `token-sim-${Math.random().toString(36).substring(2, 10)}`;
        
        // Generate proposed events based on goals
        const proposed = [
          {
            id: 'evt-1',
            summary: `Micro-learning: ${goals} Deep Dive`,
            start: "2026-07-02T11:30:00-04:00",
            end: "2026-07-02T12:00:00-04:00",
            description: `Short focused study slot on ${goals} created due to high calendar density.`
          },
          {
            id: 'evt-2',
            summary: `Micro-learning: ${goals} Practical Lab`,
            start: "2026-07-02T14:30:00-04:00",
            end: "2026-07-02T15:00:00-04:00",
            description: `Hands-on practice block to build concrete ${goals} skills.`
          }
        ];

        updatedState.transactionId = mockTransactionId;
        updatedState.token = mockToken;
        updatedState.proposedEvents = proposed;
        updatedState.scarcityFlag = true;
        updatedState.reason = "Calendar is dense with Work meetings. The Concierge gracefully degraded your daily target of 2 hours into two 30-minute micro-learning blocks.";
      }

      setState(updatedState);
    }
  };

  return (
    <div style={styles.container} className="glass-card animate-fade-in">
      <div style={styles.statusBar}>
        <div style={{ ...styles.stepIndicator, backgroundColor: step >= 1 ? '#6366f1' : '#334155' }}></div>
        <div style={{ ...styles.stepIndicator, backgroundColor: step >= 2 ? '#6366f1' : '#334155' }}></div>
      </div>

      {step === 1 ? (
        <div>
          <h2 style={styles.title}>Welcome to Career Skill Concierge 👤</h2>
          <p style={styles.subtitle}>Let's build a personalized career advancement plan aligned with real-time market trends.</p>

          <div style={styles.insightsCard}>
            <h4 style={styles.insightsTitle}>📈 Live Market Analytics</h4>
            <ul style={styles.insightsList}>
              {state.marketInsights.map((insight, idx) => (
                <li key={idx} style={styles.insightItem}>
                  <span style={styles.bullet}>⚡</span> {insight}
                </li>
              ))}
            </ul>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>What is your target career upskilling goal?</label>
            <input 
              type="text" 
              value={goals} 
              onChange={(e) => setGoals(e.target.value)} 
              style={styles.textInput} 
              placeholder="e.g. AI Engineering, Cloud Architecture"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Weekly time budget: <strong>{hours} hours/week</strong></label>
            <input 
              type="range" 
              min="1" 
              max="20" 
              value={hours} 
              onChange={(e) => setHours(Number(e.target.value))} 
              style={styles.rangeInput}
            />
            <div style={styles.rangeLabels}>
              <span>1h</span>
              <span>10h</span>
              <span>20h</span>
            </div>
          </div>

          <button onClick={handleNext} style={styles.primaryButton}>
            Continue to Calendar Scope Selection →
          </button>
        </div>
      ) : (
        <div>
          <h2 style={styles.title}>Zero-Trust Calendar Authorization 🔒</h2>
          <p style={styles.subtitle}>
            Select target calendars allowed for scheduling. Unselected calendars will remain <strong>completely isolated</strong> and dark to the agent.
          </p>

          <div style={styles.scopingBox}>
            <div style={styles.scopingHeader}>
              <span>Target Calendar</span>
              <span>Permission Scope</span>
            </div>
            
            {localCalendars.map((cal) => (
              <div 
                key={cal.id} 
                onClick={() => toggleCalendar(cal.id)}
                style={{
                  ...styles.calendarRow,
                  borderLeft: cal.selected ? '4px solid #6366f1' : '4px solid #334155',
                  backgroundColor: cal.selected ? 'rgba(99, 102, 241, 0.05)' : 'transparent'
                }}
              >
                <div style={styles.calendarInfo}>
                  <input 
                    type="checkbox" 
                    checked={cal.selected} 
                    onChange={() => {}} // Handled by row onClick
                    style={styles.checkbox}
                  />
                  <div>
                    <div style={styles.calendarName}>{cal.name}</div>
                    {cal.sensitive && (
                      <span style={styles.sensitiveLabel}>🔒 Strictly Private / Dark</span>
                    )}
                  </div>
                </div>
                <div>
                  {cal.selected ? (
                    <span style={styles.scopeBadgeAllowed}>✓ Read/Staging Access</span>
                  ) : (
                    <span style={styles.scopeBadgeBlocked}>Isolated (Invisible)</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div style={styles.trustBanner}>
            <div style={styles.trustIcon}>🛡️</div>
            <div style={styles.trustText}>
              <strong>Privacy Mandate:</strong> The client state manager cryptographically binds the allowed calendar identifiers to all requests. The orchestrator cannot fetch schedule events outside these scopes.
            </div>
          </div>

          <div style={styles.buttonGroup}>
            <button onClick={() => setStep(1)} style={styles.secondaryButton}>
              ← Back
            </button>
            <button onClick={handleNext} style={styles.primaryButton}>
              Finalize Onboarding & Stage Schedule
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    maxWidth: '650px',
    margin: '30px auto',
    padding: '30px',
  },
  statusBar: {
    display: 'flex',
    gap: '8px',
    marginBottom: '24px',
  },
  stepIndicator: {
    height: '4px',
    flex: 1,
    borderRadius: '2px',
    transition: 'background-color 0.3s ease',
  },
  title: {
    fontSize: '24px',
    marginBottom: '8px',
    background: 'linear-gradient(to right, #60a5fa, #a78bfa)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  subtitle: {
    fontSize: '14px',
    color: '#94a3b8',
    marginBottom: '24px',
    lineHeight: '1.5',
  },
  insightsCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    border: '1px solid rgba(255, 255, 255, 0.05)',
    borderRadius: '12px',
    padding: '16px',
    marginBottom: '24px',
  },
  insightsTitle: {
    fontSize: '13px',
    color: '#38bdf8',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: '10px',
  },
  insightsList: {
    listStyle: 'none',
  },
  insightItem: {
    fontSize: '13px',
    color: '#e2e8f0',
    marginBottom: '8px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  bullet: {
    color: '#fbbf24',
  },
  formGroup: {
    marginBottom: '24px',
  },
  label: {
    display: 'block',
    fontSize: '14px',
    color: '#cbd5e1',
    marginBottom: '8px',
  },
  textInput: {
    width: '100%',
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    padding: '12px 16px',
    fontSize: '14px',
    color: '#f8fafc',
    outline: 'none',
    transition: 'border-color 0.2s',
    ':focus': {
      borderColor: '#6366f1',
    }
  },
  rangeInput: {
    width: '100%',
    cursor: 'pointer',
    accentColor: '#6366f1',
  },
  rangeLabels: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '11px',
    color: '#64748b',
    marginTop: '4px',
  },
  scopingBox: {
    border: '1px solid rgba(255, 255, 255, 0.06)',
    borderRadius: '12px',
    overflow: 'hidden',
    marginBottom: '24px',
  },
  scopingHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '10px 16px',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
    fontSize: '11px',
    textTransform: 'uppercase',
    color: '#64748b',
    letterSpacing: '0.05em',
  },
  calendarRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 16px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
    ':hover': {
      backgroundColor: 'rgba(255, 255, 255, 0.01)',
    }
  },
  calendarInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  checkbox: {
    width: '16px',
    height: '16px',
    cursor: 'pointer',
    accentColor: '#6366f1',
  },
  calendarName: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#f1f5f9',
  },
  sensitiveLabel: {
    fontSize: '10px',
    color: '#f59e0b',
    display: 'block',
    marginTop: '2px',
  },
  scopeBadgeAllowed: {
    fontSize: '11px',
    color: '#34d399',
    backgroundColor: 'rgba(52, 211, 153, 0.08)',
    padding: '4px 8px',
    borderRadius: '6px',
    border: '1px solid rgba(52, 211, 153, 0.15)',
  },
  scopeBadgeBlocked: {
    fontSize: '11px',
    color: '#94a3b8',
    backgroundColor: 'rgba(148, 163, 184, 0.05)',
    padding: '4px 8px',
    borderRadius: '6px',
    border: '1px solid rgba(148, 163, 184, 0.08)',
  },
  trustBanner: {
    display: 'flex',
    gap: '12px',
    padding: '14px',
    backgroundColor: 'rgba(16, 185, 129, 0.05)',
    border: '1px solid rgba(16, 185, 129, 0.15)',
    borderRadius: '12px',
    marginBottom: '24px',
    alignItems: 'center',
  },
  trustIcon: {
    fontSize: '20px',
  },
  trustText: {
    fontSize: '12px',
    color: '#a7f3d0',
    lineHeight: '1.4',
  },
  primaryButton: {
    width: '100%',
    backgroundColor: '#6366f1',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    padding: '12px 24px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)',
    transition: 'all 0.2s',
    outline: 'none',
    ':hover': {
      backgroundColor: '#4f46e5',
      transform: 'translateY(-1px)',
    }
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    color: '#94a3b8',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    padding: '12px 20px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
    outline: 'none',
    ':hover': {
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
    }
  },
  buttonGroup: {
    display: 'flex',
    gap: '12px',
    marginTop: '24px',
  }
};
