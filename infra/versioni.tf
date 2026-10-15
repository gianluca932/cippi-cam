terraform {
  required_version = ">= 1.10" # dalla 1.10 il lock dello stato su S3 è nativo (use_lockfile): niente DynamoDB

  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 6.0" }
    archive = { source = "hashicorp/archive", version = "~> 2.7" }
    random  = { source = "hashicorp/random", version = "~> 3.7" }
  }

  # Lo stato sta su S3, non nel repo: contiene ARN e la password dell'API.
  # Il bucket si passa all'init (è nel nome l'ID dell'account):
  #   terraform init -backend-config="bucket=cippi-cam-tfstate-<ACCOUNT_ID>"
  backend "s3" {
    key          = "cippi-cam/terraform.tfstate"
    region       = "eu-south-1"
    use_lockfile = true # un file .tflock accanto allo stato: due apply insieme non si pestano i piedi
    encrypt      = true
  }
}

provider "aws" {
  region = var.regione
  default_tags { tags = { progetto = var.progetto } } # ogni risorsa taggata: i costi si filtrano per progetto
}

data "aws_caller_identity" "io" {}
