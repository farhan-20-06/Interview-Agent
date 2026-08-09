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
    /** Count of candidate answers actually submitted (not questions displayed). */
    answersSubmitted: 0,
    history: [],
    curriculumDays: [],
    currentDay: null,
    isLoading: false,
    isInterviewDone: false,
    lastFeedback: null,
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
  const feedbackMetaName = document.getElementById('feedbackMetaName');
  const feedbackMetaRole = document.getElementById('feedbackMetaRole');
  const feedbackMetaQuestions = document.getElementById('feedbackMetaQuestions');
  const feedbackStatusBadge = document.getElementById('feedbackStatusBadge');
  const feedbackStatusBadgeText = document.getElementById('feedbackStatusBadgeText');
  const feedbackStatusBanner = document.getElementById('feedbackStatusBanner');
  const feedbackStatusBannerText = document.getElementById('feedbackStatusBannerText');
  const feedbackSummaryText = document.getElementById('feedbackSummaryText');
  const feedbackStrengthsList = document.getElementById('feedbackStrengthsList');
  const feedbackGapsList = document.getElementById('feedbackGapsList');
  const feedbackNextList = document.getElementById('feedbackNextList');
  const feedbackTopicsAssessedList = document.getElementById('feedbackTopicsAssessedList');
  const feedbackTopicsNotAssessedList = document.getElementById('feedbackTopicsNotAssessedList');
  const btnRestart = document.getElementById('btnRestart');

  const interviewProgressBadge = document.getElementById('interviewProgressBadge');

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
      candidateGrid.innerHTML =
        '<p style="padding: 24px; color: var(--text-muted); font-size: 0.875rem;">No candidate profiles found.</p>';
      return;
    }

    state.candidates.forEach((cand) => {
      const card = document.createElement('div');
      card.className = 'candidate-card';

      const name = cand.member?.name || 'Unknown';
      const role = cand.member?.jobRole || 'Unknown Role';
      const expYears = cand.member?.yearsExperience;
      const expText = expYears !== undefined ? `${expYears} yr${expYears !== 1 ? 's' : ''}` : '—';
      const education = cand.member?.education || 'AI Cohort';

      const missions = cand.missions || [];
      const completedMissions = missions.filter((m) => !m.skipped).length;
      const totalMissions = missions.length;
      const progressText =
        totalMissions > 0 ? `${completedMissions} of ${totalMissions} modules` : 'Cohort member';

      card.innerHTML = `
        <div class="avatar-medium">${getInitials(name)}</div>
        <div class="candidate-info">
          <h3>${escapeHtml(name)}</h3>
          <span class="role-badge">${escapeHtml(role)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Experience</span>
          <span class="detail-value">${escapeHtml(expText)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Education</span>
          <span class="detail-value">${escapeHtml(education)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Progress</span>
          <span class="detail-value">${escapeHtml(progressText)}</span>
        </div>
        <button class="btn btn-primary btn-sm btn-select-candidate">
          Begin Interview
        </button>
      `;

      card.querySelector('.btn-select-candidate').addEventListener('click', () => startInterviewSession(cand));
      candidateGrid.appendChild(card);
    });
  }

  // ─── Interview Flow Logic ──────────────────────────────────────────────────
  async function startInterviewSession(candidate) {
    state.selectedCandidate = candidate;
    state.sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    state.answersSubmitted = 0;
    state.history = [];
    state.curriculumDays = extractCandidateTopics(candidate);
    state.currentDay = state.curriculumDays[0]?.day || 1;
    state.isInterviewDone = false;
    state.lastFeedback = null;

    setupInterviewUI();
    showScreen('interview');

    appendSystemMessage('Personalized Interview — Interview scope is based on your completed cohort progress.');

    await sendInterviewRequest({
      sessionId: state.sessionId,
      candidate: candidate,
    });
  }

  function extractCandidateTopics(candidate) {
    const topicsMap = new Map();

    if (candidate.missions) {
      candidate.missions.forEach((m) => {
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
    const expYears = cand.member?.yearsExperience;
    const expText = expYears !== undefined ? `${expYears} yr${expYears !== 1 ? 's' : ''}` : '';

    sidebarAvatar.textContent = getInitials(name);
    sidebarCandidateName.textContent = name;
    sidebarCandidateRole.textContent = role;
    sidebarCandidateExp.textContent = expText ? `${expText} experience` : '';

    const headerName = document.getElementById('interviewHeaderCandidateName');
    const headerMeta = document.getElementById('interviewHeaderCandidateMeta');
    if (headerName) headerName.textContent = name;
    if (headerMeta) headerMeta.textContent = expText ? `${role} · ${expText} experience` : role;

    chatHistory.innerHTML = '';
    chatErrorBanner.classList.add('hidden');
    answerInput.value = '';

    if (answerInputArea) answerInputArea.classList.remove('hidden');
    if (viewResultsArea) viewResultsArea.classList.add('hidden');

    updateProgressUI();
  }

  function updateProgressUI() {
    const qCount = state.answersSubmitted;
    questionProgressText.textContent = qCount > 0 ? `Question ${qCount}` : 'Starting…';
    if (interviewProgressBadge) {
      interviewProgressBadge.textContent = qCount > 0 ? `Question ${qCount}` : 'Starting';
    }
    renderCurriculumCoverage();
  }

  function renderCurriculumCoverage() {
    curriculumCoverageList.innerHTML = '';

    state.curriculumDays.forEach((topic, idx) => {
      const item = document.createElement('div');

      let statusClass = 'status-upcoming';
      let icon = '○';

      const activeTopicIndex = Math.min(
        Math.floor((state.answersSubmitted - 1) / 2),
        state.curriculumDays.length - 1
      );

      if (idx < activeTopicIndex) {
        statusClass = 'status-completed';
        icon = '✓';
      } else if (idx === activeTopicIndex && state.answersSubmitted > 0) {
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

    appendChatMessage('candidate', message);
    answerInput.value = '';

    await sendInterviewRequest({
      sessionId: state.sessionId,
      message: message,
    });
  }

  async function handleEndInterview() {
    if (state.isLoading || state.isInterviewDone) return;

    setLoadingState(true);
    chatErrorBanner.classList.add('hidden');

    try {
      const response = await fetch('/api/interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: state.sessionId,
          endInterview: true,
          reason: 'candidate_ended',
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to end interview');
      }

      state.isInterviewDone = true;
      state.lastFeedback = data.feedback ?? null;

      if (data.feedback?.questionsAnswered != null) {
        state.answersSubmitted = data.feedback.questionsAnswered;
      }

      if (data.reply) {
        appendChatMessage('interviewer', data.reply);
      }

      renderFeedbackScreen(data.feedback);

      if (answerInputArea) answerInputArea.classList.add('hidden');
      if (viewResultsArea) viewResultsArea.classList.remove('hidden');
    } catch (err) {
      chatErrorBanner.textContent = `Could not end interview: ${err.message}. Please try again.`;
      chatErrorBanner.classList.remove('hidden');
    } finally {
      setLoadingState(false);
    }
  }

  async function sendInterviewRequest(payload) {
    setLoadingState(true);
    chatErrorBanner.classList.add('hidden');

    const isAnswerSubmission = Boolean(payload.message);

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

      if (isAnswerSubmission) {
        state.answersSubmitted += 1;
        updateProgressUI();
      }

      if (data.reply) {
        appendChatMessage('interviewer', data.reply);
      }

      if (data.done) {
        state.isInterviewDone = true;
        state.lastFeedback = data.feedback ?? null;

        if (data.feedback?.questionsAnswered != null) {
          state.answersSubmitted = data.feedback.questionsAnswered;
        }

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
      if (btnEndInterview) btnEndInterview.disabled = true;
    } else {
      typingIndicator.classList.add('hidden');
      if (!state.isInterviewDone) {
        if (btnSendAnswer) btnSendAnswer.disabled = false;
        if (btnEndInterview) btnEndInterview.disabled = false;
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

    const senderName =
      sender === 'interviewer' ? 'AI Interviewer' : state.selectedCandidate?.member?.name || 'Candidate';

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
    container.innerHTML = `
      <div class="system-notice">${escapeHtml(text)}</div>
    `;
    chatHistory.appendChild(container);
    scrollToBottom();
  }

  function scrollToBottom() {
    chatHistory.scrollTop = chatHistory.scrollHeight;
  }

  function renderListItems(listEl, items, emptyMessage) {
    if (!listEl) return;
    listEl.innerHTML = '';
    if (!items || items.length === 0) {
      const li = document.createElement('li');
      li.textContent = emptyMessage;
      listEl.appendChild(li);
      return;
    }
    items.forEach((item) => {
      const li = document.createElement('li');
      li.textContent = item;
      listEl.appendChild(li);
    });
  }

  // ─── Feedback Rendering ────────────────────────────────────────────────────
  function renderFeedbackScreen(feedback) {
    const cand = state.selectedCandidate;
    const name = cand?.member?.name || 'Unknown';
    const role = cand?.member?.jobRole || 'Unknown Role';

    const questionsAnswered =
      feedback?.questionsAnswered ?? state.answersSubmitted ?? 0;
    const completionStatus = feedback?.completionStatus ?? (feedback?.isPartial ? 'ended_early' : 'completed');

    feedbackCandidateMeta.textContent = `Assessment results for ${name} — ${role}`;
    if (feedbackMetaName) feedbackMetaName.textContent = name;
    if (feedbackMetaRole) feedbackMetaRole.textContent = role;
    if (feedbackMetaQuestions) {
      feedbackMetaQuestions.textContent =
        questionsAnswered === 1
          ? '1 question'
          : `${questionsAnswered} questions`;
    }

    // Status badge and banner
    if (feedbackStatusBadge) {
      feedbackStatusBadge.classList.remove('partial', 'error-status', 'no-answers');
    }
    if (feedbackStatusBanner) {
      feedbackStatusBanner.classList.remove('hidden', 'error-banner', 'complete-banner');
    }

    if (completionStatus === 'no_answers') {
      if (feedbackStatusBadge) feedbackStatusBadge.classList.add('no-answers');
      if (feedbackStatusBadgeText) feedbackStatusBadgeText.textContent = 'No Answers Submitted';
      if (feedbackStatusBanner) {
        feedbackStatusBanner.classList.remove('hidden');
        feedbackStatusBannerText.textContent =
          'The interview ended before any answers were submitted. A meaningful technical assessment could not be generated.';
      }
    } else if (completionStatus === 'error') {
      if (feedbackStatusBadge) feedbackStatusBadge.classList.add('error-status');
      if (feedbackStatusBadgeText) feedbackStatusBadgeText.textContent = 'Interview Ended — Error';
      if (feedbackStatusBanner) {
        feedbackStatusBanner.classList.add('error-banner');
        feedbackStatusBanner.classList.remove('hidden');
        feedbackStatusBannerText.textContent =
          questionsAnswered > 0
            ? `The interview ended due to an error after ${questionsAnswered} answered question${questionsAnswered === 1 ? '' : 's'}. The assessment below is based only on submitted answers.`
            : 'The interview ended due to an error before any answers were submitted.';
      }
    } else if (completionStatus === 'ended_early' || feedback?.isPartial) {
      if (feedbackStatusBadge) feedbackStatusBadge.classList.add('partial');
      if (feedbackStatusBadgeText) feedbackStatusBadgeText.textContent = 'INTERVIEW PARTIALLY COMPLETED';
      if (feedbackStatusBanner) {
        feedbackStatusBanner.classList.remove('hidden');
        feedbackStatusBannerText.textContent =
          questionsAnswered > 0
            ? `Candidate ended the interview after answering ${questionsAnswered} question${questionsAnswered === 1 ? '' : 's'}. The assessment below is based on the answers provided.`
            : 'The interview ended early before any answers were submitted.';
      }
    } else {
      if (feedbackStatusBadgeText) feedbackStatusBadgeText.textContent = 'Interview Completed';
      if (feedbackStatusBanner) {
        feedbackStatusBanner.classList.add('complete-banner');
        feedbackStatusBanner.classList.remove('hidden');
        feedbackStatusBannerText.textContent =
          questionsAnswered > 0
            ? `Interview completed after ${questionsAnswered} answered question${questionsAnswered === 1 ? '' : 's'}.`
            : 'Interview completed.';
      }
    }

    if (!feedback) {
      feedbackSummaryText.textContent = 'Interview completed. No detailed feedback was returned.';
      renderListItems(feedbackStrengthsList, [], 'No strengths recorded.');
      renderListItems(feedbackGapsList, [], 'No improvement areas recorded.');
      renderListItems(feedbackNextList, [], 'No next steps recorded.');
      renderListItems(feedbackTopicsAssessedList, [], 'No topics assessed.');
      renderListItems(feedbackTopicsNotAssessedList, [], 'No topics listed.');
      return;
    }

    feedbackSummaryText.textContent = feedback.summary || 'Assessment complete.';

    renderListItems(
      feedbackStrengthsList,
      feedback.strengths,
      completionStatus === 'no_answers'
        ? 'No technical strengths could be assessed without submitted answers.'
        : 'No specific strengths were identified from the submitted answers.'
    );

    renderListItems(
      feedbackGapsList,
      feedback.gaps,
      completionStatus === 'no_answers'
        ? 'No improvement areas could be assessed without submitted answers.'
        : 'No specific improvement areas were identified from the submitted answers.'
    );

    renderListItems(
      feedbackNextList,
      feedback.next,
      'Complete a full interview session for a comprehensive assessment.'
    );

    renderListItems(
      feedbackTopicsAssessedList,
      feedback.topicsAssessed,
      questionsAnswered > 0 ? 'Topics will appear here when assessed.' : 'No topics were assessed.'
    );

    renderListItems(
      feedbackTopicsNotAssessedList,
      feedback.topicsNotAssessed,
      'All eligible topics were covered in submitted answers.'
    );

    const coverageEl = document.getElementById('feedbackCurriculumList');
    if (coverageEl) {
      coverageEl.innerHTML = '';
      const topics = state.curriculumDays || [];
      if (topics.length > 0) {
        topics.forEach((topic) => {
          const li = document.createElement('li');
          li.textContent = topic.title;
          coverageEl.appendChild(li);
        });
      } else {
        coverageEl.innerHTML = '<li>General AI engineering topics</li>';
      }
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
      renderFeedbackScreen(state.lastFeedback);
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
    btnEndInterview.addEventListener('click', handleEndInterview);
  }

  showScreen('landing');
});
