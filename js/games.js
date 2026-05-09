/* =================================================================
   YARGHLE GAMES MODULE v1.0
   - Game picker → public lobby per game → in-game room
   - Realtime sync via Supabase (postgres_changes + broadcast)
   - Mobile-first touch UI (tap-to-select, tap-to-move)
   ================================================================= */

(function () {
  'use strict';

  // ============ STATE ============
  let view            = 'picker';       // 'picker' | 'lobby' | 'room'
  let currentGameType = null;           // 'chess' | 'checkers' | 'tictactoe' | 'connect4' | 'draw'
  let currentRoomId   = null;
  let currentRoom     = null;           // local cached row from game_rooms
  let myRole          = null;           // 'player' | 'spectator'
  let mySlot          = null;           // 0 | 1 (board games)
  let lobbyChannel    = null;
  let roomChannel     = null;
  let drawChannel     = null;
  let lobbyRooms      = [];

  const SUPA = () => (typeof supabaseClient !== 'undefined' ? supabaseClient : null);

  // ============ PLAYER NAME (persisted) ============
  function getPlayerName()   { return localStorage.getItem('yarghle_player_name') || ''; }
  function setPlayerName(n)  { localStorage.setItem('yarghle_player_name', n); }

  function ensureName() {
    const n = getPlayerName();
    if (n && n.trim()) return n.trim();
    const asked = (prompt('Pick a pirate name:') || '').trim().slice(0, 24);
    if (!asked) return null;
    setPlayerName(asked);
    return asked;
  }

  // ============ HELPERS ============
  function esc(str) {
    const d = document.createElement('div'); d.textContent = String(str ?? ''); return d.innerHTML;
  }
  function fmtAge(ts) {
    const diff = (Date.now() - new Date(ts).getTime()) / 1000;
    if (diff < 60)    return 'just now';
    if (diff < 3600)  return Math.floor(diff / 60)   + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }
  function $(id) { return document.getElementById(id); }

  // ============ CATEGORY REGISTRY ============
  const CATEGORIES = {
    all:      { label: 'ALL',      emoji: '🎮' },
    classic:  { label: 'CLASSIC',  emoji: '♟️' },
    casino:   { label: 'CASINO',   emoji: '🃏' },
    party:    { label: 'PARTY',    emoji: '🎉' },
    creative: { label: 'CREATIVE', emoji: '🎨' },
  };
  let currentCategory = 'all';
  let searchQuery     = '';

  // ============ GAME REGISTRY ============
  const GAMES = {
    tictactoe: {
      name: 'Tic-Tac-Toe',
      emoji: '❌⭕',
      blurb: 'Classic 3-in-a-row. Quick games while ye wait for grog.',
      color: '#fff700',
      category: 'classic',
      maxPlayers: 2,
      initialState: () => ({ board: Array(9).fill(null), turn: 0, winner: null }),
    },
    connect4: {
      name: 'Connect 4',
      emoji: '🔴🟡',
      blurb: '7×6 grid. Drop discs, get four in a row.',
      color: '#ff1493',
      category: 'classic',
      maxPlayers: 2,
      initialState: () => ({ board: Array(42).fill(null), turn: 0, winner: null }),
    },
    checkers: {
      name: 'Checkers',
      emoji: '⚫🔴',
      blurb: '8×8 board. Force jumps. Crown yer pieces.',
      color: '#39ff14',
      category: 'classic',
      maxPlayers: 2,
      initialState: () => ({ board: initCheckersBoard(), turn: 0, winner: null, mustJumpFrom: null }),
    },
    chess: {
      name: 'Chess',
      emoji: '♟️',
      blurb: '2 players. Capture the king. Spectators welcome.',
      color: '#00ffff',
      category: 'classic',
      maxPlayers: 2,
      initialState: () => ({ fen: 'start', lastMove: null, winner: null }),
    },
    blackjack: {
      name: 'Blackjack',
      emoji: '🃏',
      blurb: '1-6 players vs the dealer. Hit 21, beat the house.',
      color: '#ff8800',
      category: 'casino',
      maxPlayers: 6,
      isCasino:  true,                // → uses ready-up lobby flow
      initialState: () => ({
        phase:  'lobby',              // 'lobby' | 'betting' | 'playing' | 'dealer' | 'roundend' | 'finished'
        config: { startingChips: 1000, elimination: false },
        round:  0,
        chips:  {},                   // { name: number }
        bets:   {},                   // { name: number } current round
        hands:  {},                   // { name: [{rank, suit}] }
        hasStood: {},                 // { name: bool }
        dealerHand:   [],
        dealerHidden: true,
        deck:    [],
        currentTurn: null,            // name whose turn it is
        turnOrder:   [],
        results: {},                  // { name: { outcome, payout } } during roundend
        ready:   [],                  // names ready in lobby phase
        eliminated: [],               // names out (elimination mode)
      }),
    },
    poker: {
      name: "Texas Hold'em",
      emoji: '♠️♥️',
      blurb: '2-8 players. No-limit hold\'em poker. Bluff yer way to the chip lead.',
      color: '#9d4edd',
      category: 'casino',
      maxPlayers: 8,
      isCasino:  true,
      initialState: () => ({
        phase:  'lobby',              // 'lobby' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'handend' | 'finished'
        config: { startingChips: 1000, smallBlind: 5, bigBlind: 10, elimination: false },
        ready:  [],
        chips:  {},                   // { name: number }
        eliminated: [],
        handNumber: 0,
        dealerName: null,
        // Per-hand state
        deck:        [],
        communityCards: [],
        pot:         0,
        currentBet:  0,
        minRaise:    0,
        currentTurn: null,
        turnOrder:   [],              // ordered names; index 0 acts first this round
        hands:       {},              // { name: [card, card] }
        bets:        {},              // { name: chips bet this round }
        totalBets:   {},              // { name: chips bet this hand total }
        inHand:      [],              // names not folded
        hasActed:    [],              // names who acted this betting round
        allIn:       [],              // names all-in this hand
        lastHandResults: null,        // for handend display
      }),
    },
    draw: {
      name: 'Drawing Room',
      emoji: '🎨',
      blurb: 'Up to 6 drawers on a shared canvas. Like PictoChat.',
      color: '#ff6ec7',
      category: 'creative',
      maxPlayers: 6,
      initialState: () => ({ chat: [] }),
    },
    skribbl: {
      name: 'Skribbl',
      emoji: '✏️',
      blurb: '3-8 pirates. Draw the word, others guess. First correct = most points.',
      color: '#ff6ec7',
      category: 'party',
      maxPlayers: 8,
      isParty: true,
      initialState: () => ({
        phase:  'lobby',                  // 'lobby' | 'choosing' | 'drawing' | 'roundend' | 'finished'
        config: { rounds: 3, drawTime: 80, customWordsOnly: false },
        ready:  [],
        scores: {},                       // { name: total }
        roundScores: {},                  // { name: pts this round } (cleared each round)
        roundNumber: 0,
        totalRounds: 0,                   // computed from rounds × players
        drawOrder: [],                    // [name, name, ...] sequence of drawers
        drawerIdx: 0,                     // index into drawOrder
        currentDrawer: null,
        currentWord:   null,              // ground truth word
        wordChoices:   null,              // 3 options for drawer
        revealedWord:  '',                // '_ _ _' representation with progressive hints
        hintsRevealed: 0,
        roundEndsAt:   null,              // ms timestamp
        guessers:      [],                // names who guessed correctly this round
        chatLog:       [],                // [{name, msg, type}] type='guess'|'correct'|'system'|'closeguess'
        customWords:   [],                // host-supplied word pool
      }),
    },
    chameleon: {
      name: 'Chameleon',
      emoji: '🦎',
      blurb: '3-8 pirates. One is the Chameleon — bluff or be caught.',
      color: '#39ff14',
      category: 'party',
      maxPlayers: 8,
      isParty: true,
      initialState: () => ({
        phase:  'lobby',                  // 'lobby' | 'reveal' | 'speaking' | 'voting' | 'accusation' | 'guess' | 'roundend' | 'finished'
        config: { rounds: 5 },
        ready:  [],
        scores: {},                       // { name: total }
        roundNumber: 0,
        currentTopic:   null,             // { name, words: [...16] }
        currentWord:    null,             // secret word
        currentChameleon: null,           // name
        speakOrder:     [],
        currentSpeaker: null,
        spokenWords:    {},               // { name: word said }
        votes:          {},               // { voterName: accusedName }
        accused:        null,             // name with most votes
        chameleonGuess: null,             // word the chameleon guessed if caught
        roundResult:    null,             // 'chameleon-escaped' | 'chameleon-guessed' | 'caught'
      }),
    },
  };

  // =================================================================
  // VIEW SWITCHER
  // =================================================================
  function showView(name) {
    view = name;
    ['picker', 'lobby', 'room'].forEach(v => {
      const el = $('games-' + v);
      if (el) el.style.display = (v === name) ? 'block' : 'none';
    });
  }

  // =================================================================
  // PICKER (game selection)
  // =================================================================
  function renderPicker() {
    const wrap = $('games-picker-grid');
    if (!wrap) return;
    const me = getPlayerName();
    const nameLine = me
      ? `<div class="games-name-line">Playing as <strong>${esc(me)}</strong> · <a href="#" id="games-change-name">change</a></div>`
      : `<div class="games-name-line">Pick a name when ye join yer first game.</div>`;

    // Category pills
    const pills = Object.entries(CATEGORIES).map(([key, c]) => `
      <button class="cat-pill ${currentCategory === key ? 'active' : ''}" data-cat="${key}">
        ${c.emoji} ${c.label}
      </button>`).join('');

    // Filter games by category + search
    const q = searchQuery.trim().toLowerCase();
    const filtered = Object.entries(GAMES).filter(([key, g]) => {
      if (currentCategory !== 'all' && g.category !== currentCategory) return false;
      if (!q) return true;
      return g.name.toLowerCase().includes(q) || g.blurb.toLowerCase().includes(q);
    });

    const grid = filtered.length === 0
      ? '<div class="games-empty">No games match yer search, scallywag.</div>'
      : '<div class="games-grid">' + filtered.map(([key, g]) => `
          <button class="game-card" data-game="${key}" style="border-color:${g.color};">
            <span class="game-emoji">${g.emoji}</span>
            <span class="game-name" style="color:${g.color};">${esc(g.name)}</span>
            <span class="game-blurb">${esc(g.blurb)}</span>
            <span class="game-cta" style="background:${g.color};">ENTER LOBBY →</span>
          </button>`).join('') + '</div>';

    wrap.innerHTML = `
      ${nameLine}
      <div class="cat-pills">${pills}</div>
      <div class="games-search-row">
        <input type="text" id="games-search" class="games-search" placeholder="🔍 Search games..." value="${esc(searchQuery)}">
      </div>
      ${grid}`;

    wrap.querySelectorAll('.game-card').forEach(btn => {
      btn.addEventListener('click', () => enterLobby(btn.dataset.game));
    });
    wrap.querySelectorAll('.cat-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        currentCategory = btn.dataset.cat;
        renderPicker();
      });
    });
    const search = $('games-search');
    if (search) {
      search.addEventListener('input', e => {
        searchQuery = e.target.value;
        // Re-render but preserve focus + cursor position
        const pos = search.selectionStart;
        renderPicker();
        const newSearch = $('games-search');
        if (newSearch) { newSearch.focus(); try { newSearch.setSelectionRange(pos, pos); } catch(e){} }
      });
    }
    const change = $('games-change-name');
    if (change) change.addEventListener('click', e => {
      e.preventDefault();
      localStorage.removeItem('yarghle_player_name');
      ensureName();
      renderPicker();
    });
  }

  // =================================================================
  // LOBBY (per game type)
  // =================================================================
  async function enterLobby(gameType) {
    if (!GAMES[gameType]) return;
    currentGameType = gameType;
    showView('lobby');
    await loadLobby();
    subscribeLobby();
  }

  async function loadLobby() {
    if (!SUPA()) { showLobbyError('Supabase client not loaded. Check the script tags in index.html.'); return; }
    const cutoff = new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString();   // hide rooms idle > 6h
    const { data, error } = await SUPA()
      .from('game_rooms')
      .select('*')
      .eq('game_type', currentGameType)
      .neq('status', 'finished')
      .gte('updated_at', cutoff)
      .order('updated_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('Lobby load error:', error);
      showLobbyError('Failed to load lobby: ' + (error.message || 'Unknown error') + ' (code: ' + (error.code || '?') + ')');
      return;
    }
    lobbyRooms = data || [];
    renderLobby();

    // Best-effort cleanup: nuke any rooms idle > 24h
    const oldCutoff = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();
    SUPA().from('game_rooms').delete().lt('updated_at', oldCutoff).then(() => {});
  }

  function showLobbyError(msg) {
    const g = GAMES[currentGameType] || { name: 'GAMES', emoji: '⚠️', color: 'var(--sketch-red)' };
    const wrap = $('games-lobby');
    if (!wrap) return;
    wrap.innerHTML = `
      <div class="lobby-head">
        <button class="lobby-back" id="lobby-back-btn">← GAMES</button>
        <h2 style="color: var(--sketch-red);">⚠️ ERROR</h2>
        <span style="min-width: 100px;"></span>
      </div>
      <div class="games-empty" style="color: var(--sketch-red); font-size: 13px; line-height: 1.6;">${esc(msg)}</div>
      <div class="games-empty" style="font-size: 10px; padding-top: 0;">
        Open browser DevTools (F12) → Console tab for full details.<br>
        Most common cause: the <code>game_rooms</code> table doesn't exist yet — re-run the SQL in Supabase.
      </div>`;
    const back = $('lobby-back-btn');
    if (back) back.addEventListener('click', leaveLobby);
  }

  function renderLobby() {
    const g = GAMES[currentGameType];
    const wrap = $('games-lobby');
    if (!wrap || !g) return;

    const cards = lobbyRooms.map(r => {
      const players    = (r.players    || []);
      const spectators = (r.spectators || []);
      const isFull     = players.length >= r.max_players;
      const playerNames= players.map(p => esc(p.name)).join(', ') || '<em style="color:#666">(none)</em>';
      const statusTag  = r.status === 'playing' ? '<span class="room-tag playing">PLAYING</span>'
                       : r.status === 'finished' ? '<span class="room-tag finished">FINISHED</span>'
                       : '<span class="room-tag waiting">WAITING</span>';
      return `
        <div class="room-card">
          <div class="room-card-head">
            <span class="room-host">🏴‍☠️ ${esc(r.host_name)}</span>
            ${statusTag}
            <span class="room-age">${fmtAge(r.updated_at)}</span>
          </div>
          <div class="room-card-body">
            <span class="room-meta">Players (${players.length}/${r.max_players}): ${playerNames}</span>
            <span class="room-meta">👀 ${spectators.length} spectator${spectators.length === 1 ? '' : 's'}</span>
          </div>
          <div class="room-card-actions">
            ${(!isFull && r.status !== 'finished')
              ? `<button class="room-btn join" data-room="${r.id}" data-as="player">JOIN AS PLAYER</button>` : ''}
            <button class="room-btn spectate" data-room="${r.id}" data-as="spectator">${isFull ? '🍿 SPECTATE' : '👀 SPECTATE'}</button>
          </div>
        </div>`;
    }).join('') || '<div class="games-empty">No rooms yet. Be the first pirate to host!</div>';

    wrap.innerHTML = `
      <div class="lobby-head">
        <button class="lobby-back" id="lobby-back-btn">← GAMES</button>
        <h2 style="color:${g.color};">${g.emoji} ${esc(g.name).toUpperCase()} LOBBY</h2>
        <button class="lobby-host" id="lobby-host-btn" style="background:${g.color};">🏴‍☠️ HOST NEW ROOM</button>
      </div>
      <div class="lobby-blurb">${esc(g.blurb)}</div>
      <div class="lobby-rooms">${cards}</div>`;

    $('lobby-back-btn').addEventListener('click', leaveLobby);
    $('lobby-host-btn').addEventListener('click', hostRoom);
    wrap.querySelectorAll('.room-btn').forEach(b => {
      b.addEventListener('click', () => joinRoom(parseInt(b.dataset.room, 10), b.dataset.as));
    });
  }

  function subscribeLobby() {
    if (lobbyChannel) { SUPA().removeChannel(lobbyChannel); lobbyChannel = null; }
    lobbyChannel = SUPA()
      .channel('lobby-' + currentGameType)
      .on('postgres_changes',
          { event: '*', schema: 'public', table: 'game_rooms', filter: `game_type=eq.${currentGameType}` },
          () => { if (view === 'lobby') loadLobby(); })
      .subscribe();
  }

  async function leaveLobby() {
    if (lobbyChannel) { SUPA().removeChannel(lobbyChannel); lobbyChannel = null; }
    currentGameType = null;
    showView('picker');
    renderPicker();
  }

  // =================================================================
  // HOST / JOIN
  // =================================================================
  async function hostRoom() {
    const name = ensureName(); if (!name) return;
    const g = GAMES[currentGameType]; if (!g || !SUPA()) return;
    const initial = g.initialState();
    const { data, error } = await SUPA()
      .from('game_rooms')
      .insert([{
        game_type:   currentGameType,
        host_name:   name,
        status:      'waiting',
        players:     [{ name, slot: 0 }],
        spectators:  [],
        state:       initial,
        max_players: g.maxPlayers,
      }])
      .select()
      .single();
    if (error) { alert('Failed to host: ' + error.message); return; }
    myRole = 'player'; mySlot = 0;
    enterRoom(data);
  }

  async function joinRoom(roomId, as) {
    const name = ensureName(); if (!name) return;
    if (!SUPA()) return;

    const { data: room, error } = await SUPA()
      .from('game_rooms').select('*').eq('id', roomId).single();
    if (error || !room) { alert('Room is gone, matey.'); loadLobby(); return; }

    let players    = room.players    || [];
    let spectators = room.spectators || [];

    // If they're already in, just enter.
    const playerIdx = players.findIndex(p => p.name === name);
    if (playerIdx >= 0) {
      myRole = 'player'; mySlot = players[playerIdx].slot;
      enterRoom(room); return;
    }
    if (spectators.some(s => s.name === name)) {
      myRole = 'spectator'; mySlot = null;
      enterRoom(room); return;
    }

    if (as === 'player' && players.length < room.max_players) {
      const usedSlots = new Set(players.map(p => p.slot));
      let slot = 0;
      while (usedSlots.has(slot)) slot++;
      players.push({ name, slot });
      myRole = 'player'; mySlot = slot;
    } else {
      spectators.push({ name });
      myRole = 'spectator'; mySlot = null;
    }

    // Auto-start when full (board games only — casino + party games use ready-up flow)
    let newStatus = room.status;
    const game = GAMES[currentGameType];
    if (newStatus === 'waiting' && players.length >= room.max_players
        && currentGameType !== 'draw' && !game.isCasino && !game.isParty) {
      newStatus = 'playing';
    }

    const { data: updated, error: upErr } = await SUPA()
      .from('game_rooms').update({ players, spectators, status: newStatus }).eq('id', roomId).select().single();
    if (upErr) { alert('Join failed: ' + upErr.message); return; }
    enterRoom(updated);
  }

  // =================================================================
  // ROOM RUNTIME
  // =================================================================
  function enterRoom(room) {
    currentRoomId = room.id;
    currentRoom   = room;
    showView('room');
    renderRoomShell();
    renderGameContent();
    subscribeRoom();
    if (currentGameType === 'draw') subscribeDrawBroadcast();
  }

  function subscribeRoom() {
    if (roomChannel) { SUPA().removeChannel(roomChannel); roomChannel = null; }
    roomChannel = SUPA()
      .channel('room-' + currentRoomId)
      .on('postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'game_rooms', filter: `id=eq.${currentRoomId}` },
          payload => {
            const newRoom = payload.new;
            if (!newRoom) return;
            // Re-derive my role/slot in case I'm new or my slot changed
            const me = getPlayerName();
            const found = (newRoom.players || []).find(p => p.name === me);
            if (found) { myRole = 'player'; mySlot = found.slot; }
            else if ((newRoom.spectators || []).some(s => s.name === me)) { myRole = 'spectator'; mySlot = null; }
            currentRoom = newRoom;
            renderRoomShell();
            renderGameContent();
          })
      .on('postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'game_rooms', filter: `id=eq.${currentRoomId}` },
          () => { alert('Room was closed.'); leaveRoom(); })
      .subscribe();
  }

  async function leaveRoom() {
    if (drawChannel) { SUPA().removeChannel(drawChannel); drawChannel = null; }
    if (roomChannel) { SUPA().removeChannel(roomChannel); roomChannel = null; }

    const me = getPlayerName();
    if (currentRoom && me && SUPA()) {
      let players    = (currentRoom.players    || []).filter(p => p.name !== me);
      let spectators = (currentRoom.spectators || []).filter(s => s.name !== me);
      // If room is empty, delete it. Otherwise, update.
      if (players.length === 0 && spectators.length === 0) {
        await SUPA().from('game_rooms').delete().eq('id', currentRoomId);
      } else {
        await SUPA().from('game_rooms').update({ players, spectators }).eq('id', currentRoomId);
      }
    }
    currentRoomId = null;
    currentRoom   = null;
    myRole        = null;
    mySlot        = null;
    showView('lobby');
    loadLobby();
    subscribeLobby();
  }

  function renderRoomShell() {
    const g = GAMES[currentGameType];
    const r = currentRoom;
    if (!g || !r) return;
    const players    = r.players    || [];
    const spectators = r.spectators || [];
    const head = $('room-head');
    if (!head) return;

    const playerList = players.map(p => {
      const isMe = p.name === getPlayerName();
      const slotLabel = currentGameType === 'draw' ? '' : ` <span class="slot-label">[${slotName(p.slot)}]</span>`;
      return `<span class="player-pill ${isMe ? 'me' : ''}">🏴‍☠️ ${esc(p.name)}${slotLabel}</span>`;
    }).join('') || '<em style="color:#666">No players yet.</em>';

    const specList = spectators.length
      ? spectators.map(s => `<span class="spec-pill">👀 ${esc(s.name)}</span>`).join('')
      : '<em style="color:#666">No spectators.</em>';

    head.innerHTML = `
      <div class="room-head-row">
        <button class="lobby-back" id="room-back-btn">← LOBBY</button>
        <h2 style="color:${g.color};">${g.emoji} ${esc(g.name).toUpperCase()}</h2>
        <span class="room-status ${r.status}">${r.status.toUpperCase()}</span>
      </div>
      <div class="room-people">
        <div><strong style="color:${g.color};">Players (${players.length}/${r.max_players}):</strong> ${playerList}</div>
        <div><strong style="color:#888;">Spectators (${spectators.length}):</strong> ${specList}</div>
      </div>`;
    $('room-back-btn').addEventListener('click', leaveRoom);
  }

  function slotName(slot) {
    if (currentGameType === 'tictactoe') return slot === 0 ? '❌' : '⭕';
    if (currentGameType === 'connect4')  return slot === 0 ? '🔴' : '🟡';
    if (currentGameType === 'checkers')  return slot === 0 ? 'BLACK' : 'RED';
    if (currentGameType === 'chess')     return slot === 0 ? 'WHITE' : 'BLACK';
    return 'P' + (slot + 1);
  }

  // =================================================================
  // GAME CONTENT DISPATCH
  // =================================================================
  function renderGameContent() {
    const wrap = $('room-game');
    if (!wrap || !currentRoom) return;
    const game = GAMES[currentGameType];

    // Casino games have their own internal phase machine (lobby → betting → playing → ...)
    if (game && game.isCasino) {
      if (currentGameType === 'blackjack') return renderBlackjack(wrap);
      if (currentGameType === 'poker')     return renderPoker(wrap);
      return;
    }
    // Party games also have phase-based UIs
    if (game && game.isParty) {
      if (currentGameType === 'chameleon') return renderChameleon(wrap);
      if (currentGameType === 'skribbl')   return renderSkribbl(wrap);
      return;
    }

    if (currentRoom.status === 'waiting' && currentGameType !== 'draw') {
      wrap.innerHTML = `<div class="game-waiting">⏳ Waiting for ${currentRoom.max_players - (currentRoom.players || []).length} more pirate(s) to join...</div>`;
      return;
    }

    switch (currentGameType) {
      case 'tictactoe': renderTicTacToe(wrap); break;
      case 'connect4':  renderConnect4(wrap);  break;
      case 'checkers':  renderCheckers(wrap);  break;
      case 'chess':     renderChess(wrap);     break;
      case 'draw':      renderDrawRoom(wrap);  break;
    }
  }

  // =================================================================
  // TIC-TAC-TOE
  // =================================================================
  function renderTicTacToe(wrap) {
    const s = currentRoom.state || GAMES.tictactoe.initialState();
    const winnerInfo = s.winner !== null ? winnerLine(s.winner) : '';
    const myTurn = myRole === 'player' && s.winner === null && s.turn === mySlot;
    const turnText = s.winner !== null
      ? winnerLabel(s)
      : `Turn: ${slotName(s.turn)} ${myTurn ? '(you)' : ''}`;

    wrap.innerHTML = `
      <div class="ttt-status">${turnText}</div>
      <div class="ttt-board" id="ttt-board">
        ${s.board.map((c, i) => `
          <button class="ttt-cell ${c !== null ? 'filled' : ''} ${winnerInfo && winnerInfo.includes(i) ? 'win' : ''}"
                  data-i="${i}" ${c !== null || !myTurn ? 'disabled' : ''}>
            ${c === 0 ? '❌' : c === 1 ? '⭕' : ''}
          </button>`).join('')}
      </div>
      ${s.winner !== null ? '<button class="game-rematch" id="ttt-rematch">🔁 REMATCH</button>' : ''}`;

    wrap.querySelectorAll('.ttt-cell').forEach(b => {
      b.addEventListener('click', () => playTicTacToe(parseInt(b.dataset.i, 10)));
    });
    const rematch = $('ttt-rematch');
    if (rematch) rematch.addEventListener('click', resetGame);
  }

  function winnerLine(winner) {
    if (winner === 'draw' || winner === null) return null;
    const s = currentRoom.state;
    const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    for (const line of lines) {
      if (s.board[line[0]] === winner && s.board[line[1]] === winner && s.board[line[2]] === winner)
        return line;
    }
    return null;
  }

  async function playTicTacToe(idx) {
    const s = JSON.parse(JSON.stringify(currentRoom.state));
    if (s.winner !== null || s.board[idx] !== null) return;
    if (s.turn !== mySlot) return;
    s.board[idx] = mySlot;

    // Check win
    const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    for (const [a,b,c] of lines) {
      if (s.board[a] !== null && s.board[a] === s.board[b] && s.board[b] === s.board[c]) {
        s.winner = s.board[a];
      }
    }
    if (s.winner === null && s.board.every(x => x !== null)) s.winner = 'draw';
    s.turn = 1 - s.turn;

    await pushState(s, s.winner !== null ? 'finished' : 'playing');
  }

  // =================================================================
  // CONNECT 4
  // =================================================================
  function renderConnect4(wrap) {
    const s = currentRoom.state || GAMES.connect4.initialState();
    const myTurn = myRole === 'player' && s.winner === null && s.turn === mySlot;
    const winLine = s.winner !== null && s.winner !== 'draw' ? findC4WinLine(s.board) : null;
    const turnText = s.winner !== null
      ? winnerLabel(s)
      : `Turn: ${slotName(s.turn)} ${myTurn ? '(you)' : ''}`;

    let html = `<div class="c4-status">${turnText}</div><div class="c4-board" id="c4-board">`;
    // Row of column drop buttons
    html += '<div class="c4-drops">';
    for (let col = 0; col < 7; col++) {
      const colFull = s.board[col] !== null;
      html += `<button class="c4-drop" data-col="${col}" ${(colFull || !myTurn) ? 'disabled' : ''}>▼</button>`;
    }
    html += '</div>';
    // 6 rows × 7 cols
    for (let row = 0; row < 6; row++) {
      html += '<div class="c4-row">';
      for (let col = 0; col < 7; col++) {
        const idx = row * 7 + col;
        const cell = s.board[idx];
        const isWin = winLine && winLine.includes(idx);
        html += `<div class="c4-cell ${cell !== null ? 'filled p' + cell : ''} ${isWin ? 'win' : ''}"></div>`;
      }
      html += '</div>';
    }
    html += '</div>';
    if (s.winner !== null) html += '<button class="game-rematch" id="c4-rematch">🔁 REMATCH</button>';
    wrap.innerHTML = html;

    wrap.querySelectorAll('.c4-drop').forEach(b => {
      b.addEventListener('click', () => playConnect4(parseInt(b.dataset.col, 10)));
    });
    const rematch = $('c4-rematch');
    if (rematch) rematch.addEventListener('click', resetGame);
  }

  function findC4WinLine(board) {
    const dirs = [[0,1],[1,0],[1,1],[1,-1]];
    for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++) {
      const v = board[r*7+c]; if (v === null) continue;
      for (const [dr,dc] of dirs) {
        const line = [];
        for (let k = 0; k < 4; k++) {
          const nr = r + dr*k, nc = c + dc*k;
          if (nr < 0 || nr >= 6 || nc < 0 || nc >= 7) break;
          if (board[nr*7+nc] !== v) break;
          line.push(nr*7+nc);
        }
        if (line.length === 4) return line;
      }
    }
    return null;
  }

  async function playConnect4(col) {
    const s = JSON.parse(JSON.stringify(currentRoom.state));
    if (s.winner !== null || s.turn !== mySlot) return;
    // Drop into column
    let row = -1;
    for (let r = 5; r >= 0; r--) {
      if (s.board[r*7+col] === null) { row = r; break; }
    }
    if (row === -1) return;
    s.board[row*7+col] = mySlot;
    if (findC4WinLine(s.board)) s.winner = mySlot;
    else if (s.board.every(x => x !== null)) s.winner = 'draw';
    s.turn = 1 - s.turn;
    await pushState(s, s.winner !== null ? 'finished' : 'playing');
  }

  // =================================================================
  // CHECKERS
  // =================================================================
  function initCheckersBoard() {
    const b = Array(64).fill(null);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 1) b[r*8+c] = { p: 1, k: false };   // red on top (slot 1)
    }
    for (let r = 5; r < 8; r++) for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 1) b[r*8+c] = { p: 0, k: false };   // black on bottom (slot 0)
    }
    return b;
  }

  let checkersSelected = null;   // local UI state for selected piece

  function renderCheckers(wrap) {
    const s = currentRoom.state;
    const myTurn = myRole === 'player' && s.winner === null && s.turn === mySlot;
    const turnText = s.winner !== null
      ? winnerLabel(s)
      : `Turn: ${slotName(s.turn)} ${myTurn ? '(you)' : ''}`;

    const moves = (myTurn && checkersSelected !== null)
      ? legalCheckersMovesFrom(s, checkersSelected) : [];

    let html = `<div class="ck-status">${turnText}</div><div class="ck-board" id="ck-board">`;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const i = r*8+c;
      const piece = s.board[i];
      const dark = (r + c) % 2 === 1;
      const isSel = checkersSelected === i;
      const isTarget = moves.some(m => m.to === i);
      let cls = 'ck-cell ' + (dark ? 'dark' : 'light');
      if (isSel)   cls += ' sel';
      if (isTarget) cls += ' target';
      let inner = '';
      if (piece) {
        inner = `<div class="ck-piece p${piece.p} ${piece.k ? 'king' : ''}">${piece.k ? '♛' : ''}</div>`;
      }
      html += `<div class="${cls}" data-i="${i}">${inner}</div>`;
    }
    html += '</div>';
    if (s.winner !== null) html += '<button class="game-rematch" id="ck-rematch">🔁 REMATCH</button>';
    wrap.innerHTML = html;

    wrap.querySelectorAll('.ck-cell').forEach(el => {
      el.addEventListener('click', () => onCheckersClick(parseInt(el.dataset.i, 10)));
    });
    const rm = $('ck-rematch');
    if (rm) rm.addEventListener('click', () => { checkersSelected = null; resetGame(); });
  }

  function legalCheckersMovesFrom(state, from) {
    const board = state.board;
    const piece = board[from]; if (!piece || piece.p !== state.turn) return [];
    const r = Math.floor(from / 8), c = from % 8;
    const dirs = [];
    if (piece.k || piece.p === 0) { dirs.push([-1,-1],[-1,1]); }   // black/king moves up
    if (piece.k || piece.p === 1) { dirs.push([1,-1],[1,1]); }     // red/king moves down

    // First check all jumps anywhere (forced jump rule)
    const anyJumps = anyJumpsAvailable(state);
    const moves = [];
    for (const [dr, dc] of dirs) {
      const nr = r + dr, nc = c + dc;
      const jr = r + 2*dr, jc = c + 2*dc;
      const ni = nr*8+nc, ji = jr*8+jc;
      if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
        // Plain move
        if (!anyJumps && board[ni] === null) {
          moves.push({ from, to: ni, jump: false, captured: null });
        }
        // Jump
        if (jr >= 0 && jr < 8 && jc >= 0 && jc < 8) {
          if (board[ni] && board[ni].p !== piece.p && board[ji] === null) {
            moves.push({ from, to: ji, jump: true, captured: ni });
          }
        }
      }
    }
    return moves;
  }

  function anyJumpsAvailable(state) {
    const board = state.board;
    for (let i = 0; i < 64; i++) {
      const piece = board[i]; if (!piece || piece.p !== state.turn) continue;
      const r = Math.floor(i/8), c = i%8;
      const dirs = [];
      if (piece.k || piece.p === 0) { dirs.push([-1,-1],[-1,1]); }
      if (piece.k || piece.p === 1) { dirs.push([1,-1],[1,1]); }
      for (const [dr, dc] of dirs) {
        const nr = r+dr, nc = c+dc, jr = r+2*dr, jc = c+2*dc;
        if (jr < 0 || jr >= 8 || jc < 0 || jc >= 8) continue;
        const ni = nr*8+nc, ji = jr*8+jc;
        if (board[ni] && board[ni].p !== piece.p && board[ji] === null) return true;
      }
    }
    return false;
  }

  async function onCheckersClick(idx) {
    const s = currentRoom.state;
    if (s.winner !== null || myRole !== 'player' || s.turn !== mySlot) return;

    const piece = s.board[idx];
    // If a piece is selected and this idx is a valid target → move
    if (checkersSelected !== null) {
      const moves = legalCheckersMovesFrom(s, checkersSelected);
      const move  = moves.find(m => m.to === idx);
      if (move) {
        const ns = JSON.parse(JSON.stringify(s));
        const moving = ns.board[move.from];
        ns.board[move.from] = null;
        if (move.captured !== null) ns.board[move.captured] = null;
        ns.board[move.to] = moving;
        // Crown
        const r = Math.floor(move.to / 8);
        if ((moving.p === 0 && r === 0) || (moving.p === 1 && r === 7)) ns.board[move.to].k = true;

        // Check for chain jump (must continue if more jumps available from new square)
        let mustContinue = false;
        if (move.jump) {
          const morePresent = legalCheckersMovesFromForced(ns, move.to);
          if (morePresent.length > 0) mustContinue = true;
        }

        if (!mustContinue) {
          ns.turn = 1 - ns.turn;
          // Check for win
          const oppHasPieces = ns.board.some(p => p && p.p === ns.turn);
          if (!oppHasPieces) ns.winner = mySlot;
          else {
            // Stalemate (no legal moves) → other side loses
            const oppCanMove = canCheckersMove(ns);
            if (!oppCanMove) ns.winner = mySlot;
          }
        }
        await pushState(ns, ns.winner !== null ? 'finished' : 'playing');
        // Keep selection only if chain-jump continues
        checkersSelected = mustContinue ? move.to : null;
        return;
      }
    }
    // Otherwise: try selecting our own piece
    if (piece && piece.p === mySlot) {
      const moves = legalCheckersMovesFrom(s, idx);
      if (moves.length > 0) { checkersSelected = idx; renderGameContent(); }
      else checkersSelected = null;
    } else {
      checkersSelected = null;
      renderGameContent();
    }
  }

  function legalCheckersMovesFromForced(state, from) {
    const piece = state.board[from]; if (!piece) return [];
    const r = Math.floor(from / 8), c = from % 8;
    const dirs = [];
    if (piece.k || piece.p === 0) { dirs.push([-1,-1],[-1,1]); }
    if (piece.k || piece.p === 1) { dirs.push([1,-1],[1,1]); }
    const out = [];
    for (const [dr,dc] of dirs) {
      const nr = r+dr, nc = c+dc, jr = r+2*dr, jc = c+2*dc;
      if (jr < 0 || jr >= 8 || jc < 0 || jc >= 8) continue;
      const ni = nr*8+nc, ji = jr*8+jc;
      if (state.board[ni] && state.board[ni].p !== piece.p && state.board[ji] === null) {
        out.push({ from, to: ji, jump: true, captured: ni });
      }
    }
    return out;
  }

  function canCheckersMove(state) {
    for (let i = 0; i < 64; i++) {
      const p = state.board[i]; if (!p || p.p !== state.turn) continue;
      if (legalCheckersMovesFrom(state, i).length > 0) return true;
    }
    return false;
  }

  // =================================================================
  // CHESS
  // =================================================================
  let chessInstance = null;
  let chessSelected = null;
  let chessLegalTargets = [];

  function getChess() {
    // chess.js attaches `Chess` to window when loaded from CDN.
    if (typeof Chess === 'undefined') return null;
    if (!chessInstance) chessInstance = new Chess();
    return chessInstance;
  }

  function syncChessFromState() {
    const ch = getChess(); if (!ch) return;
    const s  = currentRoom.state || {};
    if (s.fen && s.fen !== 'start') ch.load(s.fen);
    else ch.reset();
  }

  function renderChess(wrap) {
    const ch = getChess();
    if (!ch) {
      wrap.innerHTML = '<div class="game-waiting">⏳ Loading chess engine...</div>';
      return;
    }
    syncChessFromState();
    const s = currentRoom.state;
    const turn = ch.turn();                                // 'w' | 'b'
    const myColor = mySlot === 0 ? 'w' : (mySlot === 1 ? 'b' : null);
    const gameOver = s.winner != null;                     // covers null and undefined; lets 0 (white wins) through
    const myTurn = myRole === 'player' && !gameOver && turn === myColor;
    const turnText = gameOver
      ? (s.winner === 'draw' ? `🤝 Draw — ${esc(s.drawReason || 'agreed')}` : winnerLabel(s))
      : `Turn: ${turn === 'w' ? 'WHITE' : 'BLACK'} ${myTurn ? '(you)' : ''} ${ch.in_check && ch.in_check() ? '· CHECK' : ''}`;

    // Render board (white at bottom for slot 0, flipped for slot 1)
    const flip = mySlot === 1;
    let html = `<div class="ch-status">${turnText}</div>
      <div class="ch-board" id="ch-board" data-flipped="${flip}">`;
    const ranks = flip ? [1,2,3,4,5,6,7,8] : [8,7,6,5,4,3,2,1];
    const files = flip ? ['h','g','f','e','d','c','b','a'] : ['a','b','c','d','e','f','g','h'];
    for (const r of ranks) {
      for (const f of files) {
        const sq = f + r;
        const piece = ch.get(sq);
        const dark = ((r + f.charCodeAt(0)) % 2 === 0);
        const isSel = chessSelected === sq;
        const isTarget = chessLegalTargets.includes(sq);
        const isLast = s.lastMove && (s.lastMove.from === sq || s.lastMove.to === sq);
        let cls = 'ch-cell ' + (dark ? 'dark' : 'light');
        if (isSel)    cls += ' sel';
        if (isTarget) cls += ' target';
        if (isLast)   cls += ' last';
        const ch_glyph = piece ? chessGlyph(piece) : '';
        html += `<div class="${cls}" data-sq="${sq}"><span class="ch-piece">${ch_glyph}</span></div>`;
      }
    }
    html += '</div>';
    if (gameOver) html += '<button class="game-rematch" id="ch-rematch">🔁 REMATCH</button>';
    wrap.innerHTML = html;

    wrap.querySelectorAll('.ch-cell').forEach(el => {
      el.addEventListener('click', () => onChessClick(el.dataset.sq));
    });
    const rm = $('ch-rematch');
    if (rm) rm.addEventListener('click', () => { chessSelected = null; chessLegalTargets = []; chessInstance = null; resetGame(); });
  }

  function chessGlyph(piece) {
    const map = {
      'wK': '♔', 'wQ': '♕', 'wR': '♖', 'wB': '♗', 'wN': '♘', 'wP': '♙',
      'bK': '♚', 'bQ': '♛', 'bR': '♜', 'bB': '♝', 'bN': '♞', 'bP': '♟',
    };
    return map[(piece.color === 'w' ? 'w' : 'b') + piece.type.toUpperCase()] || '';
  }

  async function onChessClick(sq) {
    const ch = getChess(); if (!ch) return;
    const s = currentRoom.state;
    if (s.winner != null) return;
    if (myRole !== 'player') return;
    const myColor = mySlot === 0 ? 'w' : 'b';
    if (ch.turn() !== myColor) return;

    const piece = ch.get(sq);
    if (chessSelected) {
      // Try to move from chessSelected → sq
      const move = ch.move({ from: chessSelected, to: sq, promotion: 'q' });
      if (move) {
        const ns = { fen: ch.fen(), lastMove: { from: chessSelected, to: sq }, winner: null };
        if (ch.in_checkmate()) {
          ns.winner = mySlot;
        } else if (ch.in_stalemate()) {
          ns.winner = 'draw'; ns.drawReason = 'stalemate';
        } else if (ch.in_draw && ch.in_draw()) {
          ns.winner = 'draw'; ns.drawReason = 'draw';
        }
        chessSelected = null; chessLegalTargets = [];
        await pushState(ns, ns.winner != null ? 'finished' : 'playing');
        return;
      }
      // Failed move: maybe selecting a different own piece
      chessSelected = null; chessLegalTargets = [];
    }
    if (piece && piece.color === myColor) {
      chessSelected = sq;
      chessLegalTargets = ch.moves({ square: sq, verbose: true }).map(m => m.to);
      renderGameContent();
    } else {
      renderGameContent();
    }
  }

  // =================================================================
  // BLACKJACK
  // - Phases: lobby → betting → playing → dealer → roundend → betting...
  // - Hidden info: hands stored in shared state (friends-trust model)
  // =================================================================
  const BJ_SUITS = ['♠','♥','♦','♣'];
  const BJ_RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  const BJ_CHIP_OPTIONS = [500, 1000, 2500, 5000];

  function bjMakeDeck() {
    const d = [];
    for (const s of BJ_SUITS) for (const r of BJ_RANKS) d.push({ rank: r, suit: s });
    // Fisher-Yates shuffle
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  }

  function bjCardValue(rank) {
    if (rank === 'A') return 11;
    if (['J','Q','K'].includes(rank)) return 10;
    return parseInt(rank, 10);
  }

  function bjHandTotal(hand) {
    let total = 0, aces = 0;
    for (const c of hand) {
      total += bjCardValue(c.rank);
      if (c.rank === 'A') aces++;
    }
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return total;
  }

  function bjIsBlackjack(hand) {
    return hand.length === 2 && bjHandTotal(hand) === 21;
  }

  function bjCardHTML(card, hidden) {
    if (hidden) return '<div class="bj-card bj-back">🏴‍☠️</div>';
    const isRed = card.suit === '♥' || card.suit === '♦';
    return `<div class="bj-card ${isRed ? 'red' : 'black'}">
      <span class="bj-card-rank">${card.rank}</span>
      <span class="bj-card-suit">${card.suit}</span>
    </div>`;
  }

  // ---- Render dispatch (phase-based) ----
  function renderBlackjack(wrap) {
    const s = currentRoom.state || GAMES.blackjack.initialState();
    switch (s.phase) {
      case 'lobby':     renderBjLobby(wrap, s); break;
      case 'betting':   renderBjBetting(wrap, s); break;
      case 'playing':   renderBjPlaying(wrap, s); break;
      case 'dealer':    renderBjPlaying(wrap, s); break;   // same view, dealer revealed
      case 'roundend':  renderBjRoundEnd(wrap, s); break;
      case 'finished':  renderBjFinished(wrap, s); break;
      default:          renderBjLobby(wrap, s);
    }
  }

  function bjIsHost() {
    return currentRoom && currentRoom.host_name === getPlayerName();
  }

  // ---------- LOBBY (config + ready up) ----------
  function renderBjLobby(wrap, s) {
    const me      = getPlayerName();
    const host    = bjIsHost();
    const players = currentRoom.players || [];
    const config  = s.config || { startingChips: 1000, elimination: false };

    const chipPills = BJ_CHIP_OPTIONS.map(amt => `
      <button class="bj-pill ${config.startingChips === amt ? 'active' : ''}"
              data-chips="${amt}" ${host ? '' : 'disabled'}>${amt} 💰</button>`).join('');

    const elimPills = `
      <button class="bj-pill ${!config.elimination ? 'active' : ''}" data-elim="off" ${host ? '' : 'disabled'}>OFF (auto-rebuy)</button>
      <button class="bj-pill ${config.elimination ? 'active' : ''}" data-elim="on"  ${host ? '' : 'disabled'}>ON (broke = out)</button>`;

    const readySet = new Set(s.ready || []);
    const playerRows = players.map(p => {
      const ready = readySet.has(p.name);
      const isYou = p.name === me;
      const isHost = p.name === currentRoom.host_name;
      return `<div class="bj-player-row ${isYou ? 'me' : ''}">
        <span>🏴‍☠️ <strong>${esc(p.name)}</strong>${isHost ? ' <span class="bj-host-tag">HOST</span>' : ''}${isYou ? ' (you)' : ''}</span>
        <span class="bj-ready-tag ${ready ? 'ready' : 'notready'}">${ready ? '✅ READY' : '⏳ NOT READY'}</span>
      </div>`;
    }).join('');

    const myReady   = readySet.has(me);
    const readyCount = readySet.size;
    const canDeal   = host && readyCount >= 1;

    wrap.innerHTML = `
      <div class="bj-lobby">
        <h3 class="bj-lobby-h">⚙️ GAME SETTINGS</h3>
        <div class="bj-config">
          <div class="bj-config-row">
            <span class="bj-config-label">Starting Chips:</span>
            <div class="bj-pills">${chipPills}</div>
          </div>
          <div class="bj-config-row">
            <span class="bj-config-label">Elimination Mode:</span>
            <div class="bj-pills">${elimPills}</div>
          </div>
          ${!host ? '<div class="bj-host-note">Only the host can change settings.</div>' : ''}
        </div>

        <h3 class="bj-lobby-h">PLAYERS (${players.length}/${currentRoom.max_players})</h3>
        <div class="bj-player-list">${playerRows || '<em style="color:#666">No players yet.</em>'}</div>

        <div class="bj-lobby-actions">
          <button class="bj-btn ready ${myReady ? 'unready' : ''}" id="bj-ready-btn">
            ${myReady ? '❌ UNREADY' : '✅ READY UP'}
          </button>
          ${host ? `<button class="bj-btn deal" id="bj-deal-btn" ${canDeal ? '' : 'disabled'}>
            🃏 DEAL CARDS (${readyCount} ready)
          </button>` : `<div class="bj-host-note">Waiting on host to deal...</div>`}
        </div>
      </div>`;

    // Wire up settings (host only)
    if (host) {
      wrap.querySelectorAll('[data-chips]').forEach(b => b.addEventListener('click', () => {
        const next = JSON.parse(JSON.stringify(s));
        next.config.startingChips = parseInt(b.dataset.chips, 10);
        pushState(next);
      }));
      wrap.querySelectorAll('[data-elim]').forEach(b => b.addEventListener('click', () => {
        const next = JSON.parse(JSON.stringify(s));
        next.config.elimination = (b.dataset.elim === 'on');
        pushState(next);
      }));
    }
    // Ready toggle
    $('bj-ready-btn').addEventListener('click', () => {
      const next = JSON.parse(JSON.stringify(s));
      const set = new Set(next.ready || []);
      if (set.has(me)) set.delete(me); else set.add(me);
      next.ready = [...set];
      pushState(next);
    });
    // Deal (host only)
    const dealBtn = $('bj-deal-btn');
    if (dealBtn) dealBtn.addEventListener('click', () => bjStartGame(s));
  }

  function bjStartGame(s) {
    if (!bjIsHost()) return;
    const players = (currentRoom.players || []).filter(p => (s.ready || []).includes(p.name));
    if (players.length === 0) return;

    const next = JSON.parse(JSON.stringify(s));
    next.phase = 'betting';
    next.round = 1;
    next.chips = {};
    next.bets  = {};
    next.eliminated = [];
    for (const p of players) next.chips[p.name] = next.config.startingChips;
    next.turnOrder = players.map(p => p.name);
    next.deck = bjMakeDeck();
    next.hands = {};
    next.hasStood = {};
    next.dealerHand = [];
    next.dealerHidden = true;
    next.currentTurn = null;
    next.results = {};
    pushState(next, 'playing');
  }

  // ---------- BETTING ----------
  function renderBjBetting(wrap, s) {
    const me = getPlayerName();
    const myChips = s.chips[me] || 0;
    const inGame = s.turnOrder.includes(me) && !(s.eliminated || []).includes(me);
    const allBetsIn = s.turnOrder.every(n =>
      (s.eliminated || []).includes(n) || (s.bets[n] !== undefined)
    );

    const pBets = s.turnOrder.map(name => {
      const elim   = (s.eliminated || []).includes(name);
      const chips  = s.chips[name] || 0;
      const bet    = s.bets[name];
      const isMe   = name === me;
      const status = elim ? '<span class="bj-out">💀 OUT</span>'
                   : (bet !== undefined ? `<span class="bj-bet-tag">BET ${bet}</span>`
                                       : '<span class="bj-pending">⏳ betting...</span>');
      return `<div class="bj-player-row ${isMe ? 'me' : ''}">
        <span>🏴‍☠️ <strong>${esc(name)}</strong>${isMe ? ' (you)' : ''} · 💰 ${chips}</span>
        ${status}
      </div>`;
    }).join('');

    let bettingUI = '';
    if (inGame && s.bets[me] === undefined && myChips > 0) {
      const presets = [10, 25, 50, 100, 250, 500].filter(v => v <= myChips);
      bettingUI = `
        <div class="bj-bet-input">
          <label>YOUR BET (max ${myChips}): </label>
          <input type="number" id="bj-bet-amount" min="1" max="${myChips}" value="${Math.min(50, myChips)}" />
          <div class="bj-bet-presets">
            ${presets.map(v => `<button class="bj-pill" data-bet-preset="${v}">${v}</button>`).join('')}
            <button class="bj-pill" data-bet-preset="${myChips}">ALL IN</button>
          </div>
          <button class="bj-btn primary" id="bj-place-bet-btn">💰 PLACE BET</button>
        </div>`;
    } else if (inGame && s.bets[me] !== undefined) {
      bettingUI = `<div class="bj-waiting-msg">Bet placed: ${s.bets[me]}. Waiting for other players...</div>`;
    } else if (!inGame) {
      bettingUI = `<div class="bj-waiting-msg">👀 Spectating round ${s.round}</div>`;
    }

    wrap.innerHTML = `
      <div class="bj-table">
        <div class="bj-roundbar">
          <span>ROUND ${s.round}</span>
          <span class="bj-elim-tag">${s.config.elimination ? '☠️ ELIMINATION' : '🔄 AUTO-REBUY'}</span>
          ${bjIsHost() ? `<button class="bj-btn end" id="bj-end-btn">END GAME</button>` : ''}
        </div>
        <h3 class="bj-phase-h">💵 PLACE YER BETS</h3>
        <div class="bj-player-list">${pBets}</div>
        ${bettingUI}
      </div>`;

    // Wire bet UI
    const placeBtn = $('bj-place-bet-btn');
    if (placeBtn) placeBtn.addEventListener('click', () => {
      const amt = parseInt($('bj-bet-amount').value, 10);
      if (!amt || amt < 1) return;
      if (amt > myChips) return;
      const next = JSON.parse(JSON.stringify(s));
      next.bets[me] = amt;
      // If everyone has now bet, auto-deal
      const everyoneBet = next.turnOrder.every(n =>
        (next.eliminated || []).includes(n) || next.bets[n] !== undefined);
      if (everyoneBet) {
        bjDealRound(next);
        pushState(next);
      } else {
        pushState(next);
      }
    });
    wrap.querySelectorAll('[data-bet-preset]').forEach(b => b.addEventListener('click', () => {
      $('bj-bet-amount').value = b.dataset.betPreset;
    }));
    const endBtn = $('bj-end-btn');
    if (endBtn) endBtn.addEventListener('click', () => bjEndGame(s));

    // Edge case: if you're spectating and all others have bet, auto-deal
    if (allBetsIn) {
      const next = JSON.parse(JSON.stringify(s));
      bjDealRound(next);
      pushState(next);
    }
  }

  function bjDealRound(s) {
    // Deal 2 to each active player, 2 to dealer (1 hidden)
    const active = s.turnOrder.filter(n => !(s.eliminated || []).includes(n) && s.bets[n] !== undefined);
    s.hands = {};
    s.hasStood = {};
    for (const n of active) s.hands[n] = [];
    s.dealerHand = [];
    for (let i = 0; i < 2; i++) {
      for (const n of active) s.hands[n].push(s.deck.shift());
      s.dealerHand.push(s.deck.shift());
    }
    s.dealerHidden = true;
    s.phase = 'playing';

    // Auto-stand any natural blackjacks
    for (const n of active) if (bjIsBlackjack(s.hands[n])) s.hasStood[n] = true;

    // Set first turn (skip those with blackjack already standing)
    s.currentTurn = active.find(n => !s.hasStood[n]) || null;

    // If everyone has blackjack, jump straight to dealer
    if (s.currentTurn === null) bjPlayDealer(s);
  }

  // ---------- PLAYING / DEALER ----------
  function renderBjPlaying(wrap, s) {
    const me = getPlayerName();
    const dealerTotal = bjHandTotal(s.dealerHand);
    const dealerVisibleTotal = s.dealerHidden
      ? bjHandTotal([s.dealerHand[0]])
      : dealerTotal;

    const dealerCards = s.dealerHand.map((c, i) =>
      bjCardHTML(c, s.dealerHidden && i === 1)).join('');

    const playerBlocks = s.turnOrder
      .filter(n => !(s.eliminated || []).includes(n) && s.hands[n])
      .map(name => {
        const hand = s.hands[name];
        const total = bjHandTotal(hand);
        const isMe = name === me;
        const stood = s.hasStood[name];
        const busted = total > 21;
        const isCurrent = s.currentTurn === name;
        const bj = bjIsBlackjack(hand);
        const tag = busted ? '<span class="bj-out">💥 BUST</span>'
                  : bj ? '<span class="bj-bj-tag">⭐ BLACKJACK</span>'
                  : stood ? '<span class="bj-stood-tag">✋ STAND</span>'
                  : isCurrent ? '<span class="bj-turn-tag">⏰ TURN</span>'
                  : '';
        return `
          <div class="bj-player-block ${isMe ? 'me' : ''} ${isCurrent ? 'current' : ''}">
            <div class="bj-player-head">
              🏴‍☠️ <strong>${esc(name)}</strong>${isMe ? ' (you)' : ''}
              · 💰 ${s.chips[name] || 0} · BET ${s.bets[name] || 0} ${tag}
            </div>
            <div class="bj-cards">${hand.map(c => bjCardHTML(c, false)).join('')}
              <div class="bj-total">${total}</div>
            </div>
          </div>`;
      }).join('');

    const myTurn = s.currentTurn === me && s.phase === 'playing';
    const myHand = s.hands[me];
    const myBusted = myHand && bjHandTotal(myHand) > 21;
    const actionUI = myTurn && !myBusted ? `
      <div class="bj-actions">
        <button class="bj-btn primary" id="bj-hit-btn">👊 HIT</button>
        <button class="bj-btn"         id="bj-stand-btn">✋ STAND</button>
      </div>` : '';

    wrap.innerHTML = `
      <div class="bj-table">
        <div class="bj-roundbar">
          <span>ROUND ${s.round}</span>
          <span class="bj-elim-tag">${s.config.elimination ? '☠️ ELIMINATION' : '🔄 AUTO-REBUY'}</span>
          ${bjIsHost() ? `<button class="bj-btn end" id="bj-end-btn">END GAME</button>` : ''}
        </div>

        <div class="bj-dealer">
          <div class="bj-dealer-head">🎩 DEALER ${s.dealerHidden ? `(showing ${dealerVisibleTotal})` : `(${dealerTotal}${dealerTotal > 21 ? ' BUST' : ''})`}</div>
          <div class="bj-cards">${dealerCards}</div>
        </div>

        <div class="bj-players">${playerBlocks}</div>
        ${actionUI}
      </div>`;

    if (myTurn && !myBusted) {
      $('bj-hit-btn').addEventListener('click',   () => bjAction('hit'));
      $('bj-stand-btn').addEventListener('click', () => bjAction('stand'));
    }
    const endBtn = $('bj-end-btn');
    if (endBtn) endBtn.addEventListener('click', () => bjEndGame(s));
  }

  function bjAction(kind) {
    const me = getPlayerName();
    const s = JSON.parse(JSON.stringify(currentRoom.state));
    if (s.currentTurn !== me || s.phase !== 'playing') return;

    if (kind === 'hit') {
      s.hands[me].push(s.deck.shift());
      const total = bjHandTotal(s.hands[me]);
      if (total >= 21) s.hasStood[me] = true;     // auto-stand on 21 or bust
    } else if (kind === 'stand') {
      s.hasStood[me] = true;
    }

    // Find next player who hasn't stood
    const order = s.turnOrder.filter(n => !(s.eliminated || []).includes(n) && s.hands[n]);
    const myIdx = order.indexOf(me);
    let next = null;
    for (let i = 1; i <= order.length; i++) {
      const candidate = order[(myIdx + i) % order.length];
      if (!s.hasStood[candidate]) { next = candidate; break; }
    }
    s.currentTurn = next;

    if (next === null) bjPlayDealer(s);
    pushState(s);
  }

  function bjPlayDealer(s) {
    s.phase = 'dealer';
    s.dealerHidden = false;
    // Dealer hits until total >= 17 (stands on all 17, including soft 17)
    while (bjHandTotal(s.dealerHand) < 17) {
      s.dealerHand.push(s.deck.shift());
    }
    bjResolveResults(s);
  }

  function bjResolveResults(s) {
    const dealerTotal = bjHandTotal(s.dealerHand);
    const dealerBust  = dealerTotal > 21;
    const dealerBJ    = bjIsBlackjack(s.dealerHand);
    s.results = {};

    for (const name of s.turnOrder) {
      if ((s.eliminated || []).includes(name)) continue;
      const hand = s.hands[name];
      if (!hand) continue;
      const bet = s.bets[name] || 0;
      const total = bjHandTotal(hand);
      const playerBJ = bjIsBlackjack(hand);
      let outcome, payout = 0;

      if (playerBJ && !dealerBJ) {
        outcome = 'blackjack'; payout = Math.floor(bet * 2.5);     // 3:2 payout (return + 1.5x)
      } else if (playerBJ && dealerBJ) {
        outcome = 'push'; payout = bet;
      } else if (total > 21) {
        outcome = 'bust'; payout = 0;
      } else if (dealerBust) {
        outcome = 'win'; payout = bet * 2;
      } else if (total > dealerTotal) {
        outcome = 'win'; payout = bet * 2;
      } else if (total === dealerTotal) {
        outcome = 'push'; payout = bet;
      } else {
        outcome = 'lose'; payout = 0;
      }

      // Subtract bet (taken at deal time conceptually) and add payout
      s.chips[name] = (s.chips[name] || 0) - bet + payout;
      s.results[name] = { outcome, payout, net: payout - bet };
    }

    // Apply elimination / rebuy after results
    const REBUY = 200;
    for (const name of s.turnOrder) {
      if ((s.eliminated || []).includes(name)) continue;
      if ((s.chips[name] || 0) <= 0) {
        if (s.config.elimination) {
          s.eliminated = [...(s.eliminated || []), name];
          s.chips[name] = 0;
        } else {
          s.chips[name] = REBUY;
          s.results[name] = { ...(s.results[name] || {}), rebuy: REBUY };
        }
      }
    }

    s.phase = 'roundend';
    s.currentTurn = null;
  }

  // ---------- ROUND END (results) ----------
  function renderBjRoundEnd(wrap, s) {
    const me = getPlayerName();
    const dealerTotal = bjHandTotal(s.dealerHand);

    const dealerCards = s.dealerHand.map(c => bjCardHTML(c, false)).join('');
    const blocks = s.turnOrder
      .filter(n => s.hands[n])
      .map(name => {
        const hand = s.hands[name];
        const total = bjHandTotal(hand);
        const r = s.results[name] || { outcome: '?' };
        const isMe = name === me;
        const elim = (s.eliminated || []).includes(name);

        const outcomeLabel = {
          blackjack: '⭐ BLACKJACK!',
          win:       '🏆 WIN',
          push:      '🤝 PUSH',
          bust:      '💥 BUST',
          lose:      '😢 LOSE',
        }[r.outcome] || r.outcome;

        const netLabel = r.net > 0 ? `<span class="bj-net pos">+${r.net} 💰</span>`
                       : r.net < 0 ? `<span class="bj-net neg">${r.net} 💰</span>`
                       : `<span class="bj-net">±0</span>`;

        const rebuyTag = r.rebuy ? `<span class="bj-rebuy-tag">💸 Auto-rebuy ${r.rebuy}</span>` : '';
        const elimTag  = elim ? `<span class="bj-out">☠️ ELIMINATED</span>` : '';

        return `<div class="bj-player-block ${isMe ? 'me' : ''}">
          <div class="bj-player-head">
            🏴‍☠️ <strong>${esc(name)}</strong>${isMe ? ' (you)' : ''}
            · 💰 ${s.chips[name] || 0} ${netLabel} ${elimTag} ${rebuyTag}
          </div>
          <div class="bj-cards">${hand.map(c => bjCardHTML(c, false)).join('')}
            <div class="bj-total">${total}</div>
            <span class="bj-outcome ${r.outcome}">${outcomeLabel}</span>
          </div>
        </div>`;
      }).join('');

    const stillIn = s.turnOrder.filter(n => !(s.eliminated || []).includes(n));
    const canContinue = stillIn.length > 0;

    wrap.innerHTML = `
      <div class="bj-table">
        <div class="bj-roundbar">
          <span>ROUND ${s.round} RESULTS</span>
          <span class="bj-elim-tag">${s.config.elimination ? '☠️ ELIMINATION' : '🔄 AUTO-REBUY'}</span>
          ${bjIsHost() ? `<button class="bj-btn end" id="bj-end-btn">END GAME</button>` : ''}
        </div>

        <div class="bj-dealer">
          <div class="bj-dealer-head">🎩 DEALER (${dealerTotal}${dealerTotal > 21 ? ' BUST' : ''})</div>
          <div class="bj-cards">${dealerCards}</div>
        </div>

        <div class="bj-players">${blocks}</div>

        <div class="bj-actions">
          ${canContinue ? `<button class="bj-btn primary" id="bj-next-btn">▶️ NEXT ROUND</button>` : ''}
        </div>
      </div>`;

    const nextBtn = $('bj-next-btn');
    if (nextBtn) nextBtn.addEventListener('click', () => {
      const next = JSON.parse(JSON.stringify(s));
      next.phase = 'betting';
      next.round = (next.round || 1) + 1;
      next.bets = {};
      next.hands = {};
      next.hasStood = {};
      next.dealerHand = [];
      next.dealerHidden = true;
      next.results = {};
      // Re-shuffle deck if low
      if ((next.deck || []).length < 20) next.deck = bjMakeDeck();
      pushState(next);
    });
    const endBtn = $('bj-end-btn');
    if (endBtn) endBtn.addEventListener('click', () => bjEndGame(s));
  }

  function bjEndGame(s) {
    if (!bjIsHost()) return;
    if (!confirm('End the game? This will reveal the leaderboard.')) return;
    const next = JSON.parse(JSON.stringify(s));
    next.phase = 'finished';
    pushState(next, 'finished');
  }

  // ---------- FINISHED (leaderboard) ----------
  function renderBjFinished(wrap, s) {
    const board = (s.turnOrder || [])
      .map(name => ({ name, chips: s.chips[name] || 0, eliminated: (s.eliminated || []).includes(name) }))
      .sort((a, b) => b.chips - a.chips);

    const rows = board.map((p, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
      return `<div class="bj-player-row ${i === 0 ? 'winner' : ''}">
        <span>${medal} 🏴‍☠️ <strong>${esc(p.name)}</strong>${p.eliminated ? ' ☠️' : ''}</span>
        <span><strong>${p.chips}</strong> 💰</span>
      </div>`;
    }).join('');

    wrap.innerHTML = `
      <div class="bj-table">
        <h3 class="bj-phase-h">🏆 GAME OVER 🏆</h3>
        <div class="bj-player-list">${rows}</div>
        ${bjIsHost() ? `<div class="bj-actions"><button class="bj-btn primary" id="bj-rematch-btn">🔁 NEW GAME</button></div>` : ''}
      </div>`;

    const rm = $('bj-rematch-btn');
    if (rm) rm.addEventListener('click', () => {
      const fresh = GAMES.blackjack.initialState();
      pushState(fresh, 'waiting');
    });
  }

  // =================================================================
  // TEXAS HOLD'EM POKER
  // =================================================================
  // Note on hidden information: hole cards are stored in the room state
  // for simplicity. The UI only shows YOUR cards face-up; others stay
  // face-down until showdown. A determined cheater could read other hands
  // via DevTools — that's an acceptable tradeoff for a friends-only site.

  // -------- Card / deck helpers (poker uses 'Tdhscd' format for pokersolver) --------
  const POKER_RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
  const POKER_SUITS = ['c','d','h','s'];
  function pokerNewDeck() {
    const d = [];
    for (const r of POKER_RANKS) for (const s of POKER_SUITS) d.push(r + s);
    return d;
  }
  function pokerShuffle(deck) {
    const d = deck.slice();
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  }
  function pokerCardEmoji(suit) { return suit === 'h' ? '♥️' : suit === 'd' ? '♦️' : suit === 's' ? '♠️' : '♣️'; }
  function pokerRankLabel(r) { return r === 'T' ? '10' : r; }
  function pokerCardHTML(card, faceDown = false) {
    if (faceDown || !card) {
      return `<div class="pk-card facedown">🏴‍☠️</div>`;
    }
    const rank = card[0], suit = card[1];
    const isRed = (suit === 'h' || suit === 'd');
    return `<div class="pk-card ${isRed ? 'red' : 'black'}">
      <span class="pk-rank">${pokerRankLabel(rank)}</span>
      <span class="pk-suit">${pokerCardEmoji(suit)}</span>
    </div>`;
  }

  // ---------- Top-level dispatcher ----------
  function renderPoker(wrap) {
    const s = currentRoom.state;
    if (!s) { wrap.innerHTML = '<div class="game-waiting">Loading...</div>'; return; }
    switch (s.phase) {
      case 'lobby':    renderPokerLobby(wrap, s);    break;
      case 'preflop':
      case 'flop':
      case 'turn':
      case 'river':    renderPokerHand(wrap, s);     break;
      case 'showdown': renderPokerHand(wrap, s);     break;
      case 'handend':  renderPokerHandEnd(wrap, s);  break;
      case 'finished': renderPokerFinished(wrap, s); break;
      default:         wrap.innerHTML = '<div class="game-waiting">Unknown phase: ' + esc(s.phase) + '</div>';
    }
  }

  // ---------- Lobby (ready-up) ----------
  function renderPokerLobby(wrap, s) {
    const me  = getPlayerName();
    const isHost = currentRoom.host_name === me;
    const players = currentRoom.players || [];
    const allReady = players.length >= 2 && players.every(p => s.ready.includes(p.name));
    const iAmReady = s.ready.includes(me);

    wrap.innerHTML = `
      <div class="pk-lobby">
        <h3 class="pk-lobby-title">♠️♥️ POKER LOBBY ♣️♦️</h3>
        <div class="pk-config">
          <div class="pk-config-row">
            <label>💰 Starting Chips:</label>
            <input type="number" id="pk-start-chips" min="100" max="100000" step="50"
                   value="${s.config.startingChips}" ${isHost ? '' : 'disabled'}>
          </div>
          <div class="pk-config-row">
            <label>🪙 Small Blind:</label>
            <input type="number" id="pk-sb" min="1" max="10000" step="1"
                   value="${s.config.smallBlind}" ${isHost ? '' : 'disabled'}>
          </div>
          <div class="pk-config-row">
            <label>💵 Big Blind:</label>
            <input type="number" id="pk-bb" min="2" max="20000" step="1"
                   value="${s.config.bigBlind}" ${isHost ? '' : 'disabled'}>
          </div>
          <div class="pk-config-row">
            <label>☠️ Elimination Mode:</label>
            <input type="checkbox" id="pk-elim" ${s.config.elimination ? 'checked' : ''} ${isHost ? '' : 'disabled'}>
            <span class="pk-config-hint">${s.config.elimination ? 'Last pirate standing wins' : 'Broke players auto-rebuy'}</span>
          </div>
          ${isHost ? '' : '<div class="pk-config-hint">⚓ Only the host can change settings.</div>'}
        </div>
        <div class="pk-ready-list">
          ${players.map(p => {
            const r = s.ready.includes(p.name);
            return `<div class="pk-ready-row ${r ? 'ready' : ''}">
              <span>🏴‍☠️ ${esc(p.name)}${p.name === currentRoom.host_name ? ' 👑' : ''}</span>
              <span>${r ? '✅ READY' : '⏳ NOT READY'}</span>
            </div>`;
          }).join('')}
        </div>
        <div class="pk-lobby-actions">
          <button class="pk-btn ready ${iAmReady ? 'on' : ''}" id="pk-ready-btn">
            ${iAmReady ? '✅ READY!' : '⏳ READY UP'}
          </button>
          ${isHost && allReady
            ? `<button class="pk-btn start" id="pk-start-btn">🏴‍☠️ DEAL FIRST HAND</button>`
            : (isHost ? `<button class="pk-btn start" disabled>Need 2+ ready pirates</button>` : '')}
        </div>
      </div>`;

    // Wire up host config inputs
    if (isHost) {
      ['pk-start-chips', 'pk-sb', 'pk-bb', 'pk-elim'].forEach(id => {
        const el = $(id);
        if (el) el.addEventListener('change', pokerUpdateConfig);
      });
    }
    $('pk-ready-btn').addEventListener('click', pokerToggleReady);
    const startBtn = $('pk-start-btn');
    if (startBtn) startBtn.addEventListener('click', pokerStartGame);
  }

  async function pokerUpdateConfig() {
    const me = getPlayerName();
    if (currentRoom.host_name !== me) return;
    const s = JSON.parse(JSON.stringify(currentRoom.state));
    s.config.startingChips = Math.max(100, parseInt($('pk-start-chips').value, 10) || 1000);
    s.config.smallBlind    = Math.max(1,  parseInt($('pk-sb').value, 10)         || 5);
    s.config.bigBlind      = Math.max(s.config.smallBlind * 2, parseInt($('pk-bb').value, 10) || 10);
    s.config.elimination   = $('pk-elim').checked;
    await pushState(s);
  }

  async function pokerToggleReady() {
    const me = getPlayerName();
    const s = JSON.parse(JSON.stringify(currentRoom.state));
    if (s.ready.includes(me)) s.ready = s.ready.filter(n => n !== me);
    else s.ready.push(me);
    await pushState(s);
  }

  async function pokerStartGame() {
    const me = getPlayerName();
    if (currentRoom.host_name !== me) return;
    const s = JSON.parse(JSON.stringify(currentRoom.state));
    const players = currentRoom.players || [];
    if (players.length < 2) { alert('Need at least 2 players.'); return; }
    if (!players.every(p => s.ready.includes(p.name))) { alert('Not everyone is ready!'); return; }

    // Distribute starting chips
    s.chips = {};
    players.forEach(p => { s.chips[p.name] = s.config.startingChips; });
    s.eliminated = [];
    s.handNumber = 0;
    // Random first dealer
    s.dealerName = players[Math.floor(Math.random() * players.length)].name;
    pokerStartHand(s);
    await pushState(s, 'playing');
  }

  // ---------- Start a new hand ----------
  function pokerStartHand(s) {
    s.handNumber++;
    // Active players (not eliminated, have chips)
    const players = currentRoom.players || [];
    const active = players.filter(p =>
      !s.eliminated.includes(p.name) && (s.chips[p.name] || 0) > 0
    );

    if (active.length < 2) {
      // Game over
      s.phase = 'finished';
      s.lastHandResults = null;
      return;
    }

    // Rotate dealer button to next active player (clockwise = next in players[] order)
    if (s.handNumber === 1) {
      // First hand: dealerName already set; ensure they're active
      if (!active.find(p => p.name === s.dealerName)) s.dealerName = active[0].name;
    } else {
      const dealerIdx = players.findIndex(p => p.name === s.dealerName);
      for (let i = 1; i <= players.length; i++) {
        const cand = players[(dealerIdx + i) % players.length];
        if (active.find(p => p.name === cand.name)) { s.dealerName = cand.name; break; }
      }
    }

    // Build turn order: starts left of dealer (small blind), through everyone, ending at dealer
    const dealerIdx = players.findIndex(p => p.name === s.dealerName);
    const order = [];
    for (let i = 1; i <= players.length; i++) {
      const cand = players[(dealerIdx + i) % players.length];
      if (active.find(p => p.name === cand.name)) order.push(cand.name);
    }
    s.turnOrder = order;

    // Reset per-hand state
    s.deck           = pokerShuffle(pokerNewDeck());
    s.communityCards = [];
    s.pot            = 0;
    s.currentBet     = 0;
    s.minRaise       = s.config.bigBlind;
    s.hands          = {};
    s.bets           = {};
    s.totalBets      = {};
    s.inHand         = order.slice();
    s.hasActed       = [];
    s.allIn          = [];

    // Deal 2 hole cards each
    for (const name of order) {
      s.hands[name] = [s.deck.pop(), s.deck.pop()];
      s.bets[name] = 0;
      s.totalBets[name] = 0;
    }

    // Post blinds. Heads-up special case: dealer posts small blind.
    let sbName, bbName;
    if (order.length === 2) {
      sbName = order[1];     // dealer
      bbName = order[0];     // other
    } else {
      sbName = order[0];     // first after dealer
      bbName = order[1];
    }
    pokerCommitChips(s, sbName, Math.min(s.config.smallBlind, s.chips[sbName]));
    pokerCommitChips(s, bbName, Math.min(s.config.bigBlind,   s.chips[bbName]));
    s.currentBet = s.config.bigBlind;

    // First to act: heads-up = dealer (sb); 3+ players = next after BB
    if (order.length === 2) {
      s.currentTurn = sbName;          // dealer/SB acts first preflop heads-up
    } else {
      const bbIdx = order.indexOf(bbName);
      // First non-all-in active player after BB
      for (let i = 1; i <= order.length; i++) {
        const cand = order[(bbIdx + i) % order.length];
        if (s.inHand.includes(cand) && !s.allIn.includes(cand)) { s.currentTurn = cand; break; }
      }
    }

    s.phase = 'preflop';
  }

  function pokerCommitChips(s, name, amount) {
    const have = s.chips[name] || 0;
    const actual = Math.min(have, amount);
    s.chips[name] -= actual;
    s.bets[name]      = (s.bets[name] || 0) + actual;
    s.totalBets[name] = (s.totalBets[name] || 0) + actual;
    s.pot            += actual;
    if (s.chips[name] === 0 && !s.allIn.includes(name)) s.allIn.push(name);
    return actual;
  }

  // ---------- Active hand UI ----------
  function renderPokerHand(wrap, s) {
    const me = getPlayerName();
    const players = currentRoom.players || [];
    const myTurn = s.currentTurn === me && myRole === 'player' && !s.allIn.includes(me);
    const inShowdown = s.phase === 'showdown';

    // Header: pot + community cards
    const community = [];
    for (let i = 0; i < 5; i++) {
      community.push(s.communityCards[i]
        ? pokerCardHTML(s.communityCards[i])
        : '<div class="pk-card empty"></div>');
    }

    const phaseLabel = {
      preflop: 'PRE-FLOP', flop: 'FLOP', turn: 'TURN', river: 'RIVER', showdown: 'SHOWDOWN',
    }[s.phase] || s.phase.toUpperCase();

    let html = `
      <div class="pk-table">
        <div class="pk-table-head">
          <span class="pk-phase">${phaseLabel} · Hand #${s.handNumber}</span>
          <span class="pk-pot">💰 POT: ${s.pot}</span>
        </div>
        <div class="pk-community">${community.join('')}</div>
        <div class="pk-players">`;

    // Other players
    for (const p of players) {
      const name = p.name;
      const isMe = name === me;
      const folded = !s.inHand.includes(name);
      const allIn = s.allIn.includes(name);
      const isTurn = s.currentTurn === name;
      const isDealer = s.dealerName === name;
      const chips = s.chips[name] || 0;
      const bet = s.bets[name] || 0;
      const elim = s.eliminated.includes(name);
      const hand = s.hands[name];
      let cardsHTML;
      if (!hand) cardsHTML = '<div class="pk-cards"></div>';
      else if (isMe || (inShowdown && !folded)) {
        cardsHTML = `<div class="pk-cards">${hand.map(c => pokerCardHTML(c)).join('')}</div>`;
      } else if (folded) {
        cardsHTML = `<div class="pk-cards faded">${hand.map(() => pokerCardHTML(null, true)).join('')}</div>`;
      } else {
        cardsHTML = `<div class="pk-cards">${hand.map(() => pokerCardHTML(null, true)).join('')}</div>`;
      }

      let status = '';
      if (elim)    status = '<span class="pk-tag elim">OUT</span>';
      else if (folded) status = '<span class="pk-tag fold">FOLDED</span>';
      else if (allIn)  status = '<span class="pk-tag allin">ALL-IN</span>';
      else if (isTurn) status = '<span class="pk-tag turn">TO ACT</span>';

      html += `
        <div class="pk-player ${isMe ? 'me' : ''} ${isTurn ? 'active' : ''} ${folded ? 'folded' : ''}">
          <div class="pk-player-head">
            <span class="pk-player-name">${isDealer ? '🎯 ' : ''}${esc(name)}${isMe ? ' (you)' : ''}</span>
            ${status}
          </div>
          ${cardsHTML}
          <div class="pk-player-foot">
            <span class="pk-chips">💰 ${chips}</span>
            ${bet > 0 ? `<span class="pk-bet">Bet: ${bet}</span>` : ''}
          </div>
        </div>`;
    }
    html += '</div>';

    // Action bar (only on my turn)
    if (myTurn && !inShowdown) {
      const myChips = s.chips[me] || 0;
      const myBet = s.bets[me] || 0;
      const toCall = Math.max(0, s.currentBet - myBet);
      const canCheck = toCall === 0;
      const minRaiseTotal = s.currentBet + s.minRaise;     // total bet, not raise increment
      const maxBet = myBet + myChips;                      // total commitment if all-in
      // Default raise amount: min raise, capped at max
      const defaultRaise = Math.min(minRaiseTotal, maxBet);

      html += `
        <div class="pk-actions">
          <button class="pk-btn fold" id="pk-fold">FOLD</button>
          ${canCheck
            ? `<button class="pk-btn check" id="pk-check">CHECK</button>`
            : `<button class="pk-btn call" id="pk-call">CALL ${Math.min(toCall, myChips)}${toCall >= myChips ? ' (ALL-IN)' : ''}</button>`}
          ${maxBet > s.currentBet
            ? `<div class="pk-raise-group">
                 <input type="number" id="pk-raise-amt" min="${minRaiseTotal}" max="${maxBet}" step="1" value="${defaultRaise}">
                 <button class="pk-btn raise" id="pk-raise">${s.currentBet === 0 ? 'BET' : 'RAISE'}</button>
                 <button class="pk-btn allin" id="pk-allin">ALL-IN (${myChips})</button>
               </div>`
            : ''}
        </div>`;
    } else if (inShowdown) {
      // Showdown banner - results will populate after a tick via lastHandResults; this transient view shows reveal
      html += `<div class="pk-actions"><div class="pk-action-msg">🎴 Showdown! Revealing hands...</div></div>`;
    } else {
      html += `<div class="pk-actions"><div class="pk-action-msg">⏳ Waiting on ${esc(s.currentTurn || '...')}</div></div>`;
    }

    html += '</div>';
    wrap.innerHTML = html;

    // Wire up actions
    const foldBtn = $('pk-fold');   if (foldBtn)  foldBtn.addEventListener('click', () => pokerAction('fold'));
    const checkBtn = $('pk-check'); if (checkBtn) checkBtn.addEventListener('click', () => pokerAction('check'));
    const callBtn = $('pk-call');   if (callBtn)  callBtn.addEventListener('click', () => pokerAction('call'));
    const raiseBtn = $('pk-raise'); if (raiseBtn) raiseBtn.addEventListener('click', () => {
      const amt = parseInt($('pk-raise-amt').value, 10);
      pokerAction('raise', amt);
    });
    const allInBtn = $('pk-allin'); if (allInBtn) allInBtn.addEventListener('click', () => pokerAction('allin'));
  }

  // ---------- Player actions ----------
  async function pokerAction(action, amount) {
    const me = getPlayerName();
    const s = JSON.parse(JSON.stringify(currentRoom.state));
    if (s.currentTurn !== me) return;
    if (!s.inHand.includes(me)) return;

    const myBet  = s.bets[me] || 0;
    const myChips = s.chips[me] || 0;
    const toCall = Math.max(0, s.currentBet - myBet);

    if (action === 'fold') {
      s.inHand = s.inHand.filter(n => n !== me);
    } else if (action === 'check') {
      if (toCall > 0) return;     // illegal
    } else if (action === 'call') {
      pokerCommitChips(s, me, toCall);
    } else if (action === 'allin') {
      pokerCommitChips(s, me, myChips);
      // If all-in raises, update currentBet/minRaise
      const newBet = s.bets[me];
      if (newBet > s.currentBet) {
        s.minRaise = Math.max(s.minRaise, newBet - s.currentBet);
        s.currentBet = newBet;
        // All-in raise re-opens action: clear hasActed for everyone except me
        s.hasActed = [me];
      }
    } else if (action === 'raise') {
      // 'amount' is total bet for the round, not raise increment
      const total = parseInt(amount, 10) || 0;
      if (total < s.currentBet + s.minRaise) {
        // Allow shoving as a "raise" if user typed all-in amount even if below min raise
        if (total >= myBet + myChips) {
          // Treat as all-in
          pokerCommitChips(s, me, myChips);
          if (s.bets[me] > s.currentBet) {
            s.minRaise = Math.max(s.minRaise, s.bets[me] - s.currentBet);
            s.currentBet = s.bets[me];
            s.hasActed = [me];
          }
        } else { return; }
      } else {
        const need = total - myBet;
        if (need > myChips) return;
        pokerCommitChips(s, me, need);
        s.minRaise   = s.bets[me] - s.currentBet;
        s.currentBet = s.bets[me];
        s.hasActed   = [me];     // raise re-opens action
      }
    } else { return; }

    // Mark me as having acted this round
    if (!s.hasActed.includes(me)) s.hasActed.push(me);

    // Resolve next state
    pokerAdvance(s);
    await pushState(s);

    // If we entered showdown or handend, schedule auto-progression
    if (s.phase === 'showdown') {
      setTimeout(() => pokerResolveShowdown(), 1500);
    } else if (s.phase === 'handend') {
      // Already handled
    }
  }

  // ---------- Advance betting / phase ----------
  function pokerAdvance(s) {
    // Check: only one player left in hand → award pot, hand ends
    if (s.inHand.length === 1) {
      const winner = s.inHand[0];
      s.chips[winner] += s.pot;
      s.lastHandResults = {
        type: 'fold-win',
        winners: [winner],
        descr: 'All others folded',
        pots: [{ amount: s.pot, winners: [winner] }],
      };
      s.pot = 0;
      s.phase = 'handend';
      return;
    }

    // Are all live (non-all-in) players done acting AND bets equal?
    const liveActors = s.inHand.filter(n => !s.allIn.includes(n));
    const allActed = liveActors.every(n => s.hasActed.includes(n));
    const targetBet = s.currentBet;
    const allMatched = liveActors.every(n => (s.bets[n] || 0) === targetBet);

    if (allActed && allMatched) {
      // Move to next phase
      pokerNextPhase(s);
    } else {
      // Move turn to next live (non-all-in) player still in hand
      const order = s.turnOrder;
      const curIdx = order.indexOf(s.currentTurn);
      for (let i = 1; i <= order.length; i++) {
        const cand = order[(curIdx + i) % order.length];
        if (s.inHand.includes(cand) && !s.allIn.includes(cand)) {
          s.currentTurn = cand;
          return;
        }
      }
      // Nobody left to act (all all-in) — advance
      pokerNextPhase(s);
    }
  }

  function pokerNextPhase(s) {
    // Reset bets per round
    for (const k of Object.keys(s.bets)) s.bets[k] = 0;
    s.currentBet = 0;
    s.minRaise   = s.config.bigBlind;
    s.hasActed   = [];

    // If everyone left is all-in OR only one+ active, just deal remaining cards and showdown
    const liveActors = s.inHand.filter(n => !s.allIn.includes(n));
    const skipBetting = liveActors.length <= 1;

    if (s.phase === 'preflop') {
      // Deal flop
      s.deck.pop();                                              // burn
      s.communityCards.push(s.deck.pop(), s.deck.pop(), s.deck.pop());
      s.phase = 'flop';
    } else if (s.phase === 'flop') {
      s.deck.pop();
      s.communityCards.push(s.deck.pop());
      s.phase = 'turn';
    } else if (s.phase === 'turn') {
      s.deck.pop();
      s.communityCards.push(s.deck.pop());
      s.phase = 'river';
    } else if (s.phase === 'river') {
      s.phase = 'showdown';
      return;
    }

    // If we're skipping betting, recurse to next phase
    if (skipBetting && s.phase !== 'showdown') {
      pokerNextPhase(s);
      return;
    }

    // First to act post-flop = first live player after dealer
    const order = s.turnOrder;
    const dealerIdx = order.indexOf(s.dealerName);
    if (dealerIdx === -1) {
      // dealer folded out earlier — find next live
      for (let i = 0; i < order.length; i++) {
        if (s.inHand.includes(order[i]) && !s.allIn.includes(order[i])) { s.currentTurn = order[i]; return; }
      }
    } else {
      for (let i = 1; i <= order.length; i++) {
        const cand = order[(dealerIdx + i) % order.length];
        if (s.inHand.includes(cand) && !s.allIn.includes(cand)) { s.currentTurn = cand; return; }
      }
    }
  }

  // ---------- Showdown: evaluate hands, distribute (with side pots) ----------
  async function pokerResolveShowdown() {
    if (typeof Hand === 'undefined' || !Hand.solve) {
      // pokersolver didn't load; fall back to splitting pot evenly among inHand
      console.error('pokersolver not loaded — splitting pot evenly');
      const s = JSON.parse(JSON.stringify(currentRoom.state));
      const winners = s.inHand.slice();
      const share = Math.floor(s.pot / winners.length);
      winners.forEach(n => { s.chips[n] += share; });
      s.lastHandResults = { type: 'showdown', winners, descr: 'Pot split (engine unavailable)', pots: [{ amount: s.pot, winners }] };
      s.pot = 0;
      s.phase = 'handend';
      await pushState(s);
      return;
    }

    const s = JSON.parse(JSON.stringify(currentRoom.state));

    // Build side pots based on totalBets among everyone who contributed
    // Eligible per pot = inHand players with totalBets >= that level
    const allContribs = Object.entries(s.totalBets).filter(([n, v]) => v > 0);
    const showdownPlayers = s.inHand.slice();

    // Sort showdown players by their total contribution ascending
    const sortedShow = showdownPlayers.slice().sort((a, b) => (s.totalBets[a] || 0) - (s.totalBets[b] || 0));

    const pots = [];
    let prevLevel = 0;
    for (const p of sortedShow) {
      const level = s.totalBets[p] || 0;
      if (level <= prevLevel) continue;
      const layerSize = level - prevLevel;
      let potAmt = 0;
      for (const [n, contrib] of allContribs) {
        const contribAtLevel = Math.min(layerSize, Math.max(0, contrib - prevLevel));
        potAmt += contribAtLevel;
      }
      pots.push({
        amount: potAmt,
        eligible: showdownPlayers.filter(p2 => (s.totalBets[p2] || 0) >= level),
        level,
      });
      prevLevel = level;
    }

    // Evaluate each showdown player's best 5-card hand
    const hands = {};
    const handDescr = {};
    for (const name of showdownPlayers) {
      const cards = s.hands[name].concat(s.communityCards);
      try {
        const h = Hand.solve(cards);
        hands[name] = h;
        handDescr[name] = h.descr;
      } catch (e) {
        console.error('Hand eval failed for', name, cards, e);
      }
    }

    // Award each pot
    const potResults = [];
    for (const pot of pots) {
      const eligibleHands = pot.eligible.map(n => hands[n]).filter(Boolean);
      if (eligibleHands.length === 0) continue;
      const winners = Hand.winners(eligibleHands);
      const winnerNames = pot.eligible.filter(n => winners.includes(hands[n]));
      const share = Math.floor(pot.amount / winnerNames.length);
      const remainder = pot.amount - share * winnerNames.length;
      winnerNames.forEach((n, i) => { s.chips[n] += share + (i === 0 ? remainder : 0); });
      potResults.push({ amount: pot.amount, winners: winnerNames, descr: handDescr[winnerNames[0]] || '' });
    }

    s.lastHandResults = {
      type: 'showdown',
      winners: potResults[0]?.winners || [],
      descr: potResults[0]?.descr || '',
      pots: potResults,
      hands: handDescr,
    };
    s.pot = 0;
    s.phase = 'handend';

    // Handle elimination/rebuy after pot distribution
    pokerHandleBrokePlayers(s);

    await pushState(s);
  }

  function pokerHandleBrokePlayers(s) {
    const players = currentRoom.players || [];
    for (const p of players) {
      if (s.eliminated.includes(p.name)) continue;
      if ((s.chips[p.name] || 0) <= 0) {
        if (s.config.elimination) s.eliminated.push(p.name);
        else                      s.chips[p.name] = s.config.startingChips;     // rebuy
      }
    }
  }

  // ---------- Hand-end summary ----------
  function renderPokerHandEnd(wrap, s) {
    const me = getPlayerName();
    const isHost = currentRoom.host_name === me;
    const r = s.lastHandResults;
    const players = currentRoom.players || [];

    let resultsHTML = '';
    if (r) {
      if (r.type === 'fold-win') {
        resultsHTML = `<div class="pk-result-line">🏆 <strong>${esc(r.winners[0])}</strong> wins ${r.pots[0].amount} chips — everyone else folded.</div>`;
      } else {
        resultsHTML = r.pots.map((pot, i) => {
          const lbl = i === 0 ? 'Main pot' : `Side pot ${i}`;
          return `<div class="pk-result-line">
            🏆 ${lbl} (${pot.amount}): <strong>${pot.winners.map(esc).join(', ')}</strong>
            ${pot.descr ? ` — ${esc(pot.descr)}` : ''}
          </div>`;
        }).join('');
        // Show all hand descriptions
        if (r.hands) {
          resultsHTML += '<div class="pk-result-hands">';
          for (const [name, descr] of Object.entries(r.hands)) {
            resultsHTML += `<div>${esc(name)}: ${esc(descr)}</div>`;
          }
          resultsHTML += '</div>';
        }
      }
    }

    // Show community + revealed hole cards
    const community = s.communityCards.map(c => pokerCardHTML(c)).join('') || '<em>No flop</em>';

    let stackHTML = '<div class="pk-stacks">';
    for (const p of players) {
      const elim = s.eliminated.includes(p.name);
      stackHTML += `<div class="pk-stack ${elim ? 'elim' : ''}">
        🏴‍☠️ ${esc(p.name)}: <strong>${s.chips[p.name] || 0}</strong>
        ${elim ? ' <span class="pk-tag elim">OUT</span>' : ''}
      </div>`;
    }
    stackHTML += '</div>';

    wrap.innerHTML = `
      <div class="pk-handend">
        <h3 class="pk-handend-title">🃏 HAND #${s.handNumber} COMPLETE 🃏</h3>
        <div class="pk-handend-community">${community}</div>
        <div class="pk-handend-results">${resultsHTML}</div>
        ${stackHTML}
        ${isHost
          ? `<button class="pk-btn next-hand" id="pk-next-hand-btn">🏴‍☠️ DEAL NEXT HAND</button>`
          : `<div class="pk-action-msg">⏳ Waiting for host to deal next hand...</div>`}
      </div>`;

    const btn = $('pk-next-hand-btn');
    if (btn) btn.addEventListener('click', pokerNextHand);
  }

  async function pokerNextHand() {
    const me = getPlayerName();
    if (currentRoom.host_name !== me) return;
    const s = JSON.parse(JSON.stringify(currentRoom.state));
    pokerStartHand(s);
    await pushState(s);
  }

  // ---------- Game over ----------
  function renderPokerFinished(wrap, s) {
    const me = getPlayerName();
    const isHost = currentRoom.host_name === me;
    const players = currentRoom.players || [];
    // Sort by chips desc
    const sorted = players.slice().sort((a, b) => (s.chips[b.name] || 0) - (s.chips[a.name] || 0));
    const winner = sorted[0];

    wrap.innerHTML = `
      <div class="pk-finished">
        <h3 class="pk-finished-title">🏴‍☠️ GAME OVER 🏴‍☠️</h3>
        <div class="pk-winner">🏆 <strong>${esc(winner.name)}</strong> wins with ${s.chips[winner.name] || 0} chips!</div>
        <div class="pk-final-stacks">
          ${sorted.map((p, i) => `
            <div class="pk-final-row">
              <span>#${i + 1} ${esc(p.name)}</span>
              <span>${s.chips[p.name] || 0} chips</span>
            </div>`).join('')}
        </div>
        ${isHost ? `<button class="pk-btn restart" id="pk-restart-btn">🔁 PLAY AGAIN</button>` : ''}
      </div>`;
    const btn = $('pk-restart-btn');
    if (btn) btn.addEventListener('click', pokerRestart);
  }

  async function pokerRestart() {
    const me = getPlayerName();
    if (currentRoom.host_name !== me) return;
    const s = GAMES.poker.initialState();
    await pushState(s);
  }

  // =================================================================
  // CHAMELEON 🦎
  // =================================================================
  // 16-word topic packs (4×4 grids). Easy to add more — just push more
  // objects with `name` (label) and `words` (exactly 16 strings).
  const CHAMELEON_TOPICS = [
    { name: 'Food', words: ['Pizza','Eggs','Pasta','Sausage','Potatoes','Salad','Cheese','Ice Cream','Fish','Soup','Fruit','Chocolate','Cake','Bread','Chicken','Beef'] },
    { name: 'Animals', words: ['Lion','Shark','Eagle','Snake','Dolphin','Tiger','Bear','Whale','Elephant','Spider','Frog','Penguin','Wolf','Octopus','Bat','Crocodile'] },
    { name: 'Pirate Things', words: ['Treasure','Cannon','Parrot','Eyepatch','Compass','Map','Anchor','Sword','Skull','Ship','Plank','Chest','Rum','Hat','Hook','Flag'] },
    { name: 'Movies & TV', words: ['Star Wars','Marvel','Disney','Horror','Comedy','Anime','Sitcom','Reality','Action','Romance','Western','Documentary','Cartoon','Drama','Musical','Sci-Fi'] },
    { name: 'Sports', words: ['Football','Soccer','Basketball','Tennis','Golf','Hockey','Baseball','Boxing','Skating','Surfing','Skiing','Volleyball','Wrestling','Cycling','Bowling','Swimming'] },
    { name: 'Vacation Spots', words: ['Beach','Mountain','City','Island','Forest','Desert','Cruise','Hotel','Camp','Cabin','Resort','Theme Park','Museum','Zoo','Spa','Casino'] },
    { name: 'In a Kitchen', words: ['Knife','Fork','Plate','Cup','Pan','Oven','Fridge','Sink','Toaster','Microwave','Bowl','Spoon','Stove','Cutting Board','Blender','Kettle'] },
    { name: 'Music Genres', words: ['Rock','Pop','Hip-Hop','Country','Jazz','Classical','Metal','Reggae','Electronic','Punk','Blues','Folk','R&B','Indie','K-Pop','Disco'] },
    { name: 'Video Games', words: ['Mario','Zelda','Minecraft','Fortnite','Pokemon','Roblox','Halo','Tetris','Sonic','Pac-Man','Sims','Call of Duty','Among Us','Doom','Skyrim','Animal Crossing'] },
    { name: 'Yarghle Lore', words: ['Yarghle','RAM','Subscriber','Grog','Treasure','YouTube','Bell','Like','Comment','Share','Pirate','Ship','Swag','Bit','Stream','Friend'] },
  ];

  function renderChameleon(wrap) {
    const s = currentRoom.state;
    if (!s) return;
    switch (s.phase) {
      case 'lobby':       renderChamLobby(wrap, s);       break;
      case 'reveal':      renderChamReveal(wrap, s);      break;
      case 'speaking':    renderChamSpeaking(wrap, s);    break;
      case 'voting':      renderChamVoting(wrap, s);      break;
      case 'accusation':  renderChamAccusation(wrap, s);  break;
      case 'guess':       renderChamGuess(wrap, s);       break;
      case 'roundend':    renderChamRoundEnd(wrap, s);    break;
      case 'finished':    renderChamFinished(wrap, s);    break;
      default:            wrap.innerHTML = '<div class="game-waiting">Loading...</div>';
    }
  }

  function renderChamLobby(wrap, s) {
    const me = getPlayerName();
    const isHost = currentRoom.host_name === me;
    const players = currentRoom.players || [];
    const canStart = players.length >= 3 && players.every(p => s.ready.includes(p.name));
    const iAmReady = s.ready.includes(me);

    wrap.innerHTML = `
      <div class="cm-lobby">
        <h3 class="cm-lobby-title">🦎 CHAMELEON LOBBY 🦎</h3>
        <div class="cm-rules">
          <p>One pirate is the <strong>Chameleon</strong> — they don't know the secret word.</p>
          <p>Everyone says one word about the secret word. The Chameleon must bluff.</p>
          <p>After everyone speaks, vote on who you think is the Chameleon!</p>
        </div>
        <div class="cm-config">
          <div class="cm-config-row">
            <span class="cm-config-label">🎲 Rounds to play:</span>
            <div class="cm-pill-row">
              ${[3,5,7,10].map(n =>
                `<button class="bj-pill ${s.config.rounds === n ? 'active' : ''}" data-rounds="${n}" ${isHost ? '' : 'disabled'}>${n}</button>`
              ).join('')}
            </div>
          </div>
        </div>
        <div class="cm-ready-list">
          ${players.map(p => {
            const r = s.ready.includes(p.name);
            return `<div class="pk-ready-row ${r ? 'ready' : ''}">
              <span>🏴‍☠️ ${esc(p.name)}${p.name === currentRoom.host_name ? ' 👑' : ''}</span>
              <span>${r ? '✅ READY' : '⏳ NOT READY'}</span>
            </div>`;
          }).join('')}
        </div>
        ${players.length < 3 ? '<div class="cm-waiting">Need at least 3 pirates to play.</div>' : ''}
        <div class="pk-lobby-actions">
          <button class="pk-btn ready ${iAmReady ? 'on' : ''}" id="cm-ready-btn">
            ${iAmReady ? '✅ READY!' : '⏳ READY UP'}
          </button>
          ${isHost
            ? `<button class="pk-btn start" id="cm-start-btn" ${canStart ? '' : 'disabled'}>🦎 START</button>`
            : ''}
        </div>
      </div>`;

    if (isHost) {
      wrap.querySelectorAll('[data-rounds]').forEach(b =>
        b.addEventListener('click', () => chamSetRounds(parseInt(b.dataset.rounds, 10))));
    }
    $('cm-ready-btn').addEventListener('click', chamToggleReady);
    const startBtn = $('cm-start-btn');
    if (startBtn) startBtn.addEventListener('click', chamStart);
  }

  async function chamSetRounds(n) {
    const me = getPlayerName();
    if (currentRoom.host_name !== me) return;
    const s = JSON.parse(JSON.stringify(currentRoom.state));
    s.config.rounds = n;
    await pushState(s);
  }

  async function chamToggleReady() {
    const me = getPlayerName();
    const s = JSON.parse(JSON.stringify(currentRoom.state));
    if (s.ready.includes(me)) s.ready = s.ready.filter(n => n !== me);
    else s.ready.push(me);
    await pushState(s);
  }

  async function chamStart() {
    const me = getPlayerName();
    if (currentRoom.host_name !== me) return;
    const s = JSON.parse(JSON.stringify(currentRoom.state));
    const players = currentRoom.players || [];
    if (players.length < 3) { alert('Need at least 3 players.'); return; }
    if (!players.every(p => s.ready.includes(p.name))) { alert('Not everyone is ready!'); return; }

    s.scores = {};
    players.forEach(p => { s.scores[p.name] = 0; });
    s.roundNumber = 0;
    chamStartRound(s);
    await pushState(s, 'playing');
  }

  function chamStartRound(s) {
    s.roundNumber++;
    const players = currentRoom.players || [];

    // Pick random topic + word
    const topic = CHAMELEON_TOPICS[Math.floor(Math.random() * CHAMELEON_TOPICS.length)];
    const word  = topic.words[Math.floor(Math.random() * topic.words.length)];
    s.currentTopic = topic;
    s.currentWord  = word;

    // Pick random Chameleon
    s.currentChameleon = players[Math.floor(Math.random() * players.length)].name;

    // Random speak order
    const shuffled = players.map(p => p.name).slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    s.speakOrder = shuffled;
    s.currentSpeaker = shuffled[0];
    s.spokenWords = {};
    s.votes = {};
    s.accused = null;
    s.chameleonGuess = null;
    s.roundResult = null;

    s.phase = 'reveal';
  }

  function renderChamReveal(wrap, s) {
    const me = getPlayerName();
    const amChameleon = s.currentChameleon === me;
    const isHost = currentRoom.host_name === me;

    wrap.innerHTML = `
      <div class="cm-reveal">
        <h3 class="cm-reveal-title">🎴 ROUND ${s.roundNumber} of ${s.config.rounds} 🎴</h3>
        <div class="cm-topic-name">Topic: <strong>${esc(s.currentTopic.name)}</strong></div>
        <div class="cm-grid">
          ${s.currentTopic.words.map(w =>
            `<div class="cm-grid-cell ${(amChameleon ? false : w === s.currentWord) ? 'secret' : ''}">${esc(w)}</div>`
          ).join('')}
        </div>
        <div class="cm-role-card ${amChameleon ? 'chameleon' : 'normal'}">
          ${amChameleon
            ? `<div class="cm-role-title">🦎 YOU ARE THE CHAMELEON</div>
               <div class="cm-role-desc">Bluff! Listen to others' words and try to figure out the secret word.</div>`
            : `<div class="cm-role-title">🏴‍☠️ Secret Word: <strong>${esc(s.currentWord)}</strong></div>
               <div class="cm-role-desc">When it's yer turn, say ONE word that hints at the secret — but not too obvious!</div>`
          }
        </div>
        ${isHost
          ? `<button class="pk-btn start" id="cm-begin-btn">🎤 BEGIN SPEAKING</button>`
          : `<div class="cm-waiting">⏳ Waiting for host to begin...</div>`}
      </div>`;
    const btn = $('cm-begin-btn');
    if (btn) btn.addEventListener('click', async () => {
      const ns = JSON.parse(JSON.stringify(currentRoom.state));
      ns.phase = 'speaking';
      await pushState(ns);
    });
  }

  function renderChamSpeaking(wrap, s) {
    const me = getPlayerName();
    const amChameleon = s.currentChameleon === me;
    const myTurn = s.currentSpeaker === me;
    const players = currentRoom.players || [];

    let html = `
      <div class="cm-speaking">
        <h3 class="cm-section-title">🎤 SPEAKING PHASE</h3>
        <div class="cm-topic-name">Topic: <strong>${esc(s.currentTopic.name)}</strong></div>
        <div class="cm-grid">
          ${s.currentTopic.words.map(w => {
            const isSecret = !amChameleon && w === s.currentWord;
            return `<div class="cm-grid-cell ${isSecret ? 'secret' : ''}">${esc(w)}</div>`;
          }).join('')}
        </div>
        <div class="cm-spoken-list">`;

    for (const name of s.speakOrder) {
      const word = s.spokenWords[name];
      const isCurrent = s.currentSpeaker === name;
      const isMe = name === me;
      html += `<div class="cm-spoken-row ${isCurrent ? 'current' : ''} ${word ? 'done' : ''} ${isMe ? 'me' : ''}">
        <span class="cm-spoken-name">🏴‍☠️ ${esc(name)}${isMe ? ' (you)' : ''}</span>
        ${word ? `<span class="cm-spoken-word">"${esc(word)}"</span>` : (isCurrent ? '<span class="cm-spoken-turn">SPEAKING...</span>' : '<span class="cm-spoken-pending">⏳</span>')}
      </div>`;
    }
    html += '</div>';

    if (myTurn) {
      html += `
        <div class="cm-input-row">
          <input type="text" id="cm-word-input" placeholder="Say one word..." maxlength="30" autofocus>
          <button class="pk-btn start" id="cm-submit-btn">📢 SAY IT</button>
        </div>
        <div class="cm-hint">${amChameleon ? '🦎 Bluff carefully — others have a secret word ye dunno!' : '💡 Hint at the secret without saying it directly.'}</div>`;
    } else {
      html += `<div class="cm-waiting">⏳ Waiting on <strong>${esc(s.currentSpeaker)}</strong>...</div>`;
    }
    html += '</div>';
    wrap.innerHTML = html;

    const submitBtn = $('cm-submit-btn');
    const input = $('cm-word-input');
    if (submitBtn) submitBtn.addEventListener('click', chamSubmitWord);
    if (input) input.addEventListener('keydown', e => {
      if (e.key === 'Enter') chamSubmitWord();
    });
    if (input) input.focus();
  }

  async function chamSubmitWord() {
    const me = getPlayerName();
    const input = $('cm-word-input');
    const word = (input?.value || '').trim().slice(0, 30);
    if (!word) { alert('Say something!'); return; }

    const s = JSON.parse(JSON.stringify(currentRoom.state));
    if (s.currentSpeaker !== me) return;

    s.spokenWords[me] = word;
    // Move to next speaker
    const idx = s.speakOrder.indexOf(me);
    if (idx === s.speakOrder.length - 1) {
      // Everyone has spoken → voting phase
      s.phase = 'voting';
      s.currentSpeaker = null;
    } else {
      s.currentSpeaker = s.speakOrder[idx + 1];
    }
    await pushState(s);
  }

  function renderChamVoting(wrap, s) {
    const me = getPlayerName();
    const players = currentRoom.players || [];
    const myVote = s.votes[me];
    const allVoted = players.every(p => s.votes[p.name]);

    let html = `
      <div class="cm-voting">
        <h3 class="cm-section-title">🗳️ VOTE: WHO IS THE CHAMELEON?</h3>
        <div class="cm-spoken-recap">
          ${s.speakOrder.map(name =>
            `<div class="cm-spoken-row done">
              <span class="cm-spoken-name">🏴‍☠️ ${esc(name)}</span>
              <span class="cm-spoken-word">"${esc(s.spokenWords[name] || '?')}"</span>
            </div>`
          ).join('')}
        </div>
        <div class="cm-vote-grid">`;

    for (const p of players) {
      if (p.name === me) continue;     // can't vote for self
      const voteCount = Object.values(s.votes).filter(v => v === p.name).length;
      const iVotedThis = myVote === p.name;
      html += `<button class="cm-vote-btn ${iVotedThis ? 'voted' : ''}" data-vote="${esc(p.name)}">
        🦎 ${esc(p.name)}
        ${voteCount > 0 ? `<span class="cm-vote-count">${voteCount}</span>` : ''}
      </button>`;
    }
    html += '</div>';

    html += `<div class="cm-vote-status">
      ${myVote ? `Ye voted for <strong>${esc(myVote)}</strong>. Tap another to change.` : '☝️ Tap a name to vote.'}
      <br><small>${Object.keys(s.votes).length} / ${players.length} voted</small>
    </div>`;

    if (allVoted && currentRoom.host_name === me) {
      html += `<button class="pk-btn start" id="cm-tally-btn">📊 TALLY VOTES</button>`;
    }
    html += '</div>';
    wrap.innerHTML = html;

    wrap.querySelectorAll('[data-vote]').forEach(b =>
      b.addEventListener('click', () => chamVote(b.dataset.vote)));
    const tally = $('cm-tally-btn');
    if (tally) tally.addEventListener('click', chamTallyVotes);
  }

  async function chamVote(target) {
    const me = getPlayerName();
    const s = JSON.parse(JSON.stringify(currentRoom.state));
    if (s.phase !== 'voting') return;
    s.votes[me] = target;
    await pushState(s);
  }

  async function chamTallyVotes() {
    const me = getPlayerName();
    if (currentRoom.host_name !== me) return;
    const s = JSON.parse(JSON.stringify(currentRoom.state));

    // Tally
    const tally = {};
    for (const v of Object.values(s.votes)) tally[v] = (tally[v] || 0) + 1;
    let topName = null, topCount = -1, tied = false;
    for (const [name, count] of Object.entries(tally)) {
      if (count > topCount) { topName = name; topCount = count; tied = false; }
      else if (count === topCount) { tied = true; }
    }
    // Per the rules: ties → host (dealer this round) gets deciding vote.
    // Simplification: if tied, host's vote becomes the deciding vote among tied candidates.
    if (tied) {
      const hostVote = s.votes[currentRoom.host_name];
      if (hostVote && tally[hostVote] === topCount) topName = hostVote;
    }
    s.accused = topName;

    if (s.accused === s.currentChameleon) {
      // Chameleon was caught → they get to guess the word
      s.phase = 'guess';
    } else {
      // Chameleon escaped
      s.roundResult = 'chameleon-escaped';
      chamApplyScores(s);
      s.phase = 'roundend';
    }
    await pushState(s);
  }

  function renderChamAccusation(wrap, s) {
    // Currently unused phase — accusation logic happens directly in tally → guess/roundend.
    // Kept for future expansion.
    renderChamRoundEnd(wrap, s);
  }

  function renderChamGuess(wrap, s) {
    const me = getPlayerName();
    const amChameleon = s.currentChameleon === me;

    let html = `
      <div class="cm-guess">
        <h3 class="cm-section-title">🦎 CHAMELEON CAUGHT!</h3>
        <div class="cm-accused">${esc(s.accused)} was accused — and they ARE the Chameleon!</div>
        <div class="cm-guess-prompt">The Chameleon now gets ONE chance to guess the secret word. If they nail it, they still win the round!</div>
        <div class="cm-grid">
          ${s.currentTopic.words.map(w =>
            `<button class="cm-grid-cell guessable ${amChameleon ? 'clickable' : ''}" data-guess="${esc(w)}" ${amChameleon ? '' : 'disabled'}>${esc(w)}</button>`
          ).join('')}
        </div>
        ${amChameleon
          ? '<div class="cm-hint">☝️ Tap yer guess. No takebacks!</div>'
          : `<div class="cm-waiting">⏳ Waiting on <strong>${esc(s.currentChameleon)}</strong> to guess...</div>`}
      </div>`;
    wrap.innerHTML = html;

    if (amChameleon) {
      wrap.querySelectorAll('[data-guess]').forEach(b =>
        b.addEventListener('click', () => chamSubmitGuess(b.dataset.guess)));
    }
  }

  async function chamSubmitGuess(guess) {
    const me = getPlayerName();
    const s = JSON.parse(JSON.stringify(currentRoom.state));
    if (s.currentChameleon !== me) return;
    if (s.chameleonGuess) return;     // already guessed

    s.chameleonGuess = guess;
    if (guess === s.currentWord) {
      s.roundResult = 'chameleon-guessed';
    } else {
      s.roundResult = 'caught';
    }
    chamApplyScores(s);
    s.phase = 'roundend';
    await pushState(s);
  }

  function chamApplyScores(s) {
    const players = currentRoom.players || [];
    if (s.roundResult === 'chameleon-escaped') {
      s.scores[s.currentChameleon] = (s.scores[s.currentChameleon] || 0) + 2;
    } else if (s.roundResult === 'chameleon-guessed') {
      s.scores[s.currentChameleon] = (s.scores[s.currentChameleon] || 0) + 1;
    } else if (s.roundResult === 'caught') {
      for (const p of players) {
        if (p.name !== s.currentChameleon) {
          s.scores[p.name] = (s.scores[p.name] || 0) + 2;
        }
      }
    }
  }

  function renderChamRoundEnd(wrap, s) {
    const me = getPlayerName();
    const isHost = currentRoom.host_name === me;
    const players = currentRoom.players || [];
    const lastRound = s.roundNumber >= s.config.rounds;

    let resultHTML = '';
    if (s.roundResult === 'chameleon-escaped') {
      resultHTML = `<div class="cm-result-line escaped">🦎 The Chameleon ESCAPED!</div>
        <div class="cm-result-detail"><strong>${esc(s.currentChameleon)}</strong> was the Chameleon.<br>
        Secret word was <strong>${esc(s.currentWord)}</strong>. (+2 to Chameleon)</div>`;
    } else if (s.roundResult === 'chameleon-guessed') {
      resultHTML = `<div class="cm-result-line guessed">🎯 Caught — but the Chameleon guessed RIGHT!</div>
        <div class="cm-result-detail"><strong>${esc(s.currentChameleon)}</strong> was the Chameleon and guessed <strong>${esc(s.chameleonGuess)}</strong>.<br>
        Secret word was <strong>${esc(s.currentWord)}</strong>. (+1 to Chameleon)</div>`;
    } else {
      resultHTML = `<div class="cm-result-line caught">⚓ The Chameleon was CAUGHT!</div>
        <div class="cm-result-detail"><strong>${esc(s.currentChameleon)}</strong> was the Chameleon and guessed <strong>${esc(s.chameleonGuess)}</strong> (wrong!).<br>
        Secret word was <strong>${esc(s.currentWord)}</strong>. (+2 to everyone else)</div>`;
    }

    const sortedScores = players.slice().sort((a, b) => (s.scores[b.name] || 0) - (s.scores[a.name] || 0));
    const scoresHTML = sortedScores.map(p =>
      `<div class="cm-score-row"><span>🏴‍☠️ ${esc(p.name)}${p.name === s.currentChameleon ? ' 🦎' : ''}</span>
        <span><strong>${s.scores[p.name] || 0}</strong> pts</span></div>`
    ).join('');

    wrap.innerHTML = `
      <div class="cm-roundend">
        <h3 class="cm-section-title">🎴 ROUND ${s.roundNumber} COMPLETE</h3>
        ${resultHTML}
        <div class="cm-scores-list">${scoresHTML}</div>
        ${isHost
          ? `<button class="pk-btn start" id="cm-next-btn">${lastRound ? '🏆 SHOW FINAL SCORES' : '➡️ NEXT ROUND'}</button>`
          : `<div class="cm-waiting">⏳ Waiting for host...</div>`}
      </div>`;

    const next = $('cm-next-btn');
    if (next) next.addEventListener('click', async () => {
      const ns = JSON.parse(JSON.stringify(currentRoom.state));
      if (lastRound) {
        ns.phase = 'finished';
      } else {
        chamStartRound(ns);
      }
      await pushState(ns);
    });
  }

  function renderChamFinished(wrap, s) {
    const me = getPlayerName();
    const isHost = currentRoom.host_name === me;
    const players = currentRoom.players || [];
    const sorted = players.slice().sort((a, b) => (s.scores[b.name] || 0) - (s.scores[a.name] || 0));
    const winner = sorted[0];

    wrap.innerHTML = `
      <div class="cm-finished">
        <h3 class="cm-finished-title">🏆 GAME OVER 🏆</h3>
        <div class="cm-winner-name">🥇 <strong>${esc(winner.name)}</strong> wins!</div>
        <div class="cm-final-scores">
          ${sorted.map((p, i) => `
            <div class="cm-final-row">
              <span>#${i + 1} ${esc(p.name)}</span>
              <span>${s.scores[p.name] || 0} pts</span>
            </div>`).join('')}
        </div>
        ${isHost ? `<button class="pk-btn restart" id="cm-restart-btn">🔁 PLAY AGAIN</button>` : ''}
      </div>`;
    const btn = $('cm-restart-btn');
    if (btn) btn.addEventListener('click', async () => {
      await pushState(GAMES.chameleon.initialState());
    });
  }

  // =================================================================
  // SKRIBBL ✏️ (Pictionary-style word-guessing draw game)
  // =================================================================
  const SKRIBBL_WORDS = [
    // Easy
    'cat','dog','sun','moon','star','tree','house','car','book','fish',
    'apple','banana','pizza','ball','clock','chair','door','phone','shoe','hat',
    'eye','heart','flower','cloud','rain','snow','fire','water','egg','key',
    // Medium
    'pirate','ship','treasure','island','sword','parrot','anchor','compass','map','flag',
    'dragon','castle','wizard','knight','crown','rainbow','butterfly','umbrella','volcano','planet',
    'guitar','piano','drum','rocket','telescope','microscope','dinosaur','mermaid','unicorn','ghost',
    'pumpkin','snowman','robot','alien','astronaut','cowboy','ninja','vampire','witch','zombie',
    // Hard / fun
    'helicopter','submarine','penguin','octopus','dolphin','elephant','giraffe','kangaroo','platypus','chameleon',
    'sandwich','spaghetti','hamburger','cupcake','popcorn','sushi','tacos','donut','pretzel','watermelon',
    'lightning','tornado','earthquake','volcano','meteor','galaxy','blackhole','rainbow','sunset','aurora',
    'skateboard','bicycle','motorcycle','airplane','rollercoaster','escalator','treadmill','trampoline','seesaw','swing',
    // Yarghle-themed
    'yarghle','grog','swag','plank','cannon','eyepatch','peg leg','crow nest','jolly roger','doubloon',
  ];

  function renderSkribbl(wrap) {
    const s = currentRoom.state;
    if (!s) return;
    switch (s.phase) {
      case 'lobby':     renderSkribblLobby(wrap, s);    break;
      case 'choosing':  renderSkribblChoosing(wrap, s); break;
      case 'drawing':   renderSkribblDrawing(wrap, s);  break;
      case 'roundend':  renderSkribblRoundEnd(wrap, s); break;
      case 'finished':  renderSkribblFinished(wrap, s); break;
      default:          wrap.innerHTML = '<div class="game-waiting">Loading...</div>';
    }
  }

  function renderSkribblLobby(wrap, s) {
    const me = getPlayerName();
    const isHost = currentRoom.host_name === me;
    const players = currentRoom.players || [];
    const canStart = players.length >= 2 && players.every(p => s.ready.includes(p.name));
    const iAmReady = s.ready.includes(me);

    wrap.innerHTML = `
      <div class="sk-lobby">
        <h3 class="sk-lobby-title">✏️ SKRIBBL LOBBY ✏️</h3>
        <div class="cm-rules">
          <p>One pirate draws, others guess in the chat.</p>
          <p>First correct guess gets the most points. Drawer scores when guessed.</p>
          <p>Each player draws ${s.config.rounds} times.</p>
        </div>
        <div class="cm-config">
          <div class="cm-config-row">
            <span class="cm-config-label">🎲 Rounds per player:</span>
            <div class="cm-pill-row">
              ${[2,3,5].map(n =>
                `<button class="bj-pill ${s.config.rounds === n ? 'active' : ''}" data-rounds="${n}" ${isHost ? '' : 'disabled'}>${n}</button>`
              ).join('')}
            </div>
          </div>
          <div class="cm-config-row">
            <span class="cm-config-label">⏱️ Draw time (seconds):</span>
            <div class="cm-pill-row">
              ${[60,80,120,180].map(n =>
                `<button class="bj-pill ${s.config.drawTime === n ? 'active' : ''}" data-drawtime="${n}" ${isHost ? '' : 'disabled'}>${n}s</button>`
              ).join('')}
            </div>
          </div>
        </div>
        <div class="cm-ready-list">
          ${players.map(p => {
            const r = s.ready.includes(p.name);
            return `<div class="pk-ready-row ${r ? 'ready' : ''}">
              <span>🏴‍☠️ ${esc(p.name)}${p.name === currentRoom.host_name ? ' 👑' : ''}</span>
              <span>${r ? '✅ READY' : '⏳ NOT READY'}</span>
            </div>`;
          }).join('')}
        </div>
        ${players.length < 2 ? '<div class="cm-waiting">Need at least 2 pirates to play.</div>' : ''}
        <div class="pk-lobby-actions">
          <button class="pk-btn ready ${iAmReady ? 'on' : ''}" id="sk-ready-btn">
            ${iAmReady ? '✅ READY!' : '⏳ READY UP'}
          </button>
          ${isHost
            ? `<button class="pk-btn start" id="sk-start-btn" ${canStart ? '' : 'disabled'}>✏️ START</button>`
            : ''}
        </div>
      </div>`;

    if (isHost) {
      wrap.querySelectorAll('[data-rounds]').forEach(b =>
        b.addEventListener('click', () => skribblSetRounds(parseInt(b.dataset.rounds, 10))));
      wrap.querySelectorAll('[data-drawtime]').forEach(b =>
        b.addEventListener('click', () => skribblSetDrawTime(parseInt(b.dataset.drawtime, 10))));
    }
    $('sk-ready-btn').addEventListener('click', skribblToggleReady);
    const startBtn = $('sk-start-btn');
    if (startBtn) startBtn.addEventListener('click', skribblStart);
  }

  async function skribblSetRounds(n) {
    const me = getPlayerName(); if (currentRoom.host_name !== me) return;
    const s = JSON.parse(JSON.stringify(currentRoom.state));
    s.config.rounds = n; await pushState(s);
  }
  async function skribblSetDrawTime(n) {
    const me = getPlayerName(); if (currentRoom.host_name !== me) return;
    const s = JSON.parse(JSON.stringify(currentRoom.state));
    s.config.drawTime = n; await pushState(s);
  }
  async function skribblToggleReady() {
    const me = getPlayerName();
    const s = JSON.parse(JSON.stringify(currentRoom.state));
    if (s.ready.includes(me)) s.ready = s.ready.filter(n => n !== me);
    else s.ready.push(me);
    await pushState(s);
  }

  async function skribblStart() {
    const me = getPlayerName(); if (currentRoom.host_name !== me) return;
    const s = JSON.parse(JSON.stringify(currentRoom.state));
    const players = currentRoom.players || [];
    if (players.length < 2) { alert('Need at least 2 players.'); return; }
    if (!players.every(p => s.ready.includes(p.name))) { alert('Not everyone is ready!'); return; }

    s.scores = {};
    players.forEach(p => { s.scores[p.name] = 0; });

    // Build draw order: each player draws `rounds` times, shuffled
    const order = [];
    for (let r = 0; r < s.config.rounds; r++) {
      const shuffled = players.map(p => p.name).slice();
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      order.push(...shuffled);
    }
    s.drawOrder = order;
    s.totalRounds = order.length;
    s.drawerIdx = 0;
    skribblNextDrawer(s);
    await pushState(s, 'playing');
  }

  function skribblPickWordChoices() {
    const pool = SKRIBBL_WORDS.slice();
    const out = [];
    for (let i = 0; i < 3 && pool.length > 0; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      out.push(pool.splice(idx, 1)[0]);
    }
    return out;
  }

  function skribblNextDrawer(s) {
    if (s.drawerIdx >= s.drawOrder.length) {
      s.phase = 'finished';
      return;
    }
    s.currentDrawer = s.drawOrder[s.drawerIdx];
    s.wordChoices  = skribblPickWordChoices();
    s.currentWord  = null;
    s.revealedWord = '';
    s.hintsRevealed = 0;
    s.guessers     = [];
    s.chatLog      = [];
    s.roundScores  = {};
    s.roundEndsAt  = null;
    s.phase = 'choosing';
  }

  // ---------- Drawer picks a word ----------
  function renderSkribblChoosing(wrap, s) {
    const me = getPlayerName();
    const amDrawer = s.currentDrawer === me;
    const players = currentRoom.players || [];

    let html = `
      <div class="sk-table">
        ${skribblHeaderHTML(s)}
        <div class="sk-canvas-wrap" id="sk-canvas-wrap-placeholder"></div>`;

    if (amDrawer) {
      html += `
        <div class="sk-choose">
          <div class="sk-choose-title">📜 CHOOSE A WORD TO DRAW</div>
          <div class="sk-choose-options">
            ${s.wordChoices.map(w =>
              `<button class="sk-choose-btn" data-word="${esc(w)}">${esc(w)}</button>`
            ).join('')}
          </div>
        </div>`;
    } else {
      html += `<div class="sk-waiting-msg">⏳ <strong>${esc(s.currentDrawer)}</strong> is choosing a word...</div>`;
    }

    html += skribblScoreboardHTML(s, players);
    html += '</div>';
    wrap.innerHTML = html;

    if (amDrawer) {
      wrap.querySelectorAll('[data-word]').forEach(b =>
        b.addEventListener('click', () => skribblPickWord(b.dataset.word)));
    }
  }

  async function skribblPickWord(word) {
    const me = getPlayerName();
    const s = JSON.parse(JSON.stringify(currentRoom.state));
    if (s.currentDrawer !== me || s.phase !== 'choosing') return;

    s.currentWord  = word;
    s.revealedWord = word.split('').map(c => c === ' ' ? ' ' : '_').join(' ');
    s.hintsRevealed = 0;
    s.roundEndsAt = Date.now() + s.config.drawTime * 1000;
    s.phase = 'drawing';
    s.chatLog = [{ name: 'system', msg: `${me} is drawing!`, type: 'system' }];
    await pushState(s);
    // Subscribe to draw broadcasts for stroke sync (drawer broadcasts, others receive)
    skribblSubscribeStrokes();
  }

  // ---------- Drawing phase ----------
  let skTimerInterval = null;
  let skRevealInterval = null;

  function renderSkribblDrawing(wrap, s) {
    const me = getPlayerName();
    const amDrawer = s.currentDrawer === me;
    const haveGuessed = s.guessers.includes(me);
    const players = currentRoom.players || [];

    const wordDisplay = amDrawer
      ? s.currentWord
      : (haveGuessed ? s.currentWord : s.revealedWord);

    let html = `
      <div class="sk-table">
        ${skribblHeaderHTML(s)}
        <div class="sk-word-row">
          <span class="sk-word-label">${amDrawer ? '🖌️ Draw:' : (haveGuessed ? '✅ Word:' : 'Guess:')}</span>
          <span class="sk-word">${esc(wordDisplay || '')}</span>
          <span class="sk-word-len">(${(s.currentWord || '').length} letters)</span>
        </div>
        <div class="sk-timer" id="sk-timer">--</div>
        <div class="sk-canvas-wrap"><canvas id="sk-canvas" class="draw-canvas" width="900" height="600"></canvas></div>`;

    // Drawer toolbar
    if (amDrawer) {
      const colors = ['#000000','#ffffff','#ff0000','#ff8800','#fff700','#39ff14','#00ffff','#0088ff','#9d4edd','#ff1493','#8b4513','#888888'];
      const sizes  = [3, 6, 12, 24];
      html += `
        <div class="draw-toolbar sk-toolbar">
          <div class="draw-tools">
            <button class="draw-tool ${myTool === 'brush' ? 'active' : ''}" data-tool="brush">🖌️</button>
            <button class="draw-tool ${myTool === 'eraser' ? 'active' : ''}" data-tool="eraser">🧼</button>
          </div>
          <div class="draw-colors">
            ${colors.map(c => `<button class="draw-color ${c === myStrokeColor ? 'active' : ''}" data-c="${c}" style="background:${c};"></button>`).join('')}
          </div>
          <div class="draw-sizes">
            ${sizes.map(sz => `<button class="draw-size ${sz === myStrokeSize ? 'active' : ''}" data-s="${sz}"><span style="width:${sz}px;height:${sz}px;background:${myTool === 'eraser' ? '#888' : myStrokeColor};border-radius:50%;display:inline-block;"></span></button>`).join('')}
          </div>
          <button class="draw-clear" id="sk-clear-btn">🧽 CLEAR</button>
        </div>`;
    }

    // Chat / guesses
    html += `
      <div class="sk-chat">
        <div class="sk-chat-log" id="sk-chat-log">
          ${s.chatLog.map(c => skribblChatLineHTML(c)).join('')}
        </div>
        ${(amDrawer || haveGuessed)
          ? `<div class="sk-chat-disabled">${amDrawer ? '🖌️ You are drawing — chat is hidden.' : '✅ You guessed it! Wait for others.'}</div>`
          : `<div class="sk-chat-input-row">
              <input type="text" id="sk-chat-input" placeholder="Type yer guess..." maxlength="60" autocomplete="off">
              <button class="pk-btn start" id="sk-chat-send">SEND</button>
            </div>`}
      </div>`;

    html += skribblScoreboardHTML(s, players);
    html += '</div>';
    wrap.innerHTML = html;

    // Set up canvas
    skribblInitCanvas(s, amDrawer);

    // Wire up drawer tools
    if (amDrawer) {
      wrap.querySelectorAll('.draw-tool').forEach(b => b.addEventListener('click', () => {
        myTool = b.dataset.tool;
        wrap.querySelectorAll('.draw-tool').forEach(x => x.classList.toggle('active', x.dataset.tool === myTool));
        wrap.querySelectorAll('.draw-size span').forEach(s => s.style.background = myTool === 'eraser' ? '#888' : myStrokeColor);
      }));
      wrap.querySelectorAll('.draw-color').forEach(b => b.addEventListener('click', () => {
        myStrokeColor = b.dataset.c; myTool = 'brush';
        wrap.querySelectorAll('.draw-color').forEach(x => x.classList.toggle('active', x.dataset.c === myStrokeColor));
        wrap.querySelectorAll('.draw-tool').forEach(x => x.classList.toggle('active', x.dataset.tool === 'brush'));
        wrap.querySelectorAll('.draw-size span').forEach(s => s.style.background = myStrokeColor);
      }));
      wrap.querySelectorAll('.draw-size').forEach(b => b.addEventListener('click', () => {
        myStrokeSize = parseInt(b.dataset.s, 10);
        wrap.querySelectorAll('.draw-size').forEach(x => x.classList.toggle('active', parseInt(x.dataset.s, 10) === myStrokeSize));
      }));
      const clearBtn = $('sk-clear-btn');
      if (clearBtn) clearBtn.addEventListener('click', skribblClearCanvas);
    }

    // Wire up chat
    if (!amDrawer && !haveGuessed) {
      const sendBtn = $('sk-chat-send');
      const input = $('sk-chat-input');
      const send = () => {
        const txt = (input.value || '').trim();
        if (txt) skribblSubmitGuess(txt);
        input.value = '';
      };
      if (sendBtn) sendBtn.addEventListener('click', send);
      if (input) {
        input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
        input.focus();
      }
    }

    // Auto-scroll chat
    const chatLog = $('sk-chat-log');
    if (chatLog) chatLog.scrollTop = chatLog.scrollHeight;

    // Start timer + reveal logic (host only, to avoid duplicate updates)
    skribblStartTimers(s);
  }

  function skribblHeaderHTML(s) {
    return `
      <div class="sk-header">
        <span class="sk-round">Round ${Math.floor(s.drawerIdx / (currentRoom.players?.length || 1)) + 1}/${s.config.rounds}</span>
        <span class="sk-drawer">🖌️ ${esc(s.currentDrawer || '')}</span>
        <span class="sk-progress">${s.drawerIdx + 1} / ${s.totalRounds}</span>
      </div>`;
  }

  function skribblScoreboardHTML(s, players) {
    const sorted = players.slice().sort((a, b) => (s.scores[b.name] || 0) - (s.scores[a.name] || 0));
    return `<div class="sk-scoreboard">
      ${sorted.map(p => {
        const isDrawer = s.currentDrawer === p.name;
        const hasGuessed = s.guessers.includes(p.name);
        return `<div class="sk-score-pill ${isDrawer ? 'drawer' : ''} ${hasGuessed ? 'guessed' : ''}">
          ${isDrawer ? '🖌️' : (hasGuessed ? '✅' : '🏴‍☠️')} ${esc(p.name)}: <strong>${s.scores[p.name] || 0}</strong>
        </div>`;
      }).join('')}
    </div>`;
  }

  function skribblChatLineHTML(c) {
    if (c.type === 'system')     return `<div class="sk-chat-line system">${esc(c.msg)}</div>`;
    if (c.type === 'correct')    return `<div class="sk-chat-line correct">✅ <strong>${esc(c.name)}</strong> guessed the word!</div>`;
    if (c.type === 'closeguess') return `<div class="sk-chat-line close"><strong>${esc(c.name)}</strong>: ${esc(c.msg)} <span class="sk-close-tag">CLOSE!</span></div>`;
    return `<div class="sk-chat-line"><strong>${esc(c.name)}</strong>: ${esc(c.msg)}</div>`;
  }

  // ---------- Skribbl canvas ----------
  let skCanvas = null, skCtx = null;
  let skDrawing = false;
  let skLastPt = null;
  let skHistory = [];
  let skDrawChannel = null;

  function skribblInitCanvas(s, amDrawer) {
    skCanvas = $('sk-canvas');
    if (!skCanvas) return;
    skCtx = skCanvas.getContext('2d');
    skribblFitCanvas();
    window.addEventListener('resize', skribblFitCanvas);

    // Re-paint stroke history (kept across re-renders within same round)
    skHistory.forEach(stroke => skribblPaintStroke(stroke, false));

    if (amDrawer) {
      skCanvas.addEventListener('pointerdown', skribblPointerDown);
      skCanvas.addEventListener('pointermove', skribblPointerMove);
      skCanvas.addEventListener('pointerup', skribblPointerUp);
      skCanvas.addEventListener('pointercancel', skribblPointerUp);
      skCanvas.addEventListener('pointerleave', skribblPointerUp);
      skCanvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
      skCanvas.addEventListener('touchmove',  e => e.preventDefault(), { passive: false });
    }
  }

  function skribblFitCanvas() {
    if (!skCanvas) return;
    const cssW = Math.min(900, skCanvas.parentElement.clientWidth - 8);
    const cssH = Math.round(cssW * 0.66);
    const dpr  = window.devicePixelRatio || 1;
    skCanvas.style.width  = cssW + 'px';
    skCanvas.style.height = cssH + 'px';
    skCanvas.width  = Math.floor(cssW * dpr);
    skCanvas.height = Math.floor(cssH * dpr);
    skCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    skCtx.lineCap = 'round'; skCtx.lineJoin = 'round';
    skCtx.fillStyle = '#ffffff';
    skCtx.fillRect(0, 0, cssW, cssH);
    skHistory.forEach(stroke => skribblPaintStroke(stroke, false));
  }

  function skribblNormPoint(e) {
    const r = skCanvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }
  function skribblPointerDown(e) {
    skDrawing = true;
    skCanvas.setPointerCapture && skCanvas.setPointerCapture(e.pointerId);
    skLastPt = skribblNormPoint(e);
  }
  function skribblPointerMove(e) {
    if (!skDrawing) return;
    const pt = skribblNormPoint(e);
    const useColor = (myTool === 'eraser') ? '#ffffff' : myStrokeColor;
    const useSize = (myTool === 'eraser') ? myStrokeSize * 1.5 : myStrokeSize;
    const stroke = { from: skLastPt, to: pt, c: useColor, s: useSize };
    skribblPaintStroke(stroke, true);
    skLastPt = pt;
    if (skDrawChannel) skDrawChannel.send({ type: 'broadcast', event: 'sk-stroke', payload: stroke });
  }
  function skribblPointerUp() { skDrawing = false; skLastPt = null; }

  function skribblPaintStroke(stroke, addToHistory) {
    if (!skCtx || !skCanvas) return;
    const r = skCanvas.getBoundingClientRect();
    skCtx.strokeStyle = stroke.c;
    skCtx.lineWidth   = stroke.s;
    skCtx.beginPath();
    skCtx.moveTo(stroke.from.x * r.width, stroke.from.y * r.height);
    skCtx.lineTo(stroke.to.x * r.width, stroke.to.y * r.height);
    skCtx.stroke();
    if (addToHistory) skHistory.push(stroke);
  }

  function skribblClearCanvas() {
    skHistory = [];
    if (skCtx && skCanvas) {
      const r = skCanvas.getBoundingClientRect();
      skCtx.fillStyle = '#ffffff';
      skCtx.fillRect(0, 0, r.width, r.height);
    }
    if (skDrawChannel) skDrawChannel.send({ type: 'broadcast', event: 'sk-clear', payload: {} });
  }

  function skribblSubscribeStrokes() {
    if (skDrawChannel) { SUPA().removeChannel(skDrawChannel); skDrawChannel = null; }
    skHistory = [];
    skDrawChannel = SUPA()
      .channel('sk-draw-' + currentRoomId, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'sk-stroke' }, payload => {
        const stroke = payload.payload;
        if (!stroke || !stroke.from || !stroke.to) return;
        skribblPaintStroke(stroke, true);
      })
      .on('broadcast', { event: 'sk-clear' }, () => {
        skHistory = [];
        if (skCtx && skCanvas) {
          const r = skCanvas.getBoundingClientRect();
          skCtx.fillStyle = '#ffffff';
          skCtx.fillRect(0, 0, r.width, r.height);
        }
      })
      .subscribe();
  }

  function skribblCleanupCanvas() {
    if (skDrawChannel) { SUPA().removeChannel(skDrawChannel); skDrawChannel = null; }
    skHistory = [];
    skDrawing = false;
    skLastPt = null;
  }

  // ---------- Timer + progressive reveal ----------
  function skribblStartTimers(s) {
    if (skTimerInterval) clearInterval(skTimerInterval);
    if (skRevealInterval) clearInterval(skRevealInterval);
    if (s.phase !== 'drawing') return;

    skTimerInterval = setInterval(() => {
      const room = currentRoom;
      if (!room || !room.state || room.state.phase !== 'drawing') {
        clearInterval(skTimerInterval); skTimerInterval = null;
        return;
      }
      const remaining = Math.max(0, Math.ceil((room.state.roundEndsAt - Date.now()) / 1000));
      const timerEl = $('sk-timer');
      if (timerEl) timerEl.textContent = remaining + 's';
      // Host triggers round-end
      if (remaining <= 0 && currentRoom.host_name === getPlayerName()) {
        skribblEndRound('time');
      }
    }, 250);

    // Progressive letter reveal — host only manages this
    if (currentRoom.host_name === getPlayerName()) {
      skRevealInterval = setInterval(() => skribblMaybeReveal(), 1000);
    }
  }

  async function skribblMaybeReveal() {
    const s = currentRoom?.state;
    if (!s || s.phase !== 'drawing' || !s.currentWord) return;
    const total = s.config.drawTime * 1000;
    const elapsed = total - (s.roundEndsAt - Date.now());
    // Reveal at: 50%, 70%, 85% of round duration
    const targets = [0.5, 0.7, 0.85];
    const wantHints = targets.filter(t => elapsed > total * t).length;
    if (wantHints > s.hintsRevealed) {
      // Reveal one more letter
      const letters = s.currentWord.split('');
      const indices = letters.map((c, i) => c === ' ' ? -1 : i).filter(i => i >= 0);
      const revealed = s.revealedWord.split(' ');
      // Find still-hidden indices
      const hidden = indices.filter(i => revealed[i] === '_');
      if (hidden.length > 0) {
        const pickIdx = hidden[Math.floor(Math.random() * hidden.length)];
        revealed[pickIdx] = letters[pickIdx].toUpperCase();
        const ns = JSON.parse(JSON.stringify(s));
        ns.revealedWord = revealed.join(' ');
        ns.hintsRevealed = wantHints;
        await pushState(ns);
      }
    }
  }

  // ---------- Guessing ----------
  async function skribblSubmitGuess(text) {
    const me = getPlayerName();
    const s = JSON.parse(JSON.stringify(currentRoom.state));
    if (s.phase !== 'drawing') return;
    if (s.currentDrawer === me) return;
    if (s.guessers.includes(me)) return;

    const guess  = text.trim().toLowerCase();
    const target = (s.currentWord || '').toLowerCase();

    if (guess === target) {
      // Correct!
      s.guessers.push(me);
      // Score: faster guessers earn more. Base = 100, scaled by remaining time.
      const total = s.config.drawTime * 1000;
      const remaining = Math.max(0, s.roundEndsAt - Date.now());
      const timeBonus = Math.floor(100 * (remaining / total));
      const orderBonus = Math.max(0, 50 - s.guessers.length * 10);   // 1st: +50, 2nd: +40, ...
      const earned = 100 + timeBonus + orderBonus;
      s.scores[me] = (s.scores[me] || 0) + earned;
      s.roundScores[me] = earned;
      // Drawer also scores when someone guesses (smaller, capped)
      const drawerEarn = 25;
      s.scores[s.currentDrawer] = (s.scores[s.currentDrawer] || 0) + drawerEarn;
      s.roundScores[s.currentDrawer] = (s.roundScores[s.currentDrawer] || 0) + drawerEarn;
      s.chatLog.push({ name: me, msg: '', type: 'correct' });

      // If everyone has guessed → end round
      const players = currentRoom.players || [];
      const nonDrawers = players.filter(p => p.name !== s.currentDrawer);
      if (s.guessers.length >= nonDrawers.length) {
        await pushState(s);
        // Host transitions to roundend
        if (currentRoom.host_name === me) skribblEndRound('all-guessed');
        return;
      }
    } else {
      // Incorrect: check for "close" (1 character off)
      const isClose = skribblIsClose(guess, target);
      s.chatLog.push({ name: me, msg: text, type: isClose ? 'closeguess' : 'guess' });
    }
    await pushState(s);
  }

  function skribblIsClose(a, b) {
    if (Math.abs(a.length - b.length) > 2) return false;
    // Levenshtein distance ≤ 2
    const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i++) dp[i][0] = i;
    for (let j = 0; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        if (a[i-1] === b[j-1]) dp[i][j] = dp[i-1][j-1];
        else dp[i][j] = 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
      }
    }
    return dp[a.length][b.length] <= 2 && a.length >= 3;
  }

  async function skribblEndRound(reason) {
    const s = JSON.parse(JSON.stringify(currentRoom.state));
    if (s.phase !== 'drawing') return;
    s.phase = 'roundend';
    s.endReason = reason;
    if (skTimerInterval) { clearInterval(skTimerInterval); skTimerInterval = null; }
    if (skRevealInterval) { clearInterval(skRevealInterval); skRevealInterval = null; }
    skribblCleanupCanvas();
    await pushState(s);
  }

  function renderSkribblRoundEnd(wrap, s) {
    const me = getPlayerName();
    const isHost = currentRoom.host_name === me;
    const players = currentRoom.players || [];
    skribblCleanupCanvas();

    const reasonText = s.endReason === 'all-guessed' ? 'Everyone guessed it!' : "Time's up!";
    const sorted = players.slice().sort((a, b) => (s.scores[b.name] || 0) - (s.scores[a.name] || 0));

    wrap.innerHTML = `
      <div class="sk-roundend">
        <h3 class="sk-roundend-title">⏰ ${reasonText}</h3>
        <div class="sk-reveal">The word was: <strong>${esc(s.currentWord || '')}</strong></div>
        <div class="sk-roundscore">
          ${players.map(p => {
            const earned = s.roundScores[p.name] || 0;
            return `<div class="sk-roundscore-row">
              <span>🏴‍☠️ ${esc(p.name)}${p.name === s.currentDrawer ? ' 🖌️' : ''}</span>
              <span>+${earned}</span>
            </div>`;
          }).join('')}
        </div>
        <div class="sk-totalscores">
          <div class="sk-totalscores-title">📊 Total Scores</div>
          ${sorted.map((p, i) => `
            <div class="cm-final-row">
              <span>#${i + 1} ${esc(p.name)}</span>
              <span>${s.scores[p.name] || 0}</span>
            </div>`).join('')}
        </div>
        ${isHost
          ? `<button class="pk-btn start" id="sk-next-btn">${(s.drawerIdx + 1 >= s.totalRounds) ? '🏆 SHOW FINAL SCORES' : '➡️ NEXT TURN'}</button>`
          : `<div class="cm-waiting">⏳ Waiting for host...</div>`}
      </div>`;

    const btn = $('sk-next-btn');
    if (btn) btn.addEventListener('click', async () => {
      const ns = JSON.parse(JSON.stringify(currentRoom.state));
      ns.drawerIdx++;
      skribblNextDrawer(ns);
      await pushState(ns);
    });
  }

  function renderSkribblFinished(wrap, s) {
    const me = getPlayerName();
    const isHost = currentRoom.host_name === me;
    const players = currentRoom.players || [];
    const sorted = players.slice().sort((a, b) => (s.scores[b.name] || 0) - (s.scores[a.name] || 0));
    const winner = sorted[0];

    wrap.innerHTML = `
      <div class="cm-finished">
        <h3 class="cm-finished-title">🏆 SKRIBBL OVER 🏆</h3>
        <div class="cm-winner-name">🥇 <strong>${esc(winner.name)}</strong> wins with ${s.scores[winner.name] || 0} pts!</div>
        <div class="cm-final-scores">
          ${sorted.map((p, i) => `
            <div class="cm-final-row">
              <span>#${i + 1} ${esc(p.name)}</span>
              <span>${s.scores[p.name] || 0} pts</span>
            </div>`).join('')}
        </div>
        ${isHost ? `<button class="pk-btn restart" id="sk-restart-btn">🔁 PLAY AGAIN</button>` : ''}
      </div>`;
    const btn = $('sk-restart-btn');
    if (btn) btn.addEventListener('click', async () => {
      await pushState(GAMES.skribbl.initialState());
    });
  }

  // =================================================================
  // DRAWING ROOM
  // =================================================================
  let drawCanvas = null, drawCtx = null;
  let drawing = false;
  let lastPt = null;
  let myStrokeColor = '#39ff14';
  let myStrokeSize  = 4;
  let myTool        = 'brush';            // 'brush' | 'eraser'
  const DRAW_BG     = '#0d0d2b';          // matches canvas background; eraser paints with this
  // Buffer of strokes received while we were rendering
  let drawHistory = [];

  function renderDrawRoom(wrap) {
    const colors = ['#39ff14','#ff1493','#00ffff','#fff700','#ff6ec7','#ffffff','#ff8800','#9d4edd','#ff0000','#0088ff','#000000'];
    const sizes  = [2, 4, 8, 16, 28];
    wrap.innerHTML = `
      <div class="draw-toolbar">
        <div class="draw-tools">
          <button class="draw-tool ${myTool === 'brush'  ? 'active' : ''}" data-tool="brush">🖌️ BRUSH</button>
          <button class="draw-tool ${myTool === 'eraser' ? 'active' : ''}" data-tool="eraser">🧼 ERASER</button>
        </div>
        <div class="draw-colors">
          ${colors.map(c => `<button class="draw-color ${c === myStrokeColor ? 'active' : ''}" data-c="${c}" style="background:${c};"></button>`).join('')}
        </div>
        <div class="draw-sizes">
          ${sizes.map(s => `<button class="draw-size ${s === myStrokeSize ? 'active' : ''}" data-s="${s}"><span style="width:${s*1.5}px;height:${s*1.5}px;background:${myTool === 'eraser' ? '#888' : myStrokeColor};border-radius:50%;display:inline-block;"></span></button>`).join('')}
        </div>
        <button class="draw-clear" id="draw-clear-btn">🧽 CLEAR ALL</button>
      </div>
      <canvas id="draw-canvas" class="draw-canvas" width="1200" height="800"></canvas>
      <div class="draw-hint">Tip: pinch-zoom is disabled while drawing. Pick a tool, color, and size first.</div>`;

    drawCanvas = $('draw-canvas');
    drawCtx    = drawCanvas.getContext('2d');
    fitDrawCanvas();
    window.addEventListener('resize', fitDrawCanvas);

    // Restore any past strokes from buffer
    drawHistory.forEach(s => paintStroke(s, false));

    // Tool toggle (brush / eraser)
    wrap.querySelectorAll('.draw-tool').forEach(b => b.addEventListener('click', () => {
      myTool = b.dataset.tool;
      wrap.querySelectorAll('.draw-tool').forEach(x => x.classList.toggle('active', x.dataset.tool === myTool));
      // Update size dot color preview based on current tool
      wrap.querySelectorAll('.draw-size span').forEach(s =>
        s.style.background = myTool === 'eraser' ? '#888' : myStrokeColor);
    }));

    // Tools
    wrap.querySelectorAll('.draw-color').forEach(b => b.addEventListener('click', () => {
      myStrokeColor = b.dataset.c;
      // Picking a color implicitly switches you to brush mode
      myTool = 'brush';
      wrap.querySelectorAll('.draw-tool').forEach(x => x.classList.toggle('active', x.dataset.tool === 'brush'));
      wrap.querySelectorAll('.draw-color').forEach(x => x.classList.toggle('active', x.dataset.c === myStrokeColor));
      wrap.querySelectorAll('.draw-size span').forEach(s => s.style.background = myStrokeColor);
    }));
    wrap.querySelectorAll('.draw-size').forEach(b => b.addEventListener('click', () => {
      myStrokeSize = parseInt(b.dataset.s, 10);
      wrap.querySelectorAll('.draw-size').forEach(x => x.classList.toggle('active', parseInt(x.dataset.s, 10) === myStrokeSize));
    }));
    $('draw-clear-btn').addEventListener('click', clearDrawCanvas);

    // Pointer events (works for mouse + touch)
    drawCanvas.addEventListener('pointerdown', dPointerDown);
    drawCanvas.addEventListener('pointermove', dPointerMove);
    drawCanvas.addEventListener('pointerup',   dPointerUp);
    drawCanvas.addEventListener('pointercancel', dPointerUp);
    drawCanvas.addEventListener('pointerleave', dPointerUp);
    // Prevent scrolling while drawing
    drawCanvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
    drawCanvas.addEventListener('touchmove',  e => e.preventDefault(), { passive: false });
  }

  function fitDrawCanvas() {
    if (!drawCanvas) return;
    const cssW = Math.min(1200, drawCanvas.parentElement.clientWidth - 8);
    const cssH = Math.round(cssW * 0.7);                    // taller, ~10:7 aspect
    const dpr  = window.devicePixelRatio || 1;
    drawCanvas.style.width  = cssW + 'px';
    drawCanvas.style.height = cssH + 'px';
    drawCanvas.width  = Math.floor(cssW * dpr);
    drawCanvas.height = Math.floor(cssH * dpr);
    drawCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawCtx.lineCap = 'round';
    drawCtx.lineJoin = 'round';
    // Re-paint history at new size (we use absolute coords 0..1)
    drawCtx.fillStyle = DRAW_BG;
    drawCtx.fillRect(0, 0, cssW, cssH);
    drawHistory.forEach(s => paintStroke(s, false));
  }

  function getNormPoint(e) {
    const r = drawCanvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }

  function dPointerDown(e) {
    if (myRole !== 'player') return;                         // only players draw
    drawing = true;
    drawCanvas.setPointerCapture && drawCanvas.setPointerCapture(e.pointerId);
    lastPt = getNormPoint(e);
  }
  function dPointerMove(e) {
    if (!drawing) return;
    const pt = getNormPoint(e);
    // Eraser paints with the background color, slightly bigger for a nicer feel
    const useColor = (myTool === 'eraser') ? DRAW_BG : myStrokeColor;
    const useSize  = (myTool === 'eraser') ? myStrokeSize * 1.5 : myStrokeSize;
    const stroke = { from: lastPt, to: pt, c: useColor, s: useSize };
    paintStroke(stroke, true);
    lastPt = pt;
    if (drawChannel) drawChannel.send({ type: 'broadcast', event: 'stroke', payload: stroke });
  }
  function dPointerUp() { drawing = false; lastPt = null; }

  function paintStroke(stroke, addToHistory) {
    if (!drawCtx) return;
    const r = drawCanvas.getBoundingClientRect();
    drawCtx.strokeStyle = stroke.c;
    drawCtx.lineWidth   = stroke.s;
    drawCtx.beginPath();
    drawCtx.moveTo(stroke.from.x * r.width, stroke.from.y * r.height);
    drawCtx.lineTo(stroke.to.x   * r.width, stroke.to.y   * r.height);
    drawCtx.stroke();
    if (addToHistory) drawHistory.push(stroke);
  }

  function clearDrawCanvas() {
    if (myRole !== 'player') return;
    drawHistory = [];
    if (drawCtx && drawCanvas) {
      const r = drawCanvas.getBoundingClientRect();
      drawCtx.fillStyle = DRAW_BG;
      drawCtx.fillRect(0, 0, r.width, r.height);
    }
    if (drawChannel) drawChannel.send({ type: 'broadcast', event: 'clear', payload: {} });
  }

  function subscribeDrawBroadcast() {
    if (drawChannel) { SUPA().removeChannel(drawChannel); drawChannel = null; }
    drawHistory = [];
    drawChannel = SUPA()
      .channel('draw-' + currentRoomId, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'stroke' }, payload => {
        const s = payload.payload;
        if (!s || !s.from || !s.to) return;
        paintStroke(s, true);
      })
      .on('broadcast', { event: 'clear' }, () => {
        drawHistory = [];
        if (drawCtx && drawCanvas) {
          const r = drawCanvas.getBoundingClientRect();
          drawCtx.fillStyle = DRAW_BG;
          drawCtx.fillRect(0, 0, r.width, r.height);
        }
      })
      .subscribe();
  }

  // =================================================================
  // SHARED HELPERS
  // =================================================================
  async function pushState(state, status) {
    if (!SUPA() || !currentRoomId) return;
    // Optimistic local update: render the new state instantly so the player
    // doesn't have to wait for the DB roundtrip + realtime echo.
    if (currentRoom) {
      currentRoom.state = state;
      if (status) currentRoom.status = status;
      renderGameContent();
    }
    const update = { state };
    if (status) update.status = status;
    if (state.winner !== undefined && state.winner !== null) {
      update.last_winner = state.winner === 'draw' ? 'draw' : (currentRoom.players.find(p => p.slot === state.winner)?.name || null);
    }
    const { error } = await SUPA().from('game_rooms').update(update).eq('id', currentRoomId);
    if (error) console.error('pushState error:', error);
  }

  async function resetGame() {
    if (!currentRoom) return;
    const g = GAMES[currentGameType];
    await SUPA().from('game_rooms').update({
      state:  g.initialState(),
      status: 'playing',
    }).eq('id', currentRoomId);
  }

  function winnerLabel(s) {
    if (s.winner === 'draw') return '🤝 DRAW!';
    const winnerName = currentRoom.players.find(p => p.slot === s.winner)?.name || ('Player ' + (s.winner + 1));
    return `🏆 ${slotName(s.winner)} wins! (${esc(winnerName)})`;
  }

  // =================================================================
  // TAB ENTRY HOOK
  // =================================================================
  // Called by switchTab when user clicks Games tab
  window.gamesOnTabEnter = function () {
    if (view === 'picker') renderPicker();
    // If we're in lobby/room, stay there.
  };

  // Init when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { renderPicker(); showView('picker'); });
  } else {
    renderPicker(); showView('picker');
  }
})();
