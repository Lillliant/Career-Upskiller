import React, { useState, useEffect } from 'react';
import { useAppState } from '../stateManager';

export default function WeeklyCalendar({ onApprove, onCancel }) {
  const [state, setState] = useAppState();
  const [draggedEventId, setDraggedEventId] = useState(null);
  const [draggedProposedIdx, setDraggedProposedIdx] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Time matrix setup (08:00 - 18:00)
  const startHour = 8;
  const endHour = 18;
  const slotHeight = 35; // px per 30 minutes
  const totalMinutes = (endHour - startHour) * 60;
  const containerHeight = (totalMinutes / 30) * slotHeight;

  // Generate 7 days starting Thursday 2026-07-02
  const baseDate = new Date(2026, 6, 2); // July 2, 2026
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

  // Time labels list
  const timeSlots = [];
  for (let h = startHour; h < endHour; h++) {
    timeSlots.push({ hour: h, minute: 0, label: `${h.toString().padStart(2, '0')}:00` });
    timeSlots.push({ hour: h, minute: 30, label: `${h.toString().padStart(2, '0')}:30` });
  }

  // Load calendar events from backend if live
  useEffect(() => {
    const loadEvents = async () => {
      if (state.isSimulating) return;
      try {
        const res = await fetch('/api/calendar/events');
        if (res.ok) {
          const events = await res.json();
          setState({ calendarEvents: events });
        }
      } catch (err) {
        console.error("Failed to load calendar events:", err);
      }
    };
    loadEvents();
  }, [state.isSubmitted, state.onboarded]);

  // Helper: check if event is on a specific day
  const getEventsForDay = (dateStr) => {
    const dayEvents = [];

    // Add confirmed events
    state.calendarEvents.forEach(evt => {
      if (evt.start && evt.start.startsWith(dateStr)) {
        dayEvents.push({ ...evt, isProposed: false });
      }
    });

    // Add proposed events
    state.proposedEvents.forEach((evt, idx) => {
      if (evt.start && evt.start.startsWith(dateStr)) {
        dayEvents.push({ ...evt, isProposed: true, proposedIdx: idx });
      }
    });

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
        start: newStart.toISOString(),
        end: newEnd.toISOString()
      };
      setState({ proposedEvents: updated });
    } else {
      // Dragging an already scheduled block
      const updated = state.calendarEvents.map(evt => {
        if (evt.id === draggedEventId) {
          const duration = getDurationMins(evt.start, evt.end);
          const newStart = new Date(targetDay.fullDate);
          newStart.setHours(targetHour, targetMin, 0);
          const newEnd = new Date(newStart.getTime() + duration * 60 * 1000);
          return {
            ...evt,
            start: newStart.toISOString(),
            end: newEnd.toISOString()
          };
        }
        return evt;
      });
      setState({ calendarEvents: updated });
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
        updated[proposedIdx] = { ...evt, end: newEnd.toISOString() };
        setState({ proposedEvents: updated });
      }
    } else {
      const updated = state.calendarEvents.map(evt => {
        if (evt.id === event.id) {
          const start = new Date(evt.start);
          const end = new Date(evt.end);
          const newEnd = new Date(end.getTime() + deltaMins * 60 * 1000);
          if (newEnd >= new Date(start.getTime() + 15 * 60 * 1000)) {
            return { ...evt, end: newEnd.toISOString() };
          }
        }
        return evt;
      });
      setState({ calendarEvents: updated });
    }
  };

  // Resize drag handler
  const handleResizeMouseDown = (e, event, isProposed, proposedIdx) => {
    e.stopPropagation();
    e.preventDefault();
    const startY = e.clientY;
    const initialEnd = new Date(event.end);

    const handleMouseMove = (moveEvent) => {
      const deltaY = moveEvent.clientY - startY;
      // 1px = (30 mins / slotHeight) minutes
      const deltaMins = Math.round((deltaY / slotHeight) * 30 / 15) * 15;
      
      if (deltaMins !== 0) {
        const start = new Date(event.start);
        const newEnd = new Date(initialEnd.getTime() + deltaMins * 60 * 1000);
        if (newEnd >= new Date(start.getTime() + 15 * 60 * 1000)) {
          if (isProposed && proposedIdx !== null) {
            const updated = [...state.proposedEvents];
            updated[proposedIdx] = { ...updated[proposedIdx], end: newEnd.toISOString() };
            setState({ proposedEvents: updated });
          } else {
            const updated = state.calendarEvents.map(evt => {
              if (evt.id === event.id) {
                return { ...evt, end: newEnd.toISOString() };
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
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const executeApproval = async () => {
    setIsSubmitting(true);
    const selectedScopes = state.targetCalendars
      .filter(c => c.selected)
      .map(c => c.id);

    const envelope = {
      transaction_id: state.transactionId || 'tx-mock-123',
      token: state.token || 'token-mock-123',
      action: 'approve',
      proposed_events: state.proposedEvents,
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

  const executeReject = () => {
    onCancel({
      transaction_id: state.transactionId,
      token: state.token,
      action: 'reject'
    });
    setState({ proposedEvents: [] });
  };

  return (
    <div style={styles.calendarPage} className="animate-fade-in">
      <div style={styles.header}>
        <div>
          <h2 style={styles.pageTitle}>Weekly Schedule Overview 📅</h2>
          <p style={styles.pageSubtitle}>Monitor integrated calendars and staging matrices side-by-side.</p>
        </div>
      </div>

      {/* Scarcity / Staging Zero-Trust Banner */}
      {state.proposedEvents.length > 0 && (
        <div style={styles.approvalWidget} className="glass-card">
          <div style={styles.approvalHeader}>
            <div style={styles.badge}>🔐 Zero-Trust Stage Staged</div>
            <div style={styles.txId}>Transaction: {state.transactionId}</div>
          </div>
          
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
                {/* Visual horizontal slots for dropping */}
                {timeSlots.map((slot, idx) => (
                  <div 
                    key={idx}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, day, slot.hour, slot.minute)}
                    style={{ 
                      ...styles.gridSlotRow, 
                      height: `${slotHeight}px`,
                      borderBottom: slot.minute === 30 ? '1px dashed var(--calendar-grid-line)' : '1px solid var(--calendar-grid-line)'
                    }}
                  ></div>
                ))}

                {/* Absolutely positioned events */}
                {dayEvents.map((evt, idx) => {
                  const startMins = getMinutesFromStart(evt.start);
                  const duration = getDurationMins(evt.start, evt.end);
                  const top = (startMins / 30) * slotHeight;
                  const height = (duration / 30) * slotHeight;

                  const isLearning = evt.type === 'learning' || evt.isProposed;
                  const isExternal = evt.type === 'external';

                  return (
                    <div
                      key={evt.id || idx}
                      draggable={isLearning}
                      onDragStart={(e) => handleDragStart(e, evt.id || null, evt.isProposed ? evt.proposedIdx : null)}
                      style={{
                        ...styles.eventCard,
                        top: `${top}px`,
                        height: `${height}px`,
                        backgroundColor: evt.isProposed 
                          ? 'rgba(99, 102, 241, 0.08)' 
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
                      
                      {height > 45 && (
                        <p style={styles.evtDesc}>{evt.description || 'External meetings block'}</p>
                      )}

                      {/* Controls for learning blocks */}
                      {isLearning && height > 60 && (
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
    </div>
  );
}

const styles = {
  calendarPage: {
    width: '100%',
    maxWidth: '1000px',
    margin: '0 auto',
  },
  header: {
    marginBottom: '24px',
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
    marginBottom: '12px',
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
    padding: '6px 8px',
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
    fontSize: '11px',
    fontWeight: '700',
    color: 'var(--color-text-main)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  evtDur: {
    fontSize: '9px',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    color: 'var(--color-text-muted)',
    padding: '1px 4px',
    borderRadius: '4px',
    fontWeight: '600',
  },
  evtDesc: {
    fontSize: '10px',
    color: 'var(--color-text-muted)',
    margin: '2px 0 0 0',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
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
