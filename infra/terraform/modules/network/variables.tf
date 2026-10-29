variable "name" {
  description = "Name prefix applied to network resources."
  type        = string
}

variable "cluster_name" {
  description = "Future EKS cluster name used for subnet discovery tags."
  type        = string
}

variable "vpc_cidr" {
  description = "VPC IPv4 CIDR. This module reserves /24s from a /16 network."
  type        = string
  default     = "10.40.0.0/16"

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0)) && can(regex("/16$", var.vpc_cidr))
    error_message = "vpc_cidr must be a valid IPv4 /16 CIDR because this module allocates /24 subnets."
  }
}

variable "availability_zone_count" {
  description = "Number of Availability Zones used for public and private subnets."
  type        = number
  default     = 2

  validation {
    condition     = var.availability_zone_count >= 2 && var.availability_zone_count <= 3 && floor(var.availability_zone_count) == var.availability_zone_count
    error_message = "availability_zone_count must be an integer from 2 through 3."
  }
}

variable "enable_nat_gateway" {
  description = "Enable outbound IPv4 for private subnets through NAT gateways."
  type        = bool
  default     = true
}

variable "single_nat_gateway" {
  description = "Use one shared NAT gateway to reduce development cost. Set false for one NAT gateway per AZ."
  type        = bool
  default     = true
}

variable "tags" {
  description = "Tags applied to network resources."
  type        = map(string)
  default     = {}
}
