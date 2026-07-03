import React, { useState, useEffect } from 'react';
import { useAppState } from '../stateManager';

export default function SkillsManager() {
  const [state, setState] = useAppState();
  const [newGoalTitle, setNewGoalTitle] = useState('');
  const [newGoalDesc, setNewGoalDesc] = useState('');
  
  // Detail page states
  const [newTaskText, setNewTaskText] = useState('');
  const [reflectionText, setReflectionText] = useState('');
  const [rating, setRating] = useState(3);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sync goals on mount if live mode
  useEffect(() => {
    const loadGoals = async () => {
      if (state.isSimulating) return;
      try {
        const res = await fetch('/api/goals');
        if (res.ok) {
          const goals = await res.json();
          setState({ goals });
        }
      } catch (err) {
        console.error("Failed to load goals:", err);
      }
    };
    loadGoals();
  }, [state.onboarded]);

  const activeGoal = state.goals.find(g => g.id === state.activeGoalId) || state.goals[0];

  const handleCreateGoal = async (e) => {
    e.preventDefault();
    if (!newGoalTitle.trim()) return;

    const goalData = {
      title: newGoalTitle,
      description: newGoalDesc,
      status: 'to-do',
      sub_projects: []
    };

    if (state.isSimulating) {
      const mockId = `goal-${Math.random().toString(36).substring(2, 8)}`;
      const updatedGoals = [...state.goals, { ...goalData, id: mockId, time_spent_mins: 0, conversations: [] }];
      setState({ goals: updatedGoals, activeGoalId: mockId });
    } else {
      try {
        const res = await fetch('/api/goals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(goalData)
        });
        if (res.ok) {
          const data = await res.json();
          setState({ goals: data.goals });
          const newGoal = data.goals[data.goals.length - 1];
          if (newGoal) {
            setState({ activeGoalId: newGoal.id });
          }
        }
      } catch (err) {
        console.error("Failed to create goal:", err);
      }
    }
    setNewGoalTitle('');
    setNewGoalDesc('');
  };

  const handleUpdateStatus = async (goalId, newStatus) => {
    if (state.isSimulating) {
      const updated = state.goals.map(g => g.id === goalId ? { ...g, status: newStatus } : g);
      setState({ goals: updated });
    } else {
      try {
        const res = await fetch(`/api/goals/${goalId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus })
        });
        if (res.ok) {
          const data = await res.json();
          setState({ goals: data.goals });
        }
      } catch (err) {
        console.error("Failed to update status:", err);
      }
    }
  };

  const handleAddTask = async (e) => {
    e.preventDefault();
    if (!newTaskText.trim() || !activeGoal) return;

    const newTask = { title: newTaskText, completed: false };
    const updatedTasks = [...(activeGoal.sub_projects || []), newTask];

    if (state.isSimulating) {
      const updated = state.goals.map(g => g.id === activeGoal.id ? { ...g, sub_projects: updatedTasks } : g);
      setState({ goals: updated });
    } else {
      try {
        const res = await fetch(`/api/goals/${activeGoal.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sub_projects: updatedTasks })
        });
        if (res.ok) {
          const data = await res.json();
          setState({ goals: data.goals });
        }
      } catch (err) {
        console.error("Failed to add task:", err);
      }
    }
    setNewTaskText('');
  };

  const handleToggleTask = async (index) => {
    if (!activeGoal) return;
    const updatedTasks = activeGoal.sub_projects.map((t, idx) => 
      idx === index ? { ...t, completed: !t.completed } : t
    );

    if (state.isSimulating) {
      const updated = state.goals.map(g => g.id === activeGoal.id ? { ...g, sub_projects: updatedTasks } : g);
      setState({ goals: updated });
    } else {
      try {
        const res = await fetch(`/api/goals/${activeGoal.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sub_projects: updatedTasks })
        });
        if (res.ok) {
          const data = await res.json();
          setState({ goals: data.goals });
        }
      } catch (err) {
        console.error("Failed to toggle task:", err);
      }
    }
  };

  const handleSubmitReflection = async (e) => {
    e.preventDefault();
    if (!reflectionText.trim() || !activeGoal) return;
    setIsSubmitting(true);

    if (state.isSimulating) {
      // Simulation mode: mock agent reflection output
      const timestamp = new Date().toISOString();
      const userMsg = {
        role: 'user',
        text: reflectionText,
        rating: rating,
        timestamp
      };

      let agentFeedback = '';
      let bufferAdjust = 0;
      if (rating <= 2) {
        agentFeedback = "I see you found this project challenging. I've added a 1-week timeline buffer to your goals and set your preference to Beginner difficulty to give you more breathing room.";
        bufferAdjust = 1;
      } else if (rating >= 4) {
        agentFeedback = "Awesome job! You demonstrated great competence. I've increased the pacing complexity for your upcoming schedule to match your skill level.";
      } else {
        agentFeedback = "Glad to see you are on track! No adjustments are needed; keep up the consistent work.";
      }

      const agentMsg = {
        role: 'model',
        text: agentFeedback,
        timestamp
      };

      const updated = state.goals.map(g => {
        if (g.id === activeGoal.id) {
          const convs = g.conversations || [];
          return {
            ...g,
            time_spent_mins: g.time_spent_mins + 30,
            conversations: [...convs, userMsg, agentMsg]
          };
        }
        return g;
      });

      setState({ 
        goals: updated,
        logs: [
          ...state.logs,
          {
            timestamp,
            action: 'Mock Reflection Logged & Goal Adjusted',
            payload: { rating, reflectionText, bufferAdded: bufferAdjust }
          }
        ]
      });
    } else {
      // Live Mode: POST to fastapi reflect route
      try {
        const res = await fetch(`/api/goals/${activeGoal.id}/reflect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reflection_text: reflectionText,
            success_rating: rating
          })
        });
        if (res.ok) {
          const data = await res.json();
          setState({ goals: data.goals });
        }
      } catch (err) {
        console.error("Failed to post reflection:", err);
      }
    }

    setReflectionText('');
    setIsSubmitting(false);
  };

  return (
    <div style={styles.container} className="animate-fade-in">
      <div style={styles.sidebar}>
        {/* Create Goal Form */}
        <div style={styles.createBox} className="glass-card">
          <h3 style={styles.sectionTitle}>Add New Goal 🎯</h3>
          <form onSubmit={handleCreateGoal} style={styles.form}>
            <input 
              type="text" 
              value={newGoalTitle} 
              onChange={(e) => setNewGoalTitle(e.target.value)} 
              placeholder="Goal Title (e.g. Learn MLOps)"
              style={styles.textInput}
              required
            />
            <input 
              type="text" 
              value={newGoalDesc} 
              onChange={(e) => setNewGoalDesc(e.target.value)} 
              placeholder="Description"
              style={styles.textInput}
            />
            <button type="submit" style={styles.submitBtn}>
              Create Goal
            </button>
          </form>
        </div>

        {/* Goals List */}
        <div style={styles.goalsBox}>
          {state.goals.length === 0 ? (
            <div style={styles.emptyText}>No goals created yet. Use settings onboarding or add above.</div>
          ) : (
            state.goals.map((g) => (
              <div 
                key={g.id} 
                onClick={() => setState({ activeGoalId: g.id })}
                style={{
                  ...styles.goalCard,
                  borderColor: state.activeGoalId === g.id || (!state.activeGoalId && activeGoal?.id === g.id)
                    ? 'var(--color-accent)' 
                    : 'var(--border-card)',
                  backgroundColor: state.activeGoalId === g.id || (!state.activeGoalId && activeGoal?.id === g.id)
                    ? 'rgba(99, 102, 241, 0.05)'
                    : 'var(--bg-card)'
                }}
              >
                <div style={styles.goalCardHeader}>
                  <h4 style={styles.goalTitle}>{g.title}</h4>
                  <span style={{
                    ...styles.statusBadge,
                    backgroundColor: g.status === 'done' ? 'rgba(16, 185, 129, 0.15)' : g.status === 'in-progress' ? 'rgba(99, 102, 241, 0.15)' : 'rgba(120, 120, 120, 0.15)',
                    color: g.status === 'done' ? 'var(--color-success)' : g.status === 'in-progress' ? 'var(--color-accent)' : 'var(--color-text-muted)'
                  }}>
                    {g.status}
                  </span>
                </div>
                <p style={styles.goalDesc}>{g.description}</p>
                <div style={styles.goalFooter}>
                  <span>⏱️ {g.time_spent_mins || 0} mins logged</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Goal Details & Reflection Panel */}
      <div style={styles.detailPanel}>
        {activeGoal ? (
          <div style={styles.detailCard} className="glass-card">
            <div style={styles.detailHeader}>
              <div>
                <h2 style={styles.detailTitle}>{activeGoal.title}</h2>
                <p style={styles.detailSubtitle}>{activeGoal.description}</p>
              </div>
              <div style={styles.statusSelectRow}>
                <label style={styles.smallLabel}>Status:</label>
                <select 
                  value={activeGoal.status} 
                  onChange={(e) => handleUpdateStatus(activeGoal.id, e.target.value)}
                  style={styles.selectInput}
                >
                  <option value="to-do">To Do</option>
                  <option value="in-progress">In Progress</option>
                  <option value="done">Completed</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
            </div>

            {/* Checklist */}
            <div style={styles.detailSection}>
              <h3 style={styles.subTitle}>📋 Sub-Projects & Milestones Checklist</h3>
              <div style={styles.checklist}>
                {activeGoal.sub_projects && activeGoal.sub_projects.map((task, idx) => (
                  <div key={idx} style={styles.checkRow} onClick={() => handleToggleTask(idx)}>
                    <input 
                      type="checkbox" 
                      checked={task.completed} 
                      onChange={() => {}} 
                      style={styles.checkbox}
                    />
                    <span style={{
                      ...styles.taskText,
                      textDecoration: task.completed ? 'line-through' : 'none',
                      color: task.completed ? 'var(--color-text-muted)' : 'var(--color-text-main)'
                    }}>
                      {task.title}
                    </span>
                  </div>
                ))}

                <form onSubmit={handleAddTask} style={styles.taskForm}>
                  <input 
                    type="text" 
                    value={newTaskText} 
                    onChange={(e) => setNewTaskText(e.target.value)} 
                    placeholder="Add a new milestone/task..."
                    style={styles.textInputSmall}
                    required
                  />
                  <button type="submit" style={styles.addTaskBtn}>Add</button>
                </form>
              </div>
            </div>

            {/* Reflection Submit Form */}
            <div style={styles.detailSection}>
              <h3 style={styles.subTitle}>✍️ Log Learning Check-in & Reflection</h3>
              <p style={styles.captionText}>Upload reflections to let the Concierge adjust goal pacing and timelines.</p>
              
              <form onSubmit={handleSubmitReflection} style={styles.reflectForm}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Pacing/Difficulty Success Rating: <strong>{rating}/5</strong></label>
                  <input 
                    type="range" 
                    min="1" 
                    max="5" 
                    value={rating} 
                    onChange={(e) => setRating(Number(e.target.value))} 
                    style={styles.rangeInput}
                  />
                  <div style={styles.rangeLabels}>
                    <span>1 (Struggled)</span>
                    <span>3 (Comfortable)</span>
                    <span>5 (Mastered)</span>
                  </div>
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Reflection Details / Work Log:</label>
                  <textarea
                    value={reflectionText}
                    onChange={(e) => setReflectionText(e.target.value)}
                    placeholder="Draft what you accomplished, what was difficult, or if you need to adjust schedule intervals."
                    style={styles.textareaInput}
                    rows="3"
                    required
                  />
                </div>

                <button type="submit" style={styles.submitReflectBtn} disabled={isSubmitting}>
                  {isSubmitting ? 'Submitting...' : 'Upload Work Log & Request timeline Adjustment'}
                </button>
              </form>
            </div>

            {/* Reflection Logs Conversation History */}
            {activeGoal.conversations && activeGoal.conversations.length > 0 && (
              <div style={styles.detailSection}>
                <h3 style={styles.subTitle}>💬 Timeline Adjustment Conversations</h3>
                <div style={styles.convLog}>
                  {activeGoal.conversations.map((msg, idx) => (
                    <div 
                      key={idx} 
                      style={{
                        ...styles.chatBubble,
                        alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                        backgroundColor: msg.role === 'user' ? 'rgba(99, 102, 241, 0.15)' : 'var(--bg-sidebar)',
                        borderColor: msg.role === 'user' ? 'var(--color-accent)' : 'var(--border-card)'
                      }}
                    >
                      <div style={styles.bubbleMeta}>
                        <strong>{msg.role === 'user' ? 'You' : 'Skill Concierge Agent'}</strong>
                        {msg.rating && <span style={styles.bubbleRating}>⭐ {msg.rating}/5</span>}
                      </div>
                      <p style={styles.bubbleText}>{msg.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={styles.emptyCard} className="glass-card">
            <span>🎯 Select an upskilling goal from the list to manage, toggle sub-projects, and log reflections.</span>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    gap: '24px',
    width: '100%',
    maxWidth: '1000px',
    margin: '0 auto',
    alignItems: 'flex-start',
  },
  sidebar: {
    width: '320px',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    flexShrink: 0,
  },
  createBox: {
    padding: '20px',
  },
  sectionTitle: {
    fontSize: '15px',
    color: 'var(--color-text-main)',
    marginBottom: '14px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  textInput: {
    width: '100%',
    backgroundColor: 'var(--bg-main)',
    border: '1px solid var(--input-border)',
    borderRadius: '6px',
    padding: '10px 12px',
    fontSize: '13px',
    color: 'var(--color-text-main)',
    outline: 'none',
  },
  submitBtn: {
    backgroundColor: 'var(--color-accent)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    padding: '10px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  goalsBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  goalCard: {
    borderRadius: '12px',
    border: '1px solid',
    padding: '16px',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  goalCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '8px',
    marginBottom: '8px',
  },
  goalTitle: {
    fontSize: '14px',
    fontWeight: '700',
    color: 'var(--color-text-main)',
    margin: 0,
  },
  statusBadge: {
    fontSize: '10px',
    fontWeight: '700',
    padding: '2px 8px',
    borderRadius: '12px',
    textTransform: 'uppercase',
  },
  goalDesc: {
    fontSize: '12px',
    color: 'var(--color-text-muted)',
    lineHeight: '1.4',
    margin: 0,
  },
  goalFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '11px',
    color: 'var(--color-text-muted)',
    marginTop: '12px',
    borderTop: '1px solid var(--border-divider)',
    paddingTop: '8px',
  },
  emptyText: {
    fontSize: '12px',
    color: 'var(--color-text-muted)',
    textAlign: 'center',
    padding: '20px',
  },
  detailPanel: {
    flex: 1,
  },
  detailCard: {
    padding: '24px',
  },
  detailHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottom: '1px solid var(--border-divider)',
    paddingBottom: '16px',
    marginBottom: '20px',
    flexWrap: 'wrap',
    gap: '12px',
  },
  detailTitle: {
    fontSize: '20px',
    color: 'var(--color-text-main)',
    margin: 0,
  },
  detailSubtitle: {
    fontSize: '13px',
    color: 'var(--color-text-muted)',
    margin: '4px 0 0 0',
  },
  statusSelectRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  selectInput: {
    backgroundColor: 'var(--bg-sidebar)',
    border: '1px solid var(--input-border)',
    color: 'var(--color-text-main)',
    padding: '6px 12px',
    borderRadius: '6px',
    fontSize: '12px',
    outline: 'none',
  },
  subTitle: {
    fontSize: '14px',
    color: 'var(--color-text-main)',
    marginBottom: '12px',
    fontWeight: '700',
  },
  detailSection: {
    marginBottom: '28px',
    borderBottom: '1px solid var(--border-divider)',
    paddingBottom: '20px',
  },
  checklist: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  checkRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    cursor: 'pointer',
    padding: '4px 0',
  },
  checkbox: {
    width: '16px',
    height: '16px',
    accentColor: 'var(--color-accent)',
    cursor: 'pointer',
  },
  taskText: {
    fontSize: '13px',
  },
  taskForm: {
    display: 'flex',
    gap: '8px',
    marginTop: '12px',
  },
  textInputSmall: {
    flex: 1,
    backgroundColor: 'var(--bg-main)',
    border: '1px solid var(--input-border)',
    borderRadius: '6px',
    padding: '8px 12px',
    fontSize: '12px',
    color: 'var(--color-text-main)',
    outline: 'none',
  },
  addTaskBtn: {
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    color: 'var(--color-accent)',
    border: '1px solid var(--border-card)',
    borderRadius: '6px',
    padding: '8px 16px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  captionText: {
    fontSize: '11px',
    color: 'var(--color-text-muted)',
    marginBottom: '16px',
  },
  reflectForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
  },
  label: {
    fontSize: '12px',
    color: 'var(--color-text-main)',
    marginBottom: '6px',
    fontWeight: '600',
  },
  smallLabel: {
    fontSize: '11px',
    color: 'var(--color-text-muted)',
  },
  rangeInput: {
    width: '100%',
    cursor: 'pointer',
    accentColor: 'var(--color-accent)',
  },
  rangeLabels: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '10px',
    color: 'var(--color-text-muted)',
    marginTop: '2px',
  },
  textareaInput: {
    width: '100%',
    backgroundColor: 'var(--bg-main)',
    border: '1px solid var(--input-border)',
    borderRadius: '8px',
    padding: '10px 12px',
    fontSize: '13px',
    color: 'var(--color-text-main)',
    outline: 'none',
    resize: 'vertical',
  },
  submitReflectBtn: {
    backgroundColor: 'var(--color-accent)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    padding: '12px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  convLog: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    maxHeight: '300px',
    overflowY: 'auto',
    padding: '10px',
  },
  chatBubble: {
    maxWidth: '80%',
    borderRadius: '12px',
    border: '1px solid',
    padding: '12px 16px',
  },
  bubbleMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '11px',
    color: 'var(--color-text-muted)',
    marginBottom: '4px',
  },
  bubbleRating: {
    color: 'var(--color-warning)',
    fontWeight: '600',
  },
  bubbleText: {
    fontSize: '12px',
    margin: 0,
    lineHeight: '1.4',
  },
  emptyCard: {
    padding: '40px',
    textAlign: 'center',
    color: 'var(--color-text-muted)',
    fontSize: '14px',
  }
};
