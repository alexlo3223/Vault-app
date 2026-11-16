// Formulas for database properties, in the style of Notion: round(prop("Pages Read") / prop("Page Count") * 100) / 100.
// Pure logic (no DOM), shared by the browser and the tests. Formulas are parsed by hand into a small tree and
// evaluated against one row; nothing is passed to eval (the page's CSP forbids it, and a note must not run code).
//
// Values are numbers, strings, booleans, Dates, lists (arrays) or null (empty).

export class FormulaError extends Error {}
const fail = (msg) => {
  throw new FormulaError(msg);
};

// ---------- tokens ----------
const OPS = ['==', '!=', '>=', '<=', '&&', '||', '>', '<', '+', '-', '*', '/', '%', '^', '!', '(', ')', ',', '.', '?', ':', '[', ']', '='];

export function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const num = src.slice(i).match(/^(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?/);
    if (num) {
      out.push({ t: 'num', v: Number(num[0]), at: i });
      i += num[0].length;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) {
          const n = src[++j];
          s += n === 'n' ? '\n' : n === 't' ? '\t' : n;
        } else s += src[j];
        j++;
      }
      if (j >= src.length) fail('Hay un texto entre comillas sin cerrar');
      out.push({ t: 'str', v: s, at: i });
      i = j + 1;
      continue;
    }
    const id = src.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (id) {
      out.push({ t: 'id', v: id[0], at: i });
      i += id[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) fail(`Carácter inesperado “${c}”`);
    out.push({ t: 'op', v: op, at: i });
    i += op.length;
  }
  return out;
}

// ---------- parser: precedence climbing into { k: kind, ... } nodes ----------
export function parse(src) {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v) => peek()?.t === 'op' && peek().v === v;
  const isWord = (v) => peek()?.t === 'id' && peek().v === v;
  const expect = (v) => {
    if (!isOp(v)) fail(peek() ? `Se esperaba “${v}” pero hay “${peek().v}”` : `Se esperaba “${v}” al final`);
    p++;
  };

  const ternary = () => {
    const c = or();
    if (!isOp('?')) return c;
    p++;
    const a = ternary();
    expect(':');
    return { k: 'if', c, a, b: ternary() };
  };
  const binary = (next, ops) => () => {
    let a = next();
    for (;;) {
      const tok = peek();
      const op = tok && ((tok.t === 'op' && ops[tok.v]) || (tok.t === 'id' && ops[tok.v]));
      if (!op) return a;
      p++;
      a = { k: 'bin', op, a, b: next() };
    }
  };
  const unary = () => {
    if (isOp('-')) {
      p++;
      return { k: 'neg', a: unary() };
    }
    if (isOp('+')) {
      p++;
      return unary();
    }
    if (isOp('!') || isWord('not')) {
      p++;
      return { k: 'not', a: unary() };
    }
    return power();
  };
  const power = () => {
    const a = postfix();
    if (!isOp('^')) return a;
    p++;
    return { k: 'bin', op: '^', a, b: unary() };
  };
  const mul = binary(unary, { '*': '*', '/': '/', '%': '%' });
  const add = binary(mul, { '+': '+', '-': '-' });
  const cmp = binary(add, { '>': '>', '>=': '>=', '<': '<', '<=': '<=' });
  const eq = binary(cmp, { '==': '==', '=': '==', '!=': '!=' });
  const and = binary(eq, { '&&': 'and', and: 'and' });
  const or = binary(and, { '||': 'or', or: 'or' });

  const args = (close) => {
    const list = [];
    if (isOp(close)) {
      p++;
      return list;
    }
    for (;;) {
      list.push(ternary());
      if (isOp(',')) {
        p++;
        continue;
      }
      expect(close);
      return list;
    }
  };

  // Notion's dot form: x.f(a) is f(x, a). Binds tighter than ^ and unary minus, so -x.abs() is -(x.abs()).
  function postfix() {
    let n = primary();
    while (isOp('.')) {
      p++;
      const name = peek();
      if (!name || name.t !== 'id') fail('Se esperaba el nombre de una función después de “.”');
      p++;
      if (!isOp('(')) fail(`Escribe .${name.v}() con paréntesis`);
      p++;
      n = { k: 'call', name: name.v, args: [n, ...args(')')] };
    }
    return n;
  }

  function primary() {
    const tok = peek();
    if (!tok) fail('La fórmula termina antes de tiempo');
    p++;
    if (tok.t === 'num') return { k: 'val', v: tok.v };
    if (tok.t === 'str') return { k: 'val', v: tok.v };
    if (tok.t === 'op' && tok.v === '(') {
      const e = ternary();
      expect(')');
      return e;
    }
    if (tok.t === 'op' && tok.v === '[') return { k: 'list', items: args(']') };
    if (tok.t === 'id') {
      if (tok.v === 'true' || tok.v === 'false') return { k: 'val', v: tok.v === 'true' };
      if (isOp('(')) {
        p++;
        return { k: 'call', name: tok.v, args: args(')') };
      }
      fail(`Nombre desconocido “${tok.v}”. Usa prop("${tok.v}") para una propiedad`);
    }
    fail(`“${tok.v}” inesperado`);
  }

  if (!toks.length) fail('La fórmula está vacía');
  const tree = ternary();
  if (p < toks.length) fail(`“${toks[p].v}” inesperado`);
  return tree;
}

