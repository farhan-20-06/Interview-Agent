import { CandidateNotFoundError } from '../errors/candidate';
import { getCandidatesData, getCurriculumData } from './candidate-data';
import {
  Candidate,
  CandidatesFile,
  Mission,
  getMissionStatus,
} from '../types/candidate';
import { Curriculum, CurriculumTopic } from '../types/curriculum';

export interface CompactTopic {
  day: number;
  title: string;
}

export interface SelectedInterviewTopic extends CompactTopic {
  objectives: string[];
  reason: string;
}

export interface CompactAttempt {
  day: number;
  missionTitle: string;
  attemptNumber: number;
  passed?: boolean;
}

export interface CompactLearningSignal {
  day: number;
  missionTitle: string;
  strengths: string[];
  gaps: string[];
}

export interface CandidateContext {
  candidateId: string;
  name: string;
  role: string;
  experience: string;
  stats: {
    completed: number;
    skipped: number;
    failed: number;
  };
  completedTopics: CompactTopic[];
  failedTopics: CompactTopic[];
  skippedTopics: CompactTopic[];
  interviewTopics: SelectedInterviewTopic[];
  learningSignals: CompactLearningSignal[];
  recentAttempts: CompactAttempt[];
}

export interface SelectInterviewTopicsOptions {
  allowSkipped?: boolean;
  maxTopics?: number;
  minDistinctDays?: number;
}

const DEFAULT_MAX_TOPICS = 8;
const DEFAULT_MIN_DAYS = 4;
const MAX_SIGNALS_IN_CONTEXT = 5;
const MAX_ATTEMPTS_IN_CONTEXT = 5;

function findCurriculumDay(curriculum: Curriculum, day: number) {
  return curriculum.days.find((entry) => entry.day === day);
}

function toCurriculumTopic(mission: Mission, curriculum: Curriculum): CurriculumTopic {
  const dayEntry = findCurriculumDay(curriculum, mission.day);
  return {
    day: mission.day,
    title: dayEntry?.title ?? mission.title,
    objectives: dayEntry?.objectives ?? [],
    topics: dayEntry?.topics ?? [],
  };
}

function missionPriority(mission: Mission): number {
  const status = getMissionStatus(mission);
  const attempts = mission.attempts ?? 1;

  if (status === 'failed') {
    // Higher priority for more attempts (signals more struggle)
    return 200 + Math.min(attempts, 5);
  }

  if (status === 'completed') {
    // Fewer attempts = stronger completion; still prioritized for depth probing
    return 100 + Math.max(0, 5 - attempts);
  }

  if (status === 'skipped') {
    return 10;
  }

  return 0;
}

function selectionReason(mission: Mission): string {
  const status = getMissionStatus(mission);
  const attempts = mission.attempts ?? 1;

  if (status === 'failed') {
    return `Failed mission (${attempts} attempt${attempts > 1 ? 's' : ''}) — probe fundamentals and misconceptions`;
  }

  if (status === 'completed') {
    if (attempts > 2) {
      return `Completed mission (took ${attempts} attempts) — validate depth and probe struggled areas`;
    }
    return 'Completed mission — validate depth and increase difficulty';
  }

  return 'Skipped mission — included by explicit controller override';
}

export function getCandidate(
  candidateId: string,
  candidates: CandidatesFile = getCandidatesData()
): Candidate {
  const candidate = candidates.candidates.find((entry) => entry.member.id === candidateId);
  if (!candidate) {
    throw new CandidateNotFoundError(candidateId);
  }
  return candidate;
}

export function getCompletedMissions(candidate: Candidate): Mission[] {
  return candidate.missions.filter((m) => getMissionStatus(m) === 'completed');
}

export function getSkippedMissions(candidate: Candidate): Mission[] {
  return candidate.missions.filter((m) => getMissionStatus(m) === 'skipped');
}

export function getFailedMissions(candidate: Candidate): Mission[] {
  return candidate.missions.filter((m) => getMissionStatus(m) === 'failed');
}

export function getAttempts(
  candidate: Candidate
): CompactAttempt[] {
  return candidate.missions
    .filter((m) => !m.skipped && m.attempts !== undefined && m.attempts > 0)
    .flatMap((m) => {
      const count = m.attempts!;
      const status = getMissionStatus(m);
      return Array.from({ length: count }, (_, i) => ({
        day: m.day,
        missionTitle: m.title,
        attemptNumber: i + 1,
        // Only the final attempt reflects the pass/fail outcome
        passed: i + 1 === count ? status === 'completed' : undefined,
      }));
    });
}

