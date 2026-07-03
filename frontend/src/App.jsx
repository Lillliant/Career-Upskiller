import React from 'react';
import { useAppState } from './stateManager';
import OnboardingWizard from './components/OnboardingWizard';
import WeeklyCalendar from './components/WeeklyCalendar';
import SkillsManager from './components/SkillsManager';
import GoalBuilderChat from './components/GoalBuilderChat';
import AnalyticsSummary from './components/AnalyticsSummary';

export default function App() {
  const [state, setState] = useAppState();

  // Sync light/dark mode theme with document class
  React.useEffect(() => {
    if (state.theme === 'light') {
      document.body.classList.add('light-theme');
    } else {
      document.body.classList.remove('light-theme');
    }
  }, [state.theme]);

  // Load backend profile, goals and events in live mode
  const fetchAllData = async () => {
    if (state.isSimulating) return;
    try {
      const resProfile = await fetch('/api/profile');
      if (resProfile.ok) {
        const profile = await resProfile.json();
        if (profile.career_goals) {
          setState({
            careerGoals: profile.career_goals,
            hoursPerWeek: profile.hours_per_week,
            preferredStartTime: profile.preferred_start_time || '09:00',
            preferredEndTime: profile.preferred_end_time || '17:00',
            excludedDays: profile.excluded_days || ['Saturday', 'Sunday'],
            targetCalendars: profile.target_calendars || state.targetCalendars,
            proposedEvents: profile.proposed_events || [],
            scarcityFlag: profile.scarcity_flag || false,
            reason: profile.reason || '',
            onboarded: true
          });
        }
      }
      
      const resGoals = await fetch('/api/goals');
      if (resGoals.ok) {
        const goals = await resGoals.json();
        setState({ goals });
      }

      const resCalendar = await fetch('/api/calendar/events');
      if (resCalendar.ok) {
        const calendarEvents = await resCalendar.json();
        setState({ calendarEvents });
      }
    } catch (err) {
      console.error("Failed to load backend state:", err);
    }
  };

  React.useEffect(() => {
    fetchAllData();
  }, [state.onboarded]);

  const handleApproveHandshake = async (envelope) => {
    const logEntry = {
      timestamp: new Date().toISOString(),
      action: 'Zero-Trust Approval Signature Dispatched',
      payload: envelope
    };
    
    const updatedLogs = [...state.logs, logEntry];

    if (state.isSimulating) {
      // Simulation mode
      setState({ 
        logs: updatedLogs,
        isSubmitted: true,
        calendarEvents: [
          ...state.calendarEvents,
          ...state.proposedEvents.map(e => ({
            ...e,
            type: 'learning',
            color: '#6366f1'
          }))
        ],
        proposedEvents: [] // Clear staged
      });
      return Promise.resolve();
    } else {
      // Live Mode: Dispatch to FastAPI backend
      try {
        const response = await fetch('/run', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            user_id: 'test_user_123',
            session_id: 'active_session_123',
            new_message: {
              role: 'user',
              parts: [
                {
                  function_response: {
                    id: 'approval_payload',
                    name: 'adk_request_input',
                    response: envelope
                  }
                }
              ]
            }
          })
        });

        if (!response.ok) {
          throw new Error(`FastAPI response error: ${response.statusText}`);
        }

        const data = await response.json();
        console.log("Live execution resume response:", data);
        
        setState({ 
          logs: [...updatedLogs, {
            timestamp: new Date().toISOString(),
            action: 'Live Calendar Write Confirmed',
            payload: data
          }],
          isSubmitted: true
        });

        // Trigger refresh
        setTimeout(fetchAllData, 1000);
      } catch (err) {
        console.error("Failed to dispatch live handshake:", err);
        alert(`Failed to resume backend agent. Make sure fast_api_app.py is running. Error: ${err.message}`);
        throw err;
      }
    }
  };

  const handleCancelHandshake = (envelope) => {
    const logEntry = {
      timestamp: new Date().toISOString(),
      action: 'Transaction Rejected & Cancelled',
      payload: envelope
    };
    setState({ 
      logs: [...state.logs, logEntry],
      isSubmitted: false
    });
  };

  const handleReset = () => {
    setState({
      careerGoals: '',
      hoursPerWeek: 5,
      preferredStartTime: '09:00',
      preferredEndTime: '17:00',
      excludedDays: ['Saturday', 'Sunday'],
      targetCalendars: state.targetCalendars.map(c => ({ ...c, selected: c.id === 'cal-work' })),
      proposedEvents: [],
      scarcityFlag: false,
      reason: '',
      isSubmitted: false,
      onboarded: false,
      goals: [],
      calendarEvents: [],
      logs: [],
      activeTab: 'onboarding'
    });
  };

  return (
    <div style={styles.appContainer}>
      {/* Left Sidebar Menu */}
      <aside style={styles.sidebar}>
        <div style={styles.sidebarTop}>
          <div style={styles.logoContainer}>
            <span style={styles.logoIcon}>🤵</span>
            <div>
              <h1 style={styles.logoText}>Concierge</h1>
              <span style={styles.logoSubtitle}>Career Skill Planner</span>
            </div>
          </div>

          <nav style={styles.navLinks}>
            <button 
              onClick={() => setState({ activeTab: 'schedule' })}
              style={{
                ...styles.navLink,
                backgroundColor: state.activeTab === 'schedule' ? 'rgba(99, 102, 241, 0.12)' : 'transparent',
                color: state.activeTab === 'schedule' ? 'var(--color-accent)' : 'var(--color-text-muted)',
                fontWeight: state.activeTab === 'schedule' ? '700' : '500',
                borderLeft: state.activeTab === 'schedule' ? '3px solid var(--color-accent)' : '3px solid transparent'
              }}
              disabled={!state.onboarded}
            >
              📅 Weekly Schedule
            </button>

            <button 
              onClick={() => setState({ activeTab: 'skills' })}
              style={{
                ...styles.navLink,
                backgroundColor: state.activeTab === 'skills' ? 'rgba(99, 102, 241, 0.12)' : 'transparent',
                color: state.activeTab === 'skills' ? 'var(--color-accent)' : 'var(--color-text-muted)',
                fontWeight: state.activeTab === 'skills' ? '700' : '500',
                borderLeft: state.activeTab === 'skills' ? '3px solid var(--color-accent)' : '3px solid transparent'
              }}
              disabled={!state.onboarded}
            >
              🎯 Skills & Projects
            </button>

            <button 
              onClick={() => setState({ activeTab: 'builder' })}
              style={{
                ...styles.navLink,
                backgroundColor: state.activeTab === 'builder' ? 'rgba(99, 102, 241, 0.12)' : 'transparent',
                color: state.activeTab === 'builder' ? 'var(--color-accent)' : 'var(--color-text-muted)',
                fontWeight: state.activeTab === 'builder' ? '700' : '500',
                borderLeft: state.activeTab === 'builder' ? '3px solid var(--color-accent)' : '3px solid transparent'
              }}
              disabled={!state.onboarded}
            >
              💬 Goal Builder
            </button>

            <button 
              onClick={() => setState({ activeTab: 'summary' })}
              style={{
                ...styles.navLink,
                backgroundColor: state.activeTab === 'summary' ? 'rgba(99, 102, 241, 0.12)' : 'transparent',
                color: state.activeTab === 'summary' ? 'var(--color-accent)' : 'var(--color-text-muted)',
                fontWeight: state.activeTab === 'summary' ? '700' : '500',
                borderLeft: state.activeTab === 'summary' ? '3px solid var(--color-accent)' : '3px solid transparent'
              }}
              disabled={!state.onboarded}
            >
              📊 Summary Analytics
            </button>

            <button 
              onClick={() => setState({ activeTab: 'onboarding' })}
              style={{
                ...styles.navLink,
                backgroundColor: state.activeTab === 'onboarding' ? 'rgba(99, 102, 241, 0.12)' : 'transparent',
                color: state.activeTab === 'onboarding' ? 'var(--color-accent)' : 'var(--color-text-muted)',
                fontWeight: state.activeTab === 'onboarding' ? '700' : '500',
                borderLeft: state.activeTab === 'onboarding' ? '3px solid var(--color-accent)' : '3px solid transparent'
              }}
            >
              ⚙️ Settings / Onboarding
            </button>
          </nav>
        </div>

        <div style={styles.sidebarBottom}>
          <div style={styles.modeIndicator}>
            <div style={styles.modeText}>
              {state.isSimulating ? '🛠️ Sim Mode (Mock)' : '⚡ Live Agent Active'}
            </div>
            <button 
              onClick={() => setState({ isSimulating: !state.isSimulating })}
              style={styles.modeToggleBtn}
            >
              Switch Mode
            </button>
          </div>

          <div style={styles.themeRow}>
            <button 
              onClick={() => setState({ theme: state.theme === 'dark' ? 'light' : 'dark' })}
              style={styles.themeBtn}
            >
              {state.theme === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode'}
            </button>
          </div>

          {state.onboarded && (
            <button onClick={handleReset} style={styles.resetBtn}>
              Reset App State
            </button>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <main style={styles.mainCanvas}>
        {!state.onboarded ? (
          <OnboardingWizard />
        ) : (
          <div style={{ width: '100%' }}>
            {state.activeTab === 'onboarding' && <OnboardingWizard />}
            {state.activeTab === 'schedule' && (
              <WeeklyCalendar 
                onApprove={handleApproveHandshake}
                onCancel={handleCancelHandshake}
              />
            )}
            {state.activeTab === 'skills' && <SkillsManager />}
            {state.activeTab === 'builder' && <GoalBuilderChat />}
            {state.activeTab === 'summary' && <AnalyticsSummary />}
          </div>
        )}

        {/* Transaction Security Logs */}
        {state.logs.length > 0 && (
          <footer style={styles.logInspector} className="glass-card">
            <div style={styles.logHeader}>
              <span>🛡️ Zero-Trust Security Audit Logs</span>
              <span style={styles.badgeCount}>{state.logs.length} entries</span>
            </div>
            <div style={styles.logList}>
              {state.logs.map((log, idx) => (
                <div key={idx} style={styles.logItem}>
                  <div style={styles.logMeta}>
                    <span style={styles.logTime}>{new Date(log.timestamp).toLocaleTimeString()}</span>
                    <span style={styles.logAction}>{log.action}</span>
                  </div>
                  <pre style={styles.logPayload}>
                    {JSON.stringify(log.payload, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          </footer>
        )}
      </main>
    </div>
  );
}

const styles = {
  appContainer: {
    display: 'flex',
    minHeight: '100vh',
    width: '100vw',
    backgroundColor: 'var(--bg-main)',
  },
  sidebar: {
    width: '260px',
    backgroundColor: 'var(--bg-sidebar)',
    borderRight: '1px solid var(--border-divider)',
    padding: '24px 16px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    flexShrink: 0,
  },
  sidebarTop: {
    display: 'flex',
    flexDirection: 'column',
    gap: '32px',
  },
  logoContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    paddingLeft: '8px',
  },
  logoIcon: {
    fontSize: '28px',
  },
  logoText: {
    fontSize: '18px',
    fontWeight: '700',
    color: 'var(--color-text-main)',
    margin: 0,
    lineHeight: '1.2',
  },
  logoSubtitle: {
    fontSize: '11px',
    color: 'var(--color-text-muted)',
    display: 'block',
  },
  navLinks: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  navLink: {
    backgroundColor: 'transparent',
    border: 'none',
    color: 'var(--color-text-muted)',
    padding: '12px 16px',
    borderRadius: '8px',
    fontSize: '13px',
    textAlign: 'left',
    cursor: 'pointer',
    transition: 'all 0.2s',
    outline: 'none',
    display: 'block',
    width: '100%',
  },
  sidebarBottom: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    paddingTop: '20px',
    borderTop: '1px solid var(--border-divider)',
  },
  modeIndicator: {
    backgroundColor: 'var(--bg-card)',
    padding: '10px',
    borderRadius: '8px',
    border: '1px solid var(--border-card)',
    textAlign: 'center',
  },
  modeText: {
    fontSize: '11px',
    color: 'var(--color-text-main)',
    fontWeight: '600',
    marginBottom: '6px',
  },
  modeToggleBtn: {
    backgroundColor: 'var(--color-accent)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '4px',
    padding: '4px 8px',
    fontSize: '10px',
    fontWeight: '600',
    cursor: 'pointer',
    width: '100%',
  },
  themeRow: {
    display: 'flex',
    justifyContent: 'center',
  },
  themeBtn: {
    backgroundColor: 'transparent',
    border: '1px solid var(--input-border)',
    color: 'var(--color-text-main)',
    padding: '6px 16px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    width: '100%',
    textAlign: 'center',
    outline: 'none',
  },
  resetBtn: {
    backgroundColor: 'transparent',
    border: '1px solid rgba(244, 63, 94, 0.2)',
    color: '#fb7185',
    padding: '8px 12px',
    borderRadius: '8px',
    fontSize: '12px',
    cursor: 'pointer',
    fontWeight: '600',
    width: '100%',
  },
  mainCanvas: {
    flex: 1,
    padding: '40px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  logInspector: {
    marginTop: '40px',
    width: '100%',
    maxWidth: '900px',
  },
  logHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '12px',
    fontWeight: '600',
    color: 'var(--color-accent)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: '14px',
  },
  badgeCount: {
    fontSize: '10px',
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    padding: '2px 8px',
    borderRadius: '10px',
    color: 'var(--color-accent)',
  },
  logList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    maxHeight: '200px',
    overflowY: 'auto',
  },
  logItem: {
    backgroundColor: 'rgba(0,0,0,0.15)',
    borderRadius: '8px',
    border: '1px solid var(--border-divider)',
    padding: '12px',
  },
  logMeta: {
    display: 'flex',
    gap: '12px',
    fontSize: '11px',
    marginBottom: '6px',
  },
  logTime: {
    color: 'var(--color-text-muted)',
  },
  logAction: {
    color: 'var(--color-text-main)',
    fontWeight: '600',
  },
  logPayload: {
    fontSize: '11px',
    color: 'var(--color-text-muted)',
    fontFamily: 'monospace',
    margin: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    padding: '8px',
    borderRadius: '4px',
    overflowX: 'auto',
  }
};

