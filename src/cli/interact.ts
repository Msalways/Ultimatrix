import { main } from '../session'

export async function interactCommand(args: string[]): Promise<void> {
  const targetIdx = args.indexOf('-t')
  const targetFlagIdx = args.indexOf('--target')
  const target = targetIdx !== -1 ? args[targetIdx + 1] : targetFlagIdx !== -1 ? args[targetFlagIdx + 1] : undefined
  const plain = args.includes('--plain')

  await main(target, { plain })
}
