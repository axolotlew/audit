/*
 * Main script for the classroom schedule web application.
 *
 * This module implements the logic for uploading and parsing Excel files,
 * persisting schedule data in the browser, and rendering an interactive
 * timetable. It uses the SheetJS library (xlsx.full.min.js) to parse
 * uploaded XLSX/XLS files on the client side. Data is cached in
 * localStorage to avoid re-uploading the same file on subsequent visits.
 */

// Register the service worker to enable offline support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}

// Event handler for when the page finishes loading
document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('fileInput');
  const uploadBtn = document.getElementById('uploadBtn');
  const replaceBtn = document.getElementById('replaceBtn');

  // Trigger the hidden file input when the upload button is clicked
  uploadBtn.addEventListener('click', () => {
    fileInput.click();
  });

  // Parse the uploaded file when a selection is made
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    parseScheduleFile(file);
  });

  // Provide an option to clear the saved schedule and upload another
  replaceBtn.addEventListener('click', () => {
    if (confirm('Удалить сохранённое расписание и загрузить новое?')) {
      localStorage.removeItem('schedule');
      // Reset controls and state
      document.getElementById('controls').style.display = 'none';
      document.getElementById('schedule').innerHTML = '';
      document.getElementById('status').textContent = 'Загрузите файл расписания.';
      replaceBtn.style.display = 'none';
    }
  });

  // Initialize the page using any cached schedule
  initSchedule();
});

/**
 * Parse an uploaded Excel file into a schedule data structure and persist it.
 *
 * Uses the SheetJS library to read the workbook into a JSON representation.
 * Expects a header row containing Russian column names such as "Дата",
 * "Время начала", etc. Dates are converted to ISO YYYY-MM-DD strings.
 *
 * @param {File} file The Excel file selected by the user.
 */
function parseScheduleFile(file) {
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const data = new Uint8Array(evt.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      // Convert the sheet into a 2D array where each inner array is a row
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      // Find the header row by looking for cells containing known Russian headers
      const headerIndex = rows.findIndex((row) => {
        return row.includes('Дата') && row.includes('Время начала');
      });
      if (headerIndex === -1) {
        alert('Не удалось найти строку заголовка в файле. Убедитесь, что файл соответствует шаблону.');
        return;
      }
      const headerRow = rows[headerIndex];
      // Map column names to indices for easy lookup
      const headerMap = {};
      headerRow.forEach((cell, idx) => {
        if (typeof cell === 'string' && cell.trim().length > 0) {
          headerMap[cell.trim()] = idx;
        }
      });
      // Extract data rows after the header
      const dataRows = rows.slice(headerIndex + 1).filter((r) => r && r.length > 0 && r[headerMap['Дата']]);
      const events = [];
      dataRows.forEach((row) => {
        // Skip empty lines
        const rawDate = row[headerMap['Дата']];
        if (!rawDate) return;
        // Convert date strings or Excel date numbers into JS Date objects
        let dateObj;
        if (rawDate instanceof Date) {
          dateObj = rawDate;
        } else if (typeof rawDate === 'number') {
          // Excel stores dates as the number of days since 1899-12-30
          const epoch = new Date(Date.UTC(1899, 11, 30));
          dateObj = new Date(epoch.getTime() + rawDate * 24 * 60 * 60 * 1000);
        } else {
          const parts = rawDate.toString().split(/\.|\//);
          // Expect DD.MM.YYYY or DD/MM/YYYY
          if (parts.length === 3) {
            const [d, m, y] = parts;
            dateObj = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
          } else {
            dateObj = new Date(rawDate);
          }
        }
        const yyyy = dateObj.getFullYear().toString().padStart(4, '0');
        const mm = (dateObj.getMonth() + 1).toString().padStart(2, '0');
        const dd = dateObj.getDate().toString().padStart(2, '0');
        const isoDate = `${yyyy}-${mm}-${dd}`;
        // Extract other fields with graceful fallback
        const start = (row[headerMap['Время начала']] || '').toString().trim();
        const end = (row[headerMap['Время окончания']] || '').toString().trim();
        const dayOfWeek = (row[headerMap['День недели']] || '').toString().trim();
        const discipline = (row[headerMap['Дисциплина']] || '').toString().trim();
        const type = (row[headerMap['Вид работы']] || '').toString().trim();
        const group = (row[headerMap['Контингент']] || '').toString().trim();
        const building = (row[headerMap['Корпус']] || '').toString().trim();
        const room = (row[headerMap['Аудитория']] || '').toString().trim();
        const teacher = (row[headerMap['Преподаватель']] || '').toString().trim();
        events.push({ date: isoDate, start, end, dayOfWeek, discipline, type, group, building, room, teacher });
      });
      // Persist the parsed events to localStorage
      localStorage.setItem('schedule', JSON.stringify(events));
      // Initialize the schedule with the new data
      initSchedule();
    } catch (err) {
      console.error('Ошибка при разборе файла:', err);
      alert('Произошла ошибка при чтении файла. Проверьте формат и попробуйте снова.');
    }
  };
  reader.readAsArrayBuffer(file);
}

