'use strict';
// IriDock ボーダー予想（公開サイト）。data/ の JSON を読んで表示するだけ。ここでは計算しない
// （予想は毎日のバッチが、アプリの画面と同じ計算で作る。サイトで計算すると数字がずれる）。
// データは文字として出すだけにする（innerHTML を使わない）。
// data/ は3つに分かれている（利用者の指示「過去分の結果のやつと、予想と、実績のjsonをわけよう」、2026-10-16）:
//   forecasts.json … 予想（今日から1週間）、actuals.json … 実績（直近1年）、results.json … 過去分の結果（予想の答え合わせ）。

const $ = (id) => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';
const DOW = ['日', '月', '火', '水', '木', '金', '土'];
const SCORES = [2, 4, 6];
const PER_PAGES = [10, 30, 50, 100];   // これまでの実際のボーダーの1ページの件数（最初は 10。2026-10-17「10,30,50,100にしよう」）
const FORMAT = 2;              // data の形の版（BorderSiteExport.FormatVersion と同じ）
const STALE_HOURS = 36;        // これより古ければ「更新が止まっている」と出す
const RELOAD_MINUTES = 10;     // 開き直したとき、これだけたっていれば読み直す
const STALE_RECORD_DAYS = 7;   // 最新の記録がこれより古い帯には「最近の記録が少ない」と出す（ふだんは報告が集まるのに2〜3日かかる）
const SPARK_DAYS = 30;         // 一覧の小さなグラフの日数（実績から作る）

const state = {
  forecasts: null,             // forecasts.json（予想）
  results: null,               // results.json（過去分の結果）。読めなければ null
  actualsFailed: false,        // actuals.json（実績）を読めなかった
  loadedAt: 0,
  band: null,
  day: null,
  range: 30,
  history: new Map(),          // 帯 → 新しい順の [日付, +2, +4, +6]（actuals.json）
  answers: new Map(),          // 帯 → 答え合わせの新しい順の [日付, スコア, その日最後の予想, 安全圏（10/18〜20 は 90% の線、10/21 からはふつうの日に 5 回に 4 回の線。10/18 より前は null）, 実際, 差%, 今の計算, その差%, 外れやすい日だったか]（results.json）
  sort: { key: 'date', asc: false },
  page: 0,                     // これまでの実際のボーダーの、いま見ているページ（0 から）
  perPage: PER_PAGES[0],
  heatScore: 2,                // 曜日×週の色分け表で色にするスコア
  heatWeeks: 12,               // 曜日×週の色分け表に並べる過去の週の数
};
const HEAT_WEEK_CHOICES = [4, 8, 12];   // 曜日×週の色分け表に並べる過去の週の数（今週を含む）。選べる（2026-10-17）。最初は 12
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];

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

const current = () => state.forecasts.classes.find((c) => c.rankClass === state.band);

// 見ている帯の実際のボーダーを日付で引く（帯の記録ごとに1回だけ表を作る）。記録をまだ読み込んでいなければ null。
const byDateCache = new WeakMap();
function actualRow(iso) {
  const rows = state.history.get(state.band);
  if (!rows) return null;
  let map = byDateCache.get(rows);
  if (!map) { map = new Map(rows.map((r) => [r[0], r])); byDateCache.set(rows, map); }
  return map.get(iso) ?? null;
}

// ---- 読み込み ----
async function load() {
  // 3つまとめて読む。予想が読めなければ何も出せないが、実績・過去分の結果が読めなくても予想は出す。
  let forecasts, actuals, results;
  try {
    [forecasts, actuals, results] = await Promise.all([
      getJson('data/forecasts.json'),
      getJson('data/actuals.json').catch(() => null),
      getJson('data/results.json').catch(() => null),
    ]);
    if (forecasts.version !== FORMAT) throw new Error('format');
  } catch {
    notice('データを読み込めませんでした。時間をおいて開き直してください。');
    return;
  }

  state.forecasts = forecasts;
  state.results = results?.version === FORMAT ? results : null;
  state.actualsFailed = actuals?.version !== FORMAT;
  state.loadedAt = Date.now();
  state.history.clear();
  state.answers.clear();
  for (const c of state.actualsFailed ? [] : actuals.classes) state.history.set(c.rankClass, c.rows);
  for (const c of state.results?.classes ?? []) state.answers.set(c.rankClass, c.rows);
  renderUpdated();
  pickDay();
  renderBands();

  const names = forecasts.classes.map((c) => c.rankClass);
  if (names.length === 0) {
    notice('まだボーダーの記録がありません。');
    return;
  }
  // 開き直したときは、前に選んでいた帯を先に使う（利用者の指示、2026-10-16「再度開いたときに指定してたランク…は記憶しておいてほしい」）。
  // 前は URL の #帯 を先にしていたので、#S1 付きで保存したブックマークやホーム画面のアイコンから開くと、いつも S1 に戻っていた。
  // 覚えた帯が無い人（はじめての人・共有された #帯 のリンク）には #帯 を使う。開いている間の #帯 の切り替えは hashchange が受け持つ。
  const fromHash = decodeURIComponent(location.hash.slice(1));
  const pick = [state.band, store.get('band'), fromHash, names[0]].find((n) => n && names.includes(n));
  selectBand(pick);
}

function renderUpdated() {
  const at = new Date(state.forecasts.generatedAt);
  const jst = new Date(at.getTime() + 9 * 3600000);
  const text = `${jst.getUTCMonth() + 1}/${jst.getUTCDate()} ${String(jst.getUTCHours()).padStart(2, '0')}:${String(jst.getUTCMinutes()).padStart(2, '0')}`;
  $('updated').textContent = `${text} 更新（毎日お昼ごろに更新）`;
  const hours = (Date.now() - at.getTime()) / 3600000;
  if (hours > STALE_HOURS) notice(`データの更新が止まっているようです（最後の更新は ${text}）。ボーダー予想が古いかもしれません。`);
  else notice('');
}

