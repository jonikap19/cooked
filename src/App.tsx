import { useSyncExternalStore } from "react";
import { BrowserRouter, Route, Routes } from "react-router";
import { sessionStore } from "./api";
import CookMode from "./pages/CookMode";
import AddRecipe from "./pages/AddRecipe";
import OwnRecipe from "./pages/OwnRecipe";
import Home from "./pages/Home";
import Pantry from "./pages/Pantry";
import ShoppingList from "./pages/ShoppingList";
import RecipeDetail from "./pages/RecipeDetail";

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

export default function App() {
  return (
    <BrowserRouter>
      <SessionExpired />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/einkaufsliste" element={<ShoppingList />} />
        <Route path="/vorrat" element={<Pantry />} />
        <Route path="/neu" element={<AddRecipe />} />
        <Route path="/neu/eigenes" element={<OwnRecipe />} />
        <Route path="/rezept/:id" element={<RecipeDetail />} />
        <Route path="/rezept/:id/kochen" element={<CookMode />} />
      </Routes>
    </BrowserRouter>
  );
}
