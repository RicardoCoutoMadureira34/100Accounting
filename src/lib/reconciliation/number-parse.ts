// Conversão de valores e datas vindos de folhas de cálculo/CSV. Tudo em
// código: o modelo só diz QUE formato usa a folha, nunca converte valores.

export type NumberFormat = "comma_decimal" | "dot_decimal";

const CURRENCY_OR_LETTERS = /(eur|euro|euros|€|\$|usd|us\$)/gi;

// "1.234,56", "1 234,56", "-1234.56", "7.90-", "(12,50)", "+15" -> número
// (null se não for um valor). `hint` desfaz a ambiguidade de "1.234" e "1,234".
export function parseAmount(input: string | number | null | undefined, hint: NumberFormat = "comma_decimal"): number | null {
  if (input == null) return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;

  let s = input
    .replace(/[    ]/g, " ")
    .replace(CURRENCY_OR_LETTERS, "")
    .trim();
  if (s === "" || s === "-" || s === "–") return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/[−–]/g, "-");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1).trim();
  } else if (s.startsWith("+")) {
    s = s.slice(1).trim();
  }
  if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1).trim();
  } else if (s.endsWith("+")) {
    s = s.slice(0, -1).trim();
  }

  s = s.replace(/\s+/g, "");
  if (!/^\d[\d.,]*$/.test(s) && !/^[.,]\d+$/.test(s)) return null;

  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;
  let normalized: string;

  if (dots > 0 && commas > 0) {
    // O último separador é o decimal; o outro é de milhares.
    const decimal = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ",";
    const thousands = decimal === "." ? "," : ".";
    normalized = s.split(thousands).join("").replace(decimal, ".");
  } else if (dots > 0 || commas > 0) {
    const sep = dots > 0 ? "." : ",";
    const count = dots > 0 ? dots : commas;
    const parts = s.split(sep);
    const last = parts[parts.length - 1];
    if (count > 1) {
      // Vários separadores iguais: só podem ser milhares ("1.234.567").
      normalized = parts.join("");
    } else if (last.length === 3 && parts[0].length >= 1) {
      // "1.234": milhares ou decimal? Decide o formato indicado.
      const sepIsThousands = (sep === "." && hint === "comma_decimal") || (sep === "," && hint === "dot_decimal");
      normalized = sepIsThousands ? parts.join("") : `${parts[0]}.${last}`;
    } else {
      normalized = `${parts[0] === "" ? "0" : parts[0]}.${last}`;
    }
  } else {
    normalized = s;
  }

  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

// ---------- datas ----------

export type DateFormat = "dmy" | "mdy" | "ymd" | "excel_serial";

export function normalizeDateFormat(value: string | null | undefined): DateFormat {
  const v = (value ?? "").toLowerCase();
  if (v.includes("serial")) return "excel_serial";
  if (v.startsWith("y")) return "ymd";
  if (v.startsWith("m")) return "mdy";
  return "dmy";
}

export function normalizeNumberFormat(value: string | null | undefined): NumberFormat {
  return (value ?? "").toLowerCase().startsWith("dot") ? "dot_decimal" : "comma_decimal";
}

// Número de série do Excel (dias desde 1899-12-30) -> YYYY-MM-DD.
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function isoOrNull(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Converte o conteúdo de uma célula de data. `defaultYear` serve para datas
// sem ano ("07.01"); aceita ISO, compactas (20260107) e números de série.
export function parseDateCell(input: string | number | null | undefined, format: DateFormat, defaultYear?: number): string | null {
  if (input == null) return null;

  if (typeof input === "number") return excelSerialToIso(input);

  const s = input.replace(/[ \s]+/g, " ").trim();
  if (s === "") return null;

  // Já em ISO (com ou sem hora)
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) return isoOrNull(Number(m[1]), Number(m[2]), Number(m[3]));

  // Só dígitos: número de série do Excel ou data compacta
  if (/^\d+$/.test(s)) {
    if (s.length === 8) {
      const a = Number(s.slice(0, 4));
      if (a > 1900) return isoOrNull(a, Number(s.slice(4, 6)), Number(s.slice(6, 8)));
      return isoOrNull(Number(s.slice(4, 8)), Number(s.slice(2, 4)), Number(s.slice(0, 2)));
    }
    return excelSerialToIso(Number(s));
  }

  // Ano à frente: AAAA/MM/DD, AAAA.MM.DD
  m = /^(\d{4})[/.\- ](\d{1,2})[/.\- ](\d{1,2})$/.exec(s);
  if (m) return isoOrNull(Number(m[1]), Number(m[2]), Number(m[3]));

  // Com ano atrás: DD/MM/AAAA (ou MM/DD/AAAA), ano de 2 ou 4 dígitos
  m = /^(\d{1,2})[/.\- ](\d{1,2})[/.\- ](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const first = Number(m[1]);
    const second = Number(m[2]);
    let year = Number(m[3]);
    if (m[3].length === 2) year += 2000;
    const [d, mo] = format === "mdy" ? [second, first] : [first, second];
    return isoOrNull(year, mo, d);
  }

  // Sem ano: DD.MM ou DD/MM
  m = /^(\d{1,2})[/.\-](\d{1,2})$/.exec(s);
  if (m && defaultYear) {
    const first = Number(m[1]);
    const second = Number(m[2]);
    const [d, mo] = format === "mdy" ? [second, first] : [first, second];
    return isoOrNull(defaultYear, mo, d);
  }

  return null;
}
