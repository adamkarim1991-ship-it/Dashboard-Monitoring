export type OccHubConfig = {
  slug: string;
  hmsHubId: string;
  name: string;
  shortName: string;
  fmDistrict?: {
    key: string;
    label: string;
    districtIds: string;
  };
};

export const OCC_HUBS = {
  jatinegara: {
    slug: "jatinegara",
    hmsHubId: "460450593288",
    name: "GTL Jatinegara Hub",
    shortName: "JATINEGARA",
    fmDistrict: { key: "jatinegara", label: "Jatinegara", districtIds: "2293" },
  },
  "duren-sawit": {
    slug: "duren-sawit",
    hmsHubId: "272",
    name: "GTL Duren Sawit Hub",
    shortName: "DUREN SAWIT",
  },
} satisfies Record<string, OccHubConfig>;

export const DEFAULT_OCC_SLUG = "jatinegara";

export function getOccHub(slug?: string | null): OccHubConfig | null {
  if (!slug) return OCC_HUBS[DEFAULT_OCC_SLUG];
  return OCC_HUBS[slug as keyof typeof OCC_HUBS] ?? null;
}

export function getOccHubByHmsId(hmsHubId: string): OccHubConfig | null {
  return Object.values(OCC_HUBS).find((hub) => hub.hmsHubId === hmsHubId) ?? null;
}
