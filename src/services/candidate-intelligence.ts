import { CandidateNotFoundError } from '../errors/candidate';
import { getCandidatesData, getCurriculumData } from './candidate-data';
import {
  Candidate,
  CandidatesFile,
  LearningSignals,
  Mission,
  MissionAttempt,
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
  score?: number;
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

function bestAttemptScore(mission: Mission): number | undefined {
  const scores = mission.attempts
    .map((attempt) => attempt.score)
    .filter((score): score is number => typeof score === 'number');

  if (scores.length === 0) {
    return undefined;
  }

  return Math.max(...scores);
}

function missionPriority(mission: Mission): number {
  const score = bestAttemptScore(mission);

  if (mission.status === 'failed') {
    return 200 - (score ?? 0);
  }

  if (mission.status === 'completed') {
    return 100 + (score ?? 0);
  }

  if (mission.status === 'skipped') {
    return 10;
  }

  return 0;
}

function selectionReason(mission: Mission): string {
  if (mission.status === 'failed') {
    return 'Failed mission — probe fundamentals and misconceptions';
  }

  if (mission.status === 'completed') {
    return 'Completed mission — validate depth and increase difficulty';
  }

  return 'Skipped mission — included by explicit controller override';
}

export function getCandidate(
  candidateId: string,
  candidates: CandidatesFile = getCandidatesData()
): Candidate {
  const candidate = candidates.candidates.find((entry) => entry.id === candidateId);
  if (!candidate) {
    throw new CandidateNotFoundError(candidateId);
  }
  return candidate;
}

export function getCompletedMissions(candidate: Candidate): Mission[] {
  return candidate.missions.filter((mission) => mission.status === 'completed');
}

export function getSkippedMissions(candidate: Candidate): Mission[] {
  return candidate.missions.filter((mission) => mission.status === 'skipped');
}

export function getFailedMissions(candidate: Candidate): Mission[] {
  return candidate.missions.filter((mission) => mission.status === 'failed');
}

export function getAttempts(candidate: Candidate): MissionAttempt[] {
  return candidate.missions.flatMap((mission) => mission.attempts);
}

export function getLearningSignals(candidate: Candidate): LearningSignals[] {
  return candidate.missions
    .map((mission) => mission.learningSignals)
    .filter((signals): signals is LearningSignals => signals !== undefined);
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
    .filter((mission) => eligibleStatuses.has(mission.status))
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
      if (mission.status === 'completed' || mission.status === 'failed') {
        return true;
      }
      return options.allowSkipped === true && mission.status === 'skipped';
    })
    .sort((a, b) => missionPriority(b) - missionPriority(a));

  const selected: SelectedInterviewTopic[] = [];
  const usedDays = new Set<number>();

  for (const mission of eligibleMissions) {
    if (usedDays.has(mission.day)) {
      continue;
    }

    const topic = toCurriculumTopic(mission, curriculum);
    selected.push({
      day: topic.day,
      title: topic.title,
      objectives: topic.objectives,
      reason: selectionReason(mission),
    });
    usedDays.add(mission.day);

    if (usedDays.size >= minDistinctDays) {
      break;
    }
  }

  for (const mission of eligibleMissions) {
    if (selected.length >= maxTopics) {
      break;
    }

    if (usedDays.has(mission.day)) {
      continue;
    }

    const topic = toCurriculumTopic(mission, curriculum);
    selected.push({
      day: topic.day,
      title: topic.title,
      objectives: topic.objectives,
      reason: selectionReason(mission),
    });
    usedDays.add(mission.day);
  }

  for (const mission of eligibleMissions) {
    if (selected.length >= maxTopics) {
      break;
    }

    const alreadySelected = selected.some(
      (topic) => topic.day === mission.day && topic.title === mission.title
    );
    if (alreadySelected) {
      continue;
    }

    const topic = toCurriculumTopic(mission, curriculum);
    selected.push({
      day: topic.day,
      title: topic.title,
      objectives: topic.objectives,
      reason: selectionReason(mission),
    });
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

  const learningSignals = candidate.missions
    .filter((mission) => mission.learningSignals)
    .slice(0, MAX_SIGNALS_IN_CONTEXT)
    .map((mission) => ({
      day: mission.day,
      missionTitle: mission.title,
      strengths: mission.learningSignals?.strengths ?? [],
      gaps: mission.learningSignals?.gaps ?? [],
    }));

  const recentAttempts = candidate.missions
    .flatMap((mission) =>
      mission.attempts.map((attempt) => ({
        day: mission.day,
        missionTitle: mission.title,
        attemptNumber: attempt.attemptNumber,
        score: attempt.score,
        passed: attempt.passed,
        completedAt: attempt.completedAt,
      }))
    )
    .sort((a, b) => {
      const aTime = a.completedAt ? Date.parse(a.completedAt) : 0;
      const bTime = b.completedAt ? Date.parse(b.completedAt) : 0;
      return bTime - aTime;
    })
    .slice(0, MAX_ATTEMPTS_IN_CONTEXT)
    .map(({ day, missionTitle, attemptNumber, score, passed }) => ({
      day,
      missionTitle,
      attemptNumber,
      score,
      passed,
    }));

  return {
    candidateId: candidate.id,
    name: candidate.name,
    role: candidate.role,
    experience: candidate.experience,
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
