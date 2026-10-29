import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { HealthController } from './health.controller';
import { WorkItemsController } from './work-items/work-items.controller';
import { WorkItemsService } from './work-items/work-items.service';
import { PIMS_POOL } from './db/database.constants';
import { EntitlementService } from './auth/entitlement.service';
import { SqsAccessEventConsumerService } from './access-events/sqs-access-event-consumer.service';

@Module({
  controllers: [HealthController, WorkItemsController],
  providers: [
    WorkItemsService,
    EntitlementService,
    SqsAccessEventConsumerService,
    {
      provide: PIMS_POOL,
      useFactory: () => {
        const connectionString = process.env.PIMS_DATABASE_URL;
        if (!connectionString) throw new Error('PIMS_DATABASE_URL must be configured');
        const sslEnabled = process.env.PIMS_DATABASE_SSL === 'true';
        if (process.env.NODE_ENV === 'production' && !sslEnabled) {
          throw new Error('PIMS_DATABASE_SSL=true is required in production');
        }
        return new Pool({
          connectionString,
          max: 10,
          connectionTimeoutMillis: 5000,
          idleTimeoutMillis: 30000,
          application_name: 'realcube-pims-api',
          ssl: sslEnabled ? { rejectUnauthorized: true } : undefined,
        });
      },
    },
  ],
})
export class AppModule {}
