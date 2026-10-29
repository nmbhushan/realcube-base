output "cluster_name" {
  description = "EKS cluster name."
  value       = aws_eks_cluster.this.name
}

output "cluster_endpoint" {
  description = "Private Kubernetes API endpoint. Reach it from an approved network path inside the VPC."
  value       = aws_eks_cluster.this.endpoint
}

output "cluster_certificate_authority_data" {
  description = "Base64-encoded Kubernetes API certificate authority data."
  value       = aws_eks_cluster.this.certificate_authority[0].data
}

output "node_group_name" {
  description = "EKS managed node group name."
  value       = aws_eks_node_group.this.node_group_name
}

output "outbox_worker_role_arn" {
  description = "Least-privilege Pod Identity role for SQS publishing, or null if no queue ARN was supplied."
  value       = try(aws_iam_role.outbox_worker[0].arn, null)
}