// ---------- values ----------
const isEmpty = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'number' && Number.isNaN(v));
const isDate = (v) => v instanceof Date;
// Optional time after the date: " 14:30", "T14:30:15", with a trailing Z or +02:00 that is read but ignored.
const TIME = '(?:[T ](\\d{1,2}):(\\d{2})(?::(\\d{2})(?:\\.\\d+)?)?(?:\\s*(?:Z|[+-]\\d{2}:?\\d{2}))?)?';
// Four-digit years only, so a half-typed year never reads as a date. Day first in the slash forms (16/11/2026).
const DATE_FORMS = [
  [new RegExp(`^(\\d{4})-(\\d{1,2})-(\\d{1,2})${TIME}$`), 'ymd'],
  [new RegExp(`^(\\d{4})/(\\d{1,2})/(\\d{1,2})${TIME}$`), 'ymd'],
  [new RegExp(`^(\\d{1,2})[/.-](\\d{1,2})[/.-](\\d{4})${TIME}$`), 'dmy'],
];

// A date that really exists, or null. A bare date is a local day, like Notion: "2026-11-16" must not shift a day
// in other time zones, and years below 100 stay what they say (new Date(2, …) would be 1902).
function makeDate(y, mo, d, h, mi, s) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const date = new Date(2000, 0, 1);
  date.setFullYear(y, mo - 1, d);
  date.setHours(h, mi, s, 0);
  // A day that does not exist (30 Feb) would roll into the next month: refuse it rather than change the date.
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date : null;
}

export function toDate(v) {
  if (isDate(v)) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  for (const [re, order] of DATE_FORMS) {
    const m = s.match(re);
    if (!m) continue;
    const [y, mo, d] = order === 'ymd' ? [m[1], m[2], m[3]] : [m[3], m[2], m[1]];
    return makeDate(Number(y), Number(mo), Number(d), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0));
  }
  return null;
}

export function toNum(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (isDate(v)) return v.getTime();
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  if (Array.isArray(v)) fail('Una lista no se puede usar como número');
  fail(`“${v}” no es un número`);
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function formatDate(d, pattern = 'MMM D, YYYY') {
  if (!d) return '';
  return pattern.replace(/YYYY|MMMM|MMM|MM|M|DD|D|HH|H|mm|ss/g, (t) => {
    switch (t) {
      case 'YYYY':
        return pad(d.getFullYear(), 4);
      case 'MMMM':
        return d.toLocaleString('es', { month: 'long' });
      case 'MMM':
        return MONTHS[d.getMonth()];
      case 'MM':
        return pad(d.getMonth() + 1);
      case 'M':
        return String(d.getMonth() + 1);
      case 'DD':
        return pad(d.getDate());
      case 'D':
        return String(d.getDate());
      case 'HH':
        return pad(d.getHours());
      case 'H':
        return String(d.getHours());
      case 'mm':
        return pad(d.getMinutes());
      default:
        return pad(d.getSeconds());
    }
  });
}

const hasTime = (d) => d.getHours() || d.getMinutes() || d.getSeconds();

export function toStr(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(10)));
  if (isDate(v)) return formatDate(v, hasTime(v) ? 'MMM D, YYYY HH:mm' : 'MMM D, YYYY');
  if (Array.isArray(v)) return v.map(toStr).join(', ');
  return String(v);
}

const truthy = (v) => !isEmpty(v) && v !== false && v !== 0;
const list = (v) => (Array.isArray(v) ? v : isEmpty(v) ? [] : [v]);
const flatNums = (args) => args.flatMap(list).filter((v) => !isEmpty(v)).map(toNum);

