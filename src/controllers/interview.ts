import { Request, Response } from 'express';
import { z } from 'zod';
import { getGeminiService } from '../services/gemini.js';
import {
  createSession,
  getSession,
  updateSession,
  recordTurn,
  adjustDifficulty,
  ConversationTurn,
  InterviewSession,
} from '../services/session.js';
import {
  selectInterviewTopics,
  SelectedInterviewTopic,
} from '../services/candidate-intelligence.js';
import { getCurriculumData } from '../services/candidate-data.js';
import { INTERVIEWER_SYSTEM_PROMPT, buildInterviewContext } from '../prompts/interviewer.js';
import { CandidateSchema, Candidate } from '../types/candidate.js';
import { InterviewDecision } from '../types/interview.js';

// ─── Hard Constraints ─────────────────────────────────────────────────────────

const MINIMUM_QUESTIONS = 8;
const MINIMUM_CURRICULUM_DAYS = 4;

// ─── Request Schemas ──────────────────────────────────────────────────────────

const StartInterviewSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required'),
  candidate: CandidateSchema,
});

const ContinueInterviewSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required'),
  message: z.string().min(1, 'message is required'),
});

// ─── Response Helpers ─────────────────────────────────────────────────────────

function replyOngoing(reply: string) {
  return { reply, done: false };
}

function replyFinished(reply: string, feedback: object) {
  return { reply, done: true, feedback };
}

// ─── Constraint enforcement ───────────────────────────────────────────────────

function enforceConstraints(
  decision: InterviewDecision,
  session: InterviewSession,
  newQuestionCount: number,
  newCoveredDays: number[]
): InterviewDecision {
  const nowMeetsQuestionMin = newQuestionCount >= MINIMUM_QUESTIONS;
  const nowMeetsDayMin = newCoveredDays.length >= MINIMUM_CURRICULUM_DAYS;

  if (decision.nextAction !== 'finish') return decision;
  if (nowMeetsQuestionMin && nowMeetsDayMin) return decision;

  // Override: find next uncovered eligible topic
  const uncoveredTopic = session.eligibleTopics.find(
    (t) => !newCoveredDays.includes(t.day)
  );

  if (uncoveredTopic) {
    return {
      ...decision,
      nextAction: 'new_topic',
      topic: { day: uncoveredTopic.day, title: uncoveredTopic.title },
      feedback: null,
      nextQuestion: `Good. Let's shift to another area. Can you walk me through what you know about ${uncoveredTopic.title}?`,
    };
  }

  // No uncovered topics available — force a follow-up
  const currentTopic = session.currentTopic ?? session.eligibleTopics[0];
  return {
    ...decision,
    nextAction: 'followup',
    topic: currentTopic
      ? { day: currentTopic.day, title: currentTopic.title }
      : decision.topic,
    feedback: null,
    nextQuestion: `Let's go deeper. Can you describe a production scenario where you applied what you know about ${currentTopic?.title ?? 'this topic'}?`,
  };
}

// ─── Start Interview ──────────────────────────────────────────────────────────

async function startInterview(
  candidate: Candidate,
  sessionId: string,
  res: Response
): Promise<void> {
  const curriculum = getCurriculumData();

  // Build eligible interview topics using existing intelligence service
  const eligibleTopics = selectInterviewTopics(candidate, curriculum, {
    maxTopics: 10,
    minDistinctDays: MINIMUM_CURRICULUM_DAYS,
  });

  if (eligibleTopics.length < MINIMUM_CURRICULUM_DAYS) {
    res.status(422).json({
      error: `Candidate ${candidate.id} does not have enough completed curriculum days to interview (need ${MINIMUM_CURRICULUM_DAYS}, found ${eligibleTopics.length})`,
    });
    return;
  }

  // Create session
  const session = createSession(candidate, eligibleTopics, sessionId);

  // Select first topic
  const firstTopic = eligibleTopics[0]!;

  // Ask the LLM to open the interview with the first question
  const gemini = getGeminiService();
  const context = buildInterviewContext({
    candidate: { role: candidate.role, experience: candidate.experience },
    eligibleTopics,
    currentTopic: firstTopic,
    history: [],
    questionCount: 0,
    coveredDays: [],
    difficulty: 'medium',
    canFinish: false,
    pendingAnswer: undefined,
  });

  const openingInstruction = `${context}

INSTRUCTION: This is the START of the interview. Write a warm, professional opening (1-2 sentences) and immediately ask your first technical question about Day ${firstTopic.day} — ${firstTopic.title}. Set nextAction to "followup". Set assessment score to 0, level to "developing", reason to "Interview opening".`;

  let decision: InterviewDecision;
  try {
    decision = await gemini.generateInterviewDecision({
      systemPrompt: INTERVIEWER_SYSTEM_PROMPT,
      userContext: openingInstruction,
      temperature: 0.7,
    });
  } catch (err: any) {
    res.status(502).json({ error: `LLM service error: ${err.message}` });
    return;
  }

  const openingQuestion = decision.nextQuestion ?? '';
  if (!openingQuestion) {
    res.status(502).json({ error: 'LLM returned no opening question' });
    return;
  }

  // Save the question shown so we can record it when the candidate answers
  updateSession(session.sessionId, {
    currentDay: firstTopic.day,
    currentTopic: firstTopic,
    lastShownQuestion: openingQuestion,
  });

  res.status(200).json(replyOngoing(openingQuestion));
}

