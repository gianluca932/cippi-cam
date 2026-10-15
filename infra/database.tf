# RDS PostgreSQL su un'istanza piccola, nei limiti del piano free di AWS (750 ore al mese di db.t4g.micro, 20 GB).
# Si era partiti con Aurora Serverless v2 + Data API, ma sul piano free Aurora si crea solo in
# "express configuration", che il provider Terraform non supporta ancora (vedi CHANGELOG 0.14.0).
# - 17: la stessa major del Postgres in Docker (pgvector/pgvector:pg17). pgvector c'è già in RDS.
# - Pubblico ma chiuso: SSL e login con token IAM (vedi rete.tf e src/db/connessione.ts).
# - Non va in pausa come Aurora: gira sempre, ma l'istanza rientra nel piano free; si paga l'IPv4 pubblico (~3,6 $/mese).

resource "aws_db_instance" "diario" {
  identifier     = "${var.progetto}-db"
  engine         = "postgres"
  engine_version = "17" # l'ultima minor della 17; gli aggiornamenti minori li applica RDS
  instance_class = var.db_classe
  db_name        = "cippi"
  username       = "cippi"

  # La password del master la crea e la ruota RDS in Secrets Manager: non passa mai da Terraform né dallo stato.
  # La usa solo npm run db:migra:aws; le Lambda entrano come "diario" con un token IAM.
  manage_master_user_password         = true
  iam_database_authentication_enabled = true

  allocated_storage     = 20
  max_allocated_storage = 0     # niente crescita automatica: 20 GB è il tetto del piano free
  storage_type          = "gp2" # quello indicato dal piano free
  storage_encrypted     = true

  db_subnet_group_name   = aws_db_subnet_group.database.name
  vpc_security_group_ids = [aws_security_group.database.id]
  publicly_accessible    = true
  multi_az               = false

  auto_minor_version_upgrade = true
  backup_retention_period    = 1 # il massimo del piano free; con un account a pagamento si può salire
  # Con terraform destroy resta uno snapshot finale: le correzioni fatte a mano non si ricreano.
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.progetto}-db-finale"
}

locals {
  db_master_secret_arn = aws_db_instance.diario.master_user_secret[0].secret_arn
  db_utente            = "diario" # creato da npm run db:migra:aws
}
