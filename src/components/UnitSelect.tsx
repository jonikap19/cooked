import { UNITS } from "../../shared/units";

interface Props {
  id?: string;
  value: string;
  onChange(unit: string): void;
  "aria-label"?: string;
}

export default function UnitSelect({ id, value, onChange, "aria-label": ariaLabel }: Props) {
  // An imported unit outside the list (e.g. "Stk") stays selectable so editing never loses it.
  const options: readonly string[] = (UNITS as readonly string[]).includes(value) ? UNITS : [value, ...UNITS];
  return (
    <select id={id} className="field" aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((unit) => (
        <option key={unit} value={unit}>{unit === "" ? "–" : unit}</option>
      ))}
    </select>
  );
}
