# Kamishibai

ブラウザで開いて発表するスライドの仕組みです。GitHub の TonanKamata と ShiotaTakumi が共同で開発しました。
見た目は Beamer のテーマに倣い、既定のテーマ Boadilla は Beamer の Boadilla と同じ見た目（16:9、11pt 相当、Beamer の青と橙、Latin Modern Sans と原ノ味角ゴシック）です。
PDF ではできない次のことに使います。

- 図の中の要素を段階的に出す（辺を一本ずつ足す、カードを一枚ずつ置く）
- 二つの図をボタンで切り替える（Yes の例と No の例）
- 図の中で動かす（SVG の SMIL アニメーション、JavaScript で描く図）
- 一つの HTML ファイルとして配る（書体と数式を中に入れるので、ネットにつながらなくても同じ表示になる）

スライドは、タグで書いた HTML の原稿をブラウザで直接開くと、その場で組まれます。原稿を組むこの仕組みを、この文書ではエンジン（`engine/`）と呼びます。
新しく作るスライドは、このエンジンの原稿で書きます（下の「原稿を書いて配る」）。
ビルドなしで見られ、配るときは `make pack` で一つのファイル（配布用ファイル）にまとめます。
テーマはほかに Madrid（4:3、Beamer の Madrid に倣った見た目）があります。原稿の書き方は [engine/README.md](engine/README.md) にあります。
定義・定理・証明を見せるスライドの書き方の規則は [docs/math-slides.md](docs/math-slides.md) にあります。AI にスライドを書かせるときや見直させるときにも、この文書を基本の規則として渡します。
エンジンより前の、`html/slide.src.html` をビルドして `slide.html` を作る形もあります。この形で作った資料を直す人のために、最後の節で説明します。

## 準備

この repository を clone するか、発表の directory へコピーします。必要なものは Python 3.10 以上、Node.js 20 以上、make です。

```bash
make deps fonts engine-fonts
```

これで次のものができます。

- Python の venv（`.venv/`、fontTools）と Node のパッケージ（`tools/node_modules/`、KaTeX・BudouX・Playwright）
- Boadilla の書体（`fonts/`、`tools/fetch_fonts.py` が版を固定して取得し、SHA-256 で照合する）
- 原稿が読む書体の CSS（`engine/fonts/kamishibai-fonts.css`）

入力はすべて版が固定されているので、同じ原稿からはどの機械でも同じ配布用ファイルができます。
`python3 -m venv` が使えない Python では、`make PY=/path/to/python3` で別の Python を指定します。
配布用ファイルの組版を検査する `make check-pack`（下の表）が使うブラウザは、初回に自動で取得します（`make browsers`）。Linux で初めて検査するときは、ブラウザの依存ライブラリを
`tools/node_modules/.bin/playwright install --with-deps chromium webkit` で入れます。

## 原稿を書いて配る

[engine/sample.html](engine/sample.html) をコピーして原稿を書き始めます（例：`talk/talk.html`。原稿の中の
`<script src="…/engine/kamishibai.js">` は、原稿から `engine/` への相対パスにします）。

| コマンド | 内容 |
|---|---|
| `make preview SRC=talk/talk.html` | 原稿をそのまま、スライド用のブラウザ（既定は Google Chrome）で開く。そのファイルのタブが既に開いていれば、新しいタブを開かずに再読み込みする。別のブラウザは `SLIDE_BROWSER="Brave Browser"`（make の変数でも環境変数でもよい） |
| `make pack SRC=talk/talk.html [THEME=Madrid]` | 配布用ファイル `talk/talk.dist.html`（git で追跡しない）を作る。数式を組み、書体・画像・エンジンを中に入れた一つのファイルになる。先に原稿の規則（[engine/README.md](engine/README.md) の「規則」）を検査し、反する原稿からは作らず、前に作った `.dist.html` を消す。原稿のフォルダと `engine/` の外のファイルは `ALLOW=フォルダ` で許したときだけ入れる |
| `make check-pack SRC=talk/talk.html [THEME=Madrid]` | 配布用ファイルを作り、行の切れ方のブラウザ間の一致とはみ出しを検査する（下の「改行と書体」と、[engine/README.md](engine/README.md) の「組版の検査」） |
| `make order SRC=talk/talk.html [GAP=3 SHORT=2]` | 定理・補題・定義の読む順の警告（下の「読む順の検査」） |
| `make lang SRC=talk/talk.html` | 日本語と英語の対の検査（[engine/README.md](engine/README.md) の「日本語と英語」） |
| `make shot SRC=talk/talk.html PAGES="4 12"` | 指定したページを 1280×720 の PNG（`shots/p4.png` など、git で追跡しない。置き場は `SHOTS=` で変える）に撮る |
| `make clean SRC=talk/talk.html` | その原稿の `.dist.html`（と、最後の節のビルドする形の `slide.html`）を消す |

