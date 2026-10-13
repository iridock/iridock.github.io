'use strict';
// IriDock ボーダー予想（公開サイト）。data/ の JSON を読んで表示するだけ。ここでは計算しない
// （予想は毎日のバッチが、アプリの画面と同じ計算で作る。サイトで計算すると数字がずれる）。
// データは文字として出すだけにする（innerHTML を使わない）。

const $ = (id) => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';
const DOW = ['日', '月', '火', '水', '木', '金', '土'];
const SCORES = [2, 4, 6];
const PAGE = 60;
const FORMAT = 1;              // data の形の版（BorderSiteExport.FormatVersion と同じ）
const STALE_HOURS = 36;        // これより古ければ「更新が止まっている」と出す
const RELOAD_MINUTES = 10;     // 開き直したとき、これだけたっていれば読み直す
const STALE_RECORD_DAYS = 7;   // 最新の記録がこれより古い帯には「最近の記録が少ない」と出す（ふだんは報告が集まるのに2〜3日かかる）

const state = {
  summary: null,
  loadedAt: 0,
  band: null,
  day: null,
  range: 30,
  history: new Map(),          // 帯 → 新しい順の [日付, +2, +4, +6]
  sort: { key: 'date', asc: false },
  shown: PAGE,
  ticket: 0,
};

const nf = new Intl.NumberFormat('ja-JP');
const compact = new Intl.NumberFormat('ja-JP', { notation: 'compact', maximumFractionDigits: 1 });
const fmt = (n) => (n == null ? '—' : nf.format(n));
const short = (n) => (n == null ? '—' : compact.format(n));
const el = (name, attrs = {}, text) => {
  const e = document.createElement(name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
};
const svgEl = (name, attrs = {}) => {
  const e = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};
const dayNumber = (iso) => Math.floor(Date.parse(iso + 'T00:00:00Z') / 86400000);
const dowOf = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay();
const md = (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
const mdw = (iso) => `${md(iso)}（${DOW[dowOf(iso)]}）`;
const isoOfDay = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
// 見ている人の時計ではなく、日本時間の「今日」。ボーダーは日本時間の 0:00〜23:59 で集計されるため。
const jstToday = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* 保存できなくても動く */ } },
};

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

function notice(text) {
  const n = $('notice');
  n.textContent = text || '';
  n.hidden = !text;
}

const current = () => state.summary.classes.find((c) => c.rankClass === state.band);

// ---- 読み込み ----
async function load() {
  let summary;
  try {
    summary = await getJson('data/summary.json');
    if (summary.version !== FORMAT) throw new Error('format');
  } catch {
    notice('データを読み込めませんでした。時間をおいて開き直してください。');
    return;
  }

  state.summary = summary;
  state.loadedAt = Date.now();
  state.history.clear();
  renderUpdated();
  pickDay();
  renderBands();

  const names = summary.classes.map((c) => c.rankClass);
  if (names.length === 0) {
    notice('まだボーダーの記録がありません。');
    return;
  }
  const fromHash = decodeURIComponent(location.hash.slice(1));
  const pick = [fromHash, state.band, store.get('band'), names[0]].find((n) => n && names.includes(n));
  await selectBand(pick);
}

function renderUpdated() {
  const at = new Date(state.summary.generatedAt);
  const jst = new Date(at.getTime() + 9 * 3600000);
  const text = `${jst.getUTCMonth() + 1}/${jst.getUTCDate()} ${String(jst.getUTCHours()).padStart(2, '0')}:${String(jst.getUTCMinutes()).padStart(2, '0')}`;
  $('updated').textContent = `${text} 更新（毎日お昼ごろに更新）`;
  const hours = (Date.now() - at.getTime()) / 3600000;
  if (hours > STALE_HOURS) notice(`データの更新が止まっているようです（最後の更新は ${text}）。ボーダー予想が古いかもしれません。`);
  else notice('');
}

