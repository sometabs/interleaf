import { nativeImage } from 'electron'
import { readFile } from 'fs/promises'

import type { SpineColors } from '../../shared/api'
import { resolveCoverPath } from './covers'

interface Color {
  red: number
  green: number
  blue: number
}

interface ColorSample extends Color {
  weight: number
}

function hex({ red, green, blue }: Color): string {
  return (
    '#' +
    [red, green, blue].map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')
  )
}

function brightness({ red, green, blue }: Color): number {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function chroma({ red, green, blue }: Color): number {
  return Math.max(red, green, blue) - Math.min(red, green, blue)
}

function mutedTone(color: Color, tone: number): string {
  const gray = brightness(color)
  return hex({
    red: tone + (color.red - gray) * 0.27,
    green: tone + (color.green - gray) * 0.27,
    blue: tone + (color.blue - gray) * 0.27
  })
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
      blue: blue / weight,
      weight
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
  // Use a substantial secondary hue when the jacket background is almost gray.
  const hue =
    chroma(base) >= 28
      ? base
      : (ranked.find((color) => chroma(color) >= 42 && color.weight >= base.weight / 8) ?? base)
  const lightness = brightness(base)
  const dark = lightness < 118
  // Keep dark and light cloth tones apart so the spine lettering stays clear.
  const tone = dark ? 69 + (lightness * 37) / 118 : 148 + ((lightness - 118) * 36) / 137
  return {
    cover: mutedTone(hue, tone),
    ink: dark ? '#fffaf2' : '#181615',
    detail: mutedTone(accent ?? hue, tone + (dark ? 52 : -46))
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
