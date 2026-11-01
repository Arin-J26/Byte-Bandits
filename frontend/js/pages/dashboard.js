// Dashboard: every project the signed-in maintainer is listed on, with its numbers. Click one to open it.

import { h, clear, emptyState } from '../dom.js';
import { meter } from '../widgets.js';
import { api } from '../api.js';

export async function mount(root) {
  const data = await api.dashboard();
  const list = h('div', { class: 'project-grid' });
  const cards = data.projects.map((p) => h('article', { class: 'panel project-card' },
    h('div', { class: 'row' }, h('h2', {}, p.name), h('span', { class: 'spacer' }),
      p.unclassified ? h('span', { class: 'badge warn' }, `${p.unclassified} to classify`) : h('span', { class: 'badge live' }, 'Classified')),
    h('p', { class: 'hint mono' }, p.github),
    h('div', { class: 'stats' },
      stat('Merged PRs', p.merged_prs, ''), stat('Trust edges', p.trust_edges, 'cyan'), stat('Vouchers', p.vouchers, 'ok'),
      stat('Denounces', p.denounces, 'bad'), stat('Flagged', p.flagged_accounts, 'bad'), stat('Campaigns', p.campaigns, 'warn')),
    meter(p.spam_weight, { label: 'Spam weight across classified PRs' }),
    h('div', { class: 'row' }, h('a', { class: 'btn btn-primary', href: `#/p/${encodeURIComponent(p.id)}/overview` }, 'Open project →'))));
  list.append(...cards);

  clear(root, h('section', { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Your projects'),
        h('p', {}, `Signed in as ${data.login}. Choose a project to open its overview.`)),
    ),
    data.projects.length ? list : emptyState({ icon: '◌', title: 'No projects yet', text: 'Upload a project zip that lists you as a maintainer.' }),
  ));
}

function stat(label, value, tone) {
  return h('div', { class: `stat ${tone}` }, h('div', { class: 'stat-num' }, String(value)), h('div', { class: 'stat-label' }, label));
}
