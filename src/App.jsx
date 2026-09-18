import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabaseClient";
import { saveCache, loadCache, getQueue, enqueueAction, removeFromQueue, queueCount } from "./offlineStore";
import {
  LayoutGrid, CalendarDays, Users, MessageSquareText, Wrench,
  Radio, Wallet, Building2, ChevronDown, ChevronUp, Plus, X, Check, Bell, Menu, Shield,
  Bed, BedSingle, BedDouble, Sparkles, Crown, Moon, Sun,
  UtensilsCrossed, ShoppingBag, Shirt, ImageOff, Upload, Pencil, ArrowUp, Home, Phone
} from "lucide-react";

/* ---------------------------------------------------------
   Design tokens — "front desk, after hours" visual identity
   Ink navy + warm clay + a teal "signal" color reserved only
   for NFC tap moments, so the tap interaction reads as the
   one electrified accent against an otherwise calm palette.
--------------------------------------------------------- */
const C = {
  ink: "#16233B",
  inkSoft: "#3A4459",
  paper: "#F6F3ED",
  paperRaised: "#FFFFFF",
  line: "#E4DFD3",
  clay: "#B5673A",
  clayDeep: "#8F4E2A",
  signal: "#2F9E96",
  signalSoft: "#DCEFEC",
  amber: "#C79A3D",
  red: "#B24C4C",
};

const FONTS = (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Work+Sans:wght@400;500;600&display=swap');
    .fr { font-family: 'Fraunces', serif; }
    .ws { font-family: 'Work Sans', sans-serif; }
    @keyframes ripple {
      0% { box-shadow: 0 0 0 0 rgba(47,158,150,0.45); }
      100% { box-shadow: 0 0 0 22px rgba(47,158,150,0); }
    }
    .tap-ripple { animation: ripple 1s ease-out; }
  `}</style>
);

/* ---------------------------------------------------------
   Branches, clients, services, bookings, invoices, inquiries,
   and tags now live in Supabase. These mapper functions convert
   a DB row (snake_case) into the camelCase shape the rest of
   this file already works with, so the UI code below didn't
   need to change.
--------------------------------------------------------- */
const mapBranch = (r) => ({ id: r.id, name: r.name, location: r.location });
const mapClient = (r) => ({ id: r.id, branchId: r.branch_id, name: r.name, phone: r.phone, idType: r.id_type || null, idNumber: r.id_number || null });
const mapService = (r) => ({ id: r.id, branchId: r.branch_id, name: r.name, price: r.price, category: r.category, billingUnit: r.billing_unit || "flat", imageUrl: r.image_url || null, isAvailable: r.is_available !== false });
const mapBooking = (r) => ({ id: r.id, branchId: r.branch_id, clientId: r.client_id, serviceIds: r.service_ids || [], checkIn: r.check_in, checkOut: r.check_out, checkInTime: r.check_in_time || null, checkOutTime: r.check_out_time || null, status: r.status, roomNumber: r.room_number || "", roomId: r.room_id || null, isTemporary: r.is_temporary || false });
const mapInvoice = (r) => ({ id: r.id, branchId: r.branch_id, bookingId: r.booking_id, amount: r.amount, status: r.status, paidAt: r.paid_at || null });
// A payment row is one payment OR refund event against a booking's invoice —
// amount is positive for a payment, negative for a refund, so a plain sum
// across a booking's rows is always the true amount collected so far.
const mapPayment = (r) => ({ id: r.id, branchId: r.branch_id, bookingId: r.booking_id, amount: Number(r.amount) || 0, kind: r.kind || "payment", note: r.note || null, paidAt: r.paid_at, recordedBy: r.recorded_by || null });
const mapExpense = (r) => ({ id: r.id, branchId: r.branch_id, description: r.description, amount: Number(r.amount) || 0, createdAt: r.created_at });
const mapInquiry = (r) => ({ id: r.id, branchId: r.branch_id, clientId: r.client_id, message: r.message, status: r.status });
const mapTag = (r) => ({ id: r.id, branchId: r.branch_id, label: r.label, type: r.type, linkedName: r.linked_name, lastScan: r.last_scan });
const mapRoom = (r) => ({ id: r.id, branchId: r.branch_id, roomNumber: r.room_number, roomType: r.room_type });
const mapRoomRate = (r) => ({ branchId: r.branch_id, roomType: r.room_type, nightlyRate: Number(r.nightly_rate) || 0 });
const mapSubscriber = (r) => ({ id: r.id, name: r.name, tier: r.tier, branches: r.branches, activeBookings: r.active_bookings, subStatus: r.sub_status, mrr: r.mrr });

const TIER_OPTIONS = ["Essentials", "Growth", "Full Suite"];

// Services in these categories are guest self-serve requests (ordered from
// the Guest portal after check-in), not line items a client picks at booking time.
const GUEST_REQUEST_CATEGORIES = ["Amenities", "Kitchen", "Counter", "Laundry"];

const ID_TYPE_OPTIONS = ["NIDA", "Voting ID", "Driving License", "Passport"];

// Kitchen/Counter requests go through a richer, multi-step timeline (the guest
// is waiting on something being prepared, so "where is it" genuinely matters).
// Everything else — Amenities, Laundry, free-text messages, airtime — uses a
// single-tap "handled → received" loop, since the journey is short enough that
// extra stages wouldn't add real information.
const RICH_STAGE_CATEGORIES = ["Kitchen", "Counter"];
const RICH_STAGES = ["sent", "preparing", "delivered", "confirmed"];
const SIMPLE_STAGES = ["sent", "handled", "received"];
const RICH_STAGE_LABELS = { sent: "Sent", preparing: "Preparing", delivered: "Delivered", confirmed: "Confirmed" };
const SIMPLE_STAGE_LABELS = { sent: "Sent", handled: "Handled", received: "Received" };

// Generates a client's real id up front instead of waiting on a DB round-trip
// so an offline-queued insert doesn't need a follow-up read — which matters
// now that direct client reads are owner-only (see get_clients() in Supabase).
function newId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

/* Guest access codes and service requests also live in Supabase —
   see src/supabaseClient.js. This makes a code generated on one
   device actually work when a guest enters it on a different device. */

const INQUIRY_STAGES = ["new", "quoted", "confirmed", "completed"];
const money = (n) => "TSh " + n.toLocaleString();

function nightsBetween(checkIn, checkOut) {
  if (!checkIn || !checkOut || checkIn === "TBC" || checkOut === "TBC") return 1;
  const inD = new Date(checkIn);
  const outD = new Date(checkOut);
  const diff = Math.round((outD - inD) / 86400000);
  return diff > 0 ? diff : 1;
}

// "10/09-12/09" — day/month numerals on both ends; no year (day-to-day staff
// work doesn't need it, and dropping it shortens the column). Split out from
// formatDuration so the Bookings table can pair it with an icon instead of
// the word "night(s)" while other surfaces (client history, printed invoice)
// keep the plain-text version.
function formatDateRange(checkIn, checkOut) {
  const short = (d) => {
    const dt = new Date(d);
    const dd = String(dt.getDate()).padStart(2, "0");
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}`;
  };
  const inLabel = checkIn && checkIn !== "TBC" ? short(checkIn) : (checkIn || "TBC");
  const outLabel = checkOut && checkOut !== "TBC" ? short(checkOut) : (checkOut || "TBC");
  return `${inLabel}-${outLabel}`;
}

// "10/09-12/09 (2 nights)" — spells the night count out in words, for places
// that just need plain text (client history, printed invoice).
function formatDuration(checkIn, checkOut) {
  const range = formatDateRange(checkIn, checkOut);
  if (!checkIn || !checkOut || checkIn === "TBC" || checkOut === "TBC") return range;
  const nights = nightsBetween(checkIn, checkOut);
  return `${range} (${nights} night${nights === 1 ? "" : "s"})`;
}

// Temporary stay (day-use) rules: a flat rate regardless of how many of the
// allowed hours are used, sold only against Single/Deluxe rooms, inside a
// fixed 6am-6pm window, capped at 5 hours. Going over the cap converts the
// booking back to a regular overnight stay rather than blocking the save —
// see resolveBookingType below.
const TEMP_STAY = {
  rate: 10000,
  maxHours: 5,
  windowHours: 12, // 6am-6pm
  eligibleRoomTypes: ["single", "deluxe"],
};

function isRoomEligibleForTemporaryStay(room) {
  if (!room) return false;
  const t = (room.roomType || "").toLowerCase();
  return TEMP_STAY.eligibleRoomTypes.some((et) => t.includes(et));
}

// Hours between two "HH:MM" clock times on the same day. Returns null when
// either time is missing, since "0 hrs" would misleadingly read as a real
// zero-length stay rather than "not entered yet".
function hoursBetweenTimes(startTime, endTime) {
  if (!startTime || !endTime) return null;
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return null;
  const mins = (eh * 60 + em) - (sh * 60 + sm);
  return mins > 0 ? Math.round((mins / 60) * 10) / 10 : null;
}

// Applied right before a temporary-stay booking is saved (and whenever its
// times change while the modal is open): if the guest ends up booked for
// longer than the 5-hour cap, the booking silently would have undercharged
// them at the flat day-use rate — so it converts back to a regular overnight
// booking instead, priced at the room's normal nightly rate. The caller is
// responsible for showing the inline notice this implies.
function resolveBookingType(bookingType, checkInTime, checkOutTime) {
  if (bookingType !== "temporary") return { type: bookingType, converted: false };
  const hrs = hoursBetweenTimes(checkInTime, checkOutTime);
  if (hrs != null && hrs > TEMP_STAY.maxHours) {
    return { type: "overnight", converted: true };
  }
  return { type: "temporary", converted: false };
}

// A room is unavailable for a proposed stay if it overlaps an existing,
// still-active booking on that same room — "completed" (whether a stay
// finished naturally or was checked out early because it fell through)
// frees the room immediately, matching how the Dashboard's room grid
// already treats it. A booking whose check-in equals its check-out never
// occupies the room overnight, so it's excluded on both sides.
function isRoomAvailable(roomId, checkIn, checkOut, existingBookings, excludeBookingId) {
  if (!roomId || !checkIn || !checkOut || checkIn === "TBC" || checkOut === "TBC") return true;
  if (checkIn === checkOut) return true;
  const newIn = new Date(checkIn).getTime();
  const newOut = new Date(checkOut).getTime();
  return !existingBookings.some((b) => {
    if (b.id === excludeBookingId) return false;
    if (b.roomId !== roomId) return false;
    if (b.status === "completed") return false;
    if (!b.checkIn || !b.checkOut || b.checkIn === "TBC" || b.checkOut === "TBC") return false;
    if (b.checkIn === b.checkOut) return false;
    const bIn = new Date(b.checkIn).getTime();
    const bOut = new Date(b.checkOut).getTime();
    return newIn < bOut && bIn < newOut; // classic range overlap
  });
}

// Looks up the nightly rate for a room's type at a branch. Every room of the
// same type at the same branch shares one rate — the room dropdown is the
// only place accommodation price comes from now, there's no separate checkbox.
const FAILED_ACTION_LABELS = {
  addClient: "Adding a client",
  addBooking: "Creating a booking",
  updateBookingStatus: "Updating a booking's status",
  updateInquiryStatus: "Updating an inquiry",
  tapTag: "An NFC tap",
  addInvoice: "Creating an invoice",
  updateInvoiceStatus: "Updating an invoice",
  updateInvoiceAmount: "Updating an invoice amount",
  editBooking: "Editing a booking",
  deleteBooking: "Deleting a booking",
  deleteClient: "Deleting a client",
  addExpense: "Adding an expense",
  addPayment: "Recording a payment",
};

function rateForRoom(room, roomRates) {
  if (!room) return 0;
  const match = roomRates.find((rr) => rr.branchId === room.branchId && rr.roomType === room.roomType);
  return match ? match.nightlyRate : 0;
}

// Today's date as "YYYY-MM-DD", matching how check_in/check_out are stored.
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Builds the calendar grid for the guest's stay: one row per calendar week
// (Sun–Sat) the stay touches, so a stay crossing a week boundary just gets
// a second row rather than needing a different layout. Returns null if the
// dates aren't real (TBC, missing).
function buildStayCalendar(checkInStr, checkOutStr) {
  if (!checkInStr || !checkOutStr || checkInStr === "TBC" || checkOutStr === "TBC") return null;
  const checkIn = new Date(checkInStr + "T00:00:00");
  const checkOut = new Date(checkOutStr + "T00:00:00");
  if (isNaN(checkIn) || isNaN(checkOut)) return null;

  const startOfWeek = (d) => {
    const copy = new Date(d);
    copy.setDate(copy.getDate() - copy.getDay());
    return copy;
  };
  const gridStart = startOfWeek(checkIn);
  const lastWeekStart = startOfWeek(checkOut);
  const gridEnd = new Date(lastWeekStart);
  gridEnd.setDate(gridEnd.getDate() + 6);

  const days = [];
  const cursor = new Date(gridStart);
  while (cursor <= gridEnd) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return { weeks, checkIn, checkOut };
}

// A booking counts as occupying its room on a given date if that date falls
// within its stay AND it hasn't been marked completed yet — completed means
// "no longer active" regardless of what the original checkout date says
// (an early checkout is completed today even if it was booked through next
// week), so this naturally excludes rooms that were vacated ahead of plan.
function isBookingActiveOn(booking, dateStr) {
  if (!booking || booking.status === "completed") return false;
  if (!booking.checkIn || !booking.checkOut || booking.checkIn === "TBC" || booking.checkOut === "TBC") return false;
  return booking.checkIn <= dateStr && dateStr <= booking.checkOut;
}

// The single source of truth for what a booking should cost: room rate ×
// nights, plus any selected add-on services. Used wherever an invoice amount
// needs computing — at creation, when a still-pending/unpaid booking is
// edited, and as a fallback if a booking somehow reaches "confirmed" without
// an invoice yet (e.g. it was created while offline).
function computeInvoiceAmount(booking, roomsList, roomRatesList, servicesList) {
  const nights = nightsBetween(booking.checkIn, booking.checkOut);
  const room = roomsList.find((r) => r.id === booking.roomId);
  const accommodationAmount = booking.isTemporary
    ? TEMP_STAY.rate
    : rateForRoom(room, roomRatesList) * nights;
  const servicesAmount = (booking.serviceIds || []).reduce((sum, sid) => {
    const svc = servicesList.find((s) => s.id === sid);
    if (!svc) return sum;
    const qty = svc.billingUnit === "per_night" ? nights : 1;
    return sum + svc.price * qty;
  }, 0);
  return accommodationAmount + servicesAmount;
}

// A single source of truth for "how much has actually been paid, and is this
// invoice settled" — paid/outstanding/partial are always computed from the
// payment rows themselves rather than a manually-set status, so the two can
// never disagree. Void stays the one manually-set status, since it's a
// deliberate write-off independent of what's actually been paid.
function invoiceBalance(invoice, allPayments) {
  if (!invoice) return { paid: 0, remaining: 0, status: "outstanding" };
  if (invoice.status === "void") return { paid: 0, remaining: 0, status: "void" };
  const paid = allPayments
    .filter((p) => p.bookingId === invoice.bookingId)
    .reduce((sum, p) => sum + p.amount, 0);
  const remaining = Math.max(0, invoice.amount - paid);
  const status = paid <= 0 ? "outstanding" : remaining <= 0 ? "paid" : "partial";
  return { paid, remaining, status };
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 780px)").matches : false
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 780px)");
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isMobile;
}


