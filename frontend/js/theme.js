// Light/dark theme. CSS tokens in base.css are the single source of colour;
// canvas and Cytoscape code read them here and redraw on the 'theme' event.

import { prefs, setPref, on, emit } from './state.js';

let cache = null;

export const currentTheme = () => (prefs.theme === 'dark' ? 'dark' : 'light');

export function applyTheme() {
  document.documentElement.dataset.theme = currentTheme();
  cache = null;
  emit('theme', currentTheme());
}

export function toggleTheme() {
  setPref('theme', currentTheme() === 'dark' ? 'light' : 'dark');
}

on('prefs', ({ key }) => { if (key === 'theme') applyTheme(); });

/** Resolved token values for canvas drawing. */
export function colors() {
  if (cache) return cache;
  const cs = getComputedStyle(document.documentElement);
  const v = (name) => cs.getPropertyValue(name).trim();
  cache = {
    dark: currentTheme() === 'dark',
    bg: v('--canvas-bg'), grid: v('--canvas-grid'), node: v('--canvas-node'), surface: v('--surface'),
    text: v('--text'), muted: v('--muted'), dim: v('--dim'),
    accent: v('--accent'), accentRgb: v('--accent-rgb'), accent2Rgb: v('--accent-2-rgb'),
    ok: v('--ok'), warn: v('--warn'), bad: v('--bad'), badRgb: v('--bad-rgb'),
  };
  return cache;
}

export const rgba = (rgb, a) => `rgba(${rgb}, ${a})`;
