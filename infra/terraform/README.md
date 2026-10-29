# Terraform infrastructure foundation

The development root now defines a reusable network baseline and Amazon ECR repositories. CI validates the Terraform configuration but never authenticates to AWS or creates resources.

## Implemented

### Network module

- VPC with DNS support and DNS hostnames.
- Public and private /24 subnets in two Availability Zones by default.
- Internet gateway and public subnet routes.
- NAT gateway egress for private subnets, with a single-NAT development default.
- Separate private route tables and Kubernetes load-balancer discovery tags.
- No default public IP assignment for subnets.

The shared single NAT gateway default reduces development costs but is not Availability Zone resilient. For production, decide between one NAT gateway per AZ and a reviewed VPC-endpoint strategy, including cost and failure-mode analysis. Public subnets are intended for approved edge components; application workloads should use private subnets.

### ECR module

- Separate API, frontend and outbox-worker repositories.
- Immutable image tags to prevent a tag from being overwritten.
- Image scanning on push and encryption at rest with AES-256.
- Lifecycle policy expiring untagged images after 14 days and keeping the newest 50 tagged images by default.
- force_delete is false so Terraform will not silently delete non-empty repositories.

## Validate

From the repository root:

    terraform fmt -check -recursive infra/terraform
    terraform -chdir=infra/terraform/environments/dev init -backend=false
    terraform -chdir=infra/terraform/environments/dev validate

CI runs the same checks. Validation uses no AWS credentials and does not provision resources.

## State and deployment guardrails

**Do not apply this root to a shared or production account yet.** The remote backend has not been provisioned. Before any stateful apply, implement and review a separately bootstrapped encrypted S3 state bucket, locking, versioning, restricted access, audit logging and environment-specific state keys/roles. Never commit state files or plans.

A Terraform plan for the current defaults will create a VPC, subnets, routing, a NAT gateway and ECR repositories. NAT gateways incur ongoing hourly and data-processing charges. Use an authorized development account, inspect and review a saved plan, and confirm expected cost and cleanup behavior before any manual apply. No deploy/apply is performed by the repository workflow.

Next infrastructure steps are secure remote state, EKS and workload identities, RDS PostgreSQL, Secrets Manager/KMS, S3/SQS integration, monitoring, and disaster-recovery/restore drills.
