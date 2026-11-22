#!/bin/sh
# Show a slide in the browser kept for slides: reload its tab if it is already open, else open it.
# usage: tools/open_slide.sh slide.html   (browser: $SLIDE_BROWSER, default Google Chrome)
set -e
f=${1:-slide.html}
app=${SLIDE_BROWSER:-Google Chrome}
url=$(python3 -c 'import pathlib, sys; print(pathlib.Path(sys.argv[1]).resolve().as_uri())' "$f")
if [ "$(uname)" != Darwin ]; then
  exec xdg-open "$url"
fi
# Chromium-family browsers share Chrome's AppleScript terms. If scripting is refused
# (no Automation permission yet) or no tab shows the file, fall back to opening it.
osascript - "$app" "$url" >/dev/null 2>&1 <<'EOF' || open -a "$app" "$f"
on run {browserName, u}
  using terms from application "Google Chrome"
    tell application browserName
      repeat with w in windows
        set i to 0
        repeat with t in tabs of w
          set i to i + 1
          if (URL of t) starts with u then
            reload t
            set active tab index of w to i
            set index of w to 1
            activate
            return
          end if
        end repeat
      end repeat
    end tell
  end using terms from
  error "not open"
end run
EOF
