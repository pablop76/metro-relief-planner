import { useRef } from "react";
import type { Driver } from "../lib/types";

interface Props {
  drivers: Driver[];
  onChange: (d: Driver[]) => void;
  onRestore: () => void;
  onClose: () => void;
}

const newId = () =>
  (crypto as Crypto & { randomUUID?: () => string }).randomUUID?.() ??
  `d${Date.now()}${Math.random().toString(36).slice(2, 5)}`;

export function DriversManager({ drivers, onChange, onRestore, onClose }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  const setField = (id: string, field: keyof Driver, value: string) =>
    onChange(drivers.map((d) => (d.id === id ? { ...d, [field]: value } : d)));

  const add = () =>
    onChange([...drivers, { id: newId(), imie: "", nazwisko: "", nrPrawa: "", telefon: "" }]);

  const remove = (id: string) => onChange(drivers.filter((d) => d.id !== id));

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(drivers, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "maszynisci.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (Array.isArray(parsed)) onChange(parsed as Driver[]);
    } catch {
      alert("Nieprawidłowy plik JSON");
    }
    e.target.value = "";
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Maszyniści ({drivers.length})</h2>
          <button className="modal-x" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="dm-toolbar">
          <button onClick={add}>+ Dodaj maszynistę</button>
          <button onClick={exportJson}>⭳ Eksportuj</button>
          <button onClick={() => fileRef.current?.click()}>⭱ Importuj</button>
          <button onClick={onRestore} title="wczytaj ponownie maszynisci.json">
            ↺ Przywróć z pliku
          </button>
          <input ref={fileRef} type="file" accept=".json" hidden onChange={importJson} />
        </div>

        <div className="dm-table-wrap">
          <table className="dm-table">
            <thead>
              <tr>
                <th>Imię</th>
                <th>Nazwisko</th>
                <th>Nr prawa kierowania</th>
                <th>Telefon</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {drivers.map((d) => (
                <tr key={d.id}>
                  <td><input value={d.imie} onChange={(e) => setField(d.id, "imie", e.target.value)} /></td>
                  <td><input value={d.nazwisko} onChange={(e) => setField(d.id, "nazwisko", e.target.value)} /></td>
                  <td><input value={d.nrPrawa} onChange={(e) => setField(d.id, "nrPrawa", e.target.value)} /></td>
                  <td><input value={d.telefon} onChange={(e) => setField(d.id, "telefon", e.target.value)} /></td>
                  <td>
                    <button className="dm-del" onClick={() => remove(d.id)} title="usuń">
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
