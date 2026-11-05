import { ChefHat } from "lucide-react";
import { useState } from "react";

// Covers its (relatively positioned) parent; no image or a failed load shows a chef-hat placeholder.
export default function RecipeImage({ src, lazy = false }: { src: string | null; lazy?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <ChefHat className="placeholder-icon" aria-hidden="true" />;
  return <img className="cover" src={src} alt="" loading={lazy ? "lazy" : undefined} onError={() => setFailed(true)} />;
}
