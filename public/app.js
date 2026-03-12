const state = {
  shortcuts: [],
  sortable: null,
  dragLockUntil: 0,
  toastTimer: 0,
  editingShortcutId: "",
};

const elements = {
  grid: document.getElementById("shortcuts-grid"),
  emptyState: document.getElementById("empty-state"),
  openModalButton: document.getElementById("open-modal-button"),
  closeModalButton: document.getElementById("close-modal-button"),
  cancelModalButton: document.getElementById("cancel-modal-button"),
  modal: document.getElementById("shortcut-modal"),
  modalBackdrop: document.getElementById("modal-backdrop"),
  modalEyebrow: document.getElementById("modal-eyebrow"),
  modalTitle: document.getElementById("modal-title"),
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

function setModalMode(mode, shortcut = null) {
  const isEditing = mode === "edit" && shortcut;
  state.editingShortcutId = isEditing ? shortcut.id : "";
  elements.form.elements.shortcutId.value = state.editingShortcutId;
  elements.modalEyebrow.textContent = isEditing ? "Edit shortcut" : "Create shortcut";
  elements.modalTitle.textContent = isEditing ? `Edit ${shortcut.name}` : "Add a new HUB tile";
  elements.saveButton.textContent = isEditing ? "Save Changes" : "Save Shortcut";

  if (isEditing) {
    elements.form.elements.name.value = shortcut.name;
    elements.form.elements.url.value = shortcut.url;
    elements.form.elements.iconUrl.value = "";
    elements.form.elements.iconFile.value = "";
  } else {
    elements.form.reset();
  }
}

function openShortcut(shortcut) {
  if (Date.now() < state.dragLockUntil) {
    return;
  }

  window.open(shortcut.url, "_blank", "noopener,noreferrer");
}

function openModal(mode = "create", shortcut = null) {
  setModalMode(mode, shortcut);
  elements.modal.classList.remove("hidden");
  elements.modalBackdrop.classList.remove("hidden");
  window.setTimeout(() => {
    elements.form.elements.name.focus();
  }, 0);
}

function closeModal() {
  elements.modal.classList.add("hidden");
  elements.modalBackdrop.classList.add("hidden");
  setModalMode("create");
}

function upsertShortcut(shortcut) {
  const existingIndex = state.shortcuts.findIndex((entry) => entry.id === shortcut.id);
  if (existingIndex >= 0) {
    state.shortcuts.splice(existingIndex, 1, shortcut);
  } else {
    state.shortcuts.push(shortcut);
  }

  state.shortcuts.sort((left, right) => left.order - right.order);
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

  const actions = document.createElement("div");
  actions.className = "tile-actions";

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "tile-action-button";
  editButton.setAttribute("aria-label", `Edit ${shortcut.name}`);
  editButton.textContent = "Edit";
  editButton.addEventListener("click", (event) => {
    event.stopPropagation();
    openModal("edit", shortcut);
  });

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "tile-action-button tile-delete";
  deleteButton.setAttribute("aria-label", `Delete ${shortcut.name}`);
  deleteButton.textContent = "Delete";
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
  actions.append(editButton, deleteButton);
  card.append(actions, body);

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

async function persistOrder() {
  const orderedIds = [...elements.grid.children].map((item) => item.dataset.shortcutId);
  state.shortcuts = await requestJson("/api/shortcuts/order", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orderedIds }),
  });
}

function initSortable() {
  if (typeof Sortable === "undefined") {
    throw new Error("Drag and drop failed to load.");
  }

  state.sortable = new Sortable(elements.grid, {
    animation: 180,
    ghostClass: "shortcut-placeholder",
    chosenClass: "shortcut-chosen",
    dragClass: "shortcut-dragging",
    delayOnTouchOnly: true,
    delay: 120,
    draggable: ".shortcut-item",
    filter: ".tile-action-button",
    preventOnFilter: false,
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
  const shortcutId = String(formData.get("shortcutId") || "");
  const isEditing = Boolean(shortcutId);
  const url = isEditing ? `/api/shortcuts/${shortcutId}` : "/api/shortcuts";
  const method = isEditing ? "PUT" : "POST";
  const originalButtonText = isEditing ? "Save Changes" : "Save Shortcut";

  elements.saveButton.disabled = true;
  elements.saveButton.textContent = "Saving...";

  try {
    const shortcut = await requestJson(url, {
      method,
      body: formData,
    });

    upsertShortcut(shortcut);
    renderShortcuts();
    closeModal();
    showToast(isEditing ? "Shortcut updated." : "Shortcut saved.");
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.saveButton.disabled = false;
    elements.saveButton.textContent = originalButtonText;
  }
}

function bindEvents() {
  elements.openModalButton.addEventListener("click", () => openModal("create"));
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
  setModalMode("create");

  try {
    await loadShortcuts();
  } catch (error) {
    showToast(error.message);
  }
}

init();
