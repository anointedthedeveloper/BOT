/**
 * Word Game Service
 *
 * Rules:
 * - Starter invokes ,wdg [maxPlayers] — they auto-join as player 1
 * - Others type ,join to join (up to maxPlayers, default 5)
 * - Game starts when maxPlayers joined OR starter types ,start after ≥2 players
 * - Each round: bot picks a required starting letter, current player must reply
 *   with a real word starting with that letter, of at least `minLength` chars
 * - Round 1: minLength=3, timer=45s. Each completed round: minLength+1, timer-2s (floor 20s)
 * - Wrong word / timeout = player loses a life (3 lives total). 0 lives = eliminated.
 * - Last player standing wins. If all remaining players are eliminated in same round, no winner.
 * - Leaderboard stored in MongoDB collection `word_game_leaderboard`
 */

import { normalizeJid } from '../utils/jid.js';

const LIVES = 3;
const BASE_TIMER_MS = 45_000;
const MIN_TIMER_MS = 20_000;
const TIMER_REDUCTION_MS = 2_000;
const BASE_MIN_LENGTH = 3;
const JOIN_WINDOW_MS = 60_000; // 60s to join before game auto-starts

// Simple English word list check via Free Dictionary API
async function isRealWord(word) {
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`, {
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return true; // network issue — give benefit of the doubt
  }
}

function mask(jid) {
  const num = jid.split('@')[0];
  return `+${num.slice(0, 3)}****${num.slice(-2)}`;
}

function randomLetter() {
  return String.fromCharCode(97 + Math.floor(Math.random() * 26));
}

export class WordGameService {
  constructor(db) {
    this.db = db; // raw db handle (db.db)
    this.games = new Map(); // chatJid -> GameState
  }

  get col() {
    return this.db.collection('word_game_leaderboard');
  }

  // ── Public API ────────────────────────────────────────────────────────────

  hasGame(chatJid) {
    return this.games.has(chatJid);
  }

  getGame(chatJid) {
    return this.games.get(chatJid) ?? null;
  }

  /**
   * Called by ,wdg command. Returns a message to send.
   */
  startLobby(chatJid, starterJid, maxPlayers, sendFn) {
    if (this.games.has(chatJid)) return '⚠️ A game is already running. Type ,join to join or wait for it to finish.';
    const max = Math.max(2, Math.min(10, maxPlayers || 5));
    const game = {
      chatJid,
      phase: 'lobby',       // lobby | playing | done
      maxPlayers: max,
      players: [],          // { jid, lives, score }
      usedWords: new Set(),
      round: 0,
      currentIdx: 0,
      currentLetter: null,
      timerMs: BASE_TIMER_MS,
      minLength: BASE_MIN_LENGTH,
      turnTimer: null,
      joinTimer: null,
      sendFn,
    };
    this.games.set(chatJid, game);

    // Auto-join the starter
    this._addPlayer(game, starterJid);

    // Auto-start after JOIN_WINDOW_MS if not already started
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
      `📌 Starter can type *,start* to begin early (needs ≥2 players)`,
    ].join('\n');
  }

  /**
   * Called by ,join command. Returns a message to send.
   */
  joinGame(chatJid, jid) {
    const game = this.games.get(chatJid);
    if (!game) return '❌ No game lobby open. Type *,wdg* to start one.';
    if (game.phase !== 'lobby') return '❌ Game already in progress.';
    if (game.players.some((p) => p.jid === jid)) return '⚠️ You already joined.';
    if (game.players.length >= game.maxPlayers) return '❌ Game is full.';

    this._addPlayer(game, jid);
    const count = game.players.length;

    if (count >= game.maxPlayers) {
      clearTimeout(game.joinTimer);
      setTimeout(() => this._beginGame(game), 1500);
      return `✅ ${mask(jid)} joined! (${count}/${game.maxPlayers}) — Starting now...`;
    }
    return `✅ ${mask(jid)} joined! (${count}/${game.maxPlayers})`;
  }

  /**
   * Called by ,start command (starter only).
   */
  forceStart(chatJid, jid) {
    const game = this.games.get(chatJid);
    if (!game) return '❌ No game lobby open.';
    if (game.phase !== 'lobby') return '❌ Game already started.';
    if (game.players[0]?.jid !== jid) return '❌ Only the game starter can force-start.';
    if (game.players.length < 2) return '❌ Need at least 2 players to start.';
    clearTimeout(game.joinTimer);
    setTimeout(() => this._beginGame(game), 500);
    return '▶️ Starting game...';
  }

  /**
   * Called by ,wdg stop (starter or owner).
   */
  stopGame(chatJid, jid, isOwner = false) {
    const game = this.games.get(chatJid);
    if (!game) return '❌ No game running.';
    if (!isOwner && game.players[0]?.jid !== jid) return '❌ Only the game starter or owner can stop the game.';
    this._cleanup(game, '🛑 Game stopped by host.');
    return null; // message already sent inside _cleanup
  }

  /**
   * Handle a plain-text message during a game. Returns true if consumed.
   */
  async handleMessage(chatJid, senderJid, text) {
    const game = this.games.get(chatJid);
    if (!game || game.phase !== 'playing') return false;

    const current = game.players[game.currentIdx];
    if (!current || normalizeJid(current.jid) !== normalizeJid(senderJid)) return false;

    const word = text.trim().toLowerCase();
    if (!/^[a-z]+$/.test(word)) return false; // ignore non-alpha

    clearTimeout(game.turnTimer);

    // Validate
    const fail = await this._validateWord(game, word);
    if (fail) {
      await game.sendFn(fail);
      this._loseLife(game, current);
      return true;
    }

    // Good word
    game.usedWords.add(word);
    current.score += word.length;
    await game.sendFn(`✅ *${word}* — good! (+${word.length} pts)`);
    this._nextTurn(game);
    return true;
  }

  async getLeaderboard(chatJid) {
    const rows = await this.col
      .find({})
      .sort({ wins: -1, score: -1 })
      .limit(10)
      .toArray()
      .catch(() => []);
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

    game.turnTimer = setTimeout(() => {
      if (game.phase !== 'playing') return;
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

    // Advance to next alive player
    let next = (game.currentIdx + 1) % game.players.length;
    let loops = 0;
    while (game.players[next].eliminated) {
      next = (next + 1) % game.players.length;
      if (++loops > game.players.length) break;
    }
    game.currentIdx = next;

    // Check if we completed a full round (back to first alive player)
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
      // Same round, just pick a new letter for next player
      game.currentLetter = randomLetter();
    }

    setTimeout(() => this._promptTurn(game), 1000);
  }

  async _endGame(game, winner) {
    game.phase = 'done';
    clearTimeout(game.turnTimer);

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

    // Record scores for all players
    for (const p of game.players) {
      if (p !== winner) await this._recordScore(p.jid, p.score);
    }

    this.games.delete(game.chatJid);
  }

  _cleanup(game, msg) {
    clearTimeout(game.turnTimer);
    clearTimeout(game.joinTimer);
    game.phase = 'done';
    if (msg) game.sendFn(msg);
    this.games.delete(game.chatJid);
  }

  async _validateWord(game, word) {
    if (!word.startsWith(game.currentLetter)) {
      return `❌ Word must start with *${game.currentLetter.toUpperCase()}*. Try again — you lose a life!`;
    }
    if (word.length < game.minLength) {
      return `❌ Word must be at least *${game.minLength}* letters. Try again — you lose a life!`;
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
    await this.col.updateOne(
      { _id: jid },
      { $inc: { wins: 1, score, gamesPlayed: 1 } },
      { upsert: true },
    ).catch(() => {});
  }

  async _recordScore(jid, score) {
    await this.col.updateOne(
      { _id: jid },
      { $inc: { score, gamesPlayed: 1 }, $setOnInsert: { wins: 0 } },
      { upsert: true },
    ).catch(() => {});
  }
}
