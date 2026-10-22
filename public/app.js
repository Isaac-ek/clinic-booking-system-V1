// Apex Clinic Patient Portal Logic
const DEFAULT_API_KEY = 'clinic-secret-key-2026';

let currentApiKey = localStorage.getItem('clinic_api_key') || DEFAULT_API_KEY;
let allSlots = [];
let selectedSlot = null;
let currentLookupEmail = '';
let currentCursor = null;
let cursorHistory = [];
let currentPage = 1;

// Elements
const providerFilter = document.getElementById('provider-filter');
const slotsLoading = document.getElementById('slots-loading');
const slotsEmpty = document.getElementById('slots-empty');
const slotsGrid = document.getElementById('slots-grid');
const availableCountPill = document.getElementById('available-count-pill');
const totalCountPill = document.getElementById('total-count-pill');
const refreshSlotsBtn = document.getElementById('refresh-slots-btn');
const seedDataBtn = document.getElementById('seed-data-btn');
const emptySeedBtn = document.getElementById('empty-seed-btn');

// Modals
const bookingModal = document.getElementById('booking-modal');
const confirmationModal = document.getElementById('confirmation-modal');
const myBookingsModal = document.getElementById('my-bookings-modal');
const settingsModal = document.getElementById('settings-modal');

// Booking Form
const bookingForm = document.getElementById('booking-form');
const formSlotId = document.getElementById('form-slot-id');
const patientNameInput = document.getElementById('patient-name');
const patientEmailInput = document.getElementById('patient-email');
const bookingErrorBanner = document.getElementById('booking-error-banner');
const bookingErrorText = document.getElementById('booking-error-text');
const submitBookingBtn = document.getElementById('submit-booking-btn');

// Confirmation Details
const confId = document.getElementById('conf-id');
const confDoctor = document.getElementById('conf-doctor');
const confDatetime = document.getElementById('conf-datetime');
const confPatient = document.getElementById('conf-patient');
const confStatus = document.getElementById('conf-status');
const copyConfIdBtn = document.getElementById('copy-conf-id-btn');
const confDoneBtn = document.getElementById('conf-done-btn');
const confViewMyBtn = document.getElementById('conf-view-my-btn');

// My Bookings
const openMyBookingsBtn = document.getElementById('open-my-bookings-btn');
const closeMyBookingsModal = document.getElementById('close-my-bookings-modal');
const lookupEmailInput = document.getElementById('lookup-email-input');
const findBookingsBtn = document.getElementById('find-bookings-btn');
const patientBookingsList = document.getElementById('patient-bookings-list');
const bookingsPagination = document.getElementById('bookings-pagination');
const prevPageBtn = document.getElementById('prev-page-btn');
const nextPageBtn = document.getElementById('next-page-btn');
const paginationInfo = document.getElementById('pagination-info');

// Settings
const openSettingsBtn = document.getElementById('open-settings-btn');
const closeSettingsModal = document.getElementById('close-settings-modal');
const settingsForm = document.getElementById('settings-form');
const apiKeyInput = document.getElementById('api-key-input');
const baseApiUrl = document.getElementById('base-api-url');
const resetApiKeyBtn = document.getElementById('reset-api-key-btn');

// Toast Container
const toastContainer = document.getElementById('toast-container');

