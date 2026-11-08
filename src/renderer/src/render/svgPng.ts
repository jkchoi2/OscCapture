/** Rasterize an SVG string (w×h user units) to PNG bytes at `scale`. */
export async function svgToPng(svg: string, w: number, h: number, scale: number): Promise<Uint8Array> {
  const img = new Image()
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * scale)
  canvas.height = Math.round(h * scale)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG encoding failed'))), 'image/png')
  )
  return new Uint8Array(await blob.arrayBuffer())
}
