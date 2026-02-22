/*  =============================================
    YARGHLE EFFECTS ENGINE v1.0
    - Burst from clicked image
    - Rain from top of screen
    - Audio layering
    ============================================= */

// Embedded Yarghle profile pic so it ALWAYS works
const YARGHLE_SRC = 'data:image/jpeg;base64,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';

// Track state
let clickCount = 0;
let rainInterval = null;

// ============ SPAWN A SINGLE FALLING YARGHLE ============
function spawnFallingYarghle() {
  const img = document.createElement('img');
  img.src = YARGHLE_SRC;
  img.style.cssText = `
    position: fixed;
    z-index: 1;
    pointer-events: none;
    border-radius: 50%;
    opacity: 0.7;
    top: -80px;
    left: ${Math.random() * 100}vw;
    width: ${30 + Math.random() * 40}px;
    height: auto;
  `;
  document.body.appendChild(img);

  const duration = 5000 + Math.random() * 8000;
  const startTime = performance.now();
  const rotation = Math.random() * 720;

  function animate(now) {
    const elapsed = now - startTime;
    const progress = elapsed / duration;
    if (progress >= 1) { img.remove(); return; }
    const y = -80 + (window.innerHeight + 160) * progress;
    const r = rotation * progress;
    img.style.top = y + 'px';
    img.style.transform = `rotate(${r}deg)`;
    img.style.opacity = 0.7 * (1 - progress * 0.5);
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}

// ============ BURST FROM THE CLICKED IMAGE ============
function burstFromImage(sourceEl) {
  const rect = sourceEl.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const count = 12 + Math.floor(Math.random() * 8); // 12-20 images per burst

  for (let i = 0; i < count; i++) {
    const img = document.createElement('img');
    img.src = YARGHLE_SRC;

    const size = 25 + Math.random() * 35;
    img.style.cssText = `
      position: fixed;
      z-index: 9999;
      pointer-events: none;
      border-radius: 50%;
      width: ${size}px;
      height: auto;
      left: ${centerX - size / 2}px;
      top: ${centerY - size / 2}px;
      opacity: 1;
    `;
    document.body.appendChild(img);

    // Random direction
    const angle = (Math.PI * 2 / count) * i + (Math.random() - 0.5) * 0.5;
    const speed = 200 + Math.random() * 400;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed - 200; // upward bias
    const spin = (Math.random() - 0.5) * 1440;

    const startTime = performance.now();
    const lifetime = 1500 + Math.random() * 1000;
    const gravity = 600;

    function animate(now) {
      const elapsed = (now - startTime) / 1000;
      const progress = (now - startTime) / lifetime;
      if (progress >= 1) { img.remove(); return; }

      const x = centerX - size / 2 + vx * elapsed;
      const y = centerY - size / 2 + vy * elapsed + 0.5 * gravity * elapsed * elapsed;
      const r = spin * elapsed;
      const opacity = 1 - progress;

      img.style.left = x + 'px';
      img.style.top = y + 'px';
      img.style.transform = `rotate(${r}deg) scale(${1 - progress * 0.3})`;
      img.style.opacity = opacity;
      requestAnimationFrame(animate);
    }
    // Stagger slightly
    setTimeout(() => requestAnimationFrame(animate), i * 30);
  }
}

// ============ START RAIN (called on click) ============
function startRain() {
  // Immediate burst of falling ones
  for (let i = 0; i < 10; i++) {
    setTimeout(spawnFallingYarghle, i * 60);
  }
  // Continue raining for a few seconds
  if (rainInterval) clearInterval(rainInterval);
  rainInterval = setInterval(spawnFallingYarghle, 200);
  setTimeout(() => {
    clearInterval(rainInterval);
    rainInterval = null;
  }, 5000);
}

// ============ PLAY SOUND (layers on each click) ============
function playSound() {
  clickCount++;
  const counter = document.getElementById('clickCounter');
  if (counter) counter.textContent = clickCount;

  // Layer audio
  const audio = new Audio('sounds/sound.mp3');
  audio.play().catch(() => {}); // catch autoplay block gracefully

  // Burst from the image
  const clickImg = document.getElementById('clickmeImg');
  if (clickImg) burstFromImage(clickImg);

  // Rain from top
  startRain();

  // UI indicators
  const indicator = document.getElementById('soundIndicator');
  const bars = document.getElementById('soundBars');
  if (indicator) indicator.classList.add('active');
  if (bars) bars.classList.add('active');

  // Bounce the image
  if (clickImg) {
    clickImg.style.animation = 'none';
    clickImg.offsetHeight; // reflow
    clickImg.style.animation = 'bounce 0.3s ease 3';
  }

  audio.onended = () => {
    if (indicator) indicator.classList.remove('active');
    if (bars) bars.classList.remove('active');
  };
}

// ============ TAB SWITCHING ============
function switchTab(tabName, btn) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tabName).classList.add('active');
  btn.classList.add('active');
}

