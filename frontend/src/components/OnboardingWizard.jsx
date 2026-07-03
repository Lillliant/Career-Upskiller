import React, { useState } from 'react';
import { useAppState } from '../stateManager';

export default function OnboardingWizard() {
  const [state, setState] = useAppState();
  
  // Local state for Onboarding Wizard
  const [goals, setGoals] = useState(state.careerGoals || 'AI Engineering');
  const [firstProject, setFirstProject] = useState('Build an ADK workflow');
  const [hours, setHours] = useState(state.hoursPerWeek || 5);
  const [startTime, setStartTime] = useState(state.preferredStartTime || '09:00');
  const [endTime, setEndTime] = useState(state.preferredEndTime || '17:00');
  const [localExcludedDays, setLocalExcludedDays] = useState(state.excludedDays || ['Saturday', 'Sunday']);
  
  const [localCalendars, setLocalCalendars] = useState(
    state.targetCalendars.map(c => ({
      ...c,
      provider: c.provider || 'google',
      role: c.role || (c.id === 'cal-work' ? 'write' : 'read_only'),
      icalUrl: c.icalUrl || ''
    }))
  );

  const [step, setStep] = useState(1);
  const [isSaving, setIsSaving] = useState(false);

  const toggleExcludedDay = (day) => {
    if (localExcludedDays.includes(day)) {
      setLocalExcludedDays(localExcludedDays.filter(d => d !== day));
    } else {
      setLocalExcludedDays([...localExcludedDays, day]);
    }
  };

  const updateCalendarField = (id, field, value) => {
    const updated = localCalendars.map(cal => {
      if (cal.id === id) {
        let newCal = { ...cal, [field]: value };
        // Under Zero-Trust rules, only ONE calendar can be the 'write' destination
        if (field === 'role' && value === 'write') {
          return newCal; // handled below to unset others
        }
        return newCal;
      }
      return cal;
    });

    if (field === 'role' && value === 'write') {
      // Unset role='write' on all other calendars, forcing them to 'read_only'
      updated.forEach(c => {
        if (c.id !== id && c.role === 'write') {
          c.role = 'read_only';
        }
      });
    }
    setLocalCalendars(updated);
  };

  const handleNext = async () => {
    if (step < 3) {
      setStep(step + 1);
    } else {
      setIsSaving(true);
      
      const targetCals = localCalendars.map(cal => ({
        id: cal.id,
        name: cal.name,
        selected: cal.role !== 'isolated',
        sensitive: cal.sensitive,
        provider: cal.provider,
        role: cal.role,
        url: cal.icalUrl
      }));

      const newGoal = {
        title: firstProject,
        description: `Kickstart project for ${goals}`,
        status: 'in-progress',
        time_spent_mins: 0,
        sub_projects: [
          { title: "Review market insights", completed: true },
          { title: "Define workflow edges", completed: false },
          { title: "Confirm Zero-Trust calendar write", completed: false }
        ]
      };

      const updatedState = {
        careerGoals: goals,
        hoursPerWeek: hours,
        preferredStartTime: startTime,
        preferredEndTime: endTime,
        excludedDays: localExcludedDays,
        targetCalendars: targetCals,
        goals: [newGoal],
        onboarded: true,
        activeTab: 'schedule'
      };

      if (state.isSimulating) {
        // Simulation mode: stage mock weekly events
        const mockTransactionId = `tx-sim-${Math.random().toString(36).substring(2, 8)}`;
        const mockToken = `token-sim-${Math.random().toString(36).substring(2, 10)}`;
        
        // Generate proposed events matching rotating goals/projects
        const proposed = [
          {
            id: 'evt-1',
            summary: `Learning: ${firstProject}`,
            start: "2026-07-02T11:30:00-04:00",
            end: "2026-07-02T12:00:00-04:00",
            description: `Scheduled upskilling for goal '${firstProject}' due to calendar constraints.`
          },
          {
            id: 'evt-2',
            summary: `Learning: ${goals} Overview`,
            start: "2026-07-03T14:00:00-04:00",
            end: "2026-07-03T15:00:00-04:00",
            description: `Scheduled study on ${goals} market trends.`
          }
        ];

        setState({
          ...updatedState,
          transactionId: mockTransactionId,
          token: mockToken,
          proposedEvents: proposed,
          scarcityFlag: true,
          reason: "Calendar is dense with meetings. Some blocks degraded to 30 minutes to fit working hours.",
        });
      } else {
        // Live mode: POST to FastAPI app
        try {
          // 1. Save profile configuration
          const resProfile = await fetch('/api/profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              career_goals: goals,
              hours_per_week: hours,
              preferred_start_time: startTime,
              preferred_end_time: endTime,
              excluded_days: localExcludedDays,
              target_calendars: targetCals
            })
          });

          if (!resProfile.ok) throw new Error("Failed to save profile on backend.");

          // 2. Create the first goal
          const resGoal = await fetch('/api/goals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: newGoal.title,
              description: newGoal.description,
              status: newGoal.status,
              sub_projects: newGoal.sub_projects
            })
          });

          if (!resGoal.ok) throw new Error("Failed to create first goal on backend.");

          // 3. Initiate agent staging schedule run
          const runRes = await fetch('/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              user_id: 'test_user_123',
              session_id: 'active_session_123',
              new_message: {
                role: 'user',
                parts: [{ text: "Initialize schedule." }]
              }
            })
          });

          if (runRes.ok) {
            const runData = await runRes.json();
            console.log("Agent scheduling initialized:", runRes);
          }

          // Trigger state fetches
          setState(updatedState);
        } catch (err) {
          console.error("Failed to complete onboarding:", err);
          alert(`Onboarding write error: ${err.message}. Saving state locally in simulation mode.`);
          setState(updatedState);
        }
      }
      setIsSaving(false);
    }
  };

  const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  return (
    <div style={styles.container} className="glass-card animate-fade-in">
      {/* Progress indicators */}
      <div style={styles.statusBar}>
        <div style={{ ...styles.stepIndicator, backgroundColor: step >= 1 ? 'var(--color-accent)' : 'var(--input-border)' }}></div>
        <div style={{ ...styles.stepIndicator, backgroundColor: step >= 2 ? 'var(--color-accent)' : 'var(--input-border)' }}></div>
        <div style={{ ...styles.stepIndicator, backgroundColor: step >= 3 ? 'var(--color-accent)' : 'var(--input-border)' }}></div>
      </div>

      {step === 1 && (
        <div>
          <h2 style={styles.title}>1. Skill Goals & Project Draft 🎯</h2>
          <p style={styles.subtitle}>Specify the career direction and outline your first concrete learning project.</p>

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
            <label style={styles.label}>Draft your first goal/project title:</label>
            <input 
              type="text" 
              value={firstProject} 
              onChange={(e) => setFirstProject(e.target.value)} 
              style={styles.textInput} 
              placeholder="e.g. Implement semantic search API"
            />
          </div>

          <div style={styles.insightsCard}>
            <h4 style={styles.insightsTitle}>📊 Live Market Trends</h4>
            <ul style={styles.insightsList}>
              {state.marketInsights.map((insight, idx) => (
                <li key={idx} style={styles.insightItem}>
                  <span style={styles.bullet}>⚡</span> {insight}
                </li>
              ))}
            </ul>
          </div>

          <button onClick={handleNext} style={styles.primaryButton}>
            Next: Scheduling Preferences →
          </button>
        </div>
      )}

      {step === 2 && (
        <div>
          <h2 style={styles.title}>2. Working Hours & Pacing ⏱️</h2>
          <p style={styles.subtitle}>Configure your time constraints and pacing preferences.</p>

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

          <div style={styles.row}>
            <div style={{ ...styles.formGroup, flex: 1 }}>
              <label style={styles.label}>Preferred start time:</label>
              <select value={startTime} onChange={(e) => setStartTime(e.target.value)} style={styles.selectInput}>
                {Array.from({ length: 24 }).map((_, h) => {
                  const hour = `${h.toString().padStart(2, '0')}:00`;
                  return <option key={hour} value={hour}>{hour}</option>;
                })}
              </select>
            </div>
            <div style={{ ...styles.formGroup, flex: 1 }}>
              <label style={styles.label}>Preferred end time:</label>
              <select value={endTime} onChange={(e) => setEndTime(e.target.value)} style={styles.selectInput}>
                {Array.from({ length: 24 }).map((_, h) => {
                  const hour = `${h.toString().padStart(2, '0')}:00`;
                  return <option key={hour} value={hour}>{hour}</option>;
                })}
              </select>
            </div>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Excluded study days:</label>
            <div style={styles.daysList}>
              {daysOfWeek.map(day => {
                const isExcluded = localExcludedDays.includes(day);
                return (
                  <button 
                    key={day}
                    onClick={() => toggleExcludedDay(day)}
                    style={{
                      ...styles.dayBadge,
                      backgroundColor: isExcluded ? 'var(--color-warning)' : 'var(--bg-sidebar)',
                      color: isExcluded ? '#000000' : 'var(--color-text-main)',
                      borderColor: isExcluded ? 'var(--color-warning)' : 'var(--input-border)'
                    }}
                  >
                    {day.substring(0, 3)}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={styles.buttonGroup}>
            <button onClick={() => setStep(1)} style={styles.secondaryButton}>
              Back
            </button>
            <button onClick={handleNext} style={styles.primaryButton}>
              Next: Calendar Scoping →
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          <h2 style={styles.title}>3. Zero-Trust Calendar Authorization 🔒</h2>
          <p style={styles.subtitle}>
            Authorize access scopes. Under security directives, you must designate exactly one **Write Calendar**. iCal feeds require subscription URLs.
          </p>

          <div style={styles.scopingBox}>
            {localCalendars.map((cal) => (
              <div key={cal.id} style={styles.calendarCard}>
                <div style={styles.calendarRow}>
                  <div>
                    <div style={styles.calendarName}>{cal.name}</div>
                    <div style={styles.sensitiveDesc}>
                      {cal.sensitive ? '🔒 Contains private information' : '🔓 Public business events'}
                    </div>
                  </div>

                  <div style={styles.selectors}>
                    <select 
                      value={cal.provider} 
                      onChange={(e) => updateCalendarField(cal.id, 'provider', e.target.value)} 
                      style={styles.inlineSelect}
                    >
                      <option value="google">Google Calendar</option>
                      <option value="apple">Apple iCloud</option>
                      <option value="microsoft">Outlook</option>
                      <option value="ical">iCal Subscription</option>
                    </select>

                    <select 
                      value={cal.role} 
                      onChange={(e) => updateCalendarField(cal.id, 'role', e.target.value)} 
                      style={{
                        ...styles.inlineSelect,
                        color: cal.role === 'write' ? 'var(--color-success)' : cal.role === 'read_only' ? 'var(--color-accent)' : 'var(--color-text-muted)'
                      }}
                    >
                      <option value="write">Write destination</option>
                      <option value="read_only">Display Only (Read)</option>
                      <option value="isolated">Isolated (Invisible)</option>
                    </select>
                  </div>
                </div>

                {cal.provider === 'ical' && cal.role !== 'isolated' && (
                  <div style={styles.icalInputRow}>
                    <label style={styles.smallLabel}>iCal Subscription URL:</label>
                    <input 
                      type="text" 
                      value={cal.icalUrl} 
                      onChange={(e) => updateCalendarField(cal.id, 'icalUrl', e.target.value)} 
                      placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
                      style={styles.textInputSmall}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          <div style={styles.trustBanner}>
            <div style={styles.trustIcon}>🛡️</div>
            <div style={styles.trustText}>
              <strong>Privacy Protection:</strong> The Concierge reads busy events in memory for scheduling but strictly limits writes to the single designated write destination.
            </div>
          </div>

          <div style={styles.buttonGroup}>
            <button onClick={() => setStep(2)} style={styles.secondaryButton}>
              Back
            </button>
            <button onClick={handleNext} style={styles.primaryButton} disabled={isSaving}>
              {isSaving ? 'Saving Configurations...' : 'Finalize & Stage Schedule'}
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
    width: '100%',
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
    fontSize: '22px',
    marginBottom: '8px',
    background: 'linear-gradient(to right, var(--color-accent), #a78bfa)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  subtitle: {
    fontSize: '13px',
    color: 'var(--color-text-muted)',
    marginBottom: '24px',
    lineHeight: '1.5',
  },
  formGroup: {
    marginBottom: '20px',
  },
  row: {
    display: 'flex',
    gap: '16px',
  },
  label: {
    display: 'block',
    fontSize: '13px',
    color: 'var(--color-text-main)',
    marginBottom: '8px',
    fontWeight: '600',
  },
  smallLabel: {
    display: 'block',
    fontSize: '11px',
    color: 'var(--color-text-muted)',
    marginBottom: '4px',
  },
  textInput: {
    width: '100%',
    backgroundColor: 'var(--input-bg)',
    border: '1px solid var(--input-border)',
    borderRadius: '8px',
    padding: '12px 16px',
    fontSize: '14px',
    color: 'var(--color-text-main)',
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  textInputSmall: {
    width: '100%',
    backgroundColor: 'var(--bg-main)',
    border: '1px solid var(--input-border)',
    borderRadius: '6px',
    padding: '8px 12px',
    fontSize: '12px',
    color: 'var(--color-text-main)',
    outline: 'none',
  },
  selectInput: {
    width: '100%',
    backgroundColor: 'var(--input-bg)',
    border: '1px solid var(--input-border)',
    borderRadius: '8px',
    padding: '12px',
    fontSize: '14px',
    color: 'var(--color-text-main)',
    outline: 'none',
  },
  rangeInput: {
    width: '100%',
    cursor: 'pointer',
    accentColor: 'var(--color-accent)',
  },
  rangeLabels: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '11px',
    color: 'var(--color-text-muted)',
    marginTop: '4px',
  },
  daysList: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  dayBadge: {
    padding: '8px 14px',
    borderRadius: '20px',
    border: '1px solid',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    outline: 'none',
    transition: 'all 0.2s',
  },
  insightsCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    border: '1px solid var(--border-card)',
    borderRadius: '12px',
    padding: '16px',
    marginBottom: '24px',
  },
  insightsTitle: {
    fontSize: '12px',
    color: 'var(--color-accent)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: '10px',
  },
  insightsList: {
    listStyle: 'none',
  },
  insightItem: {
    fontSize: '12px',
    color: 'var(--color-text-main)',
    marginBottom: '8px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  bullet: {
    color: 'var(--color-warning)',
  },
  scopingBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    marginBottom: '24px',
  },
  calendarCard: {
    backgroundColor: 'var(--bg-main)',
    border: '1px solid var(--border-card)',
    borderRadius: '10px',
    padding: '16px',
  },
  calendarRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '12px',
  },
  calendarName: {
    fontSize: '14px',
    fontWeight: '600',
    color: 'var(--color-text-main)',
  },
  sensitiveDesc: {
    fontSize: '11px',
    color: 'var(--color-text-muted)',
    marginTop: '2px',
  },
  selectors: {
    display: 'flex',
    gap: '8px',
  },
  inlineSelect: {
    backgroundColor: 'var(--bg-sidebar)',
    border: '1px solid var(--input-border)',
    color: 'var(--color-text-main)',
    padding: '6px 12px',
    borderRadius: '6px',
    fontSize: '12px',
    outline: 'none',
  },
  icalInputRow: {
    marginTop: '12px',
    borderTop: '1px solid var(--border-divider)',
    paddingTop: '12px',
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
    color: 'var(--color-success)',
    lineHeight: '1.4',
  },
  primaryButton: {
    width: '100%',
    backgroundColor: 'var(--color-accent)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    padding: '12px 24px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s',
    outline: 'none',
    ':disabled': {
      opacity: 0.5,
      cursor: 'not-allowed',
    }
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    color: 'var(--color-text-muted)',
    border: '1px solid var(--input-border)',
    borderRadius: '8px',
    padding: '12px 20px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
    outline: 'none',
  },
  buttonGroup: {
    display: 'flex',
    gap: '12px',
    marginTop: '24px',
  }
};
