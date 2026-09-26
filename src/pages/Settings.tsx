import { useQueryClient } from "@tanstack/react-query";
import { del as idbDel } from "idb-keyval";
import { ChevronRight, Copy, FolderTree, KeyRound, LogOut, MapPin, Plus, Share2, Trash2, UserPlus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { Field, PageHeader, PageLoader, Sheet, useConfirm } from "@/components/ui";
import { api } from "@/lib/api";
import { keys, useCategories, useDeleteCategory, useDeleteLocation, useInvites, useLocations, useMe, useSaveCategory, useSaveLocation } from "@/lib/queries";
import { flattenTree } from "@/lib/tree";
import type { CategoryKind } from "@/lib/types";

export function SettingsPage() {
  const me = useMe();
  const invites = useInvites();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [edit, setEdit] = useState<"household" | "me" | "password" | null>(null);
  const [text, setText] = useState("");
  const [pwd, setPwd] = useState({ current: "", next: "" });
  const { ask, dialog } = useConfirm();

  if (!me.data) return <PageLoader />;
  const { user, household } = me.data;

  async function saveName(e: FormEvent) {
    e.preventDefault();
    try {
      await api.patch(edit === "household" ? "/household" : "/household/me", { name: text });
      await qc.invalidateQueries({ queryKey: keys.me });
      setEdit(null);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    try {
      await api.post("/auth/password", pwd);
      toast.success("Mot de passe modifié");
      setPwd({ current: "", next: "" });
      setEdit(null);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function createInvite() {
    try {
      await api.post("/household/invites");
      await qc.invalidateQueries({ queryKey: keys.invites });
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function share(code: string) {
    const url = `${location.origin}/inscription?code=${code}`;
    const text = `Rejoins notre foyer « ${household.name} » sur Foyer : ${url} (code ${code})`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Invitation Foyer", text, url });
        return;
      } catch {
        /* partage annulé : on copie */
      }
    }
    await navigator.clipboard.writeText(text);
    toast.success("Invitation copiée");
  }

  async function logout() {
    await api.post("/auth/logout").catch(() => undefined);
    qc.clear();
    await idbDel("foyer-cache");
    navigate("/connexion", { replace: true });
  }

  const row = "flex w-full items-center gap-3 px-4 py-3.5 text-left";

  return (
    <>
      <PageHeader back="/" title="Réglages" />
      <div className="space-y-6 px-4 pb-6">
        <section className="card divide-y divide-line overflow-hidden">
          <button className={row} onClick={() => { setText(household.name); setEdit("household"); }}>
            <span className="text-2xl">🏠</span>
            <span className="flex-1">
              <span className="block text-xs text-ink-2">Foyer</span>
              <span className="font-semibold">{household.name}</span>
            </span>
            <ChevronRight className="size-5 text-ink-3" />
          </button>
          <button className={row} onClick={() => { setText(user.name ?? ""); setEdit("me"); }}>
            <span className="text-2xl">🙂</span>
            <span className="flex-1">
              <span className="block text-xs text-ink-2">Mon prénom</span>
              <span className="font-semibold">{user.name || "—"}</span>
              <span className="block text-xs text-ink-3">{user.email}</span>
            </span>
            <ChevronRight className="size-5 text-ink-3" />
          </button>
          <button className={row} onClick={() => setEdit("password")}>
            <KeyRound className="size-5 text-ink-2" />
            <span className="flex-1 font-medium">Changer mon mot de passe</span>
            <ChevronRight className="size-5 text-ink-3" />
          </button>
        </section>

        <section>
          <h2 className="mb-2 px-1 text-sm font-bold tracking-wide text-ink-2 uppercase">Membres du foyer</h2>
          <div className="card divide-y divide-line overflow-hidden">
            {household.members.map((m) => (
              <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                <span className="flex size-9 items-center justify-center rounded-full bg-brand-soft font-bold text-brand">{(m.name || m.email)[0].toUpperCase()}</span>
                <span className="flex-1">
                  <span className="block font-semibold">
                    {m.name || m.email}
                    {m.id === user.id && <span className="font-normal text-ink-3"> (moi)</span>}
                  </span>
                  <span className="text-xs text-ink-2">{m.email}</span>
                </span>
              </div>
            ))}
            {invites.data?.map((inv) => (
              <div key={inv.id} className="flex items-center gap-2 px-4 py-3">
                <UserPlus className="size-5 text-ink-3" />
                <span className="flex-1">
                  <span className="block font-mono font-bold tracking-widest">{inv.code}</span>
                  <span className="text-xs text-ink-2">Valable jusqu'au {new Date(inv.expiresAt).toLocaleDateString("fr-FR")}</span>
                </span>
                <button className="icon-btn size-10" onClick={() => share(inv.code)} aria-label="Partager l'invitation">
                  {"share" in navigator ? <Share2 className="size-5" /> : <Copy className="size-5" />}
                </button>
                <button
                  className="icon-btn size-10 text-danger"
                  aria-label="Annuler l'invitation"
                  onClick={async () => {
                    await api.del(`/household/invites/${inv.id}`);
                    qc.invalidateQueries({ queryKey: keys.invites });
                  }}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
            <button className={`${row} font-semibold text-brand`} onClick={createInvite}>
              <UserPlus className="size-5" /> Inviter un membre
            </button>
          </div>
          <p className="mt-1.5 px-1 text-xs text-ink-3">La personne invitée crée son compte avec le code (valable 7 jours) et partage aussitôt recettes et stock.</p>
        </section>

        <section className="card divide-y divide-line overflow-hidden">
          <Link to="/reglages/categories" className={row}>
            <FolderTree className="size-5 text-ink-2" />
            <span className="flex-1 font-medium">Catégories</span>
            <ChevronRight className="size-5 text-ink-3" />
          </Link>
          <Link to="/reglages/emplacements" className={row}>
            <MapPin className="size-5 text-ink-2" />
            <span className="flex-1 font-medium">Emplacements</span>
            <ChevronRight className="size-5 text-ink-3" />
          </Link>
        </section>

        <button className="btn-soft w-full text-danger" onClick={async () => (await ask("Se déconnecter ?", { confirm: "Déconnexion" })) && logout()}>
          <LogOut className="size-4" /> Se déconnecter
        </button>
      </div>

      <Sheet open={edit === "household" || edit === "me"} onClose={() => setEdit(null)} title={edit === "household" ? "Nom du foyer" : "Mon prénom"}>
        <form onSubmit={saveName} className="space-y-3">
          <input className="input" autoFocus value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn-primary w-full">Enregistrer</button>
        </form>
      </Sheet>
      <Sheet open={edit === "password"} onClose={() => setEdit(null)} title="Changer mon mot de passe">
        <form onSubmit={savePassword} className="space-y-3">
          <input className="input" type="password" autoComplete="current-password" placeholder="Mot de passe actuel" value={pwd.current} onChange={(e) => setPwd({ ...pwd, current: e.target.value })} required />
          <input className="input" type="password" autoComplete="new-password" placeholder="Nouveau mot de passe (8 caractères min.)" minLength={8} value={pwd.next} onChange={(e) => setPwd({ ...pwd, next: e.target.value })} required />
          <button className="btn-primary w-full">Modifier</button>
        </form>
      </Sheet>
      {dialog}
    </>
  );
}

// ─── Éditeur d'arborescence (catégories / emplacements) ──────────────────────

type TreeItem = { id: string; name: string; icon: string | null; parentId: string | null; usage: number };
type Draft = { id?: string; name: string; icon: string; parentId: string };

function TreeEditor({
  items,
  loading,
  onSave,
  onDelete,
  saving,
  noun,
  usageLabel,
  deleteHint,
}: {
  items: TreeItem[];
  loading: boolean;
  onSave: (d: Draft) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
  saving: boolean;
  noun: string;
  usageLabel: (n: number) => string;
  deleteHint: string;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const { ask, dialog } = useConfirm();
  const flat = flattenTree(items);

  // Exclut l'élément édité et ses descendants des parents possibles.
  const forbidden = new Set<string>();
  if (draft?.id) {
    forbidden.add(draft.id);
    let grew = true;
    while (grew) {
      grew = false;
      for (const i of items) if (i.parentId && forbidden.has(i.parentId) && !forbidden.has(i.id)) { forbidden.add(i.id); grew = true; }
    }
  }

  if (loading) return <PageLoader />;
  return (
    <>
      <div className="card divide-y divide-line overflow-hidden">
        {flat.map((i) => (
          <button key={i.id} className="flex w-full items-center gap-3 py-3 pr-4 text-left" style={{ paddingLeft: 16 + i.depth * 22 }} onClick={() => setDraft({ id: i.id, name: i.name, icon: i.icon ?? "", parentId: i.parentId ?? "" })}>
            <span className="w-7 text-center text-xl">{i.icon || "•"}</span>
            <span className="flex-1 font-medium">{i.name || "Sans nom"}</span>
            {i.usage > 0 && <span className="text-xs text-ink-3">{usageLabel(i.usage)}</span>}
            <ChevronRight className="size-4 text-ink-3" />
          </button>
        ))}
        <button className="flex w-full items-center gap-3 px-4 py-3.5 font-semibold text-brand" onClick={() => setDraft({ name: "", icon: "", parentId: "" })}>
          <Plus className="size-5" /> Ajouter {noun}
        </button>
      </div>

      <Sheet open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? `Modifier` : `Nouvel·le ${noun.replace(/^une? /, "")}`}>
        {draft && (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              await onSave(draft);
              setDraft(null);
            }}
          >
            <div className="grid grid-cols-[4.5rem_1fr] gap-3">
              <Field label="Icône">{(fid) => <input id={fid} className="input text-center text-xl" maxLength={4} placeholder="😀" value={draft.icon} onChange={(e) => setDraft({ ...draft, icon: e.target.value })} />}</Field>
              <Field label="Nom">{(fid) => <input id={fid} className="input" autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />}</Field>
            </div>
            <Field label="Dans">
              {(fid) => (
                <select id={fid} className="input" value={draft.parentId} onChange={(e) => setDraft({ ...draft, parentId: e.target.value })}>
                  <option value="">— Premier niveau —</option>
                  {flat.filter((i) => !forbidden.has(i.id)).map((i) => (
                    <option key={i.id} value={i.id}>
                      {"  ".repeat(i.depth)}
                      {i.icon} {i.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <div className="flex gap-3">
              {draft.id && (
                <button
                  type="button"
                  className="btn-danger"
                  onClick={async () => {
                    if (await ask(`Supprimer « ${draft.name || "Sans nom"} » ?`, { message: deleteHint })) {
                      await onDelete(draft.id!);
                      setDraft(null);
                    }
                  }}
                  aria-label="Supprimer"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
              <button className="btn-primary flex-1" disabled={saving}>
                Enregistrer
              </button>
            </div>
          </form>
        )}
      </Sheet>
      {dialog}
    </>
  );
}

export function CategoriesPage() {
  const categories = useCategories();
  const save = useSaveCategory();
  const del = useDeleteCategory();
  const [kind, setKind] = useState<CategoryKind>("product");
  const items = (categories.data ?? []).filter((c) => c.kind === kind);
  return (
    <>
      <PageHeader back="/reglages" title="Catégories" />
      <div className="space-y-4 px-4">
        <div className="flex rounded-xl bg-surface-2 p-1">
          {(["product", "recipe"] as const).map((k) => (
            <button key={k} className={`flex-1 rounded-lg py-2 text-sm font-semibold ${kind === k ? "bg-surface shadow-sm" : "text-ink-2"}`} onClick={() => setKind(k)}>
              {k === "product" ? "Produits" : "Recettes"}
            </button>
          ))}
        </div>
        <TreeEditor
          key={kind}
          items={items}
          loading={categories.isPending}
          saving={save.isPending}
          noun="une catégorie"
          usageLabel={(n) => `${n} élément${n > 1 ? "s" : ""}`}
          deleteHint="Les produits et recettes concernés restent, simplement sans catégorie. Les sous-catégories remontent d'un niveau."
          onSave={(d) => save.mutateAsync({ id: d.id, data: { kind, name: d.name, icon: d.icon || null, parentId: d.parentId || null } })}
          onDelete={(id) => del.mutateAsync(id)}
        />
      </div>
    </>
  );
}

export function LocationsPage() {
  const locations = useLocations();
  const save = useSaveLocation();
  const del = useDeleteLocation();
  return (
    <>
      <PageHeader back="/reglages" title="Emplacements" subtitle="Ex. Garage › Étagère 1" />
      <div className="px-4">
        <TreeEditor
          items={locations.data ?? []}
          loading={locations.isPending}
          saving={save.isPending}
          noun="un emplacement"
          usageLabel={(n) => `${n} produit${n > 1 ? "s" : ""}`}
          deleteHint="Possible uniquement si aucun produit n'y est rangé. Les sous-emplacements remontent d'un niveau."
          onSave={(d) => save.mutateAsync({ id: d.id, data: { name: d.name, icon: d.icon || null, parentId: d.parentId || null } })}
          onDelete={(id) => del.mutateAsync(id)}
        />
      </div>
    </>
  );
}
