import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COVER_KEYS, FRAME_KEYS, coverPatch, coverSrc, describe, frameRect, frameStyle, isImageRef, posFromFrame, readCover, reframe, removePatch, visible } from '../public/cover.mjs';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ''} ${a} ≉ ${b}`);

test('a banner with nothing set is centred, as banners always were', () => {
  assert.deepEqual(readCover({ cover: 'a.png' }), { src: 'a.png', x: 50, y: 50, zoom: 1, height: 220 });
  assert.deepEqual(readCover({}), { src: '', x: 50, y: 50, zoom: 1, height: 220 });
  assert.deepEqual(readCover(), { src: '', x: 50, y: 50, zoom: 1, height: 220 });
});

test('framing values are read with limits, and nonsense falls back to the defaults', () => {
  assert.deepEqual(readCover({ cover: ' a.png ', cover_x: '30', cover_y: '12.5', cover_zoom: '1.5', cover_height: '300' }), { src: 'a.png', x: 30, y: 12.5, zoom: 1.5, height: 300 });
  const wild = readCover({ cover_x: '-20', cover_y: '900', cover_zoom: '9', cover_height: '50' });
  assert.deepEqual([wild.x, wild.y, wild.zoom, wild.height], [0, 100, 3, 120]);
  const junk = readCover({ cover_x: 'left', cover_y: '', cover_zoom: 'big', cover_height: 'tall' });
  assert.deepEqual([junk.x, junk.y, junk.zoom, junk.height], [50, 50, 1, 220]);
});

test('an image comes from https or from a file of the vault, never from other schemes', () => {
  assert.equal(coverSrc('https://example.com/a.jpg', 'N.md'), 'https://example.com/a.jpg');
  assert.equal(coverSrc('https://example.com/photo?id=1', 'N.md'), 'https://example.com/photo?id=1'); // no extension needed
  assert.equal(coverSrc('banner.png', 'Tutorial/A.md'), '/api/file?link=banner.png&from=Tutorial%2FA.md');
  assert.equal(coverSrc('attachments/my banner.PNG', 'A.md'), '/api/file?link=attachments%2Fmy%20banner.PNG&from=A.md');
  assert.equal(coverSrc('![[b.webp]]', 'A.md'), '/api/file?link=b.webp&from=A.md');
  assert.equal(coverSrc('[[b.jpg|alias]]', 'A.md'), '/api/file?link=b.jpg&from=A.md');
  for (const bad of ['http://example.com/a.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'file:///c:/a.png', 'notes.pdf', 'page', '', '   ', undefined]) assert.equal(coverSrc(bad, 'A.md'), '', String(bad));
});

test('an icon can be an emoji or an image', () => {
  assert.equal(isImageRef('icon.png'), true);
  assert.equal(isImageRef('![[icon.png]]'), true);
  assert.equal(isImageRef('https://example.com/i'), true);
  assert.equal(isImageRef('🌊'), false);
  assert.equal(isImageRef(''), false);
  assert.equal(isImageRef('notes.pdf'), false);
});

test('how much of the image shows: the axis that fills the banner shows all of it', () => {
  // a wide image in a wide banner: the image is cut at top and bottom
  const wide = visible(1920, 720, 1000, 220);
  assert.equal(wide.w, 1);
  near(wide.h, (220 / 1000) * (1920 / 720), 'height fraction');
  // a tall image: cut at the sides
  const tall = visible(600, 1200, 1000, 220);
  near(tall.h, 220 / (1000 * (1200 / 600)), 'tall: height fraction');
  assert.equal(tall.w, 1);
  // exactly the shape of the banner: all of it
  assert.deepEqual(visible(1000, 220, 1000, 220), { w: 1, h: 1 });
  // an image smaller than the banner is scaled up, never shown at a fraction above 1
  const small = visible(100, 50, 1000, 220);
  assert.ok(small.w <= 1 && small.h <= 1);
  // zoom shows proportionally less
  const z2 = visible(1920, 720, 1000, 220, 2);
  near(z2.w, 0.5, 'zoom 2 width');
  near(z2.h, wide.h / 2, 'zoom 2 height');
  // unusable sizes do not break anything
  assert.deepEqual(visible(0, 0, 1000, 220), { w: 1, h: 1 });
});

test('the visible window follows x/y: centred, at the top, at the bottom, and back', () => {
  const vis = visible(1920, 720, 1000, 220);
  const mid = frameRect(vis, 50, 50);
  near(mid.top, (1 - vis.h) / 2);
  near(mid.height, vis.h);
  assert.equal(frameRect(vis, 50, 0).top, 0);
  near(frameRect(vis, 50, 100).top + vis.h, 1, 'bottom edge touches the image');
  for (const y of [0, 17.5, 50, 83, 100]) {
    const f = frameRect(vis, 50, y);
    const back = posFromFrame(vis, f.left, f.top);
    near(back.y, y, `y ${y}`);
    assert.equal(back.x, 50); // all of the width shows: nothing to choose
  }
  // dragging past the edges is held at the edges
  assert.equal(posFromFrame(vis, 0, -0.5).y, 0);
  assert.equal(posFromFrame(vis, 0, 5).y, 100);
});

test('both axes move when both have room (zoomed in)', () => {
  const vis = visible(1920, 720, 1000, 220, 2);
  for (const [x, y] of [[0, 0], [100, 100], [30, 70], [50, 50]]) {
    const f = frameRect(vis, x, y);
    const back = posFromFrame(vis, f.left, f.top);
    near(back.x, x, `x ${x}`);
    near(back.y, y, `y ${y}`);
  }
});

test('changing the zoom or the height keeps the middle of the window where it was', () => {
  const img = { w: 1920, h: 720 };
  const from = { x: 20, y: 80, zoom: 1, height: 220 };
  const centre = (vis, pos) => {
    const f = frameRect(vis, pos.x, pos.y);
    return [f.left + vis.w / 2, f.top + vis.h / 2];
  };
  const before = centre(visible(img.w, img.h, 1000, 220, 1), from);
  const zoomed = reframe(img, 1000, from, { zoom: 2 });
  const after = centre(visible(img.w, img.h, 1000, 220, 2), zoomed);
  near(after[0], before[0], 'centre x after zoom');
  near(after[1], before[1], 'centre y after zoom');
  const taller = reframe(img, 1000, from, { height: 260 });
  const after2 = centre(visible(img.w, img.h, 1000, 260, 1), taller);
  near(after2[1], before[1], 'centre y after a taller banner');
  // a banner so tall that almost all of the image shows: the centre can only be held as near as there is room for
  const tallest = reframe(img, 1000, from, { height: 360 });
  const vis360 = visible(img.w, img.h, 1000, 360, 1);
  const c360 = centre(vis360, tallest);
  assert.ok(c360[1] >= vis360.h / 2 - 1e-9 && c360[1] <= 1 - vis360.h / 2 + 1e-9, 'stays inside the image');
  // zooming out all the way returns to a window that can only be centred on the axis with no room
  assert.equal(reframe(img, 1000, { x: 10, y: 10, zoom: 2, height: 220 }, { zoom: 1 }).x, 50);
});

test('what is visible is told in words', () => {
  assert.equal(describe({ w: 0.7123, h: 0.3301 }), 'Se ve el 71 % del ancho y el 33 % del alto de la imagen');
  assert.equal(describe({ w: 1, h: 1 }), 'Se ve el 100 % del ancho y el 100 % del alto de la imagen');
});

test('the framing becomes CSS: object-position and a zoom around the same point', () => {
  assert.deepEqual(frameStyle({ x: 30, y: 40, zoom: 2 }), { objectPosition: '30% 40%', transformOrigin: '30% 40%', transform: 'scale(2)' });
  assert.equal(frameStyle({ x: 50, y: 50, zoom: 1 }).transform, ''); // no zoom, no transform
});

test('an unchanged banner writes only its image; changes write only what differs from the defaults', () => {
  assert.deepEqual(coverPatch({ src: 'a.png', x: 50, y: 50, zoom: 1, height: 220 }), { cover: 'a.png', cover_x: '', cover_y: '', cover_zoom: '', cover_height: '' });
  assert.deepEqual(coverPatch({ src: 'a.png', x: 31.26, y: 50, zoom: 1.5, height: 300.4 }), { cover: 'a.png', cover_x: 31.3, cover_y: '', cover_zoom: 1.5, cover_height: 300 });
  assert.deepEqual(removePatch(), { cover: '', cover_x: '', cover_y: '', cover_zoom: '', cover_height: '' });
  assert.deepEqual(COVER_KEYS, ['cover', ...FRAME_KEYS]);
});
