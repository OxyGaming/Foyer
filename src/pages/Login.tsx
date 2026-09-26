import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { api } from "@/lib/api";
import { keys } from "@/lib/queries";
import { Spinner } from "@/components/ui";

function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="pt-safe mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-10">
      <div className="mb-8 text-center">
        <img src="/favicon.svg" alt="" className="mx-auto mb-4 size-16" />
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-ink-2">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/login", { email, password });
      await qc.invalidateQueries({ queryKey: keys.me });
      navigate((location.state as { from?: string } | null)?.from ?? "/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connexion impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Foyer" subtitle="Recettes, stock et courses de la maison">
      <form onSubmit={submit} className="space-y-3">
        <input className="input" type="email" autoComplete="username" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className="input" type="password" autoComplete="current-password" placeholder="Mot de passe" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p className="text-sm font-medium text-danger">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? <Spinner className="text-brand-ink" /> : "Se connecter"}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-ink-2">
        Invité·e par un membre du foyer ?{" "}
        <Link to="/inscription" className="font-semibold text-brand">
          Créer mon compte
        </Link>
      </p>
    </AuthShell>
  );
}

export function RegisterPage() {
  const [params] = useSearchParams();
  const [code, setCode] = useState(params.get("code") ?? "");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/register", { code, name, email, password });
      await qc.invalidateQueries({ queryKey: keys.me });
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Inscription impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Rejoindre un foyer" subtitle="Avec le code reçu d'un membre du foyer">
      <form onSubmit={submit} className="space-y-3">
        <input className="input text-center font-mono tracking-[0.3em] uppercase" placeholder="CODE" value={code} onChange={(e) => setCode(e.target.value)} required autoCapitalize="characters" />
        <input className="input" placeholder="Prénom" value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" />
        <input className="input" type="email" autoComplete="username" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className="input" type="password" autoComplete="new-password" placeholder="Mot de passe (8 caractères min.)" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p className="text-sm font-medium text-danger">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? <Spinner className="text-brand-ink" /> : "Créer mon compte"}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-ink-2">
        Déjà un compte ?{" "}
        <Link to="/connexion" className="font-semibold text-brand">
          Se connecter
        </Link>
      </p>
    </AuthShell>
  );
}
