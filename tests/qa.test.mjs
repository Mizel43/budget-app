import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('основные live regions и dialogs имеют доступные имена', async () => {
  const html = await read('../index.html');
  assert.match(html, /id="status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="errorNotice"[^>]*role="alert"/);
  assert.match(html, /id="migrationDialog"[^>]*aria-labelledby="migrationTitle"/);
  assert.match(html, /id="editorDialog"[^>]*aria-labelledby="editorTitle"/);
  assert.match(html, /id="nextPeriodDialog"[^>]*aria-labelledby="nextPeriodTitle"/);
  assert.match(html, /<caption class="sr-only">Доходы текущего периода<\/caption>/);
});

test('mobile CSS сохраняет tap targets, focus и keyboard-safe navigation', async () => {
  const css = await read('../css/styles.css');
  assert.match(css, /\.button\.small\s*\{[^}]*min-height:\s*44px/);
  assert.match(css, /\.brand\s*\{[^}]*min-height:\s*44px/);
  assert.match(css, /\.brand:focus-visible/);
  assert.match(css, /body:has\(input:focus\) \.bottom-nav/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test('production не содержит тяжёлых UI-зависимостей и whole-state save', async () => {
  const [html, repository] = await Promise.all([read('../index.html'), read('../js/repository.js')]);
  assert.doesNotMatch(html, /react|vue|chart\.js|serviceWorker/i);
  assert.doesNotMatch(repository, /getStateFromUI|saveWholeState|setDoc\(/);
  assert.match(repository, /runTransaction\(db/);
});

test('в интерфейсе есть детали, категории и аналитика без chart-зависимости', async () => {
  const [html, app, analytics] = await Promise.all([read('../index.html'), read('../js/app.js'), read('../js/analytics.js')]);
  assert.match(html, /data-target="details"/);
  assert.match(html, /Детали расходов/);
  assert.match(html, /Архив категорий/);
  assert.match(app, /todayDateKeyInTimeZone/);
  assert.match(analytics, /conic-gradient/);
});

test('production использует CNY и не содержит обозначений старой валюты', async () => {
  const [html, presentation, fixture] = await Promise.all([
    read('../index.html'),
    read('../js/presentation.js'),
    read('./fixtures/ui-qa.html'),
  ]);
  assert.match(presentation, /currency:\s*'CNY'/);
  assert.match(presentation, /currencyDisplay:\s*'narrowSymbol'/);
  const legacyCurrency = new RegExp(['\\u20bd', '\\bR' + 'UB\\b', 'руб' + 'л'].join('|'), 'i');
  assert.doesNotMatch(`${html}\n${presentation}\n${fixture}`, legacyCurrency);
  assert.match(html, /class="paw-badge"[\s\S]*?<ellipse[\s\S]*?<ellipse[\s\S]*?<ellipse[\s\S]*?<ellipse/);
});
