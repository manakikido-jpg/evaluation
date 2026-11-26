import pino from 'pino';
import { serializeErrorForLog } from './errorLog.js';

export const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', serializers: { err: serializeErrorForLog } });
