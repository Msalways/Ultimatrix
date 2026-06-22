import { PinoLogger } from '@mastra/loggers'
import { Observability, ConsoleExporter } from '@mastra/observability'

let _logger: PinoLogger | null = null
let _observability: Observability | null = null

export function initLogger(): PinoLogger {
  if (_logger) return _logger
  _logger = new PinoLogger({
    name: 'ultimatrix',
    level: (process.env.LOG_LEVEL || 'info') as any,
  })
  return _logger
}

export function getLogger(): PinoLogger | null {
  return _logger
}

export function initObservability(): Observability {
  if (_observability) return _observability
  _observability = new Observability({
    configs: {
      default: {
        serviceName: 'ultimatrix',
        exporters: [new ConsoleExporter()],
        logging: { enabled: true, level: 'info' },
      },
    },
  })
  return _observability
}

export function getObservability(): Observability | null {
  return _observability
}
