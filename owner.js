(() => {
  "use strict";

  const authForm = document.getElementById("auth-form");
  const authPanel = document.getElementById("auth-panel");
  const dashboard = document.getElementById("owner-dashboard");
  const authMessage = document.getElementById("auth-message");
  const passwordInput = document.getElementById("owner-password");
  const logoutButton = document.getElementById("logout-button");
  const ownerBookingForm = document.getElementById("owner-booking-form");
  const ownerPersonServices = document.getElementById("owner-person-services");
  let ownerSelectedServices = [[]];
  let state = window.Goodhands.loadState();

  function setMessage(element, message, isError = false) {
    element.textContent = message;
    element.classList.toggle("error", isError);
  }

  function setAuthMode() {
    document.getElementById("auth-title").innerHTML = "Owner <em>login.</em>";
    document.getElementById("auth-intro").textContent = "Sign in with the owner account created in your Supabase project.";
    document.getElementById("auth-submit").innerHTML = "Log in <span aria-hidden=\"true\">↗</span>";
    passwordInput.autocomplete = "current-password";
  }

  function showDashboard() {
    authPanel.hidden = true;
    dashboard.hidden = false;
    logoutButton.hidden = false;
    render();
  }

  function showLogin() {
    authPanel.hidden = false;
    dashboard.hidden = true;
    logoutButton.hidden = true;
    document.getElementById("owner-email").value = "";
    passwordInput.value = "";
    setAuthMode();
  }

  function safeText(value) {
    const span = document.createElement("span");
    span.textContent = value;
    return span.innerHTML;
  }

  function renderOwnerServiceChoices() {
    const partySize = Number(document.getElementById("owner-party-size").value);
    ownerSelectedServices = Array.from({ length: partySize }, (_, index) => ownerSelectedServices[index] || []);
    const services = window.Goodhands.getServices();
    ownerPersonServices.innerHTML = ownerSelectedServices.map((selected, personIndex) => `
      <fieldset class="person-service-card">
        <legend>PERSON ${personIndex + 1}</legend>
        <div class="service-grid">
          ${services.map(({ name, minutes }) => `
            <label class="service-option">
              <input type="checkbox" name="owner-service-${personIndex}" value="${safeText(name)}"${selected.includes(name) ? " checked" : ""}>
              <span class="service-check"></span><span class="service-name">${safeText(name)}</span><span class="service-time">${minutes} MIN</span>
            </label>`).join("")}
        </div>
      </fieldset>`).join("");
    updateOwnerBookingEstimate();
  }

  function updateOwnerBookingEstimate() {
    const total = ownerSelectedServices.reduce((groupTotal, selected) => (
      groupTotal + selected.reduce((personTotal, name) => (
        personTotal + (window.Goodhands.getServices().find(service => service.name === name)?.minutes || 0)
      ), 0)
    ), 0);
    document.getElementById("owner-booking-estimate").textContent = total
      ? `Estimated group service time: ${total} min total.`
      : "Choose services for the group.";
  }

  function render() {
    const schedule = window.Goodhands.getSchedule(state);
    document.getElementById("manage-count").textContent = `${state.bookings.length} WAITING`;
    document.getElementById("completed-count").textContent = `(${state.completed.length})`;
    document.getElementById("open-time").value = state.hours.open;
    document.getElementById("close-time").value = state.hours.close;
    document.getElementById("lunch-start").value = state.hours.lunchStart;
    document.getElementById("lunch-end").value = state.hours.lunchEnd;
    document.getElementById("owner-phone").value = state.ownerPhone || "";

    const activeBookingExists = state.bookings.some(booking => booking.startedAt);
    document.getElementById("manage-list").innerHTML = schedule.bookings.length
      ? schedule.bookings.map(({ booking, start }) => `
        <article class="manage-row">
          <div class="manage-customer"><strong>${safeText(booking.name)}</strong><span>${safeText(booking.phone)}</span></div>
          <div class="manage-meta"><strong>${safeText(booking.bookingNumber || "Booking")}</strong>${booking.partySize} ${booking.partySize === 1 ? "person" : "people"}<br>${safeText(window.Goodhands.serviceSummary(booking))}</div>
          <div class="manage-meta"><strong>${booking.startedAt ? (booking.pausedAt ? "Paused" : "In chair") : (booking.scheduledAt ? window.Goodhands.formatScheduleDateTime(start) : window.Goodhands.formatTime(start))}</strong>${booking.startedAt ? (booking.pausedAt ? "service paused" : "service started") : (booking.scheduledAt ? "appointment time" : "est. chair")}</div>
          <div class="manage-actions">
            ${booking.startedAt ? "" : `<a class="call-button" href="tel:${safeText(booking.phone)}" aria-label="Call ${safeText(booking.name)}">Call</a>`}
            ${booking.startedAt
              ? `<button type="button" class="pause-button" data-toggle-pause="${safeText(booking.id)}" aria-label="${booking.pausedAt ? "Resume" : "Pause"} service for ${safeText(booking.name)}">${booking.pausedAt ? "Resume" : "Pause"}</button><button type="button" class="stop-button" data-stop="${safeText(booking.id)}" aria-label="Stop service for ${safeText(booking.name)}">Stop</button>`
              : (!activeBookingExists
                ? `<button type="button" class="start-button" data-start="${safeText(booking.id)}" aria-label="Start service for ${safeText(booking.name)}">Start</button>`
                : "")}
            <button type="button" class="complete-button" data-complete="${safeText(booking.id)}" aria-label="Complete visit for ${safeText(booking.name)}">Complete ✓</button>
          </div>
        </article>`).join("")
      : '<div class="empty-state"><strong>All caught up.</strong>New bookings will appear here.</div>';

    document.getElementById("completed-list").innerHTML = state.completed.length
      ? state.completed.slice().reverse().map(booking => `
        <div class="completed-row">
          <strong>${safeText(booking.name)}</strong>
          <span>${safeText(window.Goodhands.serviceSummary(booking))} · ${booking.partySize} ${booking.partySize === 1 ? "person" : "people"}</span>
        </div>`).join("")
      : '<div class="empty-state">Completed visits will show here.</div>';
  }

  document.getElementById("owner-party-size").addEventListener("change", renderOwnerServiceChoices);
  ownerPersonServices.addEventListener("change", event => {
    if (!event.target.matches('input[type="checkbox"]')) return;
    const personIndex = Number(event.target.name.slice("owner-service-".length));
    ownerSelectedServices[personIndex] = [
      ...ownerPersonServices.querySelectorAll(`input[name="${event.target.name}"]:checked`)
    ].map(input => input.value);
    updateOwnerBookingEstimate();
  });
  renderOwnerServiceChoices();

  ownerBookingForm.addEventListener("submit", async event => {
    event.preventDefault();
    const message = document.getElementById("owner-booking-message");
    setMessage(message, "");
    const name = document.getElementById("owner-customer-name").value.trim();
    const phone = document.getElementById("owner-customer-phone").value.trim();
    const partySize = Number(document.getElementById("owner-party-size").value);
    const perPersonServices = ownerSelectedServices.map(services => [...services]);
    const phoneDigits = window.Goodhands.phoneDigits(phone);

    if (!name || !phone || phoneDigits.length < 7 || phoneDigits.length > 15) {
      setMessage(message, "Enter a name and a valid phone number (7–15 digits).", true);
      return;
    }
    if (perPersonServices.length !== partySize || perPersonServices.some(services => services.length === 0)) {
      setMessage(message, "Choose at least one service for every person in the group.", true);
      return;
    }

    const booking = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      bookingNumber: window.Goodhands.bookingNumber(name, phone),
      name,
      phone,
      partySize,
      perPersonServices,
      services: [...new Set(perPersonServices.flat())],
      createdAt: new Date().toISOString(),
      addedByOwner: true
    };
    state.bookings.push(booking);
    if (!await window.Goodhands.saveState(state, message)) {
      state.bookings.pop();
      return;
    }

    ownerBookingForm.reset();
    ownerSelectedServices = [[]];
    renderOwnerServiceChoices();
    render();
    setMessage(message, `${booking.bookingNumber} added to the queue for ${partySize} ${partySize === 1 ? "person" : "people"}.`);
  });

  authForm.addEventListener("submit", async event => {
    event.preventDefault();
    setMessage(authMessage, "");
    try {
      await window.Goodhands.signInOwner(
        document.getElementById("owner-email").value.trim(),
        passwordInput.value
      );
      state = window.Goodhands.loadState();
      showDashboard();
    } catch (error) {
      console.error("Could not authenticate the owner.", error);
      setMessage(authMessage, "Login failed. Check your email and password, and confirm the account is authorized for this shop.", true);
    }
  });

  document.getElementById("hours-form").addEventListener("submit", async event => {
    event.preventDefault();
    const message = document.getElementById("hours-message");
    setMessage(message, "");
    const hours = {
      open: document.getElementById("open-time").value,
      close: document.getElementById("close-time").value,
      lunchStart: document.getElementById("lunch-start").value,
      lunchEnd: document.getElementById("lunch-end").value
    };
    const ownerPhone = document.getElementById("owner-phone").value.trim();
    const ownerPhoneDigits = window.Goodhands.phoneDigits(ownerPhone);
    if (!hours.open || !hours.close || !hours.lunchStart || !hours.lunchEnd
      || window.Goodhands.minutesOf(hours.open) >= window.Goodhands.minutesOf(hours.close)
      || window.Goodhands.minutesOf(hours.lunchStart) >= window.Goodhands.minutesOf(hours.lunchEnd)
      || window.Goodhands.minutesOf(hours.lunchStart) < window.Goodhands.minutesOf(hours.open)
      || window.Goodhands.minutesOf(hours.lunchEnd) > window.Goodhands.minutesOf(hours.close)
      || (ownerPhone && (ownerPhoneDigits.length < 7 || ownerPhoneDigits.length > 15))) {
      setMessage(message, "Check your hours and contact number. Hours must be valid; a contact number must have 7–15 digits.", true);
      return;
    }

    const previousHours = state.hours;
    const previousPhone = state.ownerPhone;
    state.hours = hours;
    state.ownerPhone = ownerPhone;
    if (!await window.Goodhands.saveState(state, message)) {
      state.hours = previousHours;
      state.ownerPhone = previousPhone;
      return;
    }
    render();
    setMessage(message, "Shop hours and contact details saved.");
  });

  document.getElementById("manage-list").addEventListener("click", async event => {
    const stopButton = event.target.closest("[data-stop]");
    if (stopButton) {
      const booking = state.bookings.find(item => item.id === stopButton.dataset.stop);
      if (!booking?.startedAt) return;
      const previousState = {
        startedAt: booking.startedAt,
        pausedAt: booking.pausedAt,
        totalPausedMs: booking.totalPausedMs
      };
      delete booking.startedAt;
      delete booking.pausedAt;
      delete booking.totalPausedMs;

      if (!await window.Goodhands.saveState(state, document.getElementById("manage-message"))) {
        booking.startedAt = previousState.startedAt;
        if (previousState.pausedAt !== undefined) booking.pausedAt = previousState.pausedAt;
        if (previousState.totalPausedMs !== undefined) booking.totalPausedMs = previousState.totalPausedMs;
        render();
        return;
      }
      render();
      setMessage(document.getElementById("manage-message"), `Service stopped for ${booking.name}. The customer is back in the queue; you can start another service.`);
      return;
    }

    const pauseButton = event.target.closest("[data-toggle-pause]");
    if (pauseButton) {
      const booking = state.bookings.find(item => item.id === pauseButton.dataset.togglePause);
      if (!booking?.startedAt) return;
      const previousPausedAt = booking.pausedAt;
      const previousTotalPausedMs = booking.totalPausedMs;

      if (booking.pausedAt) {
        booking.totalPausedMs = (Number(booking.totalPausedMs) || 0)
          + Math.max(0, Date.now() - new Date(booking.pausedAt).getTime());
        delete booking.pausedAt;
      } else {
        booking.pausedAt = new Date().toISOString();
      }

      if (!await window.Goodhands.saveState(state, document.getElementById("manage-message"))) {
        if (previousPausedAt) booking.pausedAt = previousPausedAt;
        else delete booking.pausedAt;
        if (previousTotalPausedMs === undefined) delete booking.totalPausedMs;
        else booking.totalPausedMs = previousTotalPausedMs;
        render();
        return;
      }
      render();
      setMessage(
        document.getElementById("manage-message"),
        booking.pausedAt
          ? `Service paused for ${booking.name}.`
          : `Service resumed for ${booking.name}.`
      );
      return;
    }

    const startButton = event.target.closest("[data-start]");
    if (startButton) {
      const index = state.bookings.findIndex(booking => booking.id === startButton.dataset.start);
      if (index < 0 || state.bookings.some(booking => booking.startedAt)) return;
      const [booking] = state.bookings.splice(index, 1);
      booking.startedAt = new Date().toISOString();
      state.bookings.unshift(booking);
      if (!await window.Goodhands.saveState(state, document.getElementById("manage-message"))) {
        state.bookings.shift();
        delete booking.startedAt;
        state.bookings.splice(index, 0, booking);
        render();
        return;
      }
      render();
      setMessage(document.getElementById("manage-message"), `Service started for ${booking.name}. Queue estimates now use the actual start time.`);
      return;
    }

    const button = event.target.closest("[data-complete]");
    if (!button) return;
    const index = state.bookings.findIndex(booking => booking.id === button.dataset.complete);
    if (index < 0) return;

    const [booking] = state.bookings.splice(index, 1);
    state.completed.push({ ...booking, completedAt: new Date().toISOString() });
    state.bookings = window.Goodhands.moveWalkInsIntoAppointmentGaps(state);
    const nextBooking = state.bookings.some(waiting => waiting.startedAt) ? null : state.bookings[0];
    const autoStartedBooking = nextBooking && window.Goodhands.canAutoStartBooking(nextBooking)
      ? nextBooking
      : null;
    if (autoStartedBooking) autoStartedBooking.startedAt = new Date().toISOString();
    if (!await window.Goodhands.saveState(state, document.getElementById("manage-message"))) {
      state.completed.pop();
      if (autoStartedBooking) delete autoStartedBooking.startedAt;
      state.bookings.splice(index, 0, booking);
      render();
      return;
    }
    render();
    setMessage(
      document.getElementById("manage-message"),
      autoStartedBooking
        ? `${booking.name} completed. Service automatically started for ${autoStartedBooking.name}.`
        : nextBooking?.scheduledAt
          ? `${booking.name} completed. The next appointment remains scheduled for ${window.Goodhands.formatScheduleDateTime(
            window.Goodhands.getSchedule(state).bookings.find(entry => entry.booking.id === nextBooking.id).start
          )}.`
        : `${booking.name} completed.`
    );
  });

  document.getElementById("completed-toggle").addEventListener("click", event => {
    const button = event.currentTarget;
    const isExpanded = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!isExpanded));
    document.getElementById("completed-list").hidden = isExpanded;
  });

  logoutButton.addEventListener("click", async () => {
    try {
      await window.Goodhands.signOutOwner();
    } catch (error) {
      console.error("Could not sign out the owner.", error);
      setMessage(authMessage, "Could not sign out. Please close this browser tab.", true);
    }
    showLogin();
  });

  window.Goodhands.subscribeToUpdates(() => {
    if (!dashboard.hidden) {
      state = window.Goodhands.loadState();
      render();
    }
  });

  function scheduleClockRefresh() {
    window.setTimeout(() => {
      if (!dashboard.hidden) render();
      scheduleClockRefresh();
    }, 60_000 - (Date.now() % 60_000));
  }

  window.Goodhands.isOwnerAuthenticated().then(isAuthenticated => {
    if (isAuthenticated) {
      state = window.Goodhands.loadState();
      showDashboard();
    }
    else showLogin();
  }).catch(error => {
    console.error("Could not check the owner session.", error);
    showLogin();
    setMessage(authMessage, "Could not verify the online owner session. Reload the page and try again.", true);
  });
  scheduleClockRefresh();
})();
