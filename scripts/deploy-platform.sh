#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
CHART_DIR="${REPO_ROOT}/infra/helm/platform"

RELEASE=""
NAMESPACE=""
CONTEXT=""
VALUES_FILE=""
API_IMAGE=""
FRONTEND_IMAGE=""
WORKER_IMAGE=""
SMOKE_URL=""
TIMEOUT="10m"
DRY_RUN="false"

usage() {
  cat <<'USAGE'
Usage:
  scripts/deploy-platform.sh --release NAME --namespace NAME --context KUBE_CONTEXT \
    --values FILE --api-image REPOSITORY@sha256:DIGEST \
    --frontend-image REPOSITORY@sha256:DIGEST --smoke-url https://HOST [options]

Required:
  --release NAME          Helm release name
  --namespace NAME        Kubernetes namespace
  --context NAME           Explicit kubectl/Helm context (prevents accidental default-context deploys)
  --values FILE            Environment-specific values file (keep secrets in Kubernetes Secrets)
  --api-image REF          Immutable API image reference: repository@sha256:<64 lowercase hex chars>
  --frontend-image REF     Immutable frontend image reference: repository@sha256:<64 lowercase hex chars>
  --worker-image REF       Immutable outbox-worker image; required if worker.enabled=true
  --smoke-url URL          HTTPS frontend ingress/base URL reachable from this runner

Options:
  --timeout DURATION      Helm and rollout timeout (default: 10m)
  --dry-run               Render/validate the release without applying it
  --help                  Show this help
USAGE
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 2
}

while (($#)); do
  case "$1" in
    --release|--namespace|--context|--values|--api-image|--frontend-image|--worker-image|--smoke-url|--timeout)
      [[ $# -ge 2 && -n "$2" ]] || fail "Missing value for $1"
      option="$1"
      value="$2"
      shift 2
      case "$option" in
        --release) RELEASE="$value" ;;
        --namespace) NAMESPACE="$value" ;;
        --context) CONTEXT="$value" ;;
        --values) VALUES_FILE="$value" ;;
        --api-image) API_IMAGE="$value" ;;
        --frontend-image) FRONTEND_IMAGE="$value" ;;
        --worker-image) WORKER_IMAGE="$value" ;;
        --smoke-url) SMOKE_URL="$value" ;;
        --timeout) TIMEOUT="$value" ;;
      esac
      ;;
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "Unknown option: $1"
      ;;
  esac
done

[[ -n "$RELEASE" ]] || fail "--release is required"
[[ -n "$NAMESPACE" ]] || fail "--namespace is required"
[[ -n "$CONTEXT" ]] || fail "--context is required; refusing to use the implicit current context"
[[ -n "$VALUES_FILE" && -f "$VALUES_FILE" ]] || fail "--values must point to an existing environment values file"
[[ -n "$API_IMAGE" ]] || fail "--api-image is required"
[[ -n "$FRONTEND_IMAGE" ]] || fail "--frontend-image is required"
[[ "$SMOKE_URL" =~ ^https://[^[:space:]]+$ ]] || fail "--smoke-url must be an HTTPS URL reachable from this runner"

for command_name in helm kubectl jq curl; do
  command -v "$command_name" >/dev/null 2>&1 || fail "Required command not found: $command_name"
done

API_REPOSITORY=""
API_DIGEST=""
FRONTEND_REPOSITORY=""
FRONTEND_DIGEST=""
WORKER_REPOSITORY=""
WORKER_DIGEST=""

parse_digest_image() {
  local image="$1"
  local label="$2"
  if [[ ! "$image" =~ ^([^@[:space:]]+)@(sha256:[a-f0-9]{64})$ ]]; then
    fail "$label must be repository@sha256:<64 lowercase hexadecimal characters>; mutable tags are not accepted"
  fi
  case "$label" in
    API) API_REPOSITORY="${BASH_REMATCH[1]}"; API_DIGEST="${BASH_REMATCH[2]}" ;;
    frontend) FRONTEND_REPOSITORY="${BASH_REMATCH[1]}"; FRONTEND_DIGEST="${BASH_REMATCH[2]}" ;;
    worker) WORKER_REPOSITORY="${BASH_REMATCH[1]}"; WORKER_DIGEST="${BASH_REMATCH[2]}" ;;
  esac
}

parse_digest_image "$API_IMAGE" "API"
parse_digest_image "$FRONTEND_IMAGE" "frontend"
[[ -z "$WORKER_IMAGE" ]] || parse_digest_image "$WORKER_IMAGE" "worker"
[[ -d "$CHART_DIR" ]] || fail "Helm chart not found: $CHART_DIR"

