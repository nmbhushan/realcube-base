variable "state_bucket_name" {
  description = "Globally unique S3 bucket name dedicated to Terraform state."
  type        = string

  validation {
    condition     = length(var.state_bucket_name) >= 3 && length(var.state_bucket_name) <= 63 && can(regex("^[a-z0-9][a-z0-9.-]*[a-z0-9]$", var.state_bucket_name)) && !strcontains(var.state_bucket_name, "..")
    error_message = "state_bucket_name must be a 3-63 character lowercase S3 bucket name using letters, numbers, dots or hyphens, with no consecutive dots."
  }
}

variable "aws_region" {
  description = "AWS region for the state bucket and KMS key."
  type        = string
  default     = "ap-south-1"
}

variable "project_name" {
  description = "Project identifier included in resource tags."
  type        = string
  default     = "realcube-workspace"
}

variable "environment" {
  description = "Environment label for state bootstrap resources."
  type        = string
  default     = "shared"
}

variable "tags" {
  description = "Additional tags applied to the state bucket and KMS key."
  type        = map(string)
  default     = {}
}
