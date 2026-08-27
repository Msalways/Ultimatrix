/**
 * Size Constants - File sizes, buffer sizes, memory limits
 * 
 * All size-related constants in bytes for consistency.
 */

// ========== Base Units ==========
export const BYTES = {
  /** 1 Byte */
  BYTE: 1,
  
  /** 1 Kilobyte = 1,024 bytes */
  KB: 1_024,
  
  /** 1 Megabyte = 1,024 KB */
  MB: 1_024 * 1_024,
  
  /** 1 Gigabyte = 1,024 MB */
  GB: 1_024 * 1_024 * 1_024,
  
  /** 1 Terabyte = 1,024 GB */
  TB: 1_024 * 1_024 * 1_024 * 1_024,
} as const;

// ========== Common Size Aliases ==========
export const SIZE_ALIASES = {
  /** 1 KB = 1,024 bytes */
  KB: 1_024,
  
  /** 1 MB = 1,048,576 bytes */
  MB: 1_024 * 1_024,
  
  /** 1 GB = 1,073,741,824 bytes */
  GB: 1_024 * 1_024 * 1_024,
} as const;

// ========== Common Size Constants ==========
export const SIZES = {
  /** 1 byte */
  BYTE: 1,
  
  /** 1 KB = 1,024 bytes */
  KB: 1_024,
  
  /** 1 MB = 1,024 KB = 1,048,576 bytes */
  MB: 1_024 * 1_024,
  
  /** 1 GB = 1,024 MB */
  GB: 1_024 * 1_024 * 1_024,
  
  /** 1 TB = 1,024 GB */
  TB: 1_024 * 1_024 * 1_024 * 1_024,
  
  // Common size constants
  /** 1 KB */
  ONE_KB: 1_024,
  
  /** 4 KB */
  KB_4: 4 * 1_024,
  
  /** 8 KB */
  KB_8: 8 * 1_024,
  
  /** 16 KB */
  KB_16: 16 * 1_024,
  
  /** 32 KB */
  KB_32: 32 * 1_024,
  
  /** 64 KB */
  KB_64: 64 * 1_024,
  
  /** 128 KB */
  KB_128: 128 * 1_024,
  
  /** 256 KB */
  KB_256: 256 * 1_024,
  
  /** 512 KB */
  KB_512: 512 * 1_024,
  
  /** 1 MB */
  MB_1: 1_024 * 1_024,
  
  /** 2 MB */
  MB_2: 2 * 1_024 * 1_024,
  
  /** 4 MB */
  MB_4: 4 * 1_024 * 1_024,
  
  /** 8 MB */
  MB_8: 8 * 1_024 * 1_024,
  
  /** 10 MB */
  MB_10: 10 * 1_024 * 1_024,
  
  /** 16 MB */
  MB_16: 16 * 1_024 * 1_024,
  
  /** 32 MB */
  MB_32: 32 * 1_024 * 1_024,
  
  /** 50 MB */
  MB_50: 50 * 1_024 * 1_024,
  
  /** 64 MB */
  MB_64: 64 * 1_024 * 1_024,
  
  /** 100 MB */
  MB_100: 100 * 1_024 * 1_024,
  
  /** 1 GB */
  GB_1: 1_024 * 1_024 * 1_024,
  
  /** 2 GB */
  GB_2: 2 * 1_024 * 1_024 * 1_024,
  
  /** 4 GB */
  GB_4: 4 * 1_024 * 1_024 * 1_024,
} as const;

// ========== Pre-calculated Common Sizes ==========
export const COMMON_SIZES = {
  // Buffer sizes
  BUFFER_SMALL: 4 * 1_024,           // 4 KB
  BUFFER_MEDIUM: 64 * 1_024,          // 64 KB
  BUFFER_LARGE: 1_024 * 1_024,       // 1 MB
  BUFFER_HUGE: 64 * 1_024 * 1_024,   // 64 MB
  
  // Stream buffers
  STREAM_HIGH_WATER: 16 * 1_024,
  STREAM_LOW_WATER: 1_024,
  
  // HTTP bodies
  HTTP_MAX_REQUEST: 10 * 1_024 * 1_024,        // 10 MB
  HTTP_MAX_RESPONSE: 50 * 1_024 * 1_024,       // 50 MB
  HTTP_MAX_REQUEST_BODY: 10 * 1_024 * 1_024,   // 10 MB
  HTTP_MAX_RESPONSE_BODY: 50 * 1_024 * 1_024,  // 50 MB
  
  // HAR limits
  HAR_MAX_ENTRY: 10 * 1_024 * 1_024,          // 10 MB
  HAR_MAX_FILE: 100 * 1_024 * 1_024,         // 100 MB
  
  // Skill size limit
  MAX_SKILL_BYTES: 256 * 1_024,               // 256 KB
  
  // Java max buffer
  JAVA_MAX_BUFFER: 64 * 1_024 * 1_024,       // 64 MB
} as const;

// ========== Size Units ==========
export const SIZE_UNITS = {
  B: 'B',
  KB: 'KB',
  MB: 'MB',
  GB: 'GB',
  TB: 'TB',
  PB: 'PB',
} as const;

// ========== Format Options ==========
export const SIZE_FORMAT_OPTIONS = {
  /** Use binary units (KiB, MiB, GiB) */
  BINARY: true,
  
  /** Use decimal units (KB, MB, GB) */
  DECIMAL: false,
  
  /** Decimal places for formatted output */
  DECIMAL_PLACES: 2,
  
  /** Use space between number and unit */
  SPACE: true,
} as const;

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number, options: {
  binary?: boolean;
  decimals?: number;
  space?: boolean;
} = {}): string {
  const { binary = true, decimals = 2, space = true } = options;
  
  if (bytes === 0) return '0 B';
  
  const k = options.binary === false ? 1000 : 1024;
  const dm = options.decimals ?? 2;
  const sizes = options.binary === false 
    ? ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
    : ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);
  
  const space = options.space ? ' ' : '';
  return `${value.toFixed(dm)}${space}${sizes[i]}`;
}

/**
 * Parse human-readable size string to bytes
 * e.g., "10 MB" -> 10485760
 */
export function parseSize(size: string): number {
  const match = size.trim().match(/^([\d.]+)\s*(B|KB|MB|GB|TB|PB|KiB|MiB|GiB|TiB|PiB)?$/i);
  if (!match) throw new Error(`Invalid size format: ${size}`);
  
  const value = parseFloat(match[1]);
  const unit = (match[2] || 'B').toUpperCase();
  
  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1_000, KIB: 1_024,
    MB: 1_000_000, MIB: 1_048_576,
    GB: 1_000_000_000, GIB: 1_073_741_824,
    TB: 1_000_000_000_000, TIB: 1_099_511_627_776,
    PB: 1_000_000_000_000_000, PIB: 1_125_899_906_842_624,
  };
  
  const multiplier = multipliers[unit] ?? 1;
  return Math.floor(value * multiplier);
}

/**
 * Format bytes with automatic unit selection
 */
export function formatBytesAuto(bytes: number, options: {
  binary?: boolean;
  decimals?: number;
} = {}): string {
  return formatBytes(bytes, options);
}