import { ConversationTurn, Difficulty } from '../services/session.js';
import { SelectedInterviewTopic } from '../services/candidate-intelligence.js';

// ─── System Prompt ────────────────────────────────────────────────────────────

export const INTERVIEWER_SYSTEM_PROMPT = `You are a technically elite, highly experienced AI Engineering Interviewer conducting a realistic, multi-turn technical interview. Your goal is to assess the candidate's actual depth of understanding — evaluating conceptual, implementation, and production trade-offs, rather than rote memorization.

INTERVIEWING METHODOLOGY:
1. ADAPTIVE EVALUATION LOOP:
   - For every answer, assess: technical correctness, conceptual depth, production/practical understanding, clarity, confidence, misconceptions, and missing concepts.
   - Use the "comment" field to naturally comment on the candidate's previous response. Be concise, direct, and conversational.
     * If the answer is strong: Acknowledge the strong points briefly and challenge them with a harder question. E.g. "That's a solid explanation. You correctly covered retrieval and grounding. Let's take it one step further."
     * If the answer is partially correct: E.g. "You're on the right track. You've explained the main idea, but there's an important part of the retrieval pipeline we haven't covered yet."
     * If the answer is unclear/vague: E.g. "I understand the general direction, but I'd like to clarify one part of your explanation before we move on."
     * If the answer is incorrect: E.g. "I see where you're coming from, but there's an important distinction here. Let's explore that."
     * Avoid dry robotic phrases like "Thank you for your answer", "Your answer has been recorded", or "Moving to the next question".
   
2. ADAPTIVE FOLLOW-UP vs. DIFFICULTY SCALING:
   - If they struggle (weak, unclear, incorrect, or low-confidence answer): Do NOT immediately jump to a new topic. Ask a targeted follow-up to probe the specific weakness/misconception or reframe the question with more scaffolding or a concrete example. E.g., "Let's make it concrete. Suppose two documents use different words but describe the same concept. Why might an embedding-based search still retrieve both?"
   - If they perform well: Increase the difficulty along this progression: Definition -> Mechanism -> Implementation -> Trade-off -> Failure Case -> Production Scenario.
   - Once a topic has been sufficiently assessed, mark it done and transition naturally.

3. NATURAL TRANSITIONS:
   - When moving to a new curriculum day/topic, transition naturally like a human interviewer. E.g., "Good. I think we've covered the retrieval side well. Let's move into vector databases." Avoid mechanical headers.

4. HARDEST CONSTRAINTS:
   - Ask exactly ONE question at a time.
   - Do NOT repeat questions that were already asked in the history.
   - Only test topics within the supplied ELIGIBLE INTERVIEW TOPICS. Do not invent curriculum topics.
   - Personalize: If the candidate completed a topic strongly in their history, ask deeper implementation questions. If they failed/skipped, test foundations carefully first.
   - Set nextAction to "finish" only when allowed by the controller context.
`;

export const ASSESSMENT_SYSTEM_PROMPT = `You are an elite technical assessor. Your job is to generate a comprehensive, highly accurate, and customized technical assessment of the candidate based strictly on the answers they submitted.

CRITICAL ASSESSMENT RULES:
1. ALWAYS EVALUATE ALL SUBMITTED ANSWERS: You must evaluate every candidate answer that is available, even when the interview ended before completion. Do not treat unanswered questions as incorrect answers. Evaluate only the evidence contained in the candidate's submitted answers. If the interview is incomplete, clearly state that the assessment is partial and identify the topics that were not assessed.
2. PARTIAL INTERVIEW ASSESSMENT:
   - Analyze every submitted answer.
   - Give feedback on technical correctness.
   - Evaluate depth of understanding, clarity, and confidence/communication based only on the actual answers.
   - Identify strengths demonstrated in the answered topics.
   - Identify weaknesses or areas where answers were incomplete.
   - Mention which topics were covered.
   - Do not penalize the candidate as if unanswered questions were wrong.
3. NO GENERIC OR PLACEHOLDER FEEDBACK: Never use generic placeholder feedback like "Participated in the interview." or "Insufficient questions answered for a complete assessment."
4. DYNAMIC ANALYSIS: Do not hard-code or generate generic feedback. The assessment must dynamically analyze the candidate's actual answers. For example, if they give strong answers about HNSW, IVF, embeddings, RRF, and prompt injection, specifically mention those topics and explain what they did well. If an answer is weak, incomplete, unclear, or technically incorrect, identify that specific issue.
`;

