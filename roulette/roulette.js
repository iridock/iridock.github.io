// web 版ルーレット（利用者の指示、2026-10-30「webにルーレット機能を新規につくりたい」「項目の保存を行えるようにしたい。もちろんブラウザ内に保存ね。
// 重み付けはしたい。画像のコピーボタンとXへの投稿ボタン、Discordもできればやってほしい。APIとかじゃなくてね」）。設計書 16。
// ボーダー予想のデータには頼らない（ボーダー予想のサイトを止めたら止まるので、あとで別の場所へ移せるように）。
(function () {
  'use strict';

  // ---- 決まり ----
  const STORE_KEY = 'roulette.v1';
  const MAX_ITEMS = 50;          // 円盤の文字が読める範囲
  const MAX_WEIGHT = 100;
  const HISTORY_KEEP = 50;       // デスクトップ版と同じ（保存は 50 件、画面には 10 件）
  const HISTORY_SHOW = 10;
  const DEFAULT_TEMPLATE = 'ルーレットの結果は「{result}」になりました！';   // デスクトップ版と同じ
  const SPIN_MS = 5000;
  const SPIN_MS_REDUCED = 800;   // 「動きを減らす」設定のとき
  const TAU = Math.PI * 2;
  const $ = (id) => document.getElementById(id);

  // ---- 抽選（画面に触らない部分。確かめの道具からも呼ぶ） ----
  // 53 ビットの乱数（0 以上 1 未満）。Math.random ではなく、ブラウザの安全な乱数を使う。
  const randomUnit = () => {
    const a = new Uint32Array(2);
    crypto.getRandomValues(a);
    return (a[0] * 2097152 + (a[1] >>> 11)) / 9007199254740992;
  };
  // 重み: 0〜100、小数 1 桁。未指定は 1、数でなければ 0（当たらない）
  const cleanWeight = (v) => {
    if (v === undefined || v === null || v === '') return 1;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.round(Math.min(n, MAX_WEIGHT) * 10) / 10;
  };
  const isLive = (it) => it.label.trim() !== '' && it.weight > 0;

  // 当たりになれる項目の位置。直前の項目（avoidLabel）は、ほかに候補があるときだけ除く（デスクトップ版 SpinIndex と同じ）。
  function eligibleIndexes(items, avoidLabel) {
    const live = [];
    items.forEach((it, i) => { if (isLive(it)) live.push(i); });
    if (avoidLabel) {
      const rest = live.filter((i) => items[i].label !== avoidLabel);
      if (rest.length > 0) return rest;
    }
    return live;
  }
  // 重みに比例して 1 つ選ぶ。選べる項目が無ければ null。
  function pickIndex(items, rnd, avoidLabel) {
    const idx = eligibleIndexes(items, avoidLabel);
    if (idx.length === 0) return null;
    const total = idx.reduce((s, i) => s + items[i].weight, 0);
    let x = rnd() * total;
    for (const i of idx) {
      x -= items[i].weight;
      if (x < 0) return i;
    }
    return idx[idx.length - 1];
  }
  // 円盤に描く項目と、その幅（0〜1 の割合。重み ÷ 合計）。上から時計まわり。
  function layoutOf(items) {
    const live = [];
    items.forEach((it, i) => { if (isLive(it)) live.push(i); });
    const total = live.reduce((s, i) => s + items[i].weight, 0);
    let pos = 0;
    return live.map((i) => {
      const w = items[i].weight / total;
      const e = { index: i, start: pos, end: pos + w };
      pos += w;
      return e;
    });
  }
  // 当たりの項目の中のどこかが針（真上）に来るよう、回転角を決める。端は避ける（15%〜85%）。
  function targetRotation(currentRot, entry, rnd, turns) {
    const f = entry.start + (entry.end - entry.start) * (0.15 + 0.7 * rnd());
    let delta = ((-f * TAU - currentRot) % TAU);
    if (delta < 0) delta += TAU;
    return currentRot + turns * TAU + delta;
  }
  // 回転角のとき、針の下にある項目の位置
  function indexAtPointer(items, rot) {
    const list = layoutOf(items);
    if (list.length === 0) return null;
    let f = (-rot / TAU) % 1;
    if (f < 0) f += 1;
    const hit = list.find((e) => f >= e.start && f < e.end) || list[list.length - 1];
    return hit.index;
  }
  const sliceColor = (i) => `hsl(${Math.round((i * 137.5) % 360)}, 52%, 38%)`;

  // ---- 保存（ブラウザの中だけ） ----
  const newId = () => 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const sampleWheel = () => ({
    id: newId(),
    name: '今日の配信',
    items: [
      { label: '雑談', weight: 3 },
      { label: '歌枠', weight: 2 },
      { label: 'ゲーム', weight: 2 },
      { label: 'お絵描き', weight: 1 },
    ],
    avoidRepeat: true,
    removePicked: false,
    history: [],
  });
  const defaultData = () => {
    const w = sampleWheel();
    return { version: 1, currentId: w.id, wheels: [w], settings: { template: DEFAULT_TEMPLATE, discordLink: '' } };
  };
  function sanitizeWheel(w) {
    if (!w || typeof w !== 'object') return null;
    const items = Array.isArray(w.items)
      ? w.items.filter((it) => it && typeof it === 'object').slice(0, MAX_ITEMS).map((it) => ({ label: String(it.label != null ? it.label : '').slice(0, 40), weight: cleanWeight(it.weight) }))
      : [];
    const history = Array.isArray(w.history)
      ? w.history.filter((h) => h && typeof h.result === 'string' && Number.isFinite(h.at)).slice(0, HISTORY_KEEP).map((h) => ({ at: h.at, result: h.result.slice(0, 40) }))
      : [];
    return {
      id: typeof w.id === 'string' && w.id ? w.id.slice(0, 40) : newId(),
      name: String(w.name || 'ルーレット').slice(0, 30),
      items,
      avoidRepeat: w.avoidRepeat !== false,
      removePicked: w.removePicked === true,
      history,
    };
  }
  // 読み込んだ（または取り込んだ）ものは、形を確かめて作り直す。画面には textContent / value だけで出すので、文字が HTML として解釈されることは無い。
  function sanitizeData(d) {
    if (!d || typeof d !== 'object' || !Array.isArray(d.wheels)) return null;
    const wheels = d.wheels.slice(0, 30).map(sanitizeWheel).filter(Boolean);
    if (wheels.length === 0) return null;
    const s = d.settings && typeof d.settings === 'object' ? d.settings : {};
    return {
      version: 1,
      currentId: wheels.some((w) => w.id === d.currentId) ? d.currentId : wheels[0].id,
      wheels,
      settings: {
        template: typeof s.template === 'string' && s.template.trim() ? s.template.slice(0, 200) : DEFAULT_TEMPLATE,
        discordLink: typeof s.discordLink === 'string' ? s.discordLink.slice(0, 300) : '',
      },
    };
  }
  function loadData() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const d = sanitizeData(JSON.parse(raw));
        if (d) return d;
      }
    } catch (e) { /* 読めなければ、見本から始める */ }
    return defaultData();
  }

  // ---- 状態 ----
  let data = loadData();
  const state = {
    rot: 0,            // 円盤の回転（ラジアン。時計まわりが正）
    spinning: false,
    last: null,        // 直前の結果（画像・投稿に使う。{ name, items（その時点の写し）, rot, text }）
  };
  const cur = () => data.wheels.find((w) => w.id === data.currentId) || data.wheels[0];
  let warnedStorage = false;
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch (e) {
      if (!warnedStorage) {
        warnedStorage = true;
        showNotice('このブラウザには保存できません（プライベートモードなど）。使い終わる前に「ファイルに書き出す」で残してください。');
      }
    }
  }
  function showNotice(text) {
    const n = $('notice');
    n.textContent = text;
    n.hidden = false;
  }
  const setStatus = (text) => { $('status').textContent = text || ''; };

  // ---- 円盤と画像（同じ描き方） ----
  function themeColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
    return { text: v('--text', '#ffffff'), panel: v('--panel', '#222222'), accent: v('--accent', '#99ccff'), muted: v('--muted', '#aaaaaa'), fill: v('--fill', 'rgba(255,255,255,0.1)') };
  }
  const fontFamily = () => getComputedStyle(document.body).fontFamily;

  function fitText(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  }
  function drawWheel(ctx, S, rot, items, colors, ff) {
    const cx = S / 2, cy = S / 2, R = (S / 2) * 0.9;
    ctx.clearRect(0, 0, S, S);
    const list = layoutOf(items);
    if (list.length === 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, TAU);
      ctx.fillStyle = colors.fill;
      ctx.fill();
      ctx.fillStyle = colors.text;
      ctx.font = `600 ${S * 0.045}px ${ff}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('項目を入れてください', cx, cy);
    } else {
      for (const e of list) {
        const a0 = -Math.PI / 2 + rot + e.start * TAU;
        const a1 = -Math.PI / 2 + rot + e.end * TAU;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R, a0, a1);
        ctx.closePath();
        ctx.fillStyle = sliceColor(e.index);
        ctx.fill();
        ctx.lineWidth = Math.max(1, S * 0.004);
        ctx.strokeStyle = colors.panel;
        ctx.stroke();
      }
      // 名前は、中心へ向かう向きで書く。幅が狭すぎる切れ目には書かない。
      for (const e of list) {
        const span = (e.end - e.start) * TAU;
        const size = Math.min(S * 0.055, span * R * 0.6 * 0.8);
        if (size < S * 0.022) continue;
        const mid = -Math.PI / 2 + rot + ((e.start + e.end) / 2) * TAU;
        // 左向きの切れ目は、そのまま書くと文字が逆さまになる。向きを半回転させて、外側から中心へ向かって読めるようにする。
        const leftward = Math.cos(mid) < 0;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(leftward ? mid + Math.PI : mid);
        ctx.font = `700 ${size}px ${ff}`;
        ctx.textAlign = leftward ? 'left' : 'right';
        ctx.textBaseline = 'middle';
        const text = fitText(ctx, items[e.index].label.trim(), R * 0.62);
        const tx = leftward ? -R * 0.93 : R * 0.93;
        ctx.lineJoin = 'round';
        ctx.lineWidth = size * 0.14;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.strokeText(text, tx, 0);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(text, tx, 0);
        ctx.restore();
      }
    }
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.lineWidth = S * 0.012;
    ctx.strokeStyle = colors.panel;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, S * 0.035, 0, TAU);
    ctx.fillStyle = colors.text;
    ctx.fill();
    // 針（真上。円盤の中を指す）
    const w = S * 0.04;
    ctx.beginPath();
    ctx.moveTo(cx - w, cy - R - S * 0.04);
    ctx.lineTo(cx + w, cy - R - S * 0.04);
    ctx.lineTo(cx, cy - R + S * 0.05);
    ctx.closePath();
    ctx.fillStyle = colors.accent;
    ctx.fill();
    ctx.lineWidth = Math.max(1, S * 0.005);
    ctx.strokeStyle = colors.panel;
    ctx.stroke();
  }
  function redraw() {
    const canvas = $('wheel');
    const box = canvas.parentElement;
    const S = Math.max(160, Math.round(box.clientWidth * Math.min(window.devicePixelRatio || 1, 3)));
    if (canvas.width !== S || canvas.height !== S) {
      canvas.width = S;
      canvas.height = S;
    }
    drawWheel(canvas.getContext('2d'), S, state.rot, cur().items, themeColors(), fontFamily());
  }

  // 結果の画像（1200×675。止まった円盤・結果・ルーレットの名前・日付）
  function wrapLines(ctx, text, maxW) {
    const lines = [];
    let line = '';
    for (const ch of Array.from(text)) {
      if (line && ctx.measureText(line + ch).width > maxW) {
        lines.push(line);
        line = ch;
      } else {
        line += ch;
      }
    }
    if (line) lines.push(line);
    return lines;
  }
  function makeCard(last) {
    const W = 1200, H = 675;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const x = c.getContext('2d');
    const colors = themeColors();
    const ff = fontFamily();
    x.fillStyle = colors.panel;
    x.fillRect(0, 0, W, H);
    const wc = document.createElement('canvas');
    wc.width = 600;
    wc.height = 600;
    drawWheel(wc.getContext('2d'), 600, last.rot, last.items, colors, ff);
    x.drawImage(wc, 24, 38);

    const left = 660, maxW = 500;
    x.textAlign = 'left';
    x.textBaseline = 'alphabetic';
    x.fillStyle = colors.muted;
    x.font = `600 30px ${ff}`;
    x.fillText(fitText(x, last.name, maxW), left, 150);
    x.fillText('結果', left, 215);
    let lines = [last.text];
    let size = 96;
    for (const s of [96, 80, 64, 52, 44, 36]) {
      size = s;
      x.font = `700 ${s}px ${ff}`;
      lines = wrapLines(x, last.text, maxW);
      if (lines.length <= 3) break;
    }
    if (lines.length > 3) {
      lines = lines.slice(0, 3);
      lines[2] = fitText(x, lines[2] + '…', maxW);
    }
    x.fillStyle = colors.text;
    x.font = `700 ${size}px ${ff}`;
    lines.forEach((l, i) => x.fillText(l, left, 300 + size * 1.1 * (i + 1) - size * 0.2));
    const d = new Date(last.at || Date.now());
    const pad = (n) => String(n).padStart(2, '0');
    x.fillStyle = colors.muted;
    x.font = `500 26px ${ff}`;
    x.fillText(`${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}　IriDock ルーレット`, left, 625);
    return c;
  }

  // ---- 回す ----
  const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function setSpinning(on) {
    state.spinning = on;
    $('spin').disabled = on;
  }
  function spin() {
    if (state.spinning) return;
    const w = cur();
    const avoid = w.avoidRepeat && w.history[0] ? w.history[0].result : null;
    const idx = pickIndex(w.items, randomUnit, avoid);
    if (idx === null) {
      setStatus('回せる項目がありません。名前を入れて、重みを 0 より大きくしてください。');
      return;
    }
    setStatus('');
    $('share').hidden = true;
    $('preview').hidden = true;
    $('result').textContent = '…';
    const entry = layoutOf(w.items).find((e) => e.index === idx);
    const from = state.rot;
    const to = targetRotation(from, entry, randomUnit, 5);
    const snapshot = w.items.map((it) => ({ label: it.label, weight: it.weight }));
    const label = w.items[idx].label;
    const dur = reducedMotion() ? SPIN_MS_REDUCED : SPIN_MS;
    const t0 = performance.now();
    setSpinning(true);
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      state.rot = from + (to - from) * (1 - Math.pow(1 - t, 4));
      redraw();
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        state.rot = to % TAU;
        finish(w, idx, label, snapshot);
      }
    };
    requestAnimationFrame(step);
  }
  function finish(w, idx, label, snapshot) {
    const text = label.trim();
    state.last = { name: w.name, items: snapshot, rot: state.rot, text, at: Date.now() };
    w.history.unshift({ at: state.last.at, result: label });
    w.history.length = Math.min(w.history.length, HISTORY_KEEP);
    if (w.removePicked) w.items.splice(idx, 1);
    save();
    setSpinning(false);
    $('result').textContent = text;
    $('share').hidden = false;
    renderHistory();
    if (w.removePicked) renderItems();
    redraw();
  }

  // ---- 画像のコピー・投稿・共有（API は使わない） ----
  const textFor = () => (data.settings.template || DEFAULT_TEMPLATE).split('{result}').join(state.last.text);
  function showPreview(canvas) {
    const img = $('preview');
    img.src = canvas.toDataURL('image/png');   // CSP は data: を許している。長押しで保存できるよう、画面にも出す
    img.hidden = false;
  }
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  // クリックの直後に呼ぶ。画像は同期で作り（ブラウザの「クリックされた直後」の許可を使い切る前に書き込みを始める）、クリップボードへ。
  // 使えない環境では、ファイルとして保存する。
  async function copyCard() {
    const canvas = makeCard(state.last);
    const blobPromise = new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    showPreview(canvas);
    if (navigator.clipboard && window.ClipboardItem) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
        return 'copied';
      } catch (e) { /* 下で保存に切り替える */ }
    }
    download(await blobPromise, 'iridock-roulette.png');
    return 'downloaded';
  }
  function onCopy() {
    if (!state.last) return;
    copyCard().then((r) => setStatus(r === 'copied' ? '画像をコピーしました。貼り付けて使えます。' : 'コピーできなかったので、画像を保存しました。'));
  }
  function onPostX() {
    if (!state.last) return;
    const p = copyCard();
    window.open('https://x.com/intent/post?text=' + encodeURIComponent(textFor()), '_blank', 'noopener');   // デスクトップ版 XBrowserTarget と同じ
    p.then((r) => setStatus(r === 'copied' ? '画像をコピーしました。X の投稿画面で貼り付けてください（PC は Ctrl+V、スマホは長押し）。' : 'コピーできなかったので、画像を保存しました。投稿画面で添付してください。'));
  }
  const isDiscordLink = (s) => /^https:\/\/((canary|ptb)\.)?(discord|discordapp)\.com\//i.test(s);
  function onPostDiscord() {
    if (!state.last) return;
    const p = copyCard();
    const link = data.settings.discordLink.trim();
    const opened = isDiscordLink(link);
    if (opened) window.open(link, '_blank', 'noopener');
    p.then((r) => {
      const where = opened ? 'Discord のチャンネルで' : 'Discord で';
      const hint = opened ? '' : '（設定にチャンネルのリンクを入れると、ここから開けます）';
      setStatus(r === 'copied' ? `画像をコピーしました。${where}貼り付けてください。${hint}` : `コピーできなかったので、画像を保存しました。${where}添付してください。${hint}`);
    });
  }
  async function onShareNative() {
    if (!state.last) return;
    const canvas = makeCard(state.last);
    showPreview(canvas);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const payload = { files: [new File([blob], 'iridock-roulette.png', { type: 'image/png' })], text: textFor() };
    try {
      if (navigator.canShare && navigator.canShare(payload)) await navigator.share(payload);
    } catch (e) {
      if (e && e.name !== 'AbortError') setStatus('共有できませんでした。');
    }
  }

  // ---- 画面（項目・ルーレットの切り替え・履歴・設定） ----
  function updatePercents() {
    const w = cur();
    const total = w.items.reduce((s, it) => s + (isLive(it) ? it.weight : 0), 0);
    const spans = $('items').querySelectorAll('.rl-pc');
    w.items.forEach((it, i) => {
      if (spans[i]) spans[i].textContent = isLive(it) && total > 0 ? `${((it.weight / total) * 100).toFixed(1)}%` : '—';
    });
  }
  function renderItems() {
    const w = cur();
    const ul = $('items');
    ul.replaceChildren();
    w.items.forEach((it, i) => {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'rl-dot';
      dot.style.background = sliceColor(i);
      const lab = document.createElement('input');
      lab.type = 'text';
      lab.maxLength = 40;
      lab.value = it.label;
      lab.placeholder = '項目の名前';
      lab.setAttribute('aria-label', `項目 ${i + 1} の名前`);
      lab.addEventListener('input', () => { it.label = lab.value; save(); updatePercents(); redraw(); });
      const wt = document.createElement('input');
      wt.type = 'number';
      wt.min = '0';
      wt.max = String(MAX_WEIGHT);
      wt.step = '0.1';
      wt.inputMode = 'decimal';
      wt.value = String(it.weight);
      wt.setAttribute('aria-label', `項目 ${i + 1} の重み`);
      wt.addEventListener('input', () => {
        const n = parseFloat(wt.value);
        if (!Number.isFinite(n)) return;   // 入力の途中（空など）では、いまの重みのまま
        it.weight = cleanWeight(n);
        save();
        updatePercents();
        redraw();
      });
      wt.addEventListener('change', () => { wt.value = String(it.weight); });
      const pc = document.createElement('span');
      pc.className = 'rl-pc';
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'rl-del';
      del.textContent = '×';
      del.setAttribute('aria-label', `項目 ${i + 1} を消す`);
      del.addEventListener('click', () => { w.items.splice(i, 1); save(); renderItems(); });
      li.append(dot, lab, wt, pc, del);
      ul.append(li);
    });
    $('item-count').textContent = `${w.items.length} / ${MAX_ITEMS} 件`;
    $('item-add').disabled = w.items.length >= MAX_ITEMS;
    updatePercents();
    redraw();
  }
  function renderWheels() {
    const sel = $('wheel-select');
    sel.replaceChildren();
    for (const w of data.wheels) {
      const o = document.createElement('option');
      o.value = w.id;
      o.textContent = w.name || 'ルーレット';
      sel.append(o);
    }
    sel.value = data.currentId;
    $('wheel-name').value = cur().name;
    $('opt-avoid').checked = cur().avoidRepeat;
    $('opt-remove').checked = cur().removePicked;
  }
  function renderHistory() {
    const ol = $('history');
    ol.replaceChildren();
    const pad = (n) => String(n).padStart(2, '0');
    const list = cur().history.slice(0, HISTORY_SHOW);
    if (list.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'まだありません';
      ol.append(li);
      return;
    }
    for (const h of list) {
      const d = new Date(h.at);
      const li = document.createElement('li');
      const at = document.createElement('span');
      at.className = 'at';
      at.textContent = `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      li.append(at, document.createTextNode(h.result.trim() || '（名前なし）'));
      ol.append(li);
    }
  }
  function renderAll() {
    renderWheels();
    renderItems();
    renderHistory();
    $('template').value = data.settings.template;
    $('discord-link').value = data.settings.discordLink;
  }
  function selectWheel(id) {
    if (state.spinning) return;
    data.currentId = id;
    state.last = null;
    $('result').textContent = '　';
    $('share').hidden = true;
    $('preview').hidden = true;
    setStatus('');
    save();
    renderAll();
  }
  function parseBulk(text) {
    return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
      const m = line.match(/^(.*?)[,，\t]\s*(\d+(?:\.\d+)?)\s*$/);
      return m && m[1].trim() ? { label: m[1].trim().slice(0, 40), weight: cleanWeight(m[2]) } : { label: line.slice(0, 40), weight: 1 };
    });
  }
  function exportData() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `iridock-roulette-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`);
  }
  async function importFile(file) {
    try {
      const d = sanitizeData(JSON.parse(await file.text()));
      if (!d) {
        setStatus('読み込めませんでした（このルーレットの書き出しではないようです）。');
        return;
      }
      if (!window.confirm(`今のルーレットを、読み込んだ ${d.wheels.length} 件に入れ替えます。よろしいですか？`)) return;
      data = d;
      state.last = null;
      save();
      renderAll();
      setStatus(`読み込みました（${d.wheels.length} 件）。`);
    } catch (e) {
      setStatus('読み込めませんでした（ファイルを読めません）。');
    }
  }

  function bind() {
    $('spin').addEventListener('click', spin);
    $('copy-image').addEventListener('click', onCopy);
    $('post-x').addEventListener('click', onPostX);
    $('post-discord').addEventListener('click', onPostDiscord);
    $('share-native').addEventListener('click', onShareNative);
    $('wheel-select').addEventListener('change', (e) => selectWheel(e.target.value));
    $('wheel-name').addEventListener('input', (e) => {
      cur().name = e.target.value.slice(0, 30);
      const opt = $('wheel-select').selectedOptions[0];
      if (opt) opt.textContent = cur().name || 'ルーレット';
      save();
    });
    $('wheel-name').addEventListener('change', (e) => {
      if (!e.target.value.trim()) {
        cur().name = 'ルーレット';
        e.target.value = cur().name;
        renderWheels();
        save();
      }
    });
    $('wheel-add').addEventListener('click', () => {
      if (state.spinning || data.wheels.length >= 30) return;
      const w = { id: newId(), name: `ルーレット ${data.wheels.length + 1}`, items: [], avoidRepeat: true, removePicked: false, history: [] };
      data.wheels.push(w);
      selectWheel(w.id);
    });
    $('wheel-del').addEventListener('click', () => {
      if (state.spinning) return;
      if (!window.confirm(`「${cur().name}」を消します。項目と履歴もなくなります。よろしいですか？`)) return;
      data.wheels = data.wheels.filter((w) => w.id !== data.currentId);
      if (data.wheels.length === 0) data.wheels.push(sampleWheel());
      selectWheel(data.wheels[0].id);
    });
    $('item-add').addEventListener('click', () => {
      const w = cur();
      if (w.items.length >= MAX_ITEMS) return;
      w.items.push({ label: '', weight: 1 });
      save();
      renderItems();
      const inputs = $('items').querySelectorAll('input[type="text"]');
      if (inputs.length) inputs[inputs.length - 1].focus();
    });
    $('bulk-add').addEventListener('click', () => {
      const w = cur();
      const rows = parseBulk($('bulk').value);
      const room = MAX_ITEMS - w.items.length;
      w.items.push(...rows.slice(0, Math.max(0, room)));
      $('bulk').value = '';
      setStatus(rows.length > room ? `${MAX_ITEMS} 件までなので、${Math.max(0, room)} 件だけ足しました。` : `${rows.length} 件を足しました。`);
      save();
      renderItems();
    });
    $('opt-avoid').addEventListener('change', (e) => { cur().avoidRepeat = e.target.checked; save(); });
    $('opt-remove').addEventListener('change', (e) => { cur().removePicked = e.target.checked; save(); });
    $('history-clear').addEventListener('click', () => { cur().history = []; save(); renderHistory(); });
    $('template').addEventListener('input', (e) => { data.settings.template = e.target.value.slice(0, 200) || DEFAULT_TEMPLATE; save(); });
    $('discord-link').addEventListener('input', (e) => { data.settings.discordLink = e.target.value.slice(0, 300); save(); });
    $('export').addEventListener('click', exportData);
    $('import').addEventListener('click', () => $('import-file').click());
    $('import-file').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) importFile(f);
    });
    // 全画面（配信の画面共有用）。使えないブラウザ（iPhone の Safari など）ではボタンを出さない
    if (document.fullscreenEnabled && $('stage').requestFullscreen) {
      $('fullscreen').hidden = false;
      $('fullscreen').addEventListener('click', () => {
        if (document.fullscreenElement) document.exitFullscreen();
        else $('stage').requestFullscreen();
      });
      document.addEventListener('fullscreenchange', () => setTimeout(redraw, 50));
    }
    // 画像つきの共有メニューが使える端末（おもにスマホ）だけ「共有」を出す
    try {
      if (navigator.canShare && navigator.canShare({ files: [new File(['x'], 'a.png', { type: 'image/png' })] })) $('share-native').hidden = false;
    } catch (e) { /* 出さない */ }
    if (window.ResizeObserver) new ResizeObserver(redraw).observe($('wheel').parentElement);
    else window.addEventListener('resize', redraw);
  }

  // 確かめの道具から呼ぶ（画面の見た目に関わらない部分と、状態の読み出し）
  window.IriRoulette = {
    pickIndex, layoutOf, indexAtPointer, targetRotation, randomUnit, cleanWeight, sanitizeData, sliceColor,
    state: () => ({ rot: state.rot, spinning: state.spinning, last: state.last, data }),
    makeCard: () => makeCard(state.last || { name: cur().name, items: cur().items, rot: state.rot, text: '見本', at: Date.now() }),
  };

  bind();
  renderAll();
  // 書体（Noto Sans JP・Inter）は、使うまで読み込まれない。読み込めたら円盤を描き直す。
  if (document.fonts && document.fonts.load) {
    Promise.all(['700 20px "Noto Sans JP"', '700 20px Inter'].map((f) => document.fonts.load(f, 'あA'))).then(redraw).catch(() => {});
  }
})();
