#!/usr/bin/env node

/**
 * Test runner with helpful output
 * Run with: node scripts/test-runner.js [pattern]
 */

import { execSync } from 'child_process'
import path from 'path'

const pattern = process.argv[2] || ''

console.log('🧪 Running Ultimatrix Tests')
console.log('==========================')

if (pattern) {
  console.log(`Pattern: ${pattern}`)
}

try {
  const command = `npm test -- --reporter=verbose ${pattern ? `--testPathPattern="${pattern}"` : ''}`
  console.log(`Running: ${command}\n`)
  
  execSync(command, { 
    stdio: 'inherit',
    timeout: 120000 // 2 minute timeout
  })
  
  console.log('\n✅ All tests passed!')
  
} catch (error) {
  if (error.signal === 'SIGTERM') {
    console.log('\n⏰ Test timeout reached')
  } else {
    console.error('\n❌ Tests failed:', error.message)
  }
  
  console.log('\n💡 Tips:')
  console.log('- Run specific tests: node scripts/test-runner.js src/recorder')
  console.log('- Run with verbose output: node scripts/test-runner.js -- --reporter=verbose')
  console.log('- Run in watch mode: npm run test:watch')
  
  process.exit(1)
}