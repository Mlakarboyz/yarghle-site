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

  const SUPA = () => window.supabaseClient;

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

  // ============ GAME REGISTRY ============
  const GAMES = {
    tictactoe: {
      name: 'Tic-Tac-Toe',
      emoji: '❌⭕',
      blurb: 'Classic 3-in-a-row. Quick games while ye wait for grog.',
      color: '#fff700',                                  // neon yellow
      maxPlayers: 2,
      initialState: () => ({ board: Array(9).fill(null), turn: 0, winner: null }),
    },
    connect4: {
      name: 'Connect 4',
      emoji: '🔴🟡',
      blurb: '7×6 grid. Drop discs, get four in a row.',
      color: '#ff1493',                                  // neon pink
      maxPlayers: 2,
      initialState: () => ({ board: Array(42).fill(null), turn: 0, winner: null }),
    },
    checkers: {
      name: 'Checkers',
      emoji: '⚫🔴',
      blurb: '8×8 board. Force jumps. Crown yer pieces.',
      color: '#39ff14',                                  // neon green
      maxPlayers: 2,
      initialState: () => ({ board: initCheckersBoard(), turn: 0, winner: null, mustJumpFrom: null }),
    },
    chess: {
      name: 'Chess',
      emoji: '♟️',
      blurb: '2 players. Capture the king. Spectators welcome.',
      color: '#00ffff',                                  // neon cyan
      maxPlayers: 2,
      initialState: () => ({ fen: 'start', lastMove: null, winner: null }),
    },
    draw: {
      name: 'Drawing Room',
      emoji: '🎨',
      blurb: 'Up to 6 drawers on a shared canvas. Like PictoChat.',
      color: '#ff6ec7',
      maxPlayers: 6,
      initialState: () => ({ chat: [] }),
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

    wrap.innerHTML = nameLine + '<div class="games-grid">' +
      Object.entries(GAMES).map(([key, g]) => `
        <button class="game-card" data-game="${key}" style="border-color:${g.color};">
          <span class="game-emoji">${g.emoji}</span>
          <span class="game-name" style="color:${g.color};">${esc(g.name)}</span>
          <span class="game-blurb">${esc(g.blurb)}</span>
          <span class="game-cta" style="background:${g.color};">ENTER LOBBY →</span>
        </button>
      `).join('') + '</div>';

    wrap.querySelectorAll('.game-card').forEach(btn => {
      btn.addEventListener('click', () => enterLobby(btn.dataset.game));
    });
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

    // Auto-start when full (board games)
    let newStatus = room.status;
    if (newStatus === 'waiting' && players.length >= room.max_players && currentGameType !== 'draw') {
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
  // DRAWING ROOM
  // =================================================================
  let drawCanvas = null, drawCtx = null;
  let drawing = false;
  let lastPt = null;
  let myStrokeColor = '#39ff14';
  let myStrokeSize  = 4;
  // Buffer of strokes received while we were rendering
  let drawHistory = [];

  function renderDrawRoom(wrap) {
    const colors = ['#39ff14','#ff1493','#00ffff','#fff700','#ff6ec7','#ffffff','#ff8800','#9d4edd','#000000'];
    const sizes  = [2, 4, 8, 16];
    wrap.innerHTML = `
      <div class="draw-toolbar">
        <div class="draw-colors">
          ${colors.map(c => `<button class="draw-color ${c === myStrokeColor ? 'active' : ''}" data-c="${c}" style="background:${c};"></button>`).join('')}
        </div>
        <div class="draw-sizes">
          ${sizes.map(s => `<button class="draw-size ${s === myStrokeSize ? 'active' : ''}" data-s="${s}"><span style="width:${s*1.5}px;height:${s*1.5}px;background:${myStrokeColor};border-radius:50%;display:inline-block;"></span></button>`).join('')}
        </div>
        <button class="draw-clear" id="draw-clear-btn">🧽 CLEAR ALL</button>
      </div>
      <canvas id="draw-canvas" class="draw-canvas" width="800" height="500"></canvas>
      <div class="draw-hint">Tip: pinch-zoom is disabled while drawing. Tap a color/size first.</div>`;

    drawCanvas = $('draw-canvas');
    drawCtx    = drawCanvas.getContext('2d');
    fitDrawCanvas();
    window.addEventListener('resize', fitDrawCanvas);

    // Restore any past strokes from buffer
    drawHistory.forEach(s => paintStroke(s, false));

    // Tools
    wrap.querySelectorAll('.draw-color').forEach(b => b.addEventListener('click', () => {
      myStrokeColor = b.dataset.c;
      wrap.querySelectorAll('.draw-color').forEach(x => x.classList.toggle('active', x.dataset.c === myStrokeColor));
      // re-render size dots with new color
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
    const cssW = Math.min(800, drawCanvas.parentElement.clientWidth - 8);
    const cssH = Math.round(cssW * 0.625);                  // ~5:8 aspect
    const dpr  = window.devicePixelRatio || 1;
    drawCanvas.style.width  = cssW + 'px';
    drawCanvas.style.height = cssH + 'px';
    drawCanvas.width  = Math.floor(cssW * dpr);
    drawCanvas.height = Math.floor(cssH * dpr);
    drawCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawCtx.lineCap = 'round';
    drawCtx.lineJoin = 'round';
    // Re-paint history at new size (we use absolute coords 0..1)
    drawCtx.fillStyle = '#0d0d2b';
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
    const stroke = { from: lastPt, to: pt, c: myStrokeColor, s: myStrokeSize };
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
      drawCtx.fillStyle = '#0d0d2b';
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
          drawCtx.fillStyle = '#0d0d2b';
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
