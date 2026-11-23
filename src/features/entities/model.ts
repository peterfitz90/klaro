// The entity model as the app sees it, and the checks the create form runs before calling the
// database. The database checks the same rules again (fpa.create_entity and the table's CHECK
// constraints); these only give a clearer message sooner.

export const JURISDICTIONS = ['IE', 'UK'] as const;
export const CURRENCIES = ['EUR', 'GBP'] as const;
export const ROLES = ['owner', 'editor', 'viewer'] as const;

export type Jurisdiction = (typeof JURISDICTIONS)[number];
export type Currency = (typeof CURRENCIES)[number];
export type Role = (typeof ROLES)[number];

export interface Entity {
  id: string;
  name: string;
  jurisdiction: Jurisdiction;
  currency: Currency;
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

/** The usual currency for a jurisdiction, used only as the form's starting choice. */
export function defaultCurrency(j: Jurisdiction): Currency {
  return j === 'UK' ? 'GBP' : 'EUR';
}

export interface CreateEntityInput {
  name: string;
  jurisdiction: string;
  currency: string;
  fiscalYearStart: number;
}

export interface CreateEntityArgs {
  name: string;
  jurisdiction: Jurisdiction;
  currency: Currency;
  fiscalYearStart: number;
}

export type FieldErrors = Partial<Record<keyof CreateEntityInput, string>>;

/** Returns the arguments to send, or the message for each field that is wrong. */
export function validateCreateEntity(input: CreateEntityInput): { ok: true; args: CreateEntityArgs } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const name = input.name.trim();
  if (name.length < 1 || name.length > 120) errors.name = 'Enter a name of 1 to 120 characters.';
  if (!(JURISDICTIONS as readonly string[]).includes(input.jurisdiction)) errors.jurisdiction = 'Choose Ireland or the United Kingdom.';
  if (!(CURRENCIES as readonly string[]).includes(input.currency)) errors.currency = 'Choose EUR or GBP.';
  if (!Number.isInteger(input.fiscalYearStart) || input.fiscalYearStart < 1 || input.fiscalYearStart > 12) {
    errors.fiscalYearStart = 'Choose the month the financial year starts.';
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    args: { name, jurisdiction: input.jurisdiction as Jurisdiction, currency: input.currency as Currency, fiscalYearStart: input.fiscalYearStart },
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An entity id from the URL is used only if it is a well-formed uuid. */
export function isEntityId(v: string | undefined): v is string {
  return typeof v === 'string' && UUID.test(v);
}

export function entityMeta(e: Pick<Entity, 'jurisdiction' | 'currency'>): string {
  return `${e.jurisdiction} · ${e.currency}`;
}
