# AWS Load Balancer Controller, ALB Ingress and WAF Runbook

## Scope and safety

This milestone adds the AWS Load Balancer Controller's IAM permissions and EKS Pod Identity association, an opt-in Regional AWS WAFv2 Web ACL, a pinned upstream Helm values overlay, and CI rendering of the pinned controller chart. Terraform does not install the controller chart or create an ALB from the Platform Ingress; those Kubernetes changes are performed separately by an approved operator with network access to the private EKS API.

The controller IAM policy is copied from the upstream `kubernetes-sigs/aws-load-balancer-controller` v3.6.2 release and stored in `infra/terraform/modules/eks/policies/aws-load-balancer-controller-iam-policy.json`. Review and update that policy in a dedicated change whenever the controller is upgraded. The Helm chart version is pinned to `3.6.2`.

All new infrastructure is opt-in and the EKS module remains disabled by default. A regional WAF ACL incurs charges when enabled, as does an ALB and any related AWS usage. No apply or cluster deployment is performed by CI.

## Prerequisites

- The Terraform S3 backend has been bootstrapped and verified, and the development network/ECR/EKS baseline has been reviewed and applied by an authorized operator.
- The private EKS API can be reached through the approved VPN, Direct Connect, or management host. Do not make the EKS endpoint public just to run Helm.
- The requested ACM certificate is issued and in the same AWS region as the ALB (the default environment is `ap-south-1`).
- The public DNS record and ownership/validation process for the chosen host are ready.
- The controller's external permissions have been reviewed. The upstream IAM policy includes some wildcard resource permissions constrained by AWS controller tags; treat it as powerful and update only after checking the upstream policy diff.
- The Platform app's TLS, health checks, client-IP rate limiting and cookie settings have been tested in non-production.

## Phase 1 — Terraform creates controller identity and optional WAF

Copy the example configuration to a local ignored file:

```bash
cp infra/terraform/environments/dev/terraform.tfvars.example infra/terraform/environments/dev/terraform.tfvars
```

For an already-approved dev EKS cluster, set the relevant local values:

```hcl
enable_eks = true
eks_enable_load_balancer_controller = true

# Required for internet-facing Platform ingress. The WAF is separately billable.
eks_enable_platform_waf_web_acl = true
eks_waf_rate_limit = 2000
```

Retain the approved cluster administrator ARN and all required backend/account variables. Do not commit `terraform.tfvars`.

From the approved private operator path, run the normal reviewed plan workflow:

```bash
aws sts get-caller-identity
terraform -chdir=infra/terraform/environments/dev init -reconfigure -backend-config=backend.hcl
terraform -chdir=infra/terraform/environments/dev validate
terraform -chdir=infra/terraform/environments/dev plan -out=alb-waf.tfplan
```

Review the plan before applying. When the two feature flags are enabled, the plan should create a dedicated controller IAM policy/role and EKS Pod Identity association for service account `kube-system/aws-load-balancer-controller`; it should create a regional WAF ACL if its flag is true. Do not attach controller permissions to the worker-node IAM role. Do not proceed if the plan replaces the cluster/node group, exposes the EKS API publicly, or contains unrelated changes.

After approval only:

```bash
terraform -chdir=infra/terraform/environments/dev apply alb-waf.tfplan
```

Get the values needed by the operator workflow:

```bash
export AWS_REGION=ap-south-1
export CLUSTER_NAME="$(terraform -chdir=infra/terraform/environments/dev output -raw eks_cluster_name)"
export VPC_ID="$(terraform -chdir=infra/terraform/environments/dev output -raw vpc_id)"
terraform -chdir=infra/terraform/environments/dev output eks_load_balancer_controller_role_arn
terraform -chdir=infra/terraform/environments/dev output eks_platform_waf_web_acl_arn
terraform -chdir=infra/terraform/environments/dev output -json public_subnet_ids
terraform -chdir=infra/terraform/environments/dev output -json private_subnet_ids
```

The network module marks public subnets for internet-facing load balancers and private subnets for internal load balancers. The cluster discovery tag is aligned with the exact EKS cluster name.

## Phase 2 — Install the pinned AWS Load Balancer Controller chart

From the same private management host, confirm the Terraform-created Pod Identity association exists and create the service account referenced by it:

```bash
aws eks list-pod-identity-associations --cluster-name "$CLUSTER_NAME" --namespace kube-system
kubectl -n kube-system apply -f - <<'YAML'
apiVersion: v1
kind: ServiceAccount
metadata:
  name: aws-load-balancer-controller
  namespace: kube-system
YAML
```

Install the pinned upstream chart using the checked-in overlay. The cluster name, region and VPC ID are explicitly passed because the worker instances require IMDSv2 with hop limit 1 and the controller must not depend on instance metadata discovery.

