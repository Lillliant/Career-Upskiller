import { useState, useEffect } from 'react';

class AppStateStore {
  constructor() {
    this.state = {
      // Configuration
      activeTab: 'onboarding',
      theme: 'dark', // Default theme
      
      // Onboarding intake preferences
      careerGoals: '',
      hoursPerWeek: 5,
      preferredStartTime: '09:00',
      preferredEndTime: '17:00',
      studyDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      targetCalendars: [],
      availableGoogleCalendars: [],
      currentWeekOffset: 0,
      marketInsights: [
        "AI Engineering roles grew 45% this quarter.",
        "High demand for Model Context Protocol (MCP) experience.",
        "Strong value placed on Agentic Workflow orchestration skills."
      ],
      suggestedFocusAreas: ["Vibe Coding", "Agentic Security", "DAG Orchestration"],
      onboarded: false,

      // Goals list
      goals: [],
      activeGoalId: null,
      openProjectDetail: false,

      // Schedule & unified events
      transactionId: '',
      token: '',
      proposedEvents: [],
      scarcityFlag: false,
      reason: '',
      isSubmitted: false,
      calendarEvents: [],
      scheduledEvents: [],

      // Conversational Goal Builder chat logs
      builderMessages: [
        { role: 'model', text: "Hello! I am your Skill Concierge assistant. Let's discuss your career aspirations and design high-impact learning goals and weekly projects to get you there." }
      ],
      builderArchivedConversations: [],
      
      // Reflection / Work logs
      logs: []
    };
    this.listeners = new Set();
  }

  getState() {
    return this.state;
  }

  setState(newState) {
    this.state = { ...this.state, ...newState };
    this.listeners.forEach(listener => listener(this.state));
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const appState = new AppStateStore();

export function useAppState() {
  const [state, setState] = useState(appState.getState());

  useEffect(() => {
    return appState.subscribe(setState);
  }, []);

  return [state, (newState) => appState.setState(newState)];
}
