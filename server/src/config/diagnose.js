/*
 * Turning a driver error into the thing you actually have to go and fix.
 *
 * A failed connection is nearly always one of four things, and the driver names
 * none of them: "bad auth : authentication failed" does not mention that the
 * password may simply have been rotated somewhere else. On a hosting dashboard,
 * where the fix is three clicks away in another tab, saying which one it is saves
 * the whole guessing round.
 *
 * The URI is read but never echoed — it carries the password.
 */

/** The password segment of a connection string, or "" if there is none. */
function passwordIn(uri) {
  const m = String(uri || "").match(/^mongodb(?:\+srv)?:\/\/[^:@/]+:([^@]*)@/);
  return m ? m[1] : "";
}

/**
 * A hint for a connection failure, or "" when there is nothing useful to add.
 * `message` is the driver's error message; `uri` the connection string it used.
 */
function diagnoseConnection(message, uri) {
  const msg = String(message || "");
  const pw = passwordIn(uri);

  // thrown while parsing, before any packet goes out: a half-encoded password
  if (/URI malformed|Invalid scheme|Invalid connection string/i.test(msg)) {
    return [
      "  MONGODB_URI could not be parsed.",
      "  Usually a password holding @ : / ? # or [ ] that was pasted without",
      "  percent-encoding, or a % that is not followed by two hex digits.",
    ].join("\n");
  }

  if (/bad auth|Authentication failed|AuthenticationFailed/i.test(msg)) {
    const lines = ["  MongoDB rejected the username or password in MONGODB_URI."];
    if (/^<.*>$/.test(pw)) {
      lines.push("  It still carries the placeholder <password> — put the real one there.");
    } else if (/%(?![0-9a-fA-F]{2})/.test(pw)) {
      lines.push("  Its password has a stray % — the percent-encoding looks half-done.");
    } else {
      lines.push("  Check it against Atlas → Database Access. Two usual causes:");
      lines.push("    · the password was rotated and this copy was not updated");
      lines.push("    · it holds @ : / ? # or [ ] and was pasted without percent-encoding");
    }
    return lines.join("\n");
  }

  if (/ECONNREFUSED|ServerSelection|querySrv|ENOTFOUND|ETIMEDOUT/i.test(msg)) {
    return [
      "  MongoDB is not reachable.",
      "  Local: start a mongod, or use `npm run dev:memory`.",
      "  Atlas: add this host to Network Access — a cloud host has no fixed IP,",
      "         so it needs 0.0.0.0/0 there. Check the cluster address too.",
    ].join("\n");
  }

  // a user that authenticated but may not be allowed near this database
  if (/not authorized|Unauthorized/i.test(msg)) {
    return [
      "  The account signed in but is not allowed to use that database.",
      "  Atlas → Database Access → this user → give it readWrite on the database",
      "  named at the end of MONGODB_URI.",
    ].join("\n");
  }

  return "";
}

module.exports = { diagnoseConnection, passwordIn };
