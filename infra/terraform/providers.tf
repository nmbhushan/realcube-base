variable "aws_region" {
  description = "AWS region for this environment"
  type = string
  default = "ap-south-1"
}
provider "aws" {
  region = var.aws_region
}
