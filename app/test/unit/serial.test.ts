import { describe, expect, it } from 'vitest'
import { SerialQueue } from '../../server/lib/serial'

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('SerialQueue', () => {
  it('runs jobs one after another in arrival order', async () => {
    const queue = new SerialQueue()
    const log: string[] = []
    const job = (name: string, ms: number) => queue.run(async () => {
      log.push(`start ${name}`)
      await pause(ms)
      log.push(`end ${name}`)
      return name
    })
    expect(await Promise.all([job('a', 20), job('b', 1), job('c', 5)])).toEqual(['a', 'b', 'c'])
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c'])
  })

  it('keeps going after a failed job', async () => {
    const queue = new SerialQueue()
    const failed = queue.run(async () => {
      throw new Error('refused')
    })
    const next = queue.run(async () => 'ok')
    await expect(failed).rejects.toThrow('refused')
    expect(await next).toBe('ok')
  })
})
