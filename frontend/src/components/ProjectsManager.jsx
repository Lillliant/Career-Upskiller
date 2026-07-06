import React, { useState, useEffect } from 'react';
import { useAppState } from '../stateManager';

export default function ProjectsManager() {
  const [state, setState] = useAppState();
  
  // Sort states
  const [sortBy, setSortBy] = useState('status'); // 'duedate', 'skills', 'status'
  
  // Create Goal form states
  const [newGoalTitle, setNewGoalTitle] = useState('');
  const [newGoalDesc, setNewGoalDesc] = useState('');
  
  // Milestone task form states
  const [newTaskText, setNewTaskText] = useState('');
  const [newTaskDueDate, setNewTaskDueDate] = useState('');
  
  // Reflection check-in form states
  const [reflectionText, setReflectionText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Skill Editor states
  const [newSkillName, setNewSkillName] = useState('');
  const [newSkillCategory, setNewSkillCategory] = useState('');
  const [newSkillCareer, setNewSkillCareer] = useState('');

  // Sync goals on mount
  useEffect(() => {
    const loadGoals = async () => {
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

  // Sorting logic helper
  const getSortedGoals = () => {
    const goalsCopy = [...state.goals];
    
    if (sortBy === 'status') {
      const order = { 'in-progress': 0, 'to-do': 1, 'done': 2, 'archived': 3 };
      return goalsCopy.sort((a, b) => (order[a.status] ?? 4) - (order[b.status] ?? 4));
    }
    
    if (sortBy === 'duedate') {
      // Sort by earliest uncompleted milestone due date
      const getEarliestDueDate = (goal) => {
        const dates = (goal.sub_projects || [])
          .filter(t => !t.completed && t.dueDate)
          .map(t => new Date(t.dueDate).getTime());
        return dates.length > 0 ? Math.min(...dates) : Infinity;
      };
      return goalsCopy.sort((a, b) => getEarliestDueDate(a) - getEarliestDueDate(b));
    }

    if (sortBy === 'skills') {
      // Sort by number of skills associated
      return goalsCopy.sort((a, b) => (b.skills || []).length - (a.skills || []).length);
    }

    return goalsCopy;
  };

  const sortedGoals = getSortedGoals();

  const handleCreateGoal = async (e) => {
    e.preventDefault();
    if (!newGoalTitle.trim()) return;

    const goalData = {
      title: newGoalTitle,
      description: newGoalDesc,
      status: 'to-do',
      sub_projects: [],
      skills: [],
      conversations: []
    };

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
        if (newGoal) setState({ activeGoalId: newGoal.id });
      }
    } catch (err) {
      console.error("Failed to create goal:", err);
    }
    setNewGoalTitle('');
    setNewGoalDesc('');
  };

  const handleUpdateStatus = async (goalId, newStatus) => {
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
  };

  const handleAddTask = async (e) => {
    e.preventDefault();
    if (!newTaskText.trim() || !activeGoal) return;

    const defaultDueDate = newTaskDueDate || new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const newTask = { title: newTaskText, completed: false, dueDate: defaultDueDate };
    const updatedTasks = [...(activeGoal.sub_projects || []), newTask];

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
    setNewTaskText('');
    setNewTaskDueDate('');
  };

  const handleToggleTask = async (index) => {
    if (!activeGoal) return;
    const updatedTasks = activeGoal.sub_projects.map((t, idx) => 
      idx === index ? { ...t, completed: !t.completed } : t
    );

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
  };

  // Add skill mapping to project
  const handleAddSkill = async (e) => {
    e.preventDefault();
    if (!newSkillName.trim() || !activeGoal) return;

    const newSkill = {
      name: newSkillName,
      category: newSkillCategory || 'Development',
      career_application: newSkillCareer || 'Software Engineer'
    };

    const updatedSkills = [...(activeGoal.skills || []), newSkill];

    try {
      const res = await fetch(`/api/goals/${activeGoal.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skills: updatedSkills })
      });
      if (res.ok) {
        const data = await res.json();
        setState({ goals: data.goals });
      }
    } catch (err) {
      console.error("Failed to add skill:", err);
    }

    setNewSkillName('');
    setNewSkillCategory('');
    setNewSkillCareer('');
  };

  // Remove skill mapping from project
  const handleRemoveSkill = async (index) => {
    if (!activeGoal) return;
    const updatedSkills = (activeGoal.skills || []).filter((_, idx) => idx !== index);

    try {
      const res = await fetch(`/api/goals/${activeGoal.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skills: updatedSkills })
      });
      if (res.ok) {
        const data = await res.json();
        setState({ goals: data.goals });
      }
    } catch (err) {
      console.error("Failed to remove skill:", err);
    }
  };

  const handleSubmitReflection = async (e) => {
    e.preventDefault();
    if (!reflectionText.trim() || !activeGoal) return;
    setIsSubmitting(true);

    try {
      const res = await fetch(`/api/goals/${activeGoal.id}/reflect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reflection_text: reflectionText
        })
      });
      if (res.ok) {
        const data = await res.json();
        setState({ goals: data.goals });
      }
    } catch (err) {
      console.error("Failed to post reflection:", err);
    }

    setReflectionText('');
    setIsSubmitting(false);
  };

  return (
    <div style={styles.container} className="animate-fade-in">
      {/* Sidebar: Goals List & Creation */}
      <div style={styles.sidebar}>
        {/* Create Goal Form */}
        <div style={styles.createBox} className="glass-card">
          <h3 style={styles.sectionTitle}>Add New Goal 🎯</h3>
          <form onSubmit={handleCreateGoal} style={styles.form}>
            <input 
              type="text" 
              value={newGoalTitle} 
              onChange={(e) => setNewGoalTitle(e.target.value)} 
              placeholder="Goal Title (e.g. Master LangChain)"
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

        {/* Goals List Header with Sorting */}
        <div style={styles.goalsListHeader}>
          <span style={styles.listTitle}>Project List</span>
          <div style={styles.sortContainer}>
            <label style={styles.sortLabel}>Sort by:</label>
            <select 
              value={sortBy} 
              onChange={(e) => setSortBy(e.target.value)}
              style={styles.sortSelect}
            >
              <option value="status">Status</option>
              <option value="duedate">Due Date</option>
              <option value="skills">Skills count</option>
            </select>
          </div>
        </div>

        {/* Goals Cards Stack */}
        <div style={styles.goalsBox}>
          {sortedGoals.length === 0 ? (
            <div style={styles.emptyText}>No goals created yet. Create above to get started.</div>
          ) : (
            sortedGoals.map((g) => (
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
                  <span>⚙️ {(g.skills || []).length} skills mapped</span>
                  <span>⏱️ {g.time_spent_mins || 0}m logged</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main Details Panel */}
      <div style={styles.detailPanel}>
        {activeGoal ? (
          <div style={styles.detailCard} className="glass-card">
            {/* Header: Title & status select */}
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

            {/* Checklist section */}
            <div style={styles.detailSection}>
              <h3 style={styles.subTitle}>📋 Milestones & Checklists</h3>
              <div style={styles.checklist}>
                {activeGoal.sub_projects && activeGoal.sub_projects.map((task, idx) => (
                  <div key={idx} style={styles.checkRow} onClick={() => handleToggleTask(idx)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
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
                    {task.dueDate && (
                      <span style={{
                        ...styles.dueDateBadge,
                        backgroundColor: task.completed ? 'rgba(255,255,255,0.03)' : 'rgba(239, 68, 68, 0.08)',
                        color: task.completed ? 'var(--color-text-muted)' : '#f87171'
                      }}>
                        📅 Due: {task.dueDate}
                      </span>
                    )}
                  </div>
                ))}

                {/* Add Milestone Form */}
                <form onSubmit={handleAddTask} style={styles.taskForm}>
                  <input 
                    type="text" 
                    value={newTaskText} 
                    onChange={(e) => setNewTaskText(e.target.value)} 
                    placeholder="Add a new milestone/task..."
                    style={styles.textInputSmall}
                    required
                  />
                  <input 
                    type="date"
                    value={newTaskDueDate}
                    onChange={(e) => setNewTaskDueDate(e.target.value)}
                    style={styles.dateInput}
                  />
                  <button type="submit" style={styles.addTaskBtn}>Add</button>
                </form>
              </div>
            </div>

            {/* Skills mappings editor */}
            <div style={styles.detailSection}>
              <h3 style={styles.subTitle}>⚙️ Associated Skills Mappings</h3>
              <p style={styles.captionText}>Map out specific skills gained from this project, which will feed into your Skills Portfolio once completed.</p>
              
              <div style={styles.skillsEditorGrid}>
                {activeGoal.skills && activeGoal.skills.map((skill, sIdx) => (
                  <div key={sIdx} style={styles.editorSkillTag}>
                    <div>
                      <strong>{skill.name}</strong> 
                      <span style={styles.tagCategory}>({skill.category})</span>
                      <div style={styles.tagCareer}>Applied career: {skill.career_application}</div>
                    </div>
                    <button 
                      onClick={() => handleRemoveSkill(sIdx)}
                      style={styles.deleteTagBtn}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>

              {/* Add Skill Form */}
              <form onSubmit={handleAddSkill} style={styles.addSkillInlineForm}>
                <input 
                  type="text" 
                  value={newSkillName} 
                  onChange={(e) => setNewSkillName(e.target.value)} 
                  placeholder="Skill Name (e.g. LLM Fine-Tuning)"
                  style={styles.textInputSmall}
                  required
                />
                <input 
                  type="text" 
                  value={newSkillCategory} 
                  onChange={(e) => setNewSkillCategory(e.target.value)} 
                  placeholder="Category (e.g. AI Engineering)"
                  style={styles.textInputSmall}
                />
                <input 
                  type="text" 
                  value={newSkillCareer} 
                  onChange={(e) => setNewSkillCareer(e.target.value)} 
                  placeholder="Career target (e.g. AI Architect)"
                  style={styles.textInputSmall}
                />
                <button type="submit" style={styles.addTaskBtn}>Add Skill</button>
              </form>
            </div>

            {/* Reflection Submit Form */}
            <div style={styles.detailSection}>
              <h3 style={styles.subTitle}>✍️ Log Learning Check-in & Reflections</h3>
              <p style={styles.captionText}>Log check-ins to let the concierge adjust milestone pacing and shift remaining due dates.</p>
              
              <form onSubmit={handleSubmitReflection} style={styles.reflectForm}>


                <div style={styles.formGroup}>
                  <label style={styles.label}>Reflection Details / Work Log:</label>
                  <textarea
                    value={reflectionText}
                    onChange={(e) => setReflectionText(e.target.value)}
                    placeholder="Describe what you did, any bottlenecks, or if you need timeline buffers."
                    style={styles.textareaInput}
                    rows="3"
                    required
                  />
                </div>

                <button type="submit" style={styles.submitReflectBtn} disabled={isSubmitting}>
                  {isSubmitting ? 'Submitting...' : 'Upload Work Log & Recalibrate Milestones'}
                </button>
              </form>
            </div>

            {/* Reflections Chat history */}
            {activeGoal.conversations && activeGoal.conversations.length > 0 && (
              <div style={styles.detailSection}>
                <h3 style={styles.subTitle}>💬 Timeline Recalibration Conversations</h3>
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
            <span>🎯 Select a project from the left side panel to review milestones, map skills, and submit reflections.</span>
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
    gap: '16px',
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
  goalsListHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '4px 8px',
  },
  listTitle: {
    fontSize: '12px',
    fontWeight: '700',
    color: 'var(--color-text-muted)',
    textTransform: 'uppercase',
  },
  sortContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  sortLabel: {
    fontSize: '11px',
    color: 'var(--color-text-muted)',
  },
  sortSelect: {
    backgroundColor: 'var(--bg-sidebar)',
    border: '1px solid var(--input-border)',
    color: 'var(--color-text-muted)',
    borderRadius: '4px',
    padding: '2px 4px',
    fontSize: '10px',
    outline: 'none',
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
    justifyContent: 'space-between',
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
  dueDateBadge: {
    fontSize: '10px',
    padding: '2px 8px',
    borderRadius: '4px',
    fontWeight: '600',
  },
  taskForm: {
    display: 'flex',
    gap: '8px',
    marginTop: '12px',
    flexWrap: 'wrap',
  },
  dateInput: {
    backgroundColor: 'var(--bg-main)',
    border: '1px solid var(--input-border)',
    color: 'var(--color-text-main)',
    borderRadius: '6px',
    padding: '6px 10px',
    fontSize: '12px',
    outline: 'none',
  },
  textInputSmall: {
    flex: 1,
    minWidth: '150px',
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
  skillsEditorGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '10px',
    marginBottom: '16px',
  },
  editorSkillTag: {
    backgroundColor: 'var(--bg-sidebar)',
    border: '1px solid var(--border-card)',
    borderRadius: '8px',
    padding: '10px 12px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    minWidth: '180px',
  },
  tagCategory: {
    fontSize: '10px',
    color: 'var(--color-accent)',
    marginLeft: '6px',
    fontWeight: '700',
  },
  tagCareer: {
    fontSize: '10px',
    color: 'var(--color-text-muted)',
    marginTop: '4px',
  },
  deleteTagBtn: {
    background: 'none',
    border: 'none',
    color: '#fb7185',
    fontSize: '16px',
    cursor: 'pointer',
    fontWeight: '700',
  },
  addSkillInlineForm: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    backgroundColor: 'rgba(0,0,0,0.1)',
    padding: '12px',
    borderRadius: '8px',
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
