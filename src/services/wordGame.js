import { normalizeJid } from '../utils/jid.js';

const LIVES = 3;
const BASE_TIMER_MS = 45_000;
const MIN_TIMER_MS = 20_000;
const TIMER_REDUCTION_MS = 2_000;
const BASE_MIN_LENGTH = 3;
const JOIN_WINDOW_MS = 60_000;
const WARN_BEFORE_MS = 15_000; // warn when this many ms remain

// Check word validity using multiple sources — word is rejected only if ALL sources say no
async function isRealWord(word) {
  const w = word.toLowerCase();

  // Source 1: Free Dictionary API (strict — headwords only)
  const dict = fetch(
    `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`,
    { signal: AbortSignal.timeout(6000) },
  ).then((r) => r.ok).catch(() => null); // null = inconclusive

  // Source 2: Datamuse — returns matches if the word exists in its corpus
  const datamuse = fetch(
    `https://api.datamuse.com/words?sp=${encodeURIComponent(w)}&max=1`,
    { signal: AbortSignal.timeout(6000) },
  ).then(async (r) => {
    if (!r.ok) return null;
    const data = await r.json();
    // Datamuse returns the word itself as first result if it's a known word
    return Array.isArray(data) && data.length > 0 && data[0].word === w;
  }).catch(() => null);

  const [d, dm] = await Promise.all([dict, datamuse]);

  // If either source confirms it — accept
  if (d === true || dm === true) return true;
  // If both are inconclusive (network issues) — give benefit of the doubt
  if (d === null && dm === null) return true;
  // If one confirms it's invalid and the other is inconclusive — reject
  // Both must say false to reject
  if (d === false && dm === false) return false;
  // One false, one inconclusive — still accept (lenient)
  return true;
}

function mask(jid) {
  const num = jid.split('@')[0].split(':')[0];
  return `+${num.slice(0, 3)}****${num.slice(-2)}`;
}

function randomLetter() {
  // avoid rare letters x, z, q to keep game fair
  const letters = 'abcdefghijklmnoprstuvwy';
  return letters[Math.floor(Math.random() * letters.length)];
}

export class WordGameService {
  constructor(db) {
    this.db = db;
    this.games = new Map();
  }

  get col() { return this.db.collection('word_game_leaderboard'); }

  hasGame(chatJid) { return this.games.has(chatJid); }
  getGame(chatJid) { return this.games.get(chatJid) ?? null; }

  startLobby(chatJid, starterJid, maxPlayers, sendFn) {
    if (this.games.has(chatJid)) return '⚠️ A game is already running here. Type *,join* to join or wait for it to finish.';
    if (this.games.size > 0) return '⚠️ A game is already running in another chat. Only one game at a time is allowed.';

    const max = Math.max(2, Math.min(10, maxPlayers || 5));
    const game = {
      chatJid, phase: 'lobby', maxPlayers: max,
      players: [], usedWords: new Set(),
      round: 0, currentIdx: 0, currentLetter: null,
      timerMs: BASE_TIMER_MS, minLength: BASE_MIN_LENGTH,
      turnTimer: null, warnTimer: null, joinTimer: null, sendFn,
    };
    this.games.set(chatJid, game);
    this._addPlayer(game, starterJid);

    // 30s warning before auto-start
    const warnAt = JOIN_WINDOW_MS - 30_000;
    if (warnAt > 0) {
      setTimeout(() => {
        if (game.phase === 'lobby') sendFn('⏰ *30 seconds left* to join! Type *,join* now.');
      }, warnAt);
    }

    game.joinTimer = setTimeout(() => {
      if (game.phase !== 'lobby') return;
      if (game.players.length < 2) {
        sendFn('⏰ Not enough players joined. Game cancelled.');
        this.games.delete(chatJid);
      } else {
        this._beginGame(game);
      }
    }, JOIN_WINDOW_MS);

    return [
      `🎮 *Word Game started!*`,
      `👥 Players: 1/${max} — type *,join* to join`,
      `⏳ Game starts in 60s or when full`,
      `📌 Type *,start* to begin early (needs ≥2 players)`,
    ].join('\n');
  }

