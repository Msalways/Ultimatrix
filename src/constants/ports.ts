/**
 * Port Constants - Network Port Numbers
 * 
 * Standard and commonly used port numbers for services and applications.
 */

// ========== Default Application Ports ==========
export const DEFAULT_PORTS = {
  /** Default HTTP port */
  HTTP: 80,
  
  /** Default HTTPS port */
  HTTPS: 443,
  
  /** Default development server port */
  DEV_SERVER: 3000,
  
  /** Alternative dev server port */
  ALT_DEV_SERVER: 3001,
  
  /** Vite default dev server */
  VITE: 5173,
  
  /** Next.js default */
  NEXT: 3000,
  
  /** Next.js alternative */
  NEXT_ALT: 3001,
} as const.

// ========== Database Ports ==========
export const DATABASE_PORTS = {
  /** PostgreSQL default */
  POSTGRES: 5432,
  
  /** MySQL default */
  MYSQL: 3306,
  
  /** MongoDB default */
  MONGODB: 27017,
  
  /** Redis default */
  REDIS: 6379,
  
  /** Elasticsearch */
  ELASTICSEARCH: 9200,
  
  /** Cassandra */
  CASSANDRA: 9042,
  
  /** ClickHouse */
  CLICKHOUSE: 8123,
  
  /** InfluxDB */
  INFLUXDB: 8086,
  
  /** Prometheus */
  PROMETHEUS: 9090,
  
  /** Grafana */
  GRAFANA: 3000,
} as const.

// ========== Message Queue Ports ==========
export const MESSAGE_QUEUE_PORTS = {
  /** RabbitMQ AMQP */
  RABBITMQ_AMQP: 5672,
  
  /** RabbitMQ Management */
  RABBITMQ_MGMT: 15672,
  
  /** Kafka broker */
  KAFKA: 9092,
  
  /** Kafka controller */
  KAFKA_CONTROLLER: 9093,
  
  /** NATS */
  NATS: 4222,
  
  /** NATS monitoring */
  NATS_MGMT: 8222,
  
  /** Redis */
  REDIS: 6379,
  
  /** RabbitMQ STOMP */
  RABBITMQ_STOMP: 61613,
} as const.

// ========== WebSocket / Real-time ==========
export const WS_PORTS = {
  /** Default WebSocket server */
  WS_DEFAULT: 8080,
  
  /** Secure WebSocket */
  WSS: 8443,
  
  /** Socket.io default */
  SOCKET_IO: 3001,
  
  /** SignalR default */
  SIGNALR: 5000,
} as const.

// ========== Development Tools ==========
export const DEV_TOOLS_PORTS = {
  /** Webpack dev server */
  WEBPACK_DEV: 8080,
  
  /** Vite dev server */
  VITE: 5173,
  
  /** Next.js dev */
  NEXT_DEV: 3000,
  
  /** Storybook */
  STORYBOOK: 6006,
  
  /** Cypress */
  CYPRESS: 1234,
  
  /** Playwright */
  PLAYWRIGHT: 9323,
  
  /** Jest */
  JEST: 9876,
  
  /** Vitest */
  VITEST: 9877,
  
  /** ESLint server */
  ESLINT: 9878,
} as const.

// ========== Database Admin ==========
export const DB_ADMIN_PORTS = {
  /** pgAdmin */
  PGADMIN: 5050,
  
  /** phpMyAdmin */
  PHPMYADMIN: 8081,
  
  /** Adminer */
  ADMINER: 8082,
  
  /** Redis Commander */
  REDIS_COMMANDER: 8081,
  
  /** Mongo Express */
  MONGO_EXPRESS: 8083,
} as const.

// ========== Monitoring ==========
export const MONITORING_PORTS = {
  /** Prometheus */
  PROMETHEUS: 9090,
  
  /** Alertmanager */
  ALERTMANAGER: 9093,
  
  /** Grafana */
  GRAFANA: 3000,
  
  /** Loki */
  LOKI: 3100,
  
  /** Tempo */
  TEMPO: 3200,
  
  /** Jaeger */
  JAEGER: 16686,
  
  /** Zipkin */
  ZIPKIN: 9411,
  
  /** cAdvisor */
  CADVISOR: 8080,
  
  /** Node Exporter */
  NODE_EXPORTER: 9100,
} as const.