// 見ている人の今日（日本時間）に合う予想を選ぶ。無ければ、いちばん近い日。
function pickDay() {
  const days = state.summary.days.map((d) => d.date);
  if (days.length === 0) { state.day = null; return; }
  const today = jstToday();
  if (state.day && days.includes(state.day) && state.day >= today) return;
  state.day = days.find((d) => d === today) ?? days.find((d) => d > today) ?? days[days.length - 1];
  if (state.day < today) {
    notice(`今日（${mdw(today)}）のボーダー予想はまだありません。いちばん新しい ${mdw(state.day)} の予想を出しています。`);
  }
}

// 「今日」「明日」「あさって」を付けた日付。
function dayLabel(iso) {
  const diff = dayNumber(iso) - dayNumber(jstToday());
  const word = ['今日', '明日', 'あさって'][diff];
  return word ? `${mdw(iso)} ${word}` : mdw(iso);
}

// 予想を出す日（今日より前の日は出さない。今日の予想がまだ無いときだけ、いちばん新しい日を残す）。
const forecastDays = () => state.summary.days.filter((d) => d.date >= jstToday() || d.date === state.day);

// ランク帯は、見出しの中の選ぶ欄1つで選ぶ（利用者の指示「ランクの選択ももっとシンプルに」、2026-10-14。前は15個の札が横に並んでいた）。
// S・A・B・C・D のまとまりごとに区切って並べる。
function renderBands() {
  const select = $('band');
  const groups = new Map();
  for (const c of state.summary.classes) {
    const g = c.rankClass.charAt(0);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(c.rankClass);
  }
  select.replaceChildren(...[...groups].map(([g, names]) => {
    const og = el('optgroup', { label: g });
    og.append(...names.map((n) => el('option', { value: n }, n)));
    return og;
  }));
}

async function selectBand(name) {
  if (!name) return;
  state.band = name;
  store.set('band', name);
  if (decodeURIComponent(location.hash.slice(1)) !== name) history.replaceState(null, '', '#' + encodeURIComponent(name));
  $('band').value = name;
  renderHero();
  renderWeek();
  renderOverview();

  const ticket = ++state.ticket;
  const cls = current();
  let rows = state.history.get(name);
  if (!rows) {
    $('count').textContent = '読み込み中…';
    try {
      const h = await getJson(`data/history/${encodeURIComponent(cls.file)}.json`);
      rows = h.rows;
      state.history.set(name, rows);
    } catch {
      rows = [];
      if (ticket === state.ticket) $('count').textContent = '実際のボーダーを読み込めませんでした。';
    }
  }
  if (ticket !== state.ticket) return;   // 途中で別の帯に変えられた
  state.shown = PAGE;
  // 期間の欄は、その帯の記録がある範囲でしか選べないようにする（カレンダーで、記録の無い日を選ばずに済むように）。
  if (rows.length > 0) {
    for (const id of ['from', 'to']) { $(id).min = rows[rows.length - 1][0]; $(id).max = rows[0][0]; }
  }
  renderChart();
  renderTable();
}

// ---- 予想の大きな数字 ----
function lastActual(cls, score) {
  for (let i = cls.spark.length - 1; i >= 0; i--) {
    const row = cls.spark[i];
    const v = row[SCORES.indexOf(score) + 1];
    if (v != null) return { date: row[0], points: v };
  }
  return null;
}

// 日の種類（「水曜・ふつうの日」の「ふつうの日」のほう。祝日・休みの前の日 など）。
const dayKind = (info) => (info?.dayText ?? '').split('・').slice(1).join('・');

