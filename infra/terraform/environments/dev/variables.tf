variable "project_name" {
  type        = string
  description = "Project and environment prefix."
  default     = "realcube-workspace-dev"
}

variable "aws_region" {
  type        = string
  description = "AWS region for this environment."
  default     = "ap-south-1"
}

variable "vpc_cidr" {
  type        = string
  description = "VPC CIDR; this module expects a /16 and allocates /24 subnets."
  default     = "10.40.0.0/16"
}

variable "availability_zone_count" {
  type        = number
  description = "Number of Availability Zones for the development VPC."
  default     = 2

  validation {
    condition     = var.availability_zone_count >= 2 && var.availability_zone_count <= 3 && floor(var.availability_zone_count) == var.availability_zone_count
    error_message = "availability_zone_count must be an integer from 2 through 3."
  }
}

variable "enable_nat_gateway" {
  type        = bool
  description = "Enable NAT gateway egress for private subnets."
  default     = true
}

variable "single_nat_gateway" {
  type        = bool
  description = "Use one shared NAT gateway for dev cost savings; disable for one per AZ."
  default     = true
}

variable "tagged_image_retention_count" {
  type        = number
  description = "Maximum tagged image count to retain in each repository."
  default     = 50
}

variable "untagged_image_retention_days" {
  type        = number
  description = "Retention period for untagged ECR images."
  default     = 14
}

variable "enable_eks" {
  type        = bool
  description = "Opt in to provisioning the EKS control plane and managed node group. Keep false until state, account, cost and access approvals are complete."
  default     = false
}

variable "eks_kubernetes_version" {
  type        = string
  description = "EKS Kubernetes minor version; verify regional support before enabling."
  default     = "1.37"

  validation {
    condition     = length(var.eks_kubernetes_version) == 4 && startswith(var.eks_kubernetes_version, "1.") && can(tonumber(substr(var.eks_kubernetes_version, 2, 2)))
    error_message = "eks_kubernetes_version must be a minor version such as 1.37."
  }
}

variable "eks_cluster_admin_principal_arn" {
  type        = string
  description = "Exact IAM role/user ARN granted cluster-admin permissions. Required when enable_eks is true."
  default     = ""

  validation {
    condition     = !var.enable_eks || can(regex("^arn:[^:]+:iam::[0-9]{12}:(role|user)/.+$", var.eks_cluster_admin_principal_arn))
    error_message = "When enable_eks=true, set eks_cluster_admin_principal_arn to the exact IAM role or user ARN that should administer this cluster."
  }
}

variable "eks_endpoint_public_access" {
  type        = bool
  description = "Expose the EKS API publicly; the default is private-only."
  default     = false
}

variable "eks_endpoint_public_access_cidrs" {
  type        = list(string)
  description = "CIDR allow-list required when eks_endpoint_public_access=true."
  default     = []
}

variable "eks_node_instance_types" {
  type        = list(string)
  description = "EC2 instance types for the EKS managed node group."
  default     = ["t3.large"]

  validation {
    condition     = length(var.eks_node_instance_types) > 0
    error_message = "Provide at least one EKS node instance type."
  }
}

variable "eks_node_min_size" {
  type        = number
  description = "Minimum size of the managed node group."
  default     = 2
}

variable "eks_node_desired_size" {
  type        = number
  description = "Desired size of the managed node group."
  default     = 2
}

variable "eks_node_max_size" {
  type        = number
  description = "Maximum size of the managed node group."
  default     = 4
}

variable "eks_access_events_queue_arn" {
  type        = string
  description = "Optional existing SQS queue ARN for the outbox worker Pod Identity association."
  default     = ""

  validation {
    condition     = var.eks_access_events_queue_arn == "" || can(regex("^arn:[^:]+:sqs:[^:]+:[0-9]{12}:.+$", var.eks_access_events_queue_arn))
    error_message = "eks_access_events_queue_arn must be empty or a valid SQS queue ARN."
  }
}

variable "eks_enable_vpc_cni_pod_identity" {
  type        = bool
  description = "Create a dedicated Pod Identity role/association for kube-system/aws-node; enable first while retaining the node-role CNI policy."
  default     = false
}

variable "eks_remove_node_cni_policy" {
  type        = bool
  description = "Remove AmazonEKS_CNI_Policy from the node role only after the VPC CNI Pod Identity association is validated in staging."
  default     = false

  validation {
    condition     = !var.eks_remove_node_cni_policy || (var.eks_enable_vpc_cni_pod_identity && var.eks_approve_vpc_cni_policy_cutover)
    error_message = "Removing the node CNI policy requires eks_enable_vpc_cni_pod_identity=true and eks_approve_vpc_cni_policy_cutover=true after successful staging verification."
  }
}

variable "eks_approve_vpc_cni_policy_cutover" {
  type        = bool
  description = "Explicit approval gate for the second-phase CNI IAM cutover after staging verification."
  default     = false
}


variable "eks_enable_load_balancer_controller" {
  type        = bool
  description = "Create the IAM role and Pod Identity association for the AWS Load Balancer Controller; install the pinned Helm chart separately from a private operator path."
  default     = false

  validation {
    condition     = !var.eks_enable_load_balancer_controller || var.enable_eks
    error_message = "Enable EKS before enabling the AWS Load Balancer Controller identity."
  }
}

variable "eks_enable_platform_waf_web_acl" {
  type        = bool
  description = "Create a regional WAFv2 Web ACL with AWS managed rule groups and per-IP rate limiting."
  default     = false

  validation {
    condition     = !var.eks_enable_platform_waf_web_acl || var.enable_eks
    error_message = "Enable EKS before enabling the Platform WAF Web ACL."
  }
}

variable "eks_waf_rate_limit" {
  type        = number
  description = "Per-IP request threshold in a five-minute window before AWS WAF blocks requests."
  default     = 2000

  validation {
    condition     = var.eks_waf_rate_limit >= 10 && var.eks_waf_rate_limit <= 2000000000 && floor(var.eks_waf_rate_limit) == var.eks_waf_rate_limit
    error_message = "eks_waf_rate_limit must be an integer between 10 and 2,000,000,000."
  }
}
