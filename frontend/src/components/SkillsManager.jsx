import React, { useState } from 'react';
import { useAppState } from '../stateManager';

export default function SkillsManager() {
  const [state, setState] = useAppState();
  
  // Filter states
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedStatus, setSelectedStatus] = useState('All');

  // Expanded skills state: store skill names (lowercase) that are expanded
  const [expandedSkills, setExpandedSkills] = useState({});

  const toggleSkill = (skillKey) => {
    setExpandedSkills(prev => ({
      ...prev,
      [skillKey]: !prev[skillKey]
    }));
  };

  // Extract all categories, statuses, and career applications dynamically
  const categories = ['All', ...new Set(state.goals.flatMap(g => 
    (g.skills || []).map(s => s.category || 'Core')
  ))];

  const statuses = ['All', 'to-do', 'in-progress', 'done', 'archived'];

  // Group projects under individual skills
  const allSkillsMap = {};
  state.goals.forEach(goal => {
    (goal.skills || []).forEach(skill => {
      const key = (skill.name || '').trim().toLowerCase();
      if (!key) return;
      if (!allSkillsMap[key]) {
        allSkillsMap[key] = {
          name: skill.name,
          category: skill.category || 'Core',
          projects: []
        };
      }
      // Add project reference if not already present
      if (!allSkillsMap[key].projects.some(p => p.id === goal.id)) {
        allSkillsMap[key].projects.push(goal);
      }
    });
  });

  const uniqueSkills = Object.values(allSkillsMap);

  // Filter the list of unique skills and their nested projects
  const filteredSkills = uniqueSkills.map(skill => {
    const matchingProjects = skill.projects.filter(p => {
      return selectedStatus === 'All' || p.status === selectedStatus;
    });
    return {
      ...skill,
      projects: matchingProjects
    };
  }).filter(skill => {
    const categoryMatch = selectedCategory === 'All' || skill.category === selectedCategory;
    const hasProjects = skill.projects.length > 0;
    return categoryMatch && hasProjects;
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
          <label style={styles.filterLabel}>Filter by Project Status:</label>
          <select 
            value={selectedStatus} 
            onChange={(e) => setSelectedStatus(e.target.value)}
            style={styles.selectInput}
          >
            {statuses.map((s, i) => <option key={i} value={s}>{s}</option>)}
          </select>
          <span style={styles.filterHelpText}>Shows skills with at least one project in this status</span>
        </div>
      </div>

      <p style={styles.resultCount}>
        {filteredSkills.length} of {uniqueSkills.length} {uniqueSkills.length === 1 ? 'skill' : 'skills'}
      </p>

      {/* Skills Grid */}
      <div style={styles.grid}>
        {filteredSkills.length === 0 ? (
          <div style={styles.emptyCard} className="glass-card">
            <span>No skills found matching the selected filters. Build new projects in the Goal Builder chat!</span>
          </div>
        ) : (
          filteredSkills.map((skill) => {
            const skillKey = skill.name.toLowerCase();
            const isExpanded = !!expandedSkills[skillKey];
            const projectCount = skill.projects.length;
            
            return (
              <div 
                key={skillKey} 
                style={{
                  ...styles.skillCard,
                  borderColor: isExpanded ? 'rgba(99, 102, 241, 0.4)' : 'var(--border-card)',
                  backgroundColor: isExpanded ? 'rgba(30, 41, 59, 0.6)' : 'var(--bg-card)'
                }} 
                className="glass-card"
              >
                {/* Header section - clickable */}
                <div 
                  style={styles.cardHeaderClickable} 
                  onClick={() => toggleSkill(skillKey)}
                >
                  <div style={styles.headerLeft}>
                    <span style={styles.skillEmoji}>💡</span>
                    <div style={styles.skillMainInfo}>
                      <h3 style={styles.cardTitle}>{skill.name}</h3>
                      <div style={styles.metaRow}>
                        <span style={styles.categoryBadge}>{skill.category}</span>
                      </div>
                    </div>
                  </div>
                  
                  <div style={styles.headerRight}>
                    <span style={styles.projectCountBadge}>
                      📂 {projectCount} {projectCount === 1 ? 'Project' : 'Projects'}
                    </span>
                    <span style={{
                      ...styles.expandArrow,
                      transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)'
                    }}>
                      ▼
                    </span>
                  </div>
                </div>

                {/* Expanded area showing projects */}
                {isExpanded && (
                  <div style={styles.projectsContainer} className="animate-fade-in">
                    <h4 style={styles.projectsHeading}>Associated Projects:</h4>
                    <div style={styles.projectsGrid}>
                      {skill.projects.map((proj) => (
                        <div key={proj.id} style={styles.projectSubCard}>
                          <div style={styles.projectCardHeader}>
                            <span style={styles.projectCardTitle}>{proj.title}</span>
                            <span style={{
                              ...styles.statusBadge,
                              backgroundColor: proj.status === 'done' ? 'rgba(16, 185, 129, 0.15)' : proj.status === 'in-progress' ? 'rgba(99, 102, 241, 0.15)' : 'rgba(120, 120, 120, 0.15)',
                              color: proj.status === 'done' ? 'var(--color-success)' : proj.status === 'in-progress' ? 'var(--color-accent)' : 'var(--color-text-muted)'
                            }}>
                              {proj.status}
                            </span>
                          </div>
                          <p style={styles.projectCardDesc}>{proj.description}</p>
                          <button
                            onClick={(e) => {
                              e.stopPropagation(); // Avoid toggling expansion
                              setState({ 
                                activeTab: 'projects',
                                activeGoalId: proj.id,
                                openProjectDetail: true,
                              });
                            }}
                            style={styles.viewProjectBtn}
                          >
                            Go to Project ➔
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })
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
    padding: '20px 24px',
    transition: 'all 0.3s ease',
  },
  cardHeaderClickable: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    cursor: 'pointer',
    userSelect: 'none',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  skillEmoji: {
    fontSize: '24px',
  },
  skillMainInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  cardTitle: {
    fontSize: '16px',
    fontWeight: '700',
    color: 'var(--color-text-main)',
    margin: 0,
  },
  metaRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap',
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
  filterHelpText: {
    fontSize: '11px',
    color: 'var(--color-text-muted)',
    marginTop: '2px',
    fontWeight: 'normal',
  },
  resultCount: {
    fontSize: '13px',
    color: 'var(--color-text-muted)',
    margin: '0 0 16px 0',
    fontWeight: '600',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  projectCountBadge: {
    fontSize: '11px',
    fontWeight: '700',
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    color: 'var(--color-accent)',
    padding: '4px 10px',
    borderRadius: '12px',
    border: '1px solid rgba(99, 102, 241, 0.2)',
  },
  expandArrow: {
    fontSize: '11px',
    color: 'var(--color-text-muted)',
    transition: 'transform 0.2s ease',
  },
  projectsContainer: {
    marginTop: '20px',
    borderTop: '1px solid var(--border-divider)',
    paddingTop: '16px',
  },
  projectsHeading: {
    fontSize: '12px',
    color: 'var(--color-text-muted)',
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: '12px',
  },
  projectsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: '12px',
  },
  projectSubCard: {
    backgroundColor: 'var(--bg-sidebar)',
    border: '1px solid var(--border-card)',
    borderRadius: '8px',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  projectCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  projectCardTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: 'var(--color-text-main)',
  },
  statusBadge: {
    fontSize: '10px',
    fontWeight: '700',
    padding: '3px 10px',
    borderRadius: '12px',
    textTransform: 'uppercase',
  },
  projectCardDesc: {
    fontSize: '12px',
    color: 'var(--color-text-muted)',
    lineHeight: '1.4',
    margin: 0,
  },
  viewProjectBtn: {
    alignSelf: 'flex-start',
    backgroundColor: 'transparent',
    border: '1px solid var(--color-accent)',
    color: 'var(--color-accent)',
    padding: '6px 12px',
    borderRadius: '6px',
    fontSize: '11px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    marginTop: '4px',
    outline: 'none',
  },
  emptyCard: {
    padding: '40px',
    textAlign: 'center',
    color: 'var(--color-text-muted)',
    fontSize: '14px',
  }
};
