import React, { useState, useRef, useEffect } from 'react';
import { useAppState } from '../stateManager';
import { stageWeeklySchedule } from '../scheduleApi';
import { MarkdownRenderer } from './MarkdownRenderer';

export default function GoalBuilderChat() {
  const [state, setState] = useAppState();
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [viewingArchiveId, setViewingArchiveId] = useState(null);
  const threadEndRef = useRef(null);

  const archived = state.builderArchivedConversations || [];
  const viewingArchive = archived.find((c) => c.id === viewingArchiveId);
  const displayMessages = viewingArchive ? viewingArchive.messages : state.builderMessages;

  const handleDeleteArchive = async (archiveId, event) => {
    event.stopPropagation();
    if (!window.confirm('Delete this archived conversation permanently?')) return;
    try {
      const res = await fetch(`/api/chat/builder/archive/${archiveId}`, { method: 'DELETE' });
      if (res.ok) {
        const data = await res.json();
        setState({ builderArchivedConversations: data.builder_archived_conversations });
        if (viewingArchiveId === archiveId) {
          setViewingArchiveId(null);
        }
      }
    } catch (err) {
      console.error('Failed to delete archived builder conversation:', err);
    }
  };

  const handleNewConversation = async () => {
    if (
      state.builderMessages.length > 1 &&
      !window.confirm('Archive this conversation and start a new one?')
    ) {
      return;
    }
    try {
      const res = await fetch('/api/chat/builder/archive', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setState({
          builderMessages: data.builder_messages,
          builderArchivedConversations: data.builder_archived_conversations,
        });
        setViewingArchiveId(null);
        setShowArchived(false);
      }
    } catch (err) {
      console.error('Failed to archive builder conversation:', err);
    }
  };

  const suggestionChips = [
    "Recommend trending AI Engineering goals",
    "What projects should I do for MLOps?",
    "Suggest intermediate Cloud Architecture milestones",
    "How can I practice Agentic Security?"
  ];

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [displayMessages, isTyping, viewingArchiveId]);

  const persistBuilderMessages = async (messages) => {
    try {
      await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ builder_messages: messages }),
      });
    } catch (err) {
      console.error('Failed to persist builder messages:', err);
    }
  };

  const handleSend = async (textToSend) => {
    if (!textToSend.trim()) return;

    const userMsg = { role: 'user', text: textToSend };
    const updatedMsgs = [...state.builderMessages, userMsg];
    
    setState({ builderMessages: updatedMsgs });
    setInputValue('');
    setIsTyping(true);

    // Live mode connecting to FastAPI chat endpoint
    try {
      const response = await fetch('/api/chat/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updatedMsgs
        })
      });

      if (response.ok) {
        const data = await response.json();
        const nextMessages = [
          ...updatedMsgs,
          { 
            role: 'model', 
            text: data.text,
            suggestedGoal: data.suggestedGoal || null
          }
        ];
        setState({ builderMessages: nextMessages });
        await persistBuilderMessages(nextMessages);
      } else {
        throw new Error("Failed to send message to live agent");
      }
    } catch (err) {
      console.error("Live agent builder error:", err);
      setState({
        builderMessages: [
          ...updatedMsgs,
          { role: 'model', text: `Failed to connect with the live agent. (Error: ${err.message}).` }
        ]
      });
    } finally {
      setIsTyping(false);
    }
  };

  const handleAddSuggestedGoal = async (goal) => {
    try {
      const res = await fetch('/api/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(goal)
      });
      if (res.ok) {
        const data = await res.json();
        setState({ goals: data.goals, activeTab: 'projects', activeGoalId: data.goals[data.goals.length - 1]?.id, openProjectDetail: true });

        try {
          await stageWeeklySchedule(setState);
        } catch (err) {
          console.error("Failed to stage schedule after adding goal:", err);
        }
      }
    } catch (err) {
      console.error("Failed to add live goal:", err);
    }
  };

  return (
    <div style={styles.chatPage} className="animate-fade-in">
      <div style={styles.headerContainer}>
        <div style={styles.header}>
          <h2 style={styles.pageTitle}>Conversational Goal Builder 💬</h2>
          <p style={styles.pageSubtitle}>Converse with the agent concierge to explore market insights and refine learning directions.</p>
        </div>
        <div style={styles.headerActions}>
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
          <button type="button" onClick={handleNewConversation} style={styles.newConvBtn}>
            🔄 New Conversation
          </button>
        </div>
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
          <div style={styles.viewingBanner}>Viewing archived conversation — read only</div>
        )}
        {/* Messages Log Thread */}
        <div style={styles.messagesThread}>
          {displayMessages.map((msg, idx) => (
            <div 
              key={idx} 
              style={{
                ...styles.chatRow,
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start'
              }}
            >
              <div 
                style={{
                  ...styles.bubble,
                  backgroundColor: msg.role === 'user' ? 'var(--color-accent)' : 'var(--bg-sidebar)',
                  color: msg.role === 'user' ? '#ffffff' : 'var(--color-text-main)',
                  borderColor: msg.role === 'user' ? 'var(--color-accent)' : 'var(--border-card)',
                  borderRadius: msg.role === 'user' ? '16px 16px 2px 16px' : '16px 16px 16px 2px'
                }}
              >
                <div style={styles.roleLabel}>
                  {msg.role === 'user' ? 'You' : 'Upskilling Agent'}
                </div>
                {msg.role === 'user' ? (
                  <p style={styles.text}>{msg.text}</p>
                ) : (
                  <MarkdownRenderer text={msg.text} />
                )}

                {/* Embedded Goal Proposal */}
                {msg.suggestedGoal && (
                  <div style={styles.goalProposalBox}>
                    <div style={styles.proposalHeader}>
                      <span style={{ fontSize: '16px' }}>🎯</span>
                      <strong>Suggested New Goal</strong>
                    </div>
                    <h4 style={styles.proposalTitle}>{msg.suggestedGoal.title}</h4>
                    <p style={styles.proposalDesc}>{msg.suggestedGoal.description}</p>
                    {msg.suggestedGoal.priority !== undefined && (
                      <span style={styles.proposalPriority}>
                        Priority: {{
                          0: 'Low urgency',
                          1: 'Medium urgency',
                          2: 'High urgency',
                        }[msg.suggestedGoal.priority] ?? 'Medium urgency'}
                      </span>
                    )}
                    
                    <div style={styles.proposalSubProjects}>
                      <strong>Milestones & Tasks Learning Map:</strong>
                      {msg.suggestedGoal.sub_projects.map((m, mIdx) => (
                        <div key={mIdx} style={{ marginTop: '8px', paddingLeft: '4px' }}>
                          <div style={{ fontWeight: '600', fontSize: '13px', color: 'var(--color-accent)' }}>
                            📍 {m.title} {m.dueDate && <span style={{ opacity: 0.6, fontSize: '10px' }}>(Due: {m.dueDate})</span>}
                          </div>
                          {m.description && (
                            <p style={{ margin: '2px 0 6px 16px', fontSize: '11px', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                              {m.description}
                            </p>
                          )}
                          {m.tasks && m.tasks.map((t, tIdx) => (
                            <div key={tIdx} style={{ ...styles.proposalTask, paddingLeft: '16px', fontSize: '12px', marginTop: '4px' }}>
                              <span>▫️</span> <strong>{t.title}</strong> {t.estimated_time && <span style={{ color: 'var(--color-accent)', fontSize: '10px', marginLeft: '6px' }}>⏱️ {t.estimated_time}</span>}
                              {t.dueDate && <span style={{ opacity: 0.6, fontSize: '9px', marginLeft: '6px' }}>(Due: {t.dueDate})</span>}
                              {t.description && (
                                <p style={{ margin: '2px 0 0 14px', fontSize: '11px', color: 'var(--color-text-muted)' }}>
                                  {t.description}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>

                    {msg.suggestedGoal.skills && msg.suggestedGoal.skills.length > 0 && (
                      <div style={styles.proposalSkillsSection}>
                        <strong>Skills to Gain:</strong>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                          {msg.suggestedGoal.skills.map((s, sIdx) => (
                            <span key={sIdx} style={styles.proposalSkillTag}>
                              💡 {s.name} ({s.category})
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <button 
                      onClick={() => handleAddSuggestedGoal(msg.suggestedGoal)}
                      style={styles.addGoalBtn}
                    >
                      Add to My Goals & Schedule
                    </button>
                  </div>
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
                <button 
                  key={idx} 
                  onClick={() => handleSend(chip)}
                  style={styles.chipBtn}
                >
                  💡 {chip}
                </button>
              ))}
            </div>

            <form 
              onSubmit={(e) => { e.preventDefault(); handleSend(inputValue); }}
              style={styles.inputBar}
            >
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Type your career goal or upskilling interest (e.g. Master LangChain...)"
                style={styles.chatInput}
                rows={4}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend(inputValue);
                  }
                }}
              />
              <button type="submit" style={styles.sendBtn} disabled={!inputValue.trim()}>
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
    marginBottom: '20px',
    width: '100%',
    gap: '16px',
    flexWrap: 'wrap',
  },
  headerActions: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
  },
  newConvBtn: {
    backgroundColor: 'transparent',
    border: '1px solid var(--color-accent)',
    color: 'var(--color-accent)',
    borderRadius: '8px',
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    outline: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
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
  viewingBanner: {
    fontSize: '11px',
    color: 'var(--color-warning)',
    marginBottom: '8px',
    fontWeight: '600',
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
  chatContainer: {
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    height: '600px',
    justifyContent: 'space-between',
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
  goalProposalBox: {
    marginTop: '12px',
    borderTop: '1px solid var(--border-divider)',
    paddingTop: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    backgroundColor: 'rgba(0,0,0,0.1)',
    borderRadius: '8px',
    padding: '12px',
  },
  proposalHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    color: 'var(--color-warning)',
  },
  proposalTitle: {
    fontSize: '14px',
    fontWeight: '700',
    color: 'var(--color-text-main)',
    margin: 0,
  },
  proposalDesc: {
    fontSize: '12px',
    color: 'var(--color-text-muted)',
    margin: 0,
  },
  proposalPriority: {
    fontSize: '11px',
    fontWeight: '600',
    color: 'var(--color-accent)',
    backgroundColor: 'rgba(99, 102, 241, 0.12)',
    padding: '3px 8px',
    borderRadius: '4px',
    alignSelf: 'flex-start',
  },
  proposalSubProjects: {
    fontSize: '11px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    margin: '4px 0',
  },
  proposalTask: {
    color: 'var(--color-text-main)',
  },
  proposalSkillsSection: {
    fontSize: '11px',
    marginTop: '6px',
    display: 'flex',
    flexDirection: 'column',
  },
  proposalSkillTag: {
    fontSize: '9px',
    backgroundColor: 'rgba(99,102,241,0.15)',
    color: 'var(--color-accent)',
    padding: '2px 6px',
    borderRadius: '4px',
    fontWeight: '700',
  },
  addGoalBtn: {
    backgroundColor: 'var(--color-accent)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    padding: '8px 12px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    marginTop: '6px',
    alignSelf: 'flex-start',
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
    outline: 'none',
    transition: 'all 0.2s',
    ':hover': {
      color: 'var(--color-text-main)',
      borderColor: 'var(--color-accent)',
    }
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
  }
};
