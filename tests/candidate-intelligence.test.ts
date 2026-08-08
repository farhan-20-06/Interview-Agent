import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  getCandidate,
  getCompletedMissions,
  getSkippedMissions,
  getFailedMissions,
  getAttempts,
  getLearningSignals,
  getCompletedTopics,
  getSkippedTopics,
  getEligibleTopics,
  selectInterviewTopics,
  buildCandidateContext,
} from '../src/services/candidate-intelligence';
import { resetCandidateDataCache } from '../src/services/candidate-data';
import { CandidateNotFoundError } from '../src/errors/candidate';
import { CandidatesFileSchema } from '../src/types/candidate';
import { CurriculumSchema } from '../src/types/curriculum';

const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadFixture<T>(filename: string, schema: { parse: (data: unknown) => T }): T {
  const raw = readFileSync(resolve(fixturesDir, filename), 'utf-8');
  return schema.parse(JSON.parse(raw));
}

const candidates = loadFixture('candidates.json', CandidatesFileSchema);
const curriculum = loadFixture('curriculum.json', CurriculumSchema);

describe('Candidate Intelligence Layer', () => {
  beforeEach(() => {
    resetCandidateDataCache();
  });

  it('finds a candidate by ID', () => {
    const candidate = getCandidate('cand-001', candidates);
    expect(candidate.name).toBe('Alex Chen');
    expect(candidate.role).toBe('AI Engineer');
  });

  it('throws when candidate ID is not found', () => {
    expect(() => getCandidate('missing-id', candidates)).toThrow(CandidateNotFoundError);
  });

  it('identifies completed, skipped, and failed missions', () => {
    const candidate = getCandidate('cand-001', candidates);

    expect(getCompletedMissions(candidate).map((m) => m.day)).toEqual([1, 7, 10]);
    expect(getSkippedMissions(candidate).map((m) => m.day)).toEqual([3, 12]);
    expect(getFailedMissions(candidate).map((m) => m.day)).toEqual([8, 15]);
  });

  it('reads attempts across missions', () => {
    const candidate = getCandidate('cand-001', candidates);
    const attempts = getAttempts(candidate);

    expect(attempts.length).toBe(6);
    expect(attempts.some((attempt) => attempt.score === 45)).toBe(true);
  });

  it('reads learning signals from missions', () => {
    const candidate = getCandidate('cand-001', candidates);
    const signals = getLearningSignals(candidate);

    expect(signals.length).toBeGreaterThan(0);
    expect(signals[0]?.strengths.length).toBeGreaterThanOrEqual(0);
  });

  it('maps completed and skipped topics from curriculum', () => {
    const candidate = getCandidate('cand-001', candidates);

    expect(getCompletedTopics(candidate, curriculum).map((t) => t.day)).toEqual([1, 7, 10]);
    expect(getSkippedTopics(candidate, curriculum).map((t) => t.day)).toEqual([3, 12]);
  });

  it('returns eligible topics from completed and failed missions only by default', () => {
    const candidate = getCandidate('cand-001', candidates);
    const eligible = getEligibleTopics(candidate, curriculum);

    expect(eligible.map((topic) => topic.day)).toEqual([1, 7, 8, 10, 15]);
    expect(eligible.some((topic) => topic.day === 3)).toBe(false);
    expect(eligible.some((topic) => topic.day === 12)).toBe(false);
  });

  it('includes skipped topics in eligible set only when explicitly allowed', () => {
    const candidate = getCandidate('cand-001', candidates);
    const eligible = getEligibleTopics(candidate, curriculum, { allowSkipped: true });

    expect(eligible.map((topic) => topic.day)).toEqual([1, 3, 7, 8, 10, 12, 15]);
  });

  it('selects interview topics without skipped missions by default', () => {
    const candidate = getCandidate('cand-001', candidates);
    const topics = selectInterviewTopics(candidate, curriculum);

    const days = topics.map((topic) => topic.day);
    expect(days).not.toContain(3);
    expect(days).not.toContain(12);
    expect(new Set(days).size).toBeGreaterThanOrEqual(4);
  });

  it('prioritizes failed missions in interview topic selection', () => {
    const candidate = getCandidate('cand-001', candidates);
    const topics = selectInterviewTopics(candidate, curriculum, { minDistinctDays: 2 });

    const day8 = topics.find((topic) => topic.day === 8);
    const day15 = topics.find((topic) => topic.day === 15);

    expect(day8?.reason).toContain('Failed mission');
    expect(day15?.reason).toContain('Failed mission');
  });

  it('includes skipped topics when allowSkipped is enabled', () => {
    const candidate = getCandidate('cand-001', candidates);
    const topics = selectInterviewTopics(candidate, curriculum, { allowSkipped: true });

    expect(topics.some((topic) => topic.day === 3)).toBe(true);
    expect(topics.some((topic) => topic.day === 12)).toBe(true);
  });

  it('builds compact candidate context for the LLM', () => {
    const candidate = getCandidate('cand-001', candidates);
    const context = buildCandidateContext(candidate, curriculum);

    expect(context.candidateId).toBe('cand-001');
    expect(context.stats).toEqual({ completed: 3, skipped: 2, failed: 2 });
    expect(context.completedTopics.length).toBe(3);
    expect(context.interviewTopics.length).toBeGreaterThanOrEqual(4);
    expect(context.learningSignals.length).toBeLessThanOrEqual(5);
    expect(context.recentAttempts.length).toBeLessThanOrEqual(5);

    const serialized = JSON.stringify(context);
    const fullPayload = JSON.stringify({ candidate, curriculum });

    expect(serialized.length).toBeLessThan(fullPayload.length);
    expect(serialized).not.toContain('missionId');
    expect(serialized).not.toContain('"missions"');
  });

  it('does not expose skipped topics as interview topics unless allowed', () => {
    const candidate = getCandidate('cand-001', candidates);
    const defaultContext = buildCandidateContext(candidate, curriculum);
    const allowedContext = buildCandidateContext(candidate, curriculum, { allowSkipped: true });

    expect(defaultContext.interviewTopics.some((topic) => topic.day === 3)).toBe(false);
    expect(allowedContext.interviewTopics.some((topic) => topic.day === 3)).toBe(true);
  });
});