// Helper to show modern toast
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✓' : '⚠️'}</span>
    <span>${message}</span>
  `;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Generate simple UUID for Idempotency
function generateUUID() {
  if (crypto && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'idemp_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

// Date formatting helper
function formatSlotDate(isoString) {
  const d = new Date(isoString);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function formatSlotTimeRange(startIso, endIso) {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const startTime = s.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const endTime = e.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  return `${startTime} – ${endTime}`;
}

// API Request Wrapper
async function apiFetch(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': currentApiKey,
    ...(options.headers || {})
  };

  const response = await fetch(endpoint, {
    ...options,
    headers
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    data = { raw: text };
  }

  return {
    status: response.statusCode || response.status,
    headers: response.headers,
    data
  };
}

// Fetch Slots
async function loadSlots() {
  slotsLoading.style.display = 'block';
  slotsEmpty.style.display = 'none';
  slotsGrid.style.display = 'none';

  try {
    const selectedProvider = providerFilter.value;
    const url = selectedProvider ? `/slots?provider=${encodeURIComponent(selectedProvider)}` : '/slots';
    const res = await apiFetch(url);

    if (res.status === 401) {
      showToast('Authentication failed: Please check your API Key in Settings', 'error');
      slotsLoading.style.display = 'none';
      return;
    }

    if (res.status !== 200) {
      showToast(res.data?.error || 'Failed to load slots', 'error');
      slotsLoading.style.display = 'none';
      return;
    }

    allSlots = res.data.slots || [];
    renderSlots(allSlots);
    updateProviderOptions();
  } catch (err) {
    console.error('Error fetching slots:', err);
    showToast('Network error loading slots', 'error');
  } finally {
    slotsLoading.style.display = 'none';
  }
}

// Populate Provider Dropdown
function updateProviderOptions() {
  const currentVal = providerFilter.value;
  // Get all unique providers across allSlots if no filter is applied
  const providers = Array.from(new Set(allSlots.map(s => s.provider))).sort();

  // Keep first "All Specialists" option
  providerFilter.innerHTML = '<option value="">All Specialists</option>';
  providers.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    if (p === currentVal) opt.selected = true;
    providerFilter.appendChild(opt);
  });
}

// Render Slots to Grid
function renderSlots(slots) {
  const total = slots.length;
  const available = slots.filter(s => s.available).length;

  availableCountPill.textContent = `${available} Available`;
  totalCountPill.textContent = `${total} Total Slots`;

  if (total === 0) {
    slotsEmpty.style.display = 'block';
    slotsGrid.style.display = 'none';
    return;
  }

  slotsEmpty.style.display = 'none';
  slotsGrid.style.display = 'grid';
  slotsGrid.innerHTML = '';

  slots.forEach(slot => {
    const card = document.createElement('div');
    card.className = `slot-card ${slot.available ? '' : 'booked'}`;

    const initials = slot.provider
      .split(' ')
      .map(w => w[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();

    const isPast = new Date(slot.start).getTime() <= Date.now();

    card.innerHTML = `
      <div class="slot-card-header">
        <div class="doctor-profile">
          <div class="doctor-avatar">${initials}</div>
          <div>
            <div class="doctor-name">${slot.provider}</div>
            <div class="doctor-specialty">Consultant Specialist</div>
          </div>
        </div>
        <span class="pill ${slot.available ? 'pill-success' : 'pill-booked'}">
          ${slot.available ? 'Available' : 'Booked'}
        </span>
      </div>

      <div class="slot-timing-details">
        <div class="timing-row">
          <span class="timing-key">Date</span>
          <span class="timing-value">${formatSlotDate(slot.start)}</span>
        </div>
        <div class="timing-row">
          <span class="timing-key">Time</span>
          <span class="timing-value">${formatSlotTimeRange(slot.start, slot.end)}</span>
        </div>
      </div>

      <div class="slot-actions">
        <button 
          class="btn btn-primary btn-sm" 
          ${!slot.available || isPast ? 'disabled' : ''} 
          data-slot-id="${slot.id}"
        >
          ${isPast ? 'Slot Passed' : slot.available ? 'Book Appointment' : 'Slot Taken'}
        </button>
      </div>
    `;

    const bookBtn = card.querySelector('button');
    if (slot.available && !isPast) {
      bookBtn.addEventListener('click', () => openBookingModal(slot));
    }

    slotsGrid.appendChild(card);
  });
}

// Open Booking Modal for a Slot
function openBookingModal(slot) {
  selectedSlot = slot;
  formSlotId.value = slot.id;
  
  const initials = slot.provider.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
  document.getElementById('modal-doc-avatar').textContent = initials;
  document.getElementById('modal-doc-name').textContent = slot.provider;
  document.getElementById('modal-slot-date').textContent = formatSlotDate(slot.start);
  document.getElementById('modal-slot-time').textContent = formatSlotTimeRange(slot.start, slot.end);

  bookingErrorBanner.style.display = 'none';
  bookingForm.reset();
  formSlotId.value = slot.id;

  bookingModal.showModal();
}

// Handle Booking Form Submission
bookingForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  bookingErrorBanner.style.display = 'none';

  const slotId = formSlotId.value;
  const name = patientNameInput.value.trim();
  const email = patientEmailInput.value.trim();

  if (!name) {
    showBookingError('Please enter your full name');
    patientNameInput.focus();
    return;
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showBookingError('Please enter a valid email address');
    patientEmailInput.focus();
    return;
  }

  // Idempotency Key generation
  const idempotencyKey = generateUUID();

  // Set loading state
  submitBookingBtn.disabled = true;
  submitBookingBtn.querySelector('.btn-text').textContent = 'Confirming...';
  submitBookingBtn.querySelector('.btn-spinner').style.display = 'inline-block';

  try {
    const res = await apiFetch('/bookings', {
      method: 'POST',
      headers: {
        'Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify({
        slot_id: slotId,
        name,
        email
      })
    });

    if (res.status === 201) {
      // Success!
      bookingModal.close();
      showConfirmation(res.data, selectedSlot);
      showToast('Appointment successfully booked!');
      loadSlots(); // Refresh slot availability
    } else if (res.status === 409) {
      showBookingError('This slot was just booked by another patient. Please choose another slot.');
      loadSlots();
    } else if (res.status === 429) {
      const retryAfter = res.headers.get('retry-after') || '60';
      showBookingError(`Too many booking attempts for this email. Please wait ${retryAfter} seconds.`);
    } else {
      showBookingError(res.data?.error || 'Unable to complete booking. Please try again.');
    }
  } catch (err) {
    console.error('Booking submission error:', err);
    showBookingError('Network error while booking. Please try again.');
  } finally {
    submitBookingBtn.disabled = false;
    submitBookingBtn.querySelector('.btn-text').textContent = 'Confirm Booking';
    submitBookingBtn.querySelector('.btn-spinner').style.display = 'none';
  }
});

function showBookingError(msg) {
  bookingErrorText.textContent = msg;
  bookingErrorBanner.style.display = 'flex';
}

// Show Confirmation Modal
function showConfirmation(booking, slot) {
  confId.textContent = booking.id;
  confDoctor.textContent = slot ? slot.provider : 'Doctor Specialist';
  confDatetime.textContent = slot ? `${formatSlotDate(slot.start)} • ${formatSlotTimeRange(slot.start, slot.end)}` : 'Confirmed Slot';
  confPatient.textContent = `${booking.name} (${booking.email})`;
  confStatus.textContent = booking.status;

  copyConfIdBtn.onclick = () => {
    navigator.clipboard.writeText(booking.id).then(() => {
      copyConfIdBtn.textContent = 'Copied!';
      setTimeout(() => copyConfIdBtn.textContent = 'Copy', 2000);
    });
  };

  confirmationModal.showModal();
}

confDoneBtn.addEventListener('click', () => {
  confirmationModal.close();
});

confViewMyBtn.addEventListener('click', () => {
  confirmationModal.close();
  openMyBookings();
  if (patientEmailInput.value) {
    lookupEmailInput.value = patientEmailInput.value.trim().toLowerCase();
    fetchPatientBookings(true);
  }
});

// My Bookings Logic
function openMyBookings() {
  myBookingsModal.showModal();
}

openMyBookingsBtn.addEventListener('click', openMyBookings);
closeMyBookingsModal.addEventListener('click', () => myBookingsModal.close());
document.getElementById('close-booking-modal').addEventListener('click', () => bookingModal.close());
document.getElementById('cancel-modal-btn').addEventListener('click', () => bookingModal.close());

findBookingsBtn.addEventListener('click', () => {
  fetchPatientBookings(true);
});

lookupEmailInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    fetchPatientBookings(true);
  }
});

async function fetchPatientBookings(resetPagination = false) {
  const email = lookupEmailInput.value.trim().toLowerCase();
  if (!email) {
    showToast('Please enter an email address', 'error');
    return;
  }

  currentLookupEmail = email;

  if (resetPagination) {
    currentCursor = null;
    cursorHistory = [];
    currentPage = 1;
  }

  patientBookingsList.innerHTML = `
    <div class="empty-state-sm">
      <div class="spinner"></div>
      <p style="margin-top: 0.75rem;">Loading your appointments...</p>
    </div>
  `;

  try {
    let url = `/bookings?email=${encodeURIComponent(email)}&limit=5`;
    if (currentCursor) {
      url += `&cursor=${encodeURIComponent(currentCursor)}`;
    }

    const res = await apiFetch(url);

    if (res.status !== 200) {
      patientBookingsList.innerHTML = `
        <div class="empty-state-sm">
          <p style="color: var(--danger);">${res.data?.error || 'Failed to load bookings'}</p>
        </div>
      `;
      return;
    }

    const bookings = res.data.bookings || [];
    const nextCursor = res.data.next_cursor;

    if (bookings.length === 0) {
      patientBookingsList.innerHTML = `
        <div class="empty-state-sm">
          <p>No bookings found for <strong>${email}</strong>.</p>
        </div>
      `;
      bookingsPagination.style.display = 'none';
      return;
    }

    patientBookingsList.innerHTML = '';
    bookings.forEach(b => {
      const card = document.createElement('div');
      card.className = 'booking-item-card';

      const isConfirmed = b.status === 'confirmed';

      card.innerHTML = `
        <div class="booking-item-left">
          <div class="booking-item-title">
            Booking #${b.id.substring(0, 8)}...
            <span class="pill ${isConfirmed ? 'pill-success' : 'pill-cancelled'}">${b.status}</span>
          </div>
          <div class="booking-item-meta">
            Slot ID: <code>${b.slot_id}</code> • Booked on: ${new Date(b.created_at).toLocaleString()}
          </div>
          <div class="booking-item-meta">Patient: ${b.name} (${b.email})</div>
        </div>
        <div class="booking-item-right">
          ${isConfirmed ? `<button class="btn btn-sm btn-danger cancel-booking-btn" data-booking-id="${b.id}">Cancel</button>` : ''}
        </div>
      `;

      if (isConfirmed) {
        const cancelBtn = card.querySelector('.cancel-booking-btn');
        cancelBtn.addEventListener('click', () => cancelBooking(b.id));
      }

      patientBookingsList.appendChild(card);
    });

    // Pagination controls
    bookingsPagination.style.display = 'flex';
    paginationInfo.textContent = `Page ${currentPage}`;
    prevPageBtn.disabled = cursorHistory.length === 0;
    nextPageBtn.disabled = !nextCursor;

    // Attach Next / Prev
    nextPageBtn.onclick = () => {
      if (nextCursor) {
        cursorHistory.push(currentCursor);
        currentCursor = nextCursor;
        currentPage++;
        fetchPatientBookings(false);
      }
    };

    prevPageBtn.onclick = () => {
      if (cursorHistory.length > 0) {
        currentCursor = cursorHistory.pop();
        currentPage--;
        fetchPatientBookings(false);
      }
    };

  } catch (err) {
    console.error('Error fetching bookings:', err);
    patientBookingsList.innerHTML = `
      <div class="empty-state-sm">
        <p style="color: var(--danger);">Error connecting to booking service</p>
      </div>
    `;
  }
}

// Cancel Booking
async function cancelBooking(bookingId) {
  if (!confirm('Are you sure you want to cancel this appointment? This will free the slot for other patients.')) {
    return;
  }

  try {
    const res = await apiFetch(`/bookings/${bookingId}`, {
      method: 'DELETE'
    });

    if (res.status === 200) {
      showToast('Appointment successfully cancelled');
      fetchPatientBookings(false);
      loadSlots(); // Refresh slot availability
    } else {
      showToast(res.data?.error || 'Failed to cancel appointment', 'error');
    }
  } catch (err) {
    console.error('Error cancelling booking:', err);
    showToast('Network error cancelling booking', 'error');
  }
}

// Demo Data Seeder (calls POST /reset)
async function seedDemoSlots() {
  const confirmSeed = confirm('Populate realistic demo doctor slots for testing? This will reset all current slots.');
  if (!confirmSeed) return;

  const now = Date.now();
  const day = 86400000;
  const hour = 3600000;

  const demoSlots = [
    {
      id: 'slot_ade_1',
      provider: 'Dr Ade',
      start: new Date(now + 1 * day + 9 * hour).toISOString(),
      end: new Date(now + 1 * day + 9.5 * hour).toISOString()
    },
    {
      id: 'slot_ade_2',
      provider: 'Dr Ade',
      start: new Date(now + 1 * day + 10 * hour).toISOString(),
      end: new Date(now + 1 * day + 10.5 * hour).toISOString()
    },
    {
      id: 'slot_bello_1',
      provider: 'Dr Bello',
      start: new Date(now + 1 * day + 11 * hour).toISOString(),
      end: new Date(now + 1 * day + 11.5 * hour).toISOString()
    },
    {
      id: 'slot_bello_2',
      provider: 'Dr Bello',
      start: new Date(now + 2 * day + 14 * hour).toISOString(),
      end: new Date(now + 2 * day + 14.5 * hour).toISOString()
    },
    {
      id: 'slot_fatima_1',
      provider: 'Dr Fatima',
      start: new Date(now + 2 * day + 15 * hour).toISOString(),
      end: new Date(now + 2 * day + 15.5 * hour).toISOString()
    },
    {
      id: 'slot_fatima_2',
      provider: 'Dr Fatima',
      start: new Date(now + 3 * day + 9 * hour).toISOString(),
      end: new Date(now + 3 * day + 9.5 * hour).toISOString()
    }
  ];

  try {
    const res = await apiFetch('/reset', {
      method: 'POST',
      body: JSON.stringify({ slots: demoSlots })
    });

    if (res.status === 200) {
      showToast('Demo slots successfully loaded!');
      loadSlots();
    } else {
      showToast(res.data?.error || 'Failed to populate demo slots', 'error');
    }
  } catch (err) {
    console.error('Error seeding demo slots:', err);
    showToast('Failed to connect to /reset endpoint', 'error');
  }
}

seedDataBtn.addEventListener('click', seedDemoSlots);
emptySeedBtn.addEventListener('click', seedDemoSlots);

// Filter & Refresh Listeners
providerFilter.addEventListener('change', () => {
  loadSlots();
});

refreshSlotsBtn.addEventListener('click', () => {
  loadSlots();
  showToast('Refreshed slot availability');
});

// Settings Modal
openSettingsBtn.addEventListener('click', () => {
  apiKeyInput.value = currentApiKey;
  baseApiUrl.value = window.location.origin;
  settingsModal.showModal();
});

closeSettingsModal.addEventListener('click', () => settingsModal.close());

settingsForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const newKey = apiKeyInput.value.trim();
  if (!newKey) {
    showToast('API Key cannot be empty', 'error');
    return;
  }
  currentApiKey = newKey;
  localStorage.setItem('clinic_api_key', newKey);
  settingsModal.close();
  showToast('API Key updated');
  loadSlots();
});

resetApiKeyBtn.addEventListener('click', () => {
  apiKeyInput.value = DEFAULT_API_KEY;
  currentApiKey = DEFAULT_API_KEY;
  localStorage.setItem('clinic_api_key', DEFAULT_API_KEY);
  settingsModal.close();
  showToast('Reset to default API Key');
  loadSlots();
});

// Check Health & Initial Load
async function checkSystemHealth() {
  try {
    const res = await fetch('/health');
    const badge = document.getElementById('system-status-badge');
    if (res.ok) {
      badge.innerHTML = '<span class="status-dot"></span><span class="status-text">API Online</span>';
    } else {
      badge.innerHTML = '<span class="status-dot" style="background: var(--warning)"></span><span class="status-text" style="color: var(--warning)">Connecting</span>';
    }
  } catch (e) {
    const badge = document.getElementById('system-status-badge');
    badge.innerHTML = '<span class="status-dot" style="background: var(--danger)"></span><span class="status-text" style="color: var(--danger)">Offline</span>';
  }
}

// Initial Run
checkSystemHealth();
loadSlots();
