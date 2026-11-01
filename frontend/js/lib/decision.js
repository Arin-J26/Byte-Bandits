// Maps a decision string to its colour, icon and label.
// Colour is never the only signal: every decision also has an icon and text.

const STYLES = {
  ALLOW: { key: 'ALLOW', tone: 'ok', color: 'green', icon: '✓', label: 'Allow', sound: 'allow' },
  REVIEW: { key: 'REVIEW', tone: 'warn', color: 'amber', icon: '!', label: 'Review', sound: 'review' },
  UNKNOWN: {
    key: 'UNKNOWN', tone: 'warn', color: 'amber', icon: '!', label: 'Unknown', sound: 'review',
    note: 'No history. Normal review, not blocked.',
  },
  FLAG: { key: 'FLAG', tone: 'bad', color: 'red', icon: '✕', label: 'Flag', sound: 'flag' },
};

/** Unrecognised values fall back to REVIEW so nothing is silently allowed or flagged. */
export function decisionStyle(decision) {
  const key = String(decision || '').trim().toUpperCase();
  return STYLES[key] || STYLES.REVIEW;
}

/** Record type -> style (vouch is green/check, denounce is red/cross). */
export function recordTypeStyle(type) {
  return type === 'denounce'
    ? { tone: 'bad', icon: '✕', label: 'Denounce' }
    : { tone: 'ok', icon: '✓', label: 'Vouch' };
}

/** Signature status -> style. */
export function signatureStyle(valid) {
  return valid === false
    ? { tone: 'bad', icon: '✕', label: 'Invalid signature' }
    : { tone: 'ok', icon: '✓', label: 'Signature valid' };
}
