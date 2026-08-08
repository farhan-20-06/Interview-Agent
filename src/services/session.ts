import { randomUUID } from 'crypto';
import { Candidate } from '../types/candidate.js';
import { InterviewFeedback } from '../types/interview.js';
import { SelectedInterviewTopic } from './candidate-intelligence.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ConversationTurn {
  questionNumber: number;
  question: string;
  answer: string;
  assessment: {
    score: number;
    level: 'weak' | 'developing' | 'strong' | 'excellent';
    reason: string;
  };
  topicDay: number;
  topicTitle: string;
}

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface InterviewSession {
  sessionId: string;
  candidateId: string;
  candidate: Candidate;
  questionCount: number;
  coveredDays: number[];
  currentDay: number | null;
  currentTopic: SelectedInterviewTopic | null;
  conversationHistory: ConversationTurn[];
  topicScores: Record<number, number[]>;
  difficulty: Difficulty;
  completed: boolean;
  feedback: InterviewFeedback | null;
  eligibleTopics: SelectedInterviewTopic[];
  lastShownQuestion: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── In-memory store ─────────────────────────────────────────────────────────

const sessions = new Map<string, InterviewSession>();

// ─── Session Operations ───────────────────────────────────────────────────────

export function createSession(
  candidate: Candidate,
  eligibleTopics: SelectedInterviewTopic[],
  sessionId?: string
): InterviewSession {
  const finalSessionId = sessionId ?? randomUUID();
  const now = new Date().toISOString();

  const session: InterviewSession = {
    sessionId: finalSessionId,
    candidateId: candidate.member.id,
    candidate,
    questionCount: 0,
    coveredDays: [],
    currentDay: null,
    currentTopic: null,
    conversationHistory: [],
    topicScores: {},
    difficulty: 'medium',
    completed: false,
    feedback: null,
    eligibleTopics,
    lastShownQuestion: null,
    createdAt: now,
    updatedAt: now,
  };

  sessions.set(finalSessionId, session);
  return session;
}

export function getSession(sessionId: string): InterviewSession | null {
  return sessions.get(sessionId) ?? null;
}

export function updateSession(
  sessionId: string,
  updates: Partial<Omit<InterviewSession, 'sessionId' | 'createdAt'>>
): InterviewSession {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const updated: InterviewSession = {
    ...session,
    ...updates,
    sessionId: session.sessionId,
    createdAt: session.createdAt,
    updatedAt: new Date().toISOString(),
  };

  sessions.set(sessionId, updated);
  return updated;
}

export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId);
}

export function getSessionCount(): number {
  return sessions.size;
}

// ─── Session helpers ─────────────────────────────────────────────────────────

export function recordTurn(session: InterviewSession, turn: ConversationTurn): void {
  session.conversationHistory.push(turn);

  // Update topic scores
  if (!session.topicScores[turn.topicDay]) {
    session.topicScores[turn.topicDay] = [];
  }
  session.topicScores[turn.topicDay].push(turn.assessment.score);

  // Track covered days
  if (!session.coveredDays.includes(turn.topicDay)) {
    session.coveredDays.push(turn.topicDay);
  }
}

export function nextEligibleTopic(session: InterviewSession): SelectedInterviewTopic | null {
  const uncovered = session.eligibleTopics.filter(
    (topic) => !session.coveredDays.includes(topic.day)
  );
  return uncovered[0] ?? null;
}

export function adjustDifficulty(
  current: Difficulty,
  level: 'weak' | 'developing' | 'strong' | 'excellent'
): Difficulty {
  if (level === 'excellent' || level === 'strong') {
    return current === 'easy' ? 'medium' : 'hard';
  }
  if (level === 'weak') {
    return current === 'hard' ? 'medium' : 'easy';
  }
  return current;
}
