# Fluent — personal AI language tutor

Fluent turns a DeepSeek Harness session into a language tutor that remembers everything: your level, your weak grammar patterns, every word you've learned, and exactly when you're about to forget them. It is a port of the open-source [Fluent](https://github.com/m98/fluent) Claude Code kit.

## What you get

- **A dedicated `fluent` agent preset** with a tutor persona: encouraging, systematic, one question at a time.
- **12 skills** that drive every teaching flow:
  - `/fluent-setup` — one-time onboarding (name, target language, CEFR level, goals, daily minutes).
  - `/fluent-review` — today's spaced-repetition queue, scheduled by the SM-2 algorithm.
  - `/fluent-learn` — adaptive mixed practice that targets your weakest patterns.
  - `/fluent-vocab` — flashcard drills (recognition, production, cloze).
  - `/fluent-writing` — emails, letters, and forms with severity-tagged corrections.
  - `/fluent-speaking` — typed conversation and role-plays, communication first.
  - `/fluent-reading` — short texts with comprehension questions.
  - `/fluent-progress` — dashboard: mastery stars, accuracy trends, streak, achievements.
  - Helper skills (SM-2 calculator, feedback formatter, DB updater, session analyzer) load automatically when a session needs them.
- **Six local JSON databases** in `./data/` of your workspace: learner profile, progress, mistakes, mastery, spaced repetition, session log. Human-readable, exportable, private.
- **Automatic data safety**: every write to `./data/*.json` is validated and backed up (last 10 per file), and a daily snapshot goes to `./data/.backups/` when a session ends.

## Daily routine

1. `/fluent-review` first — it protects everything you've learned.
2. `/fluent-learn` or a skill-specific session (`/fluent-vocab`, `/fluent-writing`, ...).
3. `/fluent-progress` weekly to see yourself improve.

## Requirements

- **python3** (3.8+, standard library only) on the machine running the Harness — the SM-2 scheduler and database updater are Python helpers called through the bash tool.
- One workspace per learner: the tutor stores its databases in `./data/` of the session workspace. Set `$FLUENT_DATA_DIR` to share one profile across workspaces.

## Limitations

- Progress data is per-workspace by default; switching workspaces starts a fresh learner profile unless `$FLUENT_DATA_DIR` is set.
- Session result markdown goes to `./results/` in the workspace; deleting it only loses narrative history, never the databases.
- There is no audio: speaking practice is typed conversation.
