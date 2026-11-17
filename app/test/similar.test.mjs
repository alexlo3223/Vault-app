import { test } from 'node:test';
import assert from 'node:assert/strict';
import { related, sentences, suggestTags, summarize, terms } from '../public/similar.mjs';

const docs = [
  { path: 'Dune.md', name: 'Dune', content: 'Dune es una novela de ciencia ficción sobre especia, arena y un duque en Arrakis. La especia da poderes.' },
  { path: 'Foundation.md', name: 'Foundation', content: 'Foundation, otra novela de ciencia ficción: imperios, psicohistoria y una galaxia en declive.' },
  { path: 'Receta.md', name: 'Receta', content: 'Para el bizcocho bate los huevos con azúcar, añade harina y hornea veinte minutos.' },
  { path: 'Vacia.md', name: 'Vacia', content: 'Sí.' },
];

test('stop words, numbers and short words are not terms; accents are kept', () => {
  assert.deepEqual(terms('El año 2026 es de Ana, y la novela'), ['año', 'ana', 'novela']);
});

test('a note is related to the notes that share its words, the closest first, never to itself', () => {
  const r = related(docs, 'Dune.md', 5);
  assert.equal(r[0].path, 'Foundation.md', 'the other science-fiction novel is the closest');
  assert.ok(r.every((x) => x.path !== 'Dune.md'));
  assert.ok(!r.some((x) => x.path === 'Receta.md'), 'a note with no words in common is not related');
  assert.deepEqual(related(docs, 'Vacia.md'), [], 'a note with no usable words has nothing related');
});

test('the summary keeps the sentences of the note, in their order, and invents nothing', () => {
  const text = 'La especia es el recurso más valioso del planeta. Hoy hace buen tiempo en la ciudad. La especia da poderes a quien la consume. Los gusanos viven bajo la arena del desierto.';
  const s = summarize(text, 2);
  assert.equal(s.length, 2);
  for (const sentence of s) assert.ok(text.includes(sentence), `"${sentence}" is in the note`);
  assert.deepEqual(s, [...s].sort((a, b) => text.indexOf(a) - text.indexOf(b)), 'original order');
  assert.ok(s.some((x) => x.includes('especia')), 'the sentences that repeat the main word win');
});

test('a short note is its own summary, and code and headings are not sentences', () => {
  assert.deepEqual(summarize('Una frase con cuatro palabras.', 3), ['Una frase con cuatro palabras.']);
  assert.deepEqual(sentences('# Título\n\n```\nlet x = 1 de la vida\n```\n'), []);
});

test('tag suggestions are the words that make the note different, without its existing tags', () => {
  const tags = suggestTags(docs, 'Dune.md', 3, ['#novela']);
  assert.ok(tags.length > 0 && tags.length <= 3);
  assert.ok(!tags.includes('novela'), 'an existing tag is not suggested again');
  assert.ok(tags.includes('arrakis') || tags.includes('especia') || tags.includes('duque'), 'a word only this note has comes first');
  assert.deepEqual(suggestTags(docs, 'no-existe.md'), []);
});
