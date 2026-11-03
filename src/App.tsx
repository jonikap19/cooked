import { useSyncExternalStore } from "react";
import { BrowserRouter, Route, Routes } from "react-router";
import { sessionStore } from "./api";
import Home from "./pages/Home";

function SessionExpired() {
  const expired = useSyncExternalStore(sessionStore.subscribe, sessionStore.isExpired);
  if (!expired) return null;
  return (
    <div className="banner" role="alert">
      <strong>Sitzung abgelaufen</strong>
      <button onClick={() => location.reload()}>Neu laden</button>
    </div>
  );
}

// Placeholders until the add / detail / cook screens land.
const Soon = ({ title }: { title: string }) => <h1 className="page">{title}</h1>;

export default function App() {
  return (
    <BrowserRouter>
      <SessionExpired />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/neu" element={<Soon title="Rezept hinzufügen" />} />
        <Route path="/rezept/:id" element={<Soon title="Rezept" />} />
        <Route path="/rezept/:id/kochen" element={<Soon title="Kochen" />} />
      </Routes>
    </BrowserRouter>
  );
}
