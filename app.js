/* Game Dash V1 — Pega-Varetas */
(function ($) {
  'use strict';

  const STORAGE_KEY = 'gamedash_v1_data';
  const DATA_FILE = 'data.json';

  let state = {
    colors: [],
    players: [],
    currentMatch: null,
    history: []
  };

  let pendingRoundEdit = null;       // round id when editing existing
  let modalSourceLive = false;       // true when modal opened from live round (commit-on-save)
  let selectedPlayerIds = [];
  let confirmCallback = null;
  let dragSrcIdx = null;

  /* ---------- Persistence ---------- */

  function saveLocal() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }
  function loadLocal() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }
  function bootstrapState() {
    const local = loadLocal();
    if (local && Array.isArray(local.colors)) {
      state = normalizeState(local);
      renderAll();
      return;
    }
    $.getJSON(DATA_FILE)
      .done(d => { state = normalizeState(d); saveLocal(); renderAll(); })
      .fail(() => {
        state = normalizeState({});
        saveLocal();
        renderAll();
        toast('Não foi possível ler data.json. Iniciando vazio.', 'warning');
      });
  }
  function normalizeState(s) {
    const colors = (Array.isArray(s.colors) ? s.colors : []).map(c => ({
      id: c.id, name: c.name, hex: c.hex || '#888888', points: c.points
    }));
    const cm = s.currentMatch ? {
      ...s.currentMatch,
      currentPlayerIndex: typeof s.currentMatch.currentPlayerIndex === 'number' ? s.currentMatch.currentPlayerIndex : 0,
      liveRound: s.currentMatch.liveRound || null
    } : null;
    return {
      colors,
      players: Array.isArray(s.players) ? s.players : [],
      currentMatch: cm,
      history: Array.isArray(s.history) ? s.history : []
    };
  }

  /* ---------- Utils ---------- */

  function uid(p) { return p + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function getPlayer(id) { return state.players.find(p => p.id === id); }
  function getColor(id) { return state.colors.find(c => c.id === id); }
  function fmtDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }
  function swatch(hex, size) {
    const cls = size === 'sm' ? 'color-swatch-sm' : size === 'lg' ? 'color-swatch-lg' : 'color-swatch';
    return `<span class="${cls}" style="background-color:${escapeHtml(hex || '#888')}"></span>`;
  }
  function rankMedal(rank) {
    return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';
  }
  function posPill(rank) {
    const medal = rankMedal(rank);
    return `<span class="pos-pill rank-${rank}">${medal} ${rank}º</span>`;
  }
  function toast(msg, kind) {
    const $t = $('#app-toast');
    $t.removeClass('bg-dark bg-success bg-danger bg-warning text-dark text-white');
    if (kind === 'success') $t.addClass('bg-success text-white');
    else if (kind === 'danger') $t.addClass('bg-danger text-white');
    else if (kind === 'warning') $t.addClass('bg-warning text-dark');
    else $t.addClass('bg-dark text-white');
    $('#toast-body').text(msg);
    bootstrap.Toast.getOrCreateInstance($t[0], { delay: 2500 }).show();
  }
  function confirmDialog(title, body, okLabel, cb) {
    $('#confirm-title').text(title);
    $('#confirm-body').html(body);
    $('#btn-confirm-ok').text(okLabel || 'Confirmar');
    confirmCallback = cb;
    bootstrap.Modal.getOrCreateInstance($('#confirmModal')[0]).show();
  }

  /* ---------- Players ---------- */

  function renderPlayers() {
    const $list = $('#players-list').empty();
    $('#players-count').text(state.players.length);
    if (!state.players.length) {
      $list.append('<li class="list-group-item text-center text-muted py-4">Nenhum jogador cadastrado.</li>');
      return;
    }
    state.players.forEach(p => {
      const isInMatch = state.currentMatch && state.currentMatch.playerIds.includes(p.id);
      $list.append(`
        <li class="list-group-item d-flex align-items-center justify-content-between gap-2">
          <span class="player-pill"><span style="font-size:1.15rem">${escapeHtml(p.emoji || '🙂')}</span>${escapeHtml(p.name)}</span>
          <span class="d-flex gap-1">
            <button class="btn btn-sm btn-outline-secondary" data-action="edit-player" data-id="${p.id}">Editar</button>
            <button class="btn btn-sm btn-outline-danger" data-action="del-player" data-id="${p.id}" ${isInMatch ? 'disabled title="Em partida"' : ''}>×</button>
          </span>
        </li>
      `);
    });
  }

  $(document).on('submit', '#form-player', function (e) {
    e.preventDefault();
    const name = $('#player-name').val().trim();
    const emoji = $('#player-emoji').val().trim() || '🙂';
    if (!name) return;
    if (state.players.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      toast('Já existe um jogador com esse nome.', 'warning');
      return;
    }
    state.players.push({ id: uid('p'), name, emoji });
    saveLocal();
    $('#player-name').val('');
    $('#player-emoji').val('🙂');
    renderPlayers();
    renderStartMatchPlayers();
    toast('Jogador cadastrado.', 'success');
  });

  $(document).on('click', '[data-action="del-player"]', function () {
    const id = $(this).data('id');
    const p = getPlayer(id);
    if (!p) return;
    confirmDialog('Excluir jogador', `Remover <strong>${escapeHtml(p.name)}</strong>? Histórico anterior será mantido.`, 'Excluir', () => {
      state.players = state.players.filter(x => x.id !== id);
      saveLocal();
      renderPlayers();
      renderStartMatchPlayers();
      toast('Jogador removido.', 'success');
    });
  });

  $(document).on('click', '[data-action="edit-player"]', function () {
    const id = $(this).data('id');
    const p = getPlayer(id);
    if (!p) return;
    $('#edit-player-id').val(p.id);
    $('#edit-player-emoji').val(p.emoji || '🙂');
    $('#edit-player-name').val(p.name);
    bootstrap.Modal.getOrCreateInstance($('#playerEditModal')[0]).show();
  });

  $(document).on('click', '#btn-save-player-edit', function () {
    const id = $('#edit-player-id').val();
    const p = getPlayer(id);
    if (!p) return;
    const name = $('#edit-player-name').val().trim();
    const emoji = $('#edit-player-emoji').val().trim() || '🙂';
    if (!name) { toast('Nome é obrigatório.', 'warning'); return; }
    if (state.players.find(x => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) {
      toast('Já existe outro jogador com esse nome.', 'warning'); return;
    }
    p.name = name; p.emoji = emoji;
    saveLocal();
    bootstrap.Modal.getInstance($('#playerEditModal')[0]).hide();
    renderAll();
    toast('Jogador atualizado.', 'success');
  });

  /* ---------- Colors ---------- */

  function renderColors() {
    const $list = $('#colors-list').empty();
    $('#colors-count').text(state.colors.length);
    if (!state.colors.length) {
      $list.append('<li class="list-group-item text-center text-muted py-4">Nenhuma cor cadastrada.</li>');
      return;
    }
    state.colors.forEach(c => {
      $list.append(`
        <li class="list-group-item d-flex align-items-center justify-content-between gap-2">
          <span class="d-flex align-items-center gap-2">
            ${swatch(c.hex)}
            <strong>${escapeHtml(c.name)}</strong>
            <span class="badge bg-light text-dark border">${c.points} pts</span>
          </span>
          <span class="d-flex gap-1">
            <button class="btn btn-sm btn-outline-secondary" data-action="edit-color" data-id="${c.id}">Editar</button>
            <button class="btn btn-sm btn-outline-danger" data-action="del-color" data-id="${c.id}">×</button>
          </span>
        </li>
      `);
    });
  }

  $(document).on('submit', '#form-color', function (e) {
    e.preventDefault();
    const name = $('#color-name').val().trim();
    const hex = $('#color-hex').val() || '#888888';
    const points = parseInt($('#color-points').val(), 10);
    if (!name || isNaN(points) || points < 1) return;
    if (state.colors.some(c => c.name.toLowerCase() === name.toLowerCase())) {
      toast('Já existe uma cor com esse nome.', 'warning'); return;
    }
    state.colors.push({ id: uid('c'), name, hex, points });
    saveLocal();
    $('#color-name').val('');
    $('#color-hex').val('#8b5cf6');
    $('#color-points').val(10);
    renderColors();
    toast('Cor cadastrada.', 'success');
  });

  $(document).on('click', '[data-action="del-color"]', function () {
    const id = $(this).data('id');
    const c = getColor(id);
    if (!c) return;
    if (state.currentMatch) {
      const usedInRounds = state.currentMatch.rounds.some(r => Object.values(r.scores || {}).some(by => (by[id] || 0) > 0));
      const usedLive = state.currentMatch.liveRound && Object.values(state.currentMatch.liveRound.scores || {}).some(by => (by[id] || 0) > 0);
      if (usedInRounds || usedLive) { toast('Esta cor está em uso na partida atual.', 'warning'); return; }
    }
    confirmDialog('Excluir cor', `Remover <strong>${escapeHtml(c.name)}</strong>?`, 'Excluir', () => {
      state.colors = state.colors.filter(x => x.id !== id);
      saveLocal();
      renderColors();
      toast('Cor removida.', 'success');
    });
  });

  $(document).on('click', '[data-action="edit-color"]', function () {
    const id = $(this).data('id');
    const c = getColor(id);
    if (!c) return;
    $('#edit-color-id').val(c.id);
    $('#edit-color-hex').val(c.hex || '#888888');
    $('#edit-color-name').val(c.name);
    $('#edit-color-points').val(c.points);
    bootstrap.Modal.getOrCreateInstance($('#colorEditModal')[0]).show();
  });

  $(document).on('click', '#btn-save-color-edit', function () {
    const id = $('#edit-color-id').val();
    const c = getColor(id);
    if (!c) return;
    const name = $('#edit-color-name').val().trim();
    const hex = $('#edit-color-hex').val() || '#888888';
    const points = parseInt($('#edit-color-points').val(), 10);
    if (!name || isNaN(points) || points < 1) { toast('Preencha os campos corretamente.', 'warning'); return; }
    if (state.colors.find(x => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) {
      toast('Já existe outra cor com esse nome.', 'warning'); return;
    }
    c.name = name; c.hex = hex; c.points = points;
    saveLocal();
    bootstrap.Modal.getInstance($('#colorEditModal')[0]).hide();
    renderAll();
    toast('Cor atualizada.', 'success');
  });

  /* ---------- Match: start view ---------- */

  function renderStartMatchPlayers() {
    const $wrap = $('#start-match-players').empty();
    const $warn = $('#no-players-warning');
    const $btn = $('#btn-start-match');
    if (!state.players.length) {
      $warn.removeClass('d-none').text('Cadastre jogadores antes de iniciar uma partida.');
      $btn.prop('disabled', true);
      return;
    }
    if (!state.colors.length) {
      $warn.removeClass('d-none').text('Cadastre ao menos uma cor antes de iniciar uma partida.');
      $btn.prop('disabled', true);
    } else {
      $warn.addClass('d-none');
    }
    state.players.forEach(p => {
      const idx = selectedPlayerIds.indexOf(p.id);
      const sel = idx >= 0 ? 'selected' : '';
      const order = idx >= 0 ? `<span class="order-badge">${idx + 1}</span>` : '';
      $wrap.append(`
        <div class="col-6 col-sm-4 col-md-3">
          <div class="player-select-card ${sel}" data-id="${p.id}">
            ${order}
            <span class="emoji">${escapeHtml(p.emoji || '🙂')}</span>
            <div class="name">${escapeHtml(p.name)}</div>
          </div>
        </div>
      `);
    });
    if (state.colors.length) $btn.prop('disabled', selectedPlayerIds.length < 2);
  }

  $(document).on('click', '.player-select-card', function () {
    const id = $(this).data('id');
    if (selectedPlayerIds.includes(id)) selectedPlayerIds = selectedPlayerIds.filter(x => x !== id);
    else selectedPlayerIds.push(id);
    renderStartMatchPlayers();
  });

  $(document).on('click', '#btn-start-match', function () {
    if (selectedPlayerIds.length < 2) { toast('Selecione ao menos 2 jogadores.', 'warning'); return; }
    if (!state.colors.length) { toast('Cadastre ao menos uma cor antes de iniciar.', 'warning'); return; }
    state.currentMatch = {
      id: uid('m'),
      startedAt: new Date().toISOString(),
      playerIds: selectedPlayerIds.slice(),
      currentPlayerIndex: 0,
      liveRound: null,
      rounds: []
    };
    selectedPlayerIds = [];
    saveLocal();
    renderAll();
    toast('Partida iniciada.', 'success');
  });

  /* ---------- Score helpers ---------- */

  function calcScoresFromMap(scoresMap, playerId) {
    const by = (scoresMap || {})[playerId] || {};
    let total = 0;
    for (const cid in by) {
      const c = getColor(cid);
      if (c) total += (by[cid] || 0) * c.points;
    }
    return total;
  }
  function calcRoundScore(round, playerId) { return calcScoresFromMap(round.scores, playerId); }
  function calcMatchScores(match, includeLive) {
    const totals = {};
    match.playerIds.forEach(pid => { totals[pid] = 0; });
    (match.rounds || []).forEach(r => {
      match.playerIds.forEach(pid => { totals[pid] += calcRoundScore(r, pid); });
    });
    if (includeLive && match.liveRound) {
      match.playerIds.forEach(pid => { totals[pid] += calcScoresFromMap(match.liveRound.scores, pid); });
    }
    return totals;
  }
  function rankList(totals) {
    const arr = Object.keys(totals).map(pid => ({ pid, score: totals[pid] }));
    arr.sort((a, b) => b.score - a.score);
    let lastScore = null, lastRank = 0;
    arr.forEach((row, i) => {
      if (row.score === lastScore) row.rank = lastRank;
      else { row.rank = i + 1; lastRank = row.rank; lastScore = row.score; }
    });
    return arr;
  }

  /* ---------- Match: active view ---------- */

  function renderMatchView() {
    const m = state.currentMatch;
    if (!m) {
      $('#no-match-view').removeClass('d-none');
      $('#active-match-view').addClass('d-none');
      $('#match-status-badge').addClass('d-none');
      renderStartMatchPlayers();
      return;
    }
    $('#no-match-view').addClass('d-none');
    $('#active-match-view').removeClass('d-none');
    $('#match-status-badge').removeClass('d-none');
    $('#match-status-text').text(`${m.rounds.length} round${m.rounds.length !== 1 ? 's' : ''}` + (m.liveRound ? ' · ao vivo' : ''));
    $('#match-started').text(fmtDate(m.startedAt));

    renderActionBar(m);
    renderLivePanel(m);
    renderPlayOrder(m);
    renderLeaderboard(m);
    renderMatchRounds(m);
  }

  function renderActionBar(m) {
    const $bar = $('#match-action-bar').empty();
    if (m.liveRound) {
      $bar.append('<div class="alert alert-warning w-100 mb-0 py-2 small">Round em andamento — termine ou cancele para abrir outras opções.</div>');
      return;
    }
    $bar.append(`
      <button id="btn-start-round" class="btn btn-primary flex-grow-1">▶ Iniciar Round</button>
      <button id="btn-finish-match" class="btn btn-warning flex-grow-1">Finalizar Partida</button>
    `);
  }

  /* ----- Live panel ----- */

  function renderLivePanel(m) {
    const $p = $('#live-panel');
    if (!m.liveRound) { $p.addClass('d-none'); return; }
    $p.removeClass('d-none');

    const idx = m.currentPlayerIndex;
    const pid = m.playerIds[idx];
    const p = getPlayer(pid);
    const playerScore = calcScoresFromMap(m.liveRound.scores, pid);
    let total = 0;
    m.playerIds.forEach(x => total += calcScoresFromMap(m.liveRound.scores, x));

    $('#live-round-label').text(`Round ${m.rounds.length + 1} em andamento`);
    $('#live-total-text').text(`${total} pts`);
    $('#live-player-emoji').text(p ? (p.emoji || '🙂') : '?');
    $('#live-player-name').text(p ? p.name : '—');
    $('#live-player-score').text(playerScore);
    $('#live-turn-indicator').text(`Jogador ${idx + 1} de ${m.playerIds.length}`);
    $('#btn-prev-player').prop('disabled', m.playerIds.length < 2);
    $('#btn-next-player').prop('disabled', m.playerIds.length < 2);

    const $g = $('#qs-grid').empty();
    state.colors.forEach(c => {
      const count = ((m.liveRound.scores[pid] || {})[c.id]) || 0;
      $g.append(`
        <div class="qs-row">
          <button class="qs-add" data-cid="${c.id}" data-act="inc">
            ${swatch(c.hex, 'lg')}
            <div class="info">
              <div class="name">${escapeHtml(c.name)}</div>
              <div class="pts">+${c.points} pts</div>
            </div>
            <div class="count">×${count}</div>
          </button>
          <button class="qs-sub" data-cid="${c.id}" data-act="dec" ${count > 0 ? '' : 'disabled'}>−</button>
        </div>
      `);
    });
  }

  $(document).on('click', '#btn-start-round', function () {
    const m = state.currentMatch;
    if (!m) return;
    if (!state.colors.length) { toast('Cadastre cores antes de iniciar um round.', 'warning'); return; }
    m.liveRound = { scores: {} };
    m.playerIds.forEach(pid => { m.liveRound.scores[pid] = {}; });
    saveLocal();
    renderMatchView();
    toast('Round iniciado.', 'success');
  });

  $(document).on('click', '.qs-add, .qs-sub', function () {
    const m = state.currentMatch;
    if (!m || !m.liveRound) return;
    const cid = $(this).data('cid');
    const act = $(this).data('act');
    const pid = m.playerIds[m.currentPlayerIndex];
    if (!pid) return;
    if (!m.liveRound.scores[pid]) m.liveRound.scores[pid] = {};
    let v = m.liveRound.scores[pid][cid] || 0;
    v += act === 'inc' ? 1 : -1;
    if (v < 0) v = 0;
    m.liveRound.scores[pid][cid] = v;
    saveLocal();
    renderLivePanel(m);
    renderLeaderboard(m);
  });

  $(document).on('click', '#btn-prev-player', function () {
    const m = state.currentMatch;
    if (!m || !m.playerIds.length) return;
    m.currentPlayerIndex = (m.currentPlayerIndex - 1 + m.playerIds.length) % m.playerIds.length;
    saveLocal();
    renderLivePanel(m);
    renderPlayOrder(m);
  });

  $(document).on('click', '#btn-next-player', function () {
    const m = state.currentMatch;
    if (!m || !m.playerIds.length) return;
    m.currentPlayerIndex = (m.currentPlayerIndex + 1) % m.playerIds.length;
    saveLocal();
    renderLivePanel(m);
    renderPlayOrder(m);
  });

  $(document).on('click', '#btn-cancel-round', function () {
    confirmDialog('Cancelar round', 'O round atual e os pontos registrados ao vivo <strong>serão descartados</strong>. Continuar?', 'Cancelar Round', () => {
      const m = state.currentMatch;
      if (!m) return;
      m.liveRound = null;
      saveLocal();
      renderMatchView();
      toast('Round cancelado.', 'warning');
    });
  });

  $(document).on('click', '#btn-finish-round', function () {
    const m = state.currentMatch;
    if (!m || !m.liveRound) return;
    pendingRoundEdit = null;
    modalSourceLive = true;
    openRoundModal(null, m.liveRound.scores);
  });

  /* ----- Play order list ----- */

  function renderPlayOrder(m) {
    const $list = $('#play-order-list').empty();
    if (!m.playerIds.length) return;
    if (typeof m.currentPlayerIndex !== 'number' || m.currentPlayerIndex >= m.playerIds.length) m.currentPlayerIndex = 0;
    m.playerIds.forEach((pid, idx) => {
      const p = getPlayer(pid);
      if (!p) return;
      const isCurrent = idx === m.currentPlayerIndex;
      $list.append(`
        <li class="list-group-item ${isCurrent ? 'is-current' : ''}" draggable="true" data-pid="${pid}" data-idx="${idx}">
          <span class="drag-handle" title="Arraste para reordenar">⋮⋮</span>
          <span class="order-num">${idx + 1}</span>
          <span class="player-emoji">${escapeHtml(p.emoji || '🙂')}</span>
          <span class="player-name">${escapeHtml(p.name)}</span>
          ${isCurrent ? '<span class="badge bg-warning text-dark me-1">Vez</span>' : ''}
          <span class="order-actions">
            <button class="btn btn-outline-secondary" data-action="order-up" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''} title="Subir">▲</button>
            <button class="btn btn-outline-secondary" data-action="order-down" data-idx="${idx}" ${idx === m.playerIds.length - 1 ? 'disabled' : ''} title="Descer">▼</button>
            <button class="btn btn-soft" data-action="set-current" data-idx="${idx}" title="Marcar como atual">●</button>
          </span>
        </li>
      `);
    });
  }

  /* drag & drop reorder (HTML5) */
  $(document)
    .on('dragstart', '#play-order-list > li', function (e) {
      dragSrcIdx = parseInt($(this).attr('data-idx'), 10);
      $(this).addClass('dragging');
      const dt = e.originalEvent && e.originalEvent.dataTransfer;
      if (dt) {
        dt.effectAllowed = 'move';
        try { dt.setData('text/plain', String(dragSrcIdx)); } catch (_) {}
      }
    })
    .on('dragenter dragover', '#play-order-list > li', function (e) {
      if (dragSrcIdx === null) return;
      e.preventDefault();
      e.stopPropagation();
      const dt = e.originalEvent && e.originalEvent.dataTransfer;
      if (dt) dt.dropEffect = 'move';
      $('#play-order-list > li').removeClass('drag-over');
      $(this).addClass('drag-over');
      return false;
    })
    .on('dragleave', '#play-order-list > li', function (e) {
      const rel = e.originalEvent && e.originalEvent.relatedTarget;
      if (rel && this.contains(rel)) return;
      $(this).removeClass('drag-over');
    })
    .on('drop', '#play-order-list > li', function (e) {
      e.preventDefault();
      e.stopPropagation();
      $(this).removeClass('drag-over');
      const m = state.currentMatch;
      if (!m || dragSrcIdx === null) return false;
      const tgtIdx = parseInt($(this).attr('data-idx'), 10);
      if (tgtIdx === dragSrcIdx) { dragSrcIdx = null; return false; }

      const curPid = m.playerIds[m.currentPlayerIndex];
      const moved = m.playerIds.splice(dragSrcIdx, 1)[0];
      const insertAt = (dragSrcIdx < tgtIdx) ? tgtIdx - 1 : tgtIdx;
      m.playerIds.splice(insertAt, 0, moved);

      const newCurIdx = m.playerIds.indexOf(curPid);
      m.currentPlayerIndex = newCurIdx >= 0 ? newCurIdx : 0;

      dragSrcIdx = null;
      saveLocal();
      renderMatchView();
      return false;
    })
    .on('dragend', '#play-order-list > li', function () {
      dragSrcIdx = null;
      $('#play-order-list > li').removeClass('dragging drag-over');
    });

  $(document).on('click', '[data-action="order-up"]', function () {
    const m = state.currentMatch;
    if (!m) return;
    const idx = parseInt($(this).data('idx'), 10);
    if (idx <= 0) return;
    [m.playerIds[idx - 1], m.playerIds[idx]] = [m.playerIds[idx], m.playerIds[idx - 1]];
    if (m.currentPlayerIndex === idx) m.currentPlayerIndex = idx - 1;
    else if (m.currentPlayerIndex === idx - 1) m.currentPlayerIndex = idx;
    saveLocal();
    renderMatchView();
  });
  $(document).on('click', '[data-action="order-down"]', function () {
    const m = state.currentMatch;
    if (!m) return;
    const idx = parseInt($(this).data('idx'), 10);
    if (idx >= m.playerIds.length - 1) return;
    [m.playerIds[idx + 1], m.playerIds[idx]] = [m.playerIds[idx], m.playerIds[idx + 1]];
    if (m.currentPlayerIndex === idx) m.currentPlayerIndex = idx + 1;
    else if (m.currentPlayerIndex === idx + 1) m.currentPlayerIndex = idx;
    saveLocal();
    renderMatchView();
  });
  $(document).on('click', '[data-action="set-current"]', function () {
    const m = state.currentMatch;
    if (!m) return;
    m.currentPlayerIndex = parseInt($(this).data('idx'), 10);
    saveLocal();
    renderLivePanel(m);
    renderPlayOrder(m);
  });

  /* ----- Leaderboard ----- */

  function renderLeaderboard(m) {
    const totals = calcMatchScores(m, true);
    const ranked = rankList(totals);
    $('#leaderboard-meta').text(m.liveRound ? '(inclui round em andamento)' : '');
    const $lb = $('#match-leaderboard').empty();
    if (!ranked.length) { $lb.append('<div class="empty-state">Sem jogadores.</div>'); return; }
    ranked.forEach(row => {
      const p = getPlayer(row.pid);
      if (!p) return;
      const medal = rankMedal(row.rank) || `#${row.rank}`;
      $lb.append(`
        <div class="leaderboard-row rank-${row.rank}">
          <div class="rank">${medal}</div>
          <div class="name">${escapeHtml(p.emoji || '🙂')} ${escapeHtml(p.name)}</div>
          <div class="score">${row.score} pts</div>
        </div>
      `);
    });
  }

  /* ----- Rounds list (active match) ----- */

  function renderMatchRounds(m) {
    const $rs = $('#match-rounds').empty();
    $('#rounds-count').text(`${m.rounds.length} round${m.rounds.length !== 1 ? 's' : ''}`);
    if (!m.rounds.length) {
      $rs.append('<div class="empty-state">Nenhum round registrado ainda.</div>');
      return;
    }
    m.rounds.forEach((r, idx) => {
      // per-round ranking by round score
      const roundTotals = {};
      m.playerIds.forEach(pid => { roundTotals[pid] = calcRoundScore(r, pid); });
      const ranked = rankList(roundTotals);
      const roundTotalAll = ranked.reduce((s, x) => s + x.score, 0);

      const cards = ranked.map(row => {
        const p = getPlayer(row.pid);
        if (!p) return '';
        const by = r.scores[row.pid] || {};
        const picks = Object.keys(by).filter(cid => by[cid] > 0).map(cid => {
          const c = getColor(cid);
          return c ? `<span class="color-chip">${swatch(c.hex, 'sm')}${escapeHtml(c.name)} <strong>×${by[cid]}</strong></span>` : '';
        }).join('');
        const medal = rankMedal(row.rank);
        const rankLabel = medal || `${row.rank}º`;
        return `
          <div class="round-player-card">
            <div class="rp-header">
              <span class="rp-rank">${rankLabel}</span>
              <span class="rp-emoji">${escapeHtml(p.emoji || '🙂')}</span>
              <span class="rp-name">${escapeHtml(p.name)}</span>
              <span class="rp-score">${row.score} pts</span>
            </div>
            <div class="rp-picks">${picks || '<span class="empty">Não pegou nenhuma vareta</span>'}</div>
          </div>
        `;
      }).join('');

      $rs.append(`
        <div class="round-card" data-round-id="${r.id}">
          <div class="round-header">
            <div>
              <div class="round-num">Round ${idx + 1}</div>
              <div class="round-meta">
                <span class="meta-item">📅 ${fmtDate(r.createdAt)}</span>
                <span class="meta-item">Total: <strong>${roundTotalAll} pts</strong></span>
              </div>
            </div>
            <div class="round-actions">
              <button class="btn btn-sm btn-outline-secondary" data-action="edit-round" data-id="${r.id}">Editar</button>
              <button class="btn btn-sm btn-outline-danger" data-action="del-round" data-id="${r.id}">×</button>
            </div>
          </div>
          <div class="round-players-grid">${cards}</div>
        </div>
      `);
    });
  }

  /* ----- Cancel match ----- */

  $(document).on('click', '#btn-cancel-match', function () {
    confirmDialog('Cancelar partida', 'Tem certeza? Os rounds da partida atual <strong>serão perdidos</strong>.', 'Cancelar Partida', () => {
      state.currentMatch = null;
      saveLocal();
      renderAll();
      toast('Partida cancelada.', 'warning');
    });
  });

  /* ----- Round edit & delete ----- */

  $(document).on('click', '[data-action="edit-round"]', function () {
    pendingRoundEdit = $(this).data('id');
    modalSourceLive = false;
    openRoundModal(pendingRoundEdit);
  });

  $(document).on('click', '[data-action="del-round"]', function () {
    const id = $(this).data('id');
    confirmDialog('Excluir round', 'Remover este round?', 'Excluir', () => {
      state.currentMatch.rounds = state.currentMatch.rounds.filter(r => r.id !== id);
      saveLocal();
      renderMatchView();
      toast('Round removido.', 'success');
    });
  });

  /* ---------- Round Modal ---------- */

  function openRoundModal(roundId, prefillScores) {
    const m = state.currentMatch;
    if (!m) return;
    if (!state.colors.length) { toast('Cadastre cores antes de adicionar rounds.', 'warning'); return; }
    let scoresSource = null;
    let title = '';
    if (roundId) {
      const r = m.rounds.find(x => x.id === roundId);
      if (!r) return;
      scoresSource = r.scores;
      const idx = m.rounds.findIndex(x => x.id === roundId);
      title = `Editar Round ${idx + 1}`;
    } else {
      scoresSource = prefillScores || null;
      title = `Round ${m.rounds.length + 1} — conferência`;
    }
    $('#round-modal-title').text(title);

    const $body = $('#round-form-content').empty();
    m.playerIds.forEach(pid => {
      const p = getPlayer(pid);
      if (!p) return;
      const by = (scoresSource && scoresSource[pid]) || {};
      const colorRows = state.colors.map(c => {
        const val = by[c.id] || 0;
        return `
          <div class="round-form-color">
            <div class="label">
              ${swatch(c.hex)}
              <span>${escapeHtml(c.name)}</span>
              <span class="points-hint">${c.points} pts</span>
            </div>
            <div class="input-group input-group-sm stick-input">
              <button class="btn btn-outline-danger" type="button" data-stick="dec">−</button>
              <input type="number" class="form-control" min="0" value="${val}" data-player="${pid}" data-color="${c.id}" />
              <button class="btn btn-outline-success" type="button" data-stick="inc">+</button>
            </div>
          </div>
        `;
      }).join('');
      $body.append(`
        <div class="round-form-player" data-player="${pid}">
          <div class="player-header">
            <span style="font-size:1.15rem">${escapeHtml(p.emoji || '🙂')}</span>
            ${escapeHtml(p.name)}
            <span class="player-subtotal">Subtotal: <strong data-subtotal-for="${pid}">0</strong> pts</span>
          </div>
          ${colorRows}
        </div>
      `);
    });

    updateAllSubtotals();
    bootstrap.Modal.getOrCreateInstance($('#roundModal')[0]).show();
  }

  function updateSubtotalForPlayer(pid) {
    let total = 0;
    $(`#round-form-content input[data-player="${pid}"]`).each(function () {
      const v = parseInt($(this).val(), 10);
      const cid = $(this).data('color');
      const c = getColor(cid);
      if (!c || isNaN(v) || v < 0) return;
      total += v * c.points;
    });
    $(`#round-form-content [data-subtotal-for="${pid}"]`).text(total);
  }
  function updateAllSubtotals() {
    $('#round-form-content .round-form-player').each(function () {
      updateSubtotalForPlayer($(this).data('player'));
    });
  }

  $(document).on('click', '#round-form-content [data-stick]', function () {
    const $g = $(this).closest('.input-group');
    const $inp = $g.find('input[type="number"]');
    let v = parseInt($inp.val(), 10);
    if (isNaN(v)) v = 0;
    v += $(this).data('stick') === 'inc' ? 1 : -1;
    if (v < 0) v = 0;
    $inp.val(v);
    updateSubtotalForPlayer($inp.data('player'));
  });
  $(document).on('input change', '#round-form-content input[type="number"]', function () {
    let v = parseInt($(this).val(), 10);
    if (isNaN(v) || v < 0) { $(this).val(0); }
    updateSubtotalForPlayer($(this).data('player'));
  });

  $(document).on('click', '#btn-save-round', function () {
    const m = state.currentMatch;
    if (!m) return;
    const scores = {};
    m.playerIds.forEach(pid => { scores[pid] = {}; });
    let any = false;
    $('#round-form-content input[type="number"]').each(function () {
      const pid = $(this).data('player');
      const cid = $(this).data('color');
      const v = parseInt($(this).val(), 10);
      const n = isNaN(v) || v < 0 ? 0 : v;
      if (n > 0) { scores[pid][cid] = n; any = true; }
    });
    if (!any) { toast('Informe ao menos uma vareta pega.', 'warning'); return; }
    if (pendingRoundEdit) {
      const r = m.rounds.find(x => x.id === pendingRoundEdit);
      if (r) { r.scores = scores; r.updatedAt = new Date().toISOString(); }
    } else {
      m.rounds.push({ id: uid('r'), createdAt: new Date().toISOString(), scores });
      m.liveRound = null;
      // advance currentPlayerIndex to start next round naturally
      m.currentPlayerIndex = 0;
    }
    pendingRoundEdit = null;
    modalSourceLive = false;
    saveLocal();
    bootstrap.Modal.getInstance($('#roundModal')[0]).hide();
    renderMatchView();
    toast('Round salvo.', 'success');
  });

  /* ---------- Finalize match ---------- */

  $(document).on('click', '#btn-finish-match', function () {
    const m = state.currentMatch;
    if (!m) return;
    if (!m.rounds.length) { toast('Adicione ao menos um round antes de finalizar.', 'warning'); return; }
    confirmDialog('Finalizar partida', 'Finalizar a partida atual? Os dados serão movidos para o histórico.', 'Finalizar', () => {
      const totals = calcMatchScores(m, false);
      const ranked = rankList(totals);
      const finished = {
        id: m.id,
        startedAt: m.startedAt,
        finishedAt: new Date().toISOString(),
        playerIds: m.playerIds.slice(),
        rounds: JSON.parse(JSON.stringify(m.rounds)),
        totals,
        ranking: ranked
      };
      state.history.unshift(finished);
      state.currentMatch = null;
      saveLocal();
      renderAll();
      showFinalModal(finished);
    });
  });

  function showFinalModal(finished) {
    const $body = $('#final-modal-body').empty();
    $body.append(`<p class="text-muted mb-3">Partida finalizada em ${fmtDate(finished.finishedAt)} • ${finished.rounds.length} round${finished.rounds.length !== 1 ? 's' : ''}</p>`);
    const $card = $('<div class="card"><div class="card-body p-0"></div></div>');
    finished.ranking.forEach(row => {
      const p = getPlayer(row.pid) || { name: 'Jogador removido', emoji: '?' };
      const medal = rankMedal(row.rank) || `#${row.rank}`;
      $card.find('.card-body').append(`
        <div class="leaderboard-row rank-${row.rank}">
          <div class="rank">${medal}</div>
          <div class="name">${escapeHtml(p.emoji || '🙂')} ${escapeHtml(p.name)}</div>
          <div class="score">${row.score} pts</div>
        </div>
      `);
    });
    $body.append($card);
    bootstrap.Modal.getOrCreateInstance($('#finalModal')[0]).show();
  }

  /* ---------- History ---------- */

  function renderHistory() {
    const $acc = $('#historyAccordion').empty();
    $('#history-count').text(`${state.history.length} partida${state.history.length !== 1 ? 's' : ''}`);
    if (!state.history.length) { $('#history-empty').removeClass('d-none'); return; }
    $('#history-empty').addClass('d-none');

    state.history.forEach(h => {
      const winner = h.ranking[0];
      const wp = winner ? (getPlayer(winner.pid) || { name: 'Removido', emoji: '?' }) : null;
      const accId = `hist-${h.id}`;
      const summary = `
        <div class="history-summary">
          <strong>${fmtDate(h.startedAt)}</strong>
          <span class="badge bg-light text-dark border">${h.rounds.length} round${h.rounds.length !== 1 ? 's' : ''}</span>
          ${wp ? `<span class="winner-line">🏆 ${escapeHtml(wp.emoji)} ${escapeHtml(wp.name)} · ${winner.score} pts</span>` : ''}
        </div>
      `;
      $acc.append(`
        <div class="accordion-item">
          <h2 class="accordion-header">
            <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#${accId}">
              ${summary}
            </button>
          </h2>
          <div id="${accId}" class="accordion-collapse collapse" data-bs-parent="#historyAccordion">
            <div class="accordion-body p-3">
              ${renderHistoryMatchBody(h)}
            </div>
          </div>
        </div>
      `);
    });
  }

  function renderHistoryMatchBody(h) {
    // leaderboard with clickable rows
    const lbRows = h.ranking.map(row => {
      const p = getPlayer(row.pid) || { name: 'Removido', emoji: '?' };
      const medal = rankMedal(row.rank) || `#${row.rank}`;
      return `<div class="leaderboard-row rank-${row.rank} clickable" data-action="show-progression" data-match="${h.id}" data-player="${row.pid}" title="Ver progressão por round">
        <div class="rank">${medal}</div>
        <div class="name">${escapeHtml(p.emoji || '🙂')} ${escapeHtml(p.name)} <small class="text-muted">▸ ver progressão</small></div>
        <div class="score">${row.score} pts</div>
      </div>`;
    }).join('');

    // detalhes por round (refined table)
    let detailsTable = '';
    if (h.rounds.length) {
      // compute round-level top scorer for highlighting
      const roundTops = h.rounds.map(r => {
        let max = -Infinity;
        h.playerIds.forEach(pid => { const s = calcRoundScore(r, pid); if (s > max) max = s; });
        return max;
      });
      let head = '<thead><tr><th class="text-start">Jogador</th>';
      h.rounds.forEach((r, i) => head += `<th>R${i + 1}<span class="round-date">${fmtDate(r.createdAt).split(',').pop().trim()}</span></th>`);
      head += '<th>Total</th></tr></thead>';
      let body = '<tbody>';
      h.ranking.forEach(row => {
        const p = getPlayer(row.pid) || { name: 'Removido', emoji: '?' };
        body += `<tr><td class="player-cell"><span class="emoji">${escapeHtml(p.emoji || '🙂')}</span><span>${escapeHtml(p.name)}</span></td>`;
        h.rounds.forEach((r, i) => {
          const s = calcRoundScore(r, row.pid);
          const top = (roundTops[i] === s && s > 0) ? 'top-cell' : '';
          body += `<td class="${top}">${s}</td>`;
        });
        body += `<td class="total-cell">${row.score}</td></tr>`;
      });
      body += '</tbody>';
      detailsTable = `
        <div class="gd-table-wrap">
          <div class="gd-table-title">Detalhes por round</div>
          <div class="table-scroll">
            <table class="gd-table gd-table-sticky">${head}${body}</table>
          </div>
        </div>
      `;
    }

    return `
      <div class="text-muted small mb-2">Iniciada em ${fmtDate(h.startedAt)} • Finalizada em ${fmtDate(h.finishedAt)}</div>
      <div class="card mb-3"><div class="card-body p-0">${lbRows}</div></div>
      ${detailsTable}
      <div class="d-flex justify-content-end mt-3">
        <button class="btn btn-sm btn-outline-danger" data-action="del-history" data-id="${h.id}">Excluir do histórico</button>
      </div>
    `;
  }

  $(document).on('click', '[data-action="del-history"]', function (e) {
    e.stopPropagation();
    const id = $(this).data('id');
    confirmDialog('Excluir do histórico', 'Remover esta partida do histórico permanentemente?', 'Excluir', () => {
      state.history = state.history.filter(h => h.id !== id);
      saveLocal();
      renderHistory();
      toast('Partida removida do histórico.', 'success');
    });
  });

  /* ----- Progression modal ----- */

  $(document).on('click', '[data-action="show-progression"]', function () {
    const matchId = $(this).data('match');
    const playerId = $(this).data('player');
    const h = state.history.find(x => x.id === matchId);
    if (!h) return;
    showProgressionModal(h, playerId);
  });

  function showProgressionModal(h, playerId) {
    const p = getPlayer(playerId) || { name: 'Removido', emoji: '?' };
    $('#progression-title').html(`Progressão · ${escapeHtml(p.emoji || '🙂')} ${escapeHtml(p.name)}`);
    const $body = $('#progression-body').empty();

    if (!h.rounds.length) { $body.append('<div class="empty-state">Sem rounds.</div>'); return; }

    // compute progression
    const cumulative = {};
    h.playerIds.forEach(pid => { cumulative[pid] = 0; });
    const rows = [];
    let maxCum = 1;

    h.rounds.forEach((r, idx) => {
      const roundScores = {};
      h.playerIds.forEach(pid => { roundScores[pid] = calcRoundScore(r, pid); });
      h.playerIds.forEach(pid => { cumulative[pid] += roundScores[pid]; });

      const roundRanked = rankList(roundScores);
      const roundRank = (roundRanked.find(x => x.pid === playerId) || { rank: '-' }).rank;
      const cumSnap = {};
      h.playerIds.forEach(pid => { cumSnap[pid] = cumulative[pid]; });
      const cumRanked = rankList(cumSnap);
      const cumRank = (cumRanked.find(x => x.pid === playerId) || { rank: '-' }).rank;

      if (cumulative[playerId] > maxCum) maxCum = cumulative[playerId];

      rows.push({
        idx: idx + 1,
        date: fmtDate(r.createdAt),
        roundScore: roundScores[playerId],
        roundRank,
        cumScore: cumulative[playerId],
        cumRank,
        by: r.scores[playerId] || {}
      });
    });

    // also peak across all players for bar normalization
    let allMax = 0;
    h.playerIds.forEach(pid => { if ((cumulative[pid] || 0) > allMax) allMax = cumulative[pid]; });
    if (allMax === 0) allMax = 1;

    const finalRow = h.ranking.find(x => x.pid === playerId);
    const finalRank = finalRow ? finalRow.rank : '-';
    const finalScore = finalRow ? finalRow.score : 0;

    let html = `
      <div class="card mb-3" style="background: var(--surface-alt); border-color: var(--border);">
        <div class="card-body py-2 px-3 d-flex justify-content-between flex-wrap gap-2 align-items-center">
          <span class="text-muted small">Resultado final</span>
          <div class="d-flex gap-2 align-items-center">
            ${posPill(finalRank)}
            <strong class="text-primary">${finalScore} pts</strong>
          </div>
        </div>
      </div>
      <div class="gd-table-wrap">
        <div class="gd-table-title">Progressão por round</div>
        <div class="table-scroll">
          <table class="gd-table">
            <thead>
              <tr>
                <th class="text-start">Round</th>
                <th>Pts no round</th>
                <th>Pos. round</th>
                <th>Acumulado</th>
                <th>Pos. acumulada</th>
              </tr>
            </thead>
            <tbody>
    `;
    rows.forEach(row => {
      const pct = Math.round((row.cumScore / allMax) * 100);
      html += `
        <tr>
          <td class="text-start">
            <strong>R${row.idx}</strong>
            <div class="text-muted" style="font-size:0.7rem;">${row.date}</div>
          </td>
          <td class="total-cell">${row.roundScore}</td>
          <td>${posPill(row.roundRank)}</td>
          <td>
            <div class="score-bar">
              <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
              <div class="bar-value">${row.cumScore}</div>
            </div>
          </td>
          <td>${posPill(row.cumRank)}</td>
        </tr>
      `;
    });
    html += '</tbody></table></div></div>';

    // Picks per round (color chips)
    html += '<div class="gd-table-wrap mt-3"><div class="gd-table-title">Varetas pegas por round</div><div class="picks-list px-3">';
    rows.forEach(row => {
      const chips = Object.keys(row.by).filter(cid => row.by[cid] > 0).map(cid => {
        const c = getColor(cid);
        return c ? `<span class="color-chip">${swatch(c.hex, 'sm')}${escapeHtml(c.name)} <strong>×${row.by[cid]}</strong></span>` : '';
      }).join('');
      html += `
        <div class="picks-row">
          <span class="picks-round-label">R${row.idx}</span>
          <div class="picks-row-chips">${chips || '<span class="text-muted small">— não pegou nada</span>'}</div>
        </div>
      `;
    });
    html += '</div></div>';

    $body.html(html);
    bootstrap.Modal.getOrCreateInstance($('#progressionModal')[0]).show();
  }

  /* ---------- Backup ---------- */

  $(document).on('click', '#btn-export', function () {
    const data = JSON.stringify(state, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url;
    a.download = `data-${stamp}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('Backup baixado.', 'success');
  });

  $(document).on('click', '#btn-import', function () {
    const file = $('#import-file')[0].files[0];
    if (!file) { toast('Selecione um arquivo JSON.', 'warning'); return; }
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const data = JSON.parse(e.target.result);
        if (typeof data !== 'object') throw new Error('formato inválido');
        confirmDialog('Importar backup', 'Os dados atuais serão <strong>substituídos</strong>. Continuar?', 'Importar', () => {
          state = normalizeState(data);
          saveLocal();
          $('#import-file').val('');
          renderAll();
          toast('Backup importado.', 'success');
        });
      } catch (err) {
        toast('Arquivo inválido: ' + err.message, 'danger');
      }
    };
    reader.readAsText(file);
  });

  $(document).on('click', '#btn-reset', function () {
    confirmDialog('Resetar tudo', 'Apagar <strong>todos</strong> os dados (jogadores, cores, partida atual e histórico)? Esta ação não pode ser desfeita.', 'Resetar', () => {
      state = normalizeState({});
      selectedPlayerIds = [];
      saveLocal();
      renderAll();
      toast('Dados resetados.', 'warning');
    });
  });

  /* ---------- Confirm modal ---------- */

  $(document).on('click', '#btn-confirm-ok', function () {
    if (typeof confirmCallback === 'function') {
      const cb = confirmCallback;
      confirmCallback = null;
      bootstrap.Modal.getInstance($('#confirmModal')[0]).hide();
      cb();
    }
  });

  /* ---------- Render all ---------- */

  function renderAll() {
    renderPlayers();
    renderColors();
    renderMatchView();
    renderHistory();
  }

  $(function () { bootstrapState(); });

})(jQuery);
