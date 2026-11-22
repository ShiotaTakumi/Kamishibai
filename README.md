# Kamishibai

ブラウザで開いて発表するスライドの仕組み。TonanKamata と ShiotaTakumi が共同で開発した。Beamer と同じ見た目（16:9、11pt 相当、UniBlue / AlertOrange、Latin Modern Sans と
原ノ味角ゴシック）で、PDF ではできない次のことに使う。

- 図の中の要素を段階的に出す（辺を一本ずつ足す、カードを一枚ずつ置く）
- 二つの図をボタンで切り替える（Yes の例と No の例）
- 図の中で動かす（SVG の SMIL アニメーション、図のコード）
- 一つの HTML ファイルとして配る（書体と数式を中に入れるので、ネットにつながらなくても同じ表示になる）

作り方は二つある。新しく作るときは 1 の下書きを使う。

1. **下書き（紙芝居エンジン）**：タグで書いた HTML（`kamishibai.js` を読む）をブラウザで直接開くと、その場でスライドに組む。
   ビルドなしで見られ、配るときは `make pack` で一つのファイルにまとめる。
   テーマは Boadilla（16:9、既定）と Madrid（4:3、Beamer の Madrid に倣った見た目）。書き方は [engine/README.md](engine/README.md)。
2. **従来の形**：`html/slide.src.html` を `make` でビルドして `slide.html` を作る。既にこの形で作った資料を直すときに使う。

## 準備

この repository を clone するか、発表の directory へコピーする。必要なものは Python 3.10 以上、Node.js 20 以上、make。

```bash
make deps fonts engine-fonts
```

Python の venv（`.venv/`、fontTools）と Node のパッケージ（`tools/node_modules/`、KaTeX・BudouX・Playwright）を作り、
書体を `fonts/` に取得し（`tools/fetch_fonts.py`、版を固定し SHA-256 で照合）、下書きが読む書体の CSS を `engine/fonts/` に作る。
入力はすべて版が固定されているので、同じ原稿からはどの機械でも同じ配布物ができる。
`python3 -m venv` が使えない Python では、`make PY=/path/to/python3` で別の Python を指定する。
Linux で検査を初めて行うときは、ブラウザの依存ライブラリを `tools/node_modules/.bin/playwright install --with-deps chromium webkit` で入れる。

## 下書きで作る

[engine/sample.html](engine/sample.html) をコピーして下書きを書き始める（例：`talk/talk.html`。下書きの中の
`<script src="…/engine/kamishibai.js">` は、下書きから engine/ への相対パスにする）。

| コマンド | 内容 |
|---|---|
| `make preview SRC=talk/talk.html` | 下書きをそのまま、スライド用のブラウザ（既定は Google Chrome）で見せる。そのファイルのタブが既に開いていれば、新しいタブを開かずに再読み込みする。別のブラウザは `SLIDE_BROWSER="Brave Browser"` |
| `make pack SRC=talk/talk.html [THEME=Madrid]` | 配る形 `talk/talk.dist.html`（git の外）を作る。数式を組み、書体・画像・本体を中に入れた一つのファイル。先に箱の規則（`tools/check_blocks.py`）と図の規則（`tools/check_figures.py`）を確かめ、反する下書きはまとめず、前に作った `.dist.html` を消す（[engine/README.md](engine/README.md) の「書き方」） |
| `make check-pack SRC=talk/talk.html [THEME=Madrid]` | 配る形を作り、Chromium と WebKit で、各ページの段階表示をすべて出した状態・切り替える図の各カード・段階ごとの印刷・PDF を組み、行の切れ方の一致とはみ出しを検査する（詳しくは [engine/README.md](engine/README.md) の「組版の検査」） |
| `make order SRC=talk/talk.html` | 定理・補題・定義の読む順の警告（下記） |
| `make shot SRC=talk/talk.html PAGES="4 12"` | 指定した頁を 1280×720 の PNG（`shots/p4.png` など、git の外。`SHOTS=` で置き場を変える）に撮る |

直すのは下書きで、`.dist.html` は手で直さず作り直す。

## 従来の形で作る

```bash
make
```

図の生成（`tools/figs.py`）とビルド（`tools/build_html.py`）を行い、`slide.html` を作る。

| コマンド | 内容 |
|---|---|
| `make` | `slide.html` を作る |
| `make open` | `slide.html` を作り、スライド用のブラウザで見せる（`make preview` と同じ開き方） |
| `make check` | Chromium と WebKit（Safari のエンジン）で各頁を組み、行の切れ方が一致することと 1280×720 からはみ出さないことを確かめる |
| `make order` | 定理・補題・定義の読む順の警告 |

