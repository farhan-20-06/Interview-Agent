import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { CandidatesFile, CandidatesFileSchema } from '../types/candidate';
import { Curriculum, CurriculumSchema } from '../types/curriculum';
import { CandidateDataError } from '../errors/candidate';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const DEFAULT_CANDIDATES_PATH = resolve(projectRoot, 'data/candidates (1).json');
const DEFAULT_CURRICULUM_PATH = resolve(projectRoot, 'data/curriculum (2).json');

let cachedCandidates: CandidatesFile | null = null;
let cachedCurriculum: Curriculum | null = null;

function readJsonFile(path: string): unknown {
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown read error';
    throw new CandidateDataError(`Failed to read data file at ${path}: ${message}`);
  }
}

export function loadCandidates(filePath: string = DEFAULT_CANDIDATES_PATH): CandidatesFile {
  const parsed = CandidatesFileSchema.safeParse(readJsonFile(filePath));
  if (!parsed.success) {
    throw new CandidateDataError(`Invalid candidates.json structure: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function loadCurriculum(filePath: string = DEFAULT_CURRICULUM_PATH): Curriculum {
  const parsed = CurriculumSchema.safeParse(readJsonFile(filePath));
  if (!parsed.success) {
    throw new CandidateDataError(`Invalid curriculum.json structure: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function getCandidatesData(filePath?: string): CandidatesFile {
  if (!filePath && cachedCandidates) {
    return cachedCandidates;
  }

  const data = loadCandidates(filePath ?? DEFAULT_CANDIDATES_PATH);
  if (!filePath) {
    cachedCandidates = data;
  }
  return data;
}

export function getCurriculumData(filePath?: string): Curriculum {
  if (!filePath && cachedCurriculum) {
    return cachedCurriculum;
  }

  const data = loadCurriculum(filePath ?? DEFAULT_CURRICULUM_PATH);
  if (!filePath) {
    cachedCurriculum = data;
  }
  return data;
}

export function resetCandidateDataCache(): void {
  cachedCandidates = null;
  cachedCurriculum = null;
}
