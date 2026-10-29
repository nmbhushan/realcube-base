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
  description = "Maximum tagged image count to retain in each ECR repository."
  default     = 50
}

variable "untagged_image_retention_days" {
  type        = number
  description = "Retention period for untagged ECR images."
  default     = 14
}
