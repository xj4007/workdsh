/** Generate native tray bitmaps from the repository-owned brand SVG. */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const buildRoot = join(packageRoot, 'build')
const sourcePath = join(buildRoot, 'tray-icon.svg')
const source = await readFile(sourcePath)

const variants = [
  ['tray-iconTemplate.png', 16, true],
  ['tray-iconTemplate@2x.png', 32, true],
  ['tray-icon-blue.png', 16, false],
  ['tray-icon-blue@1.25x.png', 20, false],
  ['tray-icon-blue@1.5x.png', 24, false],
  ['tray-icon-blue@2x.png', 32, false],
]

await Promise.all(variants.map(async ([filename, size, template]) => {
  const rendered = sharp(source, { failOn: 'warning' })
    .resize({ width: size, height: size, fit: 'contain', background: 'transparent' })
  // macOS template images use the alpha channel to draw the system tint.
  if (template) rendered.linear(0, 0)
  await rendered.png({ compressionLevel: 9 }).toFile(join(buildRoot, filename))
}))
