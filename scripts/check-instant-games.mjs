import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const playHtml = read('upload/play.html');
const gamesHtml = read('upload/games.html');
const clientJs = read('upload/instant-games.js');
const gamesCss = read('upload/games.css');

const errors = [];
const ids = [...playHtml.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
if (duplicateIds.length) errors.push(`Duplicate play-page ids: ${duplicateIds.join(', ')}`);

const requiredIds = [
  'gameStage', 'gameScene', 'gameResult', 'resultEyebrow', 'resultValue',
  'resultMessage', 'resultReplay', 'gameOptions', 'gameStake', 'stakeMinus',
  'stakePlus', 'instantChips', 'sessionMeter', 'sessionMultiplier',
  'sessionReturn', 'primaryAction', 'actionEyebrow', 'actionLabel',
  'cashoutAction', 'gameNote', 'instantHistory', 'historyStatus',
  'gameKicker', 'gameTitle', 'gameSubtitle', 'consoleTitle', 'consoleIcon'
];
const missingIds = requiredIds.filter(id => !ids.includes(id));
if (missingIds.length) errors.push(`Missing play-page controls: ${missingIds.join(', ')}`);

const games = ['crossing', 'mines', 'plinko', 'tower', 'dice', 'limbo'];
for (const game of games) {
  if (!gamesHtml.includes(`play.html?game=${game}`)) {
    errors.push(`Missing hub link for ${game}`);
  }
  if (!clientJs.includes(`${game}: {`) || !clientJs.includes(`${game}Scene`)) {
    errors.push(`Missing client definition or scene for ${game}`);
  }
  if (!gamesCss.includes(`[data-game="${game}"]`)) {
    errors.push(`Missing theme for ${game}`);
  }
}

const localAssets = [...gamesCss.matchAll(/url\("([^"]+)"\)/g)]
  .map(match => match[1])
  .filter(asset => !asset.startsWith('data:'));
for (const asset of localAssets) {
  if (!fs.existsSync(path.join(root, 'upload', asset))) {
    errors.push(`Missing CSS asset: ${asset}`);
  }
}

if (!clientJs.includes("rpc('instant_game_start'")) {
  errors.push('Game start RPC is not wired');
}
if (!clientJs.includes("rpc('instant_game_action'")) {
  errors.push('Progressive game action RPC is not wired');
}
if (!clientJs.includes("rpc('instant_game_state'")) {
  errors.push('Round restore RPC is not wired');
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`Ace Originals check passed: ${games.length} games, ${requiredIds.length} controls, ${localAssets.length} local assets.`);
