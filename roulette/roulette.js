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
  const MAX_PEOPLE = 200;         // 登録できる「当てた人」
  const MAX_TEMPLATES = 30;       // 保存できるテンプレート
  const MAX_ITEMS = 50;          // 円盤の文字が読める範囲
  const MAX_WEIGHT = 100;
  const MAX_WHO = 30;
  const HISTORY_KEEP = 100;      // ルーレットごとに 100 件まで保存（利用者の指示）。画面にも全部出す
  const DEFAULT_TEMPLATE = 'ルーレットの結果は「{result}」になりました！';   // デスクトップ版と同じ。共有に添える文面（{result}＝結果、{who}＝当てた人）
  const SPIN_MS_REDUCED = 800;   // 「動きを減らす」設定のとき（演出ごとの回す時間は EFFECTS）
  const SUMMARY_PAGE_ENTRIES = 25;   // まとめの画像 1 枚に入れる当たりの数の目安（超えたら複数枚に分ける）
  const SUMMARY_PAGE_BODY = 1500;    // まとめの画像 1 枚の表の高さの上限（px）
  const NO_WHO = '（名前なし）';
  const TAU = Math.PI * 2;
  const $ = (id) => document.getElementById(id);

  // ページ（index.html）と、このスクリプトの版が食い違っていないかを確かめる（2026-10-30。ブラウザが前の版のファイルを最大 10 分覚えているため、
  // ページとスクリプトを同時に入れ替えた直後は、組み合わせがずれて何も動かなくなった）。ずれていたら、真っ白のまま黙らず、読み込み直しを案内する。
  // 公開のたびにスクリプトの名前に指紋（?v=）が付くので、ふだんはずれないが、念のための備え。
  const REQUIRED_IDS = ['notice', 'new-template', 'wheel-add', 'add-note', 'wheels', 'summary-scope', 'summary-body', 'summary-wrap', 'summary-empty', 'summary-count',
    'summary-copy', 'summary-x', 'summary-discord', 'summary-share', 'summary-pages', 'summary-status', 'template', 'discord-link', 'export', 'import', 'import-file', 'settings-status',
    'people-input', 'people-add', 'people-list', 'people-note', 'templates-list', 'templates-note',
    'look-theme', 'look-effect', 'look-effect-note', 'look-pattern', 'look-rim', 'look-shape', 'look-hub', 'look-hub-text', 'look-hub-text-row', 'look-hub-image-row', 'look-hub-image', 'look-hub-clear', 'look-hub-file', 'look-hub-note', 'look-preview'];
  if (REQUIRED_IDS.some((id) => !document.getElementById(id)) || typeof window.TomSelect !== 'function') {
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
  // 色合い（設定でまとめて選ぶ。利用者の指示、2026-10-30「ルーレットの種類みたいなのを設定毎に選べるようにしよう」「色合いとか演出も共通のところもっていって」。種類は色合いと演出で、見た目は円盤だけ）。
  // palette = 切れ目の色（明るい色・暗い色）。切れ目の中は、中心が暗く外側が明るいグラデーションにして立体感を出す。隣どうしが同じ色にならないよう順に使う。
  // rim = 縁の金属の色（4 色のグラデーション）、bulb = ランプ（点灯・光・消灯）、pointer = 針（明・中・暗）。文字は、どの色合いでも白の太字に濃いふちどり。
  const THEMES = {
    lively: {
      name: 'にぎやか',
      palette: [['#ff5d7d', '#b0123a'], ['#ffa63d', '#c2490d'], ['#ffd93d', '#b98300'], ['#34d1bf', '#087a72'], ['#4d94ff', '#1740b8'], ['#9b5cf6', '#5019a8'],
        ['#2fe08f', '#0a7d4b'], ['#f56bbd', '#a31f78'], ['#32c5ff', '#0369a1'], ['#ff6a3d', '#a82600'], ['#b6f23a', '#4f8a00'], ['#c24ae0', '#701a8c']],
      rim: ['#fff3b0', '#f6c445', '#b07a0a', '#ffe08a'], bulb: ['#fffbe3', '#ffe27a', '#b8781a'], pointer: ['#ff9aa9', '#e11d48', '#8a0b27'],
    },
    calm: {
      name: '落ち着いた',
      palette: [['#5f8fb5', '#1d3f5e'], ['#4f9a94', '#16504d'], ['#8a7fb5', '#3b3366'], ['#b0826b', '#5c3322'], ['#6f9a6a', '#244a25'], ['#a86f86', '#552c40'],
        ['#7d8fa3', '#2c3a4c'], ['#c0a05c', '#5f4812'], ['#5a7fa0', '#1c344d'], ['#9a6a5e', '#4a251e']],
      rim: ['#f4f6f9', '#bcc4cf', '#6c7787', '#e6eaf0'], bulb: ['#f6f9ff', '#cfe0ff', '#7a8798'], pointer: ['#a9bdd4', '#3f6a97', '#1d3a5c'],
    },
    wafu: {
      name: '和風',
      palette: [['#d04a3c', '#6e1612'], ['#2f6aa0', '#10304f'], ['#e8ad43', '#8d5a0f'], ['#468a63', '#1a4430'], ['#94559a', '#4a2150'], ['#d9617f', '#862445'],
        ['#3f969d', '#154d52'], ['#b8702a', '#5f330a'], ['#5a78b0', '#1f3158'], ['#7aa14c', '#2f4a14']],
      rim: ['#ffe7b0', '#dcab48', '#8d5f12', '#f6dc92'], bulb: ['#fff3d6', '#ffb347', '#8a5a2b'], pointer: ['#ff8a70', '#c8372d', '#6e1612'],
    },
    cute: {
      name: 'かわいい',
      palette: [['#ff8fb8', '#d63b7a'], ['#ffb36b', '#e57a26'], ['#ffe066', '#d8a51a'], ['#7fe3d1', '#2ba892'], ['#8ec5ff', '#3a7fd1'], ['#c3a1ff', '#7a4fd1'],
        ['#9ee89a', '#3fae52'], ['#ff9ecf', '#d14a97'], ['#7fd8ff', '#2a9ad1'], ['#ffa38a', '#d9573b'], ['#d4f07a', '#8fb52a'], ['#e3a4ff', '#a54fd1']],
      rim: ['#ffe9ef', '#f5aabd', '#b5576f', '#ffd3df'], bulb: ['#fff6f9', '#ffb3c9', '#c27a8c'], pointer: ['#ffb3c9', '#ec407a', '#9c1a4e'],
    },
    luxe: {
      name: 'ゴージャス',
      palette: [['#3a3a46', '#0b0b10'], ['#b02a40', '#4a0813'], ['#e0b246', '#7a5612'], ['#23704f', '#0b2b20'], ['#3b4fb0', '#111a4a'], ['#7a35a6', '#2b0f45']],
      rim: ['#fff3b0', '#f6c445', '#8a5a00', '#ffe9a3'], bulb: ['#fffbe3', '#ffe27a', '#a87414'], pointer: ['#ff8fa3', '#d81b43', '#7a0a22'],
    },
  };
  const DEFAULT_THEME = 'lively';
  // 演出（設定でまとめて選ぶ）。華やか = いまの動き。ふつう = 紙吹雪なし。控えめ = 点滅・紙吹雪・はずみなし（針のしなりと当たりの強調だけ）。
  // OS の「動きを減らす」設定のときは、どれを選んでも 0.8 秒で、動きは出さない。
  const EFFECTS = {
    full: { name: '華やか', desc: '回すのは 6 秒。ランプの点滅・紙吹雪・結果がはずむ動きが出ます。', spinMs: 6000, turns: 7, confetti: true, pop: true, blink: true },
    normal: { name: 'ふつう', desc: '回すのは 4.5 秒。紙吹雪は出ません（ランプの点滅と、結果がはずむ動きは出ます）。', spinMs: 4500, turns: 5, confetti: false, pop: true, blink: true },
    quiet: { name: '控えめ', desc: '回すのは 3 秒。点滅・紙吹雪・はずむ動きは出ません（針のしなりと、当たりの強調だけ）。', spinMs: 3000, turns: 4, confetti: false, pop: false, blink: false },
  };
  const DEFAULT_EFFECT = 'full';
  const themeOf = (name) => THEMES[name] || THEMES[DEFAULT_THEME];
  const effectOf = (name) => EFFECTS[name] || EFFECTS[DEFAULT_EFFECT];

  // 絵柄（円盤の見た目の種類。利用者の指示、2026-10-30「ルーレット自体の絵柄？も選択できるようにしてほしいな」「ルーレットの絵柄はルーレット毎じゃなくて設定でまとめて変わるように」）。
  // 色合い・演出はルーレットごとだが、絵柄は**設定で全部のルーレットにまとめて**決める（settings.look）。利用者が選んだ4つ: 切れ目の模様・縁のデザイン・盤の形・中央の飾り。
  const PATTERNS = { plain: { name: '無地' }, stripe: { name: 'しま' }, dots: { name: '水玉' }, stars: { name: '星' }, checker: { name: '市松' } };
  const RIMS = { lamp: { name: '金属とランプ' }, neon: { name: 'ネオン' }, pop: { name: 'ポップな丸' }, wafu: { name: '和風の鋲（びょう）' }, simple: { name: 'シンプルな線' } };
  const SHAPES = { disc: { name: '円盤' }, flower: { name: '花（縁が波形）' }, gear: { name: '歯車（縁がぎざぎざ）' }, dart: { name: 'ダーツ盤（同心の輪と的）' } };
  const HUBS = { star: { name: '星' }, heart: { name: 'ハート' }, crown: { name: '王冠' }, emoji: { name: '文字・絵文字' }, image: { name: '自分の画像' } };
  const MAX_HUB_IMAGE = 100000;   // 中央に置く画像（データの文字数）。保存はブラウザの中だけなので、小さく縮めて入れる
  const pickKey = (map, key, fallback) => (typeof key === 'string' && Object.prototype.hasOwnProperty.call(map, key) ? key : fallback);
  const cleanHubText = (v) => Array.from(String(v == null ? '' : v)).slice(0, 2).join('');
  const cleanHubImage = (v) => (typeof v === 'string' && v.length <= MAX_HUB_IMAGE && (v.startsWith('data:image/png;base64,') || v.startsWith('data:image/jpeg;base64,'))
    && /^[A-Za-z0-9+/=]+$/.test(v.slice(v.indexOf(',') + 1)) ? v : '');
  // 読み込んだ・壊れた保存でも、知らない値は既定に戻す
  const lookFields = (src) => {
    const o = src && typeof src === 'object' ? src : {};
    return { theme: pickKey(THEMES, o.theme, DEFAULT_THEME), effect: pickKey(EFFECTS, o.effect, DEFAULT_EFFECT), pattern: pickKey(PATTERNS, o.pattern, 'plain'), rim: pickKey(RIMS, o.rim, 'lamp'), shape: pickKey(SHAPES, o.shape, 'disc'), hub: pickKey(HUBS, o.hub, 'star'), hubText: cleanHubText(o.hubText), hubImage: cleanHubImage(o.hubImage) };
  };

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
  const colorIndex = (i, n, len) => (i + (n > 1 && i === n - 1 && i % len === 0 ? 5 : 0)) % len;
  const sliceColor = (i, n, theme) => { const p = (theme || themeOf(DEFAULT_THEME)).palette; return p[colorIndex(i, n || i + 1, p.length)][0]; };
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
  // 「当てた人を記録する」がなしのルーレット（罰ゲームなど）は、誰が当てたかが無いので、まとめに入れない。
  function summarize(wheels, scope) {
    const eligible = wheels.filter((w) => w.useWho !== false);
    const target = scope && scope !== 'all' ? eligible.filter((w) => w.id === scope) : eligible;
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
  // ルーレットのテンプレート（利用者の指示、2026-10-30「ルーレットを保存して、あたらしいルーレット作ったときにそのルーレットの設定をつかえるようにしたい。
  // デフォルトとして罰ゲームとプレゼントルーレットを表示するようにしてほしい」）。項目と重み・色合い・演出・当てた人のあり／なし・当たった項目を除く、を覚える。
  // 既定の 2 つは、初めて開いたときに画面に出るルーレットにもなる。
  // 中身は、利用者が実際に作った画面（2026-10-30「ルーレットのデフォルト値はこれにして」）をそのまま写した。
  const DEFAULT_TEMPLATES = [
    {
      name: '罰ゲーム', useWho: false, removePicked: false,
      items: [['テキーラ２杯', 1], ['テキーラ１杯', 1], ['禁煙１時間', 1], ['禁煙２時間', 1], ['禁煙６時間', 1], ['救済：禁煙－１時間', 1]],
    },
    {
      name: 'プレゼントルーレット', useWho: true, removePicked: false,
      items: [['ステッカー１', 3], ['ステッカー２', 3], ['ステッカー３', 3], ['アクリルスタンド１', 0.5], ['アクリルスタンド２', 0.5], ['キーホルダー１', 2], ['キーホルダー２', 2]],
    },
  ];
  const sanitizeItems = (items) => (Array.isArray(items)
    ? items.filter((it) => it && typeof it === 'object').slice(0, MAX_ITEMS).map((it) => ({ label: String(it.label != null ? it.label : '').slice(0, 40), weight: cleanWeight(it.weight) }))
    : []);
  const cloneItems = (items) => items.map((it) => ({ label: it.label, weight: it.weight }));
  const newTemplate = (src) => ({
    id: newId(),
    name: String(src.name || 'ルーレット').slice(0, 30),
    items: Array.isArray(src.items) && src.items.length && Array.isArray(src.items[0]) ? src.items.map(([label, weight]) => ({ label, weight })) : cloneItems(src.items || []),
    useWho: src.useWho !== false,
    removePicked: src.removePicked === true,
  });
  const defaultTemplates = () => DEFAULT_TEMPLATES.map(newTemplate);
  // テンプレート（なければ空のルーレット）から、新しいルーレットを作る。履歴と名前の欄は空から始める。
  const newWheel = (name, t) => ({
    id: newId(),
    name: String(name || (t && t.name) || 'ルーレット').slice(0, 30),
    items: t ? cloneItems(t.items) : [],
    removePicked: t ? t.removePicked === true : false,
    useWho: t ? t.useWho !== false : true,
    who: '',
    history: [],
  });
  const defaultData = () => {
    const templates = defaultTemplates();
    return { version: 1, wheels: templates.map((t) => newWheel(t.name, t)), templates, settings: { template: DEFAULT_TEMPLATE, discordLink: '', people: [], look: lookFields({}) } };
  };
  // 登録した人: 前後の空白を除き、重複・空・長すぎるものを除く
  function sanitizePeople(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    for (const x of list) {
      const name = String(x == null ? '' : x).trim().slice(0, MAX_WHO);
      if (name && !seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
    }
    return out.slice(0, MAX_PEOPLE);
  }
  function sanitizeTemplate(t) {
    if (!t || typeof t !== 'object') return null;
    return {
      id: typeof t.id === 'string' && t.id ? t.id.slice(0, 40) : newId(),
      name: String(t.name || 'ルーレット').slice(0, 30),
      items: sanitizeItems(t.items),
      useWho: t.useWho !== false,
      removePicked: t.removePicked === true,
    };
  }
  function sanitizeWheel(w) {
    if (!w || typeof w !== 'object') return null;
    const items = sanitizeItems(w.items);
    const history = Array.isArray(w.history)
      ? w.history.filter((x) => x && typeof x.result === 'string' && Number.isFinite(x.at)).slice(0, HISTORY_KEEP)
        .map((x) => ({ at: x.at, result: x.result.slice(0, 40), who: typeof x.who === 'string' ? x.who.slice(0, MAX_WHO) : '' }))
      : [];
    return {
      id: typeof w.id === 'string' && w.id ? w.id.slice(0, 40) : newId(),
      name: String(w.name || 'ルーレット').slice(0, 30),
      items,
      removePicked: w.removePicked === true,
      useWho: w.useWho !== false,                              // 当てた人を記録するか（前の版の保存には無いので、あり）
      who: typeof w.who === 'string' ? w.who.slice(0, MAX_WHO) : '',
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
      // テンプレートが保存に無い（前の版の保存）ときだけ、既定の 2 つを入れる。あるもの（空の一覧も）は、そのまま
      templates: Array.isArray(d.templates) ? d.templates.slice(0, MAX_TEMPLATES).map(sanitizeTemplate).filter(Boolean) : defaultTemplates(),
      settings: {
        template: typeof s.template === 'string' && s.template.trim() ? s.template.slice(0, 200) : DEFAULT_TEMPLATE,
        discordLink: typeof s.discordLink === 'string' ? s.discordLink.slice(0, 300) : '',
        people: sanitizePeople(s.people),
        // 前の版の保存は、色合い・演出をルーレットごとに持っていた。まとめて決める形になったので、最初のルーレットの選びを引き継ぐ（設定に無いときだけ）
        look: lookFields(Object.assign({}, d.wheels[0] && typeof d.wheels[0] === 'object' ? { theme: d.wheels[0].theme, effect: d.wheels[0].effect } : {}, s.look && typeof s.look === 'object' ? s.look : {})),
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
  // 円盤の名前用の折り返し: 文字で折り返すが、空白があればそこで切る（英単語の途中で切れないように）
  function wrapLabel(ctx, text, maxW) {
    const lines = [];
    let line = '';
    const isSpace = (c) => c === ' ' || c === '　';
    for (const ch of Array.from(text)) {
      if (line && ctx.measureText(line + ch).width > maxW) {
        const sp = Math.max(line.lastIndexOf(' '), line.lastIndexOf('　'));
        if (sp > 0 && !isSpace(ch)) {
          lines.push(line.slice(0, sp));
          line = line.slice(sp + 1) + ch;
        } else {
          lines.push(line);
          line = isSpace(ch) ? '' : ch;
        }
      } else {
        line += ch;
      }
    }
    if (line) lines.push(line);
    const out = lines.map((l) => l.trim()).filter(Boolean);
    return out.length ? out : [text];
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
  // 盤の形: 縁の外形。円盤のほか、花（波形）・歯車（ぎざぎざ）。円盤の面は、どの形でも円
  const shapeDepth = (shape, rimW) => (shape === 'flower' ? rimW * 0.36 : shape === 'gear' ? rimW * 0.4 : 0);
  function rimPath(ctx, cx, cy, outerR, rimW, shape) {
    ctx.beginPath();
    const depth = shapeDepth(shape, rimW);
    if (!depth) {
      ctx.arc(cx, cy, outerR, 0, TAU);
      return;
    }
    const n = shape === 'flower' ? 14 : 20;
    const steps = 480;
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * TAU - Math.PI / 2;
      const u = (a + Math.PI / 2) * n;
      const t = shape === 'flower' ? Math.abs(Math.cos(u / 2)) : Math.max(0, Math.min(1, 0.5 + Math.cos(u) * 1.6));
      const r = outerR - depth * (1 - t);
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.closePath();
  }
  // 縁の下地（影・縁の色・面との境目の暗い輪）。縁のデザインで色が変わる
  function paintRimBase(ctx, S, cx, cy, outerR, rimW, R, T, L) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = S * 0.035;
    ctx.shadowOffsetY = S * 0.012;
    ctx.fillStyle = '#000';
    rimPath(ctx, cx, cy, outerR, rimW, L.shape);
    ctx.fill();
    ctx.restore();
    const g = ctx.createLinearGradient(cx - outerR, cy - outerR, cx + outerR, cy + outerR);
    let fill = g;
    if (L.rim === 'neon') {
      g.addColorStop(0, '#15183c');
      g.addColorStop(1, '#07081c');
    } else if (L.rim === 'wafu') {
      g.addColorStop(0, '#dc4533');
      g.addColorStop(1, '#8a170d');
    } else if (L.rim === 'pop') {
      fill = '#fff7ee';
    } else if (L.rim === 'simple') {
      fill = T.rim[1];
    } else {
      g.addColorStop(0, T.rim[0]);
      g.addColorStop(0.3, T.rim[1]);
      g.addColorStop(0.65, T.rim[2]);
      g.addColorStop(1, T.rim[3]);
    }
    rimPath(ctx, cx, cy, outerR, rimW, L.shape);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, R + rimW * 0.14, 0, TAU);
    ctx.fillStyle = L.rim === 'neon' ? 'rgba(0, 0, 0, 0.7)' : L.rim === 'pop' ? 'rgba(120, 60, 90, 0.35)' : 'rgba(70, 40, 0, 0.55)';
    ctx.fill();
  }
  // 縁の飾り（ランプ・ネオン・丸・鋲）。fx.bulb で点滅・色替わり
  function paintRimDeco(ctx, S, cx, cy, outerR, rimW, R, T, L, fx) {
    const rd = (R + outerR - shapeDepth(L.shape, rimW)) / 2;
    const blink = fx.bulb || 0;
    if (L.rim === 'neon') {
      ctx.save();
      ctx.lineWidth = S * 0.009;
      ctx.strokeStyle = T.bulb[1];
      ctx.shadowColor = T.bulb[1];
      ctx.shadowBlur = S * (blink % 2 ? 0.02 : 0.034);
      rimPath(ctx, cx, cy, outerR - rimW * 0.22, rimW, L.shape);   // 盤の形（花・歯車）にそって光らせる
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.lineWidth = S * 0.0035;
      ctx.strokeStyle = T.bulb[0];
      ctx.stroke();
      ctx.restore();
    } else if (L.rim === 'pop') {
      const n = 16;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU - Math.PI / 2;
        const x = cx + Math.cos(a) * rd;
        const y = cy + Math.sin(a) * rd;
        ctx.beginPath();
        ctx.arc(x, y, S * 0.0125, 0, TAU);
        ctx.fillStyle = T.palette[(i + blink) % T.palette.length][0];
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x - S * 0.003, y - S * 0.003, S * 0.004, 0, TAU);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.fill();
      }
    } else if (L.rim === 'wafu') {
      ctx.save();
      ctx.lineWidth = S * 0.0035;
      ctx.strokeStyle = '#f2c14e';
      ctx.beginPath();
      ctx.arc(cx, cy, R + rimW * 0.2, 0, TAU);
      ctx.stroke();
      ctx.restore();
      const n = 24;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU - Math.PI / 2;
        const x = cx + Math.cos(a) * rd;
        const y = cy + Math.sin(a) * rd;
        const sg = ctx.createRadialGradient(x - S * 0.0025, y - S * 0.0025, S * 0.001, x, y, S * 0.0095);
        sg.addColorStop(0, '#fff3b0');
        sg.addColorStop(0.55, '#e8b53a');
        sg.addColorStop(1, '#8d5f12');
        ctx.beginPath();
        ctx.arc(x, y, S * 0.0095, 0, TAU);
        ctx.fillStyle = sg;
        ctx.fill();
      }
    } else if (L.rim === 'simple') {
      ctx.save();
      ctx.lineWidth = S * 0.004;
      ctx.strokeStyle = 'rgba(60, 40, 20, 0.55)';
      rimPath(ctx, cx, cy, outerR, rimW, L.shape);
      ctx.stroke();
      ctx.restore();
    } else {
      const bulbs = 24;   // 金属の縁のランプ（交互に点滅。回している間と当たりの演出では速く）
      for (let i = 0; i < bulbs; i++) {
        const a = (i / bulbs) * TAU - Math.PI / 2;
        const bx = cx + Math.cos(a) * rd;
        const by = cy + Math.sin(a) * rd;
        const on = (i + blink) % 2 === 0;
        ctx.save();
        ctx.beginPath();
        ctx.arc(bx, by, S * 0.0105, 0, TAU);
        if (on) {
          ctx.shadowColor = T.bulb[1];
          ctx.shadowBlur = S * 0.025;
          ctx.fillStyle = T.bulb[0];
        } else {
          ctx.fillStyle = T.bulb[2];
        }
        ctx.fill();
        ctx.restore();
      }
    }
  }
  // 切れ目の模様: 円盤といっしょに回る（円の内側だけに、うすく重ねる）。1 回の描画で全部の切れ目にかける
  function paintPattern(ctx, S, cx, cy, R, rot, pattern) {
    if (pattern === 'plain') return;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    const u = S * 0.045;
    if (pattern === 'stripe') {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.lineWidth = S * 0.016;
      ctx.beginPath();
      for (let k = -R * 2; k < R * 2; k += u) {
        ctx.moveTo(k - R, -R);
        ctx.lineTo(k + R, R);
      }
      ctx.stroke();
    } else if (pattern === 'dots') {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.beginPath();
      let row = 0;
      for (let y = -R; y <= R; y += u, row++) {
        for (let x = -R + (row % 2 ? u / 2 : 0); x <= R; x += u) {
          ctx.moveTo(x + S * 0.009, y);
          ctx.arc(x, y, S * 0.009, 0, TAU);
        }
      }
      ctx.fill();
    } else if (pattern === 'stars') {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.26)';
      let row = 0;
      for (let y = -R; y <= R; y += u * 1.5, row++) {
        for (let x = -R + (row % 2 ? u * 0.75 : 0); x <= R; x += u * 1.5) {
          starPath(ctx, x, y, S * 0.017);
          ctx.fill();
        }
      }
    } else if (pattern === 'checker') {
      const c = S * 0.05;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
      ctx.beginPath();
      for (let iy = Math.floor(-R / c); iy * c < R; iy++) {
        for (let ix = Math.floor(-R / c); ix * c < R; ix++) {
          if ((ix + iy) % 2 === 0) ctx.rect(ix * c, iy * c, c, c);
        }
      }
      ctx.fill();
    }
    ctx.restore();
  }
  // ダーツ盤: 同心の細い輪と、中心の的（緑と赤）
  function paintDartFace(ctx, S, cx, cy, R) {
    ctx.save();
    ctx.lineWidth = S * 0.004;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    for (const f of [0.97, 0.9, 0.64, 0.57]) {
      ctx.beginPath();
      ctx.arc(cx, cy, R * f, 0, TAU);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = S * 0.006;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.27, 0, TAU);
    ctx.fillStyle = 'rgba(20, 130, 70, 0.95)';
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.18, 0, TAU);
    ctx.fillStyle = 'rgba(205, 25, 45, 0.97)';
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  function heartPath(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.moveTo(cx, cy + r * 0.9);
    ctx.bezierCurveTo(cx - r * 1.5, cy + r * 0.1, cx - r * 0.9, cy - r * 1.1, cx, cy - r * 0.35);
    ctx.bezierCurveTo(cx + r * 0.9, cy - r * 1.1, cx + r * 1.5, cy + r * 0.1, cx, cy + r * 0.9);
    ctx.closePath();
  }
  function crownPath(ctx, cx, cy, r) {
    ctx.beginPath();
    [[-1, 0.7], [-1, -0.5], [-0.5, 0.05], [0, -0.8], [0.5, 0.05], [1, -0.5], [1, 0.7]].forEach(([x, y], i) => {
      if (i) ctx.lineTo(cx + x * r, cy + y * r);
      else ctx.moveTo(cx + x * r, cy + y * r);
    });
    ctx.closePath();
  }
  // 中央の飾り: 金の丸の上に、星・ハート・王冠・文字（絵文字）・自分の画像
  function paintHub(ctx, S, cx, cy, L, ff) {
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
    if (L.hub === 'image' && L.hubImg) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, hubR * 0.86, 0, TAU);
      ctx.clip();
      ctx.drawImage(L.hubImg, cx - hubR * 0.86, cy - hubR * 0.86, hubR * 1.72, hubR * 1.72);
      ctx.restore();
    } else if (L.hub === 'emoji' && L.hubText) {
      const len = Array.from(L.hubText).length;
      ctx.save();
      ctx.font = `800 ${hubR * (len > 1 ? 0.95 : 1.25)}px ${ff}, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#c4143c';
      ctx.fillText(L.hubText, cx, cy + hubR * 0.05);
      ctx.restore();
    } else if (L.hub === 'heart') {
      heartPath(ctx, cx, cy + S * 0.002, hubR * 0.5);
      ctx.fillStyle = '#c4143c';
      ctx.fill();
    } else if (L.hub === 'crown') {
      crownPath(ctx, cx, cy, hubR * 0.58);
      ctx.fillStyle = '#c4143c';
      ctx.fill();
    } else {
      starPath(ctx, cx, cy + S * 0.002, hubR * 0.58);
      ctx.fillStyle = '#c4143c';
      ctx.fill();
    }
  }
  // 円盤: 縁・立体的な切れ目・模様・読みやすい文字・当たりの強調・針。fx = { bulb, winner, tilt, theme, look }（theme は色合い、look は絵柄（設定でまとめて決める））
  function drawWheel(ctx, S, rot, items, ff, fx) {
    fx = fx || {};
    const L = Object.assign(lookFields({}), fx.look || {});
    const T = themeOf(L.theme);
    const cx = S / 2;
    const cy = S * 0.52;                 // 針のぶんを上に空ける
    const outerR = S * 0.455;
    const rimW = S * 0.05;
    const R = outerR - rimW;
    ctx.clearRect(0, 0, S, S);

    paintRimBase(ctx, S, cx, cy, outerR, rimW, R, T, L);

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
        const [light, dark] = T.palette[colorIndex(e.index, items.length, T.palette.length)];
        const g = ctx.createRadialGradient(cx, cy, R * 0.12, cx, cy, R);
        g.addColorStop(0, dark);
        g.addColorStop(1, light);
        wedge(ctx, cx, cy, R, a0, a1);
        ctx.fillStyle = g;
        ctx.fill();
      }
      paintPattern(ctx, S, cx, cy, R, rot, L.pattern);
      if (L.shape === 'dart') paintDartFace(ctx, S, cx, cy, R);
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
        const maxW = R * (0.92 - (L.shape === 'dart' ? 0.3 : 0.24));   // ダーツ盤は、中心の的をよけて短く
        // 長い名前は、折り返して何行かに分け、収まる範囲でいちばん大きい文字にする（利用者の指示「ルーレットにもっと文字数表示できる方法ないかな？折り返すとかもう少し小さくするとか」）。
        // 切れ目の幅（中心に近いほど狭い）に行が収まる大きさまで小さくし、それでも入らない最小の大きさのときだけ、行数を絞って最後の行を「…」にする。
        const minSize = S * 0.024;
        const roomFor = (lines, sz) => {
          const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
          return span * Math.max(R * 0.92 - widest, R * 0.25) * 0.94;
        };
        let size = size0;
        let lines;
        for (;;) {
          ctx.font = `800 ${size}px ${ff}`;
          lines = wrapLabel(ctx, label, maxW);
          if (lines.length * size * 1.14 <= roomFor(lines, size) || size <= minSize) break;
          size = Math.max(minSize, size * 0.93);
        }
        const maxLines = Math.max(1, Math.floor(roomFor(lines, size) / (size * 1.14)));
        if (lines.length > maxLines) {
          lines = lines.slice(0, maxLines);
          lines[maxLines - 1] = fitText(ctx, lines[maxLines - 1] + '…', maxW);
        }
        const lh = size * 1.14;
        const tx = leftward ? -R * 0.92 : R * 0.92;
        ctx.lineJoin = 'round';
        ctx.lineWidth = size * 0.24;
        ctx.strokeStyle = 'rgba(25, 10, 45, 0.65)';
        lines.forEach((l, k) => ctx.strokeText(l, tx, (k - (lines.length - 1) / 2) * lh));
        ctx.fillStyle = '#ffffff';
        lines.forEach((l, k) => ctx.fillText(l, tx, (k - (lines.length - 1) / 2) * lh));
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

    paintRimDeco(ctx, S, cx, cy, outerR, rimW, R, T, L, fx);
    paintHub(ctx, S, cx, cy, L, ff);

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
    pg.addColorStop(0, T.pointer[0]);
    pg.addColorStop(0.45, T.pointer[1]);
    pg.addColorStop(1, T.pointer[2]);
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
    drawWheel(wc.getContext('2d'), 620, last.rot, last.items, ff, { bulb: 0, winner: last.winner, tilt: 0, look: last.look });
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
      x.fillText('回す人', 64, 207);
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
  // スマホ（タッチが主で、画像つきの共有が使える端末）では、X・Discord のボタンを出さない（利用者の指示、2026-10-30「スマホの場合XとDiscordは表示しなくていいや」。
  // 「共有」から選べるため）。共有が使えない端末は、スマホでも出す。
  const isPhone = () => canShareFiles() && !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
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

  // X・Discord への投稿（API は使わない。利用者の指示、2026-10-30「PCだと共有ができない場合もあるからやっぱりXとDiscordボタンもつけよう」）。
  // どちらも、画像をコピーしてから、X の投稿画面（デスクトップ版 XBrowserTarget と同じ x.com/intent/post）か、設定したチャンネルのリンクを開く。貼り付けは 1 回要る。
  // 開く処理は、クリックの直後（同じ動きの中）で呼ぶ。そうしないと、ブラウザがポップアップとして止める。
  const isDiscordLink = (s) => /^https:\/\/((canary|ptb)\.)?(discord|discordapp)\.com\//i.test(s);   // Discord の https のリンクだけ開く
  const openTab = (url) => window.open(url, '_blank', 'noopener');
  const xUrl = (text) => 'https://x.com/intent/post?text=' + encodeURIComponent(text);
  // extra は、複数枚のときの補足（1 枚目だけコピーしたことなど）
  function postTo(kind, canvas, text, fileName, setMsg, extra) {
    const copied = copyCanvas(canvas, fileName);
    let opened = true;
    if (kind === 'x') {
      openTab(xUrl(text));
    } else {
      const link = ((data.settings && data.settings.discordLink) || '').trim();
      opened = isDiscordLink(link);
      if (opened) openTab(link);
    }
    copied.then((r) => {
      const more = extra ? ` ${extra}` : '';
      if (r !== 'copied') {
        setMsg(`コピーできなかったので、画像を保存しました。${kind === 'x' ? '投稿画面' : 'Discord'}で添付してください。${more}`);
      } else if (kind === 'x') {
        setMsg(`画像をコピーしました。X の投稿画面で貼り付けてください（PC は Ctrl+V、スマホは長押し）。${more}`);
      } else {
        setMsg(`画像をコピーしました。${opened ? 'Discord のチャンネルで' : 'Discord で'}貼り付けてください。${opened ? '' : '（設定にチャンネルのリンクを入れると、ここから開けます）'}${more}`);
      }
    });
  }

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
    // 当てた人（ルーレットごと。利用者の指示、2026-10-30「当てた人の名前はルーレット毎に設定できるようにして。設定で登録できるようにして、登録した人を選択してすぐ反映できるようにして、
    // もちろん通常入力も可能で」「当てた人はありなしをルーレット毎に設定できるようにしたい」）。「なし」のルーレット（罰ゲームなど）では、この欄を出さない。
    const whoRow = h('div', 'rl-whorow');
    whoRow.hidden = !wheel.useWho;
    // 入力と「登録した人から選ぶ」は1つの欄にまとめた（利用者の指示「当てた人の入力、ドロップダウンと入力まとめられない？」）。
    // ブラウザ標準の候補（datalist）は配色に合わず端末ごとに見た目も操作も違ったので、ライブラリの Tom Select に替えた（利用者の指示「当てた人の名前のやつ、uiがダメだ。
    // なんかいいライブラリとかない？」「有名で安定しているライブラリがいい」）。欄を押すと設定で登録した人が出て、選ぶとすぐ入る。直接入れて確定してもよい（候補に無い名前もそのまま使える）。
    const whoSelect = h('select', 'rl-who-select');
    whoSelect.setAttribute('aria-label', '回す人の名前（登録した人から選べます）');
    whoRow.append(whoSelect);
    const whoPicker = new window.TomSelect(whoSelect, {
      maxItems: 1,
      create: (input) => {
        const name = String(input).trim().slice(0, MAX_WHO);
        return name ? { value: name, text: name } : false;
      },
      createOnBlur: true,        // 入れて確定しないまま「回す」を押しても、その名前で回る
      persist: false,            // 候補に無い名前は、選び直したら候補から消える（候補は設定で登録した人だけ）
      openOnFocus: true,
      closeAfterSelect: true,
      selectOnTab: true,
      maxOptions: MAX_PEOPLE,
      plugins: ['clear_button'],
      placeholder: '回す人の名前（空でも回せます）',
      dropdownParent: 'body',    // カードの外にはみ出して出す（円盤の枠は overflow を隠すため）
      render: {
        option_create: (data, escape) => `<div class="create">「${escape(data.input)}」を回す人にする</div>`,
        no_results: () => '<div class="no-results">登録した人はいません。名前を入れて確定すると使えます</div>',
      },
      onChange: (value) => { wheel.who = String(value || '').slice(0, MAX_WHO); save(); },
    });
    whoPicker.dropdown.classList.add('rl-who-dd');
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
    // X・Discord のボタン（利用者の指示、2026-10-30「PCだと共有ができない場合もあるからやっぱりXとDiscordボタンもつけよう」。API は使わない）。
    // どちらも「画像をコピーしてから、投稿画面（X）・チャンネル（Discord）を開く」。貼り付けは 1 回要る。「共有」は、使える端末だけ。
    const xBtn = h('button', 'rl-btn', 'X に投稿');
    xBtn.type = 'button';
    const discordBtn = h('button', 'rl-btn', 'Discord');
    discordBtn.type = 'button';
    const shareBtn = h('button', 'rl-btn', '共有');
    shareBtn.type = 'button';
    shareBtn.hidden = !canShareFiles();
    xBtn.hidden = discordBtn.hidden = isPhone();
    share.append(copyBtn, xBtn, discordBtn, shareBtn);
    const status = h('p', 'rl-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const preview = h('img', 'rl-preview');
    preview.hidden = true;
    const fx = h('canvas', 'rl-fx');
    fx.setAttribute('aria-hidden', 'true');
    stage.append(box, result, whoRow, actions, share, status, preview, fx);

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
    itemsBox.append(ul, addRow, bulkBox);
    // このルーレットの設定（ルーレットごとに選べる。利用者の指示、2026-10-30「ルーレットの種類みたいなのを設定毎に選べるようにしよう」）:
    // 色合い・演出・当てた人を記録するか・テンプレートに保存
    const lookBox = h('details', 'rl-more');
    lookBox.append(h('summary', null, '設定'));
    const useWhoRow = h('div', 'rl-options');
    const useWhoLabel = h('label');
    const useWhoCheck = h('input');
    useWhoCheck.type = 'checkbox';
    useWhoCheck.checked = wheel.useWho;
    useWhoLabel.append(useWhoCheck, document.createTextNode(' 回す人を記録する'));
    useWhoRow.append(useWhoLabel);
    const useWhoNote = h('p', 'rl-note', 'なしにすると、名前の欄・履歴の「回す人」・まとめに出しません（罰ゲームなど）。');
    const saveTplRow = h('div', 'rl-row');
    const saveTplBtn = h('button', 'rl-btn', 'このルーレットをテンプレートに保存');
    saveTplBtn.type = 'button';
    saveTplRow.append(saveTplBtn);
    const saveTplNote = h('p', 'rl-note', '保存すると、「＋ ルーレットを追加」で、このルーレットの項目・重み・回す人の設定から作れます。');
    // 「当たった項目を一覧から除く」も、ここに入れた（利用者の指示「当たった項目…は設定の中に入れちゃって」）
    lookBox.append(useWhoRow, useWhoNote, opts, saveTplRow, saveTplNote);
    // 履歴（全部表示）
    const histBox = h('details', 'rl-more');
    histBox.open = true;
    const histSum = h('summary');
    histBox.append(histSum);
    const histWrap = h('div', 'rl-histwrap');
    const histTable = h('table', 'rl-hist');
    const thead = h('thead');
    const hr = h('tr');
    for (const t of ['日時', '回す人', '結果']) hr.append(h('th', t === '回す人' ? 'col-who' : null, t));
    thead.append(hr);
    const tbody = h('tbody');
    histTable.append(thead, tbody);
    histWrap.append(histTable);
    const histEmpty = h('p', 'rl-note', 'まだありません');
    const histClear = h('button', 'rl-btn', '履歴を消す');
    histClear.type = 'button';
    histBox.append(histWrap, histEmpty, histClear);
    edit.append(itemsBox, lookBox, histBox);
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
      drawWheel(canvas.getContext('2d'), S, v.rot, displayItems(), fontFamily(), { bulb: v.bulb, winner: v.winnerIdx, tilt: v.tilt, look: currentLook() });
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
      const pal = themeOf(data.settings.look.theme).palette;
      for (let i = 0; i < 170; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.15;
        const sp = unit * (0.7 + Math.random() * 1.1);
        v.confetti.push({
          x: ox, y: oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 14,
          w: 6 + Math.random() * 7, h: 10 + Math.random() * 9,
          color: pal[Math.floor(Math.random() * pal.length)][0],
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
      const eff = effectOf(data.settings.look.effect);   // 演出（回す時間・回転数）は設定でまとめて決める
      v.anim = {
        from,
        to: targetRotation(from, entry, randomUnit, eff.turns),
        t0: performance.now(),
        dur: reduced ? SPIN_MS_REDUCED : eff.spinMs,
        idx,
        label: wheel.items[idx].label,
        who: wheel.useWho ? (wheel.who || '').trim().slice(0, MAX_WHO) : '',   // 回し始めの名前の欄の中身（回している間に直しても、この回は変わらない）。なしのルーレットは空
        snapshot: wheel.items.map((it) => ({ label: it.label, weight: it.weight })),
      };
      setSpinning(true);
      countEvent('roulette-spin', 'ルーレットを回した');
    }
    function finish(a, now) {
      const text = a.label.trim();
      v.last = { name: wheel.name, items: a.snapshot, rot: v.rot, text, winner: a.idx, who: a.who, look: currentLook(), at: Date.now() };
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
      const eff = effectOf(data.settings.look.effect);
      if (!reduced) {
        if (eff.pop) {
          void result.offsetWidth;
          result.classList.add('pop');
        }
        if (eff.confetti) spawnConfetti();
        if (eff.confetti || eff.blink) v.celebrateUntil = now + 1800;   // ランプの速い点滅（と紙吹雪）の間
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
      const blink = !reduced && effectOf(data.settings.look.effect).blink;   // 演出が「控えめ」・動きを減らす設定のときは、ランプを点滅させない
      if (!v.anim && !celebrating) {
        if (v.tilt !== 0) { v.tilt = 0; redraw(); }
        if (!blink || now - v.lastIdle < 500) return;
        v.lastIdle = now;
        v.bulb = (v.bulb + 1) % 2;
        redraw();
        return;
      }
      v.bulb = blink ? Math.floor(now / (spinning ? 70 : 150)) % 2 : 0;
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
    xBtn.addEventListener('click', () => {
      if (!v.last) return;
      countEvent('roulette-x', 'X に投稿のボタンを押した');
      const c = makeCard(v.last);
      showPreview(c);
      postTo('x', c, textFor(v.last), 'iridock-roulette.png', setStatus);
    });
    discordBtn.addEventListener('click', () => {
      if (!v.last) return;
      countEvent('roulette-discord', 'Discord のボタンを押した');
      const c = makeCard(v.last);
      showPreview(c);
      postTo('discord', c, textFor(v.last), 'iridock-roulette.png', setStatus);
    });

    // 見た目と演出の選択

    // 当てた人: 候補（設定で登録した人）の一覧を作り直す。選んでいる名前は、候補に無くても残す。
    // 選び直しの通知（onChange）は出さない（保存の中身は wheel.who がもとで、ここで変えない）
    function refreshPeople() {
      whoPicker.clear(true);
      whoPicker.clearOptions();
      for (const p of data.settings.people) whoPicker.addOption({ value: p, text: p });
      if (wheel.who) {
        if (!whoPicker.options[wheel.who]) whoPicker.addOption({ value: wheel.who, text: wheel.who });
        whoPicker.setValue(wheel.who, true);
      }
      whoPicker.refreshOptions(false);
    }
    v.refreshPeople = refreshPeople;
    // 当てた人を記録するか（ルーレットごと）。なしにすると、名前の欄・履歴の「当てた人」の列・まとめから外れる
    useWhoCheck.addEventListener('change', () => {
      wheel.useWho = useWhoCheck.checked;
      whoRow.hidden = !wheel.useWho;
      save();
      renderHistory();
      renderScope();
      renderSummary();
    });
    // テンプレートに保存（同じ名前のテンプレートがあれば、上書きする）
    saveTplBtn.addEventListener('click', () => {
      const r = saveTemplate(wheel);
      saveTplNote.textContent = r === 'full'
        ? `テンプレートは ${MAX_TEMPLATES} 個までです。設定で、使わないものを消してください。`
        : r === 'updated' ? `テンプレート「${wheel.name}」を上書きしました。` : `テンプレート「${wheel.name}」として保存しました。「＋ ルーレットを追加」で選べます。`;
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
        dot.style.background = sliceColor(i, wheel.items.length, themeOf(data.settings.look.theme));
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
      histTable.classList.toggle('rl-nowho', !wheel.useWho);   // 当てた人を記録しないルーレットは、「当てた人」の列を出さない
      histSum.textContent = `履歴（${wheel.history.length} 件。保存は ${HISTORY_KEEP} 件まで）`;
      histWrap.hidden = wheel.history.length === 0;
      histEmpty.hidden = wheel.history.length > 0;
      histClear.disabled = wheel.history.length === 0;
      wheel.history.forEach((entry, i) => {
        const tr = document.createElement('tr');
        const t = h('td', 'at', stampOf(entry.at));
        const who = h('td', 'col-who');
        const input = h('input');
        input.type = 'text';
        input.maxLength = MAX_WHO;
        input.value = entry.who || '';
        input.placeholder = '名前なし';
        input.setAttribute('aria-label', `履歴 ${i + 1} の回す人`);
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

    v.destroy = () => { if (v.ro) v.ro.disconnect(); whoPicker.destroy(); };
    v.setWho = (name) => {   // 確かめの道具から呼ぶ（候補に無い名前も入れられる。選んだのと同じ動き）
      if (name && !whoPicker.options[name]) whoPicker.addOption({ value: name, text: name });
      if (name) whoPicker.setValue(name); else whoPicker.clear();
    };
    el.setAttribute('aria-label', wheel.name || 'ルーレット');
    v.renderItems = renderItems;   // 色合いを変えたとき、項目の色の点を描き直す
    refreshPeople();
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
      const w = newWheel('ルーレット');
      data.wheels.push(w);
      addWheel(w);
    }
    save();
    renderScope();
    renderSummary();
  }
  // 同じ名前がすでにあれば、「名前 2」「名前 3」…にする（まとめの表で見分けがつくように）
  function uniqueName(base) {
    const taken = new Set(data.wheels.map((w) => w.name));
    if (!taken.has(base)) return base;
    for (let k = 2; k < 1000; k++) {
      const name = `${base.slice(0, 30 - String(k).length - 1)} ${k}`;
      if (!taken.has(name)) return name;
    }
    return base;
  }

  // ---- テンプレート（ルーレットの設定を覚えておき、新しいルーレットを作るときに使う） ----
  // 同じ名前のテンプレートがあれば上書きする。'added'・'updated'・'full'（上限）を返す。
  function saveTemplate(wheel) {
    const name = (wheel.name || '').trim().slice(0, 30) || 'ルーレット';
    const src = { name, items: cloneItems(wheel.items), useWho: wheel.useWho !== false, removePicked: wheel.removePicked === true };
    const i = data.templates.findIndex((t) => t.name === name);
    let result;
    if (i >= 0) {
      data.templates[i] = Object.assign({ id: data.templates[i].id }, src);
      result = 'updated';
    } else {
      if (data.templates.length >= MAX_TEMPLATES) return 'full';
      data.templates.push(Object.assign({ id: newId() }, src));
      result = 'added';
    }
    save();
    renderTemplates();
    return result;
  }
  function renderTemplates() {
    // 上の「新しいルーレットのもと」の選択肢
    const sel = $('new-template');
    const keep = sel.value;
    sel.replaceChildren();
    const blank = h('option', null, '空のルーレット');
    blank.value = '';
    sel.append(blank);
    for (const t of data.templates) {
      const o = h('option', null, t.name);
      o.value = t.id;
      sel.append(o);
    }
    sel.value = data.templates.some((t) => t.id === keep) ? keep : '';
    // 設定の一覧
    const list = $('templates-list');
    list.replaceChildren();
    $('templates-note').textContent = data.templates.length ? '' : 'テンプレートはありません。ルーレットの「設定」から保存できます。';
    for (const t of data.templates) {
      const li = h('li', 'rl-tpl');
      li.append(h('span', 'rl-tpl-name', t.name));
      li.append(h('span', 'rl-tpl-meta', `項目 ${t.items.length} 個・回す人${t.useWho ? 'あり' : 'なし'}`));
      const del = h('button', 'rl-btn rl-btn-small', '消す');
      del.type = 'button';
      del.setAttribute('aria-label', `テンプレート「${t.name}」を消す`);
      del.addEventListener('click', () => {
        if (!window.confirm(`テンプレート「${t.name}」を消します（すでに作ったルーレットは消えません）。よろしいですか？`)) return;
        data.templates = data.templates.filter((x) => x !== t);
        save();
        renderTemplates();
      });
      li.append(del);
      list.append(li);
    }
  }

  // ---- 当てた人の登録（設定。ルーレットごとの「登録した人から選ぶ」に出る） ----
  function renderPeople() {
    const list = $('people-list');
    list.replaceChildren();
    for (const p of data.settings.people) {
      const li = h('li', 'rl-chip');
      li.append(h('span', null, p));
      const del = h('button', 'rl-chip-x', '×');
      del.type = 'button';
      del.setAttribute('aria-label', `${p} を消す`);
      del.addEventListener('click', () => {
        data.settings.people = data.settings.people.filter((x) => x !== p);
        save();
        renderPeople();
      });
      li.append(del);
      list.append(li);
    }
    $('people-note').textContent = data.settings.people.length ? `${data.settings.people.length} 人` : '登録した人はいません。';
    for (const v of views) v.refreshPeople();
  }
  function addPeople() {
    const box = $('people-input');
    // 改行・「、」「,」で区切って、まとめて登録できる
    const names = sanitizePeople(box.value.split(/[\n\r,、，]/));
    if (names.length === 0) return;
    const merged = sanitizePeople([...data.settings.people, ...names]);
    box.value = '';
    data.settings.people = merged;
    save();
    renderPeople();
    if (merged.length >= MAX_PEOPLE) $('people-note').textContent = `${merged.length} 人（上限 ${MAX_PEOPLE} 人です）`;
  }
  $('people-add').addEventListener('click', addPeople);
  $('people-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing && (e.ctrlKey || e.metaKey || !e.shiftKey)) {   // 変換の確定の Enter は除く。Shift+Enter は改行
      e.preventDefault();
      addPeople();
    }
  });

  $('wheel-add').addEventListener('click', () => {
    if (data.wheels.length >= MAX_WHEELS) {
      $('add-note').textContent = `ルーレットは ${MAX_WHEELS} 個までです。`;
      return;
    }
    $('add-note').textContent = '';
    // 選んだテンプレートの設定（項目と重み・色合い・演出・当てた人のあり／なし）で作る。「空のルーレット」なら何も入れない
    const t = data.templates.find((x) => x.id === $('new-template').value);
    const w = newWheel(uniqueName(t ? t.name : 'ルーレット'), t);
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
    for (const w of whoWheels()) {
      const o = h('option', null, w.name || 'ルーレット');
      o.value = w.id;
      sel.append(o);
    }
    sel.value = whoWheels().some((w) => w.id === keep) ? keep : 'all';
  }
  // まとめの対象にできるのは、「当てた人を記録する」ルーレットだけ
  const whoWheels = () => data.wheels.filter((w) => w.useWho !== false);
  const summaryScope = () => $('summary-scope').value || 'all';
  const summaryTitle = () => {
    const s = summaryScope();
    const w = data.wheels.find((x) => x.id === s);
    return w ? `${w.name} の結果` : '誰が何を当てたか';
  };
  const showWheelNames = () => summaryScope() === 'all' && whoWheels().length > 1;
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
    for (const id of ['summary-copy', 'summary-x', 'summary-discord', 'summary-share']) $(id).disabled = s.groups.length === 0;
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
  // X・Discord: 1 枚目の画像をコピーして開く（複数枚のときは、ほかの枚を下のボタンでコピーして続けて貼り付けてもらう）
  function postSummary(kind) {
    countEvent(kind === 'x' ? 'roulette-summary-x' : 'roulette-summary-discord', kind === 'x' ? 'まとめを X に投稿のボタンを押した' : 'まとめの Discord のボタンを押した');
    const { pages, summary } = buildSummaryPages();
    const extra = pages.length > 1 ? `（全 ${pages.length} 枚のうち 1 枚目をコピーしました。ほかの枚は、下の「N 枚目をコピー」で順にコピーして、続けて貼り付けてください）` : '';
    postTo(kind, pages[0], `${summaryTitle()}（${summary.groups.length} 人・${summary.entries} 件）`, 'iridock-roulette-summary.png', (t) => { $('summary-status').textContent = t; }, extra);
  }
  $('summary-x').addEventListener('click', () => postSummary('x'));
  $('summary-discord').addEventListener('click', () => postSummary('discord'));
  $('summary-share').addEventListener('click', async () => {
    countEvent('roulette-summary-share', 'まとめの画像を共有した');
    const { pages, summary } = buildSummaryPages();
    await shareImages(pages, 'iridock-roulette-summary', `${summaryTitle()}（${summary.groups.length} 人・${summary.entries} 件）`, (t) => { $('summary-status').textContent = t; });
  });
  if (canShareFiles()) $('summary-share').hidden = false;
  if (isPhone()) $('summary-x').hidden = $('summary-discord').hidden = true;

  // ---- 絵柄（設定でまとめて決める。全部のルーレットに反映） ----
  const hubImages = new Map();
  // 中央の画像は、読み込めてから描く（読み込み中は星などの代わりに何も重ねず、読めたら全部のルーレットを描き直す）
  function hubImageFor(url) {
    if (!url) return null;
    let e = hubImages.get(url);
    if (!e) {
      e = { img: new Image(), ok: false };
      e.img.onload = () => { e.ok = true; redrawAll(); };
      e.img.src = url;
      hubImages.set(url, e);
    }
    return e.ok ? e.img : null;
  }
  function currentLook() {
    const l = data.settings.look;
    return Object.assign({}, l, { hubImg: l.hub === 'image' ? hubImageFor(l.hubImage) : null });
  }
  function redrawAll() {
    for (const v of views) v.redraw();
    renderLookPreview();
  }
  const previewItems = ['あたり', 'はずれ', 'ラッキー', 'おめでとう', 'もう一回', 'スペシャル'].map((label) => ({ label, weight: 1 }));
  function renderLookPreview() {
    const c = $('look-preview');
    drawWheel(c.getContext('2d'), c.width, 0.35, previewItems, fontFamily(), { bulb: 0, winner: null, tilt: 0, look: currentLook() });
  }
  function syncLookUi() {
    const l = data.settings.look;
    $('look-effect-note').textContent = effectOf(l.effect).desc;
    for (const [key, id] of [['theme', 'look-theme'], ['effect', 'look-effect'], ['pattern', 'look-pattern'], ['rim', 'look-rim'], ['shape', 'look-shape'], ['hub', 'look-hub']]) $(id).value = l[key];
    $('look-hub-text').value = l.hubText;
    $('look-hub-text-row').hidden = l.hub !== 'emoji';
    $('look-hub-image-row').hidden = l.hub !== 'image';
    $('look-hub-clear').disabled = !l.hubImage;
    if (!$('look-hub-note').dataset.keep) $('look-hub-note').textContent = l.hubImage ? '画像を置いています。' : '画像はまだありません。';
  }
  // 画像を小さく（中央の丸に入れる大きさ）縮めて、文字（data URL）にする。ブラウザの外には出さない
  function readHubImage(file) {
    return new Promise((resolve) => {
      if (!file || !String(file.type).startsWith('image/')) { resolve(''); return; }
      const fr = new FileReader();
      fr.onerror = () => resolve('');
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => resolve('');
        img.onload = () => {
          try {
            const side = Math.min(img.naturalWidth, img.naturalHeight);
            if (!side) { resolve(''); return; }
            for (const size of [128, 96, 64]) {
              const cv = document.createElement('canvas');
              cv.width = size;
              cv.height = size;
              cv.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
              const url = cv.toDataURL('image/png');
              if (url.length <= MAX_HUB_IMAGE) { resolve(url); return; }
            }
          } catch (e) { /* 画像を読めない（画像として扱えない）ときは、空にする */ }
          resolve('');
        };
        img.src = String(fr.result);
      };
      fr.readAsDataURL(file);
    });
  }
  async function setHubImage(file) {
    const note = $('look-hub-note');
    const url = await readHubImage(file);
    note.dataset.keep = '1';
    if (!url) {
      note.textContent = '画像を読み込めませんでした（画像のファイルを選んでください）。';
      return false;
    }
    data.settings.look.hubImage = url;
    data.settings.look.hub = 'image';
    save();
    note.textContent = '画像を置きました。';
    delete note.dataset.keep;
    syncLookUi();
    redrawAll();
    return true;
  }
  function setupLook() {
    const defs = [['theme', 'look-theme', THEMES, DEFAULT_THEME], ['effect', 'look-effect', EFFECTS, DEFAULT_EFFECT], ['pattern', 'look-pattern', PATTERNS, 'plain'], ['rim', 'look-rim', RIMS, 'lamp'], ['shape', 'look-shape', SHAPES, 'disc'], ['hub', 'look-hub', HUBS, 'star']];
    for (const [key, id, map, fallback] of defs) {
      const sel = $(id);
      for (const [k, def] of Object.entries(map)) {
        const o = h('option', null, def.name);
        o.value = k;
        sel.append(o);
      }
      sel.addEventListener('change', () => {
        data.settings.look[key] = pickKey(map, sel.value, fallback);
        save();
        syncLookUi();
        if (key === 'theme') for (const v of views) v.renderItems();   // 項目の色の点も、色合いに合わせる
        redrawAll();
      });
    }
    $('look-hub-text').addEventListener('input', (e) => {
      data.settings.look.hubText = cleanHubText(e.target.value);
      save();
      redrawAll();
    });
    $('look-hub-image').addEventListener('click', () => $('look-hub-file').click());
    $('look-hub-file').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) setHubImage(f);
    });
    $('look-hub-clear').addEventListener('click', () => {
      data.settings.look.hubImage = '';
      save();
      syncLookUi();
      redrawAll();
    });
  }

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
    $('template').value = data.settings.template;
    $('discord-link').value = data.settings.discordLink;
    renderTemplates();
    renderPeople();
    syncLookUi();
    for (const w of data.wheels) addWheel(w);
    renderScope();
    renderSummary();
    renderLookPreview();
  }
  $('template').addEventListener('input', (e) => { data.settings.template = e.target.value.slice(0, 200) || DEFAULT_TEMPLATE; save(); });
  $('discord-link').addEventListener('input', (e) => { data.settings.discordLink = e.target.value.slice(0, 300); save(); });
  $('export').addEventListener('click', exportData);
  $('import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) importFile(f);
  });

  // 確かめの道具から呼ぶ（画面の見た目に関わらない部分と、状態の読み出し）
  window.IriRoulette = {
    pickIndex, wrapLabel, layoutOf, indexAtPointer, targetRotation, randomUnit, cleanWeight, sanitizeData, sliceColor, pointerTilt, summarize, summaryLines,
    themes: Object.keys(THEMES), effects: Object.keys(EFFECTS), themeOf,
    state: () => ({
      data,
      phone: isPhone(),
      views: views.map((v) => ({ id: v.w.id, rot: v.rot, spinning: !!v.anim, last: v.last, winner: v.winnerIdx, confetti: v.confetti.length, tilt: v.tilt })),
    }),
    setWho: (i, name) => views[i].setWho(name),
    setHubImage, lookFields, currentLook,
    makeCard: (i) => {
      const v = views[i || 0];
      return makeCard(v.last || { name: v.w.name, items: v.w.items, rot: v.rot, text: '見本', winner: null, who: '', look: currentLook(), at: Date.now() });
    },
    makeSummaryPages: () => makeSummaryPages(summarize(data.wheels, summaryScope()), summaryTitle(), showWheelNames()),
  };

  setupLook();
  rebuild();
  requestAnimationFrame(frame);
  // 書体（Noto Sans JP・Inter）は、使うまで読み込まれない。読み込めたら円盤を描き直す。
  if (document.fonts && document.fonts.load) {
    Promise.all(['800 20px "Noto Sans JP"', '700 20px "Noto Sans JP"', '700 20px Inter'].map((f) => document.fonts.load(f, 'あA'))).then(() => redrawAll()).catch(() => {});
  }
})();
