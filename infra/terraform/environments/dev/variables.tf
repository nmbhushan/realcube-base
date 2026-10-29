variable "project_name" {
  type = string
  description = "Project and environment prefix"
  default = "realcube-workspace-dev"
}
variable "aws_region" {
  type = string
  description = "AWS deployment region"
  default = "ap-south-1"
}