// ============ COUNTDOWN (secretly resets) ============
let totalSeconds = 5 * 60;
setInterval(() => {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  const ms = Math.floor(Math.random() * 99);
  const el = document.getElementById('countdown');
  if (el) el.textContent =
    String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0') + ':' + String(ms).padStart(2, '0');
  totalSeconds--;
  if (totalSeconds < 0) totalSeconds = 5 * 60;
}, 1000);

// ============ REAL VISITOR COUNT (GoatCounter) ============
async function fetchVisitorCount() {
  const el = document.getElementById('visitorCount');
  if (!el) return;
  try {
    const resp = await fetch('https://mlakarboyz.goatcounter.com/counter/%2f.json');
    if (resp.ok) {
      const data = await resp.json();
      el.textContent = data.count;
    } else { el.textContent = '???'; }
  } catch (e) { el.textContent = '???'; }
}
fetchVisitorCount();
setInterval(fetchVisitorCount, 30000);

// ============ UNITS LEFT ============
setInterval(() => {
  const el = document.getElementById('unitsLeft');
  if (el) el.textContent = Math.floor(Math.random() * 5) + 3;
}, 4000);

// ============ FAKE DOWNLOAD POPUP ============
let redirectUrl = '';
function showPopup(event, el) {
  event.preventDefault();
  redirectUrl = el.href;
  const messages = [
    'Initializing RAM transfer protocols...',
    'Converting internet bits to physical RAM...',
    'Hacking the mainframe... beep boop...',
    'Downloading money from the cloud...',
    'Contacting Nigerian prince for funds...',
    'Overclocking your WiFi to download faster...',
    'Asking permission from the Internet Elders...',
  ];
  document.getElementById('popupDesc').textContent = messages[Math.floor(Math.random() * messages.length)];
  document.getElementById('overlay').style.display = 'block';
  document.getElementById('fakePopup').style.display = 'block';
  let progress = 0;
  const loadingFill = document.getElementById('loadingFill');
  const loadingText = document.getElementById('loadingText');
  const interval = setInterval(() => {
    progress += Math.random() * 8 + 2;
    if (progress >= 100) {
      progress = 100;
      clearInterval(interval);
      loadingText.textContent = 'REDIRECTING...';
      setTimeout(() => { closePopup(); window.open(redirectUrl, '_blank'); }, 800);
    }
    loadingFill.style.width = progress + '%';
    loadingText.textContent = Math.floor(progress) + '%';
  }, 150);
}

function closePopup() {
  document.getElementById('overlay').style.display = 'none';
  document.getElementById('fakePopup').style.display = 'none';
  document.getElementById('loadingFill').style.width = '0%';
  document.getElementById('loadingText').textContent = '0%';
}

// ============ FORUM SYSTEM ============

function sanitize(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
  return d.toLocaleDateString();
}

// ---- URL / LINK FILTER ----
function containsLink(text) {
  const patterns = [
    /https?:\/\//i,
    /www\./i,
    /\.[a-z]{2,6}(\/|\s|$)/i,
    /\(dot\)/i, /\[dot\]/i, /\{dot\}/i,
    /\(\.\)/i, /\[\.\]/i,
    / dot /i,
    /\w+\s*\.\s*(com|net|org|io|co|gg|me|tv|info|biz|xyz|site|vip|dev|app)\b/i,
  ];
  return patterns.some(p => p.test(text));
}

// ---- VOTE TRACKING ----
function getVotes() {
  try { return JSON.parse(localStorage.getItem('yarghle_votes') || '{}'); }
  catch (e) { return {}; }
}
function saveVote(threadId, direction) {
  const votes = getVotes();
  votes[threadId] = direction;
  try { localStorage.setItem('yarghle_votes', JSON.stringify(votes)); } catch(e) {}
}