WORKER_ENABLED="$(awk '
  /^worker:[[:space:]]*$/ { in_worker=1; next }
  in_worker && /^[^[:space:]#][^:]*:/ { in_worker=0 }
  in_worker && /^[[:space:]]+enabled:[[:space:]]*/ {
    sub(/^[[:space:]]*enabled:[[:space:]]*/, "")
    sub(/[[:space:]]+#.*$/, "")
    gsub(/[[:space:]]/, "")
    print tolower($0)
    exit
  }
' "$VALUES_FILE")"
if [[ "$WORKER_ENABLED" == "true" && -z "$WORKER_IMAGE" ]]; then
  fail "worker.enabled=true requires --worker-image with an immutable SHA-256 digest"
fi

# Keep credentials in pre-provisioned Kubernetes Secrets; only image refs are overridden here.
HELM_SET_ARGS=(
  --set-string "namespace=$NAMESPACE"
  --set-string "api.image.repository=$API_REPOSITORY"
  --set-string "api.image.digest=$API_DIGEST"
  --set-string "api.image.tag="
  --set-string "frontend.image.repository=$FRONTEND_REPOSITORY"
  --set-string "frontend.image.digest=$FRONTEND_DIGEST"
  --set-string "frontend.image.tag="
)
if [[ -n "$WORKER_IMAGE" ]]; then
  HELM_SET_ARGS+=(
    --set-string "worker.image.repository=$WORKER_REPOSITORY"
    --set-string "worker.image.digest=$WORKER_DIGEST"
    --set-string "worker.image.tag="
  )
fi

printf 'Validating Helm chart and explicit Kubernetes context: %s\n' "$CONTEXT"
helm lint "$CHART_DIR" --values "$VALUES_FILE" "${HELM_SET_ARGS[@]}"
kubectl --context "$CONTEXT" cluster-info >/dev/null

helm_args=(
  upgrade --install "$RELEASE" "$CHART_DIR"
  --kube-context "$CONTEXT"
  --namespace "$NAMESPACE"
  --create-namespace
  --values "$VALUES_FILE"
  "${HELM_SET_ARGS[@]}"
)

if [[ "$DRY_RUN" == "true" ]]; then
  helm "${helm_args[@]}" --dry-run
  printf 'Dry run complete. No release changes were applied.\n'
  exit 0
fi

PREVIOUS_REVISION="$(helm history "$RELEASE" --namespace "$NAMESPACE" --kube-context "$CONTEXT" --max 10 --output json 2>/dev/null | jq -r '[.[] | select(.status == "deployed")] | if length > 0 then (.[-1].revision | tostring) else empty end' 2>/dev/null || true)"
UPGRADE_SUCCEEDED="false"

rollback_on_error() {
  local exit_code=$?
  trap - ERR
  if [[ "$UPGRADE_SUCCEEDED" == "true" ]]; then
    printf 'Post-deployment validation failed; initiating recovery for release %s.\n' "$RELEASE" >&2
    if [[ -n "$PREVIOUS_REVISION" ]]; then
      if ! helm rollback "$RELEASE" "$PREVIOUS_REVISION" --kube-context "$CONTEXT" --namespace "$NAMESPACE" --wait --timeout "$TIMEOUT"; then
        printf 'ERROR: Automatic rollback failed. Inspect Helm history and cluster events immediately.\n' >&2
      fi
    else
      if ! helm uninstall "$RELEASE" --kube-context "$CONTEXT" --namespace "$NAMESPACE" --wait; then
        printf 'ERROR: Failed to remove the first release after smoke-test failure. Inspect the cluster immediately.\n' >&2
      fi
    fi
  fi
  exit "$exit_code"
}
trap rollback_on_error ERR

printf 'Deploying release %s into namespace %s.\n' "$RELEASE" "$NAMESPACE"
helm "${helm_args[@]}" --atomic --wait --timeout "$TIMEOUT" --history-max 10
UPGRADE_SUCCEEDED="true"

kubectl --context "$CONTEXT" --namespace "$NAMESPACE" rollout status deployment/platform-api --timeout="$TIMEOUT"
kubectl --context "$CONTEXT" --namespace "$NAMESPACE" rollout status deployment/platform-frontend --timeout="$TIMEOUT"

smoke_check() {
  local route="$1"
  local attempt
  local url="${SMOKE_URL%/}${route}"
  for attempt in {1..12}; do
    if curl --fail --silent --show-error --connect-timeout 5 --max-time 15 "$url" >/dev/null 2>&1; then
      printf 'PASS: %s\n' "$route"
      return 0
    fi
    sleep 5
  done
  printf 'FAIL: HTTPS smoke check did not pass after 12 attempts: %s\n' "$route" >&2
  return 1
}

smoke_check "/api/health/live"
smoke_check "/api/health/ready"

UPGRADE_SUCCEEDED="false"
trap - ERR
printf 'Release succeeded. Helm release status:\n'
helm status "$RELEASE" --kube-context "$CONTEXT" --namespace "$NAMESPACE"
