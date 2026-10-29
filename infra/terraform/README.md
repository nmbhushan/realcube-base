# Terraform foundation

Skeleton only; no AWS resources are provisioned yet.

Implementation order:
1. Secure remote state and locking, separated per environment.
2. VPC, private/public subnets, routing and controlled egress.
3. ECR repositories, lifecycle rules and image scanning.
4. EKS or ECS/Fargate baseline, workload identities and access policies.
5. RDS PostgreSQL with encryption, private networking, backups and alarms.
6. Secrets Manager, KMS, S3 and SQS/SNS where required.
7. Ingress, WAF, monitoring, autoscaling, backup and disaster recovery.

Use least-privilege IAM, secure state access, environment-specific roles and reviewed plans. Never commit Terraform state or credentials.
