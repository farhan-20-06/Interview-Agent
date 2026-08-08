import { z } from 'zod';

// ─── Real Data Schema (matches candidates (1).json) ──────────────────────────

export const MissionSchema = z.object({
  day: z.number().int().positive(),
  title: z.string(),
  passed: z.boolean().optional(),
  attempts: z.number().int().min(0).optional(),
  skipped: z.boolean().optional(),
});

export const MemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  jobRole: z.string(),
  yearsExperience: z.number().default(0),
  education: z.string().optional(),
  status: z.string().optional(),
});

export const SignalsSchema = z.object({
  commitDays: z.number().optional(),
  missionsCompleted: z.number().optional(),
  missionsFirstTry: z.number().optional(),
});

export const CandidateSchema = z.object({
  member: MemberSchema,
  missions: z.array(MissionSchema).default([]),
  signals: SignalsSchema.optional(),
});

export const CandidatesFileSchema = z.object({
  candidates: z.array(CandidateSchema),
});

export type Mission = z.infer<typeof MissionSchema>;
export type Member = z.infer<typeof MemberSchema>;
export type Signals = z.infer<typeof SignalsSchema>;
export type Candidate = z.infer<typeof CandidateSchema>;
export type CandidatesFile = z.infer<typeof CandidatesFileSchema>;

// ─── Helper: Derive mission status from real data fields ─────────────────────

export type MissionStatus = 'completed' | 'failed' | 'skipped' | 'in_progress';

export function getMissionStatus(mission: Mission): MissionStatus {
  if (mission.skipped === true) return 'skipped';
  if (mission.passed === true) return 'completed';
  if (mission.passed === false) return 'failed';
  return 'in_progress';
}