  joinGame(chatJid, jid) {
    const game = this.games.get(chatJid);
    if (!game) return '❌ No game lobby open. Type *,wdg* to start one.';
    if (game.phase !== 'lobby') return '❌ Game already in progress.';
    if (game.players.some((p) => normalizeJid(p.jid) === normalizeJid(jid))) return '⚠️ You already joined.';
    if (game.players.length >= game.maxPlayers) return '❌ Game is full.';

    this._addPlayer(game, jid);
    const count = game.players.length;

    if (count >= game.maxPlayers) {
      clearTimeout(game.joinTimer);
      this._beginGame(game);
      return `✅ ${mask(jid)} joined! (${count}/${game.maxPlayers}) — Starting now...`;
    }
    return `✅ ${mask(jid)} joined! (${count}/${game.maxPlayers})`;
  }

  forceStart(chatJid, jid) {
    const game = this.games.get(chatJid);
    if (!game) return null; // no game, silently ignore
    if (game.phase !== 'lobby') return '❌ Game already started.';
    if (game.players[0]?.jid !== jid && !game.players.some((p) => normalizeJid(p.jid) === normalizeJid(jid))) {
      return '❌ Only a joined player can force-start.';
    }
    if (game.players[0] && normalizeJid(game.players[0].jid) !== normalizeJid(jid)) {
      return '❌ Only the game starter can force-start.';
    }
    if (game.players.length < 2) return '❌ Need at least 2 players to start.';
    clearTimeout(game.joinTimer);
    this._beginGame(game);
    return null; // _beginGame sends its own message
  }

  stopGame(chatJid, jid, isOwner = false) {
    const game = this.games.get(chatJid);
    if (!game) return '❌ No game running.';
    const isStarter = normalizeJid(game.players[0]?.jid) === normalizeJid(jid);
    if (!isOwner && !isStarter) return '❌ Only the game starter or owner can stop the game.';
    this._cleanup(game, '🛑 Game stopped by host.');
    return null;
  }

  async handleMessage(chatJid, senderJid, text) {
    const game = this.games.get(chatJid);
    if (!game || game.phase !== 'playing') return false;

    const current = game.players[game.currentIdx];
    if (!current || normalizeJid(current.jid) !== normalizeJid(senderJid)) return false;

    const word = text.trim().toLowerCase();
    if (!/^[a-z]+$/.test(word)) return false;

    clearTimeout(game.turnTimer);
    clearTimeout(game.warnTimer);

    const fail = await this._validateWord(game, word);
    if (fail) {
      await game.sendFn(fail);
      this._loseLife(game, current);
      return true;
    }

    game.usedWords.add(word);
    current.score += word.length;
    await game.sendFn(`✅ *${word}* — nice! (+${word.length} pts)`);
    this._nextTurn(game);
    return true;
  }

