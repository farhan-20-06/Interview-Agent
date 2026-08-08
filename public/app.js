/**
 * AI Technical Interview Agent - SPA Client Application Logic
 */

document.addEventListener('DOMContentLoaded', () => {
  // ─── App State ─────────────────────────────────────────────────────────────
  const state = {
    candidates: [],
    curriculum: [],
    selectedCandidate: null,
    sessionId: null,
    questionCount: 0,
    history: [],
    curriculumDays: [],
    currentDay: null,
    isLoading: false,
    isInterviewDone: false,
  };

  // ─── DOM Elements ──────────────────────────────────────────────────────────
  const screens = {
    landing: document.getElementById('screenLanding'),
    candidateSelect: document.getElementById('screenCandidateSelect'),
    interview: document.getElementById('screenInterview'),
    feedback: document.getElementById('screenFeedback'),
  };

  const btnStartPractice = document.getElementById('btnStartPractice');
  const candidateGrid = document.getElementById('candidateGrid');
  const candidateLoading = document.getElementById('candidateLoading');
  const candidateError = document.getElementById('candidateError');

  // Interview DOM
  const sidebarAvatar = document.getElementById('sidebarAvatar');
  const sidebarCandidateName = document.getElementById('sidebarCandidateName');
  const sidebarCandidateRole = document.getElementById('sidebarCandidateRole');
  const sidebarCandidateExp = document.getElementById('sidebarCandidateExp');
  const questionProgressText = document.getElementById('questionProgressText');
  const curriculumCoverageList = document.getElementById('curriculumCoverageList');
  
  const chatHistory = document.getElementById('chatHistory');
  const chatErrorBanner = document.getElementById('chatErrorBanner');
  const typingIndicator = document.getElementById('typingIndicator');
  const answerInputArea = document.getElementById('answerInputArea');
  const viewResultsArea = document.getElementById('viewResultsArea');
  const btnViewResults = document.getElementById('btnViewResults');
  const answerInput = document.getElementById('answerInput');
  const btnSendAnswer = document.getElementById('btnSendAnswer');
  const btnEndInterview = document.getElementById('btnEndInterview');

  // Feedback DOM
  const feedbackCandidateMeta = document.getElementById('feedbackCandidateMeta');
  const feedbackSummaryText = document.getElementById('feedbackSummaryText');
  const feedbackStrengthsList = document.getElementById('feedbackStrengthsList');
  const feedbackGapsList = document.getElementById('feedbackGapsList');
  const feedbackNextList = document.getElementById('feedbackNextList');
  const btnRestart = document.getElementById('btnRestart');

  // ─── Navigation ────────────────────────────────────────────────────────────
  function showScreen(screenKey) {
    Object.keys(screens).forEach((key) => {
      if (key === screenKey) {
        screens[key].classList.add('active');
      } else {
        screens[key].classList.remove('active');
      }
    });
    window.scrollTo(0, 0);
  }

  // ─── Candidate & Curriculum Data Fetching ──────────────────────────────────
  async function fetchCandidatesAndCurriculum() {
    candidateLoading.classList.remove('hidden');
    candidateError.classList.add('hidden');
    candidateGrid.innerHTML = '';

    try {
      const [candRes, currRes] = await Promise.all([
        fetch('/api/candidates'),
        fetch('/api/curriculum'),
      ]);

      if (!candRes.ok) throw new Error('Failed to load candidates data');
      
      const candData = await candRes.json();
      state.candidates = candData.candidates || [];

      if (currRes.ok) {
        const currData = await currRes.json();
        state.curriculum = currData.days || [];
      }

      renderCandidateCards();
    } catch (err) {
      candidateError.textContent = `Error loading candidate profiles: ${err.message}`;
      candidateError.classList.remove('hidden');
    } finally {
      candidateLoading.classList.add('hidden');
    }
  }

  function getInitials(name) {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase();
  }

  function renderCandidateCards() {
    candidateGrid.innerHTML = '';
    
    if (state.candidates.length === 0) {
      candidateGrid.innerHTML = '<p class="text-muted">No candidate profiles found.</p>';
      return;
    }

    state.candidates.forEach((cand) => {
      const card = document.createElement('div');
      card.className = 'candidate-card';

      const name = cand.member?.name || 'Unknown';
      const role = cand.member?.jobRole || 'Unknown Role';
      const exp = cand.member?.yearsExperience !== undefined ? `${cand.member.yearsExperience} years` : 'Unknown';
      const education = cand.member?.education || '';

      card.innerHTML = `
        <div class="candidate-card-header">
          <div class="avatar-medium">${getInitials(name)}</div>
          <div class="candidate-info">
            <h3>${escapeHtml(name)}</h3>
            <span class="role-badge">${escapeHtml(role)}</span>
          </div>
        </div>

        <div class="candidate-details">
          <div class="detail-row">
            <span class="detail-label">Experience:</span>
            <span class="detail-value">${escapeHtml(exp)}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Education:</span>
            <span class="detail-value">${escapeHtml(education || 'Enterprise AI Cohort')}</span>
          </div>
        </div>

        <button class="btn btn-primary btn-select-candidate" style="width: 100%;">
          <span>Select &amp; Begin Interview</span>
        </button>
      `;

      const selectBtn = card.querySelector('.btn-select-candidate');
      selectBtn.addEventListener('click', () => startInterviewSession(cand));

      candidateGrid.appendChild(card);
    });
  }

  // ─── Interview Flow Logic ──────────────────────────────────────────────────
  async function startInterviewSession(candidate) {
    state.selectedCandidate = candidate;
    state.sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    state.questionCount = 0;
    state.history = [];
    state.curriculumDays = extractCandidateTopics(candidate);
    state.currentDay = state.curriculumDays[0]?.day || 1;
    state.isInterviewDone = false;

    setupInterviewUI();
    showScreen('interview');

    // Display a clean info message to the candidate
    appendSystemMessage("Personalized Interview — Interview scope is based on your completed cohort progress.");

    // Initiate backend POST /api/interview
    await sendInterviewRequest({
      sessionId: state.sessionId,
      candidate: candidate,
    });
  }

  function extractCandidateTopics(candidate) {
    const topicsMap = new Map();

    if (candidate.missions) {
      candidate.missions.forEach((m) => {
        // Exclude skipped missions from sidebar curriculum display
        if (!m.skipped) {
          topicsMap.set(m.day, {
            day: m.day,
            title: m.title || `Day ${m.day} Topic`,
          });
        }
      });
    }

    if (topicsMap.size === 0) {
      return [
        { day: 7, title: 'Embeddings Explained' },
        { day: 8, title: 'Vector Databases Overview' },
        { day: 10, title: 'The Retrieval & Matching Engine' },
        { day: 12, title: 'Prompt Engineering Fundamentals' },
        { day: 22, title: 'Multi-Agent Orchestration' },
      ];
    }

    return Array.from(topicsMap.values());
  }

  function setupInterviewUI() {
    const cand = state.selectedCandidate;
    const name = cand.member?.name || 'Unknown';
    const role = cand.member?.jobRole || 'Unknown Role';
    const exp = cand.member?.yearsExperience !== undefined ? `${cand.member.yearsExperience} years` : 'Unknown';

    sidebarAvatar.textContent = getInitials(name);
    sidebarCandidateName.textContent = name;
    sidebarCandidateRole.textContent = role;
    sidebarCandidateExp.textContent = `${exp} experience`;

    chatHistory.innerHTML = '';
    chatErrorBanner.classList.add('hidden');
    answerInput.value = '';
    
    if (answerInputArea) answerInputArea.classList.remove('hidden');
    if (viewResultsArea) viewResultsArea.classList.add('hidden');

    updateProgressUI();
  }

  function updateProgressUI() {
    const qCount = state.questionCount;
    questionProgressText.textContent = `Question ${qCount}`;

    renderCurriculumCoverage();
  }

  function renderCurriculumCoverage() {
    curriculumCoverageList.innerHTML = '';

    state.curriculumDays.forEach((topic, idx) => {
      const item = document.createElement('div');
      
      let statusClass = 'status-upcoming';
      let icon = '○';

      // Estimate topic status based on turn progression
      const activeTopicIndex = Math.min(
        Math.floor((state.questionCount - 1) / 2),
        state.curriculumDays.length - 1
      );

      if (idx < activeTopicIndex) {
        statusClass = 'status-completed';
        icon = '✓';
      } else if (idx === activeTopicIndex && state.questionCount > 0) {
        statusClass = 'status-current';
        icon = '→';
      }

      item.className = `coverage-item ${statusClass}`;
      item.innerHTML = `
        <span class="coverage-icon">${icon}</span>
        <span class="coverage-title">${escapeHtml(topic.title)}</span>
      `;

      curriculumCoverageList.appendChild(item);
    });
  }

  async function handleSendAnswer() {
    const message = answerInput.value.trim();
    if (!message || state.isLoading || state.isInterviewDone) return;

    // Append candidate message to chat
    appendChatMessage('candidate', message);
    answerInput.value = '';

    // Send payload to API
    await sendInterviewRequest({
      sessionId: state.sessionId,
      message: message,
    });
  }

  async function sendInterviewRequest(payload) {
    setLoadingState(true);
    chatErrorBanner.classList.add('hidden');

    try {
      const response = await fetch('/api/interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Server returned an error');
      }

      state.questionCount++;
      updateProgressUI();

      if (data.reply) {
        appendChatMessage('interviewer', data.reply);
      }

      if (data.done) {
        state.isInterviewDone = true;
        renderFeedbackScreen(data.feedback);
        
        if (answerInputArea) answerInputArea.classList.add('hidden');
        if (viewResultsArea) viewResultsArea.classList.remove('hidden');
      }

    } catch (err) {
      chatErrorBanner.textContent = `API Error: ${err.message}. Please try resending your answer.`;
      chatErrorBanner.classList.remove('hidden');
    } finally {
      setLoadingState(false);
    }
  }

  function setLoadingState(loading) {
    state.isLoading = loading;
    if (loading) {
      typingIndicator.classList.remove('hidden');
      if (btnSendAnswer) btnSendAnswer.disabled = true;
      if (answerInput) answerInput.disabled = true;
    } else {
      typingIndicator.classList.add('hidden');
      if (!state.isInterviewDone) {
        if (btnSendAnswer) btnSendAnswer.disabled = false;
        if (answerInput) {
          answerInput.disabled = false;
          answerInput.focus();
        }
      }
    }
  }

  function appendChatMessage(sender, text) {
    const container = document.createElement('div');
    container.className = `chat-bubble-container ${sender}`;

    const senderName = sender === 'interviewer' ? 'AI Interviewer' : state.selectedCandidate?.member?.name || 'Candidate';
    
    container.innerHTML = `
      <div class="bubble-sender">${escapeHtml(senderName)}</div>
      <div class="chat-bubble">${escapeHtml(text)}</div>
    `;

    chatHistory.appendChild(container);
    scrollToBottom();
  }

  function appendSystemMessage(text) {
    const container = document.createElement('div');
    container.className = 'chat-bubble-container system';
    container.style.cssText = 'display: flex; justify-content: center; margin: 1rem 0; width: 100%;';
    container.innerHTML = `
      <div style="background: rgba(255,255,255,0.05); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 0.5rem 1rem; font-size: 0.9rem; color: var(--text-muted); text-align: center; max-width: 80%;">
        ${escapeHtml(text)}
      </div>
    `;
    chatHistory.appendChild(container);
    scrollToBottom();
  }

  function scrollToBottom() {
    chatHistory.scrollTop = chatHistory.scrollHeight;
  }

  // ─── Feedback Rendering ────────────────────────────────────────────────────
  function renderFeedbackScreen(feedback) {
    const cand = state.selectedCandidate;
    const totalQuestions = state.questionCount;
    const name = cand.member?.name || 'Unknown';
    const role = cand.member?.jobRole || 'Unknown Role';
    feedbackCandidateMeta.textContent = `Technical Evaluation Report for ${name} (${role}) • ${totalQuestions} Questions Asked`;

    if (!feedback) {
      feedbackSummaryText.textContent = 'Interview completed successfully.';
      feedbackStrengthsList.innerHTML = '<li>Good communication skills.</li>';
      feedbackGapsList.innerHTML = '<li>No critical gaps identified.</li>';
      feedbackNextList.innerHTML = '<li>Continue with domain practice.</li>';
      return;
    }

    feedbackSummaryText.textContent = feedback.summary || 'Completed technical evaluation.';

    // Render Strengths
    feedbackStrengthsList.innerHTML = '';
    (feedback.strengths || []).forEach((s) => {
      const li = document.createElement('li');
      li.textContent = s;
      feedbackStrengthsList.appendChild(li);
    });
    if (!feedback.strengths || feedback.strengths.length === 0) {
      feedbackStrengthsList.innerHTML = '<li>Demonstrated solid engagement throughout.</li>';
    }

    // Render Gaps
    feedbackGapsList.innerHTML = '';
    (feedback.gaps || []).forEach((g) => {
      const li = document.createElement('li');
      li.textContent = g;
      feedbackGapsList.appendChild(li);
    });
    if (!feedback.gaps || feedback.gaps.length === 0) {
      feedbackGapsList.innerHTML = '<li>No major knowledge gaps observed.</li>';
    }

    // Render Next Steps
    feedbackNextList.innerHTML = '';
    (feedback.next || []).forEach((n) => {
      const li = document.createElement('li');
      li.textContent = n;
      feedbackNextList.appendChild(li);
    });
    if (!feedback.next || feedback.next.length === 0) {
      feedbackNextList.innerHTML = '<li>Review advanced architectural topics.</li>';
    }
  }

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ─── Event Listeners ────────────────────────────────────────────────────────
  btnStartPractice.addEventListener('click', async () => {
    showScreen('candidateSelect');
    await fetchCandidatesAndCurriculum();
  });

  btnSendAnswer.addEventListener('click', handleSendAnswer);

  if (btnViewResults) {
    btnViewResults.addEventListener('click', () => {
      showScreen('feedback');
    });
  }

  answerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSendAnswer();
    }
  });

  btnRestart.addEventListener('click', () => {
    showScreen('candidateSelect');
  });

  if (btnEndInterview) {
    btnEndInterview.addEventListener('click', () => {
      if (state.isLoading || state.isInterviewDone) return;
      state.isInterviewDone = true;
      showScreen('feedback');
      renderFeedbackScreen({
        summary: 'Interview ended early by user.',
        strengths: ['Participated in the interview.'],
        gaps: ['Insufficient questions answered for a complete assessment.'],
        next: ['Complete a full session for accurate evaluation.']
      });
    });
  }

  // Initial View
  showScreen('landing');
});
