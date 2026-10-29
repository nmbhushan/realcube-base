import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { OidcAccessGuard } from './oidc-access.guard';

@Module({
  providers: [{ provide: APP_GUARD, useClass: OidcAccessGuard }],
})
export class AuthModule {}
