/**
 * 裁剪器的纯几何换算（无 DOM 依赖，便于单测）。
 *
 * 约定：`rotation` 是顺时针旋转的 90° 次数，取值 0..3。
 * 旋转只影响「显示」和最终编码，原图位图本身始终不动 —— 这样转图不用重新编码。
 */

export interface Rect { x: number; y: number; w: number; h: number }

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function normRotation(rotation: number): number {
  return ((Math.round(rotation) % 4) + 4) % 4
}

/** 旋转后的显示尺寸（奇数次旋转宽高互换）。 */
export function rotatedSize(w: number, h: number, rotation: number): { w: number; h: number } {
  return normRotation(rotation) % 2 === 0 ? { w, h } : { w: h, h: w }
}

/**
 * 把 stage 上的选区换算成「旋转后坐标系」的图片像素。
 * `img` 是图片在 stage 上的显示矩形，`imageW/imageH` 是旋转后的像素尺寸。
 */
export function stageRectToImage(crop: Rect, img: Rect, imageW: number, imageH: number): Rect {
  if (img.w <= 0 || img.h <= 0 || imageW <= 0 || imageH <= 0) return { x: 0, y: 0, w: 0, h: 0 }
  const kx = imageW / img.w
  const ky = imageH / img.h
  const x = clamp((crop.x - img.x) * kx, 0, imageW)
  const y = clamp((crop.y - img.y) * ky, 0, imageH)
  const w = clamp(crop.w * kx, 0, imageW - x)
  const h = clamp(crop.h * ky, 0, imageH - y)
  return { x, y, w, h }
}

/**
 * 把「旋转后坐标系」的矩形反算回原图像素坐标。
 * 90° 的整数倍旋转下，轴对齐矩形映射过去仍是轴对齐矩形，所以只需换边 + 翻转。
 *
 * 像素映射（原图坐标 u,v → 显示坐标 x,y）：
 *   0: x=u,        y=v
 *   1: x=H-1-v,    y=u
 *   2: x=W-1-u,    y=H-1-v
 *   3: x=v,        y=W-1-u
 */
export function unrotateRect(rect: Rect, rotation: number, srcW: number, srcH: number): Rect {
  const r = normRotation(rotation)
  let out: Rect
  switch (r) {
    case 1: out = { x: rect.y, y: srcH - rect.x - rect.w, w: rect.h, h: rect.w }; break
    case 2: out = { x: srcW - rect.x - rect.w, y: srcH - rect.y - rect.h, w: rect.w, h: rect.h }; break
    case 3: out = { x: srcW - rect.y - rect.h, y: rect.x, w: rect.h, h: rect.w }; break
    default: out = { x: rect.x, y: rect.y, w: rect.w, h: rect.h }
  }
  const x = clamp(out.x, 0, srcW)
  const y = clamp(out.y, 0, srcH)
  const w = clamp(out.w, 0, srcW - x)
  const h = clamp(out.h, 0, srcH - y)
  return { x, y, w, h }
}

/** 等比缩放后居中铺进容器；`allowUpscale` 为 false 时不放大。 */
export function fitRect(containerW: number, containerH: number, w: number, h: number, allowUpscale = false): Rect {
  if (w <= 0 || h <= 0 || containerW <= 0 || containerH <= 0) return { x: 0, y: 0, w: 0, h: 0 }
  const scale = Math.min(containerW / w, containerH / h, allowUpscale ? Infinity : 1)
  const dw = w * scale
  const dh = h * scale
  return { x: (containerW - dw) / 2, y: (containerH - dh) / 2, w: dw, h: dh }
}
