// Small display helpers. Pure.

export const fmtWeight = (w) => (Number(w) || 0).toFixed(2);

export function fmtSigned(v) {
  const n = Number(v) || 0;
  return `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(2)}`;
}

export function fmtTime(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts ?? '');
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

export function fmtAgo(ts, now = Date.now()) {
  const s = Math.round((now - new Date(ts).getTime()) / 1000);
  if (!Number.isFinite(s)) return '';
  if (s < 60) return `${Math.max(0, s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** Normalises the "via" field: arrays are kept, strings like "a → b" are split. */
export function viaList(via) {
  if (Array.isArray(via)) return via.map(String);
  if (via == null || via === '') return [];
  return String(via).split(/\s*(?:→|->|>|,)\s*/).filter(Boolean);
}
