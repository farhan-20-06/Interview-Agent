/**
 * Interview API Contract & Flow Integration Tests
 *
 * All LLM calls are mocked. Verifies:
 * 1. Start interview (validates payload, checks reply + done format)
 * 2. Continue interview (validates message, state updates)
 * 3. Multiple turns (accumulates history, tracks counts)
 * 4. Finish interview (feedback validation, done=true)
 * 5. Invalid sessionId checks (404 handling)
 * 6. Missing candidate during initialization (400 validation error)
 * 7. Missing message on subsequent turns (400 validation error)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response } from 'express';
import { interviewHandler } from '../src/controllers/interview.js';
import { resetGeminiService } from '../src/services/gemini.js';
import { getSession } from '../src/services/session.js';
import { InterviewDecision } from '../src/types/interview.js';

// ─── Mock Gemini Service ──────────────────────────────────────────────────────

vi.mock('../src/services/gemini.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/services/gemini.js')>();
  return {
    ...original,
    getGeminiService: vi.fn(),
    resetGeminiService: original.resetGeminiService,
  };
});

import { getGeminiService } from '../src/services/gemini.js';

// ─── Mock Data Paths ──────────────────────────────────────────────────────────

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

// ─── Test Helpers ─────────────────────────────────────────────────────────────

const MOCK_CANDIDATE = {
  id: 'cand-001',
  name: 'Alex Chen',
  role: 'AI Engineer',
  experience: '2 years',
  cohort: '2026-Q1',
  missions: [
    {
      day: 1,
      missionId: 'day-1-foundations',
      title: 'AI Engineering Foundations',
      status: 'completed' as const,
      attempts: [{ attemptNumber: 1, score: 90, passed: true }],
    },
    {
      day: 7,
      missionId: 'day-7-embeddings',
      title: 'Embeddings',
      status: 'completed' as const,
      attempts: [],
    },
    {
      day: 8,
      missionId: 'day-8-vector-db',
      title: 'Vector Databases',
      status: 'completed' as const,
      attempts: [],
    },
    {
      day: 10,
      missionId: 'day-10-retrieval',
      title: 'Retrieval and Matching Engine',
      status: 'completed' as const,
      attempts: [],
    },
  ],
};

function makeMockDecision(overrides: Partial<InterviewDecision> = {}): InterviewDecision {
  return {
    assessment: { score: 7, level: 'strong', reason: 'Good answer' },
    nextAction: 'followup',
    nextQuestion: 'Can you explain the trade-offs between HNSW and IVF indexes?',
    topic: { day: 8, title: 'Vector Databases' },
    feedback: null,
    ...overrides,
  };
}

function makeFinishDecision(): InterviewDecision {
  return {
    assessment: { score: 8, level: 'strong', reason: 'Solid overall' },
    nextAction: 'finish',
    nextQuestion: 'Thank you, that concludes the interview.',
    topic: { day: 10, title: 'Retrieval and Matching Engine' },
    feedback: {
      summary: 'Strong candidate with good understanding of vector search.',
      strengths: ['Explains embeddings clearly', 'Understands similarity search'],
      gaps: ['Needs deeper HNSW tuning knowledge'],
      next: ['Study HNSW parameter selection', 'Practice hybrid retrieval design'],
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Interview API Contract & Flow', () => {
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

  // ─── 1. Start Interview ─────────────────────────────────────────────────────

  it('1. starts an interview successfully with valid inputs', async () => {
    const { res, data, status } = makeResponse();
    await interviewHandler(
      makeRequest({
        sessionId: 'test-session-001',
        candidate: MOCK_CANDIDATE,
      }),
      res
    );

    expect(status()).toBe(200);
    const d = data();
    expect(d).toEqual({
      reply: expect.any(String),
      done: false,
    });
    expect(d.sessionId).toBeUndefined(); // conforms strictly to contract
  });

  // ─── 2. Continue Interview & State Persistence ──────────────────────────────

  it('2. continues the interview and persists state between turns', async () => {
    const sessionId = 'test-session-002';

    // Start
    const startRes = makeResponse();
    await interviewHandler(makeRequest({ sessionId, candidate: MOCK_CANDIDATE }), startRes.res);
    expect(startRes.status()).toBe(200);

    // Continue
    const continueRes = makeResponse();
    await interviewHandler(
      makeRequest({
        sessionId,
        message: 'Embeddings convert text into high-dimensional vectors.',
      }),
      continueRes.res
    );

    expect(continueRes.status()).toBe(200);
    expect(continueRes.data()).toEqual({
      reply: expect.any(String),
      done: false,
    });

    const session = getSession(sessionId);
    expect(session).not.toBeNull();
    expect(session!.questionCount).toBe(1);
    expect(session!.conversationHistory.length).toBe(1);
    expect(session!.conversationHistory[0].answer).toBe(
      'Embeddings convert text into high-dimensional vectors.'
    );
  });

  // ─── 3. Multiple Turns ──────────────────────────────────────────────────────

  it('3. supports multiple turns, properly updating session counts and difficulty', async () => {
    const sessionId = 'test-session-003';

    // Start
    await interviewHandler(makeRequest({ sessionId, candidate: MOCK_CANDIDATE }), makeResponse().res);

    // Turn 1
    await interviewHandler(makeRequest({ sessionId, message: 'Answer 1' }), makeResponse().res);

    // Turn 2
    await interviewHandler(makeRequest({ sessionId, message: 'Answer 2' }), makeResponse().res);

    const session = getSession(sessionId);
    expect(session!.questionCount).toBe(2);
    expect(session!.conversationHistory.length).toBe(2);
  });

  // ─── 4. Finish Interview & Feedback validation ──────────────────────────────

  it('4. finishes interview and returns required feedback fields', async () => {
    const sessionId = 'test-session-004';

    // Start
    await interviewHandler(makeRequest({ sessionId, candidate: MOCK_CANDIDATE }), makeResponse().res);

    // Rotate through 4 curriculum days to satisfy day count constraints
    const days = [1, 7, 8, 10, 1, 7, 8, 10];
    const titles = ['Foundations', 'Embeddings', 'Vector Databases', 'Retrieval', 'Foundations', 'Embeddings', 'Vector Databases', 'Retrieval'];

    for (let i = 0; i < 7; i++) {
      mockService.generateInterviewDecision.mockResolvedValue(
        makeMockDecision({
          nextAction: 'new_topic',
          topic: { day: days[i]!, title: titles[i]! }
        })
      );
      await interviewHandler(makeRequest({ sessionId, message: `Answer ${i + 1}` }), makeResponse().res);
    }

    // Question 8: finish decision
    mockService.generateInterviewDecision.mockResolvedValue(makeFinishDecision());

    const finalRes = makeResponse();
    await interviewHandler(makeRequest({ sessionId, message: 'Final answer.' }), finalRes.res);

    expect(finalRes.status()).toBe(200);
    const d = finalRes.data();
    expect(d.done).toBe(true);
    expect(d.reply).toBe('Thank you, that concludes the interview.');
    expect(d.feedback).toEqual({
      summary: 'Strong candidate with good understanding of vector search.',
      strengths: ['Explains embeddings clearly', 'Understands similarity search'],
      gaps: ['Needs deeper HNSW tuning knowledge'],
      next: ['Study HNSW parameter selection', 'Practice hybrid retrieval design'],
    });
  });

  // ─── 5. Invalid sessionId ───────────────────────────────────────────────────

  it('5. returns 404 for unknown sessionId', async () => {
    const { res, data, status } = makeResponse();
    await interviewHandler(
      makeRequest({ sessionId: 'invalid-session-999', message: 'Hello' }),
      res
    );

    expect(status()).toBe(404);
    expect(data().error).toContain('Session not found');
  });

  // ─── 6. Missing Candidate (on Start) ────────────────────────────────────────

  it('6. returns 400 when missing candidate object during initialization', async () => {
    const { res, data, status } = makeResponse();
    await interviewHandler(
      makeRequest({
        sessionId: 'test-session-006',
      }),
      res
    );

    expect(status()).toBe(400);
    expect(data().error).toMatch(/expected|Required/i);
  });

  // ─── 7. Missing Message (on Continue) ───────────────────────────────────────

  it('7. returns 400 when message is missing during subsequent turns', async () => {
    const sessionId = 'test-session-007';

    // Start successfully
    await interviewHandler(makeRequest({ sessionId, candidate: MOCK_CANDIDATE }), makeResponse().res);

    // Try to continue without message
    const { res, data, status } = makeResponse();
    await interviewHandler(
      makeRequest({
        sessionId,
      }),
      res
    );

    expect(status()).toBe(400);
    expect(data().error).toMatch(/expected|Required/i);
  });

  // ─── 8. Candidate only required during initialization ───────────────────────

  it('8. candidate is not required in continue requests', async () => {
    const sessionId = 'test-session-008';

    // Start successfully
    await interviewHandler(makeRequest({ sessionId, candidate: MOCK_CANDIDATE }), makeResponse().res);

    // Continue request without candidate (only sessionId and message)
    const { res, status } = makeResponse();
    await interviewHandler(
      makeRequest({
        sessionId,
        message: 'A valid answer message.',
      }),
      res
    );

    expect(status()).toBe(200);
  });

  // ─── 9. Continue Beyond 8 Questions ─────────────────────────────────────────

  it('9. allows interview to continue beyond 8 questions until LLM determines finish', async () => {
    const sessionId = 'test-session-009';

    // Start
    await interviewHandler(makeRequest({ sessionId, candidate: MOCK_CANDIDATE }), makeResponse().res);

    const days = [1, 7, 8, 10, 1, 7, 8, 10, 1, 7];
    const titles = ['Foundations', 'Embeddings', 'Vector DB', 'Retrieval', 'Foundations', 'Embeddings', 'Vector DB', 'Retrieval', 'Foundations', 'Embeddings'];

    // Questions 1 to 9: cover 4 distinct curriculum days, then followups
    for (let i = 0; i < 9; i++) {
      mockService.generateInterviewDecision.mockResolvedValue(
        makeMockDecision({
          nextAction: i < 4 ? 'new_topic' : 'followup',
          topic: { day: days[i]!, title: titles[i]! },
          nextQuestion: `Question number ${i + 2}?`,
        })
      );
      const res = makeResponse();
      await interviewHandler(makeRequest({ sessionId, message: `Answer for Q${i + 1}` }), res.res);
      expect(res.status()).toBe(200);
      expect(res.data().done).toBe(false);
    }

    const sessionBeforeFinish = getSession(sessionId);
    expect(sessionBeforeFinish!.questionCount).toBe(9);
    expect(sessionBeforeFinish!.coveredDays.length).toBeGreaterThanOrEqual(4);

    // Question 10 returns finish after meeting minimums
    mockService.generateInterviewDecision.mockResolvedValue(makeFinishDecision());
    const finalRes = makeResponse();
    await interviewHandler(makeRequest({ sessionId, message: 'Final answer at Q10.' }), finalRes.res);

    expect(finalRes.status()).toBe(200);
    const d = finalRes.data();
    expect(d.done).toBe(true);
    expect(d.feedback).toBeDefined();

    const sessionAfterFinish = getSession(sessionId);
    expect(sessionAfterFinish!.questionCount).toBe(10);
  });
});