// 見ている人の今日（日本時間）に合う予想を選ぶ。無ければ、いちばん近い日。
function pickDay() {
  const days = state.forecasts.days.map((d) => d.date);
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
const forecastDays = () => state.forecasts.days.filter((d) => d.date >= jstToday() || d.date === state.day);

// ランク帯は、見出しの中の選ぶ欄1つで選ぶ（利用者の指示「ランクの選択ももっとシンプルに」、2026-10-14。前は15個の札が横に並んでいた）。
// S・A・B・C・D のまとまりごとに区切って並べる。
// 上の帯の札も同じ選ぶ欄にする（2026-10-16「TOPのランク押すと変更できるようにして」）。
function renderBands() {
  const groups = new Map();
  for (const c of state.forecasts.classes) {
    const g = c.rankClass.charAt(0);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(c.rankClass);
  }
  for (const select of [$('band'), $('bar-band')]) {
    select.replaceChildren(...[...groups].map(([g, names]) => {
      const og = el('optgroup', { label: g });
      og.append(...names.map((n) => el('option', { value: n }, n)));
      return og;
    }));
  }
}

// ---- アクセス解析（GoatCounter。利用者の決定、2026-10-15「goatcounterにしよう」）----
// ページの数え方では「何人来たか」までしか分からない（帯は # の後ろで切り替わり、数えられない）ので、
// 帯を表示したらイベントを1回送り、どの帯がよく見られているかを数える。同じ帯を出し直しても数えない（開き直しの読み直しなど）。
// count.js がまだ読み込まれていなければ、読み込まれたときに送る。読めない（広告ブロック・index.html にタグが無い）ときは何もしない。
let countedBand = null;
const pendingCounts = [];
function countEvent(path, title) {
  const gc = window.goatcounter;
  if (gc && typeof gc.count === 'function') gc.count({ path, title, event: true });
  else pendingCounts.push({ path, title });
}
document.querySelector('script[data-goatcounter]')?.addEventListener('load', () => {
  for (const p of pendingCounts.splice(0)) countEvent(p.path, p.title);
});
function countBand(name) {
  if (name === countedBand) return;
  countedBand = name;
  countEvent(`band-${name}`, `ランク帯 ${name} を表示`);
}

function selectBand(name) {
  if (!name) return;
  state.band = name;
  countBand(name);
  store.set('band', name);
  if (decodeURIComponent(location.hash.slice(1)) !== name) history.replaceState(null, '', '#' + encodeURIComponent(name));
  $('band').value = name;
  $('bar-band').value = name;   // 上の帯（下まで読んでも、どの帯を見ているか分かり、押せば選び直せる）
  // 実績（actuals.json）は最初に全部の帯をまとめて読んでいる（前は帯を開くたびに読んでいた）。
  const rows = state.history.get(name) || [];
  state.page = 0;
  renderHero();
  renderWeek();
  renderOverview();
  renderHeat();
  // 期間の欄は、その帯の記録がある範囲でしか選べないようにする（カレンダーで、記録の無い日を選ばずに済むように）。
  if (rows.length > 0) {
    for (const id of ['from', 'to']) { $(id).min = rows[rows.length - 1][0]; $(id).max = rows[0][0]; }
  }
  renderChart();
  renderTable();
  renderAnswers();
}

// ---- 予想の大きな数字 ----
// 一覧の小さなグラフに使う、直近 SPARK_DAYS 日の実績（古い順）。
function sparkOf(rankClass) {
  const from = dayNumber(jstToday()) - SPARK_DAYS;
  return (state.history.get(rankClass) || []).filter((r) => dayNumber(r[0]) > from).slice().reverse();
}

// 日の種類（「水曜・ふつうの日」の「ふつうの日」のほう。祝日・休みの前の日 など）。
const dayKind = (info) => (info?.dayText ?? '').split('・').slice(1).join('・');

function renderHero() {
  const cls = current();
  const info = state.forecasts.days.find((d) => d.date === state.day);
  const kind = dayKind(info);
  // 「実際のボーダーの記録は 〇 まで」は出さない（利用者の指示、2026-10-16「webのボーダー予想のところに実際のボーダーの記録は 10/14（水） までとか
  // 10/14（水） の実際のボーダーは 221,450 ptの文言いらない」）。記録が古い帯だけは、下の注意の文で知らせる。
  $('hero-sub').textContent = info ? `${dayLabel(info.date)}の予想${kind ? `（${kind}）` : ''}` : '';

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

    // 「安全圏」= ここまで上げておけば、ふつうの日なら 5 回に 4 回はそのスコアが取れるポイント（受験の A 判定の感覚。2026-10-21、設計書15）。
    // 利用者の言葉、2026-10-21「覆う範囲がどうこうじゃない。安全圏って言葉を利用者がどう思うかから考えろっていってるの」。
    // その前は 90% の線（利用者の決定、2026-10-18「今95％ラインを表示しているのを90％ラインに変更しよう」
    // 「ライバーが確認してだいたいここまであげておけばとれるよなっていうのを示したいんだよね。あきらかな外れ値の場合は注意書きでわかるし」）。
    // さらに前は「95%の確率で取れるライン」（2026-10-14〜）、その前は「ここまで上げれば取れる（95%）」。
    if (c.safe90 != null) {
      const safe = el('div', { class: 'safe' });
      safe.append(el('span', {}, '安全圏'), el('b', {}, `${fmt(c.safe90)} pt`));
      card.append(safe);
      const ratio = Math.max(0, Math.min(1, c.points / c.safe90));
      const meter = el('div', { class: 'meter', role: 'img', 'aria-label': `ボーダー予想は安全圏の ${Math.round(ratio * 100)}% の高さ` });
      const fill = el('span');
      fill.style.width = `${(ratio * 100).toFixed(1)}%`;
      meter.append(fill);
      card.append(meter);
    } else {
      const safe = el('div', { class: 'safe' });
      safe.append(el('span', {}, '安全圏は、まだ出せません（記録が足りないため）'));
      card.append(safe);
    }

    // カードに「〇/〇 の実際のボーダーは 〇 pt」は出さない（利用者の指示、2026-10-16。上の見出しの横の文言と一緒に外した）。
    if (c.caution && !sharedCaution) card.append(el('p', { class: 'caution' }, c.caution));
    return card;
  }));
}

