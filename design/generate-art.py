"""Original procedural cover + interior artwork for PALScans seed data.
No third-party assets: every shape is generated here."""
import math, os, random

W, H = 400, 600

def esc(v): return f"{v:.1f}"

# ---------------------------------------------------------------- palettes
PAL = [
    ("Frost",   "#071633", "#12386e", "#4da6ff", "#cfe8ff"),
    ("Ember",   "#2a0a06", "#7a1f12", "#ff7a3c", "#ffd9b0"),
    ("Verdant", "#04211c", "#0d5347", "#3fd6a8", "#d6fff1"),
    ("Violet",  "#170a2e", "#3d1a75", "#a06bff", "#ecdcff"),
    ("Ash",     "#12131a", "#33384a", "#8f9ab5", "#e6ebf5"),
    ("Gold",    "#241703", "#6b4405", "#f0b23c", "#ffeec4"),
    ("Rose",    "#2a0616", "#7a1236", "#ff5c8a", "#ffd6e2"),
    ("Abyss",   "#03060f", "#0d1c3a", "#2f7fd6", "#bcd9ff"),
    ("Sand",    "#241a0c", "#6d5220", "#e0b062", "#fff0d0"),
    ("Jade",    "#03191b", "#0b4a50", "#33c2c9", "#ccf6f8"),
    ("Blood",   "#1c0407", "#5e0d15", "#e03a44", "#ffd0d3"),
    ("Storm",   "#0a1020", "#243a5e", "#6fa8e0", "#dbe9fb"),
]

def defs(i, p):
    _, deep, mid, accent, light = p
    return f"""<defs>
<linearGradient id="sky{i}" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="{deep}"/><stop offset=".55" stop-color="{mid}"/><stop offset="1" stop-color="{deep}"/>
</linearGradient>
<radialGradient id="halo{i}" cx=".5" cy=".42" r=".62">
  <stop offset="0" stop-color="{accent}" stop-opacity=".85"/>
  <stop offset=".45" stop-color="{accent}" stop-opacity=".22"/>
  <stop offset="1" stop-color="{accent}" stop-opacity="0"/>
</radialGradient>
<linearGradient id="fig{i}" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#000" stop-opacity=".92"/><stop offset="1" stop-color="#000" stop-opacity=".99"/>
</linearGradient>
<linearGradient id="floor{i}" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="{accent}" stop-opacity=".30"/><stop offset="1" stop-color="{deep}" stop-opacity="0"/>
</linearGradient>
<radialGradient id="vig{i}" cx=".5" cy=".45" r=".78">
  <stop offset=".5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".72"/>
</radialGradient>
<linearGradient id="band{i}" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".85"/>
</linearGradient>
<filter id="soft{i}" x="-30%" y="-30%" width="160%" height="160%">
  <feGaussianBlur stdDeviation="9"/></filter>
<filter id="mist{i}" x="-30%" y="-30%" width="160%" height="160%">
  <feGaussianBlur stdDeviation="16"/></filter>
</defs>"""

def particles(rng, n, light, y0=0, y1=H, rmax=2.2):
    out = []
    for _ in range(n):
        x, y = rng.uniform(-10, W + 10), rng.uniform(y0, y1)
        r = rng.uniform(.5, rmax)
        out.append(f'<circle cx="{esc(x)}" cy="{esc(y)}" r="{esc(r)}" fill="{light}" opacity="{esc(rng.uniform(.15,.75))}"/>')
    return "".join(out)

def rays(rng, i, accent, cx, cy):
    out = []
    for _ in range(rng.randint(3, 6)):
        a = rng.uniform(-0.5, 0.5)
        w = rng.uniform(16, 52)
        x = cx + math.tan(a) * 400
        out.append(f'<polygon points="{esc(cx)},{esc(cy)} {esc(x-w)},{H} {esc(x+w)},{H}" fill="{accent}" opacity="{esc(rng.uniform(.05,.13))}" filter="url(#soft{i})"/>')
    return "".join(out)

def ridge(rng, y, amp, colour, opacity, step=26):
    pts, x = [], -20
    while x < W + 20:
        pts.append((x, y + rng.uniform(-amp, amp)))
        x += step
    d = f'M{esc(pts[0][0])},{esc(pts[0][1])}'
    for k in range(1, len(pts)):
        px, py = pts[k - 1]; cx, cy = pts[k]
        d += f' Q{esc((px+cx)/2)},{esc(min(py,cy)-amp*0.7)} {esc(cx)},{esc(cy)}'
    d += f' L{W+20},{H} L-20,{H} Z'
    return f'<path d="{d}" fill="{colour}" opacity="{esc(opacity)}"/>'