function renderHero() {
  const cls = current();
  const info = state.summary.days.find((d) => d.date === state.day);
  const kind = dayKind(info);
  $('hero-sub').textContent = info
    ? `${dayLabel(info.date)}の予想${kind ? `（${kind}）` : ''}${cls.latestDate ? `　／　実際のボーダーの記録は ${mdw(cls.latestDate)} まで` : ''}`
    : '';

  const cards = (state.day && cls.forecasts[state.day]) || [];
  const box = $('cards');
  const shared = $('shared');
  if (cards.length === 0) {
    box.replaceChildren(el('p', { class: 'empty' }, 'この帯は、ボーダー予想を出せるだけの記録がありません。下の「これまでの実際のボーダー」を参考にしてください。'));
    shared.replaceChildren();
    return;
  }

  // 3枚とも同じ文なら、カードごとに繰り返さず下に1回だけ出す（スマホで縦に長くならないように）。
  // 「予想の元」（どのやり方で計算したか）の文は出さない（利用者の指示「…の文言はいらない」、2026-10-14）。
  const same = (key) => cards[0][key] && cards.every((c) => c[key] === cards[0][key]);
  const sharedCaution = same('caution');
  // 報告が少ない帯（S2 など）は、最新の記録が何日も前になる。取れていないのではなく、元の集計に数字が無い（2026-10-14 に確かめた）。
  // 見た人が「壊れている」と思わないよう、古いことをはっきり書く。
  const staleDays = cls.latestDate ? dayNumber(state.day) - dayNumber(cls.latestDate) : Infinity;
  const ahead = dayNumber(state.day) - dayNumber(jstToday());
  shared.replaceChildren(
    ...(staleDays > STALE_RECORD_DAYS
      ? [el('p', { class: 'stale' }, cls.latestDate
        ? `この帯は最近の報告が少なく、実際のボーダーの記録は ${mdw(cls.latestDate)} までです。古めの記録から予想しているので、外れやすくなっています。`
        : 'この帯は最近の実際のボーダーの記録がありません。')]
      : []),
    ...(ahead >= 2 ? [el('p', { class: 'caution' }, `${ahead} 日先の予想です。先の日ほど外れやすくなります。`)] : []),
    ...(sharedCaution ? [el('p', { class: 'caution' }, cards[0].caution)] : []));

  box.replaceChildren(...cards.map((c) => {
    const card = el('article', { class: `card s${c.score}`, 'aria-label': `+${c.score} のボーダー予想` });
    const head = el('div', { class: 'card-head' });
    head.append(el('span', { class: 'pill' }, `+${c.score}`), el('span', { class: 'tag-forecast' }, 'ボーダー予想'));
    card.append(head);

    const big = el('p', { class: 'big' }, fmt(c.points));
    big.append(el('small', {}, 'pt'));
    card.append(big);

    // 「95%の確率で取れるライン」= ここまで届いていれば、過去の記録で 95% の日にそのスコアが取れていたポイント
    // （利用者の指示、2026-10-14。前は「ここまで上げれば取れる（95%）」で、伝わりにくかった）。
    if (c.safe95 != null) {
      const safe = el('div', { class: 'safe' });
      safe.append(el('span', {}, '95%の確率で取れるライン'), el('b', {}, `${fmt(c.safe95)} pt`));
      card.append(safe);
      const ratio = Math.max(0, Math.min(1, c.points / c.safe95));
      const meter = el('div', { class: 'meter', role: 'img', 'aria-label': `ボーダー予想は「95%の確率で取れるライン」の ${Math.round(ratio * 100)}% の高さ` });
      const fill = el('span');
      fill.style.width = `${(ratio * 100).toFixed(1)}%`;
      meter.append(fill);
      card.append(meter);
    } else {
      const safe = el('div', { class: 'safe' });
      safe.append(el('span', {}, '95%の確率で取れるラインは、まだ出せません（記録が足りないため）'));
      card.append(safe);
    }

    // 前は「最新の実際: 10/7（水）」で、何の数字か伝わりにくかった。
    const last = lastActual(cls, c.score);
    if (last) card.append(el('p', { class: 'last' }, `${mdw(last.date)} の実際のボーダーは ${fmt(last.points)} pt`));
    if (c.caution && !sharedCaution) card.append(el('p', { class: 'caution' }, c.caution));
    return card;
  }));
}