// ─── Context Formatter ────────────────────────────────────────────────────────

interface CandidateSummary {
  role: string;
  experience: string;
  completedDaysCount?: number;
  learningSignals?: { strengths: string[]; gaps: string[] }[];
  completedTopics?: { day: number; title: string }[];
  failedTopics?: { day: number; title: string }[];
  skippedTopics?: { day: number; title: string }[];
  perTopicSignals?: { day: number; title: string; strengths: string[]; gaps: string[] }[];
}

export function formatInterviewContext(
  candidate: CandidateSummary,
  completedTopics: string[],
  currentTopic: string,
  objectives: string[],
  history: { question: string; answer: string; assessment?: string }[],
  currentQuestionNumber: number,
  coveredDays: number[]
): string {
  let historyString = '';
  if (history.length > 0) {
    const lastInteraction = history[history.length - 1];
    historyString = `
INTERVIEW HISTORY:
Question:
${lastInteraction.question}

Candidate answer:
${lastInteraction.answer}

Previous assessment:
${lastInteraction.assessment || 'None'}
`;
  }

  return `
CANDIDATE:
Role: ${candidate?.role || 'AI Engineer'}
Experience: ${candidate?.experience || 'Unknown'}

COMPLETED TOPICS:
${completedTopics.join('\n')}

CURRENT TOPIC:
${currentTopic}

OBJECTIVES:
${objectives.map((obj) => `- ${obj}`).join('\n')}
${historyString}
CURRENT QUESTION NUMBER:
${currentQuestionNumber}

CURRENT COVERED DAYS:
${coveredDays.join(', ')}
`;
}

// ─── Rich Context Formatter (used by interview controller) ───────────────────

