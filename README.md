# Pulumi Infrastructure as Code (IaC) Project

This repository contains the infrastructure as code (IaC) for deploying a multi-cloud application using Pulumi. The project orchestrates resources on both AWS and GCP, including VPC, EC2 instances, RDS database, S3 bucket, and more.

## Project Structure

The project is organized into the following main files:

- **index.ts:** Pulumi program written in TypeScript that defines and exports the cloud infrastructure.

- **pulumi.dev.yaml:** Configuration file containing encrypted secrets and cloud provider configurations.

## Pulumi Configuration

The Pulumi configuration is stored in `pulumi.dev.yaml`. It includes configuration settings for both AWS and GCP, as well as various parameters for the infrastructure, such as VPC settings, security group configurations, and more.

## AWS Resources

The AWS resources created by this project include:

- VPC with public and private subnets
- EC2 instances with auto-scaling
- RDS database
- S3 bucket
- Security groups and IAM roles

## GCP Resources

The GCP resources created by this project include:

- GCP Storage bucket
- GCP Service Account with specified permissions

## Getting Started

1. **Prerequisites:**
   - Install [Pulumi](https://www.pulumi.com/docs/get-started/install/) on your machine.
   - Configure your AWS and GCP credentials.

2. **Clone the Repository:**
   ```bash
   git clone <repository-url>
   cd <repository-directory>
