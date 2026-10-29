terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # This root starts with local state, provisions the remote backend, then migrates
  # its own state into that backend. See README.md before running init or apply.
  backend "s3" {}
}