function compare(a, b) {
  if (isDate(a) || isDate(b)) {
    const x = toDate(a);
    const y = toDate(b);
    if (x && y) return x.getTime() - y.getTime();
  }
  const numeric = (v) => typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));
  if (numeric(a) && numeric(b)) return toNum(a) - toNum(b);
  return toStr(a).localeCompare(toStr(b), undefined, { numeric: true, sensitivity: 'base' });
}

const equal = (a, b) => {
  if (isEmpty(a) || isEmpty(b)) return isEmpty(a) && isEmpty(b);
  if (typeof a === 'boolean' || typeof b === 'boolean') return truthy(a) === truthy(b);
  if (typeof a === 'number' || typeof b === 'number' || isDate(a) || isDate(b)) return compare(a, b) === 0;
  return toStr(a) === toStr(b); // texts and lists: exact, like Notion
};

// ---------- dates ----------
const UNITS = { years: 'y', year: 'y', quarters: 'q', quarter: 'q', months: 'M', month: 'M', weeks: 'w', week: 'w', days: 'd', day: 'd', hours: 'h', hour: 'h', minutes: 'm', minute: 'm', seconds: 's', second: 's' };
const unitOf = (u) => UNITS[toStr(u).toLowerCase()] ?? fail(`Unidad de tiempo desconocida “${toStr(u)}” (usa "days", "weeks", "months", "years", …)`);
const MS = { w: 7 * 864e5, d: 864e5, h: 36e5, m: 6e4, s: 1e3 };

function dateAdd(date, n, unit) {
  const d = new Date(needDate(date).getTime());
  const u = unitOf(unit);
  const k = toNum(n);
  if (u === 'y') d.setFullYear(d.getFullYear() + k);
  else if (u === 'q') d.setMonth(d.getMonth() + 3 * k);
  else if (u === 'M') d.setMonth(d.getMonth() + k);
  else d.setTime(d.getTime() + k * MS[u]);
  return d;
}

function dateBetween(a, b, unit) {
  const x = needDate(a);
  const y = needDate(b);
  const u = unitOf(unit);
  if (u === 'y' || u === 'q' || u === 'M') {
    let months = (x.getFullYear() - y.getFullYear()) * 12 + (x.getMonth() - y.getMonth());
    // Whole months only: 31 Jan → 28 Feb is 0 months, like Notion.
    if (months > 0 && x.getDate() < y.getDate()) months--;
    if (months < 0 && x.getDate() > y.getDate()) months++;
    return Math.trunc(u === 'y' ? months / 12 : u === 'q' ? months / 3 : months);
  }
  return Math.trunc((x.getTime() - y.getTime()) / MS[u]);
}

function needDate(v) {
  const d = toDate(v);
  if (!d) fail(isEmpty(v) ? 'Hay una fecha vacía' : `“${toStr(v)}” no es una fecha`);
  return d;
}

// ---------- functions ----------
const need = (args, min, max, name) => {
  if (args.length < min || args.length > max) fail(`${name}() necesita ${min === max ? min : max === Infinity ? `${min} o más` : `de ${min} a ${max}`} argumento${max === 1 ? '' : 's'}`);
};

const regex = (pattern, flags) => {
  try {
    return new RegExp(toStr(pattern), flags);
  } catch {
    fail(`“${toStr(pattern)}” no es un patrón válido`);
  }
};

