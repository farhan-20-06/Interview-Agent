import { Request, Response } from 'express';
import { z } from 'zod';
import { getGeminiService } from '../services/gemini.js';
import {
  createSession,
  getSession,
  updateSession,
  recordTurn,
  adjustDifficulty,
  averageAnsweredScore,
  getTopicsAssessed,
  getTopicsNotAssessed,
  ConversationTurn,
  InterviewSession,
} from '../services/session.js';
import {
  selectInterviewTopics,
  SelectedInterviewTopic,
} from '../services/candidate-intelligence.js';
import { getCurriculumData } from '../services/candidate-data.js';
import {
  INTERVIEWER_SYSTEM_PROMPT,
  ASSESSMENT_SYSTEM_PROMPT,
  buildInterviewContext,
  buildEndInterviewAssessmentContext,
} from '../prompts/interviewer.js';
import { CandidateSchema, Candidate, getMissionStatus } from '../types/candidate.js';
import {
  CompletionStatus,
  InterviewDecision,
  InterviewFeedback,
} from '../types/interview.js';

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

const EndInterviewSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required'),
  endInterview: z.literal(true),
  reason: z.enum(['candidate_ended', 'error']).optional().default('candidate_ended'),
});

// ─── Response Helpers ─────────────────────────────────────────────────────────

function replyOngoing(reply: string) {
  return { reply, done: false };
}

function replyFinished(reply: string, feedback: InterviewFeedback) {
  return { reply, done: true, feedback };
}

// ─── Count completed or failed curriculum days for a candidate ────────────────

function countCompletedOrFailedDays(candidate: Candidate): number {
  const days = new Set<number>();
  for (const m of candidate.missions) {
    const status = getMissionStatus(m);
    if (status === 'completed' || status === 'failed') {
      days.add(m.day);
    }
  }
  return days.size;
}

// ─── Build per-topic candidate profile for the LLM prompt ────────────────────

function buildTopicLists(candidate: Candidate) {
  const completedTopics = candidate.missions
    .filter((m) => getMissionStatus(m) === 'completed')
    .map((m) => ({ day: m.day, title: m.title }));

  const failedTopics = candidate.missions
    .filter((m) => getMissionStatus(m) === 'failed')
    .map((m) => ({ day: m.day, title: m.title }));

  const skippedTopics = candidate.missions
    .filter((m) => getMissionStatus(m) === 'skipped')
    .map((m) => ({ day: m.day, title: m.title }));

  // Derive per-topic signals from attempts count (no learningSignals in real data)
  const perTopicSignals = candidate.missions
    .filter((m) => !m.skipped)
    .map((m) => {
      const status = getMissionStatus(m);
      const attempts = m.attempts ?? 1;
      const strengths: string[] = [];
      const gaps: string[] = [];

      if (status === 'completed' && attempts === 1) {
        strengths.push('Passed on first attempt');
      } else if (status === 'completed' && attempts >= 3) {
        gaps.push(`Required ${attempts} attempts before passing`);
      }
      if (status === 'failed') {
        gaps.push(`Did not pass despite ${attempts} attempt${attempts > 1 ? 's' : ''}`);
      }

      return { day: m.day, title: m.title, strengths, gaps };
    });

  return { completedTopics, failedTopics, skippedTopics, perTopicSignals };
}

// ─── Feedback enrichment ──────────────────────────────────────────────────────

export function enrichFeedback(
  feedback: InterviewFeedback,
  session: InterviewSession,
  completionStatus: CompletionStatus
): InterviewFeedback {
  const questionsAnswered = session.conversationHistory.length;
  const topicsAssessed = getTopicsAssessed(session);
  const topicsNotAssessed = getTopicsNotAssessed(session);
  const overallScore = averageAnsweredScore(session);
  const isPartial =
    completionStatus === 'ended_early' ||
    completionStatus === 'no_answers' ||
    completionStatus === 'error';

  return {
    ...feedback,
    completionStatus,
    isPartial,
    questionsAnswered,
    topicsAssessed: feedback.topicsAssessed?.length ? feedback.topicsAssessed : topicsAssessed,
    topicsNotAssessed: feedback.topicsNotAssessed?.length
      ? feedback.topicsNotAssessed
      : topicsNotAssessed,
    // Only attach a numeric score when answers exist; never invent zeros for unanswered.
    overallScore: questionsAnswered > 0 ? (feedback.overallScore ?? overallScore) : null,
  };
}

