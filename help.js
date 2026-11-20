// ヘルプ（見出しの横の ? ボタン）の開け閉め。ボーダー予想・イベント予想・ルーレットの 3 ページで使う（2026-11-20、利用者の言葉
// 「全体的に説明みたいなのは各セクションにヘルプボタンみたいなのつくってそこおしたら表示されるようにしようか。やたら長くなって画面がうるさくなってる」）。
// 利用者が選んだ形: 押すと見出しのすぐ下に開き、もう一度押すと閉じる。見出しの下の短い一行は、操作・読み方の説明だけヘルプに移し、
// 「直近1年」のような何が出ているかの札は見出しに残す。
// 作り: <button class="help-btn" aria-controls="ヘルプの箱の id" aria-expanded="false"> と <div class="help" id="…" hidden>。
// スクリプトが後から作るボタン（ルーレットのカード）にも効くよう、ページ全体で受け止める。開け閉めはブラウザに覚えない（はじめは毎回閉じている）。
(() => {
  'use strict';

  document.addEventListener('click', (ev) => {
    const button = ev.target.closest && ev.target.closest('.help-btn');
    if (!button) return;
    // <summary> の中に置いたボタン（ルーレットの「項目と重み」など）は、押しても折りたたみを開け閉めしない
    ev.preventDefault();
    ev.stopPropagation();
    const box = document.getElementById(button.getAttribute('aria-controls') || '');
    if (!box) return;
    const open = box.hidden;
    box.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    // 閉じている折りたたみの中のヘルプを開くときは、折りたたみも開く（開かないと見えない）
    const details = box.closest('details');
    if (open && details && !details.open) details.open = true;
  }, true);
})();
