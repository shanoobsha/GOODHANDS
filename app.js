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
  const form = document.getElementById("booking-form");
  const queueList = document.getElementById("queue-list");
  const personServices = document.getElementById("person-services");
  const confirmation = document.getElementById("booking-confirmation");
  const afterHoursDialog = document.getElementById("after-hours-dialog");
  const appointmentDialog = document.getElementById("appointment-dialog");
  const appointmentDate = document.getElementById("appointment-date");
  const appointmentSlots = document.getElementById("appointment-slots");
  let state = window.Goodhands.loadState();
  let selectedServices = [[]];
  let pendingBooking = null;
  let pendingAppointmentSlot = null;

  function showMessage(message, isError = false) {
    const element = document.getElementById("form-message");
    element.textContent = message;
    element.classList.toggle("error", isError);
  }

  function safeText(value) {
    const span = document.createElement("span");
    span.textContent = value;
    return span.innerHTML;
  }

  function render() {
    const schedule = window.Goodhands.getSchedule(state);
    const people = state.bookings.reduce((total, booking) => total + booking.partySize, 0);
    const next = window.Goodhands.formatTime(schedule.nextAvailable);

    document.getElementById("hero-people").textContent = people;
    document.getElementById("hero-groups").textContent = state.bookings.length;
    document.getElementById("hero-next").textContent = next;
    document.getElementById("hero-next-note").textContent = state.bookings.length ? "after current bookings" : "next chair available";
    document.getElementById("queue-people").textContent = people;
    document.getElementById("queue-groups").textContent = state.bookings.length;
    document.getElementById("queue-next").textContent = next;
    document.getElementById("queue-updated").textContent = `UPDATED ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toUpperCase()}`;
    updateContactLinks();

    const status = document.getElementById("shop-status");
    status.textContent = window.Goodhands.shopIsOpen(state) ? "Open now" : `Opens ${window.Goodhands.timeFromMinutes(window.Goodhands.minutesOf(state.hours.open))}`;
    status.parentElement.classList.toggle("closed", !window.Goodhands.shopIsOpen(state));

    if (schedule.bookings.length === 0) {
      queueList.innerHTML = '<div class="empty-state"><strong>No one in the chair queue.</strong>Book a visit and your place will show up here.</div>';
      return;
    }

    queueList.innerHTML = schedule.bookings.map(({ booking, start }, index) => `
      <article class="queue-card">
        <span class="queue-position">${String(index + 1).padStart(2, "0")}</span>
        <div class="queue-customer"><strong>Guest ${String(index + 1).padStart(2, "0")}</strong><span>${safeText(booking.bookingNumber || `Booking ${String(index + 1).padStart(2, "0")}`)}</span></div>
        <span class="queue-service">${safeText(window.Goodhands.serviceSummary(booking))}</span>
        <span class="queue-party">${booking.partySize} ${booking.partySize === 1 ? "person" : "people"}</span>
        ${booking.startedAt
          ? `<div class="queue-time"><strong class="service-timer${booking.pausedAt ? " service-timer-paused" : ""}" data-started-at="${safeText(booking.startedAt)}" data-paused-at="${safeText(booking.pausedAt || "")}" data-total-paused-ms="${Number(booking.totalPausedMs) || 0}" data-duration-minutes="${window.Goodhands.durationFor(booking)}">00:00:00</strong><span>${booking.pausedAt ? "SERVICE PAUSED" : "SERVICE IN PROGRESS"}</span></div>`
          : `<div class="queue-time"><strong>${booking.scheduledAt ? window.Goodhands.formatScheduleDateTime(start) : window.Goodhands.formatTime(start)}</strong><span>${booking.scheduledAt ? "APPOINTMENT TIME" : "EST. CHAIR TIME"}</span></div>`}
      </article>`).join("");
    updateServiceTimers();
  }

  function updateServiceTimers() {
    document.querySelectorAll(".service-timer").forEach(timer => {
      const booking = {
        startedAt: timer.dataset.startedAt,
        pausedAt: timer.dataset.pausedAt,
        totalPausedMs: Number(timer.dataset.totalPausedMs)
      };
      const elapsedSeconds = Math.floor(window.Goodhands.elapsedServiceMs(booking) / 1000);
      const hours = Math.floor(elapsedSeconds / 3600);
      const minutes = Math.floor((elapsedSeconds % 3600) / 60);
      const seconds = elapsedSeconds % 60;
      const elapsed = [hours, minutes, seconds].map(value => String(value).padStart(2, "0")).join(":");
      timer.textContent = `${timer.dataset.pausedAt ? "PAUSED · " : ""}${elapsed}`;
      timer.classList.toggle("service-timer-overdue", elapsedSeconds > Number(timer.dataset.durationMinutes) * 60);
    });
  }

  function updateContactLink(link, href) {
    const digits = window.Goodhands.phoneDigits(state.ownerPhone);
    link.hidden = !digits;
    if (digits) link.href = href(digits);
  }

  function updateContactLinks() {
    updateContactLink(document.getElementById("contact-owner"), digits => `tel:+${digits}`);
    updateContactLink(document.getElementById("whatsapp-owner"), digits => `https://wa.me/${digits}`);
  }

  function showConfirmation(booking, estimatedStart) {
    document.getElementById("confirmation-number").textContent = booking.bookingNumber;
    document.getElementById("confirmation-time").textContent = booking.scheduledAt
      ? window.Goodhands.formatScheduleDateTime(estimatedStart)
      : window.Goodhands.formatTime(estimatedStart);
    document.getElementById("confirmation-type").lastChild.textContent = booking.scheduledAt ? " APPOINTMENT CONFIRMED" : " YOU'RE IN THE QUEUE";
    document.getElementById("confirmation-time-label").textContent = booking.scheduledAt ? "APPOINTMENT TIME" : "ESTIMATED CHAIR TIME";
    updateContactLink(document.getElementById("confirmation-call"), digits => `tel:+${digits}`);
    updateContactLink(document.getElementById("confirmation-whatsapp"), digits => `https://wa.me/${digits}`);
    confirmation.showModal();
  }

  function showAfterHoursPrompt(booking) {
    pendingBooking = booking;
    document.getElementById("closing-time").textContent = window.Goodhands.timeFromMinutes(
      window.Goodhands.minutesOf(state.hours.close)
    );
    const digits = window.Goodhands.phoneDigits(state.ownerPhone);
    const callLink = document.getElementById("after-hours-call");
    const whatsappLink = document.getElementById("after-hours-whatsapp");
    callLink.hidden = !digits;
    whatsappLink.hidden = !digits;
    document.getElementById("after-hours-no-contact").hidden = Boolean(digits);
    if (digits) {
      callLink.href = `tel:+${digits}`;
      whatsappLink.href = `https://wa.me/${digits}`;
    }
    afterHoursDialog.showModal();
  }

  async function saveBooking(booking) {
    try {
      state = await window.Goodhands.refreshState();
    } catch (error) {
      console.error("Could not verify the latest queue before booking.", error);
      showMessage("The live queue couldn't be reached. Please try again.", true);
      return false;
    }
    const appointmentTime = booking.scheduledAt ? new Date(booking.scheduledAt).getTime() : null;
    const bookingIndex = appointmentTime === null
      ? window.Goodhands.getWalkInInsertionIndex(state, booking)
      : (() => {
        const insertAt = state.bookings.findIndex(existing => (
          existing.scheduledAt && new Date(existing.scheduledAt).getTime() > appointmentTime
        ));
        return insertAt < 0 ? state.bookings.length : insertAt;
      })();
    if (!await window.Goodhands.createBooking(booking, bookingIndex, document.getElementById("form-message"))) {
      return false;
    }

    state = window.Goodhands.loadState();
    const estimatedStart = window.Goodhands.getSchedule(state).bookings.find(item => item.booking.id === booking.id).start;
    render();
    form.reset();
    selectedServices = [[]];
    renderPersonServices();
    showConfirmation(booking, estimatedStart);
    return true;
  }

  function buildBooking() {
    showMessage("");
    if (!form.reportValidity()) return null;
    const name = document.getElementById("customer-name").value.trim();
    const phone = document.getElementById("customer-phone").value.trim();
    const partySize = Number(document.getElementById("party-size").value);
    const perPersonServices = selectedServices.map(services => [...services]);
    if (!name || !phone || perPersonServices.some(services => services.length === 0)) {
      showMessage("Please enter your name and phone number, then choose at least one service for each person.", true);
      return null;
    }
    const phoneDigits = window.Goodhands.phoneDigits(phone);
    if (phoneDigits.length < 7 || phoneDigits.length > 15) {
      showMessage("Please enter a valid phone number (7–15 digits).", true);
      return null;
    }

    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      bookingNumber: window.Goodhands.bookingNumber(name, phone),
      name,
      phone,
      partySize,
      perPersonServices,
      services: [...new Set(perPersonServices.flat())],
      createdAt: new Date().toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    };
  }

  function renderAppointmentSlots(preferredSlot = pendingAppointmentSlot) {
    const duration = window.Goodhands.durationFor(pendingBooking);
    const slots = window.Goodhands.getAvailableAppointmentSlots(state, duration, 2, 15);
    const dates = [...new Map(slots.map(slot => [slot.dateKey, slot.dateLabel])).entries()];
    const previousDate = appointmentDate.value;
    appointmentDate.replaceChildren();
    dates.forEach(([dateKey, dateLabel]) => {
      const option = document.createElement("option");
      option.value = dateKey;
      option.textContent = dateLabel;
      appointmentDate.append(option);
    });

    if (!dates.length) {
      appointmentDate.disabled = true;
      appointmentSlots.replaceChildren();
      document.getElementById("appointment-message").textContent = "No appointment times are available today or tomorrow.";
      document.getElementById("appointment-message").classList.remove("error");
      pendingAppointmentSlot = null;
      document.getElementById("confirm-appointment").disabled = true;
      return;
    }

    appointmentDate.disabled = false;
    appointmentDate.value = dates.some(([dateKey]) => dateKey === previousDate) ? previousDate : dates[0][0];
    const daySlots = slots.filter(slot => slot.dateKey === appointmentDate.value);
    const stillAvailable = daySlots.some(slot => slot.scheduledAt === preferredSlot);
    pendingAppointmentSlot = stillAvailable ? preferredSlot : null;
    appointmentSlots.replaceChildren();
    daySlots.forEach(slot => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "appointment-slot";
      button.textContent = slot.timeLabel;
      button.dataset.scheduledAt = slot.scheduledAt;
      button.setAttribute("aria-pressed", String(slot.scheduledAt === pendingAppointmentSlot));
      button.addEventListener("click", () => {
        pendingAppointmentSlot = slot.scheduledAt;
        appointmentSlots.querySelectorAll(".appointment-slot").forEach(option => {
          option.setAttribute("aria-pressed", String(option === button));
        });
        document.getElementById("appointment-message").textContent = "";
        document.getElementById("appointment-message").classList.remove("error");
        document.getElementById("confirm-appointment").disabled = false;
      });
      appointmentSlots.append(button);
    });
    const message = document.getElementById("appointment-message");
    if (preferredSlot && !stillAvailable) {
      message.textContent = "That time is no longer available. Please choose another.";
      message.classList.add("error");
    } else {
      message.textContent = "";
      message.classList.remove("error");
    }
    document.getElementById("confirm-appointment").disabled = !pendingAppointmentSlot;
  }

  function renderPersonServices() {
    const partySize = Number(document.getElementById("party-size").value);
    selectedServices = Array.from({ length: partySize }, (_, index) => selectedServices[index] || []);
    personServices.innerHTML = selectedServices.map((services, personIndex) => `
      <fieldset class="person-service-card">
        <legend>PERSON ${personIndex + 1}</legend>
        <div class="service-grid">
          ${Object.entries(SERVICES).map(([service, minutes]) => `
            <label class="service-option">
              <input type="checkbox" name="service-${personIndex}" value="${safeText(service)}"${services.includes(service) ? " checked" : ""}>
              <span class="service-check"></span><span class="service-name">${safeText(service)}</span><span class="service-time">${minutes} MIN</span>
            </label>`).join("")}
        </div>
      </fieldset>`).join("");
    updateBookingEstimate();
  }

  function updateBookingEstimate() {
    const total = selectedServices.reduce((groupTotal, services) => (
      groupTotal + services.reduce((personTotal, service) => personTotal + SERVICES[service], 0)
    ), 0);
    document.getElementById("booking-estimate").textContent = total
      ? `Estimated group service time: ${total} min total.`
      : "Choose at least one service for every person.";
  }

  document.getElementById("party-size").addEventListener("change", renderPersonServices);
  personServices.addEventListener("change", event => {
    if (!event.target.matches('input[type="checkbox"]')) return;
    const personIndex = Number(event.target.name.slice("service-".length));
    selectedServices[personIndex] = [...personServices.querySelectorAll(`input[name="${event.target.name}"]:checked`)]
      .map(input => input.value);
    updateBookingEstimate();
  });
  renderPersonServices();

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const booking = buildBooking();
    if (!booking) return;

    const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
    if (nowMinutes >= window.Goodhands.minutesOf(state.hours.close)) {
      showAfterHoursPrompt(booking);
      return;
    }

    await saveBooking(booking);
  });

  document.getElementById("choose-appointment").addEventListener("click", async () => {
    const booking = buildBooking();
    if (!booking) return;
    try {
      state = await window.Goodhands.refreshState();
    } catch (error) {
      console.error("Could not load appointment availability.", error);
      showMessage("Appointment availability couldn't be loaded. Please try again.", true);
      return;
    }
    pendingBooking = booking;
    pendingAppointmentSlot = null;
    renderAppointmentSlots();
    appointmentDialog.showModal();
  });
  appointmentDate.addEventListener("change", () => {
    pendingAppointmentSlot = null;
    renderAppointmentSlots();
  });
  document.getElementById("confirm-appointment").addEventListener("click", async () => {
    if (!pendingBooking || !pendingAppointmentSlot) return;
    try {
      state = await window.Goodhands.refreshState();
    } catch (error) {
      console.error("Could not verify the selected appointment.", error);
      document.getElementById("appointment-message").textContent = "The live queue couldn't be reached. Please try again.";
      document.getElementById("appointment-message").classList.add("error");
      return;
    }
    const stillAvailable = window.Goodhands.getAvailableAppointmentSlots(
      state,
      window.Goodhands.durationFor(pendingBooking),
      2,
      15
    ).some(slot => slot.scheduledAt === pendingAppointmentSlot);
    if (!stillAvailable) {
      renderAppointmentSlots(pendingAppointmentSlot);
      return;
    }

    pendingBooking.scheduledAt = pendingAppointmentSlot;
    const booking = pendingBooking;
    pendingBooking = null;
    pendingAppointmentSlot = null;
    appointmentDialog.close();
    await saveBooking(booking);
  });
  document.getElementById("cancel-appointment").addEventListener("click", () => {
    pendingBooking = null;
    pendingAppointmentSlot = null;
    appointmentDialog.close();
  });
  appointmentDialog.addEventListener("click", event => {
    if (event.target === appointmentDialog) {
      pendingBooking = null;
      pendingAppointmentSlot = null;
      appointmentDialog.close();
    }
  });

  document.getElementById("book-tomorrow").addEventListener("click", async () => {
    if (!pendingBooking) return;
    const booking = pendingBooking;
    pendingBooking = null;
    afterHoursDialog.close();
    await saveBooking(booking);
  });
  document.getElementById("cancel-after-hours").addEventListener("click", () => {
    pendingBooking = null;
    afterHoursDialog.close();
  });
  afterHoursDialog.addEventListener("click", event => {
    if (event.target === afterHoursDialog) {
      pendingBooking = null;
      afterHoursDialog.close();
    }
  });

  document.getElementById("confirmation-close").addEventListener("click", () => confirmation.close());
  confirmation.addEventListener("click", event => {
    if (event.target === confirmation) confirmation.close();
  });

  window.Goodhands.subscribeToUpdates(() => {
    state = window.Goodhands.loadState();
    render();
    if (appointmentDialog.open && pendingBooking) renderAppointmentSlots();
  });

  function scheduleClockRefresh() {
    window.setTimeout(() => {
      render();
      scheduleClockRefresh();
    }, 60_000 - (Date.now() % 60_000));
  }

  render();
  window.setInterval(updateServiceTimers, 1000);
  scheduleClockRefresh();
})();