`make lang`・`make order` と、英語の記録を書く `make lang-stamp`（[engine/README.md](engine/README.md) の「日本語と英語」）は Python だけで動き、`make deps` は要りません。
直すのは原稿で、`.dist.html` は手で直さず作り直します。

## カスタマイズの例

見た目と動きを自分の発表に合わせて変えたスライドの例です。どちらも塩田さんの発表で、公開されたページをブラウザでそのまま開けます。

| スライド | 発表 | 主な見どころ |
|---|---|---|
| [どの辺展開も重なりを持つ多面体の最小頂点数と最小面数](https://shiotatakumi.github.io/MyPage/contents/261114-Ununfoldable-JOSME-41/) | 第 41 回折り紙の科学・数学・教育研究集会（2026 年 11 月） | 多面体とその辺展開図を JavaScript で描く |
| [任意の高さをもつ正角柱の辺展開図における重なりの完全分類](https://shiotatakumi.github.io/MyPage/contents/261112-AL210/) | 第 210 回アルゴリズム研究会（2026 年 11 月） | 角柱・展開図・グラフを描き、スライダーとボタンで動かす |

二つとも、この repository のエンジンではなく、塩田さんが兵庫県立大学の見た目に作った別のエンジン（`uoh-slide.js`）で動きます。
原稿を `slide`・`list`・`block`・`figure` などのタグで書く点は同じで、次の変え方はこの repository の原稿でも参考になります。

- 見た目を所属や発表に合わせる（帯、見出し、箇条書きの印、箱の色、書体）
- そのスライドだけの位置の調整を CSS のファイルに、動きの調整（数式を含む文のコピー、スマートフォンのページ送り）を JavaScript のファイルに分け、エンジンには手を入れない
- 図を描くコードを図ごとのファイルに分け、`FIG["id"]` に登録する（この repository のエンジンでも同じ書き方ができる）

## 改行と書体

文字の大きさは Beamer の 11pt（1pt = 2.822 px）に合わせてあります。
エンジンは改行をブラウザの通常の規則に任せるので、ブラウザによって行の切れ方が変わり得ます。
そこで `make check-pack` が、複数のブラウザで組んだ行の切れ方を照合します。
ブラウザごとに挙動が違う機能（`text-wrap:pretty`、約物の詰め、和欧間の自動スペース）は使いません。

検査で比べるブラウザは `ENGINES=chromium,webkit,firefox,safari` から選べ、既定は Chromium と WebKit です。
どちらも Playwright が固定した版なので、どの機械でも同じ結果になります。
ただし Playwright の WebKit は新しい WebKit で、ある Mac の Safari と同じ版とは限りません。実際、WebKit 26.6 は Safari 26.2 と違い、
`word-break:keep-all` の下で開き括弧（`（`、`(`）の直後で改行することがあります。手元の Safari と合わせたいときは `ENGINES=chromium,safari` も確かめます。
`safari` はその Mac の Safari と同じシステムの WebKit で、macOS 専用です（Xcode の command-line tools の `swiftc` が要ります。Kamishibai の原稿では、印刷と PDF は検査せず画面だけを検査します）。
Firefox は行の詰め方が異なり、一致しないことが多いので既定には含めません。

## 読む順の検査

定理・補題で組み立てる発表で、主張を述べる前に使っていないかを調べる検査です。
`make order SRC=…` は、番号付きの主張ごとに、述べたページ・最初に使ったページ・証明のページを表にし、次を警告します。
番号付きの主張とは、題が「定理 1」「補題 2・3」「定義 4–6」のように種類と番号で始まる block（エンジンでは `block`・`proof` などの囲みの `title`）です。
全角の数字と、種類と数字の間の空白の有無は区別しません。

- `FORWARD`：述べる前に使っている（証明の方針の中での先取りは除く）
- `EARLY`：述べてから証明が始まるまでに `GAP=`（既定 3）ページより多く空いている
- `DEFERRED`：証明が `SHORT=`（既定 2）ページ以内なのに、証明より前に議論で使っている

題が「証明」「証明の方針」の block は、同じページの直前の主張か、ページの見出しに「補題 2 の証明」とある主張の証明として数えます。
調べる種類は既定で「定理・補題・主張・定義」で、`--kinds 定理,補題,命題,系,定義` のように変えられます。
範囲は `--sec 節の名前の先頭` で絞れます。`--kinds` と `--sec` は make からは渡せないので、`python3 tools/check_order.py 原稿 --kinds …` と直接実行します（`--help`）。

## ファイル

| ファイル | 役割 |
|---|---|
| `engine/` | エンジン（`kamishibai.js`・`figure.js`・`base.css`・`themes/`・KaTeX・書体の CSS）と見本の原稿 `sample.html`。説明は [engine/README.md](engine/README.md) |
| `tools/pack_engine.py` | 原稿を配布用ファイルにまとめる（`make pack`） |
| `tools/check_blocks.py` | block に主張だけが入っているかの検査。主張の種類の一覧はエンジンと共通（`make pack` が呼ぶ） |
| `tools/check_figures.py` | 図のキャプションと配置の検査、縮めた図と、読めない `cards`（組み上がる図の指定）の警告（`make pack` が呼ぶ） |
| `tools/check_layout.mjs` | ブラウザ間の組版の照合（`tools/layout/` の計測の script を各ブラウザで動かす） |
| `tools/check_order.py` | 番号付きの主張の読む順の検査 |
| `tools/shot.mjs` | ページを撮る（`make shot`） |
| `tools/engine_fonts.py` | 原稿が読む書体の CSS を作る（`make engine-fonts`） |
| `tools/engine_katex.py` | 原稿が読む KaTeX（`engine/katex/`）を `tools/node_modules` の KaTeX から作り直す（`make engine-katex`）。KaTeX の版を上げるときは、`npm install --prefix tools katex@版` の後に `make engine-katex` を実行する |
| `tools/fetch_fonts.py` | 書体の取得（原ノ味：SIL Open Font License、Latin Modern：GUST Font License） |
| `tools/open_slide.sh` | `make preview`・`make open` の表示（macOS では AppleScript で開いているタブを探す。初回は「ブラウザを操作する許可」を求められる） |
| `page-edit/` | 画面の文と題を直して原稿へ書き戻す Chrome の拡張（サーバーなし）。入れ方と使い方は [page-edit/README.md](page-edit/README.md) |
| `html/slide.src.html`・`tools/build_html.py`・`tools/figs.py` | ビルドする形（次の節） |

## ビルドする形：html/slide.src.html から slide.html を作る

エンジンより前の形で作った資料を直す人向けの節です。この形の資料は、原稿 `html/slide.src.html` をビルドして一つのファイル `slide.html` にします。新しく作るスライドは、エンジンの原稿で書きます。

```bash
make
```

図の生成（`tools/figs.py`）とビルド（`tools/build_html.py`）を行い、`slide.html` を作ります。
ビルドは図・数式・書体を埋め込み、改行位置を決めます。数式はビルド時に KaTeX で組むので、ページに数式処理の JavaScript は入りません。

| コマンド | 内容 |
|---|---|
| `make` | `slide.html` を作る |
| `make open` | `slide.html` を作り、スライド用のブラウザで開く（`make preview` と同じ開き方） |
| `make check` | Chromium と WebKit（Safari の組版の仕組み）で各ページを組み、行の切れ方が一致することと 1280×720 からはみ出さないことを確かめる。`ENGINES=` は `make check-pack` と同じ |
| `make order` | 定理・補題・定義の読む順の警告（上の「読む順の検査」） |

改行は BudouX の文節の切れ目だけで起こるように、ビルドが `<wbr>` を入れ、CSS は `word-break:keep-all` にしてあります。

### 原稿の書き方

- ページは `<section class="slide">`。表紙は `class="slide mid title"`。
- `data-sec="節の名前"` を付けたページから次の `data-sec` の前までが一つの節で、上端の帯（Beamer の miniframes）に出る。
- `data-v="V1"` は右上の小さなラベル（どの変種・設定の話か）。ページ番号は自動。
- ページの見出し（Beamer の frame title）は `<h2>`。本文は h2 の下の残りで、上下中央に置かれる。
- 箇条書き `ul.pts`、番号付き `ol.nums`（`ol.nums.lab` と `<span class="lb">(i)</span>` で文字のラベル）、
  block `div.blk > div.bt + div.bb`、強調 `span.k`（\alert）、左右二段 `.two`、図と文の横並び `.side`、表 `table.tb`。
- 証明は `div.pf > div.pt + 本文`（左の線）、証明の方針は `div.pf.pl`（淡い地）、後で証明する主張は `div.ph`（破線の枠）。
- 数式は `\(TeX\)`。
- 段階表示：`.reveal` を付けた要素がクリック・→・Space で一つずつ出る。`data-with="prev"` は直前と同時に出る。
  左 1/4 のクリック・← で戻る。この形では段階表示は既定でオフ（ページを開くと全部出る）で、キー S で切り替える
  （ブラウザに記憶される）。URL の `?steps` で段階表示をオンにして開き、`#s3` で 3 ページ目から開く。

### 図

| 書き方 | 結果 |
|---|---|
| `<!--SVG name w600-->` | `fig/name.svg` を幅 600 px で埋め込む。SVG 内の SMIL（`animate`、`animateTransform`）はそのまま動く |
| `<!--SVG name w420 id [init]-->` | 段階的に組み上がる図。SVG の `<g class="cd">` を、そのページの `.reveal` の `data-cards="n"`（`*` は全部）まで順に出す。`<g class="ov">` は `data-ov` のある項目で出る。`init` は最初から出ている数 |
| `<!--SVGS a,b w300 id-->` | 図 a, b を同じ場所に重ね、`<div class="ctrl below" data-flip="id"><button>…</button>…</div>` のボタンで切り替える。`data-flipcap` の段落は `data-caps="a の説明\|b の説明"` から説明文を差し替える |
| `<!--IMG path w400-->` | 画像を data URI で埋め込む |

`tools/figs.py` は図の生成器の例で、`fig/*.svg` を書き出します。自分の図の生成器に置き換えて使います。
SVG の文字はページの書体で描かれます（`font-family="LMItalic"` で変数のイタリック、`LMSans` で立体）。
埋め込む書体にない文字があるとビルドが止まるので、記号を足したら `tools/build_html.py` の `FONTS` を見ます。

## ライセンス

KaTeX と書体（下の表）を除き、この repository のファイル（エンジン、`html/`、`tools/`、`Makefile`、文書）は
CC0 1.0 Universal で、著作権と隣接する権利を放棄してパブリックドメインに置きます（[LICENSE](LICENSE)）。
`engine/` だけを写して使うときのために、同じ本文と次の表の要約を [engine/LICENSE](engine/LICENSE) にも置いています。
KaTeX と書体は、それぞれのライセンスのままです。

| もの | ライセンス | 場所と扱い |
|---|---|---|
| KaTeX 0.19.0（数式） | MIT。伸びる記号を描く部分（stretchy.js）は SIL Open Font License 1.1 | `engine/katex/`。許諾文はファイルの最初 |
| IPA Pゴシック（Madrid の日本語の書体） | IPA フォント使用許諾 v1.0 | `engine/fonts/ipa-pgothic.css`。改変せずに丸ごと埋め込み、配布用ファイルでも字を絞らない |
| Computer Modern Sans（Madrid の英数字の書体。KaTeX の KaTeX_SansSerif と同じもの） | MIT（KaTeX） | `engine/fonts/cm-sans.css` |
| 原ノ味角ゴシック（Boadilla の日本語の書体） | SIL Open Font License 1.1（予約された書体名 Harano Aji・Source） | repository には入れない。`make fonts` が取得する |
| Latin Modern Sans・Roman Italic・Math（Boadilla の英数字の書体） | GUST Font License | repository には入れない。`make fonts` が取得する |

原ノ味と Latin Modern は、配布用ファイル（`make pack`）と `slide.html`（`make`）には使う字だけに絞って埋め込みます。
字を絞った書体は改変版に当たるので、書体の中の名前を Kamishibai Gothic JP・Kamishibai Sans などに付け替え
（予約された書体名を使わない）、元の書体の著作権の表示と許諾文を CSS の注記として同じファイルに入れます。
