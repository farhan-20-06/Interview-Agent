import { z } from 'zod';

export const InterviewTopicSchema = z.object({
  day: z.number(),
  title: z.string(),
});

export const InterviewAssessmentSchema = z.object({
  score: z.number().describe("A score between 0 and 10 based on the candidate's answer."),
  level: z.enum(['weak', 'developing', 'strong', 'excellent']),
  reason: z.string().describe("A brief explanation for the given score and level."),
  quality: z.enum(['strong', 'partial', 'weak']).optional().describe("Quality of the candidate's answer."),
  confidence: z.enum(['high', 'medium', 'low']).optional().describe("Confidence level of the candidate's answer."),
  gaps: z.array(z.string()).optional().describe("Key conceptual or practical gaps identified in this answer."),
});

export const InterviewFeedbackSchema = z.object({
  summary: z.string(),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  next: z.array(z.string()),
});

export const InterviewDecisionSchema = z.object({
  comment: z.string().optional().describe("A short, natural reaction comment to the candidate's last response (1-2 sentences), directly addressed to the candidate."),
  assessment: InterviewAssessmentSchema,
  nextAction: z.enum(['followup', 'new_topic', 'finish']),
  nextQuestion: z.string().nullable().describe("The next question to ask, if action is not finish."),
  topic: InterviewTopicSchema.nullable().describe("The topic of the next question."),
  feedback: InterviewFeedbackSchema.nullable().describe("Feedback is provided when nextAction is 'finish'."),
});

export type InterviewTopic = z.infer<typeof InterviewTopicSchema>;
export type InterviewAssessment = z.infer<typeof InterviewAssessmentSchema>;
export type InterviewDecision = z.infer<typeof InterviewDecisionSchema>;

export type CompletionStatus = 'completed' | 'ended_early' | 'no_answers' | 'error';

/** API feedback payload — base fields from LLM plus server-enriched metadata. */
export type InterviewFeedback = z.infer<typeof InterviewFeedbackSchema> & {
  completionStatus?: CompletionStatus;
  isPartial?: boolean;
  questionsAnswered?: number;
  topicsAssessed?: string[];
  topicsNotAssessed?: string[];
  /** Average score across answered questions only; null when no answers exist. */
  overallScore?: number | null;
};

export interface GeminiGenerationOptions {
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
}