export function getLearningSignals(candidate: Candidate): CompactLearningSignal[] {
  const signals: CompactLearningSignal[] = [];

  for (const mission of candidate.missions) {
    const status = getMissionStatus(mission);
    const attempts = mission.attempts ?? 0;
    const strengths: string[] = [];
    const gaps: string[] = [];

    if (status === 'completed' && attempts === 1) {
      strengths.push(`Passed on first attempt`);
    } else if (status === 'completed' && attempts >= 3) {
      gaps.push(`Required ${attempts} attempts before passing`);
    }

    if (status === 'failed') {
      gaps.push(`Did not pass despite ${attempts} attempt${attempts > 1 ? 's' : ''} — probe fundamentals`);
    }

    if (strengths.length > 0 || gaps.length > 0) {
      signals.push({ day: mission.day, missionTitle: mission.title, strengths, gaps });
    }
  }

  return signals;
}

export function getCompletedTopics(
  candidate: Candidate,
  curriculum: Curriculum
): CurriculumTopic[] {
  return getCompletedMissions(candidate).map((mission) => toCurriculumTopic(mission, curriculum));
}

export function getSkippedTopics(
  candidate: Candidate,
  curriculum: Curriculum
): CurriculumTopic[] {
  return getSkippedMissions(candidate).map((mission) => toCurriculumTopic(mission, curriculum));
}

export function getFailedTopics(
  candidate: Candidate,
  curriculum: Curriculum
): CurriculumTopic[] {
  return getFailedMissions(candidate).map((mission) => toCurriculumTopic(mission, curriculum));
}

export function getEligibleTopics(
  candidate: Candidate,
  curriculum: Curriculum,
  options: Pick<SelectInterviewTopicsOptions, 'allowSkipped'> = {}
): CurriculumTopic[] {
  const eligibleStatuses = new Set(['completed', 'failed']);
  if (options.allowSkipped) {
    eligibleStatuses.add('skipped');
  }

  return candidate.missions
    .filter((mission) => eligibleStatuses.has(getMissionStatus(mission)))
    .sort((a, b) => a.day - b.day)
    .map((mission) => toCurriculumTopic(mission, curriculum));
}

export function selectInterviewTopics(
  candidate: Candidate,
  curriculum: Curriculum,
  options: SelectInterviewTopicsOptions = {}
): SelectedInterviewTopic[] {
  const maxTopics = options.maxTopics ?? DEFAULT_MAX_TOPICS;
  const minDistinctDays = options.minDistinctDays ?? DEFAULT_MIN_DAYS;

  const eligibleMissions = candidate.missions
    .filter((mission) => {
      const status = getMissionStatus(mission);
      if (status === 'completed' || status === 'failed') return true;
      return options.allowSkipped === true && status === 'skipped';
    })
    .sort((a, b) => missionPriority(b) - missionPriority(a));

  const selected: SelectedInterviewTopic[] = [];
  const usedDays = new Set<number>();

  for (const mission of eligibleMissions) {
    if (usedDays.has(mission.day)) continue;

    const topic = toCurriculumTopic(mission, curriculum);
    selected.push({
      day: topic.day,
      title: topic.title,
      objectives: topic.objectives,
      reason: selectionReason(mission),
    });
    usedDays.add(mission.day);

    if (usedDays.size >= minDistinctDays) break;
  }

  for (const mission of eligibleMissions) {
    if (selected.length >= maxTopics) break;
    if (usedDays.has(mission.day)) continue;

    const topic = toCurriculumTopic(mission, curriculum);
    selected.push({
      day: topic.day,
      title: topic.title,
      objectives: topic.objectives,
      reason: selectionReason(mission),
    });
    usedDays.add(mission.day);
  }

  return selected.sort((a, b) => a.day - b.day);
}

export function buildCandidateContext(
  candidate: Candidate,
  curriculum: Curriculum,
  options: SelectInterviewTopicsOptions = {}
): CandidateContext {
  const completedTopics = getCompletedTopics(candidate, curriculum).map(({ day, title }) => ({
    day,
    title,
  }));
  const failedTopics = getFailedTopics(candidate, curriculum).map(({ day, title }) => ({
    day,
    title,
  }));
  const skippedTopics = getSkippedTopics(candidate, curriculum).map(({ day, title }) => ({
    day,
    title,
  }));

  const learningSignals = getLearningSignals(candidate).slice(0, MAX_SIGNALS_IN_CONTEXT);

  const recentAttempts = getAttempts(candidate).slice(0, MAX_ATTEMPTS_IN_CONTEXT);

  return {
    candidateId: candidate.member.id,
    name: candidate.member.name,
    role: candidate.member.jobRole,
    experience: `${candidate.member.yearsExperience} years`,
    stats: {
      completed: getCompletedMissions(candidate).length,
      skipped: getSkippedMissions(candidate).length,
      failed: getFailedMissions(candidate).length,
    },
    completedTopics,
    failedTopics,
    skippedTopics,
    interviewTopics: selectInterviewTopics(candidate, curriculum, options),
    learningSignals,
    recentAttempts,
  };
}
