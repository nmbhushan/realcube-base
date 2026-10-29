# EKS cluster module

Creates a private-by-default EKS control plane and managed worker node group within the supplied private subnets.

## Security baseline

- Private Kubernetes API endpoint enabled; public endpoint disabled by default.
- If public endpoint access is enabled, an explicit non-empty CIDR allow-list is required.
- Explicit EKS access entry grants cluster-admin only to the configured IAM role/user ARN. Cluster-creator admin bootstrapping is disabled.
- Kubernetes Secrets are encrypted with a dedicated KMS key with rotation enabled.
- API, audit, authenticator, controller-manager and scheduler control-plane logging is enabled by default, with a 90-day CloudWatch retention setting.
- Managed EC2 nodes use private subnets, encrypted gp3 root volumes, required IMDSv2 tokens, a hop limit of one, and no SSH remote-access block.
- Node IAM permissions cover worker control-plane connectivity and ECR pulls. The VPC CNI policy remains attached by default for first-boot networking.
- EKS Pod Identity Agent is installed after the managed node group exists.
- An optional outbox-worker Pod Identity association grants only `sqs:SendMessage` to one supplied SQS queue ARN.
- An optional dedicated Pod Identity association can grant `AmazonEKS_CNI_Policy` to `kube-system/aws-node`, independent of the node role.

CNI identity is a two-stage migration. First set `eks_enable_vpc_cni_pod_identity=true` while keeping `eks_remove_node_cni_policy=false`; verify association, node readiness and CNI health in staging. Only in a separate approved apply should `eks_remove_node_cni_policy=true` and `eks_approve_vpc_cni_policy_cutover=true` be set. See [the VPC CNI identity runbook](../../../docs/eks-vpc-cni-pod-identity-runbook.md).

## Use

The dev root sets `enable_eks = false` by default. To opt in, set `enable_eks = true`, supply `eks_cluster_admin_principal_arn` with the exact IAM role/user ARN that will administer the cluster, and review the Terraform plan. Public API endpoint access stays disabled unless explicitly enabled and restricted to supplied CIDRs.

If `eks_access_events_queue_arn` is supplied, the module creates a Pod Identity association for service account `enterprise-platform-outbox-worker` in namespace `enterprise-platform`. The queue must already exist, and the Helm values must use that same service-account name.

This module does not configure the AWS Load Balancer Controller, ExternalDNS, cluster autoscaler/Karpenter, database, Redis, secrets injection, VPC endpoints, or application releases. Those require dedicated design and acceptance testing.
