import { InterviewDecision, InterviewDecisionSchema } from '../types/interview.js';

// ─── Retry Configuration ─────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('rate limit') ||
      msg.includes('quota') ||
      msg.includes('503') ||
      msg.includes('429') ||
      msg.includes('timeout') ||
      msg.includes('network') ||
      msg.includes('502')
    );
  }
  return false;
}

// ─── LLM Service (OpenRouter Implementation) ─────────────────────────────────

export interface GenerateInterviewDecisionParams {
  systemPrompt: string;
  userContext: string;
  temperature?: number;
}

export interface GeminiService {
  generateText(prompt: string): Promise<string>;
  generateInterviewDecision(params: GenerateInterviewDecisionParams): Promise<InterviewDecision>;
}

class OpenRouterServiceImpl implements GeminiService {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async generateText(prompt: string): Promise<string> {
    return this.withRetry(async () => {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:3000',
          'X-Title': 'Interview Agent'
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 2048
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as any;
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw new Error('Empty response from OpenRouter');
      
      return text;
    });
  }

  async generateInterviewDecision(
    params: GenerateInterviewDecisionParams
  ): Promise<InterviewDecision> {
    return this.withRetry(async () => {
      const fullPrompt = `${params.systemPrompt}\n\n${params.userContext}\n\nRespond with a JSON object matching this exact schema:\n{\n  "assessment": {\n    "score": <number 0-10>,\n    "level": "<weak|developing|strong|excellent>",\n    "reason": "<brief explanation>"\n  },\n  "nextAction": "<followup|new_topic|finish>",\n  "nextQuestion": "<question string or empty string>",\n  "topic": {\n    "day": <number>,\n    "title": "<topic title>"\n  },\n  "feedback": null\n}\n\nIf nextAction is "finish", include feedback:\n{\n  "feedback": {\n    "summary": "<overall summary>",\n    "strengths": ["<strength>"],\n    "gaps": ["<gap>"],\n    "next": ["<recommendation>"]\n  }\n}\n\nReturn ONLY valid JSON. No markdown fences. No extra text.`;

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:3000',
          'X-Title': 'Interview Agent'
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: fullPrompt }],
          temperature: params.temperature ?? 0.7,
          max_tokens: 2048
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as any;
      const raw = data.choices?.[0]?.message?.content;
      if (!raw) throw new Error('Empty response from OpenRouter');

      return this.parseAndValidateDecision(raw);
    });
  }

  private parseAndValidateDecision(raw: string): InterviewDecision {
    // Strip any accidental markdown fences
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error(`LLM returned invalid JSON: ${cleaned.slice(0, 200)}`);
    }

    const result = InterviewDecisionSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `LLM response failed schema validation: ${result.error.message}`
      );
    }

    return result.data;
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (!isTransientError(error) || attempt === MAX_RETRIES - 1) {
          break;
        }
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        await sleep(delay);
      }
    }
    throw lastError;
  }
}

// ─── Singleton factory ────────────────────────────────────────────────────────

let instance: GeminiService | null = null;

// Keep the exported function name the same so we don't break existing controllers
export function getGeminiService(): GeminiService {
  if (!instance) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY is not set in environment variables');
    }
    const model = process.env.OPENROUTER_MODEL ?? 'mistralai/mistral-7b-instruct:free';
    instance = new OpenRouterServiceImpl(apiKey, model);
  }
  return instance;
}

export function resetGeminiService(): void {
  instance = null;
}
