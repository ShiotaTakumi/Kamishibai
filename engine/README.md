# Kamishibai のエンジン

タグで書いた HTML の原稿をブラウザで直接開くと、その場でスライドに組む仕組みです。ビルドは要りません。
発表の後に配るときは、`make pack` で一つの HTML ファイル（配布用ファイル）にまとめます。
コマンドはすべて repository の最上位で実行します。

## 準備

```
make engine-fonts        # Boadilla の書体の CSS engine/fonts/kamishibai-fonts.css を作る（git で追跡しない。約 13 MB）
```

この CSS が無くても原稿は開けます。そのときは手元の書体（Hiragino など）で出ます。
Madrid の書体（Computer Modern Sans と IPA Pゴシック）の CSS は `engine/fonts/` に同梱されているので、作る必要はありません。

## 書き方

見本は [sample.html](sample.html) です。原稿の最初に

```html
<html lang="ja" theme="Boadilla">
<script src="engine/kamishibai.js"></script>
```

と書き（`src` は原稿から `engine/kamishibai.js` への相対パス）、その後ろに表紙 `<cover>`・ページ `<slide title="…" sec="…">`・区切りのページ `<divider>` を並べます。
使えるタグ・class・属性・キーの一覧は [kamishibai.js](kamishibai.js) の最初の説明にあります。主なものは次のとおりです。

- 本文：段落 `p`、箇条書き `list`/`item`、緑の枠の囲み `note`、赤い下向きの矢印 `down`、段組み `columns`/`column`、図 `figure`、表 `table.tbl`
- block（Beamer の block）：`block`・`alertblock`・`exampleblock`
- 証明など：強調 `alert`、証明 `proof`、証明の方針 `plan`、後で証明する主張 `later`、番号つきの手順 `nums`
- 図の切り替え：重ねた図 `flip` と、それを切り替えるボタン `switch`
- 数式：文の中は `$…$`・`\(…\)`、別の行に取るときは `$$…$$`・`\[…\]`
- 段階表示：どの要素にも `step` を付けると、クリックや → で一つずつ出ます。`with="prev"` を付けると直前の段階と一緒に出ます

### 規則

聴衆が一度で読み取れるページにするため、次の規則を置いています。ここに挙げるのは機械で確かめる規則で、定義・定理・証明の文の書き方は [docs/math-slides.md](../docs/math-slides.md) にあります。
`make pack` は配布用ファイルを作る前に二つの検査
（`tools/check_blocks.py` と `tools/check_figures.py`）を行い、規則に反する原稿からは作りません（前に作った `.dist.html` も消します）。

- block には定義・定理などの主張を一つだけ入れ、題は主張の種類で始めます。種類の一覧は `kamishibai.js` の `BLOCK_KINDS`（定義・定理・補題・系・命題・予想・未解決問題など）です。
  説明・注意・使い道・図・出典・段階表示は block の外に書きます。原稿を開くと、題が種類で始まらない block に赤い破線が出ます。
- 主張の種類はラベル（`span.label`）でなく block の題で示します。未解決問題の提起者は題の括弧に人名で並べ（頭文字と姓の間は `&nbsp;`）、
  文献の中の問題の番号は `cite` に文献の略号とともに書き、同じページの出典 `<p class="src">` でその略号の文献を示します。
  例：`<block title="未解決問題（M.&nbsp;Demaine、F.&nbsp;Hurtado）" cite="[DO07, Open Problem 25.6]">`。題の帯は 1 行に収めます。
- ページの番号で参照しません（「ページ 4」「次のページ」）。聴衆はページを戻れないので、定理の番号か内容の名前で言います。
  block の中の「頁 n」は `tools/check_blocks.py` が拒みます（block の外は検査しません）。
- 図にはキャプションを付けません（`figcaption`、`p.cap`、「図：…」「左：…右：…」で始まる文）。図の読み方は話して伝え、ページの文は主張と議論だけにします。
  図に付けた呼び名など後で使う名前は、ページの項目で導入します。`figcaption` と `p.cap` は以前の原稿を開くために表示はしますが、`make pack` は拒みます。
- 図はページの文の下に置きます。図の後ろに置けるのは、別の図、出典（`p.src`）、図だけを進める文のない段階（`<span step cards="n"></span>`）だけです。
  アルゴリズムの解説など同じ図で段階を追う説明に限り、`<side><div>文</div><figure>図</figure></side>` で文を左、図を右に並べます（`side` の中では書いた順によらず図が右に来ます）。
  どのページが段階を追う説明かは機械では判定しないので、`side` を使うページは書き手が選びます。
- 図は表示する幅で描き、縮めて収めません。`zoom` で縮めた図の最小の文字が 10px より小さくなると、`tools/check_figures.py` と `make pack` が警告します（配布用ファイルは作ります）。
  警告が出たら、図の説明を話す側へ移すか、意味の境目でページを分けます。

### ラベル

ラベル（`<span class="label">`）は行の高さに収まる小さな枠です。段落・項目・block の先頭に置くと、続く文は枠の右にそろえて折り返します。
ラベルの後ろの空白は要りません（置いても除かれます）。文の途中に置けば行の中に出ます。

### 組み上がる図

`<flip id="…" anim>` の中の SVG では、`class="cd"` の群（カード）を一つずつ、`class="ov"` の群をまとめて出せます。
段階の要素に `cards="n"` を付けるとその段階で n 枚目のカードまで出て、`ov` を付けると `class="ov"` の群が出ます。
文を出さずに図だけを進めるときは、文のない `<span step cards="n"></span>` を置きます。