/** Deterministic no-answer feedback — never fabricates strengths. */
export function buildNoAnswersFeedback(
  reason: 'candidate_ended' | 'error'
): InterviewFeedback {
  const statusLine =
    reason === 'error'
      ? 'Interview ended because of an error before any answers were submitted.'
      : 'Interview ended early by the candidate before any answers were submitted.';

  return {
    summary: `${statusLine} No answers were submitted, so a meaningful technical assessment could not be generated.`,
    strengths: [],
    gaps: [],
    next: ['Restart the interview and answer at least one question to receive a technical assessment.'],
    completionStatus: 'no_answers',
    isPartial: true,
    questionsAnswered: 0,
    topicsAssessed: [],
    topicsNotAssessed: [],
    overallScore: null,
  };
}

/**
 * Fallback partial feedback from per-turn assessments when the LLM is unavailable.
 * Still evaluates every submitted answer — never uses generic placeholders.
 */
export function buildFallbackPartialFeedback(
  session: InterviewSession,
  reason: 'candidate_ended' | 'error'
): InterviewFeedback {
  const n = session.conversationHistory.length;
  if (n === 0) return buildNoAnswersFeedback(reason);

  const topicsAssessed = getTopicsAssessed(session);
  const topicsNotAssessed = getTopicsNotAssessed(session);
  const avg = averageAnsweredScore(session);

  const endLine =
    reason === 'error'
      ? `Interview ended because of an error after ${n} question${n === 1 ? '' : 's'}.`
      : `Interview was ended early by the candidate after ${n} question${n === 1 ? '' : 's'}.`;

  const strengths = session.conversationHistory
    .filter((t) => t.assessment.level === 'strong' || t.assessment.level === 'excellent')
    .map((t) => `${t.topicTitle}: ${t.assessment.reason}`);

  const gaps = session.conversationHistory
    .filter((t) => t.assessment.level === 'weak' || t.assessment.level === 'developing')
    .map((t) => `${t.topicTitle}: ${t.assessment.reason}`);

  const topicList = topicsAssessed.join(', ') || 'the topics discussed';

  return {
    summary: `${endLine} Partial assessment based on ${n} answered question${n === 1 ? '' : 's'}. Based on the answers provided, the candidate was assessed on ${topicList}. The assessment is based only on the questions answered and does not represent performance on the remaining curriculum.`,
    strengths:
      strengths.length > 0
        ? strengths
        : session.conversationHistory.map(
            (t) => `Answered on ${t.topicTitle} (score ${t.assessment.score}/10): ${t.assessment.reason}`
          ),
    gaps:
      gaps.length > 0
        ? gaps
        : ['No major weaknesses were flagged in the per-answer assessments for the questions answered.'],
    next: [
      'Complete a full interview session to cover remaining eligible topics.',
      ...(topicsNotAssessed.slice(0, 3).map((t) => `Review: ${t}`)),
    ],
    completionStatus: reason === 'error' ? 'error' : 'ended_early',
    isPartial: true,
    questionsAnswered: n,
    topicsAssessed,
    topicsNotAssessed,
    overallScore: avg,
  };
}

// ─── Constraint enforcement ───────────────────────────────────────────────────

