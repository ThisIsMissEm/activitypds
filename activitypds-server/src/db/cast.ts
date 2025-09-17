export type DateISO = `${string}T${string}Z`;
const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
export function toDateISO(date: Date) {
  return date.toISOString() as DateISO;
}
export function fromDateISO(dateStr: DateISO) {
  return new Date(dateStr);
}

/**
 * Allows to ensure that {@link JsonEncoded} is not used with non-JSON
 * serializable values (e.g. {@link Date} or {@link Function}s).
 */
export type Encodable =
  | string
  | number
  | boolean
  | Date
  | null
  | readonly Encodable[]
  | { readonly [_ in string]?: Encodable };

export type JsonString<T extends Encodable> = T extends readonly unknown[]
  ? `[${string}]`
  : T extends object
  ? `{${string}}`
  : T extends string
  ? `"${string}"`
  : T extends number
  ? `${number}`
  : T extends boolean
  ? `true` | `false`
  : T extends Date
  ? DateISO
  : T extends null
  ? `null`
  : never;

declare const jsonEncodedType: unique symbol;
export type JsonEncoded<T extends Encodable = Encodable> = JsonString<T> & {
  [jsonEncodedType]: T;
};

export function toJson<T extends Encodable>(value: T): JsonEncoded<T> {
  const json = JSON.stringify(value, (key: string, value: any) => {
    if (value instanceof Date) {
      return toDateISO(value);
    }
    return value;
  });
  if (json === undefined) throw new TypeError("Input not JSONifyable");
  return json as JsonEncoded<T>;
}

export function fromJson<T extends Encodable>(jsonStr: JsonEncoded<T>): T {
  try {
    return JSON.parse(jsonStr, (key, value) => {
      if (typeof value === "string" && isoDateRegex.test(value)) {
        return fromDateISO(value as DateISO);
      }
      return value;
    }) as T;
  } catch (cause) {
    throw new TypeError("Database contains invalid JSON", { cause });
  }
}
