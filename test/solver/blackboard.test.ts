import { describe, it, expect, beforeEach } from 'vitest'
import { Blackboard, IntentStatus, TaskStatus } from '../../src/solver/blackboard'

describe('Blackboard', () => {
  let board: Blackboard

  beforeEach(() => {
    board = new Blackboard({ origin: 'https://example.com', goal: 'Find SQL injection' })
  })

  it('seeds with origin and goal', () => {
    expect(board.origin).toBe('https://example.com')
    expect(board.goal).toBe('Find SQL injection')
  })

  it('adds facts with sequential IDs', () => {
    const f1 = board.addFact('Target responds on port 80')
    const f2 = board.addFact('Login page found at /admin')
    expect(f1.id).toBe('f001')
    expect(f2.id).toBe('f002')
    expect(board.facts).toHaveLength(2)
  })

  it('retrieves fact by ID', () => {
    board.addFact('Test fact')
    expect(board.getFact('f001')).toBeDefined()
    expect(board.getFact('f001')?.description).toBe('Test fact')
  })

  it('returns undefined for missing fact', () => {
    expect(board.getFact('f999')).toBeUndefined()
  })

  it('adds intents with sequential IDs', () => {
    const i1 = board.addIntent('Test SQL injection')
    const i2 = board.addIntent('Test XSS')
    expect(i1.id).toBe('i001')
    expect(i2.id).toBe('i002')
  })

  it('validates fromFacts references', () => {
    board.addFact('Base fact')
    const intent = board.addIntent('Test from fact', ['f001', 'f999'])
    expect(intent.fromFacts).toEqual(['f001'])
  })

  it('lists open intents', () => {
    board.addIntent('Intent 1')
    board.addIntent('Intent 2')
    expect(board.openIntents()).toHaveLength(2)
  })

  it('claims intent changes status', () => {
    board.addIntent('Test intent')
    board.claimIntent('i001')
    expect(board.getIntent('i001')?.status).toBe(IntentStatus.EXPLORING)
  })

  it('concludes intent creates new fact', () => {
    board.addFact('Base fact')
    board.addIntent('Test intent', ['f001'])
    const fact = board.concludeIntent('i001', 'Found SQL injection on /api')
    expect(fact).not.toBeNull()
    expect(fact?.id).toBe('f002')
    expect(fact?.description).toContain('SQL injection')
    expect(board.getIntent('i001')?.status).toBe(IntentStatus.CONCLUDED)
    expect(board.getIntent('i001')?.resultFact).toBe('f002')
  })

  it('abandons intent with note', () => {
    board.addIntent('Dead end path')
    board.abandonIntent('i001', 'WAF blocks all requests')
    expect(board.getIntent('i001')?.status).toBe(IntentStatus.ABANDONED)
    expect(board.getIntent('i001')?.note).toBe('WAF blocks all requests')
  })

  it('marks complete', () => {
    board.markComplete('SQL injection confirmed with flag extraction')
    expect(board.completed).toBe(true)
    expect(board.completeReason).toContain('SQL injection')
  })

  it('records tool calls', () => {
    board.recordToolCall('httpRequest', 'GET,/api', 'i001', 200, '200 OK')
    expect(board.toolCalls).toHaveLength(1)
    expect(board.toolCalls[0].tool).toBe('httpRequest')
  })

  it('detects duplicate tool calls', () => {
    board.recordToolCall('httpRequest', 'GET,/api', 'i001', 200)
    expect(board.hasCalled('httpRequest', 'GET,/api')).toBe(true)
    expect(board.hasCalled('httpRequest', 'GET,/other')).toBe(false)
  })

  it('generates tool call summary', () => {
    board.recordToolCall('httpRequest', 'GET,/api', 'i001', 200, 'OK')
    board.recordToolCall('parseResponse', 'body', 'i002', 200)
    const summary = board.toolCallSummary()
    expect(summary).toContain('httpRequest')
    expect(summary).toContain('parseResponse')
  })

  it('renders prompt graph in English', () => {
    board.addFact('Target is alive')
    board.addIntent('Test endpoint')
    const graph = board.toPromptGraph()
    expect(graph).toContain('goal:')
    expect(graph).toContain('origin:')
    expect(graph).toContain('facts:')
    expect(graph).toContain('intents:')
    expect(graph).toContain('f001: Target is alive')
    expect(graph).toContain('i001 [open]: Test endpoint')
    expect(graph).toContain('plan:')
    expect(graph).not.toContain('(未设定)')
  })

  it('renders empty graph', () => {
    const graph = board.toPromptGraph()
    expect(graph).toContain('(none)')
  })

  it('returns summary', () => {
    board.addFact('f1')
    board.addIntent('i1')
    const summary = board.getSummary()
    expect(summary.facts).toBe(1)
    expect(summary.intents).toBe(1)
    expect(summary.openIntents).toBe(1)
  })

  it('constructs from data', () => {
    const b2 = new Blackboard({
      origin: 'https://test.com',
      goal: 'Get shell',
      facts: [{ id: 'f001', description: 'Test fact', source: 'origin' }],
    })
    expect(b2.facts).toHaveLength(1)
    expect(b2.factSeq).toBe(1)
  })

  it('lists active intents (open + exploring)', () => {
    board.addIntent('i1')
    board.addIntent('i2')
    board.addIntent('i3')
    board.claimIntent('i002')
    board.abandonIntent('i003', 'dead end')
    expect(board.activeIntents()).toHaveLength(2) // i001 open, i002 exploring
  })
})