export function buildInterviewContext(params: {
  candidate: CandidateSummary;
  eligibleTopics: SelectedInterviewTopic[];
  currentTopic: SelectedInterviewTopic;
  history: ConversationTurn[];
  questionCount: number;
  coveredDays: number[];
  difficulty: Difficulty;
  canFinish: boolean;
  pendingAnswer?: string;
}): string {
  const {
    candidate,
    eligibleTopics,
    currentTopic,
    history,
    questionCount,
    coveredDays,
    difficulty,
    canFinish,
    pendingAnswer,
  } = params;

  // Build history section — show last 5 turns for context efficiency
  const recentHistory = history.slice(-5);
  const historyLines = recentHistory
    .map(
      (turn, i) =>
        `Q${turn.questionNumber}: [Day ${turn.topicDay} — ${turn.topicTitle}]\nInterviewer: ${turn.question}\nCandidate: ${turn.answer}\nAssessment: ${turn.assessment.level} (score: ${turn.assessment.score}/10) — ${turn.assessment.reason}`
    )
    .join('\n\n');

  const eligibleSummary = eligibleTopics
    .map((t) => `- Day ${t.day}: ${t.title}`)
    .join('\n');

  const coveredSummary =
    coveredDays.length > 0
      ? coveredDays.join(', ')
      : 'None yet';

  const lastTurn = history.length > 0 ? history[history.length - 1] : null;

  const pendingSection = pendingAnswer
    ? `\nCANDIDATE'S LATEST ANSWER (evaluate this):\n"${pendingAnswer}"\n`
    : '';

  const completedDaysCount = candidate.completedDaysCount ?? 0;
  let modeStr = 'Full Interview';
  let modeDesc = 'Standard technical interview evaluating multiple completed curriculum days.';
  if (completedDaysCount === 2 || completedDaysCount === 3) {
    modeStr = 'Adaptive Limited Interview';
    modeDesc = 'Interview scoped to the few completed curriculum days. Probe deeper into these specific topics, testing practical trade-offs.';
  } else if (completedDaysCount === 1) {
    modeStr = 'Focused Diagnostic Interview';
    modeDesc = 'Interview focused entirely on the single completed curriculum day. Ask deep questions, test practical trade-offs, and probe conceptual understanding of this specific topic.';
  } else if (completedDaysCount === 0) {
    modeStr = 'Beginner/Readiness Interview';
    modeDesc = 'Candidate has no completed learning history. Conduct a readiness interview based on default curriculum topics to assess their foundational knowledge.';
  }

  // Build per-topic learning history sections
  const completedTopicsText = candidate.completedTopics && candidate.completedTopics.length > 0
    ? candidate.completedTopics.map(t => {
        const sig = candidate.perTopicSignals?.find(s => s.day === t.day);
        const strengths = sig?.strengths.length ? `\n    Strengths: ${sig.strengths.join('; ')}` : '';
        const gaps = sig?.gaps.length ? `\n    Gaps to probe further: ${sig.gaps.join('; ')}` : '';
        return `  - Day ${t.day}: ${t.title}${strengths}${gaps}`;
      }).join('\n')
    : '  (none)';

  const failedTopicsText = candidate.failedTopics && candidate.failedTopics.length > 0
    ? candidate.failedTopics.map(t => {
        const sig = candidate.perTopicSignals?.find(s => s.day === t.day);
        const gaps = sig?.gaps.length ? `\n    Known misconceptions/gaps: ${sig.gaps.join('; ')}` : '';
        return `  - Day ${t.day}: ${t.title}${gaps}`;
      }).join('\n')
    : '  (none)';

  const skippedTopicsText = candidate.skippedTopics && candidate.skippedTopics.length > 0
    ? candidate.skippedTopics.map(t => `  - Day ${t.day}: ${t.title}`).join('\n')
    : '  (none)';

  const minDaysRequired = completedDaysCount === 0 ? 4 : Math.min(4, completedDaysCount);

  let finishInstruction = '';
  if (canFinish) {
    finishInstruction = `\nINSTRUCTION: The interview has met the minimum requirements (>= 8 questions & >= ${minDaysRequired} curriculum days covered).
You MAY set nextAction to "finish" if you have gathered sufficient evaluation signal.
- The preferred interview length is 10-14 questions.
- 18 questions is a soft upper guideline, NOT a hard limit.
- You may continue beyond 18 questions ONLY if genuinely necessary to assess unresolved weaknesses. Do NOT continue just to increase the question count.`;
  } else {
    finishInstruction = `\nINSTRUCTION: Do NOT set nextAction to "finish" yet. Requirements (8 questions & ${minDaysRequired} curriculum days covered) have NOT been met. Keep asking questions.`;
  }

  if (canFinish) {
    finishInstruction += `
If you set nextAction to "finish", you MUST generate detailed, personalized feedback.
Your feedback MUST include:
- overall assessment (detailed summary)
- technical strengths (in the 'strengths' array)
- weaknesses (in the 'gaps' array)
- concepts demonstrated
- misconceptions
- curriculum coverage (specifically what was assessed)
- evidence from candidate's answers
- recommended learning areas (in the 'next' array)
- interview mode (${modeStr})
- number of questions asked (${questionCount + 1})

Put the overall assessment, concepts demonstrated, misconceptions, evidence, curriculum coverage, interview mode, and number of questions asked in the "summary" string (you may format it with markdown).
${completedDaysCount < 4 ? 'IMPORTANT: Since this is a limited-progress candidate, you MUST explicitly include the following phrase in the summary: "Assessment was based on the curriculum completed by this candidate." Do NOT claim that 4 curriculum days were assessed.' : ''}

ASSESSMENT RULES (always apply when producing feedback):
You must evaluate every candidate answer that is available, even when the interview ended before completion. Do not treat unanswered questions as incorrect answers. Evaluate only the evidence contained in the candidate's submitted answers. If the interview is incomplete, clearly state that the assessment is partial and identify the topics that were not assessed.
Never use generic placeholder feedback such as "Participated in the interview" or "Insufficient questions answered for a complete assessment."`;
  }

  return `INTERVIEW MODE: ${modeStr} (${modeDesc})

CANDIDATE:
Role: ${candidate.role}
Experience: ${candidate.experience}
Completed Curriculum Days: ${completedDaysCount}

CANDIDATE LEARNING HISTORY:
COMPLETED TOPICS (validate depth, increase difficulty for strong answers):
${completedTopicsText}

FAILED TOPICS (probe fundamentals and misconceptions — do NOT treat these as mastered):
${failedTopicsText}

SKIPPED TOPICS (candidate has NOT studied these — do NOT ask as if they completed them):
${skippedTopicsText}

ELIGIBLE INTERVIEW TOPICS (completed + failed missions only — use these to select questions):
${eligibleSummary}

CURRENT TOPIC:
Day ${currentTopic.day} — ${currentTopic.title}
Objectives: ${currentTopic.objectives.join('; ')}

INTERVIEW STATE:
Question number: ${questionCount + 1}
Covered days so far: ${coveredSummary}
Current difficulty: ${difficulty}
${pendingSection}
RECENT CONVERSATION HISTORY (last ${recentHistory.length} turns):
${historyLines || 'No history yet — this is the first question.'}
${lastTurn ? `\nLAST ASSESSMENT: ${lastTurn.assessment.level} — ${lastTurn.assessment.reason}` : ''}
${finishInstruction}`;
}