// ---- MOD SESSION ----
function getModSession() {
  try { return JSON.parse(localStorage.getItem('yarghle_mod') || 'null'); }
  catch (e) { return null; }
}
function saveModSession(session) {
  try { localStorage.setItem('yarghle_mod', JSON.stringify(session)); } catch(e) {}
}
function clearModSession() {
  try { localStorage.removeItem('yarghle_mod'); } catch(e) {}
}
function isMod() {
  const s = getModSession();
  return s && (s.role === 'mod' || s.role === 'owner');
}
function isOwner() {
  const s = getModSession();
  return s && s.role === 'owner';
}

function roleBadge(role) {
  if (role === 'owner') return '<span class="role-badge owner">👑 OWNER</span>';
  if (role === 'mod') return '<span class="role-badge mod">⚔️ MOD</span>';
  return '';
}

function updateModUI() {
  const session = getModSession();
  const loginBtn = document.getElementById('modLoginToggle');
  const loggedInInfo = document.getElementById('modLoggedInInfo');

  if (session) {
    if (loginBtn) loginBtn.textContent = '🚪 LOGOUT';
    if (loggedInInfo) {
      loggedInInfo.style.display = 'flex';
      loggedInInfo.innerHTML = `${roleBadge(session.role)} ${sanitize(session.display_name)}`;
    }
  } else {
    if (loginBtn) loginBtn.textContent = '🔑 MOD LOGIN';
    if (loggedInInfo) loggedInInfo.style.display = 'none';
  }
}

function toggleModLogin() {
  const session = getModSession();
  if (session) {
    clearModSession();
    updateModUI();
    document.getElementById('modLoginPanel')?.classList.remove('visible');
    // Re-render to hide delete buttons
    renderThreads(allThreads);
    if (currentThreadId) openThread(currentThreadId);
    return;
  }
  document.getElementById('modLoginPanel')?.classList.toggle('visible');
}

async function modLogin() {
  const code = document.getElementById('modInviteCode')?.value.trim();
  const nameField = document.getElementById('modDisplayName');
  const errorDiv = document.getElementById('modLoginError');
  if (errorDiv) errorDiv.innerHTML = '';

  if (!code) { if (errorDiv) errorDiv.innerHTML = '<div class="forum-error">Enter an invite code!</div>'; return; }
  if (!supabaseClient) return;

  try {
    const { data, error } = await supabaseClient
      .from('mod_accounts')
      .select('*')
      .eq('invite_code', code)
      .single();

    if (error || !data) {
      if (errorDiv) errorDiv.innerHTML = '<div class="forum-error">Invalid invite code!</div>';
      return;
    }

    // If unclaimed, need display name
    if (!data.is_claimed) {
      const name = nameField?.value.trim();
      if (!name) {
        nameField.style.display = 'block';
        if (errorDiv) errorDiv.innerHTML = '<div class="filter-warning">Code accepted! Now choose your display name above.</div>';
        return;
      }
      // Claim the account
      await supabaseClient
        .from('mod_accounts')
        .update({ display_name: name, is_claimed: true })
        .eq('id', data.id);
      data.display_name = name;
    }

    // Save session
    saveModSession({ code: data.invite_code, display_name: data.display_name, role: data.role });
    updateModUI();
    document.getElementById('modLoginPanel')?.classList.remove('visible');
    document.getElementById('modInviteCode').value = '';
    if (nameField) { nameField.value = ''; nameField.style.display = 'none'; }

    // Re-render to show delete buttons
    renderThreads(allThreads);
    if (currentThreadId) openThread(currentThreadId);

  } catch (e) {
    console.error('Mod login error:', e);
    if (errorDiv) errorDiv.innerHTML = '<div class="forum-error">Login failed. Try again!</div>';
  }
}

// ---- STATE ----
let allThreads = [];
let currentThreadId = null;

// ---- LOAD THREADS ----
async function loadThreads() {
  const container = document.getElementById('forumThreadList');
  const countEl = document.getElementById('forumCount');
  if (!container || !supabaseClient) return;

  try {
    const { data, error } = await supabaseClient
      .from('forum_threads')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;
    allThreads = data || [];
    renderThreads(allThreads);
    if (countEl) countEl.textContent = allThreads.length + ' thread' + (allThreads.length !== 1 ? 's' : '') + ' in the tavern';
  } catch (e) {
    console.error('Load threads error:', e);
    container.innerHTML = '<div class="forum-empty" style="color: var(--sketch-red);">Failed to load threads. Try refreshing!</div>';
  }
}

