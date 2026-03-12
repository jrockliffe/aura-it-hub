const state = {
  shortcuts: [],
  sortable: null,
  dragLockUntil: 0,
  toastTimer: 0,
};

const elements = {
  grid: document.getElementById("shortcuts-grid"),
  emptyState: document.getElementById("empty-state"),
  openModalButton: document.getElementById("open-modal-button"),
  closeModalButton: document.getElementById("close-modal-button"),
  cancelModalButton: document.getElementById("cancel-modal-button"),
  modal: document.getElementById("shortcut-modal"),
  modalBackdrop: document.getElementById("modal-backdrop"),
  form: document.getElementById("shortcut-form"),
  saveButton: document.getElementById("save-shortcut-button"),
  toast: document.getElementById("toast"),
};

function initialsFor(name) {
  const words = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (!words.length) {
    return "AI";
  }

  return words.map((word) => word[0].toUpperCase()).join("");
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.remove("hidden");

  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.add("hidden");
  }, 2800);
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Something went wrong.");
  }

  return payload;
}

function openShortcut(shortcut) {
  if (Date.now() < state.dragLockUntil) {
    return;
  }

  window.open(shortcut.url, "_blank", "noopener,noreferrer");
}

function createShortcutElement(shortcut) {
  const item = document.createElement("li");
  item.className = "shortcut-item";
  item.dataset.shortcutId = shortcut.id;

  const card = document.createElement("article");
  card.className = "shortcut-card glass-panel";
  card.tabIndex = 0;
  card.setAttribute("role", "link");
  card.setAttribute("aria-label", `Open ${shortcut.name}`);

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "tile-delete";
  deleteButton.setAttribute("aria-label", `Delete ${shortcut.name}`);
  deleteButton.textContent = "x";
  deleteButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (!window.confirm(`Delete the shortcut "${shortcut.name}"?`)) {
      return;
    }

    try {
      const payload = await requestJson(`/api/shortcuts/${shortcut.id}`, {
        method: "DELETE",
      });
      state.shortcuts = payload.shortcuts;
      renderShortcuts();
      showToast("Shortcut removed.");
    } catch (error) {
      showToast(error.message);
    }
  });

  const body = document.createElement("div");
  body.className = "shortcut-card-body";

  const iconFrame = document.createElement("div");
  iconFrame.className = "shortcut-icon-frame";

  const image = document.createElement("img");
  image.src = shortcut.iconPath;
  image.alt = `${shortcut.name} icon`;

  const fallback = document.createElement("div");
  fallback.className = "shortcut-fallback";
  fallback.textContent = initialsFor(shortcut.name);

  image.addEventListener("error", () => {
    image.style.display = "none";
    fallback.style.display = "flex";
  });

  const copy = document.createElement("div");
  copy.className = "shortcut-copy";

  const title = document.createElement("h4");
  title.className = "shortcut-name";
  title.textContent = shortcut.name;

  const host = document.createElement("p");
  host.className = "shortcut-host";
  host.textContent = shortcut.hostname;

  const meta = document.createElement("p");
  meta.className = "shortcut-meta";
  meta.textContent = "Drag to reorder";

  iconFrame.append(image, fallback);
  copy.append(title, host, meta);
  body.append(iconFrame, copy);
  card.append(deleteButton, body);

  card.addEventListener("click", () => openShortcut(shortcut));
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openShortcut(shortcut);
    }
  });

  item.append(card);
  return item;
}

function renderShortcuts() {
  elements.grid.replaceChildren();

  if (!state.shortcuts.length) {
    elements.emptyState.classList.remove("hidden");
    return;
  }

  elements.emptyState.classList.add("hidden");

  state.shortcuts.forEach((shortcut) => {
    elements.grid.append(createShortcutElement(shortcut));
  });

  if (!state.sortable) {
    initSortable();
  }
}

async function loadShortcuts() {
  state.shortcuts = await requestJson("/api/shortcuts");
  renderShortcuts();
}

function closeModal() {
  elements.modal.classList.add("hidden");
  elements.modalBackdrop.classList.add("hidden");
}

function openModal() {
  elements.modal.classList.remove("hidden");
  elements.modalBackdrop.classList.remove("hidden");
  window.setTimeout(() => {
    elements.form.elements.name.focus();
  }, 0);
}

async function persistOrder() {
  const orderedIds = [...elements.grid.children].map((item) => item.dataset.shortcutId);
  state.shortcuts = await requestJson("/api/shortcuts/order", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orderedIds }),
  });
}

function initSortable() {
  state.sortable = new Sortable(elements.grid, {
    animation: 180,
    ghostClass: "shortcut-placeholder",
    chosenClass: "shortcut-chosen",
    dragClass: "shortcut-dragging",
    draggable: ".shortcut-item",
    onStart() {
      document.body.classList.add("sorting");
      const activeCard = document.querySelector(".sortable-drag .shortcut-card");
      if (activeCard) {
        activeCard.classList.add("is-dragging");
      }
    },
    async onEnd() {
      document.body.classList.remove("sorting");
      state.dragLockUntil = Date.now() + 250;

      try {
        await persistOrder();
      } catch (error) {
        showToast(error.message);
        await loadShortcuts();
        return;
      }

      const orderedIds = [...elements.grid.children].map((item) => item.dataset.shortcutId);
      const lookup = new Map(state.shortcuts.map((shortcut) => [shortcut.id, shortcut]));
      state.shortcuts = orderedIds.map((id) => lookup.get(id)).filter(Boolean);
      showToast("Shortcut order updated.");
    },
  });
}

async function handleFormSubmit(event) {
  event.preventDefault();

  const formData = new FormData(elements.form);
  elements.saveButton.disabled = true;
  elements.saveButton.textContent = "Saving...";

  try {
    const shortcut = await requestJson("/api/shortcuts", {
      method: "POST",
      body: formData,
    });

    state.shortcuts = [...state.shortcuts, shortcut].sort((left, right) => left.order - right.order);
    renderShortcuts();
    elements.form.reset();
    closeModal();
    showToast("Shortcut saved.");
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.saveButton.disabled = false;
    elements.saveButton.textContent = "Save Shortcut";
  }
}

function bindEvents() {
  elements.openModalButton.addEventListener("click", openModal);
  elements.closeModalButton.addEventListener("click", closeModal);
  elements.cancelModalButton.addEventListener("click", closeModal);
  elements.modalBackdrop.addEventListener("click", closeModal);
  elements.form.addEventListener("submit", handleFormSubmit);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.modal.classList.contains("hidden")) {
      closeModal();
    }
  });
}

async function init() {
  bindEvents();

  try {
    await loadShortcuts();
  } catch (error) {
    showToast(error.message);
  }
}

init();
