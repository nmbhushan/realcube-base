import { Controller, Get } from '@nestjs/common';

const projects = [
  { code: 'PIMS', name: 'PIMS' },
  { code: 'SALES', name: 'Sales' },
  { code: 'BROKER', name: 'Broker' },
  { code: 'SNAGGING', name: 'Snagging' },
  { code: 'LEMS', name: 'LeMS' },
  { code: 'CAFM', name: 'CAFM' },
  { code: 'OA', name: 'OA' },
  { code: 'FINANCE', name: 'Finance' },
  { code: 'SUPPORT', name: 'Support' },
];

@Controller()
export class PlatformInfoController {
  @Get('platform-info')
  getPlatformInfo() {
    // Static non-sensitive placeholder, not an entitlement API.
    return {
      name: 'Enterprise Platform',
      role: 'central-identity-and-access-control-plane',
      status: 'scaffold',
      projects,
      note: 'Replace with persisted APIs; protect administrative endpoints before exposing user/tenant data.',
    };
  }
}
