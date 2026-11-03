import { useState, type ReactNode } from "react";

// Covers its (relatively positioned) parent; a failed load falls back to the placeholder content.
export default function RecipeImage({ src, lazy = false, children }: { src: string | null; lazy?: boolean; children: ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return children;
  return <img className="cover" src={src} alt="" loading={lazy ? "lazy" : undefined} onError={() => setFailed(true)} />;
}
