const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window: {} };
const source = fs.existsSync('js/mine-icons.js') ? fs.readFileSync('js/mine-icons.js', 'utf8') : '';
vm.runInNewContext(source, context);
const mineIcons = context.window.MineIcons;

function api() {
  assert.ok(mineIcons, 'mine SVG helpers are available');
  return mineIcons;
}

test('captured mine SVGs keep faction shields and no flag', () => {
  const { mineSvg } = api();
  const blue = mineSvg('blue', true);
  const red = mineSvg('red', true);
  const neutral = mineSvg(null, false);

  assert.match(blue, /class="mine-svg owner-blue capture"/);
  assert.match(blue, /class="mine-glyph capture"/);
  assert.doesNotMatch(blue, /mine-flag|capture-flag/);
  assert.match(blue, /#3d8bfd/i);
  assert.match(red, /class="mine-svg owner-red capture"/);
  assert.match(red, /class="mine-glyph capture"/);
  assert.doesNotMatch(red, /mine-flag|capture-flag/);
  assert.match(red, /#f04444/i);
  assert.match(neutral, /class="mine-svg neutral"/);
  assert.doesNotMatch(neutral, /mine-flag|capture-flag/);
});

test('shield contains a dark 3D mine with a fuse rather than the silver counter symbol', () => {
  for (const side of ['blue', 'red']) {
    const shield = api().mineSvg(side, true);
    const embeddedMine = shield.match(/<svg class="mine-glyph capture"[^>]*>([\s\S]*?)<\/svg>/)?.[1];
    assert.ok(embeddedMine, 'shield contains its own mine artwork');
    assert.match(embeddedMine, /class="mine-fuse"/);
    assert.match(embeddedMine, /class="mine-body"/);
    assert.match(embeddedMine, /class="mine-highlight"/);
    assert.match(embeddedMine, /stop-color="#03070e"/);
    assert.doesNotMatch(embeddedMine, /stop-color="#cbd5e1"/);
    assert.doesNotMatch(shield, /\bfilter\s*[:=]|<filter\b/, 'capture artwork must not reintroduce the Chromium filter freeze');
  }
});

test('captured mine leaves breathing room inside the shield without becoming illegible', () => {
  const shield = api().mineSvg('blue', true);
  const outer = shield.match(/<svg class="mine-svg[^\"]*"[^>]*viewBox="0 0 (\d+) (\d+)"/);
  const inner = shield.match(/<svg class="mine-glyph[^\"]*" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" viewBox="0 0 (\d+) (\d+)"/);

  assert.ok(outer, 'shield declares its drawing bounds');
  assert.ok(inner, 'embedded current mine declares its drawing bounds');
  const bodyRadius = shield.match(/class="mine-body"[^>]*r="([\d.]+)"/)?.[1];
  assert.ok(bodyRadius, 'mine body declares its visible radius');
  const artworkFraction = Number(inner[3]) * Number(bodyRadius) * 2 / (Number(inner[5]) * Number(outer[1]));
  assert.ok(artworkFraction >= 0.35 && artworkFraction <= 0.5,
    `mine body must remain legible while leaving shield space (got ${(artworkFraction * 100).toFixed(1)}%)`);
  const bodyCenterY = shield.match(/class="mine-body"[^>]*cy="([\d.]+)"/)?.[1];
  const bodyBottom = Number(inner[2]) + (Number(bodyCenterY) + Number(bodyRadius)) * Number(inner[4]) / Number(inner[6]);
  assert.ok(bodyBottom <= Number(outer[2]) * 0.78, 'mine body leaves the shield tip visible');
});

test('attack-bomb and remaining-mine SVGs have visually distinct red and neutral identities', () => {
  const { bombSvg, counterMineSvg } = api();
  const bomb = bombSvg();
  const counterMine = counterMineSvg();

  assert.match(bomb, /class="attack-bomb-svg"/);
  assert.match(bomb, /#f04444/i);
  assert.match(counterMine, /class="counter-mine-svg"/);
  assert.match(counterMine, /#aab5c8/i);
  assert.doesNotMatch(counterMine, /#f04444/i);
});
