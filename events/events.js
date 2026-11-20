// イベント予想（利用者の指示、2026-11-20。設計書 17）。data/events.json（毎日のバッチが作る）を読んで並べるだけで、計算はしない。
// ボーダー予想のデータには頼らない。保存するのは、選んだ帯と開催の状態だけ（ブラウザの localStorage。使えなくても動く）。
(() => {
  'use strict';

  // 帯の並びは上から（S3 がいちばん上、D がいちばん下）。イベントの帯は「S1〜S3」のような範囲で、間の帯も含む。
  const BANDS = ['S3', 'S2', 'S1', 'A3', 'A2', 'A1', 'B3', 'B2', 'B1', 'C5', 'C4', 'C3', 'C2', 'C1', 'D'];
  const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
  const $ = (id) => document.getElementById(id);

  const store = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* 保存できなくても動く */ } },
  };

  const state = {
    band: store.get('eventBand') || 'all',
    status: store.get('eventStatus') || 'all',
    query: '',
  };
  let events = [];

  function showNotice(text) {
    const el = $('notice');
    el.textContent = text;
    el.hidden = !text;
  }

  const yen = (n) => Number(n).toLocaleString('ja-JP');

  // '2026-11-24T19:00' → '11/24（火）19:00'。ブラウザの時刻に直さず、書いてある日本時間のまま出す。
  function when(text) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text);
    if (!m) return text;
    const weekday = WEEKDAYS[new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay()];
    return `${Number(m[2])}/${Number(m[3])}（${weekday}）${m[4]}:${m[5]}`;
  }

  function day(text) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    return m ? `${Number(m[2])}/${Number(m[3])}` : text;
  }

  // 日本時間の「いま」を '2026-11-24T19:00' の形で。見ている人の端末の時刻帯に左右されないよう、UTC から +9 時間で作る。
  function nowJst() {
    return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 16);
  }

  function coversBand(ranks, band) {
    if (!ranks || ranks.length === 0) return true;
    const at = BANDS.indexOf(band);
    const indexes = ranks.map((r) => BANDS.indexOf(r)).filter((i) => i >= 0);
    if (at < 0 || indexes.length === 0) return true;
    return at >= Math.min(...indexes) && at <= Math.max(...indexes);
  }

  function rangeText(ranks) {
    if (!ranks || ranks.length === 0) return '全ランク帯';
    return ranks.length === 1 ? ranks[0] : `${ranks[0]}〜${ranks[ranks.length - 1]}`;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // 予想と安全圏の表。1行目は見出し、あとは順位ごとの行（1位・入賞の最下位）。数字は桁がそろうよう、決まった列に置く。
  // 入るグループで変わる幅（2026-11-21「幅だけたすか」）は、その順位の行のすぐ下に小さく置く（スマホで別の行に離すと、どの順位の幅か追いにくかった）。
  function numberRow(grid, rankText, note, forecast, safe, low, high) {
    const rank = el('div', 'ev-rank');
    rank.append(el('b', '', rankText));
    if (note) rank.append(el('small', '', note));
    grid.append(rank);
    for (const [value, className] of [[forecast, 'ev-forecast'], [safe, 'ev-safe']]) {
      const cell = el('div', `ev-val ${className}`, yen(value));
      cell.append(el('small', '', 'pt'));
      grid.append(cell);
    }
    if (low != null && high != null) {
      const spread = el('div', 'ev-gspread', '入るグループで ');
      spread.append(el('b', '', `${yen(low)}〜${yen(high)}`));
      grid.append(spread);
    }
  }

  // 数字か「低い〜高い」の幅を node に入れる。幅は「〜」のあとで折り返せる（数字の途中では折り返さない）。
  function putValue(node, value, low, high) {
    if (low != null && high != null) {
      node.append(el('span', 'ev-n', yen(low)), '〜', document.createElement('wbr'), el('span', 'ev-n', yen(high)));
    } else {
      node.append(value == null ? '—' : yen(value));
    }
  }

  // 前の回の実際の小さな表（1 回が 1 行。列は日付・1位・入賞の最下位）。
  // 前は日付を列にして横に 4 回並べたが、幅 320 の iPhone では 6 桁の数字が収まらず、カードごと横にはみ出した（2026-11-21「スマホで横がはみ出す」）。
  // グループに分かれた回は、グループ1の数字でなく全グループの「低い〜高い」を出す（「過去データに幅がないし見ずらい」）。
  function recentTable(e, hasPrize) {
    const showPrize = hasPrize && e.recent.some((r) => r.prize != null);
    const table = el('table', 'ev-rtable');
    const head = el('tr');
    head.append(el('th', 'ev-rlabel', '前の回'), el('th', 'ev-rhead', '1位'));
    if (showPrize) head.append(el('th', 'ev-rhead', `${e.prizeRank}位`));
    const thead = el('thead');
    thead.append(head);
    const body = el('tbody');
    for (const r of e.recent) {
      const tr = el('tr');
      const date = el('th', 'ev-rlabel', day(r.date));
      if (r.groups >= 2) date.append(el('span', 'ev-rg', `${r.groups}グループ`));
      const top = el('td');
      putValue(top, r.top, r.topLow, r.topHigh);
      tr.append(date, top);
      if (showPrize) {
        const prize = el('td');
        putValue(prize, r.prize, r.prizeLow, r.prizeHigh);
        tr.append(prize);
      }
      body.append(tr);
    }
    table.append(thead, body);
    return table;
  }

  // 開いている「過去の回」（名前と始まりで覚える。絞り込みで描き直しても開いたまま。ブラウザには保存しない）
  const opened = new Set();
  const keyOf = (e) => `${e.name}|${e.start}|${(e.ranks || []).join('/')}`;
  const thisYear = nowJst().slice(0, 4);

  // '2026-11-13' → '11/13'。今年でなければ年も付ける（材料は 2026 年 3 月からで、年をまたぐと見分けが要る）
  function dayWithYear(text) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    if (!m) return text;
    return m[1] === thisYear ? `${Number(m[2])}/${Number(m[3])}` : `${m[1]}/${Number(m[2])}/${Number(m[3])}`;
  }

  // 下向きの山形（開くと回して上向き）。ボーダー予想のパネルの開け閉めと同じ形
  function chevron() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M6 9l6 6 6-6');
    svg.append(path);
    return svg;
  }

  // 押すと開く過去の回（2026-11-20「イベントを押下したら過去のイベント名や点数などがみれるようにしてほしい」）。
  // 記録のある全部の回を新しい順に、名前・期間・記録のある全部の順位のポイント。予想に使う 1位と入賞の最下位は太字で目立たせる。
  function pastList(e, id) {
    const box = el('div', 'ev-past');
    box.id = id;
    const list = el('ol', 'ev-plist');
    for (const p of e.past) {
      const row = el('li', 'ev-prow');
      const head = el('div', 'ev-phead');
      head.append(el('span', 'ev-pdate', `${dayWithYear(p.start)}〜${dayWithYear(p.end)}`), el('span', 'ev-pname', p.name));
      const pts = el('div', 'ev-ppts');
      // グループに分かれた回は、順位ごとに全グループの「低い〜高い」（2026-11-21「過去データに幅がない」）。グループ1だけの数字は、たまたまの1グループなので出さない
      const multi = p.groups >= 2 && Array.isArray(p.lows);
      if (multi) pts.append(el('span', 'ev-pgroups', `${p.groups}グループ`));
      p.points.forEach((v, i) => {
        const rank = i + 1;
        const cell = el('span', rank === 1 || rank === e.prizeRank ? 'ev-pt ev-key' : 'ev-pt', `${rank}位 `);
        const b = el('b');
        putValue(b, v, multi ? p.lows[i] : null, multi ? p.highs[i] : null);
        cell.append(b);
        pts.append(cell);
      });
      row.append(head, pts);
      list.append(row);
    }
    box.append(list);
    return box;
  }

  function setOpen(item, open) {
    const button = item.querySelector('.ev-more');
    const box = item.querySelector('.ev-past');
    if (!button || !box) return;
    box.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    button.querySelector('.ev-more-text').textContent = open ? '過去の回を閉じる' : `過去の回を見る（${button.dataset.count}回）`;
    item.classList.toggle('open', open);
    if (open) opened.add(item.dataset.key); else opened.delete(item.dataset.key);
  }

  // 予想を出さない理由。前の回が全く無い（初めての企画）／前の回はあるが 1位のポイントの記録が無い（順位を競わない企画など）／記録が 3 回に満たない
  function noForecastText(e) {
    if (e.seen === 0) return '前の回がないため、予想は出せません（初めての企画のようです）。';
    if (e.runs === 0) return `前の ${e.seen} 回の結果に、1位のポイントの記録がないため、予想は出せません。`;
    return `前の回の1位の記録が ${e.runs} 回しかないため、予想は出せません（3 回から出します）。`;
  }

  function render() {
    const now = nowJst();
    const text = state.query.trim().toLowerCase();
    const shown = events
      .filter((e) => e.end >= now)
      .map((e) => ({ ...e, status: e.start <= now ? 'live' : 'soon' }))
      .filter((e) => state.status === 'all' || e.status === state.status)
      .filter((e) => state.band === 'all' || coversBand(e.ranks, state.band))
      .filter((e) => !text || e.name.toLowerCase().includes(text))
      .sort((a, b) => (a.status === b.status ? (a.status === 'live' ? a.end.localeCompare(b.end) : a.start.localeCompare(b.start)) : (a.status === 'live' ? -1 : 1)) || a.name.localeCompare(b.name, 'ja'));

    const list = $('ev-list');
    list.replaceChildren();
    for (const e of shown) {
      const item = el('li', 'ev-item');

      const head = el('div', 'ev-head');
      const titles = el('div');
      titles.append(el('h3', 'ev-name', e.name));
      const meta = el('p', 'ev-meta');
      const range = el('b', '', rangeText(e.ranks));
      meta.append(range, ` ・ ${when(e.start)} 〜 ${when(e.end)}`);
      titles.append(meta);
      head.append(titles, el('span', `ev-tag ${e.status}`, e.status === 'live' ? '開催中' : 'これから'));
      item.append(head);

      const hasTop = e.forecast != null && e.safe != null;
      const hasPrize = e.prizeRank > 1 && e.prizeForecast != null && e.prizeSafe != null;
      if (hasTop || hasPrize) {
        const nums = el('div', 'ev-nums');
        // 入るグループによって変わる幅（2026-11-21「幅だけたすか」。設計書 17 の 2a）。どのグループに入るかはくじ引きで、
        // グループごとの1位は大きく違うので、前の回のいちばん低い・高いグループの目安を各順位の行の下に出す（数字の作りはバッチ側の EventSiteExport.GroupSpread）。
        // グループの数は、表の左上の空いている所に置く。
        const topSpread = hasTop && e.topLow != null && e.topHigh != null;
        const prizeSpread = hasPrize && e.prizeLow != null && e.prizeHigh != null;
        const corner = el('div', 'ev-corner', (topSpread || prizeSpread) && e.groups >= 2 ? `${e.groups}グループ` : '');
        nums.append(corner, el('div', 'ev-colhead ev-forecast', '予想'), el('div', 'ev-colhead ev-safe', '安全圏'));
        if (hasTop) numberRow(nums, '1位', '', e.forecast, e.safe, topSpread ? e.topLow : null, topSpread ? e.topHigh : null);
        if (hasPrize) numberRow(nums, `${e.prizeRank}位`, '入賞の最下位', e.prizeForecast, e.prizeSafe, prizeSpread ? e.prizeLow : null, prizeSpread ? e.prizeHigh : null);
        item.append(nums);
      } else {
        item.append(el('p', 'ev-none', noForecastText(e)));
      }

      if (e.recent && e.recent.length > 0) item.append(recentTable(e, hasPrize));

      // 過去の回の帯。押せることが一目で分かるよう、文字と山形の帯にする（利用者の選択「下に「過去の回を見る」の帯」）。
      // イベントのどこを押しても開け閉めできる（「イベントを押下したら…」）。開いた一覧の中を押しても閉じない。
      if (e.past && e.past.length > 0) {
        const id = `ev-past-${shown.indexOf(e)}`;
        item.classList.add('has-past');
        item.dataset.key = keyOf(e);
        const button = el('button', 'ev-more');
        button.type = 'button';
        button.dataset.count = String(e.past.length);
        button.setAttribute('aria-controls', id);
        button.append(el('span', 'ev-more-text'), chevron());
        item.append(button, pastList(e, id));
        setOpen(item, opened.has(item.dataset.key));
      }
      list.append(item);
    }

    $('ev-empty').hidden = shown.length > 0;
    const live = shown.filter((e) => e.status === 'live').length;
    $('list-count').textContent = `${shown.length} 件（開催中 ${live} 件・これから ${shown.length - live} 件）`;
  }

  function setupControls() {
    const select = $('ev-band');
    const all = el('option', '', 'すべての帯');
    all.value = 'all';
    select.append(all);
    for (const band of BANDS) {
      const o = el('option', '', band);
      o.value = band;
      select.append(o);
    }
    if (state.band !== 'all' && !BANDS.includes(state.band)) state.band = 'all';
    select.value = state.band;
    select.addEventListener('change', () => {
      state.band = select.value;
      store.set('eventBand', state.band);
      render();
    });

    const seg = $('ev-status');
    const press = () => {
      for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.status === state.status));
    };
    if (!['all', 'live', 'soon'].includes(state.status)) state.status = 'all';
    press();
    seg.addEventListener('click', (ev) => {
      const button = ev.target.closest('button[data-status]');
      if (!button) return;
      state.status = button.dataset.status;
      store.set('eventStatus', state.status);
      press();
      render();
    });

    $('ev-q').addEventListener('input', (ev) => {
      state.query = ev.target.value;
      render();
    });

    // イベントを押すと過去の回を開け閉めする。開いた一覧の中・文字を選んでいる途中は、開け閉めしない
    $('ev-list').addEventListener('click', (ev) => {
      const item = ev.target.closest('.ev-item.has-past');
      if (!item) return;
      if (!ev.target.closest('.ev-more') && ev.target.closest('.ev-past')) return;
      const selected = window.getSelection ? String(window.getSelection()) : '';
      if (selected && !ev.target.closest('.ev-more')) return;
      setOpen(item, !item.classList.contains('open'));
    });
  }

  async function load() {
    setupControls();
    try {
      const res = await fetch('../data/events.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      // 4 でグループの数と幅、3 で過去の回（past）を足した。2・3 は前の形（公開の切り替わりの間だけ読むことがある）
      if (![2, 3, 4].includes(data.version) || !Array.isArray(data.events)) throw new Error('形が違います');
      events = data.events;
      const t = new Date(data.generatedAt);
      if (!Number.isNaN(t.getTime())) {
        $('updated').textContent = `${t.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })} 更新`;
      }
      showNotice('');
    } catch {
      showNotice('イベントのデータを読み込めませんでした。しばらくしてからもう一度開いてください。');
    }
    render();
  }

  load();
})();