// Each entry: [min args, max args, fn(values)]. if/ifs/and/or/empty-safe ones are lazy (see evalNode).
const FN = {
  empty: [1, 1, ([v]) => isEmpty(v)],
  not: [1, 1, ([v]) => !truthy(v)],
  length: [1, 1, ([v]) => (Array.isArray(v) ? v.length : toStr(v).length)],
  concat: [1, Infinity, (a) => (a.some(Array.isArray) ? a.flatMap(list) : a.map(toStr).join(''))],
  join: [1, 2, ([l, sep = ', ']) => list(l).map(toStr).join(toStr(sep))],
  contains: [2, 2, ([a, b]) => (Array.isArray(a) ? a.some((x) => equal(x, b)) : toStr(a).includes(toStr(b)))],
  includes: [2, 2, ([a, b]) => (Array.isArray(a) ? a.some((x) => equal(x, b)) : toStr(a).includes(toStr(b)))],
  replace: [3, 3, ([s, p, r]) => toStr(s).replace(regex(p, ''), toStr(r))],
  replaceAll: [3, 3, ([s, p, r]) => toStr(s).replace(regex(p, 'g'), toStr(r))],
  test: [2, 2, ([s, p]) => regex(p, '').test(toStr(s))],
  lower: [1, 1, ([s]) => toStr(s).toLowerCase()],
  upper: [1, 1, ([s]) => toStr(s).toUpperCase()],
  trim: [1, 1, ([s]) => toStr(s).trim()],
  slice: [2, 3, ([v, a, b]) => (Array.isArray(v) ? v : toStr(v)).slice(toNum(a), b === undefined ? undefined : toNum(b))],
  format: [1, 1, ([v]) => toStr(v)],
  toNumber: [1, 1, ([v]) => (isEmpty(v) ? null : typeof v === 'string' && !Number.isFinite(Number(v)) ? null : toNum(v))],
  round: [1, 2, ([n, d = 0]) => {
    const f = 10 ** toNum(d);
    return Math.round(toNum(n) * f) / f;
  }],
  floor: [1, 1, ([n]) => Math.floor(toNum(n))],
  ceil: [1, 1, ([n]) => Math.ceil(toNum(n))],
  abs: [1, 1, ([n]) => Math.abs(toNum(n))],
  sqrt: [1, 1, ([n]) => (toNum(n) < 0 ? null : Math.sqrt(toNum(n)))],
  pow: [2, 2, ([a, b]) => toNum(a) ** toNum(b)],
  sign: [1, 1, ([n]) => Math.sign(toNum(n))],
  min: [1, Infinity, (a) => (flatNums(a).length ? Math.min(...flatNums(a)) : null)],
  max: [1, Infinity, (a) => (flatNums(a).length ? Math.max(...flatNums(a)) : null)],
  sum: [1, Infinity, (a) => flatNums(a).reduce((s, n) => s + n, 0)],
  mean: [1, Infinity, (a) => (flatNums(a).length ? flatNums(a).reduce((s, n) => s + n, 0) / flatNums(a).length : null)],
  now: [0, 0, () => new Date()],
  today: [0, 0, () => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }],
  dateAdd: [3, 3, ([d, n, u]) => dateAdd(d, n, u)],
  dateSubtract: [3, 3, ([d, n, u]) => dateAdd(d, -toNum(n), u)],
  dateBetween: [3, 3, ([a, b, u]) => dateBetween(a, b, u)],
  formatDate: [1, 2, ([d, p]) => formatDate(needDate(d), p === undefined ? undefined : toStr(p))],
  parseDate: [1, 1, ([s]) => toDate(toStr(s))],
  year: [1, 1, ([d]) => needDate(d).getFullYear()],
  month: [1, 1, ([d]) => needDate(d).getMonth() + 1],
  date: [1, 1, ([d]) => needDate(d).getDate()],
  // Day of the week like Notion: 1 = Monday … 7 = Sunday.
  day: [1, 1, ([d]) => needDate(d).getDay() || 7],
  hour: [1, 1, ([d]) => needDate(d).getHours()],
  minute: [1, 1, ([d]) => needDate(d).getMinutes()],
  at: [2, 2, ([l, i]) => list(l)[toNum(i)] ?? null],
  first: [1, 1, ([l]) => list(l)[0] ?? null],
  last: [1, 1, ([l]) => list(l).at(-1) ?? null],
  unique: [1, 1, ([l]) => list(l).filter((x, i, a) => a.findIndex((y) => equal(x, y)) === i)],
  sort: [1, 1, ([l]) => [...list(l)].sort(compare)],
  reverse: [1, 1, ([l]) => [...list(l)].reverse()],
};

// Names people write from other tools; they mean the same as the short names above.
FN.toUpperCase = FN.upper;
FN.toLowerCase = FN.lower;

