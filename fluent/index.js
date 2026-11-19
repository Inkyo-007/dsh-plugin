/**
 * Fluent preset companion plugin for DeepSeek Harness.
 *
 * Reimplements the Claude Code hooks of the original Fluent project natively:
 *
 *  - SessionStart  → `agent/pre-step` listener: on the first prepared step of
 *    each agent, appends a durable context message with the learner's name,
 *    target language, level, streak, and due-review count read from
 *    `./data/` (mirrors the original console greeting as model context).
 *  - PostToolUse   → `tools/post-execute` listener: when a write/edit tool
 *    touches a `*.json` file inside `./data/`, validates the JSON and keeps
 *    the last 10 timestamped backups next to it; a malformed file appends a
 *    warning context to the tool result so the tutor notices.
 *  - SessionEnd    → `agent/disposed` listener: copies every `./data/*.json`
 *    into `./data/.backups/YYYYMMDD/` once per day.
 *
 * Mounted inside the fluent agent preset, so every listener only sees agents
 * using that preset. All state is keyed per agent or per data directory
 * because the preset fiber is shared between agents.
 */
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export const name = 'fluent'

const SOURCE_KIND = 'fluent'
const MAX_BACKUPS_PER_FILE = 10
const DATA_FILE_TOUCH_TOOLS = new Set(['write', 'edit'])

/* ---------------------------------------------------------------- helpers */

function localDate(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function timestamp(d = new Date()) {
  const t = localDate(d).replaceAll('-', '')
  const hms = [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join('')
  return `${t}-${hms}`
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    return undefined
  }
}

async function pathExists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

function makeContextMessage(text, summary) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: {
      kind: SOURCE_KIND,
      form: 'snapshot',
      summary,
      sections: [{ name: SOURCE_KIND, text }],
    },
  }
}

/* ------------------------------------------------------------- apply() */

