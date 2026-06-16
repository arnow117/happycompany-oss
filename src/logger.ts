import pino from 'pino';

const isTest = process.env.VITEST || process.env.NODE_ENV === 'test';

export const logger = isTest
  ? pino({ level: 'silent' })
  : pino({
      level: process.env.LOG_LEVEL ?? 'info',
      transport: process.env.NODE_ENV === 'production'
        ? undefined
        : {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:HH:MM:ss.l',
              ignore: 'pid,hostname',
            },
          },
    });
