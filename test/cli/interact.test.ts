import { beforeEach, describe, expect, it, vi } from 'vitest'

const { main } = vi.hoisted(() => ({ main: vi.fn(async () => undefined) }))

vi.mock('../../src/session', () => ({ main }))

import { interactCommand } from '../../src/cli/interact'

describe('interact CLI target', () => {
  beforeEach(() => main.mockClear())

  it('starts bounded learn-and-test mode for a targeted interactive session', async () => {
    await interactCommand(['-t', 'http://127.0.0.1:3000', '--plain'])

    expect(main).toHaveBeenCalledWith('http://127.0.0.1:3000', {
      plain: true,
      approvedOrigins: [],
      interactionMode: 'run',
    })
  })

  it('keeps untargeted chat in ask mode', async () => {
    await interactCommand(['--plain'])

    expect(main).toHaveBeenCalledWith(undefined, { plain: true, approvedOrigins: [] })
  })

})
