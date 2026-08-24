import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Ultimatrix } from '../../src/sdk'
import { WorkspaceManager } from '../../src/workspace'

describe('Ultimatrix SDK runtime ownership', () => {
  const dirs: string[] = []

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  it('persists concurrent SDK instances into isolated engagement workflows', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'ultimatrix-sdk-'))
    dirs.push(outputDir)
    const targets = ['https://sdk-a.example', 'https://sdk-b.example']
    const instances = targets.map(target => new Ultimatrix({ target, outputDir }))

    await Promise.all(instances.map(instance => instance.replay()))
    await Promise.all(instances.map(instance => instance.close()))

    const workspace = new WorkspaceManager(outputDir)
    const workflows = await Promise.all(targets.map(async target => JSON.parse(await readFile(
      resolve(workspace.getTargetDir(target), 'workflow.json'),
      'utf8',
    ))))

    expect(workflows.map(workflow => workflow.target)).toEqual(targets)
    expect(new Set(workflows.map(workflow => workflow.workflowId)).size).toBe(2)
    expect(workflows.every(workflow => workflow.status === 'completed')).toBe(true)
  })
})
