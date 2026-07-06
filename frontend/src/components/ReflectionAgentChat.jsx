import React, { useState, useRef, useEffect } from 'react';
import { useAppState } from '../stateManager';
import { MarkdownRenderer } from './MarkdownRenderer';

const REFLECTION_GREETING =
  "Hello! I'm your Reflection Agent. Share how your learning is going — I can add milestones or tasks when concepts feel hard, adjust due dates for incomplete work, recommend resources for specific questions, or help reorganize your plan. I won't remove anything unless you explicitly ask.";

function getReflectionMessages(goal) {
  if (!goal) return [{ role: 'model', text: REFLECTION_GREETING }];
  return goal.reflection_messages?.length
    ? goal.reflection_messages
    : goal.conversations?.length
      ? goal.conversations
      : [{ role: 'model', text: REFLECTION_GREETING }];
}

export default function ReflectionAgentChat() {
  const [state, setState] = useAppState();
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [viewingArchiveId, setViewingArchiveId] = useState(null);
  const threadEndRef = useRef(null);

  const activeGoal =
    state.goals.find((g) => g.id === state.activeGoalId) || state.goals[0] || null;
  const messages = getReflectionMessages(activeGoal);
  const archived = activeGoal?.archived_reflection_conversations || [];
  const viewingArchive = archived.find((c) => c.id === viewingArchiveId);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping, viewingArchiveId]);

  const handleGoalChange = (goalId) => {
    setState({ activeGoalId: goalId });
    setViewingArchiveId(null);
    setShowArchived(false);
  };

  const goBackToProject = () => {
    if (!activeGoal) {
      setState({ activeTab: 'projects' });
      return;
    }
    setState({
      activeTab: 'projects',
      activeGoalId: activeGoal.id,
      openProjectDetail: true,
    });
  };

  const handleDeleteArchive = async (archiveId, event) => {
    event.stopPropagation();
    if (!activeGoal) return;
    if (!window.confirm('Delete this archived conversation permanently?')) return;
    try {
      const res = await fetch(
        `/api/goals/${activeGoal.id}/reflection/archive/${archiveId}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        const data = await res.json();
        setState({ goals: data.goals });
        if (viewingArchiveId === archiveId) {
          setViewingArchiveId(null);
        }
      }
    } catch (err) {
      console.error('Failed to delete archived reflection conversation:', err);
    }
  };

  const handleArchiveAndNew = async () => {
    if (!activeGoal) return;
    if (
      messages.length > 1 &&
      !window.confirm('Archive this conversation and start a new one?')
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/goals/${activeGoal.id}/reflection/new`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setState({ goals: data.goals });
        setViewingArchiveId(null);
        setShowArchived(false);
      }
    } catch (err) {
      console.error('Failed to start new reflection conversation:', err);
    }
  };

  const handleSend = async (textToSend, options = {}) => {
    if (!textToSend.trim() || !activeGoal) return;

    const userMsg = { role: 'user', text: textToSend };
    const optimisticGoals = state.goals.map((g) => {
      if (g.id !== activeGoal.id) return g;
      const convs = [...getReflectionMessages(g), userMsg];
      return { ...g, reflection_messages: convs, conversations: convs };
    });

    setState({ goals: optimisticGoals });
    setInputValue('');
    setIsTyping(true);
    setViewingArchiveId(null);

    try {
      const res = await fetch(`/api/goals/${activeGoal.id}/reflect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reflection_text: textToSend,
          confirm_deletion: options.confirmDeletion || false,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setState({ goals: data.goals });
      } else {
        throw new Error('Reflection request failed');
      }
    } catch (err) {
      console.error('Reflection agent error:', err);
    } finally {
      setIsTyping(false);
    }
  };

  const suggestionChips = [
    'This concept feels too hard — add a review milestone',
    'Push my incomplete tasks back by one week',
    'Recommend resources for MCP transport setup',
    'I need more time on my current milestone',
  ];

  const displayMessages = viewingArchive ? viewingArchive.messages : messages;

  if (!state.goals.length) {
    return (
      <div style={styles.chatPage} className="animate-fade-in">
        <div style={styles.headerContainer}>
          <div style={styles.header}>
            <h2 style={styles.pageTitle}>Reflection Agent ✍️</h2>
          </div>
          <div style={styles.navButtonGroup}>
            <button type="button" onClick={() => setState({ activeTab: 'projects' })} style={styles.prevBtn}>
              ← Back to Projects
            </button>
          </div>
        </div>
        <div className="glass-card" style={styles.emptyCard}>
          Create a project goal first, then return here to reflect and adjust your learning plan.
        </div>
      </div>
    );
  }

  return (
    <div style={styles.chatPage} className="animate-fade-in">
      <div style={styles.headerContainer}>
        <div style={styles.header}>
          <h2 style={styles.pageTitle}>Reflection Agent ✍️</h2>
          <p style={styles.pageSubtitle}>
            Discuss progress, add support milestones, reschedule incomplete work, and get resource recommendations.
          </p>
        </div>
        <div style={styles.headerActions}>
          <div style={styles.navButtonGroup}>
            <button type="button" onClick={goBackToProject} style={styles.prevBtn}>
              ← Back to Project
            </button>
            <button
              type="button"
              onClick={() => {
                setShowArchived((v) => !v);
                setViewingArchiveId(null);
              }}
              style={styles.secondaryBtn}
            >
              📁 Past Conversations{archived.length ? ` (${archived.length})` : ''}
            </button>
            <button type="button" onClick={handleArchiveAndNew} style={styles.nextBtn}>
              🔄 New Conversation
            </button>
          </div>
        </div>
      </div>

      <div style={styles.goalPickerRow}>
        <label style={styles.goalLabel}>Project goal:</label>
        <select
          value={activeGoal?.id || ''}
          onChange={(e) => handleGoalChange(e.target.value)}
          style={styles.goalSelect}
        >
          {state.goals.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title}
            </option>
          ))}
        </select>
      </div>

      {showArchived && (
        <div style={styles.archivePanel} className="glass-card">
          <div style={styles.archiveHeader}>
            <strong>Archived conversations</strong>
            <button type="button" onClick={() => setShowArchived(false)} style={styles.closeArchiveBtn}>
              Close
            </button>
          </div>
          {archived.length === 0 ? (
            <p style={styles.archiveEmpty}>No archived conversations yet.</p>
          ) : (
            <div style={styles.archiveList}>
              {archived.map((conv) => (
                <div
                  key={conv.id}
                  style={{
                    ...styles.archiveItem,
                    borderColor:
                      viewingArchiveId === conv.id ? 'var(--color-accent)' : 'var(--border-card)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setViewingArchiveId(conv.id)}
                    style={styles.archiveItemMain}
                  >
                    <span style={styles.archiveTitle}>{conv.title}</span>
                    <span style={styles.archiveDate}>
                      {conv.archived_at ? new Date(conv.archived_at).toLocaleString() : ''}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleDeleteArchive(conv.id, e)}
                    style={styles.deleteArchiveBtn}
                    title="Delete archived conversation"
                  >
                    🗑️
                  </button>
                </div>
              ))}
            </div>
          )}
          {viewingArchive && (
            <button
              type="button"
              onClick={() => setViewingArchiveId(null)}
              style={{ ...styles.secondaryBtn, marginTop: '12px' }}
            >
              ← Back to current conversation
            </button>
          )}
        </div>
      )}

      <div style={styles.chatContainer} className="glass-card">
        {viewingArchive && (
          <div style={styles.viewingBanner}>
            Viewing archived conversation — read only
          </div>
        )}

        <div style={styles.messagesThread}>
          {displayMessages.map((msg, idx) => (
            <div
              key={idx}
              style={{
                ...styles.chatRow,
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
              }}
            >
              <div
                style={{
                  ...styles.bubble,
                  backgroundColor: msg.role === 'user' ? 'var(--color-accent)' : 'var(--bg-sidebar)',
                  color: msg.role === 'user' ? '#ffffff' : 'var(--color-text-main)',
                  borderColor: msg.role === 'user' ? 'var(--color-accent)' : 'var(--border-card)',
                  borderRadius:
                    msg.role === 'user' ? '16px 16px 2px 16px' : '16px 16px 16px 2px',
                }}
              >
                <div style={styles.roleLabel}>
                  {msg.role === 'user' ? 'You' : 'Reflection Agent'}
                </div>
                {msg.role === 'user' ? (
                  <p style={styles.text}>{msg.text}</p>
                ) : (
                  <MarkdownRenderer text={msg.text} />
                )}

                {msg.requires_confirmation && !viewingArchive && (
                  <button
                    type="button"
                    onClick={() => handleSend('confirm delete', { confirmDeletion: true })}
                    style={styles.confirmDeleteBtn}
                  >
                    Confirm deletion
                  </button>
                )}
              </div>
            </div>
          ))}

          {isTyping && (
            <div style={styles.chatRow} className="typing-indicator">
              <div style={{ ...styles.bubble, backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border-card)' }}>
                <span style={styles.typingDot}>•</span>
                <span style={styles.typingDot}>•</span>
                <span style={styles.typingDot}>•</span>
              </div>
            </div>
          )}
          <div ref={threadEndRef} />
        </div>

        {!viewingArchive && (
          <>
            <div style={styles.chipsRow}>
              {suggestionChips.map((chip, idx) => (
                <button key={idx} type="button" onClick={() => handleSend(chip)} style={styles.chipBtn}>
                  💡 {chip}
                </button>
              ))}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend(inputValue);
              }}
              style={styles.inputBar}
            >
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Share reflections, ask for resources, request timeline changes, or ask to add support tasks..."
                style={styles.chatInput}
                rows={4}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend(inputValue);
                  }
                }}
              />
              <button type="submit" style={styles.sendBtn} disabled={!inputValue.trim() || isTyping}>
                Send
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

const styles = {
  chatPage: {
    width: '100%',
    maxWidth: '900px',
    margin: '0 auto',
  },
  headerContainer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '16px',
    width: '100%',
    gap: '16px',
    flexWrap: 'wrap',
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
  },
  headerActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    flexShrink: 0,
  },
  navButtonGroup: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  prevBtn: {
    backgroundColor: 'transparent',
    color: 'var(--color-text-muted)',
    border: '1px solid var(--input-border)',
    borderRadius: '8px',
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  nextBtn: {
    backgroundColor: 'var(--color-accent)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
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
  goalPickerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '16px',
  },
  goalLabel: {
    fontSize: '12px',
    fontWeight: '600',
    color: 'var(--color-text-muted)',
  },
  goalSelect: {
    flex: 1,
    maxWidth: '400px',
    backgroundColor: 'var(--bg-main)',
    border: '1px solid var(--input-border)',
    color: 'var(--color-text-main)',
    borderRadius: '8px',
    padding: '8px 12px',
    fontSize: '13px',
  },
  secondaryBtn: {
    backgroundColor: 'var(--bg-sidebar)',
    border: '1px solid var(--input-border)',
    color: 'var(--color-text-main)',
    borderRadius: '8px',
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  archivePanel: {
    padding: '16px',
    marginBottom: '16px',
  },
  archiveHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
    fontSize: '13px',
    color: 'var(--color-text-main)',
  },
  closeArchiveBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
    fontSize: '12px',
  },
  archiveEmpty: {
    fontSize: '12px',
    color: 'var(--color-text-muted)',
    margin: 0,
  },
  archiveList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  archiveItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '8px',
    padding: '4px',
    borderRadius: '8px',
    border: '1px solid var(--border-card)',
    backgroundColor: 'var(--bg-sidebar)',
  },
  archiveItemMain: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    flex: 1,
    padding: '6px 8px',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    textAlign: 'left',
  },
  deleteArchiveBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '14px',
    padding: '6px 8px',
    borderRadius: '6px',
    opacity: 0.7,
  },
  archiveTitle: {
    fontSize: '13px',
    color: 'var(--color-text-main)',
    fontWeight: '500',
  },
  archiveDate: {
    fontSize: '11px',
    color: 'var(--color-text-muted)',
    whiteSpace: 'nowrap',
  },
  chatContainer: {
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    height: '620px',
    justifyContent: 'space-between',
  },
  viewingBanner: {
    fontSize: '11px',
    color: 'var(--color-warning)',
    marginBottom: '8px',
    fontWeight: '600',
  },
  messagesThread: {
    flex: 1,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    paddingRight: '8px',
    marginBottom: '16px',
  },
  chatRow: {
    display: 'flex',
    width: '100%',
  },
  bubble: {
    maxWidth: '75%',
    padding: '12px 16px',
    border: '1px solid',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
  },
  roleLabel: {
    fontSize: '10px',
    color: 'var(--color-text-muted)',
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: '4px',
  },
  text: {
    fontSize: '13px',
    margin: 0,
    lineHeight: '1.4',
  },
  confirmDeleteBtn: {
    marginTop: '10px',
    backgroundColor: 'rgba(244, 63, 94, 0.15)',
    border: '1px solid rgba(244, 63, 94, 0.4)',
    color: '#fb7185',
    borderRadius: '6px',
    padding: '6px 12px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  chipsRow: {
    display: 'flex',
    gap: '8px',
    overflowX: 'auto',
    paddingBottom: '8px',
    marginBottom: '12px',
  },
  chipBtn: {
    backgroundColor: 'var(--bg-sidebar)',
    border: '1px solid var(--input-border)',
    color: 'var(--color-text-muted)',
    borderRadius: '16px',
    padding: '6px 14px',
    fontSize: '11px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  inputBar: {
    display: 'flex',
    gap: '12px',
    alignItems: 'flex-end',
  },
  chatInput: {
    flex: 1,
    backgroundColor: 'var(--bg-main)',
    border: '1px solid var(--input-border)',
    color: 'var(--color-text-main)',
    borderRadius: '8px',
    padding: '12px 16px',
    fontSize: '13px',
    outline: 'none',
    resize: 'vertical',
    minHeight: '96px',
    maxHeight: '200px',
    overflowY: 'auto',
    lineHeight: '1.4',
    fontFamily: 'inherit',
  },
  sendBtn: {
    backgroundColor: 'var(--color-accent)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    padding: '12px 20px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    alignSelf: 'flex-end',
  },
  typingDot: {
    display: 'inline-block',
    animation: 'blink 1.4s infinite both',
    fontSize: '18px',
    margin: '0 2px',
  },
  emptyCard: {
    padding: '30px',
    textAlign: 'center',
    color: 'var(--color-text-muted)',
    fontSize: '14px',
  },
};
