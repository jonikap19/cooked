import { useSyncExternalStore } from "react";
import { BrowserRouter, Route, Routes, useParams } from "react-router";
import { sessionStore } from "./api";
import CookMode from "./pages/CookMode";
import AddRecipe from "./pages/AddRecipe";
import OwnRecipe from "./pages/OwnRecipe";
import Home from "./pages/Home";
import Groups from "./pages/Groups";
import Group from "./pages/Group";
import Pantry from "./pages/Pantry";
import ShoppingList from "./pages/ShoppingList";
import SharedRecipe from "./pages/SharedRecipe";
import RecipeDetail from "./pages/RecipeDetail";
import Allergies from "./pages/Allergies";

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

// Keyed by id so sharing a recipe into a group (navigate to the copy) resets all detail state.
function RecipeDetailRoute() {
  const { id } = useParams();
  return <RecipeDetail key={id} />;
}

function GroupRoute() {
  const { id } = useParams();
  return <Group key={id} />;
}

function SharedRecipeRoute() {
  const { token } = useParams();
  return <SharedRecipe key={token} />;
}

export default function App() {
  return (
    <BrowserRouter>
      <SessionExpired />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/einkaufsliste" element={<ShoppingList />} />
        <Route path="/vorrat" element={<Pantry />} />
        <Route path="/allergien" element={<Allergies />} />
        <Route path="/gruppen" element={<Groups />} />
        <Route path="/gruppen/:id" element={<GroupRoute />} />
        <Route path="/neu" element={<AddRecipe />} />
        <Route path="/neu/eigenes" element={<OwnRecipe />} />
        <Route path="/rezept/:id" element={<RecipeDetailRoute />} />
        <Route path="/teilen/:token" element={<SharedRecipeRoute />} />
        <Route path="/rezept/:id/kochen" element={<CookMode />} />
      </Routes>
    </BrowserRouter>
  );
}