def spires(rng, y, colour, opacity, n=7):
    out = []
    for _ in range(n):
        x = rng.uniform(-10, W + 10); w = rng.uniform(10, 34); h = rng.uniform(50, 190)
        out.append(f'<polygon points="{esc(x)},{esc(y)} {esc(x+w/2)},{esc(y-h)} {esc(x+w)},{esc(y)}" fill="{colour}" opacity="{esc(opacity)}"/>')
    return "".join(out)


def person(cx, base, h, fill, rim, flip=False, pose="stand", cape=True):
    """A proportioned human silhouette (~7.5 heads). h = full height in px."""
    d = -1.0 if flip else 1.0
    hd = h * 0.062                      # head radius y
    hy = base - h * 0.935               # head centre
    sh = base - h * 0.815               # shoulder line
    hip = base - h * 0.505
    knee = base - h * 0.255
    sw = h * 0.112                      # shoulder half-width
    ww = h * 0.078                      # waist half-width
    o = ['<g>']
    if cape:
        flare = h * 0.205
        o.append(f'<path d="M{esc(cx-sw*0.9)},{esc(sh-h*0.01)} '
                 f'C{esc(cx-sw*1.5)},{esc(hip)} {esc(cx-flare*0.9)},{esc(base-h*0.06)} {esc(cx-flare)},{esc(base+h*0.01)} '
                 f'L{esc(cx+flare)},{esc(base+h*0.01)} '
                 f'C{esc(cx+flare*0.9)},{esc(base-h*0.06)} {esc(cx+sw*1.5)},{esc(hip)} {esc(cx+sw*0.9)},{esc(sh-h*0.01)} Z" '
                 f'fill="{fill}" opacity=".92"/>')
    # legs
    stance = h * (0.055 if pose == "stand" else 0.10)
    for sgn in (-1, 1):
        x0 = cx + sgn * ww * 0.45
        o.append(f'<path d="M{esc(x0-ww*0.42)},{esc(hip)} L{esc(x0+ww*0.42)},{esc(hip)} '
                 f'L{esc(x0+sgn*stance+ww*0.30)},{esc(knee)} L{esc(x0+sgn*stance+ww*0.34)},{esc(base)} '
                 f'L{esc(x0+sgn*stance-ww*0.34)},{esc(base)} L{esc(x0+sgn*stance-ww*0.30)},{esc(knee)} Z" fill="{fill}"/>')
    # torso
    o.append(f'<path d="M{esc(cx-sw)},{esc(sh)} Q{esc(cx)},{esc(sh-h*0.035)} {esc(cx+sw)},{esc(sh)} '
             f'L{esc(cx+ww)},{esc(hip+h*0.02)} Q{esc(cx)},{esc(hip+h*0.05)} {esc(cx-ww)},{esc(hip+h*0.02)} Z" fill="{fill}"/>')
    # arms
    o.append(f'<path d="M{esc(cx-sw*0.96)},{esc(sh+h*0.012)} q{esc(-h*0.03)},{esc(h*0.11)} {esc(-h*0.012)},{esc(h*0.215)} '
             f'l{esc(h*0.032)},{esc(h*0.004)} q{esc(-h*0.004)},{esc(-h*0.11)} {esc(h*0.026)},{esc(-h*0.205)} Z" fill="{fill}"/>')
    ax = cx + sw * 0.96
    o.append(f'<path d="M{esc(ax)},{esc(sh+h*0.012)} q{esc(h*0.05)},{esc(h*0.10)} {esc(h*0.035)},{esc(h*0.20)} '
             f'l{esc(-h*0.032)},{esc(h*0.006)} q{esc(h*0.006)},{esc(-h*0.095)} {esc(-h*0.045)},{esc(-h*0.19)} Z" fill="{fill}"/>')
    # neck + head + hair mass
    o.append(f'<rect x="{esc(cx-h*0.021)}" y="{esc(hy+hd*0.55)}" width="{esc(h*0.042)}" height="{esc(h*0.045)}" fill="{fill}"/>')
    o.append(f'<ellipse cx="{esc(cx)}" cy="{esc(hy)}" rx="{esc(hd*0.86)}" ry="{esc(hd)}" fill="{fill}"/>')
    o.append(f'<path d="M{esc(cx-hd*0.92)},{esc(hy-hd*0.10)} q{esc(hd*0.20)},{esc(-hd*1.30)} {esc(hd*1.84)},{esc(-hd*0.06)} '
             f'q{esc(-hd*0.30)},{esc(-hd*0.55)} {esc(-hd*0.92)},{esc(-hd*0.52)} q{esc(-hd*0.95)},{esc(-hd*0.02)} {esc(-hd*0.92)},{esc(hd*0.68)} Z" fill="{fill}"/>')
    # rim light down one edge
    o.append(f'<g opacity=".95" stroke="{rim}" fill="none" stroke-linecap="round">'
             f'<path d="M{esc(cx+d*hd*0.80)},{esc(hy-hd*0.55)} q{esc(d*hd*0.34)},{esc(hd*0.85)} {esc(-d*hd*0.10)},{esc(hd*1.42)}" stroke-width="{esc(h*0.011)}"/>'
             f'<path d="M{esc(cx+d*sw*0.98)},{esc(sh+h*0.006)} L{esc(cx+d*ww*1.02)},{esc(hip)}" stroke-width="{esc(h*0.013)}"/>'
             f'<path d="M{esc(cx+d*ww*0.66)},{esc(hip+h*0.01)} L{esc(cx+d*(ww*0.5+stance))},{esc(base-h*0.01)}" stroke-width="{esc(h*0.010)}" opacity=".8"/></g>')
    o.append('</g>')
    return "".join(o)