function renderThreads(threads) {
  const container = document.getElementById('forumThreadList');
  if (!container) return;
  const votes = getVotes();
  const canDelete = isMod();

  if (!threads || threads.length === 0) {
    container.innerHTML = '<div class="forum-empty">No threads yet... Be the first pirate to post! 🏴‍☠️</div>';
    return;
  }

  container.innerHTML = threads.map(t => {
    const score = (t.upvotes || 0) - (t.downvotes || 0);
    const myVote = votes[t.id] || null;
    const preview = t.message.length > 120 ? t.message.substring(0, 120) + '...' : t.message;
    const badge = roleBadge(t.role);
    const deleteBtn = canDelete
      ? `<button class="delete-btn" onclick="event.stopPropagation(); deleteThread(${t.id})">🗑️ Delete</button>`
      : '';
    return `
      <div class="thread-item" onclick="openThread(${t.id})">
        <div class="thread-votes" onclick="event.stopPropagation()">
          <button class="vote-btn ${myVote === 'up' ? 'upvoted' : ''}" onclick="event.stopPropagation(); voteThread(${t.id}, 'up')">▲</button>
          <span class="vote-score ${score < 0 ? 'negative' : ''}">${score}</span>
          <button class="vote-btn ${myVote === 'down' ? 'downvoted' : ''}" onclick="event.stopPropagation(); voteThread(${t.id}, 'down')">▼</button>
        </div>
        <div class="thread-content">
          <div class="thread-title">${sanitize(t.title)} ${badge}</div>
          <div class="thread-meta">
            <span>🏴‍☠️ ${sanitize(t.username)}</span>
            <span>${formatDate(t.created_at)}</span>
            <span>💬 ${t.comment_count || 0}</span>
            ${deleteBtn}
          </div>
          <div class="thread-preview">${sanitize(preview)}</div>
        </div>
      </div>`;
  }).join('');
}

// ---- SEARCH / FILTER ----
function filterThreads() {
  const query = (document.getElementById('forumSearch')?.value || '').toLowerCase().trim();
  if (!query) { renderThreads(allThreads); return; }
  const filtered = allThreads.filter(t =>
    t.title.toLowerCase().includes(query) ||
    t.message.toLowerCase().includes(query) ||
    t.username.toLowerCase().includes(query)
  );
  renderThreads(filtered);
}

// ---- NEW THREAD ----
function toggleNewThread() {
  const form = document.getElementById('newThreadForm');
  if (form) form.classList.toggle('visible');
}

async function submitThread() {
  const usernameEl = document.getElementById('threadUsername');
  const title = document.getElementById('threadTitle')?.value.trim();
  const message = document.getElementById('threadMessage')?.value.trim();
  const errorDiv = document.getElementById('threadError');
  const btn = document.getElementById('threadSubmitBtn');
  const session = getModSession();

  // If mod is logged in, use their display name
  let username = session ? session.display_name : usernameEl?.value.trim();
  let role = session ? session.role : null;

  if (errorDiv) errorDiv.innerHTML = '';
  if (!username) { if (errorDiv) errorDiv.innerHTML = '<div class="forum-error">Ye need a pirate name!</div>'; return; }
  if (!title) { if (errorDiv) errorDiv.innerHTML = '<div class="forum-error">Give yer thread a title!</div>'; return; }
  if (!message) { if (errorDiv) errorDiv.innerHTML = '<div class="forum-error">Write something!</div>'; return; }

  // URL filter
  if (containsLink(title) || containsLink(message)) {
    if (errorDiv) errorDiv.innerHTML = '<div class="forum-error">⚠️ Links and URLs are not allowed in posts!</div>';
    return;
  }
  if (!supabaseClient) return;

  btn.disabled = true;
  btn.textContent = '⏳ POSTING...';

  try {
    const { error } = await supabaseClient
      .from('forum_threads')
      .insert([{ username, title, message, role }]);
    if (error) throw error;

    if (usernameEl) usernameEl.value = '';
    document.getElementById('threadTitle').value = '';
    document.getElementById('threadMessage').value = '';
    document.getElementById('newThreadForm').classList.remove('visible');
    await loadThreads();
  } catch (e) {
    console.error('Submit thread error:', e);
    if (errorDiv) errorDiv.innerHTML = '<div class="forum-error">Failed to post: ' + sanitize(e.message) + '</div>';
  } finally {
    btn.disabled = false;
    btn.textContent = '🏴‍☠️ POST THREAD';
  }
}

