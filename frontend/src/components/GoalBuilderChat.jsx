import React, { useState, useRef, useEffect } from 'react';
import { useAppState } from '../stateManager';

export default function GoalBuilderChat() {
  const [state, setState] = useAppState();
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const threadEndRef = useRef(null);

  const suggestionChips = [
    "Recommend trending AI Engineering goals",
    "What projects should I do for MLOps?",
    "Suggest intermediate Cloud Architecture milestones",
    "How can I practice Agentic Security?"
  ];

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.builderMessages, isTyping]);

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
        setState({
          builderMessages: [
            ...updatedMsgs,
            { 
              role: 'model', 
              text: data.text,
              suggestedGoal: data.suggestedGoal || null
            }
          ]
        });
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
        setState({ goals: data.goals, activeTab: 'projects', activeGoalId: data.goals[data.goals.length - 1]?.id });
        
        // Trigger schedule staging on backend
        await fetch('/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            app_name: 'app',
            user_id: 'test_user_123',
            session_id: 'active_session_123',
            new_message: {
              role: 'user',
              parts: [{ text: "Re-stage schedule with new goals." }]
            }
          })
        });
      }
    } catch (err) {
      console.error("Failed to add live goal:", err);
    }
  };

  return (
    <div style={styles.chatPage} className="animate-fade-in">
      <div style={styles.header}>
        <h2 style={styles.pageTitle}>Conversational Goal Builder 💬</h2>
        <p style={styles.pageSubtitle}>Converse with the agent concierge to explore market insights and refine learning directions.</p>
      </div>

      <div style={styles.chatContainer} className="glass-card">
        {/* Messages Log Thread */}
        <div style={styles.messagesThread}>
          {state.builderMessages.map((msg, idx) => (
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
                <p style={styles.text}>{msg.text}</p>

                {/* Embedded Goal Proposal */}
                {msg.suggestedGoal && (
                  <div style={styles.goalProposalBox}>
                    <div style={styles.proposalHeader}>
                      <span style={{ fontSize: '16px' }}>🎯</span>
                      <strong>Suggested New Goal</strong>
                    </div>
                    <h4 style={styles.proposalTitle}>{msg.suggestedGoal.title}</h4>
                    <p style={styles.proposalDesc}>{msg.suggestedGoal.description}</p>
                    
                    <div style={styles.proposalSubProjects}>
                      <strong>Sub-Projects Checklist:</strong>
                      {msg.suggestedGoal.sub_projects.map((t, tIdx) => (
                        <div key={tIdx} style={styles.proposalTask}>
                          <span>▫️</span> {t.title} {t.dueDate && <span style={{ opacity: 0.6, fontSize: '9px' }}>(Due: {t.dueDate})</span>}
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

        {/* Suggestion Chips */}
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

        {/* Input Bar */}
        <form 
          onSubmit={(e) => { e.preventDefault(); handleSend(inputValue); }}
          style={styles.inputBar}
        >
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Type your career goal or upskilling interest (e.g. Master LangChain...)"
            style={styles.chatInput}
          />
          <button type="submit" style={styles.sendBtn} disabled={!inputValue.trim()}>
            Send
          </button>
        </form>
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
  header: {
    marginBottom: '20px',
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
  },
  sendBtn: {
    backgroundColor: 'var(--color-accent)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    padding: '0 20px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  typingDot: {
    display: 'inline-block',
    animation: 'blink 1.4s infinite both',
    fontSize: '18px',
    margin: '0 2px',
  }
};