def sword(cx, base, h, rim, flip=False):
    d = -1.0 if flip else 1.0
    gx = cx + d * h * 0.155
    gy = base - h * 0.60
    tipx, tipy = gx + d * h * 0.10, gy - h * 0.46
    bw = h * 0.016
    return (f'<g><polygon points="{esc(gx-bw)},{esc(gy)} {esc(gx+bw)},{esc(gy)} {esc(tipx+bw*0.35)},{esc(tipy)} {esc(tipx-bw*0.35)},{esc(tipy)}" '
            f'fill="{rim}" opacity=".85"/>'
            f'<rect x="{esc(gx-bw*2.1)}" y="{esc(gy)}" width="{esc(bw*4.2)}" height="{esc(h*0.014)}" fill="{rim}" opacity=".9"/></g>')

def cloaked(cx, base, scale, rim, i, flip=False):
    """A hooded, cloaked figure: head, shoulders, flaring cloak, rim light on one side."""
    s = scale
    hood = f'M{esc(cx-13*s)},{esc(base-96*s)} q{esc(13*s)},{esc(-26*s)} {esc(26*s)},0 q{esc(3*s)},{esc(16*s)} {esc(-2*s)},{esc(22*s)} l{esc(-22*s)},0 q{esc(-5*s)},{esc(-6*s)} {esc(-2*s)},{esc(-22*s)} Z'
    body = (f'M{esc(cx-24*s)},{esc(base-74*s)} q{esc(24*s)},{esc(-12*s)} {esc(48*s)},0 '
            f'C{esc(cx+38*s)},{esc(base-30*s)} {esc(cx+52*s)},{esc(base-6*s)} {esc(cx+46*s)},{esc(base)} '
            f'L{esc(cx-46*s)},{esc(base)} C{esc(cx-52*s)},{esc(base-6*s)} {esc(cx-38*s)},{esc(base-30*s)} {esc(cx-24*s)},{esc(base-74*s)} Z')
    sway = f'M{esc(cx+30*s)},{esc(base-58*s)} q{esc(34*s)},{esc(22*s)} {esc(24*s)},{esc(58*s)} l{esc(-20*s)},{esc(-8*s)} Z'
    if flip: sway = f'M{esc(cx-30*s)},{esc(base-58*s)} q{esc(-34*s)},{esc(22*s)} {esc(-24*s)},{esc(58*s)} l{esc(20*s)},{esc(-8*s)} Z'
    g = f'<g><path d="{body}" fill="url(#fig{i})"/><path d="{sway}" fill="url(#fig{i})"/><path d="{hood}" fill="url(#fig{i})"/>'
    off = -2.5 * s if not flip else 2.5 * s
    g += (f'<g opacity=".9" transform="translate({esc(off)},{esc(-1.5*s)})">'
          f'<path d="{hood}" fill="none" stroke="{rim}" stroke-width="{esc(1.9*s)}" stroke-linejoin="round"/>'
          f'<path d="{body}" fill="none" stroke="{rim}" stroke-width="{esc(1.7*s)}" stroke-linejoin="round" opacity=".8"/></g>')
    g += f'<ellipse cx="{esc(cx)}" cy="{esc(base-86*s)}" rx="{esc(7*s)}" ry="{esc(8*s)}" fill="{rim}" opacity=".55"/></g>'
    return g

