import { describe, it, expect } from 'vitest'
import {
  isAuthEndpoint,
  isWorkflowEndpoint,
  isStateMutatingEndpoint,
  isSsrfProneEndpoint,
  isAiEndpoint,
  hasTarget,
} from '../../src/primitives/routing'
import type { TechniqueContext } from '../../src/primitives/framework'

function ctx(partial: Partial<TechniqueContext>): TechniqueContext {
  return partial
}

describe('primitive routing — typed (not URL-name) signals', () => {
  it('isAuthEndpoint keys off typed authRequired/authType/useCase, NOT the URL path', () => {
    // URL says /login but no typed signal => NOT an auth endpoint (no name guessing)
    expect(isAuthEndpoint(ctx({ endpoint: { url: 'https://x/login', method: 'POST' } }))).toBe(false)
    // Typed authRequired => auth endpoint even with a neutral URL
    expect(isAuthEndpoint(ctx({ endpoint: { url: 'https://x/do', method: 'POST', authRequired: true } }))).toBe(true)
    // Typed useCase => auth endpoint
    expect(isAuthEndpoint(ctx({ endpoint: { url: 'https://x/do', method: 'POST', useCase: 'authentication operation' } }))).toBe(true)
    // Typed authType => auth endpoint
    expect(isAuthEndpoint(ctx({ endpoint: { url: 'https://x/do', method: 'POST', authType: 'oauth' } }))).toBe(true)
  })

  it('isWorkflowEndpoint keys off typed useCase / workflowSteps, NOT URL path', () => {
    expect(isWorkflowEndpoint(ctx({ endpoint: { url: 'https://x/checkout', method: 'POST' } }))).toBe(false)
    expect(isWorkflowEndpoint(ctx({ endpoint: { url: 'https://x/act', method: 'POST', useCase: 'checkout operation' } }))).toBe(true)
    expect(isWorkflowEndpoint(ctx({ workflowSteps: ['a', 'b'] }))).toBe(true)
  })

  it('isStateMutatingEndpoint keys off method + typed useCase, not URL path', () => {
    expect(isStateMutatingEndpoint(ctx({ endpoint: { url: 'https://x/transfer', method: 'POST' } }))).toBe(false)
    expect(isStateMutatingEndpoint(ctx({ endpoint: { url: 'https://x/act', method: 'POST', useCase: 'payment operation' } }))).toBe(true)
    // GET is never a mutating endpoint regardless of useCase
    expect(isStateMutatingEndpoint(ctx({ endpoint: { url: 'https://x/act', method: 'GET', useCase: 'payment operation' } }))).toBe(false)
  })

  it('isSsrfProneEndpoint keys off brain-supplied param or typed useCase, not URL path', () => {
    expect(isSsrfProneEndpoint(ctx({ endpoint: { url: 'https://x/fetch', method: 'GET' } }))).toBe(false)
    expect(isSsrfProneEndpoint(ctx({ param: 'url' }))).toBe(true)
    expect(isSsrfProneEndpoint(ctx({ endpoint: { url: 'https://x/act', method: 'GET', useCase: 'file upload' } }))).toBe(true)
  })

  it('isAiEndpoint keys off typed state/useCase/param, not URL path', () => {
    expect(isAiEndpoint(ctx({ endpoint: { url: 'https://x/chat', method: 'POST' } }))).toBe(false)
    expect(isAiEndpoint(ctx({ state: { aiFeature: true } }))).toBe(true)
    expect(isAiEndpoint(ctx({ endpoint: { url: 'https://x/act', method: 'POST', useCase: 'ai agent operation' } }))).toBe(true)
    expect(isAiEndpoint(ctx({ param: 'prompt' }))).toBe(true)
  })

  it('hasTarget requires an endpoint or target', () => {
    expect(hasTarget(ctx({}))).toBe(false)
    expect(hasTarget(ctx({ target: 'https://x' }))).toBe(true)
    expect(hasTarget(ctx({ endpoint: { url: 'https://x', method: 'GET' } }))).toBe(true)
  })
})
