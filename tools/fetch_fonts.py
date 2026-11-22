"""Download the fonts of the slides into fonts/ (pinned versions, checked by SHA-256).

  python3 tools/fetch_fonts.py

Files already in fonts/ with the right checksum are kept, so this can be run any number of times.
Both fonts are free to embed: Harano Aji under the SIL Open Font License 1.1, Latin Modern under
the GUST Font License; the license texts are saved next to the fonts.
"""
import hashlib, io, sys, urllib.request, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FONT_DIR = ROOT / "fonts"
HA = "https://github.com/trueroad/HaranoAjiFonts/raw/20250811/"
LM = "https://www.gust.org.pl/projects/e-foundry/latin-modern/download/lm2.004otf.zip"
LMM = "https://www.gust.org.pl/projects/e-foundry/lm-math/download/latinmodern-math-1959.zip"

# (file in fonts/, SHA-256 of that file, URL, member of the zip at URL or None)
FILES = [
    ("HaranoAjiGothic-Regular.otf", "fb846296a5af628d5eaa5ac28838723a099b421c9b4f0d871413d2ad41893518",
     HA + "HaranoAjiGothic-Regular.otf", None),
    ("HaranoAjiGothic-Bold.otf", "0daf46b82128d54d1cc32ab07c4ef512feb9504c076ad78bbd554ef1be735182",
     HA + "HaranoAjiGothic-Bold.otf", None),
    ("LICENSE-HaranoAji.txt", "6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2",
     HA + "LICENSE", None),
    ("lmsans10-regular.otf", "d431b786b9b603662718e79cfe9b441f47a8b0b3e854dde89d5acb3ed7cfd682",
     LM, "lmsans10-regular.otf"),
    ("lmsans10-bold.otf", "a597b710326c1a8a2c7238d808e5d38711638a72a32383478db4829d63afd687",
     LM, "lmsans10-bold.otf"),
    ("lmroman10-italic.otf", "c1fce25075567bb8dbf2151658c3b442690041db17a2d49fc9e55905ea5b7169",
     LM, "lmroman10-italic.otf"),
    ("latinmodern-math.otf", "6075562b771f8b82f0c179e363389684f2dd09de30038269e2628e504bd7be0f",
     LMM, "latinmodern-math-1959/otf/latinmodern-math.otf"),
    ("LICENSE-LatinModern.txt", "2bd69affc3da00715116f713f57eab9707e96daf3562ad0215987b15b9c16f73", LMM, "latinmodern-math-1959/doc/GUST-FONT-LICENSE.txt"),
]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    FONT_DIR.mkdir(exist_ok=True)
    cache = {}
    for name, digest, url, member in FILES:
        path = FONT_DIR / name
        if path.exists() and (digest is None or sha(path.read_bytes()) == digest):
            continue
        if url not in cache:
            print(f"downloading {url}", file=sys.stderr)
            with urllib.request.urlopen(url, timeout=120) as r:
                cache[url] = r.read()
        data = cache[url]
        if member:
            data = zipfile.ZipFile(io.BytesIO(data)).read(member)
        if digest and sha(data) != digest:
            sys.exit(f"checksum mismatch for {name} from {url}\n  expected {digest}\n  got      {sha(data)}")
        path.write_bytes(data)
        print(f"  {path.relative_to(ROOT)}", file=sys.stderr)
    print("fonts ready in fonts/", file=sys.stderr)


if __name__ == "__main__":
    main()
