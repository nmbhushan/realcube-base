# Read-only infrastructure verification

## Purpose

Use `scripts/verify-infra-readonly.sh` as the evidence-gathering step before enabling or applying the development EKS environment. It checks the active AWS identity, regional inventory for EKS, RDS, ElastiCache, ECR, SQS, CloudWatch alarms/log groups and Secrets Manager metadata, then attempts to read the development Terraform state.

The script is intentionally read-only. It does **not** run `terraform plan`, `apply`, `destroy`, read secret values, or claim that a resource is healthy merely because it exists.

## Prerequisites

- AWS CLI v2, Terraform, and an approved AWS profile/role.
- Network access and IAM permissions for the inventory calls.
- An initialized Terraform backend for `infra/terraform/environments/dev`; keep `backend.hcl` and credentials local and out of Git.
- An approved change record that identifies the expected AWS account and region.

## Run

From the repository root:

```bash
export AWS_PROFILE=your-approved-profile
export AWS_REGION=ap-south-1
aws sts get-caller-identity
bash scripts/verify-infra-readonly.sh
```

First compare the account ID and caller ARN with the approved environment. If they do not match, stop and do not proceed. The script prints metadata only; do not add commands that fetch or print secret values.

If the Terraform state step fails, do not assume that infrastructure is absent. Confirm the correct backend configuration and permissions with the infrastructure owner. Follow [the Terraform state runbook](terraform-state-runbook.md) before any state migration or apply.

## How to interpret the results

- **Resource exists:** inventory confirms that AWS reports the resource in the selected account/region; it does not prove application connectivity, security posture, or recovery readiness.
- **Empty result:** no matching resource was returned to this identity in this region, or permissions/filters prevented visibility. Check the AWS identity, region and IAM permissions.
- **Command failed:** classify it as unverified until the error is understood; do not mark the phase complete.
- **Terraform state list succeeded:** the configured backend was readable. Compare state resources with the AWS inventory and investigate drift; a successful state listing does not prove state freshness or healthy workloads.

## Exit criteria before EKS deployment

- [ ] AWS account, role and region match the approved development environment.
- [ ] Remote S3 state bucket, KMS encryption and locking are verified under the state runbook.
- [ ] Development VPC/subnets and ECR repositories are reviewed; CIDR overlap and egress costs are understood.
- [ ] Terraform state and AWS inventory are reconciled; unexplained drift is resolved.
- [ ] EKS version support, private endpoint access path, admin principal ARN, node sizing and estimated costs are approved.
- [ ] An approved Terraform plan has been reviewed by a human before any apply.

After the EKS apply is separately approved and completed, follow [the EKS foundation runbook](eks-foundation-runbook.md) to verify nodes, add-ons, access entries, Pod Identity and control-plane logs. Then proceed to controller/secrets/data-service integrations and non-production release validation.
