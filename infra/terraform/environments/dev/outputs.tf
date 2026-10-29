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

output "eks_vpc_cni_role_arn" {
  description = "Dedicated VPC CNI Pod Identity role ARN, or null when EKS or the identity association is disabled."
  value       = var.enable_eks ? module.eks[0].vpc_cni_role_arn : null
}

output "eks_vpc_cni_pod_identity_enabled" {
  description = "Whether the dedicated VPC CNI Pod Identity association is configured; null while EKS is disabled."
  value       = var.enable_eks ? module.eks[0].vpc_cni_pod_identity_enabled : null
}

output "eks_load_balancer_controller_role_arn" {
  description = "AWS Load Balancer Controller Pod Identity role ARN, or null when disabled."
  value       = var.enable_eks ? module.eks[0].load_balancer_controller_role_arn : null
}

output "eks_load_balancer_controller_enabled" {
  description = "Whether the AWS Load Balancer Controller Pod Identity association is configured, or null while EKS is disabled."
  value       = var.enable_eks ? module.eks[0].load_balancer_controller_enabled : null
}

output "eks_platform_waf_web_acl_arn" {
  description = "Regional WAFv2 Web ACL ARN for ALB ingress annotations, or null when disabled."
  value       = var.enable_eks ? module.eks[0].platform_waf_web_acl_arn : null
}
