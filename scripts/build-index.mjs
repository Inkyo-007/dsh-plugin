#!/usr/bin/env node
/**
 * Generate index.json (DSH plugin market index, format 1) for this repository.
 *
 * Every directory in the repo root whose package.json declares `dsh.bundle`
 * becomes one plugin entry, with a Git source pinned to the current HEAD
 * commit. Display metadata comes from the bundle's locale/*.json files,
 * falling back to package.json fields.
 *
 * Usage:
 *   node scripts/build-index.mjs [--repo <https-url>]
 *
 * The repository URL defaults to the `origin` remote. The generated index
 * must be served from a redirect-free https URL, e.g.:
 *   https://raw.githubusercontent.com/<owner>/<repo>/main/index.json
 */
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname

function arg(flag) {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function git(...args) {
  return execSync(`git ${args.join(' ')}`, { cwd: root, encoding: 'utf8' }).trim()
}

let repo = arg('--repo') ?? process.env.DSH_INDEX_REPO
if (!repo) {
  try {
    repo = git('remote get-url origin')
  } catch {
    console.error('error: no --repo given, $DSH_INDEX_REPO unset, and no origin remote configured')
    process.exit(1)
  }
}
// Normalize to canonical https form: strip credentials, .git suffix, trailing slash.
repo = repo.replace(/^git@([^:]+):/, 'https://$1/').replace(/\.git$/, '').replace(/\/$/, '')

const commit = git('rev-parse HEAD')
const publishTimestamp = Number(git('log -1 --format=%ct'))

function readJson(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined
}

/** Merge locale/<lang>.json meta fields into a localized text object; undefined if no locale provides it. */
function localized(dir, field, fallback) {
  const text = {}
  const localeDir = join(root, dir, 'locale')
  if (existsSync(localeDir)) {
    for (const file of readdirSync(localeDir)) {
      const match = /^([a-z]{2,8}(?:-[a-z0-9]{1,8})*)\.json$/i.exec(file)
      if (!match) continue
      const value = readJson(join(localeDir, file))?.meta?.[field]
      if (typeof value === 'string' && value.trim()) text[match[1].toLowerCase()] = value
    }
  }
  if (!text.en && fallback) text.en = fallback
  return text.en ? text : undefined
}

const plugins = []
for (const dir of readdirSync(root, { withFileTypes: true })) {
  if (!dir.isDirectory() || dir.name.startsWith('.') || dir.name === 'node_modules' || dir.name === 'origin') continue
  const manifest = readJson(join(root, dir.name, 'package.json'))
  if (!manifest?.dsh?.bundle?.patch) continue

  const entry = {
    name: manifest.name,
    ...localized(dir.name, 'title') ? { title: localized(dir.name, 'title') } : {},
    ...localized(dir.name, 'description', manifest.description)
      ? { description: localized(dir.name, 'description', manifest.description) }
      : {},
    ...existsSync(join(root, dir.name, 'icon.svg')) ? { icon: `${dir.name}/icon.svg` } : {},
    repository: { url: repo, directory: dir.name },
    ...Array.isArray(manifest.keywords) && manifest.keywords.length
      ? { metadata: { keywords: manifest.keywords } }
      : {},
    versions: [
      {
        version: manifest.version,
        publishTimestamp,
        source: { type: 'git', url: repo, commit, path: dir.name },
      },
    ],
  }
  plugins.push(entry)
}

const index = {
  format: 1,
  title: { en: "Inkyo's DSH plugins", zh: 'Inkyo 的 DSH 插件' },
  description: {
    en: 'Personal DeepSeek Harness bundle collection, installed from pinned Git commits.',
    zh: '个人 DSH 插件合集，通过钉死 commit 的 Git 源安装。',
  },
  plugins,
}

const out = join(root, 'index.json')
writeFileSync(out, JSON.stringify(index, null, 2) + '\n')
console.log(`wrote ${out} with ${plugins.length} plugin(s), pinned to ${commit}`)
for (const p of plugins) console.log(`  - ${p.name}@${p.versions[0].version} (${p.repository.directory})`)