// ---- VOTING ----
async function voteThread(threadId, direction) {
  if (!supabaseClient) return;
  const votes = getVotes();
  const current = votes[threadId];
  const thread = allThreads.find(t => t.id === threadId);
  if (!thread) return;

  let upDelta = 0, downDelta = 0;
  if (current === direction) {
    if (direction === 'up') upDelta = -1; else downDelta = -1;
    saveVote(threadId, null);
  } else {
    if (current === 'up') upDelta = -1;
    if (current === 'down') downDelta = -1;
    if (direction === 'up') upDelta += 1; else downDelta += 1;
    saveVote(threadId, direction);
  }

  thread.upvotes = (thread.upvotes || 0) + upDelta;
  thread.downvotes = (thread.downvotes || 0) + downDelta;
  renderThreads(allThreads);

  try {
    await supabaseClient
      .from('forum_threads')
      .update({ upvotes: thread.upvotes, downvotes: thread.downvotes })
      .eq('id', threadId);
  } catch (e) { console.error('Vote error:', e); }
}

// ---- DELETE ----
async function deleteThread(threadId) {
  if (!isMod() || !supabaseClient) return;
  if (!confirm('Delete this thread and all its comments?')) return;

  try {
    await supabaseClient.from('forum_comments').delete().eq('thread_id', threadId);
    await supabaseClient.from('forum_threads').delete().eq('id', threadId);
    allThreads = allThreads.filter(t => t.id !== threadId);
    renderThreads(allThreads);
    if (currentThreadId === threadId) showThreadList();
  } catch (e) { console.error('Delete thread error:', e); }
}

async function deleteComment(commentId) {
  if (!isMod() || !supabaseClient || !currentThreadId) return;
  if (!confirm('Delete this comment?')) return;

  try {
    await supabaseClient.from('forum_comments').delete().eq('id', commentId);
    // Decrement comment count
    const thread = allThreads.find(t => t.id === currentThreadId);
    if (thread && thread.comment_count > 0) {
      thread.comment_count--;
      await supabaseClient.from('forum_threads').update({ comment_count: thread.comment_count }).eq('id', currentThreadId);
    }
    await loadComments(currentThreadId);
  } catch (e) { console.error('Delete comment error:', e); }
}

// ---- OPEN THREAD ----
async function openThread(threadId) {
  currentThreadId = threadId;
  document.getElementById('forumListView').style.display = 'none';
  const detail = document.getElementById('forumDetailView');
  detail.classList.add('visible');

  const thread = allThreads.find(t => t.id === threadId);
  if (!thread) return;

  const votes = getVotes();
  const myVote = votes[threadId] || null;
  const score = (thread.upvotes || 0) - (thread.downvotes || 0);
  const badge = roleBadge(thread.role);
  const canDelete = isMod();
  const deleteBtn = canDelete
    ? `<button class="delete-btn" onclick="deleteThread(${threadId})" style="margin-top: 10px;">🗑️ Delete Thread</button>`
    : '';

  document.getElementById('threadDetailContent').innerHTML = `
    <div class="thread-detail-post">
      <div class="thread-detail-title">${sanitize(thread.title)} ${badge}</div>
      <div class="thread-detail-meta">🏴‍☠️ ${sanitize(thread.username)} · ${formatDate(thread.created_at)}</div>
      <div class="thread-detail-body">${sanitize(thread.message)}</div>
      <div style="display: flex; align-items: center; gap: 10px; margin-top: 10px; flex-wrap: wrap;">
        <div class="thread-votes" style="flex-direction: row; gap: 10px;">
          <button class="vote-btn ${myVote === 'up' ? 'upvoted' : ''}" onclick="voteThread(${threadId}, 'up'); openThread(${threadId});">▲</button>
          <span class="vote-score ${score < 0 ? 'negative' : ''}">${score}</span>
          <button class="vote-btn ${myVote === 'down' ? 'downvoted' : ''}" onclick="voteThread(${threadId}, 'down'); openThread(${threadId});">▼</button>
        </div>
        ${deleteBtn}
      </div>
    </div>`;

  // If mod logged in, pre-fill username fields
  const session = getModSession();
  const commentUser = document.getElementById('commentUsername');
  if (session && commentUser) {
    commentUser.value = session.display_name;
    commentUser.readOnly = true;
  } else if (commentUser) {
    commentUser.readOnly = false;
  }

  await loadComments(threadId);
}

