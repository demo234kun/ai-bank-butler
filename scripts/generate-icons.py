from PIL import Image, ImageDraw, ImageFilter
import math, os

OUT = 'apps/web/public/icons'
os.makedirs(OUT, exist_ok=True)
SCALE = 4
GREEN = (15, 61, 51)
GREEN_DARK = (8, 34, 28)
GOLD = (199, 166, 103)
GOLD_LIGHT = (227, 207, 165)

def rounded_bg(size, radius, padding=0):
    img = Image.new('RGBA', (size, size), (0,0,0,0))
    d = ImageDraw.Draw(img)
    # vertical gradient background
    for y in range(size):
        t = y / max(1, size-1)
        c = tuple(int(GREEN[i]*(1-t) + GREEN_DARK[i]*t) for i in range(3)) + (255,)
        d.line([(0,y),(size,y)], fill=c)
    # warm glow top-right
    glow = Image.new('RGBA', (size, size), (0,0,0,0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([size*0.48, -size*0.28, size*1.12, size*0.42], fill=(199,166,103,52))
    glow = glow.filter(ImageFilter.GaussianBlur(size*0.08))
    img = Image.alpha_composite(img, glow)
    if padding:
        mask = Image.new('L', (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle([padding,padding,size-padding,size-padding], radius=radius, fill=255)
        img.putalpha(mask)
    return img

def draw_mark(size, safe=0.16):
    img = rounded_bg(size, int(size*0.22))
    d = ImageDraw.Draw(img)
    s = size
    cx, cy = s/2, s/2
    pad = s*safe
    # outer thin ring
    r = (s - pad*2)/2
    d.ellipse([cx-r, cy-r, cx+r, cy+r], outline=(199,166,103,120), width=max(2, int(s*0.008)))
    # arch
    arch_w = s*0.46
    arch_h = s*0.30
    top = cy - s*0.17
    d.arc([cx-arch_w/2, top-arch_h/2, cx+arch_w/2, top+arch_h/2], 180, 360, fill=GOLD_LIGHT, width=max(4, int(s*0.022)))
    # columns
    col_w = max(5, int(s*0.024))
    gap = arch_w*0.28
    left = cx - gap
    right = cx + gap
    base_y = cy + s*0.14
    d.line([(left, top), (left, base_y)], fill=GOLD, width=col_w)
    d.line([(cx, top), (cx, base_y)], fill=GOLD, width=col_w)
    d.line([(right, top), (right, base_y)], fill=GOLD, width=col_w)
    # base line
    d.rounded_rectangle([cx-arch_w/2, base_y, cx+arch_w/2, base_y+max(6,int(s*0.03))], radius=max(2,int(s*0.012)), fill=GOLD_LIGHT)
    # star/dot
    d.ellipse([cx-s*0.026, top-s*0.11, cx+s*0.026, top-s*0.058], fill=GOLD_LIGHT)
    return img

# main icons (full bleed background but rounded? PWA icons can be full square ; keep rounded via alpha for apple)
for size in (512, 192, 180, 64, 32):
    img = draw_mark(size)
    img.save(f'{OUT}/icon-{size}.png')

# maskable: full square, extra safe area
mask = draw_mark(512, safe=0.23)
full = Image.new('RGBA', (512,512), GREEN + (255,))
full.alpha_composite(mask)
full.save(f'{OUT}/maskable-512.png')
print('icons generated')
