# 紙芝居エンジン（ビルドなしの HTML スライド）

下書きの HTML をブラウザで直接開くと、その場でスライドに組む仕組みです。タグで書いた下書きを組む本体に、
紙芝居（`../html/`）の見た目・部品・段階表示を合わせています。`make` で作る従来の紙芝居（`html/slide.src.html` と
`tools/build_html.py`）とは別のもので、そちらには影響しません。

## 準備

```
make engine-fonts        # fonts/ の書体を engine/fonts/kamishibai-fonts.css にまとめる（git の外。約 13 MB）
```

書体の CSS が無くても開けます（手元の Hiragino などで出ます）。Madrid テーマの書体（Computer Modern Sans と IPA Pゴシック）は
`engine/fonts/cm-sans.css`・`engine/fonts/ipa-pgothic.css` として repository に入っています。

## 書き方

見本は [sample.html](sample.html)。最初に

```html
<html lang="ja" theme="Boadilla">
<script src="engine/kamishibai.js"></script>
```

と書き、その後ろに `<cover>`・`<slide title="…" sec="…">`・`<divider>` を並べます。使えるタグ・class・キーの一覧は
[kamishibai.js](kamishibai.js) の最初の説明にあります。主なもの：

- 基本のタグ：`block`・`alertblock`・`exampleblock`・`list`/`item`・`note`・`down`・`columns`/`column`・`figure`・`table.tbl` など
- 箱（`block`・`alertblock`・`exampleblock`）には命題・定義など一つの主張だけを入れ、題は主張の種類（`kamishibai.js` の `BLOCK_KINDS`：定義・定理・補題・系・命題・予想・未解決問題など）で始めます。説明・注意・使い道・頁の参照・図・出典・段階表示は箱の外に書きます。下書きでは題が種類で始まらない箱に赤い破線が出ます。`tools/check_blocks.py` が残りの規則も確かめ、`make pack` は規則に反する下書きをまとめません（前に作った `.dist.html` も消します）
- 主張の種類（定義・定理・未解決問題など）は、ラベル（`span.label`）でなく箱の題で示します。未解決問題の提起者は題の括弧に人名で並べ（頭文字と姓の間は `&nbsp;`）、問題の番号は `cite` に短い鍵とともに書いて、同じ頁の `<p class="src">` で鍵を解きます：`<block title="未解決問題（M.&nbsp;Demaine、F.&nbsp;Hurtado）" cite="[DO07, Open Problem 25.6]">`。題の帯は 1 行に収めます
- 頁の番号で参照しません（「頁 4」「次の頁」）。聴衆は頁を戻れないので、定理の番号か内容の名前で言います。箱の中の「頁 n」は `tools/check_blocks.py` が拒みます（箱の外は検査しません）
- 図にはキャプションを付けません（`figcaption`、`p.cap`、「図：…」「左：…右：…」で始まる文）。図の読み方は語りで伝え、頁の文は主張と議論だけにします。図に付けた呼び名など後で使う名前は、頁の項目で導入します
- 図は頁の文の下に置くのが既定です。図の後ろに置けるのは、別の図、出典（`p.src`）、図だけを進める文のない段階（`<span step cards="n"></span>`）だけです。アルゴリズムの解説や、同じ図で段階を追う説明に限り、`<side><div>文</div><figure>図</figure></side>` で文を左、図を右に並べます（`side` の中では書いた順によらず図が右に来ます）。`tools/check_figures.py` がキャプションと配置を確かめ、`make pack` は規則に反する下書きをまとめません。どの頁が段階を追う説明かは機械では判定しないので、`side` を使う頁は書き手が選びます
- 図は表示する幅で描き、縮めて収めません。`zoom` で縮めた図の最小の文字が 10px より小さくなると、`tools/check_figures.py` と `make pack` が警告します（まとめることは止めません）。警告は頁の組み方を見直す合図です。語りへ移すか、意味の境目で頁を分けます
- 紙芝居の部品：`alert`・`proof`・`plan`・`later`・`nums`（`labels`・`item label`）・`side`・`flip`/`switch`。`figcaption for` と図の下の一言 `p.cap` は旧い書き方で、使いません（既存のデッキのために残しています）
- ラベル（`<span class="label">`）は行の高さに収まる小さな枠です。段落・項目・箱の先頭に置くと、続く文は枠の右にそろえて折り返します。ラベルの後ろの空白は要りません（置いても除かれます）。文の途中に置けば行の中に出ます
- 段階表示：`step`（`with="prev"` で直前と一緒に）。組み上がる図は `flip anim` と、step の `cards`・`ov`。文を出さずに図だけを進めるときは、文のない `<span step cards="n"></span>` を置きます
- 数式：`$…$`・`\(…\)`・`$$…$$`・`\[…\]`

## 見る・直す

