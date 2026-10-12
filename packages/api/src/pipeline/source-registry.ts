/**
 * Tier-1 sources (issue #4): German authorities and independent consumer organisations per field.
 * Code-reviewed on purpose — changing who counts as authoritative should go through a PR.
 */
export interface RegistryHost {
  host: string
  publisher: string
}

export interface FieldSources {
  /** Europe PMC reviews are useful for this field */
  scholarly: boolean
  hosts: RegistryHost[]
}

const gesundheitsinformation = { host: 'gesundheitsinformation.de', publisher: 'IQWiG – gesundheitsinformation.de' }
const gesundBund = { host: 'gesund.bund.de', publisher: 'Bundesministerium für Gesundheit – gesund.bund.de' }
const verbraucherzentrale = { host: 'verbraucherzentrale.de', publisher: 'Verbraucherzentrale' }
const wikipedia = { host: 'wikipedia.org', publisher: 'Wikipedia' }
const oerCommons = { host: 'oercommons.org', publisher: 'OER Commons' }

export const SOURCE_REGISTRY: Record<string, FieldSources> = {
  nutrition: {
    scholarly: true,
    hosts: [
      { host: 'dge.de', publisher: 'Deutsche Gesellschaft für Ernährung (DGE)' },
      { host: 'bzfe.de', publisher: 'Bundeszentrum für Ernährung (BZfE)' },
      gesundheitsinformation,
      verbraucherzentrale,
      { host: 'bfr.bund.de', publisher: 'Bundesinstitut für Risikobewertung (BfR)' },
      { host: 'mri.bund.de', publisher: 'Max Rubner-Institut' },
      gesundBund,
      wikipedia,
      oerCommons,
    ],
  },
  partnership: {
    scholarly: false,
    hosts: [
      { host: 'familienportal.de', publisher: 'Familienportal des Bundes' },
      { host: 'profamilia.de', publisher: 'pro familia' },
      { host: 'liebesleben.de', publisher: 'LIEBESLEBEN' },
      gesundheitsinformation,
      wikipedia,
      oerCommons,
    ],
  },
  finance: {
    scholarly: false,
    hosts: [
      verbraucherzentrale,
      { host: 'test.de', publisher: 'Stiftung Warentest' },
      { host: 'finanztip.de', publisher: 'Finanztip' },
      { host: 'bafin.de', publisher: 'BaFin' },
      { host: 'bundesbank.de', publisher: 'Deutsche Bundesbank' },
      { host: 'bundesfinanzministerium.de', publisher: 'Bundesministerium der Finanzen' },
      { host: 'deutsche-rentenversicherung.de', publisher: 'Deutsche Rentenversicherung' },
      wikipedia,
      oerCommons,
    ],
  },
  sports: {
    scholarly: true,
    hosts: [
      { host: 'dshs-koeln.de', publisher: 'Deutsche Sporthochschule Köln' },
      { host: 'dosb.de', publisher: 'Deutscher Olympischer Sportbund' },
      { host: 'dgsp.de', publisher: 'Deutsche Gesellschaft für Sportmedizin und Prävention' },
      gesundheitsinformation,
      gesundBund,
      wikipedia,
      oerCommons,
    ],
  },
  psychology: {
    scholarly: true,
    hosts: [
      gesundheitsinformation,
      { host: 'neurologen-und-psychiater-im-netz.org', publisher: 'Neurologen und Psychiater im Netz' },
      { host: 'dgps.de', publisher: 'Deutsche Gesellschaft für Psychologie' },
      { host: 'bptk.de', publisher: 'Bundespsychotherapeutenkammer' },
      { host: 'dgppn.de', publisher: 'DGPPN' },
      wikipedia,
      oerCommons,
    ],
  },
  funfacts: {
    scholarly: true,
    hosts: [
      { host: 'mpg.de', publisher: 'Max-Planck-Gesellschaft' },
      { host: 'nasa.gov', publisher: 'NASA' },
      { host: 'esa.int', publisher: 'European Space Agency (ESA)' },
      { host: 'nationalarchives.gov.uk', publisher: 'The National Archives (UK)' },
      { host: 'nhm-wien.ac.at', publisher: 'Naturhistorisches Museum Wien' },
      { host: 'fs.usda.gov', publisher: 'US Forest Service (USDA)' },
      wikipedia,
      oerCommons,
    ],
  },
  work: {
    scholarly: false,
    hosts: [
      { host: 'bmas.de', publisher: 'Bundesministerium für Arbeit und Soziales (BMAS)' },
      { host: 'arbeitsagentur.de', publisher: 'Bundesagentur für Arbeit' },
      { host: 'baua.de', publisher: 'Bundesanstalt für Arbeitsschutz und Arbeitsmedizin (BAuA)' },
      { host: 'iab.de', publisher: 'Institut für Arbeitsmarkt- und Berufsforschung (IAB)' },
      { host: 'destatis.de', publisher: 'Statistisches Bundesamt' },
      { host: 'dguv.de', publisher: 'Deutsche Gesetzliche Unfallversicherung (DGUV)' },
      wikipedia,
      oerCommons,
    ],
  },
}

/** Exact host or any subdomain of it (www., ernaehrung. …) — never a lookalike like notdge.de */
export function hostMatches(url: string, host: string): boolean {
  let hostname: string
  try {
    hostname = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  return hostname === host || hostname.endsWith(`.${host}`)
}

export function registryHostFor(url: string, fieldSlug: string): RegistryHost | null {
  return SOURCE_REGISTRY[fieldSlug]?.hosts.find((h) => hostMatches(url, h.host)) ?? null
}