`make check` と `make check-pack` は `ENGINES=chromium,webkit,firefox,safari` で比べるエンジンを選べる。ブラウザは Playwright が固定した版を初回に取得する。
`safari` はその Mac の Safari と同じシステムの WebKit（macOS 専用、Xcode の command-line tools の `swiftc` が要る。下書きでは画面だけを検査する）。

## ファイル

| ファイル | 役割 |
|---|---|
| `engine/` | 紙芝居エンジン（`kamishibai.js`・`figure.js`・`base.css`・`themes/`・KaTeX）と見本の下書き `sample.html`。説明は [engine/README.md](engine/README.md) |
| `tools/pack_engine.py` | 下書きを配る形にまとめる（`make pack`） |
| `tools/check_blocks.py` | 箱（`block` 類）に主張だけが入っているかの検査。主張の種類は `engine/kamishibai.js` の `BLOCK_KINDS` から読む（`make pack` が呼ぶ） |
| `tools/check_figures.py` | 図のキャプションと配置の検査、縮めた図の警告（`make pack` が呼ぶ） |
| `tools/shot.mjs` | 頁を撮る（`make shot`） |
| `tools/engine_fonts.py` | 下書きが読む書体の CSS を作る（`make engine-fonts`） |
| `tools/engine_katex.py` | 下書きが読む KaTeX（`engine/katex/`）を `tools/node_modules` の KaTeX から作り直す（`make engine-katex`）。KaTeX の版を上げるときは `tools/package.json` を直して `make deps` の後に実行する |
| `html/slide.src.html` | 従来の形の原稿（CSS と頁送りの script を含む） |
| `tools/figs.py` | 図の生成器の例。`fig/*.svg` を書き出す。自分の図の生成器に置き換える |
| `tools/build_html.py` | 従来の形のビルド。図・数式・書体を埋め込み、改行位置を決めて `slide.html` を書く |
| `tools/fetch_fonts.py` | 書体の取得（原ノ味：SIL Open Font License、Latin Modern：GUST Font License） |
| `tools/check_layout.mjs` | エンジン間の組版の照合（`tools/layout/` の計測 script を各エンジンで動かす。`slide.html` には `measure.js`、下書きと `.dist.html` には `engine_probe.js`） |
| `tools/check_order.py` | 番号付きの主張の読む順の検査（下書きと従来の形の両方） |
| `tools/open_slide.sh` | `make preview`・`make open` の表示（macOS では AppleScript で開いているタブを探す。初回は「ブラウザを操作する許可」を求められる） |
| `slide.html` | 従来の形の生成物 |

## 従来の形の原稿の書き方

- 頁は `<section class="slide">`。表紙は `class="slide mid title"`。
- `data-sec="節の名前"` を付けた頁から次の `data-sec` の前までが一つの節で、上端の見出し帯（Beamer の miniframes）に出る。
- `data-v="V1"` は右上の小さなラベル（どの変種・設定の話か）。頁番号は自動。
- frame title は `<h2>`。本文は h2 の下の残りで上下中央に置かれる。
- 箇条書き `ul.pts`、番号付き `ol.nums`（`ol.nums.lab` と `<span class="lb">(i)</span>` で文字のラベル）、
  block `div.blk > div.bt + div.bb`、強調 `span.k`（\alert）、左右二段 `.two`、図と文の横並び `.side`、表 `table.tb`。
- 証明は `div.pf > div.pt + 本文`（左の線）、証明の方針は `div.pf.pl`（淡い地）、後で証明する主張は `div.ph`（破線の枠）。
- 数式は `\(TeX\)`。ビルド時に KaTeX で組むので、ページに JavaScript の数式処理は入らない。
- 段階表示：`.reveal` を付けた要素がクリック・→・Space で一つずつ出る。`data-with="prev"` は直前と同時に出る。
  左 1/4 のクリック・← で戻る。段階表示は既定でオフ（頁を開くと全部出る）で、キー S で切り替える
  （ブラウザに記憶される）。URL の `?steps` で段階表示をオンにして開き、`#s3` で 3 頁目から開く。

### 図

| 書き方 | 結果 |
|---|---|
| `<!--SVG name w600-->` | `fig/name.svg` を幅 600 px で埋め込む。SVG 内の SMIL（`animate`、`animateTransform`）はそのまま動く |
| `<!--SVG name w420 id [init]-->` | 段階的に組み上がる図。SVG の `<g class="cd">` を、その頁の `.reveal` の `data-cards="n"`（`*` は全部）まで順に出す。`<g class="ov">` は `data-ov` のある項目で出る。`init` は最初から出ている数 |
| `<!--SVGS a,b w300 id-->` | 図 a, b を同じ場所に重ね、`<div class="ctrl below" data-flip="id"><button>…</button>…</div>` のボタンで切り替える。`data-flipcap` の段落は `data-caps="a の説明\|b の説明"` から説明文を差し替える |
| `<!--IMG path w400-->` | 画像を data URI で埋め込む |

