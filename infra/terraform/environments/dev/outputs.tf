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

output "eks_cluster_name" {
  description = "Name of the development EKS cluster, or null while EKS is disabled."
  value       = var.enable_eks ? module.eks[0].cluster_name : null
}

output "eks_cluster_endpoint" {
  description = "Private Kubernetes API endpoint, or null while EKS is disabled."
  value       = var.enable_eks ? module.eks[0].cluster_endpoint : null
}

output "eks_node_group_name" {
  description = "Managed node group name, or null while EKS is disabled."
  value       = var.enable_eks ? module.eks[0].node_group_name : null
}

output "eks_outbox_worker_role_arn" {
  description = "Outbox worker Pod Identity role ARN if an SQS queue ARN was supplied; otherwise null."
  value       = var.enable_eks ? module.eks[0].outbox_worker_role_arn : null
}
