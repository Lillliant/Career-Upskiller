import { useState, useEffect } from 'react';

class AppStateStore {
  constructor() {
    this.state = {
      // Configuration & Sim Mode
      isSimulating: true,
      activeTab: 'onboarding',
      
      // Onboarding intake preferences
      careerGoals: '',
      hoursPerWeek: 5,
      targetCalendars: [
        { id: 'cal-work', name: 'Work Calendar', selected: true, sensitive: false },
        { id: 'cal-personal', name: 'Personal/Family Calendar', selected: false, sensitive: true },
        { id: 'cal-learning', name: 'Skill Development Calendar', selected: false, sensitive: false },
        { id: 'cal-social', name: 'Social & Leisure', selected: false, sensitive: true },
      ],
      marketInsights: [
        "AI Engineering roles grew 45% this quarter.",
        "High demand for Model Context Protocol (MCP) experience.",
        "Strong value placed on Agentic Workflow orchestration skills."
      ],
      suggestedFocusAreas: ["Vibe Coding", "Agentic Security", "DAG Orchestration"],
      onboarded: false,

      // Schedule time blocks
      transactionId: '',
      token: '',
      proposedEvents: [],
      scarcityFlag: false,
      reason: '',
      isSubmitted: false,
      
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