SVG の文字は頁のフォントで描かれる（`font-family="LMItalic"` で変数のイタリック、`LMSans` で立体）。
埋め込むフォントにない文字があるとビルドが止まるので、記号を足したら `tools/build_html.py` の `FONTS` を見る。

## 改行とフォント

文字の大きさは Beamer の 11pt（1pt = 2.822 px）に合わせてある。従来の形では、改行は BudouX の文節の切れ目だけで起こるように
ビルドが `<wbr>` を入れ、CSS は `word-break:keep-all` にしてある。下書き（エンジン）は文節での固定をせず、ブラウザの通常の改行に任せる
（そのため `make check-pack` でエンジン間の行の切れ方を照合する）。どちらも、ブラウザごとに挙動が違う機能
（`text-wrap:pretty`、約物の詰め、和欧間の自動スペース）は使わない。

`make check`・`make check-pack` の既定は Chromium と WebKit で、どちらも Playwright が固定した版なので、どの機械でも同じ結果になる。
Playwright の WebKit は新しい WebKit で、ある Mac の Safari と同じ版とは限らない。実際、WebKit 26.6 は Safari 26.2 と違い、
`word-break:keep-all` の下で開き括弧（`（`、`(`）の直後で改行することがある。手元の Safari と合わせたいときは
`ENGINES=chromium,safari` も確かめる。Firefox は行の詰め方が異なり、一致しないことが多いので既定には含めない。

## 読む順の検査

定理・補題で組む発表のための検査。`make order`（下書きは `make order SRC=…`）は、番号付きの主張（box の題が「定理 1」「補題 2・3」「定義 4–6」で始まるもの。
下書きでは `block`・`proof`・`plan`・`later` の `title`。全角の数字と、種類と数字の間の空白の有無は区別しない）ごとに、述べた頁・
最初に使った頁・証明の頁を表にし、次を警告する。

- `FORWARD`：述べる前に使っている（証明の方針の中での先取りは除く）
- `EARLY`：述べてから証明が始まるまでに `--gap`（既定 3）頁より多く空いている
- `DEFERRED`：証明が `--short`（既定 2）頁以内なのに、証明より前に議論で使っている

タイトルが「証明」「証明の方針」の box は、同じ頁の直前の主張か、frame title の「補題 2 の証明」の主張の証明として数える。
種類は `--kinds 定理,補題,命題,系,定義`、範囲は `--sec 節の名前の先頭` で変えられる（`python3 tools/check_order.py --help`）。

## ライセンス

Kamishibai は TonanKamata と ShiotaTakumi が共同で開発した。本体（`engine/` の `kamishibai.js`・`figure.js`・`base.css`・`themes/`・`sample.html`、
`html/`、`tools/`、`Makefile`）は CC0 1.0 Universal で、著作権と隣接する権利を放棄してパブリックドメインに置く（[LICENSE](LICENSE)。
`engine/` だけを写して使うときのために、同じ本文と次の表の要約を [engine/LICENSE](engine/LICENSE) にも置く）。
CC0 は中に入れている KaTeX と書体には及ばず、それらは下のそれぞれのライセンスのままである。

| もの | ライセンス | 場所と扱い |
|---|---|---|
| KaTeX 0.19.0（数式） | MIT。伸びる記号を描く部分（stretchy.js）は SIL Open Font License 1.1 | `engine/katex/`。許諾文はファイルの最初 |
| IPA Pゴシック（Madrid の日本語の書体） | IPA フォント使用許諾 v1.0 | `engine/fonts/ipa-pgothic.css`。改変せずに丸ごと埋め込み、配る形でも字を絞らない |
| Computer Modern Sans（Madrid の英数字の書体。KaTeX の KaTeX_SansSerif と同じもの） | MIT（KaTeX） | `engine/fonts/cm-sans.css` |
| 原ノ味角ゴシック（Boadilla の日本語の書体） | SIL Open Font License 1.1（予約された書体名 Harano Aji・Source） | repository には入れない。`make fonts` が取得する |
| Latin Modern Sans・Roman Italic・Math（Boadilla の英数字の書体） | GUST Font License | repository には入れない。`make fonts` が取得する |

原ノ味と Latin Modern は、配る形（`make pack`、従来の形の `make`）では使う字だけに絞って埋め込む。
字を絞った書体は改変版に当たるので、書体の中の名前を Kamishibai Gothic JP・Kamishibai Sans などに付け替え
（予約された書体名を使わない）、元の書体の著作権の表示と許諾文を CSS の注記として同じファイルに入れる
（`tools/build_html.py` の `rename_subset`、`tools/engine_fonts.py` の `license_notice`）。