// Shown in the formula editor: [name, signature, what it does, example].
export const FUNCTIONS = [
  ['prop', 'prop("Nombre")', 'El valor de una propiedad de esta fila.', 'prop("Páginas")'],
  ['if', 'if(condición, si, si no)', 'Uno de dos valores, según la condición.', 'if(prop("Hecho"), "✅", "⏳")'],
  ['ifs', 'ifs(cond1, valor1, cond2, valor2, …, si no)', 'El valor de la primera condición que se cumple.', 'ifs(prop("Nota") > 8, "Genial", prop("Nota") > 5, "Bien", "Mal")'],
  ['round', 'round(número, decimales?)', 'Redondea a un entero, o a los decimales que digas.', 'round(3.14159, 2) = 3.14'],
  ['floor', 'floor(número)', 'Redondea hacia abajo.', 'floor(4.7) = 4'],
  ['ceil', 'ceil(número)', 'Redondea hacia arriba.', 'ceil(4.2) = 5'],
  ['abs', 'abs(número)', 'El número sin su signo.', 'abs(-3) = 3'],
  ['sqrt', 'sqrt(número)', 'Raíz cuadrada.', 'sqrt(16) = 4'],
  ['pow', 'pow(base, exponente)', 'Potencia (igual que base ^ exponente).', 'pow(2, 3) = 8'],
  ['min', 'min(a, b, …)', 'El número más pequeño (las listas se abren).', 'min(4, 1, 9) = 1'],
  ['max', 'max(a, b, …)', 'El número más grande.', 'max(4, 1, 9) = 9'],
  ['sum', 'sum(a, b, …)', 'Suma números y listas de números.', 'sum(1, 2, 3) = 6'],
  ['mean', 'mean(a, b, …)', 'La media.', 'mean(2, 4) = 3'],
  ['empty', 'empty(valor)', 'Verdadero si el valor está vacío.', 'empty(prop("Autor"))'],
  ['not', 'not(valor)', 'Lo contrario de un valor verdadero/falso.', 'not(prop("Hecho"))'],
  ['length', 'length(texto o lista)', 'Número de caracteres, o de elementos.', 'length("Dune") = 4'],
  ['concat', 'concat(a, b, …)', 'Une textos, o listas en una sola lista.', 'concat("Vol. ", 2) = "Vol. 2"'],
  ['join', 'join(lista, separador)', 'Una lista como un solo texto.', 'join(prop("Géneros"), " · ")'],
  ['contains', 'contains(texto o lista, valor)', 'Verdadero si el valor está dentro.', 'contains(prop("Géneros"), "Fantasía")'],
  ['replace', 'replace(texto, patrón, nuevo)', 'Sustituye la primera coincidencia.', 'replace("a-b-c", "-", "+") = "a+b-c"'],
  ['replaceAll', 'replaceAll(texto, patrón, nuevo)', 'Sustituye todas las coincidencias.', 'replaceAll("a-b-c", "-", "+") = "a+b+c"'],
  ['lower', 'lower(texto)', 'En minúsculas.', 'lower("Dune") = "dune"'],
  ['upper', 'upper(texto)', 'En mayúsculas.', 'upper("Dune") = "DUNE"'],
  ['slice', 'slice(texto o lista, inicio, fin?)', 'Una parte de un texto o de una lista.', 'slice("Vault", 0, 2) = "Va"'],
  ['format', 'format(valor)', 'Cualquier valor como texto.', 'format(42) = "42"'],
  ['toNumber', 'toNumber(texto)', 'Un texto como número.', 'toNumber("12") = 12'],
  ['now', 'now()', 'La fecha y la hora de ahora.', 'now()'],
  ['today', 'today()', 'Hoy, sin hora.', 'today()'],
  ['dateAdd', 'dateAdd(fecha, cantidad, unidad)', 'Suma tiempo. Unidades: "days", "weeks", "months", "years", "hours", "minutes".', 'dateAdd(prop("Inicio"), 7, "days")'],
  ['dateSubtract', 'dateSubtract(fecha, cantidad, unidad)', 'Resta tiempo.', 'dateSubtract(today(), 1, "months")'],
  ['dateBetween', 'dateBetween(fecha1, fecha2, unidad)', 'Tiempo de fecha2 a fecha1, en unidades enteras.', 'dateBetween(today(), prop("Inicio"), "days")'],
  ['formatDate', 'formatDate(fecha, patrón?)', 'Una fecha como texto. YYYY MM M DD D MMM MMMM HH mm.', 'formatDate(now(), "DD/MM/YYYY")'],
  ['year', 'year(fecha)', 'El año.', 'year(today())'],
  ['month', 'month(fecha)', 'El mes, 1–12.', 'month(today())'],
  ['date', 'date(fecha)', 'El día del mes, 1–31.', 'date(today())'],
  ['day', 'day(fecha)', 'El día de la semana, 1 (lunes) – 7 (domingo).', 'day(today())'],
];

