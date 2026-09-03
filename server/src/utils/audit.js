/*
 * Audit trail + Telegram.
 *
 * logAudit() is the single entry point: it writes the row AND pushes the message,
 * so nothing can be audited without also being announced (or vice-versa).
 * Telegram is fire-and-forget — a dead bot token must never fail a request.
 */
const Audit = require("../models/Audit");
const User = require("../models/User");
const { TG_TOKEN, TG_CHAT } = require("../config/env");

const TG_LABELS = {
  // accounts
  user_created: "👤 New account created",
  user_updated: "✏️ Account updated",
  user_deactivated: "🚫 Account deactivated",
  user_reactivated: "♻️ Account restored",
  password_reset: "🔑 Password reset by an admin",
  // taxonomy
  vertical_proposed: "🏷️ New vertical added",
  vertical_rejected: "🏷️ Vertical removed",
  subcategory_created: "🗂️ Sub-vertical created",
  // payments / receivables
  network_created: "🌐 Network added",
  network_updated: "✏️ Network updated",
  network_deleted: "🗑️ Network removed",
  payout_added: "💰 Payout created",
  payout_updated: "✏️ Payout updated",
  payout_deleted: "🗑️ Payout deleted",
  payout_reconciled: "🏦 Payment reconciled",
  payout_adjusted: "🧾 Reconciliation adjusted",
  payout_carry_created: "➡️ Carry-forward payout created",
  payout_writeoff: "⚠️ Payout written off",
  payout_overdue: "🔴 Payout OVERDUE",
  payout_verified: "✅ Payment confirmed received",
  payout_unverified: "↩️ Confirmation withdrawn",
  // security
  password_changed: "🔑 Password changed",
  sessions_revoked: "🚪 Signed out of all devices",
  twofactor_enabled: "🛡️ Two-factor turned on",
  twofactor_disabled: "⚠️ Two-factor turned OFF",
};

/*
 * The same actions again, without the emoji.
 *
 * TG_LABELS is written for a chat window, where an icon is the fastest way to tell
 * one line from the next. The Log screen has columns for that, and an emoji in a
 * table cell only fights the alignment — so the wording is shared and the decoration
 * is not. Anything missing here falls back to the raw action name, which is ugly but
 * never wrong.
 */
const ACTION_LABELS = {
  user_created: "Account created",
  user_updated: "Account updated",
  user_deactivated: "Account deactivated",
  user_reactivated: "Account restored",
  password_reset: "Password reset by an admin",
  vertical_proposed: "Vertical added",
  vertical_rejected: "Vertical removed",
  subcategory_created: "Sub-vertical created",
  network_created: "Network added",
  network_updated: "Network updated",
  network_deleted: "Network removed",
  payout_added: "Payout created",
  payout_updated: "Payout updated",
  payout_deleted: "Payout deleted",
  payout_reconciled: "Payment reconciled",
  payout_adjusted: "Reconciliation adjusted",
  payout_carry_created: "Carry-forward payout created",
  payout_writeoff: "Payout written off",
  payout_overdue: "Payout went overdue",
  payout_verified: "Payment confirmed received",
  payout_unverified: "Confirmation withdrawn",
  password_changed: "Password changed",
  sessions_revoked: "Signed out of all devices",
  twofactor_enabled: "Two-factor turned on",
  twofactor_disabled: "Two-factor turned OFF",
};

function notifyTelegram(text) {
  if (!TG_TOKEN || !TG_CHAT || !text) return;
  try {
    fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TG_CHAT, text, disable_web_page_preview: true }),
    }).catch(() => {});
  } catch (e) {
    /* never let notification failure break a request */
  }
}

async function tgMessage(actor, action, targetUserId, month, detail) {
  const head = TG_LABELS[action] || action;
  let target = "";
  try {
    if (targetUserId) {
      const u = await User.findOne({ id: Number(targetUserId) }).select("name").lean();
      if (u) target = u.name;
    }
  } catch (e) { /* ignore */ }
  let msg = head + "\n👤 By: " + (actor && actor.name ? actor.name : "system");
  if (target && target !== (actor && actor.name)) msg += "\n🎯 For: " + target;
  if (month) msg += "\n📅 Month: " + month;
  if (detail) msg += "\n📋 " + detail;
  return msg;
}

/**
 * Record an action and announce it.
 * Never throws — auditing must not be able to fail the operation it describes.
 */
async function logAudit(actor, action, targetUserId, month, detail) {
  try {
    await Audit.create({
      actorId: actor ? actor.id : null,
      actorName: actor ? actor.name : "system",
      action,
      targetUserId: targetUserId || null,
      month: month || null,
      detail: detail || "",
    });
    notifyTelegram(await tgMessage(actor, action, targetUserId, month, detail));
  } catch (e) {
    console.error("audit failed:", e.message);
  }
}

module.exports = { logAudit, notifyTelegram, TG_LABELS, ACTION_LABELS };
