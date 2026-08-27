/*
 * Request validation with Zod.
 *
 * The routes already re-check permissions on every call; this checks SHAPE — that
 * a month really looks like YYYY-MM, that an amount is a number and not a crafted
 * object, that a role is one of the two known strings. Anything unexpected is
 * rejected before it reaches a query, and the parsed (stripped) value replaces the
 * raw body, so a route can never accidentally read a field nobody validated.
 */
const { ZodError } = require("zod");

/**
 * validate({ body, params, query }) — any part may be omitted.
 * On failure returns 400 with the offending fields, so the client can point at them.
 */
function validate(schemas) {
  return (req, res, next) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
      if (schemas.params) req.params = { ...req.params, ...schemas.params.parse(req.params ?? {}) };
      if (schemas.query) {
        // req.query can be a getter-only property on newer Express; merge instead
        const parsed = schemas.query.parse(req.query ?? {});
        Object.keys(parsed).forEach((k) => { req.query[k] = parsed[k]; });
      }
      return next();
    } catch (e) {
      if (e instanceof ZodError) {
        return res.status(400).json({
          error: "invalid_input",
          fields: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        });
      }
      return next(e);
    }
  };
}

module.exports = { validate };