// ---------- evaluation ----------
function evalNode(n, env) {
  switch (n.k) {
    case 'val':
      return n.v;
    case 'list':
      return n.items.map((x) => evalNode(x, env));
    case 'neg':
      return -toNum(evalNode(n.a, env));
    case 'not':
      return !truthy(evalNode(n.a, env));
    case 'if':
      return truthy(evalNode(n.c, env)) ? evalNode(n.a, env) : evalNode(n.b, env);
    case 'bin':
      return binaryOp(n, env);
    default:
      return call(n, env);
  }
}

function binaryOp(n, env) {
  if (n.op === 'and') return truthy(evalNode(n.a, env)) && truthy(evalNode(n.b, env));
  if (n.op === 'or') return truthy(evalNode(n.a, env)) || truthy(evalNode(n.b, env));
  const a = evalNode(n.a, env);
  const b = evalNode(n.b, env);
  switch (n.op) {
    case '+':
      if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
      if (typeof a === 'string' || typeof b === 'string') {
        // "Vol. " + 2 joins; "3" + 4 stays arithmetic only when both read as numbers.
        const both = [a, b].every((v) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))));
        if (!both || typeof a === 'string') return toStr(a) + toStr(b);
      }
      if (isDate(a) || isDate(b)) fail('Usa dateAdd() para sumar tiempo a una fecha');
      return toNum(a) + toNum(b);
    case '-':
      return toNum(a) - toNum(b);
    case '*':
      return toNum(a) * toNum(b);
    case '/':
      return toNum(b) === 0 ? null : toNum(a) / toNum(b);
    case '%':
      return toNum(b) === 0 ? null : toNum(a) % toNum(b);
    case '^':
      return toNum(a) ** toNum(b);
    case '==':
      return equal(a, b);
    case '!=':
      return !equal(a, b);
    case '>':
      return compare(a, b) > 0;
    case '>=':
      return compare(a, b) >= 0;
    case '<':
      return compare(a, b) < 0;
    default:
      return compare(a, b) <= 0;
  }
}

function call(n, env) {
  const { name, args } = n;
  if (name === 'prop') {
    need(args, 1, 1, 'prop');
    if (args[0].k !== 'val' || typeof args[0].v !== 'string') fail('prop() necesita el nombre de una propiedad entre comillas: prop("Nombre")');
    return env.prop(args[0].v);
  }
  if (name === 'if') {
    need(args, 3, 3, 'if');
    return truthy(evalNode(args[0], env)) ? evalNode(args[1], env) : evalNode(args[2], env);
  }
  if (name === 'ifs') {
    if (args.length < 2) fail('ifs() necesita al menos una condición y un valor');
    for (let i = 0; i + 1 < args.length; i += 2) if (truthy(evalNode(args[i], env))) return evalNode(args[i + 1], env);
    return args.length % 2 ? evalNode(args.at(-1), env) : null;
  }
  if (name === 'and' || name === 'or') {
    if (!args.length) fail(`${name}() necesita al menos un valor`);
    return name === 'and' ? args.every((a) => truthy(evalNode(a, env))) : args.some((a) => truthy(evalNode(a, env)));
  }
  const fn = FN[name];
  if (!fn) fail(`No existe la función “${name}”`);
  need(args, fn[0], fn[1], name);
  const out = fn[2](args.map((a) => evalNode(a, env)));
  return typeof out === 'number' && !Number.isFinite(out) ? null : out;
}

// Parses and evaluates. `prop(name)` returns a property's value and may throw a FormulaError (unknown property, a
// cycle between formulas). Never throws: returns { value } or { error }.
const cache = new Map();
export function evaluate(src, env) {
  try {
    let tree = cache.get(src);
    if (!tree) {
      tree = parse(src);
      if (cache.size > 500) cache.clear();
      cache.set(src, tree);
    }
    return { value: evalNode(tree, env) };
  } catch (e) {
    if (e instanceof FormulaError) return { error: e.message };
    return { error: `Error: ${e.message}` };
  }
}

// The kind of a result, as shown under the formula editor.
export const valueType = (v) => (isEmpty(v) ? 'vacío' : Array.isArray(v) ? 'lista' : isDate(v) ? 'fecha' : typeof v === 'boolean' ? 'casilla' : typeof v === 'number' ? 'número' : 'texto');

// Property names used by a formula (to rename them when a property is renamed).
export function renameInFormula(src, from, to) {
  return src.replace(/prop\(\s*(["'])((?:\\.|(?!\1).)*)\1\s*\)/g, (m, q, name) => (name === from ? `prop("${to.replace(/"/g, '\\"')}")` : m));
}
