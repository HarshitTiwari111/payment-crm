/*
 * The shapes every write must match.
 *
 * Kept in one file so the rules are comparable side by side — a month is a month
 * everywhere, an amount is bounded everywhere. `.strip()` on the objects means
 * unknown keys are dropped rather than passed through to a document.
 */
const { z } = require("zod");
const { clean } = require("../utils/sanitize");

/* ------------------------------------------------------------- primitives */

/** Free text: markup stripped, length capped. */
const text = (max = 500) => z.any().transform((v) => clean(v, max));
const requiredText = (max = 200, label = "This") =>
  text(max).refine((v) => v.length > 0, { message: `${label} is required.` });

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a YYYY-MM month.");
const optionalMonth = z.union([month, z.literal("")]).optional();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.");
const optionalDate = z.union([isoDate, month, z.literal("")]).optional();

/**
 * Money. Bounded on both ends: a negative expected amount is meaningless, and the
 * ceiling stops a typo (or a script) writing a number that breaks every total it
 * is ever summed into.
 */
const amount = z.coerce.number().finite().min(0).max(1e12);
const signedAmount = z.coerce.number().finite().min(-1e12).max(1e12);

const role = z.enum(["admin", "manager"]);
const idNum = z.coerce.number().int().positive();

const stringArray = (max = 60) =>
  z.union([z.array(z.any()), z.string(), z.null(), z.undefined()])
    .transform((v) => {
      if (Array.isArray(v)) return v.map((x) => clean(x, max)).filter(Boolean);
      const s = clean(v, max);
      return s ? [s] : [];
    });

/* ------------------------------------------------------------------ auth */

const login = z.object({
  username: z.string().min(1, "Username is required.").max(64).transform((v) => v.trim().toLowerCase()),
  password: z.string().min(1, "Password is required.").max(200),
  /*
   * Wide enough for BOTH second factors: a 6-digit TOTP code and a 10-character
   * recovery code. Pinning this to /^\d{6}$/ would have rejected every recovery
   * code before it ever reached the check — locking out exactly the person who
   * had lost their phone and needed it.
   */
  totp: z.string().trim().min(6).max(32).optional()
    .or(z.literal("").transform(() => undefined)),
}).strip();

/*
 * Passwords: a floor of 8 with some variety. Short enough that nobody writes it on
 * a sticky note, long enough that a leaked hash is not trivially reversible. The
 * upper bound matters too — bcrypt silently ignores anything past 72 bytes, so a
 * longer "password" would give a false sense of strength.
 */
const strongPassword = z.string()
  .min(8, "Use at least 8 characters.")
  .max(72, "Passwords are limited to 72 characters.")
  .refine((v) => /[a-z]/i.test(v), { message: "Include at least one letter." })
  .refine((v) => /\d/.test(v) || /[^A-Za-z0-9]/.test(v), { message: "Include a number or a symbol." });

const changePassword = z.object({
  current: z.string().min(1, "Enter your current password.").max(200),
  next: strongPassword,
}).strip();

const setPassword = z.object({ password: strongPassword }).strip();

const totpCode = z.object({
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code."),
}).strip();

/* ----------------------------------------------------------------- users */

const createUser = z.object({
  username: z.string().min(3, "At least 3 characters.").max(40)
    .regex(/^[a-zA-Z0-9._-]+$/, "Letters, numbers, dot, dash and underscore only.")
    .transform((v) => v.toLowerCase()),
  password: strongPassword,
  name: requiredText(80, "Display name"),
  role: role.optional(),
  vertical: text(60).optional(),
  verticals: stringArray().optional(),
}).strip();

const updateUser = createUser
  .omit({ username: true, password: true })
  .extend({ name: requiredText(80, "Display name") })
  .partial({ role: true, vertical: true })
  .strip();

/* -------------------------------------------------------------- taxonomy */

const verticalName = z.object({ name: requiredText(60, "Vertical name") }).strip();
const subcategory = z.object({
  name: requiredText(60, "Name"),
  vertical: text(60).optional(),
}).strip();

