#!/usr/bin/env python3
"""立绘抠底 v3：cv2.grabCut（矩形初始化）+ 最大连通域 + 羽化，输出干净人物（无烘焙阴影）"""
from PIL import Image, ImageFilter
import numpy as np
import cv2
from scipy import ndimage
import os

# (src, dst, watermark_x0, target_h, shoe_box, gap_clear, edge_bottom, bottom_cut)
JOBS = [
    ("/home/z/my-project/upload/1792730583646.png", "/home/z/my-project/public/couple-home/char-me-real.png", 0.72, 640, (0.36, 0.92, 0.63, 0.99), (0.475, 0.93, 0.52, 0.999), False, None),
    ("/home/z/my-project/upload/1792730661556.png", "/home/z/my-project/public/couple-home/char-ta-real.png", 0.74, 640, (0.29, 0.855, 0.68, 0.985), (0.452, 0.86, 0.545, 0.952), True, 0.913),
    ("/home/z/my-project/upload/1792385383439.png", "/home/z/my-project/public/couple-home/char-me-cartoon.png", 0.72, 560, (0.34, 0.93, 0.66, 0.99), None, False, None),
    ("/home/z/my-project/upload/1792385908654.png", "/home/z/my-project/public/couple-home/char-ta-cartoon.png", 0.74, 560, (0.27, 0.875, 0.71, 0.94), None, False, None),
]

def process(src, dst, wm_x0, target_h, shoe_box, gap_clear, edge_bottom, bottom_cut):
    im = Image.open(src).convert("RGB")
    if im.height > 1100:
        s = 1100 / im.height
        im = im.resize((round(im.width * s), 1100), Image.LANCZOS)
    a = np.asarray(im)
    H, W = a.shape[:2]

    # ---- grabCut：矩形初始化 ----
    rgb = cv2.cvtColor(a, cv2.COLOR_RGB2BGR).astype(np.uint8)
    mask = np.zeros((H, W), np.uint8)
    x0, y0 = int(W * 0.10), int(H * 0.015)
    rect = (x0, y0, int(W * 0.80), int(H * 0.965))
    cv2.grabCut(rgb, mask, rect, None, None, 5, cv2.GC_INIT_WITH_RECT)
    binary1 = (mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD)

    # ---- 第二遍：鞋部救援（仅写实两张；Q 版白底无此问题） ----
    sx0, sy0, sx1, sy1 = shoe_box
    box = np.zeros((H, W), bool)
    box[int(H * sy0):int(H * sy1), int(W * sx0):int(W * sx1)] = True
    lum = a.astype(np.float32).mean(axis=-1) / 255.0
    if shoe_box is not None and "real" in dst:
        m2 = np.full((H, W), cv2.GC_PR_BGD, np.uint8)
        m2[binary1] = cv2.GC_PR_FGD
        m2[box] = cv2.GC_PR_FGD
        m2[box & (lum > 0.9)] = cv2.GC_FGD
        cv2.grabCut(rgb, m2, None, None, None, 5, cv2.GC_INIT_WITH_MASK)
        mask = m2
        binary = (mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD)
    else:
        binary = binary1

    # ---- 鞋盒内清理：写实男用边缘法（鞋与地板同亮度）；其余用亮度带法 ----
    if edge_bottom:
        gb = np.asarray(Image.fromarray((lum * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(4.0))).astype(np.float32)
        sx = ndimage.sobel(gb, axis=1)
        sy = ndimage.sobel(gb, axis=0)
        grad = np.hypot(sx, sy)
        core = box & ((grad > 6.0) | (lum < 0.8))  # 鞋轮廓/阴影细节（强预模糊压掉地板颗粒）
        keep = ndimage.binary_dilation(core, iterations=4)
        binary &= ~box | keep
    else:
        sure = box & (lum > 0.9)
        protect = ndimage.binary_dilation(sure, iterations=12)
        lowsat = (a.max(axis=-1).astype(np.float32) - a.min(axis=-1)) < 14
        floorish = box & (lum > 0.79) & (lum < 0.945) & lowsat & ~protect
        binary &= ~floorish
    if gap_clear:
        gx0, gy0, gx1, gy1 = gap_clear
        gap = np.zeros((H, W), bool)
        gap[int(H * gy0):int(H * gy1), int(W * gx0):int(W * gx1)] = True
        binary &= ~gap
        box &= ~gap
    if bottom_cut:
        cut = int(H * bottom_cut)
        binary[cut:, :] = False

    # 边框 3px 强制背景（grabCut 矩形外本来就是 BG，保险）
    binary[:3, :] = binary[-3:, :] = False
    binary[:, :3] = binary[:, -3:] = False

    # ---- 最大连通域（含种子） + 填洞 ----
    binary = ndimage.binary_closing(binary, structure=np.ones((5, 5)))
    seed_y, seed_x = int(H * 0.45), int(W * 0.5)
    if not binary[seed_y, seed_x]:
        for dy in range(1, int(H * 0.35)):
            for sy in (seed_y - dy, seed_y + dy):
                if 0 <= sy < H and binary[sy, seed_x]:
                    seed_y = sy
                    break
            else:
                continue
            break
    lab, _ = ndimage.label(binary)
    binary = lab == lab[seed_y, seed_x]
    binary = ndimage.binary_fill_holes(binary)

    # ---- alpha：内部实心 + 边缘 grabCut 概率羽化 ----
    alpha = binary.astype(np.float32)
    edge = ndimage.binary_dilation(binary, iterations=3) & ~ndimage.binary_erosion(binary, iterations=3)
    # 边缘带用轻微模糊过渡
    ea = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.4))).astype(np.float32) / 255.0
    alpha = np.where(edge, ea, alpha)

    # ---- 清水印角 ----
    yy, xx = np.mgrid[0:H, 0:W]
    wm = (xx > W * wm_x0) & (yy > H * 0.945)
    alpha[wm] = 0
    if gap_clear:
        alpha[gap] = 0
    if bottom_cut:
        alpha[cut:, :] = 0
    # 清 grabCut 可能残留的散点（主域外清零）
    lab2, _ = ndimage.label(alpha > 0.05)
    keep_ids = set(np.unique(lab2[binary | edge]))
    ids, counts = np.unique(lab2, return_counts=True)
    for i, c in zip(ids, counts):
        if i == 0 or i in keep_ids:
            continue
        if c < H * W * 0.004:
            alpha[lab2 == i] = 0

    # ---- 裁剪 + 缩放 + 导出 ----
    ys, xs = np.where(alpha > 0.02)
    pad = 8
    cy0, cy1 = max(0, ys.min() - pad), min(H, ys.max() + pad)
    cx0, cx1 = max(0, xs.min() - pad), min(W, xs.max() + pad)
    rgba = np.dstack([a, (alpha * 255).astype(np.uint8)])
    out = Image.fromarray(rgba).crop((cx0, cy0, cx1, cy1))
    scale = target_h / out.height
    out = out.resize((max(1, round(out.width * scale)), target_h), Image.LANCZOS)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    out.save(dst)

    bgc = Image.new("RGBA", out.size, (255, 0, 255, 255))
    prev = Image.alpha_composite(bgc, out).convert("RGB")
    prev.save(f"/home/z/my-project/.tmp-scripts/preview_{os.path.basename(dst)}.jpg", quality=90)
    print(f"OK {os.path.basename(dst)}  {out.size}")

for src, dst, wm, th, sb, gc, eb, bc in JOBS:
    process(src, dst, wm, th, sb, gc, eb, bc)
print("ALL DONE")
