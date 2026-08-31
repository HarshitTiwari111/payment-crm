/*
 * Every icon in the app, in one place.
 *
 * These were emoji before. Emoji render differently on every OS — different shapes,
 * different weights, some in full colour and some not — so a sidebar built from them
 * never looks like one set. These are real vector icons: they inherit the current
 * text colour, size with the font, and stay consistent everywhere.
 */
import React from "react";
import {
  FiBarChart2, FiDollarSign, FiCalendar, FiTrendingUp, FiGlobe, FiUser, FiGrid, FiSettings,
  FiActivity,
} from "react-icons/fi";
import {
  FiPlus, FiEdit2, FiTrash2, FiX, FiCheck, FiAlertTriangle, FiInfo,
  FiLock, FiChevronLeft, FiChevronRight, FiChevronDown, FiArrowLeft,
  FiEye, FiEyeOff, FiMenu, FiLogOut, FiMoon, FiSun, FiCornerDownRight,
  FiRotateCcw, FiSlash, FiCheckCircle,
} from "react-icons/fi";

/* ---------------------------------------------------------------- sidebar */

export const TAB_ICONS = {
  dashboard: FiBarChart2,
  payouts: FiDollarSign,
  calendar: FiCalendar,
  reports: FiTrendingUp,
  networks: FiGlobe,
  users: FiUser,
  verticals: FiGrid,
  log: FiActivity,
};

/** Render a tab's icon by id. */
export function TabIcon({ id, size = 17 }) {
  const Ico = TAB_ICONS[id] || FiSettings;
  return <Ico size={size} />;
}

/* ------------------------------------------------------------------ named */

export {
  FiPlus as IconAdd,
  FiEdit2 as IconEdit,
  FiTrash2 as IconDelete,
  FiX as IconClose,
  FiCheck as IconCheck,
  FiCheckCircle as IconReconcile,
  FiAlertTriangle as IconWarn,
  FiInfo as IconInfo,
  FiLock as IconLock,
  FiChevronLeft as IconPrev,
  FiChevronRight as IconNext,
  FiChevronDown as IconCaret,
  FiArrowLeft as IconArrowLeft,
  FiEye as IconEye,
  FiEyeOff as IconEyeOff,
  FiMenu as IconMenu,
  FiLogOut as IconLogout,
  FiMoon as IconMoon,
  FiSun as IconSun,
  FiCornerDownRight as IconCarry,
  FiRotateCcw as IconUndo,
  FiSlash as IconWriteOff,
  FiDollarSign as IconMoney,
  FiUser as IconUser,
};
