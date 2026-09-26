import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useLocations, useSaveProduct } from "@/lib/queries";
import { flattenTree } from "@/lib/tree";
import { NumberInput, Sheet } from "./ui";

/** « Lessive » + Enregistrer. Quantité et emplacement sont proposés mais facultatifs. */
export function QuickProductSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState<number | null>(null);
  const [locationId, setLocationId] = useState("");
  const locations = useLocations();
  const save = useSaveProduct();
  const navigate = useNavigate();

  async function submit(e: FormEvent, andAnother = false) {
    e.preventDefault();
    const p = await save.mutateAsync({ data: { name, quantity, locationId: locationId || null } });
    toast.success(`« ${p.name || "Produit"} » ajouté`);
    setName("");
    setQuantity(null);
    if (!andAnother) onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Nouveau produit">
      <form onSubmit={submit} className="space-y-3">
        <input className="input" autoFocus placeholder="Ex. Lessive, Riz, Dentifrice…" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid grid-cols-[1fr_2fr] gap-3">
          <NumberInput value={quantity} onChange={setQuantity} placeholder="Quantité" />
          <select className="input" value={locationId} onChange={(e) => setLocationId(e.target.value)} aria-label="Emplacement">
            <option value="">Emplacement…</option>
            {flattenTree(locations.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {"  ".repeat(l.depth)}
                {l.icon} {l.name}
              </option>
            ))}
          </select>
        </div>
        <p className="text-sm text-ink-2">Seul le nom est utile pour commencer ; le reste se complète plus tard.</p>
        <div className="grid grid-cols-2 gap-3">
          <button type="button" className="btn-soft" disabled={save.isPending} onClick={(e) => submit(e, true)}>
            + Un autre
          </button>
          <button className="btn-primary" disabled={save.isPending}>
            Enregistrer
          </button>
        </div>
        <button type="button" className="btn-ghost w-full text-sm" onClick={() => { onClose(); navigate("/produits/nouveau", { state: { name } }); }}>
          Formulaire complet (photo, seuils, marque…)
        </button>
      </form>
    </Sheet>
  );
}
