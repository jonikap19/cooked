import { NavLink } from "react-router";

const TABS = [
  { to: "/", label: "Kochbuch" },
  { to: "/einkaufsliste", label: "Einkaufsliste" },
  { to: "/vorrat", label: "Vorrat" },
];

export default function TabBar() {
  return (
    <nav className="tab-bar" aria-label="Hauptnavigation">
      {TABS.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end>
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
