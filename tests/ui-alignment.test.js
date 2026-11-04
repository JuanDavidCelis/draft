import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = file => readFileSync(resolve(root, file), 'utf8');

test('Draft Board mirrors the red-side card so its champion portrait is on the outer right edge', () => {
  const app = read('assets/js/app.js');
  const css = read('assets/css/styles.css');
  assert.match(app, /const slotContent = team === 'red'/);
  assert.match(app, /\$\{actionMarkup\}\$\{copyMarkup\}\$\{avatarMarkup\}/);
  assert.match(css, /\.red-column \.pick-entry \.pick-slot\s*\{\s*grid-template-columns:20px minmax\(0,1fr\) 39px;/);
  assert.match(css, /\.red-column \.pick-entry \.pick-slot>\.champion-avatar\{grid-column:3;grid-row:1;justify-self:end\}/);
});

test('potential lane priority shows portraits at opposite outer edges with the champion names facing VS', () => {
  const app = read('assets/js/app.js');
  const css = read('assets/css/styles.css');
  assert.match(app, /class="lane-team-chip own">\$\{ownAvatar\}<strong>/);
  assert.match(app, /class="lane-team-chip enemy"><strong>.*\$\{enemyAvatar\}/);
  assert.match(css, /#view-draft \.lane-matchup\s*\{\s*display:grid;/);
  assert.match(css, /#view-draft \.lane-team-chip\.enemy\s*\{[\s\S]*?justify-content:space-between;/);
});