def blade(cx, base, scale, rim):
    s = scale
    return (f'<g opacity=".95"><rect x="{esc(cx+40*s)}" y="{esc(base-104*s)}" width="{esc(4*s)}" height="{esc(96*s)}" rx="{esc(2*s)}" '
            f'fill="{rim}" opacity=".75" transform="rotate(9 {esc(cx+42*s)} {esc(base-56*s)})"/></g>')

def cover(idx, rng):
    p = PAL[idx % len(PAL)]
    name, deep, mid, accent, light = p
    i = idx
    kind = ["solo", "duo", "throne", "vista", "portrait"][idx % 5]
    horizon = rng.uniform(H * .60, H * .72)
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">', defs(i, p)]
    s.append(f'<rect width="{W}" height="{H}" fill="url(#sky{i})"/>')
    s.append(f'<ellipse cx="{W*0.5}" cy="{esc(horizon-70)}" rx="{W*0.7}" ry="{H*0.34}" fill="url(#halo{i})"/>')
    s.append(rays(rng, i, accent, W * rng.uniform(.35, .65), horizon - 150))
    # depth layers
    if kind in ("vista", "solo", "duo"):
        s.append(ridge(rng, horizon - 96, 26, deep, .55))
        s.append(spires(rng, horizon - 40, deep, .75))
    if kind == "throne":
        cx = W / 2
        s.append(f'<rect x="{esc(cx-92)}" y="{esc(horizon-250)}" width="184" height="250" fill="{deep}" opacity=".7"/>')
        for k in range(4):
            xx = cx - 70 + k * 47
            s.append(f'<rect x="{esc(xx)}" y="{esc(horizon-232)}" width="16" height="232" fill="#000" opacity=".55"/>')
        s.append(f'<polygon points="{esc(cx-104)},{esc(horizon-250)} {esc(cx)},{esc(horizon-306)} {esc(cx+104)},{esc(horizon-250)}" fill="{deep}" opacity=".8"/>')
    s.append(ridge(rng, horizon - 26, 12, "#000", .55, step=34))
    s.append(f'<rect x="0" y="{esc(horizon)}" width="{W}" height="{esc(H-horizon)}" fill="url(#floor{i})"/>')
    s.append(f'<ellipse cx="{W*0.5}" cy="{esc(horizon+6)}" rx="{W*0.46}" ry="16" fill="{accent}" opacity=".3" filter="url(#soft{i})"/>')
    s.append(particles(rng, 90, light, 0, H, 2.4))
    s.append(f'<rect x="-20" y="{esc(horizon-120)}" width="{W+40}" height="150" fill="{mid}" opacity=".22" filter="url(#mist{i})"/>')
    # subject
    if kind == "duo":
        s.append(person(W * .36, horizon + 14, H * .40, "#06060b", accent))
        s.append(person(W * .63, horizon + 6, H * .33, "#06060b", light, flip=True))
    elif kind == "portrait":
        s.append(person(W * .5, H * 1.02, H * .78, "#06060b", accent))
    elif kind == "vista":
        s.append(person(W * .60, horizon + 8, H * .22, "#06060b", accent))
    elif kind == "throne":
        s.append(person(W * .5, horizon + 10, H * .42, "#06060b", accent))
    else:
        s.append(person(W * .5, horizon + 16, H * .46, "#06060b", accent))
        s.append(sword(W * .5, horizon + 16, H * .46, accent))
    s.append(particles(rng, 26, accent, horizon - 200, horizon + 40, 3.2))
    for _ in range(rng.randint(3, 6)):
        rx0 = rng.uniform(-30, W); rw = rng.uniform(50, 150); rh = rng.uniform(14, 40)
        s.append(f'<path d="M{esc(rx0)},{H} L{esc(rx0+rw*.22)},{esc(H-rh)} L{esc(rx0+rw*.62)},{esc(H-rh*.72)} L{esc(rx0+rw)},{H} Z" fill="#000" opacity=".85"/>')
    s.append(f'<rect width="{W}" height="{H}" fill="url(#vig{i})"/>')
    s.append(f'<rect x="0" y="{H-150}" width="{W}" height="150" fill="url(#band{i})"/>')
    s.append(f'<rect x="24" y="{H-72}" width="{esc(rng.uniform(120,190))}" height="9" rx="4.5" fill="{light}" opacity=".85"/>')
    s.append(f'<rect x="24" y="{H-54}" width="{esc(rng.uniform(70,120))}" height="6" rx="3" fill="{accent}" opacity=".8"/>')
    s.append(f'<rect x="24" y="{H-38}" width="46" height="4" rx="2" fill="{light}" opacity=".35"/>')
    s.append("</svg>")
    return "".join(s)

