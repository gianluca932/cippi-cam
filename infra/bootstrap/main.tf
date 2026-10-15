# Il bucket per lo stato di Terraform. Va creato PRIMA dello stack principale (che ci salva lo stato),
# quindi vive in una configurazione a parte con lo stato locale. Si lancia una volta sola:
#   cd infra/bootstrap && terraform init && terraform apply
# Il nome del bucket in output va poi passato a `terraform init` dello stack principale (vedi infra/README.md).

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
}

variable "regione" {
  type    = string
  default = "eu-south-1"
}

provider "aws" {
  region = var.regione
  default_tags { tags = { progetto = "cippi-cam" } }
}

data "aws_caller_identity" "io" {}

# I nomi dei bucket sono globali: l'ID dell'account li rende unici.
resource "aws_s3_bucket" "stato" {
  bucket = "cippi-cam-tfstate-${data.aws_caller_identity.io.account_id}"
  lifecycle { prevent_destroy = true } # perdere lo stato = Terraform non sa più cosa ha creato
}

# Versioni: se uno stato si rovina, si torna a quello prima.
resource "aws_s3_bucket_versioning" "stato" {
  bucket = aws_s3_bucket.stato.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_public_access_block" "stato" {
  bucket                  = aws_s3_bucket.stato.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

output "bucket_stato" {
  value = aws_s3_bucket.stato.bucket
}