// ─── Continue Interview ───────────────────────────────────────────────────────

async function continueInterview(
  sessionId: string,
  candidateAnswer: string,
  res: Response
): Promise<void> {
  const session = getSession(sessionId);
  if (!session) {
    res.status(404).json({ error: `Session not found: ${sessionId}` });
    return;
  }

  if (session.completed) {
    res.status(410).json({ error: 'Interview is already completed', done: true });
    return;
  }

  const currentTopic = session.currentTopic ?? session.eligibleTopics[0];
  if (!currentTopic) {
    res.status(422).json({ error: 'No eligible topics available for this session' });
    return;
  }

  // Determine if we can allow the LLM to finish
  const newQuestionCount = session.questionCount + 1;
  const canFinish =
    newQuestionCount >= MINIMUM_QUESTIONS &&
    session.coveredDays.length >= MINIMUM_CURRICULUM_DAYS;

  // Build context for LLM evaluation
  const context = buildInterviewContext({
    candidate: { role: session.candidate.role, experience: session.candidate.experience },
    eligibleTopics: session.eligibleTopics,
    currentTopic,
    history: session.conversationHistory,
    questionCount: session.questionCount,
    coveredDays: session.coveredDays,
    difficulty: session.difficulty,
    canFinish,
    pendingAnswer: candidateAnswer,
  });

  // Call LLM
  const gemini = getGeminiService();
  let decision: InterviewDecision;
  try {
    decision = await gemini.generateInterviewDecision({
      systemPrompt: INTERVIEWER_SYSTEM_PROMPT,
      userContext: context,
      temperature: 0.7,
    });
  } catch (err: any) {
    res.status(502).json({ error: `LLM service error: ${err.message}` });
    return;
  }

  // ─── Record the completed turn ────────────────────────────────────────────

  const questionJustAnswered = session.lastShownQuestion ?? `Tell me about ${currentTopic.title}.`;

  const turn: ConversationTurn = {
    questionNumber: newQuestionCount,
    question: questionJustAnswered,
    answer: candidateAnswer,
    assessment: decision.assessment,
    topicDay: currentTopic.day,
    topicTitle: currentTopic.title,
  };

  recordTurn(session, turn);

  // newCoveredDays is updated by recordTurn (mutates session.coveredDays in place)
  const newCoveredDays = session.coveredDays;

  // ─── Apply hard constraints ───────────────────────────────────────────────

  const finalDecision = enforceConstraints(decision, session, newQuestionCount, newCoveredDays);

  // ─── Determine next topic ──────────────────────────────────────────────────

  let nextTopic: SelectedInterviewTopic = currentTopic;
  if (finalDecision.nextAction === 'new_topic' && finalDecision.topic) {
    const found = session.eligibleTopics.find((t) => t.day === finalDecision.topic?.day);
    nextTopic = found ?? currentTopic;
  }

  // ─── Adjust difficulty based on assessment ─────────────────────────────────

  const newDifficulty = adjustDifficulty(session.difficulty, decision.assessment.level);

  // ─── Save session ──────────────────────────────────────────────────────────

  const nextQuestion = finalDecision.nextQuestion ?? '';

  updateSession(sessionId, {
    questionCount: newQuestionCount,
    coveredDays: newCoveredDays,
    currentDay: nextTopic.day,
    currentTopic: nextTopic,
    conversationHistory: session.conversationHistory,
    topicScores: session.topicScores,
    difficulty: newDifficulty,
    completed: finalDecision.nextAction === 'finish',
    feedback: finalDecision.feedback ?? null,
    lastShownQuestion: nextQuestion,
  });

  // ─── Return response ───────────────────────────────────────────────────────

  if (finalDecision.nextAction === 'finish') {
    const feedback = finalDecision.feedback ?? {
      summary: 'Interview completed.',
      strengths: [],
      gaps: [],
      next: [],
    };

    const closingMessage =
      nextQuestion || "That concludes our interview. Thank you for your time. Here's your feedback:";

    res.status(200).json(replyFinished(closingMessage, feedback));
    return;
  }

  if (!nextQuestion) {
    res.status(502).json({ error: 'LLM returned no next question' });
    return;
  }

  res.status(200).json(replyOngoing(nextQuestion));
}

// ─── Main Route Handler ───────────────────────────────────────────────────────

export async function interviewHandler(req: Request, res: Response): Promise<void> {
  const body = req.body as Record<string, unknown>;

  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'Request body must be a JSON object' });
    return;
  }

  const isContinue = 'message' in body;

  if (isContinue) {
    const parsed = ContinueInterviewSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
      return;
    }
    await continueInterview(parsed.data.sessionId, parsed.data.message, res);
    return;
  } else {
    const parsed = StartInterviewSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
      return;
    }
    await startInterview(parsed.data.candidate, parsed.data.sessionId, res);
    return;
  }
}