# ---------------------------------------------------------------- interiors
PW, PH = 900, 1350

def bubble(cx, cy, rx, ry, tail, lines, rng, fill="#fff", ink="#141414"):
    o = [f'<ellipse cx="{esc(cx)}" cy="{esc(cy)}" rx="{esc(rx)}" ry="{esc(ry)}" fill="{fill}" stroke="{ink}" stroke-width="3.2"/>']
    tx, ty = cx + tail[0] * rx * .95, cy + tail[1] * ry * 1.5
    o.append(f'<polygon points="{esc(cx+tail[0]*rx*.42)},{esc(cy+tail[1]*ry*.82)} {esc(cx+tail[0]*rx*.78)},{esc(cy+tail[1]*ry*.6)} {esc(tx)},{esc(ty)}" fill="{fill}" stroke="{ink}" stroke-width="3.2" stroke-linejoin="round"/>')
    o.append(f'<ellipse cx="{esc(cx)}" cy="{esc(cy)}" rx="{esc(rx-2.4)}" ry="{esc(ry-2.4)}" fill="{fill}"/>')
    for k in range(lines):
        w = rx * rng.uniform(.75, 1.35)
        y = cy - (lines - 1) * 10 + k * 20
        o.append(f'<rect x="{esc(cx-w/2)}" y="{esc(y-4)}" width="{esc(w)}" height="7.5" rx="3.5" fill="#2c2c2c" opacity=".85"/>')
    return "".join(o)

def speed(rng, cx, cy, n, colour="#111", rmin=90, rmax=520):
    o = []
    for _ in range(n):
        a = rng.uniform(0, 2 * math.pi)
        r0 = rng.uniform(rmin, rmin * 1.9); r1 = r0 + rng.uniform(rmax * .25, rmax * .7)
        o.append(f'<line x1="{esc(cx+math.cos(a)*r0)}" y1="{esc(cy+math.sin(a)*r0)}" x2="{esc(cx+math.cos(a)*r1)}" y2="{esc(cy+math.sin(a)*r1)}" stroke="{colour}" stroke-width="{esc(rng.uniform(1,3.4))}" stroke-linecap="round" opacity="{esc(rng.uniform(.4,.95))}"/>')
    return "".join(o)

def figure_bw(cx, base, s, ink="#141414", rim="#fff"):
    hood = f'M{esc(cx-13*s)},{esc(base-96*s)} q{esc(13*s)},{esc(-26*s)} {esc(26*s)},0 q{esc(3*s)},{esc(16*s)} {esc(-2*s)},{esc(22*s)} l{esc(-22*s)},0 q{esc(-5*s)},{esc(-6*s)} {esc(-2*s)},{esc(-22*s)} Z'
    body = (f'M{esc(cx-24*s)},{esc(base-74*s)} q{esc(24*s)},{esc(-12*s)} {esc(48*s)},0 '
            f'C{esc(cx+38*s)},{esc(base-30*s)} {esc(cx+54*s)},{esc(base-6*s)} {esc(cx+46*s)},{esc(base)} '
            f'L{esc(cx-46*s)},{esc(base)} C{esc(cx-54*s)},{esc(base-6*s)} {esc(cx-38*s)},{esc(base-30*s)} {esc(cx-24*s)},{esc(base-74*s)} Z')
    return (f'<g><path d="{body}" fill="{ink}"/><path d="{hood}" fill="{ink}"/>'
            f'<g transform="translate({esc(-2.5*s)},{esc(-1.5*s)})" opacity=".95">'
            f'<path d="{hood}" fill="none" stroke="{rim}" stroke-width="{esc(2.2*s)}" stroke-linejoin="round"/>'
            f'<path d="{body}" fill="none" stroke="{rim}" stroke-width="{esc(1.8*s)}" stroke-linejoin="round" opacity=".75"/></g></g>')

