from PIL import Image, ImageDraw

BG = (16, 18, 22, 255)       # near-black
GOLD = (198, 156, 74, 255)   # gold accent
GOLD_LIGHT = (226, 190, 120, 255)
PAPER = (235, 230, 218, 255)

def make_icon(size, maskable=False):
    img = Image.new("RGBA", (size, size), BG)
    d = ImageDraw.Draw(img)

    pad = int(size * (0.16 if maskable else 0.10))
    inner = size - 2 * pad

    # Printer body (gold rounded rect)
    body_top = pad + int(inner * 0.32)
    body_h = int(inner * 0.34)
    body_left = pad
    body_right = pad + inner
    d.rounded_rectangle(
        [body_left, body_top, body_right, body_top + body_h],
        radius=int(inner * 0.06), fill=GOLD
    )

    # Paper sticking out top
    paper_w = int(inner * 0.56)
    paper_h = int(inner * 0.26)
    paper_left = pad + (inner - paper_w) // 2
    paper_top = body_top - int(paper_h * 0.55)
    d.rectangle([paper_left, paper_top, paper_left + paper_w, body_top + int(inner*0.06)], fill=PAPER)
    # lines on paper
    line_y = paper_top + int(paper_h * 0.28)
    for i in range(2):
        d.rectangle(
            [paper_left + int(paper_w*0.15), line_y + i*int(paper_h*0.22),
             paper_left + int(paper_w*0.85), line_y + i*int(paper_h*0.22) + max(2, size//64)],
            fill=(90, 70, 30, 255)
        )

    # Paper coming out bottom (printed sheet)
    out_w = int(inner * 0.66)
    out_h = int(inner * 0.30)
    out_left = pad + (inner - out_w) // 2
    out_top = body_top + body_h - int(inner*0.03)
    d.rectangle([out_left, out_top, out_left + out_w, out_top + out_h], fill=PAPER)

    # Control light on printer body
    r = max(3, int(inner * 0.045))
    cx = body_right - int(inner*0.12)
    cy = body_top + int(body_h*0.5)
    d.ellipse([cx-r, cy-r, cx+r, cy+r], fill=GOLD_LIGHT)

    return img

for size, name in [(192, "icon-192.png"), (512, "icon-512.png")]:
    make_icon(size).save(f"icons/{name}")

for size, name in [(192, "icon-maskable-192.png"), (512, "icon-maskable-512.png")]:
    make_icon(size, maskable=True).save(f"icons/{name}")

print("done")
