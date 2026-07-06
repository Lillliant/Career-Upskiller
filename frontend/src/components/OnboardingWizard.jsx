import React, { useState } from 'react';
import { useAppState } from '../stateManager';

export default function OnboardingWizard() {
  const [state, setState] = useAppState();

  // Local state for Preferences
  const [goals, setGoals] = useState(() => {
    const saved = localStorage.getItem('onboarding_progress');
    if (saved) {
      try { return JSON.parse(saved).goals || 'AI Engineering'; } catch (e) { }
    }
    return state.careerGoals || 'AI Engineering';
  });
  const [firstProject, setFirstProject] = useState(() => {
    const saved = localStorage.getItem('onboarding_progress');
    if (saved) {
      try { return JSON.parse(saved).firstProject || 'Build an ADK workflow'; } catch (e) { }
    }
    return 'Build an ADK workflow';
  });
  const [hours, setHours] = useState(() => {
    const saved = localStorage.getItem('onboarding_progress');
    if (saved) {
      try { return JSON.parse(saved).hours || 5; } catch (e) { }
    }
    return state.hoursPerWeek || 5;
  });
  const [startTime, setStartTime] = useState(() => {
    const saved = localStorage.getItem('onboarding_progress');
    if (saved) {
      try { return JSON.parse(saved).startTime || '09:00'; } catch (e) { }
    }
    return state.preferredStartTime || '09:00';
  });
  const [endTime, setEndTime] = useState(() => {
    const saved = localStorage.getItem('onboarding_progress');
    if (saved) {
      try { return JSON.parse(saved).endTime || '17:00'; } catch (e) { }
    }
    return state.preferredEndTime || '17:00';
  });
  const [localStudyDays, setLocalStudyDays] = useState(() => {
    const saved = localStorage.getItem('onboarding_progress');
    if (saved) {
      try { return JSON.parse(saved).localStudyDays || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']; } catch (e) { }
    }
    return state.studyDays || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  });
  const [localCalendars, setLocalCalendars] = useState(() => {
    const saved = localStorage.getItem('onboarding_progress');
    if (saved) {
      try { return JSON.parse(saved).localCalendars || []; } catch (e) { }
    }
    return state.targetCalendars || [];
  });

  // Add Calendar form state
  const [newCalType, setNewCalType] = useState('google');
  const [newCalUrl, setNewCalUrl] = useState('');
  const [isWriteDest, setIsWriteDest] = useState(false);

  const [step, setStep] = useState(() => {
    const saved = localStorage.getItem('onboarding_progress');
    if (saved) {
      try { return JSON.parse(saved).step || 1; } catch (e) { }
    }
    return 1;
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Local state for calendar selective import selection
  const [selectedImportIds, setSelectedImportIds] = useState([]);

  // Sync state.targetCalendars to localCalendars after Google callback completes
  React.useEffect(() => {
    if (state.targetCalendars && state.targetCalendars.length > 0) {
      setLocalCalendars(prev => {
        const merged = [...prev];
        state.targetCalendars.forEach(sc => {
          const exists = merged.some(lc => lc.id === sc.id);
          if (!exists) {
            merged.push(sc);
          } else {
            const idx = merged.findIndex(lc => lc.id === sc.id);
            if (idx !== -1) {
              merged[idx] = { ...merged[idx], selected: sc.selected, role: sc.role };
            }
          }
        });
        return merged;
      });
    }
  }, [state.targetCalendars]);

  // Persist onboarding inputs to localStorage dynamically as they change
  React.useEffect(() => {
    if (state.onboarded) return;
    const onboardingState = {
      goals,
      firstProject,
      hours,
      startTime,
      endTime,
      localStudyDays,
      localCalendars,
      step
    };
    localStorage.setItem('onboarding_progress', JSON.stringify(onboardingState));
  }, [goals, firstProject, hours, startTime, endTime, localStudyDays, localCalendars, step, state.onboarded]);

  const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  const handleToggleImportSelection = (id) => {
    if (selectedImportIds.includes(id)) {
      setSelectedImportIds(selectedImportIds.filter(x => x !== id));
    } else {
      setSelectedImportIds([...selectedImportIds, id]);
    }
  };

  const handleImportSelected = async () => {
    if (selectedImportIds.length === 0) return;

    const toImport = state.availableGoogleCalendars.filter(cal => selectedImportIds.includes(cal.id));

    let updatedCalendars = [...localCalendars];
    const hasWrite = updatedCalendars.some(c => c.role === 'write');

    toImport.forEach(cal => {
      const role = (!hasWrite && updatedCalendars.length === 0 && cal.type !== 'ical') ? 'write' : 'read_only';
      updatedCalendars.push({
        ...cal,
        selected: true,
        role: role
      });
    });

    setLocalCalendars(updatedCalendars);

    const remainingAvailable = state.availableGoogleCalendars.filter(cal => !selectedImportIds.includes(cal.id));
    setSelectedImportIds([]);

    setState({
      targetCalendars: updatedCalendars,
      availableGoogleCalendars: remainingAvailable
    });

    try {
      await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_calendars: updatedCalendars,
          available_google_calendars: remainingAvailable
        })
      });
    } catch (e) {
      console.error("Failed to save imported calendars to backend:", e);
    }
  };

  const toggleStudyDay = (day) => {
    if (localStudyDays.includes(day)) {
      setLocalStudyDays(localStudyDays.filter(d => d !== day));
    } else {
      setLocalStudyDays([...localStudyDays, day]);
    }
  };

  const handleAddCalendar = async (e) => {
    e.preventDefault();

    if (newCalType === 'google') {
      try {
        const res = await fetch('/api/auth/google/login');
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'success' && data.url) {
            window.location.href = data.url;
            return;
          }
        }
      } catch (err) {
        console.error("OAuth redirect failed, falling back to ADC:", err);
      }
      alert("Google OAuth2 Client ID/Secret not configured in environment. Adding calendar in local Developer Mode (falls back to local gcloud credentials).");
    }

    let dynamicName = 'Google Calendar';
    if (newCalType === 'ical') {
      try {
        const urlObj = new URL(newCalUrl);
        const pathname = urlObj.pathname;
        const parts = pathname.split('/');
        const lastPart = parts[parts.length - 1];
        if (lastPart && lastPart.endsWith('.ics')) {
          dynamicName = lastPart.replace('.ics', '') + ' Feed';
        } else {
          dynamicName = urlObj.hostname + ' Feed';
        }
      } catch (e) {
        dynamicName = 'iCal Feed';
      }
    }

    const newId = `cal-${Math.random().toString(36).substring(2, 8)}`;
    const newCal = {
      id: newId,
      name: dynamicName,
      type: newCalType,
      url: newCalType === 'ical' ? newCalUrl : '',
      selected: true,
      role: (isWriteDest && newCalType !== 'ical') ? 'write' : 'read_only'
    };

    let updated = [...localCalendars];
    if (isWriteDest && newCalType !== 'ical') {
      updated = updated.map(c => ({ ...c, role: 'read_only' }));
    }
    if (updated.length === 0 && newCalType !== 'ical') {
      newCal.role = 'write';
    }

    updated.push(newCal);
    setLocalCalendars(updated);

    // Reset inputs
    setNewCalUrl('');
    setIsWriteDest(false);
  };

  const handleRemoveCalendar = (id) => {
    const calendarToRemove = localCalendars.find(c => c.id === id);
    let updated = localCalendars.filter(c => c.id !== id);

    if (calendarToRemove?.role === 'write' && updated.length > 0) {
      // Find the first non-ical calendar to be the write destination
      const firstGoogle = updated.find(c => c.type === 'google');
      if (firstGoogle) {
        firstGoogle.role = 'write';
      }
    }
    setLocalCalendars(updated);
  };

  const handleToggleCalendarSelected = (id) => {
    const updated = localCalendars.map(c => ({
      ...c,
      selected: c.id === id ? !c.selected : c.selected
    }));
    setLocalCalendars(updated);
  };

  const handleSetWriteDestination = (id) => {
    const updated = localCalendars.map(c => ({
      ...c,
      role: c.id === id ? 'write' : 'read_only'
    }));
    setLocalCalendars(updated);
  };

  // Submit preferences (either onboarding finalize or settings save)
  const handleSavePreferences = async (isWizard = false) => {
    // Validation checks
    if (localCalendars.length === 0) {
      alert("Please connect at least one calendar before proceeding.");
      return;
    }

    const hasSelectedGoogle = localCalendars.some(c => c.selected && c.type === 'google');
    if (!hasSelectedGoogle) {
      alert("You must connect and select at least one Google Calendar. iCal subscriptions are read-only feeds, and the system requires a Google Calendar to schedule and write your upskilling sessions.");
      return;
    }

    setIsSaving(true);
    setSaveSuccess(false);

    // Verify we have at least one write destination
    const hasWrite = localCalendars.some(c => c.role === 'write');
    let finalizedCalendars = [...localCalendars];
    if (!hasWrite && finalizedCalendars.length > 0) {
      const firstGoogle = finalizedCalendars.find(c => c.selected && c.type === 'google');
      if (firstGoogle) {
        firstGoogle.role = 'write';
      } else {
        finalizedCalendars[0].role = 'write';
      }
    }

    const payload = {
      hours_per_week: hours,
      preferred_start_time: startTime,
      preferred_end_time: endTime,
      study_days: localStudyDays,
      target_calendars: finalizedCalendars,
      onboarded: true
    };

    const updatedState = {
      hoursPerWeek: hours,
      preferredStartTime: startTime,
      preferredEndTime: endTime,
      studyDays: localStudyDays,
      targetCalendars: finalizedCalendars,
      onboarded: true
    };

    if (isWizard) {
      updatedState.activeTab = 'builder';
    }

    // Live Mode
    try {
      const resProfile = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!resProfile.ok) throw new Error("Failed to save profile on backend.");

      // Fetch refreshed state
      const resProfileGet = await fetch('/api/profile');
      if (resProfileGet.ok) {
        const profile = await resProfileGet.json();
        setState({
          ...updatedState,
          careerGoals: profile.career_goals || '',
          proposedEvents: profile.proposed_events || [],
          scarcityFlag: profile.scarcity_flag || false,
          reason: profile.reason || '',
          transactionId: profile.transaction_id || '',
          token: profile.token || ''
        });
      }

      setSaveSuccess(true);
      localStorage.removeItem('onboarding_progress');
    } catch (err) {
      console.error("Live profile save failed:", err);
      alert(`Failed to save backend profile: ${err.message}. Make sure fast_api_app.py is running.`);
      setState(updatedState);
    } finally {
      setIsSaving(false);
    }
  };

  // --- RENDER SETTINGS PAGE (Already Onboarded) ---
  if (state.onboarded) {
    return (
      <div style={styles.container} className="glass-card animate-fade-in">
        <h2 style={styles.title}>⚙️ Career Planner Settings</h2>
        <p style={styles.subtitle}>Customize your upskilling time budget, available scheduling hours, and connected calendars.</p>

        {saveSuccess && (
          <div style={styles.successToast}>
            <span>✓ Preferences saved successfully and applied to schedule!</span>
          </div>
        )}

        {/* Section 1: Working Hours & Pacing */}
        <div style={styles.settingsSection}>
          <h3 style={styles.sectionHeader}>Time Allocation & Preferences</h3>

          <div style={styles.formGroup}>
            <label style={styles.label}>Weekly upskilling budget: <strong>{hours} hours/week</strong></label>
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
              <label style={styles.label}>Available start hour:</label>
              <select value={startTime} onChange={(e) => setStartTime(e.target.value)} style={styles.selectInput}>
                {Array.from({ length: 24 }).map((_, h) => {
                  const hour = `${h.toString().padStart(2, '0')}:00`;
                  return <option key={hour} value={hour}>{hour}</option>;
                })}
              </select>
            </div>
            <div style={{ ...styles.formGroup, flex: 1 }}>
              <label style={styles.label}>Available end hour:</label>
              <select value={endTime} onChange={(e) => setEndTime(e.target.value)} style={styles.selectInput}>
                {Array.from({ length: 24 }).map((_, h) => {
                  const hour = `${h.toString().padStart(2, '0')}:00`;
                  return <option key={hour} value={hour}>{hour}</option>;
                })}
              </select>
            </div>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Study Days:</label>
            <div style={styles.daysList}>
              {daysOfWeek.map(day => {
                const isStudyDay = localStudyDays.includes(day);
                return (
                  <button
                    key={day}
                    onClick={() => toggleStudyDay(day)}
                    style={{
                      ...styles.dayBadge,
                      backgroundColor: isStudyDay ? 'var(--color-accent)' : 'var(--bg-sidebar)',
                      color: isStudyDay ? '#ffffff' : 'var(--color-text-main)',
                      borderColor: isStudyDay ? 'var(--color-accent)' : 'var(--input-border)'
                    }}
                  >
                    {day.substring(0, 3)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Section 2: Connected Calendars Manager */}
        <div style={styles.settingsSection}>
          <h3 style={styles.sectionHeader}>Connected Calendars Scopes</h3>
          <p style={styles.captionText}>Designate exactly one calendar as the write destination. All other calendars are automatically read-only.</p>

          {state.availableGoogleCalendars && state.availableGoogleCalendars.length > 0 && (
            <div style={styles.importBox}>
              <h4 style={styles.importTitle}>📥 Available Google Calendars</h4>
              <p style={styles.importSubtitle}>
                Select which calendars you would like to import from your connected Google account:
              </p>
              <div style={styles.importList}>
                {state.availableGoogleCalendars.map(cal => {
                  const isSelected = selectedImportIds.includes(cal.id);
                  return (
                    <label 
                      key={cal.id} 
                      style={{
                        ...styles.importItem,
                        backgroundColor: isSelected ? 'rgba(99, 102, 241, 0.1)' : 'rgba(15, 23, 42, 0.2)',
                        borderColor: isSelected ? 'rgba(99, 102, 241, 0.4)' : 'var(--border-divider)',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleImportSelection(cal.id)}
                        style={styles.checkboxInline}
                      />
                      <span style={styles.importName}>{cal.name}</span>
                    </label>
                  );
                })}
              </div>
              <button
                onClick={handleImportSelected}
                style={styles.importBtn}
                disabled={selectedImportIds.length === 0}
              >
                Import Selected ({selectedImportIds.length})
              </button>
            </div>
          )}

          <div style={styles.calList}>
            {localCalendars.map(cal => {
              const isWrite = cal.role === 'write';
              return (
                <div 
                  key={cal.id} 
                  style={{
                    ...styles.calendarCard,
                    borderColor: isWrite ? 'rgba(99, 102, 241, 0.4)' : 'var(--border-card)',
                    boxShadow: isWrite ? '0 0 14px rgba(99, 102, 241, 0.15)' : 'none',
                    background: isWrite ? 'rgba(99, 102, 241, 0.04)' : 'rgba(30, 41, 59, 0.25)',
                  }}
                >
                  <div style={styles.calendarRow}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <input
                        type="checkbox"
                        checked={cal.selected}
                        onChange={() => handleToggleCalendarSelected(cal.id)}
                        style={styles.checkboxInline}
                      />
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={styles.calendarName}>{cal.name}</span>
                          <span style={{
                            ...styles.providerBadge,
                            backgroundColor: cal.type === 'google' ? 'rgba(66, 133, 244, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                            color: cal.type === 'google' ? '#4285f4' : 'var(--color-success)',
                          }}>
                            {cal.type.toUpperCase()}
                          </span>
                        </div>
                        {cal.type === 'ical' && cal.url && (
                          <div style={styles.icalUrlText}>{cal.url}</div>
                        )}
                      </div>
                    </div>
                    <div style={styles.calCardActions}>
                      {isWrite ? (
                        <span style={styles.writeLabel}>✍️ Write Destination</span>
                      ) : cal.type === 'ical' ? (
                        <span style={styles.readOnlyLabel}>🚫 Read-Only Feed</span>
                      ) : (
                        <button
                          onClick={() => handleSetWriteDestination(cal.id)}
                          style={styles.setWriteBtn}
                        >
                          Set as Write Destination
                        </button>
                      )}
                      <button
                        onClick={() => handleRemoveCalendar(cal.id)}
                        style={styles.removeBtn}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Add Calendar Form */}
          <form onSubmit={handleAddCalendar} style={styles.addCalForm}>
            <h4 style={{ ...styles.label, margin: '0 0 14px 0', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-accent)' }}>Connect New Calendar</h4>
            
            <div style={styles.providerToggleContainer}>
              <button
                type="button"
                onClick={() => setNewCalType('google')}
                style={{
                  ...styles.providerToggleButton,
                  ...(newCalType === 'google' ? styles.providerToggleButtonActive : {})
                }}
              >
                <span style={styles.providerIcon}>🌐</span>
                <span style={styles.providerLabel}>Google Calendar</span>
              </button>
              <button
                type="button"
                onClick={() => setNewCalType('ical')}
                style={{
                  ...styles.providerToggleButton,
                  ...(newCalType === 'ical' ? styles.providerToggleButtonActive : {})
                }}
              >
                <span style={styles.providerIcon}>📅</span>
                <span style={styles.providerLabel}>iCal Subscription URL</span>
              </button>
            </div>

            {newCalType === 'google' ? (
              <div style={styles.googleInfoBox}>
                ℹ️ Authenticate with your Google account to retrieve and select your Google Calendars. Supports both read and write access.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                <div style={{ ...styles.googleInfoBox, backgroundColor: 'rgba(251, 191, 36, 0.04)', borderColor: 'rgba(251, 191, 36, 0.2)', color: 'var(--color-warning)' }}>
                  ⚠️ iCal subscriptions are read-only feeds. The planner checks these for conflicts but cannot write events to them.
                </div>
                <input
                  type="url"
                  value={newCalUrl}
                  onChange={(e) => setNewCalUrl(e.target.value)}
                  placeholder="iCal Subscription URL (https://example.com/calendar.ics)"
                  style={styles.textInputSmall}
                  required
                />
              </div>
            )}

            {newCalType !== 'ical' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '14px', marginBottom: '4px' }}>
                <input
                  type="checkbox"
                  id="isWriteDest"
                  checked={isWriteDest}
                  onChange={(e) => setIsWriteDest(e.target.checked)}
                  style={styles.checkbox}
                />
                <label htmlFor="isWriteDest" style={{ fontSize: '12px', color: 'var(--color-text-main)', cursor: 'pointer', fontWeight: '500' }}>
                  Designate as Write Destination
                </label>
              </div>
            )}

            <button 
              type="submit" 
              style={styles.addCalBtn}
            >
              {newCalType === 'google' ? '🔗 Connect Google Calendar' : '🔗 Connect iCal Feed'}
            </button>
          </form>
        </div>

        <button
          onClick={() => handleSavePreferences(false)}
          style={styles.primaryButton}
          disabled={isSaving}
        >
          {isSaving ? 'Saving...' : 'Save & Re-Schedule'}
        </button>
      </div>
    );
  }

  // --- RENDER ONBOARDING FLOW (New Users) ---
  return (
    <div style={styles.container} className="glass-card animate-fade-in">
      <div style={styles.statusBar}>
        <div style={{ ...styles.stepIndicator, backgroundColor: step >= 1 ? 'var(--color-accent)' : 'var(--input-border)' }}></div>
        <div style={{ ...styles.stepIndicator, backgroundColor: step >= 2 ? 'var(--color-accent)' : 'var(--input-border)' }}></div>
      </div>

      {step === 1 && (
        <div>
          <h2 style={styles.title}>1. Working Hours & Pacing ⏱️</h2>
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
            <label style={styles.label}>Study Days:</label>
            <div style={styles.daysList}>
              {daysOfWeek.map(day => {
                const isStudyDay = localStudyDays.includes(day);
                return (
                  <button
                    key={day}
                    onClick={() => toggleStudyDay(day)}
                    style={{
                      ...styles.dayBadge,
                      backgroundColor: isStudyDay ? 'var(--color-accent)' : 'var(--bg-sidebar)',
                      color: isStudyDay ? '#ffffff' : 'var(--color-text-main)',
                      borderColor: isStudyDay ? 'var(--color-accent)' : 'var(--input-border)'
                    }}
                  >
                    {day.substring(0, 3)}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={styles.buttonGroup}>
            <button onClick={() => setStep(2)} style={styles.primaryButton}>
              Next: Calendar Scoping →
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <h2 style={styles.title}>2. Calendar Scope Authorization 🔒</h2>
          <p style={styles.subtitle}>
            You must connect at least one calendar and designate exactly one as the <b>Write Destination</b> for the upskilling schedule.
          </p>

          {state.availableGoogleCalendars && state.availableGoogleCalendars.length > 0 && (
            <div style={styles.importBox}>
              <h4 style={styles.importTitle}>📥 Available Google Calendars</h4>
              <p style={styles.importSubtitle}>
                Select which calendars you would like to import from your connected Google account:
              </p>
              <div style={styles.importList}>
                {state.availableGoogleCalendars.map(cal => {
                  const isSelected = selectedImportIds.includes(cal.id);
                  return (
                    <label 
                      key={cal.id} 
                      style={{
                        ...styles.importItem,
                        backgroundColor: isSelected ? 'rgba(99, 102, 241, 0.1)' : 'rgba(15, 23, 42, 0.2)',
                        borderColor: isSelected ? 'rgba(99, 102, 241, 0.4)' : 'var(--border-divider)',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleImportSelection(cal.id)}
                        style={styles.checkboxInline}
                      />
                      <span style={styles.importName}>{cal.name}</span>
                    </label>
                  );
                })}
              </div>
              <button
                onClick={handleImportSelected}
                style={styles.importBtn}
                disabled={selectedImportIds.length === 0}
              >
                Import Selected ({selectedImportIds.length})
              </button>
            </div>
          )}

          <div style={styles.calList}>
            {localCalendars.length === 0 ? (
              <div style={styles.emptyCalText}>No calendars connected yet. Use the form below to connect your first calendar!</div>
            ) : (
              localCalendars.map(cal => {
                const isWrite = cal.role === 'write';
                return (
                  <div 
                    key={cal.id} 
                    style={{
                      ...styles.calendarCard,
                      borderColor: isWrite ? 'rgba(99, 102, 241, 0.4)' : 'var(--border-card)',
                      boxShadow: isWrite ? '0 0 14px rgba(99, 102, 241, 0.15)' : 'none',
                      background: isWrite ? 'rgba(99, 102, 241, 0.04)' : 'rgba(30, 41, 59, 0.25)',
                    }}
                  >
                    <div style={styles.calendarRow}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <input
                          type="checkbox"
                          checked={cal.selected}
                          onChange={() => handleToggleCalendarSelected(cal.id)}
                          style={styles.checkboxInline}
                        />
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={styles.calendarName}>{cal.name}</span>
                            <span style={{
                              ...styles.providerBadge,
                              backgroundColor: cal.type === 'google' ? 'rgba(66, 133, 244, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                              color: cal.type === 'google' ? '#4285f4' : 'var(--color-success)',
                            }}>
                              {cal.type.toUpperCase()}
                            </span>
                          </div>
                          {cal.type === 'ical' && cal.url && (
                            <div style={styles.icalUrlText}>{cal.url}</div>
                          )}
                        </div>
                      </div>
                      <div style={styles.calCardActions}>
                        {isWrite ? (
                          <span style={styles.writeLabel}>✍️ Write Destination</span>
                        ) : cal.type === 'ical' ? (
                          <span style={styles.readOnlyLabel}>🚫 Read-Only Feed</span>
                        ) : (
                          <button
                            onClick={() => handleSetWriteDestination(cal.id)}
                            style={styles.setWriteBtn}
                          >
                            Set as Write Destination
                          </button>
                        )}
                        <button
                          onClick={() => handleRemoveCalendar(cal.id)}
                          style={styles.removeBtn}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Add Calendar Form */}
          <form onSubmit={handleAddCalendar} style={styles.addCalForm}>
            <h4 style={{ ...styles.label, margin: '0 0 14px 0', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-accent)' }}>Connect New Calendar</h4>
            
            <div style={styles.providerToggleContainer}>
              <button
                type="button"
                onClick={() => setNewCalType('google')}
                style={{
                  ...styles.providerToggleButton,
                  ...(newCalType === 'google' ? styles.providerToggleButtonActive : {})
                }}
              >
                <span style={styles.providerIcon}>🌐</span>
                <span style={styles.providerLabel}>Google Calendar</span>
              </button>
              <button
                type="button"
                onClick={() => setNewCalType('ical')}
                style={{
                  ...styles.providerToggleButton,
                  ...(newCalType === 'ical' ? styles.providerToggleButtonActive : {})
                }}
              >
                <span style={styles.providerIcon}>📅</span>
                <span style={styles.providerLabel}>iCal Subscription URL</span>
              </button>
            </div>

            {newCalType === 'google' ? (
              <div style={styles.googleInfoBox}>
                ℹ️ Authenticate with your Google account to retrieve and select your Google Calendars. Supports both read and write access.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                <div style={{ ...styles.googleInfoBox, backgroundColor: 'rgba(251, 191, 36, 0.04)', borderColor: 'rgba(251, 191, 36, 0.2)', color: 'var(--color-warning)' }}>
                  ⚠️ iCal subscriptions are read-only feeds. The planner checks these for conflicts but cannot write events to them.
                </div>
                <input
                  type="url"
                  value={newCalUrl}
                  onChange={(e) => setNewCalUrl(e.target.value)}
                  placeholder="iCal URL (https://example.com/calendar.ics)"
                  style={styles.textInputSmall}
                  required
                />
              </div>
            )}

            {newCalType !== 'ical' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '14px', marginBottom: '4px' }}>
                <input
                  type="checkbox"
                  id="isWriteDestWizard"
                  checked={isWriteDest}
                  onChange={(e) => setIsWriteDest(e.target.checked)}
                  style={styles.checkbox}
                />
                <label htmlFor="isWriteDestWizard" style={{ fontSize: '12px', color: 'var(--color-text-main)', cursor: 'pointer', fontWeight: '500' }}>
                  Designate as Write Destination
                </label>
              </div>
            )}

            <button 
              type="submit" 
              style={styles.addCalBtn}
            >
              {newCalType === 'google' ? '🔗 Connect Google Calendar' : '🔗 Connect iCal Feed'}
            </button>
          </form>

          <div style={styles.buttonGroup}>
            <button onClick={() => setStep(1)} style={styles.secondaryButton}>
              Back
            </button>
            <button
              onClick={() => handleSavePreferences(true)}
              style={styles.primaryButton}
              disabled={isSaving}
            >
              {isSaving ? 'Saving preferences...' : 'Finalize & Continue to Goal Builder'}
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
  settingsSection: {
    borderBottom: '1px solid var(--border-divider)',
    paddingBottom: '20px',
    marginBottom: '24px',
  },
  sectionHeader: {
    fontSize: '15px',
    color: 'var(--color-text-main)',
    fontWeight: '700',
    marginBottom: '14px',
  },
  successToast: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    color: 'var(--color-success)',
    padding: '12px',
    borderRadius: '8px',
    border: '1px solid rgba(16, 185, 129, 0.2)',
    fontSize: '13px',
    fontWeight: '600',
    marginBottom: '20px',
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
  captionText: {
    fontSize: '11px',
    color: 'var(--color-text-muted)',
    marginBottom: '16px',
    marginTop: '-8px',
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
  },
  textInputSmall: {
    backgroundColor: 'var(--input-bg)',
    border: '1px solid var(--input-border)',
    borderRadius: '8px',
    padding: '12px 16px',
    fontSize: '13px',
    color: 'var(--color-text-main)',
    outline: 'none',
    width: '100%',
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
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
  calList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    marginBottom: '20px',
  },
  calendarCard: {
    backgroundColor: 'rgba(30, 41, 59, 0.25)',
    border: '1px solid var(--border-card)',
    borderRadius: '12px',
    padding: '16px',
    transition: 'all 0.2s ease',
  },
  calendarRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  calendarName: {
    fontSize: '14px',
    fontWeight: '600',
    color: 'var(--color-text-main)',
  },
  providerBadge: {
    fontSize: '9px',
    padding: '2px 6px',
    borderRadius: '4px',
    fontWeight: '700',
  },
  calCardActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  writeLabel: {
    fontSize: '11px',
    fontWeight: '700',
    color: 'var(--color-success)',
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    padding: '4px 8px',
    borderRadius: '6px',
  },
  setWriteBtn: {
    backgroundColor: 'transparent',
    border: '1px solid var(--color-accent)',
    color: 'var(--color-accent)',
    fontSize: '11px',
    padding: '6px 12px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: '600',
    transition: 'all 0.15s ease',
  },
  removeBtn: {
    backgroundColor: 'transparent',
    border: 'none',
    color: '#fb7185',
    fontSize: '11px',
    cursor: 'pointer',
    fontWeight: '600',
    padding: '6px 12px',
  },
  icalUrlText: {
    fontSize: '10px',
    color: 'var(--color-text-muted)',
    marginTop: '4px',
    fontFamily: 'monospace',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: '300px',
  },
  addCalForm: {
    backgroundColor: 'rgba(30, 41, 59, 0.35)',
    border: '1px solid var(--border-divider)',
    borderRadius: '14px',
    padding: '20px',
    marginTop: '20px',
    marginBottom: '20px',
    boxShadow: 'var(--shadow-main)',
    display: 'flex',
    flexDirection: 'column',
  },
  addCalGrid: {
    display: 'flex',
    gap: '8px',
  },
  inlineSelect: {
    backgroundColor: 'var(--bg-main)',
    border: '1px solid var(--input-border)',
    color: 'var(--color-text-main)',
    padding: '6px 12px',
    borderRadius: '6px',
    fontSize: '12px',
    outline: 'none',
  },
  checkbox: {
    width: '15px',
    height: '15px',
    cursor: 'pointer',
    accentColor: 'var(--color-accent)',
  },
  addCalBtn: {
    backgroundColor: 'var(--color-accent)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    padding: '8px 16px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    marginTop: '16px',
    width: 'auto',
    alignSelf: 'flex-start',
    transition: 'background-color 0.2s ease, opacity 0.2s ease, transform 0.1s ease',
  },
  providerToggleContainer: {
    display: 'flex',
    gap: '12px',
    marginBottom: '16px',
  },
  providerToggleButton: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '12px 8px',
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    border: '1px solid var(--input-border)',
    borderRadius: '10px',
    cursor: 'pointer',
    color: 'var(--color-text-muted)',
    transition: 'all 0.2s ease',
    outline: 'none',
  },
  providerToggleButtonActive: {
    backgroundColor: 'rgba(99, 102, 241, 0.12)',
    borderColor: 'var(--color-accent)',
    color: 'var(--color-text-main)',
    boxShadow: '0 0 8px rgba(99, 102, 241, 0.15)',
  },
  providerIcon: {
    fontSize: '20px',
  },
  providerLabel: {
    fontSize: '11px',
    fontWeight: '600',
  },
  googleInfoBox: {
    backgroundColor: 'rgba(99, 102, 241, 0.04)',
    border: '1px solid rgba(99, 102, 241, 0.15)',
    borderRadius: '8px',
    padding: '12px',
    marginBottom: '12px',
    fontSize: '11px',
    color: 'var(--color-text-muted)',
    lineHeight: '1.4',
  },
  emptyCalText: {
    fontSize: '12px',
    color: 'var(--color-text-muted)',
    textAlign: 'center',
    padding: '20px 0',
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
    outline: 'none',
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
    outline: 'none',
  },
  buttonGroup: {
    display: 'flex',
    gap: '12px',
    marginTop: '24px',
  },
  checkboxInline: {
    width: '14px',
    height: '14px',
    cursor: 'pointer',
    accentColor: 'var(--color-accent)',
    marginRight: '8px',
  },
  readOnlyLabel: {
    fontSize: '11px',
    color: 'var(--color-text-muted)',
    fontWeight: '600',
    padding: '4px 8px',
  },
  importBox: {
    backgroundColor: 'rgba(99, 102, 241, 0.05)',
    border: '1px dashed var(--color-accent)',
    borderRadius: '10px',
    padding: '16px',
    marginBottom: '20px',
  },
  importTitle: {
    margin: '0 0 4px 0',
    fontSize: '14px',
    color: 'var(--color-accent)',
    fontWeight: '700',
  },
  importSubtitle: {
    margin: '0 0 12px 0',
    fontSize: '12px',
    color: 'var(--color-text-muted)',
  },
  importList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    marginBottom: '16px',
  },
  importItem: {
    display: 'flex',
    alignItems: 'center',
    fontSize: '12px',
    color: 'var(--color-text-main)',
    cursor: 'pointer',
    marginBottom: '4px',
  },
  importName: {
    fontWeight: '500',
  },
  importBtn: {
    backgroundColor: 'var(--color-accent)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    padding: '8px 16px',
    fontSize: '11px',
    fontWeight: '600',
    cursor: 'pointer',
  }
};
