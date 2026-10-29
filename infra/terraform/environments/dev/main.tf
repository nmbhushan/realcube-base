locals {
  common_tags = {
    Project     = var.project_name
    Environment = "dev"
    ManagedBy   = "Terraform"
  }
}

module "network" {
  source = "../../modules/network"

  name                    = var.project_name
  cluster_name            = var.project_name
  vpc_cidr                = var.vpc_cidr
  availability_zone_count = var.availability_zone_count
  enable_nat_gateway      = var.enable_nat_gateway
  single_nat_gateway      = var.single_nat_gateway
  tags                    = local.common_tags
}

module "ecr" {
  source = "../../modules/ecr"

  repository_names = [
    "${var.project_name}/platform-api",
    "${var.project_name}/platform-frontend",
    "${var.project_name}/platform-worker"
  ]

  tagged_image_retention_count  = var.tagged_image_retention_count
  untagged_image_retention_days = var.untagged_image_retention_days
  tags                          = local.common_tags
}

module "eks" {
  count  = var.enable_eks ? 1 : 0
  source = "../../modules/eks"

  name                         = "${var.project_name}-eks"
  kubernetes_version           = var.eks_kubernetes_version
  private_subnet_ids           = module.network.private_subnet_ids
  cluster_admin_principal_arn  = var.eks_cluster_admin_principal_arn
  endpoint_public_access       = var.eks_endpoint_public_access
  endpoint_public_access_cidrs = var.eks_endpoint_public_access_cidrs
  node_instance_types          = var.eks_node_instance_types
  node_min_size                = var.eks_node_min_size
  node_desired_size            = var.eks_node_desired_size
  node_max_size                = var.eks_node_max_size
  access_events_queue_arn          = var.eks_access_events_queue_arn
  enable_vpc_cni_pod_identity      = var.eks_enable_vpc_cni_pod_identity
  remove_node_cni_policy           = var.eks_remove_node_cni_policy
  approve_vpc_cni_policy_cutover   = var.eks_approve_vpc_cni_policy_cutover
  tags                         = local.common_tags
}
