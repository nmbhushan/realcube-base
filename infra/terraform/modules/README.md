# Terraform modules

## Current reusable modules

- network/: VPC, public/private subnets, routes and configurable NAT gateway layout.
- ecr/: immutable ECR image repositories, push-time scanning, encryption and lifecycle rules.
- eks/: private-by-default EKS control plane, private managed node group, explicit access entry, encrypted Kubernetes Secrets, audit/control-plane logs, and optional SQS-scoped Pod Identity for the outbox worker.

Each environment should call reviewed local modules and declare its own Terraform/provider constraints. EKS is opt-in in the dev root and must only be enabled after remote state, cluster-admin identity, private network access, account permissions and costs have been reviewed. Keep security-sensitive modules explicit rather than using broad generic abstractions. CI formats and validates but never applies.
