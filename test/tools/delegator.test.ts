import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shouldDelegate, getAvailableTools, getToolDescription } from '../../src/tools/delegator'

describe('Tool Delegator', () => {
  describe('shouldDelegate', () => {
    it('should suggest sqlmap for SQL injection', () => {
      const result = shouldDelegate('Test for SQL injection in login form')
      expect(result?.tool).toBe('sqlmap')
    })

    it('should suggest sqlmap for sqli', () => {
      const result = shouldDelegate('Check for sqli vulnerability')
      expect(result?.tool).toBe('sqlmap')
    })

    it('should suggest ffuf for directory discovery', () => {
      const result = shouldDelegate('Discover hidden directories on the server')
      expect(result?.tool).toBe('ffuf')
    })

    it('should suggest ffuf for hidden files', () => {
      const result = shouldDelegate('Find hidden files and endpoints')
      expect(result?.tool).toBe('ffuf')
    })

    it('should suggest nuclei for CVE', () => {
      const result = shouldDelegate('Check for known CVE vulnerabilities')
      expect(result?.tool).toBe('nuclei')
    })

    it('should suggest nuclei for misconfiguration', () => {
      const result = shouldDelegate('Scan for misconfiguration issues')
      expect(result?.tool).toBe('nuclei')
    })

    it('should suggest nmap for port scanning', () => {
      const result = shouldDelegate('Scan open ports on target host')
      expect(result?.tool).toBe('nmap')
    })

    it('should suggest nmap for service discovery', () => {
      const result = shouldDelegate('Discover running services on host')
      expect(result?.tool).toBe('nmap')
    })

    it('should return null for unknown hypothesis', () => {
      const result = shouldDelegate('Check for XSS in forms')
      expect(result).toBeNull()
    })
  })

  describe('getAvailableTools', () => {
    it('should return all tools', () => {
      const tools = getAvailableTools()
      expect(tools).toEqual(['sqlmap', 'ffuf', 'nuclei', 'nmap'])
    })
  })

  describe('getToolDescription', () => {
    it('should describe sqlmap', () => {
      const desc = getToolDescription('sqlmap')
      expect(desc).toContain('SQL injection')
    })

    it('should describe ffuf', () => {
      const desc = getToolDescription('ffuf')
      expect(desc).toContain('fuzzer')
    })

    it('should describe nuclei', () => {
      const desc = getToolDescription('nuclei')
      expect(desc.toLowerCase()).toContain('template')
    })

    it('should describe nmap', () => {
      const desc = getToolDescription('nmap')
      expect(desc).toContain('port scanner')
    })
  })
})
