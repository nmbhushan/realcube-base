# Terraform infrastructure foundation

Terraform now contains reusable AWS network/ECR modules, a development root, a protected S3 remote-state bootstrap, and a private-by-default EKS module. CI validates these configurations without AWS credentials and never applies infrastructure.

## Network and ECR

The network module creates a DNS-enabled VPC with public and private /24 subnets across two Availability Zones by default, an internet gateway, private routing and NAT egress. Private subnets do not auto-assign public IP addresses. The single NAT default reduces development cost but is not AZ-resilient.

The ECR module creates API, frontend and outbox-worker repositories with immutable tags, push-time scanning, AES-256 at-rest encryption, and image lifecycle rules. Repositories use `force_delete = false`.

## Protected remote state

The `bootstrap-state/` root defines a versioned S3 state bucket, customer-managed KMS encryption, Block Public Access, enforced bucket ownership, a TLS-only bucket policy and destroy protection. Environment roots use `use_lockfile = true` for S3-native locking. Follow [the Terraform state runbook](../../docs/terraform-state-runbook.md) using an approved AWS role; the configuration itself has not created the bucket or migrated state.

## EKS baseline (opt-in)

The `modules/eks/` module provides a private EKS control plane and managed node group in private subnets, KMS encryption for Kubernetes Secrets, CloudWatch control-plane logs with 90-day retention, explicit EKS access entries, encrypted gp3 node disks, IMDSv2, and the Pod Identity Agent. If an existing SQS queue ARN is configured, a service-account association grants the outbox worker only `sqs:SendMessage` to that queue.

The module can optionally create the dedicated AWS Load Balancer Controller IAM policy/role and EKS Pod Identity association for `kube-system/aws-load-balancer-controller`, based on the upstream policy pinned to controller release v3.6.2. A separate opt-in regional AWS WAFv2 Web ACL adds AWS-managed IP reputation, Common, Known Bad Inputs and SQLi rules plus a per-IP rate limit. WAF is billable; sampled requests are disabled and CloudWatch metrics are enabled. Neither option is enabled by default.

The Helm chart itself is installed separately by an approved operator with private access to EKS, using the pinned chart and values overlay. See [the ALB Controller and WAF runbook](../../docs/alb-controller-waf-runbook.md).

The development root gates the EKS module behind `enable_eks = false`. Keep it disabled until the remote backend is verified, the account/role and cost have been approved, and a private operator access path is available. The API endpoint is private by default. Any public endpoint needs a non-empty, reviewed CIDR allow-list.

VPC CNI identity hardening is opt-in and staged: Terraform can first create a separate `kube-system/aws-node` Pod Identity association while retaining the node-role CNI policy, then remove the node-role policy only in a second apply with explicit cutover approval. See [the VPC CNI identity runbook](../../docs/eks-vpc-cni-pod-identity-runbook.md).

See [the EKS foundation runbook](../../docs/eks-foundation-runbook.md) before planning or applying. Terraform CI does not create resources.

## Validate

    terraform fmt -check -recursive infra/terraform
    terraform -chdir=infra/terraform/bootstrap-state init -backend=false
    terraform -chdir=infra/terraform/bootstrap-state validate
    terraform -chdir=infra/terraform/environments/dev init -backend=false
    terraform -chdir=infra/terraform/environments/dev validate

Validation uses Terraform 1.11.4, does not authenticate to AWS, and does not run `plan` or `apply`.

## Cost and production gates

A dev plan can create a VPC, public/private subnets, NAT gateway, ECR repositories, and (only if opted in) EKS, a managed node group, KMS key and CloudWatch log group. EKS control-plane, EC2, EBS, NAT and log charges may accrue. Review the saved plan, account, region, CIDR overlap, endpoint exposure, IAM, costs and cleanup impact before manual apply.

Remaining work includes production-grade remote-state IAM separation, staging validation of VPC CNI and Load Balancer Controller identities, ALB/WAF end-to-end rehearsal, database/Redis/secrets integrations, backup/restore, monitoring, DR, and non-production deployment tests.