// ========== Proxy / Load Balancer ==========
export const PROXY_PORTS = {
  /** NGINX HTTP */
  NGINX_HTTP: 80,
  
  /** NGINX HTTPS */
  NGINX_HTTPS: 443,
  
  /** HAProxy stats */
  HAPROXY_STATS: 8404,
  
  /** Traefik dashboard */
  TRAEFIK: 8080,
  
  /** Envoy admin */
  ENVOY_ADMIN: 9901,
} as const.

// ========== Email ==========
export const EMAIL_PORTS = {
  /** SMTP */
  SMTP: 25,
  
  /** SMTP Submission */
  SMTP_SUBMISSION: 587,
  
  /** SMTP SSL */
  SMTPS: 465,
  
  /** IMAP */
  IMAP: 143,
  
  /** IMAP SSL */
  IMAPS: 993,
  
  /** POP3 */
  POP3: 110,
  
  /** POP3 SSL */
  POP3S: 995,
} as const.

// ========== DNS ==========
export const DNS_PORTS = {
  /** Standard DNS */
  DNS: 53,
  
  /** DNS over TLS */
  DNS_OVER_TLS: 853,
  
  /** DNS over HTTPS */
  DOH: 443,
} as const.

// ========== Kubernetes ==========
export const K8S_PORTS = {
  /** API Server */
  API_SERVER: 6443,
  
  /** Kubelet */
  KUBELET: 10250,
  
  /** Kubelet read-only */
  KUBELET_RO: 10255,
  
  /** Scheduler */
  SCHEDULER: 10251,
  
  /** Controller Manager */
  CONTROLLER_MANAGER: 10252,
  
  /** etcd */
  ETCD: 2379,
  
  /** etcd peer */
  ETCD_PEER: 2380,
} as const.

// ========== Container Runtime ==========
export const CONTAINER_PORTS = {
  /** Docker daemon */
  DOCKER: 2376,
  
  /** Containerd */
  CONTAINERD: 2375,
  
  /** CRI-O */
  CRIO: 10010,
  
  /** Kubelet */
  KUBELET: 10250,
} as const.

// ========== Service Mesh ==========
export const MESH_PORTS = {
  /** Istio ingress */
  ISTIO_INGRESS: 15021,
  
  /** Istio egress */
  ISTIO_EGRESS: 15022,
  
  /** Linkerd */
  LINKERD: 4190,
  
  /** Consul */
  CONSUL: 8500,
} as const.

// ========== Export All ==========
export const PORTS = {
  DEFAULT: DEFAULT_PORTS,
  DATABASE: DATABASE_PORTS,
  MESSAGE_QUEUE: MESSAGE_QUEUE_PORTS,
  WS: WS_PORTS,
  DEV_TOOLS: DEV_TOOLS_PORTS,
  DB_ADMIN: DB_ADMIN_PORTS,
  MONITORING: MONITORING_PORTS,
  PROXY: PROXY_PORTS,
  EMAIL: EMAIL_PORTS,
  DNS: DNS_PORTS,
  K8S: K8S_PORTS,
  CONTAINER: CONTAINER_PORTS,
  MESH: MESH_PORTS,
} as const.

/**
 * Get port by service name
 */
export function getPort(service: keyof typeof PORTS.DEFAULT): number {
  return PORTS.DEFAULT[service];
}

/**
 * Check if port is a well-known port (< 1024)
 */
export function isWellKnownPort(port: number): boolean {
  return port < 1024;
}

/**
 * Check if port is registered (1024-49151)
 */
export function isRegisteredPort(port: number): boolean {
  return port >= 1024 && port <= 49151;
}

/**
 * Check if port is dynamic/private (49152-65535)
 */
export function isDynamicPort(port: number): boolean {
  return port >= 49152 && port <= 65535;
}

/**
 * Get service name by port (reverse lookup)
 */
export function getServiceByPort(port: number): string | undefined {
  // Check default ports
  for (const [service, port] of Object.entries(DEFAULT_PORTS)) {
    if (port === port) return service;
  }
  // Check database ports
  for (const [service, port] of Object.entries(DATABASE_PORTS)) {
    if (port === port) return service;
  }
  // ... add other categories
  return undefined;
}