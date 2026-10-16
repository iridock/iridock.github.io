// 配色を、本文を描く前に当てる（利用者の指示、2026-10-16「色の設定…色は和のイメージの色でお願い」）。
// app.js は本文の後ろで読むので、そこで当てると、一瞬いつもの配色（藍）が見えてから切り替わる。
// サイトの決まり（CSP）でページの中に書いたスクリプトは動かないので、別のファイルにして head で読む。
// 配色そのもの（色の値）は style.css の [data-theme="…"] にある。ここに置くのは、ブラウザの上の帯の色（theme-color）と明るさだけ。
(function () {
  // bar は各配色の地の色（tools/make-site-themes.py の bg と同じ）。配色を足したら、ここと app.js の THEMES にも足す。
  var themes = {
    ai: { bar: '#165e83', scheme: 'dark' },
    sumi: { bar: '#595857', scheme: 'dark' },
    akane: { bar: '#b7282e', scheme: 'light' },
    sakura: { bar: '#55295b', scheme: 'dark' },
    fuji: { bar: '#a59aca', scheme: 'light' },
    matcha: { bar: '#c5c56a', scheme: 'light' },
    washi: { bar: '#fbfaf5', scheme: 'light' },
    sakurairo: { bar: '#eebbcb', scheme: 'light' },
    seiji: { bar: '#7ebea5', scheme: 'light' },
  };
  function apply(id) {
    if (!themes[id]) id = 'ai';
    document.documentElement.setAttribute('data-theme', id);
    var bar = document.querySelector('meta[name="theme-color"]');
    if (bar) bar.setAttribute('content', themes[id].bar);
    var scheme = document.querySelector('meta[name="color-scheme"]');
    if (scheme) scheme.setAttribute('content', themes[id].scheme);
    return id;
  }
  var saved = null;
  try { saved = localStorage.getItem('theme'); } catch (e) { /* 保存できないブラウザでも、いつもの配色で動く */ }
  apply(saved);
  window.iridockTheme = { ids: Object.keys(themes), apply: apply };
})();
