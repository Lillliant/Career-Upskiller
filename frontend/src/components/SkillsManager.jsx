import React, { useState } from 'react';
import { useAppState } from '../stateManager';

export default function SkillsManager() {
  const [state] = useAppState();
  
  // Filter states
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedStatus, setSelectedStatus] = useState('All');
  const [selectedCareer, setSelectedCareer] = useState('All');

  // Extract all categories, statuses, and career applications dynamically
  const categories = ['All', ...new Set(state.goals.flatMap(g => 
    (g.skills || []).map(s => s.category || 'Core')
  ))];

  const statuses = ['All', 'to-do', 'in-progress', 'done', 'archived'];

  const careers = ['All', ...new Set(state.goals.flatMap(g => 
    (g.skills || []).map(s => s.career_application || 'General')
  ))];

  // Filter projects/goals
  const filteredGoals = state.goals.filter(goal => {
    const goalSkills = goal.skills || [];
    
    // Category match
    const categoryMatch = selectedCategory === 'All' || goalSkills.some(s => s.category === selectedCategory);
    
    // Status match
    const statusMatch = selectedStatus === 'All' || goal.status === selectedStatus;
    
    // Career match
    const careerMatch = selectedCareer === 'All' || goalSkills.some(s => s.career_application === selectedCareer);

    return categoryMatch && statusMatch && careerMatch;
  });

  return (
    <div style={styles.container} className="animate-fade-in">
      <div style={styles.header}>
        <h2 style={styles.pageTitle}>🏆 My Skills Portfolio</h2>
        <p style={styles.pageSubtitle}>Review competency domains, mapped skill acquisitions, and career pathways.</p>
      </div>

      {/* Filters Bar */}
      <div style={styles.filterBar} className="glass-card">
        <div style={styles.filterGroup}>
          <label style={styles.filterLabel}>Filter by Category:</label>
          <select 
            value={selectedCategory} 
            onChange={(e) => setSelectedCategory(e.target.value)}
            style={styles.selectInput}
          >
            {categories.map((c, i) => <option key={i} value={c}>{c}</option>)}
          </select>
        </div>

        <div style={styles.filterGroup}>
          <label style={styles.filterLabel}>Filter by Status:</label>
          <select 
            value={selectedStatus} 
            onChange={(e) => setSelectedStatus(e.target.value)}
            style={styles.selectInput}
          >
            {statuses.map((s, i) => <option key={i} value={s}>{s}</option>)}
          </select>
        </div>

        <div style={styles.filterGroup}>
          <label style={styles.filterLabel}>Filter by Career track:</label>
          <select 
            value={selectedCareer} 
            onChange={(e) => setSelectedCareer(e.target.value)}
            style={styles.selectInput}
          >
            {careers.map((car, i) => <option key={i} value={car}>{car}</option>)}
          </select>
        </div>
      </div>

      {/* Skills Grid */}
      <div style={styles.grid}>
        {filteredGoals.length === 0 ? (
          <div style={styles.emptyCard} className="glass-card">
            <span>No goals found matching the selected filters. Build new projects in the Goal Builder chat!</span>
          </div>
        ) : (
          filteredGoals.map((g) => (
            <div key={g.id} style={styles.skillCard} className="glass-card">
              <div style={styles.cardHeader}>
                <h3 style={styles.cardTitle}>{g.title}</h3>
                <span style={{
                  ...styles.statusBadge,
                  backgroundColor: g.status === 'done' ? 'rgba(16, 185, 129, 0.15)' : g.status === 'in-progress' ? 'rgba(99, 102, 241, 0.15)' : 'rgba(120, 120, 120, 0.15)',
                  color: g.status === 'done' ? 'var(--color-success)' : g.status === 'in-progress' ? 'var(--color-accent)' : 'var(--color-text-muted)'
                }}>
                  {g.status}
                </span>
              </div>
              <p style={styles.cardDesc}>{g.description}</p>
              
              <div style={styles.skillsSection}>
                <h4 style={styles.skillsHeading}>Learned Skill Map:</h4>
                {g.skills && g.skills.length > 0 ? (
                  <div style={styles.skillsList}>
                    {g.skills.map((skill, idx) => (
                      <div key={idx} style={styles.skillTagCard}>
                        <div style={styles.skillNameRow}>
                          <span style={styles.skillTagName}>💡 {skill.name}</span>
                          <span style={styles.categoryBadge}>{skill.category}</span>
                        </div>
                        <div style={styles.careerApplyText}>
                          💼 Career Application: <strong>{skill.career_application}</strong>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span style={styles.emptySkillsText}>No skills declared for this project yet. Add them in Projects & Goals.</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    width: '100%',
    maxWidth: '1000px',
    margin: '0 auto',
  },
  header: {
    marginBottom: '24px',
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
  filterBar: {
    display: 'flex',
    gap: '20px',
    padding: '20px',
    marginBottom: '24px',
    flexWrap: 'wrap',
  },
  filterGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    flex: 1,
    minWidth: '200px',
  },
  filterLabel: {
    fontSize: '11px',
    color: 'var(--color-text-muted)',
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  selectInput: {
    backgroundColor: 'var(--bg-sidebar)',
    border: '1px solid var(--input-border)',
    color: 'var(--color-text-main)',
    padding: '10px',
    borderRadius: '6px',
    fontSize: '13px',
    outline: 'none',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: '20px',
  },
  skillCard: {
    padding: '24px',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  },
  cardTitle: {
    fontSize: '16px',
    fontWeight: '700',
    color: 'var(--color-text-main)',
    margin: 0,
  },
  statusBadge: {
    fontSize: '10px',
    fontWeight: '700',
    padding: '3px 10px',
    borderRadius: '12px',
    textTransform: 'uppercase',
  },
  cardDesc: {
    fontSize: '12px',
    color: 'var(--color-text-muted)',
    lineHeight: '1.4',
    margin: '0 0 20px 0',
  },
  skillsSection: {
    borderTop: '1px solid var(--border-divider)',
    paddingTop: '16px',
  },
  skillsHeading: {
    fontSize: '12px',
    color: 'var(--color-text-main)',
    fontWeight: '700',
    marginBottom: '10px',
  },
  skillsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  skillTagCard: {
    backgroundColor: 'var(--bg-sidebar)',
    border: '1px solid var(--border-card)',
    borderRadius: '8px',
    padding: '12px',
  },
  skillNameRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  skillTagName: {
    fontSize: '13px',
    fontWeight: '600',
    color: 'var(--color-text-main)',
  },
  categoryBadge: {
    fontSize: '9px',
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    color: 'var(--color-accent)',
    padding: '2px 8px',
    borderRadius: '4px',
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  careerApplyText: {
    fontSize: '11px',
    color: 'var(--color-text-muted)',
    marginTop: '6px',
  },
  emptySkillsText: {
    fontSize: '11px',
    color: 'var(--color-text-muted)',
  },
  emptyCard: {
    padding: '40px',
    textAlign: 'center',
    color: 'var(--color-text-muted)',
    fontSize: '14px',
  }
};
