variable "repository_names" {
  description = "Unique ECR repository names to create."
  type        = list(string)

  validation {
    condition     = length(var.repository_names) > 0 && length(distinct(var.repository_names)) == length(var.repository_names)
    error_message = "repository_names must contain at least one unique repository name."
  }
}

variable "tagged_image_retention_count" {
  description = "Maximum number of tagged images retained in each repository."
  type        = number
  default     = 50

  validation {
    condition     = var.tagged_image_retention_count >= 1 && floor(var.tagged_image_retention_count) == var.tagged_image_retention_count
    error_message = "tagged_image_retention_count must be a positive integer."
  }
}

variable "untagged_image_retention_days" {
  description = "Age in days after which untagged images can be expired."
  type        = number
  default     = 14

  validation {
    condition     = var.untagged_image_retention_days >= 1 && floor(var.untagged_image_retention_days) == var.untagged_image_retention_days
    error_message = "untagged_image_retention_days must be a positive integer."
  }
}

variable "tags" {
  description = "Tags applied to ECR repositories."
  type        = map(string)
  default     = {}
}
