# Terraform modules

## Current reusable modules

- network/: VPC, public/private subnets, routes and configurable NAT gateway layout.
- ecr/: immutable ECR image repositories, push-time scanning, encryption and lifecycle rules.

Each environment should call reviewed local modules and declare its own Terraform/provider constraints. Keep security-sensitive modules explicit rather than adding broad generic abstractions. Validate formatting and plans in CI, and do not apply from CI until remote state, credentials and environment approval controls are established.
