// Small shared pieces: the spam-weight meter, the maintainer's decision badge, and the Block / Accept controls.
// A decision is set only when the maintainer clicks; nothing here decides for them.

import { h, toast } from './dom.js';
import { api } from './api.js';

export function meter(percent, { label = 'Spam weight', compact = false } = {}) {
  const value = percent == null ? null : Math.max(0, Math.min(100, percent));
  const tone = value == null ? 'dim' : value >= 50 ? 'bad' : value >= 20 ? 'warn' : 'ok';
  if (compact) {
    return h('div', { class: `meter compact`, role: 'meter', aria: { label, valuemin: '0', valuemax: '100', valuenow: value == null ? '' : String(value), valuetext: value == null ? 'not classified yet' : `${value}% spam` } },
      h('div', { class: 'meter-head' }, h('span', { class: `mono tone-${tone}` }, value == null ? '—' : `${value}%`)),
      h('div', { class: 'bar-track' }, h('div', { class: `bar-fill tone-${tone}`, style: { width: `${value ?? 0}%` } })));
  }
  return h('div', { class: 'meter', role: 'meter', aria: { label, valuemin: '0', valuemax: '100', valuenow: value == null ? '' : String(value), valuetext: value == null ? 'not classified yet' : `${value}% spam` } },
    h('div', { class: 'meter-head' }, h('span', { class: 'hint' }, label),
      h('span', { class: `mono tone-${tone}` }, value == null ? '—' : `${value}%`)),
    h('div', { class: 'bar-track' }, h('div', { class: `bar-fill tone-${tone}`, style: { width: `${value ?? 0}%` } })));
}

export function decisionBadge(decision) {
  if (decision === 'block') return h('span', { class: 'badge bad' }, h('span', { 'aria-hidden': 'true' }, '✕'), 'Blocked by you');
  if (decision === 'accept') return h('span', { class: 'badge live' }, h('span', { 'aria-hidden': 'true' }, '✓'), 'Accepted by you');
  return h('span', { class: 'badge' }, h('span', { 'aria-hidden': 'true' }, '…'), 'No decision');
}

/** Block / Accept / Clear for one contributor. `onChange(decision)` runs after the server confirms. */
export function decisionControls(projectId, handle, decision, onChange) {
  const set = async (action) => {
    try {
      const out = await api.setDecision(projectId, handle, action);
      toast(out.decision ? `${handle}: ${out.decision === 'block' ? 'blocked' : 'accepted'} by you` : `${handle}: decision cleared`, 'ok', 2500);
      onChange(out.decision);
    } catch (err) {
      toast(err.message, 'bad', 4000);
    }
  };
  return h('div', { class: 'row', role: 'group', aria: { label: `Your decision for ${handle}` } },
    h('button', { class: 'btn btn-sm btn-danger', type: 'button', aria: { pressed: String(decision === 'block') }, on: { click: () => set('block') } }, '✕ Block'),
    h('button', { class: 'btn btn-sm', type: 'button', aria: { pressed: String(decision === 'accept') }, on: { click: () => set('accept') } }, '✓ Accept'),
    decision ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', on: { click: () => set('clear') } }, 'Clear') : null);
}
