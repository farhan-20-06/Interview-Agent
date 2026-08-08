import { z } from 'zod';

export const MissionStatusSchema = z.enum([
  'completed',
  'skipped',
  'failed',
  'in_progress',
  'not_started',
]);

export const MissionAttemptSchema = z.object({
  attemptNumber: z.number().int().positive(),
  score: z.number().optional(),
  passed: z.boolean().optional(),
  completedAt: z.string().optional(),
  durationMinutes: z.number().optional(),
});

export const LearningSignalsSchema = z.object({
  strengths: z.array(z.string()).default([]),
  gaps: z.array(z.string()).default([]),
  engagement: z.string().optional(),
  notes: z.array(z.string()).default([]),
});

export const MissionSchema = z.object({
  day: z.number().int().positive(),
  missionId: z.string(),
  title: z.string(),
  status: MissionStatusSchema,
  attempts: z.array(MissionAttemptSchema).default([]),
  learningSignals: LearningSignalsSchema.optional(),
});

export const CandidateSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  experience: z.string(),
  cohort: z.string().optional(),
  missions: z.array(MissionSchema).default([]),
});

export const CandidatesFileSchema = z.object({
  candidates: z.array(CandidateSchema),
});

export type MissionStatus = z.infer<typeof MissionStatusSchema>;
export type MissionAttempt = z.infer<typeof MissionAttemptSchema>;
export type LearningSignals = z.infer<typeof LearningSignalsSchema>;
export type Mission = z.infer<typeof MissionSchema>;
export type Candidate = z.infer<typeof CandidateSchema>;
export type CandidatesFile = z.infer<typeof CandidatesFileSchema>;
