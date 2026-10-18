export interface EnvironmentVariables {
  MONGODB_URI: string;
  JWT_ACCESS_SECRET: string;
  JWT_ACCESS_TTL: string;
  REFRESH_TOKEN_TTL_DAYS: number;
  INITIAL_USER_USERNAME?: string;
  INITIAL_USER_PASSWORD?: string;
  PORT?: string;
}

function required(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required environment variable ${key}`);
  }
  return value;
}

function optional(
  config: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = config[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export function validate(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const ttlDaysRaw = optional(config, 'REFRESH_TOKEN_TTL_DAYS') ?? '7';
  const ttlDays = Number(ttlDaysRaw);
  if (!Number.isInteger(ttlDays) || ttlDays <= 0) {
    throw new Error('REFRESH_TOKEN_TTL_DAYS must be a positive integer');
  }

  const initialUsername = optional(config, 'INITIAL_USER_USERNAME');
  if (
    initialUsername !== undefined &&
    (initialUsername.trim().length < 3 || initialUsername.trim().length > 64)
  ) {
    throw new Error('INITIAL_USER_USERNAME must be 3-64 characters');
  }

  return {
    MONGODB_URI: required(config, 'MONGODB_URI'),
    JWT_ACCESS_SECRET: required(config, 'JWT_ACCESS_SECRET'),
    JWT_ACCESS_TTL: optional(config, 'JWT_ACCESS_TTL') ?? '15m',
    REFRESH_TOKEN_TTL_DAYS: ttlDays,
    INITIAL_USER_USERNAME: initialUsername,
    INITIAL_USER_PASSWORD: optional(config, 'INITIAL_USER_PASSWORD'),
    PORT: optional(config, 'PORT'),
  };
}
