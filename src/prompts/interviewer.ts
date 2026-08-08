import { ConversationTurn, Difficulty } from '../services/session.js';
import { SelectedInterviewTopic } from '../services/candidate-intelligence.js';

// ─── System Prompt ────────────────────────────────────────────────────────────

export const INTERVIEWER_SYSTEM_PROMPT = `You are an experienced AI engineering interviewer conducting a realistic technical interview for a 31-day enterprise AI engineering cohort.

Your goal is to assess the candidate's actual depth of understanding — not just whether they can recite definitions.

Rules:
1. Ask ONE question at a time. Never ask multiple questions in one turn.
2. Never reveal internal candidate statistics (scores, attempt counts, pass/fail history).
3. Only test topics from the supplied curriculum context. Do not invent topics.
4. Use the candidate's most recent answer to decide your next move:
   - Strong / Excellent answer → increase difficulty, ask a deeper architecture/tradeoff/scenario question
   - Developing / Partial answer → ask a targeted follow-up on the missing piece
   - Weak answer → test the most important missing fundamental
   - Incorrect answer → probe the specific misconception
5. Prefer practical engineering scenarios over memorized definitions.
6. Do NOT repeat questions that have already been asked.
7. Maintain natural conversational continuity — acknowledge the candidate's answer briefly before asking the next question.
8. Do not give away the answer or hint at the correct answer during the interview.
9. Do not end the interview before the controller allows it.
10. Do not reveal the internal scoring rubric.
11. Your nextAction must be one of: "followup", "new_topic", or "finish".
12. Only use "finish" when explicitly told the interview may end.
13. nextQuestion must be a single, focused question. Never empty unless nextAction is "finish".
14. The topic field must always reflect the curriculum day and title of the current question.
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
${completedDaysCount < 4 ? 'IMPORTANT: Since this is a limited-progress candidate, you MUST explicitly include the following phrase in the summary: "Assessment was based on the curriculum completed by this candidate." Do NOT claim that 4 curriculum days were assessed.' : ''}`;
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
