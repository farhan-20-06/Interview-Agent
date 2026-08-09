import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import { interviewHandler } from './controllers/interview.js';

const app = express();
const PORT = process.env.PORT ?? 3000;

import path from 'path';
import { getCandidatesData, getCurriculumData } from './services/candidate-data.js';

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

// ─── Routes ───────────────────────────────────────────────────────────────────

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Candidates endpoint (for UI selection without exposing internal attempt scores)
app.get('/api/candidates', (_req: Request, res: Response) => {
  try {
    const data = getCandidatesData();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Curriculum endpoint
app.get('/api/curriculum', (_req: Request, res: Response) => {
  try {
    const data = getCurriculumData();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Interview endpoint
app.post('/api/interview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await interviewHandler(req, res);
  } catch (err) {
    next(err);
  }
});

// ─── Error Handler ────────────────────────────────────────────────────────────

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Unhandled error]', err);
  // Never expose stack traces or API keys
  const message = err instanceof Error ? err.message : 'Internal server error';
  const safe = message.replace(/api[_-]?key[^\s]*/gi, '[REDACTED]');
  res.status(500).json({ error: safe });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Interview Agent running on http://localhost:${PORT}`);
  console.log(`  POST /api/interview   — start or continue an interview`);
  console.log(`  GET  /api/health      — health check`);
});

export default app;