export function apply(ctx) {
  const welcomed = new WeakSet()
  const snapshots = new Map() // dataDir -> last snapshot day (shared fiber: one snapshot per day per workspace)
  let queue = Promise.resolve()

  /** Serialize filesystem side effects across listeners. */
  const enqueue = (job) => {
    queue = queue.then(job, job).catch((error) => {
      ctx.logger.warn(`fluent: ${String(error?.message ?? error)}`)
    })
    return queue
  }

  /** The session's Fluent data directory: $FLUENT_DATA_DIR or <cwd>/data. */
  function dataDirFor(session) {
    const env = process.env.FLUENT_DATA_DIR
    if (env) return path.resolve(env)
    let cwd
    try {
      cwd = session ? ctx.get('workingDirectory')?.get(session) : undefined
    } catch {
      cwd = undefined
    }
    return path.join(cwd ?? process.cwd(), 'data')
  }

  /* ------------------------------------------- 1. session-start welcome */

  async function renderWelcome(dataDir) {
    const profile = await readJson(path.join(dataDir, 'learner-profile.json'))
    if (!profile) {
      return [
        '[Fluent session context]',
        'No learner profile found in ./data/ yet. This workspace has not been onboarded.',
        'When the learner is ready, run /fluent-setup to create the profile and seed the six databases.',
      ].join('\n')
    }

    const learner = profile.learner ?? {}
    const lines = [
      '[Fluent session context]',
      `Learner: ${learner.name ?? 'unknown'}`,
      `Target language: ${learner.target_language ?? '?'} (${learner.current_level ?? '?'} → ${learner.target_level ?? '?'})`,
      `Streak: ${profile.current_streak_days ?? 0} day(s) | Total sessions: ${profile.total_sessions ?? 0} | Study time: ${profile.total_study_minutes ?? 0} min`,
    ]

    const sr = await readJson(path.join(dataDir, 'spaced-repetition.json'))
    if (sr?.items && typeof sr.items === 'object') {
      const today = localDate()
      const due = Object.values(sr.items).filter((item) => {
        const dueDate = item?.due_date ?? item?.next_review_date
        return typeof dueDate === 'string' && dueDate <= today
      }).length
      if (due > 0) lines.push(`Spaced repetition: ${due} item(s) due today — suggest /fluent-review.`)
      else lines.push('Spaced repetition: nothing due today.')
    }

    lines.push('Greet the learner personally with these facts when the conversation begins.')
    return lines.join('\n')
  }

  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    if (welcomed.has(agent)) return decision
    welcomed.add(agent)
    try {
      const text = await renderWelcome(dataDirFor(agent.session))
      return {
        ...decision,
        messages: [
          ...decision.messages,
          makeContextMessage(text, 'Fluent learner context'),
        ],
      }
    } catch (error) {
      ctx.logger.warn(`fluent: welcome injection failed: ${String(error?.message ?? error)}`)
      return decision
    }
  })

  /* ------------------------- 2. data-file validation + per-write backup */

  function touchedDataFile(exec) {
    if (!DATA_FILE_TOUCH_TOOLS.has(exec.name)) return undefined
    const filePath = exec.arguments?.file_path
    if (typeof filePath !== 'string' || !filePath.endsWith('.json')) return undefined
    if (filePath.includes('.backup-')) return undefined
    if (exec.agent === undefined) return undefined
    const dataDir = dataDirFor(exec.agent.session)
    const resolved = path.resolve(dataDir, filePath)
    if (resolved !== path.join(dataDir, path.basename(resolved))) return undefined
    return { dataDir, file: resolved }
  }

  async function rotateBackups(file) {
    const dir = path.dirname(file)
    const base = path.basename(file)
    const entries = (await fs.readdir(dir)).filter((e) => e.startsWith(`${base}.backup-`)).sort().reverse()
    for (const old of entries.slice(MAX_BACKUPS_PER_FILE)) {
      await fs.unlink(path.join(dir, old)).catch(() => {})
    }
  }

  ctx.on('tools/post-execute', async (exec, _result, next) => {
    const downstream = await next()
    const touched = touchedDataFile(exec)
    if (!touched || downstream.isError) return downstream

    const warning = await enqueue(async () => {
      let parsed
      try {
        parsed = JSON.parse(await fs.readFile(touched.file, 'utf8'))
      } catch (error) {
        return `[Fluent] ⚠️ Invalid JSON in ${touched.file}: ${String(error?.message ?? error)}. ` +
          `Restore one of the ${path.basename(touched.file)}.backup-* copies before continuing.`
      }
      if (parsed === null || typeof parsed !== 'object') {
        return `[Fluent] ⚠️ ${touched.file} does not contain a JSON object.`
      }
      try {
        await fs.copyFile(touched.file, `${touched.file}.backup-${timestamp()}`)
        await rotateBackups(touched.file)
      } catch (error) {
        return `[Fluent] ⚠️ Backup failed for ${touched.file}: ${String(error?.message ?? error)}`
      }
      return undefined
    })

    if (!warning) return downstream
    return {
      ...downstream,
      additionalContexts: [
        makeContextMessage(warning, 'Fluent data validation'),
        ...(downstream.additionalContexts ?? []),
      ],
    }
  })

  /* --------------------------------------- 3. session-end daily snapshot */

  ctx.on('agent/disposed', ({ agent }) => {
    const dataDir = dataDirFor(agent?.session)
    const today = localDate()
    if (snapshots.get(dataDir) === today) return
    snapshots.set(dataDir, today)
    enqueue(async () => {
      if (!(await pathExists(dataDir))) return
      const files = (await fs.readdir(dataDir)).filter((f) => f.endsWith('.json') && !f.includes('.backup-'))
      if (files.length === 0) return
      const backupDir = path.join(dataDir, '.backups', today.replaceAll('-', ''))
      await fs.mkdir(backupDir, { recursive: true })
      for (const f of files) {
        await fs.copyFile(path.join(dataDir, f), path.join(backupDir, f))
      }
    })
  })
}
