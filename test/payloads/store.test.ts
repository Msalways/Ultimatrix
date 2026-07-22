import { describe, it, expect, beforeEach } from 'vitest'
import { PayloadStore } from '../../src/payloads/store'

describe('PayloadStore', () => {
  let store: PayloadStore

  beforeEach(() => {
    PayloadStore.reset()
    store = new PayloadStore()
  })

  it('loads payload categories from JSON files', () => {
    const categories = store.listCategories()
    expect(categories.length).toBeGreaterThan(0)
    expect(categories.some(c => c.startsWith('sqli/'))).toBe(true)
    expect(categories.some(c => c.startsWith('xss/'))).toBe(true)
    expect(categories.some(c => c.startsWith('ssrf/'))).toBe(true)
    expect(categories.some(c => c.startsWith('ssti/'))).toBe(true)
  })

  it('getPayloads returns default payloads for a category', () => {
    const payloads = store.getPayloads('sqli/error-based')
    expect(payloads.length).toBeGreaterThan(0)
    expect(payloads.some(p => p.includes("'"))).toBe(true)
  })

  it('getPayloads returns variant-specific payloads when variant specified', () => {
    const mysqlPayloads = store.getPayloads('sqli/error-based', 'mysql')
    expect(mysqlPayloads.length).toBeGreaterThan(0)
    expect(mysqlPayloads.some(p => p.includes("'"))).toBe(true)

    const pgPayloads = store.getPayloads('sqli/error-based', 'postgresql')
    expect(pgPayloads.length).toBeGreaterThan(0)
    expect(pgPayloads.some(p => p.includes("'"))).toBe(true)
  })

  it('getPayloads returns empty array for unknown category', () => {
    const payloads = store.getPayloads('nonexistent/category')
    expect(payloads).toEqual([])
  })

  it('getPayloads falls back to default payloads for unknown variant in known category', () => {
    const payloads = store.getPayloads('sqli/error-based', 'nonexistent-dbms')
    const defaults = store.getPayloads('sqli/error-based')
    expect(payloads).toEqual(defaults)
  })

  it('getMarkers returns detection markers', () => {
    const markers = store.getMarkers('sqli/error-based')
    expect(markers.length).toBeGreaterThan(0)
    expect(markers.some(m => m.toLowerCase().includes('sql'))).toBe(true)
  })

  it('getMarkers returns empty array for unknown category', () => {
    const markers = store.getMarkers('nonexistent/category')
    expect(markers).toEqual([])
  })

  it('listVariants returns all variants for a category', () => {
    const variants = store.listVariants('sqli/error-based')
    expect(variants.length).toBeGreaterThanOrEqual(4)
    expect(variants).toContain('mysql')
    expect(variants).toContain('postgresql')
    expect(variants).toContain('mssql')
    expect(variants).toContain('oracle')
    expect(variants).toContain('sqlite')
  })

  it('listVariants returns empty array for unknown category', () => {
    const variants = store.listVariants('nonexistent/category')
    expect(variants).toEqual([])
  })

  it('hasCategory returns true for existing categories', () => {
    expect(store.hasCategory('sqli/error-based')).toBe(true)
    expect(store.hasCategory('xss/reflected')).toBe(true)
    expect(store.hasCategory('ssrf/cloud-metadata')).toBe(true)
  })

  it('hasCategory returns false for unknown categories', () => {
    expect(store.hasCategory('nonexistent/category')).toBe(false)
  })

  it('hasVariant returns true for existing variants', () => {
    expect(store.hasVariant('sqli/error-based', 'mysql')).toBe(true)
    expect(store.hasVariant('sqli/error-based', 'postgresql')).toBe(true)
  })

  it('hasVariant returns false for unknown variants', () => {
    expect(store.hasVariant('sqli/error-based', 'nonexistent')).toBe(false)
  })

  it('getMetadata returns category metadata', () => {
    const meta = store.getMetadata('sqli/error-based')
    expect(meta.cwe).toBe('CWE-89')
  })

  it('getMetadata returns empty object for unknown category', () => {
    const meta = store.getMetadata('nonexistent/category')
    expect(meta).toEqual({})
  })

  it('SSRF cloud-metadata has AWS + GCP + Azure variants', () => {
    const variants = store.listVariants('ssrf/cloud-metadata')
    expect(variants).toContain('aws')
    expect(variants).toContain('gcp')
    expect(variants).toContain('azure')
  })

  it('SSTI generic has multiple template engine variants', () => {
    const variants = store.listVariants('ssti/generic')
    expect(variants).toContain('jinja2')
    expect(variants).toContain('twig')
    expect(variants).toContain('freemarker')
    expect(variants).toContain('velocity')
  })

  it('JWT alg-none has alg_none, key_confusion, null_sig, kid_injection, weak_secret variants', () => {
    const variants = store.listVariants('jwt/alg-none')
    expect(variants).toContain('alg_none')
    expect(variants).toContain('key_confusion')
    expect(variants).toContain('null_sig')
    expect(variants).toContain('kid_injection')
    expect(variants).toContain('weak_secret')
  })

  it('singleton getInstance returns same instance', () => {
    const a = PayloadStore.getInstance()
    const b = PayloadStore.getInstance()
    expect(a).toBe(b)
  })

  it('reset clears singleton for testing', () => {
    const a = PayloadStore.getInstance()
    PayloadStore.reset()
    const b = PayloadStore.getInstance()
    expect(a).not.toBe(b)
  })

  it('lazy loading — categories not loaded until first access', () => {
    const fresh = new PayloadStore()
    expect((fresh as any).loaded).toBe(false)
    fresh.listCategories()
    expect((fresh as any).loaded).toBe(true)
  })
})
