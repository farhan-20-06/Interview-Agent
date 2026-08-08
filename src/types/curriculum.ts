import { z } from 'zod';

export const CurriculumDaySchema = z.object({
  day: z.number().int().positive(),
  title: z.string(),
  type: z.string().optional(),
  tools: z.array(z.string()).default([]),
  objectives: z.array(z.string()).default([]),
  topics: z.array(z.string()).default([]),
});

export const CurriculumSchema = z.object({
  program: z.string().optional(),
  cohort: z.string().optional(),
  modules: z.array(z.any()).optional(),
  days: z.array(CurriculumDaySchema),
});

export type CurriculumDay = z.infer<typeof CurriculumDaySchema>;
export type Curriculum = z.infer<typeof CurriculumSchema>;

export interface CurriculumTopic {
  day: number;
  title: string;
  objectives: string[];
  topics: string[];
}
