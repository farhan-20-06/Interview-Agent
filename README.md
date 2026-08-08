# AI Interview Agent - Gemini Wrapper

This directory contains the Gemini wrapper service for the AI Interview Agent backend.

## Configuration

1. Copy the `.env.example` file to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Set your `GEMINI_API_KEY` and `GEMINI_MODEL` (default: `gemini-2.5-flash`) in the `.env` file.

## Features

- **Robust Retry**: Configurable exponential backoff on transient errors.
- **Type Safety**: Full Zod schema validation for structured JSON generation.
- **Interview Logic**: Encapsulated system prompts and context formatting to keep prompts small and focused.
- **Security**: Designed specifically for backend to prevent leaking API keys to client-side apps.

## Scripts

- **Test**: Run `npm test` to execute the vitest suite (API calls are safely mocked).
- **Build**: Run `npx tsc` to compile TypeScript to JavaScript.

## Example Usage

```typescript
import { getGeminiService } from './src/services/gemini';
import { InterviewDecisionSchema } from './src/types/interview';

// The service automatically reads from process.env.GEMINI_API_KEY
const gemini = getGeminiService();

// Simple text generation
const text = await gemini.generateText("Explain embeddings simply.");

// Structured interview decision
const decision = await gemini.generateInterviewDecision({
  candidate: { role: 'AI Engineer' },
  completedTopics: ['Day 7 - Embeddings', 'Day 8 - Vector Databases'],
  currentTopic: 'Day 10 - Retrieval Engine',
  objectives: ['Test retrieval knowledge'],
  history: [], // previous Q&A
  currentQuestionNumber: 1,
  coveredDays: [7, 8, 10]
});
console.log(decision.assessment.score);
```