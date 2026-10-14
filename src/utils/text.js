export const truncate = (s, n) => {
  s = String(s ?? '');
  return s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s;
};

/** Splits "a b \"c d\" e" into ["a","b","c d","e"]; honours single and double quotes. */
export function splitArgs(input) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(input))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

export function extractTags(text) {
  const tags = new Set();
  for (const m of String(text ?? '').matchAll(/(?:^|\s)#([\p{L}\p{N}_-]{1,32})/gu)) tags.add(m[1].toLowerCase());
  return [...tags].slice(0, 10);
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '?';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const parts = [[Math.floor(s / 86400), 'd'], [Math.floor((s % 86400) / 3600), 'h'], [Math.floor((s % 3600) / 60), 'm'], [s % 60, 's']];
  const shown = parts.filter(([v]) => v > 0).slice(0, 3);
  return shown.length ? shown.map(([v, u]) => `${v}${u}`).join(' ') : '0s';
}

export function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function formatDate(date, timeZone = 'UTC') {
  try {
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(date));
  } catch {
    return new Date(date).toISOString();
  }
}

/** Case-insensitive AND match of whitespace-separated terms. Returns match score (0 = no match). */
export function scoreMatch(haystack, terms) {
  const h = String(haystack ?? '').toLowerCase();
  let score = 0;
  for (const t of terms) {
    const idx = h.indexOf(t.toLowerCase());
    if (idx < 0) return 0;
    score += 1 + (idx === 0 ? 0.5 : 0);
  }
  return score;
}

export function snippet(text, terms, width = 80) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= width) return s;
  const i = terms.length ? s.toLowerCase().indexOf(terms[0].toLowerCase()) : 0;
  const start = Math.max(0, (i < 0 ? 0 : i) - 20);
  return `${start > 0 ? '…' : ''}${s.slice(start, start + width)}${start + width < s.length ? '…' : ''}`;
}
