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
  const progressBarFill = document.getElementById('progressBarFill');
  const curriculumCoverageList = document.getElementById('curriculumCoverageList');
  
  const chatHistory = document.getElementById('chatHistory');
  const chatErrorBanner = document.getElementById('chatErrorBanner');
  const typingIndicator = document.getElementById('typingIndicator');
  const answerInput = document.getElementById('answerInput');
  const btnSendAnswer = document.getElementById('btnSendAnswer');

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

      // DO NOT expose attempt counts or internal learning signals!
      card.innerHTML = `
        <div class="candidate-card-header">
          <div class="avatar-medium">${getInitials(cand.name)}</div>
          <div class="candidate-info">
            <h3>${escapeHtml(cand.name)}</h3>
            <span class="role-badge">${escapeHtml(cand.role)}</span>
          </div>
        </div>

        <div class="candidate-details">
          <div class="detail-row">
            <span class="detail-label">Experience:</span>
            <span class="detail-value">${escapeHtml(cand.experience)}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Cohort:</span>
            <span class="detail-value">${escapeHtml(cand.cohort || 'Enterprise AI')}</span>
          </div>
        </div>

        <button class="btn btn-primary btn-select-candidate" style="width: 100%;">
          <span>Select & Begin Interview</span>
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

    // Initiate backend POST /api/interview
    await sendInterviewRequest({
      sessionId: state.sessionId,
      candidate: candidate,
    });
  }

  function extractCandidateTopics(candidate) {
    // Collect unique topics from candidate missions without showing internal scores
    const topicsMap = new Map();

    if (candidate.missions) {
      candidate.missions.forEach((m) => {
        // Exclude skipped missions from eligible curriculum topics by default
        if (m.status !== 'skipped') {
          topicsMap.set(m.day, {
            day: m.day,
            title: m.title || `Day ${m.day} Topic`,
          });
        }
      });
    }

    // Fallback if none mapped
    if (topicsMap.size === 0) {
      return [
        { day: 1, title: 'AI Engineering Foundations' },
        { day: 7, title: 'Embeddings' },
        { day: 8, title: 'Vector Databases' },
        { day: 10, title: 'Retrieval Engine' },
        { day: 15, title: 'Evaluation & Guardrails' },
      ];
    }

    return Array.from(topicsMap.values());
  }

  function setupInterviewUI() {
    const cand = state.selectedCandidate;
    sidebarAvatar.textContent = getInitials(cand.name);
    sidebarCandidateName.textContent = cand.name;
    sidebarCandidateRole.textContent = cand.role;
    sidebarCandidateExp.textContent = `${cand.experience} experience`;

    chatHistory.innerHTML = '';
    chatErrorBanner.classList.add('hidden');
    answerInput.value = '';

    updateProgressUI();
  }

  const progressNote = document.getElementById('progressNote');

  function updateProgressUI() {
    const qCount = state.questionCount;
    questionProgressText.textContent = `Question ${qCount}`;

    if (qCount <= 8) {
      if (progressNote) {
        progressNote.textContent = 'Minimum: 8 questions & 4 curriculum days';
      }
      const percentage = Math.min((qCount / 8) * 100, 100);
      progressBarFill.style.width = `${percentage}%`;
    } else {
      if (progressNote) {
        progressNote.textContent = `Minimum 8 questions met (${qCount} asked)`;
      }
      progressBarFill.style.width = '100%';
    }

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
        // Wait 1.5 seconds then show feedback
        setTimeout(() => {
          renderFeedbackScreen(data.feedback);
          showScreen('feedback');
        }, 1500);
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
      btnSendAnswer.disabled = true;
      answerInput.disabled = true;
    } else {
      typingIndicator.classList.add('hidden');
      btnSendAnswer.disabled = false;
      answerInput.disabled = false;
      answerInput.focus();
    }
  }

  function appendChatMessage(sender, text) {
    const container = document.createElement('div');
    container.className = `chat-bubble-container ${sender}`;

    const senderName = sender === 'interviewer' ? 'AI Interviewer' : state.selectedCandidate?.name || 'Candidate';
    
    container.innerHTML = `
      <div class="bubble-sender">${escapeHtml(senderName)}</div>
      <div class="chat-bubble">${escapeHtml(text)}</div>
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
    feedbackCandidateMeta.textContent = `Technical Evaluation Report for ${cand.name} (${cand.role}) • ${totalQuestions} Questions Asked`;

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

  answerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSendAnswer();
    }
  });

  btnRestart.addEventListener('click', () => {
    showScreen('candidateSelect');
  });

  // Initial View
  showScreen('landing');
});
