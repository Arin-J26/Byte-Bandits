// Maintainer portal: sign in, or sign up with a GitHub username and a password.
// Sign-up checks the username exists on GitHub and that it is listed as a maintainer of an uploaded project.

import { h, clear } from '../dom.js';
import { api } from '../api.js';

export async function mount(root, { onSignedIn }) {
  let mode = 'signin';
  const login = h('input', { class: 'input mono', id: 'login-user', autocomplete: 'username', required: true, maxlength: '39',
    placeholder: 'your GitHub username', aria: { label: 'GitHub username' } });
  const pass = h('input', { class: 'input', id: 'login-pass', type: 'password', required: true, maxlength: '200',
    autocomplete: 'current-password', aria: { label: 'Password' } });
  const error = h('div', { class: 'alert', role: 'alert', hidden: true });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Sign in');
  const tabIn = h('button', { type: 'button', role: 'tab', 'aria-selected': 'true' }, 'Sign in');
  const tabUp = h('button', { type: 'button', role: 'tab', 'aria-selected': 'false' }, 'Sign up');
  const hint = h('p', { class: 'hint' });

  function setMode(next) {
    mode = next;
    tabIn.setAttribute('aria-selected', String(mode === 'signin'));
    tabUp.setAttribute('aria-selected', String(mode === 'signup'));
    submit.textContent = mode === 'signin' ? 'Sign in' : 'Create account';
    pass.setAttribute('autocomplete', mode === 'signin' ? 'current-password' : 'new-password');
    hint.textContent = mode === 'signin'
      ? 'Use the GitHub username and the Sniffer password you created.'
      : 'Your GitHub username must exist and be listed as a maintainer in an uploaded project file. The password is local to Sniffer (min. 10 characters).';
    error.hidden = true;
  }
  tabIn.addEventListener('click', () => setMode('signin'));
  tabUp.addEventListener('click', () => setMode('signup'));

  const form = h('form', { class: 'panel auth-card', aria: { label: 'Maintainer sign in' } },
    h('p', { class: 'eyebrow' }, 'Maintainer portal'),
    h('h1', {}, 'Welcome back to Sniffer'),
    h('div', { class: 'seg', role: 'tablist' }, tabIn, tabUp),
    h('div', { class: 'field' }, h('label', { for: 'login-user' }, 'GitHub username'), login),
    h('div', { class: 'field' }, h('label', { for: 'login-pass' }, 'Password'), pass),
    hint, error, submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    submit.disabled = true;
    try {
      const who = mode === 'signin'
        ? await api.signIn(login.value.trim(), pass.value)
        : await api.signUp(login.value.trim(), pass.value);
      pass.value = '';
      onSignedIn(who.login);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });
  clear(root, h('section', { class: 'auth-wrap' }, form));
  setMode('signin');
  login.focus();
}
