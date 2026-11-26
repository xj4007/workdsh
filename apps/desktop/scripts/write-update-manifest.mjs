#!/usr/bin/env node

/** Write the static update manifest (latest.json) for the packaged Windows installer. */

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
const downloadBaseUrl = 'https://sanyunbuddy.sycjlht.com/desktop'

async function readTarget() {
  const version = JSON.parse(await readFile(resolve(desktopRoot, 'package.json'), 'utf8')).version
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('apps/desktop/package.json must record a version')
  }
  // Matches build.nsis.artifactName in apps/desktop/package.json and build.win.target arch x64.
  const fileName = `SanyunBuddy-${version}-x64-Setup.exe`
  return {
    version,
    installer: resolve(desktopRoot, 'dist', fileName),
    manifestPath: resolve(desktopRoot, 'dist', 'latest.json'),
    url: `${downloadBaseUrl}/${fileName}`,
  }
}

/** Write dist/latest.json describing the packaged installer; returns the manifest. */
export async function writeUpdateManifest() {
  const { version, installer, manifestPath, url } = await readTarget()
  const bytes = await readFile(installer).catch((error) => {
    throw new Error(
      `Cannot read ${installer}; build the Windows installer first with "corepack yarn dist:win" (${error.code ?? error.message})`,
      { cause: error },
    )
  })
  const manifest = {
    version,
    url,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.byteLength,
    notes: '',
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Wrote ${manifestPath} for 三云Buddy ${version} (${manifest.size} bytes, sha256 ${manifest.sha256})`)
  console.log(`Upload ${installer} first, then ${manifestPath}, to the server's /desktop/ static directory.`)
  console.log(`Clients read ${downloadBaseUrl}/latest.json`)
  return manifest
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await writeUpdateManifest()
}
