import React, { useState, useEffect } from 'react';
import { useAppState } from '../stateManager';

export default function ProjectsManager() {
  const [state, setState] = useAppState();
  
  // Sort states
  const [sortBy, setSortBy] = useState('status'); // 'duedate', 'skills', 'status'
  
  // Create Goal form states
  const [newGoalTitle, setNewGoalTitle] = useState('');
  const [newGoalDesc, setNewGoalDesc] = useState('');
  
  // Milestone task form states (for adding whole milestones)
  const [newTaskText, setNewTaskText] = useState('');
  const [newTaskDueDate, setNewTaskDueDate] = useState('');

  // Inline add task form states (keyed by milestone index)
  const [nestedTaskTitle, setNestedTaskTitle] = useState({});
  const [nestedTaskDesc, setNestedTaskDesc] = useState({});
  const [nestedTaskTime, setNestedTaskTime] = useState({});
  const [nestedTaskResource, setNestedTaskResource] = useState({});
  const [nestedTaskDueDate, setNestedTaskDueDate] = useState({});
  const [activeAddTaskId, setActiveAddTaskId] = useState(null);
  
  // Reflection check-in form states
  const [reflectionText, setReflectionText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Filter states
  const [filterStatus, setFilterStatus] = useState('All');

  // Skill Editor states
  const [newSkillName, setNewSkillName] = useState('');
  const [newSkillCategory, setNewSkillCategory] = useState('');

  // Goal Editing states
  const [isEditingGoal, setIsEditingGoal] = useState(false);
  const [editGoalTitle, setEditGoalTitle] = useState('');
  const [editGoalDesc, setEditGoalDesc] = useState('');

  // Milestone Editing states
  const [editingMilestoneIdx, setEditingMilestoneIdx] = useState(null);
  const [editMilestoneTitle, setEditMilestoneTitle] = useState('');
  const [editMilestoneDesc, setEditMilestoneDesc] = useState('');
  const [editMilestoneDueDate, setEditMilestoneDueDate] = useState('');

  // Task Editing states
  const [editingTaskKey, setEditingTaskKey] = useState(null); // "milestoneIdx-taskIdx"
  const [editTaskTitle, setEditTaskTitle] = useState('');
  const [editTaskDesc, setEditTaskDesc] = useState('');
  const [editTaskTime, setEditTaskTime] = useState('');
  const [editTaskResource, setEditTaskResource] = useState('');
  const [editTaskDueDate, setEditTaskDueDate] = useState('');

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

  // Filtering and Sorting logic helper
  const getSortedAndFilteredGoals = () => {
    let goalsCopy = [...state.goals];
    
    if (filterStatus !== 'All') {
      goalsCopy = goalsCopy.filter(g => g.status === filterStatus);
    }
    
    if (sortBy === 'status') {
      const order = { 'in-progress': 0, 'to-do': 1, 'done': 2, 'archived': 3 };
      return goalsCopy.sort((a, b) => (order[a.status] ?? 4) - (order[b.status] ?? 4));
    }
    
    if (sortBy === 'duedate') {
      // Sort by earliest uncompleted milestone due date
      const getEarliestDueDate = (goal) => {
        const dates = [];
        (goal.sub_projects || []).forEach(m => {
          if (!m.completed && m.dueDate) {
            dates.push(new Date(m.dueDate).getTime());
          }
          if (m.tasks) {
            m.tasks.forEach(t => {
              if (!t.completed && t.dueDate) {
                dates.push(new Date(t.dueDate).getTime());
              }
            });
          }
        });
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

  const sortedGoals = getSortedAndFilteredGoals();

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

        // Fetch updated profile with proposed events
        const profileRes = await fetch('/api/profile');
        if (profileRes.ok) {
          const profile = await profileRes.json();
          setState({
            proposedEvents: profile.proposed_events || [],
            scarcityFlag: profile.scarcity_flag || false,
            reason: profile.reason || '',
            transactionId: profile.transaction_id || '',
            token: profile.token || ''
          });
        }
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
    const newMilestone = { 
      title: newTaskText, 
      description: "Custom milestone",
      completed: false, 
      dueDate: defaultDueDate,
      tasks: []
    };
    const updatedTasks = [...(activeGoal.sub_projects || []), newMilestone];

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
      console.error("Failed to add milestone:", err);
    }
    setNewTaskText('');
    setNewTaskDueDate('');
  };

  const handleToggleTask = async (milestoneIdx, taskIdx = null) => {
    if (!activeGoal) return;
    
    let updatedSubProjects;
    if (taskIdx === null) {
      // Toggle milestone itself
      updatedSubProjects = activeGoal.sub_projects.map((m, mIdx) => {
        if (mIdx === milestoneIdx) {
          const nextCompleted = !m.completed;
          const updatedTasks = m.tasks ? m.tasks.map(t => ({ ...t, completed: nextCompleted })) : undefined;
          return { ...m, completed: nextCompleted, tasks: updatedTasks };
        }
        return m;
      });
    } else {
      // Toggle nested task
      updatedSubProjects = activeGoal.sub_projects.map((m, mIdx) => {
        if (mIdx === milestoneIdx) {
          const updatedTasks = m.tasks.map((t, tId) => 
            tId === taskIdx ? { ...t, completed: !t.completed } : t
          );
          const allCompleted = updatedTasks.every(t => t.completed);
          return { ...m, tasks: updatedTasks, completed: allCompleted };
        }
        return m;
      });
    }

    try {
      const res = await fetch(`/api/goals/${activeGoal.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sub_projects: updatedSubProjects })
      });
      if (res.ok) {
        const data = await res.json();
        setState({ goals: data.goals });
      }
    } catch (err) {
      console.error("Failed to toggle task:", err);
    }
  };

  const handleAddNestedTask = async (e, milestoneIdx) => {
    e.preventDefault();
    if (!activeGoal) return;
    
    const title = nestedTaskTitle[milestoneIdx]?.trim();
    if (!title) return;

    const desc = nestedTaskDesc[milestoneIdx]?.trim() || "Task Description";
    const time = nestedTaskTime[milestoneIdx]?.trim() || "2 hours";
    const resource = nestedTaskResource[milestoneIdx]?.trim() || "";
    const dueDate = nestedTaskDueDate[milestoneIdx] || new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const newTask = {
      title,
      description: desc,
      estimated_time: time,
      resource,
      dueDate,
      completed: false
    };

    const updatedSubProjects = activeGoal.sub_projects.map((m, mIdx) => {
      if (mIdx === milestoneIdx) {
        const tasks = [...(m.tasks || []), newTask];
        return { ...m, tasks };
      }
      return m;
    });

    try {
      const res = await fetch(`/api/goals/${activeGoal.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sub_projects: updatedSubProjects })
      });
      if (res.ok) {
        const data = await res.json();
        setState({ goals: data.goals });
      }
    } catch (err) {
      console.error("Failed to add nested task:", err);
    }

    // Reset inputs for this milestone
    setNestedTaskTitle(prev => ({ ...prev, [milestoneIdx]: '' }));
    setNestedTaskDesc(prev => ({ ...prev, [milestoneIdx]: '' }));
    setNestedTaskTime(prev => ({ ...prev, [milestoneIdx]: '' }));
    setNestedTaskResource(prev => ({ ...prev, [milestoneIdx]: '' }));
    setNestedTaskDueDate(prev => ({ ...prev, [milestoneIdx]: '' }));
    setActiveAddTaskId(null);
  };

  // Add skill mapping to project
  const handleAddSkill = async (e) => {
    e.preventDefault();
    if (!newSkillName.trim() || !activeGoal) return;

    const newSkill = {
      name: newSkillName,
      category: newSkillCategory || 'Development'
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

  const handleDeleteGoal = async (goalId) => {
    if (!window.confirm("Are you sure you want to delete this goal?")) return;
    try {
      const res = await fetch(`/api/goals/${goalId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        const data = await res.json();
        setState({ goals: data.goals });
        if (state.activeGoalId === goalId) {
          setState({ activeGoalId: data.goals[0]?.id || null });
        }
        setIsEditingGoal(false);
      }
    } catch (err) {
      console.error("Failed to delete goal:", err);
    }
  };

  const handleSaveGoal = async (goalId) => {
    if (!editGoalTitle.trim()) return;
    try {
      const res = await fetch(`/api/goals/${goalId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editGoalTitle,
          description: editGoalDesc
        })
      });
      if (res.ok) {
        const data = await res.json();
        setState({ goals: data.goals });
        setIsEditingGoal(false);
      }
    } catch (err) {
      console.error("Failed to update goal:", err);
    }
  };

  const handleDeleteMilestone = async (milestoneIdx) => {
    if (!activeGoal || !window.confirm("Are you sure you want to delete this milestone and its tasks?")) return;
    const updatedSubProjects = activeGoal.sub_projects.filter((_, idx) => idx !== milestoneIdx);
    try {
      const res = await fetch(`/api/goals/${activeGoal.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sub_projects: updatedSubProjects })
      });
      if (res.ok) {
        const data = await res.json();
        setState({ goals: data.goals });
      }
    } catch (err) {
      console.error("Failed to delete milestone:", err);
    }
  };

  const handleSaveMilestone = async (milestoneIdx) => {
    if (!activeGoal || !editMilestoneTitle.trim()) return;
    const updatedSubProjects = activeGoal.sub_projects.map((m, idx) => {
      if (idx === milestoneIdx) {
        return {
          ...m,
          title: editMilestoneTitle,
          description: editMilestoneDesc,
          dueDate: editMilestoneDueDate
        };
      }
      return m;
    });
    try {
      const res = await fetch(`/api/goals/${activeGoal.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sub_projects: updatedSubProjects })
      });
      if (res.ok) {
        const data = await res.json();
        setState({ goals: data.goals });
        setEditingMilestoneIdx(null);
      }
    } catch (err) {
      console.error("Failed to save milestone:", err);
    }
  };

  const handleDeleteTask = async (milestoneIdx, taskIdx) => {
    if (!activeGoal || !window.confirm("Are you sure you want to delete this task?")) return;
    const updatedSubProjects = activeGoal.sub_projects.map((m, idx) => {
      if (idx === milestoneIdx) {
        const tasks = m.tasks.filter((_, tIdx) => tIdx !== taskIdx);
        return { ...m, tasks };
      }
      return m;
    });
    try {
      const res = await fetch(`/api/goals/${activeGoal.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sub_projects: updatedSubProjects })
      });
      if (res.ok) {
        const data = await res.json();
        setState({ goals: data.goals });
      }
    } catch (err) {
      console.error("Failed to delete task:", err);
    }
  };

  const handleSaveTask = async (milestoneIdx, taskIdx) => {
    if (!activeGoal || !editTaskTitle.trim()) return;
    const updatedSubProjects = activeGoal.sub_projects.map((m, idx) => {
      if (idx === milestoneIdx) {
        const tasks = m.tasks.map((t, tIdx) => {
          if (tIdx === taskIdx) {
            return {
              ...t,
              title: editTaskTitle,
              description: editTaskDesc,
              estimated_time: editTaskTime,
              resource: editTaskResource,
              dueDate: editTaskDueDate
            };
          }
          return t;
        });
        return { ...m, tasks };
      }
      return m;
    });
    try {
      const res = await fetch(`/api/goals/${activeGoal.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sub_projects: updatedSubProjects })
      });
      if (res.ok) {
        const data = await res.json();
        setState({ goals: data.goals });
        setEditingTaskKey(null);
      }
    } catch (err) {
      console.error("Failed to save task:", err);
    }
  };

  const handleClearResource = async (milestoneIdx, taskIdx) => {
    if (!activeGoal || !window.confirm("Are you sure you want to clear the resource link for this task?")) return;
    const updatedSubProjects = activeGoal.sub_projects.map((m, idx) => {
      if (idx === milestoneIdx) {
        const tasks = m.tasks.map((t, tIdx) => {
          if (tIdx === taskIdx) {
            return { ...t, resource: "" };
          }
          return t;
        });
        return { ...m, tasks };
      }
      return m;
    });
    try {
      const res = await fetch(`/api/goals/${activeGoal.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sub_projects: updatedSubProjects })
      });
      if (res.ok) {
        const data = await res.json();
        setState({ goals: data.goals });
      }
    } catch (err) {
      console.error("Failed to clear resource:", err);
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
            <label style={styles.sortLabel}>Status:</label>
            <select 
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              style={styles.sortSelect}
            >
              <option value="All">All</option>
              <option value="to-do">To-do</option>
              <option value="in-progress">In-progress</option>
              <option value="done">Done</option>
              <option value="archived">Archived</option>
            </select>

            <label style={styles.sortLabel}>Sort:</label>
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
              {isEditingGoal ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', marginRight: '16px' }}>
                  <input 
                    type="text" 
                    value={editGoalTitle} 
                    onChange={(e) => setEditGoalTitle(e.target.value)} 
                    style={styles.textInputSmall}
                    placeholder="Goal Title"
                  />
                  <input 
                    type="text" 
                    value={editGoalDesc} 
                    onChange={(e) => setEditGoalDesc(e.target.value)} 
                    style={styles.textInputSmall}
                    placeholder="Goal Description"
                  />
                  <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                    <button 
                      onClick={() => handleSaveGoal(activeGoal.id)} 
                      style={styles.addTaskBtn}
                    >
                      Save Goal
                    </button>
                    <button 
                      onClick={() => setIsEditingGoal(false)} 
                      style={styles.cancelBtn}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <h2 style={styles.detailTitle}>{activeGoal.title}</h2>
                    <button 
                      onClick={() => {
                        setEditGoalTitle(activeGoal.title);
                        setEditGoalDesc(activeGoal.description || '');
                        setIsEditingGoal(true);
                      }} 
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--color-accent)',
                        cursor: 'pointer',
                        fontSize: '14px',
                        padding: '2px 6px',
                        borderRadius: '4px',
                      }}
                      title="Edit Goal"
                    >
                      ✏️ Edit
                    </button>
                    <button 
                      onClick={() => handleDeleteGoal(activeGoal.id)} 
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#fb7185',
                        cursor: 'pointer',
                        fontSize: '14px',
                        padding: '2px 6px',
                        borderRadius: '4px',
                      }}
                      title="Delete Goal"
                    >
                      🗑️ Delete
                    </button>
                  </div>
                  <p style={styles.detailSubtitle}>{activeGoal.description}</p>
                </div>
              )}
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
              <h3 style={styles.subTitle}>📋 Milestones & Learning Map</h3>
              <div>
                {activeGoal.sub_projects && activeGoal.sub_projects.map((milestone, mIdx) => {
                  const hasTasks = milestone.tasks && milestone.tasks.length > 0;
                  return (
                    <div key={mIdx} style={styles.milestoneSection} className="glass-card">
                      {/* Milestone Header */}
                      {editingMilestoneIdx === mIdx ? (
                        <div style={styles.milestoneHeader}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                            <input 
                              type="text" 
                              value={editMilestoneTitle} 
                              onChange={(e) => setEditMilestoneTitle(e.target.value)} 
                              style={styles.textInputSmall}
                              placeholder="Milestone Title"
                            />
                            <input 
                              type="text" 
                              value={editMilestoneDesc} 
                              onChange={(e) => setEditMilestoneDesc(e.target.value)} 
                              style={styles.textInputSmall}
                              placeholder="Milestone Description"
                            />
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <label style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Due Date:</label>
                              <input 
                                type="date" 
                                value={editMilestoneDueDate} 
                                onChange={(e) => setEditMilestoneDueDate(e.target.value)} 
                                style={styles.dateInput}
                              />
                            </div>
                            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                              <button 
                                onClick={() => handleSaveMilestone(mIdx)} 
                                style={styles.addTaskBtn}
                              >
                                Save
                              </button>
                              <button 
                                onClick={() => setEditingMilestoneIdx(null)} 
                                style={styles.cancelBtn}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div style={styles.milestoneHeader}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                            <input 
                              type="checkbox" 
                              checked={milestone.completed || false} 
                              onChange={() => handleToggleTask(mIdx)} 
                              style={styles.checkbox}
                            />
                            <div>
                              <strong style={{
                                fontSize: '15px',
                                textDecoration: milestone.completed ? 'line-through' : 'none',
                                color: milestone.completed ? 'var(--color-text-muted)' : 'var(--color-accent)',
                                display: 'inline-block'
                              }}>
                                {milestone.title}
                              </strong>
                              {milestone.description && (
                                <p style={{
                                  margin: '4px 0 0 0',
                                  fontSize: '12px',
                                  color: 'var(--color-text-muted)',
                                  fontStyle: 'italic'
                                }}>
                                  {milestone.description}
                                </p>
                              )}
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <button 
                              onClick={() => {
                                setEditMilestoneTitle(milestone.title);
                                setEditMilestoneDesc(milestone.description || '');
                                setEditMilestoneDueDate(milestone.dueDate || '');
                                setEditingMilestoneIdx(mIdx);
                              }}
                              style={{ background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', fontSize: '12px' }}
                              title="Edit Milestone"
                            >
                              ✏️ Edit
                            </button>
                            <button 
                              onClick={() => handleDeleteMilestone(mIdx)}
                              style={{ background: 'none', border: 'none', color: '#fb7185', cursor: 'pointer', fontSize: '12px' }}
                              title="Delete Milestone"
                            >
                              🗑️ Delete
                            </button>
                            {milestone.dueDate && (
                              <span style={{
                                ...styles.dueDateBadge,
                                backgroundColor: milestone.completed ? 'rgba(255,255,255,0.03)' : 'rgba(99, 102, 241, 0.12)',
                                color: milestone.completed ? 'var(--color-text-muted)' : 'var(--color-accent)'
                              }}>
                                Due: {milestone.dueDate}
                              </span>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Nested Tasks */}
                      <div style={styles.nestedTasksContainer}>
                        {hasTasks ? (
                          milestone.tasks.map((task, tIdx) => (
                            editingTaskKey === `${mIdx}-${tIdx}` ? (
                              <div key={tIdx} style={styles.taskItem}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                  <input 
                                    type="text" 
                                    value={editTaskTitle} 
                                    onChange={(e) => setEditTaskTitle(e.target.value)} 
                                    style={styles.textInputSmall}
                                    placeholder="Task Title"
                                  />
                                  <input 
                                    type="text" 
                                    value={editTaskDesc} 
                                    onChange={(e) => setEditTaskDesc(e.target.value)} 
                                    style={styles.textInputSmall}
                                    placeholder="Task Description"
                                  />
                                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                    <input 
                                      type="text" 
                                      value={editTaskTime} 
                                      onChange={(e) => setEditTaskTime(e.target.value)} 
                                      style={{ ...styles.nestedInput, width: '120px' }}
                                      placeholder="Time (e.g. 2 hours)"
                                    />
                                    <input 
                                      type="date" 
                                      value={editTaskDueDate} 
                                      onChange={(e) => setEditTaskDueDate(e.target.value)} 
                                      style={styles.dateInput}
                                    />
                                  </div>
                                  <input 
                                    type="text" 
                                    value={editTaskResource} 
                                    onChange={(e) => setEditTaskResource(e.target.value)} 
                                    style={styles.textInputSmall}
                                    placeholder="Resource / URL"
                                  />
                                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
                                    <button 
                                      onClick={() => handleSaveTask(mIdx, tIdx)} 
                                      style={styles.submitNestedBtn}
                                    >
                                      Save Task
                                    </button>
                                    <button 
                                      onClick={() => setEditingTaskKey(null)} 
                                      style={styles.cancelBtn}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div key={tIdx} style={styles.taskItem}>
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                                  <input 
                                    type="checkbox" 
                                    checked={task.completed || false} 
                                    onChange={() => handleToggleTask(mIdx, tIdx)} 
                                    style={{ ...styles.checkbox, marginTop: '4px' }}
                                  />
                                  <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                      <span style={{
                                        fontWeight: '600',
                                        fontSize: '13px',
                                        textDecoration: task.completed ? 'line-through' : 'none',
                                        color: task.completed ? 'var(--color-text-muted)' : 'var(--color-text-main)'
                                      }}>
                                        {task.title}
                                      </span>
                                      {task.estimated_time && (
                                        <span style={styles.durationBadge}>
                                          ⏱️ {task.estimated_time}
                                        </span>
                                      )}
                                      {task.dueDate && (
                                        <span style={{
                                          ...styles.dueDateBadge,
                                          fontSize: '10px',
                                          padding: '1px 6px',
                                          backgroundColor: task.completed ? 'rgba(255,255,255,0.03)' : 'rgba(239, 68, 68, 0.08)',
                                          color: task.completed ? 'var(--color-text-muted)' : '#f87171'
                                        }}>
                                          Due: {task.dueDate}
                                        </span>
                                      )}
                                    </div>
                                    {task.description && (
                                      <p style={styles.taskDescText}>
                                        {task.description}
                                      </p>
                                    )}
                                    {task.resource && (
                                      <div style={styles.resourceBox}>
                                        <span style={{ fontSize: '11px' }}>📖 Resource: </span>
                                        {task.resource.startsWith('http') ? (
                                          <a href={task.resource} target="_blank" rel="noopener noreferrer" style={styles.resourceLink}>
                                            {task.resource}
                                          </a>
                                        ) : (
                                          <span style={{ color: 'var(--color-text-muted)', fontSize: '11px' }}>{task.resource}</span>
                                        )}
                                        <button 
                                          onClick={() => handleClearResource(mIdx, tIdx)}
                                          style={{
                                            background: 'none',
                                            border: 'none',
                                            color: '#fb7185',
                                            cursor: 'pointer',
                                            fontSize: '10px',
                                            marginLeft: '8px'
                                          }}
                                          title="Clear resource link"
                                        >
                                          🗑️ Clear Resource
                                        </button>
                                      </div>
                                    )}
                                    <div style={{ display: 'flex', gap: '8px', marginTop: '6px', justifyContent: 'flex-end' }}>
                                      <button 
                                        onClick={() => {
                                          setEditTaskTitle(task.title);
                                          setEditTaskDesc(task.description || '');
                                          setEditTaskTime(task.estimated_time || '');
                                          setEditTaskResource(task.resource || '');
                                          setEditTaskDueDate(task.dueDate || '');
                                          setEditingTaskKey(`${mIdx}-${tIdx}`);
                                        }}
                                        style={{ background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', fontSize: '11px' }}
                                        title="Edit Task"
                                      >
                                        ✏️ Edit Task
                                      </button>
                                      <button 
                                        onClick={() => handleDeleteTask(mIdx, tIdx)}
                                        style={{ background: 'none', border: 'none', color: '#fb7185', cursor: 'pointer', fontSize: '11px' }}
                                        title="Delete Task"
                                      >
                                        🗑️ Delete Task
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )
                          ))
                        ) : (
                          <div style={{ color: 'var(--color-text-muted)', fontSize: '12px', paddingLeft: '28px' }}>
                            No sub-tasks added yet. Add a learning step below!
                          </div>
                        )}

                        {/* Inline Add Task Form for this Milestone */}
                        {activeAddTaskId === mIdx ? (
                          <form onSubmit={(e) => handleAddNestedTask(e, mIdx)} style={styles.nestedTaskForm}>
                            <div style={styles.formRow}>
                              <input 
                                type="text"
                                value={nestedTaskTitle[mIdx] || ''}
                                onChange={(e) => setNestedTaskTitle(prev => ({ ...prev, [mIdx]: e.target.value }))}
                                placeholder="Task Title (e.g. Variables and Data Types)"
                                style={styles.nestedInput}
                                required
                              />
                              <input 
                                type="text"
                                value={nestedTaskTime[mIdx] || ''}
                                onChange={(e) => setNestedTaskTime(prev => ({ ...prev, [mIdx]: e.target.value }))}
                                placeholder="Time (e.g. 2 hours)"
                                style={{ ...styles.nestedInput, width: '120px' }}
                              />
                              <input 
                                type="date"
                                value={nestedTaskDueDate[mIdx] || ''}
                                onChange={(e) => setNestedTaskDueDate(prev => ({ ...prev, [mIdx]: e.target.value }))}
                                style={{ ...styles.nestedInput, width: '130px' }}
                              />
                            </div>
                            <input 
                              type="text"
                              value={nestedTaskDesc[mIdx] || ''}
                              onChange={(e) => setNestedTaskDesc(prev => ({ ...prev, [mIdx]: e.target.value }))}
                              placeholder="Task Description (what to learn/build)"
                              style={{ ...styles.nestedInput, marginTop: '6px' }}
                            />
                            <input 
                              type="text"
                              value={nestedTaskResource[mIdx] || ''}
                              onChange={(e) => setNestedTaskResource(prev => ({ ...prev, [mIdx]: e.target.value }))}
                              placeholder="Resource / URL (e.g. MDN Web Docs)"
                              style={{ ...styles.nestedInput, marginTop: '6px' }}
                            />
                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}>
                              <button type="button" onClick={() => setActiveAddTaskId(null)} style={styles.cancelBtn}>Cancel</button>
                              <button type="submit" style={styles.submitNestedBtn}>Add Task</button>
                            </div>
                          </form>
                        ) : (
                          <button 
                            type="button" 
                            onClick={() => setActiveAddTaskId(mIdx)} 
                            style={styles.addNestedBtn}
                          >
                            ➕ Add Task to Milestone
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Add Milestone Form */}
                <div style={{ marginTop: '20px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '15px' }}>
                  <h4 style={{ fontSize: '14px', margin: '0 0 10px 0', color: 'var(--color-text-main)' }}>Add New Milestone Node</h4>
                  <form onSubmit={handleAddTask} style={styles.taskForm}>
                    <input 
                      type="text" 
                      value={newTaskText} 
                      onChange={(e) => setNewTaskText(e.target.value)} 
                      placeholder="Milestone Title (e.g., Milestone 4: Advanced Frameworks)"
                      style={styles.textInputSmall}
                      required
                    />
                    <input 
                      type="date"
                      value={newTaskDueDate}
                      onChange={(e) => setNewTaskDueDate(e.target.value)}
                      style={styles.dateInput}
                    />
                    <button type="submit" style={styles.addTaskBtn}>Create Milestone</button>
                  </form>
                </div>
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
  },
  milestoneSection: {
    padding: '16px',
    borderRadius: '12px',
    border: '1px solid var(--border-card)',
    backgroundColor: 'rgba(255,255,255,0.01)',
    marginBottom: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  milestoneHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    paddingBottom: '10px',
    flexWrap: 'wrap',
    gap: '10px',
  },
  nestedTasksContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    paddingLeft: '6px',
  },
  taskItem: {
    padding: '10px 12px',
    borderRadius: '8px',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    border: '1px solid rgba(255, 255, 255, 0.03)',
  },
  durationBadge: {
    fontSize: '10px',
    padding: '1px 6px',
    borderRadius: '4px',
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    color: 'var(--color-accent)',
    fontWeight: '600',
  },
  taskDescText: {
    margin: '4px 0 0 28px',
    fontSize: '12px',
    color: 'var(--color-text-muted)',
    lineHeight: '1.4',
  },
  resourceBox: {
    margin: '6px 0 0 28px',
    fontSize: '11px',
    color: 'var(--color-text-muted)',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    flexWrap: 'wrap',
  },
  resourceLink: {
    color: 'var(--color-accent)',
    textDecoration: 'none',
    fontWeight: '500',
    wordBreak: 'break-all',
  },
  nestedTaskForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    backgroundColor: 'rgba(0,0,0,0.15)',
    padding: '12px',
    borderRadius: '8px',
    border: '1px solid rgba(255,255,255,0.05)',
    marginTop: '8px',
  },
  formRow: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  nestedInput: {
    flex: 1,
    minWidth: '120px',
    backgroundColor: 'var(--bg-main)',
    border: '1px solid var(--input-border)',
    borderRadius: '6px',
    padding: '6px 10px',
    fontSize: '12px',
    color: 'var(--color-text-main)',
    outline: 'none',
  },
  cancelBtn: {
    backgroundColor: 'transparent',
    color: 'var(--color-text-muted)',
    border: 'none',
    padding: '6px 12px',
    fontSize: '12px',
    cursor: 'pointer',
  },
  submitNestedBtn: {
    backgroundColor: 'var(--color-accent)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    padding: '6px 14px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  addNestedBtn: {
    background: 'none',
    border: '1px dashed rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: 'var(--color-accent)',
    padding: '8px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    textAlign: 'center',
    marginTop: '6px',
    transition: 'all 0.2s',
  }
};
