import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { OidcAccessGuard } from './oidc-access.guard';
import { PlatformPermissionGuard } from './platform-permission.guard';

@Module({
  providers: [
    // Register authentication before authorization: the second guard consumes request.user.
    { provide: APP_GUARD, useClass: OidcAccessGuard },
    { provide: APP_GUARD, useClass: PlatformPermissionGuard },
  ],
})
export class AuthModule {}