/* ---------------------------------------------------------
   Small building blocks
--------------------------------------------------------- */
function ConnectionBadge({ isOnline, usingCache, syncing, pendingCount }) {
  let label, bg, fg;
  if (syncing) {
    label = "Syncing…";
    bg = "#E4E9F3"; fg = "#3A4E8A";
  } else if (!isOnline) {
    label = pendingCount > 0 ? `Offline · ${pendingCount} to sync` : "Offline";
    bg = "#F3DEDE"; fg = "#B24C4C";
  } else if (usingCache || pendingCount > 0) {
    label = `Online · ${pendingCount} pending`;
    bg = "#F3E7CE"; fg = "#8A6A1E";
  } else {
    label = "Online";
    bg = "#DCEFEC"; fg = "#1E6E67";
  }
  return (
    <span className="ws" style={{ background: bg, color: fg, fontSize: "12px", fontWeight: 500, padding: "5px 11px", borderRadius: "999px", whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

// Guest-facing weekly calendar for their stay — a grayed cell for a day
// already passed, filled for the day/days ahead, outlined for today,
// and nothing shown for days outside the stay. One row per week touched,
// so a stay crossing a week boundary just gets a second row.
function StayCalendar({ checkIn, checkOut }) {
  const built = buildStayCalendar(checkIn, checkOut);
  if (!built) return null;
  const { weeks, checkIn: inDate, checkOut: outDate } = built;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

  return (
    <div style={{ marginTop: "10px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "4px", marginBottom: "4px" }}>
        {WEEKDAY_LABELS.map((l, i) => (
          <div key={i} style={{ textAlign: "center", fontSize: "10.5px", color: C.inkSoft, fontWeight: 500 }}>{l}</div>
        ))}
      </div>
      {weeks.map((week, wi) => (
        <div key={wi} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "4px", marginBottom: "4px" }}>
          {week.map((day, di) => {
            const inStay = day >= inDate && day <= outDate;
            const isPast = inStay && day < today;
            const isToday = day.getTime() === today.getTime();
            return (
              <div key={di} style={{
                aspectRatio: "1", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "12px", fontWeight: inStay ? 500 : 400,
                background: !inStay ? "transparent" : isPast ? C.line : C.signal,
                color: !inStay ? C.inkSoft : isPast ? C.inkSoft : "#fff",
                border: isToday ? `2px solid ${C.clay}` : "1px solid transparent",
                opacity: !inStay ? 0.35 : 1,
              }}>
                {day.getDate()}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

const BOOKING_STATUSES = ["pending", "confirmed", "completed"];

function StatusPicker({ value, onChange }) {
  const tones = {
    pending: { bg: "#F3E7CE", fg: "#8A6A1E" },
    confirmed: { bg: C.signalSoft, fg: "#1E6E67" },
    completed: { bg: "#E4E9F3", fg: "#3A4E8A" },
    cancelled: { bg: "#F3DEDE", fg: C.red },
  };
  const t = tones[value] || tones.pending;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="ws"
      style={{
        background: t.bg, color: t.fg, fontSize: "12.5px", fontWeight: 500,
        padding: "4px 8px", borderRadius: "999px", border: "none", cursor: "pointer",
      }}
    >
      {BOOKING_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  );
}

const PILL_TONES = {
  pending: { bg: "#F3E7CE", fg: "#8A6A1E" },
  confirmed: { bg: C.signalSoft, fg: "#1E6E67" },
  completed: { bg: "#E4E9F3", fg: "#3A4E8A" },
  cancelled: { bg: "#F3DEDE", fg: C.red },
  outstanding: { bg: "#F3DEDE", fg: C.red },
  partial: { bg: "#FCEFD9", fg: C.clayDeep },
  paid: { bg: C.signalSoft, fg: "#1E6E67" },
  void: { bg: C.line, fg: C.inkSoft },
  new: { bg: "#E4E9F3", fg: "#3A4E8A" },
  quoted: { bg: "#F3E7CE", fg: "#8A6A1E" },
  default: { bg: C.line, fg: C.inkSoft },
};

function Pill({ tone, children }) {
  const t = PILL_TONES[tone] || PILL_TONES.default;
  return (
    <span
      className="ws"
      style={{
        background: t.bg,
        color: t.fg,
        fontSize: "12px",
        fontWeight: 500,
        padding: "3px 10px",
        borderRadius: "999px",
        whiteSpace: "nowrap",
        textTransform: "capitalize",
      }}
    >
      {children}
    </span>
  );
}

/* Room types are shown as an icon plus the room number rather than spelled out —
   the grid reads faster and the Room column stops eating horizontal space. The
   type name still travels with it as a tooltip so nothing is lost for a new
   staff member who hasn't learned the icons yet. Matching is substring-based so
   "Deluxe Double" or "Standard Single" still land on the right icon. */
const ROOM_TYPE_ICONS = [
  { match: "presidential", icon: Crown },
  { match: "deluxe", icon: Sparkles },
  { match: "suite", icon: Sparkles },
  { match: "double", icon: BedDouble },
  { match: "twin", icon: BedDouble },
  { match: "single", icon: BedSingle },
];

function roomTypeIcon(roomType) {
  const t = (roomType || "").toLowerCase();
  const hit = ROOM_TYPE_ICONS.find((r) => t.includes(r.match));
  return hit ? hit.icon : Bed;
}

function RoomBadge({ room, fallback, size = 15 }) {
  if (!room) {
    return <span style={{ fontSize: "13.5px", color: C.inkSoft }}>{fallback || "—"}</span>;
  }
  const Icon = roomTypeIcon(room.roomType);
  return (
    <span
      title={room.roomType}
      style={{ display: "inline-flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}
    >
      <Icon size={size} strokeWidth={2} color={C.clay} />
      <span style={{ fontWeight: 500 }}>{room.roomNumber}</span>
    </span>
  );
}

// A moon marks a normal overnight stay; a sun marks a temporary (day-use)
// stay shown as "hours used / 12-hour window" instead of a night count —
// two visually distinct symbols for two different kinds of booking.
function DurationDisplay({ booking }) {
  if (booking.isTemporary) {
    const hrs = hoursBetweenTimes(booking.checkInTime, booking.checkOutTime);
    return (
      <span title="Temporary stay" style={{ display: "inline-flex", alignItems: "center", gap: "5px", whiteSpace: "nowrap" }}>
        <Sun size={14} strokeWidth={2} color={C.amber} />
        <span>{hrs != null ? `${hrs}/${TEMP_STAY.windowHours} hrs` : "Temporary stay"}</span>
      </span>
    );
  }
  const nights = nightsBetween(booking.checkIn, booking.checkOut);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}>
      <span>{formatDateRange(booking.checkIn, booking.checkOut)}</span>
      <span title={`${nights} night${nights === 1 ? "" : "s"}`} style={{ display: "inline-flex", alignItems: "center", gap: "3px", color: C.inkSoft }}>
        <Moon size={13} strokeWidth={2} />
        {nights}
      </span>
    </span>
  );
}

// Service-request categories get one icon each, used wherever a category
// needs to be scannable at a glance rather than read as text — currently
// the guest-requests accordion on the provider side.
const REQUEST_CATEGORY_ICONS = {
  Kitchen: UtensilsCrossed,
  Counter: ShoppingBag,
  Amenities: Sparkles,
  Laundry: Shirt,
  General: MessageSquareText,
  Airtime: Wallet,
};
function requestCategoryIcon(category) {
  return REQUEST_CATEGORY_ICONS[category] || Bell;
}

// True once a request has reached its final stage — the point at which
// staff no longer need to act on it. Kitchen/Counter go through the richer
// sent → preparing → delivered → confirmed loop; everything else is the
// simpler sent → handled → received loop.
function isRequestSettled(r) {
  const isRich = RICH_STAGE_CATEGORIES.includes(r.category);
  const stage = r.stage || "sent";
  return isRich ? stage === "confirmed" : stage === "received";
}

// Groups requests under the stay they belong to. The access code ties every
// request from one guest's session together; staff-logged orders carry no
// code, so those fall back to guest name + room, the next best identifier.
function requestGroupKey(r) {
  return r.code || `${r.guest_name || "Guest"}::${r.room_number || ""}`;
}

function RequestCard({ r, onAdvance }) {
  const isRich = RICH_STAGE_CATEGORIES.includes(r.category);
  const stage = r.stage || "sent";
  return (
    <div style={{ padding: "12px", border: `1px solid ${C.line}`, borderRadius: "9px", background: C.paperRaised }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px" }}>
        <div>
          <div style={{ fontSize: "14px" }}>
            {r.message}{r.quantity > 1 ? ` (× ${r.quantity})` : ""}
          </div>
          <div style={{ fontSize: "12px", color: C.inkSoft, marginTop: "3px" }}>
            {new Date(r.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          {isRich ? (
            <>
              <Pill tone={stage === "confirmed" ? "completed" : stage === "delivered" ? "confirmed" : "pending"}>
                {RICH_STAGE_LABELS[stage] || stage}
              </Pill>
              <div style={{ marginTop: "8px" }}>
                {stage === "sent" && (
                  <button onClick={() => onAdvance(r.id, "preparing")} style={{ fontSize: "12.5px", border: "none", background: C.signal, color: "#fff", borderRadius: "6px", padding: "6px 12px", cursor: "pointer" }}>
                    Start preparing
                  </button>
                )}
                {stage === "preparing" && (
                  <button onClick={() => onAdvance(r.id, "delivered")} style={{ fontSize: "12.5px", border: "none", background: C.signal, color: "#fff", borderRadius: "6px", padding: "6px 12px", cursor: "pointer" }}>
                    Mark delivered
                  </button>
                )}
                {stage === "delivered" && (
                  <div style={{ fontSize: "11.5px", color: C.inkSoft }}>Awaiting guest confirmation</div>
                )}
              </div>
            </>
          ) : (
            <>
              {stage === "received" ? (
                <Pill tone="completed">Received by guest</Pill>
              ) : stage === "handled" ? (
                <>
                  <Pill tone="pending">Handled</Pill>
                  <div style={{ fontSize: "11.5px", color: C.inkSoft, marginTop: "6px" }}>Awaiting guest confirmation</div>
                </>
              ) : (
                <button
                  onClick={() => onAdvance(r.id, "handled")}
                  style={{ fontSize: "12.5px", border: "none", background: C.signal, color: "#fff", borderRadius: "6px", padding: "6px 12px", cursor: "pointer" }}
                >
                  Mark handled
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Requests grouped by guest/stay rather than one long flat feed. A guest
// with several requests collapses to a single row — category icons with
// counts for a scan-at-a-glance read — and expands to the full itemized
// list on click. A group with anything still awaiting action stays expanded
// by default so nothing needing a response gets buried; fully settled
// groups start collapsed. Clicking a row overrides that default either way.
function RequestsPanel({ requests, onAdvance }) {
  const [overrides, setOverrides] = useState({});

  const groups = [];
  const indexByKey = {};
  requests.forEach((r) => {
    const key = requestGroupKey(r);
    if (!(key in indexByKey)) {
      indexByKey[key] = groups.length;
      groups.push({ key, guestName: r.guest_name || "Guest", roomNumber: r.room_number || "", roomType: r.room_type || "", items: [] });
    }
    groups[indexByKey[key]].items.push(r);
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {groups.map((g) => {
        const hasActive = g.items.some((r) => !isRequestSettled(r));
        const expanded = overrides[g.key] ?? hasActive;
        const counts = {};
        g.items.forEach((r) => { counts[r.category] = (counts[r.category] || 0) + 1; });
        const categories = Object.keys(counts);
        const roomHeader = g.roomNumber
          ? `Room ${g.roomNumber}${g.roomType ? " · " + g.roomType : ""} — ${g.guestName}`
          : g.guestName;
        return (
          <div key={g.key} style={{ border: `1px solid ${C.line}`, borderRadius: "9px", overflow: "hidden" }}>
            <button
              onClick={() => setOverrides((prev) => ({ ...prev, [g.key]: !expanded }))}
              className="ws"
              style={{
                width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
                gap: "10px", padding: "12px", background: "none", border: "none", cursor: "pointer", textAlign: "left"
              }}
            >
              <div>
                <div style={{ fontSize: "13.5px", fontWeight: 600, color: C.ink }}>{roomHeader}</div>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "6px", flexWrap: "wrap" }}>
                  {categories.map((cat) => {
                    const Icon = requestCategoryIcon(cat);
                    return (
                      <span key={cat} title={cat} style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "12px", color: C.inkSoft }}>
                        <Icon size={14} strokeWidth={2} color={C.clayDeep} />
                        {counts[cat]}
                      </span>
                    );
                  })}
                  {hasActive && <Pill tone="pending">Needs attention</Pill>}
                </div>
              </div>
              {expanded ? <ChevronUp size={18} color={C.inkSoft} style={{ flexShrink: 0 }} /> : <ChevronDown size={18} color={C.inkSoft} style={{ flexShrink: 0 }} />}
            </button>
            {expanded && (
              <div style={{ padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: "10px" }}>
                {g.items.map((r) => <RequestCard key={r.id} r={r} onAdvance={onAdvance} />)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function NavItem({ icon: Icon, label, active, onClick, badge }) {
  return (
    <button
      onClick={onClick}
      className="ws"
      style={{
        display: "flex", alignItems: "center", gap: "10px",
        width: "100%", textAlign: "left", padding: "9px 14px",
        borderRadius: "8px", border: "none", cursor: "pointer",
        background: active ? "rgba(255,255,255,0.1)" : "transparent",
        color: active ? "#FFFFFF" : "rgba(255,255,255,0.62)",
        fontSize: "14.5px", fontWeight: 500, transition: "background 120ms",
      }}
    >
      <Icon size={17} strokeWidth={2} />
      <span style={{ flex: 1 }}>{label}</span>
      {badge ? (
        <span style={{
          background: C.signal, color: "#fff", fontSize: "11px", fontWeight: 600,
          borderRadius: "999px", padding: "1px 7px", minWidth: "18px", textAlign: "center"
        }}>
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function Panel({ title, action, children }) {
  return (
    <div style={{ background: C.paperRaised, border: `1px solid ${C.line}`, borderRadius: "10px" }}>
      {title && (
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "16px 20px", borderBottom: `1px solid ${C.line}`
        }}>
          <h3 className="fr" style={{ margin: 0, fontSize: "18px", fontWeight: 500, color: C.ink }}>{title}</h3>
          {action}
        </div>
      )}
      <div style={{ padding: "20px" }}>{children}</div>
    </div>
  );
}

/* ---------------------------------------------------------
   Login
--------------------------------------------------------- */
function Login({ onSignIn, onBack }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  async function handleSignIn() {
    setSigningIn(true);
    setError("");
    const { data, error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setSigningIn(false);
    if (authError || !data.session) {
      setError(authError?.message || "Incorrect email or password.");
      return;
    }
    onSignIn(data.session);
  }

  return (
    <div style={{
      minHeight: "560px", display: "flex", alignItems: "center", justifyContent: "center",
      background: C.paper
    }}>
      {FONTS}
      <div style={{
        width: "min(360px, 92vw)", background: C.paperRaised, border: `1px solid ${C.line}`,
        borderRadius: "14px", padding: "36px 32px"
      }}>
        <div style={{
          width: "40px", height: "40px", borderRadius: "9px", background: C.ink,
          display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "22px"
        }}>
          <Radio size={19} color={C.signal} strokeWidth={2.2} />
        </div>
        <h1 className="fr" style={{ margin: "0 0 6px", fontSize: "26px", fontWeight: 500, color: C.ink }}>
          Utulivu
        </h1>
        <p className="ws" style={{ margin: "0 0 26px", fontSize: "14px", color: C.inkSoft }}>
          Sign in to manage your property.
        </p>
        <label className="ws" style={{ fontSize: "12.5px", color: C.inkSoft, display: "block", marginBottom: "6px" }}>
          Email
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSignIn()}
          className="ws"
          style={{
            width: "100%", padding: "10px 12px", borderRadius: "8px",
            border: `1px solid ${C.line}`, marginBottom: "14px", fontSize: "14px",
            outlineColor: C.signal, boxSizing: "border-box"
          }}
        />
        <label className="ws" style={{ fontSize: "12.5px", color: C.inkSoft, display: "block", marginBottom: "6px" }}>
          Password
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSignIn()}
          className="ws"
          style={{
            width: "100%", padding: "10px 12px", borderRadius: "8px",
            border: `1px solid ${C.line}`, marginBottom: "10px", fontSize: "14px",
            outlineColor: C.signal, boxSizing: "border-box"
          }}
        />
        {error && <p style={{ color: C.red, fontSize: "12.5px", margin: "0 0 12px" }}>{error}</p>}
        <button
          onClick={handleSignIn}
          disabled={signingIn || !email.trim() || !password}
          className="ws"
          style={{
            width: "100%", padding: "11px", borderRadius: "8px", border: "none",
            background: C.ink, color: "#fff", fontSize: "14.5px", fontWeight: 500,
            cursor: signingIn ? "default" : "pointer", opacity: signingIn ? 0.7 : 1, marginTop: "4px"
          }}
        >
          {signingIn ? "Signing in…" : "Sign in"}
        </button>
        {onBack && (
          <button onClick={onBack} className="ws" style={{ width: "100%", marginTop: "10px", padding: "9px", borderRadius: "8px", border: `1px solid ${C.line}`, background: "none", color: C.inkSoft, fontSize: "13px", cursor: "pointer" }}>
            ← Choose a different portal
          </button>
        )}
        <p className="ws" style={{ marginTop: "16px", fontSize: "12px", color: C.inkSoft }}>
          Demo data only — nothing here is saved beyond this session.
        </p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Dashboard widgets — room-by-room occupancy for today, and the
   expenses ledger. Both are role-aware: staff get today's actionable
   state, manager/owner additionally get historical context.
--------------------------------------------------------- */
function RoomGrid({ rooms, bookings, clientName, canManage }) {
  const today = todayStr();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {rooms.map((room) => {
        const todaysBookings = bookings.filter((b) => b.roomId === room.id && isBookingActiveOn(b, today));
        const occupied = todaysBookings.length > 0;
        const allTimeCount = bookings.filter((b) => b.roomId === room.id).length;
        return (
          <div key={room.id} style={{
            display: "flex", alignItems: "center", gap: "12px", padding: "10px 12px",
            border: `1px solid ${C.line}`, borderRadius: "8px",
            background: occupied ? C.signalSoft : C.paperRaised
          }}>
            <div style={{ width: "88px", flexShrink: 0, fontSize: "13.5px" }}>
              <RoomBadge room={room} size={16} />
            </div>
            <div style={{ flex: 1, display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {occupied ? todaysBookings.map((b) => (
                <span key={b.id} style={{ fontSize: "11.5px", background: "#fff", border: `1px solid ${C.line}`, borderRadius: "6px", padding: "3px 8px" }}>
                  {clientName(b.clientId)} · {b.checkInTime || "--:--"}–{b.checkOutTime || "--:--"}
                </span>
              )) : (
                <span style={{ fontSize: "12px", color: C.inkSoft }}>Vacant</span>
              )}
            </div>
            {canManage && (
              <div style={{ fontSize: "11px", color: C.inkSoft, flexShrink: 0, whiteSpace: "nowrap" }}>Booked {allTimeCount}×</div>
            )}
          </div>
        );
      })}
      {rooms.length === 0 && (
        <div style={{ fontSize: "13px", color: C.inkSoft }}>No rooms set up for this branch yet.</div>
      )}
    </div>
  );
}

function ExpensesPanel({ expenses, canManage, showAll, onToggleShowAll, onAdd }) {
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [adding, setAdding] = useState(false);
  const today = todayStr();
  const scoped = canManage && showAll ? expenses : expenses.filter((e) => e.createdAt && e.createdAt.slice(0, 10) === today);
  const total = scoped.reduce((sum, e) => sum + e.amount, 0);
  const isHistorical = canManage && showAll;

  async function handleAdd() {
    if (!desc.trim() || !amount || Number(amount) <= 0) return;
    setAdding(true);
    await onAdd(desc.trim(), Number(amount));
    setDesc("");
    setAmount("");
    setAdding(false);
  }

  return (
    <Panel
      title="Expenses"
      action={canManage && (
        <button
          onClick={onToggleShowAll}
          style={{ fontSize: "12.5px", border: `1px solid ${C.line}`, background: "none", borderRadius: "6px", padding: "6px 12px", cursor: "pointer", color: C.clayDeep }}
        >
          {showAll ? "Show today only" : "View all"}
        </button>
      )}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
        <span style={{ fontSize: "13px", color: C.inkSoft }}>{isHistorical ? "Total" : "Today's total"}</span>
        <span className="fr" style={{ fontSize: "20px", fontWeight: 500 }}>{money(total)}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "14px", maxHeight: "220px", overflowY: "auto" }}>
        {scoped.length === 0 && (
          <span style={{ fontSize: "12.5px", color: C.inkSoft }}>No expenses recorded {isHistorical ? "" : "today "}yet.</span>
        )}
        {scoped.slice().reverse().map((e) => (
          <div key={e.id} style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", padding: "6px 0", borderBottom: `1px solid ${C.line}` }}>
            <span>{e.description}</span>
            <span style={{ color: C.inkSoft }}>{money(e.amount)}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: "8px" }}>
        <input
          value={desc}
          onChange={(ev) => setDesc(ev.target.value)}
          placeholder="What for?"
          style={{ flex: 2, padding: "8px", borderRadius: "7px", border: `1px solid ${C.line}`, fontSize: "13px", boxSizing: "border-box" }}
        />
        <input
          type="number"
          min="0"
          value={amount}
          onChange={(ev) => setAmount(ev.target.value)}
          placeholder="Amount"
          style={{ flex: 1, padding: "8px", borderRadius: "7px", border: `1px solid ${C.line}`, fontSize: "13px", boxSizing: "border-box" }}
        />
        <button
          disabled={adding || !desc.trim() || !amount || Number(amount) <= 0}
          onClick={handleAdd}
          style={{
            padding: "8px 14px", borderRadius: "7px", border: "none", fontSize: "13px", whiteSpace: "nowrap",
            background: desc.trim() && amount ? C.clay : C.line, color: desc.trim() && amount ? "#fff" : C.inkSoft,
            cursor: desc.trim() && amount ? "pointer" : "default"
          }}
        >
          {adding ? "Adding…" : "Add"}
        </button>
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------
   Main app
--------------------------------------------------------- */
// Lets staff log a service order directly for a guest — e.g. a counter
// purchase that never touched the Guest portal. Picks from active bookings
// rather than requiring a guest access code, since not every guest has one.
function StaffOrderModal({ bookings, rooms, clientName, services, onClose, onSave }) {
  const [bookingId, setBookingId] = useState("");
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState(1);
  const [saving, setSaving] = useState(false);

  const activeBookings = bookings.filter((b) => b.status !== "completed");
  const bookingLabel = (bk) => {
    const room = rooms.find((r) => r.id === bk.roomId);
    return `${clientName(bk.clientId)}${room ? " — " + room.roomNumber + " · " + room.roomType : ""}`;
  };
  const selectedItem = services.find((s) => s.id === itemId);
  const hasQuantity = selectedItem && (selectedItem.category === "Kitchen" || selectedItem.category === "Laundry");
  const canSave = bookingId && itemId;

  async function handleSave() {
    setSaving(true);
    const booking = bookings.find((b) => b.id === bookingId);
    const ok = await onSave(booking, selectedItem, hasQuantity ? qty : 1);
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(22,35,59,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 20 }}>
      <div className="ws" style={{ background: "#fff", borderRadius: "12px", padding: "24px", width: "min(360px, 92vw)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h3 className="fr" style={{ margin: 0, fontSize: "19px" }}>Log an order</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
        </div>
        <p style={{ fontSize: "12px", color: C.inkSoft, margin: "0 0 16px" }}>
          For orders taken directly at the counter or by phone — bypasses the Guest portal, shows up in Requests and the ledger below just the same.
        </p>

        <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Guest / room</label>
        <select value={bookingId} onChange={(e) => setBookingId(e.target.value)} style={{ width: "100%", padding: "9px", borderRadius: "7px", border: `1px solid ${C.line}`, margin: "6px 0 14px", fontSize: "14px" }}>
          <option value="">— Select a booking —</option>
          {activeBookings.map((bk) => <option key={bk.id} value={bk.id}>{bookingLabel(bk)}</option>)}
        </select>

        <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Item</label>
        <select value={itemId} onChange={(e) => setItemId(e.target.value)} style={{ width: "100%", padding: "9px", borderRadius: "7px", border: `1px solid ${C.line}`, margin: "6px 0 14px", fontSize: "14px" }}>
          <option value="">— Select an item —</option>
          {services.map((s) => <option key={s.id} value={s.id}>{s.category} — {s.name} ({s.price > 0 ? money(s.price) : "Free"})</option>)}
        </select>

        {hasQuantity && (
          <>
            <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Quantity</label>
            <input
              type="number"
              min="1"
              value={qty}
              onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
              style={{ width: "100%", padding: "9px", borderRadius: "7px", border: `1px solid ${C.line}`, margin: "6px 0 14px", fontSize: "14px", boxSizing: "border-box" }}
            />
          </>
        )}

        <button
          disabled={!canSave || saving}
          onClick={handleSave}
          style={{
            width: "100%", background: canSave ? C.ink : C.line, color: canSave ? "#fff" : C.inkSoft,
            border: "none", borderRadius: "8px", padding: "11px", fontSize: "14.5px",
            cursor: canSave && !saving ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
            opacity: saving ? 0.7 : 1
          }}
        >
          <Check size={16} /> {saving ? "Logging…" : "Log order"}
        </button>
      </div>
    </div>
  );
}

// Records either a payment or a refund against an invoice. Refunds require a
// short note — there's no automatic proration logic, so the note is the only
// record of *why* money went back once the number is entered.
function PaymentModal({ invoice, kind, balance, onClose, onSave }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const isRefund = kind === "refund";
  const numericAmount = Number(amount);
  const canSave = amount && numericAmount > 0 && (!isRefund || note.trim().length > 0);

  async function handleSave() {
    setSaving(true);
    const ok = await onSave({ amount: isRefund ? -Math.abs(numericAmount) : Math.abs(numericAmount), note: note.trim() || null, kind });
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(22,35,59,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 20 }}>
      <div className="ws" style={{ background: "#fff", borderRadius: "12px", padding: "24px", width: "min(340px, 92vw)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h3 className="fr" style={{ margin: 0, fontSize: "19px" }}>{isRefund ? "Issue a refund" : "Record a payment"}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
        </div>

        <p style={{ fontSize: "12.5px", color: C.inkSoft, margin: "0 0 16px" }}>
          {money(balance.paid)} paid of {money(invoice.amount)} · {money(balance.remaining)} remaining
        </p>

        <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Amount</label>
        <input
          type="number"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={isRefund ? "Amount to refund" : "Amount received"}
          autoFocus
          style={{ width: "100%", padding: "9px", borderRadius: "7px", border: `1px solid ${C.line}`, margin: "6px 0 14px", fontSize: "14px", boxSizing: "border-box" }}
        />

        <label style={{ fontSize: "12.5px", color: C.inkSoft }}>{isRefund ? "Reason (required)" : "Note (optional)"}</label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={isRefund ? "e.g. early checkout — 2 nights refunded" : "e.g. deposit, cash on arrival"}
          style={{ width: "100%", padding: "9px", borderRadius: "7px", border: `1px solid ${C.line}`, margin: "6px 0 18px", fontSize: "14px", boxSizing: "border-box" }}
        />

        <button
          disabled={!canSave || saving}
          onClick={handleSave}
          style={{
            width: "100%", background: canSave ? (isRefund ? C.red : C.ink) : C.line, color: canSave ? "#fff" : C.inkSoft,
            border: "none", borderRadius: "8px", padding: "11px", fontSize: "14.5px",
            cursor: canSave && !saving ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
            opacity: saving ? 0.7 : 1
          }}
        >
          <Check size={16} /> {saving ? "Saving…" : isRefund ? "Issue refund" : "Save payment"}
        </button>
      </div>
    </div>
  );
}

// Create, edit, or delete a service — the catalog behind both the booking-
// time add-on checklist and the guest-portal request menu. Category picks
// from the four guest-request categories (Kitchen/Counter/Amenities/
// Laundry) or a free-typed "Other" for booking-time add-ons like Transport,
// which aren't guest self-serve requests at all. The availability checkbox
// here is the same one-click toggle exposed on each row of the catalog
// table — this modal just also lets it be set at creation time.
function ServiceModal({ service, branchId, onClose, onSave, onDelete }) {
  const isEdit = Boolean(service);
  const startsCustom = isEdit && !GUEST_REQUEST_CATEGORIES.includes(service.category);
  const [name, setName] = useState(service?.name || "");
  const [categoryChoice, setCategoryChoice] = useState(startsCustom ? "custom" : (service?.category || "Kitchen"));
  const [customCategory, setCustomCategory] = useState(startsCustom ? service.category : "");
  const [price, setPrice] = useState(service ? String(service.price) : "");
  const [billingUnit, setBillingUnit] = useState(service?.billingUnit || "flat");
  const [isAvailable, setIsAvailable] = useState(service ? service.isAvailable : true);
  const [imageUrl, setImageUrl] = useState(service?.imageUrl || null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef(null);

  const finalCategory = categoryChoice === "custom" ? customCategory.trim() : categoryChoice;
  const canSave = name.trim().length > 0 && finalCategory.length > 0 && price !== "" && Number(price) >= 0;

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError("");
    try {
      const path = `${branchId}/${newId()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("service-photos").upload(path, file);
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("service-photos").getPublicUrl(path);
      setImageUrl(data.publicUrl);
    } catch (err) {
      setUploadError("Couldn't upload that photo — you can still save without one.");
    }
    setUploading(false);
  }

  async function handleSave() {
    setSaving(true);
    await onSave({ id: service?.id, name: name.trim(), category: finalCategory, price: Number(price), billingUnit, isAvailable, imageUrl });
    setSaving(false);
  }

  async function handleDelete() {
    if (!window.confirm(`Delete "${service.name}"? This can't be undone.`)) return;
    setDeleting(true);
    await onDelete(service.id);
    setDeleting(false);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(22,35,59,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 20 }}>
      <div className="ws" style={{ background: "#fff", borderRadius: "12px", padding: "24px", width: "min(380px, 92vw)", maxHeight: "88vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h3 className="fr" style={{ margin: 0, fontSize: "19px" }}>{isEdit ? "Edit service" : "New service"}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
        </div>

        <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Chicken Curry"
          autoFocus
          style={{ width: "100%", padding: "9px", borderRadius: "7px", border: `1px solid ${C.line}`, margin: "6px 0 14px", fontSize: "14px", boxSizing: "border-box" }}
        />

        <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Category</label>
        <select
          value={categoryChoice}
          onChange={(e) => setCategoryChoice(e.target.value)}
          style={{ width: "100%", padding: "9px", borderRadius: "7px", border: `1px solid ${C.line}`, margin: "6px 0 8px", fontSize: "14px" }}
        >
          {GUEST_REQUEST_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          <option value="custom">Other (booking add-on, e.g. Transport)</option>
        </select>
        {categoryChoice === "custom" ? (
          <input
            value={customCategory}
            onChange={(e) => setCustomCategory(e.target.value)}
            placeholder="e.g. Transport"
            style={{ width: "100%", padding: "9px", borderRadius: "7px", border: `1px solid ${C.line}`, margin: "0 0 14px", fontSize: "14px", boxSizing: "border-box" }}
          />
        ) : (
          <p style={{ fontSize: "11px", color: C.inkSoft, margin: "0 0 14px" }}>
            {GUEST_REQUEST_CATEGORIES.includes(categoryChoice) ? "Shows up in the guest portal's ordering menu." : ""}
          </p>
        )}

        <div style={{ display: "flex", gap: "10px", marginBottom: "14px" }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Price (TSh)</label>
            <input
              type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)}
              style={{ width: "100%", padding: "9px", borderRadius: "7px", border: `1px solid ${C.line}`, marginTop: "6px", fontSize: "14px", boxSizing: "border-box" }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Billing</label>
            <select value={billingUnit} onChange={(e) => setBillingUnit(e.target.value)} style={{ width: "100%", padding: "9px", borderRadius: "7px", border: `1px solid ${C.line}`, marginTop: "6px", fontSize: "14px" }}>
              <option value="flat">One-time</option>
              <option value="per_night">Per night</option>
            </select>
          </div>
        </div>

        <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Photo (optional)</label>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", margin: "6px 0 6px" }}>
          {imageUrl ? (
            <img src={imageUrl} alt="" style={{ width: "56px", height: "56px", borderRadius: "8px", objectFit: "cover", border: `1px solid ${C.line}` }} />
          ) : (
            <div style={{ width: "56px", height: "56px", borderRadius: "8px", border: `1px dashed ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center", color: C.inkSoft, flexShrink: 0 }}>
              <ImageOff size={20} />
            </div>
          )}
          <div style={{ flex: 1, display: "flex", flexWrap: "wrap", gap: "8px" }}>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} style={{ display: "none" }} />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              style={{ fontSize: "12.5px", display: "flex", alignItems: "center", gap: "5px", border: `1px solid ${C.line}`, background: "none", borderRadius: "6px", padding: "6px 11px", cursor: uploading ? "default" : "pointer", color: C.clayDeep }}
            >
              <Upload size={13} /> {uploading ? "Uploading…" : imageUrl ? "Replace" : "Upload"}
            </button>
            {imageUrl && (
              <button type="button" onClick={() => setImageUrl(null)} style={{ fontSize: "12.5px", border: "none", background: "none", color: C.inkSoft, cursor: "pointer" }}>
                Remove
              </button>
            )}
          </div>
        </div>
        {uploadError && <p style={{ fontSize: "11.5px", color: C.red, margin: "0 0 14px" }}>{uploadError}</p>}
        {!uploadError && <div style={{ marginBottom: "14px" }} />}

        <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13.5px", color: C.ink, marginBottom: "18px" }}>
          <input type="checkbox" checked={isAvailable} onChange={(e) => setIsAvailable(e.target.checked)} />
          Available to order right now
        </label>

        <button
          disabled={!canSave || saving}
          onClick={handleSave}
          style={{
            width: "100%", background: canSave ? C.ink : C.line, color: canSave ? "#fff" : C.inkSoft,
            border: "none", borderRadius: "8px", padding: "11px", fontSize: "14.5px",
            cursor: canSave && !saving ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
            opacity: saving ? 0.7 : 1
          }}
        >
          <Check size={16} /> {saving ? "Saving…" : "Save service"}
        </button>

        {isEdit && (
          <button
            disabled={deleting}
            onClick={handleDelete}
            style={{ width: "100%", marginTop: "8px", padding: "9px", borderRadius: "8px", border: "none", background: "none", color: C.red, fontSize: "13px", cursor: deleting ? "default" : "pointer" }}
          >
            {deleting ? "Deleting…" : "Delete service"}
          </button>
        )}
      </div>
    </div>
  );
}

function ProviderApp({ onExit, onGenerateCode, onJumpToGuest }) {
  const [session, setSession] = useState(undefined); // undefined = checking, null = signed out
  const [role, setRole] = useState(null); // 'owner' | 'manager' | 'staff' | null while loading
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState(null);
  const [tab, setTab] = useState("dashboard");

  const [clients, setClients] = useState([]);
  const [services, setServices] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [inquiries, setInquiries] = useState([]);
  const [tags, setTags] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [roomRates, setRoomRates] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [payments, setPayments] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);

  const [showBranchMenu, setShowBranchMenu] = useState(false);
  const [showAddBooking, setShowAddBooking] = useState(false);
  const [addBookingPrefillClientId, setAddBookingPrefillClientId] = useState(null);
  const [showLogOrder, setShowLogOrder] = useState(false);
  const [showAddClient, setShowAddClient] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [viewingClientHistory, setViewingClientHistory] = useState(null);
  const [tapFlash, setTapFlash] = useState(null);
  const [generatedCode, setGeneratedCode] = useState(null);
  const [printInvoice, setPrintInvoice] = useState(null);
  const [editingBooking, setEditingBooking] = useState(null);
  const [paymentModal, setPaymentModal] = useState(null); // { invoice, kind: "payment" | "refund" }
  const [showAddService, setShowAddService] = useState(false);
  const [editingService, setEditingService] = useState(null);
  const [teamMembers, setTeamMembers] = useState([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [generatingId, setGeneratingId] = useState(null);
  const [requests, setRequests] = useState([]);
  const [showAllRequests, setShowAllRequests] = useState(false);
  const [showAllExpenses, setShowAllExpenses] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [usingCache, setUsingCache] = useState(false);
  const [pendingCount, setPendingCount] = useState(queueCount());
  const [syncing, setSyncing] = useState(false);
  const [syncFailures, setSyncFailures] = useState([]);
  const [showSyncFailures, setShowSyncFailures] = useState(false);

  function applyFetchedData(b, c, s, bk, inv, iq, t, rm, rr, ex, pm) {
    const mapped = {
      branches: b ? b.map(mapBranch) : [],
      clients: c ? c.map(mapClient) : [],
      services: s ? s.map(mapService) : [],
      bookings: bk ? bk.map(mapBooking) : [],
      invoices: inv ? inv.map(mapInvoice) : [],
      inquiries: iq ? iq.map(mapInquiry) : [],
      tags: t ? t.map(mapTag) : [],
      rooms: rm ? rm.map(mapRoom) : [],
      roomRates: rr ? rr.map(mapRoomRate) : [],
      expenses: ex ? ex.map(mapExpense) : [],
      payments: pm ? pm.map(mapPayment) : [],
    };
    setBranches(mapped.branches);
    setClients(mapped.clients);
    setServices(mapped.services);
    setBookings(mapped.bookings);
    setInvoices(mapped.invoices);
    setInquiries(mapped.inquiries);
    setTags(mapped.tags);
    setRooms(mapped.rooms);
    setRoomRates(mapped.roomRates);
    setExpenses(mapped.expenses);
    setPayments(mapped.payments);
    setBranchId((prev) => prev || mapped.branches[0]?.id || null);
    saveCache(mapped);
    setUsingCache(false);
  }

  async function fetchAll() {
    try {
      const [b, c, s, bk, inv, iq, t, rm, rr, ex, pm] = await Promise.all([
        supabase.from("branches").select("*"),
        supabase.rpc("get_clients"), // owner-only fields (id_type/id_number) come back null for staff
        supabase.from("services").select("*"),
        supabase.from("bookings").select("*"),
        supabase.from("invoices").select("*"),
        supabase.from("inquiries").select("*"),
        supabase.from("tags").select("*"),
        supabase.from("rooms").select("*"),
        supabase.from("room_rates").select("*"),
        supabase.from("expenses").select("*"),
        supabase.from("payments").select("*"),
      ]);
      const firstError = [b, c, s, bk, inv, iq, t, rm, rr, ex, pm].find((r) => r.error)?.error;
      if (firstError) throw firstError;
      applyFetchedData(b.data, c.data, s.data, bk.data, inv.data, iq.data, t.data, rm.data, rr.data, ex.data, pm.data);
      setIsOnline(true);
    } catch (e) {
      // No connection (or Supabase unreachable) — fall back to whatever we last cached locally.
      const cached = loadCache();
      if (cached) {
        setBranches(cached.branches || []);
        setClients(cached.clients || []);
        setServices(cached.services || []);
        setBookings(cached.bookings || []);
        setInvoices(cached.invoices || []);
        setInquiries(cached.inquiries || []);
        setTags(cached.tags || []);
        setRooms(cached.rooms || []);
        setRoomRates(cached.roomRates || []);
        setExpenses(cached.expenses || []);
        setPayments(cached.payments || []);
        setBranchId((prev) => prev || cached.branches?.[0]?.id || null);
        setUsingCache(true);
      }
      setIsOnline(false);
    }
    setDataLoading(false);
  }

  async function syncPending() {
    const queue = getQueue();
    if (queue.length === 0) {
      fetchAll();
      return;
    }
    setSyncing(true);
    let hadTransientFailure = false;
    const newlyFailed = [];

    for (const action of queue) {
      try {
        if (action.type === "addClient") {
          // payload already carries the real client id (generated client-side),
          // so no read-back is needed — good, since staff can't SELECT clients directly.
          const { error } = await supabase.from("clients").insert(action.payload);
          if (error) throw error;
        } else if (action.type === "addBooking") {
          const { error } = await supabase.from("bookings").insert(action.payload);
          if (error) throw error;
        } else if (action.type === "updateBookingStatus") {
          const { error } = await supabase.from("bookings").update({ status: action.payload.status }).eq("id", action.payload.id);
          if (error) throw error;
        } else if (action.type === "updateInquiryStatus") {
          const { error } = await supabase.from("inquiries").update({ status: action.payload.status }).eq("id", action.payload.id);
          if (error) throw error;
        } else if (action.type === "tapTag") {
          const { error } = await supabase.from("tags").update({ last_scan: action.payload.stamp }).eq("id", action.payload.tagId);
          if (error) throw error;
          if (action.payload.inquiry) {
            const { error: iqErr } = await supabase.from("inquiries").insert(action.payload.inquiry);
            if (iqErr) throw iqErr;
          }
        } else if (action.type === "addInvoice") {
          const { error } = await supabase.from("invoices").insert(action.payload);
          if (error) throw error;
        } else if (action.type === "updateInvoiceStatus") {
          const { error } = await supabase.from("invoices").update({ status: action.payload.status }).eq("id", action.payload.id);
          if (error) throw error;
        } else if (action.type === "updateInvoiceAmount") {
          const { error } = await supabase.from("invoices").update({ amount: action.payload.amount }).eq("id", action.payload.id);
          if (error) throw error;
        } else if (action.type === "addExpense") {
          const { error } = await supabase.from("expenses").insert(action.payload);
          if (error) throw error;
        } else if (action.type === "addPayment") {
          const { error } = await supabase.from("payments").insert(action.payload);
          if (error) throw error;
        } else if (action.type === "editBooking") {
          const { error } = await supabase.from("bookings").update(action.payload.updates).eq("id", action.payload.id);
          if (error) throw error;
        } else if (action.type === "deleteBooking") {
          const { error } = await supabase.from("bookings").delete().eq("id", action.payload.id);
          if (error) throw error;
        } else if (action.type === "deleteClient") {
          const { error } = await supabase.from("clients").delete().eq("id", action.payload.id);
          if (error) throw error;
        }
        removeFromQueue(action.id);
      } catch (e) {
        // A Postgres error code means the request actually reached the server
        // and was rejected for a real reason (a double-booked room, a broken
        // reference, a permission check) — retrying the exact same payload
        // will never succeed, so retrying it forever would just jam every
        // other queued action behind it. No error code usually means the
        // request never reached the server at all (still offline, or a
        // one-off network hiccup) — that's worth trying again later.
        if (e?.code) {
          removeFromQueue(action.id);
          newlyFailed.push({ action, message: e.message || "This change couldn't be saved." });
          // Don't leave a phantom entry on screen for something that will
          // never actually exist on the server.
          if (action.tempId) {
            if (action.type === "addClient") setClients((prev) => prev.filter((c) => c.id !== action.tempId));
            if (action.type === "addBooking") setBookings((prev) => prev.filter((b) => b.id !== action.tempId));
            if (action.type === "addPayment") setPayments((prev) => prev.filter((p) => p.id !== action.tempId));
          }
        } else {
          hadTransientFailure = true;
        }
        // Deliberately no `return` here — one bad action shouldn't block
        // everything queued behind it.
      }
    }

    setPendingCount(queueCount());
    setSyncing(false);
    if (newlyFailed.length > 0) {
      setSyncFailures((prev) => [...prev, ...newlyFailed]);
    }
    // Only worth a full refetch if we actually made progress syncing
    // something — if everything's still stuck offline, there's nothing new
    // to pull down yet.
    if (!hadTransientFailure || newlyFailed.length > 0) {
      fetchAll();
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setRole(null);
      return;
    }
    supabase
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .single()
      .then(({ data }) => setRole(data?.role || "staff"));
  }, [session]);

  useEffect(() => {
    if (tab === "team" && role === "owner") fetchTeam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (!session) return;
    fetchAll();
    if (navigator.onLine && queueCount() > 0) syncPending();

    function handleOnline() {
      setIsOnline(true);
      syncPending();
    }
    function handleOffline() {
      setIsOnline(false);
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    supabase
      .from("service_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data) setRequests(data);
      });

    const requestsChannel = supabase
      .channel("service_requests_live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "service_requests" }, (payload) => {
        setRequests((prev) => [payload.new, ...prev]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "service_requests" }, (payload) => {
        setRequests((prev) => prev.map((r) => (r.id === payload.new.id ? payload.new : r)));
      })
      .subscribe();

    const bookingsChannel = supabase
      .channel("bookings_live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "bookings" }, (payload) => {
        setBookings((prev) => (prev.some((bk) => bk.id === payload.new.id) ? prev : [...prev, mapBooking(payload.new)]));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "bookings" }, (payload) => {
        setBookings((prev) => prev.map((bk) => (bk.id === payload.new.id ? mapBooking(payload.new) : bk)));
      })
      .subscribe();

    // Invoices can change from outside this browser tab's own actions — e.g.
    // another staff member's session, or the owner voiding one from a
    // different tab. This keeps Bookings and Finance current without a
    // manual refresh.
    const invoicesChannel = supabase
      .channel("invoices_live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "invoices" }, (payload) => {
        setInvoices((prev) => (prev.some((v) => v.id === payload.new.id) ? prev : [...prev, mapInvoice(payload.new)]));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "invoices" }, (payload) => {
        setInvoices((prev) => prev.map((v) => (v.id === payload.new.id ? mapInvoice(payload.new) : v)));
      })
      .subscribe();

    // Same idea for payments — a payment recorded from a different staff
    // session or device should update everyone's view of the balance without
    // a manual refresh. Payments are never edited or deleted once recorded
    // (a mistake gets corrected with another entry), so only INSERT matters.
    const paymentsChannel = supabase
      .channel("payments_live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "payments" }, (payload) => {
        setPayments((prev) => (prev.some((p) => p.id === payload.new.id) ? prev : [...prev, mapPayment(payload.new)]));
      })
      .subscribe();

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      supabase.removeChannel(requestsChannel);
      supabase.removeChannel(bookingsChannel);
      supabase.removeChannel(invoicesChannel);
      supabase.removeChannel(paymentsChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Advances a request's stage from the provider side. Kitchen/Counter items
  // move sent → preparing → delivered (the final "confirmed" step belongs to
  // the guest). Everything else moves sent → handled (the guest then confirms
  // "received" from their own portal).
  async function advanceRequestStage(id, nextStage) {
    setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, stage: nextStage } : r)));
    try {
      const { error } = await supabase.from("service_requests").update({ stage: nextStage }).eq("id", id);
      if (error) throw error;
    } catch (e) {
      // handled locally; will reconcile next successful fetch — request-handling isn't queued
      // since it's low-stakes and the live subscription will correct it once back online.
    }
  }

  if (session === undefined) {
    return (
      <div style={{ minHeight: "560px", display: "flex", alignItems: "center", justifyContent: "center", background: C.paper, color: C.inkSoft }}>
        {FONTS}
        <p className="ws">Loading…</p>
      </div>
    );
  }
  if (!session) return <Login onSignIn={setSession} onBack={onExit} />;
  if (dataLoading || !branchId) {
    return (
      <div style={{ minHeight: "560px", display: "flex", alignItems: "center", justifyContent: "center", background: C.paper, color: C.inkSoft }}>
        {FONTS}
        <p className="ws">Loading…</p>
      </div>
    );
  }

  // Owner and manager share almost all operational authority — edit/delete
  // bookings & clients, see client ID numbers, see historical/occupancy data.
  // Two things stay owner-exclusive regardless: voiding an invoice (a
  // deliberate financial write-off) and team/role management (who has
  // authority at all) — everything else, manager runs it like they own it.
  const canManage = role === "owner" || role === "manager";

  const branch = branches.find((b) => b.id === branchId);
  const inBranch = (arr) => arr.filter((x) => x.branchId === branchId);
  const bClients = inBranch(clients);
  const bServices = inBranch(services);
  const bBookings = inBranch(bookings);
  const bInquiries = inBranch(inquiries);
  const bTags = inBranch(tags);
  const bInvoices = inBranch(invoices);
  const bRooms = inBranch(rooms);

  // Clients with an active (pending/confirmed) booking float to the top,
  // ranked by their most recent check-in; then completed, then cancelled,
  // then clients with no bookings at all sink to the bottom.
  const STATUS_RANK = { confirmed: 3, pending: 3, completed: 2, cancelled: 1 };
  const clientActivity = {};
  bBookings.forEach((bk) => {
    const rank = STATUS_RANK[bk.status] || 0;
    const dateVal = bk.checkIn && bk.checkIn !== "TBC" ? new Date(bk.checkIn).getTime() : 0;
    const score = rank * 1e15 + dateVal;
    if (!clientActivity[bk.clientId] || score > clientActivity[bk.clientId]) clientActivity[bk.clientId] = score;
  });
  const sortedClients = [...bClients].sort((a, b) => (clientActivity[b.id] ?? -1) - (clientActivity[a.id] ?? -1));

  const searchedClients = clientSearch.trim()
    ? sortedClients.filter((c) => {
        const q = clientSearch.trim().toLowerCase();
        return c.name.toLowerCase().includes(q) || (c.phone || "").toLowerCase().includes(q);
      })
    : sortedClients;

  // Lifetime bookings count + total paid spend for a client — shown inline
  // on their card, and behind the "View history" link for the full list.
  // "Spend" is now the actual sum of payments (refunds already subtract,
  // since those are stored as negative amounts) across their bookings,
  // rather than the full amount of invoices someone once marked "paid".
  function clientStats(clientId) {
    const clientBookings = bookings.filter((b) => b.clientId === clientId);
    const bookingIds = new Set(clientBookings.map((b) => b.id));
    const totalSpend = payments
      .filter((p) => bookingIds.has(p.bookingId))
      .reduce((sum, p) => sum + p.amount, 0);
    return { bookingCount: clientBookings.length, totalSpend, clientBookings };
  }

  // Same idea for the Bookings tab itself — active bookings (pending/confirmed)
  // on top, most recent check-in first, so real current activity isn't buried
  // under old completed/cancelled or historical test bookings.
  const sortedBookings = [...bBookings].sort((a, b) => {
    const rankA = STATUS_RANK[a.status] || 0;
    const rankB = STATUS_RANK[b.status] || 0;
    if (rankA !== rankB) return rankB - rankA;
    const dateA = a.checkIn && a.checkIn !== "TBC" ? new Date(a.checkIn).getTime() : 0;
    const dateB = b.checkIn && b.checkIn !== "TBC" ? new Date(b.checkIn).getTime() : 0;
    return dateB - dateA;
  });

  const clientName = (id) => clients.find((c) => c.id === id)?.name || "—";
  const serviceNames = (ids) => ids.map((id) => services.find((s) => s.id === id)?.name).join(", ");
  const roomLabel = (bk) => {
    const room = rooms.find((r) => r.id === bk.roomId);
    if (room) return `${room.roomNumber} · ${room.roomType}`;
    return bk.roomNumber || "—";
  };

  const bExpenses = inBranch(expenses);
  const bPayments = inBranch(payments);
  const paidForBooking = (bookingId) => bPayments.filter((p) => p.bookingId === bookingId).reduce((sum, p) => sum + p.amount, 0);

  // "Collected" is simply every payment (and refund, since those are already
  // negative) recorded in this branch — a direct cash figure rather than
  // something derived from invoice status. "Outstanding" is what's still
  // owed on every non-void invoice, using the same paid-so-far figure that
  // powers the balance shown on each invoice.
  const revenue = bPayments.reduce((sum, p) => sum + p.amount, 0);
  const outstanding = bInvoices
    .filter((v) => v.status !== "void")
    .reduce((sum, v) => sum + Math.max(0, v.amount - paidForBooking(v.bookingId)), 0);

  // Dashboard "today" figures — separate from Finance's all-time revenue/
  // outstanding above, since these answer a different question ("what
  // happened today") rather than "what's the running total ever." Basing
  // revenueToday on payments (not invoices) is what keeps a deposit-and-
  // balance split across two different days honest — each payment counts
  // on the day it actually happened, not the day the booking was made.
  const today = todayStr();
  const activeBookingsToday = bBookings.filter((b) => isBookingActiveOn(b, today));
  const occupiedRoomIdsToday = new Set(activeBookingsToday.map((b) => b.roomId).filter(Boolean));
  const roomsAvailableToday = bRooms.length - occupiedRoomIdsToday.size;
  const revenueToday = bPayments
    .filter((p) => p.paidAt && p.paidAt.slice(0, 10) === today)
    .reduce((sum, p) => sum + p.amount, 0);
  const outstandingToday = bInvoices
    .filter((v) => v.status !== "void" && bBookings.some((bk) => bk.id === v.bookingId && isBookingActiveOn(bk, today)))
    .reduce((sum, v) => sum + Math.max(0, v.amount - paidForBooking(v.bookingId)), 0);

  async function simulateTap(tagId) {
    const tag = tags.find((t) => t.id === tagId);
    if (!tag) return;
    const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setTags((prev) => prev.map((t) => (t.id === tagId ? { ...t, lastScan: stamp } : t)));
    setTapFlash(tagId);
    setTimeout(() => setTapFlash(null), 1000);

    const inquiryPayload =
      tag.type === "Service request"
        ? { branch_id: tag.branchId, client_id: bClients[0]?.id || null, message: "Tap request from " + tag.label, status: "new" }
        : null;

    try {
      const { error } = await supabase.from("tags").update({ last_scan: stamp }).eq("id", tagId);
      if (error) throw error;
      if (inquiryPayload) {
        const { data, error: iqErr } = await supabase.from("inquiries").insert(inquiryPayload).select().single();
        if (iqErr) throw iqErr;
        if (data) setInquiries((prev) => [mapInquiry(data), ...prev]);
      }
    } catch (e) {
      enqueueAction({ type: "tapTag", payload: { tagId, stamp, inquiry: inquiryPayload } });
      setPendingCount(queueCount());
      if (inquiryPayload) {
        setInquiries((prev) => [{ id: "pending-" + Date.now(), branchId: inquiryPayload.branch_id, clientId: inquiryPayload.client_id, message: inquiryPayload.message, status: inquiryPayload.status }, ...prev]);
      }
    }
  }

  async function moveInquiry(id, dir) {
    const iq = inquiries.find((x) => x.id === id);
    if (!iq) return;
    const idx = INQUIRY_STAGES.indexOf(iq.status);
    const next = INQUIRY_STAGES[Math.min(Math.max(idx + dir, 0), INQUIRY_STAGES.length - 1)];
    setInquiries((prev) => prev.map((x) => (x.id === id ? { ...x, status: next } : x)));
    try {
      const { error } = await supabase.from("inquiries").update({ status: next }).eq("id", id);
      if (error) throw error;
    } catch (e) {
      enqueueAction({ type: "updateInquiryStatus", payload: { id, status: next } });
      setPendingCount(queueCount());
    }
  }

  async function updateBookingStatus(id, status) {
    const bk = bookings.find((b) => b.id === id);
    setBookings((prev) => prev.map((bk) => (bk.id === id ? { ...bk, status } : bk)));
    try {
      const { error } = await supabase.from("bookings").update({ status }).eq("id", id);
      if (error) throw error;
    } catch (e) {
      enqueueAction({ type: "updateBookingStatus", payload: { id, status } });
      setPendingCount(queueCount());
    }

    // Invoices are created the moment a booking is made (see AddBookingModal's
    // onSave below), so this is just a safety net for anything that somehow
    // reached "confirmed" without one — e.g. a booking created while offline.
    // There's no "cancelled" status anymore — a guest who backs out gets
    // checked out instead, so the room reads as previously sold rather than
    // erased. If that stay shouldn't be billed, the owner voids the invoice
    // directly (Finance or Bookings tab) — that's a deliberate financial
    // write-off now, not an automatic side effect of a status change.
    if (!bk) return;
    const existingInvoice = invoices.find((v) => v.bookingId === id);

    if (status === "confirmed" && !existingInvoice) {
      const amount = computeInvoiceAmount(bk, rooms, roomRates, services);
      const payload = { branch_id: branchId, booking_id: id, amount, status: "outstanding" };
      try {
        const { data, error } = await supabase.from("invoices").insert(payload).select().single();
        if (error) throw error;
        setInvoices((prev) => [...prev, mapInvoice(data)]);
      } catch (e) {
        enqueueAction({ type: "addInvoice", payload });
        setPendingCount(queueCount());
        setInvoices((prev) => [...prev, { id: "temp-" + Date.now(), branchId, bookingId: id, amount, status: "outstanding" }]);
      }
    }
  }

  async function fetchTeam() {
    setTeamLoading(true);
    const { data } = await supabase.from("profiles").select("*").order("email");
    setTeamMembers(data || []);
    setTeamLoading(false);
  }

  async function setMemberRole(id, newRole) {
    const prevMembers = teamMembers;
    setTeamMembers((prev) => prev.map((m) => (m.id === id ? { ...m, role: newRole } : m)));
    const { error } = await supabase.from("profiles").update({ role: newRole }).eq("id", id);
    if (error) {
      setTeamMembers(prevMembers); // roll back — the database rejected it, don't show a role that isn't real
      alert("Couldn't update that role: " + error.message);
    }
  }

  async function addExpense(description, amount) {
    const id = newId();
    const payload = { id, branch_id: branchId, description, amount, created_by: session.user.id };
    const expense = mapExpense({ id, branch_id: branchId, description, amount, created_at: new Date().toISOString() });
    setExpenses((prev) => [...prev, expense]);
    try {
      const { error } = await supabase.from("expenses").insert(payload);
      if (error) throw error;
    } catch (e) {
      enqueueAction({ type: "addExpense", payload });
      setPendingCount(queueCount());
    }
  }

  // Services aren't typically created in a rush at the front desk the way a
  // booking or payment is, so unlike those, this goes straight to Supabase
  // rather than through the offline queue — simpler, and a failure here is
  // rare enough that a plain retry is the reasonable answer.
  async function saveService(fields) {
    const payload = {
      branch_id: branchId,
      name: fields.name,
      category: fields.category,
      price: fields.price,
      billing_unit: fields.billingUnit,
      is_available: fields.isAvailable,
      image_url: fields.imageUrl || null,
    };
    try {
      if (fields.id) {
        const { data, error } = await supabase.from("services").update(payload).eq("id", fields.id).select().single();
        if (error) throw error;
        setServices((prev) => prev.map((s) => (s.id === fields.id ? mapService(data) : s)));
      } else {
        const id = newId();
        const { data, error } = await supabase.from("services").insert({ id, ...payload }).select().single();
        if (error) throw error;
        setServices((prev) => [...prev, mapService(data)]);
      }
      setShowAddService(false);
      setEditingService(null);
    } catch (e) {
      alert("Couldn't save that service: " + (e.message || "please try again."));
    }
  }

  async function deleteService(id) {
    try {
      const { error } = await supabase.from("services").delete().eq("id", id);
      if (error) throw error;
      setServices((prev) => prev.filter((s) => s.id !== id));
      setEditingService(null);
    } catch (e) {
      alert("Couldn't delete that service: " + (e.message || "please try again."));
    }
  }

  // The one-click availability toggle right on the catalog row — forward-
  // looking only: it stops the item from being ordered again, but doesn't
  // touch any request already placed against it before the toggle.
  async function toggleServiceAvailability(service) {
    const nextAvailable = !service.isAvailable;
    setServices((prev) => prev.map((s) => (s.id === service.id ? { ...s, isAvailable: nextAvailable } : s)));
    try {
      const { error } = await supabase.from("services").update({ is_available: nextAvailable }).eq("id", service.id);
      if (error) throw error;
    } catch (e) {
      setServices((prev) => prev.map((s) => (s.id === service.id ? { ...s, isAvailable: !nextAvailable } : s)));
      alert("Couldn't update availability: " + (e.message || "please try again."));
    }
  }

  // Staff logging an order on the guest's behalf (e.g. a counter purchase
  // that never touches the Guest portal) — same shape as a guest-initiated
  // request, just with no access code attached, so it shows up in the
  // Requests tab and the accounting ledger the same way a guest order would.
  async function logStaffOrder(booking, item, qty) {
    const room = rooms.find((r) => r.id === booking.roomId);
    const qtyLabel = qty > 1 ? ` × ${qty}` : "";
    const priceLabel = item.price > 0 ? `TSh ${Number(item.price).toLocaleString()}` : "Free";
    const payload = {
      code: null,
      guest_name: clientName(booking.clientId),
      room_number: room ? room.roomNumber : null,
      room_type: room ? room.roomType : null,
      category: item.category,
      quantity: qty,
      amount: item.price * qty,
      stage: "handled", // logged after the fact by staff, so it's already fulfilled
      message: `${clientName(booking.clientId)} requested ${item.name}${qtyLabel} (${priceLabel}) — logged by staff`,
    };
    const { data, error } = await supabase.from("service_requests").insert(payload).select().single();
    if (!error && data) setRequests((prev) => [data, ...prev]);
    return !error;
  }

  // Voiding is the one financial action that erases money owed rather than
  // recording more of it, so it stays a deliberate owner-only write-off —
  // paid/outstanding/partial are never set directly, only ever derived from
  // the payments actually recorded (see invoiceBalance).
  async function voidInvoice(id) {
    if (role !== "owner") return;
    setInvoices((prev) => prev.map((v) => (v.id === id ? { ...v, status: "void" } : v)));
    try {
      const { error } = await supabase.from("invoices").update({ status: "void" }).eq("id", id);
      if (error) throw error;
    } catch (e) {
      enqueueAction({ type: "updateInvoiceStatus", payload: { id, status: "void" } });
      setPendingCount(queueCount());
    }
  }

  // Any signed-in role can record an ordinary payment — this is what used to
  // be "mark paid", just now backed by a real amount instead of a flipped
  // status. A refund (a negative amount) stays owner-only, mirroring void;
  // this is also enforced server-side by the payments table's RLS policy.
  async function recordPayment({ amount, note, kind }) {
    if (!paymentModal) return false;
    if (kind === "refund" && role !== "owner") return false;
    const invoice = paymentModal.invoice;
    const id = newId();
    const payload = { id, branch_id: branchId, booking_id: invoice.bookingId, amount, kind, note: note || null, recorded_by: session.user.id };
    setPayments((prev) => [...prev, mapPayment({ ...payload, paid_at: new Date().toISOString() })]);
    try {
      const { error } = await supabase.from("payments").insert(payload);
      if (error) throw error;
    } catch (e) {
      enqueueAction({ type: "addPayment", payload, tempId: id });
      setPendingCount(queueCount());
    }
    return true;
  }

  // Shared invoice control used on the Bookings tab, Finance tab, and client
  // history — a live balance (paid so far / remaining) plus whichever actions
  // the signed-in role can take. Everyone can record a payment; only the
  // owner can issue a refund or void, matching how void already worked.
  function invoiceControl(invoice) {
    if (!invoice) return <span style={{ fontSize: "12.5px", color: C.inkSoft }}>—</span>;
    const balance = invoiceBalance(invoice, payments);
    if (balance.status === "void") {
      return <Pill tone="void">void</Pill>;
    }
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "5px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <Pill tone={balance.status}>{balance.status}</Pill>
          <span style={{ fontSize: "11.5px", color: C.inkSoft, whiteSpace: "nowrap" }}>
            {money(balance.paid)} of {money(invoice.amount)}
          </span>
        </div>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          <button
            onClick={() => setPaymentModal({ invoice, kind: "payment" })}
            style={{ fontSize: "12px", border: "none", background: C.signal, color: "#fff", borderRadius: "6px", padding: "4px 10px", cursor: "pointer" }}
          >
            Record payment
          </button>
          {role === "owner" && (
            <>
              <button
                onClick={() => setPaymentModal({ invoice, kind: "refund" })}
                style={{ fontSize: "12px", border: `1px solid ${C.line}`, background: "none", color: C.red, borderRadius: "6px", padding: "4px 10px", cursor: "pointer" }}
              >
                Refund
              </button>
              <button
                onClick={() => voidInvoice(invoice.id)}
                style={{ fontSize: "12px", border: "none", background: "none", color: C.inkSoft, borderRadius: "6px", padding: "4px 6px", cursor: "pointer" }}
              >
                Void
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  async function saveBookingEdit(id, updates) {
    if (!canManage) return; // enforced server-side too — see the accompanying SQL note
    if (!isRoomAvailable(updates.roomId, updates.checkIn, updates.checkOut, bBookings, id)) {
      alert("That room is already booked for the selected dates. Please choose a different room or date range.");
      return;
    }
    const dbUpdates = {
      client_id: updates.clientId,
      room_id: updates.roomId || null,
      service_ids: updates.serviceIds,
      check_in: updates.checkIn,
      check_out: updates.checkOut,
      check_in_time: updates.checkInTime || null,
      check_out_time: updates.checkOutTime || null,
      is_temporary: updates.isTemporary || false,
    };
    setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, ...updates } : b)));
    try {
      const { error } = await supabase.from("bookings").update(dbUpdates).eq("id", id);
      if (error) throw error;
    } catch (e) {
      if (e?.message?.includes("already booked")) {
        alert("That room is already booked for the selected dates. Please choose a different room or date range.");
        return;
      }
      enqueueAction({ type: "editBooking", payload: { id, updates: dbUpdates } });
      setPendingCount(queueCount());
    }

    // Keep the invoice amount live while nothing's final yet — the moment a
    // booking is confirmed, or the invoice is voided, this stops touching it.
    // "Outstanding" is no longer a status invoices sit in on purpose (that's
    // derived from payments now) — void is the only status this needs to
    // check for.
    const bk = bookings.find((b) => b.id === id);
    const inv = invoices.find((v) => v.bookingId === id);
    if (bk && bk.status === "pending" && inv && inv.status !== "void") {
      const newAmount = computeInvoiceAmount(updates, rooms, roomRates, services);
      if (newAmount !== inv.amount) {
        setInvoices((prev) => prev.map((v) => (v.id === inv.id ? { ...v, amount: newAmount } : v)));
        try {
          const { error: invError } = await supabase.from("invoices").update({ amount: newAmount }).eq("id", inv.id);
          if (invError) throw invError;
        } catch (e2) {
          enqueueAction({ type: "updateInvoiceAmount", payload: { id: inv.id, amount: newAmount } });
          setPendingCount(queueCount());
        }
      }
    }

    setEditingBooking(null);
  }

  async function deleteBooking(id) {
    if (!canManage) return; // enforced server-side too — see the accompanying SQL note
    if (!window.confirm("Delete this booking? This can't be undone.")) return;
    setBookings((prev) => prev.filter((b) => b.id !== id));
    try {
      const { error } = await supabase.from("bookings").delete().eq("id", id);
      if (error) throw error;
    } catch (e) {
      enqueueAction({ type: "deleteBooking", payload: { id } });
      setPendingCount(queueCount());
    }
  }

  async function deleteClient(id) {
    if (!canManage) return; // enforced server-side too — see the accompanying SQL note
    if (!window.confirm("Delete this client? This can't be undone.")) return;
    const prevClients = clients;
    setClients((prev) => prev.filter((c) => c.id !== id));
    try {
      const { error } = await supabase.from("clients").delete().eq("id", id);
      if (error) throw error;
    } catch (e) {
      if (e?.code === "23503") {
        setClients(prevClients);
        alert("Can't delete this client — they have existing bookings. Remove those first.");
      } else {
        enqueueAction({ type: "deleteClient", payload: { id } });
        setPendingCount(queueCount());
      }
    }
  }

  async function generateGuestCode(bk) {
    setGeneratingId(bk.id);
    const code = "UTU-" + Math.floor(1000 + Math.random() * 9000);
    const checkoutDate = bk.checkOut && bk.checkOut !== "TBC" ? bk.checkOut : new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const expiresAt = `${checkoutDate}T12:00:00`;
    const inv = invoices.find((v) => v.bookingId === bk.id);
    const room = rooms.find((r) => r.id === bk.roomId);
    const entry = {
      code,
      branch_id: branchId,
      booking_id: bk.id,
      guest_name: clientName(bk.clientId),
      room_number: room ? room.roomNumber : (bk.roomNumber || null),
      room_type: room ? room.roomType : null,
      service_names: serviceNames(bk.serviceIds),
      check_in: bk.checkIn,
      check_out: bk.checkOut,
      status: bk.status,
      invoice_amount: inv ? inv.amount : null,
      invoice_status: inv ? inv.status : null,
      expires_at: expiresAt,
    };
    const ok = await onGenerateCode(entry);
    setGeneratingId(null);
    if (ok) setGeneratedCode(entry);
  }

  const newRequestCount = requests.filter((r) => (r.stage || "sent") === "sent").length;

  // Staff only ever see today's requests — history is a manager/owner view,
  // consistent with the same "staff get today's actionable state, not
  // historical patterns" rule applied to occupancy and client records.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const visibleRequests = canManage && showAllRequests
    ? requests
    : requests.filter((r) => new Date(r.created_at) >= todayStart);

  const NAV = [
    { id: "dashboard", label: "Dashboard", icon: LayoutGrid },
    { id: "requests", label: "Requests", icon: Bell, badge: newRequestCount || null },
    { id: "bookings", label: "Bookings", icon: CalendarDays },
    { id: "clients", label: "Clients", icon: Users },
    { id: "inquiries", label: "Inquiries", icon: MessageSquareText },
    { id: "services", label: "Services", icon: Wrench },
    { id: "tags", label: "NFC tags", icon: Radio },
    { id: "finance", label: "Finance", icon: Wallet },
    ...(role === "owner" ? [{ id: "team", label: "Team", icon: Shield }] : []),
  ];

  return (
    <div className="ws" style={{ display: "flex", height: "100vh", background: C.paper, color: C.ink, position: "relative", overflowX: "hidden", overflowY: "hidden" }}>
      {FONTS}

      {/* Backdrop for the mobile sidebar drawer */}
      {isMobile && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(22,35,59,0.4)", zIndex: 15 }}
        />
      )}

      {/* Sidebar — stays put while only the content column scrolls, so the
          menu is always one click away without scrolling back up. */}
      <div style={{
        width: "220px", background: C.ink, padding: "20px 14px", display: "flex", flexDirection: "column", flexShrink: 0, overflowY: "auto",
        ...(isMobile
          ? {
              position: "fixed", top: 0, bottom: 0, left: 0, zIndex: 16,
              transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)",
              transition: "transform 200ms ease", boxShadow: sidebarOpen ? "4px 0 16px rgba(0,0,0,0.2)" : "none"
            }
          : {})
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "9px", padding: "0 6px 20px" }}>
          <div style={{ width: "26px", height: "26px", borderRadius: "7px", background: "rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Radio size={14} color={C.signal} />
          </div>
          <span className="fr" style={{ color: "#fff", fontSize: "16px", fontWeight: 500 }}>Utulivu</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          {NAV.map((n) => (
            <NavItem key={n.id} icon={n.icon} label={n.label} active={tab === n.id} onClick={() => { setTab(n.id); setSidebarOpen(false); }} badge={n.badge} />
          ))}
        </div>
        <div style={{ marginTop: "auto", padding: "12px 6px 0", borderTop: "1px solid rgba(255,255,255,0.12)" }}>
          <p style={{ color: "rgba(255,255,255,0.5)", fontSize: "12px", margin: "12px 0 2px" }}>{session.user.email}</p>
          {role && <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "11px", margin: "0 0 6px", textTransform: "capitalize" }}>{role}</p>}
          <div style={{ display: "flex", gap: "12px" }}>
            <button onClick={() => supabase.auth.signOut()} className="ws" style={{ background: "none", border: "none", color: "rgba(255,255,255,0.55)", fontSize: "12px", cursor: "pointer", padding: 0 }}>
              Sign out
            </button>
            {onExit && (
              <button onClick={onExit} className="ws" style={{ background: "none", border: "none", color: "rgba(255,255,255,0.55)", fontSize: "12px", cursor: "pointer", padding: 0 }}>
                ← Switch portal
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Top bar */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px",
          padding: isMobile ? "14px 16px" : "16px 28px", borderBottom: `1px solid ${C.line}`, position: "relative", flexShrink: 0
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {isMobile && (
              <button onClick={() => setSidebarOpen(true)} style={{ background: "none", border: `1px solid ${C.line}`, borderRadius: "7px", padding: "8px", cursor: "pointer", display: "flex" }}>
                <Menu size={18} color={C.ink} />
              </button>
            )}
            <h2 className="fr" style={{ margin: 0, fontSize: isMobile ? "18px" : "21px", fontWeight: 500, textTransform: "capitalize" }}>
              {tab === "tags" ? "NFC tags" : tab}
            </h2>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <ConnectionBadge isOnline={isOnline} usingCache={usingCache} syncing={syncing} pendingCount={pendingCount} />
          {syncFailures.length > 0 && (
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setShowSyncFailures((s) => !s)}
                className="ws"
                style={{ background: "#F3DEDE", color: C.red, border: "none", borderRadius: "999px", padding: "5px 11px", fontSize: "12px", fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" }}
              >
                {syncFailures.length} sync issue{syncFailures.length === 1 ? "" : "s"}
              </button>
              {showSyncFailures && (
                <div style={{
                  position: "absolute", right: 0, top: "34px", background: C.paperRaised,
                  border: `1px solid ${C.line}`, borderRadius: "8px", boxShadow: "0 6px 18px rgba(22,35,59,0.12)",
                  width: "280px", zIndex: 10, maxHeight: "320px", overflowY: "auto"
                }}>
                  {syncFailures.map((f, i) => (
                    <div key={f.action.id} style={{ padding: "10px 14px", borderTop: i === 0 ? "none" : `1px solid ${C.line}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                        <div style={{ fontSize: "13px", fontWeight: 500 }}>{FAILED_ACTION_LABELS[f.action.type] || f.action.type}</div>
                        <button
                          onClick={() => setSyncFailures((prev) => prev.filter((x) => x.action.id !== f.action.id))}
                          style={{ background: "none", border: "none", cursor: "pointer", color: C.inkSoft, flexShrink: 0 }}
                        >
                          <X size={13} />
                        </button>
                      </div>
                      <div style={{ fontSize: "11.5px", color: C.inkSoft, marginTop: "2px" }}>{f.message}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setShowBranchMenu((s) => !s)}
              style={{
                display: "flex", alignItems: "center", gap: "8px", background: C.paperRaised,
                border: `1px solid ${C.line}`, borderRadius: "8px", padding: "8px 12px", cursor: "pointer", fontSize: "14px"
              }}
            >
              <Building2 size={15} color={C.clay} />
              {branch.name}
              <ChevronDown size={14} />
            </button>
            {showBranchMenu && (
              <div style={{
                position: "absolute", right: 0, top: "42px", background: C.paperRaised,
                border: `1px solid ${C.line}`, borderRadius: "8px", boxShadow: "0 6px 18px rgba(22,35,59,0.12)",
                width: "220px", zIndex: 10
              }}>
                {branches.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => { setBranchId(b.id); setShowBranchMenu(false); }}
                    style={{
                      display: "block", width: "100%", textAlign: "left", padding: "10px 14px",
                      border: "none", background: b.id === branchId ? C.paper : "transparent", cursor: "pointer", fontSize: "13.5px"
                    }}
                  >
                    <div style={{ fontWeight: 500 }}>{b.name}</div>
                    <div style={{ fontSize: "12px", color: C.inkSoft }}>{b.location}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: isMobile ? "16px" : "24px 28px", overflowY: "auto", flex: 1 }}>

          {tab === "dashboard" && (
            <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? "10px" : "16px" }}>
              <h3 className="fr" style={{ margin: 0, fontSize: "16px", fontWeight: 500, color: C.inkSoft }}>
                Today · {new Date().toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}
              </h3>

              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: isMobile ? "10px" : "16px" }}>
                {[
                  ["Active bookings today", activeBookingsToday.length],
                  ["Rooms available", roomsAvailableToday],
                  ...(canManage ? [
                    ["Revenue today", money(revenueToday)],
                    ["Outstanding today", money(outstandingToday)],
                  ] : []),
                ].map(([label, val]) => (
                  <div key={label} style={{ background: C.paperRaised, border: `1px solid ${C.line}`, borderRadius: "10px", padding: "18px" }}>
                    <div style={{ fontSize: "12.5px", color: C.inkSoft, marginBottom: "8px" }}>{label}</div>
                    <div className="fr" style={{ fontSize: "24px", fontWeight: 500 }}>{val}</div>
                  </div>
                ))}
              </div>

              <Panel title="Rooms">
                <RoomGrid rooms={bRooms} bookings={bBookings} clientName={clientName} canManage={canManage} />
              </Panel>

              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? "10px" : "16px" }}>
                <ExpensesPanel
                  expenses={bExpenses}
                  canManage={canManage}
                  showAll={showAllExpenses}
                  onToggleShowAll={() => setShowAllExpenses((s) => !s)}
                  onAdd={addExpense}
                />
                <Panel title="Recent inquiries">
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {bInquiries.slice(0, 4).map((iq) => (
                      <div key={iq.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.line}` }}>
                        <div>
                          <div style={{ fontSize: "14px", fontWeight: 500 }}>{clientName(iq.clientId)}</div>
                          <div style={{ fontSize: "13px", color: C.inkSoft }}>{iq.message}</div>
                        </div>
                        <Pill tone={iq.status}>{iq.status}</Pill>
                      </div>
                    ))}
                    {bInquiries.length === 0 && (
                      <span style={{ fontSize: "12.5px", color: C.inkSoft }}>No inquiries yet.</span>
                    )}
                  </div>
                </Panel>
              </div>
            </div>
          )}

          {tab === "requests" && (
            <Panel
              title="Guest requests"
              action={
                canManage && (
                  <button
                    onClick={() => setShowAllRequests((s) => !s)}
                    style={{ fontSize: "12.5px", border: `1px solid ${C.line}`, background: "none", borderRadius: "6px", padding: "6px 12px", cursor: "pointer", color: C.clayDeep }}
                  >
                    {showAllRequests ? "Show today only" : "View previous days"}
                  </button>
                )
              }
            >
              <p style={{ fontSize: "13.5px", color: C.inkSoft, marginTop: 0, marginBottom: "18px" }}>
                Live requests sent from the Guest portal — this list updates automatically, no refresh needed.
                {!canManage && " Showing today's requests."}
              </p>
              {visibleRequests.length === 0 ? (
                <p style={{ fontSize: "13.5px", color: C.inkSoft }}>{showAllRequests ? "No requests found." : "No requests yet today."}</p>
              ) : (
                <RequestsPanel requests={visibleRequests} onAdvance={advanceRequestStage} />
              )}
            </Panel>
          )}

          {tab === "bookings" && (
            <Panel
              title="Bookings"
              action={
                <button onClick={() => setShowAddBooking(true)} style={{ display: "flex", alignItems: "center", gap: "6px", background: C.clay, color: "#fff", border: "none", borderRadius: "7px", padding: "8px 13px", fontSize: "13.5px", cursor: "pointer" }}>
                  <Plus size={15} /> New booking
                </button>
              }
            >
              <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: C.inkSoft, fontSize: "12.5px" }}>
                    <th style={{ paddingBottom: "10px" }}>Room</th>
                    <th>Client</th>
                    <th>Services</th>
                    <th>Duration</th>
                    <th>Status</th>
                    <th>Payment</th>
                    <th>Guest access</th>
                    {canManage && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {sortedBookings.map((bk) => {
                    const inv = invoices.find((v) => v.bookingId === bk.id);
                    return (
                    <tr key={bk.id} style={{ borderTop: `1px solid ${C.line}` }}>
                      <td style={{ padding: "10px 0" }}><RoomBadge room={rooms.find((r) => r.id === bk.roomId)} fallback={bk.roomNumber} /></td>
                      <td>{clientName(bk.clientId)}</td>
                      <td>{serviceNames(bk.serviceIds)}</td>
                      <td><DurationDisplay booking={bk} /></td>
                      <td><StatusPicker value={bk.status} onChange={(s) => updateBookingStatus(bk.id, s)} /></td>
                      <td>{invoiceControl(inv)}</td>
                      <td>
                        <button
                          onClick={() => generateGuestCode(bk)}
                          disabled={generatingId === bk.id}
                          style={{ fontSize: "12.5px", border: `1px solid ${C.line}`, background: "none", borderRadius: "6px", padding: "5px 10px", cursor: generatingId === bk.id ? "default" : "pointer", color: C.clayDeep, opacity: generatingId === bk.id ? 0.6 : 1 }}
                        >
                          {generatingId === bk.id ? "Generating…" : "Generate code"}
                        </button>
                      </td>
                      {canManage && (
                        <td>
                          <div style={{ display: "flex", gap: "6px" }}>
                            <button
                              onClick={() => setEditingBooking(bk)}
                              style={{ fontSize: "12.5px", border: `1px solid ${C.line}`, background: "none", borderRadius: "6px", padding: "5px 10px", cursor: "pointer", color: C.ink }}
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => deleteBooking(bk.id)}
                              style={{ fontSize: "12.5px", border: `1px solid ${C.line}`, background: "none", borderRadius: "6px", padding: "5px 10px", cursor: "pointer", color: C.red }}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );})}
                </tbody>
              </table>
              </div>
            </Panel>
          )}

          {tab === "clients" && (
            <Panel
              title="Clients"
              action={
                <button onClick={() => setShowAddClient(true)} style={{ display: "flex", alignItems: "center", gap: "6px", background: C.clay, color: "#fff", border: "none", borderRadius: "7px", padding: "8px 13px", fontSize: "13.5px", cursor: "pointer" }}>
                  <Plus size={15} /> New client
                </button>
              }
            >
              <input
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                placeholder="Search by name or phone…"
                style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", border: `1px solid ${C.line}`, marginBottom: "14px", fontSize: "14px", boxSizing: "border-box" }}
              />
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: "14px" }}>
                {searchedClients.map((c) => {
                  const stats = clientStats(c.id);
                  return (
                  <div key={c.id} style={{ border: `1px solid ${C.line}`, borderRadius: "9px", padding: "14px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontWeight: 500, marginBottom: "4px" }}>{c.name}</div>
                      <div style={{ fontSize: "13px", color: C.inkSoft }}>{c.phone}</div>
                      {canManage && c.idNumber && (
                        <div style={{ fontSize: "12px", color: C.inkSoft, marginTop: "4px" }}>{c.idType || "ID"}: {c.idNumber}</div>
                      )}
                      {canManage && !c.idNumber && (
                        <div style={{ fontSize: "11.5px", color: C.amber, marginTop: "4px" }}>ID not on file</div>
                      )}
                      <div style={{ fontSize: "12px", color: C.inkSoft, marginTop: "6px" }}>
                        {stats.bookingCount} booking{stats.bookingCount === 1 ? "" : "s"} · {money(stats.totalSpend)} spent
                      </div>
                      {stats.bookingCount > 0 && (
                        <button
                          onClick={() => setViewingClientHistory(c)}
                          style={{ fontSize: "12px", border: "none", background: "none", color: C.clayDeep, cursor: "pointer", padding: 0, marginTop: "4px" }}
                        >
                          View history
                        </button>
                      )}
                    </div>
                    {canManage && (
                      <button
                        onClick={() => deleteClient(c.id)}
                        style={{ fontSize: "12px", border: "none", background: "none", color: C.red, cursor: "pointer", padding: "2px" }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                );})}
                {searchedClients.length === 0 && (
                  <div style={{ fontSize: "13.5px", color: C.inkSoft }}>
                    {clientSearch.trim() ? "No clients match that search." : "No clients yet for this branch."}
                  </div>
                )}
              </div>
            </Panel>
          )}

          {tab === "inquiries" && (
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(4, 1fr)", gap: "14px" }}>
              {INQUIRY_STAGES.map((stage, colIdx) => (
                <div key={stage}>
                  <div style={{ fontSize: "12.5px", fontWeight: 600, color: C.inkSoft, textTransform: "capitalize", marginBottom: "10px" }}>{stage}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {bInquiries.filter((i) => i.status === stage).map((iq) => (
                      <div key={iq.id} style={{ background: C.paperRaised, border: `1px solid ${C.line}`, borderRadius: "8px", padding: "12px" }}>
                        <div style={{ fontSize: "13.5px", fontWeight: 500 }}>{clientName(iq.clientId)}</div>
                        <div style={{ fontSize: "13px", color: C.inkSoft, margin: "4px 0 8px" }}>{iq.message}</div>
                        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                          <button disabled={colIdx === 0} onClick={() => moveInquiry(iq.id, -1)} style={{ fontSize: "12px", border: `1px solid ${C.line}`, background: "none", borderRadius: "5px", padding: "3px 7px", cursor: colIdx === 0 ? "default" : "pointer", opacity: colIdx === 0 ? 0.4 : 1 }}>← back</button>
                          <button disabled={colIdx === INQUIRY_STAGES.length - 1} onClick={() => moveInquiry(iq.id, 1)} style={{ fontSize: "12px", border: `1px solid ${C.line}`, background: "none", borderRadius: "5px", padding: "3px 7px", cursor: colIdx === 3 ? "default" : "pointer", opacity: colIdx === 3 ? 0.4 : 1 }}>advance →</button>
                          <button
                            onClick={() => { setAddBookingPrefillClientId(iq.clientId); setShowAddBooking(true); }}
                            style={{ fontSize: "12px", border: "none", background: C.signal, color: "#fff", borderRadius: "5px", padding: "3px 8px", cursor: "pointer" }}
                          >
                            Convert to booking
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "services" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <Panel
              title="Service catalog"
              action={
                <button
                  onClick={() => setShowAddService(true)}
                  style={{ display: "flex", alignItems: "center", gap: "6px", background: C.clay, color: "#fff", border: "none", borderRadius: "7px", padding: "8px 13px", fontSize: "13.5px", cursor: "pointer" }}
                >
                  <Plus size={15} /> New service
                </button>
              }
            >
              <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: C.inkSoft, fontSize: "12.5px" }}>
                    <th style={{ paddingBottom: "10px" }}></th>
                    <th>Service</th>
                    <th>Category</th>
                    <th>Price</th>
                    <th>Availability</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {bServices.map((s) => (
                    <tr key={s.id} style={{ borderTop: `1px solid ${C.line}` }}>
                      <td style={{ padding: "10px 0" }}>
                        {s.imageUrl ? (
                          <img src={s.imageUrl} alt="" style={{ width: "34px", height: "34px", borderRadius: "6px", objectFit: "cover" }} />
                        ) : (
                          <div style={{ width: "34px", height: "34px", borderRadius: "6px", border: `1px dashed ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center", color: C.inkSoft }}>
                            <ImageOff size={14} />
                          </div>
                        )}
                      </td>
                      <td>{s.name}</td>
                      <td>{s.category}</td>
                      <td>{money(s.price)}{s.billingUnit === "per_night" ? "/night" : ""}</td>
                      <td>
                        <button
                          onClick={() => toggleServiceAvailability(s)}
                          style={{
                            fontSize: "12px", fontWeight: 500, border: "none", borderRadius: "999px", padding: "4px 11px", cursor: "pointer",
                            background: s.isAvailable ? C.signalSoft : C.line, color: s.isAvailable ? "#1E6E67" : C.inkSoft,
                          }}
                        >
                          {s.isAvailable ? "Available" : "Unavailable"}
                        </button>
                      </td>
                      <td>
                        <button
                          onClick={() => setEditingService(s)}
                          style={{ background: "none", border: "none", cursor: "pointer", color: C.inkSoft, padding: "4px" }}
                          title="Edit"
                        >
                          <Pencil size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {bServices.length === 0 && (
                    <tr><td colSpan={6} style={{ padding: "14px 0", color: C.inkSoft, fontSize: "13.5px" }}>No services yet — add the first one above.</td></tr>
                  )}
                </tbody>
              </table>
              </div>
              <div style={{ marginTop: "16px", paddingTop: "16px", borderTop: `1px solid ${C.line}` }}>
                <h4 className="fr" style={{ margin: "0 0 10px", fontSize: "15px", fontWeight: 500, color: C.ink }}>Room rates</h4>
                <p style={{ fontSize: "12.5px", color: C.inkSoft, margin: "0 0 12px" }}>
                  Accommodation is priced automatically from these rates once a room is picked on a booking — there's no separate room line item to select.
                </p>
                <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: C.inkSoft, fontSize: "12.5px" }}>
                      <th style={{ paddingBottom: "10px" }}>Room type</th>
                      <th>Nightly rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roomRates.filter((rr) => rr.branchId === branchId).map((rr) => (
                      <tr key={rr.roomType} style={{ borderTop: `1px solid ${C.line}` }}>
                        <td style={{ padding: "10px 0" }}>{rr.roomType}</td>
                        <td>{money(rr.nightlyRate)}/night</td>
                      </tr>
                    ))}
                    {roomRates.filter((rr) => rr.branchId === branchId).length === 0 && (
                      <tr><td colSpan={2} style={{ padding: "10px 0", color: C.inkSoft }}>No room rates set up yet — add them in the room_rates table in Supabase.</td></tr>
                    )}
                  </tbody>
                </table>
                </div>
              </div>
            </Panel>

            <Panel
              title="Order ledger"
              action={
                <button
                  onClick={() => setShowLogOrder(true)}
                  style={{ display: "flex", alignItems: "center", gap: "6px", background: C.clay, color: "#fff", border: "none", borderRadius: "7px", padding: "8px 13px", fontSize: "13.5px", cursor: "pointer" }}
                >
                  <Plus size={15} /> Log an order
                </button>
              }
            >
              <p style={{ fontSize: "12.5px", color: C.inkSoft, marginTop: 0, marginBottom: "14px" }}>
                Every chargeable order as its own line — kept per-order rather than cumulated, since different items can come from different outside providers.
              </p>
              {(() => {
                const ledger = [...requests].filter((r) => r.amount != null).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                const ledgerTotal = ledger.reduce((sum, r) => sum + (r.amount || 0), 0);
                return ledger.length === 0 ? (
                  <p style={{ fontSize: "13.5px", color: C.inkSoft }}>No chargeable orders yet.</p>
                ) : (
                  <>
                    <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
                      <thead>
                        <tr style={{ textAlign: "left", color: C.inkSoft, fontSize: "12.5px" }}>
                          <th style={{ paddingBottom: "10px" }}>Date</th>
                          <th>Guest / room</th>
                          <th>Item</th>
                          <th>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ledger.map((r) => (
                          <tr key={r.id} style={{ borderTop: `1px solid ${C.line}` }}>
                            <td style={{ padding: "10px 0" }}>{new Date(r.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}</td>
                            <td>{r.guest_name || "—"}{r.room_number ? ` · Room ${r.room_number}` : ""}</td>
                            <td>{r.message}</td>
                            <td>{money(r.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "12px", paddingTop: "12px", borderTop: `1px solid ${C.line}` }}>
                      <span style={{ fontSize: "13px", color: C.inkSoft }}>Total</span>
                      <span className="fr" style={{ fontSize: "15px", fontWeight: 500 }}>{money(ledgerTotal)}</span>
                    </div>
                  </>
                );
              })()}
            </Panel>
            </div>
          )}

          {tab === "tags" && (
            <Panel title="NFC tags">
              <p style={{ fontSize: "13.5px", color: C.inkSoft, marginTop: 0, marginBottom: "18px" }}>
                Tap a tag below to simulate a guest or staff scan — a room tag logs a scan, a service-request tag opens a new inquiry.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(3, 1fr)", gap: "14px" }}>
                {bTags.map((t) => (
                  <div
                    key={t.id}
                    className={tapFlash === t.id ? "tap-ripple" : ""}
                    style={{ border: `1px solid ${C.line}`, borderRadius: "9px", padding: "16px", textAlign: "center" }}
                  >
                    <Radio size={20} color={C.signal} style={{ marginBottom: "8px" }} />
                    <div style={{ fontWeight: 500, fontSize: "14px" }}>{t.label}</div>
                    <div style={{ fontSize: "12.5px", color: C.inkSoft, margin: "3px 0 12px" }}>{t.type} · {t.linkedName}</div>
                    <button
                      onClick={() => simulateTap(t.id)}
                      style={{ background: C.signal, color: "#fff", border: "none", borderRadius: "7px", padding: "7px 14px", fontSize: "13px", cursor: "pointer", width: "100%" }}
                    >
                      Simulate tap
                    </button>
                    {t.lastScan && <div style={{ fontSize: "11.5px", color: C.inkSoft, marginTop: "8px" }}>Last scan: {t.lastScan}</div>}
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {tab === "finance" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "16px" }}>
                <div style={{ background: C.paperRaised, border: `1px solid ${C.line}`, borderRadius: "10px", padding: "18px" }}>
                  <div style={{ fontSize: "12.5px", color: C.inkSoft, marginBottom: "8px" }}>Collected this period</div>
                  <div className="fr" style={{ fontSize: "24px" }}>{money(revenue)}</div>
                </div>
                <div style={{ background: C.paperRaised, border: `1px solid ${C.line}`, borderRadius: "10px", padding: "18px" }}>
                  <div style={{ fontSize: "12.5px", color: C.inkSoft, marginBottom: "8px" }}>Outstanding</div>
                  <div className="fr" style={{ fontSize: "24px", color: C.red }}>{money(outstanding)}</div>
                </div>
              </div>
              <Panel title="Invoices">
                <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: C.inkSoft, fontSize: "12.5px" }}>
                      <th style={{ paddingBottom: "10px" }}>Booking</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {bInvoices.map((v) => {
                      const bk = bookings.find((b) => b.id === v.bookingId);
                      const unpaidAfterCheckout = bk?.status === "completed" && invoiceBalance(v, payments).remaining > 0;
                      return (
                        <tr key={v.id} style={{ borderTop: `1px solid ${C.line}` }}>
                          <td style={{ padding: "10px 0" }}>{bk ? clientName(bk.clientId) : "—"}</td>
                          <td>{money(v.amount)}</td>
                          <td>
                            {invoiceControl(v)}
                            {unpaidAfterCheckout && (
                              <div style={{ fontSize: "11.5px", color: C.red, marginTop: "4px" }}>Guest checked out — still unpaid</div>
                            )}
                          </td>
                          <td>
                            <button
                              onClick={() => setPrintInvoice({ invoice: v, booking: bk })}
                              style={{ fontSize: "12.5px", border: `1px solid ${C.line}`, background: "none", borderRadius: "6px", padding: "5px 10px", cursor: "pointer", color: C.clayDeep }}
                            >
                              Print
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              </Panel>
            </div>
          )}

          {tab === "team" && role === "owner" && (
            <Panel title="Team">
              <p style={{ fontSize: "13.5px", color: C.inkSoft, marginTop: 0, marginBottom: "18px" }}>
                Owner: full control, including who has access. Manager: runs day-to-day operations like an owner, but can't void invoices or manage the team. Staff: day-to-day work only — can't edit or delete bookings/clients, can't see client ID numbers, and can only mark an invoice paid.
              </p>
              {teamLoading ? (
                <p style={{ fontSize: "13.5px", color: C.inkSoft }}>Loading…</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {teamMembers.map((m) => {
                    const isSelf = m.id === session.user.id;
                    return (
                    <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px", border: `1px solid ${C.line}`, borderRadius: "9px" }}>
                      <div>
                        <div style={{ fontSize: "14px", fontWeight: 500 }}>{m.email}</div>
                        {isSelf && <div style={{ fontSize: "11.5px", color: C.inkSoft }}>This is you</div>}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <Pill tone={m.role === "owner" ? "confirmed" : m.role === "manager" ? "quoted" : "default"}>{m.role}</Pill>
                        <select
                          value={m.role}
                          disabled={isSelf}
                          onChange={(e) => setMemberRole(m.id, e.target.value)}
                          title={isSelf ? "You can't change your own role" : undefined}
                          style={{ fontSize: "12.5px", border: `1px solid ${C.line}`, borderRadius: "6px", padding: "6px 10px", background: isSelf ? C.paper : "none", color: isSelf ? C.inkSoft : C.ink, cursor: isSelf ? "default" : "pointer" }}
                        >
                          <option value="owner">owner</option>
                          <option value="manager">manager</option>
                          <option value="staff">staff</option>
                        </select>
                      </div>
                    </div>
                  );})}
                  {teamMembers.length === 0 && (
                    <p style={{ fontSize: "13.5px", color: C.inkSoft }}>No team members yet — create accounts in Supabase's Authentication → Users, and they'll appear here automatically.</p>
                  )}
                </div>
              )}
            </Panel>
          )}
        </div>
      </div>

      {/* Client booking history modal */}
      {viewingClientHistory && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(22,35,59,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 20 }}>
          <div className="ws" style={{ background: "#fff", borderRadius: "12px", padding: "24px", width: "min(480px, 92vw)", maxHeight: "80vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
              <h3 className="fr" style={{ margin: 0, fontSize: "19px" }}>{viewingClientHistory.name}</h3>
              <button onClick={() => setViewingClientHistory(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            <p style={{ fontSize: "12.5px", color: C.inkSoft, margin: "0 0 16px" }}>{viewingClientHistory.phone}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {clientStats(viewingClientHistory.id).clientBookings
                .slice()
                .sort((a, b) => new Date(b.checkIn === "TBC" ? 0 : b.checkIn) - new Date(a.checkIn === "TBC" ? 0 : a.checkIn))
                .map((bk) => {
                  const inv = invoices.find((v) => v.bookingId === bk.id);
                  return (
                    <div key={bk.id} style={{ border: `1px solid ${C.line}`, borderRadius: "8px", padding: "12px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                        <span style={{ fontSize: "13.5px" }}><RoomBadge room={rooms.find((r) => r.id === bk.roomId)} fallback={bk.roomNumber} /></span>
                        <Pill tone={bk.status}>{bk.status}</Pill>
                      </div>
                      <div style={{ fontSize: "12.5px", color: C.inkSoft }}>{formatDuration(bk.checkIn, bk.checkOut)}</div>
                      {inv && (
                        <div style={{ marginTop: "6px" }}>{invoiceControl(inv)}</div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* Printable invoice modal */}
      {printInvoice && (
        <InvoicePrintModal
          data={printInvoice}
          branch={branch}
          clientName={clientName}
          serviceNames={serviceNames}
          services={services}
          rooms={rooms}
          roomRates={roomRates}
          payments={payments}
          onClose={() => setPrintInvoice(null)}
        />
      )}

      {/* Add booking modal */}
      {showAddBooking && (
        <AddBookingModal
          clients={bClients}
          services={bServices.filter((s) => !GUEST_REQUEST_CATEGORIES.includes(s.category))}
          rooms={bRooms}
          roomRates={roomRates}
          existingBookings={bBookings}
          initialClientId={addBookingPrefillClientId}
          onClose={() => { setShowAddBooking(false); setAddBookingPrefillClientId(null); }}
          onAddClient={async (newClient) => {
            const id = newId();
            const payload = { id, branch_id: branchId, name: newClient.name, phone: newClient.phone, id_type: newClient.idType || null, id_number: newClient.idNumber || null };
            const client = mapClient(payload);
            try {
              const { error } = await supabase.from("clients").insert(payload);
              if (error) throw error;
              setClients((prev) => [...prev, client]);
              return client;
            } catch (e) {
              enqueueAction({ type: "addClient", payload, tempId: id });
              setPendingCount(queueCount());
              setClients((prev) => [...prev, client]);
              return client;
            }
          }}
          onSave={async (newBooking) => {
            if (!isRoomAvailable(newBooking.roomId, newBooking.checkIn, newBooking.checkOut, bBookings, null)) {
              alert("That room is already booked for the selected dates. Please choose a different room or date range.");
              return false;
            }
            const payload = {
              branch_id: branchId,
              client_id: newBooking.clientId,
              room_id: newBooking.roomId || null,
              service_ids: newBooking.serviceIds,
              check_in: newBooking.checkIn,
              check_out: newBooking.checkOut,
              check_in_time: newBooking.checkInTime || null,
              check_out_time: newBooking.checkOutTime || null,
              is_temporary: newBooking.isTemporary || false,
              status: newBooking.status,
            };
            try {
              const { data, error } = await supabase.from("bookings").insert(payload).select().single();
              if (error) throw error;
              const created = mapBooking(data);
              setBookings((prev) => [...prev, created]);

              // Invoice exists from creation now, not just from confirmation —
              // a walk-in who pays cash immediately has something to mark paid
              // right away, without staff needing to confirm the booking first.
              // (If this insert fails while the booking succeeded, it'll still
              // get created as a fallback the moment the booking is confirmed —
              // see updateBookingStatus.)
              const amount = computeInvoiceAmount(created, rooms, roomRates, services);
              const invoicePayload = { branch_id: branchId, booking_id: created.id, amount, status: "outstanding" };
              try {
                const { data: invData, error: invError } = await supabase.from("invoices").insert(invoicePayload).select().single();
                if (invError) throw invError;
                setInvoices((prev) => [...prev, mapInvoice(invData)]);
              } catch (invE) {
                enqueueAction({ type: "addInvoice", payload: invoicePayload });
                setPendingCount(queueCount());
                setInvoices((prev) => [...prev, { id: "temp-" + Date.now(), branchId, bookingId: created.id, amount, status: "outstanding" }]);
              }
            } catch (e) {
              if (e?.message?.includes("already booked")) {
                alert("That room is already booked for the selected dates. Please choose a different room or date range.");
                return false;
              }
              const tempBookingId = "temp-" + Date.now();
              enqueueAction({ type: "addBooking", payload, tempId: tempBookingId });
              setPendingCount(queueCount());
              setBookings((prev) => [...prev, { id: tempBookingId, branchId, clientId: newBooking.clientId, roomId: newBooking.roomId, serviceIds: newBooking.serviceIds, checkIn: newBooking.checkIn, checkOut: newBooking.checkOut, checkInTime: newBooking.checkInTime || null, checkOutTime: newBooking.checkOutTime || null, isTemporary: newBooking.isTemporary || false, status: newBooking.status }]);
              // Created while offline: no real booking id to attach an invoice to
              // yet, so this one gets its invoice at confirm-time instead (the
              // same fallback mentioned above).
            }
            setShowAddBooking(false);
            setAddBookingPrefillClientId(null);
            return true;
          }}
        />
      )}

      {/* Add client modal */}
      {showAddClient && (
        <AddClientModal
          onClose={() => setShowAddClient(false)}
          onSave={async (newClient) => {
            const id = newId();
            const payload = { id, branch_id: branchId, name: newClient.name, phone: newClient.phone, id_type: newClient.idType || null, id_number: newClient.idNumber || null };
            try {
              const { error } = await supabase.from("clients").insert(payload);
              if (error) throw error;
              setClients((prev) => [...prev, mapClient(payload)]);
            } catch (e) {
              enqueueAction({ type: "addClient", payload, tempId: id });
              setPendingCount(queueCount());
              setClients((prev) => [...prev, mapClient(payload)]);
            }
            setShowAddClient(false);
          }}
        />
      )}

      {/* Edit booking modal (owner only) */}
      {editingBooking && (
        <EditBookingModal
          booking={editingBooking}
          clients={bClients}
          services={bServices.filter((s) => !GUEST_REQUEST_CATEGORIES.includes(s.category))}
          rooms={bRooms}
          roomRates={roomRates}
          existingBookings={bBookings}
          onClose={() => setEditingBooking(null)}
          onSave={(updates) => saveBookingEdit(editingBooking.id, updates)}
        />
      )}

      {/* Log a staff-side order modal */}
      {showLogOrder && (
        <StaffOrderModal
          bookings={bBookings}
          rooms={bRooms}
          clientName={clientName}
          services={bServices.filter((s) => GUEST_REQUEST_CATEGORIES.includes(s.category))}
          onClose={() => setShowLogOrder(false)}
          onSave={logStaffOrder}
        />
      )}

      {/* Generated guest code modal */}
      {generatedCode && (
        <GeneratedCodeModal
          entry={generatedCode}
          onClose={() => setGeneratedCode(null)}
          onOpenGuest={() => {
            const code = generatedCode.code;
            setGeneratedCode(null);
            onJumpToGuest(code);
          }}
        />
      )}

      {/* Record a payment or refund against an invoice */}
      {paymentModal && (
        <PaymentModal
          invoice={paymentModal.invoice}
          kind={paymentModal.kind}
          balance={invoiceBalance(paymentModal.invoice, payments)}
          onClose={() => setPaymentModal(null)}
          onSave={recordPayment}
        />
      )}

      {/* Create or edit a service */}
      {(showAddService || editingService) && (
        <ServiceModal
          service={editingService}
          branchId={branchId}
          onClose={() => { setShowAddService(false); setEditingService(null); }}
          onSave={saveService}
          onDelete={deleteService}
        />
      )}
    </div>
  );
}

function AddClientModal({ onClose, onSave }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [idType, setIdType] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const idNumberRef = useRef(null);

  async function handleSave() {
    setSaving(true);
    await onSave({ name: name.trim(), phone: phone.trim() || "—", idType: idType || null, idNumber: idNumber.trim() || null });
    setSaving(false);
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(22,35,59,0.35)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 20
    }}>
      <div className="ws" style={{ background: "#fff", borderRadius: "12px", padding: "24px", width: "min(340px, 92vw)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h3 className="fr" style={{ margin: 0, fontSize: "19px" }}>New client</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
        </div>

        <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Full name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Halima Juma"
          style={{ width: "100%", padding: "9px", borderRadius: "7px", border: `1px solid ${C.line}`, margin: "6px 0 14px", fontSize: "14px", boxSizing: "border-box" }}
        />

        <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Phone number</label>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="e.g. +255 7XX XXX XXX"
          style={{ width: "100%", padding: "9px", borderRadius: "7px", border: `1px solid ${C.line}`, margin: "6px 0 14px", fontSize: "14px", boxSizing: "border-box" }}
        />

        <label style={{ fontSize: "12.5px", color: C.inkSoft }}>ID type (optional)</label>
        <select
          value={idType}
          onChange={(e) => {
            setIdType(e.target.value);
            if (e.target.value) setTimeout(() => idNumberRef.current?.focus(), 0);
          }}
          style={{ width: "100%", padding: "9px", borderRadius: "7px", border: `1px solid ${C.line}`, margin: "6px 0 14px", fontSize: "14px", boxSizing: "border-box" }}
        >
          <option value="">— Not recorded —</option>
          {ID_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>

        <label style={{ fontSize: "12.5px", color: C.inkSoft }}>ID number</label>
        <input
          ref={idNumberRef}
          value={idNumber}
          onChange={(e) => setIdNumber(e.target.value)}
          placeholder={idType ? `${idType} number` : "As shown on the ID"}
          style={{ width: "100%", padding: "9px", borderRadius: "7px", border: `1px solid ${C.line}`, margin: "6px 0 18px", fontSize: "14px", boxSizing: "border-box" }}
        />

        <button
          disabled={!name.trim() || saving}
          onClick={handleSave}
          style={{
            width: "100%", background: name.trim() ? C.ink : C.line, color: name.trim() ? "#fff" : C.inkSoft,
            border: "none", borderRadius: "8px", padding: "11px", fontSize: "14.5px",
            cursor: name.trim() && !saving ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
            opacity: saving ? 0.7 : 1
          }}
        >
          <Check size={16} /> {saving ? "Saving…" : "Save client"}
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Edit an existing booking — owner only (both the button that
   opens this and the underlying database write are gated to
   the owner role; staff never see this option).
--------------------------------------------------------- */
function EditBookingModal({ booking, clients, services, rooms, roomRates, existingBookings, onClose, onSave }) {
  const [clientId, setClientId] = useState(booking.clientId);
  const [roomId, setRoomId] = useState(booking.roomId || "");
  const [serviceIds, setServiceIds] = useState(booking.serviceIds);
  const [checkIn, setCheckIn] = useState(booking.checkIn === "TBC" ? "" : booking.checkIn);
  const [checkOut, setCheckOut] = useState(booking.checkOut === "TBC" ? "" : booking.checkOut);
  const [checkInTime, setCheckInTime] = useState(booking.checkInTime || "");
  const [checkOutTime, setCheckOutTime] = useState(booking.checkOutTime || "");
  const [saving, setSaving] = useState(false);
  const [bookingType, setBookingType] = useState(booking.isTemporary ? "temporary" : "overnight");
  const [convertedNotice, setConvertedNotice] = useState(false);

  const toggleService = (id) =>
    setServiceIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));

  const selectedRoom = rooms.find((r) => r.id === roomId);
  const nights = checkIn && checkOut ? nightsBetween(checkIn, checkOut) : 1;
  const isTemporary = bookingType === "temporary";
  const temporaryHours = hoursBetweenTimes(checkInTime, checkOutTime);
  const accommodationTotal = isTemporary ? TEMP_STAY.rate : rateForRoom(selectedRoom, roomRates) * nights;

  useEffect(() => {
    if (isTemporary && checkIn) setCheckOut(checkIn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTemporary, checkIn]);

  useEffect(() => {
    const resolved = resolveBookingType(bookingType, checkInTime, checkOutTime);
    if (resolved.converted) {
      setBookingType("overnight");
      setConvertedNotice(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkInTime, checkOutTime]);

  function selectBookingType(type) {
    setBookingType(type);
    setConvertedNotice(false);
    if (type === "temporary" && selectedRoom && !isRoomEligibleForTemporaryStay(selectedRoom)) {
      setRoomId("");
    }
  }

  async function handleSave() {
    setSaving(true);
    await onSave({ clientId, roomId: roomId || null, serviceIds, checkIn: checkIn || "TBC", checkOut: checkOut || "TBC", checkInTime: checkInTime || null, checkOutTime: checkOutTime || null, isTemporary });
    setSaving(false);
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(22,35,59,0.35)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 20
    }}>
      <div className="ws" style={{ background: "#fff", borderRadius: "12px", padding: "24px", width: "min(380px, 92vw)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h3 className="fr" style={{ margin: 0, fontSize: "19px" }}>Edit booking</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
        </div>

        <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Client</label>
        <select value={clientId} onChange={(e) => setClientId(e.target.value)} style={{ width: "100%", padding: "9px", borderRadius: "7px", border: `1px solid ${C.line}`, margin: "6px 0 14px", fontSize: "14px" }}>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Stay type</label>
        <div style={{ display: "flex", gap: "8px", margin: "6px 0 4px" }}>
          {["overnight", "temporary"].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => selectBookingType(t)}
              style={{
                flex: 1, padding: "9px", borderRadius: "7px", fontSize: "13.5px", cursor: "pointer",
                border: bookingType === t ? `1px solid ${C.ink}` : `1px solid ${C.line}`,
                background: bookingType === t ? C.ink : "none",
                color: bookingType === t ? "#fff" : C.ink,
              }}
            >
              {t === "overnight" ? "Overnight" : "Temporary stay"}
            </button>
          ))}
        </div>
        {isTemporary && (
          <p style={{ fontSize: "11.5px", color: C.inkSoft, margin: "0 0 10px" }}>
            Day-use only — 6am to 6pm, up to 5 hours, flat {money(TEMP_STAY.rate)}. Single and Deluxe rooms only.
          </p>
        )}
        {convertedNotice && (
          <p style={{ fontSize: "11.5px", color: C.amber, margin: "0 0 10px", fontWeight: 500 }}>
            Converted to overnight — exceeds the {TEMP_STAY.maxHours}-hr temporary-stay limit.
          </p>
        )}
        {!isTemporary && !convertedNotice && <div style={{ marginBottom: "14px" }} />}

        <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Room</label>
        <select value={roomId} onChange={(e) => setRoomId(e.target.value)} style={{ width: "100%", padding: "9px", borderRadius: "7px", border: `1px solid ${C.line}`, margin: "6px 0 6px", fontSize: "14px" }}>
          <option value="">— Select a room —</option>
          {rooms.map((r) => {
            const ineligible = isTemporary && !isRoomEligibleForTemporaryStay(r);
            return (
              <option key={r.id} value={r.id} disabled={ineligible}>
                {r.roomNumber} — {r.roomType}{ineligible ? " — not available for temporary stay" : ""}
              </option>
            );
          })}
        </select>
        {selectedRoom ? (
          <p style={{ fontSize: "12px", color: C.inkSoft, margin: "0 0 14px" }}>
            {isTemporary
              ? `${selectedRoom.roomType} · Temporary stay · ${money(accommodationTotal)} flat`
              : `${selectedRoom.roomType} · ${money(rateForRoom(selectedRoom, roomRates))}/night${checkIn && checkOut ? ` × ${nights} nights = ${money(accommodationTotal)}` : ""}`}
          </p>
        ) : (
          <div style={{ marginBottom: "14px" }} />
        )}

        <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Will they need transport?</label>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", margin: "6px 0 14px" }}>
          {services.map((s) => (
            <label key={s.id} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13.5px" }}>
              <input type="checkbox" checked={serviceIds.includes(s.id)} onChange={() => toggleService(s.id)} />
              {s.name} — {money(s.price)}{s.billingUnit === "per_night" ? "/night" : ""}
            </label>
          ))}
        </div>

        <div style={{ display: "flex", gap: "10px", marginBottom: checkIn && checkOut && checkIn === checkOut ? "6px" : "18px" }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Check-in</label>
            <input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} style={{ width: "100%", padding: "8px", borderRadius: "7px", border: `1px solid ${C.line}`, marginTop: "6px", boxSizing: "border-box" }} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Check-out</label>
            <input type="date" value={checkOut} disabled={isTemporary} onChange={(e) => setCheckOut(e.target.value)} style={{ width: "100%", padding: "8px", borderRadius: "7px", border: `1px solid ${C.line}`, marginTop: "6px", boxSizing: "border-box", background: isTemporary ? C.paper : "#fff" }} />
          </div>
        </div>
        <div style={{ display: "flex", gap: "10px", marginBottom: "14px" }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Check-in time{isTemporary ? "" : " (optional)"}</label>
            <input type="time" value={checkInTime} onChange={(e) => setCheckInTime(e.target.value)} style={{ width: "100%", padding: "8px", borderRadius: "7px", border: `1px solid ${C.line}`, marginTop: "6px", boxSizing: "border-box" }} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Check-out time{isTemporary ? "" : " (optional)"}</label>
            <input type="time" value={checkOutTime} onChange={(e) => setCheckOutTime(e.target.value)} style={{ width: "100%", padding: "8px", borderRadius: "7px", border: `1px solid ${C.line}`, marginTop: "6px", boxSizing: "border-box" }} />
          </div>
        </div>
        {isTemporary && temporaryHours != null && (
          <p style={{ fontSize: "11px", color: C.inkSoft, margin: "0 0 14px" }}>
            {temporaryHours}/{TEMP_STAY.windowHours} hrs booked.
          </p>
        )}
        {checkIn && checkOut && checkIn === checkOut && (
          <p style={{ fontSize: "11px", color: C.inkSoft, margin: "0 0 12px" }}>
            Same-day check-in/check-out leaves the room vacant that night, so it won't block another booking.
          </p>
        )}

        <p style={{ fontSize: "11.5px", color: C.inkSoft, margin: "0 0 12px" }}>
          Note: this updates the booking's details only. If the booking already has an invoice, its amount won't change automatically — adjust it in Finance if needed.
        </p>

        <button
          disabled={saving}
          onClick={handleSave}
          style={{
            width: "100%", background: C.ink, color: "#fff",
            border: "none", borderRadius: "8px", padding: "11px", fontSize: "14.5px",
            cursor: saving ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
            opacity: saving ? 0.7 : 1
          }}
        >
          <Check size={16} /> {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

function AddBookingModal({ clients, services, rooms, roomRates, existingBookings, onClose, onSave, onAddClient, initialClientId }) {
  const initialClient = initialClientId ? clients.find((c) => c.id === initialClientId) : null;
  const [clientQuery, setClientQuery] = useState(initialClient ? initialClient.name : "");
  const [phone, setPhone] = useState(initialClient && initialClient.phone !== "—" ? initialClient.phone : "");
  const [showIdFields, setShowIdFields] = useState(false);
  const [idType, setIdType] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [roomId, setRoomId] = useState("");
  const [serviceIds, setServiceIds] = useState([]);
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [checkInTime, setCheckInTime] = useState("");
  const [checkOutTime, setCheckOutTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [bookingType, setBookingType] = useState("overnight");
  const [convertedNotice, setConvertedNotice] = useState(false);
  const idNumberRef = useRef(null);

  const matchedClient = clients.find((c) => c.name.trim().toLowerCase() === clientQuery.trim().toLowerCase());
  const selectedRoom = rooms.find((r) => r.id === roomId);
  const roomTaken = roomId && !isRoomAvailable(roomId, checkIn || null, checkOut || null, existingBookings, null);
  const nights = checkIn && checkOut ? nightsBetween(checkIn, checkOut) : 1;
  const isTemporary = bookingType === "temporary";
  const temporaryHours = hoursBetweenTimes(checkInTime, checkOutTime);
  const accommodationTotal = isTemporary ? TEMP_STAY.rate : rateForRoom(selectedRoom, roomRates) * nights;

  // A temporary stay always books the same calendar day — keep check-out in
  // step with check-in automatically rather than making staff set both.
  useEffect(() => {
    if (isTemporary && checkIn) setCheckOut(checkIn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTemporary, checkIn]);

  // Going over the 5-hour cap would silently undercharge a guest at the flat
  // day-use rate, so this converts the booking back to a regular overnight
  // stay the moment the times say it's run long — before save, not after.
  useEffect(() => {
    const resolved = resolveBookingType(bookingType, checkInTime, checkOutTime);
    if (resolved.converted) {
      setBookingType("overnight");
      setConvertedNotice(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkInTime, checkOutTime]);

  function selectBookingType(type) {
    setBookingType(type);
    setConvertedNotice(false);
    if (type === "temporary" && selectedRoom && !isRoomEligibleForTemporaryStay(selectedRoom)) {
      setRoomId("");
    }
  }

  function handleQueryChange(value) {
    setClientQuery(value);
    const match = clients.find((c) => c.name.trim().toLowerCase() === value.trim().toLowerCase());
    setPhone(match ? (match.phone === "—" ? "" : match.phone) : "");
  }

  const toggleService = (id) =>
    setServiceIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));

  const canSave = clientQuery.trim().length > 0 && !roomTaken && (!isTemporary || (checkInTime && checkOutTime));

  async function handleSave() {
    setSaving(true);
    let finalClientId;
    if (matchedClient) {
      finalClientId = matchedClient.id;
    } else {
      const created = await onAddClient({
        name: clientQuery.trim(),
        phone: phone.trim() || "—",
        idType: showIdFields ? (idType || null) : null,
        idNumber: showIdFields ? (idNumber.trim() || null) : null,
      });
      if (!created) { setSaving(false); return; }
      finalClientId = created.id;
    }
    const ok = await onSave({ clientId: finalClientId, roomId: roomId || null, serviceIds, checkIn: checkIn || "TBC", checkOut: checkOut || "TBC", checkInTime: checkInTime || null, checkOutTime: checkOutTime || null, isTemporary, status: "pending" });
    setSaving(false);
    // onSave returns false on a real conflict (e.g. room double-booked) — leave the
    // modal open with what the person typed so they can just change the room/dates.
    if (ok === false) return;
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(22,35,59,0.35)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 20
    }}>
      <div className="ws" style={{ background: "#fff", borderRadius: "12px", width: "min(380px, 92vw)", maxHeight: "88vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "24px 24px 16px" }}>
          <h3 className="fr" style={{ margin: 0, fontSize: "19px" }}>New booking</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
        </div>

        <div style={{ overflowY: "auto", flex: 1, padding: "0 24px" }}>
        <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Client name</label>
        <input
          list="client-name-options"
          value={clientQuery}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Start typing a name…"
          autoFocus
          style={{ width: "100%", padding: "9px", borderRadius: "7px", border: `1px solid ${C.line}`, margin: "6px 0 10px", fontSize: "14px", boxSizing: "border-box" }}
        />
        <datalist id="client-name-options">
          {clients.map((c) => <option key={c.id} value={c.name} />)}
        </datalist>

        <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Phone number</label>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="e.g. +255 7XX XXX XXX"
          style={{ width: "100%", padding: "9px", borderRadius: "7px", border: `1px solid ${C.line}`, margin: "6px 0 4px", fontSize: "14px", boxSizing: "border-box" }}
        />
        <p style={{ fontSize: "12px", color: C.inkSoft, margin: "0 0 10px" }}>
          {matchedClient ? "Existing client" : clientQuery.trim() ? "New client — will be added" : ""}
        </p>

        {/* Middle-ground ID capture: collapsed by default so a fast walk-in booking
            isn't slowed down, but one click away when staff want to record it now
            instead of circling back to the Clients tab later. Only relevant for a
            new client — an existing client's ID is managed from Clients. */}
        {!matchedClient && clientQuery.trim() && (
          <div style={{ marginBottom: "14px" }}>
            {!showIdFields ? (
              <button
                type="button"
                onClick={() => setShowIdFields(true)}
                style={{ fontSize: "12.5px", border: `1px dashed ${C.line}`, background: "none", borderRadius: "6px", padding: "7px 11px", cursor: "pointer", color: C.clayDeep, width: "100%", textAlign: "left" }}
              >
                + Add ID info (optional)
              </button>
            ) : (
              <div style={{ border: `1px solid ${C.line}`, borderRadius: "8px", padding: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <span style={{ fontSize: "12.5px", fontWeight: 500, color: C.inkSoft }}>ID info</span>
                  <button type="button" onClick={() => { setShowIdFields(false); setIdType(""); setIdNumber(""); }} style={{ background: "none", border: "none", cursor: "pointer", color: C.inkSoft }}>
                    <X size={14} />
                  </button>
                </div>
                <select
                  value={idType}
                  onChange={(e) => {
                    setIdType(e.target.value);
                    if (e.target.value) setTimeout(() => idNumberRef.current?.focus(), 0);
                  }}
                  style={{ width: "100%", padding: "8px", borderRadius: "7px", border: `1px solid ${C.line}`, marginBottom: "8px", fontSize: "13.5px", boxSizing: "border-box" }}
                >
                  <option value="">— ID type —</option>
                  {ID_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <input
                  ref={idNumberRef}
                  value={idNumber}
                  onChange={(e) => setIdNumber(e.target.value)}
                  placeholder={idType ? `${idType} number` : "ID number"}
                  style={{ width: "100%", padding: "8px", borderRadius: "7px", border: `1px solid ${C.line}`, fontSize: "13.5px", boxSizing: "border-box" }}
                />
              </div>
            )}
          </div>
        )}

        <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Stay type</label>
        <div style={{ display: "flex", gap: "8px", margin: "6px 0 4px" }}>
          {["overnight", "temporary"].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => selectBookingType(t)}
              style={{
                flex: 1, padding: "9px", borderRadius: "7px", fontSize: "13.5px", cursor: "pointer",
                border: bookingType === t ? `1px solid ${C.ink}` : `1px solid ${C.line}`,
                background: bookingType === t ? C.ink : "none",
                color: bookingType === t ? "#fff" : C.ink,
              }}
            >
              {t === "overnight" ? "Overnight" : "Temporary stay"}
            </button>
          ))}
        </div>
        {isTemporary && (
          <p style={{ fontSize: "11.5px", color: C.inkSoft, margin: "0 0 10px" }}>
            Day-use only — 6am to 6pm, up to 5 hours, flat {money(TEMP_STAY.rate)}. Single and Deluxe rooms only.
          </p>
        )}
        {convertedNotice && (
          <p style={{ fontSize: "11.5px", color: C.amber, margin: "0 0 10px", fontWeight: 500 }}>
            Converted to overnight — exceeds the {TEMP_STAY.maxHours}-hr temporary-stay limit.
          </p>
        )}
        {!isTemporary && !convertedNotice && <div style={{ marginBottom: "14px" }} />}

        <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Room</label>
        <select value={roomId} onChange={(e) => setRoomId(e.target.value)} style={{ width: "100%", padding: "9px", borderRadius: "7px", border: `1px solid ${C.line}`, margin: "6px 0 6px", fontSize: "14px" }}>
          <option value="">— Select a room —</option>
          {rooms.map((r) => {
            const dateTaken = !isRoomAvailable(r.id, checkIn || null, checkOut || null, existingBookings, null);
            const ineligible = isTemporary && !isRoomEligibleForTemporaryStay(r);
            const taken = dateTaken || ineligible;
            return (
              <option key={r.id} value={r.id} disabled={taken}>
                {r.roomNumber} — {r.roomType} ({isTemporary ? money(TEMP_STAY.rate) : `${money(rateForRoom(r, roomRates))}/night`})
                {ineligible ? " — not available for temporary stay" : dateTaken ? " (booked those dates)" : ""}
              </option>
            );
          })}
        </select>
        {selectedRoom && (
          <p style={{ fontSize: "12px", color: roomTaken ? C.red : C.inkSoft, margin: "0 0 14px" }}>
            {roomTaken
              ? "This room is already booked for those dates."
              : isTemporary
                ? `${selectedRoom.roomType} · Temporary stay · ${money(accommodationTotal)} flat`
                : `${selectedRoom.roomType} · ${money(rateForRoom(selectedRoom, roomRates))}/night${checkIn && checkOut ? ` × ${nights} nights = ${money(accommodationTotal)}` : ""}`}
          </p>
        )}
        {!selectedRoom && <div style={{ marginBottom: "14px" }} />}

        <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Will they need transport?</label>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", margin: "6px 0 14px" }}>
          {services.map((s) => (
            <label key={s.id} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13.5px" }}>
              <input type="checkbox" checked={serviceIds.includes(s.id)} onChange={() => toggleService(s.id)} />
              {s.name} — {money(s.price)}{s.billingUnit === "per_night" ? "/night" : ""}
            </label>
          ))}
          {services.length === 0 && (
            <span style={{ fontSize: "12.5px", color: C.inkSoft }}>No transport options set up yet.</span>
          )}
        </div>

        <div style={{ display: "flex", gap: "10px", marginBottom: checkIn && checkOut && checkIn === checkOut ? "6px" : "18px" }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Check-in</label>
            <input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} style={{ width: "100%", padding: "8px", borderRadius: "7px", border: `1px solid ${C.line}`, marginTop: "6px", boxSizing: "border-box" }} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Check-out</label>
            <input type="date" value={checkOut} disabled={isTemporary} onChange={(e) => setCheckOut(e.target.value)} style={{ width: "100%", padding: "8px", borderRadius: "7px", border: `1px solid ${C.line}`, marginTop: "6px", boxSizing: "border-box", background: isTemporary ? C.paper : "#fff" }} />
          </div>
        </div>
        <div style={{ display: "flex", gap: "10px", marginBottom: "18px" }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Check-in time{isTemporary ? "" : " (optional)"}</label>
            <input type="time" value={checkInTime} onChange={(e) => setCheckInTime(e.target.value)} style={{ width: "100%", padding: "8px", borderRadius: "7px", border: `1px solid ${C.line}`, marginTop: "6px", boxSizing: "border-box" }} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: "12.5px", color: C.inkSoft }}>Check-out time{isTemporary ? "" : " (optional)"}</label>
            <input type="time" value={checkOutTime} onChange={(e) => setCheckOutTime(e.target.value)} style={{ width: "100%", padding: "8px", borderRadius: "7px", border: `1px solid ${C.line}`, marginTop: "6px", boxSizing: "border-box" }} />
          </div>
        </div>
        {isTemporary && temporaryHours != null && (
          <p style={{ fontSize: "11px", color: C.inkSoft, margin: "0 0 18px" }}>
            {temporaryHours}/{TEMP_STAY.windowHours} hrs booked.
          </p>
        )}
        {checkIn && checkOut && checkIn === checkOut && (
          <p style={{ fontSize: "11px", color: C.inkSoft, margin: "0 0 18px" }}>
            Same-day check-in/check-out leaves the room vacant that night, so it won't block another booking.
          </p>
        )}
        </div>

        <div style={{ padding: "14px 24px 24px", borderTop: `1px solid ${C.line}` }}>
        <button
          disabled={!canSave || saving}
          onClick={handleSave}
          style={{
            width: "100%", background: canSave ? C.ink : C.line, color: canSave ? "#fff" : C.inkSoft,
            border: "none", borderRadius: "8px", padding: "11px", fontSize: "14.5px",
            cursor: canSave && !saving ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
            opacity: saving ? 0.7 : 1
          }}
        >
          <Check size={16} /> {saving ? "Saving…" : "Save booking"}
        </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Modal shown right after generating a guest access code —
   built for live demos: copy it, or jump straight into the
   guest portal with it already applied.
--------------------------------------------------------- */
/* ---------------------------------------------------------
   Printable invoice — a clean modal that, when printed,
   shows only the invoice itself (everything else on the page
   is hidden via the print stylesheet below).
--------------------------------------------------------- */
function InvoicePrintModal({ data, branch, clientName, serviceNames, services, rooms, roomRates, payments, onClose }) {
  const { invoice, booking } = data;
  const room = booking ? rooms.find((r) => r.id === booking.roomId) : null;
  const nights = booking ? nightsBetween(booking.checkIn, booking.checkOut) : 1;
  const accommodationTotal = booking?.isTemporary ? TEMP_STAY.rate : rateForRoom(room, roomRates) * nights;
  const lines = booking ? booking.serviceIds.map((id) => services.find((s) => s.id === id)).filter(Boolean) : [];
  const today = new Date().toLocaleDateString([], { dateStyle: "medium" });
  const balance = invoiceBalance(invoice, payments);
  const bookingPayments = booking ? payments.filter((p) => p.bookingId === booking.id) : [];

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(22,35,59,0.35)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 30
    }}>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #invoice-print-area, #invoice-print-area * { visibility: visible; }
          #invoice-print-area {
            position: fixed; inset: 0; margin: 0; box-shadow: none; border: none;
          }
          .no-print { display: none !important; }
        }
      `}</style>
      <div className="ws" style={{ background: "#fff", borderRadius: "12px", padding: "0", width: "min(440px, 92vw)", maxHeight: "88vh", overflowY: "auto" }}>
        <div id="invoice-print-area" style={{ padding: "32px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "24px" }}>
            <div>
              <div className="fr" style={{ fontSize: "20px", fontWeight: 500, color: C.ink }}>Utulivu</div>
              <div style={{ fontSize: "12.5px", color: C.inkSoft }}>{branch?.name}</div>
              <div style={{ fontSize: "12.5px", color: C.inkSoft }}>{branch?.location}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="fr" style={{ fontSize: "16px", fontWeight: 500 }}>Invoice</div>
              <div style={{ fontSize: "12px", color: C.inkSoft }}>{today}</div>
            </div>
          </div>

          <div style={{ fontSize: "13.5px", marginBottom: "20px" }}>
            <div style={{ color: C.inkSoft, fontSize: "12px", marginBottom: "2px" }}>Billed to</div>
            <div style={{ fontWeight: 500 }}>{booking ? clientName(booking.clientId) : "—"}</div>
            {booking && <div style={{ color: C.inkSoft, fontSize: "12.5px" }}>{booking.checkIn} → {booking.checkOut}</div>}
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13.5px", marginBottom: "18px" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.line}`, textAlign: "left", color: C.inkSoft, fontSize: "12px" }}>
                <th style={{ paddingBottom: "8px" }}>Item</th>
                <th style={{ paddingBottom: "8px", textAlign: "right" }}>Price</th>
              </tr>
            </thead>
            <tbody>
              {room && (
                <tr style={{ borderBottom: `1px solid ${C.line}` }}>
                  <td style={{ padding: "7px 0" }}>
                    {room.roomType} room ({room.roomNumber}){booking?.isTemporary ? " · temporary stay" : nights > 1 ? ` × ${nights} nights` : ""}
                  </td>
                  <td style={{ padding: "7px 0", textAlign: "right" }}>{money(accommodationTotal)}</td>
                </tr>
              )}
              {lines.length > 0 ? lines.map((s) => {
                const qty = s.billingUnit === "per_night" ? nights : 1;
                return (
                  <tr key={s.id} style={{ borderBottom: `1px solid ${C.line}` }}>
                    <td style={{ padding: "7px 0" }}>{s.name}{qty > 1 ? ` × ${qty} nights` : ""}</td>
                    <td style={{ padding: "7px 0", textAlign: "right" }}>{money(s.price * qty)}</td>
                  </tr>
                );
              }) : (!room && (
                <tr><td colSpan={2} style={{ padding: "7px 0", color: C.inkSoft }}>{booking ? serviceNames(booking.serviceIds) : "—"}</td></tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "10px", borderTop: `2px solid ${C.ink}` }}>
            <span className="fr" style={{ fontSize: "15px", fontWeight: 500 }}>Total</span>
            <span className="fr" style={{ fontSize: "18px", fontWeight: 500 }}>{money(invoice.amount)}</span>
          </div>

          {/* Full payment history — every payment and refund recorded against
              this booking, in order, so the printed invoice doubles as an
              audit trail rather than just a single status stamp. */}
          {bookingPayments.length > 0 && (
            <div style={{ marginTop: "14px", paddingTop: "12px", borderTop: `1px dashed ${C.line}` }}>
              <div style={{ fontSize: "12px", color: C.inkSoft, marginBottom: "6px" }}>Payments</div>
              {bookingPayments
                .slice()
                .sort((a, b) => new Date(a.paidAt) - new Date(b.paidAt))
                .map((p) => (
                  <div key={p.id} style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px", padding: "3px 0" }}>
                    <span>
                      {new Date(p.paidAt).toLocaleDateString([], { dateStyle: "medium" })}
                      {p.kind === "refund" ? " · refund" : ""}
                      {p.note ? ` — ${p.note}` : ""}
                    </span>
                    <span>{p.amount < 0 ? "-" : ""}{money(Math.abs(p.amount))}</span>
                  </div>
                ))}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "10px", paddingTop: "8px", borderTop: `1px solid ${C.line}` }}>
            <span style={{ fontSize: "13px", fontWeight: 500 }}>{balance.status === "void" ? "Status" : "Balance due"}</span>
            {balance.status === "void" ? (
              <Pill tone="void">void</Pill>
            ) : (
              <span className="fr" style={{ fontSize: "16px", fontWeight: 500, color: balance.remaining > 0 ? C.red : "#1E6E67" }}>
                {money(balance.remaining)}
              </span>
            )}
          </div>
        </div>

        <div className="no-print" style={{ display: "flex", gap: "8px", padding: "16px 32px 24px" }}>
          <button
            onClick={() => window.print()}
            style={{ flex: 1, padding: "10px", borderRadius: "8px", border: "none", background: C.ink, color: "#fff", fontSize: "13.5px", cursor: "pointer" }}
          >
            Print
          </button>
          <button
            onClick={onClose}
            style={{ flex: 1, padding: "10px", borderRadius: "8px", border: `1px solid ${C.line}`, background: "none", color: C.inkSoft, fontSize: "13.5px", cursor: "pointer" }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function GeneratedCodeModal({ entry, onClose, onOpenGuest }) {
  const [copied, setCopied] = useState(false);
  const [qrUrl, setQrUrl] = useState(null);
  const [qrFailed, setQrFailed] = useState(false);
  const expiresLabel = new Date(entry.expires_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

  // The QR points at this same app with ?code= attached, so a guest scanning it
  // lands straight in their stay instead of retyping the code (see App() below,
  // which reads that parameter on load). Encoded against wherever the app is
  // actually served from, so it works the same in dev and in production.
  const guestLink = (() => {
    try {
      return `${window.location.origin}${window.location.pathname}?code=${encodeURIComponent(entry.code)}`;
    } catch (e) {
      return entry.code;
    }
  })();

  // Loaded on demand rather than imported at the top: if the `qrcode` package
  // isn't installed the modal still works, it just shows the code without the
  // square instead of failing the whole build.
  useEffect(() => {
    let cancelled = false;
    import("qrcode")
      .then((mod) => (mod.default || mod).toDataURL(guestLink, {
        width: 240,
        margin: 1,
        color: { dark: "#16233B", light: "#FFFFFF" },
      }))
      .then((url) => { if (!cancelled) setQrUrl(url); })
      .catch(() => { if (!cancelled) setQrFailed(true); });
    return () => { cancelled = true; };
  }, [guestLink]);

  function copy() {
    try {
      navigator.clipboard.writeText(entry.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      // clipboard unavailable — the code is still shown on screen
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(22,35,59,0.35)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 30
    }}>
      <div className="ws" style={{ background: "#fff", borderRadius: "12px", padding: "28px", width: "min(340px, 92vw)", textAlign: "center" }}>
        <div style={{ fontSize: "12.5px", color: C.inkSoft, marginBottom: "8px" }}>Guest access code</div>
        <div className="fr" style={{ fontSize: "32px", fontWeight: 500, letterSpacing: "1px", marginBottom: "6px", color: C.ink }}>{entry.code}</div>
        <div style={{ fontSize: "12.5px", color: C.inkSoft, marginBottom: "16px" }}>Valid until {expiresLabel}</div>

        {qrUrl && (
          <div style={{ marginBottom: "16px" }}>
            <img
              src={qrUrl}
              alt={`QR code opening the guest portal for ${entry.code}`}
              style={{ width: "180px", height: "180px", borderRadius: "8px", border: `1px solid ${C.line}` }}
            />
            <div style={{ fontSize: "11.5px", color: C.inkSoft, marginTop: "8px" }}>
              Scanning this opens the stay directly — no code to type.
            </div>
          </div>
        )}
        {qrFailed && (
          <div style={{ fontSize: "11.5px", color: C.inkSoft, marginBottom: "16px" }}>
            QR unavailable — share the code above instead.
          </div>
        )}
        <button onClick={copy} style={{ width: "100%", padding: "10px", borderRadius: "8px", border: `1px solid ${C.line}`, background: "none", fontSize: "13.5px", cursor: "pointer", marginBottom: "8px" }}>
          {copied ? "Copied!" : "Copy code"}
        </button>
        <button onClick={onOpenGuest} style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "none", background: C.signal, color: "#fff", fontSize: "13.5px", cursor: "pointer", marginBottom: "8px" }}>
          Open guest portal with this code
        </button>
        <button onClick={onClose} style={{ width: "100%", padding: "9px", borderRadius: "8px", border: "none", background: "none", color: C.inkSoft, fontSize: "13px", cursor: "pointer" }}>
          Close
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Operator portal — Utulivu's own view across all subscribers
--------------------------------------------------------- */
function OperatorApp({ onExit }) {
  const [session, setSession] = useState(undefined);
  const [subscribers, setSubscribers] = useState([]);
  const [loading, setLoading] = useState(true);
  const isMobile = useIsMobile();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    supabase
      .from("subscribers")
      .select("*")
      .then(({ data }) => {
        if (data) setSubscribers(data.map(mapSubscriber));
        setLoading(false);
      });
  }, [session]);

  const totalMrr = subscribers.reduce((sum, p) => sum + p.mrr, 0);
  const activeCount = subscribers.filter((p) => p.subStatus === "active").length;
  const totalBranches = subscribers.reduce((sum, p) => sum + p.branches, 0);

  async function updateTier(id, tier) {
    setSubscribers((prev) => prev.map((p) => (p.id === id ? { ...p, tier } : p)));
    await supabase.from("subscribers").update({ tier }).eq("id", id);
  }

  const subTones = {
    active: { bg: C.signalSoft, fg: "#1E6E67" },
    trial: { bg: "#E4E9F3", fg: "#3A4E8A" },
    overdue: { bg: "#F3DEDE", fg: C.red },
  };

  if (session === undefined) {
    return (
      <div style={{ minHeight: "640px", display: "flex", alignItems: "center", justifyContent: "center", background: C.paper, color: C.inkSoft }}>
        {FONTS}
        <p className="ws">Loading…</p>
      </div>
    );
  }
  if (!session) return <Login onSignIn={setSession} onBack={onExit} />;
  if (loading) {
    return (
      <div style={{ minHeight: "640px", display: "flex", alignItems: "center", justifyContent: "center", background: C.paper, color: C.inkSoft }}>
        {FONTS}
        <p className="ws">Loading…</p>
      </div>
    );
  }

  return (
    <div className="ws" style={{ minHeight: "640px", background: C.paper, color: C.ink, padding: isMobile ? "16px" : "28px 32px" }}>
      {FONTS}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px", flexWrap: "wrap", gap: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ width: "30px", height: "30px", borderRadius: "8px", background: C.ink, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Radio size={15} color={C.signal} />
          </div>
          <h1 className="fr" style={{ margin: 0, fontSize: isMobile ? "18px" : "22px", fontWeight: 500 }}>Utulivu · Operator</h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          {!isMobile && <span style={{ fontSize: "12.5px", color: C.inkSoft }}>{session.user.email}</span>}
          <button onClick={() => supabase.auth.signOut()} style={{ background: "none", border: `1px solid ${C.line}`, borderRadius: "7px", padding: "7px 12px", fontSize: "13px", color: C.inkSoft, cursor: "pointer" }}>
            Sign out
          </button>
          {onExit && (
            <button onClick={onExit} style={{ background: "none", border: `1px solid ${C.line}`, borderRadius: "7px", padding: "7px 12px", fontSize: "13px", color: C.inkSoft, cursor: "pointer" }}>
              ← Switch portal
            </button>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: "16px", marginBottom: "20px" }}>
        {[
          ["Monthly recurring revenue", money(totalMrr)],
          ["Active subscribers", activeCount + " / " + subscribers.length],
          ["Branches under management", totalBranches],
        ].map(([label, val]) => (
          <div key={label} style={{ background: C.paperRaised, border: `1px solid ${C.line}`, borderRadius: "10px", padding: "18px" }}>
            <div style={{ fontSize: "12.5px", color: C.inkSoft, marginBottom: "8px" }}>{label}</div>
            <div className="fr" style={{ fontSize: "22px", fontWeight: 500 }}>{val}</div>
          </div>
        ))}
      </div>

      <Panel title="Subscribers">
        <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
          <thead>
            <tr style={{ textAlign: "left", color: C.inkSoft, fontSize: "12.5px" }}>
              <th style={{ paddingBottom: "10px" }}>Provider</th>
              <th>Tier</th>
              <th>Branches</th>
              <th>Active bookings</th>
              <th>MRR</th>
              <th>Subscription</th>
            </tr>
          </thead>
          <tbody>
            {subscribers.map((p) => (
              <tr key={p.id} style={{ borderTop: `1px solid ${C.line}` }}>
                <td style={{ padding: "10px 0" }}>{p.name}</td>
                <td>
                  <select
                    value={p.tier}
                    onChange={(e) => updateTier(p.id, e.target.value)}
                    style={{ border: `1px solid ${C.line}`, borderRadius: "6px", padding: "3px 6px", fontSize: "13px" }}
                  >
                    {TIER_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </td>
                <td>{p.branches}</td>
                <td>{p.activeBookings}</td>
                <td>{money(p.mrr)}</td>
                <td>
                  <span className="ws" style={{
                    background: subTones[p.subStatus].bg, color: subTones[p.subStatus].fg,
                    fontSize: "12.5px", fontWeight: 500, padding: "3px 10px", borderRadius: "999px"
                  }}>
                    {p.subStatus}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Panel>
    </div>
  );
}

/* ---------------------------------------------------------
   Guest portal — the provider's own client. No account,
   just a temporary access code that expires 1 hour after
   the linked booking's checkout.
--------------------------------------------------------- */
const GUEST_CODE_KEY = "utulivu_guest_code";

// The guest's own request status feed — the same card whether it's shown
// filtered to just Kitchen (on the Kitchen tab) or in full across every
// category (on the Requests tab), so the two views can never drift apart.
function GuestRequestStatus({ requests, isExpired, confirmingId, onConfirm, emptyText }) {
  if (requests.length === 0) {
    return emptyText ? <p style={{ fontSize: "13px", color: C.inkSoft, margin: 0 }}>{emptyText}</p> : null;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {requests.map((r) => {
        const isRich = RICH_STAGE_CATEGORIES.includes(r.category);
        const stage = r.stage || "sent";
        return (
          <div key={r.id} style={{ border: `1px solid ${C.line}`, borderRadius: "8px", padding: "12px" }}>
            <div style={{ fontSize: "13.5px", fontWeight: 500 }}>
              {r.message}{r.quantity > 1 ? ` (× ${r.quantity})` : ""}
            </div>
            {isRich ? (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "8px", flexWrap: "wrap" }}>
                {RICH_STAGES.map((s, i) => {
                  const reached = RICH_STAGES.indexOf(stage) >= i;
                  return (
                    <span key={s} style={{
                      fontSize: "11px", fontWeight: 500, padding: "3px 9px", borderRadius: "999px",
                      background: reached ? C.signalSoft : C.line, color: reached ? "#1E6E67" : C.inkSoft
                    }}>
                      {RICH_STAGE_LABELS[s]}
                    </span>
                  );
                })}
                {stage === "delivered" && (
                  <button
                    disabled={confirmingId === r.id || isExpired}
                    onClick={() => onConfirm(r)}
                    style={{ fontSize: "12px", border: "none", background: isExpired ? C.line : C.signal, color: isExpired ? C.inkSoft : "#fff", borderRadius: "6px", padding: "5px 11px", cursor: isExpired ? "default" : "pointer", marginLeft: "auto" }}
                  >
                    {confirmingId === r.id ? "Confirming…" : "Confirm received"}
                  </button>
                )}
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "8px" }}>
                <span style={{ fontSize: "11.5px", color: C.inkSoft }}>{SIMPLE_STAGE_LABELS[stage] || stage}</span>
                {stage === "handled" && (
                  <button
                    disabled={confirmingId === r.id || isExpired}
                    onClick={() => onConfirm(r)}
                    style={{ fontSize: "12px", border: "none", background: isExpired ? C.line : C.signal, color: isExpired ? C.inkSoft : "#fff", borderRadius: "6px", padding: "5px 11px", cursor: isExpired ? "default" : "pointer" }}
                  >
                    {confirmingId === r.id ? "Confirming…" : "Mark as received"}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// The Kitchen tab's photo menu — a fork/knife placeholder for any item with
// no uploaded photo, greyed out and disabled once a service is toggled
// unavailable, with an optional per-item note on how to prepare it.
function KitchenOrderGrid({ items, quantities, setQuantities, cookingNotes, setCookingNotes, requestedIds, sendingId, onRequest, isExpired }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "10px" }}>
      {items.map((item) => {
        const requested = requestedIds.includes(item.id);
        const available = item.is_available !== false;
        const qty = quantities[item.id] || 1;
        const disabled = isExpired || !available;
        return (
          <div key={item.id} style={{
            border: `1px solid ${C.line}`, borderRadius: "10px", overflow: "hidden",
            opacity: available ? 1 : 0.55, background: C.paperRaised
          }}>
            {item.image_url ? (
              <img src={item.image_url} alt={item.name} style={{ width: "100%", height: "90px", objectFit: "cover", display: "block" }} />
            ) : (
              <div style={{ width: "100%", height: "90px", background: C.paper, display: "flex", alignItems: "center", justifyContent: "center", color: C.inkSoft }}>
                <UtensilsCrossed size={22} />
              </div>
            )}
            <div style={{ padding: "10px" }}>
              <div style={{ fontSize: "13px", fontWeight: 500 }}>{item.name}</div>
              <div style={{ fontSize: "11.5px", color: C.inkSoft, marginBottom: "8px" }}>
                {item.price > 0 ? `TSh ${Number(item.price).toLocaleString()}` : "Free"}
              </div>

              {!available ? (
                <span style={{ fontSize: "11.5px", color: C.red, fontWeight: 500 }}>Currently unavailable</span>
              ) : requested ? (
                <span style={{ fontSize: "12px", color: "#1E6E67", fontWeight: 500 }}>Requested</span>
              ) : (
                <>
                  <div style={{ display: "flex", gap: "6px", marginBottom: "6px" }}>
                    <input
                      type="number"
                      min="1"
                      value={qty}
                      onChange={(e) => setQuantities((prev) => ({ ...prev, [item.id]: Math.max(1, Number(e.target.value) || 1) }))}
                      disabled={disabled}
                      style={{ width: "42px", padding: "6px", borderRadius: "6px", border: `1px solid ${C.line}`, fontSize: "12px", textAlign: "center" }}
                    />
                    <input
                      value={cookingNotes[item.id] || ""}
                      onChange={(e) => setCookingNotes((prev) => ({ ...prev, [item.id]: e.target.value }))}
                      placeholder="How prepared? (optional)"
                      disabled={disabled}
                      style={{ flex: 1, minWidth: 0, padding: "6px 8px", borderRadius: "6px", border: `1px solid ${C.line}`, fontSize: "11.5px", boxSizing: "border-box" }}
                    />
                  </div>
                  <button
                    disabled={disabled || sendingId === item.id}
                    onClick={() => onRequest(item)}
                    style={{
                      width: "100%", fontSize: "12.5px", border: "none", borderRadius: "6px", padding: "6px 0",
                      background: disabled ? C.line : C.clay, color: disabled ? C.inkSoft : "#fff",
                      cursor: disabled ? "default" : "pointer", opacity: sendingId === item.id ? 0.7 : 1
                    }}
                  >
                    {sendingId === item.id ? "Sending…" : "Request"}
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// The compact row list used for Counter/Amenities/Laundry — no photos, just
// name, price, an optional quantity (Laundry only), and the same
// unavailable/requested states as the Kitchen grid.
function OtherServicesList({ items, quantities, setQuantities, requestedIds, sendingId, onRequest, isExpired }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {items.map((item) => {
        const requested = requestedIds.includes(item.id);
        const available = item.is_available !== false;
        const hasQuantity = item.category === "Laundry";
        const qty = quantities[item.id] || 1;
        const disabled = isExpired || !available;
        return (
          <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.line}`, gap: "10px", opacity: available ? 1 : 0.55 }}>
            <div>
              <div style={{ fontSize: "13.5px", fontWeight: 500 }}>{item.name}</div>
              <div style={{ fontSize: "12px", color: C.inkSoft }}>{item.price > 0 ? `TSh ${Number(item.price).toLocaleString()}` : "Free"}</div>
            </div>
            {!available ? (
              <span style={{ fontSize: "12px", color: C.red, fontWeight: 500, whiteSpace: "nowrap" }}>Currently unavailable</span>
            ) : requested ? (
              <span style={{ fontSize: "12.5px", color: "#1E6E67", fontWeight: 500, whiteSpace: "nowrap" }}>Requested</span>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {hasQuantity && (
                  <input
                    type="number"
                    min="1"
                    value={qty}
                    onChange={(e) => setQuantities((prev) => ({ ...prev, [item.id]: Math.max(1, Number(e.target.value) || 1) }))}
                    disabled={disabled}
                    style={{ width: "48px", padding: "6px", borderRadius: "6px", border: `1px solid ${C.line}`, fontSize: "12.5px", textAlign: "center" }}
                  />
                )}
                <button
                  disabled={disabled || sendingId === item.id}
                  onClick={() => onRequest(item)}
                  style={{
                    fontSize: "12.5px", border: "none", borderRadius: "6px", padding: "6px 12px", whiteSpace: "nowrap",
                    background: disabled ? C.line : C.clay, color: disabled ? C.inkSoft : "#fff",
                    cursor: disabled ? "default" : "pointer", opacity: sendingId === item.id ? 0.7 : 1
                  }}
                >
                  {sendingId === item.id ? "Sending…" : "Request"}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const GUEST_TABS = [
  { id: "stay", label: "Stay", icon: Home },
  { id: "kitchen", label: "Kitchen", icon: UtensilsCrossed },
  { id: "requests", label: "Requests", icon: Bell },
  { id: "frontdesk", label: "Front desk", icon: Phone },
];

// The bottom navigation bar itself — full-width chrome (unlike the content
// above it and the message composer below, which both stay content-width),
// matching how a bottom tab bar normally reads in a phone app.
function GuestTabBar({ active, onChange, requestBadge }) {
  return (
    <div className="no-print" style={{
      position: "fixed", left: 0, right: 0, bottom: 0, background: C.paperRaised,
      borderTop: `1px solid ${C.line}`, display: "flex", zIndex: 5,
      boxShadow: "0 -4px 14px rgba(22,35,59,0.06)"
    }}>
      {GUEST_TABS.map((t) => {
        const Icon = t.icon;
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className="ws"
            style={{
              flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "3px",
              padding: "9px 4px 8px", border: "none", background: "none", cursor: "pointer", position: "relative",
              color: isActive ? C.clay : C.inkSoft,
            }}
          >
            <span style={{ position: "relative" }}>
              <Icon size={19} strokeWidth={isActive ? 2.3 : 2} />
              {t.id === "requests" && requestBadge > 0 && (
                <span style={{
                  position: "absolute", top: "-4px", right: "-8px", background: C.signal, color: "#fff",
                  fontSize: "10px", fontWeight: 600, borderRadius: "999px", padding: "1px 5px", minWidth: "15px", textAlign: "center"
                }}>
                  {requestBadge}
                </span>
              )}
            </span>
            <span style={{ fontSize: "11px", fontWeight: isActive ? 600 : 500 }}>{t.label}</span>
            {isActive && <span style={{ position: "absolute", bottom: 0, left: "20%", right: "20%", height: "2px", background: C.clay, borderRadius: "2px" }} />}
          </button>
        );
      })}
    </div>
  );
}

function GuestApp({ onExit, initialCode }) {
  const savedCode = (() => {
    try { return localStorage.getItem(GUEST_CODE_KEY); } catch (e) { return null; }
  })();
  const startCode = initialCode || savedCode || "";

  const [codeInput, setCodeInput] = useState(startCode);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(Boolean(startCode));
  const [error, setError] = useState("");
  const [airtimeAmount, setAirtimeAmount] = useState("");
  const [airtimeNetwork, setAirtimeNetwork] = useState("");
  const [airtimePhone, setAirtimePhone] = useState("");
  const [airtimeSending, setAirtimeSending] = useState(false);
  const [airtimeSent, setAirtimeSent] = useState(false);
  const [guestServices, setGuestServices] = useState([]);
  const [guestServicesLoading, setGuestServicesLoading] = useState(false);
  const [activeCategory, setActiveCategory] = useState(null);
  const [quantities, setQuantities] = useState({});
  const [cookingNotes, setCookingNotes] = useState({});
  const [requestedIds, setRequestedIds] = useState([]);
  const [sendingId, setSendingId] = useState(null);
  const [customMessage, setCustomMessage] = useState("");
  const [customSending, setCustomSending] = useState(false);
  const [customSent, setCustomSent] = useState(false);
  const [myRequests, setMyRequests] = useState([]);
  const [confirmingId, setConfirmingId] = useState(null);
  const [paidSoFar, setPaidSoFar] = useState(0);
  const [hasStayedBefore, setHasStayedBefore] = useState(false);
  const [guestTab, setGuestTab] = useState("stay");

  useEffect(() => {
    if (startCode) lookup(startCode, { silent: Boolean(!initialCode && savedCode) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Whether this guest — matched by phone number, not name, since a name can
  // be retyped slightly differently on a later visit — has any other booking
  // on record. Fetched once per session rather than polled: it can't change
  // during the course of a single stay, unlike requests or the running
  // balance. Defaults to false on any error or missing link, since claiming
  // false familiarity is worse than just saying a plain "Welcome".
  useEffect(() => {
    if (!session?.access?.code) return;
    supabase
      .rpc("get_guest_stay_count", { p_code: session.access.code })
      .then(({ data }) => setHasStayedBefore(typeof data === "number" && data > 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const CATEGORY_ORDER = ["Kitchen", "Counter", "Amenities", "Laundry"];

  useEffect(() => {
    if (!session?.access?.branch_id) return;
    setGuestServicesLoading(true);
    supabase
      .from("services")
      .select("*")
      .eq("branch_id", session.access.branch_id)
      .in("category", GUEST_REQUEST_CATEGORIES)
      .then(({ data }) => {
        if (data) {
          setGuestServices(data);
          // Kitchen has its own dedicated tab now, so the pill switcher on
          // the Requests tab only ever needs to default to one of the other
          // three categories.
          const firstCategory = CATEGORY_ORDER.filter((cat) => cat !== "Kitchen").find((cat) => data.some((s) => s.category === cat));
          setActiveCategory(firstCategory || null);
        }
        setGuestServicesLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // The guest's own request history — fetched through a guarded RPC (rather
  // than a direct table select) so a guest can only ever see requests tied to
  // their own code, without needing a broad anon read policy on the table.
  // Realtime isn't available here for the same reason, so this polls lightly
  // instead — fine at this volume, and it keeps "is my food coming" fresh
  // without opening up other guests' requests to anyone holding an anon key.
  async function fetchMyRequests() {
    if (!session?.access?.code) return;
    const { data } = await supabase.rpc("get_my_requests", { p_code: session.access.code });
    if (data) setMyRequests(data);
  }

  // The guest's running balance — how much has actually been paid against
  // this stay, fetched live rather than relying on the invoice_amount snapshot
  // taken when the code was generated (payments recorded afterward wouldn't
  // otherwise show up here). Same guarded-RPC pattern as fetchMyRequests, so a
  // guest never gets read access to the payments table directly.
  async function fetchMyBalance() {
    if (!session?.access?.code) return;
    const { data } = await supabase.rpc("get_my_balance", { p_code: session.access.code });
    if (typeof data === "number") setPaidSoFar(data);
  }

  useEffect(() => {
    if (!session?.access?.code) return;
    fetchMyRequests();
    fetchMyBalance();
    const interval = setInterval(() => {
      fetchMyRequests();
      fetchMyBalance();
    }, 12000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function requestItem(item) {
    if (item.is_available === false) return;
    setSendingId(item.id);
    const hasQuantity = item.category === "Kitchen" || item.category === "Laundry";
    const qty = hasQuantity ? (quantities[item.id] || 1) : 1;
    const qtyLabel = qty > 1 ? ` × ${qty}` : "";
    const priceLabel = item.price > 0 ? `TSh ${Number(item.price).toLocaleString()}` : "Free";
    const note = item.category === "Kitchen" ? (cookingNotes[item.id] || "").trim() : "";
    const noteLabel = note ? ` — ${note}` : "";
    await supabase.from("service_requests").insert({
      code: session.access.code,
      guest_name: session.access.guest_name,
      room_number: session.access.room_number || null,
      room_type: session.access.room_type || null,
      category: item.category,
      quantity: qty,
      amount: item.price * qty,
      message: `${session.access.guest_name} requested ${item.name}${qtyLabel} (${priceLabel})${noteLabel}`,
    });
    setSendingId(null);
    setRequestedIds((prev) => [...prev, item.id]);
    fetchMyRequests();
  }

  async function sendCustomMessage() {
    if (!customMessage.trim()) return;
    setCustomSending(true);
    await supabase.from("service_requests").insert({
      code: session.access.code,
      guest_name: session.access.guest_name,
      room_number: session.access.room_number || null,
      room_type: session.access.room_type || null,
      category: "General",
      message: customMessage.trim(),
    });
    setCustomSending(false);
    setCustomSent(true);
    setCustomMessage("");
    setTimeout(() => setCustomSent(false), 2500);
    fetchMyRequests();
  }

  // The simple loop's "Mark as received" and the rich loop's final "Confirm
  // received" both call this — it's the guest's own capability, so it goes
  // through a security-definer RPC that checks the code matches the request
  // rather than a broad UPDATE grant on the whole table.
  async function confirmRequest(request) {
    const isRich = RICH_STAGE_CATEGORIES.includes(request.category);
    const finalStage = isRich ? "confirmed" : "received";
    setConfirmingId(request.id);
    setMyRequests((prev) => prev.map((r) => (r.id === request.id ? { ...r, stage: finalStage } : r)));
    try {
      await supabase.rpc("guest_confirm_request", { p_id: request.id, p_code: session.access.code, p_stage: finalStage });
    } catch (e) {
      // will reconcile on next poll
    }
    setConfirmingId(null);
    fetchMyRequests();
  }

  async function lookup(rawCode, opts = {}) {
    setLoading(true);
    setError("");
    const { data, error: qErr } = await supabase
      .from("access_codes")
      .select("*")
      .ilike("code", rawCode.trim())
      .maybeSingle();
    setLoading(false);
    if (qErr || !data) {
      try { localStorage.removeItem(GUEST_CODE_KEY); } catch (e) {}
      if (!opts.silent) setError("That access code wasn't recognized. Check the code from your booking confirmation.");
      return;
    }
    try { localStorage.setItem(GUEST_CODE_KEY, data.code); } catch (e) {}
    setSession({ access: data });
  }

  function enter() {
    lookup(codeInput);
  }

  function switchGuest() {
    try { localStorage.removeItem(GUEST_CODE_KEY); } catch (e) {}
    setSession(null);
    setCodeInput("");
    setError("");
  }

  if (!session) {
    return (
      <div style={{ minHeight: "560px", display: "flex", alignItems: "center", justifyContent: "center", background: C.paper }}>
        {FONTS}
        <div className="ws" style={{ width: "min(340px, 92vw)", background: C.paperRaised, border: `1px solid ${C.line}`, borderRadius: "14px", padding: "32px" }}>
          <div style={{ width: "40px", height: "40px", borderRadius: "9px", background: C.ink, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "20px" }}>
            <Radio size={19} color={C.signal} />
          </div>
          <h1 className="fr" style={{ margin: "0 0 6px", fontSize: "23px", fontWeight: 500 }}>Welcome to Utulivu</h1>
          <p style={{ margin: "0 0 22px", fontSize: "13.5px", color: C.inkSoft, lineHeight: 1.55 }}>
            Your room, your requests and your bill, all in one place. Enter the access code from your booking confirmation to open your stay.
          </p>
          <input
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            placeholder="e.g. UTU-2201"
            style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: `1px solid ${C.line}`, marginBottom: "12px", fontSize: "14px", boxSizing: "border-box" }}
          />
          {error && <p style={{ color: C.red, fontSize: "12.5px", margin: "0 0 12px" }}>{error}</p>}
          <button onClick={enter} disabled={loading} style={{ width: "100%", padding: "11px", borderRadius: "8px", border: "none", background: C.ink, color: "#fff", fontSize: "14.5px", fontWeight: 500, cursor: loading ? "default" : "pointer", opacity: loading ? 0.7 : 1 }}>
            {loading ? "Checking…" : "Access my stay"}
          </button>
          <p style={{ fontSize: "11.5px", color: C.inkSoft, marginTop: "12px" }}>
            Lost your code? The front desk can send you a new one.
          </p>
          {onExit && (
            <button onClick={onExit} style={{ width: "100%", marginTop: "10px", padding: "9px", borderRadius: "8px", border: `1px solid ${C.line}`, background: "none", color: C.inkSoft, fontSize: "13px", cursor: "pointer" }}>
              ← Choose a different portal
            </button>
          )}
        </div>
      </div>
    );
  }

  const { access } = session;
  const isExpired = Date.now() > new Date(access.expires_at).getTime();
  const expiresLabel = new Date(access.expires_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  const ordersTotal = myRequests.reduce((sum, r) => sum + (r.amount || 0), 0);
  const grandTotal = (access.invoice_amount || 0) + ordersTotal;
  const remainingBalance = Math.max(0, grandTotal - paidSoFar);
  // First name only — warm without guessing at a title the booking never recorded.
  const guestFirstName = (access.guest_name || "").trim().split(" ")[0] || "there";

  // Requests are stored with a human sentence ("Halima requested Chai × 2 (TSh 1,000)")
  // because that's what reads well in the staff feed. On a bill it just needs the
  // item, so the name prefix and the trailing price are stripped back off — the
  // amount is already its own column here.
  const chargeableRequests = myRequests.filter((r) => (r.amount || 0) > 0);
  const requestLabel = (r) => {
    const stripped = (r.message || "")
      .replace(/^.*?\brequested\s+/i, "")
      .replace(/\s*\(TSh[^)]*\)\s*$/i, "")
      .replace(/\s*—\s*logged by staff\s*$/i, "")
      .trim();
    return stripped || r.category || "Request";
  };

  return (
    <div className="ws" style={{ minHeight: "560px", background: C.paper, display: "flex", justifyContent: "center", padding: "36px 20px 170px" }}>
      {FONTS}
      <div style={{ width: "min(420px, 100%)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px" }}>
          <h1 className="fr" style={{ margin: 0, fontSize: "22px", fontWeight: 500 }}>{hasStayedBefore ? "Welcome back" : "Welcome"}, {guestFirstName}</h1>
          <span style={{
            fontSize: "12.5px", fontWeight: 500, padding: "3px 10px", borderRadius: "999px",
            background: isExpired ? "#F3DEDE" : C.signalSoft, color: isExpired ? C.red : "#1E6E67"
          }}>
            {isExpired ? "Access expired" : "Access active"}
          </span>
        </div>

        {isExpired && (
          <div style={{ background: "#F3DEDE", border: "1px solid #E9C7C7", borderRadius: "9px", padding: "12px 14px", marginBottom: "16px", fontSize: "13px", color: C.red }}>
            This access code expired on {expiresLabel} — one hour after checkout. Your stay details stay visible, but new orders and messages are closed. Contact the front desk if you still need help.
          </div>
        )}

        {/* Booking, invoice and request status in one panel — it's really one
            piece of information ("here's your stay, here's what you owe, here's
            what you've asked for"), and splitting it across headered panels was
            just wasted vertical space. */}
        {guestTab === "stay" && (
        <>
        <Panel title="Booking">
          <div id="stay-summary-print" style={{ fontSize: "14px", lineHeight: 1.8 }}>
            {access.room_number && (
              <div style={{ marginBottom: "8px" }}>
                <span style={{ fontSize: "12px", color: C.inkSoft }}>Your room</span>
                <div className="fr" style={{ fontSize: "22px", fontWeight: 500, color: C.ink }}>
                  Room {access.room_number}{access.room_type ? ` · ${access.room_type}` : ""}
                </div>
              </div>
            )}
            <div><strong>{access.service_names}</strong></div>
            <div style={{ color: C.inkSoft }}>{access.check_in} → {access.check_out}</div>
            <StayCalendar checkIn={access.check_in} checkOut={access.check_out} />
            <div style={{ marginTop: "6px" }}><Pill tone={access.status}>{access.status}</Pill></div>

            {/* Accommodation and everything ordered during the stay are listed
                separately and only summed at the very bottom — a guest checking
                their bill wants to see what each line was before they're asked
                to accept a single number. This sits inside the printable area so
                a printed summary is a real bill, not just the dates. */}
            <div style={{ borderTop: `1px solid ${C.line}`, marginTop: "14px", paddingTop: "14px" }}>
              {access.invoice_amount == null && chargeableRequests.length === 0 ? (
                <span style={{ fontSize: "13.5px", color: C.inkSoft }}>No charges on file yet.</span>
              ) : (
                <>
                  {access.invoice_amount != null && (
                    <>
                      <div style={{ fontSize: "12px", color: C.inkSoft, marginBottom: "6px" }}>Accommodation</div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
                        <span style={{ fontSize: "13.5px" }}>
                          Room {access.room_number || "—"}{access.room_type ? ` · ${access.room_type}` : ""}
                        </span>
                        <span style={{ fontSize: "13.5px", flexShrink: 0 }}>{money(access.invoice_amount)}</span>
                      </div>
                    </>
                  )}

                  {chargeableRequests.length > 0 && (
                    <div style={{ marginTop: access.invoice_amount != null ? "14px" : 0 }}>
                      <div style={{ fontSize: "12px", color: C.inkSoft, marginBottom: "6px" }}>Orders &amp; services</div>
                      {chargeableRequests.map((r) => (
                        <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "10px", marginBottom: "4px" }}>
                          <span style={{ fontSize: "13.5px" }}>{requestLabel(r)}</span>
                          <span style={{ fontSize: "13.5px", flexShrink: 0 }}>{money(r.amount)}</span>
                        </div>
                      ))}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "6px", paddingTop: "6px", borderTop: `1px dashed ${C.line}` }}>
                        <span style={{ fontSize: "12.5px", color: C.inkSoft }}>Orders subtotal</span>
                        <span style={{ fontSize: "13.5px" }}>{money(ordersTotal)}</span>
                      </div>
                    </div>
                  )}

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "12px", paddingTop: "10px", borderTop: `2px solid ${C.ink}` }}>
                    <span style={{ fontSize: "13px", fontWeight: 500 }}>Grand total</span>
                    <span className="fr" style={{ fontSize: "19px", fontWeight: 500 }}>{money(grandTotal)}</span>
                  </div>
                  {paidSoFar > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px" }}>
                      <span style={{ fontSize: "12.5px", color: C.inkSoft }}>Paid so far</span>
                      <span style={{ fontSize: "13.5px" }}>{money(paidSoFar)}</span>
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "6px" }}>
                    <span style={{ fontSize: "12.5px", fontWeight: 500, color: remainingBalance > 0 ? C.red : "#1E6E67" }}>
                      {remainingBalance > 0 ? "Remaining balance" : "Fully paid"}
                    </span>
                    {remainingBalance > 0 && (
                      <span style={{ fontSize: "14px", fontWeight: 500, color: C.red }}>{money(remainingBalance)}</span>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {(access.invoice_amount != null || ordersTotal > 0) && (
            <button
              onClick={() => window.print()}
              className="no-print"
              style={{ width: "100%", marginTop: "12px", padding: "9px", borderRadius: "7px", border: `1px solid ${C.line}`, background: "none", color: C.inkSoft, fontSize: "13px", cursor: "pointer" }}
            >
              Print summary
            </button>
          )}
        </Panel>
        <style>{`
          @media print {
            body * { visibility: hidden; }
            #stay-summary-print, #stay-summary-print * { visibility: visible; }
            .no-print { display: none !important; }
          }
        `}</style>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "18px" }}>
          <button onClick={switchGuest} style={{ background: "none", border: "none", color: C.inkSoft, fontSize: "13px", cursor: "pointer" }}>
            Not you? Switch guest
          </button>
          {onExit && (
            <button onClick={onExit} style={{ background: "none", border: "none", color: C.inkSoft, fontSize: "13px", cursor: "pointer" }}>
              ← Choose a different portal
            </button>
          )}
        </div>
        </>
        )}

        {/* Kitchen tab — the photo menu, plus a Kitchen-only slice of the
            guest's own request status so "is my order coming?" doesn't
            require a tab switch right after placing it. */}
        {guestTab === "kitchen" && (
          <>
            {guestServices.some((s) => s.category === "Kitchen") && (
              <Panel title="Kitchen menu">
                <p style={{ fontSize: "13px", color: C.inkSoft, marginTop: 0, marginBottom: "14px" }}>
                  Pick a quantity, add any notes on how you'd like it prepared, and send your order to the kitchen.
                </p>
                <KitchenOrderGrid
                  items={guestServices.filter((item) => item.category === "Kitchen")}
                  quantities={quantities}
                  setQuantities={setQuantities}
                  cookingNotes={cookingNotes}
                  setCookingNotes={setCookingNotes}
                  requestedIds={requestedIds}
                  sendingId={sendingId}
                  onRequest={requestItem}
                  isExpired={isExpired}
                />
              </Panel>
            )}
            <div style={{ height: "14px" }} />
            <Panel title="Your kitchen orders">
              <GuestRequestStatus
                requests={myRequests.filter((r) => r.category === "Kitchen")}
                isExpired={isExpired}
                confirmingId={confirmingId}
                onConfirm={confirmRequest}
                emptyText="Nothing ordered from the kitchen yet this stay."
              />
            </Panel>
          </>
        )}

        {/* Requests tab — ordering for everything that isn't Kitchen, plus the
            full picture of every request across every category (Kitchen
            included), so there's one place to check where everything stands. */}
        {guestTab === "requests" && (
          <>
            {guestServices.some((s) => s.category !== "Kitchen") && (
              <>
                <Panel title="Order more">
                  <div style={{ display: "flex", gap: "6px", marginBottom: "14px", flexWrap: "wrap" }}>
                    {CATEGORY_ORDER.filter((cat) => cat !== "Kitchen" && guestServices.some((s) => s.category === cat)).map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setActiveCategory(cat)}
                        style={{
                          fontSize: "12.5px", fontWeight: 500, border: `1px solid ${C.line}`, borderRadius: "999px",
                          padding: "6px 13px", cursor: "pointer",
                          background: activeCategory === cat ? C.ink : "none",
                          color: activeCategory === cat ? "#fff" : C.inkSoft,
                        }}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                  <p style={{ fontSize: "13px", color: C.inkSoft, marginTop: 0, marginBottom: "14px" }}>
                    {(activeCategory === "Counter" || activeCategory === "Amenities") && "Tap to request any item — staff will bring it to your room."}
                    {activeCategory === "Laundry" && "Pick a quantity per item — ironing is complimentary."}
                  </p>
                  <OtherServicesList
                    items={guestServices.filter((item) => item.category === activeCategory)}
                    quantities={quantities}
                    setQuantities={setQuantities}
                    requestedIds={requestedIds}
                    sendingId={sendingId}
                    onRequest={requestItem}
                    isExpired={isExpired}
                  />
                </Panel>
                <div style={{ height: "14px" }} />
              </>
            )}
            <Panel title="Your requests">
              <GuestRequestStatus
                requests={myRequests}
                isExpired={isExpired}
                confirmingId={confirmingId}
                onConfirm={confirmRequest}
                emptyText="Nothing requested yet this stay."
              />
            </Panel>
          </>
        )}

        {/* Front desk tab — airtime top-up. Messaging lives in the floating
            composer now, always reachable regardless of which tab is open. */}
        {guestTab === "frontdesk" && (
        <Panel title="Front desk">
          <div>
            <p style={{ fontSize: "13px", fontWeight: 500, margin: "0 0 8px", color: C.ink }}>Airtime top-up</p>
            {airtimeSent ? (
              <p style={{ fontSize: "13.5px", color: "#1E6E67", margin: 0 }}>Request sent — {airtimeNetwork}, TSh {Number(airtimeAmount).toLocaleString()} to {airtimePhone}. Front desk notified.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <select
                  value={airtimeNetwork}
                  onChange={(e) => setAirtimeNetwork(e.target.value)}
                  disabled={isExpired || airtimeSending}
                  style={{ padding: "9px 10px", borderRadius: "7px", border: `1px solid ${C.line}`, fontSize: "13.5px", boxSizing: "border-box" }}
                >
                  <option value="">Tap to select network</option>
                  {["Vodacom", "Tigo", "Airtel", "Halotel"].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <input
                  type="tel"
                  value={airtimePhone}
                  onChange={(e) => setAirtimePhone(e.target.value)}
                  placeholder="Number to top up, e.g. +255 7XX XXX XXX"
                  disabled={isExpired || airtimeSending}
                  style={{ padding: "9px 10px", borderRadius: "7px", border: `1px solid ${C.line}`, fontSize: "13.5px", boxSizing: "border-box" }}
                />
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    type="number"
                    min="500"
                    step="500"
                    value={airtimeAmount}
                    onChange={(e) => setAirtimeAmount(e.target.value)}
                    placeholder="Amount in TSh"
                    disabled={isExpired || airtimeSending}
                    style={{ flex: 1, padding: "9px 10px", borderRadius: "7px", border: `1px solid ${C.line}`, fontSize: "13.5px", boxSizing: "border-box" }}
                  />
                  <button
                    disabled={isExpired || airtimeSending || !airtimeNetwork || !airtimeAmount || Number(airtimeAmount) <= 0 || !airtimePhone.trim()}
                    onClick={async () => {
                      setAirtimeSending(true);
                      await supabase.from("service_requests").insert({
                        code: access.code,
                        guest_name: access.guest_name,
                        room_number: access.room_number || null,
                        room_type: access.room_type || null,
                        category: "Airtime",
                        network: airtimeNetwork,
                        phone: airtimePhone.trim(),
                        amount: Number(airtimeAmount),
                        message: `${access.guest_name} requested airtime top-up: ${airtimeNetwork}, ${airtimePhone.trim()}, TSh ${Number(airtimeAmount).toLocaleString()}`,
                      });
                      setAirtimeSending(false);
                      setAirtimeSent(true);
                      fetchMyRequests();
                    }}
                    style={{
                      padding: "9px 14px", borderRadius: "7px", border: "none", fontSize: "13.5px", whiteSpace: "nowrap",
                      background: isExpired ? C.line : C.clay, color: isExpired ? C.inkSoft : "#fff",
                      cursor: isExpired ? "default" : "pointer", opacity: airtimeSending ? 0.7 : 1
                    }}
                  >
                    {airtimeSending ? "Sending…" : "Request"}
                  </button>
                </div>
                <p style={{ fontSize: "11.5px", color: C.inkSoft, margin: 0 }}>
                  Enter whichever number you want topped up — it doesn't have to be the number tied to your booking.
                </p>
              </div>
            )}
          </div>
        </Panel>
        )}
      </div>

      {/* Floating message composer — pinned just above the tab bar so a guest
          never has to scroll past everything else just to say something
          urgent. Same width as the rest of the content, centered, one line
          plus Send. Hidden entirely when printing, and disabled (not hidden)
          once access has expired. */}
      <div className="no-print" style={{ position: "fixed", left: 0, right: 0, bottom: "58px", display: "flex", justifyContent: "center", padding: "0 20px 8px", pointerEvents: "none" }}>
        <div style={{
          width: "min(420px, 100%)", display: "flex", gap: "8px", alignItems: "center",
          background: C.paperRaised, border: `1px solid ${C.line}`, borderRadius: "999px",
          padding: "6px 6px 6px 16px", boxShadow: "0 6px 20px rgba(22,35,59,0.14)", pointerEvents: "auto"
        }}>
          <input
            value={customMessage}
            onChange={(e) => setCustomMessage(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !isExpired && !customSending && customMessage.trim()) sendCustomMessage(); }}
            placeholder={isExpired ? "Messaging is closed for this stay" : "Message the front desk…"}
            disabled={isExpired || customSending}
            className="ws"
            style={{ flex: 1, minWidth: 0, border: "none", outline: "none", fontSize: "13.5px", background: "none", color: C.ink }}
          />
          <button
            disabled={isExpired || customSending || !customMessage.trim()}
            onClick={sendCustomMessage}
            aria-label="Send"
            style={{
              width: "34px", height: "34px", borderRadius: "50%", border: "none", flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: isExpired || !customMessage.trim() ? C.line : C.signal,
              color: isExpired || !customMessage.trim() ? C.inkSoft : "#fff",
              cursor: isExpired || !customMessage.trim() ? "default" : "pointer",
              opacity: customSending ? 0.7 : 1
            }}
          >
            <ArrowUp size={16} strokeWidth={2.5} />
          </button>
        </div>
      </div>
      {customSent && (
        <div className="no-print" style={{ position: "fixed", left: 0, right: 0, bottom: "126px", display: "flex", justifyContent: "center", pointerEvents: "none" }}>
          <span style={{ fontSize: "12px", color: "#1E6E67", background: C.signalSoft, padding: "4px 12px", borderRadius: "999px" }}>
            Sent — the front desk has been notified.
          </span>
        </div>
      )}

      <GuestTabBar
        active={guestTab}
        onChange={setGuestTab}
        requestBadge={myRequests.filter((r) => !isRequestSettled(r)).length}
      />
    </div>
  );
}

/* ---------------------------------------------------------
   Portal gate — choose which of the three Utulivu experiences
   to view. In production these are three separate surfaces;
   here they live in one file for the demo.
--------------------------------------------------------- */
function PortalGate({ onSelect, onReset }) {
  const isMobile = useIsMobile();
  const options = [
    { id: "operator", title: "Operator", desc: "Utulivu's own view — manage subscribers, tiers, and platform revenue." },
    { id: "provider", title: "Provider", desc: "The hospitality business's dashboard — bookings, clients, finance, NFC tags." },
    { id: "guest", title: "Guest", desc: "The provider's own client — a temporary, code-based view of their stay." },
  ];
  return (
    <div className="ws" style={{ minHeight: "640px", background: C.paper, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
      {FONTS}
      <div style={{ width: "min(620px, 100%)" }}>
        <div style={{ textAlign: "center", marginBottom: "30px" }}>
          <div style={{ width: "42px", height: "42px", borderRadius: "10px", background: C.ink, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
            <Radio size={20} color={C.signal} />
          </div>
          <h1 className="fr" style={{ margin: "0 0 6px", fontSize: "28px", fontWeight: 500, color: C.ink }}>Utulivu</h1>
          <p style={{ margin: 0, fontSize: "14px", color: C.inkSoft }}>Choose which portal to view.</p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: "14px" }}>
          {options.map((o) => (
            <button
              key={o.id}
              onClick={() => onSelect(o.id)}
              style={{
                textAlign: "left", background: C.paperRaised, border: `1px solid ${C.line}`, borderRadius: "12px",
                padding: "20px", cursor: "pointer"
              }}
            >
              <div className="fr" style={{ fontSize: "18px", fontWeight: 500, color: C.ink, marginBottom: "8px" }}>{o.title}</div>
              <div style={{ fontSize: "13px", color: C.inkSoft, lineHeight: 1.5 }}>{o.desc}</div>
            </button>
          ))}
        </div>
        {onReset && (
          <div style={{ textAlign: "center", marginTop: "22px" }}>
            <button onClick={onReset} style={{ background: "none", border: "none", color: C.inkSoft, fontSize: "12.5px", cursor: "pointer" }}>
              Reset demo data
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Top-level router
--------------------------------------------------------- */
// A scanned QR arrives as ?code=UTU-1234 — that's enough to know which portal
// the person wants and which stay to open, so both are read once on load.
function codeFromUrl() {
  try {
    return new URLSearchParams(window.location.search).get("code") || "";
  } catch (e) {
    return "";
  }
}

export default function App() {
  const [portal, setPortal] = useState(() => (codeFromUrl() ? "guest" : null));
  const [prefillGuestCode, setPrefillGuestCode] = useState(() => codeFromUrl());
  const [resetKey, setResetKey] = useState(0);

  async function addAccessCode(entry) {
    const { error } = await supabase.from("access_codes").insert(entry);
    if (error) {
      console.error("Could not save guest access code:", error.message);
      return false;
    }
    return true;
  }

  function jumpToGuest(code) {
    setPrefillGuestCode(code);
    setPortal("guest");
  }

  function resetDemo() {
    setPrefillGuestCode("");
    setPortal(null);
    setResetKey((k) => k + 1); // forces provider/operator to remount with fresh seed state
  }

  if (!portal) return <PortalGate onSelect={setPortal} onReset={resetDemo} />;
  if (portal === "operator") return <OperatorApp key={resetKey} onExit={() => setPortal(null)} />;
  if (portal === "guest") return <GuestApp onExit={() => setPortal(null)} initialCode={prefillGuestCode} />;
  return <ProviderApp key={resetKey} onExit={() => setPortal(null)} onGenerateCode={addAccessCode} onJumpToGuest={jumpToGuest} />;
}
