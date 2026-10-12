import { describe, expect, it } from 'vitest'
import {
  nlipMessageSchema,
  nlipQuestion,
  nlipToken,
  nlipText,
  nlipConfigInputSchema,
} from '~/types/nlip'

describe('NLIP SDK 0.1.3 text profile', () => {
  it('accepts SDK nullable fields and case-insensitive formats', () => {
    const message = nlipMessageSchema.parse({
      format: 'TEXT',
      subformat: 'english',
      content: 'Question',
      messagetype: null,
      label: null,
      submessages: null,
    })
    expect(nlipQuestion(message)).toBe('Question')
  })
  it('joins text submessages and extracts the SDK conversation token', () => {
    const message = nlipText('Question', 'correlation-1')
    message.submessages!.push({
      format: 'text',
      subformat: 'english',
      content: 'Relevant detail',
    })
    expect(nlipToken(message, 'conversation')).toBe('correlation-1')
    expect(nlipQuestion(message)).toBe('Question\nRelevant detail')
  })
  it('rejects ambiguous credentials and unsupported control/binary input', () => {
    const message = nlipText('Question')
    message.submessages = [
      { format: 'token', subformat: 'authorization', content: 'a' },
      { format: 'token', subformat: 'authorization', content: 'b' },
    ]
    expect(() => nlipToken(message, 'authorization')).toThrow(/duplicate/)
    expect(() => nlipQuestion({ ...message, messagetype: 'CONTROL' })).toThrow(
      /Control/,
    )
    expect(() =>
      nlipQuestion({
        format: 'binary',
        subformat: 'image/base64',
        content: 'YQ==',
      }),
    ).toThrow(/Only text/)
  })
  it('rejects empty/oversized questions and duplicate agent IDs', () => {
    expect(() => nlipQuestion(nlipText(' '))).toThrow()
    expect(() => nlipQuestion(nlipText('a'.repeat(16001)))).toThrow()
    const agent = {
      id: 'ta',
      name: 'TA',
      description: 'Explain slides',
      endpoint: 'https://ta.example/nlip/',
    }
    expect(
      nlipConfigInputSchema.safeParse({
        inboundEnabled: false,
        agents: [agent, agent],
      }).success,
    ).toBe(false)
  })
})
