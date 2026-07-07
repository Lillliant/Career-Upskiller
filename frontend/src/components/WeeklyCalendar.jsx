import React, { useState, useEffect, useRef } from 'react';
import { useAppState, appState } from '../stateManager';
import { stageWeeklySchedule, clearDayLearningEvents } from '../scheduleApi';

/** Format a Date as ISO 8601 with the app's fixed -04:00 offset. */
function toLocalOffsetISO(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}-04:00`
  );
}

export default function WeeklyCalendar({ onApprove, onCancel }) {
  const [state, setState] = useAppState();
  const containerRef = useRef(null);
  const [draggedEventId, setDraggedEventId] = useState(null);
  const [draggedProposedIdx, setDraggedProposedIdx] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isStaging, setIsStaging] = useState(false);
  const [stageMessage, setStageMessage] = useState('');
  const [contextMenu, setContextMenu] = useState(null);
  const [hoveredEvent, setHoveredEvent] = useState(null);

  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  const updateScheduledEventOnBackend = async (event) => {
    try {
      const res = await fetch(`/api/calendar/events/${event.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start: event.start,
          end: event.end,
          summary: event.summary,
          description: event.description
        })
      });
      if (!res.ok) {
        console.error("Failed to update event on backend");
      }
    } catch (err) {
      console.error("Error updating event on backend:", err);
    }
  };

  const handleDeleteEvent = async (event, isProposed, proposedIdx) => {
    if (isProposed && proposedIdx !== null) {
      const updated = state.proposedEvents.filter((_, idx) => idx !== proposedIdx);
      setState({ proposedEvents: updated });
    } else {
      if (!window.confirm(`Are you sure you want to delete "${event.summary}"?`)) return;
      try {
        const res = await fetch(`/api/calendar/events/${event.id}`, {
          method: 'DELETE'
        });
        if (res.ok) {
          const updated = state.calendarEvents.filter(evt => evt.id !== event.id);
          setState({ calendarEvents: updated });
        } else {
          alert("Failed to delete event from calendar");
        }
      } catch (err) {
        console.error("Error deleting event:", err);
        alert("Error deleting event");
      }
    }
  };

  const handleEventContextMenu = (e, event, isProposed, proposedIdx) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    setHoveredEvent(null);
    
    setContextMenu({
      rect,
      event,
      isProposed,
      proposedIdx
    });
  };


  // 15-minute grid setup (08:00 - 18:00)
  const startHour = 8;
  const endHour = 18;
  const slotHeight = 22; // px per 15 minutes
  const totalMinutes = (endHour - startHour) * 60;
  const containerHeight = (totalMinutes / 15) * slotHeight;

  // Generate 7 days for the Sunday-start week containing today, shifted by currentWeekOffset
  const today = new Date();
  const baseDate = new Date(today);
  baseDate.setDate(today.getDate() - today.getDay() + state.currentWeekOffset * 7);
  baseDate.setHours(0, 0, 0, 0);
  
  const weekDays = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(baseDate);
    d.setDate(baseDate.getDate() + i);
    return {
      dateStr: d.toISOString().split('T')[0],
      dayName: d.toLocaleDateString('en-US', { weekday: 'short' }),
      dateNum: d.getDate(),
      fullDate: d
    };
  });

  // Time labels list (15-minute intervals)
  const timeSlots = [];
  for (let h = startHour; h < endHour; h++) {
    timeSlots.push({ hour: h, minute: 0, label: `${h.toString().padStart(2, '0')}:00` });
    timeSlots.push({ hour: h, minute: 15, label: `${h.toString().padStart(2, '0')}:15` });
    timeSlots.push({ hour: h, minute: 30, label: `${h.toString().padStart(2, '0')}:30` });
    timeSlots.push({ hour: h, minute: 45, label: `${h.toString().padStart(2, '0')}:45` });
  }

  // Load calendar events from backend if live mode
  useEffect(() => {
    const loadEvents = async () => {
      try {
        const res = await fetch(`/api/calendar/events?offset=${state.currentWeekOffset}`);
        if (res.ok) {
          const events = await res.json();
          setState({ calendarEvents: events });
        }
      } catch (err) {
        console.error("Failed to load calendar events:", err);
      }
    };
    loadEvents();
  }, [state.currentWeekOffset, state.isSubmitted, state.onboarded]);

  // Helper: check if event is on a specific day
  const getEventsForDay = (dateStr) => {
    const dayEvents = [];

    // Add confirmed events
    state.calendarEvents.forEach(evt => {
      if (evt.start && evt.start.startsWith(dateStr)) {
        dayEvents.push({ ...evt, isProposed: false });
      }
    });

    // Add proposed events (only show proposed on the current active week offset = 0)
    if (state.currentWeekOffset === 0) {
      state.proposedEvents.forEach((evt, idx) => {
        if (evt.start && evt.start.startsWith(dateStr)) {
          dayEvents.push({ ...evt, isProposed: true, proposedIdx: idx });
        }
      });
    }

    return dayEvents;
  };

  // Helpers for coordinates
  const getMinutesFromStart = (timeIso) => {
    const d = new Date(timeIso);
    const mins = d.getHours() * 60 + d.getMinutes();
    return Math.max(0, mins - startHour * 60);
  };

  const getDurationMins = (startIso, endIso) => {
    const s = new Date(startIso);
    const e = new Date(endIso);
    return Math.max(15, (e - s) / (1000 * 60));
  };

  // Drag & Drop handlers
  const handleDragStart = (e, id, proposedIdx) => {
    setDraggedEventId(id);
    setDraggedProposedIdx(proposedIdx);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e, targetDay, targetHour, targetMin) => {
    e.preventDefault();
    if (draggedEventId === null && draggedProposedIdx === null) return;

    if (draggedProposedIdx !== null) {
      // Dragging a proposed block
      const updated = [...state.proposedEvents];
      const event = updated[draggedProposedIdx];
      const duration = getDurationMins(event.start, event.end);

      const newStart = new Date(targetDay.fullDate);
      newStart.setHours(targetHour, targetMin, 0);
      const newEnd = new Date(newStart.getTime() + duration * 60 * 1000);

      updated[draggedProposedIdx] = {
        ...event,
        start: toLocalOffsetISO(newStart),
        end: toLocalOffsetISO(newEnd)
      };
      setState({ proposedEvents: updated });
    } else {
      // Dragging an already scheduled block
      let updatedEvent = null;
      const updated = state.calendarEvents.map(evt => {
        if (evt.id === draggedEventId) {
          const duration = getDurationMins(evt.start, evt.end);
          const newStart = new Date(targetDay.fullDate);
          newStart.setHours(targetHour, targetMin, 0);
          const newEnd = new Date(newStart.getTime() + duration * 60 * 1000);
          updatedEvent = {
            ...evt,
            start: newStart.toISOString(),
            end: newEnd.toISOString()
          };
          return updatedEvent;
        }
        return evt;
      });
      setState({ calendarEvents: updated });
      if (updatedEvent) {
        updateScheduledEventOnBackend(updatedEvent);
      }
    }

    setDraggedEventId(null);
    setDraggedProposedIdx(null);
  };

  // Adjust duration +/- 15 mins
  const adjustDuration = (event, isProposed, proposedIdx, deltaMins) => {
    if (isProposed && proposedIdx !== null) {
      const updated = [...state.proposedEvents];
      const evt = updated[proposedIdx];
      const start = new Date(evt.start);
      const end = new Date(evt.end);
      const newEnd = new Date(end.getTime() + deltaMins * 60 * 1000);
      if (newEnd >= new Date(start.getTime() + 15 * 60 * 1000)) {
        updated[proposedIdx] = { ...evt, end: toLocalOffsetISO(newEnd) };
        setState({ proposedEvents: updated });
      }
    } else {
      let updatedEvent = null;
      const updated = state.calendarEvents.map(evt => {
        if (evt.id === event.id) {
          const start = new Date(evt.start);
          const end = new Date(evt.end);
          const newEnd = new Date(end.getTime() + deltaMins * 60 * 1000);
          if (newEnd >= new Date(start.getTime() + 15 * 60 * 1000)) {
            updatedEvent = { ...evt, end: newEnd.toISOString() };
            return updatedEvent;
          }
        }
        return evt;
      });
      setState({ calendarEvents: updated });
      if (updatedEvent) {
        updateScheduledEventOnBackend(updatedEvent);
      }
    }
  };

  // Resize drag handler (granularity 15m)
  const handleResizeMouseDown = (e, event, isProposed, proposedIdx) => {
    e.stopPropagation();
    e.preventDefault();
    const startY = e.clientY;
    const initialEnd = new Date(event.end);
    let latestEndISO = event.end;

    const handleMouseMove = (moveEvent) => {
      const deltaY = moveEvent.clientY - startY;
      const deltaMins = Math.round(deltaY / slotHeight) * 15;
      
      if (deltaMins !== 0) {
        const start = new Date(event.start);
        const newEnd = new Date(initialEnd.getTime() + deltaMins * 60 * 1000);
        if (newEnd >= new Date(start.getTime() + 15 * 60 * 1000)) {
          latestEndISO = isProposed ? toLocalOffsetISO(newEnd) : newEnd.toISOString();
          if (isProposed && proposedIdx !== null) {
            const updated = [...state.proposedEvents];
            updated[proposedIdx] = { ...updated[proposedIdx], end: latestEndISO };
            setState({ proposedEvents: updated });
          } else {
            const updated = state.calendarEvents.map(evt => {
              if (evt.id === event.id) {
                return { ...evt, end: latestEndISO };
              }
              return evt;
            });
            setState({ calendarEvents: updated });
          }
        }
      }
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (!isProposed && latestEndISO !== event.end) {
        updateScheduledEventOnBackend({
          ...event,
          end: latestEndISO
        });
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const executeApproval = async () => {
    setIsSubmitting(true);
    const currentState = appState.getState();
    const selectedScopes = currentState.targetCalendars
      .filter(c => c.selected)
      .map(c => c.id);

    const envelope = {
      transaction_id: currentState.transactionId || 'tx-mock-123',
      token: currentState.token || 'token-mock-123',
      action: 'approve',
      proposed_events: currentState.proposedEvents,
      calendar_scopes: selectedScopes
    };

    try {
      await onApprove(envelope);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSubmitting(false);
    }
  };

  const executeReject = async () => {
    try {
      await onCancel({
        transaction_id: state.transactionId,
        token: state.token,
        action: 'reject'
      });
    } catch (e) {
      console.error(e);
    }
  };

  // Navigations
  const handlePrevWeek = () => {
    setState({ currentWeekOffset: state.currentWeekOffset - 1 });
  };

  const handleNextWeek = () => {
    setState({ currentWeekOffset: state.currentWeekOffset + 1 });
  };

  const handleCurrentWeek = () => {
    setState({ currentWeekOffset: 0 });
  };

  const handleScheduleWeek = async () => {
    setIsStaging(true);
    setStageMessage('');
    try {
      const data = await stageWeeklySchedule(setState, { weekOffset: state.currentWeekOffset });
      const eventCount = (data.proposed_events || []).length;
      if (eventCount === 0) {
        setStageMessage(data.reason || 'No events were staged for this week.');
      } else {
        setStageMessage(
          `Staged ${eventCount} learning block${eventCount === 1 ? '' : 's'} from ${data.task_count || eventCount} task(s). Review and approve below.`
        );
      }
    } catch (err) {
      console.error('Failed to stage weekly schedule:', err);
      alert(err.message || 'Failed to stage weekly schedule.');
    } finally {
      setIsStaging(false);
    }
  };

  const reloadCalendarEvents = async () => {
    try {
      const res = await fetch(`/api/calendar/events?offset=${state.currentWeekOffset}`);
      if (res.ok) {
        const events = await res.json();
        setState({ calendarEvents: events });
      }
    } catch (err) {
      console.error('Failed to reload calendar events:', err);
    }
  };

  const handleClearDay = async (day) => {
    const dayEvents = getEventsForDay(day.dateStr);
    const managedCount = dayEvents.filter((evt) => evt.type === 'learning' || evt.isProposed).length;

    if (managedCount === 0) {
      alert(`No managed learning blocks on ${day.dayName}.`);
      return;
    }

    if (!window.confirm(
      `Clear ${managedCount} managed learning block${managedCount === 1 ? '' : 's'} on ${day.dayName} ${day.dateNum}?\n\nThis removes them from Google Calendar and local state. Orphaned learning events on Google Calendar are not affected.`
    )) {
      return;
    }

    try {
      const result = await clearDayLearningEvents(day.dateStr);
      const cleared = result.removed_from_state ?? result.deleted_count ?? 0;
      setState({
        proposedEvents: state.proposedEvents.filter((evt) => !evt.start?.startsWith(day.dateStr)),
        scheduledEvents: (state.scheduledEvents || []).filter((evt) => !evt.start?.startsWith(day.dateStr)),
      });
      await reloadCalendarEvents();
      alert(`Cleared ${cleared} learning block${cleared === 1 ? '' : 's'} from ${day.dayName}.`);
    } catch (err) {
      console.error('Failed to clear day:', err);
      alert(err.message || 'Failed to clear learning blocks for this day.');
    }
  };

  // Formatted date string for week title
  const startOfWeekStr = weekDays[0].fullDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endOfWeekStr = weekDays[6].fullDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div ref={containerRef} style={styles.calendarPage} className="animate-fade-in">
      <div style={styles.header}>
        <div>
          <h2 style={styles.pageTitle}>Weekly Schedule Overview 📅</h2>
          <p style={styles.pageSubtitle}>Monitor integrated calendars and staging matrices side-by-side.</p>
        </div>

        {/* Weekly Pagination Navigation */}
        <div style={styles.navRow}>
          <button onClick={handlePrevWeek} style={styles.navBtn}>◀ Prev Week</button>
          <button onClick={handleCurrentWeek} style={{ ...styles.navBtn, fontWeight: '700' }}>Current Week</button>
          <button onClick={handleNextWeek} style={styles.navBtn}>Next Week ▶</button>
          <button
            onClick={handleScheduleWeek}
            style={styles.scheduleBtn}
            disabled={isStaging}
            title="Build this week's learning blocks from task due dates across your projects"
          >
            {isStaging ? 'Scheduling…' : '📆 Schedule This Week'}
          </button>
          <span style={styles.weekRangeText}>{startOfWeekStr} – {endOfWeekStr}</span>
        </div>
      </div>

      {stageMessage && (
        <div style={styles.stageMessage} className="glass-card">
          {stageMessage}
        </div>
      )}

      {/* Scarcity / Staging Zero-Trust Banner */}
      {state.proposedEvents.length > 0 && state.stagedWeekOffset === state.currentWeekOffset && (
        <div style={styles.approvalWidget} className="glass-card">
          <div style={styles.approvalHeader}>
            <div style={styles.badge}>🔐 New Events Pending Your Approval</div>
            <div style={styles.txId}>Transaction: {state.transactionId}</div>
          </div>
          <p style={styles.approvalHint}>
            Review the proposed schedule below, then approve or reject before these events are added to your calendar.
          </p>
          
          {state.scarcityFlag && (
            <div style={styles.scarcityWarning}>
              <span style={{ fontSize: '18px' }}>⚠️</span>
              <div>
                <strong>Weekly Scheduling Scarcity Adjustment:</strong>
                <div style={{ fontSize: '12px', marginTop: '2px', color: 'var(--color-text-main)' }}>
                  {state.reason}
                </div>
              </div>
            </div>
          )}

          <div style={styles.approvalActions}>
            <button onClick={executeReject} style={styles.rejectBtn} disabled={isSubmitting}>
              Reject Proposal
            </button>
            <button onClick={executeApproval} style={styles.approveBtn} disabled={isSubmitting}>
              {isSubmitting ? 'Verifying Envelope...' : 'Approve & Schedule (HITL)'}
            </button>
          </div>
        </div>
      )}

      {/* Reclaim Grid */}
      <div style={styles.gridContainer} className="glass-card">
        {/* Day Header Row */}
        <div style={styles.dayHeaderRow}>
          <div style={styles.timeLabelSpacer}>Time</div>
          {weekDays.map((day) => (
            <div key={day.dateStr} style={styles.dayHeaderCell}>
              <span style={styles.dayName}>{day.dayName}</span>
              <span style={styles.dayNum}>{day.dateNum}</span>
              <button
                type="button"
                onClick={() => handleClearDay(day)}
                style={styles.clearDayBtn}
                title={`Clear managed learning blocks on ${day.dayName}`}
              >
                Clear
              </button>
            </div>
          ))}
        </div>

        {/* Calendar Body Grid */}
        <div style={{ ...styles.gridBody, height: `${containerHeight}px` }}>
          {/* Time column */}
          <div style={styles.timeColumn}>
            {timeSlots.map((slot, idx) => (
              <div key={idx} style={{ ...styles.timeCell, height: `${slotHeight}px` }}>
                {slot.minute === 0 ? slot.label : ''}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {weekDays.map((day) => {
            const dayEvents = getEventsForDay(day.dateStr);
            return (
              <div key={day.dateStr} style={styles.dayColumn}>
                {/* Visual horizontal slots for dropping (15-minute granularity) */}
                {timeSlots.map((slot, idx) => (
                  <div 
                    key={idx}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, day, slot.hour, slot.minute)}
                    style={{ 
                      ...styles.gridSlotRow, 
                      height: `${slotHeight}px`,
                      borderBottom: slot.minute === 45 ? '1px solid var(--calendar-grid-line)' : '1px dashed rgba(255,255,255,0.02)'
                    }}
                  ></div>
                ))}

                {/* Absolutely positioned events */}
                {dayEvents.map((evt, idx) => {
                  const startMins = getMinutesFromStart(evt.start);
                  const duration = getDurationMins(evt.start, evt.end);
                  const top = (startMins / 15) * slotHeight;
                  const height = (duration / 15) * slotHeight;

                  const isLearning = evt.type === 'learning' || evt.isProposed;
                  const isExternal = evt.type === 'external';

                  return (
                    <div
                      key={evt.id || idx}
                      draggable={isLearning}
                      onDragStart={(e) => handleDragStart(e, evt.id || null, evt.isProposed ? evt.proposedIdx : null)}
                      onContextMenu={(e) => {
                        if (isLearning) {
                          handleEventContextMenu(e, evt, !!evt.isProposed, evt.isProposed ? evt.proposedIdx : null);
                        }
                      }}
                      onMouseEnter={(e) => {
                        if (draggedEventId === null && draggedProposedIdx === null && !contextMenu) {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setHoveredEvent({
                            event: evt,
                            rect: rect
                          });
                        }
                      }}
                      onMouseLeave={() => {
                        setHoveredEvent(null);
                      }}
                      style={{
                        ...styles.eventCard,
                        top: `${top}px`,
                        height: `${height}px`,
                        backgroundColor: evt.isProposed 
                          ? 'rgba(255, 191, 36, 0.08)' 
                          : isExternal 
                            ? 'var(--bg-sidebar)' 
                            : 'rgba(99, 102, 241, 0.15)',
                        borderColor: evt.isProposed 
                          ? 'var(--color-warning)' 
                          : isExternal 
                            ? 'var(--border-card)' 
                            : 'var(--color-accent)',
                        borderStyle: evt.isProposed ? 'dashed' : 'solid',
                        borderLeftWidth: isLearning ? '4px' : '1px',
                        borderLeftColor: evt.isProposed 
                          ? 'var(--color-warning)' 
                          : isExternal 
                            ? 'var(--color-text-muted)' 
                            : 'var(--color-accent)',
                        cursor: isLearning ? 'grab' : 'default',
                        zIndex: evt.isProposed ? 12 : 10
                      }}
                    >
                      <div style={styles.evtHeader}>
                        <span style={styles.evtTitle} title={evt.summary}>
                          {evt.summary}
                        </span>
                        <span style={styles.evtDur}>{duration}m</span>
                      </div>
                      
                      {height > 30 && (
                        <p style={styles.evtDesc}>{evt.description || 'External meetings block'}</p>
                      )}

                      {/* Controls for learning blocks */}
                      {isLearning && height > 45 && (
                        <div style={styles.evtControls}>
                          <button 
                            onClick={(e) => { e.stopPropagation(); adjustDuration(evt, evt.isProposed, evt.isProposed ? evt.proposedIdx : null, -15); }}
                            style={styles.adjustBtn}
                          >
                            -15m
                          </button>
                          <button 
                            onClick={(e) => { e.stopPropagation(); adjustDuration(evt, evt.isProposed, evt.isProposed ? evt.proposedIdx : null, 15); }}
                            style={styles.adjustBtn}
                          >
                            +15m
                          </button>
                        </div>
                      )}

                      {/* Resize Handle */}
                      {isLearning && (
                        <div 
                          onMouseDown={(e) => handleResizeMouseDown(e, evt, evt.isProposed, evt.isProposed ? evt.proposedIdx : null)}
                          style={styles.resizeHandle}
                          title="Drag to resize"
                        >
                          •••
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {contextMenu && (() => {
        const rect = contextMenu.rect;
        if (!rect) return null;
        const containerRect = containerRef.current?.getBoundingClientRect() || { left: 0, top: 0, width: window.innerWidth };
        const relativeLeft = rect.left - containerRect.left;
        const relativeRight = rect.right - containerRect.left;
        const relativeTop = rect.top - containerRect.top;

        const menuWidth = 140;
        const gap = 2;
        const shouldPlaceLeft = relativeRight + gap + menuWidth > containerRect.width;
        const left = shouldPlaceLeft 
          ? Math.max(8, relativeLeft - menuWidth - gap) 
          : Math.min(containerRect.width - menuWidth - 8, relativeRight + gap);
        const top = relativeTop;
        
        return (
          <div 
            style={{
              position: 'absolute',
              top: `${top}px`,
              left: `${left}px`,
              backgroundColor: 'var(--bg-sidebar)',
              border: '1px solid var(--border-card)',
              borderRadius: '8px',
              boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.4)',
              zIndex: 1000,
              padding: '4px',
              display: 'flex',
              flexDirection: 'column',
              width: `${menuWidth}px`
            }}
            className="animate-fade-in"
          >
            <button
              onClick={() => {
                handleDeleteEvent(contextMenu.event, contextMenu.isProposed, contextMenu.proposedIdx);
                setContextMenu(null);
              }}
              style={{
                backgroundColor: 'transparent',
                border: 'none',
                color: '#fb7185',
                padding: '8px 12px',
                fontSize: '12px',
                fontWeight: '600',
                textAlign: 'left',
                cursor: 'pointer',
                borderRadius: '4px',
                width: '100%',
                transition: 'background-color 0.2s',
              }}
              onMouseEnter={(e) => e.target.style.backgroundColor = 'rgba(244, 63, 94, 0.1)'}
              onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
            >
              🗑️ Delete Event
            </button>
            <button
              onClick={() => setContextMenu(null)}
              style={{
                backgroundColor: 'transparent',
                border: 'none',
                color: 'var(--color-text-muted)',
                padding: '8px 12px',
                fontSize: '12px',
                textAlign: 'left',
                cursor: 'pointer',
                borderRadius: '4px',
                width: '100%',
                transition: 'background-color 0.2s',
              }}
              onMouseEnter={(e) => e.target.style.backgroundColor = 'rgba(255, 255, 255, 0.05)'}
              onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
            >
              Cancel
            </button>
          </div>
        );
      })()}
      {hoveredEvent && !contextMenu && (() => {
        const rect = hoveredEvent.rect;
        if (!rect) return null;
        const containerRect = containerRef.current?.getBoundingClientRect() || { left: 0, top: 0, width: window.innerWidth };
        const relativeLeft = rect.left - containerRect.left;
        const relativeRight = rect.right - containerRect.left;
        const relativeTop = rect.top - containerRect.top;

        const tooltipWidth = 240;
        const gap = 4;
        const shouldPlaceLeft = relativeRight + gap + tooltipWidth > containerRect.width;
        const left = shouldPlaceLeft 
          ? Math.max(8, relativeLeft - tooltipWidth - gap) 
          : Math.min(containerRect.width - tooltipWidth - 8, relativeRight + gap);
        const top = relativeTop;
        
        return (
          <div 
            style={{
              position: 'absolute',
              top: `${top}px`,
              left: `${left}px`,
              backgroundColor: 'rgba(15, 23, 42, 0.95)',
              backdropFilter: 'blur(8px)',
              border: '1px solid var(--color-accent)',
              borderRadius: '8px',
              padding: '10px 14px',
              color: '#ffffff',
              fontSize: '11px',
              width: `${tooltipWidth}px`,
              zIndex: 2000,
              boxShadow: '0 10px 15px -3px rgba(0,0,0,0.5)',
              pointerEvents: 'none',
            }}
            className="animate-fade-in"
          >
            <div style={{ fontWeight: '700', marginBottom: '4px', color: 'var(--color-accent)' }}>
              {hoveredEvent.event.summary}
            </div>
            <div style={{ color: '#cbd5e1', lineHeight: '1.4', whiteSpace: 'pre-line' }}>
              {hoveredEvent.event.description || 'No description provided.'}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

const styles = {
  calendarPage: {
    width: '100%',
    maxWidth: '1000px',
    margin: '0 auto',
    position: 'relative',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '24px',
    flexWrap: 'wrap',
    gap: '16px',
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
  navRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  navBtn: {
    backgroundColor: 'var(--bg-sidebar)',
    border: '1px solid var(--input-border)',
    borderRadius: '6px',
    color: 'var(--color-text-main)',
    padding: '6px 12px',
    fontSize: '12px',
    cursor: 'pointer',
  },
  scheduleBtn: {
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    border: '1px solid var(--color-accent)',
    borderRadius: '6px',
    color: 'var(--color-accent)',
    padding: '6px 14px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  stageMessage: {
    marginBottom: '16px',
    padding: '12px 16px',
    borderRadius: '10px',
    fontSize: '13px',
    color: 'var(--color-text-main)',
    border: '1px solid var(--input-border)',
  },
  weekRangeText: {
    fontSize: '13px',
    fontWeight: '600',
    color: 'var(--color-text-main)',
    marginLeft: '6px',
  },
  approvalWidget: {
    border: '1px solid var(--color-warning)',
    backgroundColor: 'rgba(251, 191, 36, 0.05)',
    padding: '20px',
    borderRadius: '12px',
    marginBottom: '24px',
  },
  approvalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  },
  approvalHint: {
    fontSize: '12px',
    color: 'var(--color-text-muted)',
    margin: '0 0 12px 0',
    lineHeight: '1.4',
  },
  badge: {
    fontSize: '12px',
    fontWeight: '700',
    color: 'var(--color-warning)',
    backgroundColor: 'rgba(251, 191, 36, 0.15)',
    padding: '4px 10px',
    borderRadius: '6px',
    border: '1px solid rgba(251, 191, 36, 0.25)',
  },
  txId: {
    fontSize: '11px',
    color: 'var(--color-text-muted)',
    fontFamily: 'monospace',
  },
  scarcityWarning: {
    display: 'flex',
    gap: '12px',
    backgroundColor: 'rgba(251, 191, 36, 0.08)',
    border: '1px solid rgba(251, 191, 36, 0.2)',
    padding: '12px',
    borderRadius: '8px',
    fontSize: '13px',
    color: 'var(--color-warning)',
    alignItems: 'center',
    marginBottom: '16px',
  },
  approvalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
  },
  rejectBtn: {
    backgroundColor: 'transparent',
    color: 'var(--color-text-main)',
    border: '1px solid var(--input-border)',
    borderRadius: '6px',
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
  },
  approveBtn: {
    backgroundColor: 'var(--color-accent)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    padding: '8px 20px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(99, 102, 241, 0.2)',
  },
  gridContainer: {
    padding: 0,
    overflow: 'hidden',
  },
  dayHeaderRow: {
    display: 'flex',
    backgroundColor: 'var(--bg-sidebar)',
    borderBottom: '1px solid var(--border-divider)',
    textAlign: 'center',
    alignItems: 'center',
    padding: '10px 0',
  },
  timeLabelSpacer: {
    width: '60px',
    fontSize: '11px',
    color: 'var(--color-text-muted)',
    fontWeight: '600',
    textAlign: 'right',
    paddingRight: '12px',
  },
  dayHeaderCell: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  dayName: {
    fontSize: '11px',
    color: 'var(--color-text-muted)',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  dayNum: {
    fontSize: '18px',
    fontWeight: '700',
    color: 'var(--color-text-main)',
    marginTop: '2px',
  },
  clearDayBtn: {
    marginTop: '6px',
    backgroundColor: 'transparent',
    border: '1px solid var(--input-border)',
    borderRadius: '4px',
    color: 'var(--color-text-muted)',
    fontSize: '9px',
    fontWeight: '600',
    padding: '2px 6px',
    cursor: 'pointer',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
  },
  gridBody: {
    display: 'flex',
    position: 'relative',
    overflowY: 'auto',
  },
  timeColumn: {
    width: '60px',
    borderRight: '1px solid var(--border-divider)',
    backgroundColor: 'var(--bg-sidebar)',
    zIndex: 2,
  },
  timeCell: {
    fontSize: '10px',
    color: 'var(--color-text-muted)',
    textAlign: 'right',
    paddingRight: '8px',
    paddingTop: '2px',
  },
  dayColumn: {
    flex: 1,
    position: 'relative',
    borderRight: '1px solid var(--border-divider)',
  },
  gridSlotRow: {
    width: '100%',
  },
  eventCard: {
    position: 'absolute',
    left: '4px',
    right: '4px',
    borderRadius: '8px',
    border: '1px solid',
    padding: '4px 6px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    overflow: 'hidden',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
    transition: 'all 0.15s ease',
  },
  evtHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '4px',
  },
  evtTitle: {
    fontSize: '10px',
    fontWeight: '700',
    color: 'var(--color-text-main)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  evtDur: {
    fontSize: '8px',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    color: 'var(--color-text-muted)',
    padding: '1px 3px',
    borderRadius: '3px',
    fontWeight: '600',
  },
  evtDesc: {
    fontSize: '9px',
    color: 'var(--color-text-muted)',
    margin: '2px 0 0 0',
    whiteSpace: 'pre-line',
    overflow: 'hidden',
    lineHeight: '1.3',
  },
  evtControls: {
    display: 'flex',
    gap: '4px',
    marginTop: '4px',
  },
  adjustBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    border: 'none',
    borderRadius: '3px',
    color: 'var(--color-text-main)',
    fontSize: '8px',
    padding: '2px 4px',
    cursor: 'pointer',
    outline: 'none',
  },
  resizeHandle: {
    position: 'absolute',
    bottom: '0',
    left: '0',
    right: '0',
    height: '6px',
    cursor: 'ns-resize',
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--color-text-muted)',
    fontSize: '6px',
    userSelect: 'none',
    lineHeight: '1',
  }
};