function showThreadList() {
  currentThreadId = null;
  document.getElementById('forumListView').style.display = 'block';
  document.getElementById('forumDetailView').classList.remove('visible');
}

// ---- COMMENTS ----
async function loadComments(threadId) {
  const container = document.getElementById('commentsList');
  const header = document.getElementById('commentsHeader');
  if (!container || !supabaseClient) return;

  container.innerHTML = '<div style="text-align: center; color: var(--neon-green); padding: 15px;">Loading comments...</div>';

  try {
    const { data, error } = await supabaseClient
      .from('forum_comments')
      .select('*')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true })
      .limit(100);

    if (error) throw error;
    if (header) header.textContent = '💬 COMMENTS (' + (data?.length || 0) + ')';
    const canDelete = isMod();

    if (!data || data.length === 0) {
      container.innerHTML = '<div class="forum-empty" style="padding: 20px; font-size: 10px;">No comments yet. Be the first!</div>';
      return;
    }

    container.innerHTML = data.map(c => {
      const badge = roleBadge(c.role);
      const del = canDelete ? `<button class="delete-btn" onclick="deleteComment(${c.id})" style="font-size: 10px; padding: 2px 6px;">🗑️</button>` : '';
      return `
      <div class="comment-item">
        <div class="comment-header">
          <span><span class="comment-username">🏴‍☠️ ${sanitize(c.username)}</span> ${badge}</span>
          <span style="display: flex; align-items: center; gap: 8px;">${formatDate(c.created_at)} ${del}</span>
        </div>
        <div class="comment-body">${sanitize(c.message)}</div>
      </div>`;
    }).join('');

  } catch (e) {
    console.error('Load comments error:', e);
    container.innerHTML = '<div class="forum-empty" style="color: var(--sketch-red);">Failed to load comments.</div>';
  }
}

async function submitComment() {
  const usernameEl = document.getElementById('commentUsername');
  const message = document.getElementById('commentMessage')?.value.trim();
  const errorDiv = document.getElementById('commentError');
  const btn = document.getElementById('commentSubmitBtn');
  const session = getModSession();

  let username = session ? session.display_name : usernameEl?.value.trim();
  let role = session ? session.role : null;

  if (errorDiv) errorDiv.innerHTML = '';
  if (!username) { if (errorDiv) errorDiv.innerHTML = '<div class="forum-error">Ye need a name!</div>'; return; }
  if (!message) { if (errorDiv) errorDiv.innerHTML = '<div class="forum-error">Write a comment!</div>'; return; }

  // URL filter
  if (containsLink(message)) {
    if (errorDiv) errorDiv.innerHTML = '<div class="forum-error">⚠️ Links and URLs are not allowed in comments!</div>';
    return;
  }
  if (!supabaseClient || !currentThreadId) return;

  btn.disabled = true;
  btn.textContent = '⏳ POSTING...';

  try {
    const { error } = await supabaseClient
      .from('forum_comments')
      .insert([{ thread_id: currentThreadId, username, message, role }]);
    if (error) throw error;

    const thread = allThreads.find(t => t.id === currentThreadId);
    if (thread) {
      thread.comment_count = (thread.comment_count || 0) + 1;
      await supabaseClient.from('forum_threads').update({ comment_count: thread.comment_count }).eq('id', currentThreadId);
    }

    document.getElementById('commentMessage').value = '';
    await loadComments(currentThreadId);
  } catch (e) {
    console.error('Submit comment error:', e);
    if (errorDiv) errorDiv.innerHTML = '<div class="forum-error">Failed to post comment.</div>';
  } finally {
    btn.disabled = false;
    btn.textContent = '💬 POST COMMENT';
  }
}

// ---- INIT ----
document.addEventListener('DOMContentLoaded', () => {
  updateModUI();
  loadThreads();
  // If mod logged in, pre-fill thread username
  const session = getModSession();
  const threadUser = document.getElementById('threadUsername');
  if (session && threadUser) {
    threadUser.value = session.display_name;
    threadUser.readOnly = true;
  }
});
