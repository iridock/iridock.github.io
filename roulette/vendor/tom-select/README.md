# Tom Select 2.6.2

当てた人の名前の欄（候補つきの入力）に使っている部品です。

- 出どころ: https://github.com/orchidjs/tom-select （npm の `tom-select@2.6.2`。`dist/js/tom-select.complete.min.js` と `dist/css/tom-select.css` を、そのまま置いています）
- 許諾: Apache License 2.0（`LICENSE`）
- 同梱している理由: このサイトは外の配信元から部品を読み込まない決まり（閲覧者の情報が外の会社へ行かないように）のため
- 見た目の上書きは `../../roulette.css` にあります（この中のファイルは書き換えません）
- 版を上げるときは、`tom-select@<版>` から同じ2つのファイルを取り直し、`python tools/check-roulette.py` を通します
