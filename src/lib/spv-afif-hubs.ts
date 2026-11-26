export type SpvAfifHubConfig = {
  slug: string;
  hmsHubId: string;
  name: string;
  shortName: string;
};

export const SPV_AFIF_HUBS = [
  { slug: "ciracas", hmsHubId: "294", name: "GTL Ciracas Hub", shortName: "CIRACAS" },
  { slug: "duren-sawit", hmsHubId: "272", name: "GTL Duren Sawit Hub", shortName: "DUREN SAWIT" },
  { slug: "jatinegara", hmsHubId: "460450593288", name: "GTL Jatinegara Hub", shortName: "JATINEGARA" },
  { slug: "kramatjati", hmsHubId: "303", name: "GTL Kramatjati Hub", shortName: "KRAMATJATI" },
  { slug: "matraman", hmsHubId: "460450593308", name: "GTL Matraman Hub", shortName: "MATRAMAN" },
  { slug: "pasar-rebo", hmsHubId: "460450593295", name: "GTL Pasar Rebo Hub", shortName: "PASAR REBO" },
  { slug: "pulogadung", hmsHubId: "275", name: "GTL Pulogadung Hub", shortName: "PULOGADUNG" },
  { slug: "senen", hmsHubId: "460450593312", name: "GTL Senen Hub", shortName: "SENEN" },
  { slug: "tanahabang", hmsHubId: "302", name: "GTL Tanahabang Hub", shortName: "TANAHABANG" },
] satisfies SpvAfifHubConfig[];

export function getSpvAfifHub(slug?: string | null): SpvAfifHubConfig | null {
  if (!slug) return null;
  return SPV_AFIF_HUBS.find((hub) => hub.slug === slug) ?? null;
}
