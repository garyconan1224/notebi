// S5 knowledge deep-link acceptance entrypoint.
// Reuses the maintained real-media runner while placing evidence under this phase.
import path from 'node:path'

process.env.REAL_MEDIA_REPORT ||= path.resolve(
  './scripts/knowledge_acceptance/evidence/real-media-report.json',
)
process.env.REAL_MEDIA_SCREENSHOT_DIR ||= path.resolve(
  './scripts/knowledge_acceptance/evidence/screenshots',
)

await import('../r7_acceptance/real-media.mjs')