function enforceConstraints(
  decision: InterviewDecision,
  session: InterviewSession,
  newQuestionCount: number,
  newCoveredDays: number[]
): InterviewDecision {
  const completedDaysCount = countCompletedOrFailedDays(session.candidate);
  const minDaysRequired = completedDaysCount === 0
    ? 1
    : Math.min(MINIMUM_CURRICULUM_DAYS, completedDaysCount);

  const nowMeetsQuestionMin = newQuestionCount >= MINIMUM_QUESTIONS;
  const nowMeetsDayMin = newCoveredDays.length >= minDaysRequired;

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

  const completedDaysCount = countCompletedOrFailedDays(candidate);

  // Build eligible interview topics
  let eligibleTopics = selectInterviewTopics(candidate, curriculum, {
    maxTopics: 10,
    minDistinctDays: MINIMUM_CURRICULUM_DAYS,
  });

  if (completedDaysCount === 0) {
    // No learning history — use default readiness topics from the real curriculum
    const targetDays = [7, 8, 10, 12, 22];
    const defaultDays = curriculum.days.filter((day) => targetDays.includes(day.day));
    eligibleTopics = defaultDays.map((day) => ({
      day: day.day,
      title: day.title,
      objectives: day.objectives,
      reason: 'Readiness Assessment — default curriculum topic (no candidate history)',
    }));
  }

  // Create session
  const session = createSession(candidate, eligibleTopics, sessionId);
  const firstTopic = eligibleTopics[0]!;

  const { completedTopics, failedTopics, skippedTopics, perTopicSignals } = buildTopicLists(candidate);

  const context = buildInterviewContext({
    candidate: {
      role: candidate.member.jobRole,
      experience: `${candidate.member.yearsExperience} years`,
      completedDaysCount,
      completedTopics,
      failedTopics,
      skippedTopics,
      perTopicSignals,
    },
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

  const gemini = getGeminiService();
  let decision: InterviewDecision;
  try {
    decision = await gemini.generateInterviewDecision({
      systemPrompt: INTERVIEWER_SYSTEM_PROMPT,
      userContext: openingInstruction,
      temperature: 0.7,
    });
  } catch (err: any) {
    console.error("[InterviewController] Error starting interview session:", err);
    res.status(503).json({ error: 'The AI Interviewer is temporarily unavailable. Please try resending your answer.' });
    return;
  }

  const openingQuestion = decision.nextQuestion ?? '';
  if (!openingQuestion) {
    res.status(503).json({ error: 'The AI Interviewer failed to initialize. Please restart the interview.' });
    return;
  }

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
    res.status(410).json({ error: 'Interview is already completed', done: true, feedback: session.feedback });
    return;
  }

  const currentTopic = session.currentTopic ?? session.eligibleTopics[0];
  if (!currentTopic) {
    res.status(422).json({ error: 'No eligible topics available for this session' });
    return;
  }

  const newQuestionCount = session.questionCount + 1;
  const completedDaysCount = countCompletedOrFailedDays(session.candidate);
  const minDaysRequired = completedDaysCount === 0
    ? 1
    : Math.min(MINIMUM_CURRICULUM_DAYS, completedDaysCount);

  const canFinish =
    newQuestionCount >= MINIMUM_QUESTIONS &&
    session.coveredDays.length >= minDaysRequired;

  const { completedTopics, failedTopics, skippedTopics, perTopicSignals } = buildTopicLists(session.candidate);

  const context = buildInterviewContext({
    candidate: {
      role: session.candidate.member.jobRole,
      experience: `${session.candidate.member.yearsExperience} years`,
      completedDaysCount,
      completedTopics,
      failedTopics,
      skippedTopics,
      perTopicSignals,
    },
    eligibleTopics: session.eligibleTopics,
    currentTopic,
    history: session.conversationHistory,
    questionCount: session.questionCount,
    coveredDays: session.coveredDays,
    difficulty: session.difficulty,
    canFinish,
    pendingAnswer: candidateAnswer,
  });

  const gemini = getGeminiService();
  let decision: InterviewDecision;
  try {
    console.log('[Interview] generating next question for session');
    decision = await gemini.generateInterviewDecision({
      systemPrompt: INTERVIEWER_SYSTEM_PROMPT,
      userContext: context,
      temperature: 0.7,
    });
    console.log('[Interview] next question generated:', Boolean(decision?.nextQuestion));
  } catch (err: any) {
    console.error("[InterviewController] Error continuing interview session:", err);
    res.status(503).json({ error: 'The AI Interviewer is temporarily unavailable. Please try resending your answer.' });
    return;
  }

  // ─── Record the completed turn ────────────────────────────────────────────
  // Answers are recorded BEFORE finish handling so they are never discarded.

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

  // Combine comment and nextQuestion for presentation
  const comment = finalDecision.comment ? finalDecision.comment.trim() : '';
  const questionPart = finalDecision.nextQuestion ? finalDecision.nextQuestion.trim() : '';
  const combinedReply = comment && questionPart ? `${comment}\n\n${questionPart}` : (comment || questionPart);

  // ─── Return response ───────────────────────────────────────────────────────

  if (finalDecision.nextAction === 'finish') {
    const baseFeedback = finalDecision.feedback ?? {
      summary: 'Interview completed.',
      strengths: [],
      gaps: [],
      next: [],
    };
    const feedback = enrichFeedback(baseFeedback, session, 'completed');

    updateSession(sessionId, {
      questionCount: newQuestionCount,
      coveredDays: newCoveredDays,
      currentDay: nextTopic.day,
      currentTopic: nextTopic,
      conversationHistory: session.conversationHistory,
      topicScores: session.topicScores,
      difficulty: newDifficulty,
      completed: true,
      completionStatus: 'completed',
      endReason: 'completed_normally',
      feedback,
      lastShownQuestion: combinedReply,
      endedAt: new Date().toISOString(),
    });

    const closingMessage =
      combinedReply || "That concludes our interview. Thank you for your time.";

    res.status(200).json(replyFinished(closingMessage, feedback));
    return;
  }

  updateSession(sessionId, {
    questionCount: newQuestionCount,
    coveredDays: newCoveredDays,
    currentDay: nextTopic.day,
    currentTopic: nextTopic,
    conversationHistory: session.conversationHistory,
    topicScores: session.topicScores,
    difficulty: newDifficulty,
    completed: false,
    feedback: null,
    lastShownQuestion: combinedReply,
  });

  if (!combinedReply) {
    res.status(503).json({ error: 'The AI Interviewer failed to formulate the next question. Please try resending your answer.' });
    return;
  }

  res.status(200).json(replyOngoing(combinedReply));
}

// ─── End Interview Early (preserve answers, generate partial assessment) ──────

async function endInterviewEarly(
  sessionId: string,
  reason: 'candidate_ended' | 'error',
  res: Response
): Promise<void> {
  const session = getSession(sessionId);
  if (!session) {
    res.status(404).json({ error: `Session not found: ${sessionId}` });
    return;
  }

  // If already completed, return preserved feedback — do not clear answers.
  if (session.completed && session.feedback) {
    res.status(200).json(
      replyFinished(
        'Interview already concluded. Showing the existing assessment.',
        session.feedback
      )
    );
    return;
  }

  const answeredCount = session.conversationHistory.length;

  // Zero answers — no LLM call, no fabricated strengths
  if (answeredCount === 0) {
    const feedback = enrichFeedback(buildNoAnswersFeedback(reason), session, 'no_answers');
    updateSession(sessionId, {
      completed: true,
      completionStatus: 'no_answers',
      endReason: reason,
      feedback,
      endedAt: new Date().toISOString(),
      // Preserve conversationHistory explicitly (empty, but not wiped)
      conversationHistory: session.conversationHistory,
    });
    res.status(200).json(
      replyFinished(
        'The interview ended before any answers were submitted.',
        feedback
      )
    );
    return;
  }

  const topicsAssessed = getTopicsAssessed(session);
  const topicsNotAssessed = getTopicsNotAssessed(session);
  const completedDaysCount = countCompletedOrFailedDays(session.candidate);
  const { completedTopics, failedTopics, skippedTopics, perTopicSignals } = buildTopicLists(
    session.candidate
  );

  const context = buildEndInterviewAssessmentContext({
    candidate: {
      role: session.candidate.member.jobRole,
      experience: `${session.candidate.member.yearsExperience} years`,
      completedDaysCount,
      completedTopics,
      failedTopics,
      skippedTopics,
      perTopicSignals,
    },
    eligibleTopics: session.eligibleTopics,
    history: session.conversationHistory,
    coveredDays: session.coveredDays,
    endReason: reason,
    topicsAssessed,
    topicsNotAssessed,
  });

  const completionStatus: CompletionStatus = reason === 'error' ? 'error' : 'ended_early';

  let feedback: InterviewFeedback;
  try {
    const gemini = getGeminiService();
    const decision = await gemini.generateInterviewDecision({
      systemPrompt: ASSESSMENT_SYSTEM_PROMPT,
      userContext: context,
      temperature: 0.5,
    });

    const base =
      decision.feedback ??
      buildFallbackPartialFeedback(session, reason);

    feedback = enrichFeedback(base, session, completionStatus);
  } catch {
    // Preserve answers and still produce a meaningful assessment from turn data
    feedback = enrichFeedback(buildFallbackPartialFeedback(session, reason), session, completionStatus);
  }

  updateSession(sessionId, {
    completed: true,
    completionStatus,
    endReason: reason,
    feedback,
    endedAt: new Date().toISOString(),
    // Explicitly preserve all submitted answers
    conversationHistory: session.conversationHistory,
    questionCount: session.questionCount,
    topicScores: session.topicScores,
    coveredDays: session.coveredDays,
  });

  const closing =
    reason === 'error'
      ? `The interview ended due to an error after ${answeredCount} answered question${answeredCount === 1 ? '' : 's'}. A partial assessment has been generated from your submitted answers.`
      : `Interview ended early after ${answeredCount} answered question${answeredCount === 1 ? '' : 's'}. A partial assessment has been generated from your submitted answers.`;

  res.status(200).json(replyFinished(closing, feedback));
}

// ─── Main Route Handler ───────────────────────────────────────────────────────

export async function interviewHandler(req: Request, res: Response): Promise<void> {
  const body = req.body as Record<string, unknown>;

  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'Request body must be a JSON object' });
    return;
  }

  if (body.endInterview === true) {
    const parsed = EndInterviewSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
      return;
    }
    await endInterviewEarly(parsed.data.sessionId, parsed.data.reason, res);
    return;
  }

  const isContinue = 'message' in body;

  if (isContinue) {
    const parsed = ContinueInterviewSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
      return;
    }
    console.log('[Interview] continuing session:', Boolean(parsed.data.sessionId));
    console.log('[Interview] answer received:', Boolean(parsed.data.message));
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
