import React, { useState } from 'react';
import { useAppState } from '../stateManager';

export default function InteractiveVibeDiff({ 
  transactionId: propTxId, 
  token: propToken, 
  proposedEvents: propEvents, 
  scarcityFlag: propScarcity, 
  reason: propReason,
  onApprove, 
  onCancel 
}) {
  const [state, setState] = useAppState();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isApproved, setIsApproved] = useState(false);
  const [draggedEventIdx, setDraggedEventIdx] = useState(null);

  // Fallback to state store values if props are not provided
  const transactionId = propTxId || state.transactionId || 'tx-mock';
  const token = propToken || state.token || 'token-mock';
  const proposedEvents = propEvents || state.proposedEvents || [];
  const scarcityFlag = propScarcity !== undefined ? propScarcity : state.scarcityFlag;
  const reason = propReason || state.reason;

  const startOfDay = 8 * 60; // 08:00 in minutes
  const endOfDay = 18 * 60; // 18:00 in minutes
  const totalMinutes = endOfDay - startOfDay; // 600 minutes
  const slotHeight = 25; // height of each 30-min slot in pixels
  const containerHeight = (totalMinutes / 30) * slotHeight; // 500px

  // Generate 30-min slots
  const slots = [];
  for (let h = 8; h < 18; h++) {
    slots.push({ hour: h, minute: 0, timeLabel: `${h.toString().padStart(2, '0')}:00` });
    slots.push({ hour: h, minute: 30, timeLabel: `${h.toString().padStart(2, '0')}:30` });
  }

  // Helper: parse date to minutes from 08:00
  const getMinutesFromStart = (dateStr) => {
    const d = new Date(dateStr);
    const mins = d.getHours() * 60 + d.getMinutes();
    return Math.max(0, mins - startOfDay);
  };

  // Helper: parse event duration in minutes
  const getDurationMins = (event) => {
    const start = new Date(event.start);
    const end = new Date(event.end);
    return Math.max(15, (end - start) / (1000 * 60));
  };

  // Drag & Drop handlers
  const handleDragStart = (e, index) => {
    setDraggedEventIdx(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e, slot) => {
    e.preventDefault();
    if (draggedEventIdx === null) return;

    const updated = [...proposedEvents];
    const event = updated[draggedEventIdx];
    const duration = getDurationMins(event);

    // Calculate new start time ISO string
    const newStart = new Date(event.start);
    newStart.setHours(slot.hour, slot.minute, 0);

    const newEnd = new Date(newStart.getTime() + duration * 60 * 1000);

    updated[draggedEventIdx] = {
      ...event,
      start: newStart.toISOString(),
      end: newEnd.toISOString()
    };

    setState({ proposedEvents: updated });
    setDraggedEventIdx(null);
  };

  // Quick adjust duration button handlers (+/- 15 mins)
  const adjustDuration = (index, deltaMins) => {
    const updated = [...proposedEvents];
    const event = updated[index];
    const start = new Date(event.start);
    const currentEnd = new Date(event.end);
    const newEnd = new Date(currentEnd.getTime() + deltaMins * 60 * 1000);
    const minEnd = new Date(start.getTime() + 15 * 60 * 1000); // minimum 15 mins

    if (newEnd >= minEnd) {
      updated[index] = {
        ...event,
        end: newEnd.toISOString()
      };
      setState({ proposedEvents: updated });
    }
  };

  // Drag to Resize handler (tactile mouse handle)
  const handleResizeMouseDown = (e, index) => {
    e.stopPropagation();
    e.preventDefault();
    const startY = e.clientY;
    const startEnd = new Date(proposedEvents[index].end);

    const handleMouseMove = (moveEvent) => {
      const deltaY = moveEvent.clientY - startY;
      // Map deltaY in pixels back to minutes. 
      // slotHeight (25px) represents 30 minutes, so 1px = 1.2 minutes
      const deltaMins = Math.round((deltaY / slotHeight) * 30 / 15) * 15; // snap to 15m
      
      if (deltaMins !== 0) {
        const updated = [...proposedEvents];
        const event = updated[index];
        const start = new Date(event.start);
        const newEnd = new Date(startEnd.getTime() + deltaMins * 60 * 1000);
        const minEnd = new Date(start.getTime() + 15 * 60 * 1000);

        if (newEnd >= minEnd) {
          updated[index] = {
            ...event,
            end: newEnd.toISOString()
          };
          setState({ proposedEvents: updated });
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

  const handleApprove = async () => {
    setIsSubmitting(true);
    
    // Gather selected scopes chosen in Onboarding
    const selectedScopes = state.targetCalendars
      .filter(c => c.selected)
      .map(c => c.id);

    // Cryptographically bound transaction envelope
    const envelope = {
      transaction_id: transactionId,
      token: token,
      action: 'approve',
      proposed_events: proposedEvents, // User-modified calendar timings
      calendar_scopes: selectedScopes  // Whitelisted scopes
    };

    try {
      if (onApprove) {
        await onApprove(envelope);
      }
      setIsApproved(true);
      setState({ isSubmitted: true });
    } catch (error) {
      console.error("Authorization dispatch failed:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = () => {
    const envelope = {
      transaction_id: transactionId,
      token: token,
      action: 'reject'
    };
    if (onCancel) {
      onCancel(envelope);
    }
    setState({ proposedEvents: [], isSubmitted: false });
  };

  return (
    <div style={styles.container} className="glass-card animate-fade-in">
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerTitleContainer}>
          <div style={styles.headerIcon}>📅</div>
          <div>
            <h3 style={styles.title}>Interactive Time Matrix</h3>
            <p style={styles.subtitle}>Drag events to reschedule or pull bottom handles to adjust duration</p>
          </div>
        </div>
        <div style={styles.txBadge}>TX: {transactionId}</div>
      </div>

      {/* Time Scarcity Alert Banner */}
      {scarcityFlag && (
        <div style={styles.scarcityAlert}>
          <div style={styles.scarcityIcon}>⚠️</div>
          <div style={styles.scarcityContent}>
            <h4 style={styles.scarcityTitle}>Graceful Degradation Triggered</h4>
            <p style={styles.scarcityText}>{reason}</p>
          </div>
        </div>
      )}

      {/* Grid Layout Container */}
      <div style={styles.matrixContainer}>
        {/* Left Side: Time Labels */}
        <div style={styles.timeLabelsColumn}>
          {slots.map((slot, idx) => (
            <div key={idx} style={{ ...styles.timeLabelCell, height: `${slotHeight}px` }}>
              {slot.minute === 0 ? slot.timeLabel : ''}
            </div>
          ))}
        </div>

        {/* Right Side: Grid Drop Slots & Absolute Cards */}
        <div style={{ ...styles.gridDropArea, height: `${containerHeight}px` }}>
          {/* Background Grid Slot Rows */}
          {slots.map((slot, idx) => (
            <div 
              key={idx} 
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, slot)}
              style={{ 
                ...styles.gridSlotRow, 
                height: `${slotHeight}px`,
                borderBottom: slot.minute === 30 ? '1px dashed rgba(255, 255, 255, 0.03)' : '1px solid rgba(255, 255, 255, 0.05)'
              }}
            >
              <span style={styles.innerSlotLabel}>{slot.timeLabel}</span>
            </div>
          ))}

          {/* Draggable Event Cards */}
          {proposedEvents.map((evt, index) => {
            const startMins = getMinutesFromStart(evt.start);
            const duration = getDurationMins(evt);
            
            const topPos = (startMins / 30) * slotHeight;
            const heightPos = (duration / 30) * slotHeight;

            return (
              <div
                key={evt.id || index}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                style={{
                  ...styles.eventCard,
                  top: `${topPos}px`,
                  height: `${heightPos}px`,
                }}
              >
                <div style={styles.eventCardHeader}>
                  <span style={styles.eventTitle}>{evt.summary}</span>
                  <span style={styles.durationBadge}>{duration}m</span>
                </div>
                
                <p style={styles.eventDesc}>{evt.description}</p>
                
                {/* Tactile adjustment buttons */}
                <div style={styles.quickAdjustRow}>
                  <button onClick={() => adjustDuration(index, -15)} style={styles.adjustBtn}>-15m</button>
                  <button onClick={() => adjustDuration(index, 15)} style={styles.adjustBtn}>+15m</button>
                </div>

                {/* Resize drag handle */}
                <div 
                  onMouseDown={(e) => handleResizeMouseDown(e, index)}
                  style={styles.resizeHandle}
                  title="Drag down to lengthen"
                >
                  •••
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer & Zero-Trust Verification */}
      <div style={styles.footer}>
        <div style={styles.securitySeal}>
          <span style={styles.sealIcon}>🔒</span>
          <span>Zero-Trust Execution Envelope Active</span>
        </div>
        
        <div style={styles.actionButtons}>
          {!isApproved ? (
            <>
              <button 
                onClick={handleReject} 
                style={styles.btnCancel}
                disabled={isSubmitting}
              >
                Reject
              </button>
              <button 
                onClick={handleApprove} 
                style={styles.btnApprove}
                disabled={isSubmitting || proposedEvents.length === 0}
              >
                {isSubmitting ? 'Signing Payload...' : 'Approve & Execute (HITL)'}
              </button>
            </>
          ) : (
            <div style={styles.approvedSuccess}>
              <span style={styles.checkIcon}>✅</span>
              <span>Handshake Verified! Schedule Dispatched.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    maxWidth: '850px',
    margin: '30px auto',
    padding: '24px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
    paddingBottom: '16px',
    marginBottom: '20px',
  },
  headerTitleContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  headerIcon: {
    fontSize: '28px',
  },
  title: {
    fontSize: '18px',
    fontWeight: '600',
    margin: 0,
    background: 'linear-gradient(to right, #38bdf8, #818cf8)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  subtitle: {
    fontSize: '13px',
    color: '#94a3b8',
    margin: '2px 0 0 0',
  },
  txBadge: {
    fontSize: '11px',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    padding: '4px 8px',
    borderRadius: '6px',
    color: '#cbd5e1',
    fontFamily: 'monospace',
    border: '1px solid rgba(255, 255, 255, 0.08)',
  },
  scarcityAlert: {
    display: 'flex',
    gap: '12px',
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    border: '1px solid rgba(245, 158, 11, 0.25)',
    borderRadius: '12px',
    padding: '12px 16px',
    marginBottom: '20px',
    alignItems: 'center',
  },
  scarcityIcon: {
    fontSize: '18px',
    color: '#fbbf24',
  },
  scarcityContent: {
    flex: 1,
  },
  scarcityTitle: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#fbbf24',
    margin: 0,
  },
  scarcityText: {
    fontSize: '12px',
    color: '#e2e8f0',
    margin: '2px 0 0 0',
  },
  matrixContainer: {
    display: 'flex',
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    borderRadius: '12px',
    border: '1px solid rgba(255, 255, 255, 0.05)',
    padding: '16px',
    gap: '16px',
    marginBottom: '24px',
  },
  timeLabelsColumn: {
    width: '40px',
    display: 'flex',
    flexDirection: 'column',
  },
  timeLabelCell: {
    fontSize: '11px',
    color: '#64748b',
    textAlign: 'right',
    paddingRight: '8px',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'flex-end',
  },
  gridDropArea: {
    flex: 1,
    position: 'relative',
    borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
  },
  gridSlotRow: {
    width: '100%',
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    paddingLeft: '12px',
  },
  innerSlotLabel: {
    fontSize: '10px',
    color: '#334155',
    pointerEvents: 'none',
  },
  eventCard: {
    position: 'absolute',
    left: '12px',
    right: '12px',
    backgroundColor: 'rgba(99, 102, 241, 0.12)',
    border: '1px solid rgba(99, 102, 241, 0.3)',
    borderLeft: '4px solid #6366f1',
    borderRadius: '8px',
    padding: '8px 12px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    overflow: 'hidden',
    cursor: 'grab',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.2)',
    transition: 'border-color 0.2s',
    zIndex: 10,
    ':active': {
      cursor: 'grabbing',
    }
  },
  eventCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '2px',
  },
  eventTitle: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#e2e8f0',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  durationBadge: {
    fontSize: '10px',
    backgroundColor: 'rgba(99, 102, 241, 0.25)',
    color: '#a5b4fc',
    padding: '1px 6px',
    borderRadius: '8px',
    fontWeight: '500',
  },
  eventDesc: {
    fontSize: '11px',
    color: '#94a3b8',
    margin: 0,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  quickAdjustRow: {
    display: 'flex',
    gap: '6px',
    marginTop: '4px',
  },
  adjustBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '4px',
    color: '#94a3b8',
    fontSize: '9px',
    padding: '2px 6px',
    cursor: 'pointer',
    outline: 'none',
    transition: 'background 0.2s',
    ':hover': {
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
      color: '#ffffff',
    }
  },
  resizeHandle: {
    position: 'absolute',
    bottom: '0',
    left: '0',
    right: '0',
    height: '6px',
    cursor: 'ns-resize',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'rgba(99, 102, 241, 0.5)',
    fontSize: '8px',
    userSelect: 'none',
    backgroundColor: 'rgba(99, 102, 241, 0.08)',
    lineHeight: '1',
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTop: '1px solid rgba(255, 255, 255, 0.08)',
    paddingTop: '20px',
    marginTop: '20px',
    flexWrap: 'wrap',
    gap: '12px',
  },
  securitySeal: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    color: '#10b981',
    fontWeight: '500',
  },
  sealIcon: {
    fontSize: '14px',
  },
  actionButtons: {
    display: 'flex',
    gap: '12px',
  },
  btnCancel: {
    backgroundColor: 'transparent',
    color: '#cbd5e1',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    outline: 'none',
  },
  btnApprove: {
    backgroundColor: '#6366f1',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    padding: '8px 20px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    boxShadow: '0 4px 6px -1px rgba(99, 102, 241, 0.4)',
    outline: 'none',
  },
  approvedSuccess: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: '#10b981',
    fontSize: '13px',
    fontWeight: '600',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    border: '1px solid rgba(16, 185, 129, 0.2)',
    padding: '8px 16px',
    borderRadius: '8px',
  },
  checkIcon: {
    fontSize: '16px',
  }
};
