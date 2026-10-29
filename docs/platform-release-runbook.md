# Platform Release Runbook

## Purpose and safety boundary

Use this runbook for a controlled release of the Enterprise Platform API and frontend through the Helm chart. Rehearse it in **non-production EKS first**. It does not provision AWS infrastructure, create database resources, or replace the approved production change process.

Run the script from an approved operator workstation or private deployment runner that can reach the selected Kubernetes cluster and frontend HTTPS ingress. Do not run it from an arbitrary hosted CI runner when the ingress is internal.

## Prerequisites

- An authenticated kubeconfig and a known Kubernetes context for the target environment.
- Helm 3, kubectl, jq, curl and Bash.
- A reviewed environment values file. Keep it outside source control if it contains environment-specific information.
- The namespace's referenced Kubernetes Secrets already created through the approved secret manager/workload process.
- API and frontend container images published to the approved registry, with immutable SHA-256 digests recorded.
- A reachable HTTPS frontend base URL for smoke checks.

Production deployment requires approved TLS, ingress, WAF/network configuration, database and Redis availability, backups, monitoring and an authorized change window.

## Pre-deployment checks

1. Verify the intended AWS account, cluster and region through your organization's approved login process.
2. Confirm the Kubernetes context explicitly, e.g. `kubectl config get-contexts` and `kubectl --context "$KUBE_CONTEXT" cluster-info`.
3. Confirm referenced Kubernetes Secret objects exist without printing secret values: `kubectl --context "$KUBE_CONTEXT" -n enterprise-platform get secrets`.
4. Verify the database migration plan and rollback/forward-fix strategy. Helm rollback does not reverse database migrations.
5. Run chart validation in CI and review the change/approval record.

## Release command

Create an environment-specific values file from the reviewed configuration. The chart values should reference pre-provisioned Kubernetes Secrets, not contain credentials directly. Image references must be in the form `registry/repository@sha256:<64 lowercase hex characters>`. If `worker.enabled=true` in the values file, pass `--worker-image` for that workload as well; the script rejects an enabled worker without a digest-pinned image.

```bash
chmod +x scripts/deploy-platform.sh

./scripts/deploy-platform.sh \
  --release enterprise-platform \
  --namespace enterprise-platform \
  --context "$KUBE_CONTEXT" \
  --values "$DEPLOY_VALUES_FILE" \
  --api-image "ACCOUNT.dkr.ecr.ap-south-1.amazonaws.com/realcube/platform-api@sha256:REPLACE_WITH_64_HEX_CHARACTERS" \
  --frontend-image "ACCOUNT.dkr.ecr.ap-south-1.amazonaws.com/realcube/platform-frontend@sha256:REPLACE_WITH_64_HEX_CHARACTERS" \
  --smoke-url "https://platform.staging.example.com"
```

Replace every example value before running. Do not use `latest` or any mutable tag with this release command.

To validate the release definition without applying a release, add `--dry-run`. It still requires the explicit Kubernetes context and cluster connectivity. A dry run does not validate runtime health.

## What the script checks

1. Requires a named Kubernetes context; it refuses to use the implicit current context.
2. Validates that API and frontend images include immutable `sha256` digests.
3. Lints the Helm chart and verifies cluster connectivity.
4. Uses Helm `--atomic --wait` and waits for both API and frontend rollouts.
5. Calls `/api/health/live` and `/api/health/ready` over HTTPS, retrying each check for up to one minute.
6. If rollout status or post-deployment smoke validation fails after an upgrade, attempts to roll back to the previous Helm revision. If this was the first install, it attempts to uninstall the new release. Check output and cluster events if recovery itself fails.

A successful script run is not a full acceptance test. Validate OIDC login/logout with the chosen provider, tenant isolation, invitation delivery, Redis failover, database connectivity, logs/alerts and application workflows in the target environment.

## Verification commands

```bash
helm status enterprise-platform --kube-context "$KUBE_CONTEXT" -n enterprise-platform
helm history enterprise-platform --kube-context "$KUBE_CONTEXT" -n enterprise-platform
kubectl --context "$KUBE_CONTEXT" -n enterprise-platform get deployments,pods,services
kubectl --context "$KUBE_CONTEXT" -n enterprise-platform rollout status deployment/platform-api
kubectl --context "$KUBE_CONTEXT" -n enterprise-platform rollout status deployment/platform-frontend
```

Confirm running API and frontend images resolve to the approved digests. Confirm pod readiness, expected replica count, error rate, OIDC flow and dependency health before closing the change.

## Manual recovery

If automatic rollback did not complete, inspect events and Helm history, then select the last known-good revision from the approved release record:

```bash
helm history enterprise-platform --kube-context "$KUBE_CONTEXT" -n enterprise-platform
helm rollback enterprise-platform <KNOWN_GOOD_REVISION> \
  --kube-context "$KUBE_CONTEXT" -n enterprise-platform --wait --timeout 10m
```

Do not guess a revision. If the failure involves a database migration, restore/forward-fix decisions must follow the database recovery plan; rolling back Kubernetes workloads alone may not restore data compatibility.

## Release exit criteria

- Both deployments complete without an unavailable rollout target.
- Health endpoints return HTTP 200 over the approved HTTPS ingress.
- OIDC login/logout and a representative tenant-scoped Platform workflow pass.
- No new critical alerts, unexplained 5xx increase or growing outbox backlog.
- Rollback is either not needed or verified successful; the change record captures the deployed digests and Helm revision.