## 見る・直す

```
make preview SRC=talk/talk.html            # スライド用のブラウザで開く（開いていれば再読み込み）
make order SRC=talk/talk.html              # 定理・補題・定義の読む順の警告（../README.md の「読む順の検査」）
make shot SRC=talk/talk.html PAGES="4 12"  # 4 ページ目と 12 ページ目を 1280×720 の PNG に撮る（shots/p4.png など）
```

原稿は開くたびに組まれるので、保存してブラウザを再読み込みすれば変更が出ます。
URL の `#s<n>` で開くページを指定できます（`talk.html#s5` は 5 ページ目から開く）。

## テーマ

| テーマ | 大きさ | 見た目 |
|---|---|---|
| Boadilla（既定） | 1280 × 720（16:9） | Beamer の Boadilla（上端に節とページの丸の帯、丸い箇条書きの印） |
| Madrid | 960 × 720（4:3） | Beamer の Madrid |

テーマは `<html theme="…">` で選びます。URL に `?theme=Madrid` を付けると、開くときに変えられます。
画面の大きさ、書体、括弧と句読点の空きはテーマの CSS が決め、画面への合わせ方・ページ一覧の縮小・印刷の用紙はその大きさに従います。
class だけで書く以前の書き方のうち、`ul.pts`（箇条書き）と `.blk`（block）は Boadilla でだけ効きます。

## 配布用ファイルを作る

原稿は engine/ の JS・CSS・書体を読むので、そのままでは一つのファイルとして渡せません。

```
make pack SRC=talk/talk.html               # talk/talk.dist.html ができる（git で追跡しない）
make pack SRC=talk/talk.html THEME=Madrid  # テーマを変えて作る
```

`.dist.html` はそれ一つで、ネットにつながずに file:// で開けます。中身はエンジンの JS・CSS、組み終えた数式、画像、書体です。
Boadilla の書体は原稿で使う字だけに絞ってあり、見本で約 0.7 MB です。
Madrid の IPA Pゴシックは許諾の条件により絞らずに入れるので、約 8.8 MB になります。
Boadilla の書体を入れるには、先に `make fonts` と `make engine-fonts` が要ります（無ければ手元の書体で出るファイルになります）。
同じ原稿からは何度作っても同じバイト列になります。

直すのは原稿です。`.dist.html` は手で直さず、作り直します。

## 組版の検査

```
make check-pack SRC=talk/talk.html                                # 配布用ファイルを作り、それを検査する
make check-pack SRC=talk/talk.html THEME=Madrid ENGINES=chromium,webkit,safari
make browsers && node tools/check_layout.mjs talk/talk.html       # 原稿をそのまま検査する
```

検査するのは次の三つの見え方です。

- 画面：各ページで段階表示をすべて出した状態と、切り替える図の各カード（説明文も変わるため）
- 印刷：段階ごとの印刷の各紙。紙の大きさが画面と同じか、段階が n 組のページから 0, 1, …, n 組を出した n + 1 枚ができるか
- PDF：Chromium では実際に PDF を作り、ページ数と用紙の大きさを確かめる

報告する問題は次のとおりです。いずれかがあれば終了コード 1 で終わります。

- 画面（幅 × 高さ）の外に出た文字・block
- 本文の領域の外に出た文字・block。本文の領域は、Madrid ではページの枠の内側、Boadilla ではページの余白の内側です。
  Beamer の block のように負の余白でわざと張り出す block は、その分だけ許します。見出し・上端の帯・ページ番号・下の帯と、絶対配置の部品は、画面の外に出たときだけ報告します
- 自分の段落より幅の広い文字（切れない長い語や数式）
- 枠に切られて見えない中身（下の帯で「…」に省略された著者名なども含む）
- 行の切れ方の違い（エンジンの間、および同じエンジンの画面と印刷の間）

印刷と PDF は、切り替える図を最初のカードで組みます。ほかのカードの説明文は画面でだけ検査します。
`safari`（その Mac のシステムの WebKit）は画面だけを検査します。

## キー

- 進む：→ / Space / Enter / PageDown / クリック。戻る：← / PageUp / 画面の左 1/4 のクリック。Home / End で最初と最後のページ。
  タッチの画面では、画面に出る ◀ ▶ のボタンでも進み・戻ります。
- 段階表示は既定でオンです。S で「全部出す」（ページだけを送る）と切り替え、選んだほうはブラウザが覚えます。
- ⌘F 全画面、⌘B ページ一覧、⌘K ポインター、⌘P 印刷（Windows では Ctrl）。
- ⌘E は選択の状態：文字を選べるようになり、クリックではページを送らず、← → だけで送ります。
  ⌘U はキー操作を止める状態：キーでもクリックでもページを送りません。どちらも右上に印が出て、同じキーをもう一度押すと戻ります。
- 左下の ▷ を押すと同じ操作のボタンが出ます。そこの PDF のボタンは、段階ごとに一枚ずつ印刷します。

## ファイル

- `kamishibai.js`：エンジンの本体。最初の説明に書き方の一覧がある
- `figure.js`：図のコードから使う道具
- `base.css`・`themes/`：見た目
- `katex/`：KaTeX 0.19.0（版を上げる手順は ../README.md の「ファイル」）
- `fonts/`：書体の CSS。Madrid の `cm-sans.css`・`ipa-pgothic.css` は同梱、Boadilla の `kamishibai-fonts.css` は `make engine-fonts` で作る
- 許諾は [LICENSE](LICENSE)（エンジンは CC0 1.0。KaTeX と書体はそれぞれのライセンスのまま）
