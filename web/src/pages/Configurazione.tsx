import { useState } from "react";
import { configs, type Ambiente } from "../config";

type Row = [label: string, value: string | number | undefined];

function Section({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <div className="config-section">
      <h3>{title}</h3>
      <dl>
        {rows
          .filter(([, v]) => v !== undefined)
          .map(([label, value]) => (
            <div key={label} className="config-row">
              <dt>{label}</dt>
              <dd className={value === "da definire" ? "tbd" : ""}>{value}</dd>
            </div>
          ))}
      </dl>
    </div>
  );
}

export function Configurazione() {
  const [env, setEnv] = useState<Ambiente>("locale");
  const c = configs[env];

  return (
    <section className="panel">
      <div className="config-head">
        <h2>Configurazione</h2>
        <div className="segmented" role="tablist">
          {(["locale", "aws"] as const).map((e) => (
            <button key={e} role="tab" aria-selected={env === e} onClick={() => setEnv(e)}>
              {e === "locale" ? "💻 Locale" : "☁️ AWS"}
            </button>
          ))}
        </div>
      </div>

      <div className="config-grid">
        <Section
          title="Modelli"
          rows={[
            ["Provider", c.modelli.provider],
            ["Endpoint", c.modelli.endpoint],
            ["Visione (occhi)", c.modelli.visione],
            ["Chat (agente)", c.modelli.chat],
            ["Contesto (num_ctx)", c.modelli.contesto],
            ["Soglia confidenza", c.modelli.sogliaConfidenza],
          ]}
        />
        <Section
          title="Database"
          rows={[
            ["Tipo", c.database.tipo],
            ["Connessione", c.database.connessione],
          ]}
        />
        <Section
          title="Storage foto"
          rows={[
            ["Tipo", c.storageFoto.tipo],
            ["Percorso", c.storageFoto.percorso],
          ]}
        />
        <Section
          title="Calcolo"
          rows={[
            ["Tipo", c.calcolo.tipo],
            ["Dettagli", c.calcolo.dettagli],
          ]}
        />
        <Section
          title="Rete"
          rows={[
            ["Region", c.rete.region],
            ["VPC", c.rete.vpc],
            ["Subnet", c.rete.subnet],
            ["Security group", c.rete.securityGroup],
            ["Accesso", c.rete.accesso],
          ]}
        />
      </div>
    </section>
  );
}
