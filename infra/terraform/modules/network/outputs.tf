output "vpc_id" {
  description = "ID of the VPC."
  value       = aws_vpc.this.id
}

output "vpc_cidr" {
  description = "CIDR block of the VPC."
  value       = aws_vpc.this.cidr_block
}

output "availability_zones" {
  description = "Availability Zones selected for the environment."
  value       = local.availability_zones
}

output "public_subnet_ids" {
  description = "Public subnet IDs, ordered by selected Availability Zone."
  value       = [for az in local.availability_zones : aws_subnet.public[az].id]
}

output "private_subnet_ids" {
  description = "Private subnet IDs, ordered by selected Availability Zone."
  value       = [for az in local.availability_zones : aws_subnet.private[az].id]
}
