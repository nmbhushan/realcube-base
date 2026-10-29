output "repository_urls" {
  description = "Map of ECR repository names to registry URLs."
  value       = { for name, repository in aws_ecr_repository.this : name => repository.repository_url }
}

output "repository_arns" {
  description = "Map of ECR repository names to ARNs."
  value       = { for name, repository in aws_ecr_repository.this : name => repository.arn }
}
