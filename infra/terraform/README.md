# Terraform infrastructure foundation

Terraform now contains reusable AWS network/ECR modules, a development root, and a dedicated root for bootstrapping protected S3 remote state. These configurations describe AWS resources; CI validates them without AWS credentials and never creates or changes infrastructure.

## Network module

- VPC with DNS support and DNS hostnames.
- Public and private /24 subnets in two Availability Zones by default.
- Internet gateway and public subnet routes.
- NAT gateway egress for private subnets, with a single-NAT development default.
- Separate private route tables and Kubernetes load-balancer discovery tags.
- No default public IP assignment for subnets.

The shared single NAT gateway default reduces development costs but is not Availability Zone resilient. For production, decide between one NAT gateway per AZ and a reviewed VPC-endpoint strategy, including cost and failure-mode analysis. Public subnets are intended for approved edge components; application workloads should use private subnets.

## ECR module

- Separate API, frontend and outbox-worker repositories.
- Immutable image tags to prevent a tag from being overwritten.
- Image scanning on push and encryption at rest with AES-256.
- Lifecycle policy expiring untagged images after 14 days and keeping the newest 50 tagged images by default.
- force_delete is false so Terraform will not silently delete non-empty repositories.

## Protected remote state

The `bootstrap-state/` root defines a versioned S3 state bucket, customer-managed KMS encryption, Block Public Access, enforced bucket ownership, a TLS-only bucket policy and destroy protection. Environment roots use the S3 backend with `use_lockfile = true`, the S3-native lock mechanism supported by Terraform 1.10 and later; no DynamoDB table is required.

**The templates have not provisioned the bucket.** Follow [the Terraform state bootstrap and migration runbook](../../docs/terraform-state-runbook.md) with an approved AWS role. The bootstrap root starts with local state, then migrates its state to a distinct key in the newly created bucket. Keep local state, plans and configured backend files out of Git and protect backups as sensitive artifacts.

## Validate

From the repository root:

    terraform fmt -check -recursive infra/terraform
    terraform -chdir=infra/terraform/bootstrap-state init -backend=false
    terraform -chdir=infra/terraform/bootstrap-state validate
    terraform -chdir=infra/terraform/environments/dev init -backend=false
    terraform -chdir=infra/terraform/environments/dev validate

CI runs these checks using Terraform 1.11.4. Validation has no AWS credentials and does not run `plan` or `apply`.

## Before provisioning the development network

Once remote state has been bootstrapped and approved, review the development plan. The current defaults create a VPC, subnets, routing, one NAT gateway and ECR repositories. NAT gateways incur ongoing hourly and data-processing charges. Confirm account, region, CIDR overlap, names, tags, cost and cleanup behavior before any manual apply.

Remaining infrastructure work includes EKS and workload identity, RDS PostgreSQL, Secrets Manager/KMS integration for application secrets, S3/SQS access, monitoring, backup and disaster-recovery/restore drills.
