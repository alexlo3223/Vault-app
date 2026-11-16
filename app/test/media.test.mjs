import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookmarkLine, bookmarkParts, isBookmark, mediaKind, parse, serialize } from '../public/blocks.mjs';

test('a web bookmark line is kept exactly and read back into its address and title', () => {
  const line = bookmarkLine('https://example.com/a', 'Example article');
  assert.equal(isBookmark(line), true);
  assert.deepEqual(bookmarkParts(line), { url: 'https://example.com/a', title: 'Example article' });
  const md = `${line}\n`;
  assert.deepEqual(parse(md).blocks.map((b) => b.type), ['bookmark']);
  assert.equal(serialize(parse(md)), md);
});

test('bookmarks refuse plain-http and markup in the title', () => {
  assert.equal(isBookmark('<a class="bookmark" href="http://example.com">x</a>'), false);
  assert.equal(bookmarkLine('https://example.com', '<b>bold</b>'), '<a class="bookmark" href="https://example.com">bbold/b</a>');
});

test('stored files are shown as pictures, videos, audio, or a download card', () => {
  assert.equal(mediaKind('photo.PNG'), 'image');
  assert.equal(mediaKind('clip.mp4'), 'video');
  assert.equal(mediaKind('song.m4a'), 'audio');
  assert.equal(mediaKind('report.pdf'), 'file');
  assert.equal(mediaKind('no-extension'), 'file');
});