// ---- 全ランク帯の一覧 ----
function sparkline(cls) {
  const W = 76, H = 26, P = 2;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' });
  const pts = cls.spark.filter((r) => r[1] != null);
  if (pts.length < 2) return svg;
  const xs = pts.map((r) => dayNumber(r[0]));
  const ys = pts.map((r) => r[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const x = (n) => P + ((n - x0) / Math.max(x1 - x0, 1)) * (W - 2 * P);
  const y = (v) => H - P - ((v - y0) / Math.max(y1 - y0, 1)) * (H - 2 * P);
  svg.append(svgEl('polyline', { points: pts.map((r, i) => `${x(xs[i]).toFixed(1)},${y(ys[i]).toFixed(1)}`).join(' ') }));
  return svg;
}

function renderOverview() {
  $('overview-date').textContent = state.day ? dayLabel(state.day) : '';
  const list = $('overview');
  list.replaceChildren(...state.summary.classes.map((cls) => {
    const li = el('li');
    const b = el('button', { type: 'button', 'data-band': cls.rankClass, 'aria-current': String(cls.rankClass === state.band) });
    b.append(el('span', { class: 'band' }, cls.rankClass));
    const cards = (state.day && cls.forecasts[state.day]) || [];
    const nums = el('span', { class: 'nums' });
    if (cards.length === 0) nums.append(el('span', { class: 'none' }, '予想なし'));
    for (const c of cards) nums.append(el('span', { class: `c${c.score}`, title: `+${c.score}: ${fmt(c.points)} pt` }, short(c.points)));
    b.append(nums, sparkline(cls));
    b.setAttribute('aria-label', `${cls.rankClass}: ${cards.map((c) => `+${c.score} ${fmt(c.points)}`).join('、') || '予想なし'}`);
    li.append(b);
    return li;
  }));
}

// ---- グラフ ----
function renderChart() {
  const svg = $('chart');
  const W = Math.max(Math.round(svg.clientWidth || 640), 280);
  const H = Math.max(Math.round(svg.clientHeight || 260), 180);
  const L = 50, R = 16, T = 12, B = 24;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.replaceChildren();
  $('tip').hidden = true;

  const cls = current();
  const rows = state.history.get(state.band) || [];
  // 期間は今日（日本時間）までの実際と、今日から先の1週間の予想。選んだ日に関わらず同じ範囲で描く（日を選ぶたびに横軸が動かないように）。
  const end = dayNumber(jstToday());
  const start = end - state.range;
  const list = rows.filter((r) => dayNumber(r[0]) >= start && dayNumber(r[0]) <= end).slice().reverse();   // 古い順
  const forecasts = forecastDays()
    .filter((d) => cls.forecasts[d.date])
    .map((d) => ({ date: d.date, cards: cls.forecasts[d.date] }));
  const last = Math.max(end, ...forecasts.map((f) => dayNumber(f.date)));

  const values = [];
  for (const r of list) for (let i = 1; i <= 3; i++) if (r[i] != null) values.push(r[i]);
  for (const f of forecasts) for (const c of f.cards) values.push(c.points);
  if (values.length === 0) {
    const t = svgEl('text', { class: 'tick', x: W / 2, y: H / 2, 'text-anchor': 'middle' });
    t.textContent = 'この期間の記録がありません';
    svg.append(t);
    return;
  }

  const min = Math.min(...values), max = Math.max(...values);
  const pad = Math.max((max - min) * 0.08, max * 0.02, 1);
  const lo = Math.max(0, min - pad), hi = max + pad;
  const x = (n) => L + ((n - start) / Math.max(last - start, 1)) * (W - L - R);
  const y = (v) => T + ((hi - v) / (hi - lo)) * (H - T - B);

  for (let i = 0; i <= 3; i++) {
    const v = lo + ((hi - lo) * i) / 3;
    svg.append(svgEl('line', { class: 'grid', x1: L, x2: W - R, y1: y(v), y2: y(v) }));
    const t = svgEl('text', { class: 'tick', x: L - 6, y: y(v) + 4, 'text-anchor': 'end' });
    t.textContent = short(Math.round(v));
    svg.append(t);
  }
  const steps = W < 420 ? 2 : 4;
  for (let i = 0; i <= steps; i++) {
    const n = Math.round(start + ((last - start) * i) / steps);
    const t = svgEl('text', { class: 'tick', x: x(n), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === steps ? 'end' : 'middle' });
    t.textContent = md(isoOfDay(n));
    svg.append(t);
  }

  SCORES.forEach((s, idx) => {
    const color = `var(--c${s})`;
    const pts = list.filter((r) => r[idx + 1] != null).map((r) => [x(dayNumber(r[0])), y(r[idx + 1])]);
    if (pts.length > 1) {
      const line = pts.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
      const area = `${pts[0][0].toFixed(1)},${(H - B).toFixed(1)} ${line} ${pts[pts.length - 1][0].toFixed(1)},${(H - B).toFixed(1)}`;
      svg.append(svgEl('polygon', { class: 'area', fill: color, points: area }));
      svg.append(svgEl('polyline', { class: 'ln', stroke: color, points: line }));
    } else if (pts.length === 1) {
      svg.append(svgEl('circle', { class: 'dot', cx: pts[0][0], cy: pts[0][1], r: 3, fill: color }));
    }
    // 予想は、最後の実際から1週間ぶんを順に点線でつなぐ（実際の線と見分けるため）。選んでいる日の丸は大きく。
    const tail = pts[pts.length - 1];
    const fpts = forecasts
      .map((f) => ({ date: f.date, card: f.cards.find((c) => c.score === s) }))
      .filter((f) => f.card)
      .map((f) => ({ date: f.date, at: [x(dayNumber(f.date)), y(f.card.points)] }));
    const path = [...(tail ? [tail] : []), ...fpts.map((f) => f.at)];
    if (path.length > 1) svg.append(svgEl('polyline', { class: 'fcl', stroke: color, points: path.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ') }));
    for (const f of fpts) {
      svg.append(svgEl('circle', { class: 'fc', cx: f.at[0], cy: f.at[1], r: f.date === state.day ? 5 : 3, stroke: color }));
    }
  });

  // なぞると、その日の数字が出る。
  const cursor = svgEl('line', { class: 'cursor', y1: T, y2: H - B, visibility: 'hidden' });
  svg.append(cursor);
  const points = [
    ...list.map((r) => ({ date: r[0], values: { 2: r[1], 4: r[2], 6: r[3] }, forecast: false })),
    ...forecasts.map((f) => ({ date: f.date, values: Object.fromEntries(f.cards.map((c) => [c.score, c.points])), forecast: true })),
  ];
  const show = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * W;
    let best = null, bd = Infinity;
    for (const p of points) { const d = Math.abs(x(dayNumber(p.date)) - px); if (d < bd) { bd = d; best = p; } }
    if (!best) return;
    const cx = x(dayNumber(best.date));
    cursor.setAttribute('x1', cx); cursor.setAttribute('x2', cx); cursor.setAttribute('visibility', 'visible');
    const tip = $('tip');
    tip.replaceChildren(el('b', {}, `${mdw(best.date)} ${best.forecast ? 'のボーダー予想' : 'の実際のボーダー'}`),
      ...SCORES.map((s) => {
        const row = el('span', { class: `row c${s}` });
        row.append(el('span', {}, `+${s}`), el('span', {}, fmt(best.values[s])));
        return row;
      }));
    tip.hidden = false;
    const left = (cx / W) * rect.width;
    tip.style.left = `${Math.min(Math.max(left - tip.offsetWidth / 2, 0), $('chartbox').clientWidth - tip.offsetWidth)}px`;
  };
  svg.onpointermove = (e) => show(e.clientX);
  svg.onpointerdown = (e) => show(e.clientX);
  svg.onpointerleave = () => { cursor.setAttribute('visibility', 'hidden'); $('tip').hidden = true; };
}

// ---- 表 ----
// 期間で絞る（利用者の指示「日付検索は日付の検索をもっと楽にして。あと範囲でできるようにして」、2026-10-14）。
// 日付はカレンダーから選び、よく使う期間はボタン1つで入れる。前の「10/3 と打つ」欄はやめた。曜日は別の選ぶ欄。
const isoOf = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

// ボタンの期間（日本時間の今日から数える）。
function presetRange(key) {
  const today = jstToday();
  const t = new Date(today + 'T00:00:00Z');
  if (key === '7' || key === '30') return [isoOfDay(dayNumber(today) - Number(key) + 1), today];
  if (key === 'month') return [`${today.slice(0, 8)}01`, today];
  if (key === 'last') {
    const first = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1));
    const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0));
    return [isoOf(first), isoOf(last)];
  }
  return ['', ''];
}

