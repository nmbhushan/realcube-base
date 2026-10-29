output "state_bucket_name" {
  description = "S3 bucket name to use in Terraform S3 backend configuration."
  value       = aws_s3_bucket.state.bucket
}

output "state_bucket_arn" {
  description = "ARN of the protected Terraform state bucket."
  value       = aws_s3_bucket.state.arn
}

output "state_kms_key_arn" {
  description = "KMS key ARN used for server-side state encryption."
  value       = aws_kms_key.state.arn
}

output "aws_region" {
  description = "Region in which the state bucket and KMS key were created."
  value       = var.aws_region
}
