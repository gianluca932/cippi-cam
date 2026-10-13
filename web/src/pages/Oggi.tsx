import { Chat } from "../components/Chat";
import { Gallery } from "../components/Gallery";
import { diary } from "../mock";

export function Oggi() {
  return (
    <main className="layout">
      <Gallery title="Galleria di oggi" entries={diary} />
      <Chat />
    </main>
  );
}
