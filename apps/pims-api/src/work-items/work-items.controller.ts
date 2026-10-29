import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentPimsPrincipal, PimsPrincipal, RequirePimsPermission } from '../auth/pims-auth';
import { OidcAccessGuard } from '../auth/oidc-access.guard';
import { PimsPermissionGuard } from '../auth/pims-permission.guard';
import { CreateWorkItemDto } from './create-work-item.dto';
import { WorkItemsService } from './work-items.service';

@Controller('work-items')
@UseGuards(OidcAccessGuard, PimsPermissionGuard)
export class WorkItemsController {
  constructor(private readonly workItems: WorkItemsService) {}

  @Get()
  @RequirePimsPermission('pims:read')
  list(@CurrentPimsPrincipal() principal: PimsPrincipal) {
    return this.workItems.list(principal);
  }

  @Post()
  @RequirePimsPermission('pims:write')
  create(
    @CurrentPimsPrincipal() principal: PimsPrincipal,
    @Body() input: CreateWorkItemDto,
  ) {
    return this.workItems.create(principal, input);
  }
}
