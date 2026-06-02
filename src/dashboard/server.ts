import http from 'http';
import fs from 'fs';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import type { AgentDecision } from '../agents/middleware/agent-decision-emitter';
import type { SessionMeta } from '../core/session-pool';

export interface DashboardEvent {
  type: 'navigate' | 'finding' | 'screenshot' | 'model_update' | 'tool_call' | 'risk_change' | 'session' | 'session_switch' | 'session_diff' | 'status' | 'error' | 'agent_decision';
  data: Record<string, unknown>;
  timestamp: string;
}

export function agentDecisionToEvent(d: AgentDecision): DashboardEvent {
  return {
    type: 'agent_decision',
    data: {
      id: d.id,
      agent: d.agent,
      tool: d.tool,
      args: d.args,
      decision: d.decision,
      risk: d.risk,
      source: d.source,
    },
    timestamp: d.timestamp,
  };
}

export function sessionSwitchToEvent(meta: SessionMeta): DashboardEvent {
  return {
    type: 'session_switch',
    data: {
      sessionId: meta.id,
      label: meta.label,
      role: meta.role,
      authenticated: meta.authenticated,
    },
    timestamp: new Date().toISOString(),
  };
}

export function sessionDiffToEvent(args: { url: string; sessionA: string; sessionB: string; leakDetected: boolean; notes: string[] }): DashboardEvent {
  return {
    type: 'session_diff',
    data: { ...args },
    timestamp: new Date().toISOString(),
  };
}

export interface DashboardServer {
  port: number;
  server: http.Server;
  emit: (event: DashboardEvent) => void;
  close: () => void;
}

function loadHtml(): string {
  const candidates = [
    path.join(process.cwd(), 'src', 'dashboard', 'client.html'),
    path.join(process.cwd(), 'dist', 'dashboard', 'client.html'),
  ];
  for (const p of candidates) {
    try {
      return fs.readFileSync(p, 'utf-8');
    } catch {
      continue;
    }
  }
  throw new Error('Cannot find client.html — checked: ' + candidates.join(', '));
}

export function startDashboard(port = 3000): DashboardServer {
  const dashboardHtml = loadHtml();

  const server = http.createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(dashboardHtml);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  const wss = new WebSocketServer({ server, path: '/ws' });
  const clients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
  });

  function emit(event: DashboardEvent): void {
    const message = JSON.stringify(event);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  function close(): void {
    for (const client of clients) {
      client.close();
    }
    clients.clear();
    wss.close();
    server.close();
  }

  server.listen(port);

  return { port, server, emit, close };
}
