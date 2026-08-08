import { z } from 'zod';

export const InterviewTopicSchema = z.object({
  day: z.number(),
  title: z.string(),
});

export const InterviewAssessmentSchema = z.object({
  score: z.number().describe("A score between 0 and 10 based on the candidate's answer."),
  level: z.enum(['weak', 'developing', 'strong', 'excellent']),
  reason: z.string().describe("A brief explanation for the given score and level."),
});

export const InterviewFeedbackSchema = z.object({
  summary: z.string(),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  next: z.array(z.string()),
});

export const InterviewDecisionSchema = z.object({
  assessment: InterviewAssessmentSchema,
  nextAction: z.enum(['followup', 'new_topic', 'finish']),
  nextQuestion: z.string().nullable().describe("The next question to ask, if action is not finish."),
  topic: InterviewTopicSchema.nullable().describe("The topic of the next question."),
  feedback: InterviewFeedbackSchema.nullable().describe("Feedback is provided when nextAction is 'finish'."),
});

export type InterviewTopic = z.infer<typeof InterviewTopicSchema>;
export type InterviewAssessment = z.infer<typeof InterviewAssessmentSchema>;
export type InterviewFeedback = z.infer<typeof InterviewFeedbackSchema>;
export type InterviewDecision = z.infer<typeof InterviewDecisionSchema>;

export interface GeminiGenerationOptions {
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
}