```
make preview SRC=talk/talk.html    # スライド用のブラウザで開く（開いていれば再読み込み）
make order SRC=talk/talk.html      # 定理・補題・定義の読む順の警告（../README.md の「読む順の検査」）
make shot SRC=talk/talk.html PAGES="4 12" # 4 頁と 12 頁を 1280×720 の PNG に撮る（shots/p4.png など）
```

頁は URL の `#s<n>` で指定します（`talk.html#s5` は 5 頁目から開く）。`make shot` は `tools/shot.mjs` を呼び、頁ごとに読み込み直して撮ります（Playwright で hash だけを変えても頁は切り替わらないため）。

ファイルとして開くだけで組まれるので、下書きを保存してブラウザを再読み込みすれば反映される。

## テーマ

| テーマ | 大きさ | 見た目 |
|---|---|---|
| Boadilla（既定） | 1280 × 720（16:9） | 紙芝居と同じ（Beamer の Boadilla・miniframes・circles） |
| Madrid | 960 × 720（4:3） | Beamer の Madrid |

テーマは `<html theme="…">` で選び、URL に `?theme=Madrid` を付けると開くときに変えられます。
画面の大きさ（`--W`・`--H`）はテーマの CSS が決め、画面への合わせ方・一覧の縮小・印刷の用紙はその値に従います。

## 配る形にする

下書きは engine/ の JS・CSS・書体を読むので、そのままでは一つのファイルとして渡せません。

```
make pack SRC=talk/talk.html               # talk/talk.dist.html ができる（git の外）
make pack SRC=talk/talk.html THEME=Madrid  # テーマを変えて作る
```

`.dist.html` はそれ一つで、ネットにつながずに file:// で開けます。中身は本体の JS・CSS、組んだ数式、
画像、書体です。Boadilla の書体は下書きで使う字だけに削ってあり、見本で約 0.7 MB です。
Madrid の IPA Pゴシックは許諾の条件があるので削らずに入れ、約 8.4 MB になります。
`engine/fonts/` に書体の CSS が無いときは、手元の書体で出ます。同じ下書きからは何度作っても同じバイト列になります。

直すのは下書きです。`.dist.html` は作り直せば済むので、手で直しません。

## 組版の検査

```
make check-pack SRC=talk/talk.html                                # 配る形を作り、それを検査する
make check-pack SRC=talk/talk.html THEME=Madrid ENGINES=chromium,webkit,safari
node ../tools/check_layout.mjs talk/talk.html                     # 下書きをそのまま検査する
```

検査するのは次の三つの見え方です。

- 画面：各ページで段階表示をすべて出した状態と、切り替える図の各カード（説明文も変わるため）
- 印刷：段階ごとの印刷の各紙。紙の大きさが画面と同じか、段階が n 組のページから 0, 1, …, n 組を出した n + 1 枚ができるか
- PDF：Chromium では実際に PDF を作り、ページ数と用紙の大きさを確かめる

報告する問題は次のとおりです。いずれかがあれば終了コード 1 で終わります。

- 画面（W × H）の外に出た文字・箱
- 本文の領域の外に出た文字・箱。本文の領域は、Madrid ではページの枠（slide などの要素）の内側、Boadilla ではページの余白の内側です。Beamer の block のように負の余白でわざと張り出す箱は、その分だけ許します。見出し・見出し帯・ページ番号・下の帯と、絶対配置の部品は、画面の外に出たときだけ報告します
- 自分の段落より幅の広い文字（切れない長い語や数式）
- 枠に切られて見えない中身（下の帯で「…」に省略された著者名なども含む）
- 行の切れ方の違い（エンジンの間、および同じエンジンの画面と印刷の間）

印刷と PDF は、切り替える図を最初のカードで組みます。ほかのカードの説明文は画面でだけ検査します。
`safari`（その Mac のシステムの WebKit）は画面だけを検査します。

## キー

→ / Space / Enter / クリックで進む、← / 左 1/4 のクリックで戻る、S で段階表示の切り替え。
⌘F 全画面、⌘B ページ一覧、⌘K ポインター、⌘E 選択、⌘U キー無効、⌘P 印刷、左下の ▷ の PDF で step ごとに印刷。

## ファイル

- `kamishibai.js`：本体
- `figure.js`：図を描く道具
- `base.css`・`themes/`：見た目
- `katex/`：KaTeX 0.19.0（版を上げるときは `make engine-katex` で作り直す）
- `fonts/`：Boadilla の書体 `kamishibai-fonts.css` は `make engine-fonts` で作る（git の外）。Madrid の書体 `cm-sans.css`・`ipa-pgothic.css` は repository に入っている
- 配る形を作る道具は `../tools/pack_engine.py`（`make pack`）
- 許諾は [LICENSE](LICENSE)（本体は CC0 1.0。KaTeX と書体はそれぞれのライセンスのまま）
