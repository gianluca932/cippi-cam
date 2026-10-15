variable "progetto" {
  type    = string
  default = "cippi-cam"
}

variable "regione" {
  type    = string
  default = "eu-south-1" # Milano: Bedrock (Claude, Qwen3-VL, Titan), RDS Postgres
}

# --- Modelli (Bedrock) ---
# Da scegliere MISURANDO: npm run valuta e npm run chiedi con LLM_PROVIDER=bedrock (regola d'oro n. 2).
# Candidati a Milano: Claude Haiku 4.5, Qwen3-VL, Amazon Nova 2 Lite (Claude 5.5 non è abilitato per questo account).
# Su Bedrock i Qwen non hanno il profilo "eu.": girano solo a Milano.

variable "modello_visione" {
  type = string
  # npm run valuta (57 foto, 2026-10-15): azioni 56%, acqua 39%, cibo 94%, ~4 s a foto.
  # Nova 2 Lite: 50%, 39%, 74%. Claude Haiku 4.5 bloccato in attesa del modulo Anthropic.
  default = "qwen.qwen3-vl-235b-a22b"
}

variable "modello_agente" {
  type    = string
  default = "qwen.qwen3-235b-a22b-2507-v1:0" # testuale, chiama i tool via Converse; da misurare con npm run chiedi
}

variable "modello_embedding" {
  type    = string
  default = "amazon.titan-embed-text-v2:0"
}

variable "dimensioni_embedding" {
  type        = number
  default     = 1024 # Titan v2: 256, 512 o 1024. Deve coincidere con la colonna embedding_testo (npm run db:migra:aws)
  description = "Dimensioni dei vettori di testo"
}

# --- Database ---

variable "db_classe" {
  type        = string
  default     = "db.t4g.micro" # 2 vCPU, 1 GB: nel piano free, e per un diario basta
  description = "Classe dell'istanza RDS"
}
