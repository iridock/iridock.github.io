// web 版ルーレット（利用者の指示、2026-10-30。設計書 16）。
// 使い方は 2 つ: ①罰ゲームを決めて実行する ②プレゼントルーレット（リアルグッズ・音声・全部の 3 つなどを並べ、視聴者が「ガチャしたい」と言ったら回して当たりを共有し、
// 最後に「誰が何を当てたか」を表の画像で共有する）。利用者の言葉:「ルーレットの複数表示もしたいし、項目と重みも保存したいな」「新規追加ボタンみたいなかんじでどんどんついかできるように」
// 「回す前に名前の欄へ入れる」「ルーレットごとの履歴のまま」「共有の画像は人ごとのまとめの表。長いときは複数枚に分ける」。
// ボーダー予想のデータには頼らない（ボーダー予想のサイトを止めたら止まるので、あとで別の場所へ移せるように）。
(function () {
  'use strict';

  // ---- 決まり ----
  const STORE_KEY = 'roulette.v1';
  const MAX_WHEELS = 30;
  const MAX_ITEMS = 50;          // 円盤の文字が読める範囲
  const MAX_WEIGHT = 100;
  const MAX_WHO = 30;
  const HISTORY_KEEP = 100;      // ルーレットごとに 100 件まで保存（利用者の指示）。画面にも全部出す
  const DEFAULT_TEMPLATE = 'ルーレットの結果は「{result}」になりました！';   // デスクトップ版と同じ。共有に添える文面（{result}＝結果、{who}＝当てた人）
  const SPIN_MS = 6000;
  const SPIN_MS_REDUCED = 800;   // 「動きを減らす」設定のとき
  const SPIN_TURNS = 7;
  const SUMMARY_PAGE_ENTRIES = 25;   // まとめの画像 1 枚に入れる当たりの数の目安（超えたら複数枚に分ける）
  const SUMMARY_PAGE_BODY = 1500;    // まとめの画像 1 枚の表の高さの上限（px）
  const NO_WHO = '（名前なし）';
  const TAU = Math.PI * 2;
  const $ = (id) => document.getElementById(id);

  // ページ（index.html）と、このスクリプトの版が食い違っていないかを確かめる（2026-10-30。ブラウザが前の版のファイルを最大 10 分覚えているため、
  // ページとスクリプトを同時に入れ替えた直後は、組み合わせがずれて何も動かなくなった）。ずれていたら、真っ白のまま黙らず、読み込み直しを案内する。
  // 公開のたびにスクリプトの名前に指紋（?v=）が付くので、ふだんはずれないが、念のための備え。
  const REQUIRED_IDS = ['notice', 'who', 'wheel-add', 'add-note', 'wheels', 'summary-scope', 'summary-body', 'summary-wrap', 'summary-empty', 'summary-count',
    'summary-copy', 'summary-share', 'summary-pages', 'summary-status', 'template', 'export', 'import', 'import-file', 'settings-status'];
  if (REQUIRED_IDS.some((id) => !document.getElementById(id))) {
    const box = document.createElement('p');
    box.setAttribute('role', 'alert');
    box.textContent = 'ページの一部が前の版のままになっているようです。Ctrl+F5（スマホは、ページを閉じて開き直す）でもう一度開いてください。';
    box.style.cssText = 'margin:16px;padding:12px 16px;border-radius:12px;background:#fff3cd;color:#5c4400;font-size:15px;font-weight:600';
    document.body.prepend(box);
    return;
  }
  function h(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

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
  // 針のしなり: 円盤の切れ目が針に当たった直後がいちばん大きく、そのあと元に戻る（針が切れ目を押し分けて進むように見える）
  function pointerTilt(items, rot) {
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
    const arc = d * TAU * 0.4;
    return -0.42 * Math.max(0, 1 - arc / 0.05);
  }

  // ---- まとめ（誰が何を当てたか。ルーレットごとの履歴を合わせる） ----
  // scope は 'all'（全部のルーレット）かルーレットの id。当てた人ごとに、ルーレットごとの景品（同じものは ×回数）をまとめる。
  // 人の並びは、最初に当てた順。名前なしは最後。
  function summarize(wheels, scope) {
    const target = scope && scope !== 'all' ? wheels.filter((w) => w.id === scope) : wheels;
    const byWho = new Map();
    let entries = 0;
    for (const w of target) {
      // 履歴は新しい順なので、古い順にたどる
      for (let i = w.history.length - 1; i >= 0; i--) {
        const hs = w.history[i];
        const who = (hs.who || '').trim() || NO_WHO;
        if (!byWho.has(who)) byWho.set(who, { who, first: hs.at, wheels: new Map(), total: 0 });
        const g = byWho.get(who);
        g.first = Math.min(g.first, hs.at);
        if (!g.wheels.has(w.id)) g.wheels.set(w.id, { name: w.name, items: new Map() });
        const prizes = g.wheels.get(w.id).items;
        const label = hs.result.trim() || NO_WHO;
        prizes.set(label, (prizes.get(label) || 0) + 1);
        g.total++;
        entries++;
      }
    }
    const groups = [...byWho.values()].sort((a, b) => (a.who === NO_WHO) - (b.who === NO_WHO) || a.first - b.first);
    return { groups, entries };
  }
  // 1 人ぶんの文（ルーレットごとに 1 行。複数のルーレットを合わせるときは、先頭にルーレットの名前を付ける）
  function summaryLines(group, showWheel) {
    return [...group.wheels.values()].map((w) => {
      const text = [...w.items].map(([label, n]) => (n > 1 ? `${label} ×${n}` : label)).join('、');
      return showWheel ? `${w.name}: ${text}` : text;
    });
  }

  // ---- 保存（ブラウザの中だけ） ----
  const newId = () => 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const newWheel = (name, items) => ({ id: newId(), name, items: items || [], removePicked: false, history: [] });
  const sampleWheel = () => newWheel('今日の配信', [
    { label: '雑談', weight: 3 },
    { label: '歌枠', weight: 2 },
    { label: 'ゲーム', weight: 2 },
    { label: 'お絵描き', weight: 1 },
  ]);
  const defaultData = () => {
    const w = sampleWheel();
    return { version: 1, wheels: [w], settings: { template: DEFAULT_TEMPLATE, who: '' } };
  };
  function sanitizeWheel(w) {
    if (!w || typeof w !== 'object') return null;
    const items = Array.isArray(w.items)
      ? w.items.filter((it) => it && typeof it === 'object').slice(0, MAX_ITEMS).map((it) => ({ label: String(it.label != null ? it.label : '').slice(0, 40), weight: cleanWeight(it.weight) }))
      : [];
    const history = Array.isArray(w.history)
      ? w.history.filter((x) => x && typeof x.result === 'string' && Number.isFinite(x.at)).slice(0, HISTORY_KEEP)
        .map((x) => ({ at: x.at, result: x.result.slice(0, 40), who: typeof x.who === 'string' ? x.who.slice(0, MAX_WHO) : '' }))
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
  function sanitizeData(d) {
    if (!d || typeof d !== 'object' || !Array.isArray(d.wheels)) return null;
    const wheels = d.wheels.slice(0, MAX_WHEELS).map(sanitizeWheel).filter(Boolean);
    if (wheels.length === 0) return null;
    const s = d.settings && typeof d.settings === 'object' ? d.settings : {};
    return {
      version: 1,
      wheels,
      settings: {
        template: typeof s.template === 'string' && s.template.trim() ? s.template.slice(0, 200) : DEFAULT_TEMPLATE,
        who: typeof s.who === 'string' ? s.who.slice(0, MAX_WHO) : '',
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

  // ---- 全体の状態 ----
  let data = loadData();
  const views = [];
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
  const pad2 = (n) => String(n).padStart(2, '0');
  const stampOf = (ms) => { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
  const currentWho = () => $('who').value.trim().slice(0, MAX_WHO);

  // アクセス解析（GoatCounter。利用者の決定、2026-10-30「GoatCounterはいい感じに」）。ページの数え方に加えて、回した・コピーした・共有した回数を数える。
  // 項目や結果・名前の中身は送らない（回数だけ）。count.js がまだ読み込まれていなければ、読み込まれたときに送る。読めない（広告ブロックなど）ときは何もしない。
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
  // 「、」で区切った言葉の単位で折り返す（「サイン入りポスター ×2」の「×2」だけが次の行に落ちないように）。1 つの言葉が長すぎるときだけ、文字で折り返す。
  function wrapTokens(ctx, text, maxW) {
    const tokens = text.split('、').map((t, i, a) => (i < a.length - 1 ? `${t}、` : t));
    const lines = [];
    let line = '';
    for (const t of tokens) {
      if (line && ctx.measureText(line + t).width > maxW) {
        lines.push(line);
        line = '';
      }
      if (ctx.measureText(t).width > maxW) {
        const parts = wrapLines(ctx, t, maxW);
        lines.push(...parts.slice(0, -1));
        line = parts[parts.length - 1];
      } else {
        line += t;
      }
    }
    if (line) lines.push(line);
    return lines;
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

  // 結果・まとめの画像に共通の、華やかな背景（配色に関わらず、濃い紫〜青。きらめきの位置は seedText から決める）
  function paintBackdrop(x, W, H, seedText, glow) {
    const bg = x.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#1b1450');
    bg.addColorStop(0.55, '#41187a');
    bg.addColorStop(1, '#0f2f5c');
    x.fillStyle = bg;
    x.fillRect(0, 0, W, H);
    if (glow) {
      const g = x.createRadialGradient(330, 340, 40, 330, 340, 420);
      g.addColorStop(0, 'rgba(255, 214, 90, 0.35)');
      g.addColorStop(1, 'rgba(255, 214, 90, 0)');
      x.fillStyle = g;
      x.fillRect(0, 0, W, H);
    }
    let seed = 7;
    for (const ch of Array.from(seedText)) seed = (seed * 31 + ch.charCodeAt(0)) % 100003;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const count = Math.round((W * H) / 11000);
    for (let i = 0; i < count; i++) {
      const sx = 20 + rnd() * (W - 40), sy = 14 + rnd() * (H - 28), sr = 2 + rnd() * 5;
      x.fillStyle = `rgba(255, 240, 190, ${0.2 + rnd() * 0.45})`;
      if (i % 3 === 0) {
        starPath(x, sx, sy, sr * 1.8);
        x.fill();
      } else {
        x.beginPath();
        x.arc(sx, sy, sr * 0.6, 0, TAU);
        x.fill();
      }
    }
  }
  function goldGradient(x, y0, y1) {
    const g = x.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, '#fff6c8');
    g.addColorStop(0.5, '#ffd23f');
    g.addColorStop(1, '#ff9f1c');
    return g;
  }

  // 結果の画像（1200×675。止まった円盤・結果・ルーレットの名前・当てた人・日付）
  function makeCard(last) {
    const W = 1200, H = 675;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const x = c.getContext('2d');
    const ff = fontFamily();
    paintBackdrop(x, W, H, last.text, true);
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
    // 「結果」の札と、当てた人
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
    if (last.who) {
      x.fillStyle = '#ffffff';
      x.font = `700 34px ${ff}`;
      x.fillText(fitText(x, `${last.who} さん`, maxW - 150), left + 140, 214);
    }
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
    const gold = goldGradient(x, 260, 260 + size * 1.2 * lines.length);
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
    x.fillStyle = '#c4b4f0';
    x.font = `600 26px ${ff}`;
    x.fillText(`${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}　IriDock ルーレット`, left, 628);
    return c;
  }

  // まとめの画像（誰が何を当てたかの表）。長いときは複数枚に分ける（文章だと文字数の制限に引っかかるため、表の画像にする。利用者の指示）。
  // 1 枚の目安: 当たり 25 件・表の高さ 1500px。1 人の分が長いときは、人の途中で次の画像へ「（つづき）」として続ける。
  function makeSummaryPages(summary, scopeName, showWheel) {
    const W = 1200;
    const ff = fontFamily();
    const measure = document.createElement('canvas').getContext('2d');
    measure.font = `600 32px ${ff}`;
    const textW = 700;
    // 行（1 人ぶん。長い文は折り返して、何行になるかを数える）
    const rows = [];
    for (const g of summary.groups) {
      const lines = [];
      for (const l of summaryLines(g, showWheel)) lines.push(...wrapTokens(measure, l, textW));
      // 1 つの行が長すぎるときは分ける（人の途中でも次の画像へ）
      for (let i = 0; i < lines.length; i += 12) rows.push({ who: g.who, lines: lines.slice(i, i + 12), cont: i > 0, total: g.total });
    }
    const lineH = 42;
    const rowH = (r) => Math.max(60, r.lines.length * lineH + 22);
    const pages = [];
    let cur = { rows: [], h: 0, entries: 0 };
    for (const r of rows) {
      const first = !r.cont;
      const need = rowH(r);
      if (cur.rows.length > 0 && (cur.h + need > SUMMARY_PAGE_BODY || (first && cur.entries + r.total > SUMMARY_PAGE_ENTRIES))) {
        pages.push(cur);
        cur = { rows: [], h: 0, entries: 0 };
      }
      cur.rows.push(r);
      cur.h += need;
      if (first) cur.entries += r.total;
    }
    if (cur.rows.length > 0 || pages.length === 0) pages.push(cur);
    return pages.map((pg, pi) => {
      const H = 170 + 56 + pg.h + 80;
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const x = c.getContext('2d');
      paintBackdrop(x, W, H, scopeName + pi, false);
      x.textAlign = 'left';
      x.textBaseline = 'alphabetic';
      x.font = `800 56px ${ff}`;
      x.lineJoin = 'round';
      x.lineWidth = 9;
      x.strokeStyle = 'rgba(40, 10, 70, 0.75)';
      const title = fitText(x, scopeName, W - 300);
      x.strokeText(title, 60, 100);
      x.fillStyle = goldGradient(x, 50, 110);
      x.fillText(title, 60, 100);
      x.fillStyle = '#d9ccff';
      x.font = `600 26px ${ff}`;
      x.fillText(`${summary.groups.length} 人・${summary.entries} 件`, 60, 146);
      if (pages.length > 1) {
        x.textAlign = 'right';
        x.fillStyle = '#ffd23f';
        x.font = `800 34px ${ff}`;
        x.fillText(`${pi + 1} / ${pages.length}`, W - 60, 100);
        x.textAlign = 'left';
      }
      // 表の見出し
      x.fillStyle = 'rgba(246, 196, 69, 0.95)';
      x.fillRect(40, 170, W - 80, 52);
      x.fillStyle = '#3a1a00';
      x.font = `800 28px ${ff}`;
      x.fillText('当てた人', 64, 207);
      x.fillText('当たったもの', 400, 207);
      let y = 226;
      pg.rows.forEach((r, i) => {
        const hh = rowH(r);
        if (i % 2 === 0) {
          x.fillStyle = 'rgba(255, 255, 255, 0.08)';
          x.fillRect(40, y, W - 80, hh);
        }
        x.fillStyle = r.who === NO_WHO ? '#c4b4f0' : '#ffd23f';
        x.font = `800 34px ${ff}`;
        x.fillText(fitText(x, r.cont ? `${r.who}（つづき）` : r.who, 320), 64, y + 44);
        x.fillStyle = '#ffffff';
        x.font = `600 32px ${ff}`;
        r.lines.forEach((l, k) => x.fillText(l, 400, y + 44 + k * lineH));
        y += hh;
      });
      const d = new Date();
      x.fillStyle = '#c4b4f0';
      x.font = `600 24px ${ff}`;
      x.textAlign = 'right';
      x.fillText(`${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}　IriDock ルーレット`, W - 60, H - 26);
      return c;
    });
  }

  // ---- 画像のコピー・共有（API は使わない） ----
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
  async function copyCanvas(canvas, fileName) {
    const blobPromise = new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (navigator.clipboard && window.ClipboardItem) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
        return 'copied';
      } catch (e) { /* 下で保存に切り替える */ }
    }
    download(await blobPromise, fileName);
    return 'downloaded';
  }
  const canShareFiles = () => {
    try {
      return !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'a.png', { type: 'image/png' })] }));
    } catch (e) {
      return false;
    }
  };
  const toBlob = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  // 共有メニュー（X・Discord などのアプリを選べる）。画像（複数枚も可）と文面を一緒に渡す。
  async function shareImages(canvases, baseName, text, onError) {
    const files = [];
    for (let i = 0; i < canvases.length; i++) {
      files.push(new File([await toBlob(canvases[i])], canvases.length > 1 ? `${baseName}-${i + 1}.png` : `${baseName}.png`, { type: 'image/png' }));
    }
    const payload = { files, text };
    try {
      if (navigator.canShare && navigator.canShare(payload)) await navigator.share(payload);
    } catch (e) {
      if (e && e.name !== 'AbortError') onError('共有できませんでした。「画像をコピー」を使ってください。');
    }
  }
  const textFor = (last) => (data.settings.template || DEFAULT_TEMPLATE).split('{result}').join(last.text).split('{who}').join(last.who || '');

  // ---- 動きのまとめ役（回している間・当たりの演出は毎コマ、ふだんはランプだけ 0.5 秒ごと） ----
  let reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => { reduced = mq.matches; };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
  }
  let lastNow = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - lastNow) / 1000);
    lastNow = now;
    if (document.hidden) return;
    for (const v of views) v.frame(now, dt);
  }

  // ---- ルーレット 1 つぶんの画面（円盤・結果・項目と重み・履歴） ----
  function createView(wheel) {
    const v = { w: wheel, rot: 0, anim: null, tilt: 0, bulb: 0, winnerIdx: null, celebrateUntil: 0, confetti: [], last: null, lastIdle: 0 };

    // DOM
    const el = h('article', 'panel rl-card');
    const head = h('div', 'rl-card-head');
    const title = h('input', 'rl-title');
    title.type = 'text';
    title.maxLength = 30;
    title.value = wheel.name;
    title.autocomplete = 'off';
    title.setAttribute('aria-label', 'ルーレットの名前');
    const delWheel = h('button', 'rl-btn', '削除');
    delWheel.type = 'button';
    head.append(title, delWheel);
    const body = h('div', 'rl-card-body');

    const stage = h('div', 'rl-stage');
    const box = h('div', 'rl-wheelbox');
    const canvas = h('canvas', 'rl-wheel');
    canvas.setAttribute('role', 'img');
    box.append(canvas);
    const result = h('p', 'rl-result', '　');
    result.setAttribute('role', 'status');
    result.setAttribute('aria-live', 'polite');
    const actions = h('div', 'rl-actions');
    const spinBtn = h('button', 'rl-primary', '回す');
    spinBtn.type = 'button';
    const fsBtn = h('button', 'rl-btn', '全画面');
    fsBtn.type = 'button';
    fsBtn.hidden = true;
    actions.append(spinBtn, fsBtn);
    const share = h('div', 'rl-share');
    share.hidden = true;
    const copyBtn = h('button', 'rl-btn', '画像をコピー');
    copyBtn.type = 'button';
    const shareBtn = h('button', 'rl-btn', '共有');
    shareBtn.type = 'button';
    shareBtn.hidden = !canShareFiles();
    share.append(copyBtn, shareBtn);
    const status = h('p', 'rl-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const preview = h('img', 'rl-preview');
    preview.hidden = true;
    const fx = h('canvas', 'rl-fx');
    fx.setAttribute('aria-hidden', 'true');
    stage.append(box, result, actions, share, status, preview, fx);

    const edit = h('div', 'rl-edit');
    // 項目と重み
    const itemsBox = h('details', 'rl-more');
    itemsBox.open = true;
    itemsBox.append(h('summary', null, '項目と重み'));
    itemsBox.append(h('p', 'rl-note', '重みが大きいほど当たりやすくなります（0 は当たりません）'));
    const ul = h('ul', 'rl-items');
    ul.setAttribute('aria-label', '項目の一覧');
    const addRow = h('div', 'rl-row');
    const addBtn = h('button', 'rl-btn', '項目を足す');
    addBtn.type = 'button';
    const count = h('span', 'rl-count');
    addRow.append(addBtn, count);
    const bulkBox = h('details', 'rl-more');
    bulkBox.append(h('summary', null, 'まとめて追加'));
    const bulk = h('textarea');
    bulk.rows = 4;
    bulk.placeholder = '1 行に 1 つ。「名前,重み」でも入れられます（例: ゲーム,2）';
    const bulkBtn = h('button', 'rl-btn', '追加する');
    bulkBtn.type = 'button';
    bulkBox.append(bulk, bulkBtn);
    const opts = h('div', 'rl-options');
    const removeLabel = h('label');
    const removeCheck = h('input');
    removeCheck.type = 'checkbox';
    removeCheck.checked = wheel.removePicked;
    removeLabel.append(removeCheck, document.createTextNode(' 当たった項目を一覧から除く'));
    opts.append(removeLabel);
    itemsBox.append(ul, addRow, bulkBox, opts);
    // 履歴（全部表示）
    const histBox = h('details', 'rl-more');
    histBox.open = true;
    const histSum = h('summary');
    histBox.append(histSum);
    const histWrap = h('div', 'rl-histwrap');
    const histTable = h('table', 'rl-hist');
    const thead = h('thead');
    const hr = h('tr');
    for (const t of ['日時', '当てた人', '結果']) hr.append(h('th', null, t));
    thead.append(hr);
    const tbody = h('tbody');
    histTable.append(thead, tbody);
    histWrap.append(histTable);
    const histEmpty = h('p', 'rl-note', 'まだありません');
    const histClear = h('button', 'rl-btn', '履歴を消す');
    histClear.type = 'button';
    histBox.append(histWrap, histEmpty, histClear);
    edit.append(itemsBox, histBox);
    body.append(stage, edit);
    el.append(head, body);
    v.el = el;
    v.title = title;

    const setStatus = (t) => { status.textContent = t || ''; };
    const displayItems = () => (v.anim ? v.anim.snapshot : wheel.items);
    // 項目や重みを直したら、当たりの強調は消す（円盤の切れ目が変わるため）
    const touch = () => { v.winnerIdx = null; };

    // 円盤を描く
    function redraw() {
      const S = Math.max(160, Math.round(box.clientWidth * Math.min(window.devicePixelRatio || 1, 3)));
      if (canvas.width !== S || canvas.height !== S) {
        canvas.width = S;
        canvas.height = S;
      }
      canvas.setAttribute('aria-label', `ルーレットの円盤（${wheel.name}）。押すと回ります`);
      drawWheel(canvas.getContext('2d'), S, v.rot, displayItems(), fontFamily(), { bulb: v.bulb, winner: v.winnerIdx, tilt: v.tilt });
    }
    v.redraw = redraw;

    // 紙吹雪（当たりの演出。「動きを減らす」設定のときは出さない）
    function fxFit() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(stage.clientWidth * dpr), hgt = Math.round(stage.clientHeight * dpr);
      if (fx.width !== w || fx.height !== hgt) {
        fx.width = w;
        fx.height = hgt;
      }
      return dpr;
    }
    function spawnConfetti() {
      const sr = stage.getBoundingClientRect();
      const wr = canvas.getBoundingClientRect();
      const ox = wr.left - sr.left + wr.width / 2;
      const oy = wr.top - sr.top + wr.height * 0.52;
      const unit = Math.max(260, wr.width);
      v.confetti = [];
      for (let i = 0; i < 170; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.15;
        const sp = unit * (0.7 + Math.random() * 1.1);
        v.confetti.push({
          x: ox, y: oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 14,
          w: 6 + Math.random() * 7, h: 10 + Math.random() * 9,
          color: PALETTE[Math.floor(Math.random() * PALETTE.length)][0],
          life: 0, max: 2.2 + Math.random() * 1.4, round: Math.random() < 0.25,
        });
      }
    }
    function stepConfetti(dt) {
      const g = Math.max(260, canvas.clientWidth) * 2.6;
      for (const p of v.confetti) {
        p.life += dt;
        p.vy += g * dt;
        p.vx *= 1 - 0.6 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
      }
      v.confetti = v.confetti.filter((p) => p.life < p.max);
    }
    function drawConfetti() {
      const dpr = fxFit();
      const ctx = fx.getContext('2d');
      ctx.clearRect(0, 0, fx.width, fx.height);
      for (const p of v.confetti) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, (p.max - p.life) / 0.6));
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
      v.confetti = [];
      fx.getContext('2d').clearRect(0, 0, fx.width, fx.height);
    }

    // 回す
    function setSpinning(on) {
      spinBtn.disabled = on;
      canvas.classList.toggle('is-spinning', on);
    }
    function spin() {
      if (v.anim) return;
      const idx = pickIndex(wheel.items, randomUnit);
      if (idx === null) {
        setStatus('回せる項目がありません。名前を入れて、重みを 0 より大きくしてください。');
        return;
      }
      setStatus('');
      share.hidden = true;
      preview.hidden = true;
      result.classList.remove('pop');
      result.textContent = '…';
      v.winnerIdx = null;
      v.celebrateUntil = 0;
      clearFx();
      const entry = layoutOf(wheel.items).find((e) => e.index === idx);
      const from = v.rot;
      v.anim = {
        from,
        to: targetRotation(from, entry, randomUnit, SPIN_TURNS),
        t0: performance.now(),
        dur: reduced ? SPIN_MS_REDUCED : SPIN_MS,
        idx,
        label: wheel.items[idx].label,
        who: currentWho(),   // 回し始めの名前の欄の中身（回している間に直しても、この回は変わらない）
        snapshot: wheel.items.map((it) => ({ label: it.label, weight: it.weight })),
      };
      setSpinning(true);
      countEvent('roulette-spin', 'ルーレットを回した');
    }
    function finish(a, now) {
      const text = a.label.trim();
      v.last = { name: wheel.name, items: a.snapshot, rot: v.rot, text, winner: a.idx, who: a.who, at: Date.now() };
      wheel.history.unshift({ at: v.last.at, result: a.label, who: a.who });
      wheel.history.length = Math.min(wheel.history.length, HISTORY_KEEP);
      v.winnerIdx = a.idx;
      if (wheel.removePicked) {
        wheel.items.splice(a.idx, 1);
        v.winnerIdx = null;
      }
      save();
      setSpinning(false);
      result.textContent = a.who ? `${text}（${a.who} さん）` : text;
      if (!reduced) {
        void result.offsetWidth;
        result.classList.add('pop');
        v.celebrateUntil = now + 1800;
        spawnConfetti();
      }
      share.hidden = false;
      renderHistory();
      if (wheel.removePicked) renderItems();
      redraw();
      renderSummary();
    }
    function stepSpin(now) {
      const a = v.anim;
      const t = Math.min(1, Math.max(0, (now - a.t0) / a.dur));   // コマの時刻が回し始めより少し前になることがあるので、0 未満にしない
      v.rot = a.from + (a.to - a.from) * (1 - Math.pow(1 - t, 4));
      v.tilt = reduced || t >= 1 ? 0 : pointerTilt(a.snapshot, v.rot);
      if (t >= 1) {
        v.rot = a.to % TAU;
        v.anim = null;
        finish(a, now);
      }
    }
    v.frame = (now, dt) => {
      const spinning = !!v.anim;
      if (spinning) stepSpin(now);
      const celebrating = v.confetti.length > 0 || now < v.celebrateUntil;
      if (!v.anim && !celebrating) {
        if (v.tilt !== 0) { v.tilt = 0; redraw(); }
        if (reduced || now - v.lastIdle < 500) return;
        v.lastIdle = now;
        v.bulb = (v.bulb + 1) % 2;
        redraw();
        return;
      }
      v.bulb = reduced ? 0 : Math.floor(now / (spinning ? 70 : 150)) % 2;
      if (v.confetti.length > 0) {
        stepConfetti(dt);
        drawConfetti();
        if (v.confetti.length === 0) clearFx();
      }
      redraw();
    };

    // 結果の画像のコピー・共有
    function showPreview(c) {
      preview.src = c.toDataURL('image/png');   // CSP は data: を許している。長押しで保存できるよう、画面にも出す
      preview.alt = '結果の画像（長押しで保存できます）';
      preview.hidden = false;
    }
    copyBtn.addEventListener('click', () => {
      if (!v.last) return;
      countEvent('roulette-copy', '結果の画像をコピーした');
      const c = makeCard(v.last);
      showPreview(c);
      copyCanvas(c, 'iridock-roulette.png').then((r) => setStatus(r === 'copied' ? '画像をコピーしました。X や Discord などに貼り付けて使えます。' : 'コピーできなかったので、画像を保存しました。'));
    });
    shareBtn.addEventListener('click', async () => {
      if (!v.last) return;
      countEvent('roulette-share', '結果の画像を共有した');
      const c = makeCard(v.last);
      showPreview(c);
      await shareImages([c], 'iridock-roulette', textFor(v.last), setStatus);
    });

    // 項目と重みの編集
    function updatePercents() {
      const total = wheel.items.reduce((s, it) => s + (isLive(it) ? it.weight : 0), 0);
      const spans = ul.querySelectorAll('.rl-pc');
      wheel.items.forEach((it, i) => {
        if (spans[i]) spans[i].textContent = isLive(it) && total > 0 ? `${((it.weight / total) * 100).toFixed(1)}%` : '—';
      });
    }
    function renderItems() {
      ul.replaceChildren();
      wheel.items.forEach((it, i) => {
        const li = document.createElement('li');
        const dot = h('span', 'rl-dot');
        dot.style.background = sliceColor(i, wheel.items.length);
        const lab = h('input');
        lab.type = 'text';
        lab.maxLength = 40;
        lab.value = it.label;
        lab.placeholder = '項目の名前';
        lab.setAttribute('aria-label', `項目 ${i + 1} の名前`);
        lab.addEventListener('input', () => { it.label = lab.value; touch(); save(); updatePercents(); redraw(); });
        const wt = h('input');
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
        const pc = h('span', 'rl-pc');
        const del = h('button', 'rl-del', '×');
        del.type = 'button';
        del.setAttribute('aria-label', `項目 ${i + 1} を消す`);
        del.addEventListener('click', () => { wheel.items.splice(i, 1); touch(); save(); renderItems(); });
        li.append(dot, lab, wt, pc, del);
        ul.append(li);
      });
      count.textContent = `${wheel.items.length} / ${MAX_ITEMS} 件`;
      addBtn.disabled = wheel.items.length >= MAX_ITEMS;
      updatePercents();
      redraw();
    }
    addBtn.addEventListener('click', () => {
      if (wheel.items.length >= MAX_ITEMS) return;
      wheel.items.push({ label: '', weight: 1 });
      touch();
      save();
      renderItems();
      const inputs = ul.querySelectorAll('input[type="text"]');
      if (inputs.length) inputs[inputs.length - 1].focus();
    });
    function parseBulk(text) {
      return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
        const m = line.match(/^(.*?)[,，\t]\s*(\d+(?:\.\d+)?)\s*$/);
        return m && m[1].trim() ? { label: m[1].trim().slice(0, 40), weight: cleanWeight(m[2]) } : { label: line.slice(0, 40), weight: 1 };
      });
    }
    bulkBtn.addEventListener('click', () => {
      const rows = parseBulk(bulk.value);
      const room = MAX_ITEMS - wheel.items.length;
      wheel.items.push(...rows.slice(0, Math.max(0, room)));
      bulk.value = '';
      setStatus(rows.length > room ? `${MAX_ITEMS} 件までなので、${Math.max(0, room)} 件だけ足しました。` : `${rows.length} 件を足しました。`);
      touch();
      save();
      renderItems();
    });
    removeCheck.addEventListener('change', () => { wheel.removePicked = removeCheck.checked; save(); });

    // 履歴（全部表示。「当てた人」はあとから直せる）
    function renderHistory() {
      tbody.replaceChildren();
      histSum.textContent = `履歴（${wheel.history.length} 件。保存は ${HISTORY_KEEP} 件まで）`;
      histWrap.hidden = wheel.history.length === 0;
      histEmpty.hidden = wheel.history.length > 0;
      histClear.disabled = wheel.history.length === 0;
      wheel.history.forEach((entry, i) => {
        const tr = document.createElement('tr');
        const t = h('td', 'at', stampOf(entry.at));
        const who = document.createElement('td');
        const input = h('input');
        input.type = 'text';
        input.maxLength = MAX_WHO;
        input.value = entry.who || '';
        input.placeholder = '名前なし';
        input.setAttribute('aria-label', `履歴 ${i + 1} の当てた人`);
        input.addEventListener('input', () => { entry.who = input.value.slice(0, MAX_WHO); save(); renderSummary(); });
        who.append(input);
        const r = h('td', null, entry.result.trim() || NO_WHO);
        tr.append(t, who, r);
        tbody.append(tr);
      });
    }
    // 履歴を消す前に確認する（利用者の指示、2026-10-30「履歴を消す際に確認がでるようにして」）
    histClear.addEventListener('click', () => {
      const n = wheel.history.length;
      if (n === 0) return;
      if (!window.confirm(`「${wheel.name}」の履歴 ${n} 件を消します。元には戻せません。よろしいですか？`)) return;
      wheel.history = [];
      save();
      renderHistory();
      renderSummary();
    });

    // 名前・削除・回す・全画面
    title.addEventListener('input', () => { wheel.name = title.value.slice(0, 30); el.setAttribute('aria-label', wheel.name || 'ルーレット'); save(); renderScope(); renderSummary(); });
    title.addEventListener('change', () => {
      if (!title.value.trim()) {
        wheel.name = 'ルーレット';
        title.value = wheel.name;
        save();
        renderScope();
        renderSummary();
      }
    });
    delWheel.addEventListener('click', () => {
      if (v.anim) return;
      if (!window.confirm(`「${wheel.name}」を消します。項目と履歴もなくなります。よろしいですか？`)) return;
      removeWheel(v);
    });
    spinBtn.addEventListener('click', spin);
    canvas.addEventListener('click', spin);   // 円盤を押しても回る
    if (document.fullscreenEnabled && stage.requestFullscreen) {
      fsBtn.hidden = false;
      fsBtn.addEventListener('click', () => {
        if (document.fullscreenElement) document.exitFullscreen();
        else stage.requestFullscreen();
      });
      document.addEventListener('fullscreenchange', () => setTimeout(redraw, 50));
    }
    if (window.ResizeObserver) v.ro = new ResizeObserver(() => { redraw(); fxFit(); }), v.ro.observe(stage);

    v.destroy = () => { if (v.ro) v.ro.disconnect(); };
    el.setAttribute('aria-label', wheel.name || 'ルーレット');
    renderItems();
    renderHistory();
    return v;
  }

  // ---- ルーレットの追加・削除 ----
  function addWheel(wheel) {
    const v = createView(wheel);
    views.push(v);
    $('wheels').append(v.el);
    v.redraw();
    return v;
  }
  function removeWheel(v) {
    data.wheels = data.wheels.filter((w) => w !== v.w);
    v.destroy();
    v.el.remove();
    views.splice(views.indexOf(v), 1);
    if (data.wheels.length === 0) {   // 1 つも無いと、画面に何も出ないので、空のルーレットを 1 つ置く
      const w = newWheel('ルーレット 1');
      data.wheels.push(w);
      addWheel(w);
    }
    save();
    renderScope();
    renderSummary();
  }
  $('wheel-add').addEventListener('click', () => {
    if (data.wheels.length >= MAX_WHEELS) {
      $('add-note').textContent = `ルーレットは ${MAX_WHEELS} 個までです。`;
      return;
    }
    $('add-note').textContent = '';
    const w = newWheel(`ルーレット ${data.wheels.length + 1}`);
    data.wheels.push(w);
    const v = addWheel(w);
    save();
    renderScope();
    renderSummary();
    countEvent('roulette-add', 'ルーレットを追加した');
    v.el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' });
    v.title.focus();
    v.title.select();
  });

  // ---- まとめ（誰が何を当てたか。表の画像で共有する） ----
  function renderScope() {
    const sel = $('summary-scope');
    const keep = sel.value || 'all';
    sel.replaceChildren();
    const all = h('option', null, '全部のルーレット');
    all.value = 'all';
    sel.append(all);
    for (const w of data.wheels) {
      const o = h('option', null, w.name || 'ルーレット');
      o.value = w.id;
      sel.append(o);
    }
    sel.value = data.wheels.some((w) => w.id === keep) ? keep : 'all';
  }
  const summaryScope = () => $('summary-scope').value || 'all';
  const summaryTitle = () => {
    const s = summaryScope();
    const w = data.wheels.find((x) => x.id === s);
    return w ? `${w.name} の結果` : '誰が何を当てたか';
  };
  const showWheelNames = () => summaryScope() === 'all' && data.wheels.length > 1;
  function renderSummary() {
    const s = summarize(data.wheels, summaryScope());
    const tbody = $('summary-body');
    tbody.replaceChildren();
    const show = showWheelNames();
    for (const g of s.groups) {
      const tr = document.createElement('tr');
      tr.append(h('td', 'who', g.who));
      const td = document.createElement('td');
      for (const l of summaryLines(g, show)) td.append(h('div', null, l));
      tr.append(td);
      tbody.append(tr);
    }
    $('summary-wrap').hidden = s.groups.length === 0;
    $('summary-empty').hidden = s.groups.length > 0;
    $('summary-count').textContent = s.groups.length ? `${s.groups.length} 人・${s.entries} 件` : '';
    $('summary-copy').disabled = $('summary-share').disabled = s.groups.length === 0;
    $('summary-pages').replaceChildren();
    $('summary-status').textContent = '';
  }
  // 画像を作る（複数枚のときは、枚ごとに下見とコピーのボタンを出す）
  function buildSummaryPages() {
    const s = summarize(data.wheels, summaryScope());
    const pages = makeSummaryPages(s, summaryTitle(), showWheelNames());
    const box = $('summary-pages');
    box.replaceChildren();
    pages.forEach((c, i) => {
      const fig = h('figure', 'rl-page');
      const img = h('img');
      img.src = c.toDataURL('image/png');
      img.alt = `まとめの画像 ${i + 1} 枚目（長押しで保存できます）`;
      fig.append(img);
      if (pages.length > 1) {
        const b = h('button', 'rl-btn', `${i + 1} 枚目をコピー`);
        b.type = 'button';
        b.addEventListener('click', () => {
          countEvent('roulette-summary-copy', 'まとめの画像をコピーした');
          copyCanvas(c, `iridock-roulette-summary-${i + 1}.png`).then((r) => { $('summary-status').textContent = r === 'copied' ? `${i + 1} 枚目をコピーしました。` : `コピーできなかったので、${i + 1} 枚目を保存しました。`; });
        });
        fig.append(b);
      }
      box.append(fig);
    });
    return { pages, summary: s };
  }
  $('summary-scope').addEventListener('change', renderSummary);
  $('summary-copy').addEventListener('click', () => {
    countEvent('roulette-summary-copy', 'まとめの画像をコピーした');
    const { pages } = buildSummaryPages();
    copyCanvas(pages[0], 'iridock-roulette-summary.png').then((r) => {
      const more = pages.length > 1 ? `（全 ${pages.length} 枚のうち 1 枚目。ほかの枚は下のボタンでコピーできます）` : '';
      $('summary-status').textContent = r === 'copied' ? `画像をコピーしました。貼り付けて使えます。${more}` : 'コピーできなかったので、画像を保存しました。';
    });
  });
  $('summary-share').addEventListener('click', async () => {
    countEvent('roulette-summary-share', 'まとめの画像を共有した');
    const { pages, summary } = buildSummaryPages();
    await shareImages(pages, 'iridock-roulette-summary', `${summaryTitle()}（${summary.groups.length} 人・${summary.entries} 件）`, (t) => { $('summary-status').textContent = t; });
  });
  if (canShareFiles()) $('summary-share').hidden = false;

  // ---- 設定・書き出し・読み込み ----
  function exportData() {
    const d = new Date();
    download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `iridock-roulette-${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}.json`);
  }
  async function importFile(file) {
    const note = $('settings-status');
    try {
      const d = sanitizeData(JSON.parse(await file.text()));
      if (!d) {
        note.textContent = '読み込めませんでした（このルーレットの書き出しではないようです）。';
        return;
      }
      if (views.some((v) => v.anim)) {
        note.textContent = '回している最中は読み込めません。';
        return;
      }
      if (!window.confirm(`今のルーレットを、読み込んだ ${d.wheels.length} 件に入れ替えます。よろしいですか？`)) return;
      data = d;
      rebuild();
      save();
      note.textContent = `読み込みました（${d.wheels.length} 件）。`;
    } catch (e) {
      note.textContent = '読み込めませんでした（ファイルを読めません）。';
    }
  }
  function rebuild() {
    for (const v of views.splice(0)) {
      v.destroy();
      v.el.remove();
    }
    $('who').value = data.settings.who;
    $('template').value = data.settings.template;
    for (const w of data.wheels) addWheel(w);
    renderScope();
    renderSummary();
  }
  $('who').addEventListener('input', (e) => { data.settings.who = e.target.value.slice(0, MAX_WHO); save(); });
  $('template').addEventListener('input', (e) => { data.settings.template = e.target.value.slice(0, 200) || DEFAULT_TEMPLATE; save(); });
  $('export').addEventListener('click', exportData);
  $('import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) importFile(f);
  });

  // 確かめの道具から呼ぶ（画面の見た目に関わらない部分と、状態の読み出し）
  window.IriRoulette = {
    pickIndex, layoutOf, indexAtPointer, targetRotation, randomUnit, cleanWeight, sanitizeData, sliceColor, pointerTilt, summarize, summaryLines,
    state: () => ({
      data,
      who: $('who').value,
      views: views.map((v) => ({ id: v.w.id, rot: v.rot, spinning: !!v.anim, last: v.last, winner: v.winnerIdx, confetti: v.confetti.length, tilt: v.tilt })),
    }),
    makeCard: (i) => {
      const v = views[i || 0];
      return makeCard(v.last || { name: v.w.name, items: v.w.items, rot: v.rot, text: '見本', winner: null, who: '', at: Date.now() });
    },
    makeSummaryPages: () => makeSummaryPages(summarize(data.wheels, summaryScope()), summaryTitle(), showWheelNames()),
  };

  rebuild();
  requestAnimationFrame(frame);
  // 書体（Noto Sans JP・Inter）は、使うまで読み込まれない。読み込めたら円盤を描き直す。
  if (document.fonts && document.fonts.load) {
    Promise.all(['800 20px "Noto Sans JP"', '700 20px "Noto Sans JP"', '700 20px Inter'].map((f) => document.fonts.load(f, 'あA'))).then(() => views.forEach((v) => v.redraw())).catch(() => {});
  }
})();