/**
 * Initialise the app by reading any saved schedule from localStorage.
 *
 * If a schedule is present, populate the building and date selectors and
 * render the corresponding table. Otherwise, prompt the user to upload
 * a file. This function is idempotent and can be called after loading
 * a new schedule.
 */
function initSchedule() {
  const statusEl = document.getElementById('status');
  const replaceBtn = document.getElementById('replaceBtn');
  const controls = document.getElementById('controls');
  const scheduleContainer = document.getElementById('schedule');
  // Retrieve stored events
  const stored = localStorage.getItem('schedule');
  if (!stored) {
    statusEl.textContent = 'Загрузите файл расписания.';
    controls.style.display = 'none';
    replaceBtn.style.display = 'none';
    scheduleContainer.innerHTML = '';
    return;
  }
  let events;
  try {
    events = JSON.parse(stored);
  } catch (e) {
    console.warn('Stored schedule could not be parsed; clearing.');
    localStorage.removeItem('schedule');
    statusEl.textContent = 'Загрузите файл расписания.';
    controls.style.display = 'none';
    replaceBtn.style.display = 'none';
    scheduleContainer.innerHTML = '';
    return;
  }
  if (!Array.isArray(events) || events.length === 0) {
    statusEl.textContent = 'Файл расписания не содержит данных.';
    controls.style.display = 'none';
    replaceBtn.style.display = 'none';
    scheduleContainer.innerHTML = '';
    return;
  }
  // Show the replace button now that data exists
  replaceBtn.style.display = 'inline-block';
  // Determine unique buildings and dates
  const buildings = Array.from(new Set(events.map((ev) => ev.building))).sort();
  const dates = Array.from(new Set(events.map((ev) => ev.date))).sort();
  // Populate the selectors
  const buildingSelect = document.getElementById('buildingSelect');
  const dateSelect = document.getElementById('dateSelect');
  buildingSelect.innerHTML = buildings
    .map((b) => {
      // Escape quotes in the value attribute to avoid breaking the HTML
      const safeValue = escapeHtml(b);
      const safeLabel = b || 'Неизвестный корпус';
      return `<option value="${safeValue}">${escapeHtml(safeLabel)}</option>`;
    })
    .join('');
  dateSelect.innerHTML = dates
    .map((d) => `<option value="${d}">${escapeHtml(d)}</option>`)
    .join('');
  // Show the controls section
  controls.style.display = 'flex';
  // When the selection changes, re-render
  buildingSelect.onchange = renderSchedule;
  dateSelect.onchange = renderSchedule;
  // Render the initial table
  renderSchedule();
}

/**
 * Render the schedule table for the selected building and date.
 *
 * The timetable is rendered as a grid where rows represent distinct start
 * times and columns represent rooms. Each cell shows the subject and group
 * name when a lecture occupies the slot, or "Свободно" when the room is
 * available. The first column enumerates the pair number based on the
 * sorted times.
 */
function renderSchedule() {
  const scheduleContainer = document.getElementById('schedule');
  const statusEl = document.getElementById('status');
  const stored = localStorage.getItem('schedule');
  if (!stored) return;
  const events = JSON.parse(stored);
  const building = document.getElementById('buildingSelect').value;
  const date = document.getElementById('dateSelect').value;
  // Filter events for the selected building and date
  const dailyEvents = events.filter((ev) => ev.building === building && ev.date === date);
  if (dailyEvents.length === 0) {
    scheduleContainer.innerHTML = '<p>Нет занятий для выбранной даты.</p>';
    statusEl.textContent = '';
    return;
  }
  // Derive unique rooms and times
  const rooms = Array.from(new Set(dailyEvents.map((ev) => ev.room))).sort();
  const times = Array.from(new Set(dailyEvents.map((ev) => ev.start))).sort((a, b) => {
    const [ah, am] = a.split(':').map((v) => parseInt(v, 10));
    const [bh, bm] = b.split(':').map((v) => parseInt(v, 10));
    return ah * 60 + am - (bh * 60 + bm);
  });
  // Build HTML table
  let html = '<table class="schedule-table"><thead><tr>';
  html += '<th>Пара</th><th>Время</th>';
  rooms.forEach((room) => {
    html += `<th>${room}</th>`;
  });
  html += '</tr></thead><tbody>';
  times.forEach((time, idx) => {
    html += `<tr><td>${idx + 1}</td><td>${time}</td>`;
    rooms.forEach((room) => {
      const ev = dailyEvents.find((e) => e.room === room && e.start === time);
      if (ev) {
        const subj = ev.discipline || '';
        const grp = ev.group || '';
        html += `<td class="occupied"><div class="subject">${escapeHtml(subj)}</div><div class="group">${escapeHtml(grp)}</div></td>`;
      } else {
        html += '<td class="free">Свободно</td>';
      }
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  scheduleContainer.innerHTML = html;
  statusEl.textContent = '';
}

/**
 * Escape HTML special characters to prevent XSS when rendering cell content.
 *
 * @param {string} str The raw string value.
 * @returns {string} The escaped string safe for insertion into HTML.
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}