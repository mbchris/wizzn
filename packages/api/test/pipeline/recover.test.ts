import { describe, expect, it } from 'vitest'
import { QUEUES } from '../../src/jobs/queues.js'
import { resumePlan } from '../../src/pipeline/recover.js'

const words = (n: number) => Array.from({ length: n }, (_, i) => `wort${i}`).join(' ')
const audioDraft = { title: 'Notgroschen', script: words(500), images: [{ prompt: 'Sparschwein', atFraction: 0.2 }] }

describe('resumePlan', () => {
  it('re-runs research for units stuck in researching', () => {
    expect(resumePlan({ status: 'researching', format: 'written', contentJson: null })).toEqual({ resetTo: 'queued', queue: QUEUES.research })
  })
  it('re-drafts when the draft is missing or is still the previous final content', () => {
    expect(resumePlan({ status: 'drafting', format: 'audio', contentJson: null })).toEqual({ resetTo: 'researching', queue: QUEUES.draft })
    const finalAudio = { format: 'audio', script: words(500), durationSec: 200, audioId: 'a', images: [], sources: [] }
    expect(resumePlan({ status: 'drafting', format: 'audio', contentJson: finalAudio })).toEqual({ resetTo: 'researching', queue: QUEUES.draft })
  })
  it('only checks a complete (possibly admin-edited) draft', () => {
    expect(resumePlan({ status: 'drafting', format: 'audio', contentJson: audioDraft })).toEqual({ resetTo: 'drafting', queue: QUEUES.check })
  })
  it('re-runs check and media from their from-status', () => {
    expect(resumePlan({ status: 'checking', format: 'written', contentJson: null })).toEqual({ resetTo: 'drafting', queue: QUEUES.check })
    expect(resumePlan({ status: 'rendering_media', format: 'written', contentJson: null })).toEqual({ resetTo: 'checking', queue: QUEUES.media })
  })
  it('has no plan for idle units', () => {
    for (const status of ['queued', 'in_review', 'published', 'rejected', 'failed'] as const) expect(resumePlan({ status, format: 'written', contentJson: null })).toBeNull()
  })
})