/* --------------------------------------------------------------- payouts */

const createPayout = z.object({
  campaign: text(120).optional(),
  network: requiredText(80, "Network"),
  vertical: text(60).optional(),
  // the sub-vertical inside that vertical; blank is a real answer, not a missing one
  subcategory: text(60).optional(),
  earnedMonth: month,
  amountExpected: amount.refine((v) => v > 0, { message: "Enter the amount owed." }),
  // the spend side, and the row this came from when it came from a sheet
  adCost: amount.optional(),
  overallRevenue: amount.optional(),
  externalId: text(120).optional(),
  expectedDate: optionalDate,
  netTerms: z.union([z.coerce.number().int().min(0).max(365), z.null(), z.literal("")]).optional(),
  currency: z.string().max(4).optional(),
  /*
   * How it will be paid. One value, never a set — the three are alternatives, and
   * an empty string is the honest answer for "not decided yet". `payAccount` is
   * whatever that method identifies (bank name, PayPal id, wallet id); it is a
   * label to pay against, not a credential, so it is cleaned like any other text.
   */
  payMethod: z.enum(["", "bank", "paypal", "crypto"]).optional(),
  payAccount: text(200).optional(),
  note: text(500).optional(),
}).strip();

const updatePayout = createPayout.partial().strip();

const reconcile = z.object({
  date: optionalDate,
  amountReceived: amount.optional(),
  deduction: amount.optional(),
  deductionReason: z.enum(["", "validation", "scrub", "chargeback", "fx", "other"]).optional(),
  carriedForward: amount.optional(),
  carriedToMonth: optionalMonth,
  note: text(500).optional(),
}).strip();

/*
 * An adjustment is the one place a negative figure is correct — reversing an
 * entry that was recorded wrongly is exactly what it is for.
 */
const adjust = z.object({
  txnId: idNum,
  date: optionalDate,
  amountReceived: signedAmount.optional(),
  deduction: signedAmount.optional(),
  /*
   * The same correction stated as the figure it should have been, rather than the
   * difference from what it was — see adjust() for why both exist. Unsigned: these
   * are totals, and a total received is never below zero.
   */
  setReceived: amount.optional(),
  setDeduction: amount.optional(),
  // the date this entry should have carried; it moves the entry rather than posting one
  setDate: optionalDate,
  deductionReason: z.enum(["", "validation", "scrub", "chargeback", "fx", "other"]).optional(),
  carriedForward: signedAmount.optional(),
  carriedToMonth: optionalMonth,
  note: text(500).optional(),
}).strip();

const writeoff = z.object({ reason: text(500).optional() }).strip();

const network = z.object({
  name: requiredText(80, "Name"),
  netTerms: z.coerce.number().int().min(0).max(365).optional(),
  defaultCurrency: z.string().max(4).optional(),
  contact: text(200).optional(),
  note: text(500).optional(),
  active: z.coerce.boolean().optional(),
}).strip();

const networkUpdate = network.partial().strip();

const campaign = z.object({
  name: requiredText(120, "Name"),
  vertical: text(60).optional(),
}).strip();

/* ----------------------------------------------------------------- params */

const idParam = z.object({ id: z.coerce.number().int().positive() });

/*
 * Networks and refresh tokens are keyed by Mongo's own _id rather than the
 * auto-increment number the rest of the app uses, so they need their own shape.
 * Handing mongoose a string it cannot cast raised inside the driver and surfaced
 * as a 500; a 24-character hex check answers it as the bad request it is.
 */
const objectIdParam = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, "Not a valid id.") });

module.exports = {
  login, changePassword, setPassword, totpCode, strongPassword,
  createUser, updateUser,
  verticalName, subcategory,
  createPayout, updatePayout, reconcile, adjust, writeoff,
  network, networkUpdate, campaign,
  idParam, objectIdParam,
  z,
};
