import { useState, useEffect } from 'react';

class AppStateStore {
  constructor() {
    this.state = {
      // Configuration & Sim Mode
      isSimulating: true,
      activeTab: 'onboarding',
      theme: 'dark', // Default theme
      
      // Onboarding intake preferences
      careerGoals: '',
      hoursPerWeek: 5,
      preferredStartTime: '09:00',
      preferredEndTime: '17:00',
      excludedDays: ['Saturday', 'Sunday'],
      targetCalendars: [
        { id: 'cal-work', name: 'Work Calendar', selected: true, sensitive: false, type: 'google', role: 'write' },
        { id: 'cal-personal', name: 'Personal/Family Calendar', selected: false, sensitive: true, type: 'google', role: 'read_only' },
        { id: 'cal-learning', name: 'Skill Development Calendar', selected: false, sensitive: false, type: 'google', role: 'read_only' },
        { id: 'cal-social', name: 'Social & Leisure', selected: false, sensitive: true, type: 'google', role: 'read_only' },
      ],
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

      // Schedule & unified events
      transactionId: '',
      token: '',
      proposedEvents: [],
      scarcityFlag: false,
      reason: '',
      isSubmitted: false,
      calendarEvents: [],

      // Conversational Goal Builder chat logs
      builderMessages: [
        { role: 'model', text: "Hello! I am your Skill Concierge assistant. Let's discuss your career aspirations and design high-impact learning goals and weekly projects to get you there." }
      ],
      
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