// 今の期間がどのボタンと同じかを、ボタンの押されている印に出す（手で日付を変えたら、どれも押されていない形に）。
function markPreset() {
  const from = $('from').value, to = $('to').value;
  for (const b of document.querySelectorAll('#presets button')) {
    const [f, t] = presetRange(b.dataset.preset);
    b.setAttribute('aria-pressed', String(f === from && t === to));
  }
}

// 期間（から・まで）。逆に選ばれていたら入れ替える。空なら、その側は限らない。
function period() {
  let from = $('from').value, to = $('to').value;
  if (from && to && from > to) [from, to] = [to, from];
  return { from, to };
}

function filtered() {
  const rows = state.history.get(state.band) || [];
  const score = Number($('score').value), dow = Number($('dow').value);
  const { from, to } = period();
  let list = rows.filter((r) => {
    if (from && r[0] < from) return false;
    if (to && r[0] > to) return false;
    if (dow >= 0 && dowOf(r[0]) !== dow) return false;
    if (score && r[SCORES.indexOf(score) + 1] == null) return false;
    return true;
  });
  const { key, asc } = state.sort;
  const val = (r) => (key === 'date' ? r[0] : r[SCORES.indexOf(key) + 1] ?? -1);
  list = list.slice().sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * (asc ? 1 : -1));
  return list;
}

