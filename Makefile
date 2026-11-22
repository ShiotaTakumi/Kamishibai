# HTML slides: html/slide.src.html + fig/*.svg -> slide.html (single file, fonts and math embedded)
# Every input is pinned (requirements.txt, tools/package-lock.json, fonts by SHA-256), so the
# same source gives the same slide.html on any machine.
PY ?= python3
VENV = .venv
VPY = $(VENV)/bin/python
ENGINES ?= chromium,webkit

.PHONY: all deps fonts engine-fonts engine-katex pack preview shot browsers figs html open check check-pack order clean
all: html

deps: $(VENV)/.ok tools/node_modules/.ok
$(VENV)/.ok: requirements.txt
	$(PY) -m venv $(VENV)
	$(VPY) -m pip install -q -r requirements.txt
	touch $@
tools/node_modules/.ok: tools/package.json tools/package-lock.json
	npm ci --prefix tools
	touch $@

# Harano Aji and Latin Modern (free licenses), downloaded once into fonts/
fonts: fonts/.ok
fonts/.ok: tools/fetch_fonts.py
	$(PY) tools/fetch_fonts.py
	touch $@

# the fonts of the runtime engine (engine/kamishibai.js) as one CSS file with the fonts inside
engine-fonts: deps fonts
	$(VPY) tools/engine_fonts.py

# rebuild engine/katex/ from the KaTeX in tools/node_modules (after npm install --prefix tools katex@VERSION)
engine-katex:
	$(PY) tools/engine_katex.py

# a draft of the engine as one HTML file to hand out (next to it as NAME.dist.html; git-ignored);
# e.g. make pack SRC=talk/talk.html THEME=Madrid
SRC ?= engine/sample.html
pack: deps fonts
	$(VPY) tools/pack_engine.py $(SRC)$(if $(THEME), --theme $(THEME))

# show a draft of the engine as it is (no build) in the browser kept for slides; reloads its tab if open
preview:
	sh tools/open_slide.sh $(SRC)

# screenshots of pages of a draft of the engine (1280x720, page n = #s<n>) into $(SHOTS)/p<n>.png;
# e.g. make shot SRC=talk/talk.html PAGES="4 12"
SHOTS ?= shots
shot: browsers
	$(if $(PAGES),,$(error PAGES is empty: e.g. make shot SRC=talk/talk.html PAGES="4 12"))
	mkdir -p $(SHOTS)
	node tools/shot.mjs $(SRC) $(SHOTS) $(PAGES)

# the browsers of the layout check, pinned by Playwright (on Linux: add --with-deps)
comma := ,
PWB = $(filter-out safari,$(subst $(comma), ,$(ENGINES)))
browsers: tools/node_modules/.ok
	$(if $(PWB),tools/node_modules/.bin/playwright install $(PWB))

figs: $(VENV)/.ok
	$(VPY) tools/figs.py

html: deps fonts figs
	$(VPY) tools/build_html.py

# build, then show slide.html in the browser kept for slides (reloads its tab if open);
# e.g. make open SLIDE_BROWSER="Brave Browser"
open: html
	sh tools/open_slide.sh slide.html

# line breaks and overflow in Chromium and WebKit; e.g. make check ENGINES=chromium,webkit,firefox,safari
# (safari = the system WebKit of a Mac, needs swiftc)
check: html browsers
	node tools/check_layout.mjs --engines=$(ENGINES)

# the same for a draft of the engine, packed first: every page with all steps, every card of each
# flip figure, the printed sheets and (Chromium) the PDF; e.g. make check-pack SRC=talk/talk.html THEME=Madrid
check-pack: pack browsers
	node tools/check_layout.mjs $(basename $(SRC)).dist.html --engines=$(ENGINES)

# warnings on the order of definitions, lemmas and theorems (never fails the build);
# make order SRC=talk/talk.html reads a draft of the engine instead of html/slide.src.html
order:
	$(PY) tools/check_order.py $(if $(filter command line,$(origin SRC)),$(SRC),html/slide.src.html)

clean:
	rm -f slide.html
