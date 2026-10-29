import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';

async function bootstrapWorker(): Promise<void> {
  if (process.env.OUTBOX_PUBLISHER_ENABLED !== 'true') {
    throw new Error('Outbox worker requires OUTBOX_PUBLISHER_ENABLED=true');
  }
  if (!process.env.ACCESS_EVENTS_QUEUE_URL) {
    throw new Error('Outbox worker requires ACCESS_EVENTS_QUEUE_URL');
  }
  if (!process.env.PLATFORM_DATABASE_URL) {
    throw new Error('Outbox worker requires PLATFORM_DATABASE_URL');
  }

  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.enableShutdownHooks();
  new Logger('OutboxWorker').log('Started durable access-change outbox publisher');
}
void bootstrapWorker();