function renderTable() {
  const rows = state.history.get(state.band) || [];
  const score = Number($('score').value);
  const list = filtered();
  const { from, to } = period();
  const span = from || to ? `${from ? mdw(from) : '最初'} 〜 ${to ? mdw(to) : '最新'}　` : '';
  $('count').textContent = list.length === rows.length
    ? `${state.band} の実際のボーダー ${fmt(rows.length)} 日分（直近1年）`
    : `${span}${fmt(list.length)} 日分 ／ ${state.band} の実際のボーダー ${fmt(rows.length)} 日分（直近1年）`;

  // 表は2つある（1週間の予想・実際）。実際の表（#actual）の中だけを見る。
  for (const b of document.querySelectorAll('#actual th .sort')) {
    const key = b.dataset.sort === 'date' ? 'date' : Number(b.dataset.sort);
    if (key === state.sort.key) b.setAttribute('aria-sort', state.sort.asc ? 'ascending' : 'descending');
    else b.removeAttribute('aria-sort');
  }
  const hide = (s) => score !== 0 && score !== s;
  document.querySelectorAll('#actual thead th.n').forEach((th, i) => { th.hidden = hide(SCORES[i]); });

  $('rows').replaceChildren(...list.slice(0, state.shown).map((r) => {
    const d = dowOf(r[0]);
    const tr = el('tr', { class: d === 0 ? 'sun' : d === 6 ? 'sat' : '' });
    tr.append(el('td', {}, r[0].replace(/-/g, '/')), el('td', {}, DOW[d]));
    SCORES.forEach((s, i) => {
      const td = el('td', { class: `n c${s}` }, fmt(r[i + 1]));
      td.hidden = hide(s);
      tr.append(td);
    });
    return tr;
  }));
  $('more').hidden = list.length <= state.shown;
}

