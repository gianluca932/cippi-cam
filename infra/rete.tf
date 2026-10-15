# La rete del database. RDS deve stare in una VPC; le Lambda invece stanno fuori
# (dentro servirebbero una NAT, ~35 $/mese, o un endpoint per Bedrock, S3 e SQS).
# Quindi il database è raggiungibile da internet sulla 5432, ma per entrare servono
# SSL (rds.force_ssl, attivo di default da Postgres 15) e un token IAM firmato: l'utente "diario" non ha password.
# Le Lambda non hanno IP fissi, quindi la porta non si può restringere a un elenco di indirizzi.

data "aws_availability_zones" "disponibili" {
  state = "available"
}

resource "aws_vpc" "principale" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true # serve perché il nome del database risolva all'IP pubblico
  tags                 = { Name = "${var.progetto}-vpc" }
}

resource "aws_internet_gateway" "principale" {
  vpc_id = aws_vpc.principale.id
  tags   = { Name = "${var.progetto}-igw" }
}

resource "aws_route_table" "pubblica" {
  vpc_id = aws_vpc.principale.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.principale.id
  }
  tags = { Name = "${var.progetto}-pubblica" }
}

# RDS vuole un subnet group su almeno due zone di disponibilità, anche se l'istanza è una sola.
resource "aws_subnet" "database" {
  count             = 2
  vpc_id            = aws_vpc.principale.id
  cidr_block        = cidrsubnet(aws_vpc.principale.cidr_block, 8, count.index)
  availability_zone = data.aws_availability_zones.disponibili.names[count.index]
  tags              = { Name = "${var.progetto}-db-${count.index}" }
}

resource "aws_route_table_association" "database" {
  count          = 2
  subnet_id      = aws_subnet.database[count.index].id
  route_table_id = aws_route_table.pubblica.id
}

resource "aws_db_subnet_group" "database" {
  name       = "${var.progetto}-db"
  subnet_ids = aws_subnet.database[*].id
}

resource "aws_security_group" "database" {
  name        = "${var.progetto}-db"
  description = "Postgres: solo la 5432, con SSL e token IAM"
  vpc_id      = aws_vpc.principale.id
}

resource "aws_vpc_security_group_ingress_rule" "postgres" {
  security_group_id = aws_security_group.database.id
  description       = "Lambda (IP non fissi) e Mac"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 5432
  to_port           = 5432
}