// ---- 全ランク帯の一覧 ----
function sparkline(cls) {
  const W = 76, H = 26, P = 2;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' });
  const pts = sparkOf(cls.rankClass).filter((r) => r[1] != null);
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
  list.replaceChildren(...state.forecasts.classes.map((cls) => {
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
  for (const f of forecasts) for (const c of f.cards) { values.push(c.points); if (c.safe90 != null) values.push(c.safe90); }
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

  // 予想の幅（予想〜安全圏）を帯で塗る。先の日ほど太くなるので、どこまで上げれば安全かと、
  // 先の日ほど当てにならないことが目で分かる（利用者が選んだ案 B、2026-10-14）。線より先に描いて、下に敷く。
  for (const s of SCORES) {
    const pts = forecasts
      .map((f) => ({ n: dayNumber(f.date), card: f.cards.find((c) => c.score === s) }))
      .filter((f) => f.card && f.card.safe90 != null);
    if (pts.length < 2) continue;
    const at = (f, v) => `${x(f.n).toFixed(1)},${y(v).toFixed(1)}`;
    const upper = pts.map((f) => at(f, f.card.safe90));
    const lower = pts.map((f) => at(f, f.card.points)).reverse();
    svg.append(svgEl('polygon', { class: 'band', fill: `var(--c${s})`, points: [...upper, ...lower].join(' ') }));
    svg.append(svgEl('polyline', { class: 'fsl', stroke: `var(--c${s})`, points: upper.join(' ') }));
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
    ...forecasts.map((f) => ({
      date: f.date,
      values: Object.fromEntries(f.cards.map((c) => [c.score, c.points])),
      safe: Object.fromEntries(f.cards.map((c) => [c.score, c.safe90])),
      forecast: true,
    })),
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
        const safe = best.forecast && best.safe?.[s] != null ? `（安全圏 ${fmt(best.safe[s])}）` : '';
        row.append(el('span', {}, `+${s}`), el('span', {}, fmt(best.values[s]) + safe));
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
// ボタンは「直近7日・直近30日・すべて」だけ（「今月」「先月」は外した。利用者の指示「実際のボーダーに今月、先月の選択肢はいらない」、2026-10-14）。

// ボタンの期間（日本時間の今日から数える）。
function presetRange(key) {
  const today = jstToday();
  if (key === '7' || key === '30') return [isoOfDay(dayNumber(today) - Number(key) + 1), today];
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
  $('count').textContent = state.actualsFailed
    ? '実際のボーダーを読み込めませんでした。時間をおいて開き直してください。'
    : list.length === rows.length
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

  // ページ送り（2026-10-17「これまでの実際のボーダーにページャーつけよう。デフォルト10件で50,100選択できるように」）
  const pages = Math.max(1, Math.ceil(list.length / state.perPage));
  state.page = Math.min(Math.max(state.page, 0), pages - 1);
  const start = state.page * state.perPage;
  $('rows').replaceChildren(...list.slice(start, start + state.perPage).map((r) => {
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
  $('page-info').textContent = `${state.page + 1} / ${pages}`;
  $('page-info').title = list.length ? `${fmt(start + 1)}〜${fmt(Math.min(start + state.perPage, list.length))} 件目 ／ ${fmt(list.length)} 件` : '';
  $('page-first').disabled = $('page-prev').disabled = state.page === 0;
  $('page-next').disabled = $('page-last').disabled = state.page >= pages - 1;
}

// 外れやすい日の札（1週間の予想と答え合わせの表で同じもの）。スマホの幅では日付の列が 45px ほどしかなく「外れやすい日」が入らないので、「注意」に縮める
// （答え合わせの表が 354/330 でスマホの幅からはみ出した。2026-10-25）。title は、押さなくても理由が見られるよう渡された文をそのまま使う。
function riskyTag(title) {
  const tag = el('span', { class: 'risky', title });
  tag.append(el('span', { class: 'long' }, '外れやすい日'), el('span', { class: 'short' }, '注意'));
  return tag;
}
// 「直近の傾向」の札（2つ目の札。利用者の指示、2026-10-26「直近だけ傾向が見られるやつを別の札作ろうか」「3ヶ月とか1年とか続いてれば入れてほしい」→「すすめて」）。
// 外れやすい日の札（前もって分かる日）とは別物で、「ここ数か月続いている片寄り」を知らせる説明の札。予想や安全圏は動かさない。
// 出す条件と文言は安全圏のループ（work-aa）が決め、予想のカードの trend に入る（空なら出さない。設計書15）。スマホの幅では「傾向」に縮める。
function trendTag(title) {
  const tag = el('span', { class: 'trendtag', title });
  tag.append(el('span', { class: 'long' }, '直近の傾向'), el('span', { class: 'short' }, '傾向'));
  return tag;
}

// ---- 1週間のボーダー予想（利用者の指示「ボーダー予想は本日から一週間分みれるようにして」、2026-10-14） ----
// 大きい数字がボーダー予想、小さい数字が安全圏（ふつうの日に 5 回に 4 回取れる線。設計書15）。行を押すと、その日が上のカードに大きく出る。
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
    // 外れやすい日の札（利用者の指示、2026-10-25「一週間の予想にも外れやすい日いれてほしいな」）。答え合わせの表と同じ形・同じ決まり:
    // カードに一言（caution）が出る日に付ける。押すと上のカードに一言が出るので、ここでは札だけ。スマホの幅では「注意」に縮める。
    const cautionText = cards.map((x) => x.caution).find((t) => t);
    if (cautionText) th.append(riskyTag(cautionText));
    const trendText = cards.map((x) => x.trend).find((t) => t);
    if (trendText) th.append(trendTag(trendText));
    tr.append(th);
    for (const s of SCORES) {
      const c = cards.find((x) => x.score === s);
      const td = el('td', { class: `n c${s}` });
      if (c) {
        td.append(el('span', { class: 'wf' }, fmt(c.points)));
        if (c.safe90 != null) td.append(el('span', { class: 'ws', title: '安全圏（ここまで上げておけば、ふつうの日なら 5 回に 4 回は取れるライン）' }, fmt(c.safe90)));
        // 前の同じ曜日の実際と比べた ▲▼ は出さない（2026-10-14 に案 D として入れたが、利用者の指示 2026-10-16「1週間のボーダー予想の▲▼の機能もいらない」で外した）。
      } else {
        td.append(el('span', { class: 'none' }, '—'));
      }
      tr.append(td);
    }
    return tr;
  }));
}

// ---- これまでの答え合わせ（利用者の指示、2026-10-15） ----
// その日最後のボーダー予想と、実際のボーダーの差。数字はバッチが計算したもの（ここでは計算しない）。
const ANSWER_ROWS = 30;        // 帯の表に出す日数
const pct1 = (v) => `${v.toFixed(1)}%`;
// 表の上のまとめの文（全ランク帯の外れの真ん中など）・日ごとの外れの真ん中の札・「まだ答え合わせできた日がありません…」は出さない
// （利用者の指示、2026-10-16「…の説明もいらない」「日ごとの外れの真ん中の札…いらない」「まだ答え合わせできた日がありません…の文…いらない」）。
// その日最後の安全圏（利用者の指示、2026-10-16「これまでの答え合わせに95%ラインもいれてくれない？」、
// 2026-10-18 に 95% から 90% の「安全圏」に替え、2026-10-21 からはふつうの日に 5 回に 4 回取れる線。設計書15）。10/18 より前の日は 95% の線しか覚えていないので出さない（過去の予想は書き換えない）。
// 越えた日の ▲ や色分けは付けない（2026-10-16「▲ は実際が…を越えた日です。の説明もいらないし、機能もいらない」）。
function lineOf(points) {
  return el('span', { class: 'wl', title: 'その日最後の安全圏' }, `安全圏 ${fmt(points)}`);
}
// 今の計算での予想（利用者の指示、2026-10-18「webのこれまでの答え合わせに今の計算での予想もだしてほしい」）。
// バッチが、その日に予想した時刻までに届いていた記録だけで、今のやり方で計算し直したもの（r[6]）と、実際との差（r[7]）。ここでは計算しない。
// スマホの幅では「の計算」を省いて「今 106,074」にする（入り切らず、表が右へはみ出したため）。
function nowOf(r) {
  const s = el('span', { class: 'wn', title: 'その日と同じ材料で、今のやり方で計算し直した予想' }, '今');
  s.append(el('span', { class: 'long' }, 'の計算'), ` ${fmt(r[6])}`);
  if (r[7] != null) s.append(el('span', { class: 'wd' }, `（${r[7] > 0 ? '+' : ''}${pct1(r[7])}）`));
  return s;
}
// ---- 答え合わせの統計と、1週間（7日）ごとのページ送り（利用者の指示、2026-10-26） ----
// 利用者の言葉「これまでの答え合わせの1番上に統計を出そう。統計日数、予想のプラスマイナス5パーセントで収まった回数、安全圏で収まった日、マイナスだった日、プラスだった日。
// あと直近1週間だけ出してページングにしよう」「統計は他出した方がいいのあればだして」。
// 利用者が選んだ形: 統計は選んでいる帯の、表に出す日（ANSWER_ROWS）の全部で数える（ページをめくっても数字は変わらない）／
// +2・+4・+6 を 1 本ずつ数える（「日×スコア」が 1 本）／1 ページ = 7 日で、新しい 7 日から古いほうへ。
// 追加で出したのは、±10% の本数と、安全圏の内を「ふつうの日」と「外れやすい日」に分けたもの（外れやすい日の一言が効いているかが分かる）。
// 数えるのは実際が届いた本だけ。差は（予想 − 実際）÷ 実際 で、＋は予想が高すぎ、−は低すぎ（バッチが決めた r[5]。ここでは計算しない）。
// 前に外した「外れの真ん中」の言葉と、安全圏を越えた日の ▲ は、今回も出さない。
const ANSWER_PAGE_DAYS = 7;
const pctOf = (a, b) => (b > 0 ? `${Math.round((a * 100) / b)}%` : '—');
function answerStats(rows, dates) {
  const inRange = new Set(dates);
  const done = rows.filter((r) => inRange.has(r[0]) && r[4] != null && r[5] != null);
  const safe = done.filter((r) => r[3] != null);
  const inSafe = (list) => list.filter((r) => r[4] <= r[3]).length;
  const normal = safe.filter((r) => r[8] === false);
  const risky = safe.filter((r) => r[8] === true);
  const tiles = [];
  const add = (label, value, sub, title) => tiles.push({ label, value, sub, title });
  // 数える相手が 1 本も無いときは「0 / 0 本」でなく「—」にする（安全圏を覚える前の日しか答えが届いていない帯など）
  const frac = (label, a, b, title, note = '') => add(label, b > 0 ? `${a} / ${b} 本` : '—', b > 0 ? `${pctOf(a, b)}${note}` : `まだありません${note}`, title);
  // 安全圏は 10/18 から覚えている（それより前の日は null。過去の予想は書き換えない）ので、分母は「統計の本数」より少なくなる。
  // 利用者の言葉（2026-10-26）「全部で30本なのに安全圏に収まったなど分母が21な理由がわからない」→ 外れた本数と、いつまでの日かを書く。
  const noSafe = done.filter((r) => r[3] == null);
  const noSafeNote = noSafe.length > 0 ? `（${noSafe.length} 本は ${md([...noSafe].sort((x, y) => (x[0] < y[0] ? 1 : -1))[0][0])} までで安全圏の記録なし）` : '';
  add('統計日数', `${new Set(done.map((r) => r[0])).size} 日`, `${done.length} 本`, '「本」は +2・+4・+6 を 1 本ずつ数えたものです');
  frac('予想の ±5% に収まった', done.filter((r) => Math.abs(r[5]) <= 5).length, done.length);
  frac('予想の ±10% に収まった', done.filter((r) => Math.abs(r[5]) <= 10).length, done.length);
  frac('安全圏の内に収まった', inSafe(safe), safe.length, '実際のボーダーが、その日最後の安全圏以下だった本数（安全圏を覚えている日だけ）', noSafeNote);
  // 目安の 80% は work-aa（安全圏のループ）の提案（2026-10-26）。日数が少ないうちは 80% から大きくぶれる（4 日の窓で 59〜95%、7 日の窓で 63〜91%）。
  frac('ふつうの日の安全圏の内', inSafe(normal), normal.length, '「外れやすい日」の札が付いていない日。安全圏は、ふつうの日なら 5 回に 4 回（80%）ほど収まる設計です');
  frac('外れやすい日の安全圏の内', inSafe(risky), risky.length, '「外れやすい日」の札が付いた日');
  add('マイナス（予想が低すぎ）', `${done.filter((r) => r[5] < 0).length} 本`, pctOf(done.filter((r) => r[5] < 0).length, done.length), '予想より実際が高かった本数');
  add('プラス（予想が高すぎ）', `${done.filter((r) => r[5] > 0).length} 本`, pctOf(done.filter((r) => r[5] > 0).length, done.length), '予想より実際が低かった本数');
  return done.length === 0 ? [] : tiles;
}
function renderAnswerStats(rows, dates) {
  const box = $('answer-stats');
  box.replaceChildren(...answerStats(rows, dates).map((t) => {
    const tile = el('div', { class: 'stat' });
    if (t.title) tile.title = t.title;
    tile.append(el('span', { class: 'sl' }, t.label), el('b', { class: 'sv' }, t.value), el('span', { class: 'ss' }, t.sub));
    return tile;
  }));
  box.hidden = !box.hasChildNodes();
}
function renderAnswers() {
  const rows = state.answers.get(state.band);
  const byDate = new Map();
  for (const r of rows || []) {
    if (!byDate.has(r[0])) byDate.set(r[0], new Map());
    byDate.get(r[0]).set(r[1], r);
  }
  const allDates = [...byDate.keys()].sort().reverse().slice(0, ANSWER_ROWS);
  renderAnswerStats(rows || [], allDates);
  // 帯を変えたら、いちばん新しい 7 日に戻す
  if (state.answerBand !== state.band) {
    state.answerBand = state.band;
    state.answerPage = 0;
  }
  const pages = Math.max(1, Math.ceil(allDates.length / ANSWER_PAGE_DAYS));
  state.answerPage = Math.min(Math.max(state.answerPage ?? 0, 0), pages - 1);
  const dates = allDates.slice(state.answerPage * ANSWER_PAGE_DAYS, (state.answerPage + 1) * ANSWER_PAGE_DAYS);
  $('answer-pager').hidden = allDates.length === 0;
  $('answer-range').textContent = dates.length ? `${mdw(dates[dates.length - 1])} 〜 ${mdw(dates[0])}` : '';
  $('answer-page-info').textContent = `${state.answerPage + 1} / ${pages}`;
  $('answer-page-prev').disabled = state.answerPage === 0;
  $('answer-page-next').disabled = state.answerPage >= pages - 1;
  $('answer-rows').replaceChildren(...dates.map((date) => {
    const d = dowOf(date);
    const tr = el('tr', { class: d === 0 ? 'sun' : d === 6 ? 'sat' : '' });
    const th = el('th', { scope: 'row' }, mdw(date));
    // 外れやすい日だった日には札を付ける（利用者の指示、2026-10-25「これまでの答え合わせのところで外れやすい日だったかどうかがわかるようにして」）。
    // r[8] は、その日のカードに出した一言があったか（10/25 からは当日に出した一言、それより前は今のルールで数え直したもの。バッチが決める。ここでは決めない）。
    // 札だけで理由は出さない（利用者の決定）。
    if ([...byDate.get(date).values()].some((r) => r[8] === true)) {
      th.append(riskyTag('この日は、予想のカードに「外れやすい日」の一言を出していた日です'));
    }
    // r[9] は、その日のカードに「直近の傾向」の一言を出していたか（バッチが決める。まだ覚えていない日・古い版の results.json は無い）
    if ([...byDate.get(date).values()].some((r) => r[9] === true)) {
      th.append(trendTag('この日は、予想のカードに「直近の傾向」の一言を出していた日です'));
    }
    tr.append(th);
    for (const s of SCORES) {
      const r = byDate.get(date).get(s);
      const td = el('td', { class: `n c${s}` });
      if (!r) {
        td.append(el('span', { class: 'none' }, '—'));
      } else if (r[4] == null) {
        td.append(el('span', { class: 'pending' }, '結果待ち'), el('span', { class: 'wp' }, `予想 ${fmt(r[2])}`));
        if (r[6] != null) td.append(nowOf(r));
        if (r[3] != null) td.append(lineOf(r[3]));
      } else {
        // 実際が安全圏を越えた日の ▲ と色分けは付けない（利用者の指示、2026-10-16「▲ は実際が…を越えた日です。の説明もいらないし、機能もいらない」）。
        // 差は別の部品にして、スマホの幅では次の行に分ける（1行だと 390px の幅で表が右へはみ出した。2026-10-16）
        const wp = el('span', { class: 'wp' }, `予想 ${fmt(r[2])}`);
        wp.append(el('span', { class: 'wd' }, `（${r[5] > 0 ? '+' : ''}${pct1(r[5])}）`));
        td.append(el('span', { class: 'wa', title: '実際のボーダー' }, fmt(r[4])), wp);
        if (r[6] != null) td.append(nowOf(r));
        if (r[3] != null) td.append(lineOf(r[3]));
      }
      tr.append(td);
    }
    return tr;
  }));
  const empty = $('answer-empty');
  empty.textContent = state.results ? `${state.band} の答え合わせは、まだありません。` : '答え合わせを読み込めませんでした。時間をおいて開き直してください。';
  empty.hidden = allDates.length > 0;
}
// ページ送り（‹ = 新しい 7 日へ、› = 古い 7 日へ。「これまでの実際のボーダー」のページ送りと同じ向き）
$('answer-page-prev').addEventListener('click', () => { state.answerPage -= 1; renderAnswers(); });
$('answer-page-next').addEventListener('click', () => { state.answerPage += 1; renderAnswers(); });

// ---- 曜日×週の色分け表（利用者が選んだ案 C、2026-10-14） ----
// 横は月〜日、縦は直近12週と、予想のある来週まで。色が濃いほどボーダーが高い（表の中の最小〜最大で濃さを決める）。
// 今日から先は予想を点線の枠で入れ、過去の同じ曜日と並べて見比べられるようにする。月曜・月初が高いといった癖も見える。
const HEAT_MIN = 0.05, HEAT_MAX = 0.75;   // 濃淡の幅（いちばん低い日はほぼ地のまま）
function renderHeat() {
  const cls = current();
  const score = state.heatScore;
  // 色は配色ごとの1つの色の濃淡（2026-10-16）。前は +2/+4/+6 の色を 85% まで濃く塗り、「見た目浮いちゃっている」と言われた。
  // 文字を --on-strong に切り替える濃さは、配色ごとに tools/make-site-themes.py が測って --heat-flip に書く。
  const css = getComputedStyle(document.documentElement);
  const rgb = css.getPropertyValue('--heat-rgb').trim() || '86, 180, 233';
  const flip = Number(css.getPropertyValue('--heat-flip')) || 0.55;
  const idx = SCORES.indexOf(score) + 1;
  const today = dayNumber(jstToday());
  const mondayOf = (n) => n - ((new Date(n * 86400000).getUTCDay() + 6) % 7);
  const forecastNs = Object.keys(cls.forecasts).map(dayNumber).filter((n) => n >= today);
  const lastWeek = mondayOf(Math.max(today, ...forecastNs));

  const weeks = [];
  for (let w = mondayOf(today) - (state.heatWeeks - 1) * 7; w <= lastWeek; w += 7) {
    weeks.push(MONDAY_FIRST.map((_, i) => {
      const n = w + i;
      const iso = isoOfDay(n);
      const fc = n >= today ? cls.forecasts[iso]?.find((c) => c.score === score) : null;
      const actual = n < today ? actualRow(iso)?.[idx] ?? null : null;
      return { n, iso, value: fc ? fc.points : actual, forecast: !!fc };
    }));
  }

  const values = weeks.flat().filter((c) => c.value != null).map((c) => c.value);
  const lo = Math.min(...values), hi = Math.max(...values);
  const average = MONDAY_FIRST.map((_, i) => {
    const v = weeks.map((w) => w[i]).filter((c) => !c.forecast && c.value != null).map((c) => c.value);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  });

  $('heat-head').replaceChildren(...MONDAY_FIRST.map((d, i) => {
    const th = el('th', { scope: 'col', class: d === 0 ? 'sun' : d === 6 ? 'sat' : '' });
    th.append(el('span', { class: 'hw' }, DOW[d]), el('span', { class: 'ha', title: `直近${state.heatWeeks}週の${DOW[d]}曜の平均` }, average[i] == null ? '—' : short(Math.round(average[i]))));
    return th;
  }));

  $('heat-rows').replaceChildren(...weeks.map((week) => {
    const tr = el('tr');
    for (const c of week) {
      const names = [];
      if (c.forecast) names.push('fc');
      if (c.n === today) names.push('today');
      if (c.forecast && c.iso === state.day) names.push('on');
      if (c.value == null) names.push(c.n >= today ? 'later' : 'blank');   // .empty はお知らせの枠の名前なので使わない
      const td = el('td', { class: names.join(' ') });
      if (c.value != null) {
        const t = hi > lo ? (c.value - lo) / (hi - lo) : 0.5;
        const alpha = HEAT_MIN + (HEAT_MAX - HEAT_MIN) * t;
        td.style.backgroundColor = `rgba(${rgb},${alpha.toFixed(2)})`;
        if (alpha >= flip) td.classList.add('dark');
        td.title = `${mdw(c.iso)} ${c.forecast ? 'のボーダー予想' : 'の実際のボーダー'} +${score}: ${fmt(c.value)} pt`;
      }
      if (c.forecast) { td.dataset.day = c.iso; td.tabIndex = 0; }
      td.append(el('span', { class: 'hd' }, md(c.iso)), el('span', { class: 'hv' }, c.value == null ? (c.n >= today ? '' : '—') : short(c.value)));
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
  renderHeat();
  // スマホでは上のカードが画面の外にあるので、そこまで戻す。
  const hero = document.querySelector('.hero');
  if (hero.getBoundingClientRect().top < 0) hero.scrollIntoView({ behavior: 'smooth' });
}

// ---- パネルの開け閉め（利用者の指示、2026-10-16「各パネルに閉じれる機能つけようか。再度開いたときに…パネルの開けしめは記憶しておいてほしい」） ----
// 見出しの右に「閉じる／開く」を置く。閉じても見出しは残す（上のボーダー予想は、見出しの中のランク帯の選ぶ欄も残す）。
// どのパネルを閉じたかは、見出しの id でこのブラウザに覚える。
const FOLD_KEY = 'folded';
function foldedSet() {
  try { return new Set(JSON.parse(store.get(FOLD_KEY) || '[]')); } catch { return new Set(); }
}
// ボタンは文字でなく矢印のアイコン（利用者の指示、2026-10-16「閉じる。開くはダサいから、アイコンでわかりやすいのでして」）。
// 開いているときは ∧（たたむ）、閉じているときは ∨（開く）。向きは CSS で aria-expanded から回す。名前は読み上げとなぞったときの説明に入れる。
const ARROW_UP = 'M6 15l6-6 6 6';
const ARROW_DOWN = 'M6 9l6 6 6-6';
function icon(d) {
  const svg = svgEl('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' });
  svg.append(svgEl('path', { d }));
  return svg;
}
const foldIcon = () => icon(ARROW_UP);
// パネルの名前は、見出しの文字の部分だけから作る（上のボーダー予想の見出しには、ランク帯の選ぶ欄が入っている）。開け閉めの読み上げと設定の一覧で使う。
const headingText = (heading) => [...(heading?.childNodes ?? [])].filter((n) => n.nodeType === Node.TEXT_NODE)
  .map((n) => n.textContent).join('').trim().replace(/^の/, '');
function setFolded(section, button, folded) {
  section.classList.toggle('folded', folded);
  const title = headingText($(section.getAttribute('aria-labelledby'))) || 'パネル';
  button.setAttribute('aria-expanded', String(!folded));
  button.setAttribute('aria-label', `${title}を${folded ? '開く' : '閉じる'}`);
  button.title = folded ? '開く' : '閉じる';
}
function setupFolds() {
  const saved = foldedSet();
  for (const section of document.querySelectorAll('main section[aria-labelledby]')) {
    const head = section.querySelector('.panel-head, .hero-head');
    if (!head) continue;
    const key = section.getAttribute('aria-labelledby');
    const button = el('button', { type: 'button', class: 'fold' });
    button.append(foldIcon());
    head.append(button);
    setFolded(section, button, saved.has(key));
    button.addEventListener('click', () => {
      const now = foldedSet();
      const folded = !section.classList.contains('folded');
      if (folded) now.add(key); else now.delete(key);
      store.set(FOLD_KEY, JSON.stringify([...now]));
      setFolded(section, button, folded);
    });
  }
}
setupFolds();

// ---- 設定（利用者の指示、2026-10-16「上のヘッダのところに設定アイコンおいて。色の設定。各カードの表示非表示。順番の入れ替えを設定できるようにしよう。
// もちろん設定したらブラウザに保存するようにしてね。色は和のイメージの色でお願い」） ----
// 利用者が選んだ形: 表示・並べ替えの対象はパネル6つ（上のボーダー予想は常に先頭）、並べ替えは ↑↓ ボタン、
// 配色は画面全体を和の色の組み合わせで。選んだものはすぐ画面に当て、このブラウザに覚える。
// 配色の色の値は style.css の [data-theme]、最初に当てるのは theme.js（本文を描く前に当て、いつもの配色が一瞬見えないように）。
// 「もう３種類色が欲しい」（2026-10-16）で 茜・桜・青磁 を足した。地はどれも名前の色そのもの（「背景色を指定のメイン色にしてほしいんだ」）なので、
// 「明るい地」の書き添えはやめた（見本の色で分かる。藤・抹茶もパネルは白に近く、3つにだけ付けると食い違う）。
// id は保存されているので変えない（夜桜は sakura、明るい桜は sakurairo）。色の値は tools/make-site-themes.py。
const THEMES = [
  { id: 'ai', name: '藍', reading: 'あい' },
  { id: 'sumi', name: '墨と朱', reading: 'すみとしゅ' },
  { id: 'akane', name: '茜', reading: 'あかね' },
  { id: 'sakura', name: '夜桜', reading: 'よざくら' },
  { id: 'fuji', name: '藤', reading: 'ふじ' },
  { id: 'matcha', name: '抹茶', reading: 'まっちゃ' },
  { id: 'washi', name: '和紙', reading: 'わし' },
  { id: 'sakurairo', name: '桜', reading: 'さくら' },
  { id: 'seiji', name: '青磁', reading: 'せいじ' },
];
const LAYOUT_KEY = 'layout';
const panelOf = (id) => document.querySelector(`#panels > section[aria-labelledby="${id}"]`);
const DEFAULT_ORDER = [...document.querySelectorAll('#panels > section[aria-labelledby]')].map((s) => s.getAttribute('aria-labelledby'));
const panelName = (id) => headingText($(id)) || id;

// 最初は表示しないパネル（設定でオンにすると出る）。並びは index.html の順で、答え合わせはいちばん下
// （2026-10-16「これまでの答え合わせは一番下でよくて、デフォルト非表示にして」）。
const DEFAULT_HIDDEN = ['answer-title'];
// 覚えた並びの形の版。版 1（印なし）は、答え合わせが2番目で表示するのが既定だったころのもの。
const LAYOUT_VERSION = 2;
function loadLayout() {
  let saved = {};
  try { saved = JSON.parse(store.get(LAYOUT_KEY) || '{}') || {}; } catch { saved = {}; }
  const known = new Set(DEFAULT_ORDER);
  // 覚えた並びに無いパネル（あとでサイトに足したもの）は、後ろに足す。もう無いパネルは捨てる。
  let order = (Array.isArray(saved.order) ? saved.order : []).filter((id, i, all) => known.has(id) && all.indexOf(id) === i);
  const hidden = Array.isArray(saved.hidden) ? saved.hidden.filter((id) => known.has(id)) : [...DEFAULT_HIDDEN];
  // 版 1 で覚えた並びは、答え合わせだけ新しい既定（いちばん下・表示しない）に合わせる。ほかのパネルの選択はそのまま。
  // 版 1 では「答え合わせが見えている」のが既定で、選んで見えるようにしたのかが分からないため。次に設定を変えると版 2 で覚える。
  if (Array.isArray(saved.order) && saved.v !== LAYOUT_VERSION) {
    order = order.filter((id) => id !== 'answer-title');
    if (!hidden.includes('answer-title')) hidden.push('answer-title');
  }
  for (const id of DEFAULT_ORDER) if (!order.includes(id)) order.push(id);
  return { order, hidden: new Set(hidden) };
}
function saveLayout(layout) {
  store.set(LAYOUT_KEY, JSON.stringify({ v: LAYOUT_VERSION, order: layout.order, hidden: [...layout.hidden] }));
}
function applyLayout(layout = loadLayout()) {
  const box = $('panels');
  for (const id of layout.order) box.append(panelOf(id));
  for (const id of DEFAULT_ORDER) {
    const s = panelOf(id);
    s.hidden = layout.hidden.has(id);
    s.classList.remove('side-wide', 'side-narrow');
  }
  // 「推移」と「全ランク帯」が隣り合うときだけ、PC の幅で左右に並べる（推移が左。前の並びと同じ）。離れていれば、どちらも横いっぱい。
  const visible = layout.order.filter((id) => !layout.hidden.has(id));
  const a = visible.indexOf('chart-title');
  const b = visible.indexOf('overview-title');
  if (a >= 0 && b >= 0 && Math.abs(a - b) === 1) {
    panelOf('chart-title').classList.add('side-wide');
    panelOf('overview-title').classList.add('side-narrow');
  }
}
applyLayout();

const currentTheme = () => document.documentElement.getAttribute('data-theme') || 'ai';
function setTheme(id) {
  const applied = window.iridockTheme ? window.iridockTheme.apply(id) : (document.documentElement.setAttribute('data-theme', id), id);
  store.set('theme', applied);
  // 色分け表は色を数で塗っているので、塗り直す（グラフは色の変数で描いているので、そのまま変わる）。
  if (state.forecasts && state.band) renderHeat();
}

function renderSettings(focus) {
  const theme = currentTheme();
  $('theme-list').replaceChildren(...THEMES.map((t) => {
    const b = el('button', { type: 'button', class: 'theme-opt', 'data-pick': t.id, 'aria-pressed': String(t.id === theme) });
    // 見本はその配色の data-theme を付けて描く: 地の上にパネルの色の札を置き、見出しの色の明朝の「和」と +2/+4/+6 の点を並べる。
    // 前は地の上にじかに点を並べていて、地とパネルの色が違う配色（茜は紅白）では、点が地に沈んで見えなかった。
    const sw = el('span', { class: 'swatch', 'data-theme': t.id, 'aria-hidden': 'true' });
    const chip = el('span', { class: 'chip' });
    chip.append(el('b', {}, '和'), el('i', { class: 's2' }), el('i', { class: 's4' }), el('i', { class: 's6' }));
    sw.append(chip);
    const name = el('span', { class: 'theme-name' }, t.name);
    name.append(el('small', {}, t.reading));
    b.append(sw, name);
    return b;
  }));
  const layout = loadLayout();
  $('layout-list').replaceChildren(...layout.order.map((id, i) => {
    const on = !layout.hidden.has(id);
    const li = el('li', { class: on ? '' : 'off', 'data-id': id });
    const label = el('label');
    const box = el('input', { type: 'checkbox', 'data-act': 'show', 'aria-label': `${panelName(id)}を出す` });
    box.checked = on;
    label.append(box, el('span', {}, panelName(id)));
    const up = el('button', { type: 'button', class: 'move', 'data-act': 'up', 'aria-label': `${panelName(id)}を上へ`, title: '上へ' });
    up.append(icon(ARROW_UP));
    up.disabled = i === 0;
    const down = el('button', { type: 'button', class: 'move', 'data-act': 'down', 'aria-label': `${panelName(id)}を下へ`, title: '下へ' });
    down.append(icon(ARROW_DOWN));
    down.disabled = i === layout.order.length - 1;
    li.append(label, up, down);
    return li;
  }));
  if (focus) $('layout-list').querySelector(`li[data-id="${focus.id}"] [data-act="${focus.act}"]`)?.focus();
}

$('open-settings').addEventListener('click', () => {
  renderSettings();
  $('settings').showModal();
});
$('close-settings').addEventListener('click', () => $('settings').close());
// 外側（暗くした所）を押しても閉じる。キーボードで押したときは位置が 0 になるので、ダイアログそのものを押したときだけ見る。
$('settings').addEventListener('click', (e) => {
  if (e.target !== $('settings')) return;
  const r = $('settings').getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) $('settings').close();
});
$('theme-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pick]');
  if (!b) return;
  setTheme(b.dataset.pick);
  renderSettings();
  $('theme-list').querySelector(`[data-pick="${b.dataset.pick}"]`)?.focus();
});
$('layout-list').addEventListener('change', (e) => {
  if (e.target.dataset.act !== 'show') return;
  const id = e.target.closest('li').dataset.id;
  const layout = loadLayout();
  if (e.target.checked) layout.hidden.delete(id); else layout.hidden.add(id);
  saveLayout(layout);
  applyLayout(layout);
  renderSettings({ id, act: 'show' });
});
$('layout-list').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const id = b.closest('li').dataset.id;
  const layout = loadLayout();
  const i = layout.order.indexOf(id);
  const j = b.dataset.act === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= layout.order.length) return;
  [layout.order[i], layout.order[j]] = [layout.order[j], layout.order[i]];
  saveLayout(layout);
  applyLayout(layout);
  // 動かした行の同じボタンに戻す（端に着いてそのボタンが押せなくなったら、反対のボタンに）。
  const last = layout.order.length - 1;
  const act = b.dataset.act === 'up' ? (j === 0 ? 'down' : 'up') : (j === last ? 'up' : 'down');
  renderSettings({ id, act });
});
$('reset-settings').addEventListener('click', () => {
  store.set(LAYOUT_KEY, '{}');
  setTheme('ai');
  applyLayout();
  renderSettings();
});

// ---- 操作 ----
$('band').addEventListener('change', (e) => selectBand(e.target.value));
$('bar-band').addEventListener('change', (e) => selectBand(e.target.value));
// いちばん上へ戻る（動きを減らす設定の人には、すっと動かさずにすぐ戻す）。
$('to-top').addEventListener('click', () => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
});
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
// 並べる週の数（2026-10-17「曜日毎のボーダーも4,8,12週を選択できるようにしよう」）。選んだものはこのブラウザに覚える。
function setHeatWeeks(n) {
  state.heatWeeks = HEAT_WEEK_CHOICES.includes(n) ? n : 12;
  for (const x of document.querySelectorAll('#heat-weeks button')) x.setAttribute('aria-pressed', String(Number(x.dataset.weeks) === state.heatWeeks));
  $('heat-sub').textContent = `直近${state.heatWeeks}週と、この先の予想`;
  for (const x of document.querySelectorAll('.heat-n')) x.textContent = String(state.heatWeeks);
}
setHeatWeeks(Number(store.get('heatWeeks')) || 12);
$('heat-weeks').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-weeks]');
  if (!b) return;
  setHeatWeeks(Number(b.dataset.weeks));
  store.set('heatWeeks', String(state.heatWeeks));
  if (state.forecasts) renderHeat();
});
$('heat-score').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-score]');
  if (!b) return;
  state.heatScore = Number(b.dataset.score);
  for (const x of document.querySelectorAll('#heat-score button')) x.setAttribute('aria-pressed', String(x === b));
  renderHeat();
});
$('heat-rows').addEventListener('click', (e) => selectDay(e.target.closest('td[data-day]')?.dataset.day));
$('heat-rows').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  selectDay(e.target.closest('td[data-day]')?.dataset.day);
});
$('range').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-days]');
  if (!b) return;
  state.range = Number(b.dataset.days);
  for (const x of document.querySelectorAll('#range button')) x.setAttribute('aria-pressed', String(x === b));
  renderChart();
});

