/** Injectable clock so retention/expiry jobs can be tested with the clock moved forward (UAT-31). */
let override: (() => Date) | null = null;

export function now(): Date {
  return override ? override() : new Date();
}

export function setClock(fn: (() => Date) | null) {
  override = fn;
}
