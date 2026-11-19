/**
 * Offline harness test for dsh-fluent/index.js.
 * Mocks the Cordis ctx, fires the three listeners, and asserts filesystem
 * and message effects. Run:
 *   ELECTRON_RUN_AS_NODE=1 node tests/test-hooks.mjs
 */
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const { apply } = await import(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js'))

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluent-hooks-'))
const dataDir = path.join(tmp, 'data')
await fs.mkdir(dataDir, { recursive: true })

const listeners = new Map()
const warnings = []
const ctx = {
  on: (event, fn) => listeners.set(event, fn),
  get: (service) => (service === 'workingDirectory' ? { get: () => tmp } : undefined),
  logger: { warn: (m) => warnings.push(m) },
}
apply(ctx)

let failures = 0
const check = (label, cond) => {
  console.log(cond ? 'PASS' : 'FAIL', label)
  if (!cond) failures++
}
const agentA = { session: { id: 'a' } }
const agentB = { session: { id: 'b' } }
const signal = new AbortController().signal
const runPreStep = (agent) =>
  listeners.get('agent/pre-step')(
    { agent, turn: 1, step: 1, signal },
    () => Promise.resolve({ kind: 'continue', messages: [] }),
  )

// 1. First agent, empty data dir → setup hint
let decision = await runPreStep(agentA)
let text = decision.messages.at(-1)?.content?.[0]?.text ?? ''
check('welcome: no profile → /fluent-setup hint', text.includes('/fluent-setup'))

// 2. Same agent again → no duplicate welcome
decision = await runPreStep(agentA)
check('welcome: not duplicated for same agent', decision.messages.length === 0)

// 3. Seed profile + spaced repetition, new agent → stats in welcome
await fs.writeFile(
  path.join(dataDir, 'learner-profile.json'),
  JSON.stringify({
    learner: { name: 'Marie', target_language: 'French', current_level: 'A2', target_level: 'B1' },
    current_streak_days: 5,
    total_sessions: 12,
    total_study_minutes: 300,
  }),
)
const today = new Date()
const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
await fs.writeFile(
  path.join(dataDir, 'spaced-repetition.json'),
  JSON.stringify({ items: { a: { due_date: iso }, b: { due_date: iso }, c: { due_date: '2999-01-01' } } }),
)
decision = await runPreStep(agentB)
text = decision.messages.at(-1)?.content?.[0]?.text ?? ''
check('welcome: names learner', text.includes('Marie'))
check('welcome: shows streak', text.includes('5'))
check('welcome: counts due reviews', text.includes('2 item(s) due'))

// 4. post-execute: valid JSON write → timestamped backup, no warning
const target = path.join(dataDir, 'progress-db.json')
await fs.writeFile(target, JSON.stringify({ ok: true }))
const exec = { name: 'write', arguments: { file_path: target }, agent: agentA }
const downstream = await listeners.get('tools/post-execute')(exec, {}, () =>
  Promise.resolve({ isError: false, additionalContexts: [] }),
)
check('validate: no warning on valid JSON', (downstream.additionalContexts ?? []).length === 0)
let backups = (await fs.readdir(dataDir)).filter((f) => f.startsWith('progress-db.json.backup-'))
check('validate: backup created', backups.length === 1)

// 5. post-execute: invalid JSON → warning context, no new backup
await fs.writeFile(target, '{ broken')
const downstream2 = await listeners.get('tools/post-execute')(exec, {}, () =>
  Promise.resolve({ isError: false }),
)
const warningText = downstream2.additionalContexts?.[0]?.content?.[0]?.text ?? ''
check('validate: warns on invalid JSON', warningText.includes('Invalid JSON'))
backups = (await fs.readdir(dataDir)).filter((f) => f.startsWith('progress-db.json.backup-'))
check('validate: no backup of invalid file', backups.length === 1)

// 6. post-execute: file outside ./data is ignored
const outside = path.join(tmp, 'other.json')
await fs.writeFile(outside, '{ broken')
const downstream3 = await listeners.get('tools/post-execute')(
  { name: 'write', arguments: { file_path: outside }, agent: agentA },
  {},
  () => Promise.resolve({ isError: false }),
)
check('validate: ignores files outside ./data', downstream3.additionalContexts === undefined)

// 7. agent/disposed → daily snapshot
await listeners.get('agent/disposed')({ agent: agentA })
await new Promise((r) => setTimeout(r, 200)) // drain the serialized queue
const snapDir = path.join(dataDir, '.backups', iso.replaceAll('-', ''))
const snapFiles = await fs.readdir(snapDir).catch(() => [])
check('snapshot: daily backup dir created', snapFiles.includes('learner-profile.json'))

// 8. second dispose same day → no duplicate work (dir stays single)
await listeners.get('agent/disposed')({ agent: agentB })
await new Promise((r) => setTimeout(r, 200))
const backupsRoot = await fs.readdir(path.join(dataDir, '.backups'))
check('snapshot: one snapshot per day', backupsRoot.length === 1)

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`)
await fs.rm(tmp, { recursive: true, force: true })
process.exit(failures === 0 ? 0 : 1)
