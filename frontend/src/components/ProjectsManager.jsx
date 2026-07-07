import React, { useState, useEffect } from 'react';
import { useAppState } from '../stateManager';
import { stageWeeklySchedule, fetchScheduleCapacity, rebalanceSchedule, resumeOnHoldGoals } from '../scheduleApi';

const PRIORITY_LABELS = {
  0: 'Low urgency',
  1: 'Medium urgency',
  2: 'High urgency',
};

function normalizePriority(value) {
  const p = Number(value);
  if (Number.isNaN(p)) return 1;
  return Math.max(0, Math.min(2, p));
}

function priorityLabel(value) {
  return PRIORITY_LABELS[normalizePriority(value)] || PRIORITY_LABELS[1];
}

function parseDurationMins(estStr) {
  if (!estStr) return 60;
  const s = String(estStr).toLowerCase().trim();
  try {
    const parts = s.split(/\s+/);
    if (!parts.length) return 60;
    const val = parseFloat(parts[0]);
    if (Number.isNaN(val)) return 60;
    if (s.includes('hour')) return Math.round(val * 60);
    if (s.includes('min')) return Math.round(val);
    return 60;
  } catch {
    return 60;
  }
}

function computeGoalHoursStats(goal) {
  let totalMins = 0;
  let scheduledIncompleteMins = 0;

  (goal.sub_projects || []).forEach((m) => {
    if (m.tasks?.length) {
      m.tasks.forEach((t) => {
        const estMins = parseDurationMins(t.estimated_time);
        totalMins += estMins;
        if (!t.completed) {
          scheduledIncompleteMins += t.allocated_time_mins || 0;
        }
      });
    } else if (!m.completed) {
      totalMins += 60;
    }
  });

  const loggedMins = goal.time_spent_mins || 0;
  const totalHours = totalMins / 60;
  const loggedHours = loggedMins / 60;
  const scheduledIncompleteHours = scheduledIncompleteMins / 60;

  const pct = (part, whole) => (whole > 0 ? Math.min(100, (part / whole) * 100) : 0);

  return {
    totalHours,
    loggedHours,
    scheduledIncompleteHours,
    loggedPct: pct(loggedHours, totalHours),
    scheduledPct: pct(scheduledIncompleteHours, totalHours),
    remainingHours: Math.max(0, totalHours - loggedHours - scheduledIncompleteHours),
    remainingPct: pct(Math.max(0, totalHours - loggedHours - scheduledIncompleteHours), totalHours),
  };
}

function formatHours(hours) {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  const rounded = Math.round(hours * 10) / 10;
  return `${rounded}h`;
}

