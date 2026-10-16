import { useState } from "react";
import uccellini from "../../../config/uccellini.json";
import { configs, type Ambiente } from "../config";

type Row = [label: string, value: string | number | undefined];

// I colori in config/uccellini.json sono in italiano (li legge il codice): qui si mostrano in inglese.
const COLORE: Record<string, string> = { giallo: "yellow", celeste: "light blue", verde: "green", bianco: "white", grigio: "grey", blu: "blue" };

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
              <dd className={value === "to be defined" ? "tbd" : ""}>{value}</dd>
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
        <h2>Configuration</h2>
        <div className="segmented" role="tablist">
          {(["locale", "aws"] as const).map((e) => (
            <button key={e} role="tab" aria-selected={env === e} onClick={() => setEnv(e)}>
              {e === "locale" ? "💻 Local" : "☁️ AWS"}
            </button>
          ))}
        </div>
      </div>

      <div className="config-grid">
        <Section
          title="Birds · config/uccellini.json"
          rows={uccellini.map((u): Row => [u.nome, COLORE[u.colore] ?? u.colore])}
        />
        <Section
          title="Models"
          rows={[
            ["Provider", c.modelli.provider],
            ["Endpoint", c.modelli.endpoint],
            ["Vision (eyes)", c.modelli.visione],
            ["Chat (agent)", c.modelli.chat],
            ["Embedding", c.modelli.embedding],
            ["Context (num_ctx)", c.modelli.contesto],
            ["Confidence threshold", c.modelli.sogliaConfidenza],
          ]}
        />
        <Section
          title="Database"
          rows={[
            ["Type", c.database.tipo],
            ["Connection", c.database.connessione],
          ]}
        />
        <Section
          title="Photo storage"
          rows={[
            ["Type", c.storageFoto.tipo],
            ["Path", c.storageFoto.percorso],
          ]}
        />
        <Section
          title="Compute"
          rows={[
            ["Type", c.calcolo.tipo],
            ["Details", c.calcolo.dettagli],
          ]}
        />
        <Section
          title="Network"
          rows={[
            ["Region", c.rete.region],
            ["VPC", c.rete.vpc],
            ["Subnet", c.rete.subnet],
            ["Security group", c.rete.securityGroup],
            ["Access", c.rete.accesso],
          ]}
        />
      </div>
    </section>
  );
}
