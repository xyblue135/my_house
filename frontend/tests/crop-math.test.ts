import { describe, expect, it } from 'vitest'
import { fitRect, rotatedSize, stageRectToImage, unrotateRect, type Rect } from '../src/utils/cropMath'

const W = 4000
const H = 3000

describe('rotatedSize', () => {
  it('奇数次旋转宽高互换', () => {
    expect(rotatedSize(W, H, 0)).toEqual({ w: 4000, h: 3000 })
    expect(rotatedSize(W, H, 1)).toEqual({ w: 3000, h: 4000 })
    expect(rotatedSize(W, H, 2)).toEqual({ w: 4000, h: 3000 })
    expect(rotatedSize(W, H, 3)).toEqual({ w: 3000, h: 4000 })
  })

  it('负数和超过 4 的旋转值会归一化', () => {
    expect(rotatedSize(W, H, -1)).toEqual({ w: 3000, h: 4000 })
    expect(rotatedSize(W, H, 4)).toEqual({ w: 4000, h: 3000 })
    expect(rotatedSize(W, H, 5)).toEqual({ w: 3000, h: 4000 })
  })
})

describe('stageRectToImage', () => {
  const img: Rect = { x: 10, y: 20, w: 400, h: 300 }

  it('铺满显示区时换算成整张图', () => {
    expect(stageRectToImage(img, img, W, H)).toEqual({ x: 0, y: 0, w: 4000, h: 3000 })
  })

  it('按比例换算位置与尺寸', () => {
    // 显示区 400px 宽对应 4000px，放大 10 倍
    expect(stageRectToImage({ x: 10, y: 20, w: 200, h: 150 }, img, W, H))
      .toEqual({ x: 0, y: 0, w: 2000, h: 1500 })
    expect(stageRectToImage({ x: 110, y: 170, w: 100, h: 150 }, img, W, H))
      .toEqual({ x: 1000, y: 1500, w: 1000, h: 1500 })
  })

  it('超出图片范围的部分被夹回去', () => {
    const r = stageRectToImage({ x: -50, y: -50, w: 500, h: 400 }, img, W, H)
    expect(r.x).toBe(0)
    expect(r.y).toBe(0)
    expect(r.w).toBe(4000)
    expect(r.h).toBe(3000)
  })

  it('显示区为 0 时不会算出 NaN', () => {
    expect(stageRectToImage({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 0, h: 0 }, W, H))
      .toEqual({ x: 0, y: 0, w: 0, h: 0 })
  })
})

describe('unrotateRect', () => {
  it('不旋转时原样返回', () => {
    expect(unrotateRect({ x: 1, y: 2, w: 3, h: 4 }, 0, W, H)).toEqual({ x: 1, y: 2, w: 3, h: 4 })
  })

  it('整图选区在任意旋转下都还原成整图', () => {
    expect(unrotateRect({ x: 0, y: 0, w: H, h: W }, 1, W, H)).toEqual({ x: 0, y: 0, w: W, h: H })
    expect(unrotateRect({ x: 0, y: 0, w: W, h: H }, 2, W, H)).toEqual({ x: 0, y: 0, w: W, h: H })
    expect(unrotateRect({ x: 0, y: 0, w: H, h: W }, 3, W, H)).toEqual({ x: 0, y: 0, w: W, h: H })
  })

  it('顺时针 90° 后显示区左上角对应原图左下角', () => {
    // 顺时针转 90°：原图左下角转到显示区左上角
    const r = unrotateRect({ x: 0, y: 0, w: 100, h: 200 }, 1, W, H)
    expect(r).toEqual({ x: 0, y: H - 100, w: 200, h: 100 })
  })

  it('逆时针 90° 后显示区左上角对应原图右上角', () => {
    const r = unrotateRect({ x: 0, y: 0, w: 100, h: 200 }, 3, W, H)
    expect(r).toEqual({ x: W - 200, y: 0, w: 200, h: 100 })
  })

  it('旋转 180° 是中心对称', () => {
    const r = unrotateRect({ x: 0, y: 0, w: 100, h: 100 }, 2, W, H)
    expect(r).toEqual({ x: W - 100, y: H - 100, w: 100, h: 100 })
  })

  it('反算与正算互为逆运算（任意旋转）', () => {
    // 把原图矩形按顺时针 r 转过去，再按 4-r 转回来，应回到原处
    const forward: Record<number, (r: Rect) => Rect> = {
      1: (r) => ({ x: H - r.y - r.h, y: r.x, w: r.h, h: r.w }),
      2: (r) => ({ x: W - r.x - r.w, y: H - r.y - r.h, w: r.w, h: r.h }),
      3: (r) => ({ x: r.y, y: W - r.x - r.w, w: r.h, h: r.w }),
    }
    const src: Rect = { x: 500, y: 700, w: 800, h: 600 }
    for (const r of [1, 2, 3]) {
      const shown = forward[r](src)
      const back = unrotateRect(shown, r, W, H)
      expect(back).toEqual(src)
    }
  })

  it('结果始终落在原图范围内', () => {
    const r = unrotateRect({ x: -20, y: 9999, w: 500, h: 300 }, 1, W, H)
    expect(r.x).toBeGreaterThanOrEqual(0)
    expect(r.y).toBeGreaterThanOrEqual(0)
    expect(r.x + r.w).toBeLessThanOrEqual(W)
    expect(r.y + r.h).toBeLessThanOrEqual(H)
  })
})

describe('fitRect', () => {
  it('大图等比缩小并居中', () => {
    expect(fitRect(400, 300, 4000, 3000)).toEqual({ x: 0, y: 0, w: 400, h: 300 })
    expect(fitRect(400, 300, 4000, 2000)).toEqual({ x: 0, y: 50, w: 400, h: 200 })
  })

  it('默认不放大、居中留白', () => {
    expect(fitRect(400, 300, 100, 100)).toEqual({ x: 150, y: 100, w: 100, h: 100 })
  })

  it('允许放大时铺满短边', () => {
    expect(fitRect(400, 300, 100, 100, true)).toEqual({ x: 50, y: 0, w: 300, h: 300 })
  })

  it('非法尺寸返回全 0', () => {
    expect(fitRect(0, 0, 100, 100)).toEqual({ x: 0, y: 0, w: 0, h: 0 })
  })
})
