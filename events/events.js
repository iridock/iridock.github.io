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
  function numberRow(grid, rankText, note, forecast, safe) {
    const rank = el('div', 'ev-rank');
    rank.append(el('b', '', rankText));
    if (note) rank.append(el('small', '', note));
    grid.append(rank);
    for (const [value, className] of [[forecast, 'ev-forecast'], [safe, 'ev-safe']]) {
      const cell = el('div', `ev-val ${className}`, yen(value));
      cell.append(el('small', '', 'pt'));
      grid.append(cell);
    }
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
      p.points.forEach((v, i) => {
        const rank = i + 1;
        const cell = el('span', rank === 1 || rank === e.prizeRank ? 'ev-pt ev-key' : 'ev-pt', `${rank}位 `);
        cell.append(el('b', '', yen(v)));
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
        nums.append(el('div', 'ev-corner'), el('div', 'ev-colhead ev-forecast', '予想'), el('div', 'ev-colhead ev-safe', '安全圏'));
        if (hasTop) numberRow(nums, '1位', '', e.forecast, e.safe);
        if (hasPrize) numberRow(nums, `${e.prizeRank}位`, '入賞の最下位', e.prizeForecast, e.prizeSafe);
        item.append(nums);
      } else {
        item.append(el('p', 'ev-none', noForecastText(e)));
      }

      if (e.recent && e.recent.length > 0) {
        const recent = el('p', 'ev-recent');
        recent.append(el('span', 'label', '前の回の1位'));
        for (const r of e.recent) {
          const run = el('span', 'run', `${day(r.date)} `);
          run.append(el('b', '', yen(r.top)));
          recent.append(run);
        }
        item.append(recent);
        if (hasPrize && e.recent.some((r) => r.prize != null)) {
          const prize = el('p', 'ev-recent');
          prize.append(el('span', 'label', `前の回の${e.prizeRank}位`));
          for (const r of e.recent) {
            if (r.prize == null) continue;
            const run = el('span', 'run', `${day(r.date)} `);
            run.append(el('b', '', yen(r.prize)));
            prize.append(run);
          }
          item.append(prize);
        }
      }

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
      // 3 で過去の回（past）を足した。2 は過去の回の無い前の形（公開の切り替わりの間だけ読むことがある）
      if (![2, 3].includes(data.version) || !Array.isArray(data.events)) throw new Error('形が違います');
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