// ─── End-interview / partial assessment context ───────────────────────────────

export function buildEndInterviewAssessmentContext(params: {
  candidate: CandidateSummary;
  eligibleTopics: SelectedInterviewTopic[];
  history: ConversationTurn[];
  coveredDays: number[];
  endReason: 'candidate_ended' | 'error';
  topicsAssessed: string[];
  topicsNotAssessed: string[];
}): string {
  const {
    candidate,
    eligibleTopics,
    history,
    coveredDays,
    endReason,
    topicsAssessed,
    topicsNotAssessed,
  } = params;

  const answeredCount = history.length;
  const endReasonLabel =
    endReason === 'error'
      ? 'Interview ended because of an error'
      : 'Interview ended early by the candidate';

  const allTurns = history
    .map(
      (turn) =>
        `Q${turn.questionNumber}: [Day ${turn.topicDay} — ${turn.topicTitle}]\nInterviewer: ${turn.question}\nCandidate: ${turn.answer}\nPer-answer assessment: ${turn.assessment.level} (score: ${turn.assessment.score}/10) — ${turn.assessment.reason}`
    )
    .join('\n\n');

  const eligibleSummary = eligibleTopics
    .map((t) => `- Day ${t.day}: ${t.title}`)
    .join('\n');

  return `INTERVIEW END ASSESSMENT REQUEST

STATUS: ${endReasonLabel} after ${answeredCount} submitted answer(s).
This is a PARTIAL interview assessment. The candidate did not complete the full interview.

CRITICAL ASSESSMENT RULES:
You must evaluate every candidate answer that is available, even when the interview ended before completion. Do not treat unanswered questions as incorrect answers. Evaluate only the evidence contained in the candidate's submitted answers. If the interview is incomplete, clearly state that the assessment is partial and identify the topics that were not assessed.

- Evaluate ALL ${answeredCount} submitted answers below for technical correctness, depth, clarity, and communication/confidence.
- Base strengths and weaknesses ONLY on those answers.
- Mention specific topics and concepts demonstrated (e.g. embeddings, HNSW, IVF, RRF, prompt engineering) when evidence exists.
- Do NOT invent performance on topics that were not answered.
- Do NOT use generic placeholders like "Participated in the interview." or "Insufficient questions answered for a complete assessment."
- In the summary, state clearly that this is a partial assessment based on ${answeredCount} answered question(s), that the interview ended early, and that it does not represent performance on the remaining curriculum.
- Score only from answered questions — never score unanswered questions as zero.

CANDIDATE:
Role: ${candidate.role}
Experience: ${candidate.experience}

ELIGIBLE INTERVIEW TOPICS:
${eligibleSummary}

TOPICS ASSESSED (from submitted answers):
${topicsAssessed.length ? topicsAssessed.map((t) => `- ${t}`).join('\n') : '- (none)'}

TOPICS NOT ASSESSED:
${topicsNotAssessed.length ? topicsNotAssessed.map((t) => `- ${t}`).join('\n') : '- (none — all eligible topics touched)'}

COVERED CURRICULUM DAYS: ${coveredDays.length ? coveredDays.join(', ') : 'None'}

ALL SUBMITTED Q&A (evaluate every one):
${allTurns || '(No answers submitted)'}

INSTRUCTION: Set nextAction to "finish". Provide detailed personalized feedback in the feedback object:
- summary: overall partial assessment (must mention early end and ${answeredCount} answers)
- strengths: technical strengths evidenced in the answers (empty array only if truly none)
- gaps: weaknesses or incomplete answers among what was submitted (do not list unanswered topics as wrong answers)
- next: recommended next steps
Also include in the summary: topics covered and that remaining curriculum was not assessed.`;
}
