// Único módulo que lê process.env (regra do projeto).
const env = process.env;

function numberFrom(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export const config = Object.freeze({
  nodeEnv: env.NODE_ENV || 'development',
  port: numberFrom(env.PORT, 3000),
  databaseUrl: env.DATABASE_URL || 'postgres://catraca:catraca@localhost:5432/catraca',
  partnerApiKey: env.PARTNER_API_KEY || 'catraca-parceiro-dev',
  gatewayDelayScale: numberFrom(env.GATEWAY_DELAY_SCALE, 1),
  sessionTtlDays: 7,
});

export const isTest = config.nodeEnv === 'test';
export const isProduction = config.nodeEnv === 'production';
