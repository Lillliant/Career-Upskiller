import React, { useState, useRef, useEffect } from 'react';
import { useAppState } from '../stateManager';
import { stageWeeklySchedule } from '../scheduleApi';

// Safe Markdown-to-React Renderer for agent responses
function MarkdownRenderer({ text }) {
  if (!text) return null;

  const lines = text.split('\n');
  const elements = [];
  let currentList = [];
  let currentParagraph = [];
  let currentCodeBlock = null;
  let blockKey = 0;

  const flushList = () => {
    if (currentList.length > 0) {
      elements.push(
        <ul key={`list-${blockKey++}`} style={{ margin: '8px 0', paddingLeft: '20px', listStyleType: 'disc' }}>
          {currentList.map((item, idx) => (
            <li key={idx} style={{ marginBottom: '4px', fontSize: '13px', lineHeight: '1.4', color: 'var(--color-text-main)' }}>
              {renderInline(item)}
            </li>
          ))}
        </ul>
      );
      currentList = [];
    }
  };

  const flushParagraph = () => {
    if (currentParagraph.length > 0) {
      elements.push(
        <p key={`p-${blockKey++}`} style={{ margin: '8px 0', lineHeight: '1.4', fontSize: '13px', color: 'var(--color-text-main)' }}>
          {currentParagraph.map((line, idx) => (
            <React.Fragment key={idx}>
              {renderInline(line)}
              {idx < currentParagraph.length - 1 && <br />}
            </React.Fragment>
          ))}
        </p>
      );
      currentParagraph = [];
    }
  };

  const flushCodeBlock = () => {
    if (currentCodeBlock !== null) {
      elements.push(
        <pre 
          key={`code-${blockKey++}`} 
          style={{ 
            fontFamily: 'monospace',
            backgroundColor: 'rgba(0, 0, 0, 0.25)',
            border: '1px solid var(--border-card)',
            borderRadius: '6px',
            padding: '10px',
            fontSize: '12px',
            overflowX: 'auto',
            margin: '8px 0',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            color: 'var(--color-text-main)'
          }}
        >
          {currentCodeBlock.join('\n')}
        </pre>
      );
      currentCodeBlock = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Check for code blocks
    if (line.trim().startsWith('```')) {
      if (currentCodeBlock !== null) {
        flushCodeBlock();
      } else {
        flushList();
        flushParagraph();
        currentCodeBlock = [];
      }
      continue;
    }

    if (currentCodeBlock !== null) {
      currentCodeBlock.push(line);
      continue;
    }

    const trimmed = line.trim();

    if (trimmed === '') {
      flushList();
      flushParagraph();
      continue;
    }

    // Headers
    if (trimmed.startsWith('#')) {
      flushList();
      flushParagraph();
      const match = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (match) {
        const level = match[1].length;
        const headerText = match[2];
        const HeadingTag = `h${level}`;
        elements.push(
          <HeadingTag key={`h-${blockKey++}`} style={headingStyles[level]}>
            {renderInline(headerText)}
          </HeadingTag>
        );
      } else {
        currentParagraph.push(line);
      }
      continue;
    }

    // Unordered list items
    const listMatch = line.match(/^\s*[-*]\s+(.*)$/);
    if (listMatch) {
      flushParagraph();
      currentList.push(listMatch[1]);
      continue;
    }

    // Ordered list items
    const oListMatch = line.match(/^\s*(\d+)\.\s+(.*)$/);
    if (oListMatch) {
      flushList();
      flushParagraph();
      elements.push(
        <div key={`ol-${blockKey++}`} style={{ display: 'flex', gap: '6px', fontSize: '13px', margin: '6px 0', paddingLeft: '12px', lineHeight: '1.4', color: 'var(--color-text-main)' }}>
          <span style={{ fontWeight: '600' }}>{oListMatch[1]}.</span>
          <span>{renderInline(oListMatch[2])}</span>
        </div>
      );
      continue;
    }

    // Text line
    flushList();
    currentParagraph.push(line);
  }

  flushList();
  flushParagraph();
  flushCodeBlock();

  return <div className="markdown-content">{elements}</div>;
}

// A helper to parse inline styles like bold, italic, and code blocks
function renderInline(text) {
  const regex = /(\*\*|__|\*|_|`)/g;
  const parts = text.split(regex);
  
  if (parts.length === 1) return text;
  
  const result = [];
  const stack = [];
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    
    if (part === '**' || part === '__') {
      if (stack.length > 0 && stack[stack.length - 1] === 'bold') {
        stack.pop();
      } else {
        stack.push('bold');
      }
    } else if (part === '*' || part === '_') {
      if (stack.length > 0 && stack[stack.length - 1] === 'italic') {
        stack.pop();
      } else {
        stack.push('italic');
      }
    } else if (part === '`') {
      if (stack.length > 0 && stack[stack.length - 1] === 'code') {
        stack.pop();
      } else {
        stack.push('code');
      }
    } else {
      let element = part;
      for (let j = stack.length - 1; j >= 0; j--) {
        const style = stack[j];
        if (style === 'bold') {
          element = <strong key={`b-${i}`}>{element}</strong>;
        } else if (style === 'italic') {
          element = <em key={`i-${i}`}>{element}</em>;
        } else if (style === 'code') {
          element = <code key={`c-${i}`} style={codeStyle}>{element}</code>;
        }
      }
      result.push(element);
    }
  }
  
  return result;
}

const headingStyles = {
  1: { fontSize: '20px', fontWeight: 'bold', margin: '14px 0 8px 0', color: 'var(--color-text-main)' },
  2: { fontSize: '18px', fontWeight: 'bold', margin: '12px 0 6px 0', color: 'var(--color-text-main)' },
  3: { fontSize: '16px', fontWeight: 'bold', margin: '10px 0 6px 0', color: 'var(--color-text-main)' },
  4: { fontSize: '14px', fontWeight: 'bold', margin: '8px 0 4px 0', color: 'var(--color-text-main)' },
  5: { fontSize: '13px', fontWeight: 'bold', margin: '6px 0 4px 0', color: 'var(--color-text-main)' },
  6: { fontSize: '12px', fontWeight: 'bold', margin: '6px 0 4px 0', color: 'var(--color-text-main)' },
};

const codeStyle = {
  fontFamily: 'monospace',
  backgroundColor: 'rgba(255, 255, 255, 0.1)',
  padding: '2px 4px',
  borderRadius: '3px',
  fontSize: '90%',
  border: '1px solid var(--border-card)',
  color: 'var(--color-text-main)',
};

export default function GoalBuilderChat() {
  const [state, setState] = useAppState();
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const threadEndRef = useRef(null);

  const handleNewConversation = () => {
    if (window.confirm("Are you sure you want to start a new conversation? This will clear current chat messages.")) {
      setState({
        builderMessages: [
          { role: 'model', text: "Hello! I am your Skill Concierge assistant. Let's discuss your career aspirations and design high-impact learning goals and weekly projects to get you there." }
        ]
      });
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
        <button
          onClick={handleNewConversation}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          style={{
            ...styles.newConvBtn,
            backgroundColor: isHovered ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
          }}
        >
          🔄 New Conversation
        </button>
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
  headerContainer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
    width: '100%',
    gap: '16px',
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
