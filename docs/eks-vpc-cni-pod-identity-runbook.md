# EKS VPC CNI Pod Identity Runbook

## Goal and safety

Move the Amazon VPC CNI (`kube-system/aws-node`) from the broad worker-node IAM role to a dedicated role using EKS Pod Identity. AWS recommends a separate identity for the CNI so ordinary pods inheriting node credentials do not also inherit the CNI permissions.

This is a deliberately staged migration. Terraform defaults keep the node-role `AmazonEKS_CNI_Policy` attached, keep the Pod Identity association disabled, and keep the EKS module opt-in disabled. Do not combine identity creation and node-policy removal into the first cluster-creation apply. No AWS changes are performed by CI.

## Prerequisites

- The EKS cluster has been created in non-production using approved remote state and change control.
- The `eks-pod-identity-agent` add-on is healthy on the worker nodes.
- The starter uses IPv4. IPv6 clusters need a separate policy designed for IPv6; do not assume `AmazonEKS_CNI_Policy` is sufficient.
- A private operator network path to the EKS API is available.

## Phase 1 — Create the CNI identity while retaining node permissions

In your local, untracked `terraform.tfvars`, enable only the association:

```hcl
enable_eks = true
eks_enable_vpc_cni_pod_identity = true
eks_remove_node_cni_policy = false
eks_approve_vpc_cni_policy_cutover = false
```

Review the plan. It should add a dedicated IAM role with `AmazonEKS_CNI_Policy` and a Pod Identity association for namespace `kube-system`, service account `aws-node`. It must not detach the policy from the node role or replace the EKS cluster/node group. Apply only after the normal approval.

Verify from the approved private management path:

```bash
CLUSTER_NAME="$(terraform -chdir=infra/terraform/environments/dev output -raw eks_cluster_name)"
aws eks list-pod-identity-associations --cluster-name "$CLUSTER_NAME" --namespace kube-system
kubectl get nodes -o wide
kubectl -n kube-system rollout status daemonset/aws-node
kubectl -n kube-system get pods -l k8s-app=aws-node -o wide
kubectl -n kube-system logs daemonset/aws-node -c aws-node --since=30m
```

Confirm the association is bound to `aws-node`, nodes are Ready, and CNI logs show no new IP allocation or credential errors. Exercise pod creation and scaling in staging. Allow enough time to observe routine node/pod churn before continuing.

## Phase 2 — Remove the CNI policy from the node role

Only after Phase 1 is verified and the change is approved, update the local `terraform.tfvars`:

```hcl
enable_eks = true
eks_enable_vpc_cni_pod_identity = true
eks_remove_node_cni_policy = true
eks_approve_vpc_cni_policy_cutover = true
```

The approval variable is a configuration guard, not proof that staging tests occurred; the operator remains responsible for enforcing the review gate.

Run `terraform plan -out=cni-identity-cutover.tfplan` and inspect the saved plan before applying. Expected change: detach `AmazonEKS_CNI_Policy` from the node IAM role. The dedicated role and association should remain present. Abort if the plan replaces the cluster or node group, destroys the association, or contains unrelated infrastructure changes.

After approved apply, repeat node readiness, `aws-node` rollout, CNI log and pod-creation/scaling checks. Verify workload nodes continue to become Ready and new pods receive IP addresses.

## Rollback

If CNI errors, node readiness degrades, or pod IP allocation becomes unreliable, restore the fallback permission first by setting `eks_remove_node_cni_policy = false` and `eks_approve_vpc_cni_policy_cutover = false`, then review and apply that plan. Keep the identity association in place while investigating; do not remove both permission paths together. Only disable the association after the node-role policy is restored and a separate change is approved.

## Acceptance criteria

- The Pod Identity Agent is healthy.
- A dedicated role has only the CNI managed policy required for the IPv4 setup.
- The EKS association targets `kube-system/aws-node`.
- Phase 1 retains node-role policy and does not cause node replacement.
- Phase 2 is a separate reviewed plan, only detaches the node-role CNI policy, and leaves the cluster, node group and association intact.
- Staging tests prove node readiness, CNI health, pod creation and IP allocation before production is considered.

## References

- [Amazon EKS best practices: VPC CNI and separate IAM role](https://docs.aws.amazon.com/eks/latest/best-practices/vpc-cni.html)
- [Configure the Amazon VPC CNI IAM role](https://docs.aws.amazon.com/eks/latest/userguide/cni-iam-role.html)
- [EKS Pod Identity association — Terraform AWS provider](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/eks_pod_identity_association)