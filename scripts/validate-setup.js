#!/usr/bin/env node

/**
 * Quick validation script for Ultimatrix setup
 * Run with: node scripts/validate-setup.js
 */

import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

console.log('🔍 Validating Ultimatrix setup...\n')

const checks = [
  {
    name: 'Node.js version',
    check: () => {
      try {
        const version = execSync('node --version', { encoding: 'utf8' }).trim()
        const majorVersion = parseInt(version.replace('v', '').split('.')[0])
        return { success: majorVersion >= 20, version }
      } catch {
        return { success: false, error: 'Node.js not found' }
      }
    }
  },
  {
    name: 'npm installation',
    check: () => {
      try {
        const version = execSync('npm --version', { encoding: 'utf8' }).trim()
        return { success: true, version }
      } catch {
        return { success: false, error: 'npm not found' }
      }
    }
  },
  {
    name: 'Dependencies installed',
    check: () => {
      try {
        const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'))
        const nodeModules = fs.existsSync('node_modules')
        const hasCoreDeps = nodeModules && 
          fs.existsSync('node_modules/@mastra/core') &&
          fs.existsSync('node_modules/playwright')
        return { success: hasCoreDeps, deps: Object.keys(packageJson.dependencies || {}) }
      } catch {
        return { success: false, error: 'package.json not found' }
      }
    }
  },
  {
    name: 'Playwright browsers',
    check: () => {
      try {
        const browsersPath = path.join('node_modules', '.cache', 'playwright')
        const playwrightInstalled = fs.existsSync(browsersPath)
        const playwrightBinary = fs.existsSync('node_modules/.bin/playwright')
        return { success: playwrightInstalled || playwrightBinary, note: playwrightInstalled ? 'Browsers cached' : 'Binary found' }
      } catch {
        return { success: false, error: 'Playwright browsers not found' }
      }
    }
  },
  {
    name: 'TypeScript compilation',
    check: () => {
      try {
        execSync('npm run lint', { stdio: 'pipe' })
        return { success: true }
      } catch (error) {
        return { success: false, error: error.message }
      }
    }
  },
  {
    name: 'Test suite',
    check: () => {
      try {
        execSync('npm test', { stdio: 'pipe', timeout: 60000 })
        return { success: true }
      } catch (error) {
        return { success: false, error: error.message }
      }
    }
  }
]

let allPassed = true

checks.forEach(({ name, check }) => {
  console.log(`📋 ${name}...`)
  const result = check()
  
  if (result.success) {
    if (result.version) {
      console.log(`  ✅ ${name}: ${result.version}`)
    } else if (result.deps) {
      console.log(`  ✅ ${name}: ${result.deps.length} dependencies`)
    } else {
      console.log(`  ✅ ${name}: OK`)
    }
  } else {
    console.log(`  ❌ ${name}: ${result.error || 'Failed'}`)
    allPassed = false
  }
  console.log()
})

if (allPassed) {
  console.log('🎉 All checks passed! Your Ultimatrix setup is ready.')
  console.log('\nNext steps:')
  console.log('1. Set your LLM API key: export GROQ_API_KEY=your_key_here')
  console.log('2. Run a test scan: npx ultimatrix interact -t https://httpbin.org')
  console.log('3. Or start the web UI: npx ultimatrix web')
} else {
  console.log('❌ Some checks failed. Please fix the issues above.')
  console.log('\nTroubleshooting:')
  console.log('- Run "npm install" to install dependencies')
  console.log('- Run "npx playwright install chromium" to install browsers')
  console.log('- Run "npm test" to verify tests pass')
  process.exit(1)
}