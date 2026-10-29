data "aws_caller_identity" "current" {}

locals {
  worker_identity_enabled = trimspace(var.access_events_queue_arn) != ""
  cluster_tags = merge(var.tags, {
    Name                                = var.name
    "kubernetes.io/cluster/${var.name}" = "owned"
  })
}

resource "aws_kms_key" "cluster" {
  description             = "Encrypts Kubernetes secrets for ${var.name}"
  enable_key_rotation     = true
  deletion_window_in_days = 30

  tags = merge(var.tags, {
    Name = "${var.name}-secrets"
  })
}

resource "aws_kms_alias" "cluster" {
  name          = "alias/${var.name}-eks-secrets"
  target_key_id = aws_kms_key.cluster.key_id
}

resource "aws_cloudwatch_log_group" "cluster" {
  name              = "/aws/eks/${var.name}/cluster"
  retention_in_days = var.cluster_log_retention_days
  tags              = var.tags
}

resource "aws_iam_role" "cluster" {
  name = "${var.name}-cluster-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "eks.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "cluster_policy" {
  role       = aws_iam_role.cluster.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
}

resource "aws_eks_cluster" "this" {
  name     = var.name
  role_arn = aws_iam_role.cluster.arn
  version  = var.kubernetes_version

  enabled_cluster_log_types = var.cluster_log_types

  access_config {
    authentication_mode                         = "API_AND_CONFIG_MAP"
    bootstrap_cluster_creator_admin_permissions = false
  }

  encryption_config {
    provider {
      key_arn = aws_kms_key.cluster.arn
    }
    resources = ["secrets"]
  }

  vpc_config {
    subnet_ids              = var.private_subnet_ids
    endpoint_private_access = true
    endpoint_public_access  = var.endpoint_public_access
    public_access_cidrs     = var.endpoint_public_access ? var.endpoint_public_access_cidrs : null
  }

  tags = local.cluster_tags

  lifecycle {
    precondition {
      condition     = length(var.private_subnet_ids) >= 2
      error_message = "EKS must use at least two private subnets in separate Availability Zones."
    }
    precondition {
      condition     = !var.endpoint_public_access || length(var.endpoint_public_access_cidrs) > 0
      error_message = "A public EKS API endpoint requires explicit endpoint_public_access_cidrs; unrestricted public access is not allowed."
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.cluster_policy,
    aws_cloudwatch_log_group.cluster
  ]
}

resource "aws_eks_access_entry" "cluster_admin" {
  cluster_name  = aws_eks_cluster.this.name
  principal_arn = var.cluster_admin_principal_arn
  type          = "STANDARD"
}

resource "aws_eks_access_policy_association" "cluster_admin" {
  cluster_name  = aws_eks_cluster.this.name
  principal_arn = aws_eks_access_entry.cluster_admin.principal_arn
  policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"

  access_scope {
    type = "cluster"
  }
}

resource "aws_iam_role" "nodes" {
  name = "${var.name}-nodes-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "ec2.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "node_worker" {
  role       = aws_iam_role.nodes.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy"
}

resource "aws_iam_role_policy_attachment" "node_ecr_pull" {
  role       = aws_iam_role.nodes.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryPullOnly"
}

# Keep the node-role permission during the first identity rollout. Remove it only in a
# later, separately approved apply after the Pod Identity association has been tested in staging.
resource "aws_iam_role_policy_attachment" "node_cni" {
  count      = var.remove_node_cni_policy ? 0 : 1
  role       = aws_iam_role.nodes.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
}

resource "aws_launch_template" "nodes" {
  name_prefix            = "${var.name}-nodes-"
  update_default_version = true

  block_device_mappings {
    device_name = "/dev/xvda"

    ebs {
      volume_size           = var.node_disk_size_gib
      volume_type           = "gp3"
      encrypted             = true
      delete_on_termination = true
    }
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  tag_specifications {
    resource_type = "instance"
    tags          = merge(local.cluster_tags, { Name = "${var.name}-worker" })
  }

  tag_specifications {
    resource_type = "volume"
    tags          = merge(local.cluster_tags, { Name = "${var.name}-worker-volume" })
  }

  tags = local.cluster_tags
}

resource "aws_eks_node_group" "this" {
  cluster_name    = aws_eks_cluster.this.name
  node_group_name = "${var.name}-general"
  node_role_arn   = aws_iam_role.nodes.arn
  subnet_ids      = var.private_subnet_ids
  capacity_type   = "ON_DEMAND"
  instance_types  = var.node_instance_types

  launch_template {
    id      = aws_launch_template.nodes.id
    version = aws_launch_template.nodes.latest_version
  }

  scaling_config {
    min_size     = var.node_min_size
    desired_size = var.node_desired_size
    max_size     = var.node_max_size
  }

  update_config {
    max_unavailable = 1
  }

  labels = {
    "realcube.io/node-pool" = "general"
    "realcube.io/managed"   = "terraform"
  }

  tags = local.cluster_tags

  lifecycle {
    precondition {
      condition     = var.node_min_size >= 1 && var.node_min_size <= var.node_desired_size && var.node_desired_size <= var.node_max_size
      error_message = "Node scaling must satisfy 1 <= min_size <= desired_size <= max_size."
    }
    precondition {
      condition     = length(var.node_instance_types) > 0
      error_message = "At least one node instance type must be configured."
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.node_worker,
    aws_iam_role_policy_attachment.node_ecr_pull,
    aws_iam_role_policy_attachment.node_cni
  ]
}

resource "aws_eks_addon" "pod_identity_agent" {
  cluster_name                = aws_eks_cluster.this.name
  addon_name                  = "eks-pod-identity-agent"
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "PRESERVE"

  tags = var.tags

  depends_on = [aws_eks_node_group.this]
}

resource "aws_iam_role" "vpc_cni" {
  count = var.enable_vpc_cni_pod_identity ? 1 : 0

  name = "${var.name}-vpc-cni"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "pods.eks.amazonaws.com"
      }
      Action = ["sts:AssumeRole", "sts:TagSession"]
      Condition = {
        StringEquals = {
          "aws:SourceAccount" = data.aws_caller_identity.current.account_id
        }
        ArnEquals = {
          "aws:SourceArn" = aws_eks_cluster.this.arn
        }
      }
    }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "vpc_cni" {
  count = var.enable_vpc_cni_pod_identity ? 1 : 0

  role       = aws_iam_role.vpc_cni[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
}

resource "aws_eks_pod_identity_association" "vpc_cni" {
  count = var.enable_vpc_cni_pod_identity ? 1 : 0

  cluster_name    = aws_eks_cluster.this.name
  namespace       = "kube-system"
  service_account = "aws-node"
  role_arn        = aws_iam_role.vpc_cni[0].arn

  tags = var.tags

  depends_on = [
    aws_eks_addon.pod_identity_agent,
    aws_iam_role_policy_attachment.vpc_cni
  ]
}

data "aws_iam_policy_document" "worker_pod_identity_trust" {
  count = local.worker_identity_enabled ? 1 : 0

  statement {
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["pods.eks.amazonaws.com"]
    }
    actions = ["sts:AssumeRole", "sts:TagSession"]

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_eks_cluster.this.arn]
    }
  }
}

resource "aws_iam_role" "outbox_worker" {
  count = local.worker_identity_enabled ? 1 : 0

  name               = "${var.name}-outbox-worker"
  assume_role_policy = data.aws_iam_policy_document.worker_pod_identity_trust[0].json
  tags               = var.tags
}

resource "aws_iam_role_policy" "outbox_worker_sqs" {
  count = local.worker_identity_enabled ? 1 : 0

  name = "${var.name}-outbox-send-message"
  role = aws_iam_role.outbox_worker[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["sqs:SendMessage"]
      Resource = var.access_events_queue_arn
    }]
  })
}

resource "aws_eks_pod_identity_association" "outbox_worker" {
  count = local.worker_identity_enabled ? 1 : 0

  cluster_name    = aws_eks_cluster.this.name
  namespace       = var.worker_namespace
  service_account = var.worker_service_account
  role_arn        = aws_iam_role.outbox_worker[0].arn

  tags = var.tags

  depends_on = [
    aws_eks_addon.pod_identity_agent,
    aws_iam_role_policy.outbox_worker_sqs
  ]
}
