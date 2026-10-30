// web 版ルーレット（利用者の指示、2026-10-30「webにルーレット機能を新規につくりたい」「項目の保存を行えるようにしたい。もちろんブラウザ内に保存ね。
// 重み付けはしたい。画像のコピーボタンと…APIとかじゃなくてね」。そのあと「共有ボタンで、XもDiscordも投稿できるから画像コピーと共有だけにしよう。直前と同じ項目をさけるはなくてよい。
// 円盤はもっと豪華さというか、このルーレットがまわしたくなるような華やかさをだしてほしい。演出とか、いろあい、文字の読みやすさ、を含めて」）。設計書 16。
// ボーダー予想のデータには頼らない（ボーダー予想のサイトを止めたら止まるので、あとで別の場所へ移せるように）。
(function () {
  'use strict';

  // ---- 決まり ----
  const STORE_KEY = 'roulette.v1';
  const MAX_ITEMS = 50;          // 円盤の文字が読める範囲
  const MAX_WEIGHT = 100;
  const HISTORY_KEEP = 50;       // デスクトップ版と同じ（保存は 50 件、画面には 10 件）
  const HISTORY_SHOW = 10;
  const DEFAULT_TEMPLATE = 'ルーレットの結果は「{result}」になりました！';   // デスクトップ版と同じ。共有に添える文面
  const SPIN_MS = 6000;
  const SPIN_MS_REDUCED = 800;   // 「動きを減らす」設定のとき
  const SPIN_TURNS = 7;
  const TAU = Math.PI * 2;
  const $ = (id) => document.getElementById(id);

  // 円盤の色（明るい色・暗い色）。切れ目の中は、中心が暗く外側が明るいグラデーションにして立体感を出す。隣どうしが同じ色にならないよう 12 色を順に使う。
  const PALETTE = [
    ['#ff5d7d', '#b0123a'],   // 桃赤
    ['#ffa63d', '#c2490d'],   // 橙
    ['#ffd93d', '#b98300'],   // 黄
    ['#34d1bf', '#087a72'],   // 青緑
    ['#4d94ff', '#1740b8'],   // 青
    ['#9b5cf6', '#5019a8'],   // 紫
    ['#2fe08f', '#0a7d4b'],   // 緑
    ['#f56bbd', '#a31f78'],   // 桃
    ['#32c5ff', '#0369a1'],   // 水色
    ['#ff6a3d', '#a82600'],   // 朱
    ['#b6f23a', '#4f8a00'],   // 黄緑
    ['#c24ae0', '#701a8c'],   // 赤紫
  ];

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

  // 重みに比例して 1 つ選ぶ。選べる項目（名前があり、重みが 0 より大きい）が無ければ null。
  // （「直前と同じ項目を避ける」は、利用者の指示でやめた。2026-10-30）
  function pickIndex(items, rnd) {
    const live = [];
    items.forEach((it, i) => { if (isLive(it)) live.push(i); });
    if (live.length === 0) return null;
    const total = live.reduce((s, i) => s + items[i].weight, 0);
    let x = rnd() * total;
    for (const i of live) {
      x -= items[i].weight;
      if (x < 0) return i;
    }
    return live[live.length - 1];
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
  // 切れ目の色の番号。最後の切れ目が最初と同じ色になる（隣どうしが同じ）ときだけ、ずらす。
  const colorIndex = (i, n) => (i + (n > 1 && i === n - 1 && i % PALETTE.length === 0 ? 5 : 0)) % PALETTE.length;
  const sliceColor = (i, n) => PALETTE[colorIndex(i, n || i + 1)][0];

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
    removePicked: false,
    history: [],
  });
  const defaultData = () => {
    const w = sampleWheel();
    return { version: 1, currentId: w.id, wheels: [w], settings: { template: DEFAULT_TEMPLATE } };
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
      removePicked: w.removePicked === true,
      history,
    };
  }
  // 読み込んだ（または取り込んだ）ものは、形を確かめて作り直す。画面には textContent / value だけで出すので、文字が HTML として解釈されることは無い。
  // 前の版にあった「直前を避ける」「Discord のリンク」は、読み込んでも使わない。
  function sanitizeData(d) {
    if (!d || typeof d !== 'object' || !Array.isArray(d.wheels)) return null;
    const wheels = d.wheels.slice(0, 30).map(sanitizeWheel).filter(Boolean);
    if (wheels.length === 0) return null;
    const s = d.settings && typeof d.settings === 'object' ? d.settings : {};
    return {
      version: 1,
      currentId: wheels.some((w) => w.id === d.currentId) ? d.currentId : wheels[0].id,
      wheels,
      settings: { template: typeof s.template === 'string' && s.template.trim() ? s.template.slice(0, 200) : DEFAULT_TEMPLATE },
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
    anim: null,        // 回している最中の動き（{ from, to, t0, dur, idx, label, snapshot }）
    tilt: 0,           // 針のしなり（ラジアン）。切れ目が針に当たるたびに振れる
    bulb: 0,           // 縁のランプの点滅（0 / 1）
    winnerIdx: null,   // 当たりの項目の位置（円盤で目立たせる）。項目を直したら消す
    celebrateUntil: 0, // 当たりの演出（ランプの速い点滅・紙吹雪）をする時刻まで
    confetti: [],
    last: null,        // 直前の結果（画像・共有に使う。{ name, items（その時点の写し）, rot, text, winner, at }）
  };
  const cur = () => data.wheels.find((w) => w.id === data.currentId) || data.wheels[0];
  const displayItems = () => (state.anim ? state.anim.snapshot : cur().items);
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

  // アクセス解析（GoatCounter。利用者の決定、2026-10-30「GoatCounterはいい感じに」）。ページの数え方に加えて、回した・コピーした・共有した回数を数える。
  // 項目や結果の中身は送らない（回数だけ）。count.js がまだ読み込まれていなければ、読み込まれたときに送る。読めない（広告ブロックなど）ときは何もしない。
  const pendingCounts = [];
  function countEvent(path, title) {
    const gc = window.goatcounter;
    if (gc && typeof gc.count === 'function') gc.count({ path, title, event: true });
    else pendingCounts.push({ path, title });
  }
  const gcScript = document.querySelector('script[data-goatcounter]');
  if (gcScript) gcScript.addEventListener('load', () => { for (const p of pendingCounts.splice(0)) countEvent(p.path, p.title); });

  // ---- 円盤と画像（同じ描き方） ----
  const fontFamily = () => getComputedStyle(document.body).fontFamily;

  function fitText(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  }
  function wedge(ctx, cx, cy, r, a0, a1) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a0, a1);
    ctx.closePath();
  }
  function starPath(ctx, cx, cy, r) {
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const rr = k % 2 === 0 ? r : r * 0.45;
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    ctx.closePath();
  }
  // 円盤: 金の縁とランプ・立体的な切れ目・読みやすい文字・当たりの強調・針。fx = { bulb, winner, tilt }
  function drawWheel(ctx, S, rot, items, ff, fx) {
    fx = fx || {};
    const cx = S / 2;
    const cy = S * 0.52;                 // 針のぶんを上に空ける
    const outerR = S * 0.455;
    const rimW = S * 0.05;
    const R = outerR - rimW;
    ctx.clearRect(0, 0, S, S);

    // 影
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = S * 0.035;
    ctx.shadowOffsetY = S * 0.012;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, TAU);
    ctx.fill();
    ctx.restore();

    // 金の縁
    const rim = ctx.createLinearGradient(cx - outerR, cy - outerR, cx + outerR, cy + outerR);
    rim.addColorStop(0, '#fff3b0');
    rim.addColorStop(0.3, '#f6c445');
    rim.addColorStop(0.65, '#b07a0a');
    rim.addColorStop(1, '#ffe08a');
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, TAU);
    ctx.fillStyle = rim;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, R + rimW * 0.14, 0, TAU);
    ctx.fillStyle = 'rgba(70, 40, 0, 0.55)';
    ctx.fill();

    const list = layoutOf(items);
    if (list.length === 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, TAU);
      ctx.fillStyle = '#1b2438';
      ctx.fill();
      ctx.fillStyle = '#e8eefc';
      ctx.font = `700 ${S * 0.045}px ${ff}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('項目を入れてください', cx, cy);
    } else {
      // 切れ目（中心が暗く外側が明るいグラデーション）
      for (const e of list) {
        const a0 = -Math.PI / 2 + rot + e.start * TAU;
        const a1 = -Math.PI / 2 + rot + e.end * TAU;
        const [light, dark] = PALETTE[colorIndex(e.index, items.length)];
        const g = ctx.createRadialGradient(cx, cy, R * 0.12, cx, cy, R);
        g.addColorStop(0, dark);
        g.addColorStop(1, light);
        wedge(ctx, cx, cy, R, a0, a1);
        ctx.fillStyle = g;
        ctx.fill();
      }
      // 区切りの白い線
      ctx.lineJoin = 'round';
      for (const e of list) {
        const a0 = -Math.PI / 2 + rot + e.start * TAU;
        const a1 = -Math.PI / 2 + rot + e.end * TAU;
        wedge(ctx, cx, cy, R, a0, a1);
        ctx.lineWidth = Math.max(1.5, S * 0.005);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.stroke();
      }
      // 名前: 中心へ向かう向きで書く。濃いふちどりの白い太字で、どの色の上でも読めるようにする。幅が狭すぎる切れ目には書かない。
      for (const e of list) {
        const span = (e.end - e.start) * TAU;
        const size0 = Math.min(S * 0.062, span * R * 0.62 * 0.78);
        if (size0 < S * 0.024) continue;
        const mid = -Math.PI / 2 + rot + ((e.start + e.end) / 2) * TAU;
        const leftward = Math.cos(mid) < 0;   // 左向きの切れ目は、半回転させて文字が逆さまにならないようにする
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(leftward ? mid + Math.PI : mid);
        ctx.textAlign = leftward ? 'left' : 'right';
        ctx.textBaseline = 'middle';
        const label = items[e.index].label.trim();
        const maxW = R * 0.64;
        let size = size0;
        ctx.font = `800 ${size}px ${ff}`;
        while (size > size0 * 0.65 && ctx.measureText(label).width > maxW) {   // まず小さくして収める。それでも長ければ「…」
          size *= 0.92;
          ctx.font = `800 ${size}px ${ff}`;
        }
        const text = fitText(ctx, label, maxW);
        const tx = leftward ? -R * 0.92 : R * 0.92;
        ctx.lineJoin = 'round';
        ctx.lineWidth = size * 0.24;
        ctx.strokeStyle = 'rgba(25, 10, 45, 0.65)';
        ctx.strokeText(text, tx, 0);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(text, tx, 0);
        ctx.restore();
      }
      // 当たりの強調: ほかの切れ目を暗くして、当たりを光らせる
      if (fx.winner != null && list.some((e) => e.index === fx.winner)) {
        for (const e of list) {
          if (e.index === fx.winner) continue;
          wedge(ctx, cx, cy, R, -Math.PI / 2 + rot + e.start * TAU, -Math.PI / 2 + rot + e.end * TAU);
          ctx.fillStyle = 'rgba(8, 4, 24, 0.5)';
          ctx.fill();
        }
        const w = list.find((e) => e.index === fx.winner);
        ctx.save();
        wedge(ctx, cx, cy, R, -Math.PI / 2 + rot + w.start * TAU, -Math.PI / 2 + rot + w.end * TAU);
        ctx.lineWidth = S * 0.012;
        ctx.strokeStyle = '#fff6c2';
        ctx.shadowColor = '#ffd23f';
        ctx.shadowBlur = S * 0.04;
        ctx.stroke();
        ctx.restore();
      }
      // つや（左上の光）
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, TAU);
      ctx.clip();
      const gloss = ctx.createRadialGradient(cx - R * 0.38, cy - R * 0.45, R * 0.05, cx - R * 0.2, cy - R * 0.25, R * 1.0);
      gloss.addColorStop(0, 'rgba(255, 255, 255, 0.28)');
      gloss.addColorStop(0.5, 'rgba(255, 255, 255, 0.05)');
      gloss.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = gloss;
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.lineWidth = S * 0.006;
    ctx.strokeStyle = 'rgba(70, 40, 0, 0.7)';
    ctx.stroke();

    // 縁のランプ（交互に点滅。回している間と当たりの演出では速く）
    const bulbs = 24;
    for (let i = 0; i < bulbs; i++) {
      const a = (i / bulbs) * TAU - Math.PI / 2;
      const bx = cx + Math.cos(a) * (outerR - rimW * 0.5);
      const by = cy + Math.sin(a) * (outerR - rimW * 0.5);
      const on = (i + (fx.bulb || 0)) % 2 === 0;
      ctx.save();
      ctx.beginPath();
      ctx.arc(bx, by, S * 0.0105, 0, TAU);
      if (on) {
        ctx.shadowColor = '#ffe27a';
        ctx.shadowBlur = S * 0.025;
        ctx.fillStyle = '#fffbe3';
      } else {
        ctx.fillStyle = '#b8781a';
      }
      ctx.fill();
      ctx.restore();
    }

    // 中央（金の飾りと星）
    const hubR = S * 0.07;
    const hub = ctx.createRadialGradient(cx - hubR * 0.3, cy - hubR * 0.35, hubR * 0.1, cx, cy, hubR);
    hub.addColorStop(0, '#fff7c9');
    hub.addColorStop(0.5, '#f1b72f');
    hub.addColorStop(1, '#9a6200');
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = S * 0.015;
    ctx.beginPath();
    ctx.arc(cx, cy, hubR, 0, TAU);
    ctx.fillStyle = hub;
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = S * 0.006;
    ctx.strokeStyle = '#fff3b0';
    ctx.stroke();
    starPath(ctx, cx, cy + S * 0.002, hubR * 0.58);
    ctx.fillStyle = '#c4143c';
    ctx.fill();

    // 針（赤い宝石のような形。切れ目が当たるたびにしなる）
    const px = cx;
    const py = cy - outerR - S * 0.012;
    const pw = S * 0.04;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(fx.tilt || 0);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = S * 0.012;
    ctx.shadowOffsetY = S * 0.006;
    ctx.beginPath();
    ctx.moveTo(0, S * 0.098);
    ctx.lineTo(-pw, 0);
    ctx.arc(0, 0, pw, Math.PI, 0);
    ctx.closePath();
    const pg = ctx.createLinearGradient(-pw, -pw, pw, S * 0.09);
    pg.addColorStop(0, '#ff9aa9');
    pg.addColorStop(0.45, '#e11d48');
    pg.addColorStop(1, '#8a0b27');
    ctx.fillStyle = pg;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = S * 0.0065;
    ctx.strokeStyle = '#fff3b0';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, S * 0.014, 0, TAU);
    ctx.fillStyle = '#f6c445';
    ctx.fill();
    ctx.restore();
  }

  // 針のしなり: 円盤の切れ目が針に当たった直後がいちばん大きく、そのあと元に戻る（針が切れ目を押し分けて進むように見える）
  function pointerTilt(items, rot, S) {
    const list = layoutOf(items);
    if (list.length < 2) return 0;
    let f = (-rot / TAU) % 1;
    if (f < 0) f += 1;
    let d = 1;
    for (const e of list) {
      let diff = e.start - f;          // 針は割合が減る向きに進む。いま通り過ぎた境目までの距離
      if (diff < 0) diff += 1;
      if (diff < d) d = diff;
    }
    const arc = d * TAU * S * 0.4;
    return -0.42 * Math.max(0, 1 - arc / (S * 0.05));
  }

  function wheelSize() {
    const box = $('wheel').parentElement;
    return Math.max(160, Math.round(box.clientWidth * Math.min(window.devicePixelRatio || 1, 3)));
  }
  function redraw() {
    const canvas = $('wheel');
    const S = wheelSize();
    if (canvas.width !== S || canvas.height !== S) {
      canvas.width = S;
      canvas.height = S;
    }
    drawWheel(canvas.getContext('2d'), S, state.rot, displayItems(), fontFamily(), { bulb: state.bulb, winner: state.winnerIdx, tilt: state.tilt });
  }

  // 結果の画像（1200×675。止まった円盤・結果・ルーレットの名前・日付。配色に関わらず、華やかな濃い色の背景）
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
    const ff = fontFamily();
    const bg = x.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#1b1450');
    bg.addColorStop(0.55, '#41187a');
    bg.addColorStop(1, '#0f2f5c');
    x.fillStyle = bg;
    x.fillRect(0, 0, W, H);
    const glow = x.createRadialGradient(330, 340, 40, 330, 340, 420);
    glow.addColorStop(0, 'rgba(255, 214, 90, 0.35)');
    glow.addColorStop(1, 'rgba(255, 214, 90, 0)');
    x.fillStyle = glow;
    x.fillRect(0, 0, W, H);
    // きらめき（星と点。位置は結果の文字から決めるので、同じ結果なら同じ並び）
    let seed = 7;
    for (const ch of Array.from(last.text)) seed = (seed * 31 + ch.charCodeAt(0)) % 100003;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 46; i++) {
      const sx = 20 + rnd() * (W - 40), sy = 14 + rnd() * (H - 28), sr = 2 + rnd() * 5;
      x.fillStyle = `rgba(255, 240, 190, ${0.25 + rnd() * 0.5})`;
      if (i % 3 === 0) {
        starPath(x, sx, sy, sr * 1.8);
        x.fill();
      } else {
        x.beginPath();
        x.arc(sx, sy, sr * 0.6, 0, TAU);
        x.fill();
      }
    }
    const wc = document.createElement('canvas');
    wc.width = 620;
    wc.height = 620;
    drawWheel(wc.getContext('2d'), 620, last.rot, last.items, ff, { bulb: 0, winner: last.winner, tilt: 0 });
    x.drawImage(wc, 16, 28);

    const left = 660, maxW = 500;
    x.textAlign = 'left';
    x.textBaseline = 'alphabetic';
    x.fillStyle = '#d9ccff';
    x.font = `700 32px ${ff}`;
    x.fillText(fitText(x, last.name, maxW), left, 150);
    // 「結果」の札
    x.fillStyle = '#f6c445';
    x.beginPath();
    if (x.roundRect) x.roundRect(left, 180, 120, 46, 23);
    else x.rect(left, 180, 120, 46);   // 古いブラウザでは角を丸めない
    x.fill();
    x.fillStyle = '#3a1a00';
    x.font = `800 28px ${ff}`;
    x.textAlign = 'center';
    x.fillText('結果', left + 60, 213);
    x.textAlign = 'left';
    let lines = [last.text];
    let size = 100;
    for (const s of [100, 84, 68, 56, 46, 38]) {
      size = s;
      x.font = `800 ${s}px ${ff}`;
      lines = wrapLines(x, last.text, maxW);
      if (lines.length <= 3) break;
    }
    if (lines.length > 3) {
      lines = lines.slice(0, 3);
      lines[2] = fitText(x, lines[2] + '…', maxW);
    }
    x.font = `800 ${size}px ${ff}`;
    const gold = x.createLinearGradient(0, 260, 0, 260 + size * 1.2 * lines.length);
    gold.addColorStop(0, '#fff6c8');
    gold.addColorStop(0.5, '#ffd23f');
    gold.addColorStop(1, '#ff9f1c');
    lines.forEach((l, i) => {
      const y = 262 + size * 1.12 * (i + 1) - size * 0.2;
      x.lineJoin = 'round';
      x.lineWidth = size * 0.16;
      x.strokeStyle = 'rgba(40, 10, 70, 0.75)';
      x.strokeText(l, left, y);
      x.fillStyle = gold;
      x.fillText(l, left, y);
    });
    const d = new Date(last.at || Date.now());
    const pad = (n) => String(n).padStart(2, '0');
    x.fillStyle = '#c4b4f0';
    x.font = `600 26px ${ff}`;
    x.fillText(`${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}　IriDock ルーレット`, left, 628);
    return c;
  }

  // ---- 紙吹雪（当たりの演出。「動きを減らす」設定のときは出さない） ----
  function fxCanvasFit() {
    const stage = $('stage');
    const cv = $('fx');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(stage.clientWidth * dpr), h = Math.round(stage.clientHeight * dpr);
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    return dpr;
  }
  function spawnConfetti() {
    const stage = $('stage').getBoundingClientRect();
    const wheel = $('wheel').getBoundingClientRect();
    const ox = wheel.left - stage.left + wheel.width / 2;
    const oy = wheel.top - stage.top + wheel.height * 0.52;
    const unit = Math.max(300, wheel.width);
    state.confetti = [];
    for (let i = 0; i < 170; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.15;
      const v = unit * (0.7 + Math.random() * 1.1);
      state.confetti.push({
        x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 14,
        w: 6 + Math.random() * 7, h: 10 + Math.random() * 9,
        color: PALETTE[Math.floor(Math.random() * PALETTE.length)][0],
        life: 0, max: 2.2 + Math.random() * 1.4, round: Math.random() < 0.25,
      });
    }
  }
  function stepConfetti(dt) {
    const g = Math.max(300, $('wheel').clientWidth) * 2.6;
    for (const p of state.confetti) {
      p.life += dt;
      p.vy += g * dt;
      p.vx *= 1 - 0.6 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
    state.confetti = state.confetti.filter((p) => p.life < p.max);
  }
  function drawConfetti() {
    const cv = $('fx');
    const dpr = fxCanvasFit();
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const p of state.confetti) {
      const alpha = Math.min(1, (p.max - p.life) / 0.6);
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.translate(p.x * dpr, p.y * dpr);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.round) {
        ctx.beginPath();
        ctx.arc(0, 0, p.w * 0.5 * dpr, 0, TAU);
        ctx.fill();
      } else {
        ctx.fillRect((-p.w / 2) * dpr, (-p.h / 2) * dpr, p.w * dpr, p.h * dpr);
      }
      ctx.restore();
    }
  }
  function clearFx() {
    state.confetti = [];
    const cv = $('fx');
    cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
  }

  // ---- 動きのまとめ役（回している間・当たりの演出は毎コマ、ふだんはランプだけ 0.5 秒ごと） ----
  let reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => { reduced = mq.matches; };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
  }
  let lastIdle = 0;
  let lastNow = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - lastNow) / 1000);
    lastNow = now;
    if (document.hidden) return;
    const spinning = !!state.anim;
    if (spinning) stepSpin(now);
    const celebrating = state.confetti.length > 0 || now < state.celebrateUntil;
    if (!state.anim && !celebrating) {
      if (state.tilt !== 0) { state.tilt = 0; redraw(); }
      if (reduced || now - lastIdle < 500) return;
      lastIdle = now;
      state.bulb = (state.bulb + 1) % 2;
      redraw();
      return;
    }
    state.bulb = reduced ? 0 : Math.floor(now / (spinning ? 70 : 150)) % 2;
    if (state.confetti.length > 0) {
      stepConfetti(dt);
      drawConfetti();
      if (state.confetti.length === 0) clearFx();
    }
    redraw();
  }

  // ---- 回す ----
  function setSpinning(on) {
    $('spin').disabled = on;
    $('wheel').classList.toggle('is-spinning', on);
  }
  function spin() {
    if (state.anim) return;
    const w = cur();
    const idx = pickIndex(w.items, randomUnit);
    if (idx === null) {
      setStatus('回せる項目がありません。名前を入れて、重みを 0 より大きくしてください。');
      return;
    }
    setStatus('');
    $('share').hidden = true;
    $('preview').hidden = true;
    const res = $('result');
    res.classList.remove('pop');
    res.textContent = '…';
    state.winnerIdx = null;
    state.celebrateUntil = 0;
    clearFx();
    const entry = layoutOf(w.items).find((e) => e.index === idx);
    const from = state.rot;
    state.anim = {
      from,
      to: targetRotation(from, entry, randomUnit, SPIN_TURNS),
      t0: performance.now(),
      dur: reduced ? SPIN_MS_REDUCED : SPIN_MS,
      idx,
      label: w.items[idx].label,
      snapshot: w.items.map((it) => ({ label: it.label, weight: it.weight })),
    };
    setSpinning(true);
    countEvent('roulette-spin', 'ルーレットを回した');
  }
  function stepSpin(now) {
    const a = state.anim;
    const t = Math.min(1, Math.max(0, (now - a.t0) / a.dur));   // コマの時刻が回し始めより少し前になることがあるので、0 未満にしない
    state.rot = a.from + (a.to - a.from) * (1 - Math.pow(1 - t, 4));
    state.tilt = reduced || t >= 1 ? 0 : pointerTilt(a.snapshot, state.rot, 1);
    if (t >= 1) {
      state.rot = a.to % TAU;
      state.anim = null;
      finish(a, now);
    }
  }
  function finish(a, now) {
    const w = cur();
    const text = a.label.trim();
    state.last = { name: w.name, items: a.snapshot, rot: state.rot, text, winner: a.idx, at: Date.now() };
    w.history.unshift({ at: state.last.at, result: a.label });
    w.history.length = Math.min(w.history.length, HISTORY_KEEP);
    state.winnerIdx = a.idx;
    if (w.removePicked) {
      w.items.splice(a.idx, 1);
      state.winnerIdx = null;
    }
    save();
    setSpinning(false);
    const res = $('result');
    res.textContent = text;
    if (!reduced) {
      void res.offsetWidth;
      res.classList.add('pop');
      state.celebrateUntil = now + 1800;
      spawnConfetti();
    }
    $('share').hidden = false;
    renderHistory();
    if (w.removePicked) renderItems();
    redraw();
  }

  // ---- 画像のコピー・共有（API は使わない） ----
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
    countEvent('roulette-copy', '結果の画像をコピーした');
    copyCard().then((r) => setStatus(r === 'copied' ? '画像をコピーしました。X や Discord などに貼り付けて使えます。' : 'コピーできなかったので、画像を保存しました。'));
  }
  // 共有メニュー（X・Discord などのアプリを選べる）。画像と文面を一緒に渡す。
  async function onShareNative() {
    if (!state.last) return;
    countEvent('roulette-share', '結果の画像を共有した');
    const canvas = makeCard(state.last);
    showPreview(canvas);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const payload = { files: [new File([blob], 'iridock-roulette.png', { type: 'image/png' })], text: textFor() };
    try {
      if (navigator.canShare && navigator.canShare(payload)) await navigator.share(payload);
    } catch (e) {
      if (e && e.name !== 'AbortError') setStatus('共有できませんでした。「画像をコピー」を使ってください。');
    }
  }

  // ---- 画面（項目・ルーレットの切り替え・履歴・設定） ----
  // 項目や重みを直したら、当たりの強調は消す（円盤の切れ目が変わるため）
  const touch = () => { state.winnerIdx = null; };
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
      dot.style.background = sliceColor(i, w.items.length);
      const lab = document.createElement('input');
      lab.type = 'text';
      lab.maxLength = 40;
      lab.value = it.label;
      lab.placeholder = '項目の名前';
      lab.setAttribute('aria-label', `項目 ${i + 1} の名前`);
      lab.addEventListener('input', () => { it.label = lab.value; touch(); save(); updatePercents(); redraw(); });
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
        touch();
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
      del.addEventListener('click', () => { w.items.splice(i, 1); touch(); save(); renderItems(); });
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
  }
  function selectWheel(id) {
    if (state.anim) return;
    data.currentId = id;
    state.last = null;
    touch();
    clearFx();
    $('result').textContent = '　';
    $('result').classList.remove('pop');
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
      touch();
      save();
      renderAll();
      setStatus(`読み込みました（${d.wheels.length} 件）。`);
    } catch (e) {
      setStatus('読み込めませんでした（ファイルを読めません）。');
    }
  }

  function bind() {
    $('spin').addEventListener('click', spin);
    $('wheel').addEventListener('click', spin);   // 円盤を押しても回る
    $('copy-image').addEventListener('click', onCopy);
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
      if (state.anim || data.wheels.length >= 30) return;
      const w = { id: newId(), name: `ルーレット ${data.wheels.length + 1}`, items: [], removePicked: false, history: [] };
      data.wheels.push(w);
      selectWheel(w.id);
    });
    $('wheel-del').addEventListener('click', () => {
      if (state.anim) return;
      if (!window.confirm(`「${cur().name}」を消します。項目と履歴もなくなります。よろしいですか？`)) return;
      data.wheels = data.wheels.filter((w) => w.id !== data.currentId);
      if (data.wheels.length === 0) data.wheels.push(sampleWheel());
      selectWheel(data.wheels[0].id);
    });
    $('item-add').addEventListener('click', () => {
      const w = cur();
      if (w.items.length >= MAX_ITEMS) return;
      w.items.push({ label: '', weight: 1 });
      touch();
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
      touch();
      save();
      renderItems();
    });
    $('opt-remove').addEventListener('change', (e) => { cur().removePicked = e.target.checked; save(); });
    $('history-clear').addEventListener('click', () => { cur().history = []; save(); renderHistory(); });
    $('template').addEventListener('input', (e) => { data.settings.template = e.target.value.slice(0, 200) || DEFAULT_TEMPLATE; save(); });
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
    if (window.ResizeObserver) new ResizeObserver(() => { redraw(); fxCanvasFit(); }).observe($('stage'));
    else window.addEventListener('resize', redraw);
  }

  // 確かめの道具から呼ぶ（画面の見た目に関わらない部分と、状態の読み出し）
  window.IriRoulette = {
    pickIndex, layoutOf, indexAtPointer, targetRotation, randomUnit, cleanWeight, sanitizeData, sliceColor, pointerTilt,
    state: () => ({ rot: state.rot, spinning: !!state.anim, last: state.last, data, winner: state.winnerIdx, confetti: state.confetti.length, tilt: state.tilt }),
    makeCard: () => makeCard(state.last || { name: cur().name, items: cur().items, rot: state.rot, text: '見本', winner: null, at: Date.now() }),
  };

  bind();
  renderAll();
  requestAnimationFrame(frame);
  // 書体（Noto Sans JP・Inter）は、使うまで読み込まれない。読み込めたら円盤を描き直す。
  if (document.fonts && document.fonts.load) {
    Promise.all(['800 20px "Noto Sans JP"', '700 20px "Noto Sans JP"', '700 20px Inter'].map((f) => document.fonts.load(f, 'あA'))).then(redraw).catch(() => {});
  }
})();
