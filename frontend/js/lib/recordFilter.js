// Filtering, sorting, paging and export for the Records table. Pure.

const lc = (v) => String(v ?? '').toLowerCase();

/** @param {{q?:string,type?:string,sig?:'valid'|'invalid'|'',issuer?:string}} f */
export function filterRecords(records = [], f = {}) {
  const q = lc(f.q).trim();
  return records.filter((r) => {
    if (f.type && r.type !== f.type) return false;
    if (f.issuer && r.issuer !== f.issuer) return false;
    if (f.sig === 'valid' && r.signature_valid === false) return false;
    if (f.sig === 'invalid' && r.signature_valid !== false) return false;
    if (!q) return true;
    return [r.id, r.issuer, r.subject_handle, r.type, r.reason, ...(r.evidence_urls || [])]
      .some((v) => lc(v).includes(q));
  });
}

export function sortRecords(records = [], key = 'timestamp', dir = 'desc') {
  const m = dir === 'asc' ? 1 : -1;
  return [...records].sort((a, b) => {
    const av = key === 'signature_valid' ? String(a[key] !== false) : lc(a[key]);
    const bv = key === 'signature_valid' ? String(b[key] !== false) : lc(b[key]);
    return av < bv ? -m : av > bv ? m : 0;
  });
}

export function paginate(items = [], page = 1, size = 10) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const p = Math.min(Math.max(1, page), pages);
  return { page: p, pages, total: items.length, items: items.slice((p - 1) * size, p * size) };
}

export const CSV_COLUMNS = ['id', 'issuer', 'subject_handle', 'type', 'reason', 'evidence_urls', 'timestamp', 'signature_valid'];

function csvCell(v) {
  let s = Array.isArray(v) ? v.join(' ') : String(v ?? '');
  // Guard against spreadsheet formula injection from attacker-controlled text.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(records = []) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of records) lines.push(CSV_COLUMNS.map((c) => csvCell(r[c])).join(','));
  return lines.join('\n');
}

/**
 * How many independent trusted projects denounced each handle.
 * @param {Set<string>|null} trusted project ids in the viewer's trust graph (null = everyone)
 */
export function denounceCounts(records = [], trusted = null) {
  const by = new Map();
  for (const r of records) {
    if (r.type !== 'denounce' || r.signature_valid === false) continue;
    if (trusted && !trusted.has(r.issuer)) continue;
    const h = lc(r.subject_handle);
    if (!by.has(h)) by.set(h, new Set());
    by.get(h).add(r.issuer);
  }
  return new Map([...by].map(([h, s]) => [h, s.size]));
}
