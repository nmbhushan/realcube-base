output "vpc_id" {
  description = "Development VPC ID."
  value       = module.network.vpc_id
}

output "availability_zones" {
  description = "Availability Zones used by the development VPC."
  value       = module.network.availability_zones
}

output "public_subnet_ids" {
  description = "Public subnet IDs; intended for edge load balancers, not application pods."
  value       = module.network.public_subnet_ids
}

output "private_subnet_ids" {
  description = "Private subnet IDs for future EKS nodes and private workloads."
  value       = module.network.private_subnet_ids
}

output "ecr_repository_urls" {
  description = "ECR registry URLs for API, frontend and worker images."
  value       = module.ecr.repository_urls
}

output "ecr_repository_arns" {
  description = "ECR repository ARNs for later least-privilege policies."
  value       = module.ecr.repository_arns
}
