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
