import { NavLink } from "react-router";

const TABS = [
  { to: "/", label: "Kochbuch" },
  { to: "/einkaufsliste", label: "Einkaufsliste" },
  { to: "/vorrat", label: "Vorrat" },
  { to: "/gruppen", label: "Gruppen" },
];

export default function TabBar() {
  return (
    <nav className="tab-bar" aria-label="Hauptnavigation">
      {TABS.map((tab) => (
        <NavLink key={tab.to} to={tab.to}>
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