const refilter = () => { state.page = 0; renderTable(); };
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
// ページ送り。選んだ件数はこのブラウザに覚える（ランク帯・開け閉めと同じ）。
{
  const saved = Number(store.get('perPage'));
  if (PER_PAGES.includes(saved)) state.perPage = saved;
  $('per-page').value = String(state.perPage);
}
$('per-page').addEventListener('change', (e) => {
  state.perPage = PER_PAGES.includes(Number(e.target.value)) ? Number(e.target.value) : PER_PAGES[0];
  store.set('perPage', String(state.perPage));
  state.page = 0;
  renderTable();
});
for (const [id, to] of [['page-first', () => 0], ['page-prev', () => state.page - 1], ['page-next', () => state.page + 1], ['page-last', () => Infinity]]) {
  $(id).addEventListener('click', () => { state.page = to(); renderTable(); });
}
document.querySelector('#actual thead').addEventListener('click', (e) => {
  const b = e.target.closest('.sort');
  if (!b) return;
  const key = b.dataset.sort === 'date' ? 'date' : Number(b.dataset.sort);
  state.sort = { key, asc: state.sort.key === key ? !state.sort.asc : false };
  state.page = 0;
  renderTable();
});

window.addEventListener('hashchange', () => {
  const name = decodeURIComponent(location.hash.slice(1));
  if (state.forecasts && name && name !== state.band && state.forecasts.classes.some((c) => c.rankClass === name)) selectBand(name);
});

// 開き直したときに、最新に追いつく（毎日昼ごろに更新される）。
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.forecasts && Date.now() - state.loadedAt > RELOAD_MINUTES * 60000) load();
});

// 幅が変わったら、グラフを描き直す（文字がつぶれないよう、実際の幅で描いている）。
let resizeTimer;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (state.forecasts && state.band) renderChart(); }, 120);
}).observe($('chartbox'));

load();
