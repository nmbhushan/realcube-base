# EKS Foundation Runbook

## Scope and safety

The Terraform EKS module provisions a private-by-default EKS control plane, a managed EC2 node group in private subnets, cluster-admin access entries, encrypted Kubernetes Secrets, control-plane logging, and the EKS Pod Identity Agent. If configured with an existing SQS queue ARN, it also associates the outbox worker service account with a narrowly scoped role that can only send messages to that queue.

The module is behind `enable_eks = false` by default. It does not provision anything merely by being merged. No Terraform apply is performed by CI. The EKS module creates billable AWS resources; follow an approved change process and review the plan and cost before setting `enable_eks = true`.

## Preconditions

- The remote Terraform S3 backend is bootstrapped and state migration is verified; see [Terraform state runbook](terraform-state-runbook.md).
- The development VPC/ECR configuration is reviewed and applied to the correct AWS account, with no CIDR overlap.
- You have approval to create an EKS cluster, KMS key, CloudWatch log group and managed EC2 node group in the selected region.
- You have an IAM role or user ARN for the intended Kubernetes cluster administrator.
- You have a private route to the VPC (VPN, Direct Connect, or an approved management host) before attempting Kubernetes API calls.
- If enabling the outbox worker identity, the SQS queue already exists and its ARN is known.

## Configuration

Copy `infra/terraform/environments/dev/terraform.tfvars.example` to a local `terraform.tfvars` file, which is ignored by Git. Keep EKS disabled for the initial network/ECR review. To enable EKS for a planned dev deployment, change:

```hcl
enable_eks = true
eks_cluster_admin_principal_arn = "arn:aws:iam::123456789012:role/PlatformClusterAdmin"
```

Use the exact IAM role/user ARN approved for cluster administration. The cluster-creator admin bootstrap is disabled and no wildcard administrator is configured.

Defaults:
- Kubernetes version is `1.37` (confirm regional EKS support at deployment time).
- Private Kubernetes API access only; the cluster API is not reachable from a public workstation unless you explicitly enable a restricted public CIDR allow-list.
- Two `t3.large` on-demand nodes by default, scaling from two to four.
- Encrypted gp3 node root volumes, IMDSv2 required, hop limit one, no SSH access block.
- KMS encryption key for Kubernetes Secrets with rotation enabled.
- EKS control-plane logs for API, audit, authenticator, controller manager and scheduler, retained for 90 days.
- EKS Pod Identity Agent installed after the node group.
- Optional worker identity association grants `sqs:SendMessage` only to the supplied queue ARN.

For public endpoint access, both set `eks_endpoint_public_access = true` and supply an explicit, reviewed `eks_endpoint_public_access_cidrs` list. The module rejects an empty CIDR list when public access is enabled; do not use `0.0.0.0/0`.

## Plan and apply — authorized operator only

First confirm the AWS identity and Terraform state backend:

```bash
aws sts get-caller-identity
terraform -chdir=infra/terraform/environments/dev init -reconfigure -backend-config=backend.hcl
terraform -chdir=infra/terraform/environments/dev validate
terraform -chdir=infra/terraform/environments/dev plan -out=eks-dev.tfplan
```

Review the plan for the expected resources, exact region/account, Kubernetes version, subnet IDs, endpoint exposure, IAM policies, KMS resources, log retention and managed node count. Review projected costs, including the EKS control plane, EC2 nodes, EBS, NAT gateway and CloudWatch Logs. Only apply after approval:

```bash
terraform -chdir=infra/terraform/environments/dev apply eks-dev.tfplan
```

Do not commit the saved plan, local state or backend configuration.

## Connect and verify

Because the control-plane endpoint is private, run these commands from a network path inside the VPC:

```bash
CLUSTER_NAME="$(terraform -chdir=infra/terraform/environments/dev output -raw eks_cluster_name)"
aws eks update-kubeconfig --region ap-south-1 --name "$CLUSTER_NAME"
kubectl get nodes -o wide
kubectl get pods -A
aws eks describe-cluster --name "$CLUSTER_NAME" --region ap-south-1 --query 'cluster.resourcesVpcConfig'
aws eks list-addons --cluster-name "$CLUSTER_NAME" --region ap-south-1
```

Confirm the expected private endpoint settings, two ready nodes, healthy VPC CNI/CoreDNS/kube-proxy and Pod Identity Agent, active node group, working access entry, and logs appearing in the configured CloudWatch log group. Validate from an administrator identity named in `eks_cluster_admin_principal_arn`, not from an unapproved caller.

If the SQS queue ARN was supplied, verify the association exists and test the worker using the approved namespace/service account. Do not broaden its IAM policy beyond the single queue without a separate review.

## Limitations and next hardening

- The node role includes the VPC CNI managed policy by default for first-boot reliability. Follow [the VPC CNI identity runbook](eks-vpc-cni-pod-identity-runbook.md) to configure and validate a dedicated identity before removing the node-role permission.
- The module does not install AWS Load Balancer Controller, autoscaler/Karpenter, External Secrets, ingress/WAF, RDS, Redis, application secrets or application releases.
- Private subnet egress uses the development network module's single NAT gateway by default; it is not AZ-resilient and incurs ongoing cost.
- Cluster version upgrades, backup/restore strategy, admission policy, network policy, runtime security, observability dashboards and disaster recovery still need specific plans/tests.
- Terraform destroy can remove cluster resources, but KMS deletion has a waiting period and logs are retained independently. Review teardown impact and data-retention requirements before deleting anything.

## Exit criteria

- EKS is created only after approved plan and remote state verification.
- API endpoint is private, node group uses private subnets and node disks are encrypted.
- Only the configured administrator ARN receives cluster-admin through EKS access entries.
- Core system add-ons and node group are healthy.
- Pod Identity Agent is active; optional worker role is queue-scoped.
- CloudWatch log retention and alerts are verified.
- A staging deployment and rollback drill have passed before any production consideration.