describe('Blackboard Plan', () => {
  let board: Blackboard

  beforeEach(() => {
    board = new Blackboard({ origin: 'https://example.com', goal: 'Find vulnerabilities' })
  })

  it('adds plan tasks with sequential IDs', () => {
    const t1 = board.addTask('/api/users', 'sqli', 1)
    const t2 = board.addTask('/login', 'auth_bypass', 2)
    expect(t1.id).toBe('t001')
    expect(t2.id).toBe('t002')
    expect(board.plan).toHaveLength(2)
  })

  it('returns next task by priority', () => {
    board.addTask('/api/admin', 'idor', 5)
    board.addTask('/api/users', 'sqli', 1)
    board.addTask('/login', 'auth_bypass', 3)
    const next = board.nextTask()
    expect(next?.id).toBe('t002') // sqli has priority 1
    expect(next?.technique).toBe('sqli')
  })

  it('skips tested tasks when finding next', () => {
    board.addTask('/api/users', 'sqli', 1)
    board.addTask('/login', 'auth_bypass', 2)
    board.completeTask('t001', 'Found SQL error messages')
    const next = board.nextTask()
    expect(next?.id).toBe('t002')
  })

  it('skips pending tasks in priority order', () => {
    board.addTask('/a', 'xss', 5)
    board.addTask('/b', 'sqli', 1)
    board.addTask('/c', 'idor', 3)
    expect(board.nextTask()?.id).toBe('t002') // sqli priority 1
    board.skipTask('t002', 'Not applicable')
    expect(board.nextTask()?.id).toBe('t003') // idor priority 3
    board.skipTask('t003', 'No parameters')
    expect(board.nextTask()?.id).toBe('t001') // xss priority 5
  })

  it('completes task and creates fact', () => {
    board.addTask('/api/users', 'sqli', 1)
    const task = board.completeTask('t001', 'SQL error messages leak database info')
    expect(task?.status).toBe(TaskStatus.TESTED)
    expect(task?.resultNote).toBe('SQL error messages leak database info')
    expect(task?.resultFact).toBeTruthy()
    expect(board.facts.length).toBe(1)
    expect(board.facts[0].description).toContain('SQL error messages')
  })

  it('skips task with reason', () => {
    board.addTask('/api/users', 'xss', 1)
    const task = board.skipTask('t001', 'Endpoint returns 404')
    expect(task?.status).toBe(TaskStatus.SKIPPED)
    expect(task?.resultNote).toBe('Endpoint returns 404')
  })

  it('blocks task with reason', () => {
    board.addTask('/api/admin', 'idor', 1)
    const task = board.blockTask('t001', 'WAF blocks all requests')
    expect(task?.status).toBe(TaskStatus.BLOCKED)
    expect(task?.resultNote).toBe('WAF blocks all requests')
  })

  it('tracks tested endpoints for dedup', () => {
    expect(board.isTested('/api/users', 'sqli')).toBe(false)
    board.addTask('/api/users', 'sqli', 1)
    board.completeTask('t001', 'Found SQLi')
    expect(board.isTested('/api/users', 'sqli')).toBe(true)
  })

  it('dedup works after skip', () => {
    board.addTask('/api/users', 'xss', 1)
    board.skipTask('t001', 'No reflection point')
    expect(board.isTested('/api/users', 'xss')).toBe(true)
    // Next task for same endpoint+technique should not be added
  })

  it('dedup key is case-insensitive', () => {
    board.addTask('/API/Users', 'SQLi', 1)
    board.completeTask('t001', 'Found SQLi')
    expect(board.isTested('/api/users', 'sqli')).toBe(true)
  })

  it('returns undefined when no pending tasks', () => {
    board.addTask('/a', 'sqli', 1)
    board.completeTask('t001', 'Done')
    expect(board.nextTask()).toBeUndefined()
  })

  it('generates plan summary', () => {
    board.addTask('/api/users', 'sqli', 1)
    board.addTask('/login', 'auth_bypass', 2)
    board.completeTask('t001', 'Found SQLi')
    board.skipTask('t002', 'No auth form')
    const summary = board.planSummary()
    expect(summary).toContain('t001')
    expect(summary).toContain('t002')
    expect(summary).toContain('done')
    expect(summary).toContain('skip')
  })

  it('counts plan statuses', () => {
    board.addTask('/a', 'sqli', 1)
    board.addTask('/b', 'xss', 2)
    board.addTask('/c', 'idor', 3)
    board.completeTask('t001', 'Done')
    board.skipTask('t002', 'Skip')
    const counts = board.planCounts()
    expect(counts['tested']).toBe(1)
    expect(counts['skipped']).toBe(1)
    expect(counts['pending']).toBe(1)
  })

  it('summary includes plan in prompt graph', () => {
    board.addTask('/api/users', 'sqli', 1)
    const graph = board.toPromptGraph()
    expect(graph).toContain('plan:')
    expect(graph).toContain('t001')
    expect(graph).toContain('sqli')
    expect(graph).toContain('todo')
  })

  it('summary shows completed tasks as done', () => {
    board.addTask('/api/users', 'sqli', 1)
    board.completeTask('t001', 'Found SQLi')
    const graph = board.toPromptGraph()
    expect(graph).toContain('done')
  })

  it('getSummary includes plan counts', () => {
    board.addTask('/a', 'sqli', 1)
    board.completeTask('t001', 'Done')
    const summary = board.getSummary()
    expect(summary.planTotal).toBe(1)
    expect(summary.planCounts).toEqual({ tested: 1 })
  })

  it('constructs from data with plan', () => {
    const b2 = new Blackboard({
      origin: 'https://test.com',
      goal: 'Get shell',
      plan: [
        { id: 't001', endpoint: '/api', technique: 'sqli', priority: 1, status: TaskStatus.TESTED, resultFact: null, resultNote: 'Done', testedKey: '/api|sqli' },
      ],
    })
    expect(b2.plan).toHaveLength(1)
    expect(b2.isTested('/api', 'sqli')).toBe(true)
  })
})