  async getLeaderboard() {
    const rows = await this.col.find({}).sort({ wins: -1, score: -1 }).limit(10).toArray().catch(() => []);
    if (!rows.length) return '📊 No leaderboard data yet.';
    const lines = rows.map((r, i) => `│ ${i + 1}. ${mask(r._id)} — 🏆 ${r.wins}W / 🎯 ${r.score}pts`);
    return ['╭─「 🏆 *Word Game Leaderboard* 」', ...lines, '╰────────────────────'].join('\n');
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _addPlayer(game, jid) {
    game.players.push({ jid, lives: LIVES, score: 0, eliminated: false });
  }

  _beginGame(game) {
    if (game.phase !== 'lobby') return;
    game.phase = 'playing';
    game.round = 1;
    game.currentIdx = 0;
    game.currentLetter = randomLetter();

    const playerList = game.players.map((p, i) => `│ ${i + 1}. ${mask(p.jid)}`).join('\n');
    game.sendFn([
      `🎮 *Word Game — Round ${game.round}*`,
      `👥 Players:`,
      playerList,
      ``,
      `📏 Min word length: *${game.minLength}* letters`,
      `⏱️ Time per turn: *${game.timerMs / 1000}s*`,
      `❤️ Lives: *${LIVES}* each`,
    ].join('\n'));

    setTimeout(() => this._promptTurn(game), 1500);
  }

  _promptTurn(game) {
    if (game.phase !== 'playing') return;
    const current = game.players[game.currentIdx];
    if (!current) return;

    game.sendFn([
      `🔤 *${mask(current.jid)}'s turn!*`,
      `Start with letter: *${game.currentLetter.toUpperCase()}*`,
      `Min length: *${game.minLength}* | ⏱️ *${game.timerMs / 1000}s* | ❤️ ${current.lives}`,
    ].join('\n'));

    // Warn when WARN_BEFORE_MS remain (only if timer is long enough)
    if (game.timerMs > WARN_BEFORE_MS + 5000) {
      game.warnTimer = setTimeout(() => {
        if (game.phase !== 'playing') return;
        game.sendFn(`⚠️ *${mask(current.jid)}* — ${WARN_BEFORE_MS / 1000}s left!`);
      }, game.timerMs - WARN_BEFORE_MS);
    }

    game.turnTimer = setTimeout(() => {
      if (game.phase !== 'playing') return;
      clearTimeout(game.warnTimer);
      game.sendFn(`⏰ *${mask(current.jid)}* ran out of time!`);
      this._loseLife(game, current);
    }, game.timerMs);
  }

  _loseLife(game, player) {
    player.lives -= 1;
    if (player.lives <= 0) {
      player.eliminated = true;
      game.sendFn(`💀 *${mask(player.jid)}* has been eliminated!`);
    } else {
      game.sendFn(`❤️ *${mask(player.jid)}* has *${player.lives}* life/lives left.`);
    }
    this._nextTurn(game, true);
  }

  _nextTurn(game, afterPenalty = false) {
    if (game.phase !== 'playing') return;

    const alive = game.players.filter((p) => !p.eliminated);
    if (alive.length <= 1) {
      this._endGame(game, alive[0] ?? null);
      return;
    }

    let next = (game.currentIdx + 1) % game.players.length;
    let loops = 0;
    while (game.players[next].eliminated) {
      next = (next + 1) % game.players.length;
      if (++loops > game.players.length) break;
    }
    game.currentIdx = next;

    const firstAliveIdx = game.players.findIndex((p) => !p.eliminated);
    if (next === firstAliveIdx && !afterPenalty) {
      game.round += 1;
      game.minLength += 1;
      game.timerMs = Math.max(MIN_TIMER_MS, game.timerMs - TIMER_REDUCTION_MS);
      game.currentLetter = randomLetter();
      game.sendFn([
        `🔄 *Round ${game.round}!*`,
        `📏 Min length now: *${game.minLength}* | ⏱️ *${game.timerMs / 1000}s*`,
        `🔤 New letter: *${game.currentLetter.toUpperCase()}*`,
      ].join('\n'));
    } else {
      game.currentLetter = randomLetter();
    }

    setTimeout(() => this._promptTurn(game), 1000);
  }

  async _endGame(game, winner) {
    game.phase = 'done';
    clearTimeout(game.turnTimer);
    clearTimeout(game.warnTimer);

    const scores = [...game.players]
      .sort((a, b) => b.score - a.score)
      .map((p, i) => `│ ${i + 1}. ${mask(p.jid)} — ${p.score}pts ${p.eliminated ? '💀' : '✅'}`);

    if (winner) {
      await game.sendFn([
        `🏆 *${mask(winner.jid)} wins!*`,
        ``,
        `╭─「 📊 *Final Scores* 」`,
        ...scores,
        `╰────────────────────`,
      ].join('\n'));
      await this._recordWin(winner.jid, winner.score);
    } else {
      await game.sendFn([
        `🤝 *No winner — everyone was eliminated!*`,
        ``,
        `╭─「 📊 *Final Scores* 」`,
        ...scores,
        `╰────────────────────`,
      ].join('\n'));
    }

    for (const p of game.players) {
      if (p !== winner) await this._recordScore(p.jid, p.score);
    }

    this.games.delete(game.chatJid);
  }

  _cleanup(game, msg) {
    clearTimeout(game.turnTimer);
    clearTimeout(game.warnTimer);
    clearTimeout(game.joinTimer);
    game.phase = 'done';
    if (msg) game.sendFn(msg);
    this.games.delete(game.chatJid);
  }

  async _validateWord(game, word) {
    if (!word.startsWith(game.currentLetter)) {
      return `❌ Word must start with *${game.currentLetter.toUpperCase()}*. You lose a life!`;
    }
    if (word.length < game.minLength) {
      return `❌ Word must be at least *${game.minLength}* letters long. You lose a life!`;
    }
    if (game.usedWords.has(word)) {
      return `❌ *${word}* was already used! You lose a life!`;
    }
    const real = await isRealWord(word);
    if (!real) {
      return `❌ *${word}* is not a recognised English word. You lose a life!`;
    }
    return null;
  }

  async _recordWin(jid, score) {
    await this.col.updateOne({ _id: jid }, { $inc: { wins: 1, score, gamesPlayed: 1 } }, { upsert: true }).catch(() => {});
  }

  async _recordScore(jid, score) {
    await this.col.updateOne({ _id: jid }, { $inc: { score, gamesPlayed: 1 }, $setOnInsert: { wins: 0 } }, { upsert: true }).catch(() => {});
  }
}
