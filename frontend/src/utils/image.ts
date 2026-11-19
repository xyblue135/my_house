/**
 * 手机上传照片优化：客户端压缩 + 转 JPEG。
 * 手机相机原图动辄 3-10MB，上传慢、占存储；这里在浏览器端用 canvas
 * 把最长边缩到 maxDim、转 JPEG 压缩到 quality，体积通常降到 200-500KB。
 * 零依赖，纯原生 API。
 */

const SMALL_IMAGE_BYTES = 300 * 1024 // 小于 300KB 的图直接返回，不再压缩

/** 解码成 ImageBitmap（内核线程解码，不卡 UI）；老内核回退 <img> */
async function decodeImage(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' })
  } catch { /* 回退 */ }
  const url = URL.createObjectURL(blob)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('图片解码失败'))
      image.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

function closeBitmap(src: ImageBitmap | HTMLImageElement) {
  if (typeof (src as ImageBitmap).close === 'function') {
    try { (src as ImageBitmap).close() } catch { /* ignore */ }
  }
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
}

export async function compressImage(file: File, maxDim = 1600, quality = 0.82): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  // 纠正 EXIF 的同时顺手缩到 maxDim，一次编码解决（以前是「全尺寸重编码 + 再压一次」，慢还费内存）
  const oriented = await orientAndScale(file, maxDim, quality)
  file = oriented.file
  if (oriented.encoded) return file
  if (file.size < SMALL_IMAGE_BYTES) return file

  let src: ImageBitmap | HTMLImageElement | null = null
  try {
    src = await decodeImage(file)
    const scale = Math.min(1, maxDim / Math.max(src.width, src.height))
    if (scale >= 1 && file.size < 500 * 1024) return file

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(src.width * scale))
    canvas.height = Math.max(1, Math.round(src.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height)

    const blob = await canvasToJpeg(canvas, quality)
    if (!blob || blob.size >= file.size) return file

    const base = file.name.replace(/\.[^.]+$/, '') || 'photo'
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' })
  } catch {
    return file
  } finally {
    if (src) closeBitmap(src)
  }
}

/** 把已选的 File 批量压缩（图片才压，非图片原样保留）。 */
export async function compressFiles(files: File[]): Promise<File[]> {
  return Promise.all(files.map(f => compressImage(f)))
}

/** 生成预览 URL（缩略图显示用），返回 { url, revoke } 以便释放。 */
export function objectUrl(file: File): string {
  return URL.createObjectURL(file)
}

/**
 * 零依赖解析 JPEG 的 EXIF Orientation（1-8，1 表示无需旋转）。
 * 只读文件头前 256KB，找不到 EXIF 或非 JPEG 返回 1。
 */
export async function readExifOrientation(file: File): Promise<number> {
  if (file.type !== 'image/jpeg') return 1
  try {
    const buf = await file.slice(0, 256 * 1024).arrayBuffer()
    const view = new DataView(buf)
    if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return 1
    let offset = 2
    while (offset + 4 <= view.byteLength) {
      if (view.getUint8(offset) !== 0xff) return 1
      const marker = view.getUint8(offset + 1)
      if (marker === 0xe1 && view.getUint32(offset + 4, false) === 0x45786966) {
        const tiff = offset + 10
        const little = view.getUint16(tiff, false) === 0x4949
        if (view.getUint16(tiff + 2, little) !== 0x002a) return 1
        const ifd0 = tiff + 4 + view.getUint32(tiff + 4, little)
        const count = view.getUint16(ifd0, little)
        for (let i = 0; i < count; i++) {
          const entry = ifd0 + 2 + i * 12
          if (entry + 12 > view.byteLength) break
          if (view.getUint16(entry, little) === 0x0112) {
            const o = view.getUint16(entry + 8, little)
            return o >= 1 && o <= 8 ? o : 1
          }
        }
        return 1
      }
      if (marker === 0xda || marker === 0xd9) return 1
      offset += 2 + view.getUint16(offset + 2, false)
    }
    return 1
  } catch {
    return 1
  }
}

/**
 * 按 EXIF Orientation 把图片方向纠正为"视觉正确"，顺带缩到 maxDim 并编码成 JPEG。
 * 用 createImageBitmap(imageOrientation:'none') 拿原始像素，再用 canvas 手动变换，
 * 避免依赖浏览器对 EXIF 的不同处理（老 WebView 可能不纠正导致竖拍横着）。
 * 变换矩阵参照 blueimp/JavaScript-Load-Image 的已验证实现。
 *
 * 以前这里按原分辨率、q=0.95 重编码一次，1200 万像素照片在手机上要好几秒；
 * 现在缩放和旋转一次做完 —— 反正后续一定要缩到 1600，没有理由先存一份全尺寸 JPEG。
 */
async function orientAndScale(file: File, maxDim: number, quality: number): Promise<{ file: File; encoded: boolean }> {
  if (file.type !== 'image/jpeg') return { file, encoded: false }
  const orientation = await readExifOrientation(file)
  if (orientation <= 1) return { file, encoded: false }
  let bmp: ImageBitmap | null = null
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'none' })
    const w = bmp.width
    const h = bmp.height
    const scale = Math.min(1, maxDim / Math.max(w, h))
    const dw = Math.max(1, Math.round(w * scale))
    const dh = Math.max(1, Math.round(h * scale))
    const swap = orientation >= 5
    const canvas = document.createElement('canvas')
    canvas.width = swap ? dh : dw
    canvas.height = swap ? dw : dh
    const ctx = canvas.getContext('2d')
    if (!ctx) return { file, encoded: false }
    ctx.imageSmoothingQuality = 'high'
    // 先把坐标系按缩放比例缩好，下面的矩阵就仍可按原图坐标书写
    ctx.scale(scale, scale)
    switch (orientation) {
      case 2: ctx.transform(-1, 0, 0, 1, w, 0); break
      case 3: ctx.transform(-1, 0, 0, -1, w, h); break
      case 4: ctx.transform(1, 0, 0, -1, 0, h); break
      case 5: ctx.transform(0, 1, 1, 0, 0, 0); break
      case 6: ctx.transform(0, 1, -1, 0, h, 0); break
      case 7: ctx.transform(0, -1, -1, 0, h, w); break
      case 8: ctx.transform(0, -1, 1, 0, 0, w); break
    }
    ctx.drawImage(bmp, 0, 0)
    const blob = await canvasToJpeg(canvas, quality)
    if (!blob) return { file, encoded: false }
    return { file: new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }), encoded: true }
  } catch {
    return { file, encoded: false }
  } finally {
    if (bmp) closeBitmap(bmp)
  }
}

/** 兼容旧调用：只纠正方向（默认也缩到 maxDim）。 */
export async function fixImageOrientation(file: File, maxDim = 1600, quality = 0.9): Promise<File> {
  return (await orientAndScale(file, maxDim, quality)).file
}
