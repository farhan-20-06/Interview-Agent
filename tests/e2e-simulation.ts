import fs from 'fs';
import path from 'path';

const candDataPath = path.resolve(process.cwd(), 'data/candidates (1).json');
const candidates = JSON.parse(fs.readFileSync(candDataPath, 'utf8')).candidates;
const cand001 = candidates.find((c: any) => c.member.id === 'CAND-001');

const API_URL = 'http://localhost:3000/api/interview';

async function runScenario(scenarioName: string, sessionId: string, answers: string[]) {
  console.log(`\n======================================================`);
  console.log(`🚀 STARTING SCENARIO: ${scenarioName} (Session: ${sessionId})`);
  console.log(`======================================================\n`);

  const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

  // Start interview
  let response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, candidate: cand001 })
  });

  let data = await response.json();
  if (!response.ok) {
    console.error('Error starting interview:', data);
    return;
  }
  console.log(`[Interviewer (Start)]:\n${data.reply}\n`);
  
  let turnCount = 0;
  for (const answer of answers) {
    if (data.done) {
      console.log(`[Interviewer FINISHED EARLY]`);
      break;
    }

    turnCount++;
    console.log(`[Candidate Turn ${turnCount}]:\n${answer}\n`);

    response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message: answer })
    });

    data = await response.json();
    if (!response.ok) {
      console.error('Error during interview turn:', data);
      break;
    }

    console.log(`[Interviewer (Turn ${turnCount})]:\n${data.reply}\n`);

    if (data.done) {
      console.log(`\n[FINAL FEEDBACK]:`);
      console.log(JSON.stringify(data.feedback, null, 2));
      break;
    }
  }
}

const strongAnswers = [
  "I would use a two-tower neural network to encode both queries and documents into dense vectors, and then use cosine similarity to retrieve the most relevant documents. For the index, I'd use HNSW because it provides a good trade-off between recall and latency.",
  "To handle scale, I would partition the HNSW index across multiple nodes. I'd also implement an asynchronous indexing pipeline where updates are written to a message queue and processed by a pool of workers.",
  "For evaluation, I would use offline metrics like nDCG and Recall@K based on a human-annotated dataset. Online, I would run A/B tests and track implicit feedback like click-through rates.",
  "I prefer sentence-transformers like all-MiniLM for their efficiency, but if accuracy is paramount, I might use a larger model like BGE or OpenAI's embeddings.",
  "To optimize latency, I could use quantization (like int8 or binary embeddings) or use an optimized inference engine like TensorRT.",
  "Prompt engineering is crucial. I would structure my prompts with clear instructions, few-shot examples, and XML tags to separate the context from the instructions.",
  "For chaining, I might use an agentic framework where a planner model decides the steps, and worker models execute them. I'd keep track of state in memory.",
  "To prevent hallucinations, I'd ground the generation purely on the retrieved context using a strict system prompt and implement an evaluation step using a judge LLM.",
  "I'd handle API failures with exponential backoff retries and circuit breakers to ensure robustness.",
  "Yes, I believe that covers my approach to building a reliable retrieval system."
];

const weakAnswers = [
  "I would just put the text in a database and search it.",
  "What is a vector database?",
  "I guess you could use a for loop to check every document?",
  "Embeddings are just numbers, right?",
  "I don't really know how to make it faster.",
  "I usually just ask ChatGPT and copy the answer.",
  "Prompt engineering means writing good questions.",
  "I haven't used any agents before.",
  "I don't know how to stop hallucinations.",
  "That's all I know."
];

async function main() {
  await runScenario('SCENARIO A: Strong Answers', 'sim-strong-session', strongAnswers);
  await runScenario('SCENARIO B: Weak Answers', 'sim-weak-session', weakAnswers);
}

main().catch(console.error);
