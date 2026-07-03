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

    if (state.isSimulating) {
      // Simulated response delay
      setTimeout(() => {
        let reply = "";
        let suggestion = null;

        const lowerText = textToSend.toLowerCase();
        if (lowerText.includes("ai") || lowerText.includes("agentic")) {
          reply = "AI engineering roles are growing at 45% YoY. The most in-demand skill right now is building robust agents using Directed Acyclic Graphs (DAG) and the Model Context Protocol (MCP). I recommend starting with the project below:";
          suggestion = {
            title: "Master DAG Orchestration & MCP",
            description: "Learn Google ADK agent modeling and tool callbacks.",
            sub_projects: [
              { title: "Define a 3-node workflow edge mapping", completed: false },
              { title: "Build a stdio transport server client", completed: false },
              { title: "Implement Zero-Trust signature checks", completed: false }
            ]
          };
        } else if (lowerText.includes("mlops") || lowerText.includes("cloud")) {
          reply = "MLOps and cloud pipeline automation are essential for shipping models. Recruiters prioritize candidates with hands-on Kubernetes deployment and Terraform orchestration portfolios. Let's add this goal:";
          suggestion = {
            title: "Automate ML Deployment with Cloud GKE",
            description: "Deploy models on GKE and configure automated CI/CD logs.",
            sub_projects: [
              { title: "Draft a Dockerfile for model endpoint", completed: false },
              { title: "Configure Kubernetes staging manifest", completed: false },
              { title: "Setup GitHub Actions trigger on push", completed: false }
            ]
          };
        } else {
          reply = `That is a great direction! To develop skills in that area, it's best to work on a concrete, structured portfolio project. Based on market mapping, I've created the following development block:`;
          suggestion = {
            title: `Master ${textToSend} Fundamentals`,
            description: `Hands-on projects and milestones to develop competencies in ${textToSend}.`,
            sub_projects: [
              { title: "Research core syntax and references", completed: false },
              { title: "Create a simple CLI prototype application", completed: false },
              { title: "Deploy demo to cloud staging server", completed: false }
            ]
          };
        }

        setState({
          builderMessages: [
            ...updatedMsgs,
            {
              role: 'model',
              text: reply,
              suggestedGoal: suggestion
            }
          ]
        });
        setIsTyping(false);
      }, 1200);
    } else {
      // Live mode connecting to FastAPI ADK App
      try {
        const response = await fetch('/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: 'test_user_123',
            session_id: 'active_session_123',
            new_message: {
              role: 'user',
              parts: [{ text: textToSend }]
            }
          })
        });

        if (response.ok) {
          const data = await response.json();
          // Extract text response from runner output stream
          const parts = data.content?.parts || [];
          const textReply = parts.map(p => p.text || '').join('\n') || 
                            "I've updated your upskilling goal preferences. Let's review them in the Schedule or Skills tabs.";
          
          setState({
            builderMessages: [
              ...updatedMsgs,
              { role: 'model', text: textReply }
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
            { role: 'model', text: `Failed to connect with the live agent. (Error: ${err.message}). Toggle Sim Mode to test the conversation mock!` }
          ]
        });
      } finally {
        setIsTyping(false);
      }
    }
  };

  const handleAddSuggestedGoal = async (goal) => {
    if (state.isSimulating) {
      const mockId = `goal-${Math.random().toString(36).substring(2, 8)}`;
      const newGoal = {
        ...goal,
        id: mockId,
        time_spent_mins: 0,
        conversations: []
      };
      
      // Auto-schedule proposed events in simulation calendar
      const proposedEvents = [
        ...state.proposedEvents,
        {
          id: `evt-${Math.random().toString(36).substring(2, 6)}`,
          summary: `Learning: ${goal.title}`,
          start: "2026-07-06T10:00:00-04:00",
          end: "2026-07-06T11:00:00-04:00",
          description: goal.description
        }
      ];

      setState({
        goals: [...state.goals, newGoal],
        proposedEvents,
        activeTab: 'skills',
        activeGoalId: mockId
      });
      alert(`"${goal.title}" has been added to your goals and staged on your calendar!`);
    } else {
      try {
        const res = await fetch('/api/goals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(goal)
        });
        if (res.ok) {
          const data = await res.json();
          setState({ goals: data.goals, activeTab: 'skills', activeGoalId: data.goals[data.goals.length - 1]?.id });
          
          // Trigger schedule staging on backend
          await fetch('/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
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
                          <span>▫️</span> {t.title}
                        </div>
                      ))}
                    </div>

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
