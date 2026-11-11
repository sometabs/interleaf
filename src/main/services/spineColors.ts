import { nativeImage } from 'electron'
import { readFile } from 'fs/promises'

import type { SpineColors } from '../../shared/api'
import { resolveCoverPath } from './covers'

interface ColorSample {
  red: number
  green: number
  blue: number
  weight: number
}

function hex(red: number, green: number, blue: number): string {
  return (
    '#' +
    [red, green, blue].map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')
  )
}

function linear(value: number): number {
  const srgb = value / 255
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
}

function colorsFromBitmap(bitmap: Buffer, width: number): SpineColors | null {
  const bins = new Map<number, ColorSample>()
  for (let offset = 0; offset < bitmap.length; offset += 4) {
    // Electron returns BGRA pixels with premultiplied alpha.
    const alpha = bitmap[offset + 3] / 255
    if (alpha < 0.8) continue

    const red = bitmap[offset + 2] / alpha
    const green = bitmap[offset + 1] / alpha
    const blue = bitmap[offset] / alpha
    const x = (offset / 4) % width
    // Favor the edges, where the jacket's background is usually visible.
    const weight = x < width / 5 || x >= (4 * width) / 5 ? 3 : 1
    const key = ((red >> 5) * 8 + (green >> 5)) * 8 + (blue >> 5)
    const bin = bins.get(key) ?? { red: 0, green: 0, blue: 0, weight: 0 }
    bin.red += red * weight
    bin.green += green * weight
    bin.blue += blue * weight
    bin.weight += weight
    bins.set(key, bin)
  }

  const ranked = [...bins.values()]
    .sort((a, b) => b.weight - a.weight)
    .map(({ red, green, blue, weight }) => ({
      red: red / weight,
      green: green / weight,
      blue: blue / weight
    }))
  const base = ranked[0]
  if (!base) return null

  const accent = ranked.find(
    (color) =>
      Math.abs(color.red - base.red) +
        Math.abs(color.green - base.green) +
        Math.abs(color.blue - base.blue) >=
      120
  )
  const luminance =
    0.2126 * linear(base.red) + 0.7152 * linear(base.green) + 0.0722 * linear(base.blue)
  const ink = luminance < 0.18 ? '#ffffff' : '#000000'
  return {
    cover: hex(base.red, base.green, base.blue),
    ink,
    detail: accent ? hex(accent.red, accent.green, accent.blue) : ink
  }
}

export async function getSpineColors(coverPaths: string[]): Promise<Record<string, SpineColors>> {
  const result: Record<string, SpineColors> = {}
  if (!Array.isArray(coverPaths)) return result

  for (const path of new Set(coverPaths)) {
    if (typeof path !== 'string') continue
    const file = resolveCoverPath(path)
    if (!file) continue

    try {
      const image = nativeImage.createFromBuffer(await readFile(file))
      if (image.isEmpty()) continue
      const sample = image.resize({ width: 24, height: 32 })
      const colors = colorsFromBitmap(sample.toBitmap(), sample.getSize().width)
      if (colors) result[path] = colors
    } catch {
      // A missing or unreadable jacket can still use the generated spine.
    }
  }
  return result
}
