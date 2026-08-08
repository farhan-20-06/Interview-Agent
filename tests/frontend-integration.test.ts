import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'http';
import { getCandidatesData, getCurriculumData } from '../src/services/candidate-data.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.get('/api/candidates', (_req, res) => {
  res.json(getCandidatesData());
});

app.get('/api/curriculum', (_req, res) => {
  res.json(getCurriculumData());
});

describe('Frontend Static Serving & Candidates Endpoint', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          baseUrl = `http://localhost:${address.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(() => {
    server.close();
  });

  it('serves static index.html', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('AI Technical Interview Agent');
    expect(text).toContain('Practice Technical Interviews');
  });

  it('serves static styles.css', async () => {
    const res = await fetch(`${baseUrl}/styles.css`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('--bg-dark');
  });

  it('serves static app.js', async () => {
    const res = await fetch(`${baseUrl}/app.js`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('AI Technical Interview Agent');
  });

  it('returns candidate profiles via GET /api/candidates', async () => {
    const res = await fetch(`${baseUrl}/api/candidates`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.candidates).toBeDefined();
    expect(body.candidates.length).toBeGreaterThan(0);
    expect(body.candidates[0].name).toBe('Alex Chen');
  });

  it('returns curriculum via GET /api/curriculum', async () => {
    const res = await fetch(`${baseUrl}/api/curriculum`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.days).toBeDefined();
    expect(body.days.length).toBeGreaterThan(0);
  });
});

