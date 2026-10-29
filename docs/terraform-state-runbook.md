# Terraform Remote State Bootstrap and Migration

## Scope

This runbook sets up a dedicated S3 backend for RealCube Terraform state. The bootstrap root creates the S3 bucket and its customer-managed KMS key; environment roots then use S3 state with S3-native lock files. It does not create the VPC/ECR resources, EKS, databases, or any application infrastructure.

The bootstrap is deliberately manual and must run with an approved AWS identity. CI only formats, initializes without a backend and validates Terraform. It has no AWS credentials and never runs `plan` or `apply`.

## Security defaults

- Separate S3 bucket for Terraform state, with versioning enabled.
- Customer-managed KMS key with key rotation and a 30-day deletion window.
- Default bucket encryption using SSE-KMS and S3 Bucket Keys.
- S3 Block Public Access and `BucketOwnerEnforced` ownership controls.
- Bucket policy denies requests using insecure transport (non-TLS).
- Bucket and KMS key use Terraform `prevent_destroy`; the bucket also has `force_destroy = false`.
- Terraform S3 backend locking uses `use_lockfile = true`, supported by Terraform 1.10+; no DynamoDB lock table is created.

State can contain sensitive values. Do not commit the local bootstrap state file, generated backend configuration, plan files, credentials, or state backups. Restrict S3, KMS and state-object permissions to the approved operator and automation roles. Use a separately administered state bucket/account and stronger separation for production if required by security policy.

## Phase A — Bootstrap the state bucket

Prerequisites: Terraform 1.10+, AWS CLI, an approved AWS profile/role with permissions to create KMS keys/aliases and S3 buckets/policies, and permission to read the target account identity.

1. Verify the intended AWS account and role using your approved login process, for example `aws sts get-caller-identity`.
2. Copy `infra/terraform/bootstrap-state/terraform.tfvars.example` to `terraform.tfvars` in that directory. Change `state_bucket_name` to a globally unique, lowercase S3 bucket name. Choose the intended region; bucket and key should remain colocated.
3. Back up any existing local Terraform state before proceeding.
4. Initialize using local state for the bootstrap operation:

   ```bash
   terraform -chdir=infra/terraform/bootstrap-state init -backend=false
   terraform -chdir=infra/terraform/bootstrap-state fmt -check
   terraform -chdir=infra/terraform/bootstrap-state validate
   terraform -chdir=infra/terraform/bootstrap-state plan -out=bootstrap.tfplan
   ```

5. Review the plan carefully. It should create only the bootstrap KMS key and alias, S3 bucket, public access block, ownership controls, versioning, encryption configuration and TLS-only bucket policy. Confirm account, region, names, cost and tags.
6. Apply only after approval:

   ```bash
   terraform -chdir=infra/terraform/bootstrap-state apply bootstrap.tfplan
   terraform -chdir=infra/terraform/bootstrap-state output
   ```

The state bucket has no NAT or EKS resource dependencies; normal S3/KMS service costs apply. The bootstrap root state is local until Phase B, so protect it and its backup as sensitive artifacts.

## Phase B — Migrate the bootstrap root to the new S3 backend

1. Copy `infra/terraform/bootstrap-state/backend.hcl.example` to `backend.hcl` in that directory.
2. Set the bucket, region and KMS ARN using the bootstrap outputs. Keep `key = "bootstrap/terraform.tfstate"` distinct from all environment state keys.
3. Ensure the bucket exists and your identity can read/write the state object and lock object, use the KMS key, and list the bucket. Back up the local state file.
4. Migrate the state:

   ```bash
   terraform -chdir=infra/terraform/bootstrap-state init -migrate-state -backend-config=backend.hcl
   terraform -chdir=infra/terraform/bootstrap-state plan
   ```

   Review the plan; it should not recreate the bootstrap resources. If Terraform says no state migration is required, verify the selected workspace, backend and state before continuing. Do not delete local backups until remote state has been verified.

## Phase C — Configure the development environment backend

1. Copy `infra/terraform/environments/dev/backend.hcl.example` to `backend.hcl` in the development root. Use the same bucket/KMS key and the environment-specific key `realcube-workspace/dev/terraform.tfstate`.
2. Confirm `terraform.tfvars` contains the intended development region, CIDR and settings; do not commit the local file.
3. If a local state file exists, back it up and migrate it:

   ```bash
   terraform -chdir=infra/terraform/environments/dev init -migrate-state -backend-config=backend.hcl
   ```

   If this root has never had local state, initialize the configured remote backend instead:

   ```bash
   terraform -chdir=infra/terraform/environments/dev init -reconfigure -backend-config=backend.hcl
   ```

4. Verify the workspace and state location, then inspect a plan before any later resource deployment:

   ```bash
   terraform -chdir=infra/terraform/environments/dev workspace show
   terraform -chdir=infra/terraform/environments/dev state list
   terraform -chdir=infra/terraform/environments/dev plan
   ```

Do not apply the environment plan until the separate network/ECR resource changes have been reviewed and the account, naming, CIDR overlap, NAT cost and cleanup implications are approved.

## IAM access required

The operator/automation role should have least-privilege access to the exact state bucket and exact state prefixes. At minimum, state operations require listing the bucket with a prefix restriction and `s3:GetObject`/`s3:PutObject` on the state's object. The S3 lock file also requires `s3:GetObject`, `s3:PutObject` and `s3:DeleteObject` on the matching `.tflock` key. KMS permissions should be limited to the configured key and the Terraform roles that need it (including encrypt/decrypt/data-key operations). Adapt these permissions to your organization's IAM policy standards; do not use wildcard access to all buckets or all KMS keys.

## Recovery and operations

- Enable alerts for denied state access and KMS errors using the team's logging/monitoring baseline.
- Use S3 object versions to recover accidental overwrites; first stop active Terraform runs, identify the correct version, and follow a reviewed state recovery procedure.
- Do not manually delete `.tflock` objects while a Terraform operation may still be active.
- Never use `terraform force-unlock` until the lock ID, active runs and owning operator have been checked.
- Protect the KMS key from deletion and define a documented recovery/access procedure.
- Keep separate state keys and identities for dev, staging and production. Do not share one state file across environments.

## Exit criteria

- Bucket has versioning, SSE-KMS, Block Public Access, enforced bucket ownership and TLS-only access.
- Bootstrap state has been migrated and verified in S3.
- Development backend has a unique state key and S3 lock file is enabled.
- CI validates both Terraform roots without AWS credentials and still performs no deployment.
