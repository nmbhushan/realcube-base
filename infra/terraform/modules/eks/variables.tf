variable "name" {
  description = "EKS cluster name and resource name prefix."
  type        = string
}

variable "kubernetes_version" {
  description = "EKS Kubernetes minor version; verify AWS regional availability before enabling the cluster."
  type        = string
  default     = "1.37"

  validation {
    condition     = length(var.kubernetes_version) == 4 && startswith(var.kubernetes_version, "1.") && can(tonumber(substr(var.kubernetes_version, 2, 2)))
    error_message = "kubernetes_version must be a minor version such as 1.37."
  }
}

variable "private_subnet_ids" {
  description = "Private subnet IDs in at least two Availability Zones."
  type        = list(string)

  validation {
    condition     = length(var.private_subnet_ids) >= 2
    error_message = "At least two private subnet IDs are required."
  }
}

variable "cluster_admin_principal_arn" {
  description = "Explicit IAM role/user ARN granted cluster-admin access through an EKS access entry."
  type        = string
}

variable "cluster_log_types" {
  description = "EKS control-plane log categories enabled for the cluster."
  type        = list(string)
  default     = ["api", "audit", "authenticator", "controllerManager", "scheduler"]
}

variable "cluster_log_retention_days" {
  description = "CloudWatch retention period for EKS control-plane logs."
  type        = number
  default     = 90

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653], var.cluster_log_retention_days)
    error_message = "cluster_log_retention_days must be a supported CloudWatch Logs retention value."
  }
}

variable "endpoint_public_access" {
  description = "Whether to expose the EKS Kubernetes API endpoint publicly. Private access is always enabled."
  type        = bool
  default     = false
}

variable "endpoint_public_access_cidrs" {
  description = "Explicit CIDR allow-list for a public endpoint; required when public endpoint access is enabled."
  type        = list(string)
  default     = []
}

variable "node_instance_types" {
  description = "EC2 instance types for the managed node group."
  type        = list(string)
  default     = ["t3.large"]

  validation {
    condition     = length(var.node_instance_types) > 0
    error_message = "At least one node instance type is required."
  }
}

variable "node_min_size" {
  description = "Minimum managed node count."
  type        = number
  default     = 2
}

variable "node_desired_size" {
  description = "Desired managed node count."
  type        = number
  default     = 2
}

variable "node_max_size" {
  description = "Maximum managed node count."
  type        = number
  default     = 4
}

variable "node_disk_size_gib" {
  description = "Encrypted gp3 root disk size for each worker node."
  type        = number
  default     = 50

  validation {
    condition     = var.node_disk_size_gib >= 20 && var.node_disk_size_gib <= 1024 && floor(var.node_disk_size_gib) == var.node_disk_size_gib
    error_message = "node_disk_size_gib must be an integer from 20 through 1024."
  }
}

variable "access_events_queue_arn" {
  description = "Optional existing SQS queue ARN for the outbox worker. Empty leaves the workload identity association disabled."
  type        = string
  default     = ""

  validation {
    condition     = var.access_events_queue_arn == "" || can(regex("^arn:[^:]+:sqs:[^:]+:[0-9]{12}:.+$", var.access_events_queue_arn))
    error_message = "access_events_queue_arn must be empty or a valid SQS queue ARN."
  }
}

variable "enable_vpc_cni_pod_identity" {
  description = "Create a dedicated EKS Pod Identity role and association for the kube-system/aws-node VPC CNI service account."
  type        = bool
  default     = false
}

variable "remove_node_cni_policy" {
  description = "Detach AmazonEKS_CNI_Policy from the node role after the separate VPC CNI Pod Identity association has been validated in staging."
  type        = bool
  default     = false

  validation {
    condition     = !var.remove_node_cni_policy || (var.enable_vpc_cni_pod_identity && var.approve_vpc_cni_policy_cutover)
    error_message = "Removing the node CNI policy requires enable_vpc_cni_pod_identity=true and approve_vpc_cni_policy_cutover=true after successful staging verification."
  }
}

variable "approve_vpc_cni_policy_cutover" {
  description = "Explicit approval gate required to remove the node-role CNI policy after staging verification."
  type        = bool
  default     = false
}
variable "worker_namespace" {
  description = "Kubernetes namespace for the outbox worker service account."
  type        = string
  default     = "enterprise-platform"
}

variable "worker_service_account" {
  description = "Kubernetes service account name for the outbox worker."
  type        = string
  default     = "enterprise-platform-outbox-worker"
}

variable "tags" {
  description = "Tags applied to EKS resources."
  type        = map(string)
  default     = {}
}


variable "enable_load_balancer_controller" {
  description = "Create the IAM policy, role and Pod Identity association for the AWS Load Balancer Controller."
  type        = bool
  default     = false
}

variable "enable_platform_waf_web_acl" {
  description = "Create a regional AWS WAFv2 Web ACL for the Platform ALB."
  type        = bool
  default     = false
}

variable "waf_rate_limit" {
  description = "Per-IP request threshold in a five-minute window before AWS WAF blocks requests."
  type        = number
  default     = 2000

  validation {
    condition     = var.waf_rate_limit >= 10 && var.waf_rate_limit <= 2000000000 && floor(var.waf_rate_limit) == var.waf_rate_limit
    error_message = "waf_rate_limit must be an integer between 10 and 2,000,000,000."
  }
}
