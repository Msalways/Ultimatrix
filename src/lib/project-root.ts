/**
 * Project root resolution — single source of truth for finding the project root.
 *
 * tsup bundles everything into dist/index.js (flat, splitting:false).
 * import.meta.dirname in the bundle = dist/, so relative traversals like
 * join(dirname, '..', '..', 'skills') overshoot the project root.
 *
 * This module walks up from import.meta.dirname looking for package.json
 * (the universal project marker), falling back to process.cwd().
 */

import { existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'

const START_DIR = import.meta.dirname || __dirname

/**
 * Walk up from `startDir` looking for a directory containing package.json
 * with the matching name field. Falls back to any package.json, then CWD.
 */
function findProjectRoot(): string {
  // 1. Walk up from import.meta.dirname looking for package.json
  let dir = START_DIR
  for (let i = 0; i < 10; i++) {
    const pkgPath = join(dir, 'package.json')
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
        // Prefer the package with our name, but accept any package.json
        if (pkg.name === 'ultimatrix' || pkg.name === '@anthropic/ultimatrix') {
          return dir
        }
      } catch {
        // Corrupted package.json, keep looking
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break // reached filesystem root
    dir = parent
  }

  // 2. Walk up from CWD
  dir = process.cwd()
  for (let i = 0; i < 10; i++) {
    const pkgPath = join(dir, 'package.json')
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
        if (pkg.name === 'ultimatrix' || pkg.name === '@anthropic/ultimatrix') {
          return dir
        }
      } catch {
        // keep looking
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  // 3. Last resort: check if CWD itself has skills/
  if (existsSync(join(process.cwd(), 'skills'))) {
    return process.cwd()
  }

  throw new Error(
    `Cannot find project root (no package.json found walking up from ${START_DIR} or ${process.cwd()})`
  )
}

/** Absolute path to the project root directory. */
export const PROJECT_ROOT: string = findProjectRoot()

/** Absolute path to the skills/ directory. */
export const SKILLS_DIR: string = join(PROJECT_ROOT, 'skills')

/** Absolute path to skills/registry.json. */
export const REGISTRY_PATH: string = join(SKILLS_DIR, 'registry.json')
