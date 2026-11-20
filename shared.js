(() => {
  "use strict";

  const SERVICES = {
    "Haircut": 30,
    "Shave": 20,
    "Beard trim": 15,
    "Bleach": 60,
    "Facial": 30,
    "Hair wash": 15
  };
  const STORAGE_KEY = "goodhands-barbershop-v1";
  const DEFAULT_STATE = {
    bookings: [],
    completed: [],
    ownerPhone: "",
    hours: { open: "09:00", close: "18:00", lunchStart: "13:00", lunchEnd: "14:00" }
  };
  const updates = typeof BroadcastChannel === "function" ? new BroadcastChannel(STORAGE_KEY) : null;

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved || typeof saved !== "object") return structuredClone(DEFAULT_STATE);
      return {
        bookings: Array.isArray(saved.bookings) ? saved.bookings : [],
        completed: Array.isArray(saved.completed) ? saved.completed : [],
        ownerPhone: typeof saved.ownerPhone === "string" ? saved.ownerPhone : "",
        hours: { ...DEFAULT_STATE.hours, ...(saved.hours || {}) }
      };
    } catch (error) {
      console.error("Could not load saved barbershop data.", error);
      return structuredClone(DEFAULT_STATE);
    }
  }

  function saveState(state, messageElement) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if (updates) updates.postMessage({ type: "state-updated" });
      return true;
    } catch (error) {
      console.error("Could not save barbershop data.", error);
      if (messageElement) {
        messageElement.textContent = "Your changes couldn't be saved in this browser.";
        messageElement.classList.add("error");
      }
      return false;
    }
  }

  function minutesOf(value) {
    const [hours, minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
  }

  function timeFromMinutes(minutes) {
    const date = new Date();
    date.setHours(0, minutes, 0, 0);
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function normalizeWorkTime(state, start) {
    const open = minutesOf(state.hours.open);
    const close = minutesOf(state.hours.close);
    const lunchStart = minutesOf(state.hours.lunchStart);
    const lunchEnd = minutesOf(state.hours.lunchEnd);
    const result = { date: new Date(start.date), minutes: Math.max(start.minutes, open) };

    if (result.minutes >= close) {
      result.date.setDate(result.date.getDate() + 1);
      result.minutes = open;
    } else if (result.minutes >= lunchStart && result.minutes < lunchEnd) {
      result.minutes = lunchEnd;
    }
    if (result.minutes >= close) {
      result.date.setDate(result.date.getDate() + 1);
      result.minutes = open;
    }
    return result;
  }

  function nextWorkTime(state) {
    const now = new Date();
    return normalizeWorkTime(state, {
      date: now,
      minutes: now.getHours() * 60 + now.getMinutes()
    });
  }

  function durationFor(booking) {
    if (Array.isArray(booking.perPersonServices)) {
      return booking.perPersonServices.reduce((total, services) => (
        total + services.reduce((personTotal, service) => personTotal + (SERVICES[service] || 0), 0)
      ), 0);
    }
    return booking.services.reduce((total, service) => total + (SERVICES[service] || 0), 0) * booking.partySize;
  }

  function elapsedServiceMs(booking, now = Date.now()) {
    if (!booking.startedAt) return 0;
    const startedAt = new Date(booking.startedAt).getTime();
    const elapsedUntil = booking.pausedAt ? new Date(booking.pausedAt).getTime() : now;
    const pausedDuration = Number(booking.totalPausedMs) || 0;
    return Math.max(0, elapsedUntil - startedAt - pausedDuration);
  }

  function serviceSummary(booking) {
    if (Array.isArray(booking.perPersonServices)) {
      return booking.perPersonServices
        .map((services, index) => `Person ${index + 1}: ${services.join(", ")}`)
        .join(" · ");
    }
    return booking.services.join(" · ");
  }

  function addWorkingMinutes(state, start, minutes) {
    let cursor = start.minutes;
    const date = new Date(start.date);
    const open = minutesOf(state.hours.open);
    const close = minutesOf(state.hours.close);
    const lunchStart = minutesOf(state.hours.lunchStart);
    const lunchEnd = minutesOf(state.hours.lunchEnd);
    let remaining = minutes;

    while (remaining > 0) {
      if (cursor < open) cursor = open;
      if (cursor >= close) {
        date.setDate(date.getDate() + 1);
        cursor = open;
      }
      if (cursor >= lunchStart && cursor < lunchEnd) cursor = lunchEnd;
      if (cursor >= close) continue;

      const workdayEnd = cursor < lunchStart ? Math.min(close, lunchStart) : close;
      const worked = Math.min(workdayEnd - cursor, remaining);
      cursor += worked;
      remaining -= worked;

      if (remaining > 0 && cursor === lunchStart && lunchEnd > lunchStart) cursor = lunchEnd;
      else if (remaining > 0 && cursor >= close) {
        date.setDate(date.getDate() + 1);
        cursor = open;
      }
    }
    return { date, minutes: cursor };
  }

  function getSchedule(state, durationOverrides = {}) {
    let cursor = nextWorkTime(state);
    const bookings = state.bookings.map(booking => {
      let start = cursor;
      const duration = durationOverrides[booking.id] ?? durationFor(booking);
      if (booking.startedAt) {
        const startedAt = new Date(booking.startedAt);
        start = { date: startedAt, minutes: startedAt.getHours() * 60 + startedAt.getMinutes() };
        const elapsedMinutes = elapsedServiceMs(booking) / 60_000;
        cursor = addWorkingMinutes(state, nextWorkTime(state), Math.max(0, duration - elapsedMinutes));
      } else {
        if (booking.scheduledAt) {
          const appointment = new Date(booking.scheduledAt);
          if (!Number.isNaN(appointment.getTime())) {
            const requested = normalizeWorkTime(state, {
              date: appointment,
              minutes: appointment.getHours() * 60 + appointment.getMinutes()
            });
            const requestedDay = new Date(requested.date);
            requestedDay.setHours(0, 0, 0, 0);
            const cursorDay = new Date(cursor.date);
            cursorDay.setHours(0, 0, 0, 0);
            if (requestedDay > cursorDay
              || (requestedDay.getTime() === cursorDay.getTime() && requested.minutes > cursor.minutes)) {
              start = requested;
            }
          }
        }
        cursor = addWorkingMinutes(state, start, duration);
      }
      return { booking, start };
    });
    return { bookings, nextAvailable: normalizeWorkTime(state, cursor) };
  }

  function getWalkInInsertionIndex(state, booking) {
    const appointmentIndex = state.bookings.findIndex(item => item.scheduledAt);
    if (appointmentIndex < 0) return state.bookings.length;

    const activeIndex = state.bookings.reduce(
      (lastActive, item, index) => item.startedAt ? index : lastActive,
      -1
    );
    const insertionIndex = Math.max(appointmentIndex, activeIndex + 1);
    if (insertionIndex > appointmentIndex) return state.bookings.length;

    const bookings = state.bookings.slice();
    bookings.splice(insertionIndex, 0, booking);
    const baselineSchedule = getSchedule(state);
    const updatedSchedule = getSchedule({ ...state, bookings });
    const appointmentsStayPut = baselineSchedule.bookings
      .filter(entry => entry.booking.scheduledAt)
      .every(({ booking: appointment, start }) => {
        const updated = updatedSchedule.bookings.find(entry => entry.booking.id === appointment.id);
        return updated
          && updated.start.date.toDateString() === start.date.toDateString()
          && updated.start.minutes === start.minutes;
      });

    return appointmentsStayPut ? insertionIndex : state.bookings.length;
  }

  function moveWalkInsIntoAppointmentGaps(state) {
    let bookings = state.bookings.slice();
    const appointmentIds = bookings.filter(booking => booking.scheduledAt).map(booking => booking.id);

    for (const appointmentId of appointmentIds) {
      let appointmentIndex = bookings.findIndex(booking => booking.id === appointmentId);
      if (appointmentIndex < 0) continue;

      const nextAppointmentIndex = bookings.findIndex((booking, index) => (
        index > appointmentIndex && booking.scheduledAt
      ));
      const candidateIds = bookings
        .slice(appointmentIndex + 1, nextAppointmentIndex < 0 ? undefined : nextAppointmentIndex)
        .filter(booking => !booking.startedAt)
        .map(booking => booking.id);

      for (const candidateId of candidateIds) {
        const candidateIndex = bookings.findIndex(booking => booking.id === candidateId);
        appointmentIndex = bookings.findIndex(booking => booking.id === appointmentId);
        if (candidateIndex < 0 || appointmentIndex < 0 || candidateIndex <= appointmentIndex) continue;

        const baseline = getSchedule({ ...state, bookings });
        const trialBookings = bookings.slice();
        const [candidate] = trialBookings.splice(candidateIndex, 1);
        appointmentIndex = trialBookings.findIndex(booking => booking.id === appointmentId);
        trialBookings.splice(appointmentIndex, 0, candidate);
        const trial = getSchedule({ ...state, bookings: trialBookings });
        const candidateStart = trial.bookings.find(entry => entry.booking.id === candidateId)?.start;
        const originalAppointmentsUnchanged = baseline.bookings
          .filter(entry => entry.booking.scheduledAt)
          .every(({ booking, start }) => {
            const updated = trial.bookings.find(entry => entry.booking.id === booking.id);
            return updated
              && updated.start.date.toDateString() === start.date.toDateString()
              && updated.start.minutes === start.minutes;
          });
        const appointmentStart = trial.bookings.find(entry => entry.booking.id === appointmentId)?.start;
        const candidatePrecedesAppointment = candidateStart && appointmentStart && (
          candidateStart.date < appointmentStart.date
          || (candidateStart.date.toDateString() === appointmentStart.date.toDateString()
            && candidateStart.minutes < appointmentStart.minutes)
        );

        if (originalAppointmentsUnchanged && candidatePrecedesAppointment) {
          bookings = trialBookings;
        }
      }
    }

    return bookings;
  }

  function canAutoStartBooking(booking, now = Date.now()) {
    if (!booking.scheduledAt) return true;
    const appointmentTime = new Date(booking.scheduledAt).getTime();
    return Number.isNaN(appointmentTime) || appointmentTime <= now;
  }

  function getAvailableAppointmentSlots(state, duration, days = 2, interval = 15) {
    const baseSchedule = getSchedule(state);
    const today = new Date();
    const open = minutesOf(state.hours.open);
    const close = minutesOf(state.hours.close);
    const lunchStart = minutesOf(state.hours.lunchStart);
    const lunchEnd = minutesOf(state.hours.lunchEnd);
    const slots = [];

    for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
      const date = new Date(today);
      date.setDate(today.getDate() + dayOffset);
      date.setHours(0, 0, 0, 0);

      const earliest = dayOffset === 0 ? Math.max(open, today.getHours() * 60 + today.getMinutes()) : open;
      let candidate = Math.ceil(earliest / interval) * interval;
      while (candidate < close) {
        if (candidate >= lunchStart && candidate < lunchEnd) {
          candidate = Math.ceil(lunchEnd / interval) * interval;
          continue;
        }

        const start = new Date(date);
        start.setMinutes(candidate);
        const end = addWorkingMinutes(state, { date, minutes: candidate }, duration);
        if (end.date.toDateString() === date.toDateString() && end.minutes <= close) {
          const candidateBooking = {
            id: `availability-check-${start.getTime()}`,
            scheduledAt: start.toISOString(),
            partySize: 1,
            services: []
          };
          const bookings = state.bookings.slice();
          const insertAt = bookings.findIndex(booking => booking.scheduledAt
            && new Date(booking.scheduledAt).getTime() > start.getTime());
          bookings.splice(insertAt < 0 ? bookings.length : insertAt, 0, candidateBooking);
          const simulated = getSchedule(
            { ...state, bookings },
            { [candidateBooking.id]: duration }
          );
          const candidateEntry = simulated.bookings.find(entry => entry.booking.id === candidateBooking.id);
          const existingAppointmentsStayPut = baseSchedule.bookings.every(({ booking, start: baseStart }) => {
            if (!booking.scheduledAt) return true;
            const simulatedEntry = simulated.bookings.find(entry => entry.booking.id === booking.id);
            return simulatedEntry
              && simulatedEntry.start.date.toDateString() === baseStart.date.toDateString()
              && simulatedEntry.start.minutes === baseStart.minutes;
          });
          if (candidateEntry
            && candidateEntry.start.date.toDateString() === start.toDateString()
            && candidateEntry.start.minutes === candidate
            && existingAppointmentsStayPut) {
            slots.push({
              scheduledAt: start.toISOString(),
              dateKey: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
              dateLabel: date.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" }),
              timeLabel: start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
            });
          }
        }
        candidate += interval;
      }
    }

    return slots;
  }

  function formatTime(start) {
    const now = new Date();
    const isToday = start.date.toDateString() === now.toDateString();
    const isTomorrow = start.date.toDateString() === new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toDateString();
    const time = timeFromMinutes(start.minutes);
    if (isToday) return time;
    if (isTomorrow) return `Tomorrow, ${time}`;
    return `${start.date.toLocaleDateString([], { weekday: "short" })}, ${time}`;
  }

  function formatScheduleDateTime(start) {
    const appointment = new Date(start.date);
    appointment.setHours(0, start.minutes, 0, 0);
    return appointment.toLocaleString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function shopIsOpen(state) {
    const now = new Date();
    const time = now.getHours() * 60 + now.getMinutes();
    return time >= minutesOf(state.hours.open) && time < minutesOf(state.hours.close)
      && !(time >= minutesOf(state.hours.lunchStart) && time < minutesOf(state.hours.lunchEnd));
  }

  function bookingNumber(name, phone) {
    const nameLetters = name.match(/\p{L}/gu) || [];
    const namePrefix = nameLetters.slice(0, 2).join("").toUpperCase();
    const phoneSuffix = phoneDigits(phone).slice(-3);
    return `${namePrefix}-${phoneSuffix}`;
  }

  function phoneDigits(phone) {
    return phone.replace(/\D/g, "");
  }

  function getServices() {
    return Object.entries(SERVICES).map(([name, minutes]) => ({ name, minutes }));
  }

  function subscribeToUpdates(callback) {
    let lastSavedState = localStorage.getItem(STORAGE_KEY);
    const refresh = () => {
      const savedState = localStorage.getItem(STORAGE_KEY);
      if (savedState === lastSavedState) return;
      lastSavedState = savedState;
      callback();
    };
    const handleBroadcast = event => {
      if (event.data?.type === "state-updated") {
        lastSavedState = localStorage.getItem(STORAGE_KEY);
        callback();
      }
    };
    const handleStorage = event => {
      if (event.key === STORAGE_KEY) {
        lastSavedState = event.newValue;
        callback();
      }
    };

    if (updates) updates.addEventListener("message", handleBroadcast);
    window.addEventListener("storage", handleStorage);
    const pollId = window.setInterval(refresh, 1000);
    return () => {
      if (updates) updates.removeEventListener("message", handleBroadcast);
      window.removeEventListener("storage", handleStorage);
      window.clearInterval(pollId);
    };
  }

  window.Goodhands = {
    STORAGE_KEY,
    loadState,
    saveState,
    minutesOf,
    timeFromMinutes,
    getSchedule,
    getWalkInInsertionIndex,
    moveWalkInsIntoAppointmentGaps,
    canAutoStartBooking,
    getAvailableAppointmentSlots,
    formatTime,
    formatScheduleDateTime,
    shopIsOpen,
    durationFor,
    elapsedServiceMs,
    bookingNumber,
    phoneDigits,
    serviceSummary,
    getServices,
    subscribeToUpdates
  };
})();
