import React from 'react';
import { useAppState } from './stateManager';
import OnboardingWizard from './components/OnboardingWizard';
import InteractiveVibeDiff from './components/InteractiveVibeDiff';
import ProgressDashboard from './components/ProgressDashboard';

export default function App() {
  const [state, setState] = useAppState();

  const handleApproveHandshake = async (envelope) => {
    // Audit log addition
    const logEntry = {
      timestamp: new Date().toISOString(),
      action: 'Zero-Trust Approval Signature Dispatched',
      payload: envelope
    };
    
    const updatedLogs = [...state.logs, logEntry];

    if (state.isSimulating) {
      // Simulation mode: simply resolve client-side and log
      setState({ 
        logs: updatedLogs,
        isSubmitted: true
      });
      return Promise.resolve();
    } else {
      // Live Mode: Dispatch to FastAPI backend to resume runner
      try {
        const response = await fetch('/run', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            user_id: 'test_user_123',
            session_id: 'active_session_123', // In a real app, track active session
            new_message: {
              role: 'user',
              parts: [
                {
                  function_response: {
                    id: 'approval_payload', // matches orchestrator interrupt id
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
      } catch (err) {
        console.error("Failed to dispatch live handshake:", err);
        alert(`Failed to resume backend agent. Make sure fast_api_app.py is running on port 8000. Error: ${err.message}`);
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
      targetCalendars: state.targetCalendars.map(c => ({ ...c, selected: c.id === 'cal-work' })),
      proposedEvents: [],
      scarcityFlag: false,
      reason: '',
      isSubmitted: false,
      onboarded: false,
      logs: [],
      activeTab: 'onboarding'
    });
  };

  return (
    <div style={styles.appContainer}>
      {/* Top Banner */}
      <header style={styles.appHeader}>
        <div style={styles.headerLeft}>
          <span style={styles.logoIcon}> Concierge</span>
          <h1 style={styles.logoText}>Career Skill Concierge</h1>
        </div>

        {/* Mode Selector & Control Options */}
        <div style={styles.headerRight}>
          <div style={styles.simToggleContainer}>
            <span style={state.isSimulating ? styles.simLabelActive : styles.simLabel}>
              {state.isSimulating ? '🛠️ Simulation Mode (Mock)' : '⚡ Live Agent Connected'}
            </span>
            <button 
              onClick={() => setState({ isSimulating: !state.isSimulating })}
              style={styles.toggleBtn}
            >
              Toggle Mode
            </button>
          </div>
          
          {state.onboarded && (
            <button onClick={handleReset} style={styles.resetBtn}>
              Reset Session
            </button>
          )}
        </div>
      </header>

      {/* Tabs Navigation Bar */}
      {state.onboarded && (
        <nav style={styles.navBar} className="glass-card">
          <button 
            onClick={() => setState({ activeTab: 'onboarding' })}
            style={{ 
              ...styles.navTab, 
              color: state.activeTab === 'onboarding' ? '#cbd5e1' : '#64748b',
              borderBottom: state.activeTab === 'onboarding' ? '2px solid #cbd5e1' : 'none'
            }}
          >
            1. User Profile & Scopes
          </button>
          <button 
            onClick={() => setState({ activeTab: 'schedule' })}
            style={{ 
              ...styles.navTab, 
              color: state.activeTab === 'schedule' ? '#818cf8' : '#64748b',
              borderBottom: state.activeTab === 'schedule' ? '2px solid #818cf8' : 'none'
            }}
          >
            2. Proposed Schedule Matrix
          </button>
          <button 
            onClick={() => setState({ activeTab: 'dashboard' })}
            style={{ 
              ...styles.navTab, 
              color: state.activeTab === 'dashboard' ? '#34d399' : '#64748b',
              borderBottom: state.activeTab === 'dashboard' ? '2px solid #34d399' : 'none'
            }}
          >
            3. Dynamic Analytics
          </button>
        </nav>
      )}

      {/* Primary Canvas Container */}
      <main style={styles.mainContent}>
        {!state.onboarded ? (
          <OnboardingWizard />
        ) : (
          <>
            {state.activeTab === 'onboarding' && <OnboardingWizard />}
            {state.activeTab === 'schedule' && (
              <InteractiveVibeDiff 
                transactionId={state.transactionId}
                token={state.token}
                proposedEvents={state.proposedEvents}
                scarcityFlag={state.scarcityFlag}
                reason={state.reason}
                onApprove={handleApproveHandshake}
                onCancel={handleCancelHandshake}
              />
            )}
            {state.activeTab === 'dashboard' && <ProgressDashboard />}
          </>
        )}
      </main>

      {/* Transaction & Cryptographic Log Inspector */}
      {state.logs.length > 0 && (
        <footer style={styles.logInspector} className="glass-card">
          <div style={styles.logHeader}>
            <span>🛡️ Zero-Trust Handshake Logs & Payload Auditor</span>
            <span style={styles.badgeCount}>{state.logs.length} audit entry(s)</span>
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
    </div>
  );
}

const styles = {
  appContainer: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '20px',
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
  },
  appHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: '20px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
    marginBottom: '20px',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  logoIcon: {
    fontSize: '24px',
  },
  logoText: {
    fontSize: '20px',
    fontWeight: '700',
    color: '#f8fafc',
    letterSpacing: '-0.02em',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  simToggleContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    padding: '6px 12px',
    borderRadius: '24px',
    border: '1px solid rgba(255, 255, 255, 0.05)',
  },
  simLabel: {
    fontSize: '11px',
    color: '#94a3b8',
    fontWeight: '500',
  },
  simLabelActive: {
    fontSize: '11px',
    color: '#38bdf8',
    fontWeight: '600',
  },
  toggleBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    border: 'none',
    color: '#cbd5e1',
    padding: '4px 10px',
    borderRadius: '12px',
    fontSize: '10px',
    cursor: 'pointer',
    fontWeight: '600',
    transition: 'background 0.2s',
    outline: 'none',
    ':hover': {
      backgroundColor: 'rgba(255, 255, 255, 0.15)',
    }
  },
  resetBtn: {
    backgroundColor: 'transparent',
    border: '1px solid rgba(244, 63, 94, 0.2)',
    color: '#fb7185',
    padding: '6px 14px',
    borderRadius: '8px',
    fontSize: '11px',
    cursor: 'pointer',
    fontWeight: '600',
    outline: 'none',
    ':hover': {
      backgroundColor: 'rgba(244, 63, 94, 0.05)',
    }
  },
  navBar: {
    display: 'flex',
    gap: '4px',
    padding: '6px',
    borderRadius: '12px',
    marginBottom: '24px',
  },
  navTab: {
    backgroundColor: 'transparent',
    border: 'none',
    padding: '10px 16px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s',
    outline: 'none',
  },
  mainContent: {
    flex: 1,
  },
  logInspector: {
    marginTop: '40px',
    padding: '20px',
    border: '1px solid rgba(255, 255, 255, 0.05)',
  },
  logHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '12px',
    fontWeight: '600',
    color: '#38bdf8',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: '14px',
  },
  badgeCount: {
    fontSize: '10px',
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    padding: '2px 8px',
    borderRadius: '10px',
    border: '1px solid rgba(56, 189, 248, 0.25)',
  },
  logList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    maxHeight: '300px',
    overflowY: 'auto',
  },
  logItem: {
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.04)',
    padding: '12px',
  },
  logMeta: {
    display: 'flex',
    gap: '12px',
    fontSize: '11px',
    marginBottom: '6px',
  },
  logTime: {
    color: '#64748b',
  },
  logAction: {
    color: '#e2e8f0',
    fontWeight: '600',
  },
  logPayload: {
    fontSize: '11px',
    color: '#a5b4fc',
    fontFamily: 'monospace',
    margin: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    padding: '8px',
    borderRadius: '4px',
    overflowX: 'auto',
  }
};