LAYOUTS = [
    [(0,0,1,.30),(0,.30,.52,.32),(.52,.30,.48,.32),(0,.62,1,.38)],
    [(0,0,.58,.46),(.58,0,.42,.46),(0,.46,1,.30),(0,.76,.5,.24),(.5,.76,.5,.24)],
    [(0,0,1,.52),(0,.52,.34,.48),(.34,.52,.33,.48),(.67,.52,.33,.48)],
    [(0,0,.46,.34),(.46,0,.54,.34),(0,.34,1,.40),(0,.74,1,.26)],
    [(0,0,1,1)],
    [(0,0,.5,.5),(.5,0,.5,.28),(.5,.28,.5,.22),(0,.5,1,.28),(0,.78,1,.22)],
]

def panel_scene(rng, x, y, w, h, cid, ink, tone, kind):
    o = [f'<clipPath id="{cid}"><rect x="{esc(x)}" y="{esc(y)}" width="{esc(w)}" height="{esc(h)}"/></clipPath>',
         f'<g clip-path="url(#{cid})">']
    if kind == "dark":
        o.append(f'<rect x="{esc(x)}" y="{esc(y)}" width="{esc(w)}" height="{esc(h)}" fill="#15151a"/>')
        o.append(f'<rect x="{esc(x)}" y="{esc(y+h*.5)}" width="{esc(w)}" height="{esc(h*.5)}" fill="url(#{tone})" opacity=".45"/>')
        o.append(person(x + w * .52, y + h * .97, min(h * .74, w * 1.15), "#0d0d10", "#f6f4ee"))
        if w > 240: o.append(bubble(x + w * .28, y + h * .2, min(w * .22, 120), min(h * .11, 52), (1, 1), 2, rng))
    elif kind == "action":
        o.append(f'<rect x="{esc(x)}" y="{esc(y)}" width="{esc(w)}" height="{esc(h)}" fill="#f6f4ee"/>')
        o.append(speed(rng, x + w * .5, y + h * .45, int(90 * min(1, w / 420)), "#161616", min(w, h) * .18, max(w, h)))
        o.append(person(x + w * .5, y + h * .95, min(h * .70, w * 1.05), "#141414", "#f6f4ee"))
        pts = " ".join(f"{esc(x+w*.14+k*(w*.085)+rng.uniform(-12,12))},{esc(y+h*.24+(-30 if k%2 else 30))}" for k in range(9))
        o.append(f'<polygon points="{pts}" fill="#141414" stroke="#f6f4ee" stroke-width="3.5"/>')
    elif kind == "close":
        o.append(f'<rect x="{esc(x)}" y="{esc(y)}" width="{esc(w)}" height="{esc(h)}" fill="#eae7de"/>')
        o.append(f'<rect x="{esc(x)}" y="{esc(y)}" width="{esc(w)}" height="{esc(h*.34)}" fill="url(#{tone})" opacity=".4"/>')
        # eyes-only close-up: the classic reaction framing, cropped by the panel
        cy = y + h * .52
        er = min(h * .17, w * .11)
        o.append(f'<rect x="{esc(x)}" y="{esc(cy-er*2.1)}" width="{esc(w)}" height="{esc(er*4.2)}" fill="#efece3"/>')
        for sgn in (-1, 1):
            ex = x + w * .5 + sgn * w * .21
            o.append(f'<path d="M{esc(ex-er*1.5)},{esc(cy)} q{esc(er*1.5)},{esc(-er*1.45)} {esc(er*3.0)},0 q{esc(-er*1.5)},{esc(er*1.15)} {esc(-er*3.0)},0 Z" fill="#f7f5ef" stroke="#141414" stroke-width="{esc(max(2.6, er*.22))}" stroke-linejoin="round"/>')
            o.append(f'<circle cx="{esc(ex)}" cy="{esc(cy-er*.16)}" r="{esc(er*.62)}" fill="#141414"/>')
            o.append(f'<circle cx="{esc(ex+er*.24)}" cy="{esc(cy-er*.42)}" r="{esc(er*.20)}" fill="#f7f5ef"/>')
            o.append(f'<path d="M{esc(ex-er*1.7)},{esc(cy-er*1.75)} q{esc(er*1.7)},{esc(-er*.85)} {esc(er*3.4)},{esc(er*.10)}" stroke="#141414" stroke-width="{esc(max(3.2, er*.30))}" fill="none" stroke-linecap="round"/>')
        o.append(f'<rect x="{esc(x)}" y="{esc(cy+er*2.1)}" width="{esc(w)}" height="{esc(y+h-(cy+er*2.1))}" fill="url(#{tone})" opacity=".5"/>')
        o.append(speed(rng, x + w * .5, cy, 26, "#141414", max(w, h) * .30, max(w, h) * .55))
        if w > 220: o.append(bubble(x + w * .26, y + h * .8, min(w * .23, 130), min(h * .1, 50), (1, -1), 2, rng))
    else:
        o.append(f'<rect x="{esc(x)}" y="{esc(y)}" width="{esc(w)}" height="{esc(h)}" fill="#e9e6dd"/>')
        o.append(f'<rect x="{esc(x)}" y="{esc(y)}" width="{esc(w)}" height="{esc(h*.62)}" fill="#dcd8cd"/>')
        bx = x
        while bx < x + w:
            bw = rng.uniform(30, 92); bh = rng.uniform(h * .14, h * .46)
            o.append(f'<rect x="{esc(bx)}" y="{esc(y+h*.62-bh)}" width="{esc(bw)}" height="{esc(bh)}" fill="#20222a"/>')
            for r in range(int(bh // 26)):
                o.append(f'<rect x="{esc(bx+6)}" y="{esc(y+h*.62-bh+10+r*26)}" width="{esc(max(4,bw-12))}" height="7" fill="#f6f4ee" opacity=".18"/>')
            bx += bw + rng.uniform(5, 26)
        o.append(f'<rect x="{esc(x)}" y="{esc(y+h*.62)}" width="{esc(w)}" height="{esc(h*.38)}" fill="url(#{tone})" opacity=".4"/>')
        o.append(person(x + w * rng.uniform(.34, .66), y + h * .96, min(h * .62, w * .95), "#141414", "#f6f4ee"))
        if w > 240: o.append(bubble(x + w * .3, y + h * .18, min(w * .24, 140), min(h * .11, 56), (1, 1), 3, rng))
    o.append("</g>")
    o.append(f'<rect x="{esc(x)}" y="{esc(y)}" width="{esc(w)}" height="{esc(h)}" fill="none" stroke="#141414" stroke-width="4.5"/>')
    return "".join(o)

def manga_page(idx, rng):
    lay = LAYOUTS[idx % len(LAYOUTS)]
    M, G = 42, 16
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {PW} {PH}" width="{PW}" height="{PH}">',
         f'''<defs>
<pattern id="t{idx}" width="8" height="8" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r="1.7" fill="#141414"/></pattern>
<pattern id="h{idx}" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(38)"><line x1="0" y1="0" x2="0" y2="9" stroke="#141414" stroke-width="1.5"/></pattern>
</defs>''',
         f'<rect width="{PW}" height="{PH}" fill="#f6f4ee"/>']
    for k, (fx, fy, fw, fh) in enumerate(lay):
        x = M + fx * (PW - 2 * M) + (G / 2 if fx > 0 else 0)
        y = M + fy * (PH - 2 * M) + (G / 2 if fy > 0 else 0)
        w = fw * (PW - 2 * M) - (G / 2 if fx > 0 else 0) - (G / 2 if fx + fw < .999 else 0)
        h = fh * (PH - 2 * M) - (G / 2 if fy > 0 else 0) - (G / 2 if fy + fh < .999 else 0)
        kind = rng.choice(["scene", "scene", "close", "action", "dark"])
        tone = f"t{idx}" if rng.random() < .6 else f"h{idx}"
        s.append(panel_scene(rng, x, y, w, h, f"c{idx}_{k}", "#141414", tone, kind))
    s.append(f'<text x="{PW/2}" y="{PH-14}" text-anchor="middle" font-family="sans-serif" font-size="15" fill="#8a8578">{idx}</text>')
    s.append("</svg>")
    return "".join(s)

SW, SH = 900, 1600
def strip_page(idx, rng):
    p = PAL[(idx * 3) % len(PAL)]
    _, deep, mid, accent, light = p
    i = f"s{idx}"
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SW} {SH}" width="{SW}" height="{SH}">',
         f'''<defs>
<linearGradient id="bg{i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{deep}"/><stop offset="1" stop-color="{mid}"/></linearGradient>
<radialGradient id="gl{i}" cx=".5" cy=".35" r=".7"><stop offset="0" stop-color="{accent}" stop-opacity=".55"/><stop offset="1" stop-color="{accent}" stop-opacity="0"/></radialGradient>
<linearGradient id="fl{i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{accent}" stop-opacity=".3"/><stop offset="1" stop-color="{deep}" stop-opacity="0"/></linearGradient>
<filter id="b{i}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="14"/></filter>
</defs>''',
         f'<rect width="{SW}" height="{SH}" fill="#0b0b10"/>']
    y = 0
    while y < SH - 40:
        ph = min(rng.choice([430, 520, 610, 700]), SH - y)
        inset = rng.choice([0, 0, 34])
        px, pw = inset, SW - inset * 2
        s.append(f'<g><rect x="{esc(px)}" y="{esc(y)}" width="{esc(pw)}" height="{esc(ph)}" fill="url(#bg{i})"/>')
        s.append(f'<ellipse cx="{esc(px+pw*.5)}" cy="{esc(y+ph*.36)}" rx="{esc(pw*.6)}" ry="{esc(ph*.42)}" fill="url(#gl{i})"/>')
        hz = y + ph * .74
        s.append(ridge(rng, hz - 60, 22, deep, .6).replace(f'L{W+20},{H} L-20,{H}', f'L{SW+20},{esc(y+ph)} L-20,{esc(y+ph)}'))
        s.append(f'<rect x="{esc(px)}" y="{esc(hz)}" width="{esc(pw)}" height="{esc(y+ph-hz)}" fill="url(#fl{i})"/>')
        for _ in range(70):
            s.append(f'<circle cx="{esc(rng.uniform(px,px+pw))}" cy="{esc(rng.uniform(y,y+ph))}" r="{esc(rng.uniform(.8,3))}" fill="{light}" opacity="{esc(rng.uniform(.15,.8))}"/>')
        n = rng.choice([1, 1, 2])
        for f in range(n):
            fx = px + pw * ((.36, .66)[f] if n == 2 else rng.uniform(.38, .62))
            s.append(figure_bw(fx, hz + 16, ph / 300, "#07070c", accent))
        if rng.random() < .75:
            s.append(bubble(px + pw * rng.uniform(.28, .68), y + ph * .2, rng.uniform(120, 175), rng.uniform(52, 74), (rng.choice([-1, 1]), 1), rng.choice([2, 3]), rng))
        if rng.random() < .35:
            pts = " ".join(f"{esc(px+pw*.12+k*(pw*.08)+rng.uniform(-14,14))},{esc(y+ph*.52+(-34 if k%2 else 34))}" for k in range(9))
            s.append(f'<polygon points="{pts}" fill="{accent}" stroke="#0b0b10" stroke-width="4"/>')
        s.append("</g>")
        y += ph
    s.append("</svg>")
    return "".join(s)

if __name__ == "__main__":
    import sys
    out_c, out_p = sys.argv[1], sys.argv[2]
    os.makedirs(out_c, exist_ok=True); os.makedirs(out_p, exist_ok=True)
    for n in range(1, 25):
        rng = random.Random(1000 + n)
        open(os.path.join(out_c, f"cover-{n:02d}.svg"), "w").write(cover(n - 1, rng))
    for n in range(1, 9):
        rng = random.Random(2000 + n)
        open(os.path.join(out_p, f"page-m-{n:02d}.svg"), "w").write(manga_page(n, rng))
    for n in range(1, 7):
        rng = random.Random(3000 + n)
        open(os.path.join(out_p, f"page-c-{n:02d}.svg"), "w").write(strip_page(n, rng))
    print("covers", len(os.listdir(out_c)), "pages", len(os.listdir(out_p)))
