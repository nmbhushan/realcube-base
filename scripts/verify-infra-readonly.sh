#!/usr/bin/env bash
set -Eeuo pipefail

# Read-only inventory for the RealCube development AWS environment.
# This script never runs terraform plan/apply and never reads secret values.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-ap-south-1}}"
TF_DIR="${ROOT}/infra/terraform/environments/dev"

if ! command -v aws >/dev/null 2>&1; then
  echo "ERROR: AWS CLI v2 is required." >&2
  exit 2
fi
if ! command -v terraform >/dev/null 2>&1; then
  echo "ERROR: Terraform is required." >&2
  exit 2
fi

echo "RealCube infrastructure read-only verification"
echo "Region: ${REGION}"
echo "Terraform directory: ${TF_DIR}"
echo "Timestamp (UTC): $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo

echo "== AWS caller identity =="
aws sts get-caller-identity --output table
echo
echo "Verify the account and role above against the approved change request before interpreting any inventory."
echo

run_inventory() {
  local label="$1"
  shift
  echo "== ${label} =="
  if "$@"; then
    :
  else
    local rc=$?
    echo "WARNING: inventory command failed (exit ${rc}); check IAM permissions and region."
  fi
  echo
}

run_inventory "EKS clusters" aws eks list-clusters --region "${REGION}" --output table
run_inventory "RDS instances (metadata only)" aws rds describe-db-instances --region "${REGION}" --query 'DBInstances[].{Identifier:DBInstanceIdentifier,Status:DBInstanceStatus,Engine:Engine,MultiAZ:MultiAZ,Encrypted:StorageEncrypted,Endpoint:Endpoint.Address}' --output table
run_inventory "ElastiCache replication groups (metadata only)" aws elasticache describe-replication-groups --region "${REGION}" --query 'ReplicationGroups[].{Id:ReplicationGroupId,Status:Status,Engine:Engine,EncryptedAtRest:AtRestEncryptionEnabled,EncryptedInTransit:TransitEncryptionEnabled}' --output table
run_inventory "ECR repositories" aws ecr describe-repositories --region "${REGION}" --query 'repositories[].{Name:repositoryName,Immutable:imageTagMutability,ScanOnPush:imageScanningConfiguration.scanOnPush,Encryption:encryptionConfiguration.encryptionType}' --output table
run_inventory "SQS queues (names/URLs only)" aws sqs list-queues --region "${REGION}" --output table
run_inventory "CloudWatch alarms" aws cloudwatch describe-alarms --region "${REGION}" --query 'MetricAlarms[].{Name:AlarmName,State:StateValue,Updated:AlarmConfigurationUpdatedTimestamp}' --output table
run_inventory "CloudWatch log groups (names/retention only)" aws logs describe-log-groups --region "${REGION}" --query 'logGroups[].{Name:logGroupName,RetentionDays:retentionInDays,Encrypted:kmsKeyId!=null}' --output table
run_inventory "Secrets Manager metadata only (values are never fetched)" aws secretsmanager list-secrets --region "${REGION}" --query 'SecretList[].{Name:Name,RotationEnabled:RotationEnabled,LastChanged:LastChangedDate}' --output table

echo "== Terraform state inventory =="
if [[ ! -d "${TF_DIR}" ]]; then
  echo "WARNING: Terraform dev directory not found: ${TF_DIR}"
elif terraform -chdir="${TF_DIR}" state list; then
  echo
  echo "State listing succeeded. This is not proof that state is current or that resources are healthy."
else
  echo "WARNING: Terraform state could not be read. Confirm backend.hcl exists locally, run terraform init -reconfigure with the approved backend, and verify state access."
fi

echo
echo "== Safety reminders =="
echo "- This script is read-only: it does not provision, change, or destroy AWS resources."
echo "- A failed list command can mean missing IAM permission, wrong region, or absent resources; it is not proof of absence."
echo "- Do not paste secret values, credentials, Terraform state contents, or unredacted account-sensitive output into issues or pull requests."
echo "- Capture this output in the approved change record after confirming the AWS account and region."
