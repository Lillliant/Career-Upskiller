import React from 'react';
import { useAppState } from './stateManager';
import OnboardingWizard from './components/OnboardingWizard';
import WeeklyCalendar from './components/WeeklyCalendar';
import SkillsManager from './components/SkillsManager';
import ProjectsManager from './components/ProjectsManager';
import GoalBuilderChat from './components/GoalBuilderChat';
import ReflectionAgentChat from './components/ReflectionAgentChat';
import AnalyticsSummary from './components/AnalyticsSummary';
import { approveWeeklySchedule, rejectWeeklySchedule } from './scheduleApi';

export default function App() {
  const [state, setState] = useAppState();
  const isFirstLoad = React.useRef(true);

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
    try {
      const resProfile = await fetch('/api/profile');
      if (resProfile.ok) {
        const profile = await resProfile.json();
        if (profile.target_calendars && profile.target_calendars.length > 0) {
          setState({ targetCalendars: profile.target_calendars });
        }
        if (profile.available_google_calendars) {
          setState({ availableGoogleCalendars: profile.available_google_calendars });
        }
        if (profile.onboarded || profile.career_goals) {
          const nextState = {
            careerGoals: profile.career_goals || '',
            hoursPerWeek: profile.hours_per_week,
            preferredStartTime: profile.preferred_start_time || '09:00',
            preferredEndTime: profile.preferred_end_time || '17:00',
            studyDays: profile.study_days || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
            targetCalendars: profile.target_calendars || state.targetCalendars,
            proposedEvents: profile.proposed_events || [],
            scarcityFlag: profile.scarcity_flag || false,
            reason: profile.reason || '',
            transactionId: profile.transaction_id || '',
            token: profile.token || '',
            onboarded: true,
            scheduledEvents: profile.scheduled_events || []
          };
          if (isFirstLoad.current) {
            nextState.activeTab = 'schedule';
          }
          if (profile.builder_messages?.length) {
            nextState.builderMessages = profile.builder_messages;
          }
          if (profile.builder_archived_conversations?.length) {
            nextState.builderArchivedConversations = profile.builder_archived_conversations;
          }
          setState(nextState);
        } else {
          setState({
            onboarded: false,
            activeTab: 'onboarding'
          });
        }
        isFirstLoad.current = false;
      }
      
      const resGoals = await fetch('/api/goals');
      if (resGoals.ok) {
        const goals = await resGoals.json();
        setState({ goals });
      }

      // Pass week offset to fetch events for selected week
      const resCalendar = await fetch(`/api/calendar/events?offset=${state.currentWeekOffset}`);
      if (resCalendar.ok) {
        const calendarEvents = await resCalendar.json();
        setState({ calendarEvents });
      }
    } catch (err) {
      console.error("Failed to load backend state:", err);
    }
  };

  React.useEffect(() => {
    const handleOAuthCallback = async () => {
      const path = window.location.pathname;
      const searchParams = new URLSearchParams(window.location.search);
      const code = searchParams.get('code');
      
      if (path === '/oauth-callback' && code) {
        // Clear history immediately to prevent concurrent duplicate invocations in StrictMode or re-renders
        window.history.replaceState({}, document.title, "/");
        try {
          setState({ activeTab: 'onboarding' });
          const res = await fetch(`/api/auth/google/callback?code=${code}`);
          if (res.ok) {
            await fetchAllData();
            alert("Google Calendar successfully connected! All local events have been synchronized.");
          } else {
            const errData = await res.json();
            alert(`Failed to connect Google Calendar: ${errData.detail || 'Unknown error'}`);
          }
        } catch (e) {
          console.error("Error during OAuth callback:", e);
        }
      } else {
        fetchAllData();
      }
    };
    handleOAuthCallback();
  }, [state.onboarded, state.currentWeekOffset, state.activeTab]);

  const handleApproveHandshake = async (envelope) => {
    try {
      const data = await approveWeeklySchedule(envelope);
      console.log("Schedule approval response:", data);
      
      setState({ 
        isSubmitted: true,
        proposedEvents: [],
        scarcityFlag: false,
        reason: '',
        transactionId: '',
        token: '',
        scheduledEvents: data.scheduled_events || state.scheduledEvents,
      });

      await fetchAllData();
    } catch (err) {
      console.error("Failed to dispatch schedule approval:", err);
      alert(`Failed to approve schedule: ${err.message}`);
      throw err;
    }
  };

  const handleCancelHandshake = async (envelope) => {
    try {
      await rejectWeeklySchedule(envelope);
      setState({ 
        isSubmitted: false,
        proposedEvents: [],
        scarcityFlag: false,
        reason: '',
        transactionId: '',
        token: '',
      });
    } catch (err) {
      console.error("Failed to reject schedule:", err);
      alert(`Failed to reject schedule: ${err.message}`);
    }
  };

  const handleReset = async () => {
    try {
      await fetch('/api/reset', {
        method: 'POST',
      });
    } catch (err) {
      console.error("Failed to reset backend state:", err);
    }
    localStorage.removeItem('onboarding_progress');
    setState({
      careerGoals: '',
      hoursPerWeek: 5,
      preferredStartTime: '09:00',
      preferredEndTime: '17:00',
      studyDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      targetCalendars: [],
      availableGoogleCalendars: [],
      currentWeekOffset: 0,
      proposedEvents: [],
      scarcityFlag: false,
      reason: '',
      isSubmitted: false,
      onboarded: false,
      goals: [],
      calendarEvents: [],
      scheduledEvents: [],
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
              🏆 My Skills
            </button>

            <button 
              onClick={() => setState({ activeTab: 'projects' })}
              style={{
                ...styles.navLink,
                backgroundColor: state.activeTab === 'projects' ? 'rgba(99, 102, 241, 0.12)' : 'transparent',
                color: state.activeTab === 'projects' ? 'var(--color-accent)' : 'var(--color-text-muted)',
                fontWeight: state.activeTab === 'projects' ? '700' : '500',
                borderLeft: state.activeTab === 'projects' ? '3px solid var(--color-accent)' : '3px solid transparent'
              }}
              disabled={!state.onboarded}
            >
              📋 Projects & Goals
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
              ⚙️ Settings
            </button>
          </nav>
        </div>

        <div style={styles.sidebarBottom}>
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
            {state.activeTab === 'projects' && <ProjectsManager />}
            {state.activeTab === 'builder' && <GoalBuilderChat />}
            {state.activeTab === 'reflection' && <ReflectionAgentChat />}
            {state.activeTab === 'summary' && <AnalyticsSummary />}
          </div>
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
};