```bash
helm repo add eks https://aws.github.io/eks-charts
helm repo update eks
helm upgrade --install aws-load-balancer-controller eks/aws-load-balancer-controller \
  --version 3.6.2 \
  --namespace kube-system \
  --values infra/helm/aws-load-balancer-controller-values.yaml \
  --set-string clusterName="$CLUSTER_NAME" \
  --set-string region="$AWS_REGION" \
  --set-string vpcId="$VPC_ID" \
  --set serviceAccount.create=false \
  --set serviceAccount.name=aws-load-balancer-controller
```

The first Helm install applies the controller CRDs. Before a later chart upgrade, update the CRDs from the same controller release in a reviewed change; Helm upgrade does not automatically upgrade CRDs.

Verify rollout and credentials:

```bash
kubectl -n kube-system rollout status deployment/aws-load-balancer-controller
kubectl -n kube-system get deployment aws-load-balancer-controller
kubectl -n kube-system logs deployment/aws-load-balancer-controller --since=30m
aws eks list-pod-identity-associations --cluster-name "$CLUSTER_NAME" --namespace kube-system
```

Controller replicas should be ready, logs should be free of authorization errors, and the association should map the correct cluster/namespace/service account to the dedicated role.

## Phase 3 — Create the Platform ALB Ingress

The application Helm chart already has an Ingress template with HTTP-to-HTTPS redirect, ACM certificate, IP targets, a readiness health check and a WAF annotation. Internet-facing ingress template rendering fails if `ingress.wafAclArn` is empty.

Create a local, untracked values overlay (replace the sample values with reviewed deployment information):

```yaml
ingress:
  enabled: true
  className: alb
  scheme: internet-facing
  host: platform.example.com
  certificateArn: arn:aws:acm:ap-south-1:123456789012:certificate/REPLACE_WITH_ISSUED_CERTIFICATE_ID
  wafAclArn: REPLACE_WITH_TERRAFORM_WAF_ACL_ARN
  # Optional but recommended for deterministic placement: comma-separated IDs
  # of both public subnets from the Terraform public_subnet_ids output.
  subnets: subnet-REPLACE_PUBLIC_A,subnet-REPLACE_PUBLIC_B
```

Get the WAF ARN from Terraform only when `eks_enable_platform_waf_web_acl=true`:

```bash
terraform -chdir=infra/terraform/environments/dev output -raw eks_platform_waf_web_acl_arn
```

Apply the overlay together with your approved immutable-image values and secrets/configuration for the Platform release. For example:

```bash
helm upgrade --install enterprise-platform infra/helm/platform \
  --namespace enterprise-platform --create-namespace \
  --values /path/to/approved-platform-values.yaml \
  --values /path/to/platform-ingress-values.yaml
```

For an internal ALB, set `scheme: internal` and use private subnet IDs. WAF is optional for internal ingress; a publicly reachable Platform ALB must use the issued ACM certificate and WAF ACL. Keep the EKS Kubernetes API private. Configure the DNS alias to the resulting ALB after validating it.

## WAF behavior and review

The optional Regional Web ACL has default action `allow`, with these rules evaluated in priority order:

1. AWS managed IP reputation list.
2. AWS managed common rule set.
3. AWS managed known-bad-input rule set.
4. AWS managed SQL injection rule set.
5. A per-source-IP rate-based block rule, default threshold 2,000 requests per five-minute window.

The managed rule groups use their default actions. Managed groups and the rate threshold can block legitimate traffic, so observe CloudWatch WAF metrics in staging and tune only through a reviewed Terraform change. Sampled requests are disabled; this configuration does not enable detailed WAF request logging. A WAF ACL and its managed rule groups/rules incur additional usage charges. Budget for WAF, ALB capacity/data processing and network traffic before enabling.

## Verification and rollback

- Confirm the ALB is provisioned in the intended subnets and the HTTPS listener uses the expected ACM certificate.
- Confirm HTTP requests redirect to HTTPS and the target group health checks pass.
- Confirm the Ingress references the intended WAF ARN and the Web ACL is associated with the ALB.
- Review WAF CloudWatch metrics for blocked/allowed requests and false positives; validate application sign-in, session cookies, callbacks and API flows through the real domain.
- Verify controller IAM errors do not appear in logs and the controller uses its Pod Identity, not broad node-role permissions.
- Exercise failure/recovery by reverting the application Helm release to its prior approved values/image digests. For a Terraform issue, revert the relevant flag change through a reviewed plan; do not destroy the EKS cluster or shared state as a first response.
- Remove public ingress by disabling/reverting the Platform Ingress through a reviewed Helm release before considering any WAF or controller teardown. Review data retention and costs before deleting WAF resources.

## References

- [Upstream AWS Load Balancer Controller installation guide](https://kubernetes-sigs.github.io/aws-load-balancer-controller/latest/deploy/installation/)
- [Pinned controller IAM policy — v3.6.2](https://github.com/kubernetes-sigs/aws-load-balancer-controller/blob/v3.6.2/docs/install/iam_policy.json)
- [AWS EKS guide for installing the Load Balancer Controller](https://docs.aws.amazon.com/eks/latest/userguide/lbc-helm.html)
- [Terraform AWS WAFv2 Web ACL resource](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/wafv2_web_acl)