// ---- 1週間のボーダー予想（利用者の指示「ボーダー予想は本日から一週間分みれるようにして」、2026-10-14） ----
// 大きい数字がボーダー予想、小さい数字が「95%の確率で取れるライン」。行を押すと、その日が上のカードに大きく出る。
function renderWeek() {
  const cls = current();
  $('week-rows').replaceChildren(...forecastDays().map((d) => {
    const cards = cls.forecasts[d.date] || [];
    const on = d.date === state.day;
    const tr = el('tr', { 'data-day': d.date, class: on ? 'on' : '', tabindex: '0', 'aria-current': String(on) });
    const th = el('th', { scope: 'row' });
    th.append(el('span', { class: 'wd' }, mdw(d.date)));
    const word = ['今日', '明日', 'あさって'][dayNumber(d.date) - dayNumber(jstToday())];
    if (word) th.append(el('span', { class: 'rel' }, word));
    const kind = dayKind(d);
    if (kind && kind !== 'ふつうの日') th.append(el('span', { class: 'kind' }, kind));
    tr.append(th);
    for (const s of SCORES) {
      const c = cards.find((x) => x.score === s);
      const td = el('td', { class: `n c${s}` });
      if (c) {
        td.append(el('span', { class: 'wf' }, fmt(c.points)));
        if (c.safe95 != null) td.append(el('span', { class: 'ws', title: '95%の確率で取れるライン' }, fmt(c.safe95)));
      } else {
        td.append(el('span', { class: 'none' }, '—'));
      }
      tr.append(td);
    }
    return tr;
  }));
}

function selectDay(date) {
  if (!date || date === state.day) return;
  state.day = date;
  renderHero();
  renderWeek();
  renderOverview();
  renderChart();
  // スマホでは上のカードが画面の外にあるので、そこまで戻す。
  const hero = document.querySelector('.hero');
  if (hero.getBoundingClientRect().top < 0) hero.scrollIntoView({ behavior: 'smooth' });
}

// ---- 操作 ----
$('band').addEventListener('change', (e) => selectBand(e.target.value));
$('overview').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-band]');
  if (!b) return;
  selectBand(b.dataset.band);
  if (window.matchMedia('(max-width: 860px)').matches) document.querySelector('.hero').scrollIntoView({ behavior: 'smooth' });
});
$('week-rows').addEventListener('click', (e) => selectDay(e.target.closest('tr[data-day]')?.dataset.day));
$('week-rows').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  selectDay(e.target.closest('tr[data-day]')?.dataset.day);
});
$('range').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-days]');
  if (!b) return;
  state.range = Number(b.dataset.days);
  for (const x of document.querySelectorAll('#range button')) x.setAttribute('aria-pressed', String(x === b));
  renderChart();
});

const refilter = () => { state.shown = PAGE; renderTable(); };
['from', 'to'].forEach((id) => $(id).addEventListener('change', () => { markPreset(); refilter(); }));
$('presets').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-preset]');
  if (!b) return;
  [$('from').value, $('to').value] = presetRange(b.dataset.preset);
  markPreset();
  refilter();
});
['score', 'dow'].forEach((id) => $(id).addEventListener('change', refilter));
$('clear').addEventListener('click', () => {
  $('from').value = ''; $('to').value = ''; $('score').value = '0'; $('dow').value = '-1';
  markPreset();
  refilter();
});
$('more').addEventListener('click', () => { state.shown += PAGE; renderTable(); });
document.querySelector('#actual thead').addEventListener('click', (e) => {
  const b = e.target.closest('.sort');
  if (!b) return;
  const key = b.dataset.sort === 'date' ? 'date' : Number(b.dataset.sort);
  state.sort = { key, asc: state.sort.key === key ? !state.sort.asc : false };
  state.shown = PAGE;
  renderTable();
});

window.addEventListener('hashchange', () => {
  const name = decodeURIComponent(location.hash.slice(1));
  if (state.summary && name && name !== state.band && state.summary.classes.some((c) => c.rankClass === name)) selectBand(name);
});

// 開き直したときに、最新に追いつく（毎日昼ごろに更新される）。
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.summary && Date.now() - state.loadedAt > RELOAD_MINUTES * 60000) load();
});

// 幅が変わったら、グラフを描き直す（文字がつぶれないよう、実際の幅で描いている）。
let resizeTimer;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (state.summary && state.band) renderChart(); }, 120);
}).observe($('chartbox'));

load();
