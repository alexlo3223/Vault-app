// Similar notes, a short summary and tag suggestions, computed from the text alone (TF-IDF and sentence scoring).
// Not generative: every sentence and tag comes from the note itself. Pure, shared by the server and the editor.

const STOP = new Set([
  // Spanish
  'a', 'al', 'algo', 'como', 'con', 'de', 'del', 'el', 'ella', 'ellas', 'ellos', 'en', 'era', 'es', 'esa', 'ese', 'eso', 'esta', 'este',
  'esto', 'fue', 'ha', 'han', 'hay', 'la', 'las', 'le', 'les', 'lo', 'los', 'me', 'mi', 'muy', 'no', 'nos', 'o', 'para', 'pero', 'por',
  'porque', 'que', 'qué', 'se', 'si', 'sí', 'sin', 'sobre', 'son', 'su', 'sus', 'también', 'te', 'tiene', 'todo', 'un', 'una', 'uno', 'y', 'ya',
  // English
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the',
  'this', 'to', 'was', 'were', 'will', 'with',
]);

// Words of three letters or more, lower-cased, without stop words or pure numbers.
export function terms(text) {
  const out = [];
  for (const m of String(text).toLowerCase().matchAll(/[\p{L}][\p{L}\p{N}_-]*/gu)) {
    const w = m[0];
    if (w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)) out.push(w);
  }
  return out;
}

// Inverse document frequency over the whole vault: a word that appears in every note tells nothing about one of them.
function idfOf(docs) {
  const df = new Map();
  for (const d of docs) for (const w of new Set(d.terms)) df.set(w, (df.get(w) ?? 0) + 1);
  const n = docs.length;
  const idf = new Map();
  for (const [w, c] of df) idf.set(w, Math.log((n + 1) / (c + 1)) + 1);
  return idf;
}

// Each document as a weighted term vector: term frequency (divided by its length) times idf.
function vectorOf(tokens, idf) {
  const tf = new Map();
  for (const w of tokens) tf.set(w, (tf.get(w) ?? 0) + 1);
  const v = new Map();
  for (const [w, c] of tf) v.set(w, (c / tokens.length) * (idf.get(w) ?? 1));
  return v;
}

const cosine = (a, b) => {
  let dot = 0;
  for (const [w, x] of a) if (b.has(w)) dot += x * b.get(w);
  const na = Math.sqrt([...a.values()].reduce((s, x) => s + x * x, 0));
  const nb = Math.sqrt([...b.values()].reduce((s, x) => s + x * x, 0));
  return na && nb ? dot / (na * nb) : 0;
};

// docs: [{ path, name, content }]. Returns the n notes closest to `target` (not the note itself), best first.
export function related(docs, target, n = 5) {
  const prepared = docs.map((d) => ({ ...d, terms: terms(d.content) }));
  const idf = idfOf(prepared);
  const vectors = new Map(prepared.map((d) => [d.path, vectorOf(d.terms, idf)]));
  const base = vectors.get(target);
  if (!base || !base.size) return [];
  return prepared
    .filter((d) => d.path !== target)
    .map((d) => ({ path: d.path, name: d.name, score: cosine(base, vectors.get(d.path)) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, n)
    .map((r) => ({ ...r, score: Math.round(r.score * 1000) / 1000 }));
}

// Sentences of a text, in order, without markup and headings.
export function sentences(text) {
  return String(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#+\s*/gm, '')
    .replace(/[*_`>[\]]/g, '')
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 4);
}

// The n sentences that carry the most frequent words of the note, shown in their original order. Never invents text.
export function summarize(text, n = 3) {
  const all = sentences(text);
  if (all.length <= n) return all;
  const freq = new Map();
  for (const w of terms(text)) freq.set(w, (freq.get(w) ?? 0) + 1);
  const score = (s) => {
    const ws = terms(s);
    return ws.length ? ws.reduce((t, w) => t + (freq.get(w) ?? 0), 0) / Math.sqrt(ws.length) : 0;
  };
  const best = all.map((s, i) => ({ s, i, v: score(s) })).sort((a, b) => b.v - a.v || a.i - b.i).slice(0, n);
  return best.sort((a, b) => a.i - b.i).map((x) => x.s);
}

// The words that make this note different from the others, skipping tags it already has.
export function suggestTags(docs, target, n = 5, existing = []) {
  const prepared = docs.map((d) => ({ ...d, terms: terms(d.content) }));
  const idf = idfOf(prepared);
  const me = prepared.find((d) => d.path === target);
  if (!me) return [];
  const skip = new Set(existing.map((t) => t.toLowerCase().replace(/^#/, '')));
  return [...vectorOf(me.terms, idf)]
    .filter(([w]) => !skip.has(w))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([w]) => w);
}
