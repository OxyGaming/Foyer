import { describe, expect, it } from "vitest";
import { itemsToRows } from "./pdfText";
import { matchProduct, parseReceipt, parseSize, suggestName } from "./receiptParse";

describe("taille lue dans le libellé", () => {
  it("lots, poids, volumes, pièces", () => {
    expect(parseSize("LAIT 1/2 ECR UHT 6X1L")).toEqual({ quantity: 6, unit: "L" });
    expect(parseSize("CREME FR.EP 30% 20CL")).toEqual({ quantity: 20, unit: "cl" });
    expect(parseSize("Farine T45 1,5kg")).toEqual({ quantity: 1.5, unit: "kg" });
    expect(parseSize("OEUFS PLEIN AIR X12")).toEqual({ quantity: 12, unit: "pièce" });
    expect(parseSize("Yaourts 4 x 125 g")).toEqual({ quantity: 500, unit: "g" });
    expect(parseSize("Baguette tradition")).toBeNull();
  });
});

describe("facture de drive", () => {
  // Colonnes : libellé | quantité | prix unitaire | montant (type Leclerc / Carrefour).
  const columns = [
    ["E.Leclerc DRIVE Saint-Jean"],
    ["Facture n° 123456", "Commande du 30/09/2026"],
    ["Désignation", "Qté", "P.U.", "Montant"],
    ["CREMERIE"],
    ["LAIT 1/2 ECR UHT 6X1L", "1", "5,94 €", "5,94 €"],
    ["CREME FR.EP 30% 20CL", "2", "1,29", "2,58"],
    ["Remise immédiate", "-0,50"],
    ["FRUITS ET LEGUMES"],
    ["POMMES GALA VRAC", "0,812 kg x 2,49 €/kg", "2,02"],
    ["OEUFS PLEIN AIR X12"],
    ["", "1", "3,45", "3,45"],
    ["Frais de préparation", "2,00"],
    ["Sous-total", "13,49"],
    ["TOTAL TTC", "15,49 €"],
    ["Paiement CB", "15,49"],
  ];

  it("lit magasin, date, articles, quantités, remises et total", () => {
    const r = parseReceipt(columns);
    expect(r.store).toBe("E.Leclerc");
    expect(r.date).toBe("2026-09-30");
    expect(r.totalCents).toBe(1549);
    expect(r.lines).toEqual([
      { label: "LAIT 1/2 ECR UHT 6X1L", count: 1, quantity: 6, unit: "L", totalCents: 594, isPromo: false },
      { label: "CREME FR.EP 30% 20CL", count: 2, quantity: 40, unit: "cl", totalCents: 208, isPromo: true },
      { label: "POMMES GALA VRAC", count: 1, quantity: 0.812, unit: "kg", totalCents: 202, isPromo: false },
      { label: "OEUFS PLEIN AIR X12", count: 1, quantity: 12, unit: "pièce", totalCents: 345, isPromo: false },
    ]);
  });

  it("date en toutes lettres, quantité « x3 » et prix seul", () => {
    const r = parseReceipt([["Votre commande Carrefour Drive"], ["Livrée le 2 octobre 2026"], ["Pâtes coquillettes 500g", "x3", "3,57 €"]]);
    expect(r).toMatchObject({ store: "Carrefour", date: "2026-10-02" });
    expect(r.lines[0]).toMatchObject({ count: 3, quantity: 1500, unit: "g", totalCents: 357 });
  });
});

describe("reconstitution des lignes du PDF", () => {
  it("regroupe par hauteur et sépare les colonnes", () => {
    const rows = itemsToRows([
      { str: "LAIT", x: 10, y: 700, w: 20, h: 8 },
      { str: "UHT", x: 32, y: 700.5, w: 15, h: 8 },
      { str: "5,94", x: 300, y: 699.8, w: 20, h: 8 },
      { str: "TOTAL", x: 10, y: 680, w: 25, h: 8 },
    ]);
    expect(rows).toEqual([["LAIT UHT", "5,94"], ["TOTAL"]]);
  });
});

describe("rapprochement avec le catalogue", () => {
  const products = [
    { id: "lait", name: "Lait" },
    { id: "laitde", name: "Lait demi-écrémé" },
    { id: "creme", name: "Crème fraîche épaisse" },
    { id: "oeufs", name: "Œufs" },
  ];
  it("libellé appris d'abord, puis mots du nom (abréviations comprises)", () => {
    expect(matchProduct("CREME FR.EP 30% 20CL", products, new Map([["creme fr.ep 30% 20cl", "creme"]]))).toEqual({ productId: "creme", how: "learned" });
    expect(matchProduct("LAIT 1/2 ECR UHT 6X1L", products, new Map()).productId).toBe("laitde");
    expect(matchProduct("OEUFS PLEIN AIR X12", products, new Map()).productId).toBe("oeufs");
    expect(matchProduct("SAC CABAS", products, new Map())).toEqual({ productId: null, how: null });
  });

  it("propose un nom lisible pour un nouveau produit", () => {
    expect(suggestName("CREME FR.EP 30% 20CL")).toBe("Creme fr.ep");
    expect(suggestName("LAIT 1/2 ECR UHT 6X1L")).toBe("Lait 1/2 ecr uht");
  });
});
