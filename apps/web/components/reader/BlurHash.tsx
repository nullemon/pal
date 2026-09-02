'use client'

import { decode } from 'blurhash'
import { useEffect, useRef } from 'react'

const SIZE = 32

/** A 32×32 BlurHash decode painted onto a canvas that CSS stretches under the page. */
export function BlurHash({ hash, className }: { hash: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    try {
      const pixels = decode(hash, SIZE, SIZE)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const image = ctx.createImageData(SIZE, SIZE)
      image.data.set(pixels)
      ctx.putImageData(image, 0, 0)
    } catch {
      // a malformed hash just leaves the flat placeholder
    }
  }, [hash])
  return <canvas ref={ref} width={SIZE} height={SIZE} className={className} />
}
