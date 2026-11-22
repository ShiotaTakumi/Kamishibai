#!/usr/bin/env python3
"""Figure generator for the HTML slides: writes fig/*.svg from data.

Replace the two examples with the deck's own figures; keep figures generated from the same
data as the Beamer version (or from the project's tool / viewer), not drawn by hand.

  fig/example-steps.svg  a path graph built edge by edge: each step is a <g class="cd">
                         (shown one by one by the page; see data-cards in slide.src.html)
  fig/example-yes.svg,   two graphs shown in one place and switched by buttons (SVGS);
  fig/example-no.svg     no "cd" groups, so everything is drawn from the start
  fig/example-zoom.svg   a SMIL animation: a small gap d between two blocks, magnified,
                         with the right block moving between d and 0 (plays by itself)
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INK, THEME, ALERT = "#262626", "#0096c8", "#ff4c00"


def steps():
    pts = [(40 + 110 * i, 60 if i % 2 else 140) for i in range(5)]
    out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 200">']
    for k in range(len(pts) - 1):
        (x0, y0), (x1, y1) = pts[k], pts[k + 1]
        out.append(f'<g class="cd"><line x1="{x0}" y1="{y0}" x2="{x1}" y2="{y1}" stroke="{THEME}" stroke-width="5"/></g>')
    for i, (x, y) in enumerate(pts):
        out.append(f'<circle cx="{x}" cy="{y}" r="14" fill="#fefefe" stroke="{INK}" stroke-width="3"/>')
        out.append(f'<text x="{x}" y="{y + (44 if y > 100 else -26)}" font-size="26" text-anchor="middle" '
                   f'font-family="LMItalic" fill="{INK}">v<tspan font-family="LMSans" font-size="18" dy="6">{i}</tspan></text>')
    out.append("</svg>")
    return "\n".join(out)


def graph(pts, edges):
    out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220">']
    for a, b in edges:
        (x0, y0), (x1, y1) = pts[a], pts[b]
        out.append(f'<line x1="{x0}" y1="{y0}" x2="{x1}" y2="{y1}" stroke="{THEME}" stroke-width="5"/>')
    for x, y in pts:
        out.append(f'<circle cx="{x}" cy="{y}" r="14" fill="#fefefe" stroke="{INK}" stroke-width="3"/>')
    out.append("</svg>")
    return "\n".join(out)


def yes():
    """A 4-cycle with a chord: two odd vertices, so it has an Euler trail."""
    pts = [(60, 40), (260, 40), (260, 180), (60, 180)]
    return graph(pts, [(0, 1), (1, 2), (2, 3), (3, 0), (0, 2)])


def no():
    """The star K_{1,3}: four odd vertices, so it has no Euler trail."""
    pts = [(160, 110), (160, 20), (60, 190), (260, 190)]
    return graph(pts, [(0, 1), (0, 2), (0, 3)])


def zoom(d=12, dur=3):
    w, h = 400, 200
    x_left_end = 180
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}">',
           f'<rect x="20" y="50" width="{x_left_end - 20}" height="100" fill="#e6f4fa" stroke="{INK}" stroke-width="3"/>',
           f'<g><rect x="{x_left_end + d}" y="50" width="180" height="100" fill="#e6f4fa" stroke="{INK}" stroke-width="3"/>',
           f'<animateTransform attributeName="transform" type="translate" values="0 0;{-d} 0;0 0" '
           f'dur="{dur}s" repeatCount="indefinite"/></g>',
           f'<line x1="{x_left_end}" y1="170" x2="{x_left_end + d}" y2="170" stroke="{ALERT}" stroke-width="3">',
           f'<animate attributeName="x2" values="{x_left_end + d};{x_left_end};{x_left_end + d}" '
           f'dur="{dur}s" repeatCount="indefinite"/></line>',
           f'<text x="{x_left_end + d / 2}" y="196" font-size="24" text-anchor="middle" '
           f'font-family="LMItalic" fill="{ALERT}">d</text>',
           "</svg>"]
    return "\n".join(out)


def main():
    (ROOT / "fig").mkdir(exist_ok=True)
    for name, svg in (("example-steps", steps()), ("example-yes", yes()), ("example-no", no()),
                      ("example-zoom", zoom())):
        (ROOT / "fig" / f"{name}.svg").write_text(svg + "\n")
        print(f"fig/{name}.svg")


if __name__ == "__main__":
    main()
