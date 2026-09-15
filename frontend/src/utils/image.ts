/**
 * 手机上传照片优化：客户端压缩 + 转 JPEG。
 * 手机相机原图动辄 3-10MB，上传慢、占存储；这里在浏览器端用 canvas
 * 把最长边缩到 maxDim、转 JPEG 压缩到 quality，体积通常降到 200-500KB。
 * 零依赖，纯原生 API。
 */

const SMALL_IMAGE_BYTES = 300 * 1024 // 小于 300KB 的图直接返回，不再压缩

export async function compressImage(file: File, maxDim = 1600, quality = 0.82): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  if (file.size < SMALL_IMAGE_BYTES) return file

  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('图片解码失败'))
      image.src = url
    })
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
    if (scale >= 1 && file.size < 500 * 1024) return file

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.width * scale))
    canvas.height = Math.max(1, Math.round(img.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!blob || blob.size >= file.size) return file

    const base = file.name.replace(/\.[^.]+$/, '') || 'photo'
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' })
  } catch {
    return file
  } finally {
    URL.revokeObjectURL(url)
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
