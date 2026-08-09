/**
 * Partial / early-end interview assessment regression tests.
 *
 * Covers:
 * 1. 6 answers → end early → partial assessment
 * 2. 1 answer → end early → partial assessment
 * 3. 0 answers → end early → no fabricated strengths
 * 4. Normal completion → complete assessment
 * 5. End early → re-request assessment → preserved answers & feedback
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response } from 'express';
import {
  interviewHandler,
  enrichFeedback,
  buildNoAnswersFeedback,
  buildFallbackPartialFeedback,
} from '../src/controllers/interview.js';
import { resetGeminiService } from '../src/services/gemini.js';
import { createSession, getSession, recordTurn } from '../src/services/session.js';
import { InterviewDecision } from '../src/types/interview.js';

vi.mock('../src/services/gemini.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/services/gemini.js')>();
  return {
    ...original,
    getGeminiService: vi.fn(),
    resetGeminiService: original.resetGeminiService,
  };
});

import { getGeminiService } from '../src/services/gemini.js';

vi.mock('../src/services/candidate-data.js', async () => {
  const { readFileSync } = await import('fs');
  const { resolve, dirname } = await import('path');
  const { fileURLToPath } = await import('url');
  const { CandidatesFileSchema } = await import('../src/types/candidate.js');
  const { CurriculumSchema } = await import('../src/types/curriculum.js');

  const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');

  function loadJson(name: string) {
    return JSON.parse(readFileSync(resolve(fixturesDir, name), 'utf-8'));
  }

  const candidates = CandidatesFileSchema.parse(loadJson('candidates.json'));
  const curriculum = CurriculumSchema.parse(loadJson('curriculum.json'));

  return {
    getCandidatesData: () => candidates,
    getCurriculumData: () => curriculum,
    loadCandidates: () => candidates,
    loadCurriculum: () => curriculum,
    resetCandidateDataCache: vi.fn(),
  };
});

const MOCK_CANDIDATE = {
  member: {
    id: 'cand-001',
    name: 'Alex Chen',
    jobRole: 'AI Engineer',
    yearsExperience: 2,
    education: 'MS Computer Science',
    status: 'COMPLETED',
  },
  missions: [
    { day: 1, title: 'AI Engineering Foundations', passed: true as const, attempts: 1 },
    { day: 7, title: 'Embeddings', passed: true as const, attempts: 1 },
    { day: 8, title: 'Vector Databases', passed: true as const, attempts: 1 },
    { day: 10, title: 'Retrieval and Matching Engine', passed: true as const, attempts: 1 },
  ],
  signals: { commitDays: 4, missionsCompleted: 4, missionsFirstTry: 4 },
};

function makeMockDecision(overrides: Partial<InterviewDecision> = {}): InterviewDecision {
  return {
    assessment: { score: 7, level: 'strong', reason: 'Good answer on HNSW trade-offs' },
    nextAction: 'followup',
    nextQuestion: 'How would you tune IVF clusters for latency?',
    topic: { day: 8, title: 'Vector Databases' },
    feedback: null,
    ...overrides,
  };
}

function makePartialFeedback(answerCount: number) {
  return {
    summary: `Partial assessment based on ${answerCount} answered question${answerCount === 1 ? '' : 's'}. Candidate demonstrated understanding of embeddings, HNSW, IVF, and hybrid retrieval.`,
    strengths: [
      'Explained HNSW/IVF trade-offs accurately',
      'Connected embedding dimensionality to infrastructure cost',
    ],
    gaps: ['Some answers could include more production examples'],
    next: ['Complete the remaining interview topics for a full assessment'],
  };
}

function makeFinishDecision(): InterviewDecision {
  return {
    assessment: { score: 8, level: 'strong', reason: 'Solid overall' },
    nextAction: 'finish',
    nextQuestion: 'Thank you, that concludes the interview.',
    topic: { day: 10, title: 'Retrieval and Matching Engine' },
    feedback: {
      summary: 'Strong candidate with good understanding of vector search and RRF.',
      strengths: ['Explains embeddings clearly', 'Understands hybrid retrieval'],
      gaps: ['Needs deeper HNSW tuning knowledge'],
      next: ['Study HNSW parameter selection'],
    },
  };
}

function makeRequest(body: Record<string, unknown>): Request {
  return { body } as unknown as Request;
}

function makeResponse(): { res: Response; data: () => any; status: () => number } {
  let statusCode = 200;
  let responseData: any = null;

  const res = {
    status: vi.fn().mockImplementation((code: number) => {
      statusCode = code;
      return res;
    }),
    json: vi.fn().mockImplementation((data: any) => {
      responseData = data;
      return res;
    }),
  } as unknown as Response;

  return {
    res,
    data: () => responseData,
    status: () => statusCode,
  };
}

async function startSession(sessionId: string) {
  await interviewHandler(
    makeRequest({ sessionId, candidate: MOCK_CANDIDATE }),
    makeResponse().res
  );
}

async function submitAnswer(sessionId: string, message: string) {
  const res = makeResponse();
  await interviewHandler(makeRequest({ sessionId, message }), res.res);
  return res;
}

async function endSession(sessionId: string, reason: 'candidate_ended' | 'error' = 'candidate_ended') {
  const res = makeResponse();
  await interviewHandler(
    makeRequest({ sessionId, endInterview: true, reason }),
    res.res
  );
  return res;
}

describe('Partial interview assessment', () => {
  let mockService: { generateInterviewDecision: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockService = {
      generateInterviewDecision: vi.fn().mockResolvedValue(makeMockDecision()),
    };
    (getGeminiService as ReturnType<typeof vi.fn>).mockReturnValue(mockService);
    resetGeminiService();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('Case 1: 6 answers then end early — evaluates all 6 and returns partial assessment', async () => {
    const sessionId = 'partial-6';
    await startSession(sessionId);

    for (let i = 0; i < 6; i++) {
      await submitAnswer(sessionId, `Answer ${i + 1} about HNSW and embeddings`);
    }

    mockService.generateInterviewDecision.mockResolvedValueOnce({
      ...makeMockDecision(),
      nextAction: 'finish',
      feedback: makePartialFeedback(6),
    });

    const endRes = await endSession(sessionId);

    expect(endRes.status()).toBe(200);
    const d = endRes.data();
    expect(d.done).toBe(true);
    expect(d.feedback.questionsAnswered).toBe(6);
    expect(d.feedback.isPartial).toBe(true);
    expect(d.feedback.completionStatus).toBe('ended_early');
    expect(d.feedback.summary).toMatch(/partial|6/i);
    expect(d.feedback.strengths.length).toBeGreaterThan(0);
    expect(d.feedback.strengths).not.toContain('Participated in the interview.');
    expect(d.feedback.gaps).not.toContain(
      'Insufficient questions answered for a complete assessment.'
    );

    const session = getSession(sessionId);
    expect(session!.conversationHistory.length).toBe(6);
    expect(session!.feedback?.questionsAnswered).toBe(6);
  });

  it('Case 2: 1 answer then end early — evaluates the single answer', async () => {
    const sessionId = 'partial-1';
    await startSession(sessionId);
    await submitAnswer(sessionId, 'Embeddings map text to vectors for semantic search.');

    mockService.generateInterviewDecision.mockResolvedValueOnce({
      ...makeMockDecision(),
      nextAction: 'finish',
      feedback: makePartialFeedback(1),
    });

    const endRes = await endSession(sessionId);

    expect(endRes.status()).toBe(200);
    const d = endRes.data();
    expect(d.feedback.questionsAnswered).toBe(1);
    expect(d.feedback.isPartial).toBe(true);
    expect(d.feedback.summary).toMatch(/partial|1/i);
    expect(d.feedback.strengths.length).toBeGreaterThan(0);
  });

  it('Case 3: 0 answers then end early — no fabricated technical strengths', async () => {
    const sessionId = 'partial-0';
    await startSession(sessionId);

    const endRes = await endSession(sessionId);

    expect(endRes.status()).toBe(200);
    const d = endRes.data();
    expect(d.feedback.questionsAnswered).toBe(0);
    expect(d.feedback.completionStatus).toBe('no_answers');
    expect(d.feedback.strengths).toEqual([]);
    expect(d.feedback.summary).toMatch(/No answers were submitted/i);
    expect(mockService.generateInterviewDecision).toHaveBeenCalledTimes(1); // start only
  });

  it('Case 4: normal completion — complete assessment metadata', async () => {
    const sessionId = 'complete-normal';
    await startSession(sessionId);

    const days = [1, 7, 8, 10, 1, 7, 8];
    const titles = ['Foundations', 'Embeddings', 'Vector DB', 'Retrieval', 'Foundations', 'Embeddings', 'Vector DB'];

    for (let i = 0; i < 7; i++) {
      mockService.generateInterviewDecision.mockResolvedValueOnce(
        makeMockDecision({
          nextAction: 'new_topic',
          topic: { day: days[i]!, title: titles[i]! },
        })
      );
      await submitAnswer(sessionId, `Answer ${i + 1}`);
    }

    mockService.generateInterviewDecision.mockResolvedValueOnce(makeFinishDecision());
    const finalRes = await submitAnswer(sessionId, 'Final comprehensive answer.');

    expect(finalRes.status()).toBe(200);
    const d = finalRes.data();
    expect(d.done).toBe(true);
    expect(d.feedback.completionStatus).toBe('completed');
    expect(d.feedback.isPartial).toBe(false);
    expect(d.feedback.questionsAnswered).toBe(8);
    expect(d.feedback.strengths.length).toBeGreaterThan(0);
  });

  it('Case 5: end early then request assessment again — preserves answers and feedback', async () => {
    const sessionId = 'partial-revisit';
    await startSession(sessionId);

    for (let i = 0; i < 4; i++) {
      await submitAnswer(sessionId, `Answer ${i + 1}`);
    }

    mockService.generateInterviewDecision.mockResolvedValueOnce({
      ...makeMockDecision(),
      nextAction: 'finish',
      feedback: makePartialFeedback(4),
    });

    const firstEnd = await endSession(sessionId);
    const firstFeedback = firstEnd.data().feedback;

    mockService.generateInterviewDecision.mockClear();

    const secondEnd = await endSession(sessionId);

    expect(secondEnd.status()).toBe(200);
    expect(secondEnd.data().feedback).toEqual(firstFeedback);
    expect(getSession(sessionId)!.conversationHistory.length).toBe(4);
    expect(mockService.generateInterviewDecision).not.toHaveBeenCalled();
  });
});

describe('Assessment helper functions', () => {
  const eligibleTopics = [
    { day: 7, title: 'Embeddings', objectives: [], reason: 'completed' },
    { day: 8, title: 'Vector Databases', objectives: [], reason: 'completed' },
  ];

  function makeSessionWithTurns(turnCount: number) {
    const session = createSession(MOCK_CANDIDATE as any, eligibleTopics, 'helper-session');
    for (let i = 0; i < turnCount; i++) {
      recordTurn(session, {
        questionNumber: i + 1,
        question: `Q${i + 1}`,
        answer: `Answer ${i + 1}`,
        assessment: { score: 7, level: 'strong', reason: 'Good technical depth' },
        topicDay: i % 2 === 0 ? 7 : 8,
        topicTitle: i % 2 === 0 ? 'Embeddings' : 'Vector Databases',
      });
    }
    return session;
  }

  it('buildNoAnswersFeedback never fabricates strengths', () => {
    const fb = buildNoAnswersFeedback('candidate_ended');
    expect(fb.strengths).toEqual([]);
    expect(fb.questionsAnswered).toBe(0);
    expect(fb.summary).toMatch(/No answers were submitted/i);
  });

  it('buildFallbackPartialFeedback evaluates submitted answers only', () => {
    const session = makeSessionWithTurns(3);
    const fb = buildFallbackPartialFeedback(session, 'candidate_ended');

    expect(fb.questionsAnswered).toBe(3);
    expect(fb.isPartial).toBe(true);
    expect(fb.summary).toMatch(/Partial assessment based on 3/i);
    expect(fb.strengths.length).toBeGreaterThan(0);
    expect(fb.overallScore).not.toBeNull();
  });

  it('enrichFeedback uses conversationHistory length for questionsAnswered', () => {
    const session = makeSessionWithTurns(5);
    const fb = enrichFeedback(
      {
        summary: 'Test',
        strengths: ['HNSW knowledge'],
        gaps: [],
        next: [],
      },
      session,
      'ended_early'
    );

    expect(fb.questionsAnswered).toBe(5);
    expect(fb.isPartial).toBe(true);
    expect(fb.topicsAssessed).toContain('Embeddings');
    expect(fb.topicsAssessed).toContain('Vector Databases');
  });

  it('enrichFeedback does not assign overallScore when zero answers', () => {
    const session = createSession(MOCK_CANDIDATE as any, eligibleTopics, 'empty-session');
    const fb = enrichFeedback(buildNoAnswersFeedback('candidate_ended'), session, 'no_answers');
    expect(fb.overallScore).toBeNull();
    expect(fb.questionsAnswered).toBe(0);
  });
});
