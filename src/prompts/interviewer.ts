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

  const finishInstruction = canFinish
    ? `\nINSTRUCTION: The interview has met minimum requirements. You MAY set nextAction to "finish" if you have enough signal, or continue with another question.`
    : `\nINSTRUCTION: Do NOT set nextAction to "finish" yet. The interview has not met minimum requirements. Keep asking questions.`;

  return `CANDIDATE:
Role: ${candidate.role}
Experience: ${candidate.experience}

ELIGIBLE CURRICULUM TOPICS FOR THIS CANDIDATE:
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