export default function ProjectsManager() {
  const [state, setState] = useAppState();

  // Sort states
  const [sortBy, setSortBy] = useState('status'); // 'duedate', 'skills', 'status', 'priority'

  // Create Goal form states
  const [newGoalTitle, setNewGoalTitle] = useState('');
  const [newGoalDesc, setNewGoalDesc] = useState('');
  const [newGoalPriority, setNewGoalPriority] = useState(1);

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

  // Filter states
  const [filterStatus, setFilterStatus] = useState('All');
  const [rebalanceLoading, setRebalanceLoading] = useState(false);
  const [resumeLoading, setResumeLoading] = useState(false);

  // List vs detail navigation
  const [view, setView] = useState('list');

  // Milestone task collapse state (milestone index -> collapsed)
  const [collapsedMilestones, setCollapsedMilestones] = useState({});

  // Skill Editor states
  const [newSkillName, setNewSkillName] = useState('');
  const [newSkillCategory, setNewSkillCategory] = useState('');

  // Goal Editing states
  const [isEditingGoal, setIsEditingGoal] = useState(false);
  const [editGoalTitle, setEditGoalTitle] = useState('');
  const [editGoalDesc, setEditGoalDesc] = useState('');
  const [editGoalPriority, setEditGoalPriority] = useState(1);

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

  useEffect(() => {
    if (state.openProjectDetail && state.activeGoalId) {
      const goal = state.goals.find(g => g.id === state.activeGoalId);
      if (goal) {
        setView('detail');
      }
      setState({ openProjectDetail: false });
    }
  }, [state.openProjectDetail, state.activeGoalId, state.goals]);

  const activeGoal = state.goals.find(g => g.id === state.activeGoalId) || state.goals[0];

  // Filtering and Sorting logic helper
  const getSortedAndFilteredGoals = () => {
    let goalsCopy = [...state.goals];

    if (filterStatus !== 'All') {
      goalsCopy = goalsCopy.filter(g => g.status === filterStatus);
    }

    if (sortBy === 'status') {
      const order = { 'in-progress': 0, 'to-do': 1, 'on-hold': 2, 'done': 3, 'archived': 4 };
      return goalsCopy.sort((a, b) => (order[a.status] ?? 5) - (order[b.status] ?? 5));
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

    if (sortBy === 'priority') {
      return goalsCopy.sort(
        (a, b) => normalizePriority(b.priority) - normalizePriority(a.priority)
      );
    }

    return goalsCopy;
  };

  const sortedGoals = getSortedAndFilteredGoals();
  const totalProjectCount = state.goals.length;
  const filteredProjectCount = sortedGoals.length;
  const capacityWarning = state.goals.find((g) => g.scheduling_warning)?.scheduling_warning;
  const capacityInfo = state.goals.find((g) => g.scheduling_info)?.scheduling_info;
  const onHoldGoals = state.goals.filter((g) => g.status === 'on-hold');
  const goalHoursStats = activeGoal ? computeGoalHoursStats(activeGoal) : null;

  const openProject = (goalId) => {
    setState({ activeGoalId: goalId });
    setView('detail');
    setIsEditingGoal(false);
    setEditingMilestoneIdx(null);
    setEditingTaskKey(null);
    setActiveAddTaskId(null);
    setCollapsedMilestones({});
  };

  const toggleMilestoneCollapse = (mIdx) => {
    setCollapsedMilestones((prev) => ({ ...prev, [mIdx]: !prev[mIdx] }));
  };

  const collapseAllMilestones = () => {
    if (!activeGoal?.sub_projects) return;
    const all = {};
    activeGoal.sub_projects.forEach((_, idx) => { all[idx] = true; });
    setCollapsedMilestones(all);
  };

  const expandAllMilestones = () => {
    setCollapsedMilestones({});
  };

  const allMilestonesCollapsed = activeGoal?.sub_projects?.length > 0
    && activeGoal.sub_projects.every((_, idx) => collapsedMilestones[idx]);

  const goBackToList = () => {
    setView('list');
    setIsEditingGoal(false);
    setEditingMilestoneIdx(null);
    setEditingTaskKey(null);
    setActiveAddTaskId(null);
  };

  const openReflectionAgent = () => {
    if (activeGoal) {
      setState({ activeTab: 'reflection', activeGoalId: activeGoal.id });
    }
  };

  const handleCreateGoal = async (e) => {
    e.preventDefault();
    if (!newGoalTitle.trim()) return;

    const goalData = {
      title: newGoalTitle,
      description: newGoalDesc,
      status: 'to-do',
      priority: normalizePriority(newGoalPriority),
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
        if (newGoal) openProject(newGoal.id);

        try {
          await stageWeeklySchedule(setState);
        } catch (err) {
          console.error("Failed to stage schedule after goal creation:", err);
        }
      }
    } catch (err) {
      console.error("Failed to create goal:", err);
    }
    setNewGoalTitle('');
    setNewGoalDesc('');
    setNewGoalPriority(1);
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

  const formatScheduleActionFeedback = (data, { pauseLowerPriority = false, hoursPerWeek = null } = {}) => {
    const pausedCount = data.paused_goals?.length || 0;
    const changeCount = data.changes?.length || 0;
    const changeLabel = `${changeCount} due date${changeCount === 1 ? '' : 's'}`;

    if (pauseLowerPriority) {
      if (pausedCount === 0) {
        return 'No lower-priority projects to pause — your schedule is already focused on urgent work.';
      }
      if (changeCount > 0) {
        const pausedLabel = `${pausedCount} project${pausedCount === 1 ? '' : 's'}`;
        return `Paused ${pausedLabel} and rescheduled ${changeLabel} for urgent work.`;
      }
      const pausedLabel = `${pausedCount} project${pausedCount === 1 ? '' : 's'}`;
      return `Paused ${pausedLabel}. Urgent due dates were already up to date.`;
    }

    if (hoursPerWeek != null) {
      if (changeCount > 0) {
        return `Increased weekly study hours to ${hoursPerWeek} and rescheduled ${changeLabel}.`;
      }
      return `Increased weekly study hours to ${hoursPerWeek}. Due dates were already up to date.`;
    }

    if (changeCount > 0) {
      return `Rebalanced ${changeLabel} across your projects.`;
    }
    if (!data.schedule_capacity_warning) {
      return 'Due dates are up to date — no further rebalancing was needed.';
    }
    return null;
  };

  const applyScheduleRebalance = async ({ pauseLowerPriority = false, hoursPerWeek = null } = {}) => {
    setRebalanceLoading(true);
    try {
      const data = await rebalanceSchedule({
        preview: false,
        pauseLowerPriority,
        hoursPerWeek,
      });
      setState({ goals: data.goals || [] });
      if (hoursPerWeek != null) {
        setState({ hoursPerWeek: hoursPerWeek });
      }
      const feedback = formatScheduleActionFeedback(data, { pauseLowerPriority, hoursPerWeek });
      if (feedback) {
        window.alert(feedback);
      }
      return data;
    } catch (err) {
      console.error('Failed to rebalance schedule:', err);
      window.alert(err.message || 'Failed to rebalance schedule.');
      return null;
    } finally {
      setRebalanceLoading(false);
    }
  };

  const handleRebalanceDates = async () => {
    if (!window.confirm('Rebalance due dates across all projects by priority? Urgent work will be scheduled first.')) {
      return;
    }
    await applyScheduleRebalance();
  };

  const handleFocusUrgent = async () => {
    if (!window.confirm('Pause lower-priority projects and reschedule urgent work first?')) {
      return;
    }
    await applyScheduleRebalance({ pauseLowerPriority: true });
  };

  const handleIncreaseWeeklyHours = async () => {
    try {
      const capData = await fetchScheduleCapacity();
      const suggested = capData.capacity?.suggested_hours_per_week || 6;
      const rounded = Math.ceil(suggested);
      if (!window.confirm(`Increase weekly study hours to ${rounded} and rebalance due dates?`)) {
        return;
      }
      await applyScheduleRebalance({ hoursPerWeek: rounded });
    } catch (err) {
      console.error('Failed to update weekly hours:', err);
      window.alert('Could not update weekly study hours.');
    }
  };

  const handleResumeGoal = async (goalId, { skipConfirm = false } = {}) => {
    const goal = state.goals.find((g) => g.id === goalId);
    if (!goal || goal.status !== 'on-hold') return;
    if (
      !skipConfirm
      && !window.confirm(`Resume "${goal.title}"? Due dates will be restored to their pre-pause schedule.`)
    ) {
      return;
    }
    setResumeLoading(true);
    try {
      const data = await resumeOnHoldGoals({ goalIds: [goalId] });
      setState({ goals: data.goals || [] });
    } catch (err) {
      console.error('Failed to resume project:', err);
      window.alert(err.message || 'Failed to resume project.');
    } finally {
      setResumeLoading(false);
    }
  };

  const handleResumeAllOnHold = async () => {
    if (!onHoldGoals.length) return;
    const label = onHoldGoals.length === 1
      ? `"${onHoldGoals[0].title}"`
      : `${onHoldGoals.length} projects`;
    if (!window.confirm(`Resume ${label}? Due dates will be restored to their pre-pause schedule.`)) {
      return;
    }
    setResumeLoading(true);
    try {
      const data = await resumeOnHoldGoals();
      setState({ goals: data.goals || [] });
    } catch (err) {
      console.error('Failed to resume projects:', err);
      window.alert(err.message || 'Failed to resume projects.');
    } finally {
      setResumeLoading(false);
    }
  };

  const renderOnHoldBanner = () => {
    if (!onHoldGoals.length) return null;
    const names = onHoldGoals.map((g) => g.title).join(', ');
    const reason = onHoldGoals.length === 1 ? onHoldGoals[0]?.on_hold_reason : null;
    return (
      <div style={styles.onHoldBanner} className="glass-card">
        <div style={{ marginBottom: '10px' }}>
          <strong>⏸️ On hold:</strong>{' '}
          {onHoldGoals.length === 1
            ? `${onHoldGoals[0].title} is paused.`
            : `${onHoldGoals.length} projects are paused (${names}).`}
          {reason && (
            <span style={styles.onHoldReason}> {reason}</span>
          )}
        </div>
        <button
          type="button"
          style={styles.warningActionBtn}
          onClick={handleResumeAllOnHold}
          disabled={resumeLoading || rebalanceLoading}
        >
          Resume all on-hold projects
        </button>
      </div>
    );
  };

  const renderCapacityWarning = (warningText) => (
    <div style={styles.warningBanner} className="glass-card">
      <div style={{ marginBottom: '10px' }}>
        <strong>⚠️ Scheduling capacity warning:</strong> {warningText}
      </div>
      <div style={styles.warningActions}>
        <button
          type="button"
          style={styles.warningActionBtn}
          onClick={handleFocusUrgent}
          disabled={rebalanceLoading}
        >
          Focus on urgent projects
        </button>
        <button
          type="button"
          style={styles.warningActionBtn}
          onClick={handleRebalanceDates}
          disabled={rebalanceLoading}
        >
          Rebalance due dates
        </button>
        <button
          type="button"
          style={styles.warningActionBtnSecondary}
          onClick={handleIncreaseWeeklyHours}
          disabled={rebalanceLoading}
        >
          Increase weekly hours
        </button>
      </div>
    </div>
  );

  const renderCapacityInfo = (infoText) => (
    <div style={styles.infoBanner} className="glass-card">
      <div style={{ marginBottom: '10px' }}>
        <strong>ℹ️ Portfolio schedule note:</strong> {infoText}
      </div>
      <div style={styles.warningActions}>
        <button
          type="button"
          style={styles.warningActionBtn}
          onClick={handleFocusUrgent}
          disabled={rebalanceLoading}
        >
          Focus on urgent projects
        </button>
        <button
          type="button"
          style={styles.warningActionBtnSecondary}
          onClick={handleIncreaseWeeklyHours}
          disabled={rebalanceLoading}
        >
          Increase weekly hours
        </button>
      </div>
    </div>
  );

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
          setView('list');
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
          description: editGoalDesc,
          priority: normalizePriority(editGoalPriority),
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

  if (view === 'list') {
    return (
      <div style={styles.container} className="animate-fade-in">
        <div style={styles.listPage}>
          <div style={styles.pageHeader}>
            <h2 style={styles.pageTitle}>Projects & Goals</h2>
            <p style={styles.pageSubtitle}>Manage your learning projects, milestones, and skill mappings.</p>
          </div>

          {capacityWarning && renderCapacityWarning(capacityWarning)}
          {!capacityWarning && capacityInfo && renderCapacityInfo(capacityInfo)}
          {renderOnHoldBanner()}

          <div style={styles.createBox} className="glass-card">
            <h3 style={styles.sectionTitle}>Add New Goal 🎯</h3>
            <form onSubmit={handleCreateGoal} style={styles.createForm}>
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
              <select
                value={newGoalPriority}
                onChange={(e) => setNewGoalPriority(Number(e.target.value))}
                style={styles.sortSelect}
                title="Project priority"
              >
                <option value={2}>High urgency</option>
                <option value={1}>Medium urgency</option>
                <option value={0}>Low urgency</option>
              </select>
              <button type="submit" style={styles.submitBtn}>
                Create Goal
              </button>
            </form>
          </div>

          <div style={styles.goalsListHeader}>
            <div style={styles.listTitleRow}>
              <span style={styles.listTitle}>Your Projects</span>
              <span style={styles.projectCount}>
                {filteredProjectCount} of {totalProjectCount} projects
              </span>
            </div>
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
                <option value="on-hold">On hold</option>
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
                <option value="priority">Priority</option>
                <option value="duedate">Due Date</option>
                <option value="skills">Skills count</option>
              </select>
            </div>
          </div>

          <div style={styles.goalsGrid}>
            {sortedGoals.length === 0 ? (
              <div style={styles.emptyText} className="glass-card">
                {totalProjectCount === 0
                  ? 'No goals created yet. Create one above to get started.'
                  : 'No projects match the current filter.'}
              </div>
            ) : (
              sortedGoals.map((g) => {
                const cardHours = computeGoalHoursStats(g);
                return (
                  <div
                    key={g.id}
                    onClick={() => openProject(g.id)}
                    style={styles.goalCard}
                    className="glass-card"
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openProject(g.id); }}
                  >
                    <div style={styles.goalCardHeader}>
                      <h4 style={styles.goalTitle}>{g.title}</h4>
                      <span style={{
                        ...styles.statusBadge,
                        backgroundColor: g.status === 'done' ? 'rgba(16, 185, 129, 0.15)' : g.status === 'in-progress' ? 'rgba(99, 102, 241, 0.15)' : g.status === 'on-hold' ? 'rgba(251, 191, 36, 0.15)' : 'rgba(120, 120, 120, 0.15)',
                        color: g.status === 'done' ? 'var(--color-success)' : g.status === 'in-progress' ? 'var(--color-accent)' : g.status === 'on-hold' ? '#fbbf24' : 'var(--color-text-muted)'
                      }}>
                        {g.status}
                      </span>
                    </div>
                    <p style={styles.goalDesc}>{g.description || 'No description'}</p>
                    {g.status === 'on-hold' && g.on_hold_reason && (
                      <p style={styles.onHoldCardReason}>{g.on_hold_reason}</p>
                    )}
                    <div style={styles.goalFooter}>
                      <span>🎯 {priorityLabel(g.priority)}</span>
                      <span>📋 {(g.sub_projects || []).length} milestones</span>
                      <span>⚙️ {(g.skills || []).length} skills</span>
                      {cardHours.totalHours > 0 && (
                        <span>🕐 {formatHours(cardHours.totalHours)} total</span>
                      )}
                      <span>⏱️ {g.time_spent_mins || 0}m logged</span>
                    </div>
                    {g.status === 'on-hold' && (
                      <button
                        type="button"
                        style={styles.resumeCardBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleResumeGoal(g.id);
                        }}
                        disabled={resumeLoading || rebalanceLoading}
                      >
                        Resume project
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container} className="animate-fade-in">
      <div style={styles.detailPage}>
        <div style={styles.detailTopNav}>
          <button type="button" onClick={goBackToList} style={styles.backBtn}>
            ← Back to Projects
          </button>
          <button type="button" onClick={openReflectionAgent} style={styles.nextBtn}>
            ✍️ Reflection Agent →
          </button>
        </div>

        {activeGoal ? (
          <div style={styles.detailCard} className="glass-card">
            {activeGoal.scheduling_warning && renderCapacityWarning(activeGoal.scheduling_warning)}
            {!activeGoal.scheduling_warning && activeGoal.scheduling_info && renderCapacityInfo(activeGoal.scheduling_info)}
            {activeGoal.status === 'on-hold' && (
              <div style={styles.onHoldBanner}>
                <div style={{ marginBottom: '10px' }}>
                  <strong>⏸️ This project is on hold.</strong>
                  {activeGoal.on_hold_reason && (
                    <span style={styles.onHoldReason}> {activeGoal.on_hold_reason}</span>
                  )}
                </div>
                <button
                  type="button"
                  style={styles.warningActionBtn}
                  onClick={() => handleResumeGoal(activeGoal.id)}
                  disabled={resumeLoading || rebalanceLoading}
                >
                  Resume project
                </button>
              </div>
            )}
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <label style={styles.smallLabel}>Priority:</label>
                    <select
                      value={editGoalPriority}
                      onChange={(e) => setEditGoalPriority(Number(e.target.value))}
                      style={styles.selectInput}
                    >
                      <option value={2}>High urgency</option>
                      <option value={1}>Medium urgency</option>
                      <option value={0}>Low urgency</option>
                    </select>
                  </div>
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
                      type="button"
                      onClick={() => {
                        setEditGoalTitle(activeGoal.title);
                        setEditGoalDesc(activeGoal.description || '');
                        setEditGoalPriority(normalizePriority(activeGoal.priority));
                        setIsEditingGoal(true);
                      }}
                      style={styles.iconBtnAccent}
                      title="Edit goal"
                      aria-label="Edit goal"
                    >
                      ✏️
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteGoal(activeGoal.id)}
                      style={styles.iconBtnDanger}
                      title="Delete goal"
                      aria-label="Delete goal"
                    >
                      🗑️
                    </button>
                  </div>
                  <p style={styles.detailSubtitle}>{activeGoal.description}</p>
                  <span style={styles.priorityBadge}>
                    Priority: {priorityLabel(activeGoal.priority)}
                  </span>
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
                  <option value="on-hold">On Hold</option>
                  <option value="done">Completed</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
            </div>

            {goalHoursStats && goalHoursStats.totalHours > 0 && (
              <div style={styles.hoursProgressSection}>
                <div style={styles.hoursProgressHeader}>
                  <span style={styles.hoursProgressTitle}>Time progress</span>
                  <span style={styles.hoursProgressSummary}>
                    {formatHours(goalHoursStats.loggedHours)} logged · {formatHours(goalHoursStats.totalHours)} total
                  </span>
                </div>
                <div style={styles.hoursProgressBar} role="progressbar" aria-valuenow={goalHoursStats.loggedPct + goalHoursStats.scheduledPct} aria-valuemin={0} aria-valuemax={100}>
                  {goalHoursStats.loggedPct > 0 && (
                    <div
                      style={{ ...styles.hoursBarSegment, width: `${goalHoursStats.loggedPct}%`, backgroundColor: 'var(--color-success, #10b981)' }}
                      title={`Logged: ${formatHours(goalHoursStats.loggedHours)} (${Math.round(goalHoursStats.loggedPct)}%)`}
                    />
                  )}
                  {goalHoursStats.scheduledPct > 0 && (
                    <div
                      style={{ ...styles.hoursBarSegment, width: `${goalHoursStats.scheduledPct}%`, backgroundColor: 'var(--color-accent)' }}
                      title={`Scheduled (incomplete): ${formatHours(goalHoursStats.scheduledIncompleteHours)} (${Math.round(goalHoursStats.scheduledPct)}%)`}
                    />
                  )}
                </div>
                <div style={styles.hoursProgressLegend}>
                  <span style={styles.legendItem}>
                    <span style={{ ...styles.legendDot, backgroundColor: 'var(--color-success, #10b981)' }} />
                    Logged {Math.round(goalHoursStats.loggedPct)}%
                  </span>
                  <span style={styles.legendItem}>
                    <span style={{ ...styles.legendDot, backgroundColor: 'var(--color-accent)' }} />
                    Scheduled (incomplete) {Math.round(goalHoursStats.scheduledPct)}%
                  </span>
                  {goalHoursStats.remainingPct > 0 && (
                    <span style={styles.legendItem}>
                      <span style={{ ...styles.legendDot, backgroundColor: 'rgba(255,255,255,0.12)' }} />
                      Remaining {Math.round(goalHoursStats.remainingPct)}%
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Checklist section */}
            <div style={styles.detailSection}>
              <div style={styles.milestonesSectionHeader}>
                <h3 style={{ ...styles.subTitle, marginBottom: 0 }}>📋 Milestones & Learning Map</h3>
                {activeGoal.sub_projects?.length > 0 && (
                  <button
                    type="button"
                    onClick={allMilestonesCollapsed ? expandAllMilestones : collapseAllMilestones}
                    style={styles.collapseAllBtn}
                    title={allMilestonesCollapsed ? 'Expand all task lists' : 'Collapse all task lists'}
                  >
                    {allMilestonesCollapsed ? '▸ Expand all' : '▾ Collapse all'}
                  </button>
                )}
              </div>
              <div>
                {activeGoal.sub_projects && activeGoal.sub_projects.map((milestone, mIdx) => {
                  const hasTasks = milestone.tasks && milestone.tasks.length > 0;
                  const tasksCollapsed = !!collapsedMilestones[mIdx];
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
                            {hasTasks && (
                              <button
                                type="button"
                                onClick={() => toggleMilestoneCollapse(mIdx)}
                                style={styles.collapseToggleBtn}
                                title={tasksCollapsed ? 'Expand tasks' : 'Collapse tasks'}
                                aria-label={tasksCollapsed ? 'Expand tasks' : 'Collapse tasks'}
                                aria-expanded={!tasksCollapsed}
                              >
                                {tasksCollapsed ? '▸' : '▾'}
                              </button>
                            )}
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
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <button
                              type="button"
                              onClick={() => {
                                setEditMilestoneTitle(milestone.title);
                                setEditMilestoneDesc(milestone.description || '');
                                setEditMilestoneDueDate(milestone.dueDate || '');
                                setEditingMilestoneIdx(mIdx);
                              }}
                              style={styles.iconBtnAccent}
                              title="Edit milestone"
                              aria-label="Edit milestone"
                            >
                              ✏️
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteMilestone(mIdx)}
                              style={styles.iconBtnDanger}
                              title="Delete milestone"
                              aria-label="Delete milestone"
                            >
                              🗑️
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
                      {!tasksCollapsed && (
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
                                            type="button"
                                            onClick={() => handleClearResource(mIdx, tIdx)}
                                            style={{ ...styles.iconBtnDanger, fontSize: '11px', marginLeft: '8px' }}
                                            title="Clear resource link"
                                            aria-label="Clear resource link"
                                          >
                                            ✕
                                          </button>
                                        </div>
                                      )}
                                      <div style={{ display: 'flex', gap: '4px', marginTop: '6px', justifyContent: 'flex-end' }}>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setEditTaskTitle(task.title);
                                            setEditTaskDesc(task.description || '');
                                            setEditTaskTime(task.estimated_time || '');
                                            setEditTaskResource(task.resource || '');
                                            setEditTaskDueDate(task.dueDate || '');
                                            setEditingTaskKey(`${mIdx}-${tIdx}`);
                                          }}
                                          style={styles.iconBtnAccent}
                                          title="Edit task"
                                          aria-label="Edit task"
                                        >
                                          ✏️
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleDeleteTask(mIdx, tIdx)}
                                          style={styles.iconBtnDanger}
                                          title="Delete task"
                                          aria-label="Delete task"
                                        >
                                          🗑️
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
                      )}
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
          </div>
        ) : (
          <div style={styles.emptyCard} className="glass-card">
            <span>🎯 This project could not be found.</span>
            <button type="button" onClick={goBackToList} style={{ ...styles.backBtn, marginTop: '16px' }}>
              ← Back to Projects
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    width: '100%',
    maxWidth: '900px',
    margin: '0 auto',
  },
  listPage: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  detailPage: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  detailTopNav: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    gap: '12px',
    flexWrap: 'wrap',
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
  pageHeader: {
    marginBottom: '4px',
  },
  pageTitle: {
    fontSize: '22px',
    color: 'var(--color-text-main)',
    margin: '0 0 4px 0',
  },
  pageSubtitle: {
    fontSize: '13px',
    color: 'var(--color-text-muted)',
    margin: 0,
  },
  backBtn: {
    alignSelf: 'flex-start',
    background: 'none',
    border: '1px solid var(--border-card)',
    borderRadius: '8px',
    color: 'var(--color-accent)',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '600',
    padding: '8px 14px',
    transition: 'all 0.2s',
  },
  createBox: {
    padding: '20px',
  },
  createForm: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 140px auto',
    gap: '10px',
    alignItems: 'center',
  },
  warningBanner: {
    padding: '12px 16px',
    borderRadius: '8px',
    border: '1px solid rgba(251, 191, 36, 0.35)',
    backgroundColor: 'rgba(251, 191, 36, 0.1)',
    color: 'var(--color-text-main)',
    fontSize: '12px',
    lineHeight: '1.5',
    marginBottom: '8px',
  },
  infoBanner: {
    padding: '12px 16px',
    borderRadius: '8px',
    border: '1px solid rgba(99, 102, 241, 0.35)',
    backgroundColor: 'rgba(99, 102, 241, 0.08)',
    color: 'var(--color-text-main)',
    fontSize: '12px',
    lineHeight: '1.5',
    marginBottom: '8px',
  },
  warningActions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
  },
  warningActionBtn: {
    padding: '6px 12px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: 'var(--color-accent)',
    color: '#fff',
    fontSize: '11px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  warningActionBtnSecondary: {
    padding: '6px 12px',
    borderRadius: '6px',
    border: '1px solid rgba(99, 102, 241, 0.35)',
    backgroundColor: 'transparent',
    color: 'var(--color-accent)',
    fontSize: '11px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  onHoldBanner: {
    padding: '12px 16px',
    borderRadius: '8px',
    border: '1px solid rgba(251, 191, 36, 0.35)',
    backgroundColor: 'rgba(251, 191, 36, 0.08)',
    color: 'var(--color-text-main)',
    fontSize: '12px',
    lineHeight: '1.5',
    marginBottom: '12px',
  },
  onHoldReason: {
    opacity: 0.85,
    fontStyle: 'italic',
  },
  onHoldCardReason: {
    fontSize: '11px',
    color: '#fbbf24',
    margin: '0 0 8px 0',
    fontStyle: 'italic',
  },
  resumeCardBtn: {
    marginTop: '10px',
    width: '100%',
    padding: '8px 12px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: 'var(--color-accent)',
    color: '#fff',
    fontSize: '11px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  priorityBadge: {
    display: 'inline-block',
    marginTop: '8px',
    fontSize: '11px',
    fontWeight: '600',
    padding: '3px 10px',
    borderRadius: '12px',
    backgroundColor: 'rgba(99, 102, 241, 0.12)',
    color: 'var(--color-accent)',
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
  listTitleRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '10px',
    flexWrap: 'wrap',
  },
  listTitle: {
    fontSize: '12px',
    fontWeight: '700',
    color: 'var(--color-text-muted)',
    textTransform: 'uppercase',
  },
  projectCount: {
    fontSize: '12px',
    fontWeight: '600',
    color: 'var(--color-text-main)',
    textTransform: 'none',
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
  goalsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '16px',
  },
  goalCard: {
    borderRadius: '12px',
    padding: '16px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    border: '1px solid var(--border-card)',
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
    flexWrap: 'wrap',
    gap: '8px',
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
  detailCard: {
    padding: '24px',
  },
  detailHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottom: '1px solid var(--border-divider)',
    paddingBottom: '16px',
    marginBottom: '12px',
    flexWrap: 'wrap',
    gap: '12px',
  },
  iconBtnAccent: {
    background: 'none',
    border: 'none',
    color: 'var(--color-accent)',
    cursor: 'pointer',
    fontSize: '14px',
    padding: '4px 6px',
    borderRadius: '4px',
    lineHeight: 1,
  },
  iconBtnDanger: {
    background: 'none',
    border: 'none',
    color: '#fb7185',
    cursor: 'pointer',
    fontSize: '14px',
    padding: '4px 6px',
    borderRadius: '4px',
    lineHeight: 1,
  },
  hoursProgressSection: {
    marginBottom: '20px',
    paddingBottom: '16px',
    borderBottom: '1px solid var(--border-divider)',
  },
  hoursProgressHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
    flexWrap: 'wrap',
    gap: '6px',
  },
  hoursProgressTitle: {
    fontSize: '12px',
    fontWeight: '700',
    color: 'var(--color-text-main)',
  },
  hoursProgressSummary: {
    fontSize: '11px',
    color: 'var(--color-text-muted)',
  },
  hoursProgressBar: {
    display: 'flex',
    height: '10px',
    borderRadius: '6px',
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  hoursBarSegment: {
    height: '100%',
    transition: 'width 0.3s ease',
    minWidth: 0,
  },
  hoursProgressLegend: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '12px',
    marginTop: '8px',
    fontSize: '11px',
    color: 'var(--color-text-muted)',
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
  },
  legendDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  milestonesSectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
    gap: '12px',
  },
  collapseAllBtn: {
    background: 'none',
    border: '1px solid var(--border-card)',
    borderRadius: '6px',
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
    fontSize: '11px',
    fontWeight: '600',
    padding: '4px 10px',
    whiteSpace: 'nowrap',
  },
  collapseToggleBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
    fontSize: '12px',
    padding: '2px 4px',
    lineHeight: 1,
    flexShrink: 0,
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
